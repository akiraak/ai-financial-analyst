// Tesla 生成されたxlsxの数値検証スクリプト
// financials.json / stock-prices.json との突合

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const XLSX_PATH = path.join(DATA_DIR, 'Financials.xlsx');
const FINANCIALS_PATH = path.join(DATA_DIR, 'financials.json');
const STOCK_PRICES_PATH = path.join(DATA_DIR, 'stock-prices.json');

// === 行レイアウト定義（generate-xlsx.js と同一） ===
const ROW = {
  AUTO_SALES:       3,   // Automotive Sales（車両販売）
  REG_CREDITS:      4,   // Regulatory Credits（排出権クレジット）
  AUTO_LEASING:     5,   // Automotive Leasing（リース）
  AUTO_TOTAL:       6,   // Total Automotive Revenue
  ENERGY:           7,   // Energy Generation & Storage
  SERVICES:         8,   // Services & Other
  REVENUE:          9,   // 総売上高
  COST_OF_REV:     12,   // 売上原価
  GROSS_PROFIT:    13,   // 粗利益
  RND:             16,   // R&D
  SGA:             18,   // SGA
  RESTRUCTURING:   20,   // リストラクチャリング費用
  OPEX_TOTAL:      21,   // 営業費用合計
  OP_INCOME:       24,   // 営業利益
  INT_INCOME:      27,   // 受取利息
  INT_EXPENSE:     28,   // 支払利息
  OTHER_INCOME:    29,   // その他営業外損益
  PRETAX_INCOME:   30,   // 税引前利益
  TAX:             31,   // 法人税等
  NET_INCOME:      32,   // 純利益
  EPS_BASIC:       35,   // EPS（基本）
  EPS_DILUTED:     36,   // EPS（希薄化後）
  SHARES_BASIC:    37,   // 発行済株式数（基本）
  SHARES_DILUTED:  38,   // 発行済株式数（希薄化後）
  STOCK_PRICE:     39,   // 四半期末株価
};

// Automotive Leasing を計算（generate-xlsx.js と同一ロジック）
function getAutomotiveLeasing(d) {
  if (d.automotiveRevenue != null && d.automotiveSales != null) {
    return d.automotiveRevenue - d.automotiveSales - (d.regulatoryCredits || 0);
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
  const ws = wb.getWorksheet('TSLA業績');

  if (!ws) {
    console.error('エラー: シート「TSLA業績」が見つかりません');
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

    // Automotive Leasing の計算（generate-xlsx.js と同一ロジック）
    const leasing = getAutomotiveLeasing(d);

    // 検証項目の定義
    const checks = [
      { row: ROW.AUTO_SALES,     name: 'Automotive Sales',     expected: d.automotiveSales },
      { row: ROW.REG_CREDITS,    name: 'Regulatory Credits',   expected: d.regulatoryCredits },
      { row: ROW.AUTO_LEASING,   name: 'Automotive Leasing',   expected: leasing },
      { row: ROW.AUTO_TOTAL,     name: 'Total Automotive',     expected: d.automotiveRevenue },
      { row: ROW.ENERGY,         name: 'Energy',               expected: d.energyRevenue },
      { row: ROW.SERVICES,       name: 'Services & Other',     expected: d.servicesRevenue },
      { row: ROW.REVENUE,        name: '売上高',               expected: d.revenue },
      { row: ROW.COST_OF_REV,    name: '売上原価',             expected: d.costOfRevenue },
      { row: ROW.GROSS_PROFIT,   name: '粗利益',               expected: d.grossProfit },
      { row: ROW.RND,            name: 'R&D',                  expected: d.researchAndDevelopment },
      { row: ROW.SGA,            name: 'SGA',                  expected: d.sga },
      { row: ROW.RESTRUCTURING,  name: 'リストラクチャリング', expected: d.restructuring },
      { row: ROW.OPEX_TOTAL,     name: '営業費用合計',         expected: d.totalOperatingExpenses },
      { row: ROW.OP_INCOME,      name: '営業利益',             expected: d.operatingIncome },
      { row: ROW.INT_INCOME,     name: '受取利息',             expected: d.interestIncome },
      { row: ROW.INT_EXPENSE,    name: '支払利息',             expected: d.interestExpense },
      { row: ROW.OTHER_INCOME,   name: 'その他営業外損益',     expected: d.otherIncomeNet },
      { row: ROW.PRETAX_INCOME,  name: '税引前利益',           expected: d.incomeBeforeTax },
      { row: ROW.TAX,            name: '法人税等',             expected: d.incomeTaxExpense },
      { row: ROW.NET_INCOME,     name: '純利益',               expected: d.netIncome },
      { row: ROW.EPS_BASIC,      name: 'EPS(基本)',            expected: d.epsBasic,       tolerance: 0.01 },
      { row: ROW.EPS_DILUTED,    name: 'EPS(希薄化後)',        expected: d.epsDiluted,     tolerance: 0.01 },
      { row: ROW.SHARES_BASIC,   name: '発行済株式数(基本)',   expected: d.sharesBasic },
      { row: ROW.SHARES_DILUTED, name: '発行済株式数(希薄化後)', expected: d.sharesDiluted },
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
  console.log(`\n検証結果サマリー:`);
  console.log(`- 対象: Financials.xlsx`);
  console.log(`- 四半期数: ${quarters.length}`);
  console.log(`- リテラル値: ${totalChecks}項目中 ${okCount}一致 / ${ngCount}不一致`);
  console.log(`- 判定: ${ngCount === 0 ? 'OK' : 'NG'}`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
