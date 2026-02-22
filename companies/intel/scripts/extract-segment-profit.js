// 10-Q/10-K HTM からセグメント別損益データを抽出するスクリプト
// 出力: segment-profit.json
//
// Intelのセグメント構造の変遷:
//   Era 1 (FY2020-FY2021): DCG, IOTG, Mobileye, NSG, PSG, CCG, All other
//     - DCG/CCG は Platform/Adjacent のサブ行あり
//     - IOTG/Mobileye は Internet of Things グループのサブセグメント
//   Era 2 (FY2022-FY2023): CCG (Client Computing), DCAI, NEX, AXG, Mobileye, IFS, All other
//     - CCG は Desktop/Notebook/Other のサブ行あり
//   Era 3 (FY2024 Q1-Q3): Intel Products (CCG, DCAI, NEX), Intel Foundry, All other (Altera, Mobileye, Other)
//     - 行形式テーブル（旧来の縦積み）
//   Era 4 (FY2024 Q4 10-K, FY2025): マトリクス形式（セグメントが列）
//     - CCG, DCAI, Total Intel Products, Intel Foundry, All Other, Corporate Unallocated, Intersegment Eliminations
//
// 10-Q (Q1-Q3): "Three Months Ended" データを直接抽出
// 10-K (Q4): 年間データを抽出 → Q4 = Annual - (Q1 + Q2 + Q3) で算出

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segment-profit.json');

/**
 * テキストから数値をパース
 * "(1,234)" → -1234, "57,006" → 57006, "—" → null
 * 括弧が分割されている場合にも対応: "(66" + ")" → -66
 */
function parseNumber(text) {
  if (!text) return null;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned === '—' || cleaned === '-' || cleaned === '\u2014' || cleaned === '\u2013' || cleaned === '') return null;

  let negative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  } else if (cleaned.startsWith('(')) {
    // 閉じ括弧が別セルにある場合
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  }

  cleaned = cleaned.replace(/,/g, '');
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * テーブル行からセルテキストの配列を取得
 * 空セル、$記号のみ、閉じ括弧のみのセルは除外
 */
function getRowCells($, tr) {
  const cells = [];
  $(tr).find('td').each((i, td) => {
    const text = $(td).text().trim().replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
    if (text && text !== '$' && text !== ')') {
      cells.push(text);
    }
  });
  return cells;
}

/**
 * 行がすべて数値（サブトータル行）かどうかを判定
 * 例: ["9,294", "10,723"] や ["29,258", "31,773", "41,081"]
 */
function isAllNumberRow(cells) {
  if (cells.length === 0) return false;
  return cells.every(c => parseNumber(c) !== null);
}

/**
 * サブトータル行（全数値行）から指定インデックスの値を取得
 * @param {string[]} cells - 全て数値のセル配列
 * @param {number} colIdx - 0=最初の数値カラム（当期/最新年）
 */
function getSubtotalValue(cells, colIdx) {
  if (colIdx >= cells.length) return null;
  return parseNumber(cells[colIdx]);
}

/**
 * セグメントテーブルを探す（Era 1/2/3 行形式）
 * "Operating income (loss):" と "Net revenue:" / "Operating segment revenue:" を含むテーブル
 */
function findSegmentTable($) {
  let bestTable = null;
  let bestScore = 0;

  $('table').each((i, table) => {
    const text = $(table).text().replace(/\s+/g, ' ').trim();
    // セグメントテーブルの特徴: revenue と operating income の両方を含む
    if (text.length > 200 && text.length < 5000) {
      let score = 0;
      if (text.includes('Operating income') || text.includes('operating income') || text.includes('operating loss')) score += 2;
      if (text.includes('revenue') || text.includes('Revenue')) score += 2;
      // Era 1 セグメント名
      if (text.includes('Data Center Group') || text.includes('DCG')) score += 1;
      if (text.includes('Client Computing') || text.includes('CCG')) score += 1;
      // Era 2 セグメント名
      if (text.includes('Datacenter and AI') || text.includes('Data Center and AI') || text.includes('DCAI')) score += 1;
      if (text.includes('Network and Edge') || text.includes('NEX')) score += 1;
      // Era 3 セグメント名
      if (text.includes('Intel Products') || text.includes('Intel Foundry')) score += 1;
      if (text.includes('Mobileye') || text.includes('Altera')) score += 1;
      // "Net revenue:" or "Operating segment revenue:" はセグメントテーブルの強い指標
      if (text.includes('Net revenue:') || text.includes('Operating segment revenue:')) score += 3;
      // "Total net revenue" or "Total operating segment revenue" も強い指標
      if (text.includes('Total net revenue') || text.includes('Total operating segment revenue')) score += 2;

      if (score > bestScore) {
        bestScore = score;
        bestTable = $(table);
      }
    }
  });

  return bestScore >= 6 ? bestTable : null;
}

/**
 * マトリクス形式のセグメントテーブルを探す（Era 4: FY2024 Q4 10-K, FY2025）
 * セグメントが列ヘッダーにある形式
 */
function findMatrixSegmentTable($) {
  let result = null;

  $('table').each((i, table) => {
    if (result) return;
    const text = $(table).text().replace(/\s+/g, ' ').trim();
    // マトリクス形式: "Revenue", "Operating income (loss)", "Intel Products" が含まれ、
    // セグメント名がヘッダー行にある
    if (text.length > 150 && text.length < 1500 &&
        (text.includes('Revenue') || text.includes('revenue')) &&
        text.includes('Operating income') &&
        text.includes('Intel Products') &&
        (text.includes('CCG') || text.includes('Total Intel Products')) &&
        text.includes('Intel Foundry') &&
        text.includes('Total Consolidated')) {
      result = $(table);
    }
  });

  return result;
}

