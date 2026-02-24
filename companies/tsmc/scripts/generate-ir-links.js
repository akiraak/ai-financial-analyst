// TSMCの決算資料リンクを生成するスクリプト
// SEC EDGAR 6-K Filing へのリンクを ir-links.json に出力
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const OUTPUT = path.join(ROOT, 'docs/tsmc/ir-links.json');
const QUARTERLY_LINKS_PATH = path.join(__dirname, '..', 'data', 'quarterly-links.json');

// config.json から期間設定を読み込み
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = { pageYears: 2, chartYears: 4 };
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// download-filings.jsが出力したquarterly-links.jsonからリンク情報を読み込む
const quarterlyLinks = fs.existsSync(QUARTERLY_LINKS_PATH)
  ? JSON.parse(fs.readFileSync(QUARTERLY_LINKS_PATH, 'utf-8'))
  : [];

// TSMC IR サイトの直接リンク
const IR_BASE = 'https://investor.tsmc.com/english/quarterly-results';

// SEC EDGAR Filing Index へのリンク
function getEdgarFilingUrl(adsh) {
  if (!adsh) return null;
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/1046179/${adshNoDashes}/`;
}

// download-filings.jsのfilings配列からadshを引くためのマッピング
const filingAdsh = {
  'FY2020/Q1': '0001564590-20-016960',
  'FY2020/Q2': '0001564590-20-032443',
  'FY2020/Q3': '0001564590-20-046453',
  'FY2020/Q4': '0001564590-21-001132',
  'FY2021/Q1': '0001564590-21-018896',
  'FY2021/Q2': '0001564590-21-036625',
  'FY2021/Q3': '0001564590-21-050767',
  'FY2021/Q4': '0001564590-22-001132',
  'FY2022/Q1': '0001564590-22-014381',
  'FY2022/Q2': '0001564590-22-025726',
  'FY2022/Q3': '0001564590-22-034145',
  'FY2022/Q4': '0001564590-23-000363',
  'FY2023/Q1': '0001628280-23-012121',
  'FY2023/Q2': '0001628280-23-025146',
  'FY2023/Q3': '0001046179-23-000014',
  'FY2023/Q4': '0001046179-24-000005',
  'FY2024/Q1': '0001046179-24-000046',
  'FY2024/Q2': '0001046179-24-000083',
  'FY2024/Q3': '0001046179-24-000116',
  'FY2024/Q4': '0001046179-25-000004',
  'FY2025/Q1': '0001046179-25-000035',
  'FY2025/Q2': '0001046179-25-000082',
  'FY2025/Q3': '0001046179-25-000116',
  'FY2025/Q4': '0001046179-26-000008',
};

// 出力データ構築
const irLinks = [];
const totalQuarters = (config.pageYears + config.chartYears) * 4;

// quarterly-linksから対象期間のリンクを構築
const entries = quarterlyLinks.length > 0 ? quarterlyLinks : [];
const targetEntries = entries.length <= totalQuarters
  ? entries
  : entries.slice(entries.length - totalQuarters);

for (const entry of targetEntries) {
  const key = `${entry.fy}/${entry.q}`;
  const adsh = filingAdsh[key];

  irLinks.push({
    fy: entry.fy,
    q: entry.q,
    date: entry.date,
    pressRelease: entry.pressReleaseUrl || null,
    presentation: entry.presentationUrl || null,
    filing: adsh ? getEdgarFilingUrl(adsh) : null,
    irPage: IR_BASE,
  });
}

// 四半期の新しい順に並べ替え（Q4→Q1）
irLinks.sort((a, b) => {
  const fyA = parseInt(a.fy.replace('FY', ''));
  const fyB = parseInt(b.fy.replace('FY', ''));
  if (fyA !== fyB) return fyB - fyA;
  return parseInt(b.q.replace('Q', '')) - parseInt(a.q.replace('Q', ''));
});

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(irLinks, null, 2));
console.log(`出力: ${OUTPUT} (${irLinks.length} 四半期分のリンク)`);
