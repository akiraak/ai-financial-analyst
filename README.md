# AI Financial Analyst

AIを活用した株式の財務分析ツール。決算資料から業績データを抽出し、四半期推移をグラフで可視化します。

**ダッシュボード: https://akiraak.github.io/ai-financial-analyst/**

## 対応企業

| 企業 | ティッカー | 対象期間 |
|------|-----------|---------|
| NVIDIA | NVDA | FY2022 Q1 〜 FY2026 Q4（予想含む） |

## 機能

- **業績データ抽出** — 決算プレスリリース（HTML）からP/Lデータを自動抽出
- **株価取得** — Yahoo Finance APIから四半期末株価を取得
- **xlsx生成** — テンプレートベースの業績一覧エクセルを生成
- **ダッシュボード** — GitHub Pagesで4種類のグラフを公開
  - P/L推移（売上高・粗利・営業利益・純利益）
  - 利益率推移（粗利率・営業利益率・純利益率）
  - 株価 & PER（複合チャート）
  - 費用構造（売上原価・R&D・販管費の対売上比率）

## 技術スタック

- **ランタイム**: Node.js
- **xlsx生成**: ExcelJS
- **グラフ描画**: Chart.js（CDN）
- **ホスティング**: GitHub Pages（`docs/`）
- **ワークフロー管理**: Claude Code + `workflows/`

## ディレクトリ構成

```
├── workflows/          # 処理フロー定義
├── companies/nvidia/
│   ├── filings/        # 決算資料の原本（FY2022〜FY2026）
│   └── analysis/        # 抽出スクリプト・データ・xlsx
└── docs/               # GitHub Pages公開ディレクトリ
    ├── index.html      # 企業一覧
    └── nvidia/         # NVIDIAダッシュボード
```

## ライセンス

MIT
