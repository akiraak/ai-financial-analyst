// 全データソースを統合して docs/intel/data.json + 四半期別data.json を生成する
// Intel Corporation用 — 株式分割なし、SGA は直接 sga フィールド
// 営業外収支 = equityInvestmentGains + interestAndOther
// セグメント: CCG, DCAI, Foundry 等（時期により構成が変遷）
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const ROOT = path.resolve(DIR, '../../..');
const OUTPUT = path.join(ROOT, 'docs/intel/data.json');
const QUARTERS_DIR = path.join(ROOT, 'docs/intel/quarters');

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

// 営業外収支を計算（Intel: equityInvestmentGains + interestAndOther）
function getNonOperatingIncome(d) {
  const eig = d.equityInvestmentGains ?? 0;
  const iao = d.interestAndOther ?? 0;
  // 両方nullの場合はincomeBeforeTaxとoperatingIncomeの差分で算出
  if (d.equityInvestmentGains == null && d.interestAndOther == null) {
    if (d.incomeBeforeTax != null && d.operatingIncome != null) {
      return d.incomeBeforeTax - d.operatingIncome;
    }
    return null;
  }
  return eig + iao;
}

// セグメント別売上を抽出（Intelのセグメント構成は時期により変遷する）
// segments.json に ccgRevenue, dcgRevenue/dcaiRevenue 等が直接格納されている
function getSegments(seg) {
  if (!seg) return null;
  const result = {};

  // CCG（全期間共通）
  if (seg.ccgRevenue != null) result.ccg = seg.ccgRevenue;

  // DCG → DCAI（2022年から名称変更）
  if (seg.dcaiRevenue != null) result.dcai = seg.dcaiRevenue;
  else if (seg.dcgRevenue != null) result.dcg = seg.dcgRevenue;

  // Intel Foundry（2024年以降）
  if (seg.intelFoundryRevenue != null) result.intelFoundry = seg.intelFoundryRevenue;

  // NEX（Network and Edge、2022年以降）
  if (seg.nexRevenue != null) result.nex = seg.nexRevenue;

  // Mobileye
  if (seg.mobileyeRevenue != null) result.mobileye = seg.mobileyeRevenue;

  // IFS（Intel Foundry Services、2022-2023年）
  if (seg.ifsRevenue != null) result.ifs = seg.ifsRevenue;

  // AXG（Accelerated Computing Systems and Graphics、2022年）
  if (seg.axgRevenue != null) result.axg = seg.axgRevenue;

  // Altera（2024年以降、旧PSG）
  if (seg.alteraRevenue != null) result.altera = seg.alteraRevenue;

  // IOTG（IoT Group、2020-2021年）
  if (seg.iotgRevenue != null) result.iotg = seg.iotgRevenue;

  // NSG（Non-Volatile Memory Solutions Group、2020-2021年）
  if (seg.nsgRevenue != null) result.nsg = seg.nsgRevenue;

  // PSG（Programmable Solutions Group、2020-2021年）
  if (seg.psgRevenue != null) result.psg = seg.psgRevenue;

  // All Other / Other
  if (seg.allOtherRevenue != null) result.allOther = seg.allOtherRevenue;
  if (seg.otherRevenue != null) result.other = seg.otherRevenue;

  return Object.keys(result).length > 0 ? result : null;
}

// セグメント営業利益を抽出（segment-profit.json の構造に合わせる）
function getSegmentProfit(segProfit) {
  if (!segProfit) return null;
  const result = {};
  const keys = Object.keys(segProfit);
  for (const key of keys) {
    const s = segProfit[key];
    if (s && (s.revenue != null || s.operatingIncome != null)) {
      result[key] = {
        revenue: s.revenue ?? null,
        operatingIncome: s.operatingIncome ?? null,
      };
    }
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
      sga: d.sga ?? null,
      totalOperatingExpenses: d.totalOpex ?? null,
      operatingIncome: d.operatingIncome,
      nonOperatingIncome: getNonOperatingIncome(d),
      netIncome: d.netIncome,
      // EPS（Intelは株式分割なし、調整不要）
      eps: d.epsDiluted ?? null,
      // 株価
      price: sp?.price ?? null,
      priceDate: sp?.date ?? null,
      // 発行済株式数（分割調整不要）
      sharesDiluted: d.sharesDiluted ?? null,
      // セグメント別売上（動的構成）
      segments: getSegments(seg),
      // B/S（totalLiabilities = totalAssets - stockholdersEquity で算出）
      balanceSheet: bs ? {
        cashAndEquivalents: bs.cashAndEquivalents ?? null,
        totalAssets: bs.totalAssets ?? null,
        totalLiabilities: (bs.totalAssets != null && bs.stockholdersEquity != null)
          ? bs.totalAssets - bs.stockholdersEquity
          : null,
        totalEquity: bs.stockholdersEquity ?? null,
        totalDebt: bs.longTermDebt ?? null,
      } : null,
      // キャッシュフロー
      cashFlow: cf ? {
        operatingCF: cf.operatingCashFlow ?? null,
        investingCF: cf.investingCashFlow ?? null,
        financingCF: cf.financingCashFlow ?? null,
        freeCashFlow: cf.freeCashFlow ?? null,
      } : null,
      // セグメント営業利益（動的構成）
      segmentProfit: getSegmentProfit(segProfit),
      // 投資ポートフォリオ（Intel: marketableEquity, nonMarketableEquity）
      investments: inv ? {
        publiclyHeldBalance: inv.marketableEquity ?? null,
        nonMarketableBalance: inv.nonMarketableEquity ?? null,
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
  company: 'Intel Corporation',
  ticker: 'INTC',
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
  // テンプレートHTMLをコピー
  if (template) {
    fs.writeFileSync(path.join(qDir, 'index.html'), template);
  }
}
console.log(`出力: ${QUARTERS_DIR}/ (${quarters.length - startIdx} フォルダ)`);
