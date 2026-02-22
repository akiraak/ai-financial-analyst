// Intel press-release.html からキャッシュフローデータを抽出するスクリプト
// キャッシュフロー計算書テーブルおよび Non-GAAP reconciliation テーブルを解析
//
// 抽出項目:
// - operatingCashFlow: 営業キャッシュフロー
// - capitalExpenditures: 設備投資額
// - investingCashFlow: 投資活動キャッシュフロー
// - financingCashFlow: 財務活動キャッシュフロー
// - freeCashFlow: フリーキャッシュフロー（Non-GAAP reconciliation テーブルから）
//
// Intelのフォーマット変遷:
// ■ FY2020-FY2021: "FREE CASH FLOW" = GAAP Cash from Ops - Additions to PP&E
// ■ FY2022+: "Adjusted free cash flow" = GAAP Cash from Ops - Net additions to PP&E - Finance lease payments + 特殊項目
//
// 出力: cash-flows.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'cash-flows.json');

// CF本体の抽出対象
const CF_ROW_MAPPINGS = [
  { patterns: [
    /^Net cash provided by ?\(?used f?o?r?\)? operating activities$/i,
    /^Net cash provided by operating activities$/i,
  ], key: 'operatingCashFlow' },
  { patterns: [
    /^Net cash provided by ?\(?used f?o?r?\)? investing activities$/i,
    /^Net cash used for investing activities$/i,
    /^Net cash provided by investing activities$/i,
  ], key: 'investingCashFlow' },
  { patterns: [
    /^Net cash provided by ?\(?used f?o?r?\)? financing activities$/i,
    /^Net cash used for financing activities$/i,
    /^Net cash provided by financing activities$/i,
  ], key: 'financingCashFlow' },
  { patterns: [
    /^Additions to property, plant,? and equipment$/i,
  ], key: 'capitalExpenditures' },
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
 * テーブル行から数値を抽出
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
 * HTMLから全テーブルを走査し、キャッシュフロー計算書テーブルを見つける
 */
function findCashFlowTable(html) {
  const $ = cheerio.load(html);
  let found = null;

  $('table').each((i, table) => {
    if (found) return false;
    const text = $(table).text().replace(/\s+/g, ' ').toLowerCase();
    // キャッシュフロー計算書の必須キーワード
    if (text.includes('cash and cash equivalents, beginning of period') &&
        text.includes('operating activities') &&
        text.includes('investing activities')) {
      found = $.html(table);
    }
  });

  return found;
}

/**
 * Non-GAAP reconciliation テーブルから FCF を抽出
 * Intel は "FREE CASH FLOW" (旧) または "Adjusted free cash flow" (新) を使用
 *
 * テーブル識別の優先順位:
 * 1. "(In Millions)" を含み、"GAAP" + "cash" を含み、FCFラベルを含むテーブル
 * 2. "GAAP" + "cash" + FCFラベルを含むテーブル（billions以外）
 *
 * FY2020 Q2-Q3: Full-year guidance（billions）と YTD reconciliation（millions）の両方がある
 *   → "(In Millions)" テーブルを優先する
 */
function extractFCF(html) {
  const $ = cheerio.load(html);
  let fcfMillions = null;   // "(In Millions)" テーブルからの値
  let fcfFallback = null;   // フォールバック値

  $('table').each((ti, table) => {
    if (fcfMillions !== null) return false;
    const text = $(table).text().replace(/\s+/g, ' ');

    // 定義テーブル（Definition列がある）はスキップ
    if (text.includes('Definition') && text.includes('Usefulness')) return;

    // FCFラベルの存在チェック
    const hasFCFLabel = /FREE CASH FLOW|Adjusted free cash flow/i.test(text);
    if (!hasFCFLabel) return;

    // GAAP Cash 関連ラベルの存在チェック
    const hasGAAPCash = /GAAP.*(cash|net cash)/i.test(text);
    if (!hasGAAPCash) return;

    // "(In Millions)" かどうか
    const isMillions = /\(In Millions/i.test(text);
    // "(In Billions)" かどうか
    const isBillions = /\(In Billions/i.test(text);

    // Billions テーブルはスキップ（Millions テーブルがある場合）
    if (isBillions) return;

    $(table).find('tr').each((ri, row) => {
      const label = getRowLabel($, row);
      if (!label) return;

      if (/^FREE CASH FLOW$/i.test(label) || /^Adjusted free cash flow$/i.test(label)) {
        const values = extractValues($, row);
        if (values.length > 0) {
          const val = parseNumber(values[0]);
          if (val !== null) {
            if (isMillions) {
              fcfMillions = val;
              return false;
            } else if (fcfFallback === null) {
              fcfFallback = val;
            }
          }
        }
      }
    });
  });

  return fcfMillions !== null ? fcfMillions : fcfFallback;
}

/**
 * Non-GAAP テーブルから投資CF・財務CFのGAAP値も取得（FCFテーブルに記載されている場合）
 * FY2020旧フォーマットでは "GAAP CASH USED FOR INVESTING ACTIVITIES" 等のラベルで記載
 */
function extractNonGAAPCashFlows(html) {
  const $ = cheerio.load(html);
  const result = {};

  $('table').each((ti, table) => {
    const text = $(table).text().replace(/\s+/g, ' ');
    // FCFテーブル（Non-GAAP reconciliation）を探す
    if (text.includes('GAAP') && (text.includes('free cash flow') || text.includes('FREE CASH FLOW'))) {
      $(table).find('tr').each((ri, row) => {
        const label = getRowLabel($, row);
        if (!label) return;
        const values = extractValues($, row);
        if (values.length === 0) return;
        const val = parseNumber(values[0]);

        if (/GAAP.*(cash|CASH).*(investing|INVESTING)/i.test(label) && !result.investingCashFlow) {
          result.investingCashFlow = val;
        }
        if (/GAAP.*(cash|CASH).*(financing|FINANCING)/i.test(label) && !result.financingCashFlow) {
          result.financingCashFlow = val;
        }
        if (/GAAP.*(cash|CASH).*(operat|OPERAT)/i.test(label) && !result.operatingCashFlow) {
          result.operatingCashFlow = val;
        }
      });
    }
  });

  return result;
}

/**
 * press-release.html からキャッシュフローデータを抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const result = {};

  // CF計算書テーブルを解析
  const tableHtml = findCashFlowTable(html);
  if (tableHtml) {
    const $ = cheerio.load(tableHtml);
    $('tr').each((i, row) => {
      const label = getRowLabel($, row);
      if (!label) return;
      const values = extractValues($, row);
      if (values.length === 0) return;
      const firstValue = parseNumber(values[0]);
      for (const mapping of CF_ROW_MAPPINGS) {
        if (mapping.patterns.some(p => p.test(label))) {
          if (!(mapping.key in result)) {
            result[mapping.key] = firstValue;
          }
          break;
        }
      }
    });
  }

  // Non-GAAP reconciliation テーブルから FCF を抽出
  const fcf = extractFCF(html);
  if (fcf !== null) {
    result.freeCashFlow = fcf;
  }

  // CF計算書が見つからない場合（Q1-Q3で計算書がない場合など）、
  // Non-GAAPテーブルからoperating/investing/financing CFを補完
  const nonGAAPCFs = extractNonGAAPCashFlows(html);
  if (!result.operatingCashFlow && nonGAAPCFs.operatingCashFlow != null) {
    result.operatingCashFlow = nonGAAPCFs.operatingCashFlow;
  }
  if (!result.investingCashFlow && nonGAAPCFs.investingCashFlow != null) {
    result.investingCashFlow = nonGAAPCFs.investingCashFlow;
  }
  if (!result.financingCashFlow && nonGAAPCFs.financingCashFlow != null) {
    result.financingCashFlow = nonGAAPCFs.financingCashFlow;
  }

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const cashFlows = {};

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
      if (!fs.existsSync(prPath)) continue;

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        if (!cashFlows[fy]) cashFlows[fy] = {};
        cashFlows[fy][q] = data;
        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
      }
    }
  }

  // データディレクトリが存在しない場合は作成
  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cashFlows, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(cashFlows)) {
    for (const q of Object.keys(cashFlows[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のCFデータを抽出`);
}

main();
