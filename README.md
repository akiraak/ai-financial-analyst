# AI Financial Analyst

AIを活用した株式の財務分析ツール。決算資料から業績データを抽出し、四半期推移をグラフで可視化します。

**ダッシュボード: https://akiraak.github.io/ai-financial-analyst/**

## 対応企業

| 企業 | ティッカー | 対象期間 |
|------|-----------|---------|
| NVIDIA | NVDA | FY2021 Q1 〜 FY2026 Q3 |
| Broadcom | AVGO | FY2022 Q1 〜 FY2025 Q4 |
| Meta Platforms | META | FY2022 Q1 〜 FY2025 Q3 |
| Palantir Technologies | PLTR | FY2022 Q1 〜 FY2025 Q3 |
| Intel Corporation | INTC | FY2020 Q1 〜 FY2025 Q4 |

## 機能

- **業績データ抽出** — 決算プレスリリース（HTML）からP/L・B/S・CF・セグメントデータを自動抽出
- **株価取得** — Yahoo Finance APIから四半期末株価を取得
- **xlsx生成** — テンプレートベースの業績一覧エクセルを生成
- **四半期別分析ページ** — 各四半期ごとにKPIサマリー・13チャート・財務データ表・分析テキストを表示
  - A. 収益全体像: P/L推移、利益率推移、費用構造
  - B. 財務基盤: B/S概要、キャッシュフロー
  - C. 株式市場評価: 株価 & PER、バリュエーション指標（PER/PSR/PBR）
  - D. セグメント分析: セグメント別売上、構成比、営業利益、営業利益率
  - E. 投資ポートフォリオ: 投資残高推移
- **財務データ表** — 24行の財務項目（P/L・費用・利益率・株式指標）をカテゴリ別色分けで表示
- **分析テキスト** — 各チャートに概要・解説を付与（AI生成）
- **決算資料リンク** — IR原本へのリンクを自動生成

## 技術スタック

- **ランタイム**: Node.js
- **xlsx生成**: ExcelJS
- **グラフ描画**: Chart.js（CDN）
- **HTML解析**: Cheerio
- **ブラウザ自動化**: Playwright（決算資料ダウンロード）
- **ホスティング**: GitHub Pages（`docs/`）
- **ワークフロー管理**: Claude Code + `workflows/`

## ディレクトリ構成

```
├── workflows/              # 処理フロー定義
├── companies/<企業名>/
│   ├── config.json         # 期間設定（pageYears, chartYears, nextEarningsDate）
│   ├── filings/            # 決算資料の原本（press-release, 10-Q/10-K）
│   ├── scripts/            # 抽出・生成スクリプト
│   └── data/               # 抽出済みデータ（JSON）・xlsx
└── docs/                   # GitHub Pages公開ディレクトリ
    ├── index.html          # 企業一覧トップページ
    ├── css/style.css       # 共通スタイル
    ├── js/
    │   ├── chart-builder.js    # 共通チャート生成ロジック（13チャート）
    │   └── quarter-detail.js   # 四半期詳細ページのロジック
    └── <企業名>/
        ├── index.html      # ランディングページ
        ├── data.json       # 統合データ（全四半期）
        ├── analysis-text.json  # チャート解説・決算サマリー
        └── quarters/       # 四半期別分析ページ
```

## ライセンス

MIT
