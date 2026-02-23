// press-release.html からセグメント別売上データを抽出するスクリプト
// 出力: data/segments.json
// 対応形式: Microsoft SEC EDGAR形式（旧: 大文字タグ、新: 小文字タグ + inline CSS）
//
// 旧形式 (FY2021 Q1 - FY2023 Q3):
//   見出し: "SEGMENT REVENUE AND OPERATING INCOME"
//   構造: "Revenue" セクションヘッダ → 各セグメント名の行に売上値
//         "Operating Income" セクションヘッダ → 各セグメント名の行に営業利益値
//
// 新形式 (FY2023 Q4+):
//   見出し: "SEGMENT RESULTS" または "SEGMENT REVENUE AND OPERATING INCOME"
//   構造: セグメント名がボールドヘッダ → Revenue, Cost of revenue, Operating income 行

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segments.json');
const SEGMENT_PROFIT_PATH = path.join(__dirname, '..', 'data', 'segment-profit.json');

// セグメント名とキーのマッピング
const SEGMENT_MAP = {
  'Productivity and Business Processes': 'productivityAndBusiness',
  'Intelligent Cloud': 'intelligentCloud',
  'More Personal Computing': 'morePersonalComputing',
};

/**
 * テキストから数値をパース
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;
  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned.startsWith('(')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  }
  cleaned = cleaned.replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * テーブル行からラベルテキストを取得
 */
function getRowLabel($, row) {
  const cells = $(row).find('td');
  let label = '';

  cells.each((i, cell) => {
    if (label) return;
    const $cell = $(cell);
    const tdStyle = ($cell.attr('style') || '').toLowerCase();
    const tdAlign = ($cell.attr('align') || '').toLowerCase();
    const tdValign = ($cell.attr('valign') || '').toLowerCase();

    const isTdLeft = tdStyle.includes('text-align:left') || tdAlign === 'left';
    const $p = $cell.find('p').first();
    const pStyle = ($p.attr('style') || '').toLowerCase();
    const pAlign = ($p.attr('align') || '').toLowerCase();
    const isPLeft = pStyle.includes('text-align:left') || pAlign === 'left';
    const isVTop = tdValign === 'top';
    const hasMarginLeft = pStyle.includes('margin-left');

    if (isTdLeft || isPLeft || isVTop || hasMarginLeft) {
      const text = $cell.text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.\-()\s]+$/) && text.length > 1) {
        label = text;
      }
    }
  });

  // フォールバック: 最初の有意テキストセル
  if (!label) {
    cells.each((i, cell) => {
      if (label) return;
      const $cell = $(cell);
      const text = $cell.text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const $p = $cell.find('p').first();
      const pAlign = ($p.attr('align') || '').toLowerCase();
      const pStyle = ($p.attr('style') || '').toLowerCase();
      const isRight = pAlign === 'right' || pStyle.includes('text-align:right');
      if (!isRight && text && !text.match(/^[\$\d,.\-()\s]+$/) && text.length > 1) {
        label = text;
      }
    });
  }

  return label;
}

/**
 * テーブル行から数値セルを抽出
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    const tdStyle = ($cell.attr('style') || '').toLowerCase();
    const tdAlign = ($cell.attr('align') || '').toLowerCase();

    const $p = $cell.find('p');
    const pStyle = ($p.attr('style') || '').toLowerCase();
    const pAlign = ($p.attr('align') || '').toLowerCase();

    const isValueCell =
      (tdStyle.includes('text-align:center') && pStyle.includes('text-align:right')) ||
      tdStyle.includes('text-align:right') ||
      tdAlign === 'right' ||
      pAlign === 'right';

    if (isValueCell) {
      const text = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
      if (text && text !== '$' && text !== '' && text !== '&#160;') {
        const fontSize = pStyle.match(/font-size:\s*([\d.]+)pt/);
        if (fontSize && parseFloat(fontSize[1]) <= 1) return;

        const cleaned = text.replace(/[$,\s()]/g, '');
        if (cleaned && (cleaned.match(/^\d/) || cleaned === '-' || cleaned === '—')) {
          values.push(text);
        }
      }
    }
  });

  return values;
}

/**
 * HTMLテキスト内のセクション見出しを検索し、直後のテーブルHTMLを返す
 */
