// Palantirの10-Q/10-KをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

const CIK = '1321655';

// 10-Q/10-Kファイリング情報
const filings = [
  // FY2020
  { fy: 'FY2020', q: 'Q3', form: '10-Q', adsh: '0001193125-20-292177', file: 'd31861d10q.htm', date: '2020-11-13' },
  { fy: 'FY2020', q: 'Q4', form: '10-K', adsh: '0001193125-21-060650', file: 'd65934d10k.htm', date: '2021-02-26' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', form: '10-Q', adsh: '0001193125-21-159222', file: 'd158374d10q.htm', date: '2021-05-12' },
  { fy: 'FY2021', q: 'Q2', form: '10-Q', adsh: '0000950123-21-010430', file: 'd175251d10q.htm', date: '2021-08-12' },
  { fy: 'FY2021', q: 'Q3', form: '10-Q', adsh: '0001193125-21-323920', file: 'd178745d10q.htm', date: '2021-11-09' },
  { fy: 'FY2021', q: 'Q4', form: '10-K', adsh: '0001193125-22-050913', file: 'd273589d10k.htm', date: '2022-02-24' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', form: '10-Q', adsh: '0001321655-22-000006', file: 'pltr-20220331.htm', date: '2022-05-09' },
  { fy: 'FY2022', q: 'Q2', form: '10-Q', adsh: '0001321655-22-000016', file: 'pltr-20220630.htm', date: '2022-08-08' },
  { fy: 'FY2022', q: 'Q3', form: '10-Q', adsh: '0001321655-22-000032', file: 'pltr-20220930.htm', date: '2022-11-07' },
  { fy: 'FY2022', q: 'Q4', form: '10-K', adsh: '0001321655-23-000011', file: 'pltr-20221231.htm', date: '2023-02-21' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', form: '10-Q', adsh: '0001321655-23-000044', file: 'pltr-20230331.htm', date: '2023-05-09' },
  { fy: 'FY2023', q: 'Q2', form: '10-Q', adsh: '0001321655-23-000090', file: 'pltr-20230630.htm', date: '2023-08-08' },
  { fy: 'FY2023', q: 'Q3', form: '10-Q', adsh: '0001321655-23-000118', file: 'pltr-20230930.htm', date: '2023-11-03' },
  { fy: 'FY2023', q: 'Q4', form: '10-K', adsh: '0001321655-24-000022', file: 'pltr-20231231.htm', date: '2024-02-20' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', form: '10-Q', adsh: '0001321655-24-000071', file: 'pltr-20240331.htm', date: '2024-05-07' },
  { fy: 'FY2024', q: 'Q2', form: '10-Q', adsh: '0001321655-24-000135', file: 'pltr-20240630.htm', date: '2024-08-06' },
  { fy: 'FY2024', q: 'Q3', form: '10-Q', adsh: '0001321655-24-000209', file: 'pltr-20240930.htm', date: '2024-11-05' },
  { fy: 'FY2024', q: 'Q4', form: '10-K', adsh: '0001321655-25-000022', file: 'pltr-20241231.htm', date: '2025-02-18' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', form: '10-Q', adsh: '0001321655-25-000066', file: 'pltr-20250331.htm', date: '2025-05-06' },
  { fy: 'FY2025', q: 'Q2', form: '10-Q', adsh: '0001321655-25-000106', file: 'pltr-20250630.htm', date: '2025-08-05' },
  { fy: 'FY2025', q: 'Q3', form: '10-Q', adsh: '0001321655-25-000131', file: 'pltr-20250930.htm', date: '2025-11-04' },
  { fy: 'FY2025', q: 'Q4', form: '10-K', adsh: '0001321655-26-000011', file: 'pltr-20251231.htm', date: '2026-02-17' },
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
  console.log(`Palantir 10-Q/10-K ダウンロード: ${filings.length}四半期分\n`);

  let success = 0, failed = 0;
  const errors = [];

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
      errors.push({ fy: f.fy, q: f.q, form: f.form, error: err.message, url });
      failed++;
    }

    // SEC EDGARのレートリミット対策
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);
  if (errors.length > 0) {
    console.log('失敗一覧:');
    errors.forEach(e => console.log(`  ${e.fy} ${e.q} ${e.form}: ${e.error}`));
  }
})();
