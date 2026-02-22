// 10-Q/10-K HTM からセグメント別損益データを抽出するスクリプト
// 出力: segment-profit.json
//
// Metaの報告セグメント:
//   - Family of Apps (FoA): 収益と営業利益
//   - Reality Labs (RL): 収益と営業利益（損失）
//
// テーブル形式:
//   旧形式 (FY2021 Q4 ～ FY2024 Q3):
//     "Revenue:" セクションに FoA/RL、"Income (loss) from operations:" セクションに FoA/RL
//   新形式 (FY2024 Q4 ～):
//     セグメントごとにグループ化（"Family of Apps:" → Revenue/Expenses/Income、
//     "Reality Labs:" → Revenue/Expenses/Loss）
//
// セグメント報告は FY2021 Q4（10-K）から開始。
// 10-K は年間合計を含む → Q4 = 年間 - (Q1 + Q2 + Q3) で算出。
// FY2021 Q4 の 10-K には FY2020, FY2019 の遡及修正データも含まれる。

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segment-profit.json');

/**
 * テキストから数値をパース
 * "(1,234)" → -1234, "57,006" → 57006, "—" → null
 */
function parseNumber(text) {
  if (!text) return null;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned === '—' || cleaned === '-' || cleaned === '\u2014' || cleaned === '\u2013') return null;
  if (!cleaned) return null;

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
 * セグメントテーブルを探す
 * "segment information" を含むdivの次の兄弟要素のテーブルを返す
 */
function findSegmentTable($) {
  let table = null;

  $('div').each((i, el) => {
    if (table) return;
    const text = $(el).text().trim();
    if (text.includes('segment information') && text.includes('revenue') && text.length < 400) {
      // 次の数個の兄弟要素からテーブルを探す
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

  return table;
}

/**
 * 旧形式のテーブルからデータを抽出
 * "Revenue:" と "Income (loss) from operations:" セクションに分かれている
 *
 * @param {object} $ - cheerioオブジェクト
 * @param {object} table - cheerioテーブル要素
 * @param {boolean} isQ4 - Q4（10-K）の場合true
 * @returns {object|null}
 */
function extractOldFormat($, table, isQ4) {
  const rows = table.find('tr');
  let inRevenueSection = false;
  let inIncomeSection = false;
  let foaRevenue = null;
  let rlRevenue = null;
  let foaIncome = null;
  let rlIncome = null;

  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;

    const firstCell = cells[0];

    // セクションヘッダーの検出
    if (/^Revenue:$/i.test(firstCell)) {
      inRevenueSection = true;
      inIncomeSection = false;
      return;
    }
    if (/^Income \(loss\) from operations:$/i.test(firstCell)) {
      inIncomeSection = true;
      inRevenueSection = false;
      return;
    }
    if (/^Total/i.test(firstCell)) {
      inRevenueSection = false;
      inIncomeSection = false;
      return;
    }

    // "Family of Apps" 行
    if (/Family of Apps/i.test(firstCell)) {
      // 最初の数値が当期データ（Three Months Ended / Year Ended の最新年）
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) {
        if (inRevenueSection && foaRevenue === null) foaRevenue = nums[0];
        if (inIncomeSection && foaIncome === null) foaIncome = nums[0];
      }
    }

    // "Reality Labs" 行
    if (/Reality Labs/i.test(firstCell)) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) {
        if (inRevenueSection && rlRevenue === null) rlRevenue = nums[0];
        if (inIncomeSection && rlIncome === null) rlIncome = nums[0];
      }
    }
  });

  if (foaRevenue === null || rlRevenue === null || foaIncome === null || rlIncome === null) {
    return null;
  }

  return {
    familyOfApps: { revenue: foaRevenue, operatingIncome: foaIncome },
    realityLabs: { revenue: rlRevenue, operatingIncome: rlIncome },
  };
}

/**
 * 新形式のテーブルからデータを抽出
 * セグメントごとにグループ化されている（"Family of Apps:" → Revenue/Income、
 * "Reality Labs:" → Revenue/Loss）
 *
 * @param {object} $ - cheerioオブジェクト
 * @param {object} table - cheerioテーブル要素
 * @param {boolean} isQ4 - Q4（10-K）の場合true
 * @returns {object|null}
 */
