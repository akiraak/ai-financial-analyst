// quarter-detail.js — 四半期詳細ページのロジック

const QuarterDetail = {

  // === ユーティリティ ===

  // URLパラメータからfy, qを取得
  getParams() {
    const params = new URLSearchParams(window.location.search);
    const fy = parseInt(params.get('fy'));
    const q = parseInt(params.get('q'));
    return { fy, q };
  },

  // 該当四半期のインデックスを検索
  findIndex(quarters, fy, q) {
    return quarters.findIndex(d => d.fy === fy && d.q === q);
  },

  // 金額フォーマット（$M → $XXB or $XXM）
  fmtMoney(val) {
    if (val == null) return '---';
    const abs = Math.abs(val);
    if (abs >= 1000) return (val < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(1) + 'B';
    return (val < 0 ? '-' : '') + '$' + abs.toLocaleString() + 'M';
  },

  // 金額フォーマット（テーブル用、$M単位で表示）
  fmtTableMoney(val) {
    if (val == null) return '---';
    return '$' + val.toLocaleString() + 'M';
  },

  // パーセント表示
  fmtPct(val) {
    if (val == null) return '---';
    return val.toFixed(1) + '%';
  },

  // 変化率計算
  calcGrowth(current, previous) {
    if (current == null || previous == null || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  },

  // 変化率をフォーマット（色クラス付き）
  fmtChange(pct) {
    if (pct == null) return '<span class="change-neutral">---</span>';
    const sign = pct >= 0 ? '+' : '';
    const cls = pct > 0 ? 'change-positive' : pct < 0 ? 'change-negative' : 'change-neutral';
    return `<span class="${cls}">${sign}${pct.toFixed(1)}%</span>`;
  },

  // QoQ成長率（i-1との比較）
  qoq(quarters, idx, field) {
    if (idx <= 0) return null;
    return this.calcGrowth(quarters[idx][field], quarters[idx - 1][field]);
  },

  // YoY成長率（同Qの前年との比較 = i-4）
  yoy(quarters, idx, field) {
    if (idx < 4) return null;
    return this.calcGrowth(quarters[idx][field], quarters[idx - 4][field]);
  },

  // ネストしたフィールドのQoQ
  qoqNested(quarters, idx, path) {
    if (idx <= 0) return null;
    const curr = this.getNestedValue(quarters[idx], path);
    const prev = this.getNestedValue(quarters[idx - 1], path);
    return this.calcGrowth(curr, prev);
  },

  // ネストしたフィールドのYoY
  yoyNested(quarters, idx, path) {
    if (idx < 4) return null;
    const curr = this.getNestedValue(quarters[idx], path);
    const prev = this.getNestedValue(quarters[idx - 4], path);
    return this.calcGrowth(curr, prev);
  },

  // ドット区切りパスでネストした値を取得
  getNestedValue(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), obj);
  },

  // === レンダリング ===

  // ヘッダーメタ情報
  renderHeader(quarter) {
    const qNames = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4' };
    document.getElementById('headerMeta').textContent =
      `${quarter.label}` + (quarter.isOutlook ? '（ガイダンス）' : '');
    document.title = `NVIDIA ${quarter.label} 四半期詳細`;
    document.getElementById('currentLabel').textContent = quarter.label;
  },

  // 前後四半期ナビ
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

  // KPIサマリー（8カード）
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
          // PER計算（trailing 4Q EPS）
          if (idx < 3 || d.price == null) return '';
          let epsSum = 0;
          for (let i = idx; i > idx - 4 && i >= 0; i--) epsSum += (quarters[i].eps || 0);
          return epsSum > 0 ? `PER ${(d.price / epsSum).toFixed(1)}x` : '';
        })()
      },
      {
        label: '現金同等物',
        value: d.balanceSheet ? this.fmtMoney(d.balanceSheet.cashAndEquivalents) : '---',
        sub1: d.cashFlow ? `FCF ${this.fmtMoney(d.cashFlow.freeCashFlow)}` : '',
        sub2: d.cashFlow && d.revenue
          ? `FCFマージン ${this.fmtPct(d.cashFlow.freeCashFlow / d.revenue * 100)}` : ''
      },
      {
        label: '有利子負債',
        value: d.balanceSheet ? this.fmtMoney(d.balanceSheet.totalDebt) : '---',
        sub1: d.balanceSheet && d.balanceSheet.totalEquity
          ? `D/E ${(d.balanceSheet.totalDebt / d.balanceSheet.totalEquity).toFixed(2)}` : '',
        sub2: d.balanceSheet
          ? `Net Cash ${this.fmtMoney(d.balanceSheet.cashAndEquivalents - d.balanceSheet.totalDebt)}` : ''
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

  // P/L詳細テーブル
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

      // 対売上比
      let ratio = '---';
      if (d.revenue && val != null && row.field !== 'eps' && row.field !== 'revenue') {
        ratio = this.fmtPct(val / d.revenue * 100);
      } else if (row.field === 'revenue') {
        ratio = '100%';
      }

      // EPS用のフォーマット
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

  // P/Lウォーターフォールチャート
  createWaterfallChart(ctx, quarter) {
    const d = quarter;
    if (!d.revenue) return;

    // ウォーターフォールデータ: 各ステップの[底, 頂上]値を計算
    const labels = ['売上高', '売上原価', '粗利益', 'R&D', 'SGA', '営業利益', '営業外', '純利益'];
    const values = [
      d.revenue,
      -d.costOfRevenue,
      d.grossProfit,
      -d.researchAndDevelopment,
      -(d.sga || 0),
      d.operatingIncome,
      d.nonOperatingIncome || 0,
      d.netIncome
    ];

    // Floating bar: [開始点, 終了点] を計算
    const floating = [];
    const colors = [];
    const positiveColor = 'rgba(90, 158, 111, 0.8)';  // 緑
    const negativeColor = 'rgba(201, 107, 126, 0.8)';  // ピンク
    const totalColor = 'rgba(61, 107, 74, 0.9)';       // 濃い緑

    // 売上高（トータルバー）
    floating.push([0, d.revenue]);
    colors.push(totalColor);

    // 売上原価（売上高から引く）
    floating.push([d.grossProfit, d.revenue]);
    colors.push(negativeColor);

    // 粗利益（トータルバー）
    floating.push([0, d.grossProfit]);
    colors.push(totalColor);

    // R&D（粗利益から引く）
    let afterRD = d.grossProfit - d.researchAndDevelopment;
    floating.push([afterRD, d.grossProfit]);
    colors.push(negativeColor);

    // SGA
    let afterSGA = afterRD - (d.sga || 0);
    floating.push([afterSGA, afterRD]);
    colors.push(negativeColor);

    // 営業利益（トータルバー）
    floating.push([0, d.operatingIncome]);
    colors.push(totalColor);

    // 営業外収支
    const nonOp = d.nonOperatingIncome || 0;
    if (nonOp >= 0) {
      floating.push([d.operatingIncome, d.operatingIncome + nonOp]);
      colors.push(positiveColor);
    } else {
      floating.push([d.operatingIncome + nonOp, d.operatingIncome]);
      colors.push(negativeColor);
    }

    // 純利益（トータルバー）
    floating.push([0, d.netIncome]);
    colors.push(totalColor);

    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: floating,
          backgroundColor: colors,
          borderRadius: 3,
          barPercentage: 0.7
        }]
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
                const val = high - low;
                return `$${val.toLocaleString()}M`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: v => '$' + (v / 1000).toFixed(0) + 'B'
            }
          }
        }
      }
    });
  },

  // セグメント ドーナツチャート
  createSegmentPieChart(ctx, quarter) {
    const seg = quarter.segments;
    if (!seg) return false;

    const labels = ['Data Center', 'Gaming', 'Prof. Visualization', 'Automotive', 'OEM & Other'];
    const data = [seg.dataCenter, seg.gaming, seg.professionalVisualization, seg.automotive, seg.oem];
    const colors = [
      'rgba(54, 162, 235, 0.8)',
      'rgba(75, 192, 192, 0.8)',
      'rgba(255, 159, 64, 0.8)',
      'rgba(153, 102, 255, 0.8)',
      'rgba(201, 203, 207, 0.8)'
    ];

    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11 }, padding: 12 }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.parsed;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const pct = (val / total * 100).toFixed(1);
                return `${context.label}: $${val.toLocaleString()}M (${pct}%)`;
              }
            }
          }
        }
      }
    });
    return true;
  },

  // セグメント詳細テーブル
  renderSegmentTable(quarters, idx) {
    const d = quarters[idx];
    const container = document.getElementById('segmentTableContainer');
    if (!d.segments) {
      container.innerHTML = '<p style="color:#888;">セグメントデータなし</p>';
      return;
    }

    const seg = d.segments;
    const total = d.revenue;
    const items = [
      { label: 'Data Center', key: 'dataCenter' },
      { label: 'Gaming', key: 'gaming' },
      { label: 'Prof. Visualization', key: 'professionalVisualization' },
      { label: 'Automotive', key: 'automotive' },
      { label: 'OEM & Other', key: 'oem' }
    ];

    let html = `<table class="segment-detail-table">
      <thead><tr>
        <th style="text-align:left;">セグメント</th>
        <th>売上</th>
        <th>構成比</th>
        <th>QoQ</th>
        <th>YoY</th>
      </tr></thead><tbody>`;

    for (const item of items) {
      const val = seg[item.key];
      const pct = total && val != null ? (val / total * 100).toFixed(1) + '%' : '---';
      html += `<tr>
        <td>${item.label}</td>
        <td>${this.fmtTableMoney(val)}</td>
        <td>${pct}</td>
        <td>${this.fmtChange(this.qoqNested(quarters, idx, 'segments.' + item.key))}</td>
        <td>${this.fmtChange(this.yoyNested(quarters, idx, 'segments.' + item.key))}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  },

  // セグメント営業利益（SEC 2セグメント）KPIカード
  renderSegmentProfit(quarters, idx) {
    const d = quarters[idx];
    const grid = document.getElementById('segmentProfitGrid');
    const sp = d.segmentProfit;
    if (!sp) {
      document.getElementById('section-segment-profit').style.display = 'none';
      return;
    }

    const items = [];
    for (const [key, label] of [['computeAndNetworking', 'Compute & Networking'], ['graphics', 'Graphics']]) {
      const seg = sp[key];
      if (!seg) continue;
      const margin = seg.revenue ? (seg.operatingIncome / seg.revenue * 100) : null;

      items.push({
        label: `${label} 売上`, value: this.fmtMoney(seg.revenue),
        sub1: `QoQ ${this.fmtChange(this.qoqNested(quarters, idx, 'segmentProfit.' + key + '.revenue'))}`,
        sub2: `YoY ${this.fmtChange(this.yoyNested(quarters, idx, 'segmentProfit.' + key + '.revenue'))}`
      });
      items.push({
        label: `${label} 営業利益`, value: this.fmtMoney(seg.operatingIncome),
        sub1: `利益率 ${this.fmtPct(margin)}`,
        sub2: `YoY ${this.fmtChange(this.yoyNested(quarters, idx, 'segmentProfit.' + key + '.operatingIncome'))}`
      });
    }

    grid.innerHTML = items.map(item => `
      <div class="kpi-item">
        <div class="kpi-value">${item.value}</div>
        <div class="kpi-label">${item.label}</div>
        <div class="kpi-change">${item.sub1}</div>
        <div class="kpi-change">${item.sub2}</div>
      </div>
    `).join('');
  },

  // B/Sスナップショット
  renderBS(quarters, idx) {
    const d = quarters[idx];
    const grid = document.getElementById('bsGrid');
    const bs = d.balanceSheet;
    if (!bs) {
      document.getElementById('section-bs').style.display = 'none';
      return;
    }

    const deRatio = bs.totalEquity ? (bs.totalDebt / bs.totalEquity) : null;
    const netCash = bs.cashAndEquivalents - bs.totalDebt;

    const items = [
      { label: '現金同等物', value: this.fmtMoney(bs.cashAndEquivalents),
        sub1: `QoQ ${this.fmtChange(this.qoqNested(quarters, idx, 'balanceSheet.cashAndEquivalents'))}`,
        sub2: '' },
      { label: '総資産', value: this.fmtMoney(bs.totalAssets),
        sub1: `QoQ ${this.fmtChange(this.qoqNested(quarters, idx, 'balanceSheet.totalAssets'))}`,
        sub2: `YoY ${this.fmtChange(this.yoyNested(quarters, idx, 'balanceSheet.totalAssets'))}` },
      { label: '総負債', value: this.fmtMoney(bs.totalLiabilities),
        sub1: `負債比率 ${this.fmtPct(bs.totalAssets ? bs.totalLiabilities / bs.totalAssets * 100 : null)}`,
        sub2: '' },
      { label: '純資産', value: this.fmtMoney(bs.totalEquity),
        sub1: `QoQ ${this.fmtChange(this.qoqNested(quarters, idx, 'balanceSheet.totalEquity'))}`,
        sub2: `YoY ${this.fmtChange(this.yoyNested(quarters, idx, 'balanceSheet.totalEquity'))}` },
      { label: '有利子負債', value: this.fmtMoney(bs.totalDebt),
        sub1: `D/E ${deRatio != null ? deRatio.toFixed(2) : '---'}`,
        sub2: `Net Cash ${this.fmtMoney(netCash)}` }
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

  // キャッシュフロー
  renderCF(quarters, idx) {
    const d = quarters[idx];
    const grid = document.getElementById('cfGrid');
    const cf = d.cashFlow;
    if (!cf) {
      document.getElementById('section-cf').style.display = 'none';
      return;
    }

    const fcfMargin = d.revenue ? (cf.freeCashFlow / d.revenue * 100) : null;

    const items = [
      { label: '営業CF', value: this.fmtMoney(cf.operatingCF),
        sub1: `QoQ ${this.fmtChange(this.qoqNested(quarters, idx, 'cashFlow.operatingCF'))}`,
        sub2: `YoY ${this.fmtChange(this.yoyNested(quarters, idx, 'cashFlow.operatingCF'))}` },
      { label: '投資CF', value: this.fmtMoney(cf.investingCF),
        sub1: '', sub2: '' },
      { label: '財務CF', value: this.fmtMoney(cf.financingCF),
        sub1: '', sub2: '' },
      { label: 'FCF', value: this.fmtMoney(cf.freeCashFlow),
        sub1: `FCFマージン ${this.fmtPct(fcfMargin)}`,
        sub2: `YoY ${this.fmtChange(this.yoyNested(quarters, idx, 'cashFlow.freeCashFlow'))}` }
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

  // 株式・バリュエーション
  renderValuation(quarters, idx) {
    const d = quarters[idx];
    const grid = document.getElementById('valuationGrid');
    if (d.price == null) {
      document.getElementById('section-valuation').style.display = 'none';
      return;
    }

    // trailing 4Q EPS
    let epsSum = 0;
    for (let i = idx; i > idx - 4 && i >= 0; i--) epsSum += (quarters[i].eps || 0);
    const per = epsSum > 0 ? d.price / epsSum : null;

    // trailing 4Q Revenue（PSR用）
    let revSum = 0;
    for (let i = idx; i > idx - 4 && i >= 0; i--) revSum += (quarters[i].revenue || 0);

    // 時価総額
    const marketCap = d.sharesDiluted ? d.price * d.sharesDiluted : null;
    const psr = marketCap && revSum > 0 ? marketCap / revSum : null;
    const pbr = d.balanceSheet && d.balanceSheet.totalEquity
      ? marketCap / d.balanceSheet.totalEquity : null;

    const items = [
      { label: '株価', value: '$' + d.price.toFixed(2),
        sub1: d.priceDate || '', sub2: '' },
      { label: 'PER (trailing 4Q)', value: per != null ? per.toFixed(1) + 'x' : '---',
        sub1: `EPS合計 $${epsSum.toFixed(2)}`, sub2: '' },
      { label: 'PSR', value: psr != null ? psr.toFixed(1) + 'x' : '---',
        sub1: `売上合計 ${this.fmtMoney(revSum)}`, sub2: '' },
      { label: 'PBR', value: pbr != null ? pbr.toFixed(1) + 'x' : '---',
        sub1: d.balanceSheet ? `純資産 ${this.fmtMoney(d.balanceSheet.totalEquity)}` : '', sub2: '' },
      { label: '時価総額', value: marketCap ? this.fmtMoney(marketCap) : '---',
        sub1: d.sharesDiluted ? `希薄化後株式 ${(d.sharesDiluted / 1000).toFixed(1)}B株` : '', sub2: '' }
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

  // 投資ポートフォリオ
  renderInvestment(quarters, idx) {
    const d = quarters[idx];
    const grid = document.getElementById('investmentGrid');
    const inv = d.investments;
    if (!inv || (inv.nonMarketableBalance == null && inv.publiclyHeldBalance == null)) {
      document.getElementById('section-investment').style.display = 'none';
      return;
    }

    const items = [];
    if (inv.nonMarketableBalance != null) {
      items.push({ label: '非上場株式', value: this.fmtMoney(inv.nonMarketableBalance),
        sub1: `QoQ ${this.fmtChange(this.qoqNested(quarters, idx, 'investments.nonMarketableBalance'))}`, sub2: '' });
    }
    if (inv.publiclyHeldBalance != null) {
      items.push({ label: '上場株式', value: this.fmtMoney(inv.publiclyHeldBalance),
        sub1: '', sub2: '' });
    }
    if (inv.netAdditions != null) {
      items.push({ label: '新規投資額', value: this.fmtMoney(inv.netAdditions),
        sub1: '', sub2: '' });
    }
    if (inv.unrealizedGains != null) {
      items.push({ label: '未実現損益', value: this.fmtMoney(inv.unrealizedGains),
        sub1: '', sub2: '' });
    }
    if (inv.impairments != null) {
      items.push({ label: '減損額', value: this.fmtMoney(inv.impairments),
        sub1: '', sub2: '' });
    }

    grid.innerHTML = items.map(item => `
      <div class="kpi-item">
        <div class="kpi-value">${item.value}</div>
        <div class="kpi-label">${item.label}</div>
        <div class="kpi-change">${item.sub1}</div>
        <div class="kpi-change">${item.sub2}</div>
      </div>
    `).join('');
  },

  // 決算資料リンク
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

  // エラー表示
  showError(title, text) {
    document.getElementById('errorContainer').style.display = 'block';
    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorText').textContent = text;
  },

  // === メインエントリポイント ===
  init() {
    const { fy, q } = this.getParams();

    // パラメータ検証
    if (isNaN(fy) || isNaN(q) || q < 1 || q > 4) {
      this.showError('パラメータエラー', '有効な四半期を指定してください（例: ?fy=2026&q=3）');
      return;
    }

    Promise.all([
      fetch('data.json').then(r => r.json()),
      fetch('ir-links.json').then(r => r.json())
    ]).then(([data, irLinks]) => {
      const quarters = data.quarters;
      const idx = this.findIndex(quarters, fy, q);

      if (idx < 0) {
        this.showError('データなし', `FY${fy} Q${q} のデータが見つかりません。`);
        return;
      }

      const d = quarters[idx];

      // メインコンテンツ表示
      document.getElementById('mainContent').style.display = 'block';
      document.getElementById('sectionNav').style.display = 'block';

      // Outlookバナー
      if (d.isOutlook) {
        document.getElementById('outlookBanner').style.display = 'block';
      }

      // 各セクションレンダリング
      this.renderHeader(d);
      this.renderNav(quarters, idx);
      this.renderKPI(quarters, idx);
      this.renderPLTable(quarters, idx);

      // ウォーターフォールチャート
      if (d.revenue && !d.isOutlook) {
        this.createWaterfallChart(
          document.getElementById('waterfallChart').getContext('2d'), d
        );
      } else {
        document.getElementById('waterfallContainer').style.display = 'none';
      }

      // セグメント
      if (d.segments) {
        const pieDrawn = this.createSegmentPieChart(
          document.getElementById('segmentPieChart').getContext('2d'), d
        );
        this.renderSegmentTable(quarters, idx);
      } else {
        document.getElementById('section-segment').style.display = 'none';
      }

      this.renderSegmentProfit(quarters, idx);
      this.renderBS(quarters, idx);
      this.renderCF(quarters, idx);
      this.renderValuation(quarters, idx);
      this.renderInvestment(quarters, idx);
      this.renderFilings(irLinks, fy, q);

    }).catch(err => {
      console.error(err);
      this.showError('読み込みエラー', 'データの読み込みに失敗しました。');
    });
  }
};

document.addEventListener('DOMContentLoaded', () => QuarterDetail.init());
