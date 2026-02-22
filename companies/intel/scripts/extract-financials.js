// Intel press-release.html から損益計算書データを抽出するスクリプト
// テーブルタイトル: "Statements of Income" / "Statements of Operations"
// 出力: financials.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'financials.json');

// テーブルタイトル候補（年代によって異なる）
const TABLE_TITLES = [
  'Statements of Operations',
  'Statements of Income',
];

// 抽出対象の行ラベルとマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Net revenue$/i, /^TOTAL NET REVENUE$/i, /^NET REVENUE$/i, /^Revenue$/i], key: 'revenue' },
  { patterns: [/^Cost of sales$/i, /^Cost of revenue$/i], key: 'costOfRevenue' },
  { patterns: [/^Gross (?:margin|profit)$/i, /^GROSS MARGIN$/i], key: 'grossProfit' },
  { patterns: [/^Research and development/i, /^R&D$/i], key: 'researchAndDevelopment' },
  { patterns: [/^Marketing,?\s*general,?\s*and\s*administrative/i, /^MG&A$/i], key: 'sga' },
  { patterns: [/^R&D AND MG&A$/i, /^R&D and MG&A$/i], key: 'totalOpex' },
  { patterns: [/^Restructuring and other charges$/i], key: 'restructuringCharges' },
  { patterns: [/^Operating (?:income|loss|expenses)$/i, /^OPERATING INCOME/i], key: 'operatingIncome' },
  { patterns: [/^Gains? \(losses?\) on equity investments/i], key: 'equityInvestmentGains' },
  { patterns: [/^Interest and other/i], key: 'interestAndOther' },
  { patterns: [/^Income (?:\(loss\) )?before (?:provision for )?income taxes$/i, /^INCOME BEFORE TAXES$/i], key: 'incomeBeforeTax' },
  { patterns: [/^(?:Provision for|Income tax)/i], key: 'incomeTaxExpense' },
  { patterns: [/^Net income \(loss\)$/i, /^NET INCOME$/i], key: 'netIncome' },
  { patterns: [/^Net income \(loss\) attributable to Intel/i], key: 'netIncomeIntel' },
];

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

function findTable(html, title) {
  const titleIdx = html.toUpperCase().indexOf(title.toUpperCase());
  if (titleIdx === -1) return null;
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

function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');

  // 複数のタイトル候補で試行
  let tableHtml = null;
  for (const title of TABLE_TITLES) {
    tableHtml = findTable(html, title);
    if (tableHtml) break;
  }
  if (!tableHtml) {
    console.warn(`  警告: ${fy}/${q} - 損益計算書テーブルが見つかりません`);
    return null;
  }

  const $ = cheerio.load(tableHtml);
  const result = {};
  let inEpsSection = false;
  let inSharesSection = false;

  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    const values = extractValues($, row);
    const firstValue = values.length > 0 ? parseNumber(values[0]) : null;

    // Intel固有のEPS行（ラベルに "per share" と "basic/diluted" を含む一行完結型）
    if (label.match(/per share/i) && label.match(/basic/i) && !('epsBasic' in result) && firstValue !== null) {
      result.epsBasic = firstValue;
      return;
    }
    if (label.match(/per share/i) && label.match(/diluted/i) && !('epsDiluted' in result) && firstValue !== null) {
      result.epsDiluted = firstValue;
      return;
    }

    // 発行済株式数セクション検出
    if (label.match(/Weighted.?average\s+(shares|common)/i) || label.match(/^Shares of common stock/i)) {
      inSharesSection = true;
      inEpsSection = false;
      return;
    }
    // EPSセクション検出（ヘッダーのみ、値がない行）
    if ((label.match(/^Earnings per share/i) || label.match(/^EARNINGS PER SHARE/i)) && values.length === 0) {
      inEpsSection = true;
      inSharesSection = false;
      return;
    }

    if (values.length === 0) return;

    // EPSセクション内（ヘッダー形式の場合）
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

    // 発行済株式数セクション
    if (inSharesSection) {
      if (label.match(/^Basic$/i) || (label.match(/basic$/i) && !label.match(/dilut/i))) {
        if (!('sharesBasic' in result)) result.sharesBasic = firstValue;
        return;
      }
      if (label.match(/^Diluted/i) || label.match(/diluted$/i)) {
        if (!('sharesDiluted' in result)) result.sharesDiluted = firstValue;
        inSharesSection = false;
        return;
      }
    }

    // Intel固有のEPS行（EPSセクションヘッダーなしで直接出現するパターン）
    if (label.match(/Earnings.*per share.*Intel.*basic/i) && !('epsBasic' in result)) {
      result.epsBasic = firstValue;
      return;
    }
    if (label.match(/Earnings.*per share.*Intel.*diluted/i) && !('epsDiluted' in result)) {
      result.epsDiluted = firstValue;
      return;
    }
    // 古い形式: "Earnings per share of common stock" なしで直接 Basic/Diluted
    if (label.match(/Earnings.*per share.*basic/i) && !label.match(/Intel/i) && !('epsBasic' in result)) {
      result.epsBasic = firstValue;
      return;
    }
    if (label.match(/Earnings.*per share.*diluted/i) && !label.match(/Intel/i) && !('epsDiluted' in result)) {
      result.epsDiluted = firstValue;
      return;
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

  // netIncome がない場合、netIncomeIntel を使う（2024年以降のフォーマット）
  if (!('netIncome' in result) && 'netIncomeIntel' in result) {
    result.netIncome = result.netIncomeIntel;
  }
  // netIncome が取得できていて netIncomeIntel もある場合、Intel帰属分を優先
  if ('netIncomeIntel' in result && result.netIncomeIntel !== null) {
    result.netIncome = result.netIncomeIntel;
  }

  // grossProfit がない場合は計算
  if (!('grossProfit' in result) && result.revenue != null && result.costOfRevenue != null) {
    result.grossProfit = result.revenue - result.costOfRevenue;
  }

  // Intelはoperating incomeの前にOPERATING EXPENSESとして合計がくることがある
  // operatingIncomeが実際はopexの場合を修正
  if (result.operatingIncome != null && result.revenue != null && result.grossProfit != null) {
    // operating incomeがrevenue より大きい場合は誤判定
    if (Math.abs(result.operatingIncome) > result.revenue) {
      delete result.operatingIncome;
    }
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
      if (!fs.existsSync(prPath)) continue;

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        if (!financials[fy]) financials[fy] = {};
        financials[fy][q] = data;
        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目抽出: ${keys.join(', ')}`);
        if (!data.revenue) console.warn(`  ⚠ Revenue が見つかりません`);
        if (!data.netIncome && data.netIncome !== 0) console.warn(`  ⚠ Net income が見つかりません`);
        if (!data.epsDiluted && data.epsDiluted !== 0) console.warn(`  ⚠ Diluted EPS が見つかりません`);
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
