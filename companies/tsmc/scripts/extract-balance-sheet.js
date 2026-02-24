// presentation.html の隠しテキストからB/Sデータを抽出するスクリプト
// TSMCのプレゼンテーションはスライド画像 + font-size:1pt/color:white の隠しテキスト構造
// FY2023以降のみ数値データが隠しテキストに含まれる
// 出力: balance-sheet.json
// 単位: NT$ billion → NT$ million に変換して保存

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'balance-sheet.json');

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
 * B/Sスライドの隠しテキストからデータを抽出
 * 対象テキスト例:
 * "Balance Sheets & Key Indices ... Cash & Marketable Securities 3,068.59 38.7 % ...
 *  Total Assets 7,933.02 100.0 % ... Total Liabilities 2,472.23 31.2 % ...
 *  Total Shareholders' Equity 5,460.79 68.8 % ..."
 */
function extractBalanceSheet(text) {
  const result = {};

  // 各項目を正規表現で抽出（金額はNT$ billion単位、小数点1桁）
  const patterns = [
    { key: 'cashAndMarketable', re: /Cash\s*&\s*Marketable Securities\s+([\d,]+\.\d+)/ },
    { key: 'accountsReceivable', re: /Accounts Receivable\s+([\d,]+\.\d+)/ },
    { key: 'inventories', re: /Inventories\s+([\d,]+\.\d+)/ },
    { key: 'longTermInvestments', re: /Long-term Investments\s+([\d,]+\.\d+)/ },
    { key: 'netPPE', re: /Net PP&E\s+([\d,]+\.\d+)/ },
    { key: 'totalAssets', re: /Total Assets\s+([\d,]+\.\d+)/ },
    { key: 'currentLiabilities', re: /Current Liabilities\s+([\d,]+\.\d+)/ },
    { key: 'longTermDebt', re: /Long-term Interest-bearing Debts?\s+([\d,]+\.\d+)/ },
    { key: 'totalLiabilities', re: /Total Liabilities\s+([\d,]+\.\d+)/ },
    { key: 'totalEquity', re: /Total Shareholders.?\s*Equity\s+([\d,]+\.\d+)/ },
  ];

  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) {
      // NT$ billion → NT$ million に変換
      const val = parseFloat(m[1].replace(/,/g, ''));
      result[p.key] = Math.round(val * 1000);
    }
  }

  // Key Indices の抽出
  const arDaysMatch = text.match(/A\/R Turnover Days\s+(\d+)/);
  if (arDaysMatch) result.arTurnoverDays = parseInt(arDaysMatch[1]);

  const invDaysMatch = text.match(/Inventory Turnover Days\s+(\d+)/);
  if (invDaysMatch) result.inventoryTurnoverDays = parseInt(invDaysMatch[1]);

  const currentRatioMatch = text.match(/Current Ratio\s*\(x\)\s+([\d.]+)/);
  if (currentRatioMatch) result.currentRatio = parseFloat(currentRatioMatch[1]);

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * presentation.html からB/Sデータを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);

  const hiddenTexts = getHiddenTexts($);

  // "Balance Sheets" と "Total Assets" を含む隠しテキストを検索
  for (const text of hiddenTexts) {
    if (text.includes('Balance Sheet') && text.includes('Total Assets') && text.match(/[\d,]+\.\d/)) {
      return extractBalanceSheet(text);
    }
  }

  return null;
}

// メイン処理
function main() {
  const balanceSheet = {};

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
        if (!balanceSheet[fy]) balanceSheet[fy] = {};
        balanceSheet[fy][q] = data;

        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目: totalAssets=${data.totalAssets}, totalEquity=${data.totalEquity}`);
      } else {
        console.log(`  → B/Sデータなし（隠しテキストに含まれていない期間）`);
      }
    }
  }

  const dataDir = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(balanceSheet, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(balanceSheet)) {
    for (const q of Object.keys(balanceSheet[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のB/Sデータを抽出`);
}

main();
