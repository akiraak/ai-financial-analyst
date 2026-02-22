// Alphabet press-release.htm からバランスシートの投資関連データを抽出するスクリプト
// "CONSOLIDATED BALANCE SHEETS" テーブルから以下の項目を抽出:
//   - Cash and cash equivalents
//   - Marketable securities (短期)
//   - Non-marketable securities (or Non-marketable investments)
//   - Long-term debt
// 計算フィールド:
//   - totalCashAndSecurities = cashAndEquivalents + marketableSecurities
//   - netCash = totalCashAndSecurities - longTermDebt
//
// ■ ヘッダーパターン:
//   - 新形式 (FY2024+ Q1-Q3): "As of December 31, 2024" / "As of March 31, 2025"
//   - 旧形式 (FY2020-FY2023, Q4): "As of December 31," → 次行に年 "2024" "2025"
//
// ■ B/S日付 → FY/Qマッピング:
//   As of March 31     → Q1
//   As of June 30      → Q2
//   As of September 30 → Q3
//   As of December 31  → Q4
//
// ■ ラベル変遷:
//   FY2020-FY2021Q3: "Non-marketable investments"
//   FY2021Q4以降:    "Non-marketable securities"
//
// 出力: investments.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'investments.json');

// 月名 → 四半期マッピング
const MONTH_TO_QUARTER = {
  'january': 'Q1',   // 通常使わないが安全のため
  'march': 'Q1',
  'june': 'Q2',
  'september': 'Q3',
  'december': 'Q4',
};

// 抽出対象の行ラベルとフィールドマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Cash and cash equivalents$/i], key: 'cashAndEquivalents' },
  { patterns: [/^Marketable securities$/i], key: 'marketableSecurities' },
  {
    patterns: [
      /^Non-marketable securities$/i,
      /^Non-marketable equity securities$/i,
      /^Non-marketable investments$/i,
    ],
    key: 'nonMarketableSecurities',
  },
  { patterns: [/^Long-term debt$/i, /^Long-term notes payable$/i], key: 'longTermDebt' },
];

/**
 * テキストから数値をパース
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;
  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned.includes('\u2014') || cleaned.includes('\u2013')) return null;
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
 * テーブル行から数値セルの値を全て抽出
 */
