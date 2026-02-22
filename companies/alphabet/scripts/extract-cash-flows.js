// Alphabet press-release.htm からキャッシュフローデータを抽出するスクリプト
// 2つのソースを使用:
//   1. CF計算書テーブル (CONSOLIDATED STATEMENTS OF CASH FLOWS): 四半期CF + 年次/YTDデータ
//   2. FCFテーブル (Non-GAAP Free Cash Flow): FCF検証用
//
// CF計算書のヘッダーパターン:
//   Q1: "Quarter Ended March 31," → 2カラム (prior year Q1, current year Q1)
//   Q2: "Quarter Ended June 30," + "Year to Date June 30," → 4カラム (Q, Q, YTD, YTD)
//   Q3: "Quarter Ended September 30," + "Year to Date September 30," → 4カラム
//   Q4: "Quarter Ended December 31," + "Year Ended December 31," → 4カラム (Q, Q, Annual, Annual)
//
// 各PRは2四半期分のCFデータを提供（当期Q + 前年同期Q）
//
// 出力: cash-flows.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'cash-flows.json');

// 四半期末月からQマッピング（暦年＝会計年度）
const MONTH_TO_QUARTER = {
  'march': 'Q1',
  'june': 'Q2',
  'september': 'Q3',
  'december': 'Q4',
};

// CF計算書の抽出対象行ラベル
const CF_ROW_MAPPINGS = [
  { patterns: [/^Net cash provided by operating activities$/i], key: 'operatingCF' },
  { patterns: [/^Depreciation of property and equipment$/i, /^Depreciation and impairment of property and equipment$/i], key: 'depreciation' },
  { patterns: [/^Stock-based compensation expense$/i, /^Stock-based compensation$/i], key: 'stockBasedComp' },
  { patterns: [/^Purchases of property and equipment$/i], key: 'capex' },
];

/**
 * テキストから数値をパース
 * "(1,234)" -> -1234, "57,006" -> 57006, "—" -> null
 */
function parseNumber(text) {
  if (!text) return null;
  let cleaned = text.replace(/[\s\u00a0]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '—' || cleaned === '\u2014' || cleaned === '\u2013') return null;

  // "$" 記号を除去
  cleaned = cleaned.replace(/\$/g, '');

  // 括弧は負数
  let negative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }

  // カンマ除去
  cleaned = cleaned.replace(/,/g, '');

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * 行のラベルテキストを取得
 * 左寄せセル or colspan >= 3 のテキストセルからラベルを抽出
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
    if (!text) return;

    const style = ($cell.attr('style') || '').toLowerCase();
    const colspan = parseInt($cell.attr('colspan') || '1');
    const isLeftAligned = style.includes('text-align:left');

    // ラベルセルの条件: 左寄せ or 大きいcolspan、数値のみでない
    if ((isLeftAligned || colspan >= 3) && !label) {
      if (!text.match(/^[\$\d,.\-()\s\u2014\u2013]+$/) && text !== '$' && !/^\(unaudited\)$/i.test(text)) {
        label = text;
      }
    }
  });

  return label;
}

/**
 * テーブル行から右寄せの数値セルを全て抽出
 * 戻り値: 全データ列の文字列配列
 */
function extractAllValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();
    const isRightAligned = style.includes('text-align:right');

    if (isRightAligned && text) {
      // "$"のみ、空のセルはスキップ
      if (text === '$' || text === '') return;
      values.push(text);
    }
  });

  return values;
}

/**
 * CF計算書テーブルのHTMLを抽出する
 * "CONSOLIDATED STATEMENTS OF CASH FLOWS" をタイトルとして検索
 */
