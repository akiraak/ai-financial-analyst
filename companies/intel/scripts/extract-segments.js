// Intel press-release.html からセグメント別データを抽出するスクリプト
// Intelのセグメント構造は年度により異なる3つのフォーマットに対応:
//
// ■ 旧フォーマット (FY2020-FY2021):
//   DCG (Platform/Adjacency), IoT (IOTG, Mobileye), NSG, PSG, CCG (Platform/Adjacency), All other
//
// ■ 中間フォーマット (FY2022-FY2023):
//   CCG (Desktop/Notebook/Other), DCAI, NEX, AXG (FY2022のみ), Mobileye, IFS, All other
//
// ■ 最新フォーマット (FY2024+):
//   Intel Products (CCG, DCAI, NEX), Intel Foundry, All Other (Altera, Mobileye, Other)
//   ※FY2025 Q1以降はカラム形式テーブル
//
// 出力: segments.json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segments.json');

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
 * テーブル行から数値を抽出（全カラム）
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
 * テーブル行から最初の数値を抽出
 */
function extractFirstValue($, row) {
  const values = extractValues($, row);
  for (const v of values) {
    const num = parseNumber(v);
    if (num !== null) return num;
  }
  return null;
}

/**
 * HTMLからテーブルタイトル位置を見つけ、そのテーブルを抽出
 */
