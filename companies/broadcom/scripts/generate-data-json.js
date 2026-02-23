// 全データソースを統合して docs/broadcom/data.json + 四半期別data.json を生成する
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const ROOT = path.resolve(DIR, '../../..');
const OUTPUT = path.join(ROOT, 'docs/broadcom/data.json');
const QUARTERS_DIR = path.join(ROOT, 'docs/broadcom/quarters');

// config.json から期間設定を読み込み
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = { pageYears: 2, chartYears: 2 }; // デフォルト値
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
const pageQuarters = config.pageYears * 4;   // ページを生成する四半期数
const chartQuarters = config.chartYears * 4;  // チャートに表示する四半期数

const financials = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'financials.json'), 'utf-8'));
const stockPrices = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stock-prices.json'), 'utf-8'));
const segmentsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'segments.json'), 'utf-8'));
const bsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'balance-sheet.json'), 'utf-8'));
const cfData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cash-flows.json'), 'utf-8'));

// segment-profit.json, investments.json はオプション（存在しない場合はスキップ）
let segProfitData = {};
const segProfitPath = path.join(DATA_DIR, 'segment-profit.json');
if (fs.existsSync(segProfitPath)) {
  segProfitData = JSON.parse(fs.readFileSync(segProfitPath, 'utf-8'));
}
let investmentsData = {};
const investmentsPath = path.join(DATA_DIR, 'investments.json');
if (fs.existsSync(investmentsPath)) {
  investmentsData = JSON.parse(fs.readFileSync(investmentsPath, 'utf-8'));
}

// 営業外収支を計算
function getNonOperatingIncome(d) {
  if (d.totalOtherIncome != null) return d.totalOtherIncome;
  if (d.incomeBeforeTax != null && d.operatingIncome != null) {
    return d.incomeBeforeTax - d.operatingIncome;
  }
  let total = 0;
  if (d.interestExpense != null) total += d.interestExpense;
  if (d.otherIncomeNet != null) total += d.otherIncomeNet;
  return total;
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
    const segProfit = segProfitData[fyStr]?.[q];
    const inv = investmentsData[fyStr]?.[q];
    const qn = parseInt(q.replace('Q', ''));

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
      nonOperatingIncome: getNonOperatingIncome(d),
      netIncome: d.netIncome,
      // EPS（Broadcomはスプリット調整不要）
      eps: d.epsDiluted ?? null,
      // 株価
      price: sp?.price ?? null,
      priceDate: sp?.date ?? null,
      // 発行済株式数
      sharesDiluted: d.sharesDiluted ?? null,
      // セグメント別売上（Broadcom: 2セグメント）
      segments: seg ? {
        semiconductorSolutions: seg.semiconductorSolutions ?? null,
        infrastructureSoftware: seg.infrastructureSoftware ?? null,
      } : null,
      // B/S
      balanceSheet: bs ? {
        cashAndEquivalents: bs.cashAndEquivalents ?? null,
        totalAssets: bs.totalAssets ?? null,
        totalLiabilities: bs.totalLiabilities ?? null,
        totalEquity: bs.stockholdersEquity ?? bs.totalEquity ?? null,
        totalDebt: ((bs.shortTermDebt ?? 0) + (bs.longTermDebt ?? 0)) || null,
      } : null,
      // キャッシュフロー
      cashFlow: cf ? {
        operatingCF: cf.operatingCashFlow ?? cf.operatingCF ?? null,
        investingCF: cf.investingCashFlow ?? cf.investingCF ?? null,
        financingCF: cf.financingCashFlow ?? cf.financingCF ?? null,
        freeCashFlow: cf.freeCashFlow ?? null,
      } : null,
      // セグメント営業利益（データがある場合のみ）
      segmentProfit: segProfit ? {
        semiconductorSolutions: {
          revenue: segProfit.semiconductorSolutions?.revenue ?? null,
          operatingIncome: segProfit.semiconductorSolutions?.operatingIncome ?? null,
        },
        infrastructureSoftware: {
          revenue: segProfit.infrastructureSoftware?.revenue ?? null,
          operatingIncome: segProfit.infrastructureSoftware?.operatingIncome ?? null,
        },
      } : null,
      // 投資ポートフォリオ（データがある場合のみ）
      investments: inv ? {
        nonMarketableBalance: inv.nonMarketableBalance ?? null,
        publiclyHeldBalance: inv.publiclyHeldBalance ?? null,
        netAdditions: inv.netAdditions ?? null,
        unrealizedGains: inv.unrealizedGains ?? null,
        impairments: inv.impairments ?? null,
      } : null,
    });
  }
}

// ページ生成対象にhasPageフラグを付与（data.json出力前に設定）
const startIdx = Math.max(0, quarters.length - pageQuarters);
for (let i = 0; i < quarters.length; i++) {
  quarters[i].hasPage = i >= startIdx;
}

const data = {
  company: 'Broadcom',
  ticker: 'AVGO',
  generatedAt: new Date().toISOString().split('T')[0],
  nextEarningsDate: config.nextEarningsDate || null,
  quarters,
};

// 全期間data.json を出力
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
console.log(`出力: ${OUTPUT} (${quarters.length} 四半期)`);

// 四半期別data.json + index.html を出力
const templatePath = path.join(QUARTERS_DIR, 'template.html');
const template = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf-8') : null;
console.log(`設定: pageYears=${config.pageYears} (${quarters.length - startIdx}ページ), chartYears=${config.chartYears} (最大${chartQuarters}四半期分)`);

for (let i = startIdx; i < quarters.length; i++) {
  const q = quarters[i];
  const dirName = `${q.fy}Q${q.q}`;
  const qDir = path.join(QUARTERS_DIR, dirName);
  // チャートデータ: そのQまでの chartQuarters 個分に制限
  const dataStartIdx = Math.max(0, i + 1 - chartQuarters);
  // 前後のページ四半期を特定
  let prevPage = null;
  for (let j = i - 1; j >= 0; j--) {
    if (quarters[j].hasPage) {
      prevPage = { fy: quarters[j].fy, q: quarters[j].q, label: quarters[j].label };
      break;
    }
  }
  let nextPage = null;
  for (let j = i + 1; j < quarters.length; j++) {
    if (quarters[j].hasPage && !quarters[j].isOutlook) {
      nextPage = { fy: quarters[j].fy, q: quarters[j].q, label: quarters[j].label };
      break;
    }
  }

  const qData = {
    ...data,
    quarters: quarters.slice(dataStartIdx, i + 1),
    currentQuarter: { fy: q.fy, q: q.q, label: q.label },
    prevPage,
    nextPage,
  };
  fs.mkdirSync(qDir, { recursive: true });
  fs.writeFileSync(path.join(qDir, 'data.json'), JSON.stringify(qData, null, 2));
  // テンプレートHTMLをコピー（OGPプレースホルダを置換）
  if (template) {
    const html = template
      .replace(/\{\{QUARTER_LABEL\}\}/g, q.label)
      .replace(/\{\{QUARTER_DIR\}\}/g, dirName);
    fs.writeFileSync(path.join(qDir, 'index.html'), html);
  }
}
console.log(`出力: ${QUARTERS_DIR}/ (${quarters.length - startIdx} フォルダ)`);
