// 共通チャート生成ロジック
// data.json を受け取り、4種類のグラフを描画する

const ChartBuilder = {
  // 共通の四半期ラベル配列を生成
  getLabels(quarters) {
    return quarters.map(q => q.label.replace('FY', ''));
  },

  // Outlook四半期のインデックスを取得
  getOutlookIndices(quarters) {
    return quarters.map((q, i) => q.isOutlook ? i : -1).filter(i => i >= 0);
  },

  // 背景色配列を生成（Outlookは半透明）
  makeColors(baseColor, quarters) {
    return quarters.map(q => {
      if (q.isOutlook) {
        // rgba の alpha を 0.4 に
        return baseColor.replace(/[\d.]+\)$/, '0.4)');
      }
      return baseColor;
    });
  },

  // 罫線色配列
  makeBorderColors(baseColor, quarters) {
    return quarters.map(q => {
      if (q.isOutlook) return baseColor.replace(/[\d.]+\)$/, '0.6)');
      return baseColor;
    });
  },

  // === 1. P/L推移（棒グラフ）===
  createPLChart(ctx, data) {
    const labels = this.getLabels(data.quarters);
    const q = data.quarters;

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '売上高',
            data: q.map(d => d.revenue),
            backgroundColor: this.makeColors('rgba(76, 175, 80, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(76, 175, 80, 1)', q),
            borderWidth: 1,
          },
          {
            label: '粗利',
            data: q.map(d => d.grossProfit),
            backgroundColor: this.makeColors('rgba(33, 150, 243, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(33, 150, 243, 1)', q),
            borderWidth: 1,
          },
          {
            label: '営業利益',
            data: q.map(d => d.operatingIncome),
            backgroundColor: this.makeColors('rgba(255, 152, 0, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(255, 152, 0, 1)', q),
            borderWidth: 1,
          },
          {
            label: '純利益',
            data: q.map(d => d.netIncome),
            backgroundColor: this.makeColors('rgba(156, 39, 176, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(156, 39, 176, 1)', q),
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'P/L推移（百万ドル）', font: { size: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y?.toLocaleString()}M`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'B' },
          },
        },
      },
    });
  },

  // === 2. 利益率推移（折れ線グラフ）===
  createMarginChart(ctx, data) {
    const labels = this.getLabels(data.quarters);
    const q = data.quarters;

    const grossMargin = q.map(d => d.revenue ? d.grossProfit / d.revenue * 100 : null);
    const opMargin = q.map(d => d.revenue ? d.operatingIncome / d.revenue * 100 : null);
    const netMargin = q.map(d => d.revenue ? d.netIncome / d.revenue * 100 : null);

    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '粗利率',
            data: grossMargin,
            borderColor: 'rgba(33, 150, 243, 1)',
            backgroundColor: 'rgba(33, 150, 243, 0.1)',
            fill: true, tension: 0.3,
          },
          {
            label: '営業利益率',
            data: opMargin,
            borderColor: 'rgba(255, 152, 0, 1)',
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            fill: true, tension: 0.3,
          },
          {
            label: '純利益率',
            data: netMargin,
            borderColor: 'rgba(156, 39, 176, 1)',
            backgroundColor: 'rgba(156, 39, 176, 0.1)',
            fill: true, tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: '利益率推移', font: { size: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`,
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: v => v + '%' },
          },
        },
      },
    });
  },

  // === 3. 株価 & PER（複合チャート）===
  createPricePERChart(ctx, data) {
    const labels = this.getLabels(data.quarters);
    const q = data.quarters;

    // PER = 株価 / 直近4Q EPS合計
    const per = q.map((d, i) => {
      if (!d.price || i < 3) return null;
      const epsSum = q.slice(i - 3, i + 1).reduce((s, x) => s + (x.eps || 0), 0);
      return epsSum > 0 ? d.price / epsSum : null;
    });

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '株価 ($)',
            data: q.map(d => d.price),
            backgroundColor: this.makeColors('rgba(33, 150, 243, 0.5)', q),
            borderColor: this.makeBorderColors('rgba(33, 150, 243, 1)', q),
            borderWidth: 1,
            yAxisID: 'y',
            order: 2,
          },
          {
            label: 'PER (倍)',
            data: per,
            type: 'line',
            borderColor: 'rgba(255, 87, 34, 1)',
            backgroundColor: 'rgba(255, 87, 34, 0.1)',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            yAxisID: 'y1',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: '株価 & PER', font: { size: 16 } },
        },
        scales: {
          y: {
            position: 'left',
            beginAtZero: true,
            ticks: { callback: v => '$' + v },
            title: { display: true, text: '株価 ($)' },
          },
          y1: {
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: { callback: v => v + 'x' },
            title: { display: true, text: 'PER (倍)' },
          },
        },
      },
    });
  },

  // === 4. 費用構造（積み上げ棒グラフ）===
  createCostChart(ctx, data) {
    const labels = this.getLabels(data.quarters);
    const q = data.quarters;

    // 売上高に対する構成比（%）
    const cor = q.map(d => d.revenue && d.costOfRevenue != null ? d.costOfRevenue / d.revenue * 100 : null);
    const rd = q.map(d => d.revenue && d.researchAndDevelopment != null ? d.researchAndDevelopment / d.revenue * 100 : null);
    const sga = q.map(d => d.revenue && d.sga != null ? d.sga / d.revenue * 100 : null);

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '売上原価',
            data: cor,
            backgroundColor: 'rgba(239, 83, 80, 0.7)',
            borderColor: 'rgba(239, 83, 80, 1)',
            borderWidth: 1,
          },
          {
            label: '研究開発費',
            data: rd,
            backgroundColor: 'rgba(255, 152, 0, 0.7)',
            borderColor: 'rgba(255, 152, 0, 1)',
            borderWidth: 1,
          },
          {
            label: 'その他販管費',
            data: sga,
            backgroundColor: 'rgba(255, 213, 79, 0.7)',
            borderColor: 'rgba(255, 213, 79, 1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: '費用構造（対売上比率）', font: { size: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`,
            },
          },
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            ticks: { callback: v => v + '%' },
            title: { display: true, text: '売上高に対する比率' },
          },
        },
      },
    });
  },
};
