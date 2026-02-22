// Meta press-release.html から損益計算書データを抽出するスクリプト
// テーブルタイトル: "CONDENSED CONSOLIDATED STATEMENTS OF INCOME"
// 出力: financials.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'financials.json');

// テーブルタイトル
const TABLE_TITLE = 'STATEMENTS OF INCOME';

// 抽出対象の行ラベルとマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Revenue$/i, /^Total revenue$/i], key: 'revenue' },
  { patterns: [/^Cost of revenue$/i], key: 'costOfRevenue' },
  { patterns: [/^Research and development$/i], key: 'researchAndDevelopment' },
  { patterns: [/^Marketing and sales$/i], key: 'marketingAndSales' },
  { patterns: [/^General and administrative$/i], key: 'generalAndAdministrative' },
  { patterns: [/^Total costs and expenses$/i], key: 'totalCostsAndExpenses' },
  { patterns: [/^Income from operations$/i], key: 'operatingIncome' },
  { patterns: [/^Interest and other income.*net$/i, /^Interest expense$/i], key: 'otherIncomeNet' },
  { patterns: [/^Income before provision for income taxes$/i], key: 'incomeBeforeTax' },
  { patterns: [/^Provision for income taxes$/i], key: 'incomeTaxExpense' },
  { patterns: [/^Net income$/i], key: 'netIncome' },
];

/**
 * テキストから数値をパース
 * "(61)" → -61, "57,006" → 57006, "1.30" → 1.30, "-" → null
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—' || text === '&#151;' || text === '&#8212;') return null;

  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned.includes('\u2014') || cleaned.includes('\u2013') || cleaned.includes('\u0097')) return null;
  if (cleaned.startsWith('(') || cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  }

  cleaned = cleaned.replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * テーブル行から数値を抽出
 * 右寄せセルから値を集め、最初の有効な数値（当期Q列）を返す
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const rawText = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();

    const isRightAligned = style.includes('text-align:right') || style.includes('text-align: right');
    const isNumeric = /^[\$\d,.\-()\u2014\u2013]+$/.test(rawText) && rawText !== '$' && rawText !== '';

    if ((isRightAligned || isNumeric) && rawText) {
      if (rawText === '$' || rawText === '' || rawText === '-' || rawText === '—') return;
      if (rawText.includes('\u0097') || rawText.includes('\u2014') || rawText.includes('\u2013')) return;
      values.push(rawText);
    }
  });

  return values;
}

/**
 * 行のラベルテキストを取得
 */
function getRowLabel($, row) {
  const cells = $(row).find('td');
  let label = '';

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim()
      .replace(/\u00a0/g, ' ')
      .replace(/&#58;/g, ':')
      .replace(/&#160;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text === ' ') return;

    const style = ($cell.attr('style') || '').toLowerCase();
    const colspan = parseInt($cell.attr('colspan') || '1');
    const isLeftAligned = style.includes('text-align:left') || style.includes('text-align: left');

    if ((isLeftAligned || colspan >= 2) && !label) {
      if (!text.match(/^[\$\d,.\-()\s\u2014\u2013]+$/)) {
        label = text;
      }
    }
  });

  if (!label) {
    cells.each((i, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.\-()\s\u2014\u2013]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
  }

  return label;
}

/**
 * HTMLからテーブルタイトル位置を見つけ、そのテーブルを抽出
 */
function findTable(html, title) {
  const titleIdx = html.toUpperCase().indexOf(title.toUpperCase());
  if (titleIdx === -1) return null;

  // タイトルがテーブル内にあるか確認
  const before = html.substring(0, titleIdx);
  const lastTableOpen = before.lastIndexOf('<table');
  const lastTableClose = before.lastIndexOf('</table>');
  const titleInsideTable = lastTableOpen > lastTableClose && lastTableOpen !== -1;

  let tableStart;
  if (titleInsideTable) {
    tableStart = lastTableOpen;
  } else {
    const afterTitle = html.substring(titleIdx);
    const tableMatch = afterTitle.match(/<table[\s>]/i);
    if (!tableMatch) return null;
    tableStart = titleIdx + tableMatch.index;
  }

  // テーブル終了位置（ネスト対応）
  let depth = 0, tableEnd = -1, si = tableStart;
  while (si < html.length) {
    const om = html.substring(si).match(/<table[\s>]/i);
    const cm = html.substring(si).match(/<\/table>/i);
    if (!om && !cm) break;
    const op = om ? si + om.index : Infinity;
    const cp = cm ? si + cm.index : Infinity;
    if (op < cp) { depth++; si = op + 6; }
    else { depth--; if (depth === 0) { tableEnd = cp + 8; break; } si = cp + 8; }
  }

  if (tableEnd === -1) return null;
  return html.substring(tableStart, tableEnd);
}

/**
 * press-release.html から損益計算書テーブルを解析
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const tableHtml = findTable(html, TABLE_TITLE);
  if (!tableHtml) {
    console.warn(`  警告: ${fy}/${q} - ${TABLE_TITLE} が見つかりません`);
    return null;
  }

  const $ = cheerio.load(tableHtml);
  const result = {};
  let inEpsSection = false;
  let inSharesSection = false;

  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // 発行済株式数セクション検出（EPSより先にチェック — ラベルに"earnings per share"を含むため）
    if (label.match(/Weighted.average shares/i)) {
      inSharesSection = true;
      inEpsSection = false;
      return;
    }
    // EPSセクション検出
    if (label.match(/Earnings per share/i) || label.match(/Net income per share/i)) {
      inEpsSection = true;
      inSharesSection = false;
      return;
    }

    const values = extractValues($, row);
    if (values.length === 0) return;
    const firstValue = parseNumber(values[0]);

    // EPSセクション内
    if (inEpsSection) {
      if (label.match(/^Basic$/i) && !('epsBasic' in result)) {
        result.epsBasic = firstValue;
        return;
      }
      if (label.match(/^Diluted/i) && !('epsDiluted' in result)) {
        result.epsDiluted = firstValue;
        return;
      }
    }

    // 発行済株式数セクション内
    if (inSharesSection) {
      if (label.match(/^Basic$/i)) {
        result.sharesBasic = firstValue;
        return;
      }
      if (label.match(/^Diluted/i)) {
        result.sharesDiluted = firstValue;
        inSharesSection = false;
        return;
      }
    }

    // 通常の行マッピング
    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in result)) {
          result[mapping.key] = firstValue;
        }
        break;
      }
    }
  });

  // grossProfit を計算（Meta はGross Profit行がないため）
  if (result.revenue != null && result.costOfRevenue != null) {
    result.grossProfit = result.revenue - result.costOfRevenue;
  }

  return result;
}

// メイン処理
function main() {
  const financials = {};

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const prPath = path.join(fyPath, q, 'press-release.html');
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.html が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        if (!financials[fy]) financials[fy] = {};
        financials[fy][q] = data;

        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目抽出: ${keys.join(', ')}`);
        if (!data.revenue) console.warn(`  ⚠ Revenue が見つかりません`);
        if (!data.netIncome) console.warn(`  ⚠ Net income が見つかりません`);
        if (!data.epsDiluted) console.warn(`  ⚠ Diluted EPS が見つかりません`);
      }
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(financials, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(financials)) {
    for (const q of Object.keys(financials[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のデータを抽出`);
}

main();
