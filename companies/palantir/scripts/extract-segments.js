// Palantir 10-Q/10-K HTM からセグメント別売上データを抽出するスクリプト
// Palantirのプレスリリースにはセグメントテーブルがないため、10-Q/10-Kから取得
// セグメント: Government / Commercial
// 出力: segments.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segments.json');

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
 * "revenue by customer segment" を含むテキストの近くにあるテーブル
 */
function findSegmentRevenueTable($) {
  let table = null;

  // 方法1: テーブル内でGovernment/Commercial/Total revenueが全て含まれるテーブルを探す
  $('table').each((i, t) => {
    if (table) return;
    const text = $(t).text();
    if (text.match(/Government/i) && text.match(/Commercial/i) && text.match(/Total revenue/i)) {
      // Revenue行のみ含むコンパクトなテーブルを優先
      const rows = $(t).find('tr');
      if (rows.length < 15) {
        table = $(t);
      }
    }
  });

  // 方法2: より大きなテーブルも許容
  if (!table) {
    $('table').each((i, t) => {
      if (table) return;
      const text = $(t).text();
      if (text.match(/Government.*revenue/i) && text.match(/Commercial.*revenue/i)) {
        table = $(t);
      }
    });
  }

  return table;
}

/**
 * セグメント別売上テーブルからデータを抽出
 * Government revenue, Commercial revenue, Total revenue
 */
function extractSegmentRevenue($, table, isQ4) {
  let govRevenue = null;
  let comRevenue = null;
  let totalRevenue = null;

  table.find('tr').each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length < 2) return;
    const label = cells[0];

    // Government revenue
    if (/^Government\s*(revenue)?$/i.test(label) && govRevenue === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) govRevenue = nums[0];
    }

    // Commercial revenue
    if (/^Commercial\s*(revenue)?$/i.test(label) && comRevenue === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) comRevenue = nums[0];
    }

    // Total revenue
    if (/^Total revenue$/i.test(label) && totalRevenue === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) totalRevenue = nums[0];
    }
  });

  if (govRevenue === null || comRevenue === null) return null;

  return {
    governmentRevenue: govRevenue,
    commercialRevenue: comRevenue,
    totalRevenue: totalRevenue,
  };
}

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
      const table = findSegmentRevenueTable($);

      if (!table) {
        console.warn(`  ⚠ セグメントテーブルが見つかりません`);
        continue;
      }

      if (isQ4) {
        // 10-K: 年間データを抽出 → Q4 = Annual - (Q1+Q2+Q3) で算出
        const annual = extractSegmentRevenue($, table, true);
        if (annual) {
          annualData[fy] = annual;
          console.log(`  → 年間: Gov=${annual.governmentRevenue}, Com=${annual.commercialRevenue}`);
        }
      } else {
        // 10-Q: 四半期データ（Three Months Ended の最初のカラム）
        const quarterly = extractSegmentRevenue($, table, false);
        if (quarterly) {
          if (!result[fy]) result[fy] = {};
          result[fy][q] = quarterly;
          console.log(`  → Gov=${quarterly.governmentRevenue}, Com=${quarterly.commercialRevenue}`);
        }
      }
    }
  }

  // Q4 = Annual - (Q1+Q2+Q3) で算出
  console.log('\nQ4データの算出:');
  for (const fy of Object.keys(annualData).sort()) {
    const annual = annualData[fy];
    const q1 = result[fy]?.Q1;
    const q2 = result[fy]?.Q2;
    const q3 = result[fy]?.Q3;

    if (q1 && q2 && q3) {
      const q4 = {
        governmentRevenue: annual.governmentRevenue - (q1.governmentRevenue + q2.governmentRevenue + q3.governmentRevenue),
        commercialRevenue: annual.commercialRevenue - (q1.commercialRevenue + q2.commercialRevenue + q3.commercialRevenue),
        totalRevenue: annual.totalRevenue ? annual.totalRevenue - ((q1.totalRevenue || 0) + (q2.totalRevenue || 0) + (q3.totalRevenue || 0)) : null,
      };
      if (!result[fy]) result[fy] = {};
      result[fy].Q4 = q4;
      console.log(`  ${fy} Q4: Gov=${q4.governmentRevenue}, Com=${q4.commercialRevenue}`);
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
  console.log(`合計: ${total} 四半期分のセグメントデータを抽出`);
}

main();