function extractValues($, row) {
  const cells = $(row).find('td');
  const values = [];
  cells.each((i, cell) => {
    const $cell = $(cell);
    const rawText = $cell.text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
    const style = ($cell.attr('style') || '').toLowerCase();
    const isRightAligned = style.includes('text-align:right') || style.includes('text-align: right');
    const isNumeric = /^[\$\d,.\-()\u2014\u2013]+$/.test(rawText) && rawText !== '$' && rawText !== '';
    if ((isRightAligned || isNumeric) && rawText) {
      if (rawText === '$' || rawText === '' || rawText === '-' || rawText === '—') return;
      if (rawText.includes('\u2014') || rawText.includes('\u2013')) return;
      values.push(rawText);
    }
  });
  return values;
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
      .replace(/\u2019/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text === ' ') return;
    const style = ($cell.attr('style') || '').toLowerCase();
    const colspan = parseInt($cell.attr('colspan') || '1');
    const isLeftAligned = style.includes('text-align:left') || style.includes('text-align: left');
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
      if (text && !text.match(/^[\$\d,.\-()\s\u2014\u2013%]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
  }
  return label;
}

/**
 * "CONSOLIDATED BALANCE SHEETS" テーブルのHTMLを抽出する
 */
function findBalanceSheetTableHtml(html) {
  const titleIdx = html.toUpperCase().indexOf('CONSOLIDATED BALANCE SHEETS');
  if (titleIdx === -1) return null;

  const before = html.substring(0, titleIdx);
  const lastTableOpen = before.lastIndexOf('<table');
  const lastTableClose = before.lastIndexOf('</table>');
  const titleInsideTable = lastTableOpen > lastTableClose && lastTableOpen !== -1;

  let tableStart;
  if (titleInsideTable) {
    tableStart = lastTableOpen;
  } else {
    const afterTitle = html.substring(titleIdx);
    const tableMatch = afterTitle.match(/<table[\s>]/i);
    if (!tableMatch) return null;
    tableStart = titleIdx + tableMatch.index;
  }

  // テーブルの終了位置（ネスト対応）
  let depth = 0, tableEnd = -1, si = tableStart;
  while (si < html.length) {
    const om = html.substring(si).match(/<table[\s>]/i);
    const cm = html.substring(si).match(/<\/table>/i);
    if (!om && !cm) break;
    const op = om ? si + om.index : Infinity;
    const cp = cm ? si + cm.index : Infinity;
    if (op < cp) { depth++; si = op + 6; }
    else { depth--; if (depth === 0) { tableEnd = cp + 8; break; } si = cp + 8; }
  }
  if (tableEnd === -1) return null;
  return html.substring(tableStart, tableEnd);
}

/**
 * B/Sテーブルのヘッダーから各カラムのFY/Q情報を解析
 *
 * ヘッダーフォーマット:
 *   パターンA: "As of December 31, 2024" / "As of March 31, 2025"
 *   パターンB: "As of December 31," + "As of March 31," → 別行に年
 *   パターンC (Q4): "As of December 31," + 年が2つ
 *
 * 戻り値: [{ fy, q }, ...]
 */
function parseColumnHeaders($) {
  let monthsFound = [];
  let yearsFound = [];

  $('tr').each((i, row) => {
    const cells = $(row).find('td');
    const rowText = $(row).text().trim().replace(/\s+/g, ' ');

    // "Assets" が見つかったらヘッダー解析終了
    if (/^\s*Assets\s*$/i.test(rowText)) return false;

    cells.each((ci, cell) => {
      const text = $(cell).text().trim()
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return;

      // "As of [Month] [Day], [Year]" パターン（中央寄せ・左寄せ両方対応）
      const asOfMatch = text.match(/As of\s*(?:\n|\s)*(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s*(\d{4})?/i);
      if (asOfMatch) {
        const month = asOfMatch[1].toLowerCase();
        const year = asOfMatch[2] || null;
        monthsFound.push({ month, year });
        return;
      }

      // 月名だけ含む行（"December 31," など）
      const monthOnly = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?/i);
      if (monthOnly && !text.match(/\d{4}/)) {
        monthsFound.push({ month: monthOnly[1].toLowerCase(), year: null });
        return;
      }

      // 年だけの行（中央寄せ・左寄せ両方対応）
      const yearOnly = text.match(/^(20\d{2})$/);
      if (yearOnly) {
        const y = parseInt(yearOnly[1]);
        if (!yearsFound.includes(y)) yearsFound.push(y);
      }
    });
  });

  // 年がまだ未設定のmonthsFoundに年を割り当て
  if (monthsFound.length === 2 && monthsFound.every(m => m.year === null) && yearsFound.length === 2) {
    // 旧形式: 月と年が別の行
    monthsFound[0].year = String(yearsFound[0]);
    monthsFound[1].year = String(yearsFound[1]);
  } else if (monthsFound.length === 1 && monthsFound[0].year === null && yearsFound.length === 2) {
    // Q4形式: 1つの"As of December 31,"に2つの年
    const month = monthsFound[0].month;
    monthsFound = [
      { month, year: String(Math.min(...yearsFound)) },
      { month, year: String(Math.max(...yearsFound)) },
    ];
  }

  // FY/Qに変換
  const result = [];
  for (const col of monthsFound) {
    if (!col.year) continue;
    const quarter = MONTH_TO_QUARTER[col.month];
    if (!quarter) continue;
    result.push({ fy: `FY${col.year}`, q: quarter });
  }

  return result;
}

/**
 * ファイルからB/S投資関連データを抽出
 * 2カラム分のデータを返す
 *
 * 戻り値: [{ fy, q, data: {...} }, ...]
 */
function extractFromFile(filePath, fileFy, fileQ) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const tableHtml = findBalanceSheetTableHtml(html);
  if (!tableHtml) {
    console.warn(`  警告: ${fileFy}/${fileQ} - CONSOLIDATED BALANCE SHEETSテーブルが見つかりません`);
    return [];
  }

  const $ = cheerio.load(tableHtml);

  // ヘッダーからカラムのFY/Q情報を取得
  const columnHeaders = parseColumnHeaders($);
  if (columnHeaders.length === 0) {
    console.warn(`  警告: ${fileFy}/${fileQ} - ヘッダーの日付情報が解析できません`);
    return [];
  }

  // 各カラムのデータを初期化
  const columnData = columnHeaders.map(h => ({ fy: h.fy, q: h.q, data: {} }));

  // テーブル行を走査してデータを抽出
  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    const values = extractValues($, row);
    if (values.length === 0) return;

    // ラベルがマッピングに一致するか確認
    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        for (let colIdx = 0; colIdx < columnData.length; colIdx++) {
          if (colIdx < values.length && !(mapping.key in columnData[colIdx].data)) {
            const parsed = parseNumber(values[colIdx]);
            if (parsed !== null) {
              columnData[colIdx].data[mapping.key] = parsed;
            }
          }
        }
        break;
      }
    }
  });

  // 計算フィールドを追加
  for (const col of columnData) {
    const d = col.data;
    // totalCashAndSecurities = cashAndEquivalents + marketableSecurities
    if (d.cashAndEquivalents != null && d.marketableSecurities != null) {
      d.totalCashAndSecurities = d.cashAndEquivalents + d.marketableSecurities;
    }
    // netCash = totalCashAndSecurities - longTermDebt
    if (d.totalCashAndSecurities != null && d.longTermDebt != null) {
      d.netCash = d.totalCashAndSecurities - d.longTermDebt;
    }
  }

  // 有効なデータがあるカラムのみ返す
  return columnData.filter(c => Object.keys(c.data).length > 0);
}

