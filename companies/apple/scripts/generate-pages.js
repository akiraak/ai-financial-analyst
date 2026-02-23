// HTMLページ生成スクリプト（Apple Inc.用）
// ワークフロー仕様（analyze-and-visualize.md）に基づき、3つのHTMLファイルを生成する
// - docs/apple/index.html（ランディングページ）
// - docs/apple/quarters/index.html（四半期選択ページ）
// - docs/apple/quarters/template.html（四半期詳細テンプレート）

const fs = require('fs');
const path = require('path');

// === 設定 ===
const COMPANY = 'Apple Inc.';
const TICKER = 'AAPL';
const SLUG = 'apple';
const DESC = 'iPhone・Mac・iPad・Services。地域別・製品別セグメント業績を可視化。';
const BASE_URL = 'https://akiraak.github.io/ai-financial-analyst';
const ROOT = path.resolve(__dirname, '../../..');
const DOCS_DIR = path.join(ROOT, 'docs', SLUG);
const QUARTERS_DIR = path.join(DOCS_DIR, 'quarters');

// === ランディングページ ===
function generateLandingPage() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${COMPANY} (${TICKER}) 業績レポート</title>
  <meta property="og:title" content="${COMPANY} (${TICKER}) 業績レポート">
  <meta property="og:description" content="${DESC}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${BASE_URL}/${SLUG}/">
  <meta property="og:image" content="${BASE_URL}/${SLUG}/ogp.png">
  <meta property="og:site_name" content="AI Financial Analyst">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="../css/style.css">
</head>
<body>

  <div class="header">
    <div class="container">
      <div class="site-name"><a href="../">AI Financial Analyst</a></div>
      <h1>${COMPANY} <span class="ticker">${TICKER}</span></h1>
      <div class="meta" id="meta"></div>
    </div>
  </div>

  <nav class="breadcrumb">
    <div class="container">
      <a href="../">HOME</a>
      <span class="separator">/</span>
      <span class="current">${COMPANY}</span>
    </div>
  </nav>

  <div class="container">

    <!-- 四半期分析リンク -->
    <div class="section" id="section-quarters">
      <h2>四半期分析</h2>
      <p style="font-size:0.85rem;color:#666;margin-bottom:12px;">各四半期をクリックすると、詳細分析ページを表示します。</p>
      <div id="quarterLinksContainer"></div>
    </div>

  </div>

  <div class="footer">
    <p>データソース: ${COMPANY} IR / Yahoo Finance</p>
    <p><a href="../">企業一覧に戻る</a></p>
  </div>

  <script>
    fetch('data.json')
      .then(r => r.json())
      .then(data => {
        // メタ情報（ページのある四半期の期間を表示）
        const withPage = data.quarters.filter(q => !q.isOutlook && q.hasPage);
        const allActual = data.quarters.filter(q => !q.isOutlook);
        const first = withPage[0]?.label || '';
        const last = withPage[withPage.length - 1]?.label || '';
        document.getElementById('meta').textContent =
          first + ' ~ ' + last + ' | データ: ' + allActual.length + '四半期 | 更新: ' + data.generatedAt;

        // 四半期分析リンク生成（ページのある四半期のみ）
        const container = document.getElementById('quarterLinksContainer');
        const fyGroups = {};
        withPage.forEach(q => {
          if (!fyGroups[q.fy]) fyGroups[q.fy] = [];
          fyGroups[q.fy].push(q);
        });
        const sortedFYs = Object.keys(fyGroups).sort((a, b) => b - a);
        let html = '';
        for (const fy of sortedFYs) {
          html += '<div class="quarter-fy-row"><span class="quarter-fy-label">FY' + fy + '</span>';
          const sorted = fyGroups[fy].sort((a, b) => a.q - b.q);
          for (const q of sorted) {
            html += '<a href="quarters/' + q.fy + 'Q' + q.q + '/" class="quarter-link-item">Q' + q.q + '</a>';
          }
          html += '</div>';
        }
        container.innerHTML = html;
      })
      .catch(err => console.error('データ読み込みエラー:', err));

  </script>

