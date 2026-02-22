// Metaの10-Q/10-KをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

const CIK = '1326801';

// 10-Q/10-Kファイリング情報
const filings = [
  // FY2020（Facebook時代）
  { fy: 'FY2020', q: 'Q1', form: '10-Q', adsh: '0001326801-20-000048', file: 'fb-03312020x10q.htm', date: '2020-04-30' },
  { fy: 'FY2020', q: 'Q2', form: '10-Q', adsh: '0001326801-20-000076', file: 'fb-06302020x10q.htm', date: '2020-07-31' },
  { fy: 'FY2020', q: 'Q3', form: '10-Q', adsh: '0001326801-20-000084', file: 'fb-09302020x10q.htm', date: '2020-10-30' },
  { fy: 'FY2020', q: 'Q4', form: '10-K', adsh: '0001326801-21-000014', file: 'fb-20201231.htm', date: '2021-01-28' },
  // FY2021（Facebook時代）
  { fy: 'FY2021', q: 'Q1', form: '10-Q', adsh: '0001326801-21-000033', file: 'fb-20210331.htm', date: '2021-04-29' },
  { fy: 'FY2021', q: 'Q2', form: '10-Q', adsh: '0001326801-21-000049', file: 'fb-20210630.htm', date: '2021-07-29' },
  { fy: 'FY2021', q: 'Q3', form: '10-Q', adsh: '0001326801-21-000065', file: 'fb-20210930.htm', date: '2021-10-26' },
  { fy: 'FY2021', q: 'Q4', form: '10-K', adsh: '0001326801-22-000018', file: 'fb-20211231.htm', date: '2022-02-03' },
  // FY2022（Meta時代）
  { fy: 'FY2022', q: 'Q1', form: '10-Q', adsh: '0001326801-22-000057', file: 'meta-20220331.htm', date: '2022-04-28' },
  { fy: 'FY2022', q: 'Q2', form: '10-Q', adsh: '0001326801-22-000082', file: 'meta-20220630.htm', date: '2022-07-28' },
  { fy: 'FY2022', q: 'Q3', form: '10-Q', adsh: '0001326801-22-000108', file: 'meta-20220930.htm', date: '2022-10-27' },
  { fy: 'FY2022', q: 'Q4', form: '10-K', adsh: '0001326801-23-000013', file: 'meta-20221231.htm', date: '2023-02-02' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', form: '10-Q', adsh: '0001326801-23-000067', file: 'meta-20230331.htm', date: '2023-04-27' },
  { fy: 'FY2023', q: 'Q2', form: '10-Q', adsh: '0001326801-23-000093', file: 'meta-20230630.htm', date: '2023-07-27' },
  { fy: 'FY2023', q: 'Q3', form: '10-Q', adsh: '0001326801-23-000103', file: 'meta-20230930.htm', date: '2023-10-26' },
  { fy: 'FY2023', q: 'Q4', form: '10-K', adsh: '0001326801-24-000012', file: 'meta-20231231.htm', date: '2024-02-02' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', form: '10-Q', adsh: '0001326801-24-000049', file: 'meta-20240331.htm', date: '2024-04-25' },
  { fy: 'FY2024', q: 'Q2', form: '10-Q', adsh: '0001326801-24-000069', file: 'meta-20240630.htm', date: '2024-08-01' },
  { fy: 'FY2024', q: 'Q3', form: '10-Q', adsh: '0001326801-24-000081', file: 'meta-20240930.htm', date: '2024-10-31' },
  { fy: 'FY2024', q: 'Q4', form: '10-K', adsh: '0001326801-25-000017', file: 'meta-20241231.htm', date: '2025-01-30' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', form: '10-Q', adsh: '0001326801-25-000054', file: 'meta-20250331.htm', date: '2025-05-01' },
  { fy: 'FY2025', q: 'Q2', form: '10-Q', adsh: '0001628280-25-036791', file: 'meta-20250630.htm', date: '2025-07-31' },
  { fy: 'FY2025', q: 'Q3', form: '10-Q', adsh: '0001628280-25-047240', file: 'meta-20250930.htm', date: '2025-10-30' },
  { fy: 'FY2025', q: 'Q4', form: '10-K', adsh: '0001628280-26-003942', file: 'meta-20251231.htm', date: '2026-01-29' },
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
  console.log(`Meta 10-Q/10-K ダウンロード: ${filings.length}四半期分\n`);

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