/**
 * Era 1テーブルからデータを抽出 (FY2020-FY2021)
 * セグメント: DCG, IOTG, Mobileye, NSG, PSG, CCG, All other
 */
function extractEra1($, table) {
  const rows = table.find('tr');
  let inRevenueSection = false;
  let inIncomeSection = false;
  let currentGroup = null; // 'iot' グループ等

  const data = {};

  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;
    const first = cells[0];

    // セクションヘッダーの検出
    if (/^Net revenue:/i.test(first)) {
      inRevenueSection = true;
      inIncomeSection = false;
      return;
    }
    if (/^Operating income/i.test(first)) {
      inIncomeSection = true;
      inRevenueSection = false;
      return;
    }
    if (/^Total (net revenue|operating)/i.test(first)) {
      inRevenueSection = false;
      inIncomeSection = false;
      return;
    }

    // セグメントグループヘッダー
    if (/^Data Center Group$/i.test(first) && cells.length === 1) {
      currentGroup = 'dcg_header';
      return;
    }
    if (/^Internet of Things$/i.test(first) && cells.length === 1) {
      currentGroup = 'iot_header';
      return;
    }
    if (/^Client Computing Group$/i.test(first) && cells.length === 1) {
      currentGroup = 'ccg_header';
      return;
    }

    // サブトータル行（全数値行）の処理
    if (isAllNumberRow(cells)) {
      const subtotalVal = getSubtotalValue(cells, 0);
      if (inRevenueSection && currentGroup === 'dcg_header' && subtotalVal !== null) {
        if (!data.dcg) data.dcg = {};
        data.dcg.revenue = subtotalVal;
        currentGroup = null;
      } else if (inRevenueSection && currentGroup === 'ccg_header' && subtotalVal !== null) {
        if (!data.ccg) data.ccg = {};
        data.ccg.revenue = subtotalVal;
        currentGroup = null;
      } else if (inRevenueSection && currentGroup === 'iot_header' && subtotalVal !== null) {
        // IoTグループの小計（IOTG + Mobileye）- 個別に取得済みなのでスキップ
        currentGroup = null;
      } else if (inIncomeSection && currentGroup === 'iot_income_header' && subtotalVal !== null) {
        // IoTグループの小計（スキップ）
        currentGroup = null;
      }
      return;
    }

    // 数値行の処理（ラベル + 数値）
    const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
    if (nums.length === 0) return;
    const value = nums[0]; // 最初の数値が当期データ

    if (inRevenueSection) {
      // DCGサブ行（スキップ）
      if (currentGroup === 'dcg_header' && /^(Platform|Adjacent)$/i.test(first)) return;
      // DCG単一行（Platform/Adjacentサブ行がない場合も想定）
      if (/^Data Center Group$/i.test(first) && nums.length >= 1 && cells.length > 1) {
        if (!data.dcg) data.dcg = {};
        data.dcg.revenue = value;
        return;
      }

      // IOTG行
      if (/^IOTG$/i.test(first)) {
        if (!data.iotg) data.iotg = {};
        data.iotg.revenue = value;
        return;
      }
      // Mobileye行
      if (/^Mobileye$/i.test(first)) {
        if (!data.mobileye) data.mobileye = {};
        data.mobileye.revenue = value;
        return;
      }

      // NSG行
      if (/^Non-Volatile Memory/i.test(first)) {
        if (!data.nsg) data.nsg = {};
        data.nsg.revenue = value;
        return;
      }
      // PSG行
      if (/^Programmable Solutions/i.test(first)) {
        if (!data.psg) data.psg = {};
        data.psg.revenue = value;
        return;
      }

      // CCGサブ行（スキップ）
      if (currentGroup === 'ccg_header' && /^(Platform|Adjacent)$/i.test(first)) return;
      // CCG単一行
      if (/^Client Computing Group$/i.test(first) && nums.length >= 1 && cells.length > 1) {
        if (!data.ccg) data.ccg = {};
        data.ccg.revenue = value;
        return;
      }

      // All other行
      if (/^All other$/i.test(first)) {
        if (!data.allOther) data.allOther = {};
        data.allOther.revenue = value;
        return;
      }
    }

    if (inIncomeSection) {
      // DCG
      if (/^Data Center Group$/i.test(first) && nums.length >= 1) {
        if (!data.dcg) data.dcg = {};
        data.dcg.operatingIncome = value;
        currentGroup = null;
        return;
      }

      // IOT グループヘッダー
      if (/^Internet of Things$/i.test(first) && cells.length === 1) {
        currentGroup = 'iot_income_header';
        return;
      }

      // IOTG
      if (/^IOTG$/i.test(first)) {
        if (!data.iotg) data.iotg = {};
        data.iotg.operatingIncome = value;
        return;
      }
      // Mobileye
      if (/^Mobileye$/i.test(first)) {
        if (!data.mobileye) data.mobileye = {};
        data.mobileye.operatingIncome = value;
        return;
      }

      // NSG
      if (/^Non-Volatile Memory/i.test(first)) {
        if (!data.nsg) data.nsg = {};
        data.nsg.operatingIncome = value;
        return;
      }
      // PSG
      if (/^Programmable Solutions/i.test(first)) {
        if (!data.psg) data.psg = {};
        data.psg.operatingIncome = value;
        return;
      }

      // CCG
      if (/^Client Computing Group$/i.test(first) && nums.length >= 1) {
        if (!data.ccg) data.ccg = {};
        data.ccg.operatingIncome = value;
        return;
      }

      // All other
      if (/^All other$/i.test(first)) {
        if (!data.allOther) data.allOther = {};
        data.allOther.operatingIncome = value;
        return;
      }
    }
  });

  return Object.keys(data).length > 0 ? data : null;
}