function findTableByHeading(html, headingText) {
  const headingIdx = html.indexOf(headingText);
  if (headingIdx === -1) return null;

  const afterHeading = html.substring(headingIdx);
  const tableMatch = afterHeading.match(/<table[\s>]/i);
  if (!tableMatch) return null;

  const tableStart = headingIdx + tableMatch.index;

  let depth = 0;
  const tableRegex = /<(\/?)table[\s>]/gi;
  tableRegex.lastIndex = tableStart;
  let m;
  let tableEnd = -1;
  while ((m = tableRegex.exec(html)) !== null) {
    if (m[1] === '/') {
      depth--;
      if (depth === 0) {
        tableEnd = m.index + '</table>'.length;
        break;
      }
    } else {
      depth++;
    }
  }

  if (tableEnd === -1) return null;
  const tableHtml = html.substring(tableStart, tableEnd);
  const $table = cheerio.load(tableHtml);
  return { $: $table, table: $table('table').first() };
}

/**
 * 行のラベルセルがボールド（セクションヘッダ）かどうかを判定
 * ※値セル（右寄せ）は対象外 — FY2026形式では現期数値もboldのため
 */
function isBoldRow($, row) {
  const cells = $(row).find('td');
  let hasBold = false;
  cells.each((i, cell) => {
    const $cell = $(cell);
    const tdStyle = ($cell.attr('style') || '').toLowerCase();
    const tdAlign = ($cell.attr('align') || '').toLowerCase();
    const $p = $cell.find('p').first();
    const pStyle = ($p.attr('style') || '').toLowerCase();
    const pAlign = ($p.attr('align') || '').toLowerCase();

    // 値セル（右寄せ）はスキップ — ラベルセルのみを対象
    const isValueCell =
      (tdStyle.includes('text-align:center') && pStyle.includes('text-align:right')) ||
      tdStyle.includes('text-align:right') || tdAlign === 'right' || pAlign === 'right';
    if (isValueCell) return;

    // <B>タグまたはfont-weight:boldスタイル
    if ($cell.find('b').length > 0) hasBold = true;
    const fontStyle = ($cell.find('font').attr('style') || '').toLowerCase();
    if (fontStyle.includes('font-weight:bold')) hasBold = true;
  });
  return hasBold;
}

/**
 * セグメント名をキーに変換
 */
function segmentKey(label) {
  for (const [name, key] of Object.entries(SEGMENT_MAP)) {
    if (label.includes(name)) return key;
  }
  return null;
}

/**
 * 旧形式: Revenue/Operating Income セクション内でセグメント名行から値を取得
 */
function extractOldFormat($, table) {
  const revenue = {};
  const opIncome = {};
  let section = null; // 'revenue' or 'operatingIncome'

  table.find('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // セクションヘッダの判定
    if (label.match(/^\s*Revenue\s*$/i) && isBoldRow($, row)) {
      section = 'revenue';
      return;
    }
    if (label.match(/^\s*Operating Income\s*$/i) && isBoldRow($, row)) {
      section = 'operatingIncome';
      return;
    }
    if (label.match(/^\s*Total\s*$/i)) {
      // Total行はスキップ（セクション終了ではない）
      return;
    }

    const key = segmentKey(label);
    if (!key) return;

    const values = extractValues($, row);
    if (values.length === 0) return;
    const firstValue = parseNumber(values[0]);

    if (section === 'revenue') {
      revenue[key] = firstValue;
    } else if (section === 'operatingIncome') {
      opIncome[key] = firstValue;
    }
  });

  return { revenue, opIncome };
}

/**
 * 新形式: セグメント名がヘッダ → Revenue, Operating income 行
 */
