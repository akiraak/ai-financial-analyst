// template.xlsx をベースに financials.json + stock-prices.json のデータを流し込み
// Financials.xlsx を生成するスクリプト

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
  let total = 0;
  if (d.interestExpense != null) total += d.interestExpense;
  if (d.otherIncomeNet != null) total += d.otherIncomeNet;
  return total;
}

// === Excel列文字（1-based: 1=A, 2=B, ...） ===
function CL(col) {
  let s = '';
  while (col > 0) { col--; s = String.fromCharCode(65 + (col % 26)) + s; col = Math.floor(col / 26); }
  return s;
}

async function main() {
  // データ読み込み
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = JSON.parse(fs.readFileSync(STOCK_PRICES_PATH, 'utf-8'));

  // 表示範囲を自動判定
  const fyKeys = Object.keys(financials).map(k => parseInt(k.replace('FY', ''))).sort((a, b) => a - b);
  const DISPLAY_START_FY = fyKeys[0];
  const DISPLAY_END_FY = fyKeys[fyKeys.length - 1];

  // 表示する四半期一覧を構築
  const quarters = [];
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    for (const q of QUARTERS) {
      quarters.push({ fy, q, fyStr: `FY${fy}`, col: quarters.length + 2 }); // B=2 始まり
    }
  }

  // 実績最終四半期の特定
  let lastActualIdx = -1;
  for (let i = quarters.length - 1; i >= 0; i--) {
    const { fyStr, q } = quarters[i];
    const d = financials[fyStr]?.[q];
    if (d?.revenue) {
      lastActualIdx = i;
      break;
    }
  }

  // テンプレート読み込み
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const ws = wb.worksheets[0];

  // シート名をBroadcomに変更
  ws.name = 'AVGO業績';

  // === Row 1: 年度ヘッダー ===
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    const startCol = (fy - DISPLAY_START_FY) * 4 + 2;
    ws.getCell(1, startCol).value = fy;
  }

  // === Row 2: 四半期ラベル ===
  quarters.forEach(({ q, col }) => {
    ws.getCell(2, col).value = q;
  });

  // === 各四半期のデータと数式 ===
  quarters.forEach(({ fyStr, q, col }, i) => {
    const c = CL(col);
    const pc = i > 0 ? CL(col - 1) : null;
    const yc = i >= 4 ? CL(col - 4) : null;
    const d = financials[fyStr]?.[q];
    const price = stockPrices[fyStr]?.[q]?.price;

    // P/L データ
    if (d) {
      ws.getCell(3, col).value = d.revenue;
      ws.getCell(6, col).value = d.grossProfit;
      ws.getCell(9, col).value = d.researchAndDevelopment;
      ws.getCell(11, col).value = d.sga;
      if (d.researchAndDevelopment != null || d.sga != null) {
        ws.getCell(13, col).value = (d.researchAndDevelopment || 0) + (d.sga || 0);
      } else if (d.totalOperatingExpenses != null) {
        ws.getCell(13, col).value = d.totalOperatingExpenses;
      }
      ws.getCell(16, col).value = d.operatingIncome;
      ws.getCell(19, col).value = getNonOperatingIncome(d);
      ws.getCell(20, col).value = d.netIncome;

      // EPS: Broadcomは2024年7月に10:1株式分割
      // Yahoo Financeの株価は分割調整済みなので、EPSも分割調整する
      // press-releaseのEPSは発表時点の値（分割前は分割前ベース）
      // FY2024 Q3（2024年8月期末）以降は分割後ベース
      // FY2024 Q2以前は分割前ベース → ÷10で調整
      let eps = d.epsDiluted;
      if (eps != null) {
        const fy = parseInt(fyStr.replace('FY', ''));
        const qn = parseInt(q.replace('Q', ''));
        if (fy < 2024 || (fy === 2024 && qn <= 2)) {
          eps = Math.round(eps / 10 * 100) / 100;
        }
        ws.getCell(23, col).value = eps;
      }

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

  // 書き出し
  await wb.xlsx.writeFile(OUTPUT_PATH);

  const actualCount = lastActualIdx + 1;
  console.log(`出力: ${OUTPUT_PATH}`);
  console.log(`実績: ${actualCount} 四半期`);
  console.log(`年度範囲: FY${DISPLAY_START_FY} ~ FY${DISPLAY_END_FY}`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
