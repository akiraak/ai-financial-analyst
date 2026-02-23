// Microsoft決算プレスリリースをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// 対象四半期のプレスリリース情報（SEC EDGAR 8-K Exhibit 99.1）
const filings = [
  { fy: 'FY2021', q: 'Q1', adsh: '0001193125-20-278410', file: 'd10535dex991.htm', date: '2020-10-27' },
  { fy: 'FY2021', q: 'Q2', adsh: '0001193125-21-017683', file: 'd65802dex991.htm', date: '2021-01-26' },
  { fy: 'FY2021', q: 'Q3', adsh: '0001193125-21-134213', file: 'd179564dex991.htm', date: '2021-04-27' },
  { fy: 'FY2021', q: 'Q4', adsh: '0001193125-21-225746', file: 'd200100dex991.htm', date: '2021-07-27' },
  { fy: 'FY2022', q: 'Q1', adsh: '0001193125-21-307941', file: 'd239488dex991.htm', date: '2021-10-26' },
  { fy: 'FY2022', q: 'Q2', adsh: '0001193125-22-017041', file: 'd299919dex991.htm', date: '2022-01-25' },
  { fy: 'FY2022', q: 'Q3', adsh: '0001193125-22-120207', file: 'd328712dex991.htm', date: '2022-04-26' },
  { fy: 'FY2022', q: 'Q4', adsh: '0001193125-22-202034', file: 'd372382dex991.htm', date: '2022-07-26' },
  { fy: 'FY2023', q: 'Q1', adsh: '0001193125-22-268356', file: 'd361432dex991.htm', date: '2022-10-25' },
  { fy: 'FY2023', q: 'Q2', adsh: '0001193125-23-014230', file: 'd406070dex991.htm', date: '2023-01-24' },
  { fy: 'FY2023', q: 'Q3', adsh: '0001193125-23-115280', file: 'd321368dex991.htm', date: '2023-04-25' },
  { fy: 'FY2023', q: 'Q4', adsh: '0000950170-23-034400', file: 'msft-ex99_1.htm', date: '2023-07-25' },
  { fy: 'FY2024', q: 'Q1', adsh: '0000950170-23-054848', file: 'msft-ex99_1.htm', date: '2023-10-24' },
  { fy: 'FY2024', q: 'Q2', adsh: '0000950170-24-008809', file: 'msft-ex99_1.htm', date: '2024-01-30' },
  { fy: 'FY2024', q: 'Q3', adsh: '0000950170-24-048268', file: 'msft-ex99_1.htm', date: '2024-04-25' },
  { fy: 'FY2024', q: 'Q4', adsh: '0000950170-24-087835', file: 'msft-ex99_1.htm', date: '2024-07-30' },
  { fy: 'FY2025', q: 'Q1', adsh: '0000950170-24-118955', file: 'msft-ex99_1.htm', date: '2024-10-30' },
  { fy: 'FY2025', q: 'Q2', adsh: '0000950170-25-010484', file: 'msft-ex99_1.htm', date: '2025-01-29' },
  { fy: 'FY2025', q: 'Q3', adsh: '0000950170-25-061032', file: 'msft-ex99_1.htm', date: '2025-04-30' },
  { fy: 'FY2025', q: 'Q4', adsh: '0000950170-25-100226', file: 'msft-ex99_1.htm', date: '2025-07-30' },
  { fy: 'FY2026', q: 'Q1', adsh: '0001193125-25-256310', file: 'msft-ex99_1.htm', date: '2025-10-29' },
  { fy: 'FY2026', q: 'Q2', adsh: '0001193125-26-027198', file: 'msft-ex99_1.htm', date: '2026-01-28' },
];

const basePath = path.join(__dirname, '..', 'filings');

// config.json から期間設定を読み込み
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = { pageYears: 2, chartYears: 4 };
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
const downloadYears = config.pageYears + config.chartYears;

function buildEdgarUrl(adsh, filename) {
  // EDGAR URL: https://www.sec.gov/Archives/edgar/data/{CIK}/{adsh_no_dashes}/{filename}
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/789019/${adshNoDashes}/${filename}`;
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

    // フォルダ作成
    fs.mkdirSync(destDir, { recursive: true });

    // 既にダウンロード済みならスキップ
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      console.log(`⏭ ${f.fy} ${f.q} (${f.date}): 既にダウンロード済み - スキップ`);
      continue;
    }

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