function extractNewFormat($, table) {
  const revenue = {};
  const opIncome = {};
  let currentSegment = null;

  table.find('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    // セグメント名ヘッダの検出（ボールド行）
    const key = segmentKey(label);
    if (key && isBoldRow($, row)) {
      const values = extractValues($, row);
      // ヘッダ行には通常数値がない
      if (values.length === 0) {
        currentSegment = key;
        return;
      }
    }

    // "Total" や "Consolidated" 等のセクション後はセグメント終了
    if (label.match(/^\s*Total\s*/i) || label.match(/Consolidated/i)) {
      currentSegment = null;
      return;
    }

    // ボールド行でセグメント名でない場合もセグメント終了
    if (!key && isBoldRow($, row)) {
      currentSegment = null;
      return;
    }

    if (!currentSegment) return;

    const values = extractValues($, row);
    if (values.length === 0) return;
    const firstValue = parseNumber(values[0]);

    if (label.match(/^\s*Revenue\s*$/i)) {
      revenue[currentSegment] = firstValue;
    } else if (label.match(/^\s*Operating income\s*$/i)) {
      opIncome[currentSegment] = firstValue;
    }
  });

  return { revenue, opIncome };
}

/**
 * press-release.html からセグメント売上データを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');

  // "SEGMENT RESULTS" または "SEGMENT REVENUE AND OPERATING INCOME" を探す
  let found = findTableByHeading(html, 'SEGMENT RESULTS');
  if (!found) {
    found = findTableByHeading(html, 'SEGMENT REVENUE AND OPERATING INCOME');
  }
  if (!found) {
    console.warn(`  警告: ${fy}/${q} - セグメントテーブルが見つかりません`);
    return null;
  }

  const { $, table } = found;

  // 形式を判定: 新形式はセグメント名がボールドヘッダ、旧形式はRevenue/Operating Incomeがヘッダ
  let isNewFormat = false;
  table.find('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;
    // 新形式の特徴: セグメント名がボールドヘッダで、直後にRevenue行がある
    if (segmentKey(label) && isBoldRow($, row)) {
      const values = extractValues($, row);
      if (values.length === 0) {
        isNewFormat = true;
        return false; // breakに相当
      }
    }
  });

  let result;
  if (isNewFormat) {
    result = extractNewFormat($, table);
  } else {
    result = extractOldFormat($, table);
  }

  if (Object.keys(result.revenue).length === 0) {
    console.warn(`  警告: ${fy}/${q} - セグメント売上が抽出できませんでした`);
    return null;
  }

  return result;
}

// メイン処理
function main() {
  const segments = {};
  const segmentProfit = {};

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const prPath = path.join(fyPath, q, 'press-release.html');
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.html が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        // segments.json: セグメント売上のみ
        if (!segments[fy]) segments[fy] = {};
        segments[fy][q] = data.revenue;

        // segment-profit.json: セグメント売上＋営業利益
        if (Object.keys(data.opIncome).length > 0) {
          if (!segmentProfit[fy]) segmentProfit[fy] = {};
          segmentProfit[fy][q] = {};
          for (const [key, rev] of Object.entries(data.revenue)) {
            segmentProfit[fy][q][key] = {
              revenue: rev,
              operatingIncome: data.opIncome[key] || null,
            };
          }
        }

        console.log(`  → PBP: Rev=${data.revenue.productivityAndBusiness}, OI=${data.opIncome.productivityAndBusiness || 'N/A'}`);
        console.log(`    IC:  Rev=${data.revenue.intelligentCloud}, OI=${data.opIncome.intelligentCloud || 'N/A'}`);
        console.log(`    MPC: Rev=${data.revenue.morePersonalComputing}, OI=${data.opIncome.morePersonalComputing || 'N/A'}`);
      }
    }
  }

  // 出力ディレクトリ確認
  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(segments, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  fs.writeFileSync(SEGMENT_PROFIT_PATH, JSON.stringify(segmentProfit, null, 2));
  console.log(`出力: ${SEGMENT_PROFIT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(segments)) {
    for (const q of Object.keys(segments[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のデータを抽出`);
}

main();