/**
 * Era 2テーブルからデータを抽出 (FY2022-FY2023)
 * セグメント: CCG (Client Computing), DCAI, NEX, AXG, Mobileye, IFS, All other
 */
function extractEra2($, table) {
  const rows = table.find('tr');
  let inRevenueSection = false;
  let inIncomeSection = false;
  let currentGroup = null;

  const data = {};

  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;
    const first = cells[0];

    // セクションヘッダー
    if (/^(Operating segment revenue|Net revenue):/i.test(first)) {
      inRevenueSection = true;
      inIncomeSection = false;
      return;
    }
    if (/^Operating income/i.test(first) && !/\$/.test(cells[1] || '')) {
      // "Operating income (loss):" ヘッダー（数値がない行）
      if (cells.length === 1 || (cells.length > 1 && parseNumber(cells[1]) === null)) {
        inIncomeSection = true;
        inRevenueSection = false;
        return;
      }
    }
    if (/^Total (net revenue|operating segment revenue|operating income)/i.test(first)) {
      inRevenueSection = false;
      inIncomeSection = false;
      return;
    }

    // サブトータル行（全数値行）の処理
    if (isAllNumberRow(cells)) {
      const subtotalVal = getSubtotalValue(cells, 0);
      if (inRevenueSection && currentGroup === 'ccg_header' && subtotalVal !== null) {
        if (!data.ccg) data.ccg = {};
        data.ccg.revenue = subtotalVal;
        currentGroup = null;
      }
      return;
    }

    const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
    if (nums.length === 0 && cells.length > 1) return;
    const value = nums.length > 0 ? nums[0] : null;

    if (inRevenueSection) {
      // Client Computing グループヘッダー
      if (/^Client Computing$/i.test(first) && cells.length === 1) {
        currentGroup = 'ccg_header';
        return;
      }
      if (currentGroup === 'ccg_header' && /^(Desktop|Notebook|Other)$/i.test(first)) return; // サブ行スキップ

      // DCAI
      if (/^(Datacenter and AI|Data Center and AI)$/i.test(first) && value !== null) {
        if (!data.dcai) data.dcai = {};
        data.dcai.revenue = value;
        return;
      }
      // NEX
      if (/^Network and Edge$/i.test(first) && value !== null) {
        if (!data.nex) data.nex = {};
        data.nex.revenue = value;
        return;
      }
      // AXG
      if (/^Accelerated Computing/i.test(first) && value !== null) {
        if (!data.axg) data.axg = {};
        data.axg.revenue = value;
        return;
      }
      // Mobileye
      if (/^Mobileye$/i.test(first) && value !== null) {
        if (!data.mobileye) data.mobileye = {};
        data.mobileye.revenue = value;
        return;
      }
      // IFS
      if (/^Intel Foundry Services$/i.test(first) && value !== null) {
        if (!data.ifs) data.ifs = {};
        data.ifs.revenue = value;
        return;
      }
      // All other
      if (/^All other$/i.test(first) && value !== null) {
        if (!data.allOther) data.allOther = {};
        data.allOther.revenue = value;
        return;
      }
    }

    if (inIncomeSection) {
      // CCG
      if (/^Client Computing$/i.test(first) && value !== null) {
        if (!data.ccg) data.ccg = {};
        data.ccg.operatingIncome = value;
        return;
      }
      // DCAI
      if (/^(Datacenter and AI|Data Center and AI)$/i.test(first) && value !== null) {
        if (!data.dcai) data.dcai = {};
        data.dcai.operatingIncome = value;
        return;
      }
      // NEX
      if (/^Network and Edge$/i.test(first) && value !== null) {
        if (!data.nex) data.nex = {};
        data.nex.operatingIncome = value;
        return;
      }
      // AXG
      if (/^Accelerated Computing/i.test(first) && value !== null) {
        if (!data.axg) data.axg = {};
        data.axg.operatingIncome = value;
        return;
      }
      // Mobileye
      if (/^Mobileye$/i.test(first) && value !== null) {
        if (!data.mobileye) data.mobileye = {};
        data.mobileye.operatingIncome = value;
        return;
      }
      // IFS
      if (/^Intel Foundry Services$/i.test(first) && value !== null) {
        if (!data.ifs) data.ifs = {};
        data.ifs.operatingIncome = value;
        return;
      }
      // All other
      if (/^All other$/i.test(first) && value !== null) {
        if (!data.allOther) data.allOther = {};
        data.allOther.operatingIncome = value;
        return;
      }
    }
  });

  return Object.keys(data).length > 0 ? data : null;
}

/**
 * Era 3テーブルからデータを抽出 (FY2024 Q1-Q3, 行形式)
 * Intel Products (CCG, DCAI, NEX), Intel Foundry, All other (Altera, Mobileye, Other)
 */
