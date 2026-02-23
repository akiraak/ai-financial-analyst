// AppleのプレスリリースをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// Apple Inc CIK: 320193
const CIK = '320193';

// 対象四半期のプレスリリース情報（SEC EDGAR 8-K EX-99.1）
// Apple会計年度: 10月〜9月（例: FY2026 Q1 = 2025年10月〜12月）
const filings = [
  // FY2021
  { fy: 'FY2021', q: 'Q1', adsh: '0000320193-21-000009', file: 'a8-kex991q1202112262020.htm', date: '2021-01-27' },
  { fy: 'FY2021', q: 'Q2', adsh: '0000320193-21-000055', file: 'a8-kex991q2202103272021.htm', date: '2021-04-28' },
  { fy: 'FY2021', q: 'Q3', adsh: '0000320193-21-000063', file: 'a8-kex991q3202106262021.htm', date: '2021-07-27' },
  { fy: 'FY2021', q: 'Q4', adsh: '0000320193-21-000104', file: 'a8-kex991q4202109252021.htm', date: '2021-10-28' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', adsh: '0000320193-22-000006', file: 'a8-kex991q1202212252021.htm', date: '2022-01-27' },
  { fy: 'FY2022', q: 'Q2', adsh: '0000320193-22-000058', file: 'a8-kex991q2202203262022.htm', date: '2022-04-28' },
  { fy: 'FY2022', q: 'Q3', adsh: '0000320193-22-000069', file: 'a8-kex991q3202206252022.htm', date: '2022-07-28' },
  { fy: 'FY2022', q: 'Q4', adsh: '0000320193-22-000107', file: 'a8-kex991q4202209242022.htm', date: '2022-10-27' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', adsh: '0000320193-23-000005', file: 'a8-kex991q1202312312022.htm', date: '2023-02-02' },
  { fy: 'FY2023', q: 'Q2', adsh: '0000320193-23-000063', file: 'a8-kex991q2202304012023.htm', date: '2023-05-04' },
  { fy: 'FY2023', q: 'Q3', adsh: '0000320193-23-000075', file: 'a8-kex991q3202307012023.htm', date: '2023-08-03' },
  { fy: 'FY2023', q: 'Q4', adsh: '0000320193-23-000104', file: 'a8-kex991q4202309302023.htm', date: '2023-11-02' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', adsh: '0000320193-24-000005', file: 'a8-kex991q1202412302023.htm', date: '2024-02-01' },
  { fy: 'FY2024', q: 'Q2', adsh: '0000320193-24-000067', file: 'a8-kex991q2202403302024.htm', date: '2024-05-02' },
  { fy: 'FY2024', q: 'Q3', adsh: '0000320193-24-000080', file: 'a8-kex991q3202406292024.htm', date: '2024-08-01' },
  { fy: 'FY2024', q: 'Q4', adsh: '0000320193-24-000120', file: 'a8-kex991q4202409282024.htm', date: '2024-10-31' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', adsh: '0000320193-25-000007', file: 'a8-kex991q1202512282024.htm', date: '2025-01-30' },
  { fy: 'FY2025', q: 'Q2', adsh: '0000320193-25-000055', file: 'a8-kex991q2202503292025.htm', date: '2025-05-01' },
  { fy: 'FY2025', q: 'Q3', adsh: '0000320193-25-000071', file: 'a8-kex991q3202506282025.htm', date: '2025-07-31' },
  { fy: 'FY2025', q: 'Q4', adsh: '0000320193-25-000077', file: 'a8-kex991q4202509272025.htm', date: '2025-10-30' },
  // FY2026
  { fy: 'FY2026', q: 'Q1', adsh: '0000320193-26-000005', file: 'a8-kex991q1202612272025.htm', date: '2026-01-29' },
];

const basePath = path.join(__dirname, '..', 'filings');

function buildEdgarUrl(adsh, filename) {
  // EDGAR URL: https://www.sec.gov/Archives/edgar/data/{CIK}/{adsh_no_dashes}/{filename}
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
  console.log(`Apple プレスリリースダウンロード: ${filings.length}四半期分\n`);

  let success = 0, failed = 0;
  for (const f of filings) {
    const url = buildEdgarUrl(f.adsh, f.file);
    const destDir = path.join(basePath, f.fy, f.q);
    const dest = path.join(destDir, 'press-release.htm');

    // 既にダウンロード済みならスキップ
    if (fs.existsSync(dest)) {
      console.log(`[SKIP] ${f.fy} ${f.q} - 既にダウンロード済み`);
      success++;
      continue;
    }

    try {
      fs.mkdirSync(destDir, { recursive: true });
      await download(url, dest);
      const sizeKB = (fs.statSync(dest).size / 1024).toFixed(1);
      console.log(`[OK] ${f.fy} ${f.q} (${f.date}) - ${sizeKB} KB`);
      success++;
    } catch (err) {
      console.error(`[ERR] ${f.fy} ${f.q}: ${err.message}`);
      failed++;
    }

    // SEC EDGARのレートリミット対策（100ms待機）
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);

  // リンク情報をJSONに保存
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  const linksData = filings.map(f => ({
    ...f,
    url: buildEdgarUrl(f.adsh, f.file),
    localPath: `${f.fy}/${f.q}/press-release.htm`
  }));
  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'quarterly-links.json'),
    JSON.stringify(linksData, null, 2)
  );
  console.log('リンク情報を quarterly-links.json に保存しました');
})();
