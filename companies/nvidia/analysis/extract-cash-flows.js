// press-release.html からキャッシュフローデータを抽出するスクリプト
// 出力: cash-flows.json
//
// "CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS" テーブルを解析し、
// 当四半期（1列目: Three Months Ended）のデータのみ取得する
// Free Cash Flow は GAAP-to-Non-GAAP reconciliation テーブルから抽出

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, 'cash-flows.json');

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
 * 行から数値セルを抽出
 */
function extractValues($, row) {
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
 * 行のラベルテキストを取得
 */
function getRowLabel($, row) {
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
 * CF関連テーブルをすべて検索する
 * CF計算書が複数テーブルに分割されている場合があるため、
 * タイトル直後の連続するテーブルをすべて返す
 */
function findCFTables($) {
  const titleText = 'CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS';
  let tables = [];

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

  return tables;
}

/**
 * テーブルから指定マッピングで行データを抽出（1列目のみ）
 */
function extractFromTable($, table, mappings) {
  const result = {};
  if (!table) return result;

  table.find('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    const values = extractValues($, row);
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
 */
function extractFCF($) {
  // 全テーブルを走査して "Free cash flow" 行を探す
  let fcf = null;

  $('table').each((ti, table) => {
    if (fcf !== null) return false;

    $(table).find('tr').each((ri, row) => {
      if (fcf !== null) return false;
      const label = getRowLabel($, row);
      if (!label) return;

      if (FCF_PATTERNS.some(p => p.test(label))) {
        const values = extractValues($, row);
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
  const cfTables = findCFTables($);

  const result = {};

  // CF本体から Operating/Investing/Financing CF を抽出
  if (cfTables.length > 0) {
    for (const table of cfTables) {
      const cfData = extractFromTable($, table, CF_ROW_MAPPINGS);
      Object.assign(result, cfData);
    }
  } else {
    console.warn(`  警告: ${fy}/${q} - CASH FLOWSテーブルが見つかりません`);
  }

  // GAAP reconciliation から Free Cash Flow を抽出
  const fcf = extractFCF($);
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