function extractEra3($, table) {
  const rows = table.find('tr');
  let inRevenueSection = false;
  let inIncomeSection = false;
  let currentGroup = null;

  const data = {};

  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;
    const first = cells[0];

    // セクションヘッダー
    if (/^Operating segment revenue:/i.test(first)) {
      inRevenueSection = true;
      inIncomeSection = false;
      return;
    }
    if (/^Segment operating income/i.test(first) && cells.length === 1) {
      inIncomeSection = true;
      inRevenueSection = false;
      return;
    }
    if (/^Total (net revenue|operating segment revenue|segment operating)/i.test(first)) {
      return;
    }
    if (/^(Intersegment eliminations|Corporate unallocated|Total operating income)/i.test(first)) {
      inRevenueSection = false;
      inIncomeSection = false;
      return;
    }

    // サブトータル行（全数値行）の処理
    if (isAllNumberRow(cells)) {
      const subtotalVal = getSubtotalValue(cells, 0);
      if (inRevenueSection && currentGroup === 'ccg_header' && subtotalVal !== null) {
        if (!data.ccg) data.ccg = {};
        data.ccg.revenue = subtotalVal;
        currentGroup = null;
      }
      return;
    }

    const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
    const value = nums.length > 0 ? nums[0] : null;

    if (inRevenueSection) {
      // Intel Products ヘッダー
      if (/^Intel Products:/i.test(first)) return;
      // Client Computing Group ヘッダー（サブ行あり）
      if (/^Client Computing Group$/i.test(first) && cells.length === 1) {
        currentGroup = 'ccg_header';
        return;
      }
      if (currentGroup === 'ccg_header' && /^(Desktop|Notebook|Other)$/i.test(first)) return;
      // DCAI
      if (/^Data Center and AI$/i.test(first) && value !== null) {
        if (!data.dcai) data.dcai = {};
        data.dcai.revenue = value;
        return;
      }
      // NEX
      if (/^Network and Edge$/i.test(first) && value !== null) {
        if (!data.nex) data.nex = {};
        data.nex.revenue = value;
        return;
      }
      // Intel Foundry
      if (/^Intel Foundry$/i.test(first) && value !== null) {
        if (!data.foundry) data.foundry = {};
        data.foundry.revenue = value;
        return;
      }
      // All other ヘッダー
      if (/^All other$/i.test(first) && cells.length === 1) {
        currentGroup = 'allother_header';
        return;
      }
      // Altera
      if (/^Altera$/i.test(first) && value !== null) {
        if (!data.altera) data.altera = {};
        data.altera.revenue = value;
        return;
      }
      // Mobileye
      if (/^Mobileye$/i.test(first) && value !== null) {
        if (!data.mobileye) data.mobileye = {};
        data.mobileye.revenue = value;
        return;
      }
      // Other (All other 配下)
      if (/^Other$/i.test(first) && value !== null && currentGroup === 'allother_header') {
        if (!data.otherSub) data.otherSub = {};
        data.otherSub.revenue = value;
        return;
      }
      // Total all other revenue
      if (/^Total all other revenue$/i.test(first) && value !== null) {
        if (!data.allOther) data.allOther = {};
        data.allOther.revenue = value;
        currentGroup = null;
        return;
      }
    }

    if (inIncomeSection) {
      if (/^Intel Products:/i.test(first)) return;
      if (/^Total Intel Products/i.test(first)) return;
      // CCG
      if (/^Client Computing Group$/i.test(first) && value !== null) {
        if (!data.ccg) data.ccg = {};
        data.ccg.operatingIncome = value;
        return;
      }
      // DCAI
      if (/^Data Center and AI$/i.test(first) && value !== null) {
        if (!data.dcai) data.dcai = {};
        data.dcai.operatingIncome = value;
        return;
      }
      // NEX
      if (/^Network and Edge$/i.test(first) && value !== null) {
        if (!data.nex) data.nex = {};
        data.nex.operatingIncome = value;
        return;
      }
      // Intel Foundry
      if (/^Intel Foundry$/i.test(first) && value !== null) {
        if (!data.foundry) data.foundry = {};
        data.foundry.operatingIncome = value;
        return;
      }
      // All Other ヘッダー
      if (/^All Other$/i.test(first) && cells.length === 1) {
        currentGroup = 'allother_income_header';
        return;
      }
      // Altera
      if (/^Altera$/i.test(first) && value !== null) {
        if (!data.altera) data.altera = {};
        data.altera.operatingIncome = value;
        return;
      }
      // Mobileye
      if (/^Mobileye$/i.test(first) && value !== null) {
        if (!data.mobileye) data.mobileye = {};
        data.mobileye.operatingIncome = value;
        return;
      }
      // Other (All Other 配下)
      if (/^Other$/i.test(first) && value !== null) {
        if (!data.otherSub) data.otherSub = {};
        data.otherSub.operatingIncome = value;
        return;
      }
      // Total all other operating income
      if (/^Total all other operating income/i.test(first) && value !== null) {
        if (!data.allOther) data.allOther = {};
        data.allOther.operatingIncome = value;
        currentGroup = null;
        return;
      }
    }
  });

  return Object.keys(data).length > 0 ? data : null;
}

/**
 * Era 4 マトリクス形式テーブルからデータを抽出 (FY2024 Q4 10-K, FY2025)
 * 列: CCG, DCAI, Total Intel Products, Intel Foundry, All Other, Corporate Unallocated, Intersegment Eliminations, Total Consolidated
 */
