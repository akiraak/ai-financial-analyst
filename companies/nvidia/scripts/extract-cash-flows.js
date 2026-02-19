// press-release.html からキャッシュフローデータを抽出するスクリプト
// 出力: cash-flows.json
//
// "CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS" テーブルを解析し、
// 当四半期（1列目: Three Months Ended）のデータのみ取得する
// Free Cash Flow は GAAP-to-Non-GAAP reconciliation テーブルから抽出
// 対応形式: SEC EDGAR形式（<td>見出し + text-align:right値）、GlobNewswire形式

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'cash-flows.json');

// CF本体の抽出対象
const CF_ROW_MAPPINGS = [
  { patterns: [/^Net cash provided by operating activities$/i], key: 'operatingCF' },
  { patterns: [/^Net cash (?:used in|provided by)(?:\s*\(used in\))? investing activities$/i,
               /^Net cash provided by \(used in\) investing activities$/i], key: 'investingCF' },
  { patterns: [/^Net cash (?:used in|provided by)(?:\s*\(used in\))? financing activities$/i,
               /^Net cash provided by \(used in\) financing activities$/i], key: 'financingCF' },
];

// GAAP reconciliation からFCFを取得
const FCF_PATTERNS = [/^Free cash flow$/i];

/**
 * テキストから数値をパース
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;
  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned.startsWith('(')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  }
  cleaned = cleaned.replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * SEC EDGAR形式: テーブル行から右寄せの数値セルを抽出
 * text-align:right スタイルで値セルを識別する
 */
function extractValuesEdgar($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = $cell.attr('style') || '';

    // 右寄せセルから数値を抽出
    if (style.includes('text-align:right')) {
      if (text && text !== '$' && text !== '' && text !== '-' && text !== '—') {
        values.push(text);
      }
    }
  });

  return values;
}

/**
 * SEC EDGAR形式: 行のラベルテキストを取得
 * ラベルは text-align:left のセル
 */
function getRowLabelEdgar($, row) {
  const cells = $(row).find('td');
  let label = '';

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, ' ').trim();
    const style = $cell.attr('style') || '';

    if (style.includes('text-align:left') && text && !label) {
      // 数値のみのセルはスキップ
      if (!text.match(/^[\$\d,.\-()\s]+$/)) {
        label = text;
      }
    }
  });

  return label;
}

/**
 * GlobNewswire形式: 行から数値セルを抽出
 * padding-left:0 かつ text-align:right で値セルを識別する
 */
function extractValuesGnw($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, '').trim();
    const style = $cell.attr('style') || '';
    const cls = $cell.attr('class') || '';

    const hasPaddingLeft0 =
      style.includes('padding-left: 0') || style.includes('padding-left:0') ||
      cls.includes('gnw_padding_left_none');
    const isRightAligned =
      style.includes('text-align: right') || style.includes('text-align:right') ||
      cls.includes('gnw_align_right');

    if (hasPaddingLeft0 && isRightAligned && text) {
      if (text === '$' || text === '' || text === '-' || text === '—') return;
      values.push(text);
    }
  });

  return values;
}

/**
 * GlobNewswire形式: 行のラベルテキストを取得
 */
function getRowLabelGnw($, row) {
  const cells = $(row).find('td');
  let label = '';

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, ' ').trim();
    if (!text || text === ' ') return;

    const style = $cell.attr('style') || '';
    const cls = $cell.attr('class') || '';
    const isLabel =
      style.includes('text-align: left') || style.includes('text-align:left') ||
      cls.includes('gnw_align_left') || cls.includes('gnw_align_center');
    const colspan = parseInt($cell.attr('colspan') || '1');

    if (isLabel || colspan >= 2) {
      if (!label) label = text;
    }
  });

  if (!label) {
    cells.each((i, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').trim();
      if (text && text !== ' ' && !text.match(/^[\$\d,.\-()\s]+$/) && !label) {
        label = text;
      }
    });
  }

  return label;
}

/**
 * フォーマットに応じた値抽出関数を返す
 */
function getExtractValues(format) {
  return format === 'edgar' ? extractValuesEdgar : extractValuesGnw;
}

/**
 * フォーマットに応じたラベル取得関数を返す
 */
function getRowLabel(format) {
  return format === 'edgar' ? getRowLabelEdgar : getRowLabelGnw;
}

