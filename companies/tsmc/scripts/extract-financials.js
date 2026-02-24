// press-release.html から損益計算書データを抽出するスクリプト
// TSMCのプレスリリースはシンプルな6行テーブル
// 出力: financials.json
// 単位: NT$ million（EPSを除く）

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'financials.json');

// TSMCのP/L行ラベル → JSONキーのマッピング
const ROW_LABELS = {
  'Net sales': 'revenue',
  'Gross profit': 'grossProfit',
  'Income from operations': 'operatingIncome',
  'Income before tax': 'incomeBeforeTax',
  'Net income': 'netIncome',
  'EPS': 'eps',
};

/**
 * テキストから数値をパース
 * "1,046,090" → 1046090, "19.50" → 19.50, "(2.1)" → -2.1
 * 全角括弧にも対応: ＜＞
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;
  let cleaned = text.trim();
  // 全角括弧を半角に変換
  cleaned = cleaned.replace(/\uff08/g, '(').replace(/\uff09/g, ')');
  let negative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.replace(/,/g, '').replace(/\s/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * テーブル行からセルのテキスト配列を抽出
 */
function extractCells($, row) {
  const cells = [];
  $(row).find('td').each((i, td) => {
    const text = $(td).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) cells.push(text);
  });
  return cells;
}

/**
 * P/Lテーブルを探して解析する
 * TSMCのプレスリリースは通常1テーブルだが、FY2024/Q1-Q2等では分割されている
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);

  // 全テーブルを走査し、P/L関連データを含むテーブルをすべて収集
  const plTables = [];
  $('table').each((i, table) => {
    const text = $(table).text();
    const hasRevenue = text.includes('Net sales');
    const hasProfit = text.includes('Gross profit') || text.includes('Income from operations');
    const hasBottom = text.includes('Net income') || text.includes('Income before tax');
    if (hasRevenue || hasProfit || hasBottom) {
      plTables.push($(table));
    }
  });

  if (plTables.length === 0) {
    console.warn(`  警告: ${fy}/${q} - P/Lテーブルが見つかりません`);
    return null;
  }

  const result = {};

  // 全P/Lテーブルから行を抽出
  for (const targetTable of plTables) {
    const rows = targetTable.find('tr');
    rows.each((i, row) => {
      const cells = extractCells($, row);
      if (cells.length < 2) return;

      const label = cells[0];
      let key = null;
      for (const [pattern, k] of Object.entries(ROW_LABELS)) {
        if (label.startsWith(pattern)) {
          key = k;
          break;
        }
      }
      if (!key || key in result) return;

      const rawValue = cells[1];
      const value = parseNumber(rawValue);
      if (value === null) return;

      result[key] = value;
    });
  }

  // 計算項目を追加
  if (result.revenue && result.grossProfit) {
    result.costOfRevenue = result.revenue - result.grossProfit;
  }
  if (result.grossProfit && result.operatingIncome) {
    result.operatingExpenses = result.grossProfit - result.operatingIncome;
  }
  if (result.incomeBeforeTax && result.operatingIncome) {
    result.nonOperatingIncome = result.incomeBeforeTax - result.operatingIncome;
  }
  if (result.incomeBeforeTax && result.netIncome) {
    result.incomeTaxExpense = result.incomeBeforeTax - result.netIncome;
  }

  // 発行済株式数をフットノートから抽出
  // "Based on 25,931 million weighted average outstanding shares"
  const fullText = $.text();
  const sharesMatch = fullText.match(/Based on ([\d,]+) million weighted average/);
  if (sharesMatch) {
    result.sharesDiluted = parseNumber(sharesMatch[1]);
  }

  // ADR EPS（USD）を本文から抽出
  // パターン: "US$3.14 per ADR unit" or "(US$3.14 per ADR unit)"
  const adrMatch = fullText.match(/US.?([\d.]+)\s*per ADR/i);
  if (adrMatch) {
    result.epsADR = parseFloat(adrMatch[1]);
  }

  return result;
}

// メイン処理
function main() {
  const financials = {};

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const prPath = path.join(fyPath, q, 'press-release.html');
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.html が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        if (!financials[fy]) financials[fy] = {};
        financials[fy][q] = data;

        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目抽出: revenue=${data.revenue}, netIncome=${data.netIncome}, eps=${data.eps}`);
      }
    }
  }

  // JSON出力
  const dataDir = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(financials, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(financials)) {
    for (const q of Object.keys(financials[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のデータを抽出`);
}

main();
