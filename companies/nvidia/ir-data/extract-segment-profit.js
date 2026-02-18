// 10-Q/10-K PDF からセグメント別営業利益を抽出するスクリプト
// 出力: segment-profit.json
//
// NVIDIAの報告セグメント（Compute & Networking / Graphics）の
// Revenue と Operating Income を PDF の Segment Information ノートから抽出する
//
// 10-Q → "Three Months Ended" の最初のデータブロック（当四半期）
// 10-K → "Year Ended" の最初のデータブロック（年間合計）→ Q4 = 年間 - (Q1+Q2+Q3)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, 'segment-profit.json');

/**
 * pdftotext -layout でPDFからテキスト抽出
 */
function extractPdfText(pdfPath) {
  return execSync(`pdftotext -layout "${pdfPath}" -`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * テキスト行から数値を抽出（レイアウトモード用）
 * 括弧は負数: (1,234) → -1234
 * ダッシュ・ハイフン: — → 0
 * ドル記号・カンマは除去
 */
function parseNumbersFromLine(line) {
  const results = [];
  // 括弧付き負数、通常の数値、ダッシュをマッチ
  const regex = /\(([\d,]+)\)|([\d,]+)|—/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match[0] === '—') {
      results.push(0);
    } else if (match[1]) {
      // 括弧付き = 負数
      results.push(-parseInt(match[1].replace(/,/g, ''), 10));
    } else {
      results.push(parseInt(match[2].replace(/,/g, ''), 10));
    }
  }
  return results;
}

/**
 * カラム順序を検出（Graphics先 or C&N先）
 * "(In millions)" の近くにあるヘッダー行から判定
 */
function detectColumnOrder(segmentText) {
  const lines = segmentText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('(In millions)')) continue;

    // (In millions) の前後5行を走査してヘッダー行を探す
    for (let j = Math.max(0, i - 5); j <= i; j++) {
      const line = lines[j];
      const gIdx = line.indexOf('Graphics');
      const nIdx = line.indexOf('Networking');
      if (gIdx >= 0 && nIdx >= 0) {
        return gIdx < nIdx ? 'graphicsFirst' : 'cnFirst';
      }
    }
    break;
  }

  // フォールバック: FY2024以降はC&N先が標準
  return 'cnFirst';
}

/**
 * セグメントテーブルからデータを抽出
 * @param {string} text - PDFの全テキスト
 * @param {string} periodPattern - "Three Months Ended" or "Year Ended"
 * @returns {object|null} - { computeAndNetworking: { revenue, operatingIncome }, graphics: { ... } }
 */