</body>
</html>`;
}

// === 四半期選択ページ ===
function generateQuartersIndex() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${COMPANY} 四半期分析一覧</title>
  <meta property="og:title" content="${COMPANY} 四半期分析一覧">
  <meta property="og:description" content="${COMPANY}の四半期ごとの業績分析・チャートを閲覧">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${BASE_URL}/${SLUG}/quarters/">
  <meta property="og:image" content="${BASE_URL}/${SLUG}/ogp.png">
  <meta property="og:site_name" content="AI Financial Analyst">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="../../css/style.css">
</head>
<body>

  <div class="header">
    <div class="container">
      <div class="site-name"><a href="../../">AI Financial Analyst</a></div>
      <h1>${COMPANY} <span class="ticker">${TICKER}</span></h1>
      <div class="meta">四半期分析一覧</div>
    </div>
  </div>

  <nav class="breadcrumb">
    <div class="container">
      <a href="../../">HOME</a>
      <span class="separator">/</span>
      <a href="../">${COMPANY}</a>
      <span class="separator">/</span>
      <span class="current">四半期一覧</span>
    </div>
  </nav>

  <div class="container">
    <div id="quarterList"></div>
  </div>

  <div class="footer">
    <p><a href="../">ダッシュボード</a> | <a href="https://github.com/akiraak/ai-financial-analyst">GitHub</a></p>
  </div>

  <script>
    fetch('../data.json')
      .then(r => r.json())
      .then(data => {
        const container = document.getElementById('quarterList');
        // FY単位でグループ化（新しい順）
        const fyGroups = {};
        data.quarters.forEach(q => {
          if (!fyGroups[q.fy]) fyGroups[q.fy] = [];
          fyGroups[q.fy].push(q);
        });
        const sortedFYs = Object.keys(fyGroups).sort((a, b) => b - a);

        for (const fy of sortedFYs) {
          const section = document.createElement('div');
          section.className = 'section';
          const sorted = fyGroups[fy].sort((a, b) => b.q - a.q);

          let html = '<h2>FY' + fy + '</h2><div class="quarter-card-grid">';
          for (const q of sorted) {
            const dirName = q.fy + 'Q' + q.q;
            if (q.isOutlook) {
              html += '<div class="quarter-card outlook">' +
                '<div class="quarter-card-label">Q' + q.q + '</div>' +
                '<div class="quarter-card-sub">ガイダンス</div>' +
                '<div class="quarter-card-revenue">' + (q.revenue ? '$' + (q.revenue / 1000).toFixed(1) + 'B' : '---') + '</div>' +
                '<div class="quarter-card-meta">売上（予想）</div>' +
                '</div>';
            } else {
              const margin = q.revenue ? (q.operatingIncome / q.revenue * 100).toFixed(1) : '---';
              html += '<a href="' + dirName + '/" class="quarter-card">' +
                '<div class="quarter-card-label">Q' + q.q + '</div>' +
                '<div class="quarter-card-revenue">$' + (q.revenue / 1000).toFixed(1) + 'B</div>' +
                '<div class="quarter-card-meta">売上高</div>' +
                '<div class="quarter-card-detail">営業利益率 ' + margin + '%</div>' +
                '</a>';
            }
          }
          html += '</div>';
          section.innerHTML = html;
          container.appendChild(section);
        }
      });
  </script>
</body>
</html>`;
}

