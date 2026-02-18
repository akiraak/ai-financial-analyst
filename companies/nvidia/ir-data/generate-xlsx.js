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

const PARAMS = {
  sharesOutstanding: 24530000000,
  revenueGrowthRate: 0.1,
  netMarginRate: 0.55,
  targetPER: 45
};

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

  // === 設定パラメータ（B32-B35） ===
  ws.getCell('B32').value = PARAMS.sharesOutstanding;
  ws.getCell('B33').value = PARAMS.revenueGrowthRate;
  ws.getCell('B34').value = PARAMS.netMarginRate;
  ws.getCell('B35').value = PARAMS.targetPER;

  // === 各四半期のデータと数式を設定 ===
  quarters.forEach(({ fyStr, q, col }, i) => {
    const c = CL(col);                              // 現在列
    const pc = i > 0 ? CL(col - 1) : null;          // 前期列
    const yc = i >= 4 ? CL(col - 4) : null;         // 前年同期列
    const isActual = i <= lastActualIdx;
    const d = financials[fyStr]?.[q];
    const price = stockPrices[fyStr]?.[q]?.price;

    // --------------------------------------------------
    // 実績 or 予想の P/L データ
    // --------------------------------------------------
    if (isActual && d) {
      // 実績はリテラル値で直接入力
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
      if (price != null) ws.getCell(28, col).value = price;
    } else {
      // 予想は数式
      // Row 3: 売上高 = 前期 × (1+成長率)
      ws.getCell(3, col).value = { formula: `${pc}3*(1+$B$33)` };
      // Row 6: 粗利 = 売上高 × 粗利率
      ws.getCell(6, col).value = { formula: `${c}3*${c}7` };
      // Row 9: R&D（前期比+5%成長）
      ws.getCell(9, col).value = { formula: `${pc}9*1.05` };
      // Row 11: その他販管費（前期比+5%成長）
      ws.getCell(11, col).value = { formula: `${pc}11*1.05` };
      // Row 13: 販管費 = R&D + その他販管費
      ws.getCell(13, col).value = { formula: `${c}9+${c}11` };
      // Row 16: 営業利益 = 粗利 - 販管費
      ws.getCell(16, col).value = { formula: `${c}6-${c}13` };
      // Row 19: 営業外収支（前期の値を継続）
      ws.getCell(19, col).value = { formula: `${pc}19` };
      // Row 20: 純利益 = 売上高 × 純利益率
      ws.getCell(20, col).value = { formula: `${c}3*${c}21` };
      // Row 21: 純利益売上比 = パラメータ参照
      ws.getCell(21, col).value = { formula: '$B$34' };
      // Row 23: EPS = 純利益 / (発行株数/百万)
      ws.getCell(23, col).value = { formula: `${c}20/($B$32/10^6)` };
      // Row 27: 計算PER = 目標PER
      ws.getCell(27, col).value = { formula: '$B$35' };
      // Row 28: 株価 = (直近4Q純利益合計 × 百万) / 発行株数 × 目標PER
      if (i >= 3) {
        const w = CL(col - 3);
        ws.getCell(28, col).value = { formula: `(SUM(${w}20:${c}20)*10^6)/$B$32*${c}27` };
      }
    }

    // --------------------------------------------------
    // 比率・成長率の数式行（実績・予想共通）
    // --------------------------------------------------

    // Row 4: 前期比 = 今期売上 / 前期売上
    if (pc) ws.getCell(4, col).value = { formula: `${c}3/${pc}3` };

    // Row 5: 前年比 = 前年同期売上 / 今期売上（既存xlsx準拠: 前年/今年）
    if (yc) ws.getCell(5, col).value = { formula: `${yc}3/${c}3` };

    // Row 7: 粗利 売上比（実績は数式、予想は前期の粗利率を継続）
    if (isActual) {
      ws.getCell(7, col).value = { formula: `${c}6/${c}$3` };
    } else if (!ws.getCell(7, col).value) {
      // 予想: Row 6 の数式で既に ${c}3*${c}7 を使うので、ここで粗利率を設定
      ws.getCell(7, col).value = { formula: `${pc}7` };
    }

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

    // Row 21: 純利益 売上比（実績のみ。予想は上で$B$34を設定済み）
    if (isActual) ws.getCell(21, col).value = { formula: `${c}20/${c}$3` };

    // Row 22: 純利益 前年比 = 今年/前年 - 1（成長率、既存xlsx準拠）
    if (yc) ws.getCell(22, col).value = { formula: `${c}20/${yc}20-1` };

    // Row 25: PER = 株価 / 直近4Q EPS合計
    if (i >= 3) {
      const w = CL(col - 3);
      ws.getCell(25, col).value = { formula: `${c}28/SUM(${w}23:${c}23)` };
    }

    // Row 26: PER 4移動平均
    if (i >= 6) {
      const w = CL(col - 3);
      ws.getCell(26, col).value = { formula: `AVERAGE(${w}25:${c}25)` };
    }

    // Row 27: 計算PER（実績のみ。予想は上で$B$35を設定済み）
    if (isActual && i >= 3) {
      const w = CL(col - 3);
      ws.getCell(27, col).value = { formula: `${c}$29/(SUM(${w}$20:${c}$20)*10^6)` };
    }

    // Row 29: 時価総額 = 発行株数 × 株価
    ws.getCell(29, col).value = { formula: `$B$32*${c}28` };
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