function extractSegmentData(text, periodPattern) {
  // "Note XX - Segment Information" セクションを見つける
  // "Refer to Note 17 – Segment Information" 等の参照テキストを除外するため、
  // 行頭が "Note" で始まるパターンのみマッチさせる
  const noteMatch = text.match(/^\s*Note \d+[\s\-–—]+Segment Information/m);
  if (!noteMatch) return null;
  const segIdx = noteMatch.index;
  const segmentText = text.substring(segIdx);

  // カラム順序を検出
  const colOrder = detectColumnOrder(segmentText);

  // 最初のperiodPattern行を見つける
  const lines = segmentText.split('\n');
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(periodPattern)) {
      startLine = i;
      break;
    }
  }
  if (startLine < 0) return null;

  // Revenue行とOperating income行を探す（startLineから20行以内）
  let revenueLine = null;
  let operatingIncomeLine = null;
  for (let i = startLine + 1; i < Math.min(startLine + 15, lines.length); i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('Revenue') && !revenueLine) {
      revenueLine = lines[i];
    } else if (/^Operating income/.test(trimmed) && !operatingIncomeLine) {
      operatingIncomeLine = lines[i];
    }
    // 次の期間ブロックに到達したら終了
    if (i > startLine + 2 && (trimmed.startsWith('Three Months') || trimmed.startsWith('Nine Months') || trimmed.startsWith('Year Ended'))) {
      break;
    }
  }

  if (!revenueLine || !operatingIncomeLine) return null;

  const revNums = parseNumbersFromLine(revenueLine);
  const oiNums = parseNumbersFromLine(operatingIncomeLine);

  // 最低2つの数値が必要（C&N + Graphics）
  if (revNums.length < 2 || oiNums.length < 2) return null;

  // カラム順序に基づいてマッピング
  let cnRev, cnOI, gfxRev, gfxOI;
  if (colOrder === 'graphicsFirst') {
    gfxRev = revNums[0];
    cnRev = revNums[1];
    gfxOI = oiNums[0];
    cnOI = oiNums[1];
  } else {
    cnRev = revNums[0];
    gfxRev = revNums[1];
    cnOI = oiNums[0];
    gfxOI = oiNums[1];
  }

  return {
    computeAndNetworking: { revenue: cnRev, operatingIncome: cnOI },
    graphics: { revenue: gfxRev, operatingIncome: gfxOI },
  };
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
      const pdfName = isQ4 ? '10-K.pdf' : '10-Q.pdf';
      const pdfPath = path.join(qPath, pdfName);

      if (!fs.existsSync(pdfPath)) {
        console.warn(`  スキップ: ${fy}/${q} - ${pdfName} が見つかりません`);
        continue;
      }

      console.log(`処理中: ${fy}/${q} (${pdfName})`);

      const pdfText = extractPdfText(pdfPath);

      if (isQ4) {
        // 10-K: "Year Ended" から年間データを抽出
        const annual = extractSegmentData(pdfText, 'Year Ended');
        if (annual) {
          annualData[fy] = annual;
          console.log(`  → 年間データ: C&N Rev=$${annual.computeAndNetworking.revenue}M OI=$${annual.computeAndNetworking.operatingIncome}M, Graphics Rev=$${annual.graphics.revenue}M OI=$${annual.graphics.operatingIncome}M`);
        } else {
          console.warn(`  ⚠ 年間セグメントデータが見つかりません`);
        }
      } else {
        // 10-Q: "Three Months Ended" から当四半期データを抽出
        const quarterly = extractSegmentData(pdfText, 'Three Months Ended');
        if (quarterly) {
          if (!result[fy]) result[fy] = {};
          result[fy][q] = quarterly;
          console.log(`  → C&N Rev=$${quarterly.computeAndNetworking.revenue}M OI=$${quarterly.computeAndNetworking.operatingIncome}M, Graphics Rev=$${quarterly.graphics.revenue}M OI=$${quarterly.graphics.operatingIncome}M`);
        } else {
          console.warn(`  ⚠ 四半期セグメントデータが見つかりません`);
        }
      }
    }
  }

  // Q4データの算出: Q4 = Annual - (Q1 + Q2 + Q3)
  console.log('\nQ4データの算出:');
  for (const fy of Object.keys(annualData)) {
    const annual = annualData[fy];
    const q1 = result[fy]?.Q1;
    const q2 = result[fy]?.Q2;
    const q3 = result[fy]?.Q3;

    if (q1 && q2 && q3) {
      const q4 = {
        computeAndNetworking: {
          revenue: annual.computeAndNetworking.revenue - (q1.computeAndNetworking.revenue + q2.computeAndNetworking.revenue + q3.computeAndNetworking.revenue),
          operatingIncome: annual.computeAndNetworking.operatingIncome - (q1.computeAndNetworking.operatingIncome + q2.computeAndNetworking.operatingIncome + q3.computeAndNetworking.operatingIncome),
        },
        graphics: {
          revenue: annual.graphics.revenue - (q1.graphics.revenue + q2.graphics.revenue + q3.graphics.revenue),
          operatingIncome: annual.graphics.operatingIncome - (q1.graphics.operatingIncome + q2.graphics.operatingIncome + q3.graphics.operatingIncome),
        },
      };
      if (!result[fy]) result[fy] = {};
      result[fy].Q4 = q4;
      console.log(`  ${fy} Q4: C&N Rev=$${q4.computeAndNetworking.revenue}M OI=$${q4.computeAndNetworking.operatingIncome}M, Graphics Rev=$${q4.graphics.revenue}M OI=$${q4.graphics.operatingIncome}M`);
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
  console.log(`合計: ${total} 四半期分のセグメント営業利益データを抽出`);
}

main();
