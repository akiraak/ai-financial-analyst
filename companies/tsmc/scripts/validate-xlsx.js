// 生成されたFinancials.xlsxの数値をfinancials.jsonと照合検証するスクリプト
// P/Lリテラル値・株価・EPS の一致を確認する

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const XLSX_PATH = path.join(DATA_DIR, 'Financials.xlsx');
const FINANCIALS_PATH = path.join(DATA_DIR, 'financials.json');
const STOCK_PRICES_PATH = path.join(DATA_DIR, 'stock-prices.json');

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

// 行定義（generate-xlsx.jsと一致させる）
const ROWS = {
  revenue: 3,
  grossProfit: 6,
  operatingExpenses: 9,
  operatingIncome: 11,
  nonOperatingIncome: 14,
  netIncome: 15,
  eps: 18,
  epsADR: 19,
  stockPrice: 20,
};

async function main() {
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = JSON.parse(fs.readFileSync(STOCK_PRICES_PATH, 'utf-8'));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet('TSM業績');

  if (!ws) {
    console.error('シート「TSM業績」が見つかりません');
    process.exit(1);
  }

  const fyKeys = Object.keys(financials).map(k => parseInt(k.replace('FY', ''))).sort((a, b) => a - b);
  const startFY = fyKeys[0];
  const endFY = fyKeys[fyKeys.length - 1];

  let matchCount = 0;
  let mismatchCount = 0;
  const errors = [];

  function check(label, expected, actual, tolerance = 0.01) {
    if (expected == null && actual == null) return;
    if (expected == null || actual == null) {
      errors.push(`${label}: expected=${expected}, actual=${actual}`);
      mismatchCount++;
      return;
    }
    const cellValue = typeof actual === 'object' && actual.result != null ? actual.result : actual;
    if (typeof cellValue !== 'number') {
      errors.push(`${label}: expected=${expected}, actual=${cellValue} (非数値)`);
      mismatchCount++;
      return;
    }
    const diff = Math.abs(cellValue - expected);
    const relDiff = expected !== 0 ? diff / Math.abs(expected) : diff;
    if (relDiff > tolerance) {
      errors.push(`${label}: expected=${expected}, actual=${cellValue} (差=${diff.toFixed(2)})`);
      mismatchCount++;
    } else {
      matchCount++;
    }
  }

  for (let fy = startFY; fy <= endFY; fy++) {
    for (const q of QUARTERS) {
      const fyStr = `FY${fy}`;
      const d = financials[fyStr]?.[q];
      if (!d) continue;

      const col = (fy - startFY) * 4 + QUARTERS.indexOf(q) + 2;
      const qLabel = `${fyStr}/${q}`;

      // P/Lデータ検証
      check(`${qLabel} 売上高`, d.revenue, ws.getCell(ROWS.revenue, col).value);
      check(`${qLabel} 粗利益`, d.grossProfit, ws.getCell(ROWS.grossProfit, col).value);
      check(`${qLabel} 営業費用`, d.operatingExpenses, ws.getCell(ROWS.operatingExpenses, col).value);
      check(`${qLabel} 営業利益`, d.operatingIncome, ws.getCell(ROWS.operatingIncome, col).value);
      check(`${qLabel} 営業外収支`, d.nonOperatingIncome, ws.getCell(ROWS.nonOperatingIncome, col).value);
      check(`${qLabel} 純利益`, d.netIncome, ws.getCell(ROWS.netIncome, col).value);
      check(`${qLabel} EPS`, d.eps, ws.getCell(ROWS.eps, col).value);
      if (d.epsADR) {
        check(`${qLabel} ADR EPS`, d.epsADR, ws.getCell(ROWS.epsADR, col).value);
      }

      // 株価検証
      const price = stockPrices[fyStr]?.[q]?.price;
      if (price != null) {
        check(`${qLabel} 株価`, price, ws.getCell(ROWS.stockPrice, col).value);
      }
    }
  }

  console.log(`\n=== 検証結果 ===`);
  console.log(`一致: ${matchCount}`);
  console.log(`不一致: ${mismatchCount}`);
  if (errors.length > 0) {
    console.log(`\n不一致の詳細:`);
    errors.forEach(e => console.log(`  ✗ ${e}`));
  } else {
    console.log(`\nすべての値が一致しました ✓`);
  }
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