/**
 * HTMLの形式を検出する
 * SEC EDGAR形式: text-align:right で値を持つセルがある
 * GlobNewswire形式: padding-left:0 + text-align:right で値を持つセルがある
 */
function detectFormat(html) {
  // SEC EDGAR形式の特徴: border-collapse:collapse + text-align:right（padding-left:0なし）
  if (html.includes('border-collapse:collapse') && html.includes('text-align:right')) {
    return 'edgar';
  }
  return 'gnw';
}

/**
 * CF関連テーブルをすべて検索する
 * CF計算書が複数テーブルに分割されている場合があるため、
 * タイトル直後の連続するテーブルをすべて返す
 * @returns {{ tables: Array, format: string }}
 */
function findCFTables(html, $) {
  const titleText = 'CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS';
  let tables = [];
  let format = detectFormat(html);

  // SEC EDGAR形式: HTMLテキストからindexOfでタイトル位置を特定し、
  // その位置を含むテーブルと後続テーブルを切り出してcheerioで解析
  // SEC EDGARではテーブル間に<div>が挟まるため、cheerioのnext()では辿れない
  if (format === 'edgar') {
    const titleIdx = html.indexOf(titleText);
    if (titleIdx !== -1) {
      // タイトルを含む<table>の開始位置を後方検索
      const before = html.substring(0, titleIdx);
      const tableStartIdx = before.lastIndexOf('<table');
      if (tableStartIdx !== -1) {
        // タイトルを含むテーブルから順に連続するテーブルを取得
        let searchPos = tableStartIdx;
        let consecutive = 0;
        while (searchPos < html.length && consecutive < 10) {
          const tableMatch = html.substring(searchPos).match(/<table[\s>]/i);
          if (!tableMatch) break;

          const tStart = searchPos + tableMatch.index;
          const tEndMatch = html.substring(tStart).match(/<\/table>/i);
          if (!tEndMatch) break;

          const tableHtml = html.substring(tStart, tStart + tEndMatch.index + 8);
          const $t = cheerio.load(tableHtml);
          tables.push({ $: $t, table: $t('table').first() });

          searchPos = tStart + tEndMatch.index + 8;
          consecutive++;

          // 次のテーブルまでの距離を確認（SEC EDGARでは<div>が挟まるため余裕をもたせる）
          const nextContent = html.substring(searchPos, searchPos + 1000);
          const nextTable = nextContent.match(/<table[\s>]/i);
          if (!nextTable || nextTable.index > 500) break;
        }
      }
    }
    return { tables, format };
  }

  // GlobNewswire形式

  // パターン1: <td>内でタイトルを検索 → そのテーブルと連続するテーブルを取得
  $('td').each((i, el) => {
    const text = $(el).text().trim().replace(/\u00a0/g, ' ').trim();
    if (text === titleText) {
      const firstTable = $(el).closest('table');
      if (firstTable.length) {
        tables.push(firstTable);
        // 近傍のテーブルも取得（間に<p>&nbsp;</p>等が挟まる場合がある）
        let next = firstTable.next();
        let skipped = 0;
        while (next.length && skipped < 3) {
          if (next.is('table')) {
            tables.push(next);
            skipped = 0;
          } else {
            skipped++;
          }
          next = next.next();
        }
      }
      return false;
    }
  });

  // パターン2: <strong>内でタイトルを検索
  if (tables.length === 0) {
    $('strong').each((i, el) => {
      const text = $(el).text().trim().replace(/\u00a0/g, ' ').trim();
      if (text === titleText) {
        const parent = $(el).closest('p');
        let firstTable = null;
        if (parent.length) {
          firstTable = parent.nextAll('table').first();
        }
        if (!firstTable || !firstTable.length) {
          firstTable = $(el).parent().nextAll('table').first();
        }
        if (firstTable && firstTable.length) {
          tables.push(firstTable);
          // 近傍のテーブルも取得（間に<p>&nbsp;</p>等が挟まる場合がある）
          let next = firstTable.next();
          let skipped = 0;
          while (next.length && skipped < 3) {
            if (next.is('table')) {
              tables.push(next);
              skipped = 0;
            } else {
              skipped++;
            }
            next = next.next();
          }
        }
        return false;
      }
    });
  }

  return { tables, format };
}

