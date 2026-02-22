# フルビルド（データ再取得・再構築・ページ再生成）

## 目的

企業を指定して、決算資料のダウンロードからデータ抽出・xlsx生成・GitHub Pagesページ生成までを一気通貫で実行する。

## 前提

- 対象企業のフォルダ（`companies/<企業名>/`）が `scripts/`, `data/`, `filings/` の構成で存在すること
- 新規企業の場合は [download-filings.md](download-filings.md) の手順1（調査）から開始する

## 一括実行モード

Step 0（企業選択）と Step 1（config.json設定）でユーザーの承認を得たら、**Step 2〜7 はエラーが発生しない限り確認なしで一気通貫で実行する。**

- 各ステップの中間結果報告は不要。エラー時のみ停止して報告する
- 新規企業のスクリプト作成も既存企業のコードを参考に自動で進める
- Step 8（最終確認）のみユーザーに報告する

## 手順

### 0. 対象企業の確認

`companies/` 配下の企業フォルダを確認し、対象企業をユーザーに質問する。

- 企業フォルダが1つだけの場合: その企業名を表示し確認する
- 複数ある場合: 一覧を表示して選択してもらう

### 1. 設定の確認（config.json）

`companies/<企業名>/config.json` を確認する。

- **config.json が存在する場合:** 内容を表示し、変更の必要があるか簡潔に確認する。問題なければそのまま進む
- **config.json が存在しない場合:** 以下を質問し、config.json を作成する
  1. 「四半期詳細ページは何年分生成しますか？」→ `pageYears`
  2. 「各ページのグラフには何年分のデータを表示しますか？」→ `chartYears`
  - DL対象年数 = pageYears + chartYears（自動計算、質問しない）
  3. 「次回の決算発表日は？」→ `nextEarningsDate`（YYYY-MM-DD形式。トップページのカードに表示される）

**ユーザーが Step 1 で設定を承認したら、一括実行モードに入り Step 2〜7 を自動実行する。**

### 1.5. 既存データの削除

ビルド前に生成済みデータをクリーンアップする。古いファイルが残るのを防ぐ。

```bash
rm -rf companies/<企業名>/data/
rm -rf companies/<企業名>/filings/
mkdir -p companies/<企業名>/data
mkdir -p companies/<企業名>/filings
```

**注意:** `scripts/` 配下の処理コードと `config.json` は削除しない。

### 2. 決算資料のダウンロード

[download-filings.md](download-filings.md) に従い、IRページから全資料をダウンロードする。

config.json の設定に基づいてDL対象を決定する（DL年数 = `pageYears + chartYears`）。

```bash
node companies/<企業名>/scripts/download-filings.js
```

既にダウンロード済みの場合はスキップ可。新しい四半期が追加された場合のみ実行する。

### 3. データ抽出

以下のスクリプトを実行してJSONデータを生成する。3a の6スクリプトは並列実行可能。

#### 3a. 抽出スクリプト（並列実行可能）

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

#### 3b. 株価取得（financials.json に依存）

```bash
node companies/<企業名>/scripts/fetch-stock-prices.js
```

- 入力: data/financials.json（四半期一覧）
- 出力: data/stock-prices.json

### 4. xlsx生成

```bash
node companies/<企業名>/scripts/generate-xlsx.js
```

- 入力: data/financials.json, data/stock-prices.json, data/template.xlsx
- 出力: data/Financials.xlsx

### 5. xlsx検証

[validate-xlsx.md](validate-xlsx.md) に従い、生成されたxlsxの数値を検証する。

```bash
node companies/<企業名>/scripts/validate-xlsx.js
```

- 検証対象: data/Financials.xlsx
- ソース: data/financials.json, data/stock-prices.json, filings/FY*/Q*/press-release.*

### 6. ページ生成

config.json の設定に基づいてページ生成・チャートデータ範囲を決定する。

```bash
node companies/<企業名>/scripts/generate-pages.js
node companies/<企業名>/scripts/generate-data-json.js
node companies/<企業名>/scripts/generate-ir-links.js
```

| スクリプト | 出力 |
|-----------|------|
| generate-pages.js | docs/\<企業名\>/index.html, quarters/index.html, quarters/template.html |
| generate-data-json.js | docs/\<企業名\>/data.json, quarters/\<YYYYQN\>/data.json + index.html |
| generate-ir-links.js | docs/\<企業名\>/ir-links.json（決算資料リンク） |

### 7. 分析テキストの作成

[analyze-and-visualize.md](analyze-and-visualize.md) の手順4に従い、`docs/<企業名>/analysis-text.json` を作成する。

このファイルは四半期詳細ページの解説テキスト・決算サマリーの表示に**必須**。存在しない場合、ページのテキストがすべて空になる。

### 8. 確認

- `docs/<企業名>/index.html` をブラウザで開き、ランディングページが正しく表示されることを確認
- 最新四半期の `docs/<企業名>/quarters/<YYYYQN>/index.html` を開き、KPI・チャート・解説が正しく表示されることを確認
