// BroadcomのプレスリリースをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// Broadcom CIK: 1730168
const CIK = '1730168';

// 対象四半期のプレスリリース情報（SEC EDGAR 8-K EX-99.1）
const filings = [
  { fy: 'FY2020', q: 'Q1', adsh: '0001193125-20-071608', file: 'd859221dex991.htm', date: '2020-03-12' },
  { fy: 'FY2020', q: 'Q2', adsh: '0001730168-20-000099', file: 'avgo-05032020x8kxex99.htm', date: '2020-06-04' },
  { fy: 'FY2020', q: 'Q3', adsh: '0001730168-20-000154', file: 'avgo-08022020x8kxex99.htm', date: '2020-09-03' },
  { fy: 'FY2020', q: 'Q4', adsh: '0001730168-20-000201', file: 'avgo-11012020x8kxex99.htm', date: '2020-12-10' },
  { fy: 'FY2021', q: 'Q1', adsh: '0001730168-21-000026', file: 'avgo-01312021x8kxex99.htm', date: '2021-03-04' },
  { fy: 'FY2021', q: 'Q2', adsh: '0001730168-21-000110', file: 'avgo-05022021x8kxex99.htm', date: '2021-06-03' },
  { fy: 'FY2021', q: 'Q3', adsh: '0001730168-21-000121', file: 'avgo-08012021x8kxex99.htm', date: '2021-09-02' },
  { fy: 'FY2021', q: 'Q4', adsh: '0001730168-21-000148', file: 'avgo-10312021x8kxex99.htm', date: '2021-12-09' },
  { fy: 'FY2022', q: 'Q1', adsh: '0001730168-22-000015', file: 'avgo-01302022x8kxex99.htm', date: '2022-03-03' },
  { fy: 'FY2022', q: 'Q2', adsh: '0001193125-22-160304', file: 'd262320dex991.htm', date: '2022-05-26' },
  { fy: 'FY2022', q: 'Q3', adsh: '0001730168-22-000091', file: 'avgo-07312022x8kxex99.htm', date: '2022-09-01' },
  { fy: 'FY2022', q: 'Q4', adsh: '0001730168-22-000110', file: 'avgo-10302022x8kxex99.htm', date: '2022-12-08' },
  { fy: 'FY2023', q: 'Q1', adsh: '0001730168-23-000004', file: 'avgo-01292023x8kxex99.htm', date: '2023-03-02' },
  { fy: 'FY2023', q: 'Q2', adsh: '0001730168-23-000062', file: 'avgo-04302023x8kxex99.htm', date: '2023-06-01' },
  { fy: 'FY2023', q: 'Q3', adsh: '0001730168-23-000074', file: 'avgo-07302023x8kxex99.htm', date: '2023-08-31' },
  { fy: 'FY2023', q: 'Q4', adsh: '0001730168-23-000093', file: 'avgo-10292023x8kxex99.htm', date: '2023-12-07' },
  { fy: 'FY2024', q: 'Q1', adsh: '0001730168-24-000012', file: 'avgo-02042024x8kxex99.htm', date: '2024-03-07' },
  { fy: 'FY2024', q: 'Q2', adsh: '0001730168-24-000077', file: 'avgo-05052024x8kxex99.htm', date: '2024-06-12' },
  { fy: 'FY2024', q: 'Q3', adsh: '0001730168-24-000095', file: 'avgo-08042024x8kxex99.htm', date: '2024-09-05' },
  { fy: 'FY2024', q: 'Q4', adsh: '0001730168-24-000125', file: 'avgo-11032024x8kxex99.htm', date: '2024-12-12' },
  { fy: 'FY2025', q: 'Q1', adsh: '0001730168-25-000009', file: 'avgo-02022025x8kxex99.htm', date: '2025-03-06' },
  { fy: 'FY2025', q: 'Q2', adsh: '0001730168-25-000061', file: 'avgo-05042025x8kxex99.htm', date: '2025-06-05' },
  { fy: 'FY2025', q: 'Q3', adsh: '0001730168-25-000094', file: 'avgo-08032025x8kxex99.htm', date: '2025-09-04' },
  { fy: 'FY2025', q: 'Q4', adsh: '0001730168-25-000116', file: 'avgo-11022025x8kxex99.htm', date: '2025-12-11' },
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
  console.log(`Broadcom プレスリリースダウンロード: ${filings.length}四半期分\n`);

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
