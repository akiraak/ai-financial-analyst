// press-release.html から損益計算書データを抽出するスクリプト
// 出力: financials.json
// 対応形式: Microsoft SEC EDGAR形式（旧: 大文字タグ、新: 小文字タグ + inline CSS）
//
// Microsoft固有の構造:
// - <td style="text-align:center"><p style="text-align:right"><font>値</font></p></td>
// - ラベルは <td style="text-align:left"> に格納
// - 旧形式は <TD ALIGN="right"> を使用

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'financials.json');

// 抽出対象の行ラベルとマッピング（Microsoft固有のラベル）
const ROW_MAPPINGS = [
  { patterns: [/^Total revenue$/i], key: 'revenue' },
  { patterns: [/^Total cost of revenue$/i], key: 'costOfRevenue' },
  { patterns: [/^Gross margin$/i, /^Gross profit$/i], key: 'grossProfit' },
  { patterns: [/^Research and development$/i], key: 'researchAndDevelopment' },
  { patterns: [/^Sales and marketing$/i], key: 'salesAndMarketing' },
  { patterns: [/^General and administrative$/i], key: 'generalAndAdministrative' },
  { patterns: [/^Operating income$/i, /^Income from operations$/i], key: 'operatingIncome' },
  { patterns: [/^Other income,?\s*net$/i], key: 'otherIncomeNet' },
  { patterns: [/^Income before income taxes$/i], key: 'incomeBeforeTax' },
  { patterns: [/^Provision for income taxes$/i, /^Income tax (?:expense|provision)$/i], key: 'incomeTaxExpense' },
  { patterns: [/^Net income$/i], key: 'netIncome' },
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
 * テーブル行からラベルテキストを取得
 * 新形式: text-align:left のセル
 * 旧形式: VALIGN="top" のセル、またはmargin-leftを持つ<P>のセル
 * フォールバック: 最初の有意なテキストを含むセル
 */
function getRowLabel($, row) {
  const cells = $(row).find('td');
  let label = '';

  cells.each((i, cell) => {
    if (label) return;
    const $cell = $(cell);
    const tdStyle = ($cell.attr('style') || '').toLowerCase();
    const tdAlign = ($cell.attr('align') || '').toLowerCase();
    const tdValign = ($cell.attr('valign') || '').toLowerCase();

    // 新形式: text-align:left
    const isTdLeft = tdStyle.includes('text-align:left') || tdAlign === 'left';
    // 内部<p>のスタイルチェック
    const $p = $cell.find('p').first();
    const pStyle = ($p.attr('style') || '').toLowerCase();
    const pAlign = ($p.attr('align') || '').toLowerCase();
    const isPLeft = pStyle.includes('text-align:left') || pAlign === 'left';
    // 旧形式: VALIGN="top" は通常ラベルセル
    const isVTop = tdValign === 'top';
    // 旧形式: margin-left を持つ<P>
    const hasMarginLeft = pStyle.includes('margin-left');

    if (isTdLeft || isPLeft || isVTop || hasMarginLeft) {
      const text = $cell.text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.\-()\s]+$/) && text.length > 1) {
        label = text;
      }
    }
  });

  // フォールバック: 最初の有意テキストセル（右寄せでないもの）
  if (!label) {
    cells.each((i, cell) => {
      if (label) return;
      const $cell = $(cell);
      const text = $cell.text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      // 内部<p>が右寄せでないか確認
      const $p = $cell.find('p').first();
      const pAlign = ($p.attr('align') || '').toLowerCase();
      const pStyle = ($p.attr('style') || '').toLowerCase();
      const isRight = pAlign === 'right' || pStyle.includes('text-align:right');
      if (!isRight && text && !text.match(/^[\$\d,.\-()\s]+$/) && text.length > 1) {
        label = text;
      }
    });
  }

  return label;
}

