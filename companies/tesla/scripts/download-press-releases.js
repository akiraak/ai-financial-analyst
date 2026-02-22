// Tesla決算プレスリリースをSEC EDGARからダウンロードするスクリプト
// 8-K Exhibit 99.1（決算プレスリリース）を取得
const fs = require('fs');
const path = require('path');
const https = require('https');

// Tesla, Inc. CIK: 1318605
const CIK = '1318605';

// 対象四半期のプレスリリース情報（SEC EDGAR 8-K EX-99.1）
const filings = [
  // FY2020
  { fy: 'FY2020', q: 'Q1', adsh: '0001564590-20-019776', file: 'tsla-ex9901_96.htm', date: '2020-04-29' },
  { fy: 'FY2020', q: 'Q2', adsh: '0001564590-20-033069', file: 'tsla-ex991_63.htm', date: '2020-07-22' },
  { fy: 'FY2020', q: 'Q3', adsh: '0001564590-20-047108', file: 'tsla-ex991_57.htm', date: '2020-10-21' },
  { fy: 'FY2020', q: 'Q4', adsh: '0001564590-21-002645', file: 'tsla-ex991_99.htm', date: '2021-01-27' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', adsh: '0001564590-21-020558', file: 'tsla-ex99_136.htm', date: '2021-04-26' },
  { fy: 'FY2021', q: 'Q2', adsh: '0001564590-21-037953', file: 'tsla-ex991_89.htm', date: '2021-07-26' },
  { fy: 'FY2021', q: 'Q3', adsh: '0001564590-21-051307', file: 'tsla-ex991_85.htm', date: '2021-10-20' },
  { fy: 'FY2021', q: 'Q4', adsh: '0001564590-22-002476', file: 'tsla-ex991_209.htm', date: '2022-01-26' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', adsh: '0001564590-22-014917', file: 'tsla-ex991_151.htm', date: '2022-04-20' },
  { fy: 'FY2022', q: 'Q2', adsh: '0001564590-22-026048', file: 'tsla-ex991_130.htm', date: '2022-07-20' },
  { fy: 'FY2022', q: 'Q3', adsh: '0001564590-22-034639', file: 'tsla-ex991_89.htm', date: '2022-10-19' },
  { fy: 'FY2022', q: 'Q4', adsh: '0001564590-23-000799', file: 'tsla-ex991_127.htm', date: '2023-01-25' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', adsh: '0001564590-23-005959', file: 'tsla-ex991_99.htm', date: '2023-04-19' },
  { fy: 'FY2023', q: 'Q2', adsh: '0000950170-23-033544', file: 'tsla-ex99_1.htm', date: '2023-07-19' },
  { fy: 'FY2023', q: 'Q3', adsh: '0001628280-23-034588', file: 'exhibit991.htm', date: '2023-10-18' },
  { fy: 'FY2023', q: 'Q4', adsh: '0000950170-24-007073', file: 'tsla-ex99_1.htm', date: '2024-01-24' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', adsh: '0000950170-24-046895', file: 'tsla-ex99_1.htm', date: '2024-04-23' },
  { fy: 'FY2024', q: 'Q2', adsh: '0001628280-24-032603', file: 'exhibit.htm', date: '2024-07-23' },
  { fy: 'FY2024', q: 'Q3', adsh: '0001628280-24-043432', file: 'exhibit.htm', date: '2024-10-23' },
  { fy: 'FY2024', q: 'Q4', adsh: '0001628280-25-002993', file: 'exhibit991.htm', date: '2025-01-29' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', adsh: '0001628280-25-018851', file: 'exhbit991.htm', date: '2025-04-22' },
  { fy: 'FY2025', q: 'Q2', adsh: '0001628280-25-035738', file: 'exhibit991.htm', date: '2025-07-23' },
  { fy: 'FY2025', q: 'Q3', adsh: '0001628280-25-045861', file: 'exhibit991.htm', date: '2025-10-22' },
  { fy: 'FY2025', q: 'Q4', adsh: '0001628280-26-003837', file: 'exhibit991.htm', date: '2026-01-28' },
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
  console.log(`Tesla (TSLA) プレスリリース取得: ${filings.length}四半期分\n`);

  for (const f of filings) {
    const dir = path.join(basePath, f.fy, f.q);
    fs.mkdirSync(dir, { recursive: true });

    const dest = path.join(dir, 'press-release.html');
    const url = buildEdgarUrl(f.adsh, f.file);

    try {
      await download(url, dest);
      const size = fs.statSync(dest).size;
      console.log(`[OK] ${f.fy} ${f.q} - ${(size / 1024).toFixed(0)} KB (${f.date})`);
      success++;
    } catch (err) {
      console.error(`[ERR] ${f.fy} ${f.q}: ${err.message}`);
      failed++;
    }

    // レートリミット対策
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);
}

main();
