// Tesla press-release.html / 10-Q / 10-K から貸借対照表データを抽出するスクリプト
// 出力: data/balance-sheet.json
//
// データソース:
// 1. プレスリリース（テキストデータあり）: FONT/p要素から5四半期分を一括抽出
//    - FY2020 Q1-Q3, FY2023 Q2以降のプレスリリースが対象
// 2. 10-Q/10-K（テキストデータなしの期間）: HTMLテーブルから当期データを抽出
//    - FY2020 Q4 〜 FY2023 Q1が対象
//
// Teslaは暦年FY（FY2025 = カレンダー年2025）
// 日付→四半期マッピング:
//   31-Dec-YY → FYXXXX Q4, 31-Mar-YY → FYXXXX Q1,
//   30-Jun-YY → FYXXXX Q2, 30-Sep-YY → FYXXXX Q3

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'balance-sheet.json');

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * テキストから数値をパース
 * "(96)" → -96, "25,707" → 25707, "—" → null
 */
function parseNumber(text) {
  if (!text) return null;
  text = text.replace(/[$\s\u00a0]/g, '').trim();
  if (!text || text === '-' || text === '—' || text === '–' || text === '\u2014' || text === '\u2013') return null;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/,/g, '');
  const num = parseFloat(text);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * 日付文字列を FY/Q に変換（貸借対照表の日付ヘッダー用）
 * "31-Dec-24" → { fy: "FY2024", q: "Q4" }
 * "31-Mar-25" → { fy: "FY2025", q: "Q1" }
 * "30-Jun-25" → { fy: "FY2025", q: "Q2" }
 * "30-Sep-25" → { fy: "FY2025", q: "Q3" }
 */
function dateHeaderToFYQ(dateStr) {
  const match = dateStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})/);
  if (!match) return null;

  const month = match[2].toLowerCase();
  const yearShort = parseInt(match[3]);
  // 2桁年を4桁に変換（00-99 → 2000-2099）
  const year = yearShort >= 0 && yearShort <= 99 ? 2000 + yearShort : yearShort;

  // 月末→四半期マッピング（Tesla暦年FY）
  const monthToQ = {
    'mar': { q: 'Q1', fy: year },
    'jun': { q: 'Q2', fy: year },
    'sep': { q: 'Q3', fy: year },
    'dec': { q: 'Q4', fy: year },
  };

  const mapping = monthToQ[month];
  if (!mapping) return null;

  return { fy: `FY${mapping.fy}`, q: mapping.q };
}

// ============================================================
// プレスリリーステキスト解析（メインソース）
// ============================================================

/**
 * プレスリリースHTMLからBalance Sheetのテキストブロックを取得
 * FONT/p要素から "ASSETS" AND "Total assets" AND "Total liabilities" を含むものを検出
 */
