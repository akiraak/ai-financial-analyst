// Alphabet press-release.htm から損益計算書（GAAP P/L）データを抽出するスクリプト
// 各プレスリリースには「Quarter Ended」の2四半期分データ（当期Q + 前年同期Q）が含まれる
// 入力: companies/alphabet/filings/FY*/Q*/press-release.htm（24四半期分、FY2020〜FY2025）
// 出力: companies/alphabet/data/financials.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'financials.json');

// 四半期末月からQマッピング（暦年＝会計年度）
const MONTH_TO_QUARTER = {
  'march': 'Q1',
  'june': 'Q2',
  'september': 'Q3',
  'december': 'Q4',
};

// 抽出対象の行ラベルとマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Revenues$/i], key: 'revenue' },
  { patterns: [/^Cost of revenues$/i], key: 'costOfRevenue' },
  { patterns: [/^Research and development$/i], key: 'researchAndDevelopment' },
  { patterns: [/^Sales and marketing$/i], key: 'salesAndMarketing' },
  { patterns: [/^General and administrative$/i], key: 'generalAndAdministrative' },
  { patterns: [/^Total costs and expenses$/i], key: 'totalCostsAndExpenses' },
  { patterns: [/^Income from operations$/i], key: 'operatingIncome' },
  { patterns: [/^Other income \(expense\),?\s*net$/i], key: 'otherIncomeExpense' },
  { patterns: [/^Income before income taxes$/i], key: 'incomeBeforeTax' },
  { patterns: [/^Provision for income taxes$/i], key: 'incomeTaxExpense' },
  { patterns: [/^Net income$/i], key: 'netIncome' },
];

// EPS・株式数行のパターン（ラベルが多様なため複数パターン対応）
const EPS_BASIC_PATTERNS = [
  /^Basic net income per share$/i,
  /^Basic earnings per share/i,
];
const EPS_DILUTED_PATTERNS = [
  /^Diluted net income per share$/i,
  /^Diluted earnings per share/i,
];
const SHARES_BASIC_PATTERN = /^Number of shares used in basic/i;
const SHARES_DILUTED_PATTERN = /^Number of shares used in diluted/i;

// スキップする非標準行
const SKIP_PATTERNS = [
  /^European Commission fine/i,
  /^Alphabet.level activities/i,
];

/**
 * テキストから数値をパース
 * "(1,234)" → -1234, "57,006" → 57006, "1.30" → 1.30
 * "-" / "—" / 空 → null
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
 * cheerioで読み込んだテーブルからP/Lテーブルを特定する
 * 条件: "Revenues" 行があり、その後に "Costs and expenses" 行がある
 */
function findPLTable($) {
  const tables = $('table');
  let plTable = null;

  tables.each((ti, table) => {
    if (plTable) return;

    const rows = $(table).find('tr');
    let foundRevenues = false;
    let foundCostsAfterRevenues = false;

    rows.each((ri, row) => {
      const label = getRowLabel($, row);
      if (!label) return;

      if (/^Revenues$/i.test(label)) {
        foundRevenues = true;
      }
      // "Revenues" の後に "Costs and expenses:" または "Cost of revenues" が出現するか
      if (foundRevenues && (/Costs and expenses/i.test(label) || /^Cost of revenues$/i.test(label))) {
        foundCostsAfterRevenues = true;
        return false; // break
      }
    });

    if (foundRevenues && foundCostsAfterRevenues) {
      plTable = $(table);
    }
  });

  return plTable;
}

/**
 * テーブルのヘッダー行を解析して列構造を判定する
 * 戻り値: { quarterColumns: [{year, colIndex}], annualColumns: [{year, colIndex}], quarter: 'Q1'|'Q2'|'Q3'|'Q4' }
 */
function parseHeaders($, table) {
  const rows = table.find('tr');
  let headerText = '';
  let yearRow = null;
  let quarter = null;

  // ヘッダー行を探索（最初の数行）
  rows.each((i, row) => {
    if (i > 5) return false; // ヘッダーは最初の数行に限定

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
        headerText = text;
      }
    });
  });

  // 年を含むヘッダー行を探索
  const years = [];
  rows.each((i, row) => {
    if (i > 5) return false;

    const cells = $(row).find('td');
    const rowYears = [];
    cells.each((ci, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').trim();
      const style = ($(cell).attr('style') || '').toLowerCase();
      const yearMatch = text.match(/^(20\d{2})$/);

      if (yearMatch && style.includes('text-align:center')) {
        rowYears.push(parseInt(yearMatch[1]));
      }
    });

    // 年が2つ以上ある行をヘッダーとする
    if (rowYears.length >= 2 && years.length === 0) {
      years.push(...rowYears);
    }
  });

  // 列構造: [先年Q, 当年Q, 先年Annual/YTD, 当年Annual/YTD]
  // Q列は最初の2つ、年次/YTD列は後の2つ
  const result = {
    quarter,
    quarterYears: years.slice(0, 2),  // [先年, 当年]
    hasAnnualColumns: years.length >= 4,
  };

  return result;
}

