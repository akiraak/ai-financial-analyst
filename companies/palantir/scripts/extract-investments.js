// Palantir 10-Q/10-K HTM から投資ポートフォリオ情報を抽出するスクリプト
// 出力: investments.json
//
// Palantirの主な投資:
//   - Marketable securities（米国債・社債等の短期投資）→ B/Sから取得
//   - Privately-held securities（非上場投資）→ 10-Q/10-K から取得

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'investments.json');

function parseNumber(text) {
  if (!text) return null;
  let cleaned = text.replace(/[$\s\u00a0]/g, '');
  if (cleaned === '—' || cleaned === '-' || cleaned === '\u2014' || cleaned === '\u2013' || cleaned === '') return null;
  let negative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    negative = true;
    cleaned = cleaned.replace(/[()]/g, '');
  }
  cleaned = cleaned.replace(/,/g, '');
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

function getRowCells($, tr) {
  const cells = [];
  $(tr).find('td').each((i, td) => {
    const text = $(td).text().trim().replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
    if (text && text !== '$') {
      cells.push(text);
    }
  });
  return cells;
}

/**
 * Marketable securitiesの残高をB/Sテーブルから取得
 */
function extractMarketableSecurities($) {
  let balance = null;

  $('table').each((i, t) => {
    if (balance !== null) return;
    const text = $(t).text();
    if (text.match(/Marketable securities/i) && text.match(/Total.*assets/i)) {
      $(t).find('tr').each((j, tr) => {
        if (balance !== null) return;
        const cells = getRowCells($, tr);
        if (cells.length >= 2 && /^Marketable securities$/i.test(cells[0])) {
          balance = parseNumber(cells[1]);
        }
      });
    }
  });

  return balance;
}

/**
 * 非上場投資の残高を抽出
 * "privately-held" や "equity securities" のテーブルを探す
 */
function extractPrivateInvestments($) {
  let balance = null;

  // テキスト全体から非上場投資残高のヒントを探す
  $('table').each((i, t) => {
    if (balance !== null) return;
    const text = $(t).text();
    if (text.match(/privately.held/i) || (text.match(/equity securities/i) && text.match(/measurement alternative/i))) {
      $(t).find('tr').each((j, tr) => {
        if (balance !== null) return;
        const cells = getRowCells($, tr);
        if (cells.length >= 2) {
          if (/total/i.test(cells[0]) || /carrying value/i.test(cells[0])) {
            const nums = cells.slice(1).map(c => parseNumber(c)).filter(n => n !== null);
            if (nums.length >= 1) balance = nums[0];
          }
        }
      });
    }
  });

  return balance;
}

function main() {
  const result = {};

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

      if (!fs.existsSync(htmPath)) continue;

      console.log(`処理中: ${fy}/${q} (${htmName})`);

      const html = fs.readFileSync(htmPath, 'utf-8');
      const $ = cheerio.load(html);

      const entry = {};
      let hasData = false;

      const marketable = extractMarketableSecurities($);
      if (marketable !== null) {
        entry.marketableSecurities = marketable;
        hasData = true;
      }

      const privateInv = extractPrivateInvestments($);
      if (privateInv !== null) {
        entry.privatelyHeldSecurities = privateInv;
        hasData = true;
      }

      if (hasData) {
        if (!result[fy]) result[fy] = {};
        result[fy][q] = entry;
        const parts = [];
        if (entry.marketableSecurities !== undefined) parts.push(`有価証券=${entry.marketableSecurities}`);
        if (entry.privatelyHeldSecurities !== undefined) parts.push(`非上場=${entry.privatelyHeldSecurities}`);
        console.log(`  → ${parts.join(', ')}`);
      } else {
        console.log(`  → 投資データなし`);
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  let total = 0;
  for (const fy of Object.keys(result)) {
    for (const q of Object.keys(result[fy])) total++;
  }
  console.log(`合計: ${total} 四半期分の投資データを抽出`);
}

main();