function extractNewFormat($, table, isQ4) {
  const rows = table.find('tr');
  let currentSegment = null;
  let foaRevenue = null;
  let rlRevenue = null;
  let foaIncome = null;
  let rlIncome = null;

  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;

    const firstCell = cells[0];

    // セグメントヘッダーの検出
    if (/^Family of Apps:$/i.test(firstCell)) {
      currentSegment = 'foa';
      return;
    }
    if (/^Reality Labs:$/i.test(firstCell)) {
      currentSegment = 'rl';
      return;
    }
    if (/^Total:$/i.test(firstCell)) {
      currentSegment = null;
      return;
    }

    // Revenue行（最初の数値が当期データ）
    if (/^Revenue$/i.test(firstCell) && currentSegment) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) {
        if (currentSegment === 'foa' && foaRevenue === null) foaRevenue = nums[0];
        if (currentSegment === 'rl' && rlRevenue === null) rlRevenue = nums[0];
      }
    }

    // Income/Loss from operations行
    if (/^(Income from operations|Loss from operations)$/i.test(firstCell) && currentSegment) {
      const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
      if (nums.length >= 1) {
        if (currentSegment === 'foa' && foaIncome === null) foaIncome = nums[0];
        if (currentSegment === 'rl' && rlIncome === null) rlIncome = nums[0];
      }
    }
  });

  if (foaRevenue === null || rlRevenue === null || foaIncome === null || rlIncome === null) {
    return null;
  }

  return {
    familyOfApps: { revenue: foaRevenue, operatingIncome: foaIncome },
    realityLabs: { revenue: rlRevenue, operatingIncome: rlIncome },
  };
}

/**
 * テーブル形式を判定して適切な抽出関数を呼び出す
 * "Revenue:" が見つかれば旧形式、"Family of Apps:" が見つかれば新形式
 */
function extractSegmentData($, table, isQ4) {
  let hasOldFormat = false;
  let hasNewFormat = false;

  table.find('tr').each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;
    const firstCell = cells[0];
    if (/^Revenue:$/i.test(firstCell)) hasOldFormat = true;
    if (/^Family of Apps:$/i.test(firstCell)) hasNewFormat = true;
  });

  if (hasNewFormat) {
    return extractNewFormat($, table, isQ4);
  }
  if (hasOldFormat) {
    return extractOldFormat($, table, isQ4);
  }
  return null;
}

/**
 * FY2021 Q4 の10-Kから遡及修正データ（FY2020, FY2019）を抽出
 * 旧形式テーブルの2番目・3番目のカラムを取得
 */
function extractRecastData($, table) {
  const recastData = {};
  const rows = table.find('tr');

  // ヘッダー行から年を取得
  let years = [];
  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length >= 2 && /^\d{4}$/.test(cells[0])) {
      years = cells.map(c => parseInt(c, 10));
    }
  });

  if (years.length < 2) return recastData;

  // 2番目以降の年のデータを取得（1番目は当年度で別途処理済み）
  for (let yearIdx = 1; yearIdx < years.length; yearIdx++) {
    const year = years[yearIdx];
    const fy = `FY${year}`;

    let inRevenueSection = false;
    let inIncomeSection = false;
    let foaRevenue = null;
    let rlRevenue = null;
    let foaIncome = null;
    let rlIncome = null;

    rows.each((i, tr) => {
      const cells = getRowCells($, tr);
      if (cells.length === 0) return;
      const firstCell = cells[0];

      if (/^Revenue:$/i.test(firstCell)) { inRevenueSection = true; inIncomeSection = false; return; }
      if (/^Income \(loss\) from operations:$/i.test(firstCell)) { inIncomeSection = true; inRevenueSection = false; return; }
      if (/^Total/i.test(firstCell)) { inRevenueSection = false; inIncomeSection = false; return; }

      if (/Family of Apps/i.test(firstCell)) {
        const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
        if (nums.length > yearIdx) {
          if (inRevenueSection && foaRevenue === null) foaRevenue = nums[yearIdx];
          if (inIncomeSection && foaIncome === null) foaIncome = nums[yearIdx];
        }
      }

      if (/Reality Labs/i.test(firstCell)) {
        const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
        if (nums.length > yearIdx) {
          if (inRevenueSection && rlRevenue === null) rlRevenue = nums[yearIdx];
          if (inIncomeSection && rlIncome === null) rlIncome = nums[yearIdx];
        }
      }
    });

    if (foaRevenue !== null && rlRevenue !== null && foaIncome !== null && rlIncome !== null) {
      recastData[fy] = {
        familyOfApps: { revenue: foaRevenue, operatingIncome: foaIncome },
        realityLabs: { revenue: rlRevenue, operatingIncome: rlIncome },
      };
    }
  }

  return recastData;
}

