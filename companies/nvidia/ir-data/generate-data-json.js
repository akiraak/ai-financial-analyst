// financials.json + stock-prices.json を統合して docs/nvidia/data.json を生成する
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ROOT = path.resolve(DIR, '../../..');
const OUTPUT = path.join(ROOT, 'docs/nvidia/data.json');

const financials = JSON.parse(fs.readFileSync(path.join(DIR, 'financials.json'), 'utf-8'));
const stockPrices = JSON.parse(fs.readFileSync(path.join(DIR, 'stock-prices.json'), 'utf-8'));
const segmentsData = JSON.parse(fs.readFileSync(path.join(DIR, 'segments.json'), 'utf-8'));
const bsData = JSON.parse(fs.readFileSync(path.join(DIR, 'balance-sheet.json'), 'utf-8'));
const cfData = JSON.parse(fs.readFileSync(path.join(DIR, 'cash-flows.json'), 'utf-8'));

// 株式数スプリット調整（EPSの逆: 乗算で正規化）
function adjustShares(shares, fy, qn) {
  if (shares == null) return null;
  let multiplier = 1;
  if (fy < 2022 || (fy === 2022 && qn === 1)) multiplier = 40;
  else if (fy < 2025 || (fy === 2025 && qn === 1)) multiplier = 10;
  return Math.round(shares * multiplier);
}

// EPS スプリット調整（generate-xlsx.js と同じロジック）
function adjustEPS(eps, fy, qn) {
  if (eps == null) return null;
  let divisor = 1;
  if (fy < 2022 || (fy === 2022 && qn === 1)) divisor = 40;
  else if (fy < 2025 || (fy === 2025 && qn === 1)) divisor = 10;
  return Math.round(eps / divisor * 100) / 100;
}

// 四半期データを時系列配列に変換
const quarters = [];
const fys = Object.keys(financials).sort();
for (const fyStr of fys) {
  const fy = parseInt(fyStr.replace('FY', ''));
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
    const d = financials[fyStr]?.[q];
    if (!d) continue;
    const sp = stockPrices[fyStr]?.[q];
    const seg = segmentsData[fyStr]?.[q];
    const bs = bsData[fyStr]?.[q];
    const cf = cfData[fyStr]?.[q];
    const qn = parseInt(q.replace('Q', ''));

    // OEM & Other = 総売上 - 各セグメント合計（bullet pointに記載がないため差分で算出）
    let oem = null;
    if (seg && d.revenue) {
      const segSum = (seg.dataCenter || 0) + (seg.gaming || 0) +
        (seg.professionalVisualization || 0) + (seg.automotive || 0);
      const diff = d.revenue - segSum;
      if (diff > 0) oem = diff;
    }

    quarters.push({
      label: `${fyStr} ${q}`,
      fy, q: qn,
      isOutlook: d.isOutlook || false,
      // P/L
      revenue: d.revenue,
      costOfRevenue: d.costOfRevenue ?? null,
      grossProfit: d.grossProfit,
      researchAndDevelopment: d.researchAndDevelopment ?? null,
      sga: d.sga ?? null,
      totalOperatingExpenses: d.totalOperatingExpenses ?? null,
      operatingIncome: d.operatingIncome,
      netIncome: d.netIncome,
      // EPS（スプリット調整済み）
      eps: adjustEPS(d.epsDiluted, fy, qn),
      // 株価
      price: sp?.price ?? null,
      priceDate: sp?.date ?? null,
      // 発行済株式数（スプリット調整済み: EPSの逆数で乗算）
      sharesDiluted: d.sharesDiluted ? adjustShares(d.sharesDiluted, fy, qn) : null,
      // セグメント別売上
      segments: seg ? {
        dataCenter: seg.dataCenter ?? null,
        gaming: seg.gaming ?? null,
        professionalVisualization: seg.professionalVisualization ?? null,
        automotive: seg.automotive ?? null,
        oem: oem,
      } : null,
      // B/S
      balanceSheet: bs ? {
        cashAndEquivalents: bs.cashAndEquivalents ?? null,
        totalAssets: bs.totalAssets ?? null,
        totalLiabilities: bs.totalLiabilities ?? null,
        totalEquity: bs.totalEquity ?? null,
        totalDebt: ((bs.shortTermDebt ?? 0) + (bs.longTermDebt ?? 0)) || null,
      } : null,
      // キャッシュフロー
      cashFlow: cf ? {
        operatingCF: cf.operatingCF ?? null,
        investingCF: cf.investingCF ?? null,
        financingCF: cf.financingCF ?? null,
        freeCashFlow: cf.freeCashFlow ?? null,
      } : null,
    });
  }
}

const data = {
  company: 'NVIDIA',
  ticker: 'NVDA',
  generatedAt: new Date().toISOString().split('T')[0],
  quarters,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
console.log(`出力: ${OUTPUT} (${quarters.length} 四半期)`);
