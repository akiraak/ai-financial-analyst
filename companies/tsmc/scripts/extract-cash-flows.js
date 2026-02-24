// presentation.html の隠しテキストからキャッシュフローデータを抽出するスクリプト
// TSMCのプレゼンテーションはスライド画像 + font-size:1pt/color:white の隠しテキスト構造
// FY2023以降のみ数値データが隠しテキストに含まれる
// 出力: cash-flows.json
// 単位: NT$ billion → NT$ million に変換して保存

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'cash-flows.json');

/**
 * プレゼンテーションの隠しテキスト要素を全取得
 */
function getHiddenTexts($) {
  const texts = [];
  $('font, p').each((i, el) => {
    const style = $(el).attr('style') || '';
    if (style.includes('1pt') && (style.includes('white') || style.includes('#FFFFFF'))) {
      const t = $(el).text().trim().replace(/\s+/g, ' ');
      if (t.length > 20) texts.push(t);
    }
  });
  return texts;
}

/**
 * NT$ billionの値をパース（括弧は負数）
 * "725.51" → 725.51, "(356.91)" → -356.91
 */
function parseBillion(text) {
  if (!text) return null;
  let cleaned = text.trim();
  let negative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * CFスライドの隠しテキストからデータを抽出
 * 対象テキスト例:
 * "Cash Flows * Free cash flow = Cash from operating activities – Capital expenditures
 *  (In NT$ billions) 4Q25 3Q25 4Q24
 *  Beginning Balance 2,470.76 2,364.52 1,886.78
 *  Cash from operating activities 725.51 426.83 620.21
 *  Capital expenditures (356.91) (287.45) (361.95)
 *  Cash dividends (129.66) (116.70) (103.73)
 *  Bonds payable 21.75 (9.06) (1.75)
 *  Investments and others 36.41 92.62 88.07
 *  Ending Balance 2,767.86 2,470.76 2,127.63
 *  Free Cash Flow * 368.60 139.38 258.26"
 */
function extractCashFlows(text) {
  const result = {};

  // 各項目を正規表現で抽出（最初の数値 = 当四半期）
  const patterns = [
    { key: 'operatingCF', re: /Cash from operating activities\s+(\(?\d[\d,.]*\)?)/ },
    { key: 'capex', re: /Capital expenditures\s+(\(?\d[\d,.]*\)?)/ },
    { key: 'dividends', re: /Cash dividends\s+(\(?\d[\d,.]*\)?)/ },
    { key: 'freeCashFlow', re: /Free Cash Flow\s*\*?\s+(\(?\d[\d,.]*\)?)/ },
  ];

  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) {
      const val = parseBillion(m[1]);
      if (val !== null) {
        // NT$ billion → NT$ million に変換
        result[p.key] = Math.round(val * 1000);
      }
    }
  }

  // capexを正の値に変換（元データは負値）して investingCF相当として保存
  // ただしcapexは負の値のまま保持

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * presentation.html からCFデータを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);

  const hiddenTexts = getHiddenTexts($);

  // "Cash Flows" と "operating activities" を含む隠しテキストを検索
  for (const text of hiddenTexts) {
    if (text.includes('Cash Flow') && text.includes('operating activities') && text.match(/[\d,]+\.\d/)) {
      return extractCashFlows(text);
    }
  }

  return null;
}

// メイン処理
function main() {
  const cashFlows = {};

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

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(presPath, fy, q);
      if (data) {
        if (!cashFlows[fy]) cashFlows[fy] = {};
        cashFlows[fy][q] = data;

        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目: operatingCF=${data.operatingCF}, freeCashFlow=${data.freeCashFlow}`);
      } else {
        console.log(`  → CFデータなし（隠しテキストに含まれていない期間）`);
      }
    }
  }

  const dataDir = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cashFlows, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(cashFlows)) {
    for (const q of Object.keys(cashFlows[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のCFデータを抽出`);
}

main();
