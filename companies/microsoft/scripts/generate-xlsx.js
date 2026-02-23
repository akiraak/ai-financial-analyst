// template.xlsx をベースに financials.json + stock-prices.json のデータを流し込み
// Financials.xlsx を生成するスクリプト
// Microsoft用 — 株式分割なし（2003年以降）、SGA = salesAndMarketing + generalAndAdministrative

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const TEMPLATE_PATH = path.join(DATA_DIR, 'template.xlsx');
const FINANCIALS_PATH = path.join(DATA_DIR, 'financials.json');
const STOCK_PRICES_PATH = path.join(DATA_DIR, 'stock-prices.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'Financials.xlsx');

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

// === 営業外収支を計算 ===
function getNonOperatingIncome(d) {
  if (d.incomeBeforeTax != null && d.operatingIncome != null) {
    return d.incomeBeforeTax - d.operatingIncome;
  }
  if (d.otherIncomeNet != null) return d.otherIncomeNet;
  return 0;
}

// === SGA（販管費 = salesAndMarketing + G&A）を取得 ===
function getSGA(d) {
  const sm = d.salesAndMarketing || 0;
  const ga = d.generalAndAdministrative || 0;
  return sm + ga;
}

// === Excel列文字 ===
function CL(col) {
  let s = '';
  while (col > 0) { col--; s = String.fromCharCode(65 + (col % 26)) + s; col = Math.floor(col / 26); }
  return s;
}

async function main() {
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = JSON.parse(fs.readFileSync(STOCK_PRICES_PATH, 'utf-8'));

  const fyKeys = Object.keys(financials).map(k => parseInt(k.replace('FY', ''))).sort((a, b) => a - b);
  const DISPLAY_START_FY = fyKeys[0];
  const DISPLAY_END_FY = fyKeys[fyKeys.length - 1];

  const quarters = [];
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    for (const q of QUARTERS) {
      quarters.push({ fy, q, fyStr: `FY${fy}`, col: quarters.length + 2 });
    }
  }

  // 実績最終四半期の特定
  let lastActualIdx = -1;
  for (let i = quarters.length - 1; i >= 0; i--) {
    const { fyStr, q } = quarters[i];
    const d = financials[fyStr]?.[q];
    if (d?.revenue && !d.isOutlook) { lastActualIdx = i; break; }
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  let ws = wb.worksheets[0];
  ws.name = 'MSFT業績';

  // Row 1: 年度ヘッダー
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    const startCol = (fy - DISPLAY_START_FY) * 4 + 2;
    ws.getCell(1, startCol).value = fy;
  }

  // Row 2: 四半期ラベル
  quarters.forEach(({ q, col }, i) => {
    ws.getCell(2, col).value = (i === lastActualIdx + 1) ? `${q}予想` : q;
  });

  // 各四半期のデータと数式を設定
  quarters.forEach(({ fyStr, q, col }, i) => {
    const c = CL(col);
    const pc = i > 0 ? CL(col - 1) : null;
    const yc = i >= 4 ? CL(col - 4) : null;
    const d = financials[fyStr]?.[q];
    const price = stockPrices[fyStr]?.[q]?.price;

    if (d) {
      ws.getCell(3, col).value = d.revenue;
      ws.getCell(6, col).value = d.grossProfit;
      ws.getCell(9, col).value = d.researchAndDevelopment;
      ws.getCell(11, col).value = getSGA(d);
      // 販管費合計 = R&D + SGA
      const sga = getSGA(d);
      if (d.researchAndDevelopment != null || sga != null) {
        ws.getCell(13, col).value = (d.researchAndDevelopment || 0) + (sga || 0);
      }
      ws.getCell(16, col).value = d.operatingIncome;
      ws.getCell(19, col).value = getNonOperatingIncome(d);
      ws.getCell(20, col).value = d.netIncome;

      // EPS そのまま（分割調整不要）
      if (d.epsDiluted != null) ws.getCell(23, col).value = d.epsDiluted;
      if (price != null) ws.getCell(26, col).value = price;
    }

    // 比率・成長率の数式行
    if (pc) ws.getCell(4, col).value = { formula: `${c}3/${pc}3` };
    if (yc) ws.getCell(5, col).value = { formula: `${yc}3/${c}3` };
    if (d) ws.getCell(7, col).value = { formula: `${c}6/${c}$3` };
    if (yc) ws.getCell(8, col).value = { formula: `${c}6/${yc}6` };
    ws.getCell(10, col).value = { formula: `${c}9/${c}$3` };
    ws.getCell(12, col).value = { formula: `${c}11/${c}$3` };
    ws.getCell(14, col).value = { formula: `${c}13/${c}$3` };
    if (yc) ws.getCell(15, col).value = { formula: `${c}13/${yc}13` };
    ws.getCell(17, col).value = { formula: `${c}16/${c}$3` };
    if (yc) ws.getCell(18, col).value = { formula: `${c}16/${yc}16-1` };
    if (d) ws.getCell(21, col).value = { formula: `${c}20/${c}$3` };
    if (yc) ws.getCell(22, col).value = { formula: `${c}20/${yc}20-1` };
    if (i >= 3) {
      const w = CL(col - 3);
      ws.getCell(24, col).value = { formula: `${c}26/SUM(${w}23:${c}23)` };
    }
    if (i >= 6) {
      const w = CL(col - 3);
      ws.getCell(25, col).value = { formula: `AVERAGE(${w}24:${c}24)` };
    }
  });

  await wb.xlsx.writeFile(OUTPUT_PATH);

  const actualCount = lastActualIdx + 1;
  const forecastCount = quarters.length - actualCount;
  console.log(`出力: ${OUTPUT_PATH}`);
  console.log(`実績: ${actualCount} 四半期, 予想: ${forecastCount} 四半期`);
  console.log(`年度範囲: FY${DISPLAY_START_FY} ~ FY${DISPLAY_END_FY}`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
