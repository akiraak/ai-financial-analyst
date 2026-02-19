// press-release.html からセグメント別売上データを抽出するスクリプト
// 出力: segments.json
//
// セグメントの見出し（<p><strong>Data Center</strong></p>）直後の
// <ul> 内最初の <li> から売上金額を正規表現で抽出する

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, 'segments.json');

// セグメント名の正規化マッピング
// press-release内の見出し → 統一キー
const SEGMENT_DEFS = [
  { key: 'dataCenter', patterns: [/^Data Center/i] },
  { key: 'gaming', patterns: [/^Gaming/i] },
  { key: 'professionalVisualization', patterns: [/^Professional Visualization/i] },
  { key: 'automotive', patterns: [/^Automotive/i] },
  { key: 'oem', patterns: [/^OEM/i] },
];

/**
 * テキストからドル金額を抽出して百万ドル単位に変換
 * "$51.2 billion" → 51200, "$760 million" → 760
 */
function parseDollarAmount(text) {
  const match = text.match(/\$([\d,.]+)\s*(billion|million)/i);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(num)) return null;
  if (match[2].toLowerCase() === 'billion') {
    return Math.round(num * 1000);
  }
  return Math.round(num);
}

/**
 * press-release.html からセグメント別売上を抽出
 * パターン: <p><strong>セグメント名</strong></p> の直後の <ul> 内最初の <li> に売上記載
 */
function extractFromFile(filePath, fy, q) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(html);

  const result = {};

  // <strong> 要素を走査し、セグメント見出しを探す
  $('strong').each((i, el) => {
    const headingText = $(el).text().trim().replace(/\u00a0/g, ' ').trim();

    // セグメント名にマッチするか判定
    let segKey = null;
    for (const def of SEGMENT_DEFS) {
      if (def.patterns.some(p => p.test(headingText))) {
        segKey = def.key;
        break;
      }
    }
    if (!segKey) return;
    if (segKey in result) return; // 同じセグメントの重複を防ぐ

    // 見出しの親要素（<p>）から、直後の <ul> を探す
    const parent = $(el).closest('p');
    if (!parent.length) return;

    // 次の兄弟要素から <ul> を探す
    let ul = null;
    let sibling = parent.next();
    // 数要素先まで探す（間に空白や別の<p>が入る場合がある）
    for (let attempts = 0; attempts < 5 && sibling.length; attempts++) {
      if (sibling.is('ul')) {
        ul = sibling;
        break;
      }
      // 別のセグメント見出しが来たら探索中止
      if (sibling.find('strong').length && sibling.is('p')) break;
      sibling = sibling.next();
    }

    if (!ul) return;

    // 最初の <li> のテキストから金額を抽出
    const firstLi = ul.find('li').first();
    if (!firstLi.length) return;
    const liText = firstLi.text().trim();

    const amount = parseDollarAmount(liText);
    if (amount !== null) {
      result[segKey] = amount;
    } else {
      console.warn(`  警告: ${fy}/${q} - ${segKey} の金額を抽出できません: "${liText.substring(0, 80)}..."`);
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const segments = {};

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
      const prPath = path.join(fyPath, q, 'press-release.html');
      if (!fs.existsSync(prPath)) {
        console.warn(`  スキップ: ${fy}/${q} - press-release.html が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q}`);
      const data = extractFromFile(prPath, fy, q);
      if (data) {
        if (!segments[fy]) segments[fy] = {};
        segments[fy][q] = data;

        const keys = Object.keys(data);
        const total = keys.reduce((s, k) => s + data[k], 0);
        console.log(`  → ${keys.length} セグメント抽出: ${keys.map(k => `${k}=$${data[k]}M`).join(', ')} (合計: $${total}M)`);
      } else {
        console.warn(`  ⚠ セグメントデータが見つかりません`);
      }
    }
  }

  // JSON出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(segments, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);

  // 全体サマリー
  let total = 0;
  for (const fy of Object.keys(segments)) {
    for (const q of Object.keys(segments[fy])) {
      total++;
    }
  }
  console.log(`合計: ${total} 四半期分のセグメントデータを抽出`);
}

main();
