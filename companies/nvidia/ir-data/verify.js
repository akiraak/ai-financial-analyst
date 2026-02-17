// エクセルの業績データとNVIDIA公式IRデータを突合するスクリプト
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// エクセルファイルを読み込み
const xlsxPath = path.join(__dirname, '..', 'AI企業の業績と予想.xlsx');
const wb = XLSX.readFile(xlsxPath);
const ws = wb.Sheets['NVDA業績'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

// 公式IRデータを読み込み
const officialData = JSON.parse(fs.readFileSync(path.join(__dirname, 'official-data.json'), 'utf-8'));

// エクセルの列とFY四半期のマッピング
// 列0=ラベル, 列1〜4=2024(FY2024) Q1〜Q4, 列5〜8=2025(FY2025) Q1〜Q4, 列9〜12=2026(FY2026) Q1〜Q4
const colMap = {
  1: 'FY2024_Q1', 2: 'FY2024_Q2', 3: 'FY2024_Q3', 4: 'FY2024_Q4',
  5: 'FY2025_Q1', 6: 'FY2025_Q2', 7: 'FY2025_Q3', 8: 'FY2025_Q4',
  9: 'FY2026_Q1', 10: 'FY2026_Q2', 11: 'FY2026_Q3'
};

// エクセルから指標ごとにデータを抽出
function getRowByLabel(label) {
  return rows.find(r => r[0] === label);
}

const excelData = {};
const revenueRow = getRowByLabel('売上高');
const grossProfitRow = getRowByLabel('売上総利益（粗利）');
const opIncomeRow = getRowByLabel('営業利益');
const netIncomeRow = getRowByLabel('当期純利益');
const epsRow = getRowByLabel('EPS');

for (const [col, qKey] of Object.entries(colMap)) {
  const c = parseInt(col);
  excelData[qKey] = {
    revenue: revenueRow ? revenueRow[c] : null,
    grossProfit: grossProfitRow ? grossProfitRow[c] : null,
    operatingIncome: opIncomeRow ? opIncomeRow[c] : null,
    netIncome: netIncomeRow ? netIncomeRow[c] : null,
    eps: epsRow ? epsRow[c] : null
  };
}

// 突合実行
const results = [];
let matchCount = 0;
let mismatchCount = 0;
let skipCount = 0;

const metrics = ['revenue', 'grossProfit', 'operatingIncome', 'netIncome'];
const metricLabels = {
  revenue: '売上高',
  grossProfit: '売上総利益',
  operatingIncome: '営業利益',
  netIncome: '当期純利益'
};

for (const [qKey, irValues] of Object.entries(officialData.quarters)) {
  const exValues = excelData[qKey];
  if (!exValues) continue;

  for (const metric of metrics) {
    const exVal = exValues[metric];
    const irVal = irValues[metric];

    if (exVal == null || irVal == null) {
      skipCount++;
      continue;
    }

    const diff = exVal - irVal;
    const status = diff === 0 ? '✓' : '✗';

    if (diff === 0) {
      matchCount++;
    } else {
      mismatchCount++;
    }

    results.push({
      quarter: qKey,
      metric: metricLabels[metric],
      excel: exVal,
      ir: irVal,
      diff,
      status
    });
  }
}

// コンソール出力
console.log('=== NVIDIA業績データ突合結果 ===\n');
console.log(`一致: ${matchCount}件 / 不一致: ${mismatchCount}件 / スキップ: ${skipCount}件\n`);

if (mismatchCount > 0) {
  console.log('--- 不一致の項目 ---');
  for (const r of results.filter(r => r.status === '✗')) {
    console.log(`${r.quarter} ${r.metric}: エクセル=${r.excel.toLocaleString()} / IR=${r.ir.toLocaleString()} (差異: ${r.diff > 0 ? '+' : ''}${r.diff})`);
  }
  console.log('');
}

console.log('--- 全項目一覧 ---');
console.log('四半期\t\t指標\t\tエクセル\tIR\t\t差異\t状態');
console.log('-'.repeat(80));
for (const r of results) {
  const exStr = r.excel.toLocaleString().padStart(8);
  const irStr = r.ir.toLocaleString().padStart(8);
  const diffStr = (r.diff === 0 ? '0' : `${r.diff > 0 ? '+' : ''}${r.diff}`).padStart(6);
  console.log(`${r.quarter}\t${r.metric}\t${exStr}\t${irStr}\t${diffStr}\t${r.status}`);
}

// マークダウンレポート生成
let md = `# NVIDIA業績データ突合レポート\n\n`;
md += `生成日: ${new Date().toISOString().split('T')[0]}\n\n`;
md += `## サマリー\n\n`;
md += `- 一致: **${matchCount}件**\n`;
md += `- 不一致: **${mismatchCount}件**\n`;
md += `- スキップ（データなし）: ${skipCount}件\n\n`;

if (mismatchCount > 0) {
  md += `## 不一致の項目\n\n`;
  md += `| 四半期 | 指標 | エクセル | IR公式 | 差異 |\n`;
  md += `|--------|------|---------|--------|------|\n`;
  for (const r of results.filter(r => r.status === '✗')) {
    md += `| ${r.quarter} | ${r.metric} | ${r.excel.toLocaleString()} | ${r.ir.toLocaleString()} | ${r.diff > 0 ? '+' : ''}${r.diff} |\n`;
  }
  md += `\n`;
}

md += `## 全項目一覧\n\n`;
md += `| 四半期 | 指標 | エクセル | IR公式 | 差異 | 状態 |\n`;
md += `|--------|------|---------|--------|------|------|\n`;
for (const r of results) {
  md += `| ${r.quarter} | ${r.metric} | ${r.excel.toLocaleString()} | ${r.ir.toLocaleString()} | ${r.diff === 0 ? '0' : `${r.diff > 0 ? '+' : ''}${r.diff}`} | ${r.status} |\n`;
}

md += `\n## 参照URL\n\n`;
for (const url of officialData.references) {
  md += `- ${url}\n`;
}

md += `\n## 備考\n\n`;
md += `- 単位: 百万ドル（EPS除く）\n`;
md += `- エクセルの年度ラベルはNVIDIAの会計年度（FY）に対応\n`;
md += `- NVIDIAは2024年6月に10:1の株式分割を実施\n`;
md += `- FY2026 Q4以降は予想値のため突合対象外\n`;

const reportPath = path.join(__dirname, 'verify-report.md');
fs.writeFileSync(reportPath, md);
console.log(`\nレポートを保存しました: ${reportPath}`);
