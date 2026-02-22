// PalantirのプレスリリースをSEC EDGARからダウンロードするスクリプト
// 8-K Exhibit 99.1（決算プレスリリース）を取得
const fs = require('fs');
const path = require('path');
const https = require('https');

// Palantir Technologies CIK: 1321655
const CIK = '1321655';

// 対象四半期のプレスリリース情報（SEC EDGAR 8-K EX-99.1）
// IPOは2020年9月30日。FY2020 Q3が最初の決算発表
const filings = [
  // FY2020
  { fy: 'FY2020', q: 'Q3', adsh: '0001193125-20-291678', file: 'd934165dex991.htm', date: '2020-11-12' },
  { fy: 'FY2020', q: 'Q4', adsh: '0001193125-21-043333', file: 'd131078dex991.htm', date: '2021-02-16' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', adsh: '0001193125-21-156956', file: 'd77775dex991.htm', date: '2021-05-11' },
  { fy: 'FY2021', q: 'Q2', adsh: '0000950123-21-010428', file: 'd213750dex991.htm', date: '2021-08-12' },
  { fy: 'FY2021', q: 'Q3', adsh: '0001193125-21-323727', file: 'd51038dex991.htm', date: '2021-11-09' },
  { fy: 'FY2021', q: 'Q4', adsh: '0001193125-22-044821', file: 'd317188dex991.htm', date: '2022-02-17' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', adsh: '0001193125-22-144264', file: 'd259921dex991.htm', date: '2022-05-09' },
  { fy: 'FY2022', q: 'Q2', adsh: '0001193125-22-214147', file: 'd347534dex991.htm', date: '2022-08-08' },
  { fy: 'FY2022', q: 'Q3', adsh: '0001321655-22-000029', file: 'a2022q3ex991pressrelease.htm', date: '2022-11-07' },
  { fy: 'FY2022', q: 'Q4', adsh: '0001321655-23-000005', file: 'a2022q4ex991pressrelease.htm', date: '2023-02-13' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', adsh: '0001321655-23-000042', file: 'a2023q1ex991earningsrelease.htm', date: '2023-05-08' },
  { fy: 'FY2023', q: 'Q2', adsh: '0001321655-23-000086', file: 'a2023q2ex991pressrelease.htm', date: '2023-08-07' },
  { fy: 'FY2023', q: 'Q3', adsh: '0001321655-23-000115', file: 'a2023q3ex991earningsrelease.htm', date: '2023-11-02' },
  { fy: 'FY2023', q: 'Q4', adsh: '0001321655-24-000010', file: 'a2023q4ex991earningsrelease.htm', date: '2024-02-05' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', adsh: '0001321655-24-000069', file: 'a2024q1ex991earningsrelease.htm', date: '2024-05-06' },
  { fy: 'FY2024', q: 'Q2', adsh: '0001321655-24-000133', file: 'a2024q2ex991pressrelease.htm', date: '2024-08-05' },
  { fy: 'FY2024', q: 'Q3', adsh: '0001321655-24-000207', file: 'a2024q3ex991earningsrelease.htm', date: '2024-11-04' },
  { fy: 'FY2024', q: 'Q4', adsh: '0001321655-25-000007', file: 'a2024q4ex991earningsrelease.htm', date: '2025-02-03' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', adsh: '0001321655-25-000063', file: 'a2025q1ex991pressrelease.htm', date: '2025-05-05' },
  { fy: 'FY2025', q: 'Q2', adsh: '0001321655-25-000105', file: 'a2025q2ex991pressrelease.htm', date: '2025-08-04' },
  { fy: 'FY2025', q: 'Q3', adsh: '0001321655-25-000130', file: 'a2025q3ex991earningsrelease.htm', date: '2025-11-03' },
  { fy: 'FY2025', q: 'Q4', adsh: '0001321655-26-000004', file: 'a2025q4ex991earningsrelease.htm', date: '2026-02-02' },
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
  console.log(`Palantir プレスリリースダウンロード: ${filings.length}四半期分\n`);

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
