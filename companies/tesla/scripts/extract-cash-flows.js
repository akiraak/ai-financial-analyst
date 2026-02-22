// Tesla press-release.html / 10-Q / 10-K からキャッシュフロー計算書データを抽出するスクリプト
// 出力: data/cash-flows.json
//
// データソース:
// 1. プレスリリース（テキストデータあり）: FONT/p要素から5四半期分を一括抽出
//    - FY2023 Q2以降のプレスリリースが対象
// 2. 10-Q/10-K（テキストデータなしの期間）: HTMLテーブルから抽出
//    - FY2020 Q1 〜 FY2023 Q1が対象
//    - 10-Q: Q1は単四半期、Q2はH1累計、Q3は9M累計 → 差分で単四半期を算出
//    - 10-K: 年間合計 → Q4 = 年間 - (Q1+Q2+Q3)
//
// Teslaは暦年FY（FY2025 = カレンダー年2025）

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'cash-flows.json');

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * テキストから数値をパース
 * "(96)" → -96, "25,707" → 25707, "0.60" → 0.60, "—" → null
 */
function parseNumber(text) {
  if (!text) return null;
  text = text.replace(/[$\s\u00a0]/g, '').trim();
  if (!text || text === '-' || text === '—' || text === '–' || text === '\u2014' || text === '\u2013') return null;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/,/g, '');
  const num = parseFloat(text);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * 四半期ラベル "Q4-2024" → { fy: "FY2024", q: "Q4" }
 * Tesla は暦年FY
 */
function quarterLabelToFYQ(label) {
  const match = label.match(/Q(\d)-(\d{4})/);
  if (!match) return null;
  return { fy: `FY${match[2]}`, q: `Q${match[1]}` };
}

// ============================================================
// プレスリリーステキスト解析（メインソース）
// ============================================================

/**
 * プレスリリースHTMLからキャッシュフロー計算書のテキストブロックを取得
 * FONT/p要素から「CASH FLOWS FROM OPERATING」と「Net cash provided by operating」を含むブロックを検出
 */