/**
 * 行のラベルテキストを取得
 * 左寄せ・colspan>=2 のセルからテキストを抽出
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
      // 数値のみ・"$"のみ・"(unaudited)"のみのセルはスキップ
      if (!text.match(/^[\$\d,.\-()\s\u2014\u2013]+$/) && text !== '$' && !/^\(unaudited\)$/i.test(text)) {
        // &#58; (コロン) はHTMLエンティティで表現されている場合がある
        label = text.replace(/&#58;/g, ':');
      }
    }
  });

  return label;
}

/**
 * テーブル行から右寄せの数値セルを抽出
 * "$" セルはスキップし、数値のみのセルを取得
 * 戻り値: 全データ列の数値配列 [先年Q値, 当年Q値, 先年Annual値, 当年Annual値]
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
      // "$"のみ、空、ダッシュのみのセルはスキップ
      if (text === '$' || text === '') return;
      values.push(text);
    }
  });

  return values;
}

/**
 * 数値配列からQ列の値のみ取得
 * テーブル構造: [先年Q値, 空セル, 当年Q値, 空セル, 先年Annual値, 空セル, 当年Annual値, 空セル]
 * ただし空セルは既にフィルタされているので、実際は [先年Q値, 当年Q値, (先年Annual値, 当年Annual値)]
 * → 最初の2つがQ列
 */
function extractQuarterValues(allValues) {
  // 空文字列をフィルタ（"" のセル）
  const nonEmpty = allValues.filter(v => v !== '');

  // 数値に変換して非null値だけ取得
  const parsed = nonEmpty.map(v => parseNumber(v));

  // 最初の2つが先年Q・当年Q
  return {
    priorYear: parsed.length > 0 ? parsed[0] : null,
    currentYear: parsed.length > 1 ? parsed[1] : null,
  };
}

/**
 * 1つのプレスリリースから2四半期分のP/Lデータを抽出
 * 戻り値: { priorYear: {year, quarter, data}, currentYear: {year, quarter, data} }
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);

  // P/Lテーブルを特定
  const plTable = findPLTable($);
  if (!plTable) {
    console.warn(`  警告: ${fy}/${q} - P/Lテーブルが見つかりません`);
    return null;
  }

  // ヘッダーから列構造を解析
  const headers = parseHeaders($, plTable);
  if (!headers.quarter || headers.quarterYears.length < 2) {
    console.warn(`  警告: ${fy}/${q} - ヘッダー解析に失敗（quarter=${headers.quarter}, years=${headers.quarterYears}）`);
    return null;
  }

  const priorYearNum = headers.quarterYears[0];
  const currentYearNum = headers.quarterYears[1];

  // 先年・当年のデータオブジェクト
  const priorData = {};
  const currentData = {};

  // テーブル行を走査してデータ抽出
  const rows = plTable.find('tr');
  rows.each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // スキップ対象の行
    if (SKIP_PATTERNS.some(p => p.test(label))) return;

    const allValues = extractAllValues($, row);
    if (allValues.length === 0) return;

    const qValues = extractQuarterValues(allValues);

    // 通常の行マッピング
    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in priorData)) priorData[mapping.key] = qValues.priorYear;
        if (!(mapping.key in currentData)) currentData[mapping.key] = qValues.currentYear;
        return; // break out of mapping loop
      }
    }

    // EPS Basic
    if (EPS_BASIC_PATTERNS.some(p => p.test(label))) {
      if (!('epsBasic' in priorData)) priorData.epsBasic = qValues.priorYear;
      if (!('epsBasic' in currentData)) currentData.epsBasic = qValues.currentYear;
      return;
    }

    // EPS Diluted
    if (EPS_DILUTED_PATTERNS.some(p => p.test(label))) {
      if (!('epsDiluted' in priorData)) priorData.epsDiluted = qValues.priorYear;
      if (!('epsDiluted' in currentData)) currentData.epsDiluted = qValues.currentYear;
      return;
    }

    // 発行済株式数 Basic
    if (SHARES_BASIC_PATTERN.test(label)) {
      if (!('sharesBasic' in priorData)) priorData.sharesBasic = qValues.priorYear;
      if (!('sharesBasic' in currentData)) currentData.sharesBasic = qValues.currentYear;
      return;
    }

    // 発行済株式数 Diluted
    if (SHARES_DILUTED_PATTERN.test(label)) {
      if (!('sharesDiluted' in priorData)) priorData.sharesDiluted = qValues.priorYear;
      if (!('sharesDiluted' in currentData)) currentData.sharesDiluted = qValues.currentYear;
      return;
    }
  });

  // 計算フィールド: grossProfit, totalOpex
  for (const data of [priorData, currentData]) {
    if (data.revenue != null && data.costOfRevenue != null) {
      data.grossProfit = data.revenue - data.costOfRevenue;
    }
    if (data.researchAndDevelopment != null && data.salesAndMarketing != null && data.generalAndAdministrative != null) {
      data.totalOpex = data.researchAndDevelopment + data.salesAndMarketing + data.generalAndAdministrative;
    }
  }

  return {
    priorYear: { year: priorYearNum, quarter: headers.quarter, data: priorData },
    currentYear: { year: currentYearNum, quarter: headers.quarter, data: currentData },
  };
}

/**
 * FY/Q キーを生成
 */
