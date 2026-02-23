// press-release.html から貸借対照表データを抽出するスクリプト
// 出力: balance-sheet.json
// "BALANCE SHEETS" テーブルを解析し、当四半期末（1列目）のデータを取得

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'balance-sheet.json');

const ROW_MAPPINGS = [
  { patterns: [/^Cash and cash equivalents$/i], key: 'cashAndEquivalents' },
  { patterns: [/^Total current assets$/i], key: 'totalCurrentAssets' },
  { patterns: [/^Total assets$/i], key: 'totalAssets' },
  { patterns: [/^Current portion of long-term debt$/i, /^Short-term debt$/i], key: 'shortTermDebt' },
  { patterns: [/^Total current liabilities$/i], key: 'totalCurrentLiabilities' },
  { patterns: [/^Long-term debt$/i], key: 'longTermDebt' },
  { patterns: [/^Total liabilities$/i], key: 'totalLiabilities' },
  { patterns: [/^Total stockholders.?\s*equity$/i, /^Total shareholders.?\s*equity$/i], key: 'totalEquity' },
];

function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;
  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned.startsWith('(')) { negative = true; cleaned = cleaned.replace(/[()]/g, ''); }
  cleaned = cleaned.replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

function getRowLabel($, row) {
  const cells = $(row).find('td');
  let label = '';
  cells.each((i, cell) => {
    if (label) return;
    const $cell = $(cell);
    const tdStyle = ($cell.attr('style') || '').toLowerCase();
    const tdAlign = ($cell.attr('align') || '').toLowerCase();
    const tdValign = ($cell.attr('valign') || '').toLowerCase();
    const $p = $cell.find('p').first();
    const pStyle = ($p.attr('style') || '').toLowerCase();
    const pAlign = ($p.attr('align') || '').toLowerCase();
    const isTdLeft = tdStyle.includes('text-align:left') || tdAlign === 'left';
    const isPLeft = pStyle.includes('text-align:left') || pAlign === 'left';
    const isVTop = tdValign === 'top';
    const hasMarginLeft = pStyle.includes('margin-left');
    if (isTdLeft || isPLeft || isVTop || hasMarginLeft) {
      const text = $cell.text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.\-()\s]+$/) && text.length > 1) {
        label = text;
      }
    }
  });
  if (!label) {
    cells.each((i, cell) => {
      if (label) return;
      const $cell = $(cell);
      const text = $cell.text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const $p = $cell.find('p').first();
      const pAlign = ($p.attr('align') || '').toLowerCase();
      const pStyle = ($p.attr('style') || '').toLowerCase();
      const isRight = pAlign === 'right' || pStyle.includes('text-align:right');
      if (!isRight && text && !text.match(/^[\$\d,.\-()\s]+$/) && text.length > 1) {
        label = text;
      }
    });
  }
  return label;
}

function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];
  cells.each((i, cell) => {
    const $cell = $(cell);
    const tdStyle = ($cell.attr('style') || '').toLowerCase();
    const tdAlign = ($cell.attr('align') || '').toLowerCase();
    const $p = $cell.find('p').first();
    const pStyle = ($p.attr('style') || '').toLowerCase();
    const pAlign = ($p.attr('align') || '').toLowerCase();
    const isValueCell =
      (tdStyle.includes('text-align:center') && pStyle.includes('text-align:right')) ||
      tdStyle.includes('text-align:right') || tdAlign === 'right' || pAlign === 'right';
    if (isValueCell) {
      const text = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
      if (text && text !== '$' && text !== '' && text !== '&#160;') {
        const fontSize = pStyle.match(/font-size:\s*([\d.]+)pt/);
        if (fontSize && parseFloat(fontSize[1]) <= 1) return;
        const cleaned = text.replace(/[$,\s()]/g, '');
        if (cleaned && (cleaned.match(/^\d/) || cleaned === '-' || cleaned === '—')) {
          values.push(text);
        }
      }
    }
  });
  return values;
}

function findTableByHeading(html, headingText) {
  const headingIdx = html.indexOf(headingText);
  if (headingIdx === -1) return null;
  const afterHeading = html.substring(headingIdx);
  const tableMatch = afterHeading.match(/<table[\s>]/i);
  if (!tableMatch) return null;
  const tableStart = headingIdx + tableMatch.index;
  let depth = 0;
  const tableRegex = /<(\/?)table[\s>]/gi;
  tableRegex.lastIndex = tableStart;
  let m, tableEnd = -1;
  while ((m = tableRegex.exec(html)) !== null) {
    if (m[1] === '/') { depth--; if (depth === 0) { tableEnd = m.index + '</table>'.length; break; } }
    else { depth++; }
  }
  if (tableEnd === -1) return null;
  const tableHtml = html.substring(tableStart, tableEnd);
  const $table = cheerio.load(tableHtml);
  return { $: $table, table: $table('table').first() };
}

function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const found = findTableByHeading(html, 'BALANCE SHEETS');
  if (!found) {
    console.warn(`  警告: ${fy}/${q} - BALANCE SHEETSテーブルが見つかりません`);
    return null;
  }
  const { $, table } = found;
  const result = {};
  table.find('tr').each((i, row) => {
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

function main() {
  const balanceSheet = {};
  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory()).sort();
  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory()).sort();
    for (const q of qDirs) {
      const prPath = path.join(fyPath, q, 'press-release.html');
      if (!fs.existsSync(prPath)) continue;
      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        if (!balanceSheet[fy]) balanceSheet[fy] = {};
        balanceSheet[fy][q] = data;
        console.log(`  → ${Object.keys(data).length} 項目: totalAssets=${data.totalAssets}, totalEquity=${data.totalEquity}`);
        if (!data.totalAssets) console.warn(`  ⚠ Total assets が見つかりません`);
      }
    }
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(balanceSheet, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  let total = 0;
  for (const fy of Object.keys(balanceSheet)) for (const q of Object.keys(balanceSheet[fy])) total++;
  console.log(`合計: ${total} 四半期分のB/Sデータを抽出`);
}

main();
