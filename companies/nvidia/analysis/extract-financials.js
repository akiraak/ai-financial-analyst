// press-release.html から損益計算書データを抽出するスクリプト
// 出力: financials.json
// 対応形式: SEC EDGAR形式（<div>見出し + <table>データ）、GlobNewswire形式

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, 'financials.json');

// 抽出対象の行ラベルとマッピング
// press-release内のラベル → JSONのキー
const ROW_MAPPINGS = [
  { patterns: [/^Revenue$/i], key: 'revenue' },
  { patterns: [/^Cost of revenue$/i], key: 'costOfRevenue' },
  { patterns: [/^Gross profit$/i], key: 'grossProfit' },
  { patterns: [/^Research and development$/i], key: 'researchAndDevelopment' },
  { patterns: [/^Sales, general and administrative$/i], key: 'sga' },
  { patterns: [/^Total operating expenses$/i], key: 'totalOperatingExpenses' },
  { patterns: [/^(?:Income from operations|Operating income)$/i], key: 'operatingIncome' },
  { patterns: [/^Interest income$/i], key: 'interestIncome' },
  { patterns: [/^Interest expense$/i], key: 'interestExpense' },
  { patterns: [/^Other,?\s*net$|^Other income,?\s*net$/i], key: 'otherIncomeNet' },
  { patterns: [/^Total other income(?:.*net)?$/i], key: 'totalOtherIncome' },
  { patterns: [/^Income before income tax$/i], key: 'incomeBeforeTax' },
  { patterns: [/^Income tax expense$/i], key: 'incomeTaxExpense' },
  { patterns: [/^Net income$/i], key: 'netIncome' },
];

/**
 * テキストから数値をパース
 * "(61)" → -61, "57,006" → 57006, "1.30" → 1.30, "-" → null
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;

  let negative = false;
  let cleaned = text.replace(/[$\s]/g, '');
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
 * 4列構成: [当期Q, 前年Q, 当期YTD, 前年YTD]
 * 最初の値（当期Q）を返す
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
 * ラベルは text-align:left のセル（colspan >= 3 が多い）
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
 * GlobNewswire形式: HTMLテーブルの行から数値を抽出する
 */
function extractValuesGnw($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, '').trim();
    const style = $cell.attr('style') || '';
    const cls = $cell.attr('class') || '';

    const isValueCell =
      (style.includes('padding-left: 0') && style.includes('padding-right: 0')) ||
      (cls.includes('gnw_padding_left_none') && cls.includes('gnw_padding_right_none'));

    const isRightAligned =
      style.includes('text-align: right') || style.includes('text-align:right') ||
      cls.includes('gnw_align_right');

    if (isValueCell && isRightAligned && text) {
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
 * press-release.html からCONDENSED CONSOLIDATED STATEMENTS OF INCOMEテーブルを解析
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);

  const TITLE = 'CONDENSED CONSOLIDATED STATEMENTS OF INCOME';
  let incomeTable = null;
  let format = 'gnw'; // 'gnw' or 'edgar'

  // パターン1: <td>内にタイトルがある場合（GlobNewswire形式）
  $('td').each((i, el) => {
    const text = $(el).text().trim().replace(/\u00a0/g, ' ').trim();
    if (text === TITLE) {
      incomeTable = $(el).closest('table');
      format = 'gnw';
      return false;
    }
  });

  // パターン2: <strong>内にタイトルがある場合
  if (!incomeTable) {
    $('strong').each((i, el) => {
      const text = $(el).text().trim().replace(/\u00a0/g, ' ').trim();
      if (text === TITLE) {
        const parent = $(el).closest('p');
        if (parent.length) {
          incomeTable = parent.nextAll('table').first();
        }
        if (!incomeTable || !incomeTable.length) {
          incomeTable = $(el).parent().nextAll('table').first();
        }
        format = 'gnw';
        return false;
      }
    });
  }

  // パターン3: SEC EDGAR形式（<div><font>内にタイトル、直後に<table>）
  if (!incomeTable) {
    // HTMLテキストから位置を特定し、直後のtableを取得
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
          incomeTable = $table('table').first();
          // テーブルの$コンテキストを変更
          $ === $ ; // 元の$をそのまま使えないので、$tableを使う
          format = 'edgar';

          // SEC EDGAR形式は専用のcheerioインスタンスで処理
          return extractFromEdgarTable($table, incomeTable, fy, q);
        }
      }
    }
  }

  if (!incomeTable || !incomeTable.length) {
    console.warn(`  警告: ${fy}/${q} - ${TITLE}テーブルが見つかりません`);
    return null;
  }

  // GlobNewswire形式の解析
  return extractFromTable($, incomeTable, format, fy, q);
}

