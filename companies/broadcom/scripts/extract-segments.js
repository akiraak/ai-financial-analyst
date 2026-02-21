// Broadcom press-release.html からセグメント別売上データを抽出するスクリプト
// 出力: segments.json
//
// "Net revenue by segment" テーブルを解析し、
// Semiconductor solutions / Infrastructure software の売上を取得する
// 対応形式:
//   1. 新形式: style="text-align:right" で数値セル判定（FY2020 Q2以降）
//   2. 旧形式: ALIGN="right" で数値セル判定（FY2020 Q1）

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segments.json');

// セグメント名の正規化マッピング
const SEGMENT_DEFS = [
  { key: 'semiconductorSolutions', patterns: [/^Semiconductor solutions$/i] },
  { key: 'infrastructureSoftware', patterns: [/^Infrastructure software$/i] },
];

/**
 * テキストから数値をパース
 * "(61)" → -61, "4,191" → 4191, "-" → null
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
 * テーブル行から最初の有効な売上数値を抽出
 * $記号、%値、+/-変化率を除外し、最初の純粋な数値を返す
 */
function extractFirstRevenue($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const rawText = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();
    const align = ($cell.attr('align') || '').toLowerCase();

    // 右寄せセル判定（新形式: style, 旧形式: ALIGN属性）
    const isRightAligned = style.includes('text-align:right') || style.includes('text-align: right') || align === 'right';

    if (isRightAligned && rawText) {
      // $記号のみ、空、ダッシュ、%のみはスキップ
      if (rawText === '$' || rawText === '' || rawText === '-' || rawText === '—' || rawText === '%') return;
      values.push(rawText);
    }
  });

  // 最初の有効な数値を取得（%値や+/-変化率を除外）
  for (const v of values) {
    // %値をスキップ（"72", "80" 等は2-3桁の%、通常セグメント売上は4桁以上）
    // +/-で始まる変化率もスキップ
    if (v.startsWith('+') || v.startsWith('-')) continue;

    const num = parseNumber(v);
    if (num === null) continue;

    // %値は通常100以下（セグメント売上は最低でも数百M$）
    // ただし、数値が100以下でも初期のセグメントで小さい可能性があるため
    // 最初の数値で%セルかどうかを判定する
    // 構造的に: [売上額, %値, 前年売上額, %値, 変化率, %] のため
    // 最初の数値は常に売上額
    return num;
  }

  return null;
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
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text === ' ') return;

    const style = ($cell.attr('style') || '').toLowerCase();
    const align = ($cell.attr('align') || '').toLowerCase();
    const colspan = parseInt($cell.attr('colspan') || '1');

    // ラベルセル: 左寄せ、またはcolspan>=2、または先頭テキストセル
    const isLeftAligned = style.includes('text-align:left') || style.includes('text-align: left');

    if ((isLeftAligned || colspan >= 2) && !label) {
      if (!text.match(/^[\$\d,.\-()\s\u2014\u2013%+]+$/)) {
        label = text;
      }
    }
  });

  // フォールバック: 最初の非数値テキストセルをラベルとする
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
 * "Net revenue by segment" テーブルを検索し、セグメント売上を抽出
 * テーブルタイトルの直後の行からセグメント名を探す
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');

  // "Net revenue by segment" の位置を特定（原文HTMLで検索）
  // &nbsp; を含む形式にも対応するため、正規表現で柔軟にマッチ
  const segMatch = html.match(/Net(?:&nbsp;|\s)+revenue(?:&nbsp;|\s)+by(?:&nbsp;|\s)+segment/i);
  if (!segMatch) {
    return null;
  }
  const segIdx = segMatch.index;

  // セグメントテーブルを含むテーブルを見つける
  // "Net revenue by segment" を含む<table>の開始位置を後方検索
  const before = html.substring(0, segIdx);
  const tableStartIdx = before.lastIndexOf('<table');
  const tableStartIdxUpper = before.lastIndexOf('<TABLE');
  const actualTableStart = Math.max(tableStartIdx, tableStartIdxUpper);

  if (actualTableStart === -1) {
    return null;
  }

  // テーブルの終了位置を見つける（ネストに対応）
  let depth = 0;
  let tableEnd = -1;
  let si = actualTableStart;
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
    return null;
  }

  // テーブル内のセグメント行を解析
  const tableHtml = html.substring(actualTableStart, tableEnd);
  const $ = cheerio.load(tableHtml);

  const result = {};

  // テーブルは "Net revenue by segment" を含むテーブルなので、
  // 直接セグメント名を持つ行を検索する
  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    for (const def of SEGMENT_DEFS) {
      if (def.patterns.some(p => p.test(label))) {
        if (!(def.key in result)) {
          const value = extractFirstRevenue($, row);
          if (value !== null) {
            result[def.key] = value;
          }
        }
        break;
      }
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const segments = {};

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
        if (!segments[fy]) segments[fy] = {};
        segments[fy][q] = data;

        const keys = Object.keys(data);
        const total = keys.reduce((s, k) => s + data[k], 0);
        console.log(`  → ${keys.length} セグメント抽出: ${keys.map(k => `${k}=$${data[k]}M`).join(', ')} (合計: $${total}M)`);
      } else {
        console.warn(`  警告: ${fy}/${q} - セグメントデータが見つかりません`);
      }
    }
  }

  // JSON出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(segments, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(segments)) {
    for (const q of Object.keys(segments[fy])) {
      total++;
    }
  }
  console.log(`合計: ${total} 四半期分のセグメントデータを抽出`);
}

main();
