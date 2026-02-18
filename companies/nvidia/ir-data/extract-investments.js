// 10-Q/10-K PDF から投資ポートフォリオ情報を抽出するスクリプト
// 出力: investments.json
//
// 抽出項目:
//   - 非上場株式（Non-marketable Equity Securities）の期末残高・追加額・未実現損益
//   - 上場株式（Publicly-held Equity Securities）の期末残高
//
// データソース:
//   FY2025以降: ロールフォワードテーブル（Balance at beginning/end of period）
//   FY2024 Q4: "Carrying amount" テーブル（1列のみ）
//   FY2022-FY2024 Q1-Q3: Fair Value テーブル（Privately-held equity securities Level 3）
//
// 10-K → "Year Ended" から年間データを取得し、Q4 = 年間 - (Q1+Q2+Q3) で算出

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILINGS_DIR = path.join(__dirname, '..', 'filings');
const OUTPUT_PATH = path.join(__dirname, 'investments.json');

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
 * ダッシュ: — → 0
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
 * ロールフォワードテーブルから非上場株式データを抽出
 * FY2025以降の10-Q/10-K: "Balance at beginning of period" 形式
 * FY2024 Q4 10-K: "Carrying amount as of" 形式
 *
 * @param {string} text - PDFの全テキスト
 * @param {string} periodPattern - "Three Months Ended" or "Year Ended"
 * @returns {object|null} - { nonMarketableBalance, netAdditions, unrealizedGains, impairments }
 */
function extractFromRollforward(text, periodPattern) {
  // 投資関連のロールフォワードテーブルを検索
  // "non-marketable equity securities" の文脈で "Balance at beginning of period" を探す
  // （deferred revenue等の別テーブルを誤マッチしないよう文脈を確認）
  const regex = /Balance at beginning of period/g;
  let match;
  let balanceIdx = -1;

  while ((match = regex.exec(text)) !== null) {
    const contextBefore = text.substring(Math.max(0, match.index - 800), match.index);
    if (contextBefore.includes('non-marketable equity securities') ||
        contextBefore.includes('Non-Marketable Equity Securities')) {
      balanceIdx = match.index;
      break;
    }
  }

  if (balanceIdx < 0) {
    // FY2024 Q4形式: "Carrying amount as of" テーブルを試す
    return extractFromCarryingAmountTable(text);
  }

  // periodPatternの確認は省略（上の文脈チェックで十分）

  // テーブル行を抽出
  const tableText = text.substring(balanceIdx);
  const lines = tableText.split('\n');

  let endBalance = null;
  let netAdditions = null;
  let unrealizedGains = null;
  let impairments = null;

  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const line = lines[i];

    if (line.includes('Balance at end of period')) {
      const nums = parseNumbersFromLine(line);
      // 最初の数値が当四半期（Three Months Ended）または当年度（Year Ended）
      if (nums.length >= 1) endBalance = nums[0];
    } else if (line.includes('Net additions')) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1) netAdditions = nums[0];
    } else if (line.includes('Unrealized gains')) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1) unrealizedGains = nums[0];
    } else if (line.includes('Impairments and unrealized losses')) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1) impairments = nums[0];
    }
  }

  if (endBalance === null) return null;

  return { nonMarketableBalance: endBalance, netAdditions, unrealizedGains, impairments };
}

/**
 * FY2024 Q4 10-K形式: "Carrying amount as of" テーブルから抽出
 * "Carrying amount as of Jan 28, 2024  $  1,321" — 日付部分の数値を除外するため$以降をパース
 */
