// ir-links.jsonからREADME.mdを生成するスクリプト
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const data = require('./ir-links.json');

// 四半期名からQ番号を取得
function getQNum(name) {
  if (name.includes('First')) return 'Q1';
  if (name.includes('Second')) return 'Q2';
  if (name.includes('Third')) return 'Q3';
  if (name.includes('Fourth')) return 'Q4';
  return null;
}

// ファイル名を決定（download-all.jsと同じロジック）
function getFileName(doc) {
  const name = doc.name;
  const url = doc.url;
  if (name === 'Press Release' || name === 'Initial Press release') {
    if (url.includes('nvidianews.nvidia.com')) return 'press-release.html';
    if (url.endsWith('.pdf')) return 'press-release.pdf';
    return 'press-release.html';
  }
  if (name === 'Initial Press release tables') return 'press-release-tables.html';
  if (name === '10-Q' || name === 'Form 10-Q') return '10-Q.pdf';
  if (name === '10-K' || name === 'Form 10-K') return '10-K.pdf';
  const urlPath = new URL(url).pathname;
  const originalName = path.basename(urlPath);
  if (originalName && originalName !== 'default.aspx') return decodeURIComponent(originalName);
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-') + '.pdf';
}

// FY番号からカレンダー年の対応を計算
function fyPeriod(fy, q) {
  const fyNum = parseInt(fy.replace('FY', ''));
  // NVIDIAのFYはカレンダー年+1（FY2026 = 2025年2月〜2026年1月）
  const startYear = fyNum - 1;
  const qMonths = {
    Q1: `${startYear}年2月〜4月`,
    Q2: `${startYear}年5月〜7月`,
    Q3: `${startYear}年8月〜10月`,
    Q4: `${startYear}年11月〜${fyNum}年1月`
  };
  return qMonths[q] || '';
}

let md = `# NVIDIA 決算資料

## 企業情報

| 項目 | 内容 |
|------|------|
| 企業名 | NVIDIA Corporation (NVDA) |
| IRページ | https://investor.nvidia.com/ |
| 四半期決算一覧 | https://investor.nvidia.com/financial-info/quarterly-results/default.aspx |
| SEC EDGAR CIK | [1045810](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1045810) |
| 会計年度 | 1月最終日曜日が期末（2月〜翌年1月） |

## ファイル命名規則

| 資料種別 | ファイル名 |
|----------|-----------|
| 決算プレスリリース | \`press-release.html\` |
| 10-Q（四半期報告） | \`10-Q.pdf\` |
| 10-K（年次報告） | \`10-K.pdf\` |
| その他 | ソースURLの元ファイル名をそのまま使用 |

## 補足

- **Webcast**リンクはライブストリームのため、ファイルとしてはダウンロードしていない（URLのみ下記に記録）
- FY2024 Q4 / Q1のプレスリリースはIRページ上のリンクが欠落していたため、手動で補完

---

`;

// 手動補完したプレスリリース
const manualPR = {
  'FY2024/Q4': {
    name: 'Press Release',
    url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-fourth-quarter-and-fiscal-2024',
    file: 'press-release.html',
    note: '※IRページに未掲載のため手動追加'
  },
  'FY2024/Q1': {
    name: 'Press Release',
    url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2024',
    file: 'press-release.html',
    note: '※IRページに未掲載のため手動追加'
  }
};

// 実際にフォルダが存在する年度のみ出力
const existingFYs = fs.readdirSync(path.join(BASE_DIR))
  .filter(d => d.startsWith('FY') && fs.statSync(path.join(BASE_DIR, d)).isDirectory());

for (const [fy, quarters] of Object.entries(data)) {
  if (!existingFYs.includes(fy)) continue;
  const fyNum = parseInt(fy.replace('FY', ''));
  const startYear = fyNum - 1;
  md += `## ${fy}（${startYear}年2月〜${fyNum}年1月）\n\n`;

  for (const quarter of quarters) {
    const qNum = getQNum(quarter.quarter);
    if (!qNum) continue;
    const period = fyPeriod(fy, qNum);

    md += `### ${qNum}（${period}）\n\n`;
    md += `| 資料名 | ファイル名 | ソースURL |\n`;
    md += `|--------|-----------|----------|\n`;

    // 手動補完分を先に追加
    const manualKey = `${fy}/${qNum}`;
    if (manualPR[manualKey]) {
      const m = manualPR[manualKey];
      md += `| ${m.name} ${m.note} | \`${m.file}\` | ${m.url} |\n`;
    }

    for (const doc of quarter.documents) {
      if (doc.name === 'Webcast') {
        md += `| Webcast（未ダウンロード） | - | ${doc.url} |\n`;
        continue;
      }
      const fileName = getFileName(doc);
      md += `| ${doc.name} | \`${fileName}\` | ${doc.url} |\n`;
    }

    md += `\n`;
  }

  md += `---\n\n`;
}

md += `## ツールファイル

| ファイル | 説明 |
|----------|------|
| \`ir-links.json\` | IRページからスクレイピングした全資料リンク |
| \`ir-page.html\` | IRページのHTML（デバッグ用） |
| \`scrape-ir.js\` | IRページスクレイピングスクリプト |
| \`download-all.js\` | 一括ダウンロードスクリプト |
| \`download-missing.js\` | 欠落ファイル補完スクリプト |
| \`download-results.json\` | ダウンロード結果ログ |
| \`generate-readme.js\` | 本README生成スクリプト |
`;

const outputPath = '/home/ubuntu/ai-financial-analyst/companies/nvidia/filings/README.md';
fs.writeFileSync(outputPath, md);
console.log(`README.md generated (${md.length} bytes)`);
