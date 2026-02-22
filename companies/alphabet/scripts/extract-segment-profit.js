// Alphabet press-release.htm からセグメント別収益・営業利益データを抽出するスクリプト
// セグメント報告テーブル（Table 7相当）を解析
//
// ■ テーブル構造:
//   "Revenues:" セクション → Google Services / Google Cloud / Other Bets / Hedging gains / Total revenues
//   "Operating income (loss):" セクション → Google Services / Google Cloud / Other Bets / Corporate costs / Total
//
// ■ 期間別の変遷:
//   FY2020 Q1-Q3: "Google" (Services/Cloud未分割), "Other Bets", Corporate costs なし
//   FY2020 Q4:    "Google Services", "Google Cloud", "Other Bets", "Corporate costs, unallocated"
//   FY2021-FY2023 Q1: 同上
//   FY2023 Q2以降: "Alphabet-level activities" に名称変更
//
// ■ ヘッダー:
//   "Quarter Ended [Month] [Day]," + 年 → 2カラム（先年同期Q + 当年Q）
//
// 出力: segment-profit.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segment-profit.json');

// 四半期末月からQマッピング
const MONTH_TO_QUARTER = {
  'march': 'Q1',
  'june': 'Q2',
  'september': 'Q3',
  'december': 'Q4',
};

/**
 * テキストから数値をパース
 */
function parseNumber(text) {
  if (!text) return null;
  let cleaned = text.replace(/[\s\u00a0]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '—' || cleaned === '\u2014' || cleaned === '\u2013') return null;

  cleaned = cleaned.replace(/\$/g, '');

  let negative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }

  cleaned = cleaned.replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * 行のラベルテキストを取得
 */
function getRowLabel($, row) {
  const cells = $(row).find('td');
  let label = '';

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return;

    const style = ($cell.attr('style') || '').toLowerCase();
    const colspan = parseInt($cell.attr('colspan') || '1');
    const isLeftAligned = style.includes('text-align:left');

    if ((isLeftAligned || colspan >= 3) && !label) {
      if (!text.match(/^[\$\d,.\-()\s\u2014\u2013]+$/) && text !== '$' && !/^\(unaudited\)$/i.test(text)) {
        label = text;
      }
    }
  });

  return label;
}

/**
 * テーブル行から右寄せの数値セルを全て抽出
 */
function extractAllValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();
    const isRightAligned = style.includes('text-align:right');

    if (isRightAligned && text) {
      if (text === '$' || text === '') return;
      values.push(text);
    }
  });

  return values;
}

/**
 * セグメントテーブルを特定する
 * 条件: "Revenues:" セクションに "Google Services" or "Google" が含まれ、
 *       "Operating income (loss):" セクションが続くテーブル
 *
 * 注: セグメントテーブルは通常2回出現する（サマリー表と詳細表）
 *     最初のテーブル（"Quarter Ended" ヘッダー付き）を使用
 */
function findSegmentTable($) {
  let segTable = null;

  $('table').each((ti, table) => {
    if (segTable) return false;

    const $table = $(table);
    let hasRevenues = false;
    let hasSegment = false;
    let hasOperatingIncome = false;

    $table.find('tr').each((ri, row) => {
      const label = getRowLabel($, row);
      if (!label) return;

      if (/^Revenues:$/i.test(label)) hasRevenues = true;
      if (/^Google Services$/i.test(label) || /^Google$/i.test(label)) hasSegment = true;
      if (/^Operating income \(loss\):$/i.test(label)) hasOperatingIncome = true;
    });

    if (hasRevenues && hasSegment && hasOperatingIncome) {
      segTable = $table;
    }
  });

  return segTable;
}

/**
 * セグメントテーブルのヘッダーを解析して四半期と年を特定
 * 戻り値: { quarter, quarterYears: [先年, 当年] }
 */
