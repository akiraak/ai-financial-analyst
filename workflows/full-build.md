# フルビルド（データ再取得・再構築・ページ再生成）

## 目的

企業を指定して、決算資料のダウンロードからデータ抽出・xlsx生成・GitHub Pagesページ生成までを一気通貫で実行する。

## 前提

- 対象企業のフォルダ（`companies/<企業名>/`）が `scripts/`, `data/`, `filings/` の構成で存在すること
- 新規企業の場合は [download-filings.md](download-filings.md) の手順1（調査）から開始する

## 手順

### 1. 決算資料のダウンロード

[download-filings.md](download-filings.md) に従い、IRページから全資料をダウンロードする。

```bash
node companies/<企業名>/scripts/download-filings.js
```

既にダウンロード済みの場合はスキップ可。新しい四半期が追加された場合のみ実行する。

### 2. データ抽出

以下のスクリプトを実行してJSONデータを生成する。2a の6スクリプトは並列実行可能。

#### 2a. 抽出スクリプト（並列実行可能）

```bash
node companies/<企業名>/scripts/extract-financials.js
node companies/<企業名>/scripts/extract-segments.js
node companies/<企業名>/scripts/extract-balance-sheet.js
node companies/<企業名>/scripts/extract-cash-flows.js
node companies/<企業名>/scripts/extract-segment-profit.js
node companies/<企業名>/scripts/extract-investments.js
```

| スクリプト | 入力 | 出力 |
|-----------|------|------|
| extract-financials.js | press-release.html | data/financials.json |
| extract-segments.js | press-release.html | data/segments.json |
| extract-balance-sheet.js | press-release.html | data/balance-sheet.json |
| extract-cash-flows.js | press-release.html | data/cash-flows.json |
| extract-segment-profit.js | 10-Q.pdf / 10-K.pdf | data/segment-profit.json |
| extract-investments.js | 10-Q.pdf / 10-K.pdf | data/investments.json |

#### 2b. 株価取得（financials.json に依存）

```bash
node companies/<企業名>/scripts/fetch-stock-prices.js
```

- 入力: data/financials.json（四半期一覧）
- 出力: data/stock-prices.json

### 3. xlsx生成

```bash
node companies/<企業名>/scripts/generate-xlsx.js
```

- 入力: data/financials.json, data/stock-prices.json, data/template.xlsx
- 出力: data/Financials.xlsx

### 4. xlsx検証

[validate-xlsx.md](validate-xlsx.md) に従い、生成されたxlsxの数値を検証する。

```bash
node companies/<企業名>/scripts/validate-xlsx.js
```

- 検証対象: data/Financials.xlsx
- ソース: data/financials.json, data/stock-prices.json, filings/FY*/Q*/press-release.*

### 5. ページ生成

```bash
node companies/<企業名>/scripts/generate-pages.js
node companies/<企業名>/scripts/generate-data-json.js
```

| スクリプト | 出力 |
|-----------|------|
| generate-pages.js | docs/\<企業名\>/index.html, quarters/index.html, quarters/template.html |
| generate-data-json.js | docs/\<企業名\>/data.json, quarters/\<YYYYQN\>/data.json + index.html |

### 6. 分析テキストの作成

[analyze-and-visualize.md](analyze-and-visualize.md) の手順4に従い、`docs/<企業名>/analysis-text.json` を作成する。

このファイルは四半期詳細ページの解説テキスト・決算サマリーの表示に**必須**。存在しない場合、ページのテキストがすべて空になる。

### 7. 確認

- `docs/<企業名>/index.html` をブラウザで開き、ランディングページが正しく表示されることを確認
- 最新四半期の `docs/<企業名>/quarters/<YYYYQN>/index.html` を開き、KPI・チャート・解説が正しく表示されることを確認
