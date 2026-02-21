// Broadcom IR決算資料リンクの生成スクリプト
// 各四半期のIR資料（プレスリリース、10-Q/10-K）のURLをハードコードし、
// docs/broadcom/ir-links.json を出力する。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const OUTPUT = path.join(ROOT, 'docs/broadcom/ir-links.json');

// 四半期名変換用
const qNames = ['First', 'Second', 'Third', 'Fourth'];

// IR資料データ（FY・Q → ドキュメント配列）
const irDocuments = {
  FY2020: {
    Q1: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000119312520071608/d859221dex991.htm', description: 'Press Release of First Quarter 2020' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016820000045/avgo-02022020x10q.htm', description: '10-Q of First Quarter 2020' },
    ],
    Q2: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016820000099/avgo-05032020x8kxex99.htm', description: 'Press Release of Second Quarter 2020' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016820000109/avgo-20200503.htm', description: '10-Q of Second Quarter 2020' },
    ],
    Q3: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016820000154/avgo-08022020x8kxex99.htm', description: 'Press Release of Third Quarter 2020' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016820000164/avgo-20200802.htm', description: '10-Q of Third Quarter 2020' },
    ],
    Q4: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016820000201/avgo-11012020x8kxex99.htm', description: 'Press Release of Fourth Quarter 2020' },
      { name: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016820000226/avgo-20201101.htm', description: '10-K of Fourth Quarter 2020' },
    ],
  },
  FY2021: {
    Q1: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016821000026/avgo-01312021x8kxex99.htm', description: 'Press Release of First Quarter 2021' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016821000045/avgo-20210131.htm', description: '10-Q of First Quarter 2021' },
    ],
    Q2: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016821000110/avgo-05022021x8kxex99.htm', description: 'Press Release of Second Quarter 2021' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016821000116/avgo-20210502.htm', description: '10-Q of Second Quarter 2021' },
    ],
    Q3: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016821000121/avgo-08012021x8kxex99.htm', description: 'Press Release of Third Quarter 2021' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016821000123/avgo-20210801.htm', description: '10-Q of Third Quarter 2021' },
    ],
    Q4: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016821000148/avgo-10312021x8kxex99.htm', description: 'Press Release of Fourth Quarter 2021' },
      { name: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016821000153/avgo-20211031.htm', description: '10-K of Fourth Quarter 2021' },
    ],
  },
  FY2022: {
    Q1: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016822000015/avgo-01302022x8kxex99.htm', description: 'Press Release of First Quarter 2022' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016822000029/avgo-20220130.htm', description: '10-Q of First Quarter 2022' },
    ],
    Q2: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000119312522160304/d262320dex991.htm', description: 'Press Release of Second Quarter 2022' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016822000081/avgo-20220501.htm', description: '10-Q of Second Quarter 2022' },
    ],
    Q3: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016822000091/avgo-07312022x8kxex99.htm', description: 'Press Release of Third Quarter 2022' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016822000094/avgo-20220731.htm', description: '10-Q of Third Quarter 2022' },
    ],
    Q4: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016822000110/avgo-10302022x8kxex99.htm', description: 'Press Release of Fourth Quarter 2022' },
      { name: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016822000118/avgo-20221030.htm', description: '10-K of Fourth Quarter 2022' },
    ],
  },
  FY2023: {
    Q1: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016823000004/avgo-01292023x8kxex99.htm', description: 'Press Release of First Quarter 2023' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016823000008/avgo-20230129.htm', description: '10-Q of First Quarter 2023' },
    ],
    Q2: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016823000062/avgo-04302023x8kxex99.htm', description: 'Press Release of Second Quarter 2023' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016823000064/avgo-20230430.htm', description: '10-Q of Second Quarter 2023' },
    ],
    Q3: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016823000074/avgo-07302023x8kxex99.htm', description: 'Press Release of Third Quarter 2023' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016823000077/avgo-20230730.htm', description: '10-Q of Third Quarter 2023' },
    ],
    Q4: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016823000093/avgo-10292023x8kxex99.htm', description: 'Press Release of Fourth Quarter 2023' },
      { name: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016823000096/avgo-20231029.htm', description: '10-K of Fourth Quarter 2023' },
    ],
  },
  FY2024: {
    Q1: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016824000012/avgo-02042024x8kxex99.htm', description: 'Press Release of First Quarter 2024' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016824000023/avgo-20240204.htm', description: '10-Q of First Quarter 2024' },
    ],
    Q2: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016824000077/avgo-05052024x8kxex99.htm', description: 'Press Release of Second Quarter 2024' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016824000080/avgo-20240505.htm', description: '10-Q of Second Quarter 2024' },
    ],
    Q3: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016824000095/avgo-08042024x8kxex99.htm', description: 'Press Release of Third Quarter 2024' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016824000099/avgo-20240804.htm', description: '10-Q of Third Quarter 2024' },
    ],
    Q4: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016824000125/avgo-11032024x8kxex99.htm', description: 'Press Release of Fourth Quarter 2024' },
      { name: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016824000139/avgo-20241103.htm', description: '10-K of Fourth Quarter 2024' },
    ],
  },
  FY2025: {
    Q1: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016825000009/avgo-02022025x8kxex99.htm', description: 'Press Release of First Quarter 2025' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016825000021/avgo-20250202.htm', description: '10-Q of First Quarter 2025' },
    ],
    Q2: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016825000061/avgo-05042025x8kxex99.htm', description: 'Press Release of Second Quarter 2025' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016825000064/avgo-20250504.htm', description: '10-Q of Second Quarter 2025' },
    ],
    Q3: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016825000094/avgo-08032025x8kxex99.htm', description: 'Press Release of Third Quarter 2025' },
      { name: '10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016825000098/avgo-20250803.htm', description: '10-Q of Third Quarter 2025' },
    ],
    Q4: [
      { name: 'Press Release', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016825000116/avgo-11022025x8kxex99.htm', description: 'Press Release of Fourth Quarter 2025' },
      { name: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1730168/000173016825000121/avgo-20251102.htm', description: '10-K of Fourth Quarter 2025' },
    ],
  },
};

// renderFilings() が期待する出力形式に変換して出力
function generate() {
  const output = {};

  for (const [fyKey, quarters] of Object.entries(irDocuments)) {
    const fy = parseInt(fyKey.replace('FY', ''));
    const entries = [];

    // Q4→Q1の順（新しい四半期が先）
    for (const qNum of [4, 3, 2, 1]) {
      const qKey = `Q${qNum}`;
      const docs = quarters[qKey];
      if (!docs) continue;

      entries.push({
        quarter: `${qNames[qNum - 1]} Quarter ${fy}`,
        documents: docs,
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
