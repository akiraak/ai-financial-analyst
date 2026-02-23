// Microsoft IR決算資料リンクの生成スクリプト
// quarterly-links.json のSEC EDGAR URLをベースに ir-links.json を出力
// 四半期ごとにプレスリリースと10-Q/10-KのSEC EDGARリンクを生成

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT = path.join(ROOT, 'docs/microsoft/ir-links.json');

// 四半期名変換用
const qNames = ['First', 'Second', 'Third', 'Fourth'];

// CIK for Microsoft
const CIK = '789019';

// 10-Q/10-K の ADSH → SEC EDGAR URL構築用
// download-10q-10k.js からの情報
const filings10QK = [
  { fy: 'FY2021', q: 'Q1', type: '10-Q', adsh: '0001564590-20-047996', file: 'msft-10q_20200930.htm' },
  { fy: 'FY2021', q: 'Q2', type: '10-Q', adsh: '0001564590-21-004440', file: 'msft-10q_20201231.htm' },
  { fy: 'FY2021', q: 'Q3', type: '10-Q', adsh: '0001564590-21-021704', file: 'msft-10q_20210331.htm' },
  { fy: 'FY2021', q: 'Q4', type: '10-K', adsh: '0001564590-21-039151', file: 'msft-10k_20210630.htm' },
  { fy: 'FY2022', q: 'Q1', type: '10-Q', adsh: '0001564590-21-052232', file: 'msft-10q_20210930.htm' },
  { fy: 'FY2022', q: 'Q2', type: '10-Q', adsh: '0001564590-22-002580', file: 'msft-10q_20211231.htm' },
  { fy: 'FY2022', q: 'Q3', type: '10-Q', adsh: '0001564590-22-015784', file: 'msft-10q_20220331.htm' },
  { fy: 'FY2022', q: 'Q4', type: '10-K', adsh: '0001564590-22-026876', file: 'msft-10k_20220630.htm' },
  { fy: 'FY2023', q: 'Q1', type: '10-Q', adsh: '0000950170-22-022101', file: 'msft-20220930.htm' },
  { fy: 'FY2023', q: 'Q2', type: '10-Q', adsh: '0000950170-23-003772', file: 'msft-20221231.htm' },
  { fy: 'FY2023', q: 'Q3', type: '10-Q', adsh: '0000950170-23-014423', file: 'msft-20230331.htm' },
  { fy: 'FY2023', q: 'Q4', type: '10-K', adsh: '0000950170-23-035122', file: 'msft-20230630.htm' },
  { fy: 'FY2024', q: 'Q1', type: '10-Q', adsh: '0000950170-23-052545', file: 'msft-20230930.htm' },
  { fy: 'FY2024', q: 'Q2', type: '10-Q', adsh: '0000950170-24-011995', file: 'msft-20231231.htm' },
  { fy: 'FY2024', q: 'Q3', type: '10-Q', adsh: '0000950170-24-050616', file: 'msft-20240331.htm' },
  { fy: 'FY2024', q: 'Q4', type: '10-K', adsh: '0000950170-24-087843', file: 'msft-20240630.htm' },
  { fy: 'FY2025', q: 'Q1', type: '10-Q', adsh: '0000950170-24-120234', file: 'msft-20240930.htm' },
  { fy: 'FY2025', q: 'Q2', type: '10-Q', adsh: '0000950170-25-015405', file: 'msft-20241231.htm' },
  { fy: 'FY2025', q: 'Q3', type: '10-Q', adsh: '0000950170-25-051073', file: 'msft-20250331.htm' },
  { fy: 'FY2025', q: 'Q4', type: '10-K', adsh: '0000950170-25-088076', file: 'msft-20250630.htm' },
  { fy: 'FY2026', q: 'Q1', type: '10-Q', adsh: '0000950170-25-119764', file: 'msft-20250930.htm' },
  { fy: 'FY2026', q: 'Q2', type: '10-Q', adsh: '0000950170-26-014024', file: 'msft-20251231.htm' },
];

function generate() {
  // quarterly-links.json を読み込み
  const qLinks = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'quarterly-links.json'), 'utf-8'));

  // キー化: FY+Q → press release URL
  const prMap = {};
  for (const link of qLinks) {
    prMap[`${link.fy}_${link.q}`] = link;
  }

  // 10-Q/10-K キー化
  const secMap = {};
  for (const f of filings10QK) {
    const adshClean = f.adsh.replace(/-/g, '');
    secMap[`${f.fy}_${f.q}`] = {
      type: f.type,
      url: `https://www.sec.gov/Archives/edgar/data/${CIK}/${adshClean}/${f.file}`,
    };
  }

  const output = {};

  // 全FY/Qを走査
  const fySet = new Set([...qLinks.map(l => l.fy), ...filings10QK.map(f => f.fy)]);
  const sortedFYs = Array.from(fySet).sort();

  for (const fyKey of sortedFYs) {
    const fy = parseInt(fyKey.replace('FY', ''));
    const entries = [];

    for (const qNum of [4, 3, 2, 1]) {
      const qKey = `Q${qNum}`;
      const key = `${fyKey}_${qKey}`;
      const pr = prMap[key];
      const sec = secMap[key];

      if (!pr && !sec) continue;

      const documents = [];
      if (pr) {
        documents.push({
          name: 'Press Release (8-K)',
          url: pr.url,
          description: `Press Release of ${qNames[qNum - 1]} Quarter ${fy}, SEC filing`,
        });
      }
      if (sec) {
        documents.push({
          name: sec.type,
          url: sec.url,
          description: `${sec.type} of ${qNames[qNum - 1]} Quarter ${fy}, SEC filing`,
        });
      }
      // Microsoft IR ページ
      documents.push({
        name: 'Microsoft IR',
        url: 'https://www.microsoft.com/en-us/Investor/earnings/FY-2025-Q2/press-release-webcast'.replace(/FY-\d+-Q\d/, `FY-${fy}-Q${qNum}`),
        description: `Microsoft Investor Relations page for FY${fy} Q${qNum}`,
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
