// Alphabet Inc.の10-Q/10-KをSEC EDGARからダウンロードするスクリプト
const fs = require('fs');
const path = require('path');
const https = require('https');

// Alphabet Inc. CIK: 1652044
const CIK = '1652044';

// 10-Q/10-Kファイリング情報（FY2020 Q1〜FY2025 Q4）
const filings = [
  // FY2020
  { fy: 'FY2020', q: 'Q1', form: '10-Q', adsh: '0001652044-20-000021', file: 'goog-20200331.htm' },
  { fy: 'FY2020', q: 'Q2', form: '10-Q', adsh: '0001652044-20-000032', file: 'goog-20200630.htm' },
  { fy: 'FY2020', q: 'Q3', form: '10-Q', adsh: '0001652044-20-000050', file: 'goog-20200930.htm' },
  { fy: 'FY2020', q: 'Q4', form: '10-K', adsh: '0001652044-21-000010', file: 'goog-20201231.htm' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', form: '10-Q', adsh: '0001652044-21-000020', file: 'goog-20210331.htm' },
  { fy: 'FY2021', q: 'Q2', form: '10-Q', adsh: '0001652044-21-000047', file: 'goog-20210630.htm' },
  { fy: 'FY2021', q: 'Q3', form: '10-Q', adsh: '0001652044-21-000057', file: 'goog-20210930.htm' },
  { fy: 'FY2021', q: 'Q4', form: '10-K', adsh: '0001652044-22-000019', file: 'goog-20211231.htm' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', form: '10-Q', adsh: '0001652044-22-000029', file: 'goog-20220331.htm' },
  { fy: 'FY2022', q: 'Q2', form: '10-Q', adsh: '0001652044-22-000071', file: 'goog-20220630.htm' },
  { fy: 'FY2022', q: 'Q3', form: '10-Q', adsh: '0001652044-22-000090', file: 'goog-20220930.htm' },
  { fy: 'FY2022', q: 'Q4', form: '10-K', adsh: '0001652044-23-000016', file: 'goog-20221231.htm' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', form: '10-Q', adsh: '0001652044-23-000045', file: 'goog-20230331.htm' },
  { fy: 'FY2023', q: 'Q2', form: '10-Q', adsh: '0001652044-23-000070', file: 'goog-20230630.htm' },
  { fy: 'FY2023', q: 'Q3', form: '10-Q', adsh: '0001652044-23-000094', file: 'goog-20230930.htm' },
  { fy: 'FY2023', q: 'Q4', form: '10-K', adsh: '0001652044-24-000022', file: 'goog-20231231.htm' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', form: '10-Q', adsh: '0001652044-24-000053', file: 'goog-20240331.htm' },
  { fy: 'FY2024', q: 'Q2', form: '10-Q', adsh: '0001652044-24-000079', file: 'goog-20240630.htm' },
  { fy: 'FY2024', q: 'Q3', form: '10-Q', adsh: '0001652044-24-000118', file: 'goog-20240930.htm' },
  { fy: 'FY2024', q: 'Q4', form: '10-K', adsh: '0001652044-25-000014', file: 'goog-20241231.htm' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', form: '10-Q', adsh: '0001652044-25-000043', file: 'goog-20250331.htm' },
  { fy: 'FY2025', q: 'Q2', form: '10-Q', adsh: '0001652044-25-000062', file: 'goog-20250630.htm' },
  { fy: 'FY2025', q: 'Q3', form: '10-Q', adsh: '0001652044-25-000091', file: 'goog-20250930.htm' },
  { fy: 'FY2025', q: 'Q4', form: '10-K', adsh: '0001652044-26-000018', file: 'goog-20251231.htm' },
];

const basePath = path.join(__dirname, '..', 'filings');

// User-Agent（SEC EDGAR利用規約に基づく）
const USER_AGENT = 'AI Financial Analyst research@example.com';

// リクエスト間の待機時間（ミリ秒）
const DELAY_MS = 500;

// リトライ回数
const MAX_RETRIES = 3;

// EDGAR URLを構築する
function buildEdgarUrl(adsh, filename) {
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${CIK}/${adshNoDashes}/${filename}`;
}

// ファイルをダウンロードする
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      // リダイレクト処理
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      // HTTPエラー処理
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// リトライ付きダウンロード
async function downloadWithRetry(url, dest, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await download(url, dest);
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  リトライ ${attempt}/${retries - 1}: ${err.message}`);
      // リトライ前に待機（指数バックオフ）
      await new Promise(r => setTimeout(r, DELAY_MS * attempt));
    }
  }
}

(async () => {
  console.log(`Alphabet Inc. (GOOGL) 10-Q/10-K ダウンロード: ${filings.length}四半期分\n`);

  let success = 0, failed = 0;
  const errors = [];

  for (const f of filings) {
    const url = buildEdgarUrl(f.adsh, f.file);
    const destDir = path.join(basePath, f.fy, f.q);
    // Q1-Q3は10-Q、Q4は10-K
    const destName = f.form === '10-K' ? '10-K.htm' : '10-Q.htm';
    const dest = path.join(destDir, destName);

    // 既にダウンロード済みならスキップ
    if (fs.existsSync(dest)) {
      console.log(`[SKIP] ${f.fy} ${f.q} ${f.form} - 既にダウンロード済み`);
      success++;
      continue;
    }

    try {
      // ディレクトリ作成
      fs.mkdirSync(destDir, { recursive: true });
      await downloadWithRetry(url, dest);
      const sizeKB = (fs.statSync(dest).size / 1024).toFixed(1);
      console.log(`[OK] ${f.fy} ${f.q} ${f.form} - ${sizeKB} KB`);
      success++;
    } catch (err) {
      console.error(`[ERR] ${f.fy} ${f.q} ${f.form}: ${err.message}`);
      errors.push({ fy: f.fy, q: f.q, form: f.form, error: err.message, url });
      failed++;
    }

    // SEC EDGARのレートリミット対策
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);
  if (errors.length > 0) {
    console.log('失敗一覧:');
    errors.forEach(e => console.log(`  ${e.fy} ${e.q} ${e.form}: ${e.error}`));
    console.log('\nURL一覧（手動確認用）:');
    errors.forEach(e => console.log(`  ${e.url}`));
  }
})();
