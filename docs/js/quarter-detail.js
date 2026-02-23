// quarter-detail.js — 四半期詳細ページのロジック
// ./data.json + analysis-text.json を読み込み、KPIサマリー + 11チャート + 分析テキストを描画する

const QuarterDetail = {

  // === ユーティリティ ===

  fmtMoney(val) {
    if (val == null) return '---';
    const abs = Math.abs(val);
    if (abs >= 1000) return (val < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(1) + 'B';
    return (val < 0 ? '-' : '') + '$' + abs.toLocaleString() + 'M';
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
    document.title = `${document.querySelector('h1')?.textContent?.trim() || ''} ${quarter.label} 四半期詳細`;
    document.getElementById('currentLabel').textContent = quarter.label;
    // パンくずナビの四半期ラベル
    const bc = document.getElementById('breadcrumbQuarter');
    if (bc) bc.textContent = quarter.label;
  },

  renderNav(prevPage, nextPage) {
    const prevLink = document.getElementById('prevLink');
    const nextLink = document.getElementById('nextLink');

    if (prevPage) {
      prevLink.href = `../${prevPage.fy}Q${prevPage.q}/`;
      prevLink.textContent = `\u2190 ${prevPage.label}`;
      prevLink.classList.remove('disabled');
    }

    if (nextPage) {
      nextLink.href = `../${nextPage.fy}Q${nextPage.q}/`;
      nextLink.textContent = `${nextPage.label} \u2192`;
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

  // === 分析テキストの挿入 ===

  renderAnalysisText(analysisData, quarterKey) {
    const overviews = analysisData.overviews || {};
    const qData = (analysisData.quarters || {})[quarterKey] || {};
    const charts = qData.charts || {};

    // チャート概要・解説の挿入
    const chartIds = [
      'plChart', 'marginChart', 'costChart',
      'balanceSheetChart', 'cashFlowChart',
      'pricePERChart', 'valuationChart',
      'segmentRevenueChart', 'segmentCompositionChart',
      'segmentProfitChart', 'segmentMarginChart',
      'investmentChart'
    ];

    for (const id of chartIds) {
      const el = document.getElementById(id + '-desc');
      if (!el) continue;

      const overview = overviews[id];
      const analysis = charts[id];

      let html = '';
      if (overview) {
        html += `<p><span class="label">概要:</span> ${overview}</p>`;
      }
      if (analysis) {
        html += `<p class="insight"><span class="label">解説:</span> ${analysis}</p>`;
      }
      el.innerHTML = html;
    }

    // 決算サマリーの挿入（KPIセクションと統合）
    const title = document.getElementById('summaryTitle');
    const content = document.getElementById('summaryContent');
    if (title) {
      title.textContent = quarterKey.replace(/(\d{4})Q(\d)/, 'FY$1 Q$2') + ' 決算サマリー';
    }
    if (content && qData.summary && qData.summary.length > 0) {
      // type付き項目（定性情報）と通常項目（数値分析）を分離
      const qualitative = qData.summary.filter(item => item.type === 'qualitative');
      const financial = qData.summary.filter(item => !item.type);

      let html = '';

      // 定性情報セクション
      for (const item of qualitative) {
        const body = item.items
          ? '<ul>' + item.items.map(li => `<li>${li}</li>`).join('') + '</ul>'
          : `<p>${item.text}</p>`;
        html += `<div class="summary-block">
          <div class="summary-label">${item.label}</div>
          ${body}
        </div>`;
      }

      // 数値分析セクション
      if (financial.length > 0) {
        html += '<div class="summary-financial">';
        html += financial.map(item =>
          `<p><span class="label">${item.label}:</span> ${item.text}</p>`
        ).join('');
        html += '</div>';
      }

      content.innerHTML = html;
    }

    // 投資コミットメントの挿入
    if (qData.investmentCommitments) {
      const ic = qData.investmentCommitments;
      const section = document.getElementById('investmentCommitmentsSection');
      const title = document.getElementById('investmentCommitmentsTitle');
      const content = document.getElementById('investmentCommitmentsContent');

      title.textContent = `投資コミットメント（${quarterKey.replace(/(\d{4})Q(\d)/, 'FY$1 Q$2')}時点）`;

      let html = '';

      // KPIグリッド
      if (ic.kpis && ic.kpis.length > 0) {
        html += '<div class="kpi-grid">';
        for (const kpi of ic.kpis) {
          html += `<div class="kpi-item">
            <div class="kpi-value">${kpi.value}</div>
            <div class="kpi-label">${kpi.label}</div>
            <div class="kpi-sub">${kpi.sub}</div>
          </div>`;
        }
        html += '</div>';
      }

      // コミットメント一覧
      html += '<div class="chart-description">';
      if (ic.commitments && ic.commitments.length > 0) {
        html += '<p><span class="label">主要コミットメント:</span></p>';
        for (const c of ic.commitments) {
          html += `<p><strong>${c.name}</strong> — ${c.detail}</p>`;
        }
      }
      if (ic.note) {
        html += `<p class="insight"><span class="label">補足:</span> ${ic.note}</p>`;
      }
      html += '</div>';

      content.innerHTML = html;
      section.style.display = '';
    }
  },

  // === 財務データテーブル ===

  renderFinancialTable(quarters) {
    const tbl = document.getElementById('financialTable');
    if (!tbl) return;

    const q = quarters;
    // フォーマットヘルパー
    const fmt = v => v != null ? '$' + v.toLocaleString() : '—';
    const pct = (a, b) => (a != null && b) ? (a / b * 100).toFixed(1) + '%' : '—';
    const ratio = (a, b) => (a != null && b != null && b !== 0) ? (a / b * 100).toFixed(1) + '%' : '—';
    const growth = (a, b) => (a != null && b != null && b !== 0) ? ((a / b - 1) * 100).toFixed(1) + '%' : '—';
    const dlr = v => v != null ? '$' + v.toFixed(2) : '—';
    const num = v => v != null ? v.toFixed(1) + 'x' : '—';

    // 全項目定義（Excelの行順序に準拠）
    // cat: revenue(緑), profit(青), expense(橙), stock(紫) / sub: 小項目（薄い背景）
    const rows = [
      { label: '売上高', cat: 'revenue', fn: (d, i) => fmt(d.revenue) },
      { label: '前期比', cat: 'revenue', sub: true, fn: (d, i) => i > 0 && d.revenue != null && q[i-1].revenue ? ratio(d.revenue, q[i-1].revenue) : '—' },
      { label: '前年比', cat: 'revenue', sub: true, fn: (d, i) => i >= 4 && d.revenue != null && q[i-4].revenue ? ratio(q[i-4].revenue, d.revenue) : '—' },
      { label: '粗利益', cat: 'profit', fn: (d, i) => fmt(d.grossProfit) },
      { label: '粗利率', cat: 'profit', sub: true, fn: (d, i) => pct(d.grossProfit, d.revenue) },
      { label: '粗利 前年比', cat: 'profit', sub: true, fn: (d, i) => i >= 4 && d.grossProfit != null && q[i-4].grossProfit ? ratio(d.grossProfit, q[i-4].grossProfit) : '—' },
      { label: 'R&D', cat: 'expense', fn: (d, i) => fmt(d.researchAndDevelopment) },
      { label: 'R&D 売上比', cat: 'expense', sub: true, fn: (d, i) => pct(d.researchAndDevelopment, d.revenue) },
      { label: 'その他販管費', cat: 'expense', fn: (d, i) => fmt(d.sga) },
      { label: '販管費 売上比', cat: 'expense', sub: true, fn: (d, i) => pct(d.sga, d.revenue) },
      { label: '販管費合計', cat: 'expense', fn: (d, i) => fmt(d.totalOperatingExpenses) },
      { label: '販管費 売上比', cat: 'expense', sub: true, fn: (d, i) => pct(d.totalOperatingExpenses, d.revenue) },
      { label: '販管費 前年比', cat: 'expense', sub: true, fn: (d, i) => i >= 4 && d.totalOperatingExpenses != null && q[i-4].totalOperatingExpenses ? ratio(d.totalOperatingExpenses, q[i-4].totalOperatingExpenses) : '—' },
      { label: '営業利益', cat: 'profit', fn: (d, i) => fmt(d.operatingIncome) },
      { label: '営業利益率', cat: 'profit', sub: true, fn: (d, i) => pct(d.operatingIncome, d.revenue) },
      { label: '営業利益 前年比', cat: 'profit', sub: true, fn: (d, i) => i >= 4 ? growth(d.operatingIncome, q[i-4].operatingIncome) : '—' },
      { label: '営業外収支', cat: 'profit', fn: (d, i) => d.nonOperatingIncome != null ? fmt(d.nonOperatingIncome) : '—' },
      { label: '純利益', cat: 'profit', fn: (d, i) => fmt(d.netIncome) },
      { label: '純利益率', cat: 'profit', sub: true, fn: (d, i) => pct(d.netIncome, d.revenue) },
      { label: '純利益 前年比', cat: 'profit', sub: true, fn: (d, i) => i >= 4 ? growth(d.netIncome, q[i-4].netIncome) : '—' },
      { label: 'EPS', cat: 'stock', fn: (d, i) => dlr(d.eps) },
      { label: 'PER', cat: 'stock', sub: true, fn: (d, i) => {
        if (i < 3 || d.price == null) return '—';
        const epsSum = q.slice(i-3, i+1).reduce((s, x) => s + (x.eps || 0), 0);
        return epsSum > 0 ? num(d.price / epsSum) : '—';
      }},
      { label: 'PER 4Q平均', cat: 'stock', sub: true, fn: (d, i) => {
        if (i < 6 || d.price == null) return '—';
        const pers = [];
        for (let j = i - 3; j <= i; j++) {
          if (j < 3 || q[j].price == null) continue;
          const es = q.slice(j-3, j+1).reduce((s, x) => s + (x.eps || 0), 0);
          if (es > 0) pers.push(q[j].price / es);
        }
        return pers.length >= 2 ? num(pers.reduce((a, b) => a + b) / pers.length) : '—';
      }},
      { label: '株価', cat: 'stock', fn: (d, i) => dlr(d.price) },
    ];

    // ヘッダー（2行: 年度 + 四半期）
    const thead = tbl.createTHead();
    // 行1: 年度ヘッダー（colspan）
    const fyRow = thead.insertRow();
    const fyCorner = document.createElement('th');
    fyCorner.rowSpan = 2;
    fyRow.appendChild(fyCorner);
    const fyGroups = [];
    q.forEach(d => {
      const last = fyGroups[fyGroups.length - 1];
      if (last && last.fy === d.fy) { last.count++; }
      else { fyGroups.push({ fy: d.fy, count: 1 }); }
    });
    fyGroups.forEach(g => {
      const th = document.createElement('th');
      th.textContent = g.fy;
      th.colSpan = g.count;
      th.style.textAlign = 'center';
      fyRow.appendChild(th);
    });
    // 行2: 四半期ラベル
    const qRow = thead.insertRow();
    q.forEach(d => {
      const th = document.createElement('th');
      th.textContent = d.isOutlook ? 'Q' + d.q + '予想' : 'Q' + d.q;
      if (d.isOutlook) th.classList.add('outlook');
      qRow.appendChild(th);
    });
    // データ行
    const tbody = tbl.createTBody();
    rows.forEach(r => {
      const tr = tbody.insertRow();
      tr.className = 'cat-' + r.cat + (r.sub ? ' sub' : '');
      tr.insertCell().textContent = r.label;
      q.forEach((d, i) => {
        const td = tr.insertCell();
        td.textContent = r.fn(d, i);
        if (d.isOutlook) td.classList.add('outlook');
      });
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

  // === メインエントリポイント ===

  init() {
    Promise.all([
      fetch('./data.json').then(r => r.json()),
      fetch('../../ir-links.json').then(r => r.ok ? r.json() : {}),
      fetch('../../analysis-text.json').then(r => r.ok ? r.json() : {})
    ]).then(([data, irLinks, analysisData]) => {
      const quarters = data.quarters;
      const idx = quarters.length - 1;
      const d = quarters[idx];
      const quarterKey = `${d.fy}Q${d.q}`;

      // Outlookバナー
      if (d.isOutlook) {
        document.getElementById('outlookBanner').style.display = 'block';
      }

      // ヘッダー・ナビ
      this.renderHeader(d);
      this.renderNav(data.prevPage, data.nextPage);

      // KPIサマリー
      this.renderKPI(quarters, idx);

      // 財務データテーブル
      this.renderFinancialTable(quarters);

      // 分析テキスト（概要・解説・サマリー・投資コミットメント）
      this.renderAnalysisText(analysisData, quarterKey);

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

      // データが無いセクションは非表示にする
      const hasSegmentProfit = quarters.some(d => d.segmentProfit != null);
      const hasInvestments = quarters.some(d => d.investments != null);

      if (hasSegmentProfit) {
        ChartBuilder.createSegmentProfitChart(document.getElementById('segmentProfitChart'), data);
        ChartBuilder.createSegmentMarginChart(document.getElementById('segmentMarginChart'), data);
      } else {
        document.getElementById('segmentProfitChart').closest('.section').style.display = 'none';
        document.getElementById('segmentMarginChart').closest('.section').style.display = 'none';
      }

      // E. 投資ポートフォリオ
      if (hasInvestments) {
        ChartBuilder.createInvestmentChart(document.getElementById('investmentChart'), data);
      } else {
        document.getElementById('investmentChart').closest('.section').style.display = 'none';
      }

      // 決算資料リンク
      this.renderFilings(irLinks, d.fy, d.q);

    }).catch(err => {
      console.error('ページ初期化エラー:', err);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => QuarterDetail.init());
