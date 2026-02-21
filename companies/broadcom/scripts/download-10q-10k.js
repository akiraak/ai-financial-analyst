// Broadcomの10-Q/10-KをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

const CIK = '1730168';

// 10-Q/10-Kファイリング情報
const filings = [
  { fy: 'FY2020', q: 'Q1', form: '10-Q', adsh: '0001730168-20-000045', file: 'avgo-02022020x10q.htm', date: '2020-03-13' },
  { fy: 'FY2020', q: 'Q2', form: '10-Q', adsh: '0001730168-20-000109', file: 'avgo-20200503.htm', date: '2020-06-12' },
  { fy: 'FY2020', q: 'Q3', form: '10-Q', adsh: '0001730168-20-000164', file: 'avgo-20200802.htm', date: '2020-09-11' },
  { fy: 'FY2020', q: 'Q4', form: '10-K', adsh: '0001730168-20-000226', file: 'avgo-20201101.htm', date: '2020-12-18' },
  { fy: 'FY2021', q: 'Q1', form: '10-Q', adsh: '0001730168-21-000045', file: 'avgo-20210131.htm', date: '2021-03-12' },
  { fy: 'FY2021', q: 'Q2', form: '10-Q', adsh: '0001730168-21-000116', file: 'avgo-20210502.htm', date: '2021-06-11' },
  { fy: 'FY2021', q: 'Q3', form: '10-Q', adsh: '0001730168-21-000123', file: 'avgo-20210801.htm', date: '2021-09-09' },
  { fy: 'FY2021', q: 'Q4', form: '10-K', adsh: '0001730168-21-000153', file: 'avgo-20211031.htm', date: '2021-12-17' },
  { fy: 'FY2022', q: 'Q1', form: '10-Q', adsh: '0001730168-22-000029', file: 'avgo-20220130.htm', date: '2022-03-10' },
  { fy: 'FY2022', q: 'Q2', form: '10-Q', adsh: '0001730168-22-000081', file: 'avgo-20220501.htm', date: '2022-06-09' },
  { fy: 'FY2022', q: 'Q3', form: '10-Q', adsh: '0001730168-22-000094', file: 'avgo-20220731.htm', date: '2022-09-08' },
  { fy: 'FY2022', q: 'Q4', form: '10-K', adsh: '0001730168-22-000118', file: 'avgo-20221030.htm', date: '2022-12-16' },
  { fy: 'FY2023', q: 'Q1', form: '10-Q', adsh: '0001730168-23-000008', file: 'avgo-20230129.htm', date: '2023-03-08' },
  { fy: 'FY2023', q: 'Q2', form: '10-Q', adsh: '0001730168-23-000064', file: 'avgo-20230430.htm', date: '2023-06-07' },
  { fy: 'FY2023', q: 'Q3', form: '10-Q', adsh: '0001730168-23-000077', file: 'avgo-20230730.htm', date: '2023-09-06' },
  { fy: 'FY2023', q: 'Q4', form: '10-K', adsh: '0001730168-23-000096', file: 'avgo-20231029.htm', date: '2023-12-14' },
  { fy: 'FY2024', q: 'Q1', form: '10-Q', adsh: '0001730168-24-000023', file: 'avgo-20240204.htm', date: '2024-03-14' },
  { fy: 'FY2024', q: 'Q2', form: '10-Q', adsh: '0001730168-24-000080', file: 'avgo-20240505.htm', date: '2024-06-13' },
  { fy: 'FY2024', q: 'Q3', form: '10-Q', adsh: '0001730168-24-000099', file: 'avgo-20240804.htm', date: '2024-09-11' },
  { fy: 'FY2024', q: 'Q4', form: '10-K', adsh: '0001730168-24-000139', file: 'avgo-20241103.htm', date: '2024-12-20' },
  { fy: 'FY2025', q: 'Q1', form: '10-Q', adsh: '0001730168-25-000021', file: 'avgo-20250202.htm', date: '2025-03-12' },
  { fy: 'FY2025', q: 'Q2', form: '10-Q', adsh: '0001730168-25-000064', file: 'avgo-20250504.htm', date: '2025-06-11' },
  { fy: 'FY2025', q: 'Q3', form: '10-Q', adsh: '0001730168-25-000098', file: 'avgo-20250803.htm', date: '2025-09-10' },
  { fy: 'FY2025', q: 'Q4', form: '10-K', adsh: '0001730168-25-000121', file: 'avgo-20251102.htm', date: '2025-12-18' },
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
  console.log(`Broadcom 10-Q/10-K ダウンロード: ${filings.length}四半期分\n`);

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
