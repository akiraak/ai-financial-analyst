// Alphabet (GOOGL) 生成されたxlsxの数値検証スクリプト
// financials.json / stock-prices.json との突合

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const XLSX_PATH = path.join(DATA_DIR, 'Financials.xlsx');
const FINANCIALS_PATH = path.join(DATA_DIR, 'financials.json');
const STOCK_PRICES_PATH = path.join(DATA_DIR, 'stock-prices.json');

// === 行レイアウト定義（generate-xlsx.js の実際の出力に合わせる） ===
const ROW = {
  REVENUE:         10,   // 売上高 (Total Revenue)
  GROSS_PROFIT:    14,   // 粗利益
  RND:             17,   // R&D（研究開発費）
  SGA:             19,   // SGA (Sales&Marketing + G&A)
  OPEX_TOTAL:      22,   // 営業費用合計
  OP_INCOME:       25,   // 営業利益
  NON_OP_INCOME:   28,   // その他営業外損益
  NET_INCOME:      31,   // 純利益
  EPS:             35,   // EPS（希薄化後）
  SHARES:          37,   // 発行済株式数（希薄化後）
  STOCK_PRICE:     38,   // 四半期末株価
};

// SGA を計算（salesAndMarketing + generalAndAdministrative）
function getSGA(d) {
  const sm = d.salesAndMarketing || 0;
  const ga = d.generalAndAdministrative || 0;
  if (sm || ga) return sm + ga;
  return null;
}

// 営業外収支の取得（otherIncomeExpense フィールドを使用）
function getNonOperatingIncome(d) {
  if (d.otherIncomeExpense != null) return d.otherIncomeExpense;
  // フォールバック: 税引前利益 − 営業利益 で計算
  if (d.incomeBeforeTax != null && d.operatingIncome != null) {
    return d.incomeBeforeTax - d.operatingIncome;
  }
  return null;
}

// セルの実際の値を取得（数式の場合は result を取得）
function getCellValue(cell) {
  if (cell.value == null) return null;
  if (typeof cell.value === 'object' && cell.value.result !== undefined) {
    return cell.value.result;
  }
  return cell.value;
}

async function main() {
  // データ読み込み
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = JSON.parse(fs.readFileSync(STOCK_PRICES_PATH, 'utf-8'));

  // xlsx読み込み
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet('GOOGL業績');

  if (!ws) {
    console.error('エラー: シート「GOOGL業績」が見つかりません');
    process.exit(1);
  }

  // 表示範囲を自動判定
  const fyKeys = Object.keys(financials).map(k => parseInt(k.replace('FY', ''))).sort((a, b) => a - b);
  const startFY = fyKeys[0];
  const endFY = fyKeys[fyKeys.length - 1];
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

  // 四半期一覧を構築（B=2列始まり）
  const quarters = [];
  for (let fy = startFY; fy <= endFY; fy++) {
    for (const q of QUARTERS) {
      quarters.push({ fy, q, fyStr: `FY${fy}`, col: quarters.length + 2 });
    }
  }

  let okCount = 0;
  let ngCount = 0;
  const errors = [];

  console.log('=== リテラル値の検証 ===\n');

  for (const { fyStr, q, col } of quarters) {
    const d = financials[fyStr]?.[q];
    const sp = stockPrices[fyStr]?.[q];
    if (!d) continue;

    // SGA の計算（salesAndMarketing + generalAndAdministrative）
    const sga = getSGA(d);

    // 営業費用合計（R&D + SGA）
    const opexTotal = d.totalOpex != null ? d.totalOpex : null;

    // 検証項目の定義
    const checks = [
      { row: ROW.REVENUE,        name: '売上高',               expected: d.revenue },
      { row: ROW.GROSS_PROFIT,   name: '粗利益',               expected: d.grossProfit },
      { row: ROW.RND,            name: 'R&D',                  expected: d.researchAndDevelopment },
      { row: ROW.SGA,            name: 'SGA',                  expected: sga },
      { row: ROW.OPEX_TOTAL,     name: '営業費用合計',         expected: opexTotal },
      { row: ROW.OP_INCOME,      name: '営業利益',             expected: d.operatingIncome },
      { row: ROW.NON_OP_INCOME,  name: '営業外収支',           expected: getNonOperatingIncome(d) },
      { row: ROW.NET_INCOME,     name: '純利益',               expected: d.netIncome },
      { row: ROW.EPS,            name: 'EPS(希薄化後)',        expected: d.epsDiluted,     tolerance: 0.01 },
      { row: ROW.SHARES,         name: '発行済株式数(希薄化後)', expected: d.sharesDiluted },
      { row: ROW.STOCK_PRICE,    name: '株価',                 expected: sp?.price,        tolerance: 0.01 },
    ];

    for (const { row, name, expected, tolerance } of checks) {
      if (expected == null) continue;
      const cell = ws.getCell(row, col);
      const actual = getCellValue(cell);

      if (actual == null) {
        errors.push(`${fyStr} ${q} Row${row} ${name}: 期待=${expected}, 実際=空`);
        ngCount++;
        continue;
      }

      const tol = tolerance || 1;
      if (Math.abs(actual - expected) > tol) {
        errors.push(`${fyStr} ${q} Row${row} ${name}: 期待=${expected}, 実際=${actual}`);
        ngCount++;
      } else {
        okCount++;
      }
    }
  }

  // 結果出力
  console.log(`リテラル値: ${okCount}一致 / ${ngCount}不一致\n`);

  if (errors.length > 0) {
    console.log('不一致の詳細:');
    errors.forEach(e => console.log(`  ✗ ${e}`));
  } else {
    console.log('すべてのリテラル値が一致しました ✓');
  }

  // 検証サマリー
  const totalChecks = okCount + ngCount;
  const actualCount = quarters.filter(q => financials[q.fyStr]?.[q.q]?.revenue).length;
  console.log(`\n検証結果サマリー:`);
  console.log(`- 対象: Financials.xlsx`);
  console.log(`- 年度範囲: FY${startFY} ~ FY${endFY}`);
  console.log(`- 四半期数: 実績 ${actualCount}`);
  console.log(`- リテラル値: ${totalChecks}項目中 ${okCount}一致 / ${ngCount}不一致`);
  console.log(`- 判定: ${ngCount === 0 ? 'OK' : 'NG'}`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
