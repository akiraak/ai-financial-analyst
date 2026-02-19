# データ分析・可視化（GitHub Pagesレポート）

## 目的

- 業績データを投資判断の共有用ダッシュボードとしてGitHub Pagesに公開する
- 複数のデータソース（financials.json, stock-prices.json, segments.json, balance-sheet.json, cash-flows.json, segment-profit.json）を統合する
- 複数企業に対応可能な構造にする

## 予想（Outlook）データの扱い

- **企業ランディングページ**: 予想四半期は表示しない。実績四半期のリンクのみ表示する
- **グラフ**: 予想四半期（`isOutlook: true`）はグラフに含めない。グラフは実績データのみで描画する
- **財務データ表**: 予想四半期は表示する。ヘッダーに「Q4予想」と明示し、セルはグレーアウト表示
- **xlsxファイル**: 予想四半期を含む（Excelでの分析用）

## 可視化するグラフ（13チャート）

### A. 収益全体像

#### 1. P/L推移（棒グラフ）
- 売上高・粗利・営業利益・純利益の四半期推移

#### 2. 利益率推移（折れ線グラフ）
- 粗利率（grossProfit / revenue）
- 営業利益率（operatingIncome / revenue）
- 純利益率（netIncome / revenue）

#### 3. 成長率推移（折れ線グラフ）
- 売上高・営業利益・純利益のYoY成長率
- 0%ラインを基準に成長の加速・減速を把握

#### 4. 費用構造（積み上げ棒グラフ）
- 売上原価（costOfRevenue）
- 研究開発費（researchAndDevelopment）
- その他販管費（sga）
- 売上高に対する構成比で表示

### B. 財務基盤

#### 5. B/S概要（棒グラフ + 折れ線）
- 総資産・総負債・純資産（棒グラフ）
- 現金同等物（折れ線）

#### 6. キャッシュフロー（棒グラフ + 折れ線）
- 営業CF・投資CF・財務CF（棒グラフ）
- フリーキャッシュフロー（折れ線）

### C. 株式市場評価

#### 7. 株価 & PER（複合チャート）
- 株価: 棒グラフ（左軸）
- PER: 折れ線グラフ（右軸）
- PER = 株価 / 直近4Q EPS合計

#### 8. バリュエーション指標（複合折れ線）
- PER（左軸）、PSR・PBR（右軸）

### D. セグメント分析

セグメント分析セクションの冒頭に、2種類のセグメント区分の説明テキストを配置する。

- **市場向け5セグメント**（プレスリリースベース・売上のみ）: Data Center / Gaming / Professional Visualization / Automotive / OEM & Other
- **SEC報告2セグメント**（10-Q/10-Kベース・売上+営業利益）: Compute & Networking / Graphics
- 両者の対応関係（C&N ≒ Data Center + Automotive + Networking、Graphics ≒ Gaming + ProViz + Infotainment）

#### 9. セグメント別売上（積み上げ棒グラフ）
- 市場向け5セグメントの売上推移
- データソース: press-release.html → segments.json

#### 10. セグメント構成比（100%積み上げ棒グラフ）
- 総売上に占める各セグメントの構成比率

#### 11. セグメント営業利益（棒グラフ）
- SEC報告2セグメント（Compute & Networking / Graphics）の営業利益
- データソース: 10-Q/10-K PDF → segment-profit.json

#### 12. セグメント営業利益率（折れ線グラフ）
- 各報告セグメントの営業利益率（Operating Income / Revenue）

### E. 投資ポートフォリオ

#### 13. 投資残高推移（棒グラフ + 折れ線）
- 非上場株式（Non-marketable Equity Securities）: 棒グラフ
- 上場株式（Publicly-held Equity Securities）: 折れ線
- 投資コミットメント情報は静的テキストで記載（Intel, OpenAI, Anthropic等）
- データソース: 10-Q/10-K PDF → investments.json

## データソース

### 抽出済みデータ
| ファイル | 内容 | ソース |
|---------|------|-------|
| `financials.json` | P/L項目（四半期単位） | press-release.html |
| `stock-prices.json` | 四半期末株価・日付 | Yahoo Finance API |
| `segments.json` | 市場向け5セグメント売上 | press-release.html |
| `balance-sheet.json` | B/S項目 | press-release.html |
| `cash-flows.json` | CF項目 | press-release.html |
| `segment-profit.json` | SEC報告2セグメントの売上+営業利益 | 10-Q/10-K PDF |
| `investments.json` | 非上場・上場株式残高・投資活動 | 10-Q/10-K PDF |

