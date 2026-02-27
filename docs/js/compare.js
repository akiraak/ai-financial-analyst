// 企業比較チャート生成ロジック
// 全10社のdata.jsonを読み込み、6種類の比較チャートとサマリーテーブルを描画する

const CompareChart = {

  // 企業スラッグ一覧
  COMPANIES: [
    'nvidia', 'broadcom', 'alphabet', 'intel', 'meta',
    'palantir', 'tesla', 'apple', 'microsoft', 'tsmc'
  ],

  // 表示名マッピング
  DISPLAY_NAMES: {
    nvidia: 'NVIDIA',
    broadcom: 'Broadcom',
    alphabet: 'Alphabet',
    intel: 'Intel',
    meta: 'Meta',
    palantir: 'Palantir',
    tesla: 'Tesla',
    apple: 'Apple',
    microsoft: 'Microsoft',
    tsmc: 'TSMC',
  },

  // ティッカーマッピング
  TICKERS: {
    nvidia: 'NVDA',
    broadcom: 'AVGO',
    alphabet: 'GOOGL',
    intel: 'INTC',
    meta: 'META',
    palantir: 'PLTR',
    tesla: 'TSLA',
    apple: 'AAPL',
    microsoft: 'MSFT',
    tsmc: 'TSM',
  },

  // 単位正規化テーブル（全社を「百万USD / 百万株」に統一）
  // revMul: 財務数値を百万USDに変換する乗数
  // sharesMul: 希薄化後株式数を百万株に変換する乗数
  // isUSD: USD建て財務データか（falseならUSD金額チャートから除外）
  NORMALIZE: {
    nvidia:    { revMul: 1,     sharesMul: 1,     isUSD: true },
    broadcom:  { revMul: 1,     sharesMul: 1,     isUSD: true },
    alphabet:  { revMul: 1,     sharesMul: 1,     isUSD: true },
    intel:     { revMul: 1,     sharesMul: 1,     isUSD: true },
    meta:      { revMul: 1,     sharesMul: 1,     isUSD: true },
    palantir:  { revMul: 0.001, sharesMul: 0.001, isUSD: true },
    tesla:     { revMul: 1,     sharesMul: 1,     isUSD: true },
    apple:     { revMul: 1,     sharesMul: 0.001, isUSD: true },
    microsoft: { revMul: 1,     sharesMul: 1,     isUSD: true },
    tsmc:      { revMul: 1,     sharesMul: 1,     isUSD: false },
  },

  // 企業カラーパレット（ブランドカラーベース、10色）
  COLORS: {
    nvidia:    { bg: 'rgba(118, 185, 0, 0.75)',  border: 'rgba(118, 185, 0, 1)' },
    broadcom:  { bg: 'rgba(204, 9, 47, 0.75)',   border: 'rgba(204, 9, 47, 1)' },
    alphabet:  { bg: 'rgba(66, 133, 244, 0.75)', border: 'rgba(66, 133, 244, 1)' },
    intel:     { bg: 'rgba(0, 104, 181, 0.75)',  border: 'rgba(0, 104, 181, 1)' },
    meta:      { bg: 'rgba(24, 119, 242, 0.75)', border: 'rgba(24, 119, 242, 1)' },
    palantir:  { bg: 'rgba(16, 16, 16, 0.65)',   border: 'rgba(16, 16, 16, 1)' },
    tesla:     { bg: 'rgba(232, 33, 39, 0.75)',  border: 'rgba(232, 33, 39, 1)' },
    apple:     { bg: 'rgba(100, 100, 100, 0.7)', border: 'rgba(100, 100, 100, 1)' },
    microsoft: { bg: 'rgba(0, 164, 239, 0.75)',  border: 'rgba(0, 164, 239, 1)' },
    tsmc:      { bg: 'rgba(0, 87, 183, 0.75)',   border: 'rgba(0, 87, 183, 1)' },
  },

  // --- データ取得・変換 ---

  // 全社のdata.jsonを並列fetchで読み込み
  async loadAll() {
    const promises = this.COMPANIES.map(slug =>
      fetch('../' + slug + '/data.json')
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(data => ({ slug, data }))
        .catch(() => null)
    );
    const results = await Promise.all(promises);
    return results.filter(Boolean);
  },

  // 各社の最新実績四半期を取得（isOutlook=falseの最後の要素）
  getLatestActual(quarters) {
    const actuals = quarters.filter(q => !q.isOutlook);
    return actuals.length > 0 ? actuals[actuals.length - 1] : null;
  },

  // 前年同期を取得（YoY計算用：4四半期前）
  getYoYQuarter(quarters, latest) {
    const actuals = quarters.filter(q => !q.isOutlook);
    const idx = actuals.findIndex(q => q.fy === latest.fy && q.q === latest.q);
    return idx >= 4 ? actuals[idx - 4] : null;
  },

  // 正規化: 売上・利益等の金額を百万USDに変換
  normalizeFinancial(slug, val) {
    if (val == null) return null;
    return val * this.NORMALIZE[slug].revMul;
  },

  // 正規化: 株式数を百万株に変換
  normalizeShares(slug, val) {
    if (val == null) return null;
    return val * this.NORMALIZE[slug].sharesMul;
  },

  // 時価総額の計算（百万USD）
  calcMarketCap(slug, quarter) {
    const price = quarter.price;
    const shares = this.normalizeShares(slug, quarter.sharesDiluted);
    if (!price || !shares) return null;
    // TSMCはADR価格。1 ADR = 5普通株なので÷5
    if (slug === 'tsmc') return price * shares / 5;
    return price * shares;
  },

  // PER計算（TTM: 直近4四半期のEPS合計を年間EPSとして使用）
  calcPER(slug, quarters) {
    const actuals = quarters.filter(q => !q.isOutlook);
    if (actuals.length < 4) return null;
    const recent4 = actuals.slice(-4);
    const latest = recent4[3];
    if (!latest.price) return null;

    // TSMCはepsADRを使用
    const epsKey = slug === 'tsmc' ? 'epsADR' : 'eps';
    const ttmEps = recent4.reduce((sum, q) => {
      const e = q[epsKey];
      return (e != null) ? sum + e : sum;
    }, 0);

    if (ttmEps <= 0) return null;
    return latest.price / ttmEps;
  },

  // --- チャート共通ヘルパー ---

  // 横棒グラフの共通オプションを生成
  makeHorizontalBarOptions(title, formatCallback) {
    return {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: title, font: { size: 15, weight: 'bold' }, color: '#333' },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) { return formatCallback(ctx.parsed.x); }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: function(v) { return formatCallback(v); } },
          grid: { color: 'rgba(0,0,0,0.06)' }
        },
        y: {
          ticks: { font: { size: 13, weight: '600' }, color: '#333' },
          grid: { display: false }
        }
      }
    };
  },

  // データを値でソート（降順）し、ラベル・値・色の配列を返す
  sortByValue(items) {
    items.sort((a, b) => b.value - a.value);
    return {
      labels: items.map(d => d.ticker),
      values: items.map(d => d.value),
      bgColors: items.map(d => this.COLORS[d.slug].bg),
      borderColors: items.map(d => this.COLORS[d.slug].border),
    };
  },

  // --- サマリーテーブル描画 ---

  renderSummaryTable(companies) {
    const tbody = document.getElementById('summaryBody');
    if (!tbody) return;

    // テーブルデータを構築
    const rows = companies.map(({ slug, data }) => {
      const q = this.getLatestActual(data.quarters);
      if (!q) return null;
      const norm = this.NORMALIZE[slug];
      const rev = norm.isUSD ? this.normalizeFinancial(slug, q.revenue) : null;
      const opInc = norm.isUSD ? this.normalizeFinancial(slug, q.operatingIncome) : null;
      const opMargin = (q.operatingIncome != null && q.revenue)
        ? (q.operatingIncome / q.revenue * 100) : null;
      const mc = this.calcMarketCap(slug, q);
      const per = this.calcPER(slug, data.quarters);
      const yoyQ = this.getYoYQuarter(data.quarters, q);
      const yoyGrowth = (yoyQ && yoyQ.revenue && q.revenue != null)
        ? ((q.revenue - yoyQ.revenue) / yoyQ.revenue * 100) : null;

      return { slug, q, rev, opInc, opMargin, mc, per, yoyGrowth };
    }).filter(Boolean);

    // 時価総額降順でソート
    rows.sort((a, b) => (b.mc || 0) - (a.mc || 0));

    rows.forEach(row => {
      const tr = document.createElement('tr');
      const fmtM = (v) => v != null ? '$' + (v / 1000).toFixed(1) + 'B' : '—';
      const fmtMC = (v) => {
        if (v == null) return '—';
        if (v >= 1000000) return '$' + (v / 1000000).toFixed(2) + 'T';
        return '$' + (v / 1000).toFixed(0) + 'B';
      };
      const fmtPct = (v) => v != null ? v.toFixed(1) + '%' : '—';
      const fmtPER = (v) => v != null ? v.toFixed(1) + 'x' : '—';

      tr.innerHTML = [
        '<td><strong>' + this.TICKERS[row.slug] + '</strong></td>',
        '<td>' + this.DISPLAY_NAMES[row.slug] + '</td>',
        '<td>' + row.q.label + '</td>',
        '<td class="num">' + fmtM(row.rev) + '</td>',
        '<td class="num">' + fmtM(row.opInc) + '</td>',
        '<td class="num">' + fmtPct(row.opMargin) + '</td>',
        '<td class="num">' + fmtMC(row.mc) + '</td>',
        '<td class="num">' + fmtPct(row.yoyGrowth) + '</td>',
        '<td class="num">' + fmtPER(row.per) + '</td>',
      ].join('');
      tbody.appendChild(tr);
    });
  },

  // --- 6チャート生成メソッド ---

  // Chart 1: 時価総額
  createMarketCapChart(ctx, companies) {
    const items = [];
    companies.forEach(({ slug, data }) => {
      const q = this.getLatestActual(data.quarters);
      if (!q) return;
      const mc = this.calcMarketCap(slug, q);
      if (mc != null) items.push({ slug, ticker: this.TICKERS[slug], value: mc });
    });

    const sorted = this.sortByValue(items);
    const options = this.makeHorizontalBarOptions('時価総額', function(v) {
      if (v >= 1000000) return '$' + (v / 1000000).toFixed(2) + 'T';
      if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'B';
      return '$' + v.toFixed(0) + 'M';
    });

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.labels,
        datasets: [{
          data: sorted.values,
          backgroundColor: sorted.bgColors,
          borderColor: sorted.borderColors,
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: options,
    });
  },

  // Chart 2: 売上高（TSMC除外）
  createRevenueChart(ctx, companies) {
    const items = [];
    companies.forEach(({ slug, data }) => {
      if (!this.NORMALIZE[slug].isUSD) return;
      const q = this.getLatestActual(data.quarters);
      if (!q) return;
      const rev = this.normalizeFinancial(slug, q.revenue);
      if (rev != null) items.push({ slug, ticker: this.TICKERS[slug], value: rev });
    });

    const sorted = this.sortByValue(items);
    const options = this.makeHorizontalBarOptions('売上高（百万ドル）', function(v) {
      return '$' + (v / 1000).toFixed(1) + 'B';
    });

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.labels,
        datasets: [{
          data: sorted.values,
          backgroundColor: sorted.bgColors,
          borderColor: sorted.borderColors,
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: options,
    });
  },

  // Chart 3: 営業利益（TSMC除外）
  createOpIncomeChart(ctx, companies) {
    const items = [];
    companies.forEach(({ slug, data }) => {
      if (!this.NORMALIZE[slug].isUSD) return;
      const q = this.getLatestActual(data.quarters);
      if (!q) return;
      const opInc = this.normalizeFinancial(slug, q.operatingIncome);
      if (opInc != null) items.push({ slug, ticker: this.TICKERS[slug], value: opInc });
    });

    const sorted = this.sortByValue(items);
    const options = this.makeHorizontalBarOptions('営業利益（百万ドル）', function(v) {
      return '$' + (v / 1000).toFixed(1) + 'B';
    });
    // 営業利益は負値もあり得るので beginAtZero を外す
    options.scales.x.beginAtZero = false;

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.labels,
        datasets: [{
          data: sorted.values,
          backgroundColor: sorted.bgColors,
          borderColor: sorted.borderColors,
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: options,
    });
  },

  // Chart 4: 営業利益率（全10社、比率は通貨非依存）
  createOpMarginChart(ctx, companies) {
    const items = [];
    companies.forEach(({ slug, data }) => {
      const q = this.getLatestActual(data.quarters);
      if (!q || !q.revenue || q.operatingIncome == null) return;
      const margin = q.operatingIncome / q.revenue * 100;
      items.push({ slug, ticker: this.TICKERS[slug], value: margin });
    });

    const sorted = this.sortByValue(items);
    const options = this.makeHorizontalBarOptions('営業利益率（%）', function(v) {
      return v.toFixed(1) + '%';
    });
    options.scales.x.beginAtZero = false;

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.labels,
        datasets: [{
          data: sorted.values,
          backgroundColor: sorted.bgColors,
          borderColor: sorted.borderColors,
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: options,
    });
  },

  // Chart 5: 売上成長率 YoY（全10社、比率は通貨非依存）
  createRevenueGrowthChart(ctx, companies) {
    const items = [];
    companies.forEach(({ slug, data }) => {
      const q = this.getLatestActual(data.quarters);
      if (!q) return;
      const yoyQ = this.getYoYQuarter(data.quarters, q);
      if (!yoyQ || !yoyQ.revenue || !q.revenue) return;
      const growth = (q.revenue - yoyQ.revenue) / yoyQ.revenue * 100;
      items.push({ slug, ticker: this.TICKERS[slug], value: growth });
    });

    const sorted = this.sortByValue(items);
    const options = this.makeHorizontalBarOptions('売上成長率 YoY（%）', function(v) {
      return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    });
    options.scales.x.beginAtZero = false;

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.labels,
        datasets: [{
          data: sorted.values,
          backgroundColor: sorted.bgColors,
          borderColor: sorted.borderColors,
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: options,
    });
  },

  // Chart 6: PER（EPS負の企業は除外、TSMCはepsADR使用）
  createPERChart(ctx, companies) {
    const items = [];
    companies.forEach(({ slug, data }) => {
      const per = this.calcPER(slug, data.quarters);
      if (per != null) items.push({ slug, ticker: this.TICKERS[slug], value: per });
    });

    const sorted = this.sortByValue(items);
    const options = this.makeHorizontalBarOptions('PER（株価収益率・TTM）', function(v) {
      return v.toFixed(1) + 'x';
    });

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.labels,
        datasets: [{
          data: sorted.values,
          backgroundColor: sorted.bgColors,
          borderColor: sorted.borderColors,
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: options,
    });
  },

  // Chart 7: 営業利益 × PER 散布図（USD建て＆EPS正の企業のみ）
  createOpIncomePERChart(ctx, companies) {
    const self = this;
    const datasets = [];

    companies.forEach(({ slug, data }) => {
      // USD建てかつPER算出可能な企業のみ
      if (!self.NORMALIZE[slug].isUSD) return;
      const q = self.getLatestActual(data.quarters);
      if (!q) return;
      const opInc = self.normalizeFinancial(slug, q.operatingIncome);
      const per = self.calcPER(slug, data.quarters);
      if (opInc == null || per == null) return;

      datasets.push({
        label: self.TICKERS[slug],
        data: [{ x: opInc, y: per }],
        backgroundColor: self.COLORS[slug].bg,
        borderColor: self.COLORS[slug].border,
        borderWidth: 2,
        pointRadius: 8,
        pointHoverRadius: 11,
      });
    });

    // ティッカーラベル描画用プラグイン
    const tickerLabelPlugin = {
      id: 'tickerLabels',
      afterDatasetsDraw: function(chart) {
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.font = 'bold 11px -apple-system, sans-serif';
        ctx2.textBaseline = 'bottom';
        chart.data.datasets.forEach(function(ds, i) {
          var meta = chart.getDatasetMeta(i);
          if (!meta.visible || meta.data.length === 0) return;
          var pt = meta.data[0];
          ctx2.fillStyle = ds.borderColor;
          ctx2.fillText(ds.label, pt.x + 10, pt.y - 4);
        });
        ctx2.restore();
      }
    };

    return new Chart(ctx, {
      type: 'scatter',
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: '営業利益 × PER（収益力と市場評価の関係）',
            font: { size: 15, weight: 'bold' },
            color: '#333',
          },
          legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 16 } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var d = ctx.raw;
                return ctx.dataset.label + ': 営業利益 $' + (d.x / 1000).toFixed(1) + 'B / PER ' + d.y.toFixed(1) + 'x';
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: '営業利益（四半期）', font: { size: 13 } },
            ticks: { callback: function(v) { return '$' + (v / 1000).toFixed(0) + 'B'; } },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          y: {
            title: { display: true, text: 'PER (TTM)', font: { size: 13 } },
            ticks: { callback: function(v) { return v + 'x'; } },
            grid: { color: 'rgba(0,0,0,0.06)' },
          }
        }
      },
      plugins: [tickerLabelPlugin],
    });
  },

  // Chart 8: 営業利益成長率 × PER 散布図（全社、比率は通貨非依存）
  // X軸は最大1000%にクリップし、範囲外の企業はoutOfRange配列で返す
  createOpIncomeGrowthPERChart(ctx, companies) {
    const self = this;
    const datasets = [];
    const outOfRange = []; // X軸範囲外の企業情報
    const X_MAX = 200;

    companies.forEach(({ slug, data }) => {
      const q = self.getLatestActual(data.quarters);
      if (!q) return;
      const per = self.calcPER(slug, data.quarters);
      if (per == null) return;

      // 営業利益YoY成長率の算出
      const yoyQ = self.getYoYQuarter(data.quarters, q);
      if (!yoyQ || yoyQ.operatingIncome == null || q.operatingIncome == null) return;
      if (yoyQ.operatingIncome === 0) return;
      const growth = (q.operatingIncome - yoyQ.operatingIncome) / Math.abs(yoyQ.operatingIncome) * 100;

      // 範囲外の企業は記録してチャートから除外
      if (growth > X_MAX || growth < -X_MAX) {
        outOfRange.push({
          ticker: self.TICKERS[slug],
          growth: growth,
          per: per,
        });
        return;
      }

      datasets.push({
        label: self.TICKERS[slug],
        data: [{ x: growth, y: per }],
        backgroundColor: self.COLORS[slug].bg,
        borderColor: self.COLORS[slug].border,
        borderWidth: 2,
        pointRadius: 8,
        pointHoverRadius: 11,
      });
    });

    // ティッカーラベル描画用プラグイン
    const tickerLabelPlugin = {
      id: 'tickerLabelsGrowth',
      afterDatasetsDraw: function(chart) {
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.font = 'bold 11px -apple-system, sans-serif';
        ctx2.textBaseline = 'bottom';
        chart.data.datasets.forEach(function(ds, i) {
          var meta = chart.getDatasetMeta(i);
          if (!meta.visible || meta.data.length === 0) return;
          var pt = meta.data[0];
          ctx2.fillStyle = ds.borderColor;
          ctx2.fillText(ds.label, pt.x + 10, pt.y - 4);
        });
        ctx2.restore();
      }
    };

    // 範囲外の企業を注釈エリアに表示
    if (outOfRange.length > 0) {
      const noteEl = ctx.closest('.compare-section').querySelector('.chart-note-overflow');
      if (noteEl) {
        const lines = outOfRange.map(function(d) {
          return d.ticker + ': 営業利益成長率 ' + (d.growth >= 0 ? '+' : '') + d.growth.toFixed(0) + '% / PER ' + d.per.toFixed(1) + 'x';
        });
        noteEl.textContent = '※ グラフ範囲外: ' + lines.join('、');
        noteEl.style.display = 'block';
      }
    }

    return new Chart(ctx, {
      type: 'scatter',
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: '営業利益成長率 × PER（成長性と市場評価の関係）',
            font: { size: 15, weight: 'bold' },
            color: '#333',
          },
          legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 16 } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var d = ctx.raw;
                return ctx.dataset.label + ': 営業利益成長率 ' + (d.x >= 0 ? '+' : '') + d.x.toFixed(1) + '% / PER ' + d.y.toFixed(1) + 'x';
              }
            }
          }
        },
        scales: {
          x: {
            max: X_MAX,
            title: { display: true, text: '営業利益成長率 YoY（%）', font: { size: 13 } },
            ticks: { callback: function(v) { return (v >= 0 ? '+' : '') + v + '%'; } },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          y: {
            title: { display: true, text: 'PER (TTM)', font: { size: 13 } },
            ticks: { callback: function(v) { return v + 'x'; } },
            grid: { color: 'rgba(0,0,0,0.06)' },
          }
        }
      },
      plugins: [tickerLabelPlugin],
    });
  },
};