/**
 * テーブル行から数値セルを抽出
 * <td>のtext-align:centerまたはright、かつ内部<p>のtext-align:right をチェック
 * 旧形式: <TD ALIGN="right"> もサポート
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const tdStyle = ($cell.attr('style') || '').toLowerCase();
    const tdAlign = ($cell.attr('align') || '').toLowerCase();

    // 内部<p>のスタイルもチェック
    const $p = $cell.find('p');
    const pStyle = ($p.attr('style') || '').toLowerCase();
    const pAlign = ($p.attr('align') || '').toLowerCase();

    // 数値セルの判定:
    // 新形式: <td text-align:center> + <p text-align:right>
    // 旧形式: <TD ALIGN="right"> or <P ALIGN="right">
    const isValueCell =
      (tdStyle.includes('text-align:center') && pStyle.includes('text-align:right')) ||
      tdStyle.includes('text-align:right') ||
      tdAlign === 'right' ||
      pAlign === 'right';

    if (isValueCell) {
      const text = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
      if (text && text !== '$' && text !== '' && text !== '&#160;') {
        // 1ptフォントのセパレータ行を除外（&#160;のみ）
        const fontSize = pStyle.match(/font-size:\s*([\d.]+)pt/);
        if (fontSize && parseFloat(fontSize[1]) <= 1) return;

        // 数値として解釈可能かチェック
        const cleaned = text.replace(/[$,\s()]/g, '');
        if (cleaned && (cleaned.match(/^\d/) || cleaned === '-' || cleaned === '—')) {
          values.push(text);
        }
      }
    }
  });

  return values;
}

/**
 * HTMLテキスト内のセクション見出しを検索し、直後のテーブルHTMLを返す
 */
function findTableByHeading(html, headingText) {
  const headingIdx = html.indexOf(headingText);
  if (headingIdx === -1) return null;

  // 見出し以降から最初の<table>を探す
  const afterHeading = html.substring(headingIdx);
  const tableMatch = afterHeading.match(/<table[\s>]/i);
  if (!tableMatch) return null;

  const tableStart = headingIdx + tableMatch.index;

  // ネストされたtableを考慮して</table>を見つける
  let depth = 0;
  const tableRegex = /<(\/?)table[\s>]/gi;
  tableRegex.lastIndex = tableStart;
  let m;
  let tableEnd = -1;
  while ((m = tableRegex.exec(html)) !== null) {
    if (m[1] === '/') {
      depth--;
      if (depth === 0) {
        tableEnd = m.index + '</table>'.length;
        break;
      }
    } else {
      depth++;
    }
  }

  if (tableEnd === -1) return null;
  const tableHtml = html.substring(tableStart, tableEnd);
  const $table = cheerio.load(tableHtml);
  return { $: $table, table: $table('table').first() };
}

/**
 * press-release.html から損益計算書データを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');

  // "INCOME STATEMENTS" テーブルを探す
  const found = findTableByHeading(html, 'INCOME STATEMENTS');
  if (!found) {
    console.warn(`  警告: ${fy}/${q} - INCOME STATEMENTSテーブルが見つかりません`);
    return null;
  }

  const { $, table } = found;
  const result = {};
  let inEpsSection = false;
  let inSharesSection = false;

  table.find('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // EPS セクションの検出
    if (label.match(/^Earnings per share/i)) {
      inEpsSection = true;
      inSharesSection = false;
      return;
    }
    if (label.match(/^Weighted average shares outstanding/i)) {
      inSharesSection = true;
      inEpsSection = false;
      return;
    }

    const values = extractValues($, row);
    if (values.length === 0) return;

    // 最初の値（当四半期列）を取得
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

    // 株式数セクション内の Basic/Diluted
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

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const financials = {};

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

        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目: revenue=${data.revenue}, netIncome=${data.netIncome}, epsDiluted=${data.epsDiluted}`);
        if (!data.revenue) console.warn(`  ⚠ Revenue が見つかりません`);
        if (!data.netIncome) console.warn(`  ⚠ Net income が見つかりません`);
        if (!data.epsDiluted) console.warn(`  ⚠ Diluted EPS が見つかりません`);
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(financials, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(financials)) {
    for (const q of Object.keys(financials[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のデータを抽出`);
}

main();
