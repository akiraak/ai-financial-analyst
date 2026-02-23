// Appleの10-Q/10-KをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

const CIK = '320193';

// 10-Q/10-Kファイリング情報
// Apple会計年度: 10月〜9月（Q1-Q3は10-Q、Q4は10-K）
const filings = [
  // FY2021
  { fy: 'FY2021', q: 'Q1', form: '10-Q', adsh: '0000320193-21-000010', file: 'aapl-20201226.htm', date: '2021-01-28' },
  { fy: 'FY2021', q: 'Q2', form: '10-Q', adsh: '0000320193-21-000056', file: 'aapl-20210327.htm', date: '2021-04-29' },
  { fy: 'FY2021', q: 'Q3', form: '10-Q', adsh: '0000320193-21-000065', file: 'aapl-20210626.htm', date: '2021-07-28' },
  { fy: 'FY2021', q: 'Q4', form: '10-K', adsh: '0000320193-21-000105', file: 'aapl-20210925.htm', date: '2021-10-29' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', form: '10-Q', adsh: '0000320193-22-000007', file: 'aapl-20211225.htm', date: '2022-01-28' },
  { fy: 'FY2022', q: 'Q2', form: '10-Q', adsh: '0000320193-22-000059', file: 'aapl-20220326.htm', date: '2022-04-29' },
  { fy: 'FY2022', q: 'Q3', form: '10-Q', adsh: '0000320193-22-000070', file: 'aapl-20220625.htm', date: '2022-07-29' },
  { fy: 'FY2022', q: 'Q4', form: '10-K', adsh: '0000320193-22-000108', file: 'aapl-20220924.htm', date: '2022-10-28' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', form: '10-Q', adsh: '0000320193-23-000006', file: 'aapl-20221231.htm', date: '2023-02-03' },
  { fy: 'FY2023', q: 'Q2', form: '10-Q', adsh: '0000320193-23-000064', file: 'aapl-20230401.htm', date: '2023-05-05' },
  { fy: 'FY2023', q: 'Q3', form: '10-Q', adsh: '0000320193-23-000077', file: 'aapl-20230701.htm', date: '2023-08-04' },
  { fy: 'FY2023', q: 'Q4', form: '10-K', adsh: '0000320193-23-000106', file: 'aapl-20230930.htm', date: '2023-11-03' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', form: '10-Q', adsh: '0000320193-24-000006', file: 'aapl-20231230.htm', date: '2024-02-02' },
  { fy: 'FY2024', q: 'Q2', form: '10-Q', adsh: '0000320193-24-000069', file: 'aapl-20240330.htm', date: '2024-05-03' },
  { fy: 'FY2024', q: 'Q3', form: '10-Q', adsh: '0000320193-24-000081', file: 'aapl-20240629.htm', date: '2024-08-02' },
  { fy: 'FY2024', q: 'Q4', form: '10-K', adsh: '0000320193-24-000123', file: 'aapl-20240928.htm', date: '2024-11-01' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', form: '10-Q', adsh: '0000320193-25-000008', file: 'aapl-20241228.htm', date: '2025-01-31' },
  { fy: 'FY2025', q: 'Q2', form: '10-Q', adsh: '0000320193-25-000057', file: 'aapl-20250329.htm', date: '2025-05-02' },
  { fy: 'FY2025', q: 'Q3', form: '10-Q', adsh: '0000320193-25-000073', file: 'aapl-20250628.htm', date: '2025-08-01' },
  { fy: 'FY2025', q: 'Q4', form: '10-K', adsh: '0000320193-25-000079', file: 'aapl-20250927.htm', date: '2025-10-31' },
  // FY2026
  { fy: 'FY2026', q: 'Q1', form: '10-Q', adsh: '0000320193-26-000006', file: 'aapl-20251227.htm', date: '2026-01-30' },
];

const basePath = path.join(__dirname, '..', 'filings');

function buildEdgarUrl(adsh, filename) {
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${CIK}/${adshNoDashes}/${filename}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'AI-Financial-Analyst research@example.com' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

(async () => {
  console.log(`Apple 10-Q/10-K ダウンロード: ${filings.length}四半期分\n`);

  let success = 0, failed = 0;
  const errors = [];

  for (const f of filings) {
    const url = buildEdgarUrl(f.adsh, f.file);
    const destDir = path.join(basePath, f.fy, f.q);
    // Q1-Q3は10-Q、Q4は10-K
    const destName = f.form === '10-K' ? '10-K.htm' : '10-Q.htm';
    const dest = path.join(destDir, destName);

    if (fs.existsSync(dest)) {
      console.log(`[SKIP] ${f.fy} ${f.q} ${f.form} - 既にダウンロード済み`);
      success++;
      continue;
    }

    try {
      fs.mkdirSync(destDir, { recursive: true });
      await download(url, dest);
      const sizeKB = (fs.statSync(dest).size / 1024).toFixed(1);
      console.log(`[OK] ${f.fy} ${f.q} ${f.form} (${f.date}) - ${sizeKB} KB`);
      success++;
    } catch (err) {
      console.error(`[ERR] ${f.fy} ${f.q} ${f.form}: ${err.message}`);
      errors.push({ fy: f.fy, q: f.q, form: f.form, error: err.message, url });
      failed++;
    }

    // SEC EDGARのレートリミット対策
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);
  if (errors.length > 0) {
    console.log('失敗一覧:');
    errors.forEach(e => console.log(`  ${e.fy} ${e.q} ${e.form}: ${e.error}`));
  }
})();
