// Tesla press-release.html / 10-Q / 10-K からセグメント別粗利データを抽出するスクリプト
// 出力: data/segment-profit.json
//
// セグメント:
//   - Automotive: Total automotive revenues - Total automotive cost of revenues
//   - Energy: Energy generation and storage (revenue) - Energy generation and storage (cost)
//   - Services: Services and other (revenue) - Services and other (cost)
//
// データソース:
//   1. プレスリリース（テキストデータあり）: FONT/p要素から5四半期分を一括抽出
//   2. 10-Q（テキストデータなしの期間）: HTMLテーブルから当期データを抽出
//   3. 10-K（Q4がプレスリリースにない場合）: 年間データからQ4 = FY - (Q1+Q2+Q3) で算出
//
// Teslaは暦年FY（FY2025 = カレンダー年2025）

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segment-profit.json');

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
 * プレスリリーステキストからセグメント別粗利データを抽出
 * COST OF REVENUES の位置で収益セクションとコストセクションを区別する
 */
function extractSegmentFromPressReleaseText(text, headers) {
  const numCols = headers.length;
  if (numCols === 0) return {};

  // COST OF REVENUES セクションの開始位置
  const costSectionStart = text.search(/COST OF REVENUES/i);

  const extractRow = (regex, startPos = 0) => {
    const result = extractNumbersAfterLabel(text, regex, numCols, startPos);
    return result ? result.values : null;
  };

  // === 収益セクション（テキスト先頭〜COST OF REVENUESまで） ===
  // "Total automotive revenue(s)" のラベルが新旧形式で異なる
  const totalAutoRevenue = extractRow(/Total automotive revenue[s]?/i, 0);
  // "Energy generation and storage" - 1回目の出現（収益セクション）
  const energyRevenue = extractRow(/Energy generation and storage/i, 0);
  // "Services and other" - 1回目の出現（収益セクション）
  const servicesRevenue = extractRow(/Services and other/i, 0);

  // === コストセクション（COST OF REVENUES以降） ===
  if (costSectionStart < 0) {
    console.warn('    COST OF REVENUES セクションが見つかりません');
    return {};
  }

  // "Total automotive cost of revenues"
  const totalAutoCost = extractRow(/Total automotive cost of revenues/i, costSectionStart);
  // "Energy generation and storage" - 2回目の出現（コストセクション）
  const energyCost = extractRow(/Energy generation and storage/i, costSectionStart);
  // "Services and other" - 2回目の出現（コストセクション）
  const servicesCost = extractRow(/Services and other/i, costSectionStart);
  // "Gross profit" - クロスチェック用
  const grossProfit = extractRow(/Gross profit/i, costSectionStart);

  // 列ごとにオブジェクトを構築
  const result = {};
  for (let i = 0; i < numCols; i++) {
    const q = headers[i];
    const data = {};

    // Automotive
    if (totalAutoRevenue && totalAutoRevenue[i] != null) data.automotiveRevenue = totalAutoRevenue[i];
    if (totalAutoCost && totalAutoCost[i] != null) data.automotiveCost = totalAutoCost[i];
    if (data.automotiveRevenue != null && data.automotiveCost != null) {
      data.automotiveGrossProfit = Math.round((data.automotiveRevenue - data.automotiveCost) * 100) / 100;
    }

    // Energy
    if (energyRevenue && energyRevenue[i] != null) data.energyRevenue = energyRevenue[i];
    if (energyCost && energyCost[i] != null) data.energyCost = energyCost[i];
    if (data.energyRevenue != null && data.energyCost != null) {
      data.energyGrossProfit = Math.round((data.energyRevenue - data.energyCost) * 100) / 100;
    }

    // Services
    if (servicesRevenue && servicesRevenue[i] != null) data.servicesRevenue = servicesRevenue[i];
    if (servicesCost && servicesCost[i] != null) data.servicesCost = servicesCost[i];
    if (data.servicesRevenue != null && data.servicesCost != null) {
      data.servicesGrossProfit = Math.round((data.servicesRevenue - data.servicesCost) * 100) / 100;
    }

    // Total Gross Profit（クロスチェック用）
    if (grossProfit && grossProfit[i] != null) data.totalGrossProfit = grossProfit[i];

    if (Object.keys(data).length > 0) {
      result[q] = data;
    }
  }

  return result;
}

// ============================================================
// 10-Q テーブル解析（フォールバック）
// ============================================================

/**
 * 10-Q HTMLからセグメント別収益・コストを抽出
 * テーブル内で同じラベル（"Automotive sales" "Energy generation and storage" "Services and other"）が
 * 収益セクションとコストセクションで2回出現するため、セクション位置を追跡して区別する
 */
