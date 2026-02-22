// Intel press-release.html から貸借対照表データを抽出するスクリプト
// バランスシートテーブルを解析し、主要項目を取得する
//
// Intelの貸借対照表は期間により以下のフォーマット:
// ■ FY2020-FY2021: テーブルヘッダーなし。"CURRENT ASSETS" で始まる。
//   "TOTAL ASSETS", "TOTAL CURRENT LIABILITIES", "Debt"（長期）, "TOTAL STOCKHOLDERS' EQUITY"
// ■ FY2022+: "Assets" / "Current assets:" ヘッダー。
//   "Total assets", "Total current liabilities", "Debt"（長期）, "Total stockholders' equity"
//
// 出力: balance-sheet.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'balance-sheet.json');

// 抽出対象の行ラベルとマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Cash and cash equivalents$/i], key: 'cashAndEquivalents' },
  { patterns: [/^Short-term investments$/i], key: 'shortTermInvestments' },
  { patterns: [/^Total current assets$/i, /^TOTAL CURRENT ASSETS$/i], key: 'totalCurrentAssets' },
  { patterns: [/^Property, plant,? and equipment,? net$/i], key: 'propertyPlantEquipment' },
  { patterns: [/^Total assets$/i, /^TOTAL ASSETS$/i], key: 'totalAssets' },
  { patterns: [/^Total current liabilities$/i, /^TOTAL CURRENT LIABILITIES$/i], key: 'totalCurrentLiabilities' },
  // Intel の長期借入金は "Debt"（旧フォーマット）または "Long-term debt"
  { patterns: [/^Debt$/i, /^Long-term debt$/i], key: 'longTermDebt' },
  { patterns: [/^Total liabilities$/i], key: 'totalLiabilities' },
  { patterns: [
    /^Total stockholders.?\s*equity$/i,
    /^TOTAL STOCKHOLDERS.?\s*EQUITY$/i,
    /^Total Intel stockholders.?\s*equity$/i,
  ], key: 'stockholdersEquity' },
];

/**
 * テキストから数値をパース
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;
  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned.includes('\u2014') || cleaned.includes('\u2013')) return null;
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
      if (rawText.includes('\u2014') || rawText.includes('\u2013')) return;
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
      .replace(/\u2019/g, "'")
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
      if (text && !text.match(/^[\$\d,.\-()\s\u2014\u2013%]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
  }
  return label;
}

/**
 * HTMLから全テーブルを走査し、バランスシートテーブルを見つける
 * "Cash and cash equivalents" と "Total assets" の両方を含むテーブルを探す
 */
function findBalanceSheetTable(html) {
  const $ = cheerio.load(html);
  let found = null;

  $('table').each((i, table) => {
    if (found) return false;
    const text = $(table).text().replace(/\s+/g, ' ').toLowerCase();
    // バランスシートの必須キーワード
    if (text.includes('cash and cash equivalents') &&
        text.includes('total assets')) {
      found = $.html(table);
    }
  });

  return found;
}

/**
 * press-release.html からバランスシートデータを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const tableHtml = findBalanceSheetTable(html);
  if (!tableHtml) {
    console.warn(`  警告: ${fy}/${q} - バランスシートテーブルが見つかりません`);
    return null;
  }

  const $ = cheerio.load(tableHtml);
  const result = {};

  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;
    const values = extractValues($, row);
    if (values.length === 0) return;
    const firstValue = parseNumber(values[0]);

    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in result)) {
          result[mapping.key] = firstValue;
        }
        break;
      }
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const balanceSheet = {};

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
        if (!balanceSheet[fy]) balanceSheet[fy] = {};
        balanceSheet[fy][q] = data;
        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
      }
    }
  }

  // データディレクトリが存在しない場合は作成
  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(balanceSheet, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(balanceSheet)) {
    for (const q of Object.keys(balanceSheet[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のB/Sデータを抽出`);
}

main();
