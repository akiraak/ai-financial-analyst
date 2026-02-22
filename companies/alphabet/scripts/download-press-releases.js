// Alphabet Inc.の決算プレスリリースをSEC EDGARからダウンロードするスクリプト
// 8-K Exhibit 99.1（決算プレスリリース）を取得
// インデックスページからEX-99.1のファイル名を自動検出する
const fs = require('fs');
const path = require('path');
const https = require('https');

// Alphabet Inc. CIK: 1652044
const CIK = '1652044';

// 対象四半期の8-Kファイリング情報（決算発表用8-K）
const earnings8K = [
  // FY2020
  { fy: 'FY2020', q: 'Q1', adsh: '0001652044-20-000018' },
  { fy: 'FY2020', q: 'Q2', adsh: '0001652044-20-000031' },
  { fy: 'FY2020', q: 'Q3', adsh: '0001652044-20-000046' },
  { fy: 'FY2020', q: 'Q4', adsh: '0001652044-21-000006' },
  // FY2021
  { fy: 'FY2021', q: 'Q1', adsh: '0001652044-21-000018' },
  { fy: 'FY2021', q: 'Q2', adsh: '0001652044-21-000041' },
  { fy: 'FY2021', q: 'Q3', adsh: '0001652044-21-000054' },
  { fy: 'FY2021', q: 'Q4', adsh: '0001652044-22-000015' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', adsh: '0001652044-22-000025' },
  { fy: 'FY2022', q: 'Q2', adsh: '0001652044-22-000068' },
  { fy: 'FY2022', q: 'Q3', adsh: '0001652044-22-000085' },
  { fy: 'FY2022', q: 'Q4', adsh: '0001652044-23-000013' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', adsh: '0001652044-23-000041' },
  { fy: 'FY2023', q: 'Q2', adsh: '0001652044-23-000067' },
  { fy: 'FY2023', q: 'Q3', adsh: '0001652044-23-000088' },
  { fy: 'FY2023', q: 'Q4', adsh: '0001652044-24-000014' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', adsh: '0001652044-24-000047' },
  { fy: 'FY2024', q: 'Q2', adsh: '0001652044-24-000076' },
  { fy: 'FY2024', q: 'Q3', adsh: '0001652044-24-000115' },
  { fy: 'FY2024', q: 'Q4', adsh: '0001652044-25-000010' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', adsh: '0001652044-25-000040' },
  { fy: 'FY2025', q: 'Q2', adsh: '0001652044-25-000056' },
  { fy: 'FY2025', q: 'Q3', adsh: '0001652044-25-000087' },
  { fy: 'FY2025', q: 'Q4', adsh: '0001652044-26-000012' },
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

// 8-Kインデックスページ（ファイリング一覧）のURLを構築する
function buildIndexUrl(adsh) {
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${CIK}/${adshNoDashes}/${adsh}-index.htm`;
}

// HTMLコンテンツを取得する（文字列として返す）
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      // リダイレクト処理
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// インデックスページからEX-99.1のファイル名を抽出する
function extractExhibitFilename(html) {
  // EX-99.1の行を探す（大文字小文字を無視）
  // パターン: <td scope="row">EX-99.1</td> の近くにある <a href="...">filename</a>
  const lines = html.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/EX-99\.1/i)) {
      // この行またはその前後の行からhrefを探す
      const searchRange = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
      const hrefMatch = searchRange.match(/href="([^"]+)"/);
      if (hrefMatch) {
        // フルパスの場合はファイル名のみ抽出
        const href = hrefMatch[1];
        return href.split('/').pop();
      }
    }
  }

  // 代替パターン: テーブル内でEX-99.1とリンクが同じ行にある場合
  const tableMatch = html.match(/EX-99\.1[\s\S]*?href="([^"]+?)"/i);
  if (tableMatch) {
    return tableMatch[1].split('/').pop();
  }

  return null;
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

// リトライ付きHTML取得
async function fetchHtmlWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchHtml(url);
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  リトライ ${attempt}/${retries - 1}: ${err.message}`);
      await new Promise(r => setTimeout(r, DELAY_MS * attempt));
    }
  }
}

(async () => {
  console.log(`Alphabet Inc. (GOOGL) プレスリリースダウンロード: ${earnings8K.length}四半期分\n`);

  let success = 0, failed = 0;
  const errors = [];

  for (const f of earnings8K) {
    const destDir = path.join(basePath, f.fy, f.q);
    const dest = path.join(destDir, 'press-release.htm');

    // 既にダウンロード済みならスキップ
    if (fs.existsSync(dest)) {
      console.log(`[SKIP] ${f.fy} ${f.q} - 既にダウンロード済み`);
      success++;
      continue;
    }

    try {
      // ディレクトリ作成
      fs.mkdirSync(destDir, { recursive: true });

      // 1. 8-Kインデックスページを取得してEX-99.1のファイル名を特定
      const indexUrl = buildIndexUrl(f.adsh);
      console.log(`  ${f.fy} ${f.q}: インデックスページ取得中...`);
      const indexHtml = await fetchHtmlWithRetry(indexUrl);

      // レートリミット対策
      await new Promise(r => setTimeout(r, DELAY_MS));

      // EX-99.1のファイル名を抽出
      const exhibitFile = extractExhibitFilename(indexHtml);
      if (!exhibitFile) {
        throw new Error('EX-99.1のファイル名がインデックスページから見つかりません');
      }

      // 2. EX-99.1ファイルをダウンロード
      const exhibitUrl = buildEdgarUrl(f.adsh, exhibitFile);
      await downloadWithRetry(exhibitUrl, dest);
      const sizeKB = (fs.statSync(dest).size / 1024).toFixed(1);
      console.log(`[OK] ${f.fy} ${f.q} - ${sizeKB} KB (${exhibitFile})`);
      success++;
    } catch (err) {
      console.error(`[ERR] ${f.fy} ${f.q}: ${err.message}`);
      errors.push({ fy: f.fy, q: f.q, error: err.message, adsh: f.adsh });
      failed++;
      // エラー時にも不完全なファイルを削除
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    }

    // SEC EDGARのレートリミット対策
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);
  if (errors.length > 0) {
    console.log('失敗一覧:');
    errors.forEach(e => console.log(`  ${e.fy} ${e.q}: ${e.error}`));
    console.log('\nインデックスURL一覧（手動確認用）:');
    errors.forEach(e => console.log(`  ${buildIndexUrl(e.adsh)}`));
  }
})();
