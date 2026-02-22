// Meta press-release.html からキャッシュフローデータを抽出するスクリプト
// "CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS" テーブルを解析
// また、Non-GAAP reconciliation から Free Cash Flow を抽出する
// 出力: cash-flows.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'cash-flows.json');

// CF本体の抽出対象
const CF_ROW_MAPPINGS = [
  { patterns: [/^Net cash provided by operating activities$/i], key: 'operatingCashFlow' },
  { patterns: [
    /^Net cash used in investing activities$/i,
    /^Net cash provided by \(used in\) investing activities$/i,
    /^Net cash provided by investing activities$/i,
  ], key: 'investingCashFlow' },
  { patterns: [
    /^Net cash used in financing activities$/i,
    /^Net cash provided by \(used in\) financing activities$/i,
    /^Net cash provided by financing activities$/i,
  ], key: 'financingCashFlow' },
  { patterns: [/^Purchases of property and equipment$/i], key: 'capitalExpenditures' },
  { patterns: [/^Principal payments on finance leases$/i], key: 'financeLeasePayments' },
];

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

function getRowLabel($, row) {
  const cells = $(row).find('td');
  let label = '';
  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
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

/**
 * Non-GAAP reconciliation から Free Cash Flow を抽出
 */
function extractFCF(html) {
  const $ = cheerio.load(html);
  let fcf = null;

  $('table').each((ti, table) => {
    if (fcf !== null) return false;
    $(table).find('tr').each((ri, row) => {
      if (fcf !== null) return false;
      const label = getRowLabel($, row);
      if (!label) return;
      if (/^Free cash flow$/i.test(label)) {
        const values = extractValues($, row);
        if (values.length > 0) {
          const val = parseNumber(values[0]);
          if (val !== null) {
            fcf = val;
            return false;
          }
        }
      }
    });
  });

  return fcf;
}

function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const result = {};

  // CF計算書テーブルを解析
  const tableHtml = findTable(html, 'CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS');
  if (tableHtml) {
    const $ = cheerio.load(tableHtml);
    $('tr').each((i, row) => {
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
  }

  // Non-GAAP reconciliation から FCF を抽出
  const fcf = extractFCF(html);
  if (fcf !== null) {
    result.freeCashFlow = fcf;
  } else if (result.operatingCashFlow != null && result.capitalExpenditures != null) {
    // FCFが見つからない場合は計算（OCF - CapEx - Finance Lease Payments）
    let fcfCalc = result.operatingCashFlow - Math.abs(result.capitalExpenditures);
    if (result.financeLeasePayments != null) {
      fcfCalc -= Math.abs(result.financeLeasePayments);
    }
    result.freeCashFlow = fcfCalc;
  }

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const cashFlows = {};

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
        if (!cashFlows[fy]) cashFlows[fy] = {};
        cashFlows[fy][q] = data;
        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cashFlows, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(cashFlows)) {
    for (const q of Object.keys(cashFlows[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のCFデータを抽出`);
}

main();
