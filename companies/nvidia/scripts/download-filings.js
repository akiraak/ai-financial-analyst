// NVIDIA決算プレスリリースをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// 対象四半期のプレスリリース情報（SEC EDGAR）
const filings = [
  { fy: 'FY2025', q: 'Q1', adsh: '0001045810-24-000113', file: 'q1fy25pr.htm', date: '2024-05-22' },
  { fy: 'FY2025', q: 'Q2', adsh: '0001045810-24-000262', file: 'q2fy25pr.htm', date: '2024-08-28' },
  { fy: 'FY2025', q: 'Q3', adsh: '0001045810-24-000315', file: 'q3fy25pr.htm', date: '2024-11-20' },
  { fy: 'FY2025', q: 'Q4', adsh: '0001045810-25-000021', file: 'q4fy25pr.htm', date: '2025-02-26' },
  { fy: 'FY2026', q: 'Q1', adsh: '0001045810-25-000115', file: 'q1fy26pr.htm', date: '2025-05-28' },
  { fy: 'FY2026', q: 'Q2', adsh: '0001045810-25-000207', file: 'q2fy26pr.htm', date: '2025-08-27' },
  { fy: 'FY2026', q: 'Q3', adsh: '0001045810-25-000228', file: 'q3fy26pr.htm', date: '2025-11-19' },
];

const basePath = path.join(__dirname, '..', 'filings');

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
  for (const f of filings) {
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

  console.log('\n全四半期のリンク情報を quarterly-links.json に保存しました');
})();
