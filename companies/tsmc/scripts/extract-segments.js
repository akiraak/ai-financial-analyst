// presentation.html の隠しテキストからRevenue by Platformデータを抽出するスクリプト
// TSMCはプラットフォーム別売上比率をプレゼンテーションで公表
// セグメント: HPC, Smartphone, IoT, Automotive, DCE, Others
// 出力: segments.json
// 値: 売上比率（%）× 総売上で計算したNT$ million

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segments.json');
const FINANCIALS_PATH = path.join(__dirname, '..', 'data', 'financials.json');

// TSMCのプラットフォーム定義
const PLATFORMS = ['HPC', 'Smartphone', 'IoT', 'Automotive', 'DCE', 'Others'];

/**
 * プレゼンテーションの隠しテキスト要素を全取得
 */
function getHiddenTexts($) {
  const texts = [];
  $('font, p').each((i, el) => {
    const style = $(el).attr('style') || '';
    if (style.includes('1pt') && (style.includes('white') || style.includes('#FFFFFF'))) {
      const t = $(el).text().trim().replace(/\s+/g, ' ');
      if (t.length > 10) texts.push(t);
    }
  });
  return texts;
}

/**
 * "Revenue by Platform" スライドからプラットフォーム比率を抽出
 * テキスト例: "4Q25 Revenue by Platform" or
 * "Smartphone 34% Automotive 7% HPC 44% DCE 2% Others 4% IoT 9%"
 */
function extractPlatformPercentages(texts, qLabel) {
  // まず当四半期のRevenue by Platformスライドを探す
  const qPattern = new RegExp(qLabel + '\\s+Revenue by Platform', 'i');

  for (const text of texts) {
    // 当四半期のプラットフォームスライドを検索
    if (qPattern.test(text) || (text.includes('Revenue by Platform') && text.includes('%'))) {
      const percentages = {};
      for (const platform of PLATFORMS) {
        const re = new RegExp(platform + '\\s+(\\d+)%', 'i');
        const m = text.match(re);
        if (m) {
          percentages[platform.toLowerCase()] = parseInt(m[1]);
        }
      }
      // 少なくとも3つのプラットフォームが見つかったら有効
      if (Object.keys(percentages).length >= 3) {
        return percentages;
      }
    }
  }

  // フォールバック: 全テキストから "Smartphone XX%" パターンを含むものを探す
  for (const text of texts) {
    if (text.includes('Smartphone') && text.includes('%') && text.includes('HPC')) {
      const percentages = {};
      for (const platform of PLATFORMS) {
        const re = new RegExp(platform + '\\s+(\\d+)%', 'i');
        const m = text.match(re);
        if (m) {
          percentages[platform.toLowerCase()] = parseInt(m[1]);
        }
      }
      if (Object.keys(percentages).length >= 3) {
        return percentages;
      }
    }
  }

  return null;
}

/**
 * presentation.html からセグメント売上を抽出
 */
function extractFromFile(filePath, fy, q, revenue) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);

  const hiddenTexts = getHiddenTexts($);

  // 四半期ラベル（例: "4Q25"）
  const year2d = fy.replace('FY20', '');
  const qLabel = q + year2d;

  const percentages = extractPlatformPercentages(hiddenTexts, qLabel);
  if (!percentages) return null;

  // 比率 × 総売上 で金額（NT$ million）を計算
  const result = {};
  for (const [platform, pct] of Object.entries(percentages)) {
    if (revenue) {
      result[platform] = Math.round(revenue * pct / 100);
    } else {
      // revenueがない場合は比率のみ保存
      result[platform] = pct;
    }
  }
  result._percentages = percentages;

  return result;
}

// メイン処理
function main() {
  // financials.json から売上高を読み込み
  let financials = {};
  if (fs.existsSync(FINANCIALS_PATH)) {
    financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  }

  const segments = {};

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const presPath = path.join(fyPath, q, 'presentation.html');
      if (!fs.existsSync(presPath)) {
        console.log(`  スキップ: ${fy}/${q} - presentation.html なし`);
        continue;
      }

      // 対応する売上高を取得
      const revenue = financials[fy]?.[q]?.revenue || null;

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(presPath, fy, q, revenue);
      if (data) {
        if (!segments[fy]) segments[fy] = {};
        segments[fy][q] = data;

        const pct = data._percentages;
        const total = Object.values(pct).reduce((s, v) => s + v, 0);
        console.log(`  → ${Object.keys(pct).length} プラットフォーム (合計${total}%): ${Object.entries(pct).map(([k,v]) => `${k}=${v}%`).join(', ')}`);
      } else {
        console.log(`  → セグメントデータなし`);
      }
    }
  }

  const dataDir = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(segments, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(segments)) {
    for (const q of Object.keys(segments[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のセグメントデータを抽出`);
}

main();