function findCashFlowText(html) {
  // HTMLエンティティをデコード
  html = html.replace(/&#8212;/g, '—').replace(/&#8211;/g, '–').replace(/&#160;/g, ' ');

  const $ = cheerio.load(html);
  let resultText = null;

  // 新形式: <FONT>要素を走査
  $('FONT, font').each((i, el) => {
    const text = $(el).text();
    if (text.includes('CASH FLOWS FROM OPERATING') && text.includes('Net cash provided by operating')) {
      if (!resultText || text.length > resultText.length) {
        resultText = text;
      }
    }
  });

  // 旧形式: <p>要素を走査
  if (!resultText) {
    $('p').each((i, el) => {
      const text = $(el).text();
      if (text.includes('CASH FLOWS FROM OPERATING') && text.includes('Net cash provided by operating')) {
        if (!resultText || text.length > resultText.length) {
          resultText = text;
        }
      }
    });
  }

  return resultText;
}

/**
 * テキストブロックから四半期ヘッダーを抽出
 * "Q4-2024 Q1-2025 Q2-2025 Q3-2025 Q4-2025" → ["Q4-2024", "Q1-2025", ...]
 */
function extractQuarterHeaders(text) {
  const headerRegex = /Q[1-4]-\d{4}/g;
  const headers = [];
  let match;
  // テキスト冒頭部分（最初の"CASH FLOWS"の前）からヘッダーを抽出
  const cfIdx = text.indexOf('CASH FLOWS');
  const headerSection = cfIdx > 0 ? text.substring(0, cfIdx) : text.substring(0, 200);
  while ((match = headerRegex.exec(headerSection)) !== null) {
    headers.push(match[0]);
  }
  return headers;
}

/**
 * ラベルの後に続く数値をN個抽出する（1回のマッチ試行）
 * @param {string} afterLabel - ラベル直後のテキスト
 * @param {number} numCols - 抽出する列数
 * @returns {number[] | null}
 */
function extractNumbersFromText(afterLabel, numCols) {
  const numbers = [];

  // 数値トークン: (123,456) or (7,603) or 123,456 or 0.66 or — or –
  // 脚注 (1) (2) (3) (4) は除外（1桁の括弧数字でカンマなし）
  // 括弧付き: 2桁以上、またはカンマ区切りを含む数値（例: (7,603)）
  const tokenRegex = /\((\d[\d,]*,[\d,]*\d(?:\.\d+)?)\)|\((\d{2,}[\d,]*(?:\.\d+)?)\)|\((\d)\)|(\d[\d,]*(?:\.\d+)?)|([—–])/g;
  let m;
  let charCount = 0;

  while ((m = tokenRegex.exec(afterLabel)) !== null && numbers.length < numCols) {
    // 次のラベル（大文字英字の連続）に到達したか確認
    const gap = afterLabel.substring(charCount, m.index);
    if (gap.match(/[A-Z][a-z]{2,}|(?<![A-Z] )[A-Z]{4,}(?! [A-Z])/)) {
      const word = gap.match(/[A-Z][a-z]{2,}|[A-Z]{4,}/);
      if (word && !['YoY'].includes(word[0])) break;
    }

    if (m[1]) {
      // 括弧付きカンマ区切り数値 → 負数（例: (7,603)）
      numbers.push(-parseFloat(m[1].replace(/,/g, '')));
    } else if (m[2]) {
      // 括弧付き2桁以上の数値 → 負数（例: (96)）
      numbers.push(-parseFloat(m[2].replace(/,/g, '')));
    } else if (m[3]) {
      // 括弧付き1桁 → 脚注マーカー、スキップ
      continue;
    } else if (m[4]) {
      // 通常の数値
      numbers.push(parseFloat(m[4].replace(/,/g, '')));
    } else if (m[5]) {
      // ダッシュ → null
      numbers.push(null);
    }
    charCount = m.index + m[0].length;
  }

  if (numbers.length < numCols) return null;
  return numbers.slice(0, numCols);
}

/**
 * ラベルの後に続く数値をN個抽出する
 * 最初のマッチで数値抽出に失敗した場合、次の出現箇所を試行する
 * （例: "Adjustments to reconcile ... to net cash provided by operating activities:" の後には数値がないが、
 *  その後の "Net cash provided by operating activities 4,370 242 ..." には数値がある）
 * @param {string} text - 全テキスト
 * @param {RegExp} labelRegex - ラベルの正規表現
 * @param {number} numCols - 抽出する列数
 * @param {number} startPos - 検索開始位置
 * @returns {{ values: number[], endPos: number } | null}
 */
function extractNumbersAfterLabel(text, labelRegex, numCols, startPos = 0) {
  // グローバル検索用に正規表現を再構築
  const globalRegex = new RegExp(labelRegex.source, labelRegex.flags.includes('g') ? labelRegex.flags : labelRegex.flags + 'g');
  const searchText = text.substring(startPos);

  let labelMatch;
  while ((labelMatch = globalRegex.exec(searchText)) !== null) {
    const afterLabel = searchText.substring(labelMatch.index + labelMatch[0].length);
    const numbers = extractNumbersFromText(afterLabel, numCols);

    if (numbers) {
      return {
        values: numbers,
        endPos: startPos + labelMatch.index + labelMatch[0].length
      };
    }
    // 数値抽出に失敗した場合、次のマッチを試行
  }

  return null;
}

/**
 * プレスリリーステキストからキャッシュフローデータを抽出
 * @returns {Object} { "Q4-2024": { operatingCF: 4814, ... }, "Q1-2025": { ... }, ... }
 */
function extractFromPressReleaseText(text, headers) {
  const numCols = headers.length;
  if (numCols === 0) return {};

  // セクション位置の検出
  const operatingStart = text.search(/CASH FLOWS FROM OPERATING/i);
  const investingStart = text.search(/CASH FLOWS FROM INVESTING/i);
  const financingStart = text.search(/CASH FLOWS FROM FINANCING/i);

  const extractRow = (regex, startPos = 0) => {
    const result = extractNumbersAfterLabel(text, regex, numCols, startPos);
    return result ? result.values : null;
  };

  // Operating Activitiesセクション
  const opStart = operatingStart > 0 ? operatingStart : 0;
  const depreciation = extractRow(/Depreciation,?\s*amortization and impairment/i, opStart);
  const stockBasedComp = extractRow(/Stock-based compensation/i, opStart);
  const operatingCF = extractRow(/Net cash provided by (?:\(used in\) )?operating activities/i, opStart);

  // Investing Activitiesセクション
  const invStart = investingStart > 0 ? investingStart : opStart;
  const capex = extractRow(/Capital expenditures/i, invStart);
  // 10-Qフォールバック用に「Purchases of property and equipment」もチェック
  const capexAlt = capex ? null : extractRow(/Purchases of property and equipment/i, invStart);
  const investingCF = extractRow(/Net cash (?:used in|provided by) (?:\(used in\) )?investing activities/i, invStart);

  // Financing Activitiesセクション
  const finStart = financingStart > 0 ? financingStart : invStart;
  const financingCF = extractRow(/Net cash (?:provided by|used in) (?:\(used in\) )?financing activities/i, finStart);

  // 列ごとにオブジェクトを構築
  const result = {};
  for (let i = 0; i < numCols; i++) {
    const q = headers[i];
    const data = {};

    if (operatingCF && operatingCF[i] != null) data.operatingCF = operatingCF[i];
    if (depreciation && depreciation[i] != null) data.depreciation = depreciation[i];
    if (stockBasedComp && stockBasedComp[i] != null) data.stockBasedComp = stockBasedComp[i];

    // capex: 「Capital expenditures」優先、なければ「Purchases of property and equipment」
    const capexValues = capex || capexAlt;
    if (capexValues && capexValues[i] != null) {
      // capexは負数で格納（支出）
      data.capex = capexValues[i] > 0 ? -capexValues[i] : capexValues[i];
    }

    if (investingCF && investingCF[i] != null) data.investingCF = investingCF[i];
    if (financingCF && financingCF[i] != null) data.financingCF = financingCF[i];

    // freeCashFlow = operatingCF + capex（capexは負数なので実質 operatingCF - |capex|）
    if (data.operatingCF != null && data.capex != null) {
      data.freeCashFlow = Math.round((data.operatingCF + data.capex) * 100) / 100;
    }

    if (Object.keys(data).length > 0) {
      result[q] = data;
    }
  }

  return result;
}

// ============================================================
// 10-Q/10-K テーブル解析（フォールバック）
// ============================================================

/**
 * 10-Q/10-K HTMLからConsolidated Statements of Cash Flowsテーブルを解析
 * @returns {Object} { operatingCF: xxx, depreciation: xxx, ... } | null
 */
function extractCashFlowFromSecFiling(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html, { decodeEntities: true });

  // キャッシュフロー計算書テーブルを探す
  let targetTable = null;
  $('table').each((i, table) => {
    const tableText = $(table).text();
    if (tableText.includes('Cash Flows from Operating') &&
        (tableText.includes('investing') || tableText.includes('Investing')) &&
        !targetTable) {
      targetTable = table;
    }
  });

  if (!targetTable) return null;

  const result = {};

  // 行ラベルと抽出キーのマッピング定義
  // capexは期間によってラベルが変わる:
  //   - 旧: "Purchases of property and equipment excluding finance leases, net of sales"
  //   - 新: "Capital expenditures"
  // 行ラベルと抽出キーのマッピング
  // 「Net cash provided by (used in)」「Net cash (used in) provided by」「Net cash used in」等の
  // 複数バリエーションに対応する汎用パターン
  // 共通: "Net cash" + ("provided by" / "used in" / "(used in) provided by" / "provided by (used in)") + activity名
  const ROW_MAPPINGS = [
    { patterns: [/^Depreciation,?\s*amortization and impairment$/i], key: 'depreciation' },
    { patterns: [/^Stock-based compensation$/i], key: 'stockBasedComp' },
    { patterns: [/^Net cash\b.*?operating activities$/i], key: 'operatingCF' },
    { patterns: [/^Capital expenditures$/i], key: 'capex' },
    { patterns: [/^Purchases of property and equipment/i], key: 'capex' },
    { patterns: [/^Net cash\b.*?investing activities$/i], key: 'investingCF' },
    { patterns: [/^Net cash\b.*?financing activities$/i], key: 'financingCF' },
  ];

  $(targetTable).find('tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    // ラベル取得
    let label = '';
    cells.each((j, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.()\s—–\u2014\u2013]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
    if (!label) return;

    // 数値取得（最初の有効な数値列 = 当期データ）
    const values = [];
    cells.each((j, cell) => {
      // ix:nonFraction タグから直接抽出
      const ixEl = $(cell).find('ix\\:nonFraction, ix\\:nonfraction');
      if (ixEl.length > 0) {
        const val = parseNumber(ixEl.first().text().trim());
        if (val !== null) {
          const sign = ixEl.first().attr('sign');
          values.push(sign === '-' ? -Math.abs(val) : val);
          return;
        }
      }
      const text = $(cell).text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
      if (text && /[\d]/.test(text) && text !== '$') {
        const val = parseNumber(text);
        if (val !== null) values.push(val);
      }
    });

    if (values.length === 0) return;
    const firstValue = values[0];

    // マッピング
    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in result)) {
          result[mapping.key] = firstValue;
        }
        break;
      }
    }
  });

  // capexを負数に統一（支出のため）
  if (result.capex != null && result.capex > 0) {
    result.capex = -result.capex;
  }

  // freeCashFlow = operatingCF + capex
  if (result.operatingCF != null && result.capex != null) {
    result.freeCashFlow = Math.round((result.operatingCF + result.capex) * 100) / 100;
  }

  return result;
}