function toFYKey(year) {
  return `FY${year}`;
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
      const prPath = path.join(fyPath, q, 'press-release.htm');
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.htm が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const result = extractFromFile(prPath, fy, q);
      if (!result) continue;

      // 各四半期データを格納（新しいデータで上書き）
      for (const entry of [result.priorYear, result.currentYear]) {
        const { year, quarter, data } = entry;

        // FY2020未満はスキップ（先年比較データ）
        if (year < 2020) {
          console.log(`  → FY${year}/${quarter} はスキップ（2020年未満）`);
          continue;
        }

        const fyKey = toFYKey(year);
        if (!financials[fyKey]) financials[fyKey] = {};

        // 抽出項目数の表示
        const keys = Object.keys(data);
        const isNew = !(quarter in financials[fyKey]);
        financials[fyKey][quarter] = data;
        console.log(`  → ${fyKey}/${quarter}: ${keys.length} 項目${isNew ? '（新規）' : '（更新）'}`);

        // 重要フィールドの欠落警告
        if (!data.revenue) console.warn(`    ⚠ Revenue が見つかりません`);
        if (!data.netIncome) console.warn(`    ⚠ Net income が見つかりません`);
        if (!data.epsDiluted) console.warn(`    ⚠ Diluted EPS が見つかりません`);
      }
    }
  }

  // Q キーをソートして出力
  const sortedFinancials = {};
  const fyKeys = Object.keys(financials).sort();
  for (const fy of fyKeys) {
    sortedFinancials[fy] = {};
    const qKeys = Object.keys(financials[fy]).sort();
    for (const q of qKeys) {
      sortedFinancials[fy][q] = financials[fy][q];
    }
  }

  // JSON出力
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sortedFinancials, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(sortedFinancials)) {
    for (const q of Object.keys(sortedFinancials[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のデータを抽出`);

  // データ検証: 全四半期の主要フィールドチェック
  console.log('\n--- データ検証 ---');
  for (const fy of fyKeys) {
    for (const q of Object.keys(sortedFinancials[fy]).sort()) {
      const d = sortedFinancials[fy][q];
      const missing = [];
      const expectedKeys = [
        'revenue', 'costOfRevenue', 'grossProfit',
        'researchAndDevelopment', 'salesAndMarketing', 'generalAndAdministrative', 'totalOpex',
        'operatingIncome', 'otherIncomeExpense', 'incomeBeforeTax', 'incomeTaxExpense', 'netIncome',
        'epsBasic', 'epsDiluted', 'sharesBasic', 'sharesDiluted'
      ];
      for (const key of expectedKeys) {
        if (d[key] == null) missing.push(key);
      }
      if (missing.length > 0) {
        console.warn(`  ${fy}/${q}: 欠落フィールド: ${missing.join(', ')}`);
      } else {
        console.log(`  ${fy}/${q}: OK (Revenue=${d.revenue}, NetIncome=${d.netIncome}, EPS=${d.epsDiluted})`);
      }
    }
  }
}

main();
