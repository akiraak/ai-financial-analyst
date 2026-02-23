// 全データソースを統合して docs/alphabet/data.json + 四半期別data.json を生成する
// Alphabet Inc.用 — 6セグメント売上、3セグメント損益 + Alphabet-level Activities
// 営業外収支: otherIncomeExpense フィールドを直接使用
// SGA: salesAndMarketing + generalAndAdministrative
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const ROOT = path.resolve(DIR, '../../..');
const OUTPUT = path.join(ROOT, 'docs/alphabet/data.json');
const QUARTERS_DIR = path.join(ROOT, 'docs/alphabet/quarters');

// config.json から期間設定を読み込み
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = { pageYears: 2, chartYears: 4 }; // デフォルト値
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
const pageQuarters = config.pageYears * 4;   // ページを生成する四半期数
const chartQuarters = config.chartYears * 4;  // チャートに表示する四半期数

// データファイルの読み込み
const financials = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'financials.json'), 'utf-8'));
const stockPrices = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stock-prices.json'), 'utf-8'));
const segmentsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'segments.json'), 'utf-8'));
const bsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'balance-sheet.json'), 'utf-8'));
const cfData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cash-flows.json'), 'utf-8'));

// segment-profit.json はオプション
let segProfitData = {};
const segProfitPath = path.join(DATA_DIR, 'segment-profit.json');
if (fs.existsSync(segProfitPath)) {
  segProfitData = JSON.parse(fs.readFileSync(segProfitPath, 'utf-8'));
}

// investments.json はオプション
let investmentsData = {};
const investmentsPath = path.join(DATA_DIR, 'investments.json');
if (fs.existsSync(investmentsPath)) {
  investmentsData = JSON.parse(fs.readFileSync(investmentsPath, 'utf-8'));
}

// 営業外収支（Alphabet: otherIncomeExpense フィールド）
function getNonOperatingIncome(d) {
  if (d.otherIncomeExpense != null) return d.otherIncomeExpense;
  // フォールバック: 税引前利益 − 営業利益
  if (d.incomeBeforeTax != null && d.operatingIncome != null) {
    return d.incomeBeforeTax - d.operatingIncome;
  }
  return null;
}

// SGA = salesAndMarketing + generalAndAdministrative
function getSGA(d) {
  const sm = d.salesAndMarketing ?? 0;
  const ga = d.generalAndAdministrative ?? 0;
  if (d.salesAndMarketing != null || d.generalAndAdministrative != null) return sm + ga;
  return null;
}

// セグメント別売上（6セグメント: Search, YouTube, Network, Subscriptions, Cloud, Other Bets）
function getSegments(seg) {
  if (!seg) return null;
  const result = {};
  if (seg.googleSearch != null) result.googleSearch = seg.googleSearch;
  if (seg.youtubeAds != null) result.youtubeAds = seg.youtubeAds;
  if (seg.googleNetwork != null) result.googleNetwork = seg.googleNetwork;
  if (seg.googleSubscriptions != null) result.googleSubscriptions = seg.googleSubscriptions;
  if (seg.googleCloud != null) result.googleCloud = seg.googleCloud;
  if (seg.otherBets != null) result.otherBets = seg.otherBets;
  return Object.keys(result).length > 0 ? result : null;
}

// セグメント損益（Google Services, Google Cloud, Other Bets + Alphabet-level Activities）
function getSegmentProfit(sp) {
  if (!sp) return null;
  const result = {};
  if (sp.googleServicesRevenue != null || sp.googleServicesOperatingIncome != null) {
    result.googleServices = {
      revenue: sp.googleServicesRevenue ?? null,
      operatingIncome: sp.googleServicesOperatingIncome ?? null,
    };
  }
  if (sp.googleCloudRevenue != null || sp.googleCloudOperatingIncome != null) {
    result.googleCloud = {
      revenue: sp.googleCloudRevenue ?? null,
      operatingIncome: sp.googleCloudOperatingIncome ?? null,
    };
  }
  if (sp.otherBetsRevenue != null || sp.otherBetsOperatingIncome != null) {
    result.otherBets = {
      revenue: sp.otherBetsRevenue ?? null,
      operatingIncome: sp.otherBetsOperatingIncome ?? null,
    };
  }
  if (sp.alphabetLevelActivities != null) {
    result.alphabetLevel = {
      revenue: null,
      operatingIncome: sp.alphabetLevelActivities,
    };
  }
  return Object.keys(result).length > 0 ? result : null;
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
      sga: getSGA(d),
      totalOperatingExpenses: d.totalOpex ?? null,
      operatingIncome: d.operatingIncome,
      nonOperatingIncome: getNonOperatingIncome(d),
      netIncome: d.netIncome,
      // EPS
      eps: d.epsDiluted ?? null,
      // 株価
      price: sp?.price ?? null,
      priceDate: sp?.date ?? null,
      // 発行済株式数
      sharesDiluted: d.sharesDiluted ?? null,
      // セグメント別売上（6セグメント）
      segments: getSegments(seg),
      // B/S
      balanceSheet: bs ? {
        cashAndEquivalents: bs.cashAndEquivalents ?? null,
        totalAssets: bs.totalAssets ?? null,
        totalLiabilities: bs.totalLiabilities ?? null,
        totalEquity: bs.totalEquity ?? null,
        totalDebt: bs.longTermDebt ?? null,
      } : null,
      // キャッシュフロー（営業CF・FCFのみ、投資CF・財務CFはプレスリリースに未開示）
      cashFlow: cf ? {
        operatingCF: cf.operatingCF ?? null,
        investingCF: null,
        financingCF: null,
        freeCashFlow: cf.freeCashFlow ?? null,
      } : null,
      // セグメント損益（3セグメント + Alphabet-level）
      segmentProfit: getSegmentProfit(segProfit),
      // 投資ポートフォリオ
      investments: inv ? {
        nonMarketableSecurities: inv.nonMarketableSecurities ?? null,
        marketableSecurities: inv.marketableSecurities ?? null,
        netCash: inv.netCash ?? null,
      } : null,
    });
  }
}

// ページ生成対象にhasPageフラグを付与
const startIdx = Math.max(0, quarters.length - pageQuarters);
for (let i = 0; i < quarters.length; i++) {
  quarters[i].hasPage = i >= startIdx;
}

const data = {
  company: 'Alphabet Inc.',
  ticker: 'GOOGL',
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
