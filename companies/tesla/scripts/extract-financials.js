// Tesla press-release.html / 10-Q / 10-K から損益計算書データを抽出するスクリプト
// 出力: financials.json
//
// データソース:
// 1. プレスリリース（テキストデータあり）: FONT/p要素から5四半期分を一括抽出
//    - FY2020 Q1-Q3, FY2023 Q2以降のプレスリリースが対象
// 2. 10-Q/10-K（テキストデータなしの期間）: HTMLテーブルから当期データを抽出
//    - FY2020 Q4 〜 FY2023 Q1が対象
//
// Teslaは暦年FY（FY2025 = カレンダー年2025）

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'financials.json');

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
 * プレスリリースHTMLからStatement of Operationsのテキストブロックを取得
 * 新形式: <FONT> タグ内のテキスト
 * 旧形式: <p> タグ内のテキスト
 */
function findStatementOfOperationsText(html) {
  // HTMLエンティティをデコード
  html = html.replace(/&#8212;/g, '—').replace(/&#8211;/g, '–').replace(/&#160;/g, ' ');

  const $ = cheerio.load(html);
  let resultText = null;

  // 新形式: <FONT>要素を走査
  $('FONT, font').each((i, el) => {
    const text = $(el).text();
    // Statement of Operationsのスライドを検出: "REVENUES"と"Total revenues"を含む
    if (text.includes('REVENUES') && text.includes('Total revenues') && text.includes('Gross profit')) {
      if (!resultText || text.length > resultText.length) {
        resultText = text;
      }
    }
  });

  // 旧形式: <p>要素を走査
  if (!resultText) {
    $('p').each((i, el) => {
      const text = $(el).text();
      if (text.includes('REVENUES') && text.includes('Total revenues') && text.includes('Gross profit')) {
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
  // テキスト冒頭部分（最初の"REVENUES"の前）からヘッダーを抽出
  const revenuesIdx = text.indexOf('REVENUES');
  const headerSection = revenuesIdx > 0 ? text.substring(0, revenuesIdx) : text.substring(0, 200);
  while ((match = headerRegex.exec(headerSection)) !== null) {
    headers.push(match[0]);
  }
  return headers;
}

/**
 * ラベルの後に続く数値をN個抽出する
 * @param {string} text - 全テキスト
 * @param {RegExp} labelRegex - ラベルの正規表現
 * @param {number} numCols - 抽出する列数
 * @param {number} startPos - 検索開始位置
 * @returns {{ values: number[], endPos: number } | null}
 */
function extractNumbersAfterLabel(text, labelRegex, numCols, startPos = 0) {
  const searchText = text.substring(startPos);
  const labelMatch = searchText.match(labelRegex);
  if (!labelMatch) return null;

  const afterLabel = searchText.substring(labelMatch.index + labelMatch[0].length);
  const numbers = [];

  // 数値トークン: (123,456) or 123,456 or 0.66 or — or –
  // 脚注 (1) (2) (3) (4) は除外（1桁の括弧数字）
  const tokenRegex = /\((\d{2,}[\d,]*(?:\.\d+)?)\)|\((\d)\)|(\d[\d,]*(?:\.\d+)?)|([—–])/g;
  let m;
  let charCount = 0;

  while ((m = tokenRegex.exec(afterLabel)) !== null && numbers.length < numCols) {
    // 次のラベル（大文字英字3文字以上の連続）に到達したか確認
    const gap = afterLabel.substring(charCount, m.index);
    // "NET" "INCOME" "REVENUES" "Total" 等の英単語が出たら停止
    // ただし "S T A T E M E N T" のような空白付きは除外
    if (gap.match(/[A-Z][a-z]{2,}|(?<![A-Z] )[A-Z]{4,}(?! [A-Z])/)) {
      // "YoY" のような短い語は除外
      const word = gap.match(/[A-Z][a-z]{2,}|[A-Z]{4,}/);
      if (word && !['YoY'].includes(word[0])) break;
    }

    if (m[1]) {
      // 括弧付き2桁以上の数値 → 負数
      numbers.push(-parseFloat(m[1].replace(/,/g, '')));
    } else if (m[2]) {
      // 括弧付き1桁 → 脚注マーカー、スキップ
      continue;
    } else if (m[3]) {
      // 通常の数値
      numbers.push(parseFloat(m[3].replace(/,/g, '')));
    } else if (m[4]) {
      // ダッシュ → null
      numbers.push(null);
    }
    charCount = m.index + m[0].length;
  }

  if (numbers.length < numCols) return null;
  return {
    values: numbers.slice(0, numCols),
    endPos: startPos + labelMatch.index + labelMatch[0].length + charCount
  };
}

/**
 * プレスリリーステキストから損益計算書データを抽出
 * @returns {Object} { "Q4-2024": { revenue: 25707, ... }, "Q1-2025": { ... }, ... }
 */
function extractFromPressReleaseText(text, headers) {
  const numCols = headers.length;
  if (numCols === 0) return {};

  // 抽出対象行定義（検索順序が重要）
  // COST OF REVENUES セクションの区切りとして使用
  const costSectionStart = text.search(/COST OF REVENUES/i);
  const opexSectionStart = text.search(/OPERATING EXPENSES/i);
  const belowLineStart = text.search(/INCOME FROM OPERATIONS/i);
  const epsSectionStart = text.search(/Net income per share/i);
  const sharesSectionStart = text.search(/Weighted average shares/i);

  const extractRow = (regex, startPos = 0) => {
    const result = extractNumbersAfterLabel(text, regex, numCols, startPos);
    return result ? result.values : null;
  };

  // Revenue セクション（テキスト先頭からCOST OF REVENUESまで）
  const automotiveSales = extractRow(/Automotive sales/i, 0);
  const regulatoryCredits = extractRow(/Automotive regulatory credits/i, 0);
  const automotiveLeasing = extractRow(/Automotive leasing/i, 0);
  const totalAutoRevenue = extractRow(/Total automotive revenues/i, 0);
  const energyRevenue = extractRow(/Energy generation and storage/i, 0);
  const servicesRevenue = extractRow(/Services and other/i, 0);
  const revenue = extractRow(/Total revenues/i, 0);

  // Cost セクション
  const costOfRevenue = costSectionStart > 0 ? extractRow(/Total cost of revenues/i, costSectionStart) : null;
  const grossProfit = extractRow(/Gross profit/i, costSectionStart > 0 ? costSectionStart : 0);

  // Operating expenses セクション
  const startOpex = opexSectionStart > 0 ? opexSectionStart : (costSectionStart > 0 ? costSectionStart : 0);
  const rd = extractRow(/Research and development/i, startOpex);
  const sga = extractRow(/Selling,? general and administrative/i, startOpex);
  const restructuring = extractRow(/Restructuring and other/i, startOpex);
  const totalOpex = extractRow(/Total operating expenses/i, startOpex);

  // Operating income 以下
  const startBelow = belowLineStart > 0 ? belowLineStart : startOpex;
  const operatingIncome = extractRow(/INCOME FROM OPERATIONS/i, startBelow);
  const interestIncome = extractRow(/Interest income/i, startBelow);
  const interestExpense = extractRow(/Interest expense/i, startBelow);
  const otherIncomeNet = extractRow(/Other income/i, startBelow);
  const incomeBeforeTax = extractRow(/INCOME BEFORE INCOME TAXES/i, startBelow);
  const incomeTaxExpense = extractRow(/Provision for income taxes/i, startBelow);
  const netIncomeTotal = extractRow(/(?:^|\s)NET INCOME(?!\s+(?:ATTR|USED|per))/i, startBelow);
  const netIncome = extractRow(/NET INCOME ATTRIBUTABLE TO COMMON STOCKHOLDERS/i, startBelow);

  // EPS セクション
  let epsBasic = null, epsDiluted = null;
  if (epsSectionStart > 0) {
    epsBasic = extractRow(/Basic/i, epsSectionStart);
    // Dilutedは Basic の後に来る
    const basicMatch = text.substring(epsSectionStart).match(/Basic/i);
    if (basicMatch) {
      const dilutedStart = epsSectionStart + basicMatch.index + basicMatch[0].length;
      epsDiluted = extractRow(/Diluted/i, dilutedStart);
    }
  }

  // 発行済株式数セクション
  let sharesBasic = null, sharesDiluted = null;
  if (sharesSectionStart > 0) {
    sharesBasic = extractRow(/Basic/i, sharesSectionStart);
    const basicMatch = text.substring(sharesSectionStart).match(/Basic/i);
    if (basicMatch) {
      const dilutedStart = sharesSectionStart + basicMatch.index + basicMatch[0].length;
      sharesDiluted = extractRow(/Diluted/i, dilutedStart);
    }
  }

  // 列ごとにオブジェクトを構築
  const result = {};
  for (let i = 0; i < numCols; i++) {
    const q = headers[i];
    const data = {};

    if (revenue && revenue[i] != null) data.revenue = revenue[i];
    if (costOfRevenue && costOfRevenue[i] != null) data.costOfRevenue = costOfRevenue[i];
    if (grossProfit && grossProfit[i] != null) data.grossProfit = grossProfit[i];
    if (rd && rd[i] != null) data.researchAndDevelopment = rd[i];
    if (sga && sga[i] != null) data.sga = sga[i];
    if (restructuring && restructuring[i] != null) data.restructuring = restructuring[i];
    if (totalOpex && totalOpex[i] != null) data.totalOperatingExpenses = totalOpex[i];
    if (operatingIncome && operatingIncome[i] != null) data.operatingIncome = operatingIncome[i];
    if (interestIncome && interestIncome[i] != null) data.interestIncome = interestIncome[i];
    if (interestExpense && interestExpense[i] != null) data.interestExpense = interestExpense[i];
    if (otherIncomeNet && otherIncomeNet[i] != null) data.otherIncomeNet = otherIncomeNet[i];
    if (incomeBeforeTax && incomeBeforeTax[i] != null) data.incomeBeforeTax = incomeBeforeTax[i];
    if (incomeTaxExpense && incomeTaxExpense[i] != null) data.incomeTaxExpense = incomeTaxExpense[i];
    // netIncome: ATTRIBUTABLE TO COMMON STOCKHOLDERS を優先
    if (netIncome && netIncome[i] != null) {
      data.netIncome = netIncome[i];
    } else if (netIncomeTotal && netIncomeTotal[i] != null) {
      data.netIncome = netIncomeTotal[i];
    }
    if (epsBasic && epsBasic[i] != null) data.epsBasic = epsBasic[i];
    if (epsDiluted && epsDiluted[i] != null) data.epsDiluted = epsDiluted[i];
    if (sharesBasic && sharesBasic[i] != null) data.sharesBasic = sharesBasic[i];
    if (sharesDiluted && sharesDiluted[i] != null) data.sharesDiluted = sharesDiluted[i];

    // セグメント売上も含める（後でsegments.jsonからも取れるが冗長に保持）
    if (totalAutoRevenue && totalAutoRevenue[i] != null) data.automotiveRevenue = totalAutoRevenue[i];
    if (energyRevenue && energyRevenue[i] != null) data.energyRevenue = energyRevenue[i];
    if (servicesRevenue && servicesRevenue[i] != null) data.servicesRevenue = servicesRevenue[i];
    if (automotiveSales && automotiveSales[i] != null) data.automotiveSales = automotiveSales[i];
    if (regulatoryCredits && regulatoryCredits[i] != null) data.regulatoryCredits = regulatoryCredits[i];

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
 * 10-Q/10-K HTMLからConsolidated Statements of Operationsテーブルを解析
 * @returns {Object} { revenue: xxx, costOfRevenue: xxx, ... }
 */
function extractFromSecFiling(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html, { decodeEntities: true });

  // "Consolidated Statements of Operations" テーブルを探す
  let targetTable = null;
  $('table').each((i, table) => {
    const tableText = $(table).text();
    if (tableText.includes('Automotive sales') && tableText.includes('Total revenues') && !targetTable) {
      targetTable = table;
    }
  });

  // テーブルが見つからない場合、タイトルで検索
  if (!targetTable) {
    const titleEl = $('p, span, div').filter((i, el) => {
      const t = $(el).text().toLowerCase();
      return t.includes('consolidated statements of operations') || t.includes('statement of operations');
    }).first();

    if (titleEl.length) {
      targetTable = titleEl.closest('table').length ? titleEl.closest('table')[0] : titleEl.nextAll('table').first()[0];
    }
  }

  if (!targetTable) return null;

  const result = {};
  const ROW_MAPPINGS = [
    { patterns: [/^Automotive sales$/i], key: 'automotiveSales' },
    { patterns: [/^Automotive regulatory credits$/i], key: 'regulatoryCredits' },
    { patterns: [/^Total automotive revenues$/i], key: 'automotiveRevenue' },
    { patterns: [/^Energy generation and storage$/i], key: 'energyRevenue', nth: 1 },
    { patterns: [/^Services and other$/i], key: 'servicesRevenue', nth: 1 },
    { patterns: [/^Total revenues$/i], key: 'revenue' },
    { patterns: [/^Total cost of revenues$/i], key: 'costOfRevenue' },
    { patterns: [/^Gross profit$/i], key: 'grossProfit' },
    { patterns: [/^Research and development$/i], key: 'researchAndDevelopment' },
    { patterns: [/^Selling,?\s*general and administrative$/i], key: 'sga' },
    { patterns: [/^Restructuring/i], key: 'restructuring' },
    { patterns: [/^Total operating expenses$/i], key: 'totalOperatingExpenses' },
    { patterns: [/^(?:Income|Loss) from operations$/i, /INCOME FROM OPERATIONS/i], key: 'operatingIncome' },
    { patterns: [/^Interest income$/i], key: 'interestIncome' },
    { patterns: [/^Interest expense$/i], key: 'interestExpense' },
    { patterns: [/^Other income/i], key: 'otherIncomeNet' },
    { patterns: [/^Income before income taxes$/i, /INCOME BEFORE INCOME TAXES/i], key: 'incomeBeforeTax' },
    { patterns: [/^Provision for income taxes$/i], key: 'incomeTaxExpense' },
    { patterns: [/^Net income(?! attr)/i], key: 'netIncomeTotal' },
    { patterns: [/^Net income attributable to common/i, /NET INCOME ATTRIBUTABLE TO COMMON/i], key: 'netIncome' },
  ];

  const seenKeys = {};

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
      const text = $(cell).text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
      // ix:nonFraction タグから直接抽出
      const ixEl = $(cell).find('ix\\:nonFraction, ix\\:nonfraction');
      if (ixEl.length > 0) {
        const val = parseNumber(ixEl.first().text().trim());
        if (val !== null) {
          // sign属性チェック
          const sign = ixEl.first().attr('sign');
          values.push(sign === '-' ? -Math.abs(val) : val);
          return;
        }
      }
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

  // netIncome の優先順位: ATTRIBUTABLE TO COMMON > total
  if (!('netIncome' in result) && 'netIncomeTotal' in result) {
    result.netIncome = result.netIncomeTotal;
  }
  delete result.netIncomeTotal;

  // EPS と株式数は10-Q内の別テーブルにあることが多いため、
  // 主テーブルから取得できなかった場合はスキップ
  return result;
}

/**
 * 10-Q/10-KからEPSと株式数を抽出
 */
function extractEpsFromSecFiling(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html, { decodeEntities: true });
  const result = {};

  // テキスト全体からEPS関連データを検索
  $('table').each((i, table) => {
    const tableText = $(table).text();
    if (!tableText.match(/(?:per share|EPS|earnings per share)/i)) return;
    if (!tableText.match(/[Bb]asic/) || !tableText.match(/[Dd]iluted/)) return;

    let inEpsSection = false;
    let inSharesSection = false;

    $(table).find('tr').each((j, row) => {
      const cells = $(row).find('td');
      let label = '';
      cells.each((k, cell) => {
        const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        if (text && !text.match(/^[\$\d,.()\s—–]+$/) && text !== '$' && !label) {
          label = text;
        }
      });

      const values = [];
      cells.each((k, cell) => {
        const ixEl = $(cell).find('ix\\:nonFraction, ix\\:nonfraction');
        if (ixEl.length > 0) {
          const val = parseNumber(ixEl.first().text().trim());
          if (val !== null) values.push(val);
          return;
        }
        const text = $(cell).text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
        if (text && /[\d]/.test(text) && text !== '$') {
          const val = parseNumber(text);
          if (val !== null) values.push(val);
        }
      });

      if (label.match(/per share/i) || label.match(/earnings/i)) {
        inEpsSection = true;
        inSharesSection = false;
      }
      if (label.match(/Weighted/i) && label.match(/average/i)) {
        inSharesSection = true;
        inEpsSection = false;
      }

      if (values.length === 0) return;

      if (inEpsSection && label.match(/basic/i) && !('epsBasic' in result)) {
        result.epsBasic = values[0];
      }
      if (inEpsSection && label.match(/diluted/i) && !('epsDiluted' in result)) {
        result.epsDiluted = values[0];
      }
      if (inSharesSection && label.match(/basic/i) && !('sharesBasic' in result)) {
        result.sharesBasic = values[0];
      }
      if (inSharesSection && label.match(/diluted/i) && !('sharesDiluted' in result)) {
        result.sharesDiluted = values[0];
      }
    });
  });

  return result;
}

// ============================================================
// メイン処理
// ============================================================

function main() {
  const allData = {}; // { "FY2025": { "Q4": { ... } } }

  // Step 1: 全プレスリリースをスキャンし、テキストデータがあるものから5四半期分を抽出
  console.log('=== Step 1: プレスリリースからデータ抽出 ===');

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  // 古い順にスキャンし、新しいデータで上書き（最新のrestatementを反映）
  const pressReleaseResults = [];
  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const prPath = path.join(fyPath, q, 'press-release.html');
      if (!fs.existsSync(prPath)) continue;

      const html = fs.readFileSync(prPath, 'utf-8');
      const text = findStatementOfOperationsText(html);

      if (!text) {
        console.log(`  ${fy}/${q}: テキストデータなし（イメージ形式）`);
        continue;
      }

      const headers = extractQuarterHeaders(text);
      if (headers.length === 0) {
        console.log(`  ${fy}/${q}: ヘッダー抽出失敗`);
        continue;
      }

      console.log(`  ${fy}/${q}: テキストデータあり → ${headers.join(', ')}`);
      const quarterData = extractFromPressReleaseText(text, headers);

      for (const [qLabel, data] of Object.entries(quarterData)) {
        const fyq = quarterLabelToFYQ(qLabel);
        if (!fyq) continue;
        if (!allData[fyq.fy]) allData[fyq.fy] = {};
        // 新しいプレスリリースのデータで上書き（restatement対応）
        allData[fyq.fy][fyq.q] = { ...(allData[fyq.fy][fyq.q] || {}), ...data };
      }

      pressReleaseResults.push({ fy, q, headers, quarterData });
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
      if (allData[fy] && allData[fy][q] && allData[fy][q].revenue) continue;

      // 10-Q or 10-K ファイルを探す
      const qDir = path.join(fyPath, q);
      const tenQPath = path.join(qDir, '10-Q.htm');
      const tenKPath = path.join(qDir, '10-K.htm');
      const filePath = fs.existsSync(tenQPath) ? tenQPath : (fs.existsSync(tenKPath) ? tenKPath : null);

      if (!filePath) {
        console.log(`  ${fy}/${q}: 10-Q/10-Kファイルなし → スキップ`);
        continue;
      }

      console.log(`  ${fy}/${q}: ${path.basename(filePath)} から抽出中...`);

      const is10K = filePath.endsWith('10-K.htm');
      const data = extractFromSecFiling(filePath);
      if (data && data.revenue) {
        if (is10K) {
          // 10-Kは年間合計データ → Q4 = 年間 - (Q1+Q2+Q3)で計算
          console.log(`    → 10-K年間データ検出 (Revenue: ${data.revenue}) → Q4算出`);
          const q1 = allData[fy] && allData[fy]['Q1'] ? allData[fy]['Q1'] : null;
          const q2 = allData[fy] && allData[fy]['Q2'] ? allData[fy]['Q2'] : null;
          const q3 = allData[fy] && allData[fy]['Q3'] ? allData[fy]['Q3'] : null;

          if (q1 && q2 && q3 && q1.revenue && q2.revenue && q3.revenue) {
            const q4Data = {};
            // 全数値キーについて Q4 = FY - (Q1+Q2+Q3) を計算
            const numericKeys = ['revenue', 'costOfRevenue', 'grossProfit', 'researchAndDevelopment',
              'sga', 'restructuring', 'totalOperatingExpenses', 'operatingIncome',
              'interestIncome', 'interestExpense', 'otherIncomeNet', 'incomeBeforeTax',
              'incomeTaxExpense', 'netIncome', 'automotiveRevenue', 'energyRevenue',
              'servicesRevenue', 'automotiveSales', 'regulatoryCredits'];
            for (const key of numericKeys) {
              if (data[key] != null && q1[key] != null && q2[key] != null && q3[key] != null) {
                q4Data[key] = Math.round((data[key] - q1[key] - q2[key] - q3[key]) * 100) / 100;
              }
            }
            // EPSと株式数は年間合計から算出できないため10-Kから取得しない
            if (!allData[fy]) allData[fy] = {};
            allData[fy][q] = { ...(allData[fy][q] || {}), ...q4Data };
            console.log(`    → Q4算出完了: ${Object.keys(q4Data).length} 項目 (Revenue: ${q4Data.revenue})`);
          } else {
            console.log(`    → Q1-Q3データ不足のためQ4算出不可`);
          }
        } else {
          // 10-Qは四半期データをそのまま使用
          const epsData = extractEpsFromSecFiling(filePath);
          const mergedData = { ...data, ...epsData };

          if (!allData[fy]) allData[fy] = {};
          allData[fy][q] = { ...(allData[fy][q] || {}), ...mergedData };

          const keys = Object.keys(allData[fy][q]);
          console.log(`    → ${keys.length} 項目抽出`);
        }
      } else {
        console.log(`    → 抽出失敗`);
      }
    }
  }

  // Step 2.5: FY2019以前のデータを除外（DL範囲外）
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
  let missingRevenue = 0;

  for (const fy of sortedFYs) {
    const sortedQs = Object.keys(allData[fy]).sort();
    for (const q of sortedQs) {
      totalQuarters++;
      const d = allData[fy][q];
      const keys = Object.keys(d);

      if (!d.revenue) {
        missingRevenue++;
        console.warn(`  ⚠ ${fy}/${q}: Revenue なし`);
      }
      if (!d.netIncome && d.netIncome !== 0) {
        console.warn(`  ⚠ ${fy}/${q}: Net income なし`);
      }
      if (!d.epsDiluted && d.epsDiluted !== 0) {
        console.warn(`  ⚠ ${fy}/${q}: Diluted EPS なし`);
      }

      // grossProfit がない場合は計算
      if (!('grossProfit' in d) && d.revenue != null && d.costOfRevenue != null) {
        d.grossProfit = d.revenue - d.costOfRevenue;
      }

      console.log(`  ${fy}/${q}: ${keys.length} 項目 (Revenue: ${d.revenue || 'N/A'})`);
    }
  }

  // Step 4: 出力
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allData, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  console.log(`合計: ${totalQuarters} 四半期 (Revenue欠落: ${missingRevenue})`);
}

main();
