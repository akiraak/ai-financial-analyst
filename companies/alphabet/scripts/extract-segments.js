// Alphabet press-release.htm からセグメント別売上データを抽出するスクリプト
// テーブル識別: "Google Search & other" 行と "Total revenues" 行を含むテーブル
// 各テーブルは2つの四半期列（前年同期 + 当期）を持つ
// 出力: segments.json
//
// ラベル変遷:
//   - "Google other" (初期) → "Google subscriptions, platforms, and devices" (FY2023 Q4〜)
//     → いずれも googleSubscriptions にマッピング
//   - "Google Network Members' properties" (初期) → "Google Network" (FY2020 Q4〜)
//     → いずれも googleNetwork にマッピング
//   - "Google revenues" (初期) → "Google Services total" (FY2020 Q4〜)
//     → いずれも googleServicesTotal にマッピング
//   - "Other Bets revenues" (初期) → "Other Bets" (FY2020 Q4〜)
//     → いずれも otherBets にマッピング

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segments.json');

// 抽出対象の行ラベルとマッピング
// patterns: 行ラベルにマッチする正規表現（脚注番号除去後のテキストに適用）
const ROW_MAPPINGS = [
  { key: 'googleSearch',         patterns: [/^Google Search & other$/i] },
  { key: 'youtubeAds',           patterns: [/^YouTube ads$/i] },
  { key: 'googleNetwork',        patterns: [/^Google Network$/i, /^Google Network Members' properties$/i] },
  { key: 'googleAdvertising',    patterns: [/^Google advertising$/i] },
  { key: 'googleSubscriptions',  patterns: [/^Google subscriptions, platforms, and devices$/i, /^Google other$/i] },
  { key: 'googleServicesTotal',  patterns: [/^Google Services total$/i, /^Google revenues$/i] },
  { key: 'googleCloud',          patterns: [/^Google Cloud$/i] },
  { key: 'otherBets',            patterns: [/^Other Bets$/i, /^Other Bets revenues$/i] },
];

// 月名 → 四半期マッピング（Alphabetの会計年度はカレンダー年と一致）
const MONTH_TO_QUARTER = {
  'march': 'Q1',
  'june': 'Q2',
  'september': 'Q3',
  'december': 'Q4',
};

/**
 * テキストから数値をパース
 * "$54,034" → 54034, "(68)" → -68, "—" → null, "-" → null
 */
function parseNumber(text) {
  if (!text) return null;

  let cleaned = text.replace(/[$\s\u00a0]/g, '');

  // ダッシュ系文字はnull
  if (cleaned === '' || cleaned === '-' || cleaned === '—' ||
      cleaned.includes('\u2014') || cleaned.includes('\u2013') || cleaned.includes('\u0097')) {
    return null;
  }

  // 括弧は負の数
  let negative = false;
  if (cleaned.startsWith('(') || cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  }

  cleaned = cleaned.replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * 行のラベルテキストを取得
 * 脚注マーカー (1) 等を除去して返す
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

    if (!text || text === ' ') return;

    const style = ($cell.attr('style') || '').toLowerCase();
    const colspan = parseInt($cell.attr('colspan') || '1');
    const isLeftAligned = style.includes('text-align:left') || style.includes('text-align: left');

    // ラベルセル: 左寄せ or colspan >= 2 で、数値のみでないもの
    if ((isLeftAligned || colspan >= 2) && !label) {
      if (!text.match(/^[\$\d,.\-()\s\u2014\u2013]+$/)) {
        label = text;
      }
    }
  });

  // フォールバック: 最初の非数値テキストセル
  if (!label) {
    cells.each((i, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.\-()\s\u2014\u2013]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
  }

  // 脚注マーカーを除去: "YouTube ads(1)" → "YouTube ads"
  label = label.replace(/\(\d+\)\s*$/, '').trim();

  return label;
}

/**
 * テーブル行から数値列を抽出
 * $ が別セルにある場合と、$X,XXX が1セルにある場合の両方に対応
 * 戻り値: [col0Value, col1Value] （前年同期, 当期）
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const numericValues = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const rawText = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();

    // display:none のセルはスキップ
    if (style.includes('display:none')) return;

    // $ 単独セルはスキップ（次のセルに数値がある）
    if (rawText === '$') return;

    // 空セルやパディングセルはスキップ
    if (!rawText) return;

    // 右寄せの数値セル、または$付き数値をチェック
    const isRightAligned = style.includes('text-align:right') || style.includes('text-align: right');
    const hasNumber = /[\d]/.test(rawText);
    const isNumericLike = /^[\$\d,.\-()\u2014\u2013]+$/.test(rawText);

    if ((isRightAligned || isNumericLike) && hasNumber) {
      const num = parseNumber(rawText);
      if (num !== null) {
        numericValues.push(num);
      }
    }
  });

  return numericValues;
}

/**
 * "Google Search & other" と "Total revenues" を含むテーブルを検出
 * cheerioで全テーブルを走査し、条件に合うテーブルのHTMLを返す
 */
function findSegmentTable(html) {
  const $ = cheerio.load(html);
  let targetTable = null;

  $('table').each((i, table) => {
    const text = $(table).text();
    if (text.includes('Google Search') && text.includes('Total revenues')) {
      targetTable = $.html(table);
      return false; // 最初にマッチしたテーブルを使用
    }
  });

  return targetTable;
}

/**
 * テーブルヘッダーから四半期情報を解析
 * "Quarter Ended [Month] [Day]," + 年行 → [{fy, q}, {fy, q}]
 */
function parseQuarterHeaders($) {
  const rows = $('tr');
  let month = null;
  const years = [];

  rows.each((i, row) => {
    const text = $(row).text().trim().replace(/\s+/g, ' ');

    // "Quarter Ended March 31," のような行から月を抽出
    const monthMatch = text.match(/Quarter Ended\s+(\w+)\s+\d+/i);
    if (monthMatch) {
      month = monthMatch[1].toLowerCase();
      return;
    }

    // 年行: 個別セルから年を抽出（セルが連結されると "20242025" になるため）
    if (month && years.length === 0) {
      $(row).find('td, th').each((j, cell) => {
        const cellText = $(cell).text().trim();
        if (/^20\d{2}$/.test(cellText)) {
          years.push(Number(cellText));
        }
      });
      if (years.length >= 2) {
        return false; // 年が見つかったらループ終了
      }
    }
  });

  if (!month || years.length < 2) return null;

  const quarter = MONTH_TO_QUARTER[month];
  if (!quarter) return null;

  // [前年同期, 当期] の順で FY/Q を返す
  return years.map(year => ({
    fy: `FY${year}`,
    q: quarter,
  }));
}

/**
 * 1つのpress-release.htmからセグメントデータを抽出
 * 戻り値: { "FY2024": { "Q4": { ... } }, "FY2025": { "Q4": { ... } } }
 */
function extractFromFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const tableHtml = findSegmentTable(html);
  if (!tableHtml) return null;

  const $ = cheerio.load(tableHtml);

  // ヘッダーから四半期情報を取得
  const quarters = parseQuarterHeaders($);
  if (!quarters) {
    console.warn(`  警告: 四半期ヘッダーを解析できません`);
    return null;
  }

  const results = {};

  // 各行を走査してセグメントデータを抽出
  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // マッピングに一致するか確認
    let matchedKey = null;
    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        matchedKey = mapping.key;
        break;
      }
    }
    if (!matchedKey) return;

    // 数値を抽出（2列: 前年同期, 当期）
    const values = extractValues($, row);
    if (values.length < 2) {
      // 1つしか値がない場合は当期（右列）のみとして扱う
      if (values.length === 1) {
        const { fy, q } = quarters[1]; // 当期
        if (!results[fy]) results[fy] = {};
        if (!results[fy][q]) results[fy][q] = {};
        results[fy][q][matchedKey] = values[0];
      }
      return;
    }

    // 各列の値をFY/Qに割り当て
    for (let col = 0; col < 2 && col < quarters.length; col++) {
      const { fy, q } = quarters[col];
      if (!results[fy]) results[fy] = {};
      if (!results[fy][q]) results[fy][q] = {};
      results[fy][q][matchedKey] = values[col];
    }
  });

  return Object.keys(results).length > 0 ? results : null;
}