/**
 * テーブルから指定マッピングで行データを抽出（1列目のみ）
 * @param {CheerioAPI} $ - cheerioインスタンス
 * @param {Cheerio} table - テーブル要素
 * @param {Array} mappings - 行マッピング
 * @param {string} format - 'edgar' or 'gnw'
 */
function extractFromTable($, table, mappings, format) {
  const result = {};
  if (!table) return result;

  const extractValuesFn = getExtractValues(format);
  const getRowLabelFn = getRowLabel(format);

  table.find('tr').each((i, row) => {
    const label = getRowLabelFn($, row);
    if (!label) return;

    const values = extractValuesFn($, row);
    if (values.length === 0) return;

    const firstValue = parseNumber(values[0]);

    for (const mapping of mappings) {
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
 * GAAP-to-Non-GAAP reconciliation テーブルからFCFを抽出
 * 複数の reconciliation テーブルがあるため、"Free cash flow" を含むテーブルを探す
 * @param {string} html - 元のHTML文字列
 * @param {CheerioAPI} $ - cheerioインスタンス
 * @param {string} format - 'edgar' or 'gnw'
 */
function extractFCF(html, $, format) {
  const extractValuesFn = getExtractValues(format);
  const getRowLabelFn = getRowLabel(format);

  // SEC EDGAR形式: HTMLテキストからFree cash flowの位置を特定してテーブルを取得
  if (format === 'edgar') {
    // "Free cash flow" を含むテーブルをindexOfで検索
    const fcfIdx = html.indexOf('Free cash flow');
    if (fcfIdx !== -1) {
      // この位置を含むテーブルの開始位置を後方検索
      const before = html.substring(0, fcfIdx);
      const tableStartIdx = before.lastIndexOf('<table');
      if (tableStartIdx !== -1) {
        const tEndMatch = html.substring(tableStartIdx).match(/<\/table>/i);
        if (tEndMatch) {
          const tableHtml = html.substring(tableStartIdx, tableStartIdx + tEndMatch.index + 8);
          const $t = cheerio.load(tableHtml);
          const table = $t('table').first();

          let fcf = null;
          table.find('tr').each((ri, row) => {
            if (fcf !== null) return false;
            const label = getRowLabelFn($t, row);
            if (!label) return;

            if (FCF_PATTERNS.some(p => p.test(label))) {
              const values = extractValuesFn($t, row);
              if (values.length > 0) {
                fcf = parseNumber(values[0]);
                return false;
              }
            }
          });

          if (fcf !== null) return fcf;
        }
      }
    }
  }

  // GlobNewswire形式 / フォールバック: 全テーブルを走査して "Free cash flow" 行を探す
  let fcf = null;

  $('table').each((ti, table) => {
    if (fcf !== null) return false;

    $(table).find('tr').each((ri, row) => {
      if (fcf !== null) return false;
      const label = getRowLabelFn($, row);
      if (!label) return;

      if (FCF_PATTERNS.some(p => p.test(label))) {
        const values = extractValuesFn($, row);
        if (values.length > 0) {
          fcf = parseNumber(values[0]);
          return false;
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
  const $ = cheerio.load(html);

  // CFテーブルの検索（複数テーブルに分割されている場合がある）
  const { tables: cfTables, format } = findCFTables(html, $);

  const result = {};

  // CF本体から Operating/Investing/Financing CF を抽出
  if (cfTables.length > 0) {
    for (const tableItem of cfTables) {
      // パターン3（SEC EDGAR indexOf）の場合は独自の$を持つオブジェクト
      if (tableItem.$ && tableItem.table) {
        const cfData = extractFromTable(tableItem.$, tableItem.table, CF_ROW_MAPPINGS, format);
        Object.assign(result, cfData);
      } else {
        // パターン1/2: cheerio要素を直接使用
        const cfData = extractFromTable($, tableItem, CF_ROW_MAPPINGS, format);
        Object.assign(result, cfData);
      }
    }
  } else {
    console.warn(`  警告: ${fy}/${q} - CASH FLOWSテーブルが見つかりません`);
  }

  // GAAP reconciliation から Free Cash Flow を抽出
  const fcf = extractFCF(html, $, format);
  if (fcf !== null) {
    result.freeCashFlow = fcf;
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
        if (!data.operatingCF) console.warn(`  ⚠ Operating CF が見つかりません`);
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
