// Apple Inc. IR決算資料リンクの生成スクリプト
// quarterly-links.json（プレスリリース8-K）と10-Q/10-Kファイリング情報を統合し、
// docs/apple/ir-links.json を出力する。
// config.json に依存せず全四半期分を常に出力する（期間変更の影響を受けない）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT = path.join(ROOT, 'docs/apple/ir-links.json');

// 四半期名変換用
const qNames = ['First', 'Second', 'Third', 'Fourth'];

// SEC EDGAR CIK
const CIK = '320193';

// EDGAR URLビルダー
function buildEdgarUrl(adsh, file) {
  const adshNoDashes = adsh.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${CIK}/${adshNoDashes}/${file}`;
}

// quarterly-links.json からプレスリリースのリンクを読み込み
const quarterlyLinks = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'quarterly-links.json'), 'utf-8'));

// 10-Q/10-K ファイリング情報（download-10q-10k.js と同じデータ）
const tenQKFilings = [
  // FY2021
  { fy: 'FY2021', q: 'Q1', form: '10-Q', adsh: '0000320193-21-000010', file: 'aapl-20201226.htm' },
  { fy: 'FY2021', q: 'Q2', form: '10-Q', adsh: '0000320193-21-000056', file: 'aapl-20210327.htm' },
  { fy: 'FY2021', q: 'Q3', form: '10-Q', adsh: '0000320193-21-000065', file: 'aapl-20210626.htm' },
  { fy: 'FY2021', q: 'Q4', form: '10-K', adsh: '0000320193-21-000105', file: 'aapl-20210925.htm' },
  // FY2022
  { fy: 'FY2022', q: 'Q1', form: '10-Q', adsh: '0000320193-22-000007', file: 'aapl-20211225.htm' },
  { fy: 'FY2022', q: 'Q2', form: '10-Q', adsh: '0000320193-22-000059', file: 'aapl-20220326.htm' },
  { fy: 'FY2022', q: 'Q3', form: '10-Q', adsh: '0000320193-22-000070', file: 'aapl-20220625.htm' },
  { fy: 'FY2022', q: 'Q4', form: '10-K', adsh: '0000320193-22-000108', file: 'aapl-20220924.htm' },
  // FY2023
  { fy: 'FY2023', q: 'Q1', form: '10-Q', adsh: '0000320193-23-000006', file: 'aapl-20221231.htm' },
  { fy: 'FY2023', q: 'Q2', form: '10-Q', adsh: '0000320193-23-000064', file: 'aapl-20230401.htm' },
  { fy: 'FY2023', q: 'Q3', form: '10-Q', adsh: '0000320193-23-000077', file: 'aapl-20230701.htm' },
  { fy: 'FY2023', q: 'Q4', form: '10-K', adsh: '0000320193-23-000106', file: 'aapl-20230930.htm' },
  // FY2024
  { fy: 'FY2024', q: 'Q1', form: '10-Q', adsh: '0000320193-24-000006', file: 'aapl-20231230.htm' },
  { fy: 'FY2024', q: 'Q2', form: '10-Q', adsh: '0000320193-24-000069', file: 'aapl-20240330.htm' },
  { fy: 'FY2024', q: 'Q3', form: '10-Q', adsh: '0000320193-24-000081', file: 'aapl-20240629.htm' },
  { fy: 'FY2024', q: 'Q4', form: '10-K', adsh: '0000320193-24-000123', file: 'aapl-20240928.htm' },
  // FY2025
  { fy: 'FY2025', q: 'Q1', form: '10-Q', adsh: '0000320193-25-000008', file: 'aapl-20241228.htm' },
  { fy: 'FY2025', q: 'Q2', form: '10-Q', adsh: '0000320193-25-000057', file: 'aapl-20250329.htm' },
  { fy: 'FY2025', q: 'Q3', form: '10-Q', adsh: '0000320193-25-000073', file: 'aapl-20250628.htm' },
  { fy: 'FY2025', q: 'Q4', form: '10-K', adsh: '0000320193-25-000079', file: 'aapl-20250927.htm' },
  // FY2026
  { fy: 'FY2026', q: 'Q1', form: '10-Q', adsh: '0000320193-26-000006', file: 'aapl-20251227.htm' },
];

// プレスリリースと10-Q/10-KをFY/Qでインデックス化
const pressReleaseMap = {};
for (const pr of quarterlyLinks) {
  const key = `${pr.fy}_${pr.q}`;
  pressReleaseMap[key] = pr;
}

const tenQKMap = {};
for (const f of tenQKFilings) {
  const key = `${f.fy}_${f.q}`;
  tenQKMap[key] = f;
}

// 全FY/Qを収集
const allFYs = new Set();
for (const pr of quarterlyLinks) allFYs.add(pr.fy);
for (const f of tenQKFilings) allFYs.add(f.fy);

// renderFilings() が期待する出力形式に変換して出力
function generate() {
  const output = {};

  const sortedFYs = Array.from(allFYs).sort();

  for (const fyKey of sortedFYs) {
    const fy = parseInt(fyKey.replace('FY', ''));
    const entries = [];

    // Q4→Q1の順（新しい四半期が先）
    for (const qNum of [4, 3, 2, 1]) {
      const qKey = `Q${qNum}`;
      const mapKey = `${fyKey}_${qKey}`;
      const pr = pressReleaseMap[mapKey];
      const filing = tenQKMap[mapKey];

      // どちらもない場合はスキップ
      if (!pr && !filing) continue;

      const documents = [];

      // 1. プレスリリース（8-K Exhibit 99.1）
      if (pr) {
        documents.push({
          name: 'Press Release',
          url: pr.url,
          description: `Press Release of ${qNames[qNum - 1]} Quarter ${fy}, SEC EDGAR filing`,
        });
      }

      // 2. 10-Q または 10-K
      if (filing) {
        const formUrl = buildEdgarUrl(filing.adsh, filing.file);
        documents.push({
          name: filing.form,
          url: formUrl,
          description: `${filing.form} of ${qNames[qNum - 1]} Quarter ${fy}, SEC EDGAR filing`,
        });
      }

      // 3. Apple Investor Relations ページ
      documents.push({
        name: 'Investor Relations',
        url: 'https://investor.apple.com/',
        description: `Apple Inc. Investor Relations page`,
      });

      entries.push({
        quarter: `${qNames[qNum - 1]} Quarter ${fy}`,
        documents,
      });
    }

    if (entries.length > 0) {
      output[fyKey] = entries;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));

  // 統計を表示
  let totalDocs = 0;
  let totalQuarters = 0;
  for (const fy of Object.values(output)) {
    for (const q of fy) {
      totalQuarters++;
      totalDocs += q.documents.length;
    }
  }
  console.log(`出力: ${OUTPUT} (${totalQuarters}四半期, ${totalDocs}リンク)`);
}

generate();