function extractMatrix($, table) {
  const rows = table.find('tr');
  // ヘッダー行からカラムマッピングを構築
  let columnMap = {}; // { ccg: colIdx, dcai: colIdx, ... }
  let revenueValues = null;
  let operatingIncomeValues = null;

  // 全行を走査してヘッダーとデータを取得
  rows.each((i, tr) => {
    const rawCells = [];
    $(tr).find('td').each((j, td) => {
      const text = $(td).text().trim().replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
      rawCells.push(text);
    });

    const lineText = rawCells.join(' ');

    // セグメント名ヘッダー行の検出（CCG, DCAI等が含まれる行）
    if (lineText.includes('CCG') && lineText.includes('DCAI') && lineText.includes('Intel Foundry')) {
      // この行のセグメント名の位置をマッピング
      let colIdx = 0;
      rawCells.forEach(cell => {
        const clean = cell.trim();
        if (/^CCG$/i.test(clean)) columnMap.ccg = colIdx;
        if (/^DCAI$/i.test(clean)) columnMap.dcai = colIdx;
        if (/^NEX$/i.test(clean)) columnMap.nex = colIdx;
        if (/^Total Intel Products$/i.test(clean)) columnMap.totalIntelProducts = colIdx;
        if (/^Intel Foundry$/i.test(clean)) columnMap.foundry = colIdx;
        if (/^All Other$/i.test(clean)) columnMap.allOther = colIdx;
        if (/^Corporate Unallocated$/i.test(clean)) columnMap.corporateUnallocated = colIdx;
        if (/^Intersegment Eliminations$/i.test(clean)) columnMap.intersegmentElim = colIdx;
        if (/^Total Consolidated$/i.test(clean)) columnMap.totalConsolidated = colIdx;
        if (clean) colIdx++;
      });
      return;
    }

    // Revenue行
    if (rawCells.length > 0 && /^Revenue$/i.test(rawCells[0].trim())) {
      // $記号を除外し、数値のみ抽出
      revenueValues = rawCells.slice(1).filter(c => c.trim() && c.trim() !== '$').map(c => parseNumber(c));
      return;
    }

    // Operating income (loss)行
    if (rawCells.length > 0 && /^Operating income/i.test(rawCells[0].trim())) {
      operatingIncomeValues = rawCells.slice(1).filter(c => c.trim() && c.trim() !== '$').map(c => parseNumber(c));
      return;
    }
  });

  if (!revenueValues || !operatingIncomeValues) return null;

  // カラムインデックスからデータを構築
  // マトリクス形式ではカラム順序が一定: CCG, DCAI, [NEX], Total Intel Products, Intel Foundry, All Other, ...
  // 数値配列のインデックスとセグメント名を対応付ける
  const data = {};

  // セグメント名リストの順序を検出（ヘッダー行のカラム順）
  const segmentOrder = [];
  const sortedEntries = Object.entries(columnMap).sort((a, b) => a[1] - b[1]);
  sortedEntries.forEach(([key, idx]) => {
    segmentOrder.push(key);
  });

  // マトリクス形式はカラム順に数値が並ぶ
  // カラムマッピングが取得できた場合、順序通りに値を割り当て
  segmentOrder.forEach((seg, idx) => {
    if (idx < revenueValues.length && idx < operatingIncomeValues.length) {
      const rev = revenueValues[idx];
      const oi = operatingIncomeValues[idx];
      if (seg === 'ccg') data.ccg = { revenue: rev, operatingIncome: oi };
      else if (seg === 'dcai') data.dcai = { revenue: rev, operatingIncome: oi };
      else if (seg === 'nex') data.nex = { revenue: rev, operatingIncome: oi };
      else if (seg === 'foundry') data.foundry = { revenue: rev, operatingIncome: oi };
      else if (seg === 'allOther') data.allOther = { revenue: rev, operatingIncome: oi };
      // totalIntelProducts, corporateUnallocated, intersegmentElim, totalConsolidated は集計行なのでスキップ
    }
  });

  return Object.keys(data).length > 0 ? data : null;
}

/**
 * ファイリングの年代（Era）を判定
 */
function detectEra(fy, q) {
  const year = parseInt(fy.replace('FY', ''), 10);
  if (year <= 2021) return 1;
  if (year <= 2023) return 2;
  if (year === 2024 && q !== 'Q4') return 3;
  return 4; // FY2024 Q4 10-K以降
}

/**
 * 10-Kの年間データから3年分を抽出する（Era 1: FY2020, FY2021の10-K）
 * Years Ended テーブルには当年・前年・前々年のデータが含まれる
 */
function extractMultiYearAnnualData($, table, era) {
  const rows = table.find('tr');
  let years = [];

  // ヘッダーから年の情報を取得
  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length >= 2) {
      const datePattern = /(?:Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov)\s+\d+,\s+(\d{4})/g;
      const fullText = cells.join(' ');
      let match;
      while ((match = datePattern.exec(fullText)) !== null) {
        const y = parseInt(match[1], 10);
        if (!years.includes(y)) years.push(y);
      }
    }
  });

  // 各年のデータを抽出
  const results = {};
  for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
    const year = years[yearIdx];
    const fy = `FY${year}`;

    if (era === 1) {
      const data = extractEra1Annual($, table, yearIdx);
      if (data) results[fy] = data;
    } else if (era === 2) {
      const data = extractEra2Annual($, table, yearIdx);
      if (data) results[fy] = data;
    }
  }

  return results;
}

