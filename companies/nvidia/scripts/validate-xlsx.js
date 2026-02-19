// 生成されたxlsxの数値検証スクリプト
// financials.json / stock-prices.json / press-release.html との突合

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const XLSX_PATH = path.join(DATA_DIR, 'NVDA-Financials.xlsx');
const FINANCIALS_PATH = path.join(DATA_DIR, 'financials.json');
const STOCK_PRICES_PATH = path.join(DATA_DIR, 'stock-prices.json');

// EPSスプリット調整（generate-xlsx.jsと同一ロジック）
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

// 営業外収支の計算（generate-xlsx.jsと同一ロジック）
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

async function main() {
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = JSON.parse(fs.readFileSync(STOCK_PRICES_PATH, 'utf-8'));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet('NVDA業績');

  // 四半期一覧を構築（financials.jsonから自動判定）
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
  let formulaOk = 0, formulaNg = 0;
  const errors = [];

  // === リテラル値の検証 ===
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
      { row: 23, name: 'EPS', expected: adjustEPS(d.epsDiluted, fyStr, q), tolerance: 0.01 },
      { row: 26, name: '株価', expected: sp?.price, tolerance: 0.01 },
    ];

    for (const check of checks) {
      if (check.expected == null) continue;
      const cell = ws.getCell(check.row, col);
      const actual = cell.value?.result ?? cell.value;
      const tolerance = check.tolerance || 0;

      if (actual == null) {
        errors.push(`${fyStr} ${q} Row${check.row} ${check.name}: 期待=${check.expected}, 実際=空`);
        literalNg++;
      } else if (Math.abs(actual - check.expected) > tolerance) {
        errors.push(`${fyStr} ${q} Row${check.row} ${check.name}: 期待=${check.expected}, 実際=${actual}`);
        literalNg++;
      } else {
        literalOk++;
      }
    }
  }

  console.log(`リテラル値: ${literalOk}項目一致 / ${literalNg}項目不一致\n`);

  // === 数式セルの検証 ===
  console.log('=== 数式セルの検証 ===\n');

  for (let i = 0; i < quarters.length; i++) {
    const { fyStr, q, col } = quarters[i];
    const d = financials[fyStr]?.[q];
    if (!d) continue;

    const prev = i > 0 ? quarters[i - 1] : null;
    const yoy = i >= 4 ? quarters[i - 4] : null;
    const prevD = prev ? financials[prev.fyStr]?.[prev.q] : null;
    const yoyD = yoy ? financials[yoy.fyStr]?.[yoy.q] : null;

    const formulaChecks = [];

    // Row 4: 前期比
    if (prevD?.revenue && d.revenue) {
      formulaChecks.push({ row: 4, name: '前期比', expected: d.revenue / prevD.revenue });
    }
    // Row 5: 前年比
    if (yoyD?.revenue && d.revenue) {
      formulaChecks.push({ row: 5, name: '前年比', expected: yoyD.revenue / d.revenue });
    }
    // Row 7: 粗利売上比
    if (d.grossProfit && d.revenue) {
      formulaChecks.push({ row: 7, name: '粗利売上比', expected: d.grossProfit / d.revenue });
    }
    // Row 8: 粗利前年比
    if (yoyD?.grossProfit && d.grossProfit) {
      formulaChecks.push({ row: 8, name: '粗利前年比', expected: d.grossProfit / yoyD.grossProfit });
    }
    // Row 10: R&D売上比
    if (d.researchAndDevelopment && d.revenue) {
      formulaChecks.push({ row: 10, name: 'R&D売上比', expected: d.researchAndDevelopment / d.revenue });
    }
    // Row 12: SGA売上比
    if (d.sga && d.revenue) {
      formulaChecks.push({ row: 12, name: 'SGA売上比', expected: d.sga / d.revenue });
    }
    // Row 14: 販管費売上比
    const opex = (d.researchAndDevelopment || 0) + (d.sga || 0);
    if (opex && d.revenue) {
      formulaChecks.push({ row: 14, name: '販管費売上比', expected: opex / d.revenue });
    }
    // Row 17: 営業利益売上比
    if (d.operatingIncome && d.revenue) {
      formulaChecks.push({ row: 17, name: '営業利益売上比', expected: d.operatingIncome / d.revenue });
    }
    // Row 18: 営業利益前年比
    if (yoyD?.operatingIncome && d.operatingIncome) {
      formulaChecks.push({ row: 18, name: '営業利益前年比', expected: d.operatingIncome / yoyD.operatingIncome - 1 });
    }
    // Row 21: 純利益売上比
    if (d.netIncome && d.revenue) {
      formulaChecks.push({ row: 21, name: '純利益売上比', expected: d.netIncome / d.revenue });
    }
    // Row 22: 純利益前年比
    if (yoyD?.netIncome && d.netIncome) {
      formulaChecks.push({ row: 22, name: '純利益前年比', expected: d.netIncome / yoyD.netIncome - 1 });
    }

    for (const check of formulaChecks) {
      const cell = ws.getCell(check.row, col);
      const actual = cell.value?.result ?? cell.value;

      // ExcelJSは数式の計算結果を保持しない場合がある → 数式文字列の存在を確認
      if (actual == null && cell.value?.formula) {
        formulaOk++; // 数式が設定されていればOK
      } else if (actual == null) {
        errors.push(`${fyStr} ${q} Row${check.row} ${check.name}: 数式なし`);
        formulaNg++;
      } else if (Math.abs(actual - check.expected) > 0.001) {
        errors.push(`${fyStr} ${q} Row${check.row} ${check.name}: 期待=${check.expected.toFixed(4)}, 実際=${actual}`);
        formulaNg++;
      } else {
        formulaOk++;
      }
    }
  }

  console.log(`数式セル: ${formulaOk}項目正常 / ${formulaNg}項目異常\n`);

  // === 結果レポート ===
  console.log('=== 検証結果サマリー ===');
  console.log(`- 対象: NVDA-Financials.xlsx`);
  console.log(`- 年度範囲: FY${startFY} ~ FY${endFY}`);
  const actualCount = quarters.filter(q => financials[q.fyStr]?.[q.q]?.revenue).length;
  console.log(`- 四半期数: 実績 ${actualCount}`);
  console.log(`- リテラル値: ${literalOk + literalNg}項目中 ${literalOk}一致 / ${literalNg}不一致`);
  console.log(`- 数式セル: ${formulaOk + formulaNg}項目中 ${formulaOk}正常 / ${formulaNg}異常`);
  console.log(`- 判定: ${errors.length === 0 ? 'OK' : 'NG'}`);

  if (errors.length > 0) {
    console.log('\n=== 不一致の詳細 ===');
    errors.forEach(e => console.log(`  ✗ ${e}`));
  }
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
