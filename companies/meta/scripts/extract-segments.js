// Meta press-release.html からセグメント別データを抽出するスクリプト
// "Segment Information" テーブルを解析し、
// Family of Apps / Reality Labs の売上・営業利益を取得する
// 注意: セグメント報告はFY2021 Q4以降（Meta改名後）
// 出力: segments.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segments.json');

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
 * 行のラベルテキストを取得
 */
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
      if (!text.match(/^[\$\d,.\-()\s\u2014\u2013%+]+$/)) {
        label = text;
      }
    }
  });
  if (!label) {
    cells.each((i, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.\-()\s\u2014\u2013%+]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
  }
  return label;
}

/**
 * テーブル行から最初の数値を抽出
 */
function extractFirstValue($, row) {
  const cells = $(row).find('td');
  const values = [];
  cells.each((i, cell) => {
    const $cell = $(cell);
    const rawText = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();
    const isRightAligned = style.includes('text-align:right') || style.includes('text-align: right');
    if (isRightAligned && rawText) {
      if (rawText === '$' || rawText === '' || rawText === '-' || rawText === '—') return;
      if (rawText.includes('\u2014') || rawText.includes('\u2013')) return;
      values.push(rawText);
    }
  });
  for (const v of values) {
    const num = parseNumber(v);
    if (num !== null) return num;
  }
  return null;
}

/**
 * HTMLからテーブルタイトル位置を見つけ、そのテーブルを抽出
 */
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
 * press-release.html からセグメントデータを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const tableHtml = findTable(html, 'Segment Information');
  if (!tableHtml) return null;

  const $ = cheerio.load(tableHtml);
  const result = {};

  // セクション検出: Revenue / Income (loss) from operations
  let section = null;

  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // セクションヘッダー検出
    if (label.match(/^Revenue/i)) {
      section = 'revenue';
      return;
    }
    if (label.match(/Income.*from operations/i)) {
      section = 'operatingIncome';
      return;
    }

    const value = extractFirstValue($, row);

    if (section === 'revenue') {
      if (label.match(/^Advertising$/i)) {
        result.advertisingRevenue = value;
      } else if (label.match(/^Other revenue$/i)) {
        result.otherRevenue = value;
      } else if (label.match(/^Family of Apps$/i)) {
        result.familyOfAppsRevenue = value;
      } else if (label.match(/^Reality Labs$/i)) {
        result.realityLabsRevenue = value;
      } else if (label.match(/^Total revenue$/i)) {
        result.totalRevenue = value;
      }
    } else if (section === 'operatingIncome') {
      if (label.match(/^Family of Apps$/i)) {
        result.familyOfAppsOperatingIncome = value;
      } else if (label.match(/^Reality Labs$/i)) {
        result.realityLabsOperatingIncome = value;
      } else if (label.match(/^Total income from operations$/i)) {
        result.totalOperatingIncome = value;
      }
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const segments = {};

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
        if (!segments[fy]) segments[fy] = {};
        segments[fy][q] = data;
        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
      } else {
        console.log(`  → セグメントデータなし（FY2021 Q3以前は正常）`);
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(segments, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(segments)) {
    for (const q of Object.keys(segments[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のセグメントデータを抽出`);
}

main();