function findCFTableHtml(html) {
  const titleIdx = html.toUpperCase().indexOf('CONSOLIDATED STATEMENTS OF CASH FLOWS');
  if (titleIdx === -1) return null;

  // タイトルがテーブル内にあるか、テーブル外にあるかを判定
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

  // テーブルの終了位置を見つける（ネストに対応）
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
 * CF計算書テーブルのヘッダーを解析して四半期と年を特定する
 * 戻り値: { quarter: 'Q1'|..., quarterYears: [先年, 当年], hasAnnualColumns: boolean }
 */
function parseCFHeaders($) {
  let quarter = null;
  const years = [];

  $('tr').each((i, row) => {
    if (i > 8) return false; // ヘッダーは最初の数行

    const cells = $(row).find('td');
    cells.each((ci, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const style = ($(cell).attr('style') || '').toLowerCase();

      // "Quarter Ended [Month] [Day]," のパターンを検出
      const quarterMatch = text.match(/Quarter\s+Ended\s+(\w+)\s+\d+/i);
      if (quarterMatch) {
        const month = quarterMatch[1].toLowerCase();
        if (MONTH_TO_QUARTER[month]) {
          quarter = MONTH_TO_QUARTER[month];
        }
      }

      // 年の検出
      const yearMatch = text.match(/^(20\d{2})$/);
      if (yearMatch && style.includes('text-align:center')) {
        years.push(parseInt(yearMatch[1]));
      }
    });
  });

  return {
    quarter,
    quarterYears: years.slice(0, 2), // [先年, 当年]
    hasAnnualColumns: years.length >= 4,
  };
}

// 注: Non-GAAP FCF Reconciliation テーブルは使用しない
// 理由: FY2025以降のPRでは複数四半期のカラムを持つため、
//       正しいカラムの特定が困難。FCFはCF計算書の operatingCF + capex で算出する。

/**
 * 1つのプレスリリースからCFデータを抽出
 * 戻り値: [{ year, quarter, data: {...} }, ...]
 */
function extractFromFile(filePath, fileFy, fileQ) {
  const html = fs.readFileSync(filePath, 'utf-8');

  // CF計算書テーブルを抽出
  const cfTableHtml = findCFTableHtml(html);
  if (!cfTableHtml) {
    console.warn(`  警告: ${fileFy}/${fileQ} - CF計算書テーブルが見つかりません`);
    return [];
  }

  const $ = cheerio.load(cfTableHtml);

  // ヘッダー解析
  const headers = parseCFHeaders($);
  if (!headers.quarter || headers.quarterYears.length < 2) {
    console.warn(`  警告: ${fileFy}/${fileQ} - ヘッダー解析失敗（quarter=${headers.quarter}, years=${headers.quarterYears}）`);
    return [];
  }

  const priorYear = headers.quarterYears[0];
  const currentYear = headers.quarterYears[1];

  // 先年・当年のデータオブジェクト
  const priorData = {};
  const currentData = {};

  // テーブル行を走査してデータ抽出
  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    const allValues = extractAllValues($, row);
    if (allValues.length === 0) return;

    // 最初の2つが先年Q・当年Q（残りはYTD/Annual）
    const priorVal = allValues.length > 0 ? parseNumber(allValues[0]) : null;
    const currentVal = allValues.length > 1 ? parseNumber(allValues[1]) : null;

    for (const mapping of CF_ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in priorData) && priorVal !== null) priorData[mapping.key] = priorVal;
        if (!(mapping.key in currentData) && currentVal !== null) currentData[mapping.key] = currentVal;
        break;
      }
    }
  });

  // Free Cash Flow を計算: operatingCF + capex（capexは負値）
  for (const data of [priorData, currentData]) {
    if (data.operatingCF != null && data.capex != null) {
      data.freeCashFlow = data.operatingCF + data.capex;
    }
  }

  const results = [];

  // 先年データ
  if (Object.keys(priorData).length > 0) {
    results.push({ year: priorYear, quarter: headers.quarter, data: priorData });
  }
  // 当年データ
  if (Object.keys(currentData).length > 0) {
    results.push({ year: currentYear, quarter: headers.quarter, data: currentData });
  }

  return results;
}

// メイン処理
function main() {
  const cashFlows = {};

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
      const prPath = path.join(fyPath, q, 'press-release.htm');
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.htm が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const results = extractFromFile(prPath, fy, q);

      for (const { year, quarter, data } of results) {
        // FY2020未満はスキップ
        if (year < 2020) {
          console.log(`  → FY${year}/${quarter} はスキップ（2020年未満）`);
          continue;
        }

        const fyKey = `FY${year}`;
        if (!cashFlows[fyKey]) cashFlows[fyKey] = {};

        // 新しいデータで上書き
        const isNew = !(quarter in cashFlows[fyKey]);
        cashFlows[fyKey][quarter] = data;
        const keys = Object.keys(data);
        console.log(`  → ${fyKey}/${quarter}: ${keys.length} 項目${isNew ? '（新規）' : '（更新）'}: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
      }
    }
  }

  // FY/Qをソートして出力
  const sorted = {};
  for (const fy of Object.keys(cashFlows).sort()) {
    sorted[fy] = {};
    for (const q of Object.keys(cashFlows[fy]).sort()) {
      sorted[fy][q] = cashFlows[fy][q];
    }
  }

  // 出力先ディレクトリが存在しない場合は作成
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(sorted)) {
    for (const q of Object.keys(sorted[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のCFデータを抽出`);

  // データ検証
  console.log('\n--- データ検証 ---');
  for (const fy of Object.keys(sorted).sort()) {
    for (const q of Object.keys(sorted[fy]).sort()) {
      const d = sorted[fy][q];
      const missing = [];
      const expectedKeys = ['operatingCF', 'depreciation', 'stockBasedComp', 'capex', 'freeCashFlow'];
      for (const key of expectedKeys) {
        if (d[key] == null) missing.push(key);
      }
      if (missing.length > 0) {
        console.warn(`  ${fy}/${q}: 欠落フィールド: ${missing.join(', ')}`);
      } else {
        console.log(`  ${fy}/${q}: OK (OCF=${d.operatingCF}, Capex=${d.capex}, FCF=${d.freeCashFlow})`);
      }
    }
  }
}

main();