// メイン処理
function main() {
  const result = {};
  const annualData = {}; // 10-K年間データ（Q4算出用）

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
      const table = findSegmentTable($);

      if (!table) {
        console.warn(`  スキップ: セグメントテーブルが見つかりません`);
        continue;
      }

      if (isQ4) {
        // 10-K: 年間データを抽出
        const annual = extractSegmentData($, table, isQ4);
        if (annual) {
          annualData[fy] = annual;
          console.log(`  → 年間: FoA Rev=$${annual.familyOfApps.revenue}M OI=$${annual.familyOfApps.operatingIncome}M, RL Rev=$${annual.realityLabs.revenue}M OI=$${annual.realityLabs.operatingIncome}M`);

          // FY2021 Q4 の場合、遡及修正データも抽出
          if (fy === 'FY2021') {
            const recast = extractRecastData($, table);
            for (const recastFy of Object.keys(recast)) {
              annualData[recastFy] = recast[recastFy];
              console.log(`  → 遡及修正 ${recastFy}: FoA Rev=$${recast[recastFy].familyOfApps.revenue}M OI=$${recast[recastFy].familyOfApps.operatingIncome}M, RL Rev=$${recast[recastFy].realityLabs.revenue}M OI=$${recast[recastFy].realityLabs.operatingIncome}M`);
            }
          }
        } else {
          console.warn(`  ⚠ 年間セグメントデータが見つかりません`);
        }
      } else {
        // 10-Q: 当四半期データを抽出（Three Months Ended の最初のカラム）
        const quarterly = extractSegmentData($, table, isQ4);
        if (quarterly) {
          if (!result[fy]) result[fy] = {};
          result[fy][q] = quarterly;
          console.log(`  → FoA Rev=$${quarterly.familyOfApps.revenue}M OI=$${quarterly.familyOfApps.operatingIncome}M, RL Rev=$${quarterly.realityLabs.revenue}M OI=$${quarterly.realityLabs.operatingIncome}M`);
        } else {
          console.warn(`  ⚠ 四半期セグメントデータが見つかりません`);
        }
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
      const q4 = {
        familyOfApps: {
          revenue: annual.familyOfApps.revenue - (q1.familyOfApps.revenue + q2.familyOfApps.revenue + q3.familyOfApps.revenue),
          operatingIncome: annual.familyOfApps.operatingIncome - (q1.familyOfApps.operatingIncome + q2.familyOfApps.operatingIncome + q3.familyOfApps.operatingIncome),
        },
        realityLabs: {
          revenue: annual.realityLabs.revenue - (q1.realityLabs.revenue + q2.realityLabs.revenue + q3.realityLabs.revenue),
          operatingIncome: annual.realityLabs.operatingIncome - (q1.realityLabs.operatingIncome + q2.realityLabs.operatingIncome + q3.realityLabs.operatingIncome),
        },
      };
      if (!result[fy]) result[fy] = {};
      result[fy].Q4 = q4;
      console.log(`  ${fy} Q4: FoA Rev=$${q4.familyOfApps.revenue}M OI=$${q4.familyOfApps.operatingIncome}M, RL Rev=$${q4.realityLabs.revenue}M OI=$${q4.realityLabs.operatingIncome}M`);
    } else {
      // Q1-Q3データが不足 → 遡及修正の年間データを四半期に按分できないため、
      // 年間合計のみQ4として格納（FY2019, FY2020用）
      if (!result[fy]) result[fy] = {};

      // この年にQ1-Q3データが1つもなければ、年間合計として注記
      const hasAnyQuarter = result[fy]?.Q1 || result[fy]?.Q2 || result[fy]?.Q3;
      if (!hasAnyQuarter) {
        // 年間データしかない場合はスキップ（四半期分割不可）
        // 空のFYエントリを削除
        if (result[fy] && Object.keys(result[fy]).length === 0) {
          delete result[fy];
        }
        console.warn(`  ⚠ ${fy} Q4を算出できません（Q1〜Q3データ不足、年間データのみ）`);
      } else {
        console.warn(`  ⚠ ${fy} Q4を算出できません（Q1〜Q3データ不足）`);
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
  console.log(`合計: ${total} 四半期分のセグメント損益データを抽出`);
}

main();
