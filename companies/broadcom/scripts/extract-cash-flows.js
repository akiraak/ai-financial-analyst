// Broadcom press-release.html からキャッシュフローデータを抽出するスクリプト
// 出力: cash-flows.json
//
// "CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS" テーブルを解析し、
// 当四半期（1列目）のデータを取得する
// また、GAAP-to-Non-GAAP reconciliation テーブルから Free Cash Flow を抽出する
// freeCashFlow = operatingCashFlow - capitalExpenditures（計算フォールバック）
//
// 対応形式:
//   1. 新形式: style="text-align:right" で数値セル判定（FY2020 Q2以降）
//   2. 旧形式: ALIGN="right" で数値セル判定（FY2020 Q1）

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
  { patterns: [/^Purchases of property,?\s*plant and equipment$/i], key: 'capitalExpenditures' },
];

/**
 * テキストから数値をパース
 * "(10,987)" → -10987, "2,322" → 2322, "-" → null
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
 * 右寄せセル（style または ALIGN属性）から値を集める
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
    // 数値パターン判定
    const isNumeric = /^[\$\d,.\-()\u2014\u2013]+$/.test(rawText) && rawText !== '$' && rawText !== '';

    if ((isRightAligned || isNumeric) && rawText) {
      // $記号のみ、空、ダッシュ類はスキップ
      if (rawText === '$' || rawText === '' || rawText === '-' || rawText === '—') return;
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
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.\-()\s\u2014\u2013%]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
  }

  return label;
}

/**
 * CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS テーブルを検索して解析
 * タイトルがテーブル内にある場合（新形式）と外にある場合（旧形式）の両方に対応
 */
function extractCFFromFile(html) {
  // テーブルタイトルを検索
  const titlePattern = /CONDENSED\s+CONSOLIDATED\s+STATEMENTS\s+OF\s+CASH\s+FLOWS/i;
  const titleMatch = html.match(titlePattern);
  if (!titleMatch) {
    return {};
  }

  const titleIdx = titleMatch.index;
  let tableStart;

  // タイトル位置以降で<table>を見つける
  const afterTitle = html.substring(titleIdx);
  const tableAfterMatch = afterTitle.match(/<table[\s>]/i);

  // タイトルがテーブル内にあるか確認（後方検索で最寄りの<table>と</table>を比較）
  const before = html.substring(0, titleIdx);
  const lastTableOpen = Math.max(before.lastIndexOf('<table'), before.lastIndexOf('<TABLE'));
  const lastTableClose = Math.max(before.lastIndexOf('</table'), before.lastIndexOf('</TABLE'));
  const titleInsideTable = lastTableOpen > lastTableClose && lastTableOpen !== -1;

  if (titleInsideTable) {
    // タイトルがテーブル内にある場合: タイトルを含むテーブルの開始位置を使用
    tableStart = lastTableOpen;
  } else if (tableAfterMatch) {
    // タイトルがテーブル外にある場合: タイトル直後のテーブルを使用
    tableStart = titleIdx + tableAfterMatch.index;
  } else {
    return {};
  }

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
    return {};
  }

  const tableHtml = html.substring(tableStart, tableEnd);
  const $ = cheerio.load(tableHtml);

  const result = {};

  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    const values = extractValues($, row);
    if (values.length === 0) return;

    // 1列目（当四半期）のみ取得
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

  return result;
}

/**
 * GAAP-to-Non-GAAP reconciliation テーブルから Free Cash Flow を抽出
 * "Free cash flow" 行の最初の数値を取得
 * 複数のFCF行がある場合、CF計算書直後のreconciliationテーブルの値を優先
 */
function extractFCF(html) {
  const $ = cheerio.load(html);
  let fcf = null;

  // 全テーブルを走査して "Free cash flow" 行を探す
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

/**
 * press-release.html からCFデータを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');

  const result = {};

  // CF計算書から Operating/Investing/Financing CF と CapEx を抽出
  const cfData = extractCFFromFile(html);
  Object.assign(result, cfData);

  // GAAP reconciliation から Free Cash Flow を抽出
  const fcf = extractFCF(html);
  if (fcf !== null) {
    result.freeCashFlow = fcf;
  } else if (result.operatingCashFlow !== undefined && result.capitalExpenditures !== undefined) {
    // FCFが見つからない場合は計算で求める
    // capitalExpenditures は通常負の値のため abs() を使用
    result.freeCashFlow = result.operatingCashFlow - Math.abs(result.capitalExpenditures);
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
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.html が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        if (!cashFlows[fy]) cashFlows[fy] = {};
        cashFlows[fy][q] = data;

        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目抽出: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
        if (!data.operatingCashFlow) console.warn(`  警告: Operating CF が見つかりません`);
        if (!data.freeCashFlow && data.freeCashFlow !== 0) console.warn(`  警告: Free Cash Flow が見つかりません`);
      } else {
        console.warn(`  警告: ${fy}/${q} - CFデータが見つかりません`);
      }
    }
  }

  // JSON出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cashFlows, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(cashFlows)) {
    for (const q of Object.keys(cashFlows[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のCFデータを抽出`);
}

main();
