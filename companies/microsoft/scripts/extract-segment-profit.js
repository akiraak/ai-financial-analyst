// 10-Q/10-K PDF からセグメント別営業利益を抽出するスクリプト
// 出力: segment-profit.json
//
// Microsoftの報告セグメント:
//   - Productivity and Business Processes
//   - Intelligent Cloud
//   - More Personal Computing
//
// 10-Q → "Three Months Ended" の当四半期データ
// 10-K → "Year Ended" の年間データ → Q4 = 年間 - (Q1+Q2+Q3)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'segment-profit.json');

// セグメント定義
const SEGMENTS = [
  { key: 'productivityAndBusiness', patterns: [/Productivity and Business/i] },
  { key: 'intelligentCloud', patterns: [/Intelligent Cloud/i] },
  { key: 'morePersonalComputing', patterns: [/More Personal Computing/i] },
];

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
 */
function parseNumbersFromLine(line) {
  const results = [];
  const regex = /\(([\d,]+)\)|([\d,]+)|—/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match[0] === '—') {
      results.push(0);
    } else if (match[1]) {
      results.push(-parseInt(match[1].replace(/,/g, ''), 10));
    } else {
      results.push(parseInt(match[2].replace(/,/g, ''), 10));
    }
  }
  return results;
}

/**
 * セグメントテーブルからデータを抽出
 * @param {string} text - PDFの全テキスト
 * @param {string} periodPattern - "Three Months Ended" or "Year Ended"
 */
function extractSegmentData(text, periodPattern) {
  // "SEGMENT INFORMATION" セクションを見つける
  // "Note XX" で始まる行 or "SEGMENT INFORMATION" 見出し
  let segIdx = -1;
  const noteMatch = text.match(/^\s*(?:Note|NOTE)\s+\d+[\s\-–—]+(?:Segment|SEGMENT)\s+(?:Information|INFORMATION)/m);
  if (noteMatch) {
    segIdx = noteMatch.index;
  }
  // フォールバック: "SEGMENT INFORMATION" を直接検索
  if (segIdx < 0) {
    const directMatch = text.match(/SEGMENT INFORMATION/i);
    if (directMatch) segIdx = directMatch.index;
  }
  if (segIdx < 0) return null;

  const segmentText = text.substring(segIdx);
  const lines = segmentText.split('\n');

  // periodPatternを含むブロックを見つける
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(periodPattern)) {
      startLine = i;
      break;
    }
  }
  if (startLine < 0) return null;

  // セグメントごとの Revenue と Operating income を探す
  const result = {};
  let currentSegKey = null;

  for (let i = startLine + 1; i < Math.min(startLine + 50, lines.length); i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 次の期間ブロックに到達したら終了
    if (i > startLine + 3 && (trimmed.startsWith('Three Months') || trimmed.startsWith('Nine Months') ||
        trimmed.startsWith('Six Months') || trimmed.startsWith('Year Ended') || trimmed.startsWith('Twelve Months'))) {
      break;
    }

    // セグメント名の検出
    for (const seg of SEGMENTS) {
      if (seg.patterns.some(p => p.test(trimmed))) {
        currentSegKey = seg.key;
        break;
      }
    }

    // Revenue 行
    if (currentSegKey && trimmed.startsWith('Revenue')) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1 && !result[currentSegKey]) {
        result[currentSegKey] = { revenue: nums[0] };
      }
    }

    // Operating income 行
    if (currentSegKey && trimmed.match(/^Operating income/)) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1 && result[currentSegKey] && result[currentSegKey].operatingIncome == null) {
        result[currentSegKey].operatingIncome = nums[0];
      }
    }
  }

  // 全セグメントが揃っているか確認
  const hasData = SEGMENTS.every(s => result[s.key] && result[s.key].revenue != null);
  return hasData ? result : null;
}

// メイン処理
function main() {
  const result = {};
  const annualData = {};

  const fyDirs = fs.readdirSync(FILINGS_DIR)
    .filter(d => d.startsWith('FY') && fs.statSync(path.join(FILINGS_DIR, d)).isDirectory()).sort();

  for (const fy of fyDirs) {
    const fyPath = path.join(FILINGS_DIR, fy);
    const qDirs = fs.readdirSync(fyPath)
      .filter(d => d.startsWith('Q') && fs.statSync(path.join(fyPath, d)).isDirectory()).sort();

    for (const q of qDirs) {
      const isQ4 = q === 'Q4';
      const pdfName = isQ4 ? '10-K.pdf' : '10-Q.pdf';
      const pdfPath = path.join(fyPath, q, pdfName);
      if (!fs.existsSync(pdfPath)) { console.warn(`  スキップ: ${fy}/${q} - ${pdfName} なし`); continue; }

      console.log(`処理中: ${fy}/${q} (${pdfName})`);
      const pdfText = extractPdfText(pdfPath);

      if (isQ4) {
        const annual = extractSegmentData(pdfText, 'Year Ended');
        if (annual) {
          annualData[fy] = annual;
          for (const seg of SEGMENTS) {
            const d = annual[seg.key];
            if (d) console.log(`  → ${seg.key}: Rev=$${d.revenue}M, OI=$${d.operatingIncome}M (年間)`);
          }
        } else {
          console.warn(`  ⚠ 年間セグメントデータが見つかりません`);
        }
      } else {
        const quarterly = extractSegmentData(pdfText, 'Three Months Ended');
        if (quarterly) {
          if (!result[fy]) result[fy] = {};
          result[fy][q] = quarterly;
          for (const seg of SEGMENTS) {
            const d = quarterly[seg.key];
            if (d) console.log(`  → ${seg.key}: Rev=$${d.revenue}M, OI=$${d.operatingIncome}M`);
          }
        } else {
          console.warn(`  ⚠ 四半期セグメントデータが見つかりません`);
        }
      }
    }
  }

  // Q4 = Annual - (Q1+Q2+Q3)
  console.log('\nQ4データの算出:');
  for (const fy of Object.keys(annualData)) {
    const annual = annualData[fy];
    const q1 = result[fy]?.Q1;
    const q2 = result[fy]?.Q2;
    const q3 = result[fy]?.Q3;
    if (q1 && q2 && q3) {
      const q4 = {};
      for (const seg of SEGMENTS) {
        const a = annual[seg.key];
        const s1 = q1[seg.key], s2 = q2[seg.key], s3 = q3[seg.key];
        if (a && s1 && s2 && s3) {
          q4[seg.key] = {
            revenue: a.revenue - (s1.revenue + s2.revenue + s3.revenue),
            operatingIncome: a.operatingIncome - (s1.operatingIncome + s2.operatingIncome + s3.operatingIncome),
          };
        }
      }
      if (Object.keys(q4).length > 0) {
        if (!result[fy]) result[fy] = {};
        result[fy].Q4 = q4;
        for (const seg of SEGMENTS) {
          const d = q4[seg.key];
          if (d) console.log(`  ${fy} Q4 ${seg.key}: Rev=$${d.revenue}M, OI=$${d.operatingIncome}M`);
        }
      }
    } else {
      console.warn(`  ⚠ ${fy} Q4を算出できません（Q1〜Q3データ不足）`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  let total = 0;
  for (const fy of Object.keys(result)) for (const q of Object.keys(result[fy])) total++;
  console.log(`合計: ${total} 四半期分のセグメント営業利益データを抽出`);
}

main();
