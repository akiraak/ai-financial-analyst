// press-release.html から貸借対照表データを抽出するスクリプト
// 出力: balance-sheet.json
// 対応形式: SEC EDGAR形式（<td>見出し + 同一テーブル内データ）、GlobNewswire形式
//
// "CONDENSED CONSOLIDATED BALANCE SHEETS" テーブルを解析し、
// 当四半期末（1列目）のデータのみ取得する

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'balance-sheet.json');

// 抽出対象の行ラベルとマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Cash,?\s*cash equivalents/i, /^Cash and cash equivalents$/i], key: 'cashAndEquivalents' },
  { patterns: [/^Total current assets$/i], key: 'totalCurrentAssets' },
  { patterns: [/^Total assets$/i], key: 'totalAssets' },
  { patterns: [/^Short-term debt$/i, /^Current portion of long-term debt$/i], key: 'shortTermDebt' },
  { patterns: [/^Total current liabilities$/i], key: 'totalCurrentLiabilities' },
  { patterns: [/^Long-term debt$/i], key: 'longTermDebt' },
  { patterns: [/^Total liabilities$/i], key: 'totalLiabilities' },
  { patterns: [/^(?:Total )?(?:stockholders|shareholders).?\s*equity$/i], key: 'totalEquity' },
];

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
 * 2列構成: [当四半期末, 前期末]
 * 最初の値（当四半期末）を返す
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
      // 数値のみのセルはスキップ（$記号のセル等）
      if (!text.match(/^[\$\d,.\-()\s]+$/)) {
        label = text;
      }
    }
  });

  return label;
}

/**
 * GlobNewswire形式: 行から数値セルを抽出（B/Sテーブル用）
 * padding-left:0 のセルを数値セルとして判定
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, '').trim();
    const style = $cell.attr('style') || '';
    const cls = $cell.attr('class') || '';

    // 数値セル判定: padding-left:0 で text-align:right、または gnw_padding_left_none
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
 * CONDENSED CONSOLIDATED BALANCE SHEETS テーブルを検索
 * 戻り値: { table, format, $ } （format: 'edgar' or 'gnw'）
 */
function findBalanceSheetTable(html, $) {
  const TITLE = 'CONDENSED CONSOLIDATED BALANCE SHEETS';
  let table = null;
  let format = 'gnw';

  // パターン1: <td>内で検索（SEC EDGAR形式: タイトルとデータが同一テーブル）
  $('td').each((i, el) => {
    const text = $(el).text().trim().replace(/\u00a0/g, ' ').trim();
    if (text === TITLE) {
      table = $(el).closest('table');
      format = 'edgar';
      return false;
    }
  });

  // パターン2: <strong>内で検索（GlobNewswire形式）
  if (!table) {
    $('strong').each((i, el) => {
      const text = $(el).text().trim().replace(/\u00a0/g, ' ').trim();
      if (text === TITLE) {
        const parent = $(el).closest('p');
        if (parent.length) {
          table = parent.nextAll('table').first();
        }
        if (!table || !table.length) {
          table = $(el).parent().nextAll('table').first();
        }
        format = 'gnw';
        return false;
      }
    });
  }

  // パターン3: SEC EDGAR形式フォールバック（<div><font>内にタイトル、直後に<table>）
  // HTMLテキストからindexOfで位置を特定し、直後のtableを切り出す
  if (!table || !table.length) {
    const titleIdx = html.indexOf(TITLE);
    if (titleIdx !== -1) {
      const afterTitle = html.substring(titleIdx);
      const tableMatch = afterTitle.match(/<table[\s>]/i);
      if (tableMatch) {
        const tableStart = titleIdx + tableMatch.index;
        const tableEndMatch = html.substring(tableStart).match(/<\/table>/i);
        if (tableEndMatch) {
          const tableHtml = html.substring(tableStart, tableStart + tableEndMatch.index + 8);
          const $table = cheerio.load(tableHtml);
          table = $table('table').first();
          format = 'edgar';
          // 専用のcheerioインスタンスを返す
          return { table, format, $: $table };
        }
      }
    }
  }

  return { table, format, $ };
}

/**
 * press-release.html からB/Sデータを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $orig = cheerio.load(html);

  const { table: bsTable, format, $ } = findBalanceSheetTable(html, $orig);
  if (!bsTable || !bsTable.length) {
    console.warn(`  警告: ${fy}/${q} - BALANCE SHEETSテーブルが見つかりません`);
    return null;
  }

  // 形式に応じたラベル・値抽出関数を選択
  const getLabelFn = format === 'edgar' ? getRowLabelEdgar : getRowLabel;
  const getValuesFn = format === 'edgar' ? extractValuesEdgar : extractValues;

  const result = {};
  const rows = bsTable.find('tr');

  rows.each((i, row) => {
    const label = getLabelFn($, row);
    if (!label) return;

    const values = getValuesFn($, row);
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
        if (!data.totalAssets) console.warn(`  ⚠ Total assets が見つかりません`);
        if (!data.totalEquity) console.warn(`  ⚠ Total equity が見つかりません`);
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
