// TSMC決算プレスリリース・プレゼン資料をSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// TSMCのSEC EDGAR CIK
const CIK = '1046179';

// 対象四半期のフィリング情報（SEC EDGAR 6-K）
// TSMCは暦年会計（FY = Calendar Year）
const filings = [
  // FY2020
  { fy: 'FY2020', q: 'Q1', adsh: '0001564590-20-016960', pressRelease: 'tsm-6k_20200416.htm', presentation: null, date: '2020-04-16', embedded: true },
  { fy: 'FY2020', q: 'Q2', adsh: '0001564590-20-032443', pressRelease: 'tsm-ex991_64.htm', presentation: 'tsm-ex992_36.htm', date: '2020-07-16' },
  { fy: 'FY2020', q: 'Q3', adsh: '0001564590-20-046453', pressRelease: 'tsm-ex991_7.htm', presentation: 'tsm-ex992_6.htm', date: '2020-10-15' },
  { fy: 'FY2020', q: 'Q4', adsh: '0001564590-21-001132', pressRelease: 'tsm-ex991_6.htm', presentation: 'tsm-ex992_7.htm', date: '2021-01-14' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', adsh: '0001564590-21-018896', pressRelease: 'tsm-ex991_6.htm', presentation: 'tsm-ex992_30.htm', date: '2021-04-15' },
  { fy: 'FY2021', q: 'Q2', adsh: '0001564590-21-036625', pressRelease: 'tsm-ex991_6.htm', presentation: 'tsm-ex992_8.htm', date: '2021-07-15' },
  { fy: 'FY2021', q: 'Q3', adsh: '0001564590-21-050767', pressRelease: 'tsm-ex991_29.htm', presentation: 'tsm-ex992_7.htm', date: '2021-10-14' },
  { fy: 'FY2021', q: 'Q4', adsh: '0001564590-22-001132', pressRelease: 'tsm-ex991_6.htm', presentation: 'tsm-ex992_7.htm', date: '2022-01-13' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', adsh: '0001564590-22-014381', pressRelease: 'tsm-ex991_6.htm', presentation: 'tsm-ex992_7.htm', date: '2022-04-14' },
  { fy: 'FY2022', q: 'Q2', adsh: '0001564590-22-025726', pressRelease: 'tsm-ex991_6.htm', presentation: 'tsm-ex992_7.htm', date: '2022-07-14' },
  { fy: 'FY2022', q: 'Q3', adsh: '0001564590-22-034145', pressRelease: 'tsm-ex991_104.htm', presentation: 'tsm-ex992_7.htm', date: '2022-10-13' },
  { fy: 'FY2022', q: 'Q4', adsh: '0001564590-23-000363', pressRelease: 'tsm-ex991_38.htm', presentation: 'tsm-ex992_8.htm', date: '2023-01-12' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', adsh: '0001628280-23-012121', pressRelease: 'a1q23e_withguidancexfinal.htm', presentation: 'a1q23presentatione.htm', date: '2023-04-20' },
  { fy: 'FY2023', q: 'Q2', adsh: '0001628280-23-025146', pressRelease: 'a2q23e_withguidancexfinalx.htm', presentation: 'a2q23presentatione.htm', date: '2023-07-20' },
  { fy: 'FY2023', q: 'Q3', adsh: '0001046179-23-000014', pressRelease: 'a3q23e_withguidancexfinal.htm', presentation: 'a3q23presentatione.htm', date: '2023-10-19' },
  { fy: 'FY2023', q: 'Q4', adsh: '0001046179-24-000005', pressRelease: 'a4q24e_withguidancexfinal.htm', presentation: 'a4q23presentatione.htm', date: '2024-01-18' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', adsh: '0001046179-24-000046', pressRelease: 'a1q24e_withguidancexfinal.htm', presentation: 'a1q24presentatione_x.htm', date: '2024-04-18' },
  { fy: 'FY2024', q: 'Q2', adsh: '0001046179-24-000083', pressRelease: 'a2q24e_withguidancexfinal.htm', presentation: 'a2q24presentatione.htm', date: '2024-07-18' },
  { fy: 'FY2024', q: 'Q3', adsh: '0001046179-24-000116', pressRelease: 'a3q24e_withguidancexfinal.htm', presentation: 'a3q24presentatione.htm', date: '2024-10-17' },
  { fy: 'FY2024', q: 'Q4', adsh: '0001046179-25-000004', pressRelease: 'a4q24e_withguidancexfinal.htm', presentation: 'a4q24presentatione.htm', date: '2025-01-16' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', adsh: '0001046179-25-000035', pressRelease: 'a1q25e_withguidancexfinal.htm', presentation: 'a1q25presentatione_for6k.htm', date: '2025-04-17' },
  { fy: 'FY2025', q: 'Q2', adsh: '0001046179-25-000082', pressRelease: 'a2q25e_withguidancexfinal.htm', presentation: 'a2q25presentatione_6kxwm.htm', date: '2025-07-17' },
  { fy: 'FY2025', q: 'Q3', adsh: '0001046179-25-000116', pressRelease: 'a3q25e_withguidancexfinal.htm', presentation: 'a3q25presentatione.htm', date: '2025-10-16' },
  { fy: 'FY2025', q: 'Q4', adsh: '0001046179-26-000008', pressRelease: 'a4q25e_withguidancexfinal.htm', presentation: 'a4q25presentatione.htm', date: '2026-01-15' },
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
  // DL対象をconfig設定に基づいてフィルタリング
  const maxQuarters = downloadYears * 4;
  const targetFilings = filings.length <= maxQuarters
    ? filings
    : filings.slice(filings.length - maxQuarters);
  console.log(`設定: pageYears=${config.pageYears}, chartYears=${config.chartYears}, DL対象=${downloadYears}年分 (${targetFilings.length}四半期)\n`);

  for (const f of targetFilings) {
    const destDir = path.join(basePath, f.fy, f.q);
    fs.mkdirSync(destDir, { recursive: true });

    // プレスリリースをダウンロード
    const pressUrl = buildEdgarUrl(f.adsh, f.pressRelease);
    const pressDest = path.join(destDir, 'press-release.html');
    if (!fs.existsSync(pressDest)) {
      try {
        await download(pressUrl, pressDest);
        console.log(`✓ ${f.fy} ${f.q} press-release (${f.date})`);
      } catch (err) {
        console.error(`✗ ${f.fy} ${f.q} press-release: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 150));
    } else {
      console.log(`- ${f.fy} ${f.q} press-release: 既存`);
    }

    // プレゼンテーション資料をダウンロード（存在する場合）
    if (f.presentation) {
      const presDest = path.join(destDir, 'presentation.html');
      if (!fs.existsSync(presDest)) {
        const presUrl = buildEdgarUrl(f.adsh, f.presentation);
        try {
          await download(presUrl, presDest);
          console.log(`✓ ${f.fy} ${f.q} presentation`);
        } catch (err) {
          console.error(`✗ ${f.fy} ${f.q} presentation: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 150));
      } else {
        console.log(`- ${f.fy} ${f.q} presentation: 既存`);
      }
    }
  }

  // リンク情報をJSONに保存
  const linksData = targetFilings.map(f => ({
    fy: f.fy,
    q: f.q,
    date: f.date,
    pressReleaseUrl: buildEdgarUrl(f.adsh, f.pressRelease),
    presentationUrl: f.presentation ? buildEdgarUrl(f.adsh, f.presentation) : null,
    localPressRelease: `${f.fy}/${f.q}/press-release.html`,
    localPresentation: f.presentation ? `${f.fy}/${f.q}/presentation.html` : null,
  }));
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'quarterly-links.json'),
    JSON.stringify(linksData, null, 2)
  );

  console.log(`\n${targetFilings.length}四半期のリンク情報を quarterly-links.json に保存しました`);
})();