function extractFromCarryingAmountTable(text) {
  const match = text.match(/Carrying amount as of.*\n/);
  if (!match) return null;

  // 投資関連のテーブルかを文脈で確認（PDF layout modeは空白が多いため広めに見る）
  const contextBefore = text.substring(Math.max(0, match.index - 1500), match.index);
  if (!contextBefore.match(/non-marketable|equity securities|measurement alternative/i)) {
    return null;
  }

  const startIdx = match.index;
  const tableText = text.substring(startIdx);
  const lines = tableText.split('\n');

  let endBalance = null;
  let netAdditions = null;
  let unrealizedGains = null;
  let impairments = null;

  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const line = lines[i];

    if (i > 0 && line.match(/Carrying amount as of/)) {
      // 2行目のCarrying amount = 期末残高（$以降をパースして日付を除外）
      const nums = parseAmountsFromTableLine(line);
      if (nums.length >= 1) endBalance = nums[0];
    } else if (line.includes('Net additions')) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1) netAdditions = nums[0];
    } else if (line.includes('Unrealized gains')) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1) unrealizedGains = nums[0];
    } else if (line.includes('Impairments and unrealized losses')) {
      const nums = parseNumbersFromLine(line);
      if (nums.length >= 1) impairments = nums[0];
    }
  }

  if (endBalance === null) return null;

  return { nonMarketableBalance: endBalance, netAdditions, unrealizedGains, impairments };
}

/**
 * テーブル行から金額を抽出
 * $記号がある場合は$以降をパース、ない場合は行末の数値をパース
 * "Level X" や "(1)" 脚注マーカーを除外する
 */
function parseAmountsFromTableLine(line) {
  const dollarIdx = line.indexOf('$');
  if (dollarIdx >= 0) {
    return parseNumbersFromLine(line.substring(dollarIdx));
  }
  // $なしの場合: "Level X" を除去してから数値を取得
  const cleaned = line.replace(/Level\s+\d/g, '').replace(/\(\d\)/g, '');
  return parseNumbersFromLine(cleaned);
}

/**
 * Fair Valueテーブルから非上場・上場株式の残高を抽出
 *
 * 非上場: "Privately-held equity securities Level 3 $XXX" (FY2022-FY2024)
 * 上場:
 *   - "Publicly-held equity securities Level 1 $XXX" (1行、$付き)
 *   - "Publicly-held equity securities (1) XXX — XXX" (1行、$なし)
 *   - "Publicly-held equity\nsecurities (1) Level 1 ... XXX" (2行)
 *
 * 注: 同じPDFに "Other assets" テーブルの$0行がある場合があるため、
 *     最初に見つかった非ゼロ値を採用する
 *
 * @param {string} text - PDFの全テキスト
 * @returns {object} - { nonMarketableBalance, publiclyHeldBalance }
 */
function extractFromFairValueTable(text) {
  let nonMarketableBalance = null;
  let publiclyHeldBalance = null;

  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 非上場株式: "Privately-held equity securities" Level 3
    if (line.match(/Privately-held equity securities/i) && line.includes('Level 3')) {
      const nums = parseAmountsFromTableLine(line);
      if (nums.length >= 1 && nonMarketableBalance === null) {
        nonMarketableBalance = nums[0];
      }
    }

    // 上場株式: テーブル行のみ（説明文パラグラフを除外）
    // 条件: "Publicly-held equity sec" を含み、説明文ではない行
    const isPublicLine = line.match(/Publicly-held equity sec/i) &&
      !line.match(/are subject to|have readily|recorded in|was reclassified|In the first|decrease the|Refer to Note|consists of|realized gains|realized losses|gains and losses/);

    if (isPublicLine) {
      const nums = parseAmountsFromTableLine(line);
      if (nums.length >= 1 && publiclyHeldBalance === null) {
        const val = nums[0];
        if (val > 0) publiclyHeldBalance = val;
      }
    }

    // 2行にまたがるケース: "Publicly-held equity" + 次行に "securities..."
    if (line.match(/^\s*Publicly-held equity\s*$/) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (nextLine.match(/securities/i)) {
        const nums = parseAmountsFromTableLine(nextLine);
        if (nums.length >= 1 && publiclyHeldBalance === null) {
          const val = nums[0];
          if (val > 0) publiclyHeldBalance = val;
        }
      }
    }
  }

  return { nonMarketableBalance, publiclyHeldBalance };
}