function extractSegmentFrom10Q(filePath) {
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
  // セクション追跡: "Cost of revenues" ヘッダー行の後はコストセクション
  let inCostSection = false;

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

    // "Cost of revenues" セクションヘッダーの検出
    if (/^Cost of revenues$/i.test(label)) {
      inCostSection = true;
      return;
    }
    // "Gross profit" に到達したらコストセクション終了
    if (/^Gross profit$/i.test(label)) {
      inCostSection = false;
    }

    // 数値取得（最初の有効な数値列 = 当期データ）
    const values = [];
    cells.each((j, cell) => {
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

    // セクション位置に応じてマッピング
    if (!inCostSection) {
      // 収益セクション
      if (/^Total automotive revenues?$/i.test(label) && !('automotiveRevenue' in result)) {
        result.automotiveRevenue = firstValue;
      } else if (/^Energy generation and storage$/i.test(label) && !('energyRevenue' in result)) {
        result.energyRevenue = firstValue;
      } else if (/^Services and other$/i.test(label) && !('servicesRevenue' in result)) {
        result.servicesRevenue = firstValue;
      }
    } else {
      // コストセクション
      if (/^Total automotive cost of revenues$/i.test(label) && !('automotiveCost' in result)) {
        result.automotiveCost = firstValue;
      } else if (/^Energy generation and storage$/i.test(label) && !('energyCost' in result)) {
        result.energyCost = firstValue;
      } else if (/^Services and other$/i.test(label) && !('servicesCost' in result)) {
        result.servicesCost = firstValue;
      }
    }

    // Gross profit（クロスチェック用）
    if (/^Gross profit$/i.test(label) && !('totalGrossProfit' in result)) {
      result.totalGrossProfit = firstValue;
    }
  });

  // 粗利を計算
  if (result.automotiveRevenue != null && result.automotiveCost != null) {
    result.automotiveGrossProfit = Math.round((result.automotiveRevenue - result.automotiveCost) * 100) / 100;
  }
  if (result.energyRevenue != null && result.energyCost != null) {
    result.energyGrossProfit = Math.round((result.energyRevenue - result.energyCost) * 100) / 100;
  }
  if (result.servicesRevenue != null && result.servicesCost != null) {
    result.servicesGrossProfit = Math.round((result.servicesRevenue - result.servicesCost) * 100) / 100;
  }

  return result;
}

// ============================================================
// 10-K テーブル解析（年間データ → Q4算出用）
// ============================================================

/**
 * 10-K HTMLからセグメント別収益・コストの年間データを抽出
 * 10-Kの損益テーブルは独自フォーマット:
 *   - 収益テーブル: "Total automotive revenues", "Energy generation and storage segment revenue", "Services and other"
 *   - コストテーブル: "Total automotive cost of revenues", "Energy generation and storage segment", "Services and other"
 *   - 粗利行: "Gross profit total automotive", "Gross profit energy generation and storage segment", "Total gross profit"
 */
