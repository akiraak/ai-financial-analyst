# 決算更新（既存企業の新四半期追加）

## 目的

既にフルビルド済みの企業に、新しい四半期決算データを追加する。既存のスクリプトを流用し、新四半期分のみ差分処理する。

## 前提

- 対象企業のフルビルドが完了していること（`companies/<企業名>/` に scripts/, data/, filings/ が揃っている）
- 新しい四半期の決算が発表済みであること

## フルビルドとの違い

| 項目 | フルビルド | 決算更新 |
|------|-----------|---------|
| スクリプト | 新規作成 or 流用 | 既存をそのまま使用 |
| データ削除 | 全削除してクリーンビルド | 削除しない（追加のみ） |
| 決算資料DL | 全期間 | 新四半期分のみ |
| 抽出・生成 | 全期間 | 全期間再実行（新四半期を含む） |

## 一括実行モード

Step 0（企業選択）と Step 1（config.json更新）でユーザーの承認を得たら、**Step 2〜7 はエラーが発生しない限り確認なしで一気通貫で実行する。**

## 手順

### 0. 対象企業の確認

ユーザーに対象企業を確認する。

- 企業名と現在の config.json の内容を表示する
- どの四半期の決算が追加されるか確認する

### 1. config.json の更新

`companies/<企業名>/config.json` を確認・更新する。

**確認項目:**
1. **nextEarningsDate** — WebSearchで「<企業名> next earnings date <現在の年>」を検索し、次回決算発表日を更新する
2. **pageYears / chartYears** — 変更が必要か確認する（通常は変更不要）

**予想（Outlook）データの扱い:**
- 前回ビルド時に Outlook として含めていた四半期が実績に変わる場合、抽出スクリプトが実績データで上書きする
- 新たな Outlook を追加するかはプレスリリースのガイダンス記載に応じて判断する

**ユーザーが Step 1 で設定を承認したら、一括実行モードに入り Step 2〜7 を自動実行する。**

### 2. 新四半期の決算資料ダウンロード

新しい四半期の決算資料のみダウンロードする。

#### 2-1. フォルダ作成

```bash
mkdir -p companies/<企業名>/filings/FY<YYYY>/Q<N>
```

#### 2-2. ダウンロードスクリプトの更新

新四半期のエントリを以下のスクリプトに追加する:

- `download-filings.js` — プレスリリースのSEC EDGAR情報（adsh, file, date）を追加
- `download-10q-10k.js` — 10-Q/10-Kのフィリング情報（adsh, file, type, date）を追加

#### 2-3. 資料のダウンロード

[download-filings.md](download-filings.md) のルールに従い、新四半期の資料をダウンロードする。

- プレスリリース（`press-release.*`）— SEC EDGARから取得（必須）
- 10-Q / 10-K — `download-10q-10k.js` を実行（HTMダウンロード → Playwright でPDF変換）
- その他IRページに掲載されている資料

#### 2-4. filings/README.md の更新

新四半期の資料情報を `companies/<企業名>/filings/README.md` に追記する。

### 3. データ抽出（全期間再実行）

既存の抽出スクリプトを再実行する。新四半期のデータが自動的に追加される。

#### 3a. 抽出スクリプト（並列実行可能）

```bash
node companies/<企業名>/scripts/extract-financials.js
node companies/<企業名>/scripts/extract-segments.js
node companies/<企業名>/scripts/extract-balance-sheet.js
node companies/<企業名>/scripts/extract-cash-flows.js
node companies/<企業名>/scripts/extract-segment-profit.js
node companies/<企業名>/scripts/extract-investments.js
```

#### 3b. 株価取得（financials.json に依存）

```bash
node companies/<企業名>/scripts/fetch-stock-prices.js
```

**確認ポイント:**
- 各JSONの四半期数が増えていることを確認する（例: 19四半期 → 20四半期）
- 新四半期のデータが正しく抽出されているか簡易確認する

### 4. xlsx再生成

```bash
node companies/<企業名>/scripts/generate-xlsx.js
```

### 5. xlsx検証

```bash
node companies/<企業名>/scripts/validate-xlsx.js
```

[validate-xlsx.md](validate-xlsx.md) の基準に従い、全四半期の数値を検証する。

### 6. ページ再生成

#### 6-1. generate-ir-links.js のエントリ追加

新四半期のIR資料リンクを `generate-ir-links.js` の `irDocuments` に追加する。

- IRページまたはWebSearchで新四半期の資料URL（Press Release, CFO Commentary, Revenue Trend, 10-Q/10-K, Presentation, Transcript等）を収集する
- 各URLの存在を `curl -sI` で確認してからエントリに追加する
- 発表直後はIRページに未反映のことがあるため、`q4cdn.com` のURLパターンやWebSearchで直接探す

#### 6-2. ページ生成スクリプトの実行

```bash
node companies/<企業名>/scripts/generate-pages.js
node companies/<企業名>/scripts/generate-data-json.js
node companies/<企業名>/scripts/generate-ir-links.js
```

- 新四半期のページが追加される
- ランディングページの四半期リンクが更新される
- 既存の四半期ページは `pageYears` の範囲外でも保持される（フォルダが存在する限り `hasPage=true`）

### 7. 分析テキストの更新（analysis-text.json）

[analyze-and-visualize.md](analyze-and-visualize.md) の手順4に従い、`docs/<企業名>/analysis-text.json` を更新する。

**更新内容:**
- 新四半期の `summary`（定性情報 + 数値分析）を追加
- 新四半期の `charts`（12チャートの分析テキスト）を追加
- `overviews` は基本的に変更不要（必要なら更新）

### 8. 確認

以下を確認し、結果をユーザーに報告する:

- `docs/<企業名>/index.html` — ランディングページに新四半期のリンクが表示されること
- `docs/<企業名>/quarters/<YYYYQN>/index.html` — 新四半期の詳細ページが正しく表示されること
- KPI・チャート・解説テキスト・決算サマリーがすべて表示されること
- トップページ（`docs/index.html`）の企業カードに最新期間が反映されていること
