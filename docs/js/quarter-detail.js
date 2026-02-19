// quarter-detail.js — 四半期詳細ページのロジック
// ./data.json を読み込み、KPIサマリー + ChartBuilderの11チャートを描画する
// data.json には currentQuarter と、その四半期までの全quartersが含まれる

const QuarterDetail = {

  // === ユーティリティ ===

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
      prevLink.href = `../${prev.fy}Q${prev.q}/`;
      prevLink.textContent = `\u2190 ${prev.label}`;
      prevLink.classList.remove('disabled');
    }

    // 次の四半期はdata.jsonに含まれないので、全体data.jsonから判定
    // currentQuarterの次を計算
    const curr = quarters[idx];
    const nextFy = curr.q === 4 ? curr.fy + 1 : curr.fy;
    const nextQ = curr.q === 4 ? 1 : curr.q + 1;
    // 次のフォルダが存在するかfetchで確認せず、リンクだけ設定（存在しなければ404）
    // ただしOutlook(最後)の場合は次がないので非表示
    if (!curr.isOutlook) {
      nextLink.href = `../${nextFy}Q${nextQ}/`;
      nextLink.textContent = `FY${nextFy} Q${nextQ} \u2192`;
      nextLink.classList.remove('disabled');
    }
  },

  // === KPIサマリー ===

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

  // === メインエントリポイント ===

  init() {
    Promise.all([
      fetch('./data.json').then(r => r.json()),
      fetch('../../ir-links.json').then(r => r.json())
    ]).then(([data, irLinks]) => {
      const quarters = data.quarters;
      const idx = quarters.length - 1; // 最後の四半期が「この四半期」
      const d = quarters[idx];

      // Outlookバナー
      if (d.isOutlook) {
        document.getElementById('outlookBanner').style.display = 'block';
      }

      // ヘッダー・ナビ
      this.renderHeader(d);
      this.renderNav(quarters, idx);

      // KPIサマリー
      this.renderKPI(quarters, idx);

      // === 時系列チャート（ChartBuilderを再利用） ===
      // A. 収益全体像
      ChartBuilder.createPLChart(document.getElementById('plChart'), data);
      ChartBuilder.createMarginChart(document.getElementById('marginChart'), data);
      ChartBuilder.createCostChart(document.getElementById('costChart'), data);

      // B. 財務基盤
      ChartBuilder.createBalanceSheetChart(document.getElementById('balanceSheetChart'), data);
      ChartBuilder.createCashFlowChart(document.getElementById('cashFlowChart'), data);

      // C. 株式市場評価
      ChartBuilder.createPricePERChart(document.getElementById('pricePERChart'), data);
      ChartBuilder.createValuationChart(document.getElementById('valuationChart'), data);

      // D. セグメント分析
      ChartBuilder.createSegmentRevenueChart(document.getElementById('segmentRevenueChart'), data);
      ChartBuilder.createSegmentCompositionChart(document.getElementById('segmentCompositionChart'), data);
      ChartBuilder.createSegmentProfitChart(document.getElementById('segmentProfitChart'), data);
      ChartBuilder.createSegmentMarginChart(document.getElementById('segmentMarginChart'), data);

      // E. 投資ポートフォリオ
      ChartBuilder.createInvestmentChart(document.getElementById('investmentChart'), data);

      // 決算資料リンク
      this.renderFilings(irLinks, d.fy, d.q);

    }).catch(err => {
      console.error(err);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => QuarterDetail.init());
