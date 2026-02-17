// NVIDIAの全決算資料をダウンロードするスクリプト
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const BASE_DIR = '/home/ubuntu/ai-financial-analyst/companies/nvidia/filings';
const data = require('./ir-links.json');

// 四半期名からQ番号へのマッピング
function getQuarterNumber(quarterName) {
  if (quarterName.includes('First')) return 'Q1';
  if (quarterName.includes('Second')) return 'Q2';
  if (quarterName.includes('Third')) return 'Q3';
  if (quarterName.includes('Fourth')) return 'Q4';
  return null;
}

// 資料名からファイル名を決定
function getFileName(doc) {
  const name = doc.name;
  const url = doc.url;

  // プレスリリース → press-release
  if (name === 'Press Release' || name === 'Initial Press release') {
    if (url.includes('nvidianews.nvidia.com')) return 'press-release.html';
    if (url.endsWith('.pdf')) return 'press-release.pdf';
    return 'press-release.html';
  }
  if (name === 'Initial Press release tables') return 'press-release-tables.html';

  // 10-Q / 10-K（URLがUUIDの場合が多いので固定名にする）
  if (name === '10-Q' || name === 'Form 10-Q') return '10-Q.pdf';
  if (name === '10-K' || name === 'Form 10-K') return '10-K.pdf';

  // その他: URLからファイル名を取得（企業が付けた名前を使用）
  const urlPath = new URL(url).pathname;
  const originalName = path.basename(urlPath);
  if (originalName && originalName !== 'default.aspx' && !originalName.includes('?')) {
    return originalName;
  }

  // フォールバック
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-') + '.pdf';
}

// ダウンロード不要な資料タイプ
function shouldSkip(doc) {
  return doc.name === 'Webcast'; // ライブストリームリンクは保存不要
}

// HTTPSでファイルをダウンロード
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      // リダイレクト対応
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

(async () => {
  // Playwrightはプレスリリース（HTML）のダウンロードに使用
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });

  const results = { success: [], failed: [], skipped: [] };

  for (const [fy, quarters] of Object.entries(data)) {
    for (const quarter of quarters) {
      const qNum = getQuarterNumber(quarter.quarter);
      if (!qNum) {
        console.log(`  Skipping unknown quarter: ${quarter.quarter}`);
        continue;
      }

      const dir = path.join(BASE_DIR, fy, qNum);
      fs.mkdirSync(dir, { recursive: true });

      for (const doc of quarter.documents) {
        if (shouldSkip(doc)) {
          results.skipped.push(`${fy}/${qNum}: ${doc.name}`);
          continue;
        }

        const fileName = getFileName(doc);
        const filePath = path.join(dir, fileName);

        // 既にダウンロード済みならスキップ
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          console.log(`  [SKIP] ${fy}/${qNum}/${fileName} (already exists)`);
          results.skipped.push(`${fy}/${qNum}: ${fileName}`);
          continue;
        }

        try {
          if (doc.url.includes('nvidianews.nvidia.com')) {
            // HTMLページはPlaywrightで取得
            console.log(`  [HTML] ${fy}/${qNum}/${fileName} ...`);
            const page = await context.newPage();
            await page.goto(doc.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);
            const html = await page.content();
            fs.writeFileSync(filePath, html);
            await page.close();
          } else {
            // PDFなどは直接ダウンロード
            console.log(`  [DL]   ${fy}/${qNum}/${fileName} ...`);
            await downloadFile(doc.url, filePath);
          }
          results.success.push(`${fy}/${qNum}: ${fileName}`);
        } catch (err) {
          console.error(`  [FAIL] ${fy}/${qNum}/${fileName}: ${err.message}`);
          results.failed.push({ file: `${fy}/${qNum}: ${fileName}`, url: doc.url, error: err.message });
        }
      }
    }
  }

  await browser.close();

  // 結果サマリー
  console.log('\n=== Download Summary ===');
  console.log(`Success: ${results.success.length}`);
  console.log(`Failed:  ${results.failed.length}`);
  console.log(`Skipped: ${results.skipped.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed downloads:');
    results.failed.forEach(f => console.log(`  ${f.file}: ${f.error} (${f.url})`));
  }

  // 結果をJSONに保存
  fs.writeFileSync(path.join(BASE_DIR, 'download-results.json'), JSON.stringify(results, null, 2));
})();