function findBalanceSheetText(html) {
  // HTMLエンティティをデコード
  html = html.replace(/&#8212;/g, '—').replace(/&#8211;/g, '–').replace(/&#160;/g, ' ').replace(/&#8217;/g, '\u2019');

  const $ = cheerio.load(html);
  let resultText = null;

  // 新形式: <FONT>要素を走査
  $('FONT, font').each((i, el) => {
    const text = $(el).text();
    if (text.includes('ASSETS') && text.includes('Total assets') && text.includes('Total liabilities')) {
      if (!resultText || text.length > resultText.length) {
        resultText = text;
      }
    }
  });

  // 旧形式: <p>要素を走査
  if (!resultText) {
    $('p').each((i, el) => {
      const text = $(el).text();
      if (text.includes('ASSETS') && text.includes('Total assets') && text.includes('Total liabilities')) {
        if (!resultText || text.length > resultText.length) {
          resultText = text;
        }
      }
    });
  }

  return resultText;
}

/**
 * テキストブロックから日付ヘッダーを抽出
 * "31-Dec-24 31-Mar-25 30-Jun-25 30-Sep-25 31-Dec-25" → ["31-Dec-24", "31-Mar-25", ...]
 */
function extractDateHeaders(text) {
  const headerRegex = /\d{1,2}-[A-Z][a-z]{2}-\d{2}/g;
  const headers = [];
  let match;
  // テキスト冒頭部分（最初の"ASSETS"の前）からヘッダーを抽出
  const assetsIdx = text.indexOf('ASSETS');
  const headerSection = assetsIdx > 0 ? text.substring(0, assetsIdx) : text.substring(0, 300);
  while ((match = headerRegex.exec(headerSection)) !== null) {
    headers.push(match[0]);
  }
  return headers;
}

/**
 * ラベルの後に続く数値をN個抽出する
 * extractNumbersAfterLabel と同じロジック（extract-financials.js から移植）
 * @param {string} text - 全テキスト
 * @param {RegExp} labelRegex - ラベルの正規表現
 * @param {number} numCols - 抽出する列数
 * @param {number} startPos - 検索開始位置
 * @returns {{ values: number[], endPos: number } | null}
 */
function extractNumbersAfterLabel(text, labelRegex, numCols, startPos = 0) {
  const searchText = text.substring(startPos);
  const labelMatch = searchText.match(labelRegex);
  if (!labelMatch) return null;

  const afterLabel = searchText.substring(labelMatch.index + labelMatch[0].length);
  const numbers = [];

  // 数値トークン: (123,456) or 123,456 or 0.66 or — or –
  // 脚注 (1) (2) (3) (4) は除外（1桁の括弧数字）
  const tokenRegex = /\((\d{2,}[\d,]*(?:\.\d+)?)\)|\((\d)\)|(\d[\d,]*(?:\.\d+)?)|([—–])/g;
  let m;
  let charCount = 0;

  while ((m = tokenRegex.exec(afterLabel)) !== null && numbers.length < numCols) {
    // 次のラベル（大文字英字3文字以上の連続）に到達したか確認
    const gap = afterLabel.substring(charCount, m.index);
    // "Total" "ASSETS" "Accounts" 等の英単語が出たら停止
    if (gap.match(/[A-Z][a-z]{2,}|(?<![A-Z] )[A-Z]{4,}(?! [A-Z])/)) {
      const word = gap.match(/[A-Z][a-z]{2,}|[A-Z]{4,}/);
      if (word && !['YoY'].includes(word[0])) break;
    }

    if (m[1]) {
      // 括弧付き2桁以上の数値 → 負数
      numbers.push(-parseFloat(m[1].replace(/,/g, '')));
    } else if (m[2]) {
      // 括弧付き1桁 → 脚注マーカー、スキップ
      continue;
    } else if (m[3]) {
      // 通常の数値
      numbers.push(parseFloat(m[3].replace(/,/g, '')));
    } else if (m[4]) {
      // ダッシュ → null
      numbers.push(null);
    }
    charCount = m.index + m[0].length;
  }

  if (numbers.length < numCols) return null;
  return {
    values: numbers.slice(0, numCols),
    endPos: startPos + labelMatch.index + labelMatch[0].length + charCount
  };
}

/**
 * プレスリリーステキストから貸借対照表データを抽出
 * @param {string} text - バランスシートのテキストブロック
 * @param {string[]} headers - 日付ヘッダー配列 ["31-Dec-24", "31-Mar-25", ...]
 * @returns {Object} { "31-Dec-24": { cashAndEquivalents: 36563, ... }, ... }
 */
function extractFromPressReleaseText(text, headers) {
  const numCols = headers.length;
  if (numCols === 0) return {};

  // セクション位置を特定
  const assetsStart = text.search(/\bASSETS\b/);
  const liabStart = text.search(/LIABILITIES AND EQUITY/i);

  const extractRow = (regex, startPos = 0) => {
    const result = extractNumbersAfterLabel(text, regex, numCols, startPos);
    return result ? result.values : null;
  };

  // === ASSETS セクション ===
  const assetsSectionStart = assetsStart > 0 ? assetsStart : 0;

  // Cash: "Cash, cash equivalents and investments" (新形式) or "Cash and cash equivalents" (旧形式)
  const cashAndEquivalents = extractRow(/Cash(?:[,\s]+| and )cash equivalents(?:\s+and\s+investments)?/i, assetsSectionStart);
  const accountsReceivable = extractRow(/Accounts receivable,?\s*net/i, assetsSectionStart);
  const inventory = extractRow(/Inventory/i, assetsSectionStart);
  const totalCurrentAssets = extractRow(/Total current assets/i, assetsSectionStart);
  const ppe = extractRow(/Property,?\s*plant and equipment,?\s*net/i, assetsSectionStart);
  const totalAssets = extractRow(/Total assets/i, assetsSectionStart);

  // === LIABILITIES セクション ===
  const liabSectionStart = liabStart > 0 ? liabStart : (assetsSectionStart + 500);

  const accountsPayable = extractRow(/Accounts payable/i, liabSectionStart);
  const totalCurrentLiabilities = extractRow(/Total current liabilities/i, liabSectionStart);
  const longTermDebt = extractRow(/Debt and finance leases,?\s*net of current portion/i, liabSectionStart);
  const totalLiabilities = extractRow(/Total liabilities(?!\s+and)/i, liabSectionStart);
  // "Total stockholders' equity" or "Total stockholders\u2019 equity"
  const totalEquity = extractRow(/Total stockholders[\u2019']?\s*equity/i, liabSectionStart);

  // 列ごとにオブジェクトを構築（日付ヘッダーをキーに）
  const result = {};
  for (let i = 0; i < numCols; i++) {
    const dateKey = headers[i];
    const data = {};

    if (cashAndEquivalents && cashAndEquivalents[i] != null) data.cashAndEquivalents = cashAndEquivalents[i];
    if (accountsReceivable && accountsReceivable[i] != null) data.accountsReceivable = accountsReceivable[i];
    if (inventory && inventory[i] != null) data.inventory = inventory[i];
    if (totalCurrentAssets && totalCurrentAssets[i] != null) data.totalCurrentAssets = totalCurrentAssets[i];
    if (ppe && ppe[i] != null) data.ppe = ppe[i];
    if (totalAssets && totalAssets[i] != null) data.totalAssets = totalAssets[i];
    if (accountsPayable && accountsPayable[i] != null) data.accountsPayable = accountsPayable[i];
    if (totalCurrentLiabilities && totalCurrentLiabilities[i] != null) data.totalCurrentLiabilities = totalCurrentLiabilities[i];
    if (longTermDebt && longTermDebt[i] != null) data.longTermDebt = longTermDebt[i];
    if (totalLiabilities && totalLiabilities[i] != null) data.totalLiabilities = totalLiabilities[i];
    if (totalEquity && totalEquity[i] != null) data.totalEquity = totalEquity[i];

    if (Object.keys(data).length > 0) {
      result[dateKey] = data;
    }
  }

  return result;
}

// ============================================================
// 10-Q/10-K テーブル解析（フォールバック）
// ============================================================

/**
 * 10-Q/10-K HTMLからConsolidated Balance Sheetsテーブルを解析
 * @param {string} filePath - 10-Q/10-K HTMLファイルパス
 * @returns {Object|null} { cashAndEquivalents: xxx, totalAssets: xxx, ... }
 */
function extractFromSecFiling(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html, { decodeEntities: true });

  // "Consolidated Balance Sheets" テーブルを探す
  let targetTable = null;
  $('table').each((i, table) => {
    const tableText = $(table).text();
    if (tableText.includes('Total assets') && tableText.includes('Total liabilities') && tableText.includes('Accounts payable')) {
      if (!targetTable) {
        targetTable = table;
      }
    }
  });

  // テーブルが見つからない場合、タイトルで検索
  if (!targetTable) {
    const titleEl = $('p, span, div').filter((i, el) => {
      const t = $(el).text().toLowerCase();
      return t.includes('consolidated balance sheet');
    }).first();

    if (titleEl.length) {
      targetTable = titleEl.closest('table').length ? titleEl.closest('table')[0] : titleEl.nextAll('table').first()[0];
    }
  }

  if (!targetTable) return null;

  const result = {};

  // 行マッピング定義（ラベル → 出力キー）
  const ROW_MAPPINGS = [
    { patterns: [/^Cash[,\s]+cash equivalents/i, /^Cash and cash equivalents$/i], key: 'cashAndEquivalents' },
    { patterns: [/^Accounts receivable/i], key: 'accountsReceivable' },
    { patterns: [/^Inventory$/i, /^Inventories$/i], key: 'inventory' },
    { patterns: [/^Total current assets$/i], key: 'totalCurrentAssets' },
    { patterns: [/^Property,?\s*plant and equipment/i], key: 'ppe' },
    { patterns: [/^Total assets$/i], key: 'totalAssets' },
    { patterns: [/^Accounts payable$/i], key: 'accountsPayable' },
    { patterns: [/^Total current liabilities$/i], key: 'totalCurrentLiabilities' },
    { patterns: [/^Debt and finance leases,?\s*net of current/i], key: 'longTermDebt' },
    { patterns: [/^Total liabilities$/i], key: 'totalLiabilities' },
    { patterns: [/^Total stockholders[\u2019']?\s*equity/i], key: 'totalEquity' },
  ];

  $(targetTable).find('tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    // ラベル取得
    let label = '';
    cells.each((j, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !/^[\$\d,.()\s—–\u2014\u2013]+$/.test(text) && text !== '$' && !label) {
        label = text;
      }
    });
    if (!label) return;

    // 数値取得（最初の有効な数値列 = 当期データ）
    const values = [];
    cells.each((j, cell) => {
      // ix:nonFraction タグから直接抽出
      const ixEl = $(cell).find('ix\\:nonFraction, ix\\:nonfraction');
      if (ixEl.length > 0) {
        const val = parseNumber(ixEl.first().text().trim());
        if (val !== null) {
          const sign = ixEl.first().attr('sign');
          values.push(sign === '-' ? -Math.abs(val) : val);
          return;
        }
      }
      const text = $(cell).text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
      if (text && /[\d]/.test(text) && text !== '$') {
        const val = parseNumber(text);
        if (val !== null) values.push(val);
      }
    });

    if (values.length === 0) return;
    const firstValue = values[0];

    // マッピング（最初にマッチしたもののみ）
    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in result)) {
          result[mapping.key] = firstValue;
        }
        break;
      }
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

// ============================================================
// メイン処理
// ============================================================

function main() {
  const allData = {}; // { "FY2025": { "Q4": { ... } } }

  // Step 1: 全プレスリリースをスキャンし、テキストデータがあるものから5四半期分を抽出
  console.log('=== Step 1: プレスリリースからバランスシートデータ抽出 ===');

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  // 古い順にスキャンし、新しいデータで上書き（最新のrestatementを反映）
  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const prPath = path.join(fyPath, q, 'press-release.html');
      if (!fs.existsSync(prPath)) continue;

      const html = fs.readFileSync(prPath, 'utf-8');
      const text = findBalanceSheetText(html);

      if (!text) {
        console.log(`  ${fy}/${q}: テキストデータなし（イメージ形式）`);
        continue;
      }

      const headers = extractDateHeaders(text);
      if (headers.length === 0) {
        console.log(`  ${fy}/${q}: ヘッダー抽出失敗`);
        continue;
      }

      console.log(`  ${fy}/${q}: テキストデータあり → ${headers.join(', ')}`);
      const quarterData = extractFromPressReleaseText(text, headers);

      // 日付ヘッダー→FY/Qに変換して格納
      for (const [dateKey, data] of Object.entries(quarterData)) {
        const fyq = dateHeaderToFYQ(dateKey);
        if (!fyq) {
          console.log(`    ${dateKey}: FY/Q変換失敗 → スキップ`);
          continue;
        }
        if (!allData[fyq.fy]) allData[fyq.fy] = {};
        // 新しいプレスリリースのデータで上書き（restatement対応）
        allData[fyq.fy][fyq.q] = { ...(allData[fyq.fy][fyq.q] || {}), ...data };
      }
    }
  }

  // Step 2: テキストデータのないプレスリリースの四半期は10-Q/10-Kからフォールバック
  console.log('\n=== Step 2: 10-Q/10-Kからフォールバック抽出 ===');

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      // 既にプレスリリースからデータ取得済みならスキップ
      if (allData[fy] && allData[fy][q] && allData[fy][q].totalAssets) continue;

      // 10-Q or 10-K ファイルを探す
      const qDir = path.join(fyPath, q);
      const tenQPath = path.join(qDir, '10-Q.htm');
      const tenKPath = path.join(qDir, '10-K.htm');
      const filePath = fs.existsSync(tenQPath) ? tenQPath : (fs.existsSync(tenKPath) ? tenKPath : null);

      if (!filePath) {
        console.log(`  ${fy}/${q}: 10-Q/10-Kファイルなし → スキップ`);
        continue;
      }

      console.log(`  ${fy}/${q}: ${path.basename(filePath)} から抽出中...`);

      // 貸借対照表は期末時点のスナップショットなので、10-Kでも当期データをそのまま使用
      // （P/Lと異なり、年間合計から差し引く必要がない）
      const data = extractFromSecFiling(filePath);
      if (data && data.totalAssets) {
        if (!allData[fy]) allData[fy] = {};
        allData[fy][q] = { ...(allData[fy][q] || {}), ...data };

        const keys = Object.keys(allData[fy][q]);
        console.log(`    → ${keys.length} 項目抽出 (Total Assets: ${data.totalAssets})`);
      } else {
        console.log(`    → 抽出失敗`);
      }
    }
  }

  // Step 2.5: FY2019以前のデータを除外
  for (const fy of Object.keys(allData)) {
    const year = parseInt(fy.replace('FY', ''));
    if (year < 2020) {
      delete allData[fy];
      console.log(`  ${fy}: FY2019以前のため除外`);
    }
  }

  // Step 3: データ検証・整形
  console.log('\n=== Step 3: データ検証 ===');
  const sortedFYs = Object.keys(allData).sort();
  let totalQuarters = 0;
  let missingAssets = 0;

  for (const fy of sortedFYs) {
    const sortedQs = Object.keys(allData[fy]).sort();
    for (const q of sortedQs) {
      totalQuarters++;
      const d = allData[fy][q];
      const keys = Object.keys(d);

      if (!d.totalAssets) {
        missingAssets++;
        console.warn(`  ⚠ ${fy}/${q}: Total Assets なし`);
      }
      if (!d.totalLiabilities && d.totalLiabilities !== 0) {
        console.warn(`  ⚠ ${fy}/${q}: Total Liabilities なし`);
      }
      if (!d.totalEquity && d.totalEquity !== 0) {
        console.warn(`  ⚠ ${fy}/${q}: Total Equity なし`);
      }

      console.log(`  ${fy}/${q}: ${keys.length} 項目 (Total Assets: ${d.totalAssets || 'N/A'})`);
    }
  }

  // Step 4: FY/Qキーをソートして出力
  const sortedOutput = {};
  for (const fy of sortedFYs) {
    sortedOutput[fy] = {};
    const sortedQs = Object.keys(allData[fy]).sort();
    for (const q of sortedQs) {
      sortedOutput[fy][q] = allData[fy][q];
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sortedOutput, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  console.log(`合計: ${totalQuarters} 四半期 (Total Assets欠落: ${missingAssets})`);
}

main();
