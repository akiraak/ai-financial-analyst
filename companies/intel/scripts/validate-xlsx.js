// Intel 生成されたxlsxの数値検証スクリプト
// financials.json / stock-prices.json との突合

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const XLSX_PATH = path.join(DATA_DIR, 'Financials.xlsx');
const FINANCIALS_PATH = path.join(DATA_DIR, 'financials.json');
const STOCK_PRICES_PATH = path.join(DATA_DIR, 'stock-prices.json');

// Intel は株式分割なし
function adjustEPS(eps) {
  return eps;
}

// 営業外収支の計算（generate-xlsx.jsと同一ロジック）
function getNonOperatingIncome(d) {
  if (d.incomeBeforeTax != null && d.operatingIncome != null) {
    return d.incomeBeforeTax - d.operatingIncome;
  }
  let total = 0;
  if (d.equityInvestmentGains != null) total += d.equityInvestmentGains;
  if (d.interestAndOther != null) total += d.interestAndOther;
  return total;
}

async function main() {
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = JSON.parse(fs.readFileSync(STOCK_PRICES_PATH, 'utf-8'));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet('INTC業績');

  const fyKeys = Object.keys(financials).map(k => parseInt(k.replace('FY', ''))).sort((a, b) => a - b);
  const startFY = fyKeys[0];
  const endFY = fyKeys[fyKeys.length - 1];
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

  const quarters = [];
  for (let fy = startFY; fy <= endFY; fy++) {
    for (const q of QUARTERS) {
      quarters.push({ fy, q, fyStr: `FY${fy}`, col: quarters.length + 2 });
    }
  }

  let literalOk = 0, literalNg = 0;
  const errors = [];

  console.log('=== リテラル値の検証 ===\n');

  for (const { fyStr, q, col } of quarters) {
    const d = financials[fyStr]?.[q];
    const sp = stockPrices[fyStr]?.[q];
    if (!d) continue;

    const checks = [
      { row: 3, name: '売上高', expected: d.revenue },
      { row: 6, name: '粗利', expected: d.grossProfit },
      { row: 9, name: 'R&D', expected: d.researchAndDevelopment },
      { row: 11, name: 'SGA', expected: d.sga },
      { row: 16, name: '営業利益', expected: d.operatingIncome },
      { row: 19, name: '営業外収支', expected: getNonOperatingIncome(d) },
      { row: 20, name: '純利益', expected: d.netIncome },
      { row: 23, name: 'EPS', expected: adjustEPS(d.epsDiluted), tolerance: 0.01 },
      { row: 26, name: '株価', expected: sp?.price, tolerance: 0.01 },
    ];

    for (const { row, name, expected, tolerance } of checks) {
      if (expected == null) continue;
      const cell = ws.getCell(row, col);
      const actual = cell.value != null ? (typeof cell.value === 'object' ? cell.value.result : cell.value) : null;

      if (actual == null) {
        errors.push(`${fyStr} ${q} Row${row} ${name}: 期待=${expected}, 実際=空`);
        literalNg++;
        continue;
      }

      const tol = tolerance || 0;
      if (Math.abs(actual - expected) > tol) {
        errors.push(`${fyStr} ${q} Row${row} ${name}: 期待=${expected}, 実際=${actual}`);
        literalNg++;
      } else {
        literalOk++;
      }
    }
  }

  console.log(`リテラル値: ${literalOk}一致 / ${literalNg}不一致\n`);

  if (errors.length > 0) {
    console.log('不一致の詳細:');
    errors.forEach(e => console.log(`  ✗ ${e}`));
  } else {
    console.log('すべてのリテラル値が一致しました ✓');
  }

  // 検証サマリー
  const totalChecks = literalOk + literalNg;
  console.log(`\n検証結果サマリー:`);
  console.log(`- 対象: Financials.xlsx`);
  console.log(`- 四半期数: ${quarters.length}`);
  console.log(`- リテラル値: ${totalChecks}項目中 ${literalOk}一致 / ${literalNg}不一致`);
  console.log(`- 判定: ${literalNg === 0 ? 'OK' : 'NG'}`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