/**
 * Era 1 テーブルから指定カラムのデータを抽出（10-K用）
 * @param {number} colIdx - 0=最新年, 1=前年, 2=前々年
 */
function extractEra1Annual($, table, colIdx) {
  const rows = table.find('tr');
  let inRevenueSection = false;
  let inIncomeSection = false;
  let currentGroup = null;
  const data = {};

  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;
    const first = cells[0];

    if (/^Net revenue:/i.test(first)) { inRevenueSection = true; inIncomeSection = false; return; }
    if (/^Operating income/i.test(first) && cells.length === 1) { inIncomeSection = true; inRevenueSection = false; return; }
    if (/^Total (net revenue|operating)/i.test(first)) { inRevenueSection = false; inIncomeSection = false; return; }

    if (/^Data Center Group$/i.test(first) && cells.length === 1) { currentGroup = 'dcg_header'; return; }
    if (/^Internet of Things$/i.test(first) && cells.length === 1) { currentGroup = 'iot_header'; return; }
    if (/^Client Computing Group$/i.test(first) && cells.length === 1) { currentGroup = 'ccg_header'; return; }

    // サブトータル行（全数値行）の処理
    if (isAllNumberRow(cells)) {
      const subtotalVal = getSubtotalValue(cells, colIdx);
      if (inRevenueSection && currentGroup === 'dcg_header' && subtotalVal !== null) {
        if (!data.dcg) data.dcg = {};
        data.dcg.revenue = subtotalVal;
        currentGroup = null;
      } else if (inRevenueSection && currentGroup === 'ccg_header' && subtotalVal !== null) {
        if (!data.ccg) data.ccg = {};
        data.ccg.revenue = subtotalVal;
        currentGroup = null;
      } else if (inRevenueSection && currentGroup === 'iot_header' && subtotalVal !== null) {
        currentGroup = null; // IoT小計はスキップ
      } else if (inIncomeSection && currentGroup === 'iot_income_header' && subtotalVal !== null) {
        currentGroup = null; // IoT OI小計はスキップ
      }
      return;
    }

    // ラベル＋数値行の処理
    const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
    const value = nums.length > colIdx ? nums[colIdx] : null;

    if (inRevenueSection) {
      if (currentGroup === 'dcg_header' && /^(Platform|Adjacent)$/i.test(first)) return;
      if (currentGroup === 'ccg_header' && /^(Platform|Adjacent)$/i.test(first)) return;
      if (value === null) return;
      if (/^IOTG$/i.test(first)) { if (!data.iotg) data.iotg = {}; data.iotg.revenue = value; return; }
      if (/^Mobileye$/i.test(first)) { if (!data.mobileye) data.mobileye = {}; data.mobileye.revenue = value; return; }
      if (/^Non-Volatile Memory/i.test(first)) { if (!data.nsg) data.nsg = {}; data.nsg.revenue = value; return; }
      if (/^Programmable Solutions/i.test(first)) { if (!data.psg) data.psg = {}; data.psg.revenue = value; return; }
      if (/^All other$/i.test(first)) { if (!data.allOther) data.allOther = {}; data.allOther.revenue = value; return; }
    }

    if (inIncomeSection) {
      // グループヘッダー（数値なし）
      if (/^Internet of Things$/i.test(first) && cells.length === 1) { currentGroup = 'iot_income_header'; return; }
      if (value === null) return;
      if (/^Data Center Group$/i.test(first)) { if (!data.dcg) data.dcg = {}; data.dcg.operatingIncome = value; return; }
      if (/^IOTG$/i.test(first)) { if (!data.iotg) data.iotg = {}; data.iotg.operatingIncome = value; return; }
      if (/^Mobileye$/i.test(first)) { if (!data.mobileye) data.mobileye = {}; data.mobileye.operatingIncome = value; return; }
      if (/^Non-Volatile Memory/i.test(first)) { if (!data.nsg) data.nsg = {}; data.nsg.operatingIncome = value; return; }
      if (/^Programmable Solutions/i.test(first)) { if (!data.psg) data.psg = {}; data.psg.operatingIncome = value; return; }
      if (/^Client Computing Group$/i.test(first)) { if (!data.ccg) data.ccg = {}; data.ccg.operatingIncome = value; return; }
      if (/^All other$/i.test(first)) { if (!data.allOther) data.allOther = {}; data.allOther.operatingIncome = value; return; }
    }
  });

  return Object.keys(data).length > 0 ? data : null;
}

/**
 * Era 2 テーブルから指定カラムのデータを抽出（10-K用）
 */
