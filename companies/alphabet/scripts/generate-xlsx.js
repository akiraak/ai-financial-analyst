// financials.json + segments.json + stock-prices.json のデータから Financials.xlsx を生成するスクリプト
// Alphabet Inc. (GOOGL) 用 — 暦年FY
// セグメント: Google Search, YouTube Ads, Google Network, Subscriptions/Platforms/Devices, Google Cloud, Other Bets
// 販管費 = salesAndMarketing + generalAndAdministrative（合算してSGA行に表示）

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
const TEMPLATE_PATH = path.join(DATA_DIR, 'template.xlsx');
const FINANCIALS_PATH = path.join(DATA_DIR, 'financials.json');
const SEGMENTS_PATH = path.join(DATA_DIR, 'segments.json');
const STOCK_PRICES_PATH = path.join(DATA_DIR, 'stock-prices.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'Financials.xlsx');

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

// === 行レイアウト定義 ===
// Alphabet はセグメント売上内訳（Google Search, YouTube Ads, Google Network,
// Subscriptions/Platforms/Devices, Google Services Total, Google Cloud, Other Bets）を表示
const ROW = {
  YEAR_HEADER:      1,   // 年度ヘッダー
  Q_LABEL:          2,   // 四半期ラベル (Q1, Q2, ...)
  // --- セグメント売上 ---
  GOOGLE_SEARCH:    3,   // Google Search & other
  YOUTUBE_ADS:      4,   // YouTube ads
  GOOGLE_NETWORK:   5,   // Google Network
  GOOGLE_SUBS:      6,   // Google Subscriptions, Platforms & Devices
  GOOGLE_SVC_TOTAL: 7,   // Google Services Total
  GOOGLE_CLOUD:     8,   // Google Cloud
  OTHER_BETS:       9,   // Other Bets
  // --- P/L ---
  REVENUE:         10,   // 総売上高
  REVENUE_QOQ:     11,   // 売上 QoQ
  REVENUE_YOY:     12,   // 売上 YoY
  COST_OF_REV:     13,   // 売上原価
  GROSS_PROFIT:    14,   // 粗利益
  GROSS_MARGIN:    15,   // 粗利率
  GROSS_YOY:       16,   // 粗利 YoY
  // --- 営業費用 ---
  RND:             17,   // R&D
  RND_RATIO:       18,   // R&D比率
  SGA:             19,   // SGA（販管費合算: Sales&Marketing + G&A）
  SGA_RATIO:       20,   // SGA比率
  RESTRUCTURING:   21,   // リストラクチャリング費用
  OPEX_TOTAL:      22,   // 営業費用合計（COGS除く）
  OPEX_RATIO:      23,   // 営業費用比率
  OPEX_YOY:        24,   // 営業費用 YoY
  // --- 営業利益 ---
  OP_INCOME:       25,   // 営業利益
  OP_MARGIN:       26,   // 営業利益率
  OP_YOY:          27,   // 営業利益 YoY
  // --- 営業外・純利益 ---
  OTHER_INCOME:    28,   // その他営業外損益 (otherIncomeExpense)
  PRETAX_INCOME:   29,   // 税引前利益
  TAX:             30,   // 法人税等
  NET_INCOME:      31,   // 純利益
  NET_MARGIN:      32,   // 純利益率
  NET_YOY:         33,   // 純利益 YoY
  // --- EPS ---
  EPS_BASIC:       34,   // EPS（基本）
  EPS_DILUTED:     35,   // EPS（希薄化後）
  // --- 株式数 ---
  SHARES_BASIC:    36,   // 発行済株式数（基本）
  SHARES_DILUTED:  37,   // 発行済株式数（希薄化後）
  // --- 株価・バリュエーション ---
  STOCK_PRICE:     38,   // 四半期末株価
  MARKET_CAP:      39,   // 時価総額（= 株価 × 希薄化後株式数）
  PER_TTM:         40,   // PER（直近4Q EPS合計）
  PER_AVG:         41,   // PER（4Q移動平均）
};

// === SGA合算（salesAndMarketing + generalAndAdministrative） ===
function getSGA(d) {
  return (d.salesAndMarketing || 0) + (d.generalAndAdministrative || 0);
}

// === 営業費用合計を取得（COGS除く） ===
// totalOpex があればそのまま使用、なければ totalCostsAndExpenses - costOfRevenue で計算
function getTotalOpex(d) {
  if (d.totalOpex != null) return d.totalOpex;
  if (d.totalCostsAndExpenses != null && d.costOfRevenue != null) {
    return d.totalCostsAndExpenses - d.costOfRevenue;
  }
  return null;
}

// === Excel列文字（1-based: 1=A, 2=B, ...） ===
function CL(col) {
  let s = '';
  while (col > 0) { col--; s = String.fromCharCode(65 + (col % 26)) + s; col = Math.floor(col / 26); }
  return s;
}

// === テンプレート作成（template.xlsx が存在しない場合） ===
async function createTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GOOGL業績');

  // 行ラベル（A列）
  const labels = {
    [ROW.YEAR_HEADER]:    '',
    [ROW.Q_LABEL]:        '',
    [ROW.GOOGLE_SEARCH]:  'Google Search & other',
    [ROW.YOUTUBE_ADS]:    'YouTube ads',
    [ROW.GOOGLE_NETWORK]: 'Google Network',
    [ROW.GOOGLE_SUBS]:    'Google Subscriptions/Platforms/Devices',
    [ROW.GOOGLE_SVC_TOTAL]: 'Google Services Total',
    [ROW.GOOGLE_CLOUD]:   'Google Cloud',
    [ROW.OTHER_BETS]:     'Other Bets',
    [ROW.REVENUE]:        '売上高 (Total Revenue)',
    [ROW.REVENUE_QOQ]:    '売上QoQ',
    [ROW.REVENUE_YOY]:    '売上YoY',
    [ROW.COST_OF_REV]:    '売上原価',
    [ROW.GROSS_PROFIT]:   '粗利益',
    [ROW.GROSS_MARGIN]:   '粗利率',
    [ROW.GROSS_YOY]:      '粗利YoY',
    [ROW.RND]:            'R&D',
    [ROW.RND_RATIO]:      'R&D比率',
    [ROW.SGA]:            'SGA (Sales&Marketing + G&A)',
    [ROW.SGA_RATIO]:      'SGA比率',
    [ROW.RESTRUCTURING]:  'リストラクチャリング',
    [ROW.OPEX_TOTAL]:     '営業費用合計',
    [ROW.OPEX_RATIO]:     '営業費用比率',
    [ROW.OPEX_YOY]:       '営業費用YoY',
    [ROW.OP_INCOME]:      '営業利益',
    [ROW.OP_MARGIN]:      '営業利益率',
    [ROW.OP_YOY]:         '営業利益YoY',
    [ROW.OTHER_INCOME]:   'その他営業外損益',
    [ROW.PRETAX_INCOME]:  '税引前利益',
    [ROW.TAX]:            '法人税等',
    [ROW.NET_INCOME]:     '純利益',
    [ROW.NET_MARGIN]:     '純利益率',
    [ROW.NET_YOY]:        '純利益YoY',
    [ROW.EPS_BASIC]:      'EPS (基本)',
    [ROW.EPS_DILUTED]:    'EPS (希薄化後)',
    [ROW.SHARES_BASIC]:   '発行済株式数 (基本)',
    [ROW.SHARES_DILUTED]: '発行済株式数 (希薄化後)',
    [ROW.STOCK_PRICE]:    '株価 (四半期末)',
    [ROW.MARKET_CAP]:     '時価総額',
    [ROW.PER_TTM]:        'PER (直近4Q)',
    [ROW.PER_AVG]:        'PER (4Q平均)',
  };

  for (const [row, label] of Object.entries(labels)) {
    ws.getCell(parseInt(row), 1).value = label;
  }

  // A列の幅を設定
  ws.getColumn(1).width = 38;

  await wb.xlsx.writeFile(TEMPLATE_PATH);
  console.log(`テンプレート作成: ${TEMPLATE_PATH}`);
  return wb;
}

