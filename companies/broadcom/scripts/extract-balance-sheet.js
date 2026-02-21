// Broadcom press-release.html から貸借対照表データを抽出するスクリプト
// 出力: balance-sheet.json
//
// "CONDENSED CONSOLIDATED BALANCE SHEETS" テーブルを解析し、
// 当四半期末（1列目）のデータのみ取得する
// 対応形式:
//   1. 新形式: style="text-align:right" で数値セル判定（FY2020 Q2以降）
//   2. 旧形式: ALIGN="right" で数値セル判定（FY2020 Q1）

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'balance-sheet.json');

// 抽出対象の行ラベルとマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Cash and cash equivalents$/i, /^Cash,?\s*cash equivalents/i], key: 'cashAndEquivalents' },
  { patterns: [/^Total current assets$/i], key: 'totalCurrentAssets' },
  { patterns: [/^Total assets$/i], key: 'totalAssets' },
  { patterns: [/^Short-term debt$/i, /^Current portion of long-term debt$/i], key: 'shortTermDebt' },
  { patterns: [/^Total current liabilities$/i], key: 'totalCurrentLiabilities' },
  { patterns: [/^Long-term debt$/i], key: 'longTermDebt' },
  { patterns: [/^Total liabilities$/i], key: 'totalLiabilities' },
  { patterns: [/^Total stockholders.?\s*equity$/i, /^Total shareholders.?\s*equity$/i], key: 'stockholdersEquity' },
];

/**
 * テキストから数値をパース
 * "(61)" → -61, "81,006" → 81006, "-" → null
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—' || text === '&#151;' || text === '&#8212;') return null;

  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  // HTML実体参照のダッシュ記号
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
 * 右寄せセル（style または ALIGN属性）から値を集め、最初の有効な数値を返す
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const rawText = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();
    const align = ($cell.attr('align') || '').toLowerCase();

    // 右寄せセル判定（新形式: style, 旧形式: ALIGN属性）
    const isRightAligned = style.includes('text-align:right') || style.includes('text-align: right') || align === 'right';
    // 数値パターン判定（旧形式のフォールバック用）
    const isNumeric = /^[\$\d,.\-()\u2014\u2013]+$/.test(rawText) && rawText !== '$' && rawText !== '';

    if ((isRightAligned || isNumeric) && rawText) {
      // $記号のみ、空、ダッシュ類はスキップ
      if (rawText === '$' || rawText === '' || rawText === '-' || rawText === '—') return;
      // &#151; (em dash) もスキップ
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
      .replace(/&#146;/g, "'")
      .replace(/\u2019/g, "'")
      .replace(/\u2018/g, "'")
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

  // フォールバック: 最初の非数値テキストセルをラベルとする
  if (!label) {
    cells.each((i, cell) => {
      const text = $(cell).text().trim()
        .replace(/\u00a0/g, ' ')
        .replace(/&#146;/g, "'")
        .replace(/\u2019/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (text && !text.match(/^[\$\d,.\-()\s\u2014\u2013%]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
  }

  return label;
}

/**
 * CONDENSED CONSOLIDATED BALANCE SHEETS テーブルを検索して解析
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');

  // テーブルタイトルを検索
  const titlePattern = /CONDENSED\s+CONSOLIDATED\s+BALANCE\s+SHEETS/i;
  const titleMatch = html.match(titlePattern);
  if (!titleMatch) {
    console.warn(`  警告: ${fy}/${q} - BALANCE SHEETSテーブルが見つかりません`);
    return null;
  }

  const titleIdx = titleMatch.index;

  // タイトル位置以降で最初の<table>を見つける
  // ただし旧形式ではタイトルがテーブル外にあるため、タイトル直後のテーブルを取得
  // 新形式ではタイトルがテーブル内にあるため、タイトルを含むテーブルを取得
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
  let si = tableStart;
  while (si < html.length) {
    const openMatch = html.substring(si).match(/<table[\s>]/i);
    const closeMatch = html.substring(si).match(/<\/table>/i);

    if (!openMatch && !closeMatch) break;

    const openPos = openMatch ? si + openMatch.index : Infinity;
    const closePos = closeMatch ? si + closeMatch.index : Infinity;

    if (openPos < closePos) {
      depth++;
      si = openPos + 6;
    } else {
      depth--;
      if (depth === 0) {
        tableEnd = closePos + 8;
        break;
      }
      si = closePos + 8;
    }
  }

  if (tableEnd === -1) {
    console.warn(`  警告: ${fy}/${q} - テーブル終了タグが見つかりません`);
    return null;
  }

  const tableHtml = html.substring(tableStart, tableEnd);
  const $ = cheerio.load(tableHtml);

  const result = {};

  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    const values = extractValues($, row);
    if (values.length === 0) return;

    // 1列目（当四半期末）のみ取得
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
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.html が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        if (!balanceSheet[fy]) balanceSheet[fy] = {};
        balanceSheet[fy][q] = data;

        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目抽出: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
        if (!data.totalAssets) console.warn(`  警告: Total assets が見つかりません`);
        if (!data.stockholdersEquity) console.warn(`  警告: Stockholders equity が見つかりません`);
      } else {
        console.warn(`  警告: ${fy}/${q} - B/Sデータが見つかりません`);
      }
    }
  }

  // JSON出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(balanceSheet, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(balanceSheet)) {
    for (const q of Object.keys(balanceSheet[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のB/Sデータを抽出`);
}

main();
