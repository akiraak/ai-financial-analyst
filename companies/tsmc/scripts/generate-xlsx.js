// financials.json + stock-prices.json のデータからFinancials.xlsxを生成するスクリプト
// TSMCはテンプレートなしでExcelJSで書式付きxlsxを生成する
// 通貨: NT$ million（EPSはNT$、ADR EPS/株価はUSD）

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FINANCIALS_PATH = path.join(DATA_DIR, 'financials.json');
const STOCK_PRICES_PATH = path.join(DATA_DIR, 'stock-prices.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'Financials.xlsx');

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

// Excel列文字（1-based: 1=A, 2=B, ...）
function CL(col) {
  let s = '';
  while (col > 0) { col--; s = String.fromCharCode(65 + (col % 26)) + s; col = Math.floor(col / 26); }
  return s;
}

// 行定義
const ROWS = {
  fyHeader: 1,
  qHeader: 2,
  revenue: 3,
  revenueQoQ: 4,
  revenueYoY: 5,
  grossProfit: 6,
  grossMargin: 7,
  grossProfitYoY: 8,
  operatingExpenses: 9,
  opexRatio: 10,
  operatingIncome: 11,
  operatingMargin: 12,
  operatingIncomeYoY: 13,
  nonOperatingIncome: 14,
  netIncome: 15,
  netMargin: 16,
  netIncomeYoY: 17,
  eps: 18,
  epsADR: 19,
  stockPrice: 20,
  per: 21,
  perAvg: 22,
};

// 行ラベル
const ROW_LABELS = {
  [ROWS.revenue]: '売上高 (NT$M)',
  [ROWS.revenueQoQ]: '  前期比',
  [ROWS.revenueYoY]: '  前年比',
  [ROWS.grossProfit]: '粗利益 (NT$M)',
  [ROWS.grossMargin]: '  粗利率',
  [ROWS.grossProfitYoY]: '  前年比',
  [ROWS.operatingExpenses]: '営業費用 (NT$M)',
  [ROWS.opexRatio]: '  売上比',
  [ROWS.operatingIncome]: '営業利益 (NT$M)',
  [ROWS.operatingMargin]: '  営業利益率',
  [ROWS.operatingIncomeYoY]: '  前年比',
  [ROWS.nonOperatingIncome]: '営業外収支 (NT$M)',
  [ROWS.netIncome]: '純利益 (NT$M)',
  [ROWS.netMargin]: '  純利益率',
  [ROWS.netIncomeYoY]: '  前年比',
  [ROWS.eps]: 'EPS (NT$)',
  [ROWS.epsADR]: 'ADR EPS (US$)',
  [ROWS.stockPrice]: '株価 ADR (US$)',
  [ROWS.per]: 'PER (倍)',
  [ROWS.perAvg]: 'PER 4Q平均',
};

// パーセント行
const PCT_ROWS = [ROWS.revenueQoQ, ROWS.revenueYoY, ROWS.grossMargin, ROWS.grossProfitYoY,
  ROWS.opexRatio, ROWS.operatingMargin, ROWS.operatingIncomeYoY, ROWS.netMargin, ROWS.netIncomeYoY];

async function main() {
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = JSON.parse(fs.readFileSync(STOCK_PRICES_PATH, 'utf-8'));

  // 表示範囲をfinancials.jsonから自動判定
  const fyKeys = Object.keys(financials).map(k => parseInt(k.replace('FY', ''))).sort((a, b) => a - b);
  const DISPLAY_START_FY = fyKeys[0];
  const DISPLAY_END_FY = fyKeys[fyKeys.length - 1];

  const quarters = [];
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    for (const q of QUARTERS) {
      quarters.push({ fy, q, fyStr: `FY${fy}`, col: quarters.length + 2 }); // B=2 始まり
    }
  }

  // ワークブック作成
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('TSM業績');

  // 列幅設定
  ws.getColumn(1).width = 22;
  for (let i = 2; i <= quarters.length + 1; i++) {
    ws.getColumn(i).width = 13;
  }

  // 行ラベル設定
  for (const [row, label] of Object.entries(ROW_LABELS)) {
    const cell = ws.getCell(parseInt(row), 1);
    cell.value = label;
    cell.font = { name: 'Arial', size: 9, bold: !label.startsWith('  ') };
  }

  // パーセント行のフォーマット設定
  for (const row of PCT_ROWS) {
    for (let col = 2; col <= quarters.length + 1; col++) {
      ws.getCell(row, col).numFmt = '0.0%';
    }
  }

  // EPS行フォーマット
  for (let col = 2; col <= quarters.length + 1; col++) {
    ws.getCell(ROWS.eps, col).numFmt = '#,##0.00';
    ws.getCell(ROWS.epsADR, col).numFmt = '#,##0.00';
    ws.getCell(ROWS.stockPrice, col).numFmt = '#,##0.00';
    ws.getCell(ROWS.per, col).numFmt = '#,##0.0';
    ws.getCell(ROWS.perAvg, col).numFmt = '#,##0.0';
    ws.getCell(ROWS.revenue, col).numFmt = '#,##0';
    ws.getCell(ROWS.grossProfit, col).numFmt = '#,##0';
    ws.getCell(ROWS.operatingExpenses, col).numFmt = '#,##0';
    ws.getCell(ROWS.operatingIncome, col).numFmt = '#,##0';
    ws.getCell(ROWS.nonOperatingIncome, col).numFmt = '#,##0';
    ws.getCell(ROWS.netIncome, col).numFmt = '#,##0';
  }

  // 年度ヘッダー
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    const startCol = (fy - DISPLAY_START_FY) * 4 + 2;
    const cell = ws.getCell(ROWS.fyHeader, startCol);
    cell.value = fy;
    cell.font = { name: 'Arial', size: 10, bold: true };
  }

  // 四半期ラベル
  quarters.forEach(({ q, col }) => {
    const cell = ws.getCell(ROWS.qHeader, col);
    cell.value = q;
    cell.font = { name: 'Arial', size: 9 };
    cell.alignment = { horizontal: 'center' };
  });

  // データと数式を設定
  quarters.forEach(({ fyStr, q, col }, i) => {
    const c = CL(col);
    const pc = i > 0 ? CL(col - 1) : null;
    const yc = i >= 4 ? CL(col - 4) : null;
    const d = financials[fyStr]?.[q];
    const price = stockPrices[fyStr]?.[q]?.price;

    if (d) {
      ws.getCell(ROWS.revenue, col).value = d.revenue;
      ws.getCell(ROWS.grossProfit, col).value = d.grossProfit;
      ws.getCell(ROWS.operatingExpenses, col).value = d.operatingExpenses;
      ws.getCell(ROWS.operatingIncome, col).value = d.operatingIncome;
      ws.getCell(ROWS.nonOperatingIncome, col).value = d.nonOperatingIncome;
      ws.getCell(ROWS.netIncome, col).value = d.netIncome;
      ws.getCell(ROWS.eps, col).value = d.eps;
      if (d.epsADR) ws.getCell(ROWS.epsADR, col).value = d.epsADR;
      if (price != null) ws.getCell(ROWS.stockPrice, col).value = price;
    }

    // 比率・成長率の数式
    const R = ROWS;

    // 前期比 = 今期売上 / 前期売上
    if (pc) ws.getCell(R.revenueQoQ, col).value = { formula: `${c}${R.revenue}/${pc}${R.revenue}` };

    // 前年比
    if (yc) ws.getCell(R.revenueYoY, col).value = { formula: `${c}${R.revenue}/${yc}${R.revenue}` };

    // 粗利率
    if (d) ws.getCell(R.grossMargin, col).value = { formula: `${c}${R.grossProfit}/${c}${R.revenue}` };

    // 粗利前年比
    if (yc) ws.getCell(R.grossProfitYoY, col).value = { formula: `${c}${R.grossProfit}/${yc}${R.grossProfit}` };

    // 営業費用 売上比
    ws.getCell(R.opexRatio, col).value = { formula: `${c}${R.operatingExpenses}/${c}${R.revenue}` };

    // 営業利益率
    ws.getCell(R.operatingMargin, col).value = { formula: `${c}${R.operatingIncome}/${c}${R.revenue}` };

    // 営業利益前年比
    if (yc) ws.getCell(R.operatingIncomeYoY, col).value = { formula: `${c}${R.operatingIncome}/${yc}${R.operatingIncome}-1` };

    // 純利益率
    if (d) ws.getCell(R.netMargin, col).value = { formula: `${c}${R.netIncome}/${c}${R.revenue}` };

    // 純利益前年比
    if (yc) ws.getCell(R.netIncomeYoY, col).value = { formula: `${c}${R.netIncome}/${yc}${R.netIncome}-1` };

    // PER = ADR株価 / 直近4Q ADR EPS合計
    if (i >= 3) {
      const w = CL(col - 3);
      ws.getCell(R.per, col).value = { formula: `${c}${R.stockPrice}/SUM(${w}${R.epsADR}:${c}${R.epsADR})` };
    }

    // PER 4移動平均
    if (i >= 6) {
      const w = CL(col - 3);
      ws.getCell(R.perAvg, col).value = { formula: `AVERAGE(${w}${R.per}:${c}${R.per})` };
    }
  });

  // 書き出し
  await wb.xlsx.writeFile(OUTPUT_PATH);
  console.log(`出力: ${OUTPUT_PATH}`);
  console.log(`年度範囲: FY${DISPLAY_START_FY} ~ FY${DISPLAY_END_FY} (${quarters.length}四半期)`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