async function main() {
  // データ読み込み
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const segments = JSON.parse(fs.readFileSync(SEGMENTS_PATH, 'utf-8'));
  const stockPrices = JSON.parse(fs.readFileSync(STOCK_PRICES_PATH, 'utf-8'));

  // 表示範囲を自動判定
  const fyKeys = Object.keys(financials).map(k => parseInt(k.replace('FY', ''))).sort((a, b) => a - b);
  const DISPLAY_START_FY = fyKeys[0];
  const DISPLAY_END_FY = fyKeys[fyKeys.length - 1];

  // 表示する四半期一覧を構築（B=2 列始まり）
  const quarters = [];
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    for (const q of QUARTERS) {
      quarters.push({ fy, q, fyStr: `FY${fy}`, col: quarters.length + 2 });
    }
  }

  // 実績最終四半期の特定（revenueが存在し、outlook以外の最後の四半期）
  let lastActualIdx = -1;
  for (let i = quarters.length - 1; i >= 0; i--) {
    const { fyStr, q } = quarters[i];
    const d = financials[fyStr]?.[q];
    if (d?.revenue && !d.isOutlook) {
      lastActualIdx = i;
      break;
    }
  }

  // テンプレート読み込みまたは作成
  let wb;
  if (fs.existsSync(TEMPLATE_PATH)) {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(TEMPLATE_PATH);
  } else {
    wb = await createTemplate();
    // テンプレートを保存後に再読み込み
    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(TEMPLATE_PATH);
  }
  const ws = wb.getWorksheet('GOOGL業績');

  // === Row 1: 年度ヘッダーを設定 ===
  for (let fy = DISPLAY_START_FY; fy <= DISPLAY_END_FY; fy++) {
    const startCol = (fy - DISPLAY_START_FY) * 4 + 2;
    ws.getCell(ROW.YEAR_HEADER, startCol).value = fy;
  }

  // === Row 2: 四半期ラベルを設定 ===
  quarters.forEach(({ q, col }, i) => {
    ws.getCell(ROW.Q_LABEL, col).value = (i === lastActualIdx + 1) ? `${q}予想` : q;
  });

  // === 各四半期のデータと数式を設定 ===
  quarters.forEach(({ fyStr, q, col }, i) => {
    const c = CL(col);                              // 現在列
    const pc = i > 0 ? CL(col - 1) : null;          // 前期列
    const yc = i >= 4 ? CL(col - 4) : null;         // 前年同期列
    const d = financials[fyStr]?.[q];
    const seg = segments[fyStr]?.[q];
    const price = stockPrices[fyStr]?.[q]?.price;
    const R = ROW; // ショートカット

    if (seg) {
      // --------------------------------------------------
      // セグメント売上内訳（segments.json から取得）
      // --------------------------------------------------
      if (seg.googleSearch != null)        ws.getCell(R.GOOGLE_SEARCH, col).value = seg.googleSearch;
      if (seg.youtubeAds != null)          ws.getCell(R.YOUTUBE_ADS, col).value = seg.youtubeAds;
      if (seg.googleNetwork != null)       ws.getCell(R.GOOGLE_NETWORK, col).value = seg.googleNetwork;
      if (seg.googleSubscriptions != null) ws.getCell(R.GOOGLE_SUBS, col).value = seg.googleSubscriptions;
      if (seg.googleServicesTotal != null) ws.getCell(R.GOOGLE_SVC_TOTAL, col).value = seg.googleServicesTotal;
      if (seg.googleCloud != null)         ws.getCell(R.GOOGLE_CLOUD, col).value = seg.googleCloud;
      if (seg.otherBets != null)           ws.getCell(R.OTHER_BETS, col).value = seg.otherBets;
    }

    if (d) {
      // --------------------------------------------------
      // P/L データ（実績 or 予想）
      // --------------------------------------------------
      ws.getCell(R.REVENUE, col).value = d.revenue;
      if (d.costOfRevenue != null)            ws.getCell(R.COST_OF_REV, col).value = d.costOfRevenue;
      if (d.grossProfit != null)              ws.getCell(R.GROSS_PROFIT, col).value = d.grossProfit;

      // --- 営業費用 ---
      if (d.researchAndDevelopment != null)   ws.getCell(R.RND, col).value = d.researchAndDevelopment;

      // SGA = salesAndMarketing + generalAndAdministrative（合算）
      const sga = getSGA(d);
      if (sga > 0)                            ws.getCell(R.SGA, col).value = sga;

      // リストラクチャリング費用（データにあれば）
      if (d.restructuring != null)            ws.getCell(R.RESTRUCTURING, col).value = d.restructuring;

      // 営業費用合計（COGS除く）
      const opex = getTotalOpex(d);
      if (opex != null)                       ws.getCell(R.OPEX_TOTAL, col).value = opex;

      // --- 営業利益 ---
      if (d.operatingIncome != null)          ws.getCell(R.OP_INCOME, col).value = d.operatingIncome;

      // --- 営業外損益 ---
      // Alphabet は interestIncome / interestExpense を分離せず
      // otherIncomeExpense に一本化して開示
      if (d.otherIncomeExpense != null)       ws.getCell(R.OTHER_INCOME, col).value = d.otherIncomeExpense;
      if (d.incomeBeforeTax != null)          ws.getCell(R.PRETAX_INCOME, col).value = d.incomeBeforeTax;
      if (d.incomeTaxExpense != null)         ws.getCell(R.TAX, col).value = d.incomeTaxExpense;
      if (d.netIncome != null)                ws.getCell(R.NET_INCOME, col).value = d.netIncome;

      // --- EPS（分割調整済みデータをそのまま使用） ---
      if (d.epsBasic != null)                 ws.getCell(R.EPS_BASIC, col).value = d.epsBasic;
      if (d.epsDiluted != null)               ws.getCell(R.EPS_DILUTED, col).value = d.epsDiluted;

      // --- 株式数（百万株単位） ---
      if (d.sharesBasic != null)              ws.getCell(R.SHARES_BASIC, col).value = d.sharesBasic;
      if (d.sharesDiluted != null)            ws.getCell(R.SHARES_DILUTED, col).value = d.sharesDiluted;

      // --- 株価 ---
      if (price != null)                      ws.getCell(R.STOCK_PRICE, col).value = price;
    }

    // --------------------------------------------------
    // 比率・成長率の数式行
    // --------------------------------------------------

    // 売上 QoQ = 今期 / 前期 - 1
    if (pc) ws.getCell(R.REVENUE_QOQ, col).value = { formula: `${c}${R.REVENUE}/${pc}${R.REVENUE}-1` };

    // 売上 YoY = 今期 / 前年同期 - 1
    if (yc) ws.getCell(R.REVENUE_YOY, col).value = { formula: `${c}${R.REVENUE}/${yc}${R.REVENUE}-1` };

    // 粗利率 = 粗利 / 売上
    if (d) ws.getCell(R.GROSS_MARGIN, col).value = { formula: `${c}${R.GROSS_PROFIT}/${c}$${R.REVENUE}` };

    // 粗利 YoY = 今期粗利 / 前年同期粗利 - 1
    if (yc) ws.getCell(R.GROSS_YOY, col).value = { formula: `${c}${R.GROSS_PROFIT}/${yc}${R.GROSS_PROFIT}-1` };

    // R&D比率 = R&D / 売上
    ws.getCell(R.RND_RATIO, col).value = { formula: `${c}${R.RND}/${c}$${R.REVENUE}` };

    // SGA比率 = SGA / 売上
    ws.getCell(R.SGA_RATIO, col).value = { formula: `${c}${R.SGA}/${c}$${R.REVENUE}` };

    // 営業費用比率 = 営業費用合計 / 売上
    ws.getCell(R.OPEX_RATIO, col).value = { formula: `${c}${R.OPEX_TOTAL}/${c}$${R.REVENUE}` };

    // 営業費用 YoY = 今期 / 前年同期 - 1
    if (yc) ws.getCell(R.OPEX_YOY, col).value = { formula: `${c}${R.OPEX_TOTAL}/${yc}${R.OPEX_TOTAL}-1` };

    // 営業利益率 = 営業利益 / 売上
    ws.getCell(R.OP_MARGIN, col).value = { formula: `${c}${R.OP_INCOME}/${c}$${R.REVENUE}` };

    // 営業利益 YoY = 今期 / 前年同期 - 1
    if (yc) ws.getCell(R.OP_YOY, col).value = { formula: `${c}${R.OP_INCOME}/${yc}${R.OP_INCOME}-1` };

    // 純利益率 = 純利益 / 売上
    if (d) ws.getCell(R.NET_MARGIN, col).value = { formula: `${c}${R.NET_INCOME}/${c}$${R.REVENUE}` };

    // 純利益 YoY = 今期 / 前年同期 - 1
    if (yc) ws.getCell(R.NET_YOY, col).value = { formula: `${c}${R.NET_INCOME}/${yc}${R.NET_INCOME}-1` };

    // 時価総額 = 株価 × 希薄化後株式数（百万ドル単位）
    if (d) ws.getCell(R.MARKET_CAP, col).value = { formula: `${c}${R.STOCK_PRICE}*${c}${R.SHARES_DILUTED}` };

    // PER（直近4Q EPS合計ベース）= 株価 / SUM(直近4Q EPS希薄化後)
    if (i >= 3) {
      const w = CL(col - 3);
      ws.getCell(R.PER_TTM, col).value = { formula: `${c}${R.STOCK_PRICE}/SUM(${w}${R.EPS_DILUTED}:${c}${R.EPS_DILUTED})` };
    }

    // PER 4Q移動平均
    if (i >= 6) {
      const w = CL(col - 3);
      ws.getCell(R.PER_AVG, col).value = { formula: `AVERAGE(${w}${R.PER_TTM}:${c}${R.PER_TTM})` };
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
