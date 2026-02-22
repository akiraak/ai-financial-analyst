// Intel決算プレスリリースをSEC EDGARからダウンロードするスクリプト
// 8-K Exhibit 99.1（決算プレスリリース）を取得
const fs = require('fs');
const path = require('path');
const https = require('https');

// Intel Corporation CIK: 50863
const CIK = '50863';

// 対象四半期のプレスリリース情報（SEC EDGAR 8-K EX-99.1）
const filings = [
  // FY2020
  { fy: 'FY2020', q: 'Q1', adsh: '0000050863-20-000016', file: 'q1-2020earningsrelease.htm', date: '2020-04-23' },
  { fy: 'FY2020', q: 'Q2', adsh: '0000050863-20-000025', file: 'q220earningsrelease.htm', date: '2020-07-23' },
  { fy: 'FY2020', q: 'Q3', adsh: '0000050863-20-000042', file: 'q320earningsrelease.htm', date: '2020-10-22' },
  { fy: 'FY2020', q: 'Q4', adsh: '0000050863-21-000009', file: 'q420_earningsrelease.htm', date: '2021-01-21' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', adsh: '0000050863-21-000017', file: 'q121_earningsrelease.htm', date: '2021-04-22' },
  { fy: 'FY2021', q: 'Q2', adsh: '0000050863-21-000029', file: 'q221_earningsrelease.htm', date: '2021-07-22' },
  { fy: 'FY2021', q: 'Q3', adsh: '0000050863-21-000037', file: 'q321_earningsrelease.htm', date: '2021-10-21' },
  { fy: 'FY2021', q: 'Q4', adsh: '0000050863-22-000006', file: 'q421_earningsrelease.htm', date: '2022-01-26' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', adsh: '0000050863-22-000019', file: 'q122_earningsrelease.htm', date: '2022-04-28' },
  { fy: 'FY2022', q: 'Q2', adsh: '0000050863-22-000029', file: 'q222_earningsrelease.htm', date: '2022-07-28' },
  { fy: 'FY2022', q: 'Q3', adsh: '0000050863-22-000037', file: 'q322_earningsrelease.htm', date: '2022-10-27' },
  { fy: 'FY2022', q: 'Q4', adsh: '0000050863-23-000005', file: 'q422_earningsrelease.htm', date: '2023-01-26' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', adsh: '0000050863-23-000027', file: 'q123_earningsrelease.htm', date: '2023-04-27' },
  { fy: 'FY2023', q: 'Q2', adsh: '0000050863-23-000068', file: 'q223_earningsrelease.htm', date: '2023-07-27' },
  { fy: 'FY2023', q: 'Q3', adsh: '0000050863-23-000100', file: 'q323_earningsrelease.htm', date: '2023-10-26' },
  { fy: 'FY2023', q: 'Q4', adsh: '0000050863-24-000008', file: 'q423_earningsrelease.htm', date: '2024-01-25' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', adsh: '0000050863-24-000074', file: 'q124_earningsrelease.htm', date: '2024-04-25' },
  { fy: 'FY2024', q: 'Q2', adsh: '0000050863-24-000122', file: 'q224_earningsrelease.htm', date: '2024-08-01' },
  { fy: 'FY2024', q: 'Q3', adsh: '0000050863-24-000147', file: 'q324_earningsrelease.htm', date: '2024-10-31' },
  { fy: 'FY2024', q: 'Q4', adsh: '0000050863-25-000004', file: 'q424_earningsrelease.htm', date: '2025-01-30' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', adsh: '0000050863-25-000070', file: 'q125_earningsrelease.htm', date: '2025-04-24' },
  { fy: 'FY2025', q: 'Q2', adsh: '0000050863-25-000107', file: 'q225_earningsrelease.htm', date: '2025-07-24' },
  { fy: 'FY2025', q: 'Q3', adsh: '0000050863-25-000169', file: 'q325earningsrelease.htm', date: '2025-10-23' },
  { fy: 'FY2025', q: 'Q4', adsh: '0000050863-26-000009', file: 'q425earningsrelease.htm', date: '2026-01-22' },
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
  console.log(`Intel プレスリリースダウンロード: ${filings.length}四半期分\n`);

  let success = 0, failed = 0;
  for (const f of filings) {
    const url = buildEdgarUrl(f.adsh, f.file);
    const destDir = path.join(basePath, f.fy, f.q);
    const dest = path.join(destDir, 'press-release.html');

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
