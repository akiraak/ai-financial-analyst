// quarter-detail.js — 四半期詳細ページのロジック
// ChartBuilder（chart-builder.js）の13チャートを再利用し、
// 選択四半期までのデータで時系列チャートを表示する

const QuarterDetail = {

  // === ユーティリティ ===

  getParams() {
    const params = new URLSearchParams(window.location.search);
    return { fy: parseInt(params.get('fy')), q: parseInt(params.get('q')) };
  },

  findIndex(quarters, fy, q) {
    return quarters.findIndex(d => d.fy === fy && d.q === q);
  },

  fmtMoney(val) {
    if (val == null) return '---';
    const abs = Math.abs(val);
    if (abs >= 1000) return (val < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(1) + 'B';
    return (val < 0 ? '-' : '') + '$' + abs.toLocaleString() + 'M';
  },

  fmtTableMoney(val) {
    if (val == null) return '---';
    return '$' + val.toLocaleString() + 'M';
  },

  fmtPct(val) {
    if (val == null) return '---';
    return val.toFixed(1) + '%';
  },

  calcGrowth(current, previous) {
    if (current == null || previous == null || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  },

  fmtChange(pct) {
    if (pct == null) return '<span class="change-neutral">---</span>';
    const sign = pct >= 0 ? '+' : '';
    const cls = pct > 0 ? 'change-positive' : pct < 0 ? 'change-negative' : 'change-neutral';
    return `<span class="${cls}">${sign}${pct.toFixed(1)}%</span>`;
  },

  qoq(quarters, idx, field) {
    if (idx <= 0) return null;
    return this.calcGrowth(quarters[idx][field], quarters[idx - 1][field]);
  },

  yoy(quarters, idx, field) {
    if (idx < 4) return null;
    return this.calcGrowth(quarters[idx][field], quarters[idx - 4][field]);
  },

  // === ヘッダー・ナビゲーション ===

  renderHeader(quarter) {
    document.getElementById('headerMeta').textContent =
      quarter.label + (quarter.isOutlook ? '（ガイダンス）' : '');
    document.title = `NVIDIA ${quarter.label} 四半期詳細`;
    document.getElementById('currentLabel').textContent = quarter.label;
  },

  renderNav(quarters, idx) {
    const prevLink = document.getElementById('prevLink');
    const nextLink = document.getElementById('nextLink');

    if (idx > 0) {
      const prev = quarters[idx - 1];
      prevLink.href = `quarter.html?fy=${prev.fy}&q=${prev.q}`;
      prevLink.textContent = `\u2190 ${prev.label}`;
      prevLink.classList.remove('disabled');
    }

    if (idx < quarters.length - 1) {
      const next = quarters[idx + 1];
      nextLink.href = `quarter.html?fy=${next.fy}&q=${next.q}`;
      nextLink.textContent = `${next.label} \u2192`;
      nextLink.classList.remove('disabled');
    }
  },

  // === KPIサマリー（該当四半期のハイライト） ===

  renderKPI(quarters, idx) {
    const d = quarters[idx];
    const grid = document.getElementById('kpiGrid');

    const items = [
      {
        label: '売上高', value: this.fmtMoney(d.revenue),
        sub1: `QoQ ${this.fmtChange(this.qoq(quarters, idx, 'revenue'))}`,
        sub2: `YoY ${this.fmtChange(this.yoy(quarters, idx, 'revenue'))}`
      },
      {
        label: '粗利益', value: this.fmtMoney(d.grossProfit),
        sub1: `粗利率 ${this.fmtPct(d.revenue ? d.grossProfit / d.revenue * 100 : null)}`,
        sub2: `YoY ${this.fmtChange(this.yoy(quarters, idx, 'grossProfit'))}`
      },
      {
        label: '営業利益', value: this.fmtMoney(d.operatingIncome),
        sub1: `営業利益率 ${this.fmtPct(d.revenue ? d.operatingIncome / d.revenue * 100 : null)}`,
        sub2: `YoY ${this.fmtChange(this.yoy(quarters, idx, 'operatingIncome'))}`
      },
      {
        label: '純利益', value: this.fmtMoney(d.netIncome),
        sub1: `純利益率 ${this.fmtPct(d.revenue ? d.netIncome / d.revenue * 100 : null)}`,
        sub2: `YoY ${this.fmtChange(this.yoy(quarters, idx, 'netIncome'))}`
      },
      {
        label: 'EPS', value: d.eps != null ? '$' + d.eps.toFixed(2) : '---',
        sub1: `QoQ ${this.fmtChange(this.qoq(quarters, idx, 'eps'))}`,
        sub2: `YoY ${this.fmtChange(this.yoy(quarters, idx, 'eps'))}`
      },
      {
        label: '株価', value: d.price != null ? '$' + d.price.toFixed(2) : '---',
        sub1: d.priceDate ? `${d.priceDate}時点` : '',
        sub2: (() => {
          if (idx < 3 || d.price == null) return '';
          let epsSum = 0;
          for (let i = idx; i > idx - 4 && i >= 0; i--) epsSum += (quarters[i].eps || 0);
          return epsSum > 0 ? `PER ${(d.price / epsSum).toFixed(1)}x` : '';
        })()
      }
    ];

    grid.innerHTML = items.map(item => `
      <div class="kpi-item">
        <div class="kpi-value">${item.value}</div>
        <div class="kpi-label">${item.label}</div>
        <div class="kpi-change">${item.sub1}</div>
        <div class="kpi-change">${item.sub2}</div>
      </div>
    `).join('');
  },

  // === P/L詳細テーブル ===

  renderPLTable(quarters, idx) {
    const d = quarters[idx];
    const container = document.getElementById('plTableContainer');

    const rows = [
      { label: '売上高', field: 'revenue', isTotal: true },
      { label: '売上原価', field: 'costOfRevenue', indent: true },
      { label: '粗利益', field: 'grossProfit', isTotal: true },
      { label: 'R&D（研究開発費）', field: 'researchAndDevelopment', indent: true },
      { label: 'SGA（販管費）', field: 'sga', indent: true },
      { label: '営業利益', field: 'operatingIncome', isTotal: true },
      { label: '営業外収支', field: 'nonOperatingIncome', indent: true },
      { label: '純利益', field: 'netIncome', isTotal: true },
      { label: 'EPS（希薄化後）', field: 'eps' }
    ];

    let html = `<table class="pl-detail-table">
      <thead><tr>
        <th style="text-align:left;">項目</th>
        <th>金額</th>
        <th>対売上比</th>
        <th>前期比 (QoQ)</th>
        <th>前年比 (YoY)</th>
      </tr></thead><tbody>`;

    for (const row of rows) {
      const val = d[row.field];
      const cls = row.isTotal ? 'total-row' : row.indent ? 'sub-row' : '';

      let ratio = '---';
      if (d.revenue && val != null && row.field !== 'eps' && row.field !== 'revenue') {
        ratio = this.fmtPct(val / d.revenue * 100);
      } else if (row.field === 'revenue') {
        ratio = '100%';
      }

      const amount = row.field === 'eps'
        ? (val != null ? '$' + val.toFixed(2) : '---')
        : this.fmtTableMoney(val);

      html += `<tr class="${cls}">
        <td>${row.label}</td>
        <td>${amount}</td>
        <td>${ratio}</td>
        <td>${this.fmtChange(this.qoq(quarters, idx, row.field))}</td>
        <td>${this.fmtChange(this.yoy(quarters, idx, row.field))}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  },

  // === P/Lウォーターフォールチャート ===

  createWaterfallChart(ctx, quarter) {
    const d = quarter;
    if (!d.revenue) return;

    const labels = ['売上高', '売上原価', '粗利益', 'R&D', 'SGA', '営業利益', '営業外', '純利益'];
    const positiveColor = 'rgba(90, 158, 111, 0.8)';
    const negativeColor = 'rgba(201, 107, 126, 0.8)';
    const totalColor = 'rgba(61, 107, 74, 0.9)';

    const floating = [];
    const colors = [];

    // 売上高
    floating.push([0, d.revenue]); colors.push(totalColor);
    // 売上原価
    floating.push([d.grossProfit, d.revenue]); colors.push(negativeColor);
    // 粗利益
    floating.push([0, d.grossProfit]); colors.push(totalColor);
    // R&D
    let afterRD = d.grossProfit - d.researchAndDevelopment;
    floating.push([afterRD, d.grossProfit]); colors.push(negativeColor);
    // SGA
    let afterSGA = afterRD - (d.sga || 0);
    floating.push([afterSGA, afterRD]); colors.push(negativeColor);
    // 営業利益
    floating.push([0, d.operatingIncome]); colors.push(totalColor);
    // 営業外収支
    const nonOp = d.nonOperatingIncome || 0;
    if (nonOp >= 0) {
      floating.push([d.operatingIncome, d.operatingIncome + nonOp]); colors.push(positiveColor);
    } else {
      floating.push([d.operatingIncome + nonOp, d.operatingIncome]); colors.push(negativeColor);
    }
    // 純利益
    floating.push([0, d.netIncome]); colors.push(totalColor);

    new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: floating, backgroundColor: colors, borderRadius: 3, barPercentage: 0.7 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const [low, high] = context.raw;
                return `$${(high - low).toLocaleString()}M`;
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'B' } }
        }
      }
    });
  },

  // === 決算資料リンク ===

  renderFilings(irLinks, fy, q) {
    const container = document.getElementById('filingsContainer');
    const fyKey = `FY${fy}`;
    const qNames = ['First', 'Second', 'Third', 'Fourth'];
    const quarterName = `${qNames[q - 1]} Quarter ${fy}`;

    const fyData = irLinks[fyKey];
    if (!fyData) {
      container.innerHTML = '<p style="color:#888;font-size:0.85rem;">この四半期の決算資料はありません。</p>';
      return;
    }

    const qData = fyData.find(item => item.quarter === quarterName);
    if (!qData || !qData.documents || qData.documents.length === 0) {
      container.innerHTML = '<p style="color:#888;font-size:0.85rem;">この四半期の決算資料はありません。</p>';
      return;
    }

    const links = qData.documents.map(doc =>
      `<a href="${doc.url}" target="_blank" rel="noopener" class="filing-link" title="${doc.description || doc.name}">${doc.name}</a>`
    ).join('');
    container.innerHTML = `<div class="filings-links">${links}</div>`;
  },

  // === エラー表示 ===

  showError(title, text) {
    document.getElementById('errorContainer').style.display = 'block';
    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorText').textContent = text;
  },

  // === メインエントリポイント ===

  init() {
    const { fy, q } = this.getParams();

    if (isNaN(fy) || isNaN(q) || q < 1 || q > 4) {
      this.showError('パラメータエラー', '有効な四半期を指定してください（例: ?fy=2026&q=3）');
      return;
    }

    Promise.all([
      fetch('data.json').then(r => r.json()),
      fetch('ir-links.json').then(r => r.json())
    ]).then(([data, irLinks]) => {
      const allQuarters = data.quarters;
      const idx = this.findIndex(allQuarters, fy, q);

      if (idx < 0) {
        this.showError('データなし', `FY${fy} Q${q} のデータが見つかりません。`);
        return;
      }

      const d = allQuarters[idx];

      // メインコンテンツ表示
      document.getElementById('mainContent').style.display = 'block';
      document.getElementById('sectionNav').style.display = 'block';

      if (d.isOutlook) {
        document.getElementById('outlookBanner').style.display = 'block';
      }

      // ヘッダー・ナビ
      this.renderHeader(d);
      this.renderNav(allQuarters, idx);

      // KPIサマリー（該当四半期のハイライト）
      this.renderKPI(allQuarters, idx);

      // P/L詳細テーブル
      this.renderPLTable(allQuarters, idx);

      // ウォーターフォールチャート
      if (d.revenue && !d.isOutlook) {
        this.createWaterfallChart(
          document.getElementById('waterfallChart').getContext('2d'), d
        );
      } else {
        document.getElementById('waterfallContainer').style.display = 'none';
      }

      // === 時系列チャート（ChartBuilderを再利用） ===
      // 選択四半期までのデータを切り出す
      const slicedData = {
        ...data,
        quarters: allQuarters.slice(0, idx + 1)
      };

      // A. 収益全体像
      ChartBuilder.createPLChart(document.getElementById('plChart'), slicedData);
      ChartBuilder.createMarginChart(document.getElementById('marginChart'), slicedData);
      ChartBuilder.createGrowthChart(document.getElementById('growthChart'), slicedData);
      ChartBuilder.createCostChart(document.getElementById('costChart'), slicedData);

      // B. 財務基盤
      ChartBuilder.createBalanceSheetChart(document.getElementById('balanceSheetChart'), slicedData);
      ChartBuilder.createCashFlowChart(document.getElementById('cashFlowChart'), slicedData);

      // C. 株式市場評価
      ChartBuilder.createPricePERChart(document.getElementById('pricePERChart'), slicedData);
      ChartBuilder.createValuationChart(document.getElementById('valuationChart'), slicedData);

      // D. セグメント分析
      ChartBuilder.createSegmentRevenueChart(document.getElementById('segmentRevenueChart'), slicedData);
      ChartBuilder.createSegmentCompositionChart(document.getElementById('segmentCompositionChart'), slicedData);
      ChartBuilder.createSegmentProfitChart(document.getElementById('segmentProfitChart'), slicedData);
      ChartBuilder.createSegmentMarginChart(document.getElementById('segmentMarginChart'), slicedData);

      // E. 投資ポートフォリオ
      ChartBuilder.createInvestmentChart(document.getElementById('investmentChart'), slicedData);

      // 決算資料リンク
      this.renderFilings(irLinks, fy, q);

    }).catch(err => {
      console.error(err);
      this.showError('読み込みエラー', 'データの読み込みに失敗しました。');
    });
  }
};

document.addEventListener('DOMContentLoaded', () => QuarterDetail.init());
