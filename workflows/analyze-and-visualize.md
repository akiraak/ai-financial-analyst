# データ分析・可視化（GitHub Pagesレポート）

## 目的

- 業績データを投資判断の共有用ダッシュボードとしてGitHub Pagesに公開する
- financials.json + stock-prices.json をデータソースとする
- 複数企業に対応可能な構造にする

## 可視化するグラフ

### 1. P/L推移（棒グラフ）
- 売上高・粗利・営業利益・純利益の四半期推移
- 予想（isOutlook）データは色や透明度で区別する

### 2. 利益率推移（折れ線グラフ）
- 粗利率（grossProfit / revenue）
- 営業利益率（operatingIncome / revenue）
- 純利益率（netIncome / revenue）

### 3. 株価 & PER（複合チャート）
- 株価: 面グラフまたは棒グラフ（左軸）
- PER: 折れ線グラフ（右軸）
- PER = 株価 / 直近4Q EPS合計

### 4. 費用構造（積み上げ棒グラフ）
- 売上原価（costOfRevenue）
- 研究開発費（researchAndDevelopment）
- その他販管費（sga）
- 売上高に対する構成比で表示

## データソース

### 既存データ
- `companies/<企業名>/ir-data/financials.json` — P/L項目（四半期単位）
- `companies/<企業名>/ir-data/stock-prices.json` — 四半期末株価・日付

### 導出指標（レポート側で計算）
- 粗利率、営業利益率、純利益率
- PER（直近4Q EPS合計ベース）
- 費用構成比（各費用 / 売上高）

## 技術スタック

- **GitHub Pages** — 静的HTMLホスティング
- **Chart.js** — チャートライブラリ（CDN読み込み、ビルド不要）
- **データ形式** — JSONを直接fetch

## ディレクトリ構成

```
docs/                              # GitHub Pages公開ディレクトリ
├── index.html                     # 企業一覧ページ
├── js/
│   └── chart-builder.js           # 共通チャート生成ロジック
├── css/
│   └── style.css                  # 共通スタイル
└── <企業名>/
    ├── index.html                 # 企業別レポートページ
    └── data.json                  # financials + stock-prices 統合JSON
```

### data.json の生成
- financials.json と stock-prices.json を統合して docs/<企業名>/data.json として出力する
- 生成スクリプトを `companies/<企業名>/ir-data/` に配置する

## レポートページの構成

```
┌──────────────────────────────────┐
│ ヘッダー（企業名・ティッカー・    │
│ 最終更新日・対象期間）            │
├──────────────────────────────────┤
│ セクション1: P/L推移              │
│ [棒グラフ]                       │
├──────────────────────────────────┤
│ セクション2: 利益率推移            │
│ [折れ線グラフ]                    │
├──────────────────────────────────┤
│ セクション3: 株価 & PER           │
│ [複合チャート]                    │
├──────────────────────────────────┤
│ セクション4: 費用構造              │
│ [積み上げ棒グラフ]                │
├──────────────────────────────────┤
│ フッター（データソース情報）       │
└──────────────────────────────────┘
```

## 手順

### 1. data.json 生成スクリプトの作成
financials.json + stock-prices.json → docs/<企業名>/data.json を生成するスクリプトを作る。

### 2. 共通チャート生成ロジックの実装
`docs/js/chart-builder.js` に4種類のグラフ描画関数を実装する。

### 3. 企業別レポートページの作成
`docs/<企業名>/index.html` に data.json を読み込んでグラフを描画するページを作る。

### 4. トップページの作成
`docs/index.html` に企業一覧と各レポートへのリンクを配置する。

### 5. GitHub Pages の有効化
リポジトリの Settings → Pages で `docs/` ディレクトリを公開元に設定する。
