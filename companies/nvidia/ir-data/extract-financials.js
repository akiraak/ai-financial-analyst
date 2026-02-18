// press-release.html から損益計算書データを抽出するスクリプト
// 出力: financials.json

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

// EPSとシェア数は特別処理（"Net income per share:" セクション内の Basic/Diluted）

/**
 * HTMLテーブルの行から数値を抽出する
 * 各データ値は3セル構成: [$, 数値, スペーサー]
 * 数値セルはpadding-left:0かつpadding-right:0（classまたはstyle）
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, '').trim();
    const style = $cell.attr('style') || '';
    const cls = $cell.attr('class') || '';

    // 数値セルの判定: padding-left:0 かつ padding-right:0
    const isValueCell =
      (style.includes('padding-left: 0') && style.includes('padding-right: 0')) ||
      (cls.includes('gnw_padding_left_none') && cls.includes('gnw_padding_right_none'));

    // text-align:rightも必要
    const isRightAligned =
      style.includes('text-align: right') || style.includes('text-align:right') ||
      cls.includes('gnw_align_right');

    if (isValueCell && isRightAligned && text) {
      // $記号、空白のみ、&nbsp;のセルはスキップ
      if (text === '$' || text === '' || text === '-' || text === '—') return;
      values.push(text);
    }
  });

  return values;
}

/**
 * テキストから数値をパース
 * "(61)" → -61, "57,006" → 57006, "1.30" → 1.30, "-" → null
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;

  // 括弧は負数: "(61" → -61（閉じ括弧は次のセルにある場合がある）
  let negative = false;
  let cleaned = text.replace(/[$\s]/g, '');
  if (cleaned.startsWith('(')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  }

  // カンマ除去
  cleaned = cleaned.replace(/,/g, '');

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * 行のラベルテキストを取得（HTMLタグ除去、&nbsp;除去）
 */
function getRowLabel($, row) {
  const cells = $(row).find('td');
  let label = '';

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, ' ').trim();
    if (!text || text === ' ') return;

    // ラベルセルかどうか: text-align:left または align系クラス
    const style = $cell.attr('style') || '';
    const cls = $cell.attr('class') || '';
    const isLabel =
      style.includes('text-align: left') || style.includes('text-align:left') ||
      cls.includes('gnw_align_left') || cls.includes('gnw_align_center');

    // colspan付きのテキストセルはラベル
    const colspan = parseInt($cell.attr('colspan') || '1');

    if (isLabel || colspan >= 2) {
      if (!label) label = text;
    }
  });

  // ラベルが見つからない場合は全セルテキストの先頭テキストを使う
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

  // CONDENSED CONSOLIDATED STATEMENTS OF INCOME テーブルを検索
  // パターン1: タイトルが<td>内にある場合（多くの四半期）
  // パターン2: タイトルが<p><strong>内にある場合（FY2024/Q2等）
  let incomeTable = null;

  // パターン1: <td>内を検索
  $('td').each((i, el) => {
    const text = $(el).text().trim().replace(/\u00a0/g, ' ').trim();
    if (text === 'CONDENSED CONSOLIDATED STATEMENTS OF INCOME') {
      incomeTable = $(el).closest('table');
      return false;
    }
  });

  // パターン2: <strong>内を検索し、直後のテーブルを使用
  if (!incomeTable) {
    $('strong').each((i, el) => {
      const text = $(el).text().trim().replace(/\u00a0/g, ' ').trim();
      if (text === 'CONDENSED CONSOLIDATED STATEMENTS OF INCOME') {
        // 親要素（<p>等）の次のテーブルを取得
        const parent = $(el).closest('p');
        if (parent.length) {
          incomeTable = parent.nextAll('table').first();
        }
        if (!incomeTable || !incomeTable.length) {
          // フォールバック: DOM順で次のテーブル
          incomeTable = $(el).parent().nextAll('table').first();
        }
        return false;
      }
    });
  }

  if (!incomeTable) {
    console.warn(`  警告: ${fy}/${q} - CONDENSED CONSOLIDATED STATEMENTS OF INCOMEテーブルが見つかりません`);
    return null;
  }

  const result = {};
  let inEpsSection = false;
  let inSharesSection = false;

  const rows = incomeTable.find('tr');
  rows.each((i, row) => {
    const label = getRowLabel($, row);
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

    const values = extractValues($, row);
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