function extractSegmentFrom10K(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html, { decodeEntities: true });

  // コストセクションを含むテーブルを探す
  let targetTable = null;
  $('table').each((i, table) => {
    const tableText = $(table).text();
    if (tableText.includes('Automotive sales') && tableText.includes('Total cost of revenues') &&
        tableText.includes('Gross profit') && !targetTable) {
      targetTable = table;
    }
  });

  if (!targetTable) return null;

  const result = {};

  $(targetTable).find('tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    // ラベル取得
    let label = '';
    cells.each((j, cell) => {
      const text = $(cell).text().trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !text.match(/^[\$\d,.()\s—–\u2014\u2013%]+$/) && text !== '$' && !label) {
        label = text;
      }
    });
    if (!label) return;

    // 数値取得（最初の有効な数値 = 当期年間データ）
    const values = [];
    cells.each((j, cell) => {
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

    // 10-Kのラベルパターンは10-Qとは異なる
    // コストセクションのラベル
    if (/^Total automotive cost of revenues$/i.test(label) && !('automotiveCost' in result)) {
      result.automotiveCost = firstValue;
    } else if (/^Energy generation and storage segment$/i.test(label) && !('energyCost' in result)) {
      // 注意: 10-Kでは "Energy generation and storage segment" がコスト行のラベル
      result.energyCost = firstValue;
    } else if (/^Services and other$/i.test(label) && !('servicesCost' in result)) {
      // "Services and other" のコスト行（コストテーブル内で出現）
      result.servicesCost = firstValue;
    }

    // 粗利行（10-K独自フォーマット）
    if (/^Gross profit total automotive$/i.test(label) && !('automotiveGrossProfit' in result)) {
      result.automotiveGrossProfit = firstValue;
    } else if (/^Gross profit energy generation and storage segment$/i.test(label) && !('energyGrossProfit' in result)) {
      result.energyGrossProfit = firstValue;
    } else if (/^Total gross profit$/i.test(label) && !('totalGrossProfit' in result)) {
      result.totalGrossProfit = firstValue;
    }
  });

  // 収益テーブルも探す（コストと別テーブルの場合がある）
  let revenueTable = null;
  $('table').each((i, table) => {
    const text = $(table).text();
    if (text.includes('Automotive sales') && text.includes('Total revenues') &&
        !text.includes('cost of revenues') && !text.includes('Cost of revenues') && !revenueTable) {
      revenueTable = table;
    }
  });

  // 収益テーブルが別にある場合
  if (revenueTable) {
    $(revenueTable).find('tr').each((i, row) => {
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

      const values = [];
      cells.each((j, cell) => {
        const text = $(cell).text().trim().replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
        if (text && /[\d]/.test(text) && text !== '$') {
          const val = parseNumber(text);
          if (val !== null) values.push(val);
        }
      });

      if (values.length === 0) return;
      const firstValue = values[0];

      if (/^Total automotive revenues?$/i.test(label) && !('automotiveRevenue' in result)) {
        result.automotiveRevenue = firstValue;
      } else if (/^Energy generation and storage segment revenue$/i.test(label) && !('energyRevenue' in result)) {
        result.energyRevenue = firstValue;
      } else if (/^Services and other$/i.test(label) && !('servicesRevenue' in result)) {
        // 収益テーブル内の "Services and other"
        result.servicesRevenue = firstValue;
      }
    });
  }

  // 収益テーブルが見つからなかった場合、粗利 + コストから収益を逆算
  if (!('automotiveRevenue' in result) && result.automotiveGrossProfit != null && result.automotiveCost != null) {
    result.automotiveRevenue = result.automotiveGrossProfit + result.automotiveCost;
  }
  if (!('energyRevenue' in result) && result.energyGrossProfit != null && result.energyCost != null) {
    result.energyRevenue = result.energyGrossProfit + result.energyCost;
  }
  if (!('servicesRevenue' in result) && result.servicesCost != null && result.totalGrossProfit != null &&
      result.automotiveGrossProfit != null && result.energyGrossProfit != null) {
    // Services gross profit = Total - Auto - Energy
    result.servicesGrossProfit = result.totalGrossProfit - result.automotiveGrossProfit - result.energyGrossProfit;
    result.servicesRevenue = result.servicesGrossProfit + result.servicesCost;
  }

  // 粗利を収益 - コストから計算（10-Kテーブルでは負数が複数セルに分割されて
  // GPの直接パースが不正確になる場合があるため、rev-costを常に優先する）
  if (result.automotiveRevenue != null && result.automotiveCost != null) {
    result.automotiveGrossProfit = Math.round((result.automotiveRevenue - result.automotiveCost) * 100) / 100;
  }
  if (result.energyRevenue != null && result.energyCost != null) {
    result.energyGrossProfit = Math.round((result.energyRevenue - result.energyCost) * 100) / 100;
  }
  if (result.servicesRevenue != null && result.servicesCost != null) {
    result.servicesGrossProfit = Math.round((result.servicesRevenue - result.servicesCost) * 100) / 100;
  }

  return result;
}

// ============================================================
// メイン処理
// ============================================================

