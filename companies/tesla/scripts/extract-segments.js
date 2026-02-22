// Tesla press-release.html / 10-Q / 10-K から売上セグメントデータを抽出するスクリプト
// 出力: data/segments.json
//
// セグメント:
//   - automotive (Total automotive revenues)
//   - energyGenerationAndStorage (Energy generation and storage)
//   - servicesAndOther (Services and other)
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
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segments.json');

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * テキストから数値をパース
 * "(96)" → -96, "25,707" → 25707, "—" → null
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
 * プレスリリースHTMLからFinancial Summaryのテキストブロックを取得
 * 新形式: <FONT> タグ内のテキスト
 * 旧形式: <p> タグ内のテキスト
 */
function findRevenueText(html) {
  // HTMLエンティティをデコード
  html = html.replace(/&#8212;/g, '—').replace(/&#8211;/g, '–').replace(/&#160;/g, ' ');

  const $ = cheerio.load(html);
  let resultText = null;

  // 新形式: <FONT>要素を走査
  $('FONT, font').each((i, el) => {
    const text = $(el).text();
    // REVENUESとTotal revenuesを含むスライドを検出
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
    if (gap.match(/[A-Z][a-z]{2,}|(?<![A-Z] )[A-Z]{4,}(?! [A-Z])/)) {
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
 * プレスリリーステキストからセグメント売上を抽出
 * COST OF REVENUES セクションの前にある行のみ対象とする
 * @returns {Object} { "Q4-2024": { automotive: 19798, ... }, ... }
 */
function extractSegmentsFromPressReleaseText(text, headers) {
  const numCols = headers.length;
  if (numCols === 0) return {};

  // COST OF REVENUES の開始位置を取得（この前までがREVENUEセクション）
  const costSectionStart = text.search(/COST OF REVENUES/i);

  // REVENUEセクションのテキスト範囲（COST OF REVENUESの前まで）
  const revenueSection = costSectionStart > 0 ? text.substring(0, costSectionStart) : text;

  // セグメント行を抽出
  // "Total automotive revenues" （新形式）または "Total automotive revenue"（旧形式）
  const automotiveResult = extractNumbersAfterLabel(revenueSection, /Total automotive revenue[s]?/i, numCols, 0);
  // "Energy generation and storage" （COST OF REVENUESの前の最初の出現）
  const energyResult = extractNumbersAfterLabel(revenueSection, /Energy generation and storage/i, numCols, 0);
  // "Services and other" （COST OF REVENUESの前の最初の出現）
  const servicesResult = extractNumbersAfterLabel(revenueSection, /Services and other/i, numCols, 0);

  const automotive = automotiveResult ? automotiveResult.values : null;
  const energy = energyResult ? energyResult.values : null;
  const services = servicesResult ? servicesResult.values : null;

  // 列ごとにオブジェクトを構築
  const result = {};
  for (let i = 0; i < numCols; i++) {
    const q = headers[i];
    const data = {};

    if (automotive && automotive[i] != null) data.automotive = automotive[i];
    if (energy && energy[i] != null) data.energyGenerationAndStorage = energy[i];
    if (services && services[i] != null) data.servicesAndOther = services[i];

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
 * 10-Q HTMLからConsolidated Statements of Operationsテーブルを解析し、セグメント売上を抽出
 * "Energy generation and storage" と "Services and other" は
 * Revenue セクションとCost セクションの両方に存在するため、最初の出現のみ取得する
 * @returns {Object} { automotive: xxx, energyGenerationAndStorage: xxx, servicesAndOther: xxx }
 */
function extractSegmentsFromSecFiling(filePath) {
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

  if (!targetTable) return null;

  const result = {};

  // セグメント行マッピング（検索順序＝テーブル行順で最初の出現のみ取得）
  const ROW_MAPPINGS = [
    { patterns: [/^Total automotive revenues?$/i], key: 'automotive' },
    { patterns: [/^Energy generation and storage$/i, /^Energy generation and storage segment revenue$/i], key: 'energyGenerationAndStorage' },
    { patterns: [/^Services and other$/i], key: 'servicesAndOther' },
  ];

  // "Cost of revenues" や "Total cost of revenues" が出たら停止（Revenue セクションのみ対象）
  let passedCostSection = false;

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

    // Cost セクションに入ったら以降はスキップ
    if (/^Cost of revenues$/i.test(label) || /^Total cost of revenues$/i.test(label) || /^Total automotive cost of revenues$/i.test(label)) {
      passedCostSection = true;
      return;
    }
    if (passedCostSection) return;

    // 数値取得（最初の有効な数値列 = 当期データ）
    const values = [];
    cells.each((j, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
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

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 10-K（年間データ）からセグメント売上を抽出
 * 10-Kの場合は年間合計なので、Q4 = 年間 - (Q1+Q2+Q3) で算出する
 * @returns {Object} { automotive: xxx, energyGenerationAndStorage: xxx, servicesAndOther: xxx } (年間合計値)
 */
function extractAnnualSegmentsFromSecFiling(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html, { decodeEntities: true });

  let targetTable = null;
  $('table').each((i, table) => {
    const tableText = $(table).text();
    if (tableText.includes('Automotive sales') && tableText.includes('Total revenues') && !targetTable) {
      targetTable = table;
    }
  });

  if (!targetTable) return null;

  const result = {};

  // 10-Kでは行ラベルが異なる場合がある:
  // "Energy generation and storage segment revenue" (10-K)
  // "Services and other" → "Total automotive & services and other segment revenue" の前に出る
  const ROW_MAPPINGS = [
    { patterns: [/^Total automotive revenues?$/i], key: 'automotive' },
    { patterns: [/^Energy generation and storage(?:\s+segment\s+revenue)?$/i], key: 'energyGenerationAndStorage' },
    { patterns: [/^Services and other$/i], key: 'servicesAndOther' },
  ];

  // Revenue セクションのみ対象（Cost セクションの前で停止）
  let passedCostSection = false;

  $(targetTable).find('tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    let label = '';
    cells.each((j, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.()\s—–\u2014\u2013%]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
    if (!label) return;

    if (/^Cost of revenues$/i.test(label) || /^Total cost of revenues$/i.test(label)) {
      passedCostSection = true;
      return;
    }
    if (passedCostSection) return;

    // 数値取得（最初の有効な数値 = 当期年間データ）
    const values = [];
    cells.each((j, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
      const ixEl = $(cell).find('ix\\:nonFraction, ix\\:nonfraction');
      if (ixEl.length > 0) {
        const val = parseNumber(ixEl.first().text().trim());
        if (val !== null) {
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

    for (const mapping of ROW_MAPPINGS) {
      if (mapping.patterns.some(p => p.test(label))) {
        if (!(mapping.key in result)) {
          result[mapping.key] = firstValue;
        }
        break;
      }
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

// ============================================================
// メイン処理
// ============================================================

function main() {
  const allData = {}; // { "FY2025": { "Q4": { automotive: ..., ... } } }

  // Step 1: 全プレスリリースをスキャンし、テキストデータがあるものから5四半期分を抽出
  console.log('=== Step 1: プレスリリースからセグメント売上抽出 ===');

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
      const text = findRevenueText(html);

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
      const segmentData = extractSegmentsFromPressReleaseText(text, headers);

      for (const [qLabel, data] of Object.entries(segmentData)) {
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
      if (allData[fy] && allData[fy][q] && allData[fy][q].automotive) continue;

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

      if (is10K) {
        // 10-Kは年間合計データ → Q4 = 年間 - (Q1+Q2+Q3)で計算
        const annualData = extractAnnualSegmentsFromSecFiling(filePath);
        if (annualData) {
          console.log(`    → 10-K年間データ検出 (automotive: ${annualData.automotive}) → Q4算出`);
          const q1 = allData[fy] && allData[fy]['Q1'] ? allData[fy]['Q1'] : null;
          const q2 = allData[fy] && allData[fy]['Q2'] ? allData[fy]['Q2'] : null;
          const q3 = allData[fy] && allData[fy]['Q3'] ? allData[fy]['Q3'] : null;

          if (q1 && q2 && q3 && q1.automotive && q2.automotive && q3.automotive) {
            const q4Data = {};
            const segmentKeys = ['automotive', 'energyGenerationAndStorage', 'servicesAndOther'];
            for (const key of segmentKeys) {
              if (annualData[key] != null && q1[key] != null && q2[key] != null && q3[key] != null) {
                q4Data[key] = Math.round((annualData[key] - q1[key] - q2[key] - q3[key]) * 100) / 100;
              }
            }
            if (!allData[fy]) allData[fy] = {};
            allData[fy][q] = { ...(allData[fy][q] || {}), ...q4Data };
            console.log(`    → Q4算出完了: automotive=${q4Data.automotive}, energy=${q4Data.energyGenerationAndStorage}, services=${q4Data.servicesAndOther}`);
          } else {
            console.log(`    → Q1-Q3データ不足のためQ4算出不可`);
          }
        } else {
          console.log(`    → 抽出失敗`);
        }
      } else {
        // 10-Qは四半期データをそのまま使用
        const data = extractSegmentsFromSecFiling(filePath);
        if (data) {
          if (!allData[fy]) allData[fy] = {};
          allData[fy][q] = { ...(allData[fy][q] || {}), ...data };
          console.log(`    → automotive=${data.automotive}, energy=${data.energyGenerationAndStorage}, services=${data.servicesAndOther}`);
        } else {
          console.log(`    → 抽出失敗`);
        }
      }
    }
  }

  // Step 3: FY2019以前のデータを除外（DL範囲外）
  for (const fy of Object.keys(allData)) {
    const year = parseInt(fy.replace('FY', ''));
    if (year < 2020) {
      delete allData[fy];
      console.log(`  ${fy}: DL範囲外のため除外`);
    }
  }

  // Step 4: データ検証
  console.log('\n=== Step 3: データ検証 ===');
  const sortedFYs = Object.keys(allData).sort();
  let totalQuarters = 0;
  let missingSegments = 0;

  for (const fy of sortedFYs) {
    const sortedQs = Object.keys(allData[fy]).sort();
    for (const q of sortedQs) {
      totalQuarters++;
      const d = allData[fy][q];

      if (!d.automotive) {
        missingSegments++;
        console.warn(`  ⚠ ${fy}/${q}: automotive なし`);
      }
      if (!d.energyGenerationAndStorage && d.energyGenerationAndStorage !== 0) {
        console.warn(`  ⚠ ${fy}/${q}: energyGenerationAndStorage なし`);
      }
      if (!d.servicesAndOther && d.servicesAndOther !== 0) {
        console.warn(`  ⚠ ${fy}/${q}: servicesAndOther なし`);
      }

      // 合計チェック（参考値）
      const sum = (d.automotive || 0) + (d.energyGenerationAndStorage || 0) + (d.servicesAndOther || 0);
      console.log(`  ${fy}/${q}: auto=${d.automotive || 'N/A'}, energy=${d.energyGenerationAndStorage || 'N/A'}, services=${d.servicesAndOther || 'N/A'} (合計=${sum})`);
    }
  }

  // Step 5: 出力
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allData, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  console.log(`合計: ${totalQuarters} 四半期 (セグメント欠落: ${missingSegments})`);
}

main();
