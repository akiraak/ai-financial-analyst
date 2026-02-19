// SEC EDGARから10-Q/10-KをダウンロードしてPDFに変換するスクリプト
// 1. curlでHTMファイルをダウンロード
// 2. PlaywrightでローカルHTMをPDFにレンダリング
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

// config.json から期間設定を読み込み
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = { pageYears: 2, chartYears: 2 };
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
const downloadYears = config.pageYears + config.chartYears;

// 10-Q/10-Kのフィリング情報（SEC EDGAR XBRL APIから取得済み）
const filings = [
  { fy: 'FY2021', q: 'Q1', type: '10-Q', adsh: '0001045810-20-000065', file: 'nvda-20200426.htm', date: '2020-05-21' },
  { fy: 'FY2021', q: 'Q2', type: '10-Q', adsh: '0001045810-20-000147', file: 'nvda-20200726.htm', date: '2020-08-19' },
  { fy: 'FY2021', q: 'Q3', type: '10-Q', adsh: '0001045810-20-000189', file: 'nvda-20201025.htm', date: '2020-11-18' },
  { fy: 'FY2021', q: 'Q4', type: '10-K', adsh: '0001045810-21-000010', file: 'nvda-20210131.htm', date: '2021-02-26' },
  { fy: 'FY2022', q: 'Q1', type: '10-Q', adsh: '0001045810-21-000064', file: 'nvda-20210502.htm', date: '2021-05-26' },
  { fy: 'FY2022', q: 'Q2', type: '10-Q', adsh: '0001045810-21-000131', file: 'nvda-20210801.htm', date: '2021-08-20' },
  { fy: 'FY2022', q: 'Q3', type: '10-Q', adsh: '0001045810-21-000163', file: 'nvda-20211031.htm', date: '2021-11-22' },
  { fy: 'FY2022', q: 'Q4', type: '10-K', adsh: '0001045810-22-000036', file: 'nvda-20220130.htm', date: '2022-03-18' },
  { fy: 'FY2023', q: 'Q1', type: '10-Q', adsh: '0001045810-22-000079', file: 'nvda-20220501.htm', date: '2022-05-27' },
  { fy: 'FY2023', q: 'Q2', type: '10-Q', adsh: '0001045810-22-000147', file: 'nvda-20220731.htm', date: '2022-08-31' },
  { fy: 'FY2023', q: 'Q3', type: '10-Q', adsh: '0001045810-22-000166', file: 'nvda-20221030.htm', date: '2022-11-18' },
  { fy: 'FY2023', q: 'Q4', type: '10-K', adsh: '0001045810-23-000017', file: 'nvda-20230129.htm', date: '2023-02-24' },
  { fy: 'FY2024', q: 'Q1', type: '10-Q', adsh: '0001045810-23-000093', file: 'nvda-20230430.htm', date: '2023-05-26' },
  { fy: 'FY2024', q: 'Q2', type: '10-Q', adsh: '0001045810-23-000175', file: 'nvda-20230730.htm', date: '2023-08-28' },
  { fy: 'FY2024', q: 'Q3', type: '10-Q', adsh: '0001045810-23-000227', file: 'nvda-20231029.htm', date: '2023-11-21' },
  { fy: 'FY2024', q: 'Q4', type: '10-K', adsh: '0001045810-24-000029', file: 'nvda-20240128.htm', date: '2024-02-21' },
  { fy: 'FY2025', q: 'Q1', type: '10-Q', adsh: '0001045810-24-000124', file: 'nvda-20240428.htm', date: '2024-05-29' },
  { fy: 'FY2025', q: 'Q2', type: '10-Q', adsh: '0001045810-24-000264', file: 'nvda-20240728.htm', date: '2024-08-28' },
  { fy: 'FY2025', q: 'Q3', type: '10-Q', adsh: '0001045810-24-000316', file: 'nvda-20241027.htm', date: '2024-11-20' },
  { fy: 'FY2025', q: 'Q4', type: '10-K', adsh: '0001045810-25-000023', file: 'nvda-20250126.htm', date: '2025-02-26' },
  { fy: 'FY2026', q: 'Q1', type: '10-Q', adsh: '0001045810-25-000116', file: 'nvda-20250427.htm', date: '2025-05-28' },
  { fy: 'FY2026', q: 'Q2', type: '10-Q', adsh: '0001045810-25-000209', file: 'nvda-20250727.htm', date: '2025-08-27' },
  { fy: 'FY2026', q: 'Q3', type: '10-Q', adsh: '0001045810-25-000230', file: 'nvda-20251026.htm', date: '2025-11-19' },
];

function buildEdgarUrl(adsh, filename) {
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/1045810/${adshNoDashes}/${filename}`;
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

    // PDFが既に存在し、40KB超ならスキップ（40KB以下はエラーページの可能性）
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

      // HTMファイルを削除（PDFが正常に生成されたら不要）
      fs.unlinkSync(f.htmPath);
    } catch (err) {
      console.error(`✗ ${f.fy} ${f.q} (${f.type}): 変換エラー - ${err.message}`);
    }
  }

  await browser.close();
  console.log('\n完了');
})();
