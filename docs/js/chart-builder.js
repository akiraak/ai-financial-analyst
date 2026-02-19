// 共通チャート生成ロジック
// data.json を受け取り、4種類のグラフを描画する

const ChartBuilder = {
  // 共通の四半期ラベル配列を生成
  getLabels(quarters) {
    return quarters.map(q => q.label.replace('FY', ''));
  },

  // 実績四半期のみ取得（Outlook/予想を除外）
  getActualQuarters(quarters) {
    return quarters.filter(q => !q.isOutlook);
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
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

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

  // === 2. セグメント別売上（積み上げ棒グラフ）===
  createSegmentRevenueChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Data Center',
            data: q.map(d => d.segments?.dataCenter ?? null),
            backgroundColor: this.makeColors('rgba(30, 136, 229, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(30, 136, 229, 1)', q),
            borderWidth: 1,
          },
          {
            label: 'Gaming',
            data: q.map(d => d.segments?.gaming ?? null),
            backgroundColor: this.makeColors('rgba(76, 175, 80, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(76, 175, 80, 1)', q),
            borderWidth: 1,
          },
          {
            label: 'Professional Visualization',
            data: q.map(d => d.segments?.professionalVisualization ?? null),
            backgroundColor: this.makeColors('rgba(255, 183, 77, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(255, 183, 77, 1)', q),
            borderWidth: 1,
          },
          {
            label: 'Automotive',
            data: q.map(d => d.segments?.automotive ?? null),
            backgroundColor: this.makeColors('rgba(156, 39, 176, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(156, 39, 176, 1)', q),
            borderWidth: 1,
          },
          {
            label: 'OEM & Other',
            data: q.map(d => d.segments?.oem ?? null),
            backgroundColor: this.makeColors('rgba(158, 158, 158, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(158, 158, 158, 1)', q),
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'セグメント別売上（百万ドル）', font: { size: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y?.toLocaleString()}M`,
            },
          },
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'B' },
          },
        },
      },
    });
  },

  // === 3. セグメント構成比（100%積み上げ棒グラフ）===
  createSegmentCompositionChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

    // 各セグメントの売上比率を算出
    const pct = (d, key) => {
      if (!d.segments || !d.revenue) return null;
      const val = d.segments[key];
      return val != null ? val / d.revenue * 100 : null;
    };

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Data Center',
            data: q.map(d => pct(d, 'dataCenter')),
            backgroundColor: 'rgba(30, 136, 229, 0.7)',
            borderColor: 'rgba(30, 136, 229, 1)',
            borderWidth: 1,
          },
          {
            label: 'Gaming',
            data: q.map(d => pct(d, 'gaming')),
            backgroundColor: 'rgba(76, 175, 80, 0.7)',
            borderColor: 'rgba(76, 175, 80, 1)',
            borderWidth: 1,
          },
          {
            label: 'Professional Visualization',
            data: q.map(d => pct(d, 'professionalVisualization')),
            backgroundColor: 'rgba(255, 183, 77, 0.7)',
            borderColor: 'rgba(255, 183, 77, 1)',
            borderWidth: 1,
          },
          {
            label: 'Automotive',
            data: q.map(d => pct(d, 'automotive')),
            backgroundColor: 'rgba(156, 39, 176, 0.7)',
            borderColor: 'rgba(156, 39, 176, 1)',
            borderWidth: 1,
          },
          {
            label: 'OEM & Other',
            data: q.map(d => pct(d, 'oem')),
            backgroundColor: 'rgba(158, 158, 158, 0.7)',
            borderColor: 'rgba(158, 158, 158, 1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'セグメント構成比', font: { size: 16 } },
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
            max: 100,
            ticks: { callback: v => v + '%' },
          },
        },
      },
    });
  },

  // === 4. 利益率推移（折れ線グラフ）===
  createMarginChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

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

  // === 5. 株価 & PER（複合チャート）===
  createPricePERChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

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

  // === 6. 成長率推移（前年同期比）===
  createGrowthChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

    // YoY成長率を計算（4四半期前と比較）
    const yoyGrowth = (metric) => q.map((d, i) => {
      if (i < 4) return null;
      const prev = q[i - 4][metric];
      const curr = d[metric];
      if (!prev || !curr) return null;
      return (curr / prev - 1) * 100;
    });

    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '売上高 YoY',
            data: yoyGrowth('revenue'),
            borderColor: 'rgba(76, 175, 80, 1)',
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            borderWidth: 2, tension: 0.3, pointRadius: 3,
          },
          {
            label: '営業利益 YoY',
            data: yoyGrowth('operatingIncome'),
            borderColor: 'rgba(255, 152, 0, 1)',
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            borderWidth: 2, tension: 0.3, pointRadius: 3,
          },
          {
            label: '純利益 YoY',
            data: yoyGrowth('netIncome'),
            borderColor: 'rgba(156, 39, 176, 1)',
            backgroundColor: 'rgba(156, 39, 176, 0.1)',
            borderWidth: 2, tension: 0.3, pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: '成長率推移（前年同期比）', font: { size: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`,
            },
          },
          annotation: {
            annotations: {
              zeroLine: {
                type: 'line',
                yMin: 0, yMax: 0,
                borderColor: 'rgba(0, 0, 0, 0.3)',
                borderWidth: 1,
                borderDash: [5, 5],
              },
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

  // === 7. バリュエーション指標（複合折れ線）===
  createValuationChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

    // PER: 株価 / 直近4Q EPS合計（既存ロジック）
    const per = q.map((d, i) => {
      if (!d.price || i < 3) return null;
      const epsSum = q.slice(i - 3, i + 1).reduce((s, x) => s + (x.eps || 0), 0);
      return epsSum > 0 ? Math.round(d.price / epsSum * 10) / 10 : null;
    });

    // PSR: 時価総額 / 直近4Q売上合計
    const psr = q.map((d, i) => {
      if (!d.price || !d.sharesDiluted || i < 3) return null;
      const revSum = q.slice(i - 3, i + 1).reduce((s, x) => s + (x.revenue || 0), 0);
      if (revSum <= 0) return null;
      const marketCap = d.price * d.sharesDiluted;
      return Math.round(marketCap / revSum * 10) / 10;
    });

    // PBR: 時価総額 / 純資産
    const pbr = q.map(d => {
      if (!d.price || !d.sharesDiluted || !d.balanceSheet?.totalEquity) return null;
      const marketCap = d.price * d.sharesDiluted;
      return Math.round(marketCap / d.balanceSheet.totalEquity * 10) / 10;
    });

    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'PER (倍)',
            data: per,
            borderColor: 'rgba(255, 87, 34, 1)',
            borderWidth: 2, tension: 0.3, pointRadius: 3,
            yAxisID: 'y',
          },
          {
            label: 'PSR (倍)',
            data: psr,
            borderColor: 'rgba(33, 150, 243, 1)',
            borderWidth: 2, tension: 0.3, pointRadius: 3,
            yAxisID: 'y1',
          },
          {
            label: 'PBR (倍)',
            data: pbr,
            borderColor: 'rgba(76, 175, 80, 1)',
            borderWidth: 2, tension: 0.3, pointRadius: 3,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'バリュエーション指標', font: { size: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}x`,
            },
          },
        },
        scales: {
          y: {
            position: 'left',
            beginAtZero: true,
            ticks: { callback: v => v + 'x' },
            title: { display: true, text: 'PER' },
          },
          y1: {
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: { callback: v => v + 'x' },
            title: { display: true, text: 'PSR / PBR' },
          },
        },
      },
    });
  },

  // === 8. B/S概要（棒グラフ）===
  createBalanceSheetChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '総資産',
            data: q.map(d => d.balanceSheet?.totalAssets ?? null),
            backgroundColor: this.makeColors('rgba(33, 150, 243, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(33, 150, 243, 1)', q),
            borderWidth: 1,
          },
          {
            label: '総負債',
            data: q.map(d => d.balanceSheet?.totalLiabilities ?? null),
            backgroundColor: this.makeColors('rgba(239, 83, 80, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(239, 83, 80, 1)', q),
            borderWidth: 1,
          },
          {
            label: '純資産',
            data: q.map(d => d.balanceSheet?.totalEquity ?? null),
            backgroundColor: this.makeColors('rgba(76, 175, 80, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(76, 175, 80, 1)', q),
            borderWidth: 1,
          },
          {
            label: '現金同等物',
            data: q.map(d => d.balanceSheet?.cashAndEquivalents ?? null),
            type: 'line',
            borderColor: 'rgba(255, 152, 0, 1)',
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'B/S概要（百万ドル）', font: { size: 16 } },
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

  // === 9. キャッシュフロー（棒+折れ線複合）===
  createCashFlowChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '営業CF',
            data: q.map(d => d.cashFlow?.operatingCF ?? null),
            backgroundColor: this.makeColors('rgba(76, 175, 80, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(76, 175, 80, 1)', q),
            borderWidth: 1,
          },
          {
            label: '投資CF',
            data: q.map(d => d.cashFlow?.investingCF ?? null),
            backgroundColor: this.makeColors('rgba(239, 83, 80, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(239, 83, 80, 1)', q),
            borderWidth: 1,
          },
          {
            label: '財務CF',
            data: q.map(d => d.cashFlow?.financingCF ?? null),
            backgroundColor: this.makeColors('rgba(255, 152, 0, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(255, 152, 0, 1)', q),
            borderWidth: 1,
          },
          {
            label: 'FCF',
            data: q.map(d => d.cashFlow?.freeCashFlow ?? null),
            type: 'line',
            borderColor: 'rgba(30, 136, 229, 1)',
            backgroundColor: 'rgba(30, 136, 229, 0.1)',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'キャッシュフロー（百万ドル）', font: { size: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y?.toLocaleString()}M`,
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'B' },
          },
        },
      },
    });
  },

  // === 10. 費用構造（積み上げ棒グラフ）===
  createCostChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

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

  // === 11. セグメント営業利益（棒グラフ）===
  createSegmentProfitChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Compute & Networking',
            data: q.map(d => d.segmentProfit?.computeAndNetworking?.operatingIncome ?? null),
            backgroundColor: this.makeColors('rgba(30, 136, 229, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(30, 136, 229, 1)', q),
            borderWidth: 1,
          },
          {
            label: 'Graphics',
            data: q.map(d => d.segmentProfit?.graphics?.operatingIncome ?? null),
            backgroundColor: this.makeColors('rgba(76, 175, 80, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(76, 175, 80, 1)', q),
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'セグメント営業利益（百万ドル）', font: { size: 16 } },
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

  // === 12. セグメント営業利益率（折れ線グラフ）===
  createSegmentMarginChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);
    const cnMargin = q.map(d => {
      const s = d.segmentProfit?.computeAndNetworking;
      if (!s || !s.revenue || s.operatingIncome == null) return null;
      return s.operatingIncome / s.revenue * 100;
    });
    const gfxMargin = q.map(d => {
      const s = d.segmentProfit?.graphics;
      if (!s || !s.revenue || s.operatingIncome == null) return null;
      return s.operatingIncome / s.revenue * 100;
    });
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Compute & Networking',
            data: cnMargin,
            borderColor: 'rgba(30, 136, 229, 1)',
            backgroundColor: 'rgba(30, 136, 229, 0.1)',
            fill: true, tension: 0.3,
            borderWidth: 2, pointRadius: 3,
          },
          {
            label: 'Graphics',
            data: gfxMargin,
            borderColor: 'rgba(76, 175, 80, 1)',
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            fill: true, tension: 0.3,
            borderWidth: 2, pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'セグメント営業利益率', font: { size: 16 } },
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

  // === 13. 投資ポートフォリオ残高推移（棒+折れ線複合）===
  createInvestmentChart(ctx, data) {
    const q = this.getActualQuarters(data.quarters);
    const labels = this.getLabels(q);

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '非上場株式',
            data: q.map(d => d.investments?.nonMarketableBalance ?? null),
            backgroundColor: this.makeColors('rgba(156, 39, 176, 0.7)', q),
            borderColor: this.makeBorderColors('rgba(156, 39, 176, 1)', q),
            borderWidth: 1,
            order: 2,
          },
          {
            label: '上場株式',
            data: q.map(d => d.investments?.publiclyHeldBalance ?? null),
            type: 'line',
            borderColor: 'rgba(255, 152, 0, 1)',
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: '投資ポートフォリオ残高（百万ドル）', font: { size: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y?.toLocaleString()}M`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: v => '$' + (v / 1000).toFixed(1) + 'B' },
          },
        },
      },
    });
  },
};