function extractEra2Annual($, table, colIdx) {
  const rows = table.find('tr');
  let inRevenueSection = false;
  let inIncomeSection = false;
  let currentGroup = null;
  const data = {};

  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length === 0) return;
    const first = cells[0];

    if (/^(Operating segment revenue|Net revenue):/i.test(first)) { inRevenueSection = true; inIncomeSection = false; return; }
    if (/^Operating income/i.test(first) && (cells.length === 1 || parseNumber(cells[1]) === null)) {
      inIncomeSection = true; inRevenueSection = false; return;
    }
    if (/^Total (net revenue|operating segment revenue|operating income)/i.test(first)) { inRevenueSection = false; inIncomeSection = false; return; }

    // サブトータル行（全数値行）の処理
    if (isAllNumberRow(cells)) {
      const subtotalVal = getSubtotalValue(cells, colIdx);
      if (inRevenueSection && currentGroup === 'ccg_header' && subtotalVal !== null) {
        if (!data.ccg) data.ccg = {};
        data.ccg.revenue = subtotalVal;
        currentGroup = null;
      }
      return;
    }

    // ラベル＋数値行の処理
    const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
    const value = nums.length > colIdx ? nums[colIdx] : null;

    if (inRevenueSection) {
      if (/^Client Computing$/i.test(first) && cells.length === 1) { currentGroup = 'ccg_header'; return; }
      if (currentGroup === 'ccg_header' && /^(Desktop|Notebook|Other)$/i.test(first)) return;
      if (value === null) return; // 数値がない行はスキップ
      if (/^(Datacenter and AI|Data Center and AI)$/i.test(first)) { if (!data.dcai) data.dcai = {}; data.dcai.revenue = value; return; }
      if (/^Network and Edge$/i.test(first)) { if (!data.nex) data.nex = {}; data.nex.revenue = value; return; }
      if (/^Accelerated Computing/i.test(first)) { if (!data.axg) data.axg = {}; data.axg.revenue = value; return; }
      if (/^Mobileye$/i.test(first)) { if (!data.mobileye) data.mobileye = {}; data.mobileye.revenue = value; return; }
      if (/^Intel Foundry Services$/i.test(first)) { if (!data.ifs) data.ifs = {}; data.ifs.revenue = value; return; }
      if (/^All other$/i.test(first)) { if (!data.allOther) data.allOther = {}; data.allOther.revenue = value; return; }
    }

    if (inIncomeSection) {
      if (value === null) return; // 数値がない行はスキップ
      if (/^Client Computing$/i.test(first)) { if (!data.ccg) data.ccg = {}; data.ccg.operatingIncome = value; return; }
      if (/^(Datacenter and AI|Data Center and AI)$/i.test(first)) { if (!data.dcai) data.dcai = {}; data.dcai.operatingIncome = value; return; }
      if (/^Network and Edge$/i.test(first)) { if (!data.nex) data.nex = {}; data.nex.operatingIncome = value; return; }
      if (/^Accelerated Computing/i.test(first)) { if (!data.axg) data.axg = {}; data.axg.operatingIncome = value; return; }
      if (/^Mobileye$/i.test(first)) { if (!data.mobileye) data.mobileye = {}; data.mobileye.operatingIncome = value; return; }
      if (/^Intel Foundry Services$/i.test(first)) { if (!data.ifs) data.ifs = {}; data.ifs.operatingIncome = value; return; }
      if (/^All other$/i.test(first)) { if (!data.allOther) data.allOther = {}; data.allOther.operatingIncome = value; return; }
    }
  });


  return Object.keys(data).length > 0 ? data : null;
}

/**
 * セグメントデータの差分を計算（Q4 = Annual - Q1 - Q2 - Q3）
 * @param {object} annual - 年間データ
 * @param {object[]} quarters - [Q1, Q2, Q3] データ
 */
function computeQ4(annual, quarters) {
  const q4 = {};
  for (const seg of Object.keys(annual)) {
    q4[seg] = {};
    for (const metric of Object.keys(annual[seg])) {
      let sum = 0;
      let allHaveMetric = true;
      for (const qData of quarters) {
        if (qData && qData[seg] && qData[seg][metric] !== undefined && qData[seg][metric] !== null) {
          sum += qData[seg][metric];
        } else {
          allHaveMetric = false;
        }
      }
      if (allHaveMetric && annual[seg][metric] !== null && annual[seg][metric] !== undefined) {
        q4[seg][metric] = annual[seg][metric] - sum;
      }
    }
    // 空のセグメントを除去
    if (Object.keys(q4[seg]).length === 0) delete q4[seg];
  }
  return Object.keys(q4).length > 0 ? q4 : null;
}

/**
 * FY2022 Q4 10-KはFY2020-FY2021のデータをリステートした形式で含む
 * 旧セグメント(Era 1)のデータが新セグメント(Era 2)に組み替えられている
 * このデータを利用してFY2020, FY2021の Era 2 相当データも取得可能
 */
function extractEra2RestatementData($, table) {
  const results = {};
  const rows = table.find('tr');

  // ヘッダーから年を取得
  let years = [];
  rows.each((i, tr) => {
    const cells = getRowCells($, tr);
    if (cells.length >= 2) {
      const datePattern = /(?:Dec|Jan)\s+\d+,\s+(\d{4})/g;
      const fullText = cells.join(' ');
      let match;
      while ((match = datePattern.exec(fullText)) !== null) {
        const y = parseInt(match[1], 10);
        if (!years.includes(y)) years.push(y);
      }
    }
  });

  // 2番目以降の年のデータ（リステートデータ）
  for (let yearIdx = 1; yearIdx < years.length; yearIdx++) {
    const year = years[yearIdx];
    const fy = `FY${year}`;
    const data = extractEra2Annual($, table, yearIdx);
    if (data) results[fy] = data;
  }

  return results;
}

