// 10-Q/10-K HTM からマーケタブル証券ポートフォリオ情報を抽出するスクリプト
// 出力: investments.json
//
// Appleは大規模なマーケタブル証券ポートフォリオを保有。
// 10-Q/10-Kの "Marketable Securities" ノートから残高を抽出:
//   - 流動マーケタブル証券
//   - 非流動マーケタブル証券
//   - 合計
//
// データはバランスシート日付時点の残高（フロー項目ではない）。

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'investments.json');

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
 * マーケタブル証券テーブルを探す
 * "Marketable Securities" ヘッダーの近くにあるテーブルを返す
 */
function findMarketableSecuritiesTable($) {
  let table = null;

  // "Marketable Securities" ノートを探す
  $('div').each((i, el) => {
    if (table) return;
    const text = $(el).text().trim();
    if (/Note\s+\d+.*Marketable Securities/i.test(text) && text.length < 200) {
      // ノートヘッダーの後にあるテーブルを探す
      let sib = $(el);
      for (let j = 0; j < 10; j++) {
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

  // フォールバック: "following table" の近くで "marketable securities" を探す
  if (!table) {
    $('div').each((i, el) => {
      if (table) return;
      const text = $(el).text().trim();
      if (text.includes('marketable securities') && text.includes('following table') && text.length < 500) {
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
  }

  return table;
}

/**
 * マーケタブル証券テーブルからデータを抽出
 */
function extractMarketableSecurities($, table) {
  if (!table) return null;

  const result = {};
  let totalFound = false;

  table.find('tr').each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length < 2) return;
    const label = cells[0];
    const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
    if (nums.length === 0) return;

    // 合計行を探す
    if (/^Total marketable securities$/i.test(label) && !totalFound) {
      result.totalMarketableSecurities = nums[0];
      totalFound = true;
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const result = {};

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

      const table = findMarketableSecuritiesTable($);
      const data = extractMarketableSecurities($, table);

      if (data) {
        if (!result[fy]) result[fy] = {};
        result[fy][q] = data;
        const parts = Object.entries(data).map(([k, v]) => `${k}=$${v}M`);
        console.log(`  → ${parts.join(', ')}`);
      } else {
        console.warn(`  ⚠ マーケタブル証券データが見つかりません`);
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(result)) {
    for (const q of Object.keys(result[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分の投資データを抽出`);
}

main();