/**
 * SEC EDGAR形式のテーブルを解析
 */
function extractFromEdgarTable($, incomeTable, fy, q) {
  const result = {};
  let inEpsSection = false;
  let inSharesSection = false;

  const rows = incomeTable.find('tr');
  rows.each((i, row) => {
    const label = getRowLabelEdgar($, row);
    if (!label) return;

    // EPS セクションの検出
    if (label.match(/Net income per share/i)) {
      inEpsSection = true;
      inSharesSection = false;
      return;
    }
    if (label.match(/Weighted average shares/i)) {
      inSharesSection = true;
      inEpsSection = false;
      return;
    }

    const values = extractValuesEdgar($, row);
    if (values.length === 0) return;

    // 最初の値（Three Months Ended の当四半期列）を取得
    const firstValue = parseNumber(values[0]);

    // EPS セクション内の Basic/Diluted
    if (inEpsSection) {
      if (label.match(/^Basic$/i)) {
        result.epsBasic = firstValue;
        return;
      }
      if (label.match(/^Diluted$/i)) {
        result.epsDiluted = firstValue;
        inEpsSection = false;
        return;
      }
    }

    // 発行株式数セクション内の Basic/Diluted
    if (inSharesSection) {
      if (label.match(/^Basic$/i)) {
        result.sharesBasic = firstValue;
        return;
      }
      if (label.match(/^Diluted$/i)) {
        result.sharesDiluted = firstValue;
        inSharesSection = false;
        return;
      }
    }

    // 通常の行マッピング
    for (const mapping of ROW_MAPPINGS) {
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
 * GlobNewswire形式のテーブルを解析
 */
function extractFromTable($, incomeTable, format, fy, q) {
  const result = {};
  let inEpsSection = false;
  let inSharesSection = false;

  const rows = incomeTable.find('tr');
  rows.each((i, row) => {
    const label = getRowLabelGnw($, row);
    if (!label) return;

    // EPS セクションの検出
    if (label.match(/Net income per share/i)) {
      inEpsSection = true;
      inSharesSection = false;
      return;
    }
    if (label.match(/Weighted average shares/i)) {
      inSharesSection = true;
      inEpsSection = false;
      return;
    }

    const values = extractValuesGnw($, row);
    if (values.length === 0) return;

    const firstValue = parseNumber(values[0]);

    if (inEpsSection) {
      if (label.match(/^Basic$/i)) {
        result.epsBasic = firstValue;
        return;
      }
      if (label.match(/^Diluted$/i)) {
        result.epsDiluted = firstValue;
        inEpsSection = false;
        return;
      }
    }

    if (inSharesSection) {
      if (label.match(/^Basic$/i)) {
        result.sharesBasic = firstValue;
        return;
      }
      if (label.match(/^Diluted$/i)) {
        result.sharesDiluted = firstValue;
        inSharesSection = false;
        return;
      }
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

  return result;
}

// メイン処理
function main() {
  const financials = {};

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
        if (!financials[fy]) financials[fy] = {};
        financials[fy][q] = data;

        // 抽出結果のサマリー表示
        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目抽出: ${keys.join(', ')}`);
        if (!data.revenue) console.warn(`  ⚠ Revenue が見つかりません`);
        if (!data.netIncome) console.warn(`  ⚠ Net income が見つかりません`);
        if (!data.epsDiluted) console.warn(`  ⚠ Diluted EPS が見つかりません`);
      }
    }
  }

  // JSON出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(financials, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(financials)) {
    for (const q of Object.keys(financials[fy])) {
      total++;
    }
  }
  console.log(`合計: ${total} 四半期分のデータを抽出`);
}

main();
