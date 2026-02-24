// 全データソースを統合して docs/tsmc/data.json + 四半期別data.json を生成する
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const ROOT = path.resolve(DIR, '../../..');
const OUTPUT = path.join(ROOT, 'docs/tsmc/data.json');
const QUARTERS_DIR = path.join(ROOT, 'docs/tsmc/quarters');

// config.json から期間設定を読み込み
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = { pageYears: 2, chartYears: 4 };
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
const pageQuarters = config.pageYears * 4;
const chartQuarters = config.chartYears * 4;

// データ読み込み（存在しないファイルは空オブジェクト）
function readJSON(filename) {
  const p = path.join(DATA_DIR, filename);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
}

const financials = readJSON('financials.json');
const stockPrices = readJSON('stock-prices.json');
const segmentsData = readJSON('segments.json');
const bsData = readJSON('balance-sheet.json');
const cfData = readJSON('cash-flows.json');

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

    quarters.push({
      label: `FY${fy} ${q}`,
      fy, q: qn,
      // P/L（NT$ million）
      revenue: d.revenue,
      costOfRevenue: d.costOfRevenue ?? null,
      grossProfit: d.grossProfit,
      operatingExpenses: d.operatingExpenses ?? null,
      operatingIncome: d.operatingIncome,
      nonOperatingIncome: d.nonOperatingIncome ?? null,
      incomeBeforeTax: d.incomeBeforeTax ?? null,
      incomeTaxExpense: d.incomeTaxExpense ?? null,
      netIncome: d.netIncome,
      // EPS
      eps: d.eps ?? null,          // NT$
      epsADR: d.epsADR ?? null,    // US$ per ADR
      // 株価（ADR, USD）
      price: sp?.price ?? null,
      priceDate: sp?.date ?? null,
      // 発行済株式数（百万株）
      sharesDiluted: d.sharesDiluted ?? null,
      // Revenue by Platform（NT$ million + パーセンテージ）
      segments: seg ? {
        hpc: seg.hpc ?? null,
        smartphone: seg.smartphone ?? null,
        iot: seg.iot ?? null,
        automotive: seg.automotive ?? null,
        dce: seg.dce ?? null,
        others: seg.others ?? null,
        _percentages: seg._percentages ?? null,
      } : null,
      // B/S（NT$ million）
      balanceSheet: bs ? {
        cashAndMarketable: bs.cashAndMarketable ?? null,
        accountsReceivable: bs.accountsReceivable ?? null,
        inventories: bs.inventories ?? null,
        netPPE: bs.netPPE ?? null,
        totalAssets: bs.totalAssets ?? null,
        currentLiabilities: bs.currentLiabilities ?? null,
        longTermDebt: bs.longTermDebt ?? null,
        totalLiabilities: bs.totalLiabilities ?? null,
        totalEquity: bs.totalEquity ?? null,
      } : null,
      // キャッシュフロー（NT$ million）
      cashFlow: cf ? {
        operatingCF: cf.operatingCF ?? null,
        capex: cf.capex ?? null,
        freeCashFlow: cf.freeCashFlow ?? null,
        dividends: cf.dividends ?? null,
      } : null,
    });
  }
}

// hasPageフラグを付与
const startIdx = Math.max(0, quarters.length - pageQuarters);
for (let i = 0; i < quarters.length; i++) {
  quarters[i].hasPage = i >= startIdx;
}

const data = {
  company: 'Taiwan Semiconductor Manufacturing',
  ticker: 'TSM',
  currency: 'NT$',
  unit: 'million',
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
  const dataStartIdx = Math.max(0, i + 1 - chartQuarters);

  let prevPage = null;
  for (let j = i - 1; j >= 0; j--) {
    if (quarters[j].hasPage) {
      prevPage = { fy: quarters[j].fy, q: quarters[j].q, label: quarters[j].label };
      break;
    }
  }
  let nextPage = null;
  for (let j = i + 1; j < quarters.length; j++) {
    if (quarters[j].hasPage) {
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
  if (template) {
    const html = template
      .replace(/\{\{QUARTER_LABEL\}\}/g, q.label)
      .replace(/\{\{QUARTER_DIR\}\}/g, dirName);
    fs.writeFileSync(path.join(qDir, 'index.html'), html);
  }
}
console.log(`出力: ${QUARTERS_DIR}/ (${quarters.length - startIdx} フォルダ)`);
