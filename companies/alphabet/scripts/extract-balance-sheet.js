// Alphabet press-release.htm から貸借対照表（B/S）データを抽出するスクリプト
// "CONSOLIDATED BALANCE SHEETS" テーブルを解析し、2カラム分のデータを日付からFY/Qにマッピングする
//
// ■ ヘッダーパターン:
//   - 新形式 (FY2024+ Q1-Q3): "As of December 31, 2024" / "As of March 31, 2025" (日付に年を含む)
//   - 旧形式 (FY2020-FY2023, Q4): "As of December 31," + "As of March 31," → 次行に年 "2024" "2025"
//
// ■ B/Sの日付→FY/Qマッピング:
//   As of March 31, YYYY    → FYYYYY/Q1
//   As of June 30, YYYY     → FYYYYY/Q2
//   As of September 30, YYYY → FYYYYY/Q3
//   As of December 31, YYYY → FYYYYY/Q4
//
// 出力: balance-sheet.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'balance-sheet.json');

// 抽出対象の行ラベルとフィールドマッピング
const ROW_MAPPINGS = [
  { patterns: [/^Cash and cash equivalents$/i], key: 'cashAndEquivalents' },
  { patterns: [/^Marketable securities$/i], key: 'marketableSecurities' },
  { patterns: [/^Total cash,?\s*cash equivalents,?\s*and\s*(?:short-term\s*)?marketable securities$/i], key: 'totalCashAndSecurities' },
  { patterns: [/^Accounts receivable,?\s*net$/i], key: 'accountsReceivable' },
  { patterns: [/^Total current assets$/i], key: 'totalCurrentAssets' },
  // FY2020-FY2021Q3 は "Non-marketable investments"、FY2021Q4以降は "Non-marketable securities"
  { patterns: [/^Non-marketable securities$/i, /^Non-marketable equity securities$/i, /^Non-marketable investments$/i], key: 'nonMarketableSecurities' },
  { patterns: [/^Property and equipment,?\s*net$/i], key: 'ppe' },
  { patterns: [/^Total assets$/i], key: 'totalAssets' },
  { patterns: [/^Accounts payable$/i], key: 'accountsPayable' },
  { patterns: [/^Total current liabilities$/i], key: 'totalCurrentLiabilities' },
  { patterns: [/^Long-term debt$/i, /^Long-term notes payable$/i], key: 'longTermDebt' },
  { patterns: [/^Total liabilities$/i], key: 'totalLiabilities' },
  { patterns: [/^Total stockholders.?\s*equity$/i, /^Total shareholders.?\s*equity$/i], key: 'totalEquity' },
];

// 月名→四半期マッピング
const MONTH_TO_QUARTER = {
  'march': 'Q1',
  'june': 'Q2',
  'september': 'Q3',
  'december': 'Q4',
};

/**
 * テキストから数値をパース（百万ドル単位）
 * カンマ区切り、括弧での負数、ダッシュ等に対応
 */
function parseNumber(text) {
  if (!text || text === '-' || text === '—') return null;
  let negative = false;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  // emダッシュ・enダッシュはnull
  if (cleaned.includes('\u2014') || cleaned.includes('\u2013')) return null;
  // 括弧は負数
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
 * テーブル行から数値セルの値を全て抽出（左→右の順）
 * 右寄せ or 数値パターンのセルを数値として取得
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
      // ドル記号だけ、空、ダッシュのみのセルはスキップ
      if (rawText === '$' || rawText === '' || rawText === '-' || rawText === '—') return;
      if (rawText.includes('\u2014') || rawText.includes('\u2013')) return;
      values.push(rawText);
    }
  });
  return values;
}

/**
 * 行のラベルテキストを取得
 * 左寄せセル or colspan >= 2 のテキストセルからラベルを抽出
 */
