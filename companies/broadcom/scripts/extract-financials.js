// Broadcom press-release.html から損益計算書データを抽出するスクリプト
// テーブルタイトル: "CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS"
// 出力: financials.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'financials.json');

// テーブルタイトル
const TABLE_TITLE = 'STATEMENTS OF OPERATIONS';

// 抽出対象の行ラベルとマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Net revenue$/i, /^Total net revenue$/i], key: 'revenue' },
  { patterns: [/^Cost of revenue$/i], key: 'costOfRevenue' },
  { patterns: [/^Total cost of revenue$/i], key: 'totalCostOfRevenue' },
  { patterns: [/^Gross margin$/i, /^Gross profit$/i], key: 'grossProfit' },
  { patterns: [/^Research and development$/i], key: 'researchAndDevelopment' },
  { patterns: [/^Selling, general and administrative$/i, /^Sales, general and administrative$/i], key: 'sga' },
  { patterns: [/^Total operating expenses$/i], key: 'totalOperatingExpenses' },
  { patterns: [/^Operating income$/i, /^Income from operations$/i], key: 'operatingIncome' },
  { patterns: [/^Interest expense$/i], key: 'interestExpense' },
  { patterns: [/^Other income.*net$/i, /^Other income \(expense\),?\s*net$/i], key: 'otherIncomeNet' },
  { patterns: [/^Income (?:from continuing operations )?before income taxes$/i], key: 'incomeBeforeTax' },
  { patterns: [/^Provision for .*income taxes$/i, /^Benefit from income taxes$/i, /^Income tax expense$/i], key: 'incomeTaxExpense' },
  { patterns: [/^Income (?:\(loss\) )?from continuing operations$/i], key: 'incomeFromContinuingOps' },
  { patterns: [/^Net income(?: \(loss\))?$/i], key: 'netIncome' },
];