function parseSegmentHeaders($, table) {
  let quarter = null;
  const years = [];

  table.find('tr').each((i, row) => {
    if (i > 8) return false;

    $(row).find('td').each((ci, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const style = ($(cell).attr('style') || '').toLowerCase();

      // "Quarter Ended [Month] [Day]," のパターン
      const quarterMatch = text.match(/Quarter\s+Ended\s*(?:\n\s*)?(\w+)\s+\d+/i);
      if (quarterMatch) {
        const month = quarterMatch[1].toLowerCase();
        if (MONTH_TO_QUARTER[month]) {
          quarter = MONTH_TO_QUARTER[month];
        }
      }

      // "March 31," のパターン（Quarter Endedなし）
      if (!quarter) {
        const monthMatch = text.match(/(March|June|September|December)\s+\d+/i);
        if (monthMatch) {
          const month = monthMatch[1].toLowerCase();
          if (MONTH_TO_QUARTER[month]) {
            quarter = MONTH_TO_QUARTER[month];
          }
        }
      }

      // "Q4 2020" のパターン（FY2020 Q4形式）
      if (!quarter) {
        const qnMatch = text.match(/^Q(\d)\s+(20\d{2})$/);
        if (qnMatch) {
          quarter = `Q${qnMatch[1]}`;
          const y = parseInt(qnMatch[2]);
          if (!years.includes(y)) years.push(y);
        }
      }

      // 年の検出（"2020" 形式、年のみのセル）
      const yearMatch = text.match(/^(20\d{2})$/);
      if (yearMatch && style.includes('text-align:center')) {
        const y = parseInt(yearMatch[1]);
        if (!years.includes(y)) years.push(y);
      }
    });
  });

  return {
    quarter,
    quarterYears: years.slice(0, 2),
  };
}

/**
 * セグメントテーブルからデータを抽出
 * "Revenues:" と "Operating income (loss):" の2セクションを解析
 *
 * 戻り値: { priorYear: {...}, currentYear: {...} }
 */
function extractSegmentData($, table, headers) {
  let inRevenueSection = false;
  let inIncomeSection = false;

  // 先年・当年のデータ
  const priorData = {};
  const currentData = {};

  // セグメント行のラベルパターン → キー名マッピング
  // Revenues セクション用
  const revenuePatterns = [
    { patterns: [/^Google Services$/i], key: 'googleServicesRevenue' },
    { patterns: [/^Google Cloud$/i], key: 'googleCloudRevenue' },
    { patterns: [/^Other Bets$/i], key: 'otherBetsRevenue' },
  ];

  // 旧形式（FY2020 Q1-Q3）: "Google" のみ（Services/Cloud未分割）
  const revenuePatternOld = { patterns: [/^Google$/i, /^Google \(1\)$/i], key: 'googleServicesRevenue' };

  // Operating income セクション用
  const incomePatterns = [
    { patterns: [/^Google Services$/i], key: 'googleServicesOperatingIncome' },
    { patterns: [/^Google Cloud$/i], key: 'googleCloudOperatingIncome' },
    { patterns: [/^Other Bets$/i], key: 'otherBetsOperatingIncome' },
    { patterns: [/^Corporate costs,?\s*unallocated$/i, /^Alphabet-level activities$/i], key: 'alphabetLevelActivities' },
    { patterns: [/^Total income from operations$/i], key: 'totalOperatingIncome' },
  ];

  // 旧形式用の追加パターン
  const incomePatternOld = { patterns: [/^Google$/i, /^Google \(1\)$/i], key: 'googleServicesOperatingIncome' };

  // テーブルが旧形式かどうか判定（"Google Services" が存在しない場合）
  let isOldFormat = true;
  table.find('tr').each((ri, row) => {
    const label = getRowLabel($, row);
    if (/^Google Services$/i.test(label)) {
      isOldFormat = false;
      return false;
    }
  });

  table.find('tr').each((ri, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // セクションヘッダーの検出
    if (/^Revenues:$/i.test(label)) {
      inRevenueSection = true;
      inIncomeSection = false;
      return;
    }
    if (/^Operating income \(loss\):$/i.test(label)) {
      inIncomeSection = true;
      inRevenueSection = false;
      return;
    }

    // セクション終了: "Total" 行
    if (/^Total revenues$/i.test(label)) {
      inRevenueSection = false;
      return;
    }

    const allValues = extractAllValues($, row);
    if (allValues.length === 0) return;

    // 最初の2値が先年Q・当年Q
    const priorVal = allValues.length > 0 ? parseNumber(allValues[0]) : null;
    const currentVal = allValues.length > 1 ? parseNumber(allValues[1]) : null;

    if (inRevenueSection) {
      // Revenues セクション
      const patterns = isOldFormat ? [revenuePatternOld, ...revenuePatterns] : revenuePatterns;
      for (const mapping of patterns) {
        if (mapping.patterns.some(p => p.test(label))) {
          if (!(mapping.key in priorData) && priorVal !== null) priorData[mapping.key] = priorVal;
          if (!(mapping.key in currentData) && currentVal !== null) currentData[mapping.key] = currentVal;
          break;
        }
      }
    }

    if (inIncomeSection) {
      // Operating income セクション
      const patterns = isOldFormat ? [incomePatternOld, ...incomePatterns] : incomePatterns;
      for (const mapping of patterns) {
        if (mapping.patterns.some(p => p.test(label))) {
          if (!(mapping.key in priorData) && priorVal !== null) priorData[mapping.key] = priorVal;
          if (!(mapping.key in currentData) && currentVal !== null) currentData[mapping.key] = currentVal;
          break;
        }
      }
    }
  });

  return { priorData, currentData };
}

