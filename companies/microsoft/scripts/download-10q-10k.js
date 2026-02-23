// SEC EDGARからMicrosoftの10-Q/10-KをダウンロードしてPDFに変換するスクリプト
// 1. curlでHTMファイルをダウンロード
// 2. PlaywrightでローカルHTMをPDFにレンダリング
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

// config.json から期間設定を読み込み
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = { pageYears: 2, chartYears: 4 };
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
const downloadYears = config.pageYears + config.chartYears;

// 10-Q/10-Kのフィリング情報（SEC EDGAR）
const filings = [
  { fy: 'FY2021', q: 'Q1', type: '10-Q', adsh: '0001564590-20-047996', file: 'msft-10q_20200930.htm', date: '2020-10-27' },
  { fy: 'FY2021', q: 'Q2', type: '10-Q', adsh: '0001564590-21-002316', file: 'msft-10q_20201231.htm', date: '2021-01-26' },
  { fy: 'FY2021', q: 'Q3', type: '10-Q', adsh: '0001564590-21-020891', file: 'msft-10q_20210331.htm', date: '2021-04-27' },
  { fy: 'FY2021', q: 'Q4', type: '10-K', adsh: '0001564590-21-039151', file: 'msft-10k_20210630.htm', date: '2021-07-29' },
  { fy: 'FY2022', q: 'Q1', type: '10-Q', adsh: '0001564590-21-051992', file: 'msft-10q_20210930.htm', date: '2021-10-26' },
  { fy: 'FY2022', q: 'Q2', type: '10-Q', adsh: '0001564590-22-002324', file: 'msft-10q_20211231.htm', date: '2022-01-25' },
  { fy: 'FY2022', q: 'Q3', type: '10-Q', adsh: '0001564590-22-015675', file: 'msft-10q_20220331.htm', date: '2022-04-26' },
  { fy: 'FY2022', q: 'Q4', type: '10-K', adsh: '0001564590-22-026876', file: 'msft-10k_20220630.htm', date: '2022-07-28' },
  { fy: 'FY2023', q: 'Q1', type: '10-Q', adsh: '0001564590-22-035087', file: 'msft-10q_20220930.htm', date: '2022-10-25' },
  { fy: 'FY2023', q: 'Q2', type: '10-Q', adsh: '0001564590-23-000733', file: 'msft-10q_20221231.htm', date: '2023-01-24' },
  { fy: 'FY2023', q: 'Q3', type: '10-Q', adsh: '0000950170-23-014423', file: 'msft-20230331.htm', date: '2023-04-25' },
  { fy: 'FY2023', q: 'Q4', type: '10-K', adsh: '0000950170-23-035122', file: 'msft-20230630.htm', date: '2023-07-27' },
  { fy: 'FY2024', q: 'Q1', type: '10-Q', adsh: '0000950170-23-054855', file: 'msft-20230930.htm', date: '2023-10-24' },
  { fy: 'FY2024', q: 'Q2', type: '10-Q', adsh: '0000950170-24-008814', file: 'msft-20231231.htm', date: '2024-01-30' },
  { fy: 'FY2024', q: 'Q3', type: '10-Q', adsh: '0000950170-24-048288', file: 'msft-20240331.htm', date: '2024-04-25' },
  { fy: 'FY2024', q: 'Q4', type: '10-K', adsh: '0000950170-24-087843', file: 'msft-20240630.htm', date: '2024-07-30' },
  { fy: 'FY2025', q: 'Q1', type: '10-Q', adsh: '0000950170-24-118967', file: 'msft-20240930.htm', date: '2024-10-30' },
  { fy: 'FY2025', q: 'Q2', type: '10-Q', adsh: '0000950170-25-010491', file: 'msft-20241231.htm', date: '2025-01-29' },
  { fy: 'FY2025', q: 'Q3', type: '10-Q', adsh: '0000950170-25-061046', file: 'msft-20250331.htm', date: '2025-04-30' },
  { fy: 'FY2025', q: 'Q4', type: '10-K', adsh: '0000950170-25-100235', file: 'msft-20250630.htm', date: '2025-07-30' },
  { fy: 'FY2026', q: 'Q1', type: '10-Q', adsh: '0001193125-25-256321', file: 'msft-20250930.htm', date: '2025-10-29' },
  { fy: 'FY2026', q: 'Q2', type: '10-Q', adsh: '0001193125-26-027207', file: 'msft-20251231.htm', date: '2026-01-28' },
];

function buildEdgarUrl(adsh, filename) {
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/789019/${adshNoDashes}/${filename}`;
}

// curlでHTMファイルをダウンロード
function downloadHtm(url, destPath) {
  execSync(`curl -s -o "${destPath}" -H "User-Agent: AI-Financial-Analyst research@example.com" -H "Accept-Encoding: gzip, deflate" --compressed -L "${url}"`, {
    timeout: 60000,
  });
}

(async () => {
  // DL対象をconfig設定に基づいてフィルタリング
  const maxQuarters = downloadYears * 4;
  const targetFilings = filings.length <= maxQuarters
    ? filings
    : filings.slice(filings.length - maxQuarters);

  console.log(`設定: pageYears=${config.pageYears}, chartYears=${config.chartYears}, DL対象=${downloadYears}年分 (${targetFilings.length}四半期)\n`);

  // ステップ1: curlで全HTMをダウンロード
  console.log('=== ステップ1: HTMダウンロード ===\n');
  const htmFiles = [];
  for (const f of targetFilings) {
    const url = buildEdgarUrl(f.adsh, f.file);
    const destDir = path.join(__dirname, '..', 'filings', f.fy, f.q);
    const pdfName = f.type === '10-K' ? '10-K.pdf' : '10-Q.pdf';
    const pdfPath = path.join(destDir, pdfName);
    const htmPath = path.join(destDir, f.file);

    // PDFが既に存在し、40KB超ならスキップ
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 40000) {
      console.log(`⏭ ${f.fy} ${f.q} (${f.type}): PDF既に存在 - スキップ`);
      continue;
    }

    fs.mkdirSync(destDir, { recursive: true });

    try {
      downloadHtm(url, htmPath);
      const size = (fs.statSync(htmPath).size / 1024).toFixed(0);
      console.log(`✓ ${f.fy} ${f.q} (${f.type}): HTMダウンロード ${size}KB`);
      htmFiles.push({ ...f, htmPath, pdfPath, destDir });
    } catch (err) {
      console.error(`✗ ${f.fy} ${f.q} (${f.type}): DLエラー - ${err.message}`);
    }

    // SEC EDGARレートリミット対策
    await new Promise(r => setTimeout(r, 150));
  }

  // ステップ2: PlaywrightでHTMをPDFに変換
  console.log('\n=== ステップ2: PDF変換 ===\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  for (const f of htmFiles) {
    try {
      const page = await context.newPage();
      await page.goto(`file://${f.htmPath}`, { waitUntil: 'load', timeout: 30000 });
      await page.pdf({
        path: f.pdfPath,
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
      });
      await page.close();
      const size = (fs.statSync(f.pdfPath).size / 1024 / 1024).toFixed(1);
      console.log(`✓ ${f.fy} ${f.q} (${f.type}): PDF変換完了 ${size}MB`);

      // HTMファイルを削除
      fs.unlinkSync(f.htmPath);
    } catch (err) {
      console.error(`✗ ${f.fy} ${f.q} (${f.type}): 変換エラー - ${err.message}`);
    }
  }

  await browser.close();
  console.log('\n完了');
})();