/**
 * テキストから数値をパース
 * "(61)" → -61, "57,006" → 57006, "1.30" → 1.30, "-" → null
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—' || text === '&#151;' || text === '&#8212;') return null;

  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
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
 * テーブル行から数値を抽出（Broadcom EDGAR形式）
 * 右寄せまたは数値セルから値を集める
 * 最初の有効な数値（当期Q列）を返す
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const rawText = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();

    // 右寄せセルまたは数値パターンに合致するセル
    const isRightAligned = style.includes('text-align:right') || style.includes('text-align: right');
    const isNumeric = /^[\$\d,.\-()\u2014\u2013]+$/.test(rawText) && rawText !== '$' && rawText !== '';

    if ((isRightAligned || isNumeric) && rawText) {
      // $記号のみ、空、ダッシュ類のみはスキップ
      if (rawText === '$' || rawText === '' || rawText === '-' || rawText === '—') return;
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
    const isLeftAligned = style.includes('text-align:left') || style.includes('text-align: left');
    const colspan = parseInt($cell.attr('colspan') || '1');

    // ラベルセル: 左寄せ、またはcolspan>=2、または先頭のテキストセル
    if ((isLeftAligned || colspan >= 2) && !label) {
      // 数値のみのセルはスキップ
      if (!text.match(/^[\$\d,.\-()\s\u2014\u2013]+$/)) {
        label = text;
      }
    }
  });

  // フォールバック: 最初の非数値テキストセルをラベルとする
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
 * press-release.html から損益計算書テーブルを解析
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');

  // STATEMENTS OF OPERATIONS のテーブルを見つける
  const titleIdx = html.toUpperCase().indexOf(TABLE_TITLE.toUpperCase());
  if (titleIdx === -1) {
    console.warn(`  警告: ${fy}/${q} - ${TABLE_TITLE} が見つかりません`);
    return null;
  }

  // タイトル位置以降で最初の<table>を見つける
  const afterTitle = html.substring(titleIdx);
  const tableMatch = afterTitle.match(/<table[\s>]/i);
  if (!tableMatch) {
    console.warn(`  警告: ${fy}/${q} - テーブルが見つかりません`);
    return null;
  }

  const tableStart = titleIdx + tableMatch.index;

  // テーブルの終了位置を見つける（ネストに対応）
  let depth = 0;
  let tableEnd = -1;
  let searchIdx = tableStart;
  while (searchIdx < html.length) {
    const openMatch = html.substring(searchIdx).match(/<table[\s>]/i);
    const closeMatch = html.substring(searchIdx).match(/<\/table>/i);

    if (!openMatch && !closeMatch) break;

    const openPos = openMatch ? searchIdx + openMatch.index : Infinity;
    const closePos = closeMatch ? searchIdx + closeMatch.index : Infinity;

    if (openPos < closePos) {
      depth++;
      searchIdx = openPos + 6;
    } else {
      depth--;
      if (depth === 0) {
        tableEnd = closePos + 8;
        break;
      }
      searchIdx = closePos + 8;
    }
  }

  if (tableEnd === -1) {
    console.warn(`  警告: ${fy}/${q} - テーブル終了タグが見つかりません`);
    return null;
  }

  const tableHtml = html.substring(tableStart, tableEnd);
  const $ = cheerio.load(tableHtml);

  const result = {};
  let inEpsBasicSection = false;
  let inEpsDilutedSection = false;
  let inSharesSection = false;

  const rows = $('tr');
  rows.each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // セクション検出
    // パターン1: "Basic income (loss) per share:" セクション
    if (label.match(/Basic (?:income|net income).*per share/i)) {
      inEpsBasicSection = true;
      inEpsDilutedSection = false;
      inSharesSection = false;
      return;
    }
    // パターン2: "Diluted income (loss) per share:" セクション
    if (label.match(/Diluted (?:income|net income).*per share/i)) {
      inEpsDilutedSection = true;
      inEpsBasicSection = false;
      inSharesSection = false;
      return;
    }
    // パターン3: "Net income per share attributable to common stock:" フラット形式（FY2022-2023）
    if (label.match(/Net income per share attributable/i)) {
      inEpsDilutedSection = true; // フラット形式: Basic/Dilutedが直接続く
      inEpsBasicSection = false;
      inSharesSection = false;
      return;
    }
    if (label.match(/Weighted.average shares/i)) {
      inSharesSection = true;
      inEpsBasicSection = false;
      inEpsDilutedSection = false;
      return;
    }

    const values = extractValues($, row);
    if (values.length === 0) return;

    // 最初の値（当四半期）を取得
    const firstValue = parseNumber(values[0]);

    // Basic EPS セクション
    if (inEpsBasicSection) {
      if (label.match(/Net income(?: \(loss\))? per share/i)) {
        result.epsBasic = firstValue;
        return;
      }
      if (label.match(/Income(?: \(loss\))? per share from continuing operations/i) && !('epsBasicContinuing' in result)) {
        result.epsBasicContinuing = firstValue;
        return;
      }
    }

    // Diluted EPS セクション（フラット形式も含む）
    if (inEpsDilutedSection) {
      // フラット形式: "Basic" → epsBasic, "Diluted (1)" → epsDiluted
      if (label.match(/^Basic$/i) && !('epsBasic' in result)) {
        result.epsBasic = firstValue;
        return;
      }
      if (label.match(/^Diluted/i) && !('epsDiluted' in result)) {
        result.epsDiluted = firstValue;
        return;
      }
      if (label.match(/Net income(?: \(loss\))? per share/i)) {
        result.epsDiluted = firstValue;
        return;
      }
      if (label.match(/Income(?: \(loss\))? per share from continuing operations/i) && !('epsDilutedContinuing' in result)) {
        result.epsDilutedContinuing = firstValue;
        return;
      }
    }

    // 発行株式数セクション
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

  return result;
}

// メイン処理
function main() {
  const financials = {};

  // FY*/Q* ディレクトリを走査
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

        // 抽出結果のサマリー表示
        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目抽出: ${keys.join(', ')}`);
        if (!data.revenue) console.warn(`  ⚠ Revenue が見つかりません`);
        if (!data.netIncome) console.warn(`  ⚠ Net income が見つかりません`);
        if (!data.epsDiluted) console.warn(`  ⚠ Diluted EPS が見つかりません`);
      }
    }
  }

  // JSON出力
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(financials, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(financials)) {
    for (const q of Object.keys(financials[fy])) {
      total++;
    }
  }
  console.log(`合計: ${total} 四半期分のデータを抽出`);
}

main();