function main() {
  const allData = {}; // { "FY2025": { "Q4": { ... } } }

  // Step 1: 全プレスリリースをスキャンし、テキストデータがあるものから5四半期分を抽出
  console.log('=== Step 1: プレスリリースからセグメント別粗利データ抽出 ===');

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
      const quarterData = extractSegmentFromPressReleaseText(text, headers);

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
      if (allData[fy] && allData[fy][q] && allData[fy][q].automotiveRevenue) continue;

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
        const annualData = extractSegmentFrom10K(filePath);
        if (annualData && annualData.totalGrossProfit != null) {
          console.log(`    → 10-K年間データ検出 (Total GP: ${annualData.totalGrossProfit}) → Q4算出`);
          const q1 = allData[fy] && allData[fy]['Q1'] ? allData[fy]['Q1'] : null;
          const q2 = allData[fy] && allData[fy]['Q2'] ? allData[fy]['Q2'] : null;
          const q3 = allData[fy] && allData[fy]['Q3'] ? allData[fy]['Q3'] : null;

          if (q1 && q2 && q3 && q1.automotiveRevenue != null && q2.automotiveRevenue != null && q3.automotiveRevenue != null) {
            const q4Data = {};
            // 全数値キーについて Q4 = FY - (Q1+Q2+Q3) を計算
            const numericKeys = [
              'automotiveRevenue', 'automotiveCost', 'automotiveGrossProfit',
              'energyRevenue', 'energyCost', 'energyGrossProfit',
              'servicesRevenue', 'servicesCost', 'servicesGrossProfit',
              'totalGrossProfit'
            ];
            for (const key of numericKeys) {
              if (annualData[key] != null && q1[key] != null && q2[key] != null && q3[key] != null) {
                q4Data[key] = Math.round((annualData[key] - q1[key] - q2[key] - q3[key]) * 100) / 100;
              }
            }
            if (!allData[fy]) allData[fy] = {};
            allData[fy][q] = { ...(allData[fy][q] || {}), ...q4Data };
            console.log(`    → Q4算出完了: ${Object.keys(q4Data).length} 項目`);
          } else {
            console.log(`    → Q1-Q3データ不足のためQ4算出不可`);
          }
        } else {
          console.log(`    → 抽出失敗`);
        }
      } else {
        // 10-Qは四半期データをそのまま使用
        const data = extractSegmentFrom10Q(filePath);
        if (data && data.automotiveRevenue != null) {
          if (!allData[fy]) allData[fy] = {};
          allData[fy][q] = { ...(allData[fy][q] || {}), ...data };
          console.log(`    → 抽出完了: ${Object.keys(data).length} 項目`);
        } else {
          console.log(`    → 抽出失敗`);
        }
      }
    }
  }

  // Step 2.5: FY2019以前のデータを除外
  for (const fy of Object.keys(allData)) {
    const year = parseInt(fy.replace('FY', ''));
    if (year < 2020) {
      delete allData[fy];
      console.log(`  ${fy}: FY2019以前のため除外`);
    }
  }

  // Step 3: データ検証
  console.log('\n=== Step 3: データ検証 ===');
  const sortedFYs = Object.keys(allData).sort();
  let totalQuarters = 0;
  let warningCount = 0;

  for (const fy of sortedFYs) {
    const sortedQs = Object.keys(allData[fy]).sort();
    for (const q of sortedQs) {
      totalQuarters++;
      const d = allData[fy][q];

      // セグメント別粗利の合計とtotalGrossProfit のクロスチェック
      const segmentSum = (d.automotiveGrossProfit || 0) + (d.energyGrossProfit || 0) + (d.servicesGrossProfit || 0);
      if (d.totalGrossProfit != null) {
        const diff = Math.abs(segmentSum - d.totalGrossProfit);
        if (diff > 1) {
          console.warn(`  ⚠ ${fy}/${q}: セグメント合計(${segmentSum}) ≠ Total GP(${d.totalGrossProfit}) 差分=${diff}`);
          warningCount++;
        }
      }

      // 主要フィールドの欠損チェック
      const missingFields = [];
      if (d.automotiveRevenue == null) missingFields.push('autoRev');
      if (d.automotiveCost == null) missingFields.push('autoCost');
      if (d.energyRevenue == null) missingFields.push('energyRev');
      if (d.energyCost == null) missingFields.push('energyCost');
      if (d.servicesRevenue == null) missingFields.push('svcRev');
      if (d.servicesCost == null) missingFields.push('svcCost');

      if (missingFields.length > 0) {
        console.warn(`  ⚠ ${fy}/${q}: 欠損フィールド: ${missingFields.join(', ')}`);
        warningCount++;
      }

      console.log(`  ${fy}/${q}: Auto GP=${d.automotiveGrossProfit || 'N/A'}, Energy GP=${d.energyGrossProfit || 'N/A'}, Svc GP=${d.servicesGrossProfit || 'N/A'}, Total GP=${d.totalGrossProfit || 'N/A'}`);
    }
  }

  // Step 4: ソート・出力（FY年度順・四半期順に整列）
  const sortedOutput = {};
  for (const fy of sortedFYs) {
    sortedOutput[fy] = {};
    const sortedQs = Object.keys(allData[fy]).sort();
    for (const q of sortedQs) {
      sortedOutput[fy][q] = allData[fy][q];
    }
  }
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sortedOutput, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  console.log(`合計: ${totalQuarters} 四半期 (警告: ${warningCount})`);
}

main();