// メイン処理
function main() {
  const segments = {};

  // FY*/Q* ディレクトリを走査（ソート済みで時系列順に処理）
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
      const data = extractFromFile(prPath);
      if (!data) {
        console.warn(`  警告: セグメントテーブルが見つかりません`);
        continue;
      }

      // 抽出結果をマージ（新しいデータが既存を上書き）
      for (const dataFy of Object.keys(data)) {
        // FY2020未満はスキップ
        const fyNum = parseInt(dataFy.replace('FY', ''));
        if (fyNum < 2020) {
          console.log(`  → ${dataFy} はスキップ（FY2020未満）`);
          continue;
        }

        for (const dataQ of Object.keys(data[dataFy])) {
          if (!segments[dataFy]) segments[dataFy] = {};
          // 既存データがあれば上書き（新しいファイルのデータが優先）
          segments[dataFy][dataQ] = {
            ...(segments[dataFy][dataQ] || {}),
            ...data[dataFy][dataQ],
          };
          const keys = Object.keys(data[dataFy][dataQ]);
          console.log(`  → ${dataFy}/${dataQ}: ${keys.length} 項目 (${keys.join(', ')})`);
        }
      }
    }
  }

  // JSON出力
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(segments, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // サマリー表示
  let totalQuarters = 0;
  const sortedFys = Object.keys(segments).sort();
  for (const fy of sortedFys) {
    const sortedQs = Object.keys(segments[fy]).sort();
    for (const q of sortedQs) {
      totalQuarters++;
      const d = segments[fy][q];
      const keys = Object.keys(d);
      console.log(`  ${fy}/${q}: ${keys.length} 項目 — ${keys.map(k => `${k}=${d[k]}`).join(', ')}`);
    }
  }
  console.log(`合計: ${totalQuarters} 四半期分のセグメントデータを抽出`);
}

main();