// === 四半期詳細テンプレート ===
function generateTemplate() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${COMPANY} {{QUARTER_LABEL}} 決算分析</title>
  <meta property="og:title" content="${COMPANY} {{QUARTER_LABEL}} 決算分析">
  <meta property="og:description" content="${COMPANY} {{QUARTER_LABEL}}の業績分析・チャート">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${BASE_URL}/${SLUG}/quarters/{{QUARTER_DIR}}/">
  <meta property="og:image" content="${BASE_URL}/${SLUG}/ogp.png">
  <meta property="og:site_name" content="AI Financial Analyst">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="../../../css/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>

  <div class="header">
    <div class="container">
      <div class="site-name"><a href="../../../">AI Financial Analyst</a></div>
      <h1>${COMPANY} <span class="ticker">${TICKER}</span></h1>
      <div class="meta" id="headerMeta"></div>
    </div>
  </div>

  <nav class="breadcrumb">
    <div class="container">
      <a href="../../../">HOME</a>
      <span class="separator">/</span>
      <a href="../../">${COMPANY}</a>
      <span class="separator">/</span>
      <span class="current" id="breadcrumbQuarter"></span>
    </div>
  </nav>

  <!-- 四半期ナビ（前後移動） -->
  <nav class="quarter-nav">
    <div class="container">
      <a href="#" id="prevLink" class="disabled">&lt; 前の四半期</a>
      <span class="current" id="currentLabel"></span>
      <a href="#" id="nextLink" class="disabled">次の四半期 &gt;</a>
    </div>
  </nav>

  <!-- セクションナビ -->
  <nav class="section-nav">
    <div class="container">
      <a href="#section-kpi">決算サマリー</a>
      <a href="#section-financial-table">財務データ</a>
      <a href="#section-filings">決算資料</a>
    </div>
  </nav>

  <div class="container" id="mainContent">

    <!-- Outlookバナー -->
    <div class="outlook-banner" id="outlookBanner" style="display:none;">
      この四半期はガイダンス（会社予想）です。開示されている項目のみ表示しています。
    </div>

    <!-- 決算サマリー（KPI + 解説） -->
    <div class="section" id="section-kpi">
      <h2 id="summaryTitle">決算サマリー</h2>
      <div class="kpi-grid" id="kpiGrid"></div>
      <div id="summaryContent"></div>
    </div>

    <div class="section">
      <h2>P/L推移</h2>
      <div class="chart-wrapper"><canvas id="plChart"></canvas></div>
      <div class="chart-description" id="plChart-desc"></div>
    </div>

    <div class="section">
      <h2>利益率推移</h2>
      <div class="chart-wrapper"><canvas id="marginChart"></canvas></div>
      <div class="chart-description" id="marginChart-desc"></div>
    </div>

    <div class="section">
      <h2>費用構造</h2>
      <div class="chart-wrapper"><canvas id="costChart"></canvas></div>
      <div class="chart-description" id="costChart-desc"></div>
    </div>

    <div class="section">
      <h2>B/S概要</h2>
      <div class="chart-wrapper"><canvas id="balanceSheetChart"></canvas></div>
      <div class="chart-description" id="balanceSheetChart-desc"></div>
    </div>

    <div class="section">
      <h2>キャッシュフロー</h2>
      <div class="chart-wrapper"><canvas id="cashFlowChart"></canvas></div>
      <div class="chart-description" id="cashFlowChart-desc"></div>
    </div>

    <div class="section">
      <h2>株価 & PER</h2>
      <div class="chart-wrapper"><canvas id="pricePERChart"></canvas></div>
      <div class="chart-description" id="pricePERChart-desc"></div>
    </div>

    <div class="section">
      <h2>バリュエーション指標</h2>
      <div class="chart-wrapper"><canvas id="valuationChart"></canvas></div>
      <div class="chart-description" id="valuationChart-desc"></div>
    </div>

    <div class="section">
      <h2>セグメント区分について</h2>
      <div class="chart-description">
        <p><span class="label">地域別セグメント（5区分）</span>: Apple は Americas、Europe、Greater China、Japan、Rest of Asia Pacific の5地域で売上を報告している。</p>
        <p><span class="label">Americas:</span> 北米・南米を含む。Apple最大の売上地域であり、全体の約4割を占める。</p>
        <p><span class="label">Europe:</span> 欧州、インド、中東、アフリカを含む。第2位の売上規模。</p>
        <p><span class="label">Greater China:</span> 中国本土、香港、台湾を含む。iPhoneの重要市場。</p>
        <p><span class="label">Japan:</span> 日本単独での報告セグメント。</p>
        <p><span class="label">Rest of Asia Pacific:</span> オーストラリア、韓国、東南アジア等を含む。</p>
        <p style="margin-top:12px;"><span class="label">製品別セグメント（5区分）</span>: iPhone、Mac、iPad、Wearables/Home/Accessories、Services で構成。</p>
        <p><span class="label">iPhone:</span> Appleの主力製品であり、売上の約半分を占める。</p>
        <p><span class="label">Mac:</span> MacBook、iMac、Mac Pro等のパソコン製品。</p>
        <p><span class="label">iPad:</span> iPad、iPad Pro、iPad Air等のタブレット製品。</p>
        <p><span class="label">Wearables/Home/Accessories:</span> Apple Watch、AirPods、HomePod、Apple TV等。</p>
        <p><span class="label">Services:</span> App Store、Apple Music、iCloud、Apple TV+、AppleCare等。高利益率の成長セグメント。</p>
      </div>
    </div>

    <div class="section">
      <h2>セグメント別売上</h2>
      <div class="chart-wrapper"><canvas id="segmentRevenueChart"></canvas></div>
      <div class="chart-description" id="segmentRevenueChart-desc"></div>
    </div>

    <div class="section">
      <h2>セグメント別 売上比率</h2>
      <div class="chart-wrapper"><canvas id="segmentCompositionChart"></canvas></div>
      <div class="chart-description" id="segmentCompositionChart-desc"></div>
    </div>

    <div class="section">
      <h2>セグメント営業利益</h2>
      <div class="chart-wrapper"><canvas id="segmentProfitChart"></canvas></div>
      <div class="chart-description" id="segmentProfitChart-desc"></div>
    </div>

    <div class="section">
      <h2>セグメント営業利益率</h2>
      <div class="chart-wrapper"><canvas id="segmentMarginChart"></canvas></div>
      <div class="chart-description" id="segmentMarginChart-desc"></div>
    </div>

    <div class="section">
      <h2>投資ポートフォリオ</h2>
      <div class="chart-wrapper"><canvas id="investmentChart"></canvas></div>
      <div class="chart-description" id="investmentChart-desc"></div>
    </div>

    <!-- 投資コミットメント（analysis-text.jsonから動的挿入） -->
    <div class="section" id="investmentCommitmentsSection" style="display:none;">
      <h2 id="investmentCommitmentsTitle"></h2>
      <div id="investmentCommitmentsContent"></div>
    </div>

    <!-- 財務データテーブル -->
    <div class="section" id="section-financial-table">
      <h2>財務データ</h2>
      <div class="financial-table-wrapper">
        <table id="financialTable" class="financial-table"></table>
      </div>
    </div>

    <!-- 決算資料リンク -->
    <div class="section" id="section-filings">
      <h2>決算資料</h2>
      <div id="filingsContainer"></div>
    </div>

  </div>

  <div class="footer">
    <p><a href="../">四半期一覧</a> | <a href="../../">ダッシュボード</a> | <a href="https://github.com/akiraak/ai-financial-analyst">GitHub</a></p>
  </div>

  <script src="../../../js/chart-builder.js"></script>
  <script src="../../../js/quarter-detail.js"></script>
</body>
</html>`;
}

// === メイン処理 ===
function main() {
  // ディレクトリ作成
  fs.mkdirSync(QUARTERS_DIR, { recursive: true });

  // ランディングページ
  const landingPath = path.join(DOCS_DIR, 'index.html');
  fs.writeFileSync(landingPath, generateLandingPage());
  console.log(`生成: ${landingPath}`);

  // 四半期選択ページ
  const quartersIndexPath = path.join(QUARTERS_DIR, 'index.html');
  fs.writeFileSync(quartersIndexPath, generateQuartersIndex());
  console.log(`生成: ${quartersIndexPath}`);

  // 四半期詳細テンプレート
  const templatePath = path.join(QUARTERS_DIR, 'template.html');
  fs.writeFileSync(templatePath, generateTemplate());
  console.log(`生成: ${templatePath}`);

  console.log('\n完了: 3ファイルを生成しました');
}

main();
