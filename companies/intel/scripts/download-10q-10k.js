// Intel 10-Q/10-K をSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// Intel Corporation CIK: 50863
const CIK = '50863';

// 10-Q/10-K 提出情報
const filings = [
  // FY2020
  { fy: 'FY2020', q: 'Q1', form: '10-Q', adsh: '0000050863-20-000017', file: 'a0328202010qdocument-u.htm', date: '2020-04-24' },
  { fy: 'FY2020', q: 'Q2', form: '10-Q', adsh: '0000050863-20-000026', file: 'intc-20200627.htm', date: '2020-07-24' },
  { fy: 'FY2020', q: 'Q3', form: '10-Q', adsh: '0000050863-20-000043', file: 'intc-20200926.htm', date: '2020-10-23' },
  { fy: 'FY2020', q: 'Q4', form: '10-K', adsh: '0000050863-21-000010', file: 'intc-20201226.htm', date: '2021-01-22' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', form: '10-Q', adsh: '0000050863-21-000018', file: 'intc-20210327.htm', date: '2021-04-23' },
  { fy: 'FY2021', q: 'Q2', form: '10-Q', adsh: '0000050863-21-000030', file: 'intc-20210626.htm', date: '2021-07-23' },
  { fy: 'FY2021', q: 'Q3', form: '10-Q', adsh: '0000050863-21-000038', file: 'intc-20210925.htm', date: '2021-10-22' },
  { fy: 'FY2021', q: 'Q4', form: '10-K', adsh: '0000050863-22-000007', file: 'intc-20211225.htm', date: '2022-01-27' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', form: '10-Q', adsh: '0000050863-22-000020', file: 'intc-20220402.htm', date: '2022-04-29' },
  { fy: 'FY2022', q: 'Q2', form: '10-Q', adsh: '0000050863-22-000030', file: 'intc-20220702.htm', date: '2022-07-29' },
  { fy: 'FY2022', q: 'Q3', form: '10-Q', adsh: '0000050863-22-000038', file: 'intc-20221001.htm', date: '2022-10-28' },
  { fy: 'FY2022', q: 'Q4', form: '10-K', adsh: '0000050863-23-000006', file: 'intc-20221231.htm', date: '2023-01-27' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', form: '10-Q', adsh: '0000050863-23-000028', file: 'intc-20230401.htm', date: '2023-04-28' },
  { fy: 'FY2023', q: 'Q2', form: '10-Q', adsh: '0000050863-23-000069', file: 'intc-20230701.htm', date: '2023-07-28' },
  { fy: 'FY2023', q: 'Q3', form: '10-Q', adsh: '0000050863-23-000103', file: 'intc-20230930.htm', date: '2023-10-27' },
  { fy: 'FY2023', q: 'Q4', form: '10-K', adsh: '0000050863-24-000010', file: 'intc-20231230.htm', date: '2024-01-26' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', form: '10-Q', adsh: '0000050863-24-000076', file: 'intc-20240330.htm', date: '2024-04-26' },
  { fy: 'FY2024', q: 'Q2', form: '10-Q', adsh: '0000050863-24-000124', file: 'intc-20240629.htm', date: '2024-08-02' },
  { fy: 'FY2024', q: 'Q3', form: '10-Q', adsh: '0000050863-24-000149', file: 'intc-20240928.htm', date: '2024-11-01' },
  { fy: 'FY2024', q: 'Q4', form: '10-K', adsh: '0000050863-25-000009', file: 'intc-20241228.htm', date: '2025-01-31' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', form: '10-Q', adsh: '0000050863-25-000074', file: 'intc-20250329.htm', date: '2025-04-25' },
  { fy: 'FY2025', q: 'Q2', form: '10-Q', adsh: '0000050863-25-000109', file: 'intc-20250628.htm', date: '2025-07-24' },
  { fy: 'FY2025', q: 'Q3', form: '10-Q', adsh: '0000050863-25-000179', file: 'intc-20250927.htm', date: '2025-11-06' },
  { fy: 'FY2025', q: 'Q4', form: '10-K', adsh: '0000050863-26-000011', file: 'intc-20251227.htm', date: '2026-01-23' },
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
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

(async () => {
  console.log(`Intel 10-Q/10-K ダウンロード: ${filings.length}件\n`);

  let success = 0, failed = 0;
  for (const f of filings) {
    const url = buildEdgarUrl(f.adsh, f.file);
    const destDir = path.join(basePath, f.fy, f.q);
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
      failed++;
    }

    // SEC EDGARのレートリミット対策（150ms待機）
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);
})();
