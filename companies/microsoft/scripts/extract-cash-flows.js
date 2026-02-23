// press-release.html からキャッシュフローデータを抽出するスクリプト
// 出力: cash-flows.json
// "CASH FLOWS STATEMENTS" テーブルを解析
// MicrosoftはFCFを非GAAP項目として報告しないため、
// FCF = operatingCF - |capitalExpenditure| で算出する

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'cash-flows.json');

const CF_ROW_MAPPINGS = [
  { patterns: [/^Net cash from operations$/i, /^Net cash provided by operating activities$/i], key: 'operatingCF' },
  { patterns: [/^Net cash used in investing$/i, /^Net cash (?:used in|provided by).*investing/i], key: 'investingCF' },
  { patterns: [/^Net cash used in financing$/i, /^Net cash (?:used in|provided by).*financing/i], key: 'financingCF' },
  { patterns: [/^Additions to property and equipment$/i, /^Capital expenditure/i, /^Purchases of property and equipment/i], key: 'capitalExpenditure' },
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
    if (tdStyle.includes('text-align:left') || tdAlign === 'left' ||
        pStyle.includes('text-align:left') || pAlign === 'left' ||
        tdValign === 'top' || pStyle.includes('margin-left')) {
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
  const found = findTableByHeading(html, 'CASH FLOWS STATEMENTS');
  if (!found) {
    console.warn(`  警告: ${fy}/${q} - CASH FLOWS STATEMENTSテーブルが見つかりません`);
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
    for (const mapping of CF_ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in result)) {
          result[mapping.key] = firstValue;
        }
        break;
      }
    }
  });

  // FCF = operatingCF - |capitalExpenditure|
  if (result.operatingCF != null && result.capitalExpenditure != null) {
    result.freeCashFlow = result.operatingCF - Math.abs(result.capitalExpenditure);
  }

  return Object.keys(result).length > 0 ? result : null;
}

function main() {
  const cashFlows = {};
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
        if (!cashFlows[fy]) cashFlows[fy] = {};
        cashFlows[fy][q] = data;
        console.log(`  → opCF=${data.operatingCF}, invCF=${data.investingCF}, finCF=${data.financingCF}, FCF=${data.freeCashFlow}`);
      }
    }
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cashFlows, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  let total = 0;
  for (const fy of Object.keys(cashFlows)) for (const q of Object.keys(cashFlows[fy])) total++;
  console.log(`合計: ${total} 四半期分のCFデータを抽出`);
}

main();
