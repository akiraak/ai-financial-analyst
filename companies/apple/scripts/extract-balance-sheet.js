// Apple press-release.htm から貸借対照表データを抽出するスクリプト
// "CONDENSED CONSOLIDATED BALANCE SHEETS" テーブルを解析
// 出力: balance-sheet.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'balance-sheet.json');

// 抽出対象の行ラベルとマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Cash and cash equivalents$/i], key: 'cashAndEquivalents' },
  { patterns: [/^Marketable securities$/i], key: 'marketableSecurities', firstOnly: true },
  { patterns: [/^Total current assets$/i], key: 'totalCurrentAssets' },
  { patterns: [/^Total assets$/i], key: 'totalAssets' },
  { patterns: [/^Total current liabilities$/i], key: 'totalCurrentLiabilities' },
  { patterns: [/^Term debt$/i], key: 'termDebt', firstOnly: true },
  { patterns: [/^Total liabilities$/i], key: 'totalLiabilities' },
  { patterns: [/^Total shareholders.?\s*equity$/i, /^Total stockholders.?\s*equity$/i], key: 'stockholdersEquity' },
  { patterns: [/^Accounts receivable/i], key: 'accountsReceivable' },
  { patterns: [/^Inventories$/i], key: 'inventories' },
  { patterns: [/^Accounts payable$/i], key: 'accountsPayable' },
  { patterns: [/^Commercial paper$/i], key: 'commercialPaper' },
  { patterns: [/^Deferred revenue$/i], key: 'deferredRevenue' },
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
    const text = $cell.text().trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\u2019/g, "'")
      .replace(/&#58;/g, ':')
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
  const tableHtml = findTable(html, 'CONDENSED CONSOLIDATED BALANCE SHEETS');
  if (!tableHtml) {
    console.warn(`  警告: ${fy}/${q} - BALANCE SHEETSテーブルが見つかりません`);
    return null;
  }

  const $ = cheerio.load(tableHtml);
  const result = {};
  // 流動 vs 非流動 Marketable securitiesを合算するための変数
  let msCount = 0;
  let termDebtCount = 0;

  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;
    const values = extractValues($, row);
    if (values.length === 0) return;
    const firstValue = parseNumber(values[0]);

    // Marketable securitiesは流動+非流動の2回出現 → 合算
    if (/^Marketable securities$/i.test(label)) {
      if (msCount === 0) {
        result.currentMarketableSecurities = firstValue;
      } else if (msCount === 1) {
        result.nonCurrentMarketableSecurities = firstValue;
      }
      msCount++;
      // 合計を計算
      result.marketableSecurities = (result.currentMarketableSecurities || 0) + (result.nonCurrentMarketableSecurities || 0);
      return;
    }

    // Term debtも流動+非流動の2回出現 → 合算
    if (/^Term debt$/i.test(label)) {
      if (termDebtCount === 0) {
        result.currentTermDebt = firstValue;
      } else if (termDebtCount === 1) {
        result.longTermDebt = firstValue;
      }
      termDebtCount++;
      // 合計
      result.totalDebt = (result.currentTermDebt || 0) + (result.longTermDebt || 0) + (result.commercialPaper || 0);
      return;
    }

    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in result)) {
          result[mapping.key] = firstValue;
        }
        break;
      }
    }
  });

  // totalDebt再計算（commercialPaperが後から来た場合）
  if (result.currentTermDebt != null || result.longTermDebt != null) {
    result.totalDebt = (result.currentTermDebt || 0) + (result.longTermDebt || 0) + (result.commercialPaper || 0);
  }

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
      const prPath = path.join(fyPath, q, 'press-release.htm');
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

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(balanceSheet, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(balanceSheet)) {
    for (const q of Object.keys(balanceSheet[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のB/Sデータを抽出`);
}

main();