/**
 * 1つのプレスリリースからセグメントデータを抽出
 * 戻り値: [{ year, quarter, data: {...} }, ...]
 */
function extractFromFile(filePath, fileFy, fileQ) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);

  // セグメントテーブルを特定
  const segTable = findSegmentTable($);
  if (!segTable) {
    console.warn(`  警告: ${fileFy}/${fileQ} - セグメントテーブルが見つかりません`);
    return [];
  }

  // ヘッダー解析
  const headers = parseSegmentHeaders($, segTable);
  if (!headers.quarter || headers.quarterYears.length < 2) {
    console.warn(`  警告: ${fileFy}/${fileQ} - ヘッダー解析失敗（quarter=${headers.quarter}, years=${headers.quarterYears}）`);
    return [];
  }

  const priorYear = headers.quarterYears[0];
  const currentYear = headers.quarterYears[1];

  // データ抽出
  const { priorData, currentData } = extractSegmentData($, segTable, headers);

  const results = [];

  if (Object.keys(priorData).length > 0) {
    results.push({ year: priorYear, quarter: headers.quarter, data: priorData });
  }
  if (Object.keys(currentData).length > 0) {
    results.push({ year: currentYear, quarter: headers.quarter, data: currentData });
  }

  return results;
}

// メイン処理
function main() {
  const segments = {};

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const prPath = path.join(fyPath, q, 'press-release.htm');
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.htm が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const results = extractFromFile(prPath, fy, q);

      for (const { year, quarter, data } of results) {
        // FY2020未満はスキップ
        if (year < 2020) {
          console.log(`  → FY${year}/${quarter} はスキップ（2020年未満）`);
          continue;
        }

        const fyKey = `FY${year}`;
        if (!segments[fyKey]) segments[fyKey] = {};

        // 新しいデータで上書き
        const isNew = !(quarter in segments[fyKey]);
        segments[fyKey][quarter] = data;
        const keys = Object.keys(data);
        console.log(`  → ${fyKey}/${quarter}: ${keys.length} 項目${isNew ? '（新規）' : '（更新）'}`);

        // 主要値の表示
        const parts = [];
        if (data.googleServicesRevenue != null) parts.push(`GS Rev=${data.googleServicesRevenue}`);
        if (data.googleCloudRevenue != null) parts.push(`GC Rev=${data.googleCloudRevenue}`);
        if (data.totalOperatingIncome != null) parts.push(`Total OI=${data.totalOperatingIncome}`);
        if (parts.length > 0) console.log(`    ${parts.join(', ')}`);
      }
    }
  }

  // FY/Qをソートして出力
  const sorted = {};
  for (const fy of Object.keys(segments).sort()) {
    sorted[fy] = {};
    for (const q of Object.keys(segments[fy]).sort()) {
      sorted[fy][q] = segments[fy][q];
    }
  }

  // 出力先ディレクトリが存在しない場合は作成
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(sorted)) {
    for (const q of Object.keys(sorted[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のセグメント損益データを抽出`);

  // データ検証
  console.log('\n--- データ検証 ---');
  for (const fy of Object.keys(sorted).sort()) {
    for (const q of Object.keys(sorted[fy]).sort()) {
      const d = sorted[fy][q];
      const missing = [];

      // 基本フィールド（旧形式の場合Google Cloudは存在しない場合あり）
      const expectedKeys = ['googleServicesRevenue', 'googleServicesOperatingIncome', 'otherBetsRevenue', 'otherBetsOperatingIncome'];
      for (const key of expectedKeys) {
        if (d[key] == null) missing.push(key);
      }

      // FY2020 Q4以降はGoogle Cloud必須
      const fyNum = parseInt(fy.replace('FY', ''));
      const qNum = parseInt(q.replace('Q', ''));
      if (fyNum > 2020 || (fyNum === 2020 && qNum === 4)) {
        if (d.googleCloudRevenue == null) missing.push('googleCloudRevenue');
        if (d.googleCloudOperatingIncome == null) missing.push('googleCloudOperatingIncome');
      }

      if (missing.length > 0) {
        console.warn(`  ${fy}/${q}: 欠落フィールド: ${missing.join(', ')}`);
      } else {
        console.log(`  ${fy}/${q}: OK (GS Rev=${d.googleServicesRevenue}, GC Rev=${d.googleCloudRevenue || 'N/A'})`);
      }
    }
  }
}

main();