function findTable(html, title) {
  const titleIdx = html.toUpperCase().indexOf(title.toUpperCase());
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
 * FY2025+ カラム形式テーブルからセグメントデータを抽出
 * テーブル構造: CCG | DCAI | Total Intel Products | Intel Foundry | All Other | ...
 * Revenue行とOperating income行から値を取得
 */
function extractColumnarFormat($, tableHtml) {
  const $t = cheerio.load(tableHtml);
  const result = {};

  $t('tr').each((ri, row) => {
    const label = getRowLabel($t, row);
    if (!label) return;

    const values = extractValues($t, row);
    if (values.length === 0) return;

    // Revenue行
    if (/^Revenue$/i.test(label)) {
      const nums = values.map(v => parseNumber(v));
      // カラム順: CCG, DCAI, Total Intel Products, Intel Foundry, All Other, Corporate Unallocated, Intersegment Eliminations, Total
      if (nums.length >= 8) {
        result.ccgRevenue = nums[0];
        result.dcaiRevenue = nums[1];
        result.intelProductsRevenue = nums[2];
        result.intelFoundryRevenue = nums[3];
        result.allOtherRevenue = nums[4];
        result.totalRevenue = nums[7];
      } else if (nums.length >= 5) {
        result.ccgRevenue = nums[0];
        result.dcaiRevenue = nums[1];
        result.intelProductsRevenue = nums[2];
        result.intelFoundryRevenue = nums[3];
        result.allOtherRevenue = nums[4];
        if (nums.length >= 8) result.totalRevenue = nums[7];
      }
    }

    // Operating income行
    if (/^Operating income/i.test(label)) {
      const nums = values.map(v => parseNumber(v));
      if (nums.length >= 8) {
        result.ccgOperatingIncome = nums[0];
        result.dcaiOperatingIncome = nums[1];
        result.intelProductsOperatingIncome = nums[2];
        result.intelFoundryOperatingIncome = nums[3];
        result.allOtherOperatingIncome = nums[4];
        result.totalOperatingIncome = nums[7];
      } else if (nums.length >= 5) {
        result.ccgOperatingIncome = nums[0];
        result.dcaiOperatingIncome = nums[1];
        result.intelProductsOperatingIncome = nums[2];
        result.intelFoundryOperatingIncome = nums[3];
        result.allOtherOperatingIncome = nums[4];
        if (nums.length >= 8) result.totalOperatingIncome = nums[7];
      }
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 旧フォーマット (FY2020-FY2021) からセグメントデータを抽出
 */
function extractOldFormat($, tableHtml) {
  const $t = cheerio.load(tableHtml);
  const result = {};

  let section = null; // 'revenue' | 'operatingIncome'
  let revenueGroup = null; // 'dcg' | 'iot' | 'ccg' | 'iot_oi'

  $t('tr').each((ri, row) => {
    const label = getRowLabel($t, row);
    if (!label) return;

    const value = extractFirstValue($t, row);

    // セクションヘッダー検出
    if (/^Net [Rr]evenue$/i.test(label) || /^Net Revenue$/i.test(label)) {
      section = 'revenue';
      revenueGroup = null;
      return;
    }
    if (/^Operating income/i.test(label) && !label.match(/^Total/i)) {
      section = 'operatingIncome';
      revenueGroup = null;
      return;
    }

    // ── Revenue セクション ──
    if (section === 'revenue') {
      // グループヘッダー検出（値がない行）
      if (/^Data Center Group$/i.test(label) && value === null) {
        revenueGroup = 'dcg';
        return;
      }
      if (/^Internet of Things$/i.test(label) && value === null) {
        revenueGroup = 'iot';
        return;
      }
      if (/^Client Computing Group$/i.test(label) && value === null) {
        revenueGroup = 'ccg';
        return;
      }

      // DCGグループ
      if (revenueGroup === 'dcg') {
        if (/^Platform$/i.test(label)) {
          result.dcgPlatformRevenue = value;
        } else if (/^Adjacency$/i.test(label) || /^Adjacent$/i.test(label)) {
          result.dcgAdjacencyRevenue = value;
        }
      }
      // IoTグループ
      if (revenueGroup === 'iot') {
        if (/^IOTG$/i.test(label)) {
          result.iotgRevenue = value;
        } else if (/^Mobileye$/i.test(label)) {
          result.mobileyeRevenue = value;
        }
      }
      // CCGグループ
      if (revenueGroup === 'ccg') {
        if (/^Platform$/i.test(label)) {
          result.ccgPlatformRevenue = value;
        } else if (/^Adjacency$/i.test(label) || /^Adjacent$/i.test(label)) {
          result.ccgAdjacencyRevenue = value;
        }
      }
      // 独立セグメント
      if (/^Non-Volatile Memory Solutions Group$/i.test(label)) {
        result.nsgRevenue = value;
        revenueGroup = null;
      }
      if (/^Programmable Solutions Group$/i.test(label)) {
        result.psgRevenue = value;
        revenueGroup = null;
      }
      if (/^All other$/i.test(label)) {
        result.allOtherRevenue = value;
        revenueGroup = null;
      }
      if (/^TOTAL NET REVENUE$/i.test(label) || /^Total net revenue$/i.test(label)) {
        result.totalRevenue = value;
        revenueGroup = null;
      }
    }

    // ── Operating Income セクション ──
    if (section === 'operatingIncome') {
      // DCG: 旧フォーマットでは値付き1行
      if (/^Data Center Group$/i.test(label)) {
        result.dcgOperatingIncome = value;
        revenueGroup = null;
        return;
      }
      // IoT: グループヘッダー（値なし）→ IOTG/Mobileye サブ行
      if (/^Internet of Things$/i.test(label) && value === null) {
        revenueGroup = 'iot_oi';
        return;
      }
      if (revenueGroup === 'iot_oi') {
        if (/^IOTG$/i.test(label)) {
          result.iotgOperatingIncome = value;
        } else if (/^Mobileye$/i.test(label)) {
          result.mobileyeOperatingIncome = value;
        }
      }
      if (/^Non-Volatile Memory Solutions Group$/i.test(label)) {
        result.nsgOperatingIncome = value;
        revenueGroup = null;
      }
      if (/^Programmable Solutions Group$/i.test(label)) {
        result.psgOperatingIncome = value;
        revenueGroup = null;
      }
      // CCG: 値付き1行
      if (/^Client Computing Group$/i.test(label)) {
        result.ccgOperatingIncome = value;
        revenueGroup = null;
      }
      if (/^All other$/i.test(label)) {
        result.allOtherOperatingIncome = value;
        revenueGroup = null;
      }
      if (/^TOTAL OPERATING INCOME$/i.test(label) || /^Total operating income$/i.test(label)) {
        result.totalOperatingIncome = value;
      }
    }
  });

  // DCG/CCG小計を計算（Platform + Adjacency）
  if (result.dcgPlatformRevenue != null && result.dcgAdjacencyRevenue != null) {
    result.dcgRevenue = result.dcgPlatformRevenue + result.dcgAdjacencyRevenue;
  }
  if (result.ccgPlatformRevenue != null && result.ccgAdjacencyRevenue != null) {
    result.ccgRevenue = result.ccgPlatformRevenue + result.ccgAdjacencyRevenue;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 中間フォーマット (FY2022-FY2023) からセグメントデータを抽出
 */
function extractMidFormat($, tableHtml) {
  const $t = cheerio.load(tableHtml);
  const result = {};

  let section = null; // 'revenue' | 'operatingIncome'
  let inCCG = false;

  $t('tr').each((ri, row) => {
    const label = getRowLabel($t, row);
    if (!label) return;

    const value = extractFirstValue($t, row);

    // セクションヘッダー検出
    if (/^Operating segment revenue/i.test(label) || /^Net revenue/i.test(label)) {
      section = 'revenue';
      inCCG = false;
      return;
    }
    if (/^Operating income/i.test(label) && !label.match(/Total/i)) {
      section = 'operatingIncome';
      inCCG = false;
      return;
    }

    if (section === 'revenue') {
      // CCGサブアイテム
      if (/^Client Computing$/i.test(label)) {
        inCCG = true;
        return;
      }
      if (inCCG) {
        if (/^Desktop$/i.test(label)) {
          result.ccgDesktopRevenue = value;
          return;
        }
        if (/^Notebook$/i.test(label)) {
          result.ccgNotebookRevenue = value;
          return;
        }
        if (/^Other$/i.test(label)) {
          result.ccgOtherRevenue = value;
          return;
        }
      }

      // CCG小計行（ラベルなし、数値のみの行）はextractFirstValueで処理されるが
      // ここではメインセグメントを探す

      if (/^Datacenter and AI$/i.test(label) || /^Data Center and AI$/i.test(label)) {
        result.dcaiRevenue = value;
        inCCG = false;
      } else if (/^Network and Edge$/i.test(label)) {
        result.nexRevenue = value;
        inCCG = false;
      } else if (/^Accelerated Computing/i.test(label)) {
        result.axgRevenue = value;
        inCCG = false;
      } else if (/^Mobileye$/i.test(label)) {
        result.mobileyeRevenue = value;
        inCCG = false;
      } else if (/^Intel Foundry Services$/i.test(label) || /^Intel Foundry$/i.test(label)) {
        result.ifsRevenue = value;
        inCCG = false;
      } else if (/^All other$/i.test(label)) {
        result.allOtherRevenue = value;
        inCCG = false;
      } else if (/^Total operating segment revenue$/i.test(label) || /^Total net revenue$/i.test(label)) {
        result.totalRevenue = value;
        inCCG = false;
      }
    }

    if (section === 'operatingIncome') {
      if (/^Client Computing$/i.test(label)) {
        result.ccgOperatingIncome = value;
      } else if (/^Datacenter and AI$/i.test(label) || /^Data Center and AI$/i.test(label)) {
        result.dcaiOperatingIncome = value;
      } else if (/^Network and Edge$/i.test(label)) {
        result.nexOperatingIncome = value;
      } else if (/^Accelerated Computing/i.test(label)) {
        result.axgOperatingIncome = value;
      } else if (/^Mobileye$/i.test(label)) {
        result.mobileyeOperatingIncome = value;
      } else if (/^Intel Foundry Services$/i.test(label) || /^Intel Foundry$/i.test(label)) {
        result.ifsOperatingIncome = value;
      } else if (/^All other$/i.test(label)) {
        result.allOtherOperatingIncome = value;
      } else if (/^Total operating income/i.test(label)) {
        result.totalOperatingIncome = value;
      }
    }
  });

  // CCG小計を計算
  if (result.ccgDesktopRevenue != null || result.ccgNotebookRevenue != null) {
    result.ccgRevenue = (result.ccgDesktopRevenue || 0) + (result.ccgNotebookRevenue || 0) + (result.ccgOtherRevenue || 0);
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 最新フォーマット (FY2024+) の行ベーステーブルからセグメントデータを抽出
 * "Operating segment revenue:" + "Intel Products:" ヘッダーを持つ
 */
function extractLatestRowFormat($, tableHtml) {
  const $t = cheerio.load(tableHtml);
  const result = {};

  let section = null; // 'revenue' | 'operatingIncome'
  let subGroup = null; // 'intelProducts' | 'allOther'
  let inCCG = false; // CCG内のDesktop/Notebook/Other

  $t('tr').each((ri, row) => {
    const label = getRowLabel($t, row);
    if (!label) return;

    const value = extractFirstValue($t, row);

    // セクションヘッダー
    if (/^Operating segment revenue/i.test(label)) {
      section = 'revenue';
      subGroup = null;
      inCCG = false;
      return;
    }
    if (/^Segment operating income/i.test(label) || (/^Operating income/i.test(label) && !label.match(/Total/i))) {
      section = 'operatingIncome';
      subGroup = null;
      inCCG = false;
      return;
    }

    // グループヘッダー
    if (/^Intel Products/i.test(label)) {
      subGroup = 'intelProducts';
      return;
    }
    if (/^All [Oo]ther/i.test(label) && value === null) {
      subGroup = 'allOther';
      return;
    }

    if (section === 'revenue') {
      if (subGroup === 'intelProducts') {
        if (/^Client Computing Group$/i.test(label)) {
          // FY2024 Q4ではCCGが一行で値付き
          if (value !== null) {
            result.ccgRevenue = value;
          } else {
            inCCG = true;
          }
          return;
        }
        if (inCCG) {
          if (/^Desktop$/i.test(label)) { result.ccgDesktopRevenue = value; return; }
          if (/^Notebook$/i.test(label)) { result.ccgNotebookRevenue = value; return; }
          if (/^Other$/i.test(label)) { result.ccgOtherRevenue = value; return; }
        }
        if (/^Data Center and AI$/i.test(label)) {
          result.dcaiRevenue = value;
          inCCG = false;
        } else if (/^Network and Edge$/i.test(label)) {
          result.nexRevenue = value;
          inCCG = false;
        }
      }

      if (/^Total Intel Products revenue$/i.test(label)) {
        result.intelProductsRevenue = value;
        subGroup = null;
        inCCG = false;
      } else if (/^Intel Foundry$/i.test(label)) {
        result.intelFoundryRevenue = value;
        subGroup = null;
      }

      if (subGroup === 'allOther') {
        if (/^Altera$/i.test(label)) { result.alteraRevenue = value; }
        else if (/^Mobileye$/i.test(label)) { result.mobileyeRevenue = value; }
        else if (/^Other$/i.test(label)) { result.otherRevenue = value; }
        else if (/^Total all other revenue$/i.test(label)) { result.allOtherRevenue = value; }
      }

      if (/^Total operating segment revenue$/i.test(label) || /^Total net revenue$/i.test(label)) {
        result.totalRevenue = value;
      }
      if (/^Intersegment eliminations$/i.test(label) && section === 'revenue') {
        result.intersegmentEliminations = value;
      }
    }

    if (section === 'operatingIncome') {
      if (subGroup === 'intelProducts') {
        if (/^Client Computing Group$/i.test(label)) {
          result.ccgOperatingIncome = value;
        } else if (/^Data Center and AI$/i.test(label)) {
          result.dcaiOperatingIncome = value;
        } else if (/^Network and Edge$/i.test(label)) {
          result.nexOperatingIncome = value;
        }
      }

      if (/^Total Intel Products operating/i.test(label)) {
        result.intelProductsOperatingIncome = value;
        subGroup = null;
      } else if (/^Intel Foundry$/i.test(label)) {
        result.intelFoundryOperatingIncome = value;
        subGroup = null;
      }

      if (subGroup === 'allOther') {
        if (/^Altera$/i.test(label)) { result.alteraOperatingIncome = value; }
        else if (/^Mobileye$/i.test(label)) { result.mobileyeOperatingIncome = value; }
        else if (/^Other$/i.test(label)) { result.otherOperatingIncome = value; }
        else if (/^Total all other operating/i.test(label)) { result.allOtherOperatingIncome = value; }
      }

      if (/^All [Oo]ther$/i.test(label) && value !== null) {
        // FY2024 Q4の "All Other" は一行で値付き
        result.allOtherOperatingIncome = value;
        subGroup = null;
      }

      if (/^Total segment operating/i.test(label)) {
        result.totalSegmentOperatingIncome = value;
      }
      if (/^Total operating income/i.test(label)) {
        result.totalOperatingIncome = value;
      }
    }
  });

  // CCG小計（Desktop/Notebook/Otherがある場合）
  if (result.ccgDesktopRevenue != null || result.ccgNotebookRevenue != null) {
    result.ccgRevenue = (result.ccgDesktopRevenue || 0) + (result.ccgNotebookRevenue || 0) + (result.ccgOtherRevenue || 0);
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * HTMLから全テーブルを走査し、特定キーワード群を含むテーブルを見つける
 * findTableと異なり、最初の出現ではなく内容マッチで探す
 * キーワードは大文字小文字を区別しない
 */
function findSegmentTable(html, keywords) {
  const $ = cheerio.load(html);
  let found = null;

  $('table').each((i, table) => {
    if (found) return false;
    const text = $(table).text().replace(/\s+/g, ' ').toLowerCase();
    if (keywords.every(kw => text.includes(kw.toLowerCase()))) {
      found = $.html(table);
    }
  });

  return found;
}

/**
 * フォーマット判定とデータ抽出
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const fyNum = parseInt(fy.replace('FY', ''));

  // FY2025以降: カラム形式テーブル（CCG/DCAI列ヘッダー + Revenue/Operating income行）
  if (fyNum >= 2025) {
    const tableHtml = findSegmentTable(html, [
      'Intel Products', 'CCG', 'DCAI', 'Revenue', 'Operating income', 'Three Months Ended'
    ]);
    if (tableHtml) {
      const data = extractColumnarFormat(null, tableHtml);
      if (data) return data;
    }
  }

  // FY2024+: 行ベースの最新フォーマット（"Intel Products" + "Operating segment revenue"）
  if (fyNum >= 2024) {
    const tableHtml = findSegmentTable(html, [
      'Intel Products', 'Client Computing', 'Data Center and AI', 'Operating income'
    ]);
    if (tableHtml) {
      const $t = cheerio.load(tableHtml);
      const text = $t.text();
      if (text.includes('Intel Products')) {
        const data = extractLatestRowFormat(null, tableHtml);
        if (data) return data;
      }
    }
  }

  // FY2022-FY2023: 中間フォーマット（Client Computing + DCAI + Operating income）
  if (fyNum >= 2022 && fyNum <= 2023) {
    const tableHtml = findSegmentTable(html, [
      'Client Computing', 'Operating income'
    ]);
    if (tableHtml) {
      const data = extractMidFormat(null, tableHtml);
      if (data) return data;
    }
  }

  // FY2020-FY2021: 旧フォーマット（Data Center Group + Client Computing Group + Platform/Adjacency）
  if (fyNum <= 2021) {
    const tableHtml = findSegmentTable(html, [
      'Data Center Group', 'Client Computing Group', 'Platform', 'Operating income'
    ]);
    if (tableHtml) {
      const data = extractOldFormat(null, tableHtml);
      if (data) return data;
    }
  }

  return null;
}

// メイン処理
function main() {
  const segments = {};

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
        if (!segments[fy]) segments[fy] = {};
        segments[fy][q] = data;
        const keys = Object.keys(data);
        console.log(`  → ${keys.length} 項目: ${keys.map(k => `${k}=${data[k]}`).join(', ')}`);
      } else {
        console.log(`  → セグメントデータなし`);
      }
    }
  }

  // データディレクトリが存在しない場合は作成
  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(segments, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(segments)) {
    for (const q of Object.keys(segments[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分のセグメントデータを抽出`);
}

main();