### 導出指標（レポート側で計算）
- 粗利率、営業利益率、純利益率
- PER（直近4Q EPS合計ベース）、PSR、PBR
- 費用構成比（各費用 / 売上高）
- YoY成長率
- セグメント営業利益率

## 技術スタック

- **GitHub Pages** — 静的HTMLホスティング
- **Chart.js** — チャートライブラリ（CDN読み込み、ビルド不要）
- **データ形式** — JSONを直接fetch

## ディレクトリ構成

```
docs/                              # GitHub Pages公開ディレクトリ
├── index.html                     # 企業一覧ページ
├── js/
│   ├── chart-builder.js           # 共通チャート生成ロジック（13チャート）
│   └── quarter-detail.js          # 四半期詳細ページのロジック
├── css/
│   └── style.css                  # 共通スタイル
└── <企業名>/
    ├── index.html                 # ランディングページ（四半期リンクのみ）
    ├── data.json                  # 統合JSON（全データソースを結合）
    └── quarters/                  # 四半期別分析ページ
        ├── index.html             # 四半期選択ページ
        ├── template.html          # 詳細ページテンプレート
        └── <YYYYQN>/             # 例: 2026Q3/
            ├── index.html         # 四半期詳細ページ
            └── data.json          # その四半期までのデータ
```

### data.json の生成
- 全JSONデータソースを統合して docs/<企業名>/data.json として出力する
- 生成スクリプト: `companies/<企業名>/analysis/generate-data-json.js`

## ページ構成

### 企業ランディングページ（`<企業名>/index.html`）

```
┌──────────────────────────────────┐
│ ヘッダー（企業名・ティッカー・    │
│ 対象期間・四半期数・更新日）      │
├──────────────────────────────────┤
│ 四半期分析リンク                  │
│  FY別にQ1〜Q4のリンクを表示      │
│  実績のみ（予想は表示しない）     │
├──────────────────────────────────┤
│ フッター（データソース情報）       │
└──────────────────────────────────┘
```

### 四半期詳細ページ（`quarters/<YYYYQN>/index.html`）

```
┌──────────────────────────────────┐
│ ヘッダー（企業名・四半期名）      │
├──────────────────────────────────┤
│ KPIサマリー + P/L詳細テーブル    │
├──────────────────────────────────┤
│ A. 収益全体像                     │
│  1. P/L推移                      │
│  2. 利益率推移                    │
│  3. 成長率推移                    │
│  4. 費用構造                     │
├──────────────────────────────────┤
│ B. 財務基盤                      │
│  5. B/S概要                      │
│  6. キャッシュフロー               │
├──────────────────────────────────┤
│ C. 株式市場評価                   │
│  7. 株価 & PER                   │
│  8. バリュエーション指標            │
├──────────────────────────────────┤
│ D. セグメント分析                  │
│  9. セグメント別売上               │
│  10. セグメント構成比              │
│  11. セグメント営業利益            │
│  12. セグメント営業利益率           │
├──────────────────────────────────┤
│ E. 投資ポートフォリオ              │
│  13. 投資残高推移                 │
├──────────────────────────────────┤
│ フッター                          │
└──────────────────────────────────┘
```

## 手順

### 1. データ抽出スクリプトの実行
各抽出スクリプトを実行してJSONデータを生成する。

| スクリプト | 出力 |
|-----------|------|
| `extract-financials.js` | financials.json |
| `extract-segments.js` | segments.json |
| `extract-balance-sheet.js` | balance-sheet.json |
| `extract-cash-flows.js` | cash-flows.json |
| `extract-segment-profit.js` | segment-profit.json |
| `extract-investments.js` | investments.json |
| `fetch-stock-prices.js` | stock-prices.json |

### 2. data.json の生成
`generate-data-json.js` を実行して全データを統合する。

### 3. ダッシュボードの確認
ブラウザで `docs/<企業名>/index.html` を開き、13チャートが正しく表示されることを確認する。

### 4. GitHub Pages の有効化
リポジトリの Settings → Pages で `docs/` ディレクトリを公開元に設定する。
