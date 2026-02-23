// 10-Q/10-K HTM からセグメント別損益データを抽出するスクリプト
// 出力: segment-profit.json
//
// Appleの報告セグメント（地域別）:
//   - Americas
//   - Europe
//   - Greater China
//   - Japan
//   - Rest of Asia Pacific
//
// 10-Qの "Segment Information" ノートから各地域のnet salesを抽出。
// 10-Kは年間合計を含む → Q4 = 年間 - (Q1 + Q2 + Q3) で算出。
// Appleは地域別operating incomeを開示していないため、net salesのみ抽出。

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segment-profit.json');

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
 * セグメントテーブルを探す
 * "segment information" を含むdivの次のテーブルを返す
 */
function findSegmentTable($) {
  let table = null;

  $('div').each((i, el) => {
    if (table) return;
    const text = $(el).text().trim();
    // "net sales by reportable segment" を含むdivを探す
    if (text.includes('net sales by reportable segment') && text.length < 500) {
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

  // フォールバック: "Americas" と "Greater China" を含むテーブルを探す
  if (!table) {
    $('table').each((i, el) => {
      if (table) return;
      const text = $(el).text();
      if (text.includes('Americas') && text.includes('Greater China') && text.includes('Total net sales')) {
        table = $(el);
      }
    });
  }

  return table;
}

/**
 * セグメントテーブルからデータを抽出
 */
function extractSegmentData($, table) {
  const result = {};
  const rows = table.find('tr');

  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length < 2) return;

    const label = cells[0];
    const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
    if (nums.length === 0) return;

    // 最初の数値が当期データ
    const value = nums[0];

    if (/^Americas$/i.test(label)) result.americas = value;
    else if (/^Europe$/i.test(label)) result.europe = value;
    else if (/^Greater China$/i.test(label)) result.greaterChina = value;
    else if (/^Japan$/i.test(label)) result.japan = value;
    else if (/^Rest of Asia Pacific$/i.test(label)) result.restOfAsiaPacific = value;
    else if (/^Total net sales$/i.test(label)) result.totalNetSales = value;
  });

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const result = {};
  const annualData = {};

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
      const table = findSegmentTable($);

      if (!table) {
        console.warn(`  スキップ: セグメントテーブルが見つかりません`);
        continue;
      }

      const data = extractSegmentData($, table);
      if (!data) {
        console.warn(`  ⚠ セグメントデータが見つかりません`);
        continue;
      }

      if (isQ4) {
        // 10-K: 年間データ
        annualData[fy] = data;
        console.log(`  → 年間: Americas=$${data.americas}M, Europe=$${data.europe}M, China=$${data.greaterChina}M`);
      } else {
        if (!result[fy]) result[fy] = {};
        result[fy][q] = data;
        console.log(`  → Americas=$${data.americas}M, Europe=$${data.europe}M, China=$${data.greaterChina}M`);
      }
    }
  }

  // Q4データの算出: Q4 = Annual - (Q1 + Q2 + Q3)
  console.log('\nQ4データの算出:');
  for (const fy of Object.keys(annualData).sort()) {
    const annual = annualData[fy];
    const q1 = result[fy]?.Q1;
    const q2 = result[fy]?.Q2;
    const q3 = result[fy]?.Q3;

    if (q1 && q2 && q3) {
      const q4 = {};
      const segments = ['americas', 'europe', 'greaterChina', 'japan', 'restOfAsiaPacific', 'totalNetSales'];
      for (const seg of segments) {
        if (annual[seg] != null && q1[seg] != null && q2[seg] != null && q3[seg] != null) {
          q4[seg] = annual[seg] - (q1[seg] + q2[seg] + q3[seg]);
        }
      }
      if (!result[fy]) result[fy] = {};
      result[fy].Q4 = q4;
      console.log(`  ${fy} Q4: Americas=$${q4.americas}M, Europe=$${q4.europe}M, China=$${q4.greaterChina}M`);
    } else {
      console.warn(`  ⚠ ${fy} Q4を算出できません（Q1〜Q3データ不足）`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(result)) {
    for (const q of Object.keys(result[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のセグメント損益データを抽出`);
}

main();
