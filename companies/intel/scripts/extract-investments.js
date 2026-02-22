// 10-Q/10-K HTM から投資ポートフォリオ情報を抽出するスクリプト
// 出力: investments.json
//
// 抽出項目:
//   - Marketable equity securities/investments（上場株式）
//   - Non-marketable equity securities/investments（非上場株式）
//   - Equity method investments（持分法投資）- ある場合のみ
//
// データソース:
//   "Equity Investments" ノート内のテーブルから各カテゴリの残高を取得
//   テーブル構造: Marketable / Non-marketable / Equity method / Total
//
// FY2020-FY2023: "Marketable equity securities" / "Non-marketable equity securities" / "Equity method investments"
// FY2024+: "Marketable equity investments" / "Non-marketable equity investments" (Equity method行なし)
//
// 10-Q: 四半期末残高をそのまま格納
// 10-K: 決算期末残高をQ4として格納（ストック項目のため按分不要）

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'investments.json');

/**
 * テキストから数値をパース
 * "(1,234)" → -1234, "57,006" → 57006, "—" → null
 */
function parseNumber(text) {
  if (!text) return null;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned === '—' || cleaned === '-' || cleaned === '\u2014' || cleaned === '\u2013' || cleaned === '') return null;

  let negative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  } else if (cleaned.startsWith('(')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  }

  cleaned = cleaned.replace(/,/g, '');
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * テーブル行からセルテキストの配列を取得
 * 空セル、$記号のみ、閉じ括弧のみのセルは除外
 */
function getRowCells($, tr) {
  const cells = [];
  $(tr).find('td').each((i, td) => {
    const text = $(td).text().trim().replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
    if (text && text !== '$' && text !== ')') {
      cells.push(text);
    }
  });
  return cells;
}

/**
 * 株式投資の内訳テーブルを探す
 * "Marketable equity" と "Non-marketable equity" と "Total" を含む小さなテーブル
 */
function findEquityInvestmentTable($) {
  let bestTable = null;
  let bestScore = 0;

  $('table').each((i, table) => {
    const text = $(table).text().replace(/\s+/g, ' ').trim();
    // 投資テーブルの特徴: 200文字以下で Marketable/Non-marketable/Total を含む
    if (text.length > 50 && text.length < 500) {
      let score = 0;
      if (/marketable equity/i.test(text)) score += 3;
      if (/non-marketable equity/i.test(text)) score += 3;
      if (/total/i.test(text)) score += 1;
      // "Equity method" はFY2020-2023にのみ存在
      if (/equity method/i.test(text)) score += 1;
      // 投資テーブルは短いテーブル（200文字未満が理想的）
      if (text.length < 250) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestTable = $(table);
      }
    }
  });

  return bestScore >= 6 ? bestTable : null;
}

/**
 * 投資テーブルからデータを抽出
 * @param {object} $ - cheerioオブジェクト
 * @param {object} table - cheerioテーブル要素
 * @returns {object|null} - { marketableEquity, nonMarketableEquity, equityMethod, total }
 */
function extractInvestmentData($, table) {
  const data = {};

  table.find('tr').each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length < 2) return;
    const label = cells[0];

    // 最初の数値が当期データ
    const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
    if (nums.length === 0) return;
    const value = nums[0];

    // Marketable equity securities / investments
    if (/^Marketable equity/i.test(label)) {
      data.marketableEquity = value;
    }
    // Non-marketable equity securities / investments
    if (/^Non-marketable equity/i.test(label)) {
      data.nonMarketableEquity = value;
    }
    // Equity method investments
    if (/^Equity method/i.test(label)) {
      data.equityMethod = value;
    }
    // Total
    if (/^Total$/i.test(label)) {
      data.total = value;
    }
  });

  return Object.keys(data).length > 0 ? data : null;
}

// メイン処理
function main() {
  const result = {};

  // FY*/Q* ディレクトリを走査
  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const qPath = path.join(fyPath, q);
      const isQ4 = q === 'Q4';
      const htmName = isQ4 ? '10-K.htm' : '10-Q.htm';
      const htmPath = path.join(qPath, htmName);

      if (!fs.existsSync(htmPath)) {
        console.warn(`  スキップ: ${fy}/${q} - ${htmName} が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q} (${htmName})`);

      const html = fs.readFileSync(htmPath, 'utf-8');
      const $ = cheerio.load(html);

      // 投資テーブルを検索
      const table = findEquityInvestmentTable($);
      if (!table) {
        console.warn(`  ⚠ 投資テーブルが見つかりません`);
        continue;
      }

      const data = extractInvestmentData($, table);
      if (data) {
        if (!result[fy]) result[fy] = {};
        result[fy][q] = data;

        const parts = [];
        if (data.marketableEquity !== undefined) parts.push(`上場=$${data.marketableEquity}M`);
        if (data.nonMarketableEquity !== undefined) parts.push(`非上場=$${data.nonMarketableEquity}M`);
        if (data.equityMethod !== undefined) parts.push(`持分法=$${data.equityMethod}M`);
        if (data.total !== undefined) parts.push(`合計=$${data.total}M`);
        console.log(`  → ${parts.join(', ')}`);
      } else {
        console.warn(`  ⚠ 投資データが見つかりません`);
      }
    }
  }

  // JSON出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(result)) {
    for (const q of Object.keys(result[fy])) {
      total++;
    }
  }
  console.log(`合計: ${total} 四半期分の投資データを抽出`);
}

main();
