// Alphabet Inc. (GOOGL) IR決算資料リンクの生成スクリプト
// financials.json から四半期一覧を取得し、各四半期のプレスリリース・10-Q/10-K・IRページへの
// リンクを生成して docs/alphabet/ir-links.json に出力する。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT = path.join(ROOT, 'docs/alphabet/ir-links.json');

// 四半期名変換用
const qNames = ['First', 'Second', 'Third', 'Fourth'];

// SEC EDGAR CIK（Alphabet）
const CIK = '1652044';

// Alphabet IR ページURL
const ALPHABET_IR_URL = 'https://abc.xyz/investor/';

// financials.json を読み込み、全FY/Q一覧を取得
const financials = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'financials.json'), 'utf-8'));

// IRリンクを生成
function generate() {
  const output = {};

  // FYキーをソート（FY2020, FY2021, ...）
  const sortedFYs = Object.keys(financials).sort();

  for (const fyKey of sortedFYs) {
    const fy = parseInt(fyKey.replace('FY', ''));
    const quarters = financials[fyKey];
    const entries = [];

    // Q4→Q1の順（新しい四半期が先）
    for (const qNum of [4, 3, 2, 1]) {
      const qKey = `Q${qNum}`;

      // financials.json にこの四半期が存在しない場合はスキップ
      if (!quarters[qKey]) continue;

      const documents = [];

      // 1. プレスリリース（Alphabet IRページへリンク）
      documents.push({
        name: 'Press Release',
        url: ALPHABET_IR_URL,
        description: `Press Release of ${qNames[qNum - 1]} Quarter ${fy}, Alphabet Investor Relations`,
      });

      // 2. 10-Q（Q1〜Q3）または 10-K（Q4）
      const formType = qNum === 4 ? '10-K' : '10-Q';
      const edgarUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${CIK}&type=${formType}&dateb=&owner=include&count=40`;
      documents.push({
        name: formType,
        url: edgarUrl,
        description: `${formType} of ${qNames[qNum - 1]} Quarter ${fy}, SEC EDGAR`,
      });

      // 3. Alphabet Investor Relations ページ
      documents.push({
        name: 'Investor Relations',
        url: ALPHABET_IR_URL,
        description: 'Alphabet Investor Relations page',
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

  // 出力ディレクトリを作成（存在しない場合）
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