// メイン処理
function main() {
  const result = {};
  const annualData = {}; // 10-K年間データ（Q4算出用）

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

      // ロールフォワードテーブルから抽出を試みる
      const periodPattern = isQ4 ? 'Year Ended' : 'Three Months Ended';
      const rollforward = extractFromRollforward(pdfText, periodPattern);

      // Fair Valueテーブルからも抽出（上場株式残高は常にここから取る）
      const fairValue = extractFromFairValueTable(pdfText);

      // データを統合
      const entry = {
        nonMarketableBalance: rollforward?.nonMarketableBalance ?? fairValue.nonMarketableBalance,
        netAdditions: rollforward?.netAdditions ?? null,
        unrealizedGains: rollforward?.unrealizedGains ?? null,
        impairments: rollforward?.impairments ?? null,
        publiclyHeldBalance: fairValue.publiclyHeldBalance ?? null,
      };

      // 少なくとも1つの値がある場合のみ格納
      if (entry.nonMarketableBalance !== null || entry.publiclyHeldBalance !== null) {
        if (isQ4) {
          // 10-K: 年間データとして保存（後でQ4を算出）
          annualData[fy] = entry;
          console.log(`  → 年間: 非上場=$${entry.nonMarketableBalance}M, 上場=$${entry.publiclyHeldBalance ?? '?'}M, 追加=$${entry.netAdditions ?? '?'}M`);
        } else {
          if (!result[fy]) result[fy] = {};
          result[fy][q] = entry;
          console.log(`  → 非上場=$${entry.nonMarketableBalance}M, 上場=$${entry.publiclyHeldBalance ?? '?'}M, 追加=$${entry.netAdditions ?? '?'}M`);
        }
      } else {
        console.warn(`  ⚠ 投資データが見つかりません`);
      }
    }
  }

  // Q4データの算出
  console.log('\nQ4データの算出:');
  for (const fy of Object.keys(annualData)) {
    const annual = annualData[fy];
    const q1 = result[fy]?.Q1;
    const q2 = result[fy]?.Q2;
    const q3 = result[fy]?.Q3;

    if (q1 && q2 && q3 && annual.netAdditions !== null) {
      // ロールフォワード項目のQ4 = 年間 - (Q1+Q2+Q3)
      const q4 = {
        nonMarketableBalance: annual.nonMarketableBalance, // 年末残高 = Q4末残高
        netAdditions: annual.netAdditions - ((q1.netAdditions ?? 0) + (q2.netAdditions ?? 0) + (q3.netAdditions ?? 0)),
        unrealizedGains: annual.unrealizedGains !== null
          ? annual.unrealizedGains - ((q1.unrealizedGains ?? 0) + (q2.unrealizedGains ?? 0) + (q3.unrealizedGains ?? 0))
          : null,
        impairments: annual.impairments !== null
          ? annual.impairments - ((q1.impairments ?? 0) + (q2.impairments ?? 0) + (q3.impairments ?? 0))
          : null,
        publiclyHeldBalance: annual.publiclyHeldBalance,
      };
      if (!result[fy]) result[fy] = {};
      result[fy].Q4 = q4;
      console.log(`  ${fy} Q4: 非上場=$${q4.nonMarketableBalance}M, 追加=$${q4.netAdditions}M, 利益=$${q4.unrealizedGains}M`);
    } else {
      // ロールフォワードがない場合は残高のみ
      const q4 = {
        nonMarketableBalance: annual.nonMarketableBalance,
        netAdditions: null,
        unrealizedGains: null,
        impairments: null,
        publiclyHeldBalance: annual.publiclyHeldBalance,
      };
      if (!result[fy]) result[fy] = {};
      result[fy].Q4 = q4;
      console.log(`  ${fy} Q4: 非上場=$${q4.nonMarketableBalance}M, 上場=$${q4.publiclyHeldBalance ?? '?'}M（残高のみ）`);
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
  console.log(`合計: ${total} 四半期分の投資データを抽出`);
}

main();
