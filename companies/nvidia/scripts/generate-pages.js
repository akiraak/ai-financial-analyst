// HTMLページ生成スクリプト
// ワークフロー仕様（analyze-and-visualize.md）に基づき、3つのHTMLファイルを生成する
// - docs/nvidia/index.html（ランディングページ）
// - docs/nvidia/quarters/index.html（四半期選択ページ）
// - docs/nvidia/quarters/template.html（四半期詳細テンプレート）

const fs = require('fs');
const path = require('path');

// === 設定 ===
const COMPANY = 'NVIDIA Corporation';
const TICKER = 'NVDA';
const SLUG = 'nvidia';
const DESC = 'AIコンピューティング基盤を支えるGPU・半導体企業。データセンター、ゲーミング、自動車向けに展開。';
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
  <meta property="og:image" content="${BASE_URL}/ogp.png">
  <meta property="og:site_name" content="AI Financial Analyst">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="../css/style.css">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; background:#fff; }
    /* パンくず */
    .np-breadcrumb { padding:8px 0; border-bottom:1px solid #ddd; }
    .np-breadcrumb .inner { max-width:900px; margin:0 auto; padding:0 20px; font-family:-apple-system,sans-serif; font-size:.72rem; color:#999; }
    .np-breadcrumb a { color:#555; text-decoration:none; }
    .np-breadcrumb a:hover { text-decoration:underline; }
    .np-breadcrumb .sep { margin:0 6px; }
    /* マストヘッド */
    .np-masthead { padding:24px 0 14px; border-bottom:3px double #111; }
    .np-masthead .inner { max-width:900px; margin:0 auto; padding:0 20px; display:flex; align-items:center; justify-content:center; gap:24px; }
    .np-masthead .np-masthead-content { text-align:center; }
    .np-masthead .np-head { display:flex; align-items:baseline; justify-content:center; gap:14px; }
    .np-masthead h1 { font-size:2.8rem; font-weight:900; letter-spacing:-.03em; color:#111; line-height:1; }
    .np-masthead .tk { font-size:.88rem; font-family:-apple-system,sans-serif; font-weight:800; color:#fff; background:#222; padding:3px 10px; border-radius:3px; letter-spacing:.06em; line-height:1; transform:translateY(-5px); }
    .np-masthead .np-meta { font-size:.7rem; font-family:-apple-system,sans-serif; color:#999; margin-top:10px; }
    .np-masthead .np-earnings { font-size:.72rem; font-family:-apple-system,sans-serif; color:#999; margin-top:4px; }
    .np-masthead .np-earnings.past { color:#c0392b; font-weight:600; }
    .np-masthead .np-char img { width:110px; }
    /* メインコンテンツ */
    .np-main { max-width:900px; margin:0 auto; padding:0 20px 40px; }
    /* セクションヘッダー */
    .np-sec-header { font-family:-apple-system,sans-serif; font-size:.68rem; font-weight:700; letter-spacing:.22em; color:#111; text-align:center; border-top:2px solid #111; border-bottom:1px solid #111; padding:5px 0; margin-top:24px; text-transform:uppercase; }
    /* 四半期リンク */
    .np-fy-row { display:flex; align-items:center; gap:8px; padding:10px 0; border-bottom:1px solid #eee; }
    .np-fy-row:last-child { border-bottom:none; }
    .np-fy-label { font-size:.82rem; font-weight:700; color:#111; min-width:56px; font-family:-apple-system,sans-serif; }
    .np-q-link { display:inline-block; font-size:.82rem; font-weight:600; padding:4px 16px; border:1px solid #222; color:#111; text-decoration:none; font-family:-apple-system,sans-serif; transition:background .12s,color .12s; }
    .np-q-link:hover { background:#222; color:#fff; }
    /* フッター */
    .np-foot { margin-top:28px; padding:12px 0; text-align:center; font-family:-apple-system,sans-serif; font-size:.7rem; color:#888; border-top:1px solid #ccc; }
    .np-foot a { text-decoration:none; color:#555; }
    .np-foot a:hover { text-decoration:underline; }
  </style>
</head>
<body>

  <div class="np-breadcrumb">
    <div class="inner">
      <a href="../">AI Financial Analyst</a>
      <span class="sep">/</span>
      <span>${COMPANY}</span>
    </div>
  </div>

  <div class="np-masthead">
    <div class="inner">
      <div class="np-masthead-content">
        <div class="np-head">
          <span class="tk">${TICKER}</span>
          <h1>${COMPANY}</h1>
        </div>
        <div class="np-meta" id="meta"></div>
        <div class="np-earnings" id="next-earnings"></div>
      </div>
      <div class="np-char">
        <img src="../character/ai-craw-patterns-working.png" alt="AI Craw">
      </div>
    </div>
  </div>

  <div class="np-main">
    <div class="np-sec-header">四 半 期 分 析</div>
    <div id="quarterLinksContainer"></div>

    <div class="np-foot">
      <div>データソース: ${COMPANY} IR / Yahoo Finance</div>
      <div style="margin-top:6px;"><a href="../">← 銘柄一覧に戻る</a></div>
    </div>
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
          first + ' 〜 ' + last + '　|　' + allActual.length + '四半期分のデータ　|　更新: ' + data.generatedAt;

        // 次の決算発表日
        if (data.nextEarningsDate) {
          const now = new Date();
          const today = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
          const isPast = data.nextEarningsDate <= today;
          const el = document.getElementById('next-earnings');
          el.className = 'np-earnings' + (isPast ? ' past' : '');
          el.textContent = '次の決算発表: ' + data.nextEarningsDate;
        }

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
          html += '<div class="np-fy-row"><span class="np-fy-label">FY' + fy + '</span>';
          const sorted = fyGroups[fy].sort((a, b) => a.q - b.q);
          for (const q of sorted) {
            html += '<a href="quarters/' + q.fy + 'Q' + q.q + '/" class="np-q-link">Q' + q.q + '</a>';
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
  <meta property="og:image" content="${BASE_URL}/ogp.png">
  <meta property="og:site_name" content="AI Financial Analyst">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="../../css/style.css">
  <style>
    /* ===== WSJ風スタイル上書き ===== */
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Georgia,'Times New Roman',serif; background:#fff; color:#111; line-height:1.6; }
    .container { max-width:1100px; margin:0 auto; padding:0 20px; }

    /* パンくず */
    .qd-bc { padding:7px 0; border-bottom:1px solid #e0e0e0; }
    .qd-bc .inner { max-width:1100px; margin:0 auto; padding:0 20px; font-family:-apple-system,sans-serif; font-size:.72rem; color:#999; }
    .qd-bc a { color:#555; text-decoration:none; }
    .qd-bc a:hover { text-decoration:underline; }
    .qd-bc .sep { margin:0 6px; color:#ccc; }

    /* マストヘッド */
    .qd-mh { padding:20px 0 14px; border-bottom:3px double #111; }
    .qd-mh .inner { max-width:1100px; margin:0 auto; padding:0 20px; display:flex; align-items:center; justify-content:center; gap:24px; }
    .qd-mh .qd-mh-content { text-align:center; }
    .qd-mh .qd-hl { display:flex; align-items:baseline; justify-content:center; gap:12px; }
    .qd-mh h1 { font-size:2.6rem; font-weight:900; letter-spacing:-.04em; color:#111; line-height:1; }
    .qd-mh .tk { font-size:.85rem; font-family:-apple-system,sans-serif; font-weight:800; color:#fff; background:#222; padding:3px 9px; border-radius:3px; letter-spacing:.06em; line-height:1; transform:translateY(-5px); }
    .qd-mh .qd-sub { font-size:.85rem; font-family:-apple-system,sans-serif; color:#888; margin-top:8px; }
    .qd-mh .qd-char img { width:110px; }

    /* セクション */
    .section { background:#fff; border-radius:0; box-shadow:none; padding:18px 0; margin-bottom:0; border-bottom:1px solid #e8e8e8; }
    .section:last-child { border-bottom:none; }
    .section h2 { font-family:Georgia,'Times New Roman',serif; font-size:1.15rem; font-weight:700; color:#fff; background:#222; padding:8px 14px; margin:0 -14px 16px; border-bottom:none; }

    /* 四半期カード */
    .quarter-card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:14px; margin-top:10px; }
    .quarter-card { display:block; background:#f7f7f7; border:1px solid #e0e0e0; border-radius:0; padding:16px; text-decoration:none; color:#111; transition:background .15s; }
    .quarter-card:hover { background:#eee; }
    .quarter-card.outlook { background:#fafafa; border-style:dashed; color:#888; }
    .quarter-card-label { font-family:-apple-system,sans-serif; font-size:.8rem; font-weight:700; color:#555; margin-bottom:6px; }
    .quarter-card-revenue { font-family:Georgia,serif; font-size:1.3rem; font-weight:700; color:#111; }
    .quarter-card-meta { font-family:-apple-system,sans-serif; font-size:.7rem; color:#888; margin-top:2px; }
    .quarter-card-detail { font-family:-apple-system,sans-serif; font-size:.72rem; color:#555; margin-top:6px; }
    .quarter-card-sub { font-family:-apple-system,sans-serif; font-size:.7rem; color:#aaa; }

    /* フッター */
    .footer { border-top:1px solid #ccc; font-family:-apple-system,sans-serif; color:#888; padding:14px 0; margin-top:20px; }
    .footer a { color:#555; text-decoration:none; }
    .footer a:hover { text-decoration:underline; }

    @media(max-width:768px) {
      .qd-mh h1 { font-size:1.9rem; }
      .quarter-card-grid { grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); }
    }
  </style>
</head>
<body>

  <!-- パンくず -->
  <div class="qd-bc">
    <div class="inner">
      <a href="../../">AI Financial Analyst</a>
      <span class="sep">/</span>
      <a href="../">${COMPANY}</a>
      <span class="sep">/</span>
      <span>四半期一覧</span>
    </div>
  </div>

  <!-- マストヘッド -->
  <div class="qd-mh">
    <div class="inner">
      <div class="qd-mh-content">
        <div class="qd-hl">
          <span class="tk">${TICKER}</span>
          <h1>${COMPANY}</h1>
        </div>
        <div class="qd-sub">四半期分析一覧</div>
      </div>
      <div class="qd-char">
        <img src="../../character/ai-craw-patterns-thinking.png" alt="AI Craw">
      </div>
    </div>
  </div>

  <div class="container" style="margin-top:20px;">
    <div id="quarterList"></div>
  </div>

  <div class="footer">
    <div class="container">
      <p><a href="../">ダッシュボード</a> | <a href="https://github.com/akiraak/ai-financial-analyst">GitHub</a></p>
    </div>
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
  <meta property="og:image" content="${BASE_URL}/ogp.png">
  <meta property="og:site_name" content="AI Financial Analyst">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="../../../css/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    /* ===== WSJ風スタイル上書き ===== */
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Georgia,'Times New Roman',serif; background:#fff; color:#111; line-height:1.6; }

    /* コンテナ */
    .container { max-width:1100px; margin:0 auto; padding:0 20px; }

    /* パンくず */
    .qd-bc { padding:7px 0; border-bottom:1px solid #e0e0e0; }
    .qd-bc .inner { max-width:1100px; margin:0 auto; padding:0 20px; font-family:-apple-system,sans-serif; font-size:.72rem; color:#999; }
    .qd-bc a { color:#555; text-decoration:none; }
    .qd-bc a:hover { text-decoration:underline; }
    .qd-bc .sep { margin:0 6px; color:#ccc; }
    .qd-bc .cur { color:#555; font-weight:600; }

    /* マストヘッド */
    .qd-mh { padding:20px 0 14px; border-bottom:3px double #111; }
    .qd-mh .inner { max-width:1100px; margin:0 auto; padding:0 20px; display:flex; align-items:center; justify-content:center; gap:24px; }
    .qd-mh .qd-mh-content { text-align:center; }
    .qd-mh .qd-hl { display:flex; align-items:baseline; justify-content:center; gap:12px; }
    .qd-mh h1 { font-size:2.6rem; font-weight:900; letter-spacing:-.04em; color:#111; line-height:1; }
    .qd-mh .tk { font-size:.85rem; font-family:-apple-system,sans-serif; font-weight:800; color:#fff; background:#222; padding:3px 9px; border-radius:3px; letter-spacing:.06em; line-height:1; transform:translateY(-5px); }
    .qd-mh .qd-sub { font-size:.73rem; font-family:-apple-system,sans-serif; color:#888; margin-top:8px; }
    .qd-mh .qd-char img { width:110px; }

    /* 四半期ナビ */
    .quarter-nav { background:#fff; border-bottom:2px solid #111; margin-bottom:0; }
    .quarter-nav .container { display:flex; justify-content:space-between; align-items:center; padding-top:9px; padding-bottom:9px; }
    .quarter-nav a { font-family:-apple-system,sans-serif; font-size:.8rem; font-weight:700; color:#333; text-decoration:none; padding:0; border-radius:0; background:none; transition:none; }
    .quarter-nav a:hover:not(.disabled) { background:none; color:#111; text-decoration:underline; }
    .quarter-nav .current { font-family:Georgia,serif; font-size:.95rem; font-weight:700; color:#111; }
    .quarter-nav .disabled { color:#bbb; pointer-events:none; }

    /* セクションナビ */
    .section-nav { background:#fff; border-bottom:1px solid #ccc; margin-bottom:20px; }
    .section-nav .container { display:flex; flex-wrap:wrap; gap:0; padding-top:7px; padding-bottom:7px; }
    .section-nav a { font-family:-apple-system,sans-serif; font-size:.73rem; font-weight:700; color:#444; text-decoration:none; padding:5px 14px; border-radius:0; text-transform:uppercase; letter-spacing:.1em; background:none; transition:background .12s; }
    .section-nav a:hover { background:#f5f5f5; color:#111; }

    /* Outlookバナー */
    .outlook-banner { border-radius:0; font-family:-apple-system,sans-serif; }

    /* セクション */
    .section { background:#fff; border-radius:0; box-shadow:none; padding:18px 0; margin-bottom:0; border-bottom:1px solid #e8e8e8; }
    .section:last-child { border-bottom:none; }
    .section h2 { font-family:Georgia,'Times New Roman',serif; font-size:1.15rem; font-weight:700; color:#fff; background:#222; padding:8px 14px; margin:0 -14px 16px; border-bottom:none; }

    /* チャート解説 */
    .chart-description { background:#fafafa; border-left:3px solid #999; border-radius:0; font-family:-apple-system,sans-serif; }
    .chart-description .label { color:#111; }
    .chart-description .insight { border-left-color:#555; }

    /* KPIグリッド */
    .kpi-item { background:#f7f7f7; border-radius:0; border:1px solid #e0e0e0; }
    .kpi-item .kpi-value { color:#111; }
    .kpi-item .kpi-label { color:#555; }
    .kpi-item .kpi-sub { color:#777; }

    /* サマリーブロック */
    .summary-block { border-left-color:#bbb; font-family:-apple-system,sans-serif; }
    .summary-block .summary-label { color:#333; }

    /* 財務テーブル */
    .financial-table th { background:#f5f5f5; color:#333; }
    .financial-table th:first-child { background:#f5f5f5; }

    /* 決算資料リンク */
    .filing-link { border-radius:0; background:#f5f5f5; color:#333; }
    .filing-link:hover { background:#222; color:#fff; }
    .filings-fy summary { color:#333; }

    /* フッター */
    .footer { border-top:1px solid #ccc; font-family:-apple-system,sans-serif; color:#888; padding:14px 0; }
    .footer a { color:#555; text-decoration:none; }
    .footer a:hover { text-decoration:underline; }

    /* レスポンシブ */
    @media(max-width:768px) {
      .qd-mh h1 { font-size:1.9rem; }
      .section { padding:14px 0; }
    }
  </style>
</head>
<body>

  <!-- パンくず -->
  <div class="qd-bc">
    <div class="inner">
      <a href="../../../">AI Financial Analyst</a>
      <span class="sep">/</span>
      <a href="../../">${COMPANY}</a>
      <span class="sep">/</span>
      <span class="cur" id="breadcrumbQuarter"></span>
    </div>
  </div>

  <!-- マストヘッド -->
  <div class="qd-mh">
    <div class="inner">
      <div class="qd-mh-content">
        <div class="qd-hl">
          <span class="tk">${TICKER}</span>
          <h1>${COMPANY}</h1>
        </div>
        <div class="qd-sub" id="headerMeta"></div>
      </div>
      <div class="qd-char">
        <img src="../../../character/ai-craw-patterns-thinking.png" alt="AI Craw">
      </div>
    </div>
  </div>

  <!-- 四半期ナビ（前後移動） -->
  <nav class="quarter-nav">
    <div class="container">
      <a href="#" id="prevLink" class="disabled">&larr; 前の四半期</a>
      <span class="current" id="currentLabel"></span>
      <a href="#" id="nextLink" class="disabled">次の四半期 &rarr;</a>
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
      <h2>株価 &amp; PER</h2>
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
        <p><span class="label">市場向け5セグメント</span>（プレスリリースベース・売上のみ）: Data Center / Gaming / Professional Visualization / Automotive / OEM & Other。製品の最終用途別に分類され、売上の内訳を把握できる。</p>
        <p><span class="label">SEC報告2セグメント</span>（10-Q/10-Kベース・売上+営業利益）: Compute & Networking / Graphics。SEC開示義務に基づく報告セグメントで、セグメント別の営業利益が開示される。</p>
        <p><span class="label">両者の対応関係:</span> Compute & Networking は主に Data Center・Networking・Automotive（自動運転AI）・Jetson・DGX Cloud を含む。Graphics は主に Gaming（GeForce）・Professional Visualization（Quadro/RTX）・インフォテインメント・vGPU を含む。</p>
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
