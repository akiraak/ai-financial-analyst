// 10-Q/10-K HTM から投資ポートフォリオ情報を抽出するスクリプト
// 出力: investments.json
//
// 抽出項目:
//   - 非上場株式（Non-marketable equity securities/investments）の期末残高
//   - 上場株式（Marketable equity securities）の期末残高（Fair Valueテーブルから）
//
// データソース:
//   非上場: "non-marketable equity" の "following table" テーブル（FY2022 Q2以降）
//   上場: Fair Value hierarchy テーブルの "Marketable equity securities" 行
//
// 10-K: バランスシート日付の残高をそのままQ4として格納（フロー項目ではないため）

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
  }

  cleaned = cleaned.replace(/,/g, '');
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * テーブル行からセルテキストの配列を取得
 * 空セルと$記号のみのセルは除外
 */
function getRowCells($, tr) {
  const cells = [];
  $(tr).find('td').each((i, td) => {
    const text = $(td).text().trim().replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
    if (text && text !== '$') {
      cells.push(text);
    }
  });
  return cells;
}

/**
 * 非上場株式テーブルから残高を抽出
 * "non-marketable equity" の "following table" を探し、Total行の最初の数値を返す
 *
 * @param {object} $ - cheerioオブジェクト
 * @returns {number|null} - 非上場株式の合計残高
 */
function extractNonMarketableBalance($) {
  let table = null;

  // "non-marketable equity" と "following table" を含むdivを探す
  $('div').each((i, el) => {
    if (table) return;
    const text = $(el).text().trim();
    if (text.includes('non-marketable equity') && text.includes('following table') && text.length < 500) {
      // 次の兄弟要素からテーブルを探す
      let sib = $(el);
      for (let j = 0; j < 5; j++) {
        sib = sib.next();
        if (!sib.length) break;
        const tag = sib.prop('tagName');
        const t = tag === 'TABLE' ? sib : sib.find('table').first();
        if (t.length) {
          table = t;
          break;
        }
      }
    }
  });

  if (!table) return null;

  // テーブルからTotal行を探す（当期の最初の数値）
  let totalBalance = null;
  let carryingValue = null;
  let equityMethod = null;

  table.find('tr').each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;
    const label = cells[0].toLowerCase();

    // Total行（"Total", "Total non-marketable equity securities/investments"）
    if (/^total/i.test(cells[0]) && totalBalance === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) totalBalance = nums[0];
    }

    // Carrying value行（旧形式: measurement alternative の小計）
    if (/^carrying value$/i.test(cells[0]) && carryingValue === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) carryingValue = nums[0];
    }

    // 新形式: "Non-marketable equity investments under measurement alternative" 行
    if (/non-marketable equity.*measurement alternative/i.test(cells[0]) && carryingValue === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) carryingValue = nums[0];
    }

    // Equity method行
    if (/equity method/i.test(cells[0]) && equityMethod === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) equityMethod = nums[0];
    }
  });

  return {
    total: totalBalance,
    measurementAlternative: carryingValue,
    equityMethod: equityMethod,
  };
}

/**
 * Fair Valueテーブルから上場株式残高を抽出
 * "Marketable equity securities" 行の最初の数値（Fair Value列）を返す
 *
 * 注: Fair Valueテーブルは通常2つある（当期 + 前期比較）。
 * 当期テーブル（最初のテーブル）にのみ含まれる場合を正とする。
 * 当期テーブルに行がなければ、その四半期は上場株式を保有していない。
 *
 * @param {object} $ - cheerioオブジェクト
 * @returns {number|null} - 上場株式の残高
 */
function extractMarketableEquityBalance($) {
  let balance = null;

  // "fair value" と "hierarchy" を含むdivを探す
  // その直後の兄弟要素内のテーブルを全て走査
  let tables = [];
  $('div').each((i, el) => {
    if (tables.length > 0) return;
    const text = $(el).text().trim();
    if (text.includes('fair value') && text.includes('hierarchy') && text.includes('following') && text.length < 500) {
      // 次の複数の兄弟要素からテーブルを収集（最大2つ）
      let sib = $(el);
      for (let j = 0; j < 10 && tables.length < 2; j++) {
        sib = sib.next();
        if (!sib.length) break;
        const tag = sib.prop('tagName');
        const t = tag === 'TABLE' ? sib : sib.find('table').first();
        if (t.length) {
          tables.push(t);
        }
      }
    }
  });

  if (tables.length === 0) return null;

  // 最初のテーブル（当期）から "Marketable equity securities" 行を探す
  tables[0].find('tr').each((i, tr) => {
    if (balance !== null) return;
    const cells = getRowCells($, tr);
    if (cells.length >= 2 && /^Marketable equity securities$/i.test(cells[0])) {
      balance = parseNumber(cells[1]);
    }
  });

  return balance;
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

      // 非上場株式残高を抽出
      const nonMarketable = extractNonMarketableBalance($);

      // 上場株式残高を抽出（Fair Valueテーブルから）
      const marketableEquity = extractMarketableEquityBalance($);

      // エントリを構築
      const entry = {};
      let hasData = false;

      if (nonMarketable && nonMarketable.total !== null) {
        entry.nonMarketableBalance = nonMarketable.total;
        entry.measurementAlternative = nonMarketable.measurementAlternative;
        entry.equityMethod = nonMarketable.equityMethod;
        hasData = true;
      }

      if (marketableEquity !== null) {
        entry.marketableEquityBalance = marketableEquity;
        hasData = true;
      }

      if (hasData) {
        if (!result[fy]) result[fy] = {};
        result[fy][q] = entry;
        const parts = [];
        if (entry.nonMarketableBalance !== undefined) parts.push(`非上場=$${entry.nonMarketableBalance}M`);
        if (entry.marketableEquityBalance !== undefined) parts.push(`上場株式=$${entry.marketableEquityBalance}M`);
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
