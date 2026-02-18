// template.xlsx をベースに financials.json + stock-prices.json のデータを流し込み
// NVDA業績.xlsx を生成するスクリプト
//
// テンプレートの書式（色・罫線・数値フォーマット）はそのまま保持し、
// 値と数式のみを設定する。数式パターンは既存「AI企業の業績と予想.xlsx」に準拠。

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = __dirname;
const TEMPLATE_PATH = path.join(DIR, 'template.xlsx');
const FINANCIALS_PATH = path.join(DIR, 'financials.json');
const STOCK_PRICES_PATH = path.join(DIR, 'stock-prices.json');
const OUTPUT_PATH = path.join(DIR, 'NVDA業績.xlsx');

// === 設定 ===
const DISPLAY_START_FY = 2022;
const DISPLAY_END_FY = 2026;
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

// === EPS スプリット調整 ===
// 4:1 split: 2021年7月 → FY2022 Q1 以前の数値は ÷4 済み（÷40は4:1×10:1の合算）
// 10:1 split: 2024年6月 → FY2025 Q1 以前（press-releaseは発行時点の株数基準）
function adjustEPS(eps, fyStr, q) {
  if (eps == null) return null;
  const fy = parseInt(fyStr.replace('FY', ''));
  const qn = parseInt(q.replace('Q', ''));
  let divisor = 1;
  if (fy < 2022 || (fy === 2022 && qn === 1)) {
    divisor = 40;
  } else if (fy < 2025 || (fy === 2025 && qn === 1)) {
    divisor = 10;
  }
  return Math.round(eps / divisor * 100) / 100;
}

// === 営業外収支を計算 ===
function getNonOperatingIncome(d) {
  if (d.totalOtherIncome != null) return d.totalOtherIncome;
  if (d.incomeBeforeTax != null && d.operatingIncome != null) {
    return d.incomeBeforeTax - d.operatingIncome;
  }
  let total = 0;
  if (d.interestIncome != null) total += d.interestIncome;
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

  // 表示する四半期一覧を構築
  const quarters = [];
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    for (const q of QUARTERS) {
      quarters.push({ fy, q, fyStr: `FY${fy}`, col: quarters.length + 2 }); // B=2 始まり
    }
  }

  // 実績最終四半期の特定（revenueが存在する最後の四半期）
  let lastActualIdx = -1;
  for (let i = quarters.length - 1; i >= 0; i--) {
    const { fyStr, q } = quarters[i];
    if (financials[fyStr]?.[q]?.revenue) {
      lastActualIdx = i;
      break;
    }
  }

  // テンプレート読み込み
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const ws = wb.getWorksheet('NVDA業績');

  // === Row 1: 年度ヘッダーを設定（テンプレートは空欄） ===
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    const startCol = (fy - DISPLAY_START_FY) * 4 + 2; // B=2
    ws.getCell(1, startCol).value = fy;
  }

  // === Row 2: 四半期ラベルを設定（テンプレートは空欄） ===
  quarters.forEach(({ q, col }, i) => {
    ws.getCell(2, col).value = (i === lastActualIdx + 1) ? `${q}予想` : q;
  });

  // === 各四半期のデータと数式を設定 ===
  quarters.forEach(({ fyStr, q, col }, i) => {
    const c = CL(col);                              // 現在列
    const pc = i > 0 ? CL(col - 1) : null;          // 前期列
    const yc = i >= 4 ? CL(col - 4) : null;         // 前年同期列
    const d = financials[fyStr]?.[q];
    const price = stockPrices[fyStr]?.[q]?.price;

    // --------------------------------------------------
    // 実績 P/L データ
    // --------------------------------------------------
    if (d) {
      ws.getCell(3, col).value = d.revenue;
      ws.getCell(6, col).value = d.grossProfit;
      ws.getCell(9, col).value = d.researchAndDevelopment;
      ws.getCell(11, col).value = d.sga;
      ws.getCell(13, col).value = (d.researchAndDevelopment || 0) + (d.sga || 0);
      ws.getCell(16, col).value = d.operatingIncome;
      ws.getCell(19, col).value = getNonOperatingIncome(d);
      ws.getCell(20, col).value = d.netIncome;

      const eps = adjustEPS(d.epsDiluted, fyStr, q);
      if (eps != null) ws.getCell(23, col).value = eps;
      if (price != null) ws.getCell(26, col).value = price;
    }

    // --------------------------------------------------
    // 比率・成長率の数式行
    // --------------------------------------------------

    // Row 4: 前期比 = 今期売上 / 前期売上
    if (pc) ws.getCell(4, col).value = { formula: `${c}3/${pc}3` };

    // Row 5: 前年比 = 前年同期売上 / 今期売上（既存xlsx準拠: 前年/今年）
    if (yc) ws.getCell(5, col).value = { formula: `${yc}3/${c}3` };

    // Row 7: 粗利 売上比
    if (d) ws.getCell(7, col).value = { formula: `${c}6/${c}$3` };

    // Row 8: 粗利 前年比 = 今年粗利 / 前年粗利（既存xlsx準拠: 今年/前年）
    if (yc) ws.getCell(8, col).value = { formula: `${c}6/${yc}6` };

    // Row 10: R&D 売上比
    ws.getCell(10, col).value = { formula: `${c}9/${c}$3` };

    // Row 12: その他販管費 売上比
    ws.getCell(12, col).value = { formula: `${c}11/${c}$3` };

    // Row 14: 販管費 売上比
    ws.getCell(14, col).value = { formula: `${c}13/${c}$3` };

    // Row 15: 販管費 前年比 = 今年販管費 / 前年販管費
    if (yc) ws.getCell(15, col).value = { formula: `${c}13/${yc}13` };

    // Row 17: 営業利益 売上比
    ws.getCell(17, col).value = { formula: `${c}16/${c}$3` };

    // Row 18: 営業利益 前年比 = 今年/前年 - 1（成長率、既存xlsx準拠）
    if (yc) ws.getCell(18, col).value = { formula: `${c}16/${yc}16-1` };

    // Row 21: 純利益 売上比
    if (d) ws.getCell(21, col).value = { formula: `${c}20/${c}$3` };

    // Row 22: 純利益 前年比 = 今年/前年 - 1（成長率、既存xlsx準拠）
    if (yc) ws.getCell(22, col).value = { formula: `${c}20/${yc}20-1` };

    // Row 24: PER = 株価 / 直近4Q EPS合計
    if (i >= 3) {
      const w = CL(col - 3);
      ws.getCell(24, col).value = { formula: `${c}26/SUM(${w}23:${c}23)` };
    }

    // Row 25: PER 4移動平均
    if (i >= 6) {
      const w = CL(col - 3);
      ws.getCell(25, col).value = { formula: `AVERAGE(${w}24:${c}24)` };
    }

  });

  // === 書き出し ===
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
