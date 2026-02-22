// Palantir 10-Q/10-K HTM からセグメント別損益（Contribution）を抽出
// セグメント: Government / Commercial
// Contribution = Revenue - Cost of revenue - Sales and marketing（セグメント配分後）
// 出力: segment-profit.json

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
 * Contribution テーブルを探す
 * "Contribution:" ヘッダーを含むテーブル（Government/Commercial contribution）
 */
function findContributionTable($) {
  let table = null;

  $('table').each((i, t) => {
    if (table) return;
    const text = $(t).text();
    if (text.match(/Contribution/i) && text.match(/Government/i) && text.match(/Commercial/i)) {
      table = $(t);
    }
  });

  return table;
}

/**
 * Contribution テーブルからデータを抽出
 */
function extractContribution($, table) {
  let govRevenue = null;
  let comRevenue = null;
  let govContribution = null;
  let comContribution = null;
  let totalContribution = null;

  table.find('tr').each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length < 2) return;
    const label = cells[0];

    // Government revenue
    if (/^Government revenue$/i.test(label) && govRevenue === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) govRevenue = nums[0];
    }

    // Commercial revenue
    if (/^Commercial revenue$/i.test(label) && comRevenue === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) comRevenue = nums[0];
    }

    // Government contribution
    if (/^Government contribution$/i.test(label) && govContribution === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) govContribution = nums[0];
    }

    // Commercial contribution
    if (/^Commercial contribution$/i.test(label) && comContribution === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) comContribution = nums[0];
    }

    // Total contribution
    if (/^Total contribution$/i.test(label) && totalContribution === null) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) totalContribution = nums[0];
    }
  });

  if (govContribution === null || comContribution === null) return null;

  return {
    government: { revenue: govRevenue, contribution: govContribution },
    commercial: { revenue: comRevenue, contribution: comContribution },
    totalContribution: totalContribution,
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
      const table = findContributionTable($);

      if (!table) {
        console.warn(`  ⚠ Contributionテーブルが見つかりません`);
        continue;
      }

      if (isQ4) {
        const annual = extractContribution($, table);
        if (annual) {
          annualData[fy] = annual;
          console.log(`  → 年間: Gov Contrib=${annual.government.contribution}, Com Contrib=${annual.commercial.contribution}`);
        }
      } else {
        const quarterly = extractContribution($, table);
        if (quarterly) {
          if (!result[fy]) result[fy] = {};
          result[fy][q] = quarterly;
          console.log(`  → Gov Contrib=${quarterly.government.contribution}, Com Contrib=${quarterly.commercial.contribution}`);
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
        government: {
          revenue: annual.government.revenue ? annual.government.revenue - (q1.government.revenue + q2.government.revenue + q3.government.revenue) : null,
          contribution: annual.government.contribution - (q1.government.contribution + q2.government.contribution + q3.government.contribution),
        },
        commercial: {
          revenue: annual.commercial.revenue ? annual.commercial.revenue - (q1.commercial.revenue + q2.commercial.revenue + q3.commercial.revenue) : null,
          contribution: annual.commercial.contribution - (q1.commercial.contribution + q2.commercial.contribution + q3.commercial.contribution),
        },
        totalContribution: annual.totalContribution ? annual.totalContribution - ((q1.totalContribution || 0) + (q2.totalContribution || 0) + (q3.totalContribution || 0)) : null,
      };
      if (!result[fy]) result[fy] = {};
      result[fy].Q4 = q4;
      console.log(`  ${fy} Q4: Gov Contrib=${q4.government.contribution}, Com Contrib=${q4.commercial.contribution}`);
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
