// MetaのプレスリリースをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// Meta Platforms CIK: 1326801
const CIK = '1326801';

// 対象四半期のプレスリリース情報（SEC EDGAR 8-K EX-99.1）
const filings = [
  // FY2020（Facebook時代）
  { fy: 'FY2020', q: 'Q1', adsh: '0001326801-20-000046', file: 'fb-03312020xexhibit991.htm', date: '2020-04-29' },
  { fy: 'FY2020', q: 'Q2', adsh: '0001326801-20-000073', file: 'fb-06302020xexhibit991.htm', date: '2020-07-30' },
  { fy: 'FY2020', q: 'Q3', adsh: '0001326801-20-000081', file: 'fb-09302020xexhibit991.htm', date: '2020-10-29' },
  { fy: 'FY2020', q: 'Q4', adsh: '0001326801-21-000011', file: 'fb-12312020xexhibit991.htm', date: '2021-01-27' },
  // FY2021（Facebook時代）
  { fy: 'FY2021', q: 'Q1', adsh: '0001326801-21-000031', file: 'fb-03312021xexhibit991.htm', date: '2021-04-28' },
  { fy: 'FY2021', q: 'Q2', adsh: '0001326801-21-000047', file: 'fb-06302021xexhibit991.htm', date: '2021-07-28' },
  { fy: 'FY2021', q: 'Q3', adsh: '0001326801-21-000062', file: 'fb-09302021xexhibit991.htm', date: '2021-10-25' },
  { fy: 'FY2021', q: 'Q4', adsh: '0001326801-22-000015', file: 'fb-12312021xexhibit991.htm', date: '2022-02-02' },
  // FY2022（Meta時代）
  { fy: 'FY2022', q: 'Q1', adsh: '0001326801-22-000054', file: 'meta03312022-exhibit991.htm', date: '2022-04-27' },
  { fy: 'FY2022', q: 'Q2', adsh: '0001326801-22-000079', file: 'meta06302022-exhibit991.htm', date: '2022-07-27' },
  { fy: 'FY2022', q: 'Q3', adsh: '0001326801-22-000105', file: 'meta09302022-exhibit991.htm', date: '2022-10-26' },
  { fy: 'FY2022', q: 'Q4', adsh: '0001326801-23-000008', file: 'meta-12312022xexhibit991.htm', date: '2023-02-01' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', adsh: '0001326801-23-000063', file: 'meta03312023-exhibit991.htm', date: '2023-04-26' },
  { fy: 'FY2023', q: 'Q2', adsh: '0001326801-23-000089', file: 'meta06302023-exhibit991.htm', date: '2023-07-26' },
  { fy: 'FY2023', q: 'Q3', adsh: '0001326801-23-000100', file: 'meta09302023-exhibit991.htm', date: '2023-10-25' },
  { fy: 'FY2023', q: 'Q4', adsh: '0001326801-24-000010', file: 'meta-12312023xexhibit991.htm', date: '2024-02-01' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', adsh: '0001326801-24-000044', file: 'meta-03312024xexhibit991.htm', date: '2024-04-24' },
  { fy: 'FY2024', q: 'Q2', adsh: '0001326801-24-000065', file: 'meta-06302024xexhibit991.htm', date: '2024-07-31' },
  { fy: 'FY2024', q: 'Q3', adsh: '0001326801-24-000077', file: 'meta-09302024xexhibit991.htm', date: '2024-10-30' },
  { fy: 'FY2024', q: 'Q4', adsh: '0001326801-25-000014', file: 'meta-12312024xexhibit991.htm', date: '2025-01-29' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', adsh: '0001326801-25-000050', file: 'meta-03312025xexhibit991.htm', date: '2025-04-30' },
  { fy: 'FY2025', q: 'Q2', adsh: '0001628280-25-036719', file: 'meta-06302025xexhibit991.htm', date: '2025-07-30' },
  { fy: 'FY2025', q: 'Q3', adsh: '0001628280-25-047114', file: 'meta-09302025xexhibit991.htm', date: '2025-10-29' },
  { fy: 'FY2025', q: 'Q4', adsh: '0001628280-26-003832', file: 'meta-12312025xexhibit991.htm', date: '2026-01-28' },
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
  console.log(`Meta プレスリリースダウンロード: ${filings.length}四半期分\n`);

  let success = 0, failed = 0;
  for (const f of filings) {
    const url = buildEdgarUrl(f.adsh, f.file);
    const destDir = path.join(basePath, f.fy, f.q);
    const dest = path.join(destDir, 'press-release.html');

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
  const linksData = filings.map(f => ({
    ...f,
    url: buildEdgarUrl(f.adsh, f.file),
    localPath: `${f.fy}/${f.q}/press-release.html`
  }));
  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'quarterly-links.json'),
    JSON.stringify(linksData, null, 2)
  );
  console.log('リンク情報を quarterly-links.json に保存しました');
})();
