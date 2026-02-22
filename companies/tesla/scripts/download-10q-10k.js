// Tesla 10-Q/10-K をSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// Tesla, Inc. CIK: 1318605
const CIK = '1318605';

// 10-Q/10-K 提出情報
const filings = [
  // FY2020
  { fy: 'FY2020', q: 'Q1', form: '10-Q', adsh: '0001564590-20-019931', file: 'tsla-10q_20200331.htm', date: '2020-04-30' },
  { fy: 'FY2020', q: 'Q2', form: '10-Q', adsh: '0001564590-20-033670', file: 'tsla-10q_20200630.htm', date: '2020-07-28' },
  { fy: 'FY2020', q: 'Q3', form: '10-Q', adsh: '0001564590-20-047486', file: 'tsla-10q_20200930.htm', date: '2020-10-26' },
  { fy: 'FY2020', q: 'Q4', form: '10-K', adsh: '0001564590-21-004599', file: 'tsla-10k_20201231.htm', date: '2021-02-08' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', form: '10-Q', adsh: '0000950170-21-000046', file: 'tsla-20210331.htm', date: '2021-04-28' },
  { fy: 'FY2021', q: 'Q2', form: '10-Q', adsh: '0000950170-21-000524', file: 'tsla-20210630.htm', date: '2021-07-27' },
  { fy: 'FY2021', q: 'Q3', form: '10-Q', adsh: '0000950170-21-002253', file: 'tsla-20210930.htm', date: '2021-10-25' },
  { fy: 'FY2021', q: 'Q4', form: '10-K', adsh: '0000950170-22-000796', file: 'tsla-20211231.htm', date: '2022-02-07' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', form: '10-Q', adsh: '0000950170-22-006034', file: 'tsla-20220331.htm', date: '2022-04-25' },
  { fy: 'FY2022', q: 'Q2', form: '10-Q', adsh: '0000950170-22-012936', file: 'tsla-20220630.htm', date: '2022-07-25' },
  { fy: 'FY2022', q: 'Q3', form: '10-Q', adsh: '0000950170-22-019867', file: 'tsla-20220930.htm', date: '2022-10-24' },
  { fy: 'FY2022', q: 'Q4', form: '10-K', adsh: '0000950170-23-001409', file: 'tsla-20221231.htm', date: '2023-01-31' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', form: '10-Q', adsh: '0000950170-23-013890', file: 'tsla-20230331.htm', date: '2023-04-24' },
  { fy: 'FY2023', q: 'Q2', form: '10-Q', adsh: '0000950170-23-033872', file: 'tsla-20230630.htm', date: '2023-07-24' },
  { fy: 'FY2023', q: 'Q3', form: '10-Q', adsh: '0001628280-23-034847', file: 'tsla-20230930.htm', date: '2023-10-23' },
  { fy: 'FY2023', q: 'Q4', form: '10-K', adsh: '0001628280-24-002390', file: 'tsla-20231231.htm', date: '2024-01-29' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', form: '10-Q', adsh: '0001628280-24-017503', file: 'tsla-20240331.htm', date: '2024-04-24' },
  { fy: 'FY2024', q: 'Q2', form: '10-Q', adsh: '0001628280-24-032662', file: 'tsla-20240630.htm', date: '2024-07-24' },
  { fy: 'FY2024', q: 'Q3', form: '10-Q', adsh: '0001628280-24-043486', file: 'tsla-20240930.htm', date: '2024-10-24' },
  { fy: 'FY2024', q: 'Q4', form: '10-K', adsh: '0001628280-25-003063', file: 'tsla-20241231.htm', date: '2025-01-30' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', form: '10-Q', adsh: '0001628280-25-018911', file: 'tsla-20250331.htm', date: '2025-04-23' },
  { fy: 'FY2025', q: 'Q2', form: '10-Q', adsh: '0001628280-25-035806', file: 'tsla-20250630.htm', date: '2025-07-24' },
  { fy: 'FY2025', q: 'Q3', form: '10-Q', adsh: '0001628280-25-045968', file: 'tsla-20250930.htm', date: '2025-10-23' },
  { fy: 'FY2025', q: 'Q4', form: '10-K', adsh: '0001628280-26-003952', file: 'tsla-20251231.htm', date: '2026-01-29' },
];

const basePath = path.join(__dirname, '..', 'filings');

function buildEdgarUrl(adsh, filename) {
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${CIK}/${adshNoDashes}/${filename}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'financial-analyst admin@example.com' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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
    }).on('error', (err) => { file.close(); reject(err); });
  });
}

async function main() {
  let success = 0, failed = 0;
  console.log(`Tesla (TSLA) 10-Q/10-K取得: ${filings.length}四半期分\n`);

  for (const f of filings) {
    const dir = path.join(basePath, f.fy, f.q);
    fs.mkdirSync(dir, { recursive: true });

    const filename = f.form === '10-K' ? '10-K.htm' : '10-Q.htm';
    const dest = path.join(dir, filename);
    const url = buildEdgarUrl(f.adsh, f.file);

    try {
      await download(url, dest);
      const size = fs.statSync(dest).size;
      console.log(`[OK] ${f.fy} ${f.q} ${f.form} - ${(size / 1024).toFixed(0)} KB (${f.date})`);
      success++;
    } catch (err) {
      console.error(`[ERR] ${f.fy} ${f.q} ${f.form}: ${err.message}`);
      failed++;
    }

    // レートリミット対策
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);
}

main();
