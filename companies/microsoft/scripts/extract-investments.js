// 10-Q/10-K PDF から投資ポートフォリオ情報を抽出するスクリプト
// 出力: investments.json
//
// Microsoft固有: Equity investments（エクイティ投資）の残高を抽出
// 10-Q/10-K の Notes から "equity investments" セクションを検索

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'investments.json');

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
 * テキスト行から数値を抽出
 */
function parseNumbersFromLine(line) {
  const results = [];
  const regex = /\(([\d,]+)\)|([\d,]+)|—/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match[0] === '—') { results.push(0); }
    else if (match[1]) { results.push(-parseInt(match[1].replace(/,/g, ''), 10)); }
    else { results.push(parseInt(match[2].replace(/,/g, ''), 10)); }
  }
  return results;
}

/**
 * エクイティ投資の残高を抽出
 * "Equity investments" の Note セクションから残高を取得
 * フォールバック: バランスシートの "Equity investments" 行
 */
function extractInvestments(text) {
  const result = {};

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // パターン1: "Total equity investments" が1行にある場合
    if (line.match(/Total\s+equity\s+investments/i)) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1 && !result.equityInvestments) {
        result.equityInvestments = nums[0];
      }
    }

    // パターン2: "Total equity" + 次行 "investments" の2行分割パターン
    // FY2024 Q3以降のPDFで発生
    if (line.match(/Total\s+equity\s*$/i) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (nextLine.match(/^\s*investments\b/i)) {
        const nums = parseNumbersFromLine(nextLine);
        if (nums.length >= 1 && !result.equityInvestments) {
          result.equityInvestments = nums[0];
        }
      }
    }

    // パターン3: バランスシートの "Equity investments" 行
    // ※ "Level 1", "Other" 等の明細行は除外
    if (line.match(/^\s*Equity investments\s/) &&
        !line.match(/Total|Note|note|See|see|Level|Other/)) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1 && !result.equityInvestments) {
        result.equityInvestments = nums[0];
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// メイン処理
function main() {
  const investments = {};
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
      if (!fs.existsSync(pdfPath)) continue;

      console.log(`処理中: ${fy}/${q} (${pdfName})`);
      const pdfText = extractPdfText(pdfPath);
      const data = extractInvestments(pdfText);

      if (data) {
        if (isQ4) {
          annualData[fy] = data;
        } else {
          if (!investments[fy]) investments[fy] = {};
          investments[fy][q] = data;
        }
        console.log(`  → equityInvestments=$${data.equityInvestments}M`);
      } else {
        console.log(`  → 投資データなし`);
        // 空でも記録（データがない四半期がある場合）
        if (!isQ4) {
          if (!investments[fy]) investments[fy] = {};
          investments[fy][q] = { equityInvestments: null };
        }
      }
    }
  }

  // Q4: 年間データの残高をそのまま使用
  for (const fy of Object.keys(annualData)) {
    if (!investments[fy]) investments[fy] = {};
    investments[fy].Q4 = annualData[fy];
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(investments, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  let total = 0;
  for (const fy of Object.keys(investments)) for (const q of Object.keys(investments[fy])) total++;
  console.log(`合計: ${total} 四半期分の投資データを抽出`);
}

main();
