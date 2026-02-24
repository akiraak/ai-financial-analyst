// HTMLページ生成スクリプト
// - docs/tsmc/index.html（ランディングページ）
// - docs/tsmc/quarters/template.html（四半期詳細テンプレート）

const fs = require('fs');
const path = require('path');

const COMPANY = 'Taiwan Semiconductor Manufacturing';
const TICKER = 'TSM';
const SLUG = 'tsmc';
const DESC = '世界最大の半導体ファウンドリ。最先端プロセス技術でAI・HPC・スマートフォン・自動車向け半導体を受託製造。';
const BASE_URL = 'https://akiraak.github.io/ai-financial-analyst';
const ROOT = path.resolve(__dirname, '../../..');
const DOCS_DIR = path.join(ROOT, 'docs', SLUG);
const QUARTERS_DIR = path.join(DOCS_DIR, 'quarters');

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
    .np-breadcrumb { padding:8px 0; border-bottom:1px solid #ddd; }
    .np-breadcrumb .inner { max-width:900px; margin:0 auto; padding:0 20px; font-family:-apple-system,sans-serif; font-size:.72rem; color:#999; }
    .np-breadcrumb a { color:#555; text-decoration:none; }
    .np-breadcrumb a:hover { text-decoration:underline; }
    .np-breadcrumb .sep { margin:0 6px; }
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
    .np-main { max-width:900px; margin:0 auto; padding:0 20px 40px; }
    .np-sec-header { font-family:-apple-system,sans-serif; font-size:.68rem; font-weight:700; letter-spacing:.22em; color:#111; text-align:center; border-top:2px solid #111; border-bottom:1px solid #111; padding:5px 0; margin-top:24px; text-transform:uppercase; }
    .np-fy-row { display:flex; align-items:center; gap:8px; padding:10px 0; border-bottom:1px solid #eee; }
    .np-fy-row:last-child { border-bottom:none; }
    .np-fy-label { font-size:.82rem; font-weight:700; color:#111; min-width:56px; font-family:-apple-system,sans-serif; }
    .np-q-link { display:inline-block; font-size:.82rem; font-weight:600; padding:4px 16px; border:1px solid #222; color:#111; text-decoration:none; font-family:-apple-system,sans-serif; transition:background .12s,color .12s; }
    .np-q-link:hover { background:#222; color:#fff; }
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
    <div class="np-sec-header">\u56DB \u534A \u671F \u5206 \u6790</div>
    <div id="quarterLinksContainer"></div>
    <div class="np-foot">
      <div>\u30C7\u30FC\u30BF\u30BD\u30FC\u30B9: ${COMPANY} IR / SEC EDGAR / Yahoo Finance</div>
      <div style="margin-top:6px;"><a href="../">\u2190 \u9298\u67C4\u4E00\u89A7\u306B\u623B\u308B</a></div>
    </div>
  </div>
  <script>
    fetch('data.json')
      .then(r => r.json())
      .then(data => {
        const withPage = data.quarters.filter(q => !q.isOutlook && q.hasPage);
        const allActual = data.quarters.filter(q => !q.isOutlook);
        const first = withPage[0]?.label || '';
        const last = withPage[withPage.length - 1]?.label || '';
        document.getElementById('meta').textContent =
          first + ' \u301C ' + last + '\u3000|\u3000' + allActual.length + '\u56DB\u534A\u671F\u5206\u306E\u30C7\u30FC\u30BF\u3000|\u3000\u66F4\u65B0: ' + data.generatedAt;
        if (data.nextEarningsDate) {
          const now = new Date();
          const today = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
          const isPast = data.nextEarningsDate <= today;
          const el = document.getElementById('next-earnings');
          el.className = 'np-earnings' + (isPast ? ' past' : '');
          el.textContent = '\u6B21\u306E\u6C7A\u7B97\u767A\u8868: ' + data.nextEarningsDate;
        }
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
      .catch(err => console.error('Error:', err));
  </script>
</body>
</html>`;
}

function generateTemplate() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${COMPANY} {{QUARTER_LABEL}} \u6C7A\u7B97\u5206\u6790</title>
  <meta property="og:title" content="${COMPANY} {{QUARTER_LABEL}} \u6C7A\u7B97\u5206\u6790">
  <meta property="og:description" content="${COMPANY} {{QUARTER_LABEL}}\u306E\u696D\u7E3E\u5206\u6790\u30FB\u30C1\u30E3\u30FC\u30C8">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${BASE_URL}/${SLUG}/quarters/{{QUARTER_DIR}}/">
  <meta property="og:image" content="${BASE_URL}/ogp.png">
  <meta property="og:site_name" content="AI Financial Analyst">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="../../../css/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Georgia,'Times New Roman',serif; background:#fff; color:#111; line-height:1.6; }
    .container { max-width:1100px; margin:0 auto; padding:0 20px; }
    .qd-bc { padding:7px 0; border-bottom:1px solid #e0e0e0; }
    .qd-bc .inner { max-width:1100px; margin:0 auto; padding:0 20px; font-family:-apple-system,sans-serif; font-size:.72rem; color:#999; }
    .qd-bc a { color:#555; text-decoration:none; }
    .qd-bc a:hover { text-decoration:underline; }
    .qd-bc .sep { margin:0 6px; color:#ccc; }
    .qd-bc .cur { color:#555; font-weight:600; }
    .qd-mh { padding:20px 0 14px; border-bottom:3px double #111; }
    .qd-mh .inner { max-width:1100px; margin:0 auto; padding:0 20px; display:flex; align-items:center; justify-content:center; gap:24px; }
    .qd-mh .qd-mh-content { text-align:center; }
    .qd-mh .qd-hl { display:flex; align-items:baseline; justify-content:center; gap:12px; }
    .qd-mh h1 { font-size:2.6rem; font-weight:900; letter-spacing:-.04em; color:#111; line-height:1; }
    .qd-mh .tk { font-size:.85rem; font-family:-apple-system,sans-serif; font-weight:800; color:#fff; background:#222; padding:3px 9px; border-radius:3px; letter-spacing:.06em; line-height:1; transform:translateY(-5px); }
    .qd-mh .qd-sub { font-size:.73rem; font-family:-apple-system,sans-serif; color:#888; margin-top:8px; }
    .qd-mh .qd-char img { width:110px; }
    .quarter-nav { background:#fff; border-bottom:2px solid #111; margin-bottom:0; }
    .quarter-nav .container { display:flex; justify-content:space-between; align-items:center; padding-top:9px; padding-bottom:9px; }
    .quarter-nav a { font-family:-apple-system,sans-serif; font-size:.8rem; font-weight:700; color:#333; text-decoration:none; }
    .quarter-nav a:hover:not(.disabled) { color:#111; text-decoration:underline; }
    .quarter-nav .current { font-family:Georgia,serif; font-size:.95rem; font-weight:700; color:#111; }
    .quarter-nav .disabled { color:#bbb; pointer-events:none; }
    .section-nav { background:#fff; border-bottom:1px solid #ccc; margin-bottom:20px; }
    .section-nav .container { display:flex; flex-wrap:wrap; gap:0; padding-top:7px; padding-bottom:7px; }
    .section-nav a { font-family:-apple-system,sans-serif; font-size:.73rem; font-weight:700; color:#444; text-decoration:none; padding:5px 14px; text-transform:uppercase; letter-spacing:.1em; transition:background .12s; }
    .section-nav a:hover { background:#f5f5f5; color:#111; }
    .section { background:#fff; border-radius:0; box-shadow:none; padding:18px 0; margin-bottom:0; border-bottom:1px solid #e8e8e8; }
    .section:last-child { border-bottom:none; }
    .section h2 { font-family:Georgia,'Times New Roman',serif; font-size:1.15rem; font-weight:700; color:#fff; background:#222; padding:8px 14px; margin:0 -14px 16px; border-bottom:none; }
    .chart-description { background:#fafafa; border-left:3px solid #999; border-radius:0; font-family:-apple-system,sans-serif; }
    .chart-description .label { color:#111; }
    .kpi-item { background:#f7f7f7; border-radius:0; border:1px solid #e0e0e0; }
    .kpi-item .kpi-value { color:#111; }
    .kpi-item .kpi-label { color:#555; }
    .kpi-item .kpi-sub { color:#777; }
    .financial-table th { background:#f5f5f5; color:#333; }
    .filing-link { border-radius:0; background:#f5f5f5; color:#333; }
    .filing-link:hover { background:#222; color:#fff; }
    .filings-fy summary { color:#333; }
    .footer { border-top:1px solid #ccc; font-family:-apple-system,sans-serif; color:#888; padding:14px 0; }
    .footer a { color:#555; text-decoration:none; }
    .footer a:hover { text-decoration:underline; }
    @media(max-width:768px) {
      .qd-mh h1 { font-size:1.9rem; }
      .section { padding:14px 0; }
    }
  </style>
</head>
<body>
  <div class="qd-bc">
    <div class="inner">
      <a href="../../../">AI Financial Analyst</a>
      <span class="sep">/</span>
      <a href="../../">${COMPANY}</a>
      <span class="sep">/</span>
      <span class="cur" id="breadcrumbQuarter"></span>
    </div>
  </div>
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
  <nav class="quarter-nav">
    <div class="container">
      <a href="#" id="prevLink" class="disabled">&larr; \u524D\u306E\u56DB\u534A\u671F</a>
      <span class="current" id="currentLabel"></span>
      <a href="#" id="nextLink" class="disabled">\u6B21\u306E\u56DB\u534A\u671F &rarr;</a>
    </div>
  </nav>
  <nav class="section-nav">
    <div class="container">
      <a href="#section-kpi">\u6C7A\u7B97\u30B5\u30DE\u30EA\u30FC</a>
      <a href="#section-financial-table">\u8CA1\u52D9\u30C7\u30FC\u30BF</a>
      <a href="#section-filings">\u6C7A\u7B97\u8CC7\u6599</a>
    </div>
  </nav>
  <div class="container" id="mainContent">
    <div class="section" id="section-kpi">
      <h2 id="summaryTitle">\u6C7A\u7B97\u30B5\u30DE\u30EA\u30FC</h2>
      <div class="kpi-grid" id="kpiGrid"></div>
      <div id="summaryContent"></div>
    </div>
    <div class="section">
      <h2>P/L\u63A8\u79FB</h2>
      <div class="chart-wrapper"><canvas id="plChart"></canvas></div>
      <div class="chart-description" id="plChart-desc"></div>
    </div>
    <div class="section">
      <h2>\u5229\u76CA\u7387\u63A8\u79FB</h2>
      <div class="chart-wrapper"><canvas id="marginChart"></canvas></div>
      <div class="chart-description" id="marginChart-desc"></div>
    </div>
    <div class="section">
      <h2>\u8CBB\u7528\u69CB\u9020</h2>
      <div class="chart-wrapper"><canvas id="costChart"></canvas></div>
      <div class="chart-description" id="costChart-desc"></div>
    </div>
    <div class="section">
      <h2>B/S\u6982\u8981</h2>
      <div class="chart-wrapper"><canvas id="balanceSheetChart"></canvas></div>
      <div class="chart-description" id="balanceSheetChart-desc"></div>
    </div>
    <div class="section">
      <h2>\u30AD\u30E3\u30C3\u30B7\u30E5\u30D5\u30ED\u30FC</h2>
      <div class="chart-wrapper"><canvas id="cashFlowChart"></canvas></div>
      <div class="chart-description" id="cashFlowChart-desc"></div>
    </div>
    <div class="section">
      <h2>\u682A\u4FA1 &amp; PER</h2>
      <div class="chart-wrapper"><canvas id="pricePERChart"></canvas></div>
      <div class="chart-description" id="pricePERChart-desc"></div>
    </div>
    <div class="section">
      <h2>\u30D0\u30EA\u30E5\u30A8\u30FC\u30B7\u30E7\u30F3\u6307\u6A19</h2>
      <div class="chart-wrapper"><canvas id="valuationChart"></canvas></div>
      <div class="chart-description" id="valuationChart-desc"></div>
    </div>
    <div class="section">
      <h2>\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u5225\u58F2\u4E0A</h2>
      <div class="chart-wrapper"><canvas id="segmentRevenueChart"></canvas></div>
      <div class="chart-description" id="segmentRevenueChart-desc"></div>
    </div>
    <div class="section">
      <h2>\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u5225 \u58F2\u4E0A\u6BD4\u7387</h2>
      <div class="chart-wrapper"><canvas id="segmentCompositionChart"></canvas></div>
      <div class="chart-description" id="segmentCompositionChart-desc"></div>
    </div>
    <div class="section" id="section-financial-table">
      <h2>\u8CA1\u52D9\u30C7\u30FC\u30BF</h2>
      <div class="financial-table-wrapper">
        <table id="financialTable" class="financial-table"></table>
      </div>
    </div>
    <div class="section" id="section-filings">
      <h2>\u6C7A\u7B97\u8CC7\u6599</h2>
      <div id="filingsContainer"></div>
    </div>
  </div>
  <div class="footer">
    <p><a href="../../">\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9</a> | <a href="https://github.com/akiraak/ai-financial-analyst">GitHub</a></p>
  </div>
  <script src="../../../js/chart-builder.js"></script>
  <script src="../../../js/quarter-detail.js"></script>
</body>
</html>`;
}

function main() {
  fs.mkdirSync(QUARTERS_DIR, { recursive: true });

  const landingPath = path.join(DOCS_DIR, 'index.html');
  fs.writeFileSync(landingPath, generateLandingPage());
  console.log(`\u751F\u6210: ${landingPath}`);

  const templatePath = path.join(QUARTERS_DIR, 'template.html');
  fs.writeFileSync(templatePath, generateTemplate());
  console.log(`\u751F\u6210: ${templatePath}`);

  console.log('\n\u5B8C\u4E86: 2\u30D5\u30A1\u30A4\u30EB\u3092\u751F\u6210\u3057\u307E\u3057\u305F');
}

main();