// メイン処理
function main() {
  const result = {};
  const annualData = {}; // 10-K年間データ（Q4算出用）

  // FY*/Q* ディレクトリを走査
  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory())
    .sort();

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory())
      .sort();

    for (const q of qDirs) {
      const qPath = path.join(fyPath, q);
      const isQ4 = q === 'Q4';
      const htmName = isQ4 ? '10-K.htm' : '10-Q.htm';
      const htmPath = path.join(qPath, htmName);

      if (!fs.existsSync(htmPath)) {
        console.warn(`  スキップ: ${fy}/${q} - ${htmName} が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q} (${htmName})`);

      const html = fs.readFileSync(htmPath, 'utf-8');
      const $ = cheerio.load(html);
      const era = detectEra(fy, q);

      if (era === 4) {
        // マトリクス形式（FY2024 Q4 10-K, FY2025）
        const matrixTable = findMatrixSegmentTable($);
        if (!matrixTable) {
          console.warn(`  スキップ: マトリクステーブルが見つかりません`);
          continue;
        }

        if (isQ4) {
          // 10-K: 年間データ。複数年分のテーブルがある
          // 当年度テーブル（最初のマッチ）から年間データを取得
          const annual = extractMatrix($, matrixTable);
          if (annual) {
            annualData[fy] = annual;
            const segs = Object.keys(annual);
            console.log(`  → 年間データ(マトリクス): セグメント ${segs.join(', ')}`);
            for (const s of segs) {
              console.log(`    ${s}: Rev=$${annual[s].revenue}M OI=$${annual[s].operatingIncome}M`);
            }
          } else {
            console.warn(`  ⚠ マトリクス年間データが見つかりません`);
          }
        } else {
          // 10-Q: 当四半期データ
          const quarterly = extractMatrix($, matrixTable);
          if (quarterly) {
            if (!result[fy]) result[fy] = {};
            result[fy][q] = quarterly;
            const segs = Object.keys(quarterly);
            console.log(`  → セグメント ${segs.join(', ')}`);
            for (const s of segs) {
              console.log(`    ${s}: Rev=$${quarterly[s].revenue}M OI=$${quarterly[s].operatingIncome}M`);
            }
          } else {
            console.warn(`  ⚠ マトリクス四半期データが見つかりません`);
          }
        }
      } else {
        // 行形式テーブル（Era 1, 2, 3）
        const table = findSegmentTable($);
        if (!table) {
          console.warn(`  スキップ: セグメントテーブルが見つかりません`);
          continue;
        }

        if (isQ4) {
          // 10-K: 年間データ
          let annual = null;
          if (era === 1) {
            annual = extractEra1Annual($, table, 0);
          } else if (era === 2) {
            annual = extractEra2Annual($, table, 0);
          }

          if (annual) {
            annualData[fy] = annual;
            const segs = Object.keys(annual);
            console.log(`  → 年間: セグメント ${segs.join(', ')}`);
            for (const s of segs) {
              console.log(`    ${s}: Rev=$${annual[s].revenue}M OI=$${annual[s].operatingIncome}M`);
            }

            // FY2022 Q4 10-K にはFY2020, FY2021のリステートデータも含まれる（Era 2 形式）
            if (fy === 'FY2022' && era === 2) {
              const restatement = extractEra2RestatementData($, table);
              for (const rsFy of Object.keys(restatement)) {
                // リステートデータは参考情報として年間データに追加
                // ただし、元のEra 1形式のQ1-Q3がある場合のQ4計算には使わない
                console.log(`  → リステート ${rsFy}: セグメント ${Object.keys(restatement[rsFy]).join(', ')}`);
              }
            }
          } else {
            console.warn(`  ⚠ 年間セグメントデータが見つかりません`);
          }
        } else {
          // 10-Q: 当四半期データ
          let quarterly = null;
          if (era === 1) {
            quarterly = extractEra1($, table);
          } else if (era === 2) {
            quarterly = extractEra2($, table);
          } else if (era === 3) {
            quarterly = extractEra3($, table);
          }

          if (quarterly) {
            if (!result[fy]) result[fy] = {};
            result[fy][q] = quarterly;
            const segs = Object.keys(quarterly);
            console.log(`  → セグメント ${segs.join(', ')}`);
            for (const s of segs) {
              console.log(`    ${s}: Rev=$${quarterly[s].revenue}M OI=$${quarterly[s].operatingIncome}M`);
            }
          } else {
            console.warn(`  ⚠ 四半期セグメントデータが見つかりません`);
          }
        }
      }
    }
  }

  // Q4データの算出: Q4 = Annual - (Q1 + Q2 + Q3)
  console.log('\nQ4データの算出:');
  for (const fy of Object.keys(annualData).sort()) {
    const annual = annualData[fy];
    const q1 = result[fy]?.Q1;
    const q2 = result[fy]?.Q2;
    const q3 = result[fy]?.Q3;

    if (q1 && q2 && q3) {
      const q4 = computeQ4(annual, [q1, q2, q3]);
      if (q4) {
        if (!result[fy]) result[fy] = {};
        result[fy].Q4 = q4;
        console.log(`  ${fy} Q4:`);
        for (const s of Object.keys(q4)) {
          console.log(`    ${s}: Rev=$${q4[s].revenue}M OI=$${q4[s].operatingIncome}M`);
        }
      } else {
        console.warn(`  ⚠ ${fy} Q4を算出できません（セグメント不一致）`);
      }
    } else {
      console.warn(`  ⚠ ${fy} Q4を算出できません（Q1〜Q3データ不足）`);
    }
  }

  // JSON出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(result)) {
    for (const q of Object.keys(result[fy])) {
      total++;
    }
  }
  console.log(`合計: ${total} 四半期分のセグメント損益データを抽出`);
}

main();
