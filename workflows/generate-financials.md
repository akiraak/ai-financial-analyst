# 業績データxlsxの生成

## 方針

- **press-release.html** を損益計算書データのソースとする
- **Yahoo Finance API** から四半期末株価を取得する
- 「AI企業の業績と予想.xlsx」と同じレイアウトでxlsxを生成する

## 手順

### 1. データ抽出（P/L）

`companies/<企業名>/scripts/extract-financials.js` を実行し、press-release.htmlから損益計算書データを抽出する。

```bash
node companies/<企業名>/scripts/extract-financials.js
```

- 出力: `companies/<企業名>/data/financials.json`
- 抽出項目: 売上高、売上総利益、研究開発費、販管費、営業利益、営業外収支、当期純利益、EPS

### 2. 株価取得

`companies/<企業名>/scripts/fetch-stock-prices.js` を実行し、四半期末株価を取得する。

```bash
node companies/<企業名>/scripts/fetch-stock-prices.js
```

- 出力: `companies/<企業名>/data/stock-prices.json`
- 取得項目: 四半期末終値、日付

### 3. xlsx生成

`companies/<企業名>/scripts/generate-xlsx.js` を実行し、xlsxファイルを生成する。

```bash
node companies/<企業名>/scripts/generate-xlsx.js
```

- 入力: `financials.json` + `stock-prices.json`
- 出力: `companies/<企業名>/data/Financials.xlsx`

### 4. 確認

生成されたxlsxを開き、既存の「AI企業の業績と予想.xlsx」とデータを比較する。
差異があれば原因を調査し、スクリプトを修正して再実行する。
