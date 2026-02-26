// NVIDIA決算プレスリリースをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// 対象四半期のプレスリリース情報（SEC EDGAR）
const filings = [
  { fy: 'FY2021', q: 'Q1', adsh: '0001045810-20-000063', file: 'q1fy21pr.htm', date: '2020-05-21' },
  { fy: 'FY2021', q: 'Q2', adsh: '0001045810-20-000145', file: 'q2fy21pr.htm', date: '2020-08-19' },
  { fy: 'FY2021', q: 'Q3', adsh: '0001045810-20-000187', file: 'q3fy21pr.htm', date: '2020-11-18' },
  { fy: 'FY2021', q: 'Q4', adsh: '0001045810-21-000007', file: 'q4fy21pr.htm', date: '2021-02-24' },
  { fy: 'FY2022', q: 'Q1', adsh: '0001045810-21-000063', file: 'q1fy22pr.htm', date: '2021-05-26' },
  { fy: 'FY2022', q: 'Q2', adsh: '0001045810-21-000128', file: 'q2fy22pr.htm', date: '2021-08-18' },
  { fy: 'FY2022', q: 'Q3', adsh: '0001045810-21-000160', file: 'q3fy22pr.htm', date: '2021-11-17' },
  { fy: 'FY2022', q: 'Q4', adsh: '0001045810-22-000008', file: 'q4fy22pr.htm', date: '2022-02-16' },
  { fy: 'FY2023', q: 'Q1', adsh: '0001045810-22-000073', file: 'q1fy23pr.htm', date: '2022-05-25' },
  { fy: 'FY2023', q: 'Q2', adsh: '0001045810-22-000136', file: 'q2fy23pr.htm', date: '2022-08-24' },
  { fy: 'FY2023', q: 'Q3', adsh: '0001045810-22-000163', file: 'q3fy23pr.htm', date: '2022-11-16' },
  { fy: 'FY2023', q: 'Q4', adsh: '0001045810-23-000014', file: 'q4fy23pr.htm', date: '2023-02-22' },
  { fy: 'FY2024', q: 'Q1', adsh: '0001045810-23-000087', file: 'q1fy24pr.htm', date: '2023-05-24' },
  { fy: 'FY2024', q: 'Q2', adsh: '0001045810-23-000171', file: 'q2fy24pr.htm', date: '2023-08-23' },
  { fy: 'FY2024', q: 'Q3', adsh: '0001045810-23-000225', file: 'q3fy24pr.htm', date: '2023-11-21' },
  { fy: 'FY2024', q: 'Q4', adsh: '0001045810-24-000028', file: 'q4fy24pr.htm', date: '2024-02-21' },
  { fy: 'FY2025', q: 'Q1', adsh: '0001045810-24-000113', file: 'q1fy25pr.htm', date: '2024-05-22' },
  { fy: 'FY2025', q: 'Q2', adsh: '0001045810-24-000262', file: 'q2fy25pr.htm', date: '2024-08-28' },
  { fy: 'FY2025', q: 'Q3', adsh: '0001045810-24-000315', file: 'q3fy25pr.htm', date: '2024-11-20' },
  { fy: 'FY2025', q: 'Q4', adsh: '0001045810-25-000021', file: 'q4fy25pr.htm', date: '2025-02-26' },
  { fy: 'FY2026', q: 'Q1', adsh: '0001045810-25-000115', file: 'q1fy26pr.htm', date: '2025-05-28' },
  { fy: 'FY2026', q: 'Q2', adsh: '0001045810-25-000207', file: 'q2fy26pr.htm', date: '2025-08-27' },
  { fy: 'FY2026', q: 'Q3', adsh: '0001045810-25-000228', file: 'q3fy26pr.htm', date: '2025-11-19' },
  { fy: 'FY2026', q: 'Q4', adsh: '0001045810-26-000019', file: 'q4fy26pr.htm', date: '2026-02-26' },
];

const basePath = path.join(__dirname, '..', 'filings');

// config.json から期間設定を読み込み
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = { pageYears: 2, chartYears: 2 }; // デフォルト値
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
const downloadYears = config.pageYears + config.chartYears;

function buildEdgarUrl(adsh, filename) {
  // EDGAR URL: https://www.sec.gov/Archives/edgar/data/{CIK}/{adsh_no_dashes}/{filename}
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/1045810/${adshNoDashes}/${filename}`;
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
  // DL対象をconfig設定に基づいてフィルタリング（最新から downloadYears 年分）
  const maxQuarters = downloadYears * 4;
  const targetFilings = filings.length <= maxQuarters
    ? filings
    : filings.slice(filings.length - maxQuarters);
  console.log(`設定: pageYears=${config.pageYears}, chartYears=${config.chartYears}, DL対象=${downloadYears}年分 (${targetFilings.length}四半期)\n`);

  for (const f of targetFilings) {
    const url = buildEdgarUrl(f.adsh, f.file);
    const destDir = path.join(basePath, f.fy, f.q);
    const dest = path.join(destDir, 'press-release.html');

    try {
      await download(url, dest);
      console.log(`✓ ${f.fy} ${f.q} (${f.date}): ダウンロード完了`);
    } catch (err) {
      console.error(`✗ ${f.fy} ${f.q}: ${err.message}`);
    }

    // SEC EDGARのレートリミット対策（100ms待機）
    await new Promise(r => setTimeout(r, 100));
  }

  // リンク情報をJSONに保存（DL対象分のみ）
  const linksData = targetFilings.map(f => ({
    ...f,
    url: buildEdgarUrl(f.adsh, f.file),
    localPath: `${f.fy}/${f.q}/press-release.html`
  }));
  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'quarterly-links.json'),
    JSON.stringify(linksData, null, 2)
  );

  console.log(`\n${targetFilings.length}四半期のリンク情報を quarterly-links.json に保存しました`);
})();