// ============================================================
// メイン処理
// ============================================================

function main() {
  const allData = {}; // { "FY2025": { "Q4": { ... } } }

  // Step 1: 全プレスリリースをスキャンし、テキストデータがあるものから5四半期分を抽出
  console.log('=== Step 1: プレスリリースからキャッシュフローデータ抽出 ===');

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  // 古い順にスキャンし、新しいデータで上書き（最新のrestatementを反映）
  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const prPath = path.join(fyPath, q, 'press-release.html');
      if (!fs.existsSync(prPath)) continue;

      const html = fs.readFileSync(prPath, 'utf-8');
      const text = findCashFlowText(html);

      if (!text) {
        console.log(`  ${fy}/${q}: テキストデータなし（イメージ形式）`);
        continue;
      }

      const headers = extractQuarterHeaders(text);
      if (headers.length === 0) {
        console.log(`  ${fy}/${q}: ヘッダー抽出失敗`);
        continue;
      }

      console.log(`  ${fy}/${q}: テキストデータあり -> ${headers.join(', ')}`);
      const quarterData = extractFromPressReleaseText(text, headers);

      for (const [qLabel, data] of Object.entries(quarterData)) {
        const fyq = quarterLabelToFYQ(qLabel);
        if (!fyq) continue;
        if (!allData[fyq.fy]) allData[fyq.fy] = {};
        // 新しいプレスリリースのデータで上書き（restatement対応）
        allData[fyq.fy][fyq.q] = { ...(allData[fyq.fy][fyq.q] || {}), ...data };
      }
    }
  }

  // Step 2: テキストデータのないプレスリリースの四半期は10-Q/10-Kからフォールバック
  console.log('\n=== Step 2: 10-Q/10-Kからフォールバック抽出 ===');

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      // 既にプレスリリースからデータ取得済みならスキップ
      if (allData[fy] && allData[fy][q] && allData[fy][q].operatingCF != null) continue;

      // 10-Q or 10-K ファイルを探す
      const qDir = path.join(fyPath, q);
      const tenQPath = path.join(qDir, '10-Q.htm');
      const tenKPath = path.join(qDir, '10-K.htm');
      const filePath = fs.existsSync(tenQPath) ? tenQPath : (fs.existsSync(tenKPath) ? tenKPath : null);

      if (!filePath) {
        console.log(`  ${fy}/${q}: 10-Q/10-Kファイルなし -> スキップ`);
        continue;
      }

      console.log(`  ${fy}/${q}: ${path.basename(filePath)} から抽出中...`);

      const is10K = filePath.endsWith('10-K.htm');
      const isQ1 = q === 'Q1';
      const data = extractCashFlowFromSecFiling(filePath);

      if (!data || data.operatingCF == null) {
        console.log(`    -> 抽出失敗`);
        continue;
      }

      if (is10K) {
        // 10-Kは年間合計データ → Q4 = 年間 - (Q1+Q2+Q3)で計算
        console.log(`    -> 10-K年間データ検出 (operatingCF: ${data.operatingCF}) -> Q4算出`);
        const q1 = allData[fy] && allData[fy]['Q1'] ? allData[fy]['Q1'] : null;
        const q2 = allData[fy] && allData[fy]['Q2'] ? allData[fy]['Q2'] : null;
        const q3 = allData[fy] && allData[fy]['Q3'] ? allData[fy]['Q3'] : null;

        if (q1 && q2 && q3 && q1.operatingCF != null && q2.operatingCF != null && q3.operatingCF != null) {
          const q4Data = {};
          const numericKeys = ['operatingCF', 'depreciation', 'stockBasedComp', 'capex', 'investingCF', 'financingCF'];
          for (const key of numericKeys) {
            if (data[key] != null && q1[key] != null && q2[key] != null && q3[key] != null) {
              q4Data[key] = Math.round((data[key] - q1[key] - q2[key] - q3[key]) * 100) / 100;
            }
          }
          // freeCashFlow再計算
          if (q4Data.operatingCF != null && q4Data.capex != null) {
            q4Data.freeCashFlow = Math.round((q4Data.operatingCF + q4Data.capex) * 100) / 100;
          }
          if (!allData[fy]) allData[fy] = {};
          allData[fy][q] = { ...(allData[fy][q] || {}), ...q4Data };
          console.log(`    -> Q4算出完了: ${Object.keys(q4Data).length} 項目 (operatingCF: ${q4Data.operatingCF})`);
        } else {
          console.log(`    -> Q1-Q3データ不足のためQ4算出不可`);
        }
      } else if (isQ1) {
        // Q1の10-Qは単四半期データ → そのまま使用
        if (!allData[fy]) allData[fy] = {};
        allData[fy][q] = { ...(allData[fy][q] || {}), ...data };
        console.log(`    -> Q1単四半期データ: ${Object.keys(data).length} 項目 (operatingCF: ${data.operatingCF})`);
      } else {
        // Q2/Q3の10-Qは累計データ（H1/9M） → 差分で単四半期を算出
        // Q2: 単四半期 = H1累計 - Q1
        // Q3: 単四半期 = 9M累計 - Q1 - Q2
        const prevQuarters = [];
        if (q === 'Q2') {
          if (allData[fy] && allData[fy]['Q1']) prevQuarters.push(allData[fy]['Q1']);
        } else if (q === 'Q3') {
          if (allData[fy] && allData[fy]['Q1']) prevQuarters.push(allData[fy]['Q1']);
          if (allData[fy] && allData[fy]['Q2']) prevQuarters.push(allData[fy]['Q2']);
        }

        if (prevQuarters.length === (q === 'Q2' ? 1 : 2)) {
          const singleQData = {};
          const numericKeys = ['operatingCF', 'depreciation', 'stockBasedComp', 'capex', 'investingCF', 'financingCF'];
          for (const key of numericKeys) {
            if (data[key] != null) {
              let prevSum = 0;
              let allPrevAvailable = true;
              for (const pq of prevQuarters) {
                if (pq[key] != null) {
                  prevSum += pq[key];
                } else {
                  allPrevAvailable = false;
                  break;
                }
              }
              if (allPrevAvailable) {
                singleQData[key] = Math.round((data[key] - prevSum) * 100) / 100;
              }
            }
          }
          // freeCashFlow再計算
          if (singleQData.operatingCF != null && singleQData.capex != null) {
            singleQData.freeCashFlow = Math.round((singleQData.operatingCF + singleQData.capex) * 100) / 100;
          }
          if (!allData[fy]) allData[fy] = {};
          allData[fy][q] = { ...(allData[fy][q] || {}), ...singleQData };
          console.log(`    -> ${q}単四半期データ算出: ${Object.keys(singleQData).length} 項目 (operatingCF: ${singleQData.operatingCF})`);
        } else {
          // 前四半期データが不足 → 累計データをそのまま格納し、注記を付ける
          console.log(`    -> 前四半期データ不足のため累計データ(YTD)として格納`);
          if (!allData[fy]) allData[fy] = {};
          allData[fy][q] = { ...(allData[fy][q] || {}), ...data, _ytd: true };
        }
      }
    }
  }

  // Step 2.5: FY2019以前のデータを除外
  for (const fy of Object.keys(allData)) {
    const year = parseInt(fy.replace('FY', ''));
    if (year < 2020) {
      delete allData[fy];
      console.log(`  ${fy}: DL範囲外のため除外`);
    }
  }

  // Step 3: データ検証・整形
  console.log('\n=== Step 3: データ検証 ===');
  const sortedFYs = Object.keys(allData).sort();
  let totalQuarters = 0;
  let missingCF = 0;

  for (const fy of sortedFYs) {
    const sortedQs = Object.keys(allData[fy]).sort();
    for (const q of sortedQs) {
      totalQuarters++;
      const d = allData[fy][q];

      if (d.operatingCF == null) {
        missingCF++;
        console.warn(`  WARNING ${fy}/${q}: operatingCF なし`);
      }
      if (d.capex == null) {
        console.warn(`  WARNING ${fy}/${q}: capex なし`);
      }
      if (d._ytd) {
        console.warn(`  WARNING ${fy}/${q}: YTD累計データ（単四半期に変換できず）`);
        delete d._ytd; // 出力には含めない
      }

      const keys = Object.keys(d);
      console.log(`  ${fy}/${q}: ${keys.length} 項目 (operatingCF: ${d.operatingCF != null ? d.operatingCF : 'N/A'}, FCF: ${d.freeCashFlow != null ? d.freeCashFlow : 'N/A'})`);
    }
  }

  // Step 4: 出力
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allData, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  console.log(`合計: ${totalQuarters} 四半期 (operatingCF欠落: ${missingCF})`);
}

main();