// メイン処理
function main() {
  const investments = {};

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
      if (!fs.existsSync(prPath)) continue;

      console.log(`処理中: ${fy}/${q}`);
      const results = extractFromFile(prPath, fy, q);

      for (const result of results) {
        const { fy: dataFy, q: dataQ, data } = result;

        // FY2020未満はスキップ
        const yearNum = parseInt(dataFy.replace('FY', ''));
        if (yearNum < 2020) {
          console.log(`  → ${dataFy}/${dataQ} はスキップ（2020年未満）`);
          continue;
        }

        if (!investments[dataFy]) investments[dataFy] = {};

        // 新しいデータで上書き
        const isNew = !(dataQ in investments[dataFy]);
        investments[dataFy][dataQ] = data;
        const keys = Object.keys(data);
        console.log(`  → ${dataFy}/${dataQ}: ${keys.length} 項目${isNew ? '（新規）' : '（更新）'}: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
      }
    }
  }

  // FY/Qをソートして出力
  const sorted = {};
  for (const fy of Object.keys(investments).sort()) {
    sorted[fy] = {};
    for (const q of Object.keys(investments[fy]).sort()) {
      sorted[fy][q] = investments[fy][q];
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
  console.log(`合計: ${total} 四半期分の投資データを抽出`);

  // データ検証
  console.log('\n--- データ検証 ---');
  for (const fy of Object.keys(sorted).sort()) {
    for (const q of Object.keys(sorted[fy]).sort()) {
      const d = sorted[fy][q];
      const missing = [];
      const expectedKeys = ['cashAndEquivalents', 'marketableSecurities', 'nonMarketableSecurities', 'totalCashAndSecurities', 'longTermDebt', 'netCash'];
      for (const key of expectedKeys) {
        if (d[key] == null) missing.push(key);
      }
      if (missing.length > 0) {
        console.warn(`  ${fy}/${q}: 欠落フィールド: ${missing.join(', ')}`);
      } else {
        console.log(`  ${fy}/${q}: OK (Cash=${d.cashAndEquivalents}, Securities=${d.marketableSecurities}, NonMkt=${d.nonMarketableSecurities}, LTDebt=${d.longTermDebt}, NetCash=${d.netCash})`);
      }
    }
  }
}

main();