function getRowLabel($, row) {
  const cells = $(row).find('td');
  let label = '';
  cells.each((i, cell) => {
    const $cell = $(cell);
    const text = $cell.text().trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\u2019/g, "'")
      .replace(/&#8217;/g, "'")
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
 * タイトル文字列を基点にテーブルを探す（ネストテーブルに対応）
 */
function findBalanceSheetTableHtml(html) {
  // "CONSOLIDATED BALANCE SHEETS" を検索
  const titleIdx = html.toUpperCase().indexOf('CONSOLIDATED BALANCE SHEETS');
  if (titleIdx === -1) return null;

  // タイトルがテーブル内にあるか、テーブル外にあるかを判定
  const before = html.substring(0, titleIdx);
  const lastTableOpen = before.lastIndexOf('<table');
  const lastTableClose = before.lastIndexOf('</table>');
  const titleInsideTable = lastTableOpen > lastTableClose && lastTableOpen !== -1;

  let tableStart;
  if (titleInsideTable) {
    // タイトルがテーブル内 → そのテーブルの開始位置を使う
    tableStart = lastTableOpen;
  } else {
    // タイトルがテーブル外 → タイトルの後にある最初のテーブル
    const afterTitle = html.substring(titleIdx);
    const tableMatch = afterTitle.match(/<table[\s>]/i);
    if (!tableMatch) return null;
    tableStart = titleIdx + tableMatch.index;
  }

  // テーブルの終了位置を見つける（ネストに対応）
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
 * ヘッダー行から「As of」日付情報をパースし、各カラムのFY/Qを決定する
 *
 * 返り値: [{ fy: 'FY2025', q: 'Q1' }, { fy: 'FY2025', q: 'Q4' }]
 *   インデックス0が左カラム、インデックス1が右カラム
 *
 * ヘッダーフォーマット:
 *   パターンA（新形式）: "As of December 31, 2024" / "As of March 31, 2025"
 *   パターンB（旧形式）: "As of December 31," + "As of March 31," → 別の行に年 "2024" / "2025"
 */
function parseColumnHeaders($) {
  const headerRows = [];
  const rows = $('tr').toArray();

  // ヘッダー行を特定: "As of" を含む行、年を含む行
  // 注意: 一部のPRでは "As of" セルが text-align:left になっているため、
  //       アライメントに依存せず全セルのテキストを確認する
  for (const row of rows) {
    const cells = $(row).find('td');
    const rowTexts = [];
    cells.each((i, cell) => {
      const text = $(cell).text().trim()
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text && text !== '(unaudited)') {
        // "As of" パターン、年パターン、または "(unaudited)" を含むセルを収集
        const hasAsOf = /As of/i.test(text);
        const isYearOnly = /^\d{4}$/.test(text);
        if (hasAsOf || isYearOnly) {
          rowTexts.push(text);
        }
      }
    });
    if (rowTexts.length > 0) {
      headerRows.push(rowTexts);
    }
    // "Assets" ラベルが見つかったらヘッダー解析を終了
    const rowText = $(row).text().trim().replace(/\s+/g, ' ');
    if (/^\s*Assets\s*$/i.test(rowText)) break;
  }

  // ヘッダー行からカラム日付情報を抽出
  const columns = []; // { month, year } の配列
  const monthPattern = /(?:January|February|March|April|May|June|July|August|September|October|November|December)/i;
  const yearPattern = /^(\d{4})$/;

  // パターンA: "As of March 31, 2025" のように日付と年が一緒のケース
  let monthsFound = [];
  let yearsFound = [];

  for (const rowTexts of headerRows) {
    for (const text of rowTexts) {
      // "As of" 日付を探す
      const asOfMatch = text.match(/As of\s*(?:\n|\s)*(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s*(\d{4})?/i);
      if (asOfMatch) {
        const month = asOfMatch[1].toLowerCase();
        const year = asOfMatch[2] || null;
        monthsFound.push({ month, year, source: text });
        continue;
      }
      // 月名だけ含む行（"As of" + 月名が分離しているケース）
      const monthOnly = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?/i);
      if (monthOnly && !text.match(/\d{4}/)) {
        monthsFound.push({ month: monthOnly[1].toLowerCase(), year: null, source: text });
        continue;
      }
      // 年だけの行
      const yearOnly = text.match(yearPattern);
      if (yearOnly) {
        yearsFound.push(parseInt(yearOnly[1]));
      }
    }
  }

  // 年がまだ未設定のmonthsFoundに年を割り当て
  if (monthsFound.length === 2 && monthsFound.every(m => m.year === null) && yearsFound.length === 2) {
    // 旧形式: 月と年が別の行にある
    monthsFound[0].year = String(yearsFound[0]);
    monthsFound[1].year = String(yearsFound[1]);
  } else if (monthsFound.length === 1 && monthsFound[0].year === null && yearsFound.length === 2) {
    // Q4形式: "As of December 31," が1つで、年が2つ
    // 左カラムは古い年、右カラムは新しい年（同じ月）
    const month = monthsFound[0].month;
    monthsFound = [
      { month, year: String(Math.min(...yearsFound)) },
      { month, year: String(Math.max(...yearsFound)) },
    ];
  }

  // FY/Qに変換
  const result = [];
  for (const col of monthsFound) {
    if (!col.year) {
      console.warn(`  警告: 年が取得できません: month=${col.month}`);
      continue;
    }
    const quarter = MONTH_TO_QUARTER[col.month];
    if (!quarter) {
      console.warn(`  警告: 不明な月名: ${col.month}`);
      continue;
    }
    result.push({ fy: `FY${col.year}`, q: quarter });
  }

  return result;
}

/**
 * ファイルからB/Sデータを抽出
 * 2カラム分のデータを返す（各カラムはFY/Qにマッピング）
 *
 * 返り値: [{ fy, q, data: {...} }, ...]
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

  // テーブルの行を走査してデータを抽出
  $('tr').each((i, row) => {
    const label = getRowLabel($, row);
    if (!label) return;

    const values = extractValues($, row);
    if (values.length === 0) return;

    // ラベルがマッピングに一致するか確認
    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        // 各カラムに値を割り当て
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

  // 有効なデータがあるカラムのみ返す
  return columnData.filter(c => Object.keys(c.data).length > 0);
}

/**
 * メイン処理
 */
function main() {
  const balanceSheet = {};

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
        // 既にデータがある場合は上書きしない（より新しいPRからのデータを優先するため）
        if (balanceSheet[dataFy] && balanceSheet[dataFy][dataQ]) {
          console.log(`  → ${dataFy}/${dataQ}: 既存データあり、スキップ`);
          continue;
        }
        if (!balanceSheet[dataFy]) balanceSheet[dataFy] = {};
        balanceSheet[dataFy][dataQ] = data;
        const keys = Object.keys(data);
        console.log(`  → ${dataFy}/${dataQ}: ${keys.length} 項目: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
      }
    }
  }

  // 出力先ディレクトリが存在しない場合は作成
  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // FY/Qをソートして出力
  const sorted = {};
  for (const fy of Object.keys(balanceSheet).sort()) {
    sorted[fy] = {};
    for (const q of Object.keys(balanceSheet[fy]).sort()) {
      sorted[fy][q] = balanceSheet[fy][q];
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 集計
  let total = 0;
  for (const fy of Object.keys(sorted)) {
    for (const q of Object.keys(sorted[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のB/Sデータを抽出`);
}

main();
