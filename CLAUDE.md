# AI Financial Analyst

本プロジェクトは Claude Code を使い、`workflows/` に定義された処理を実行することで株の分析ページ（GitHub Pages）を生成するものです。

## プロジェクト概要
決算プレスリリース等の原本資料から財務データを抽出し、チャート・解説テキスト付きの分析レポートページを生成・公開する。

## 主な処理の流れ
1. 決算資料（プレスリリース等）のダウンロード
2. 財務データの抽出・xlsx生成
3. 分析レポートページの生成（GitHub Pages）

## 初回案内・できること

- ユーザーが「始めます」「何ができる？」等と聞いた場合は [workflows/help.md](workflows/help.md) を読み、その内容に沿って案内する

## 技術スタック

## ディレクトリ構成
```
ai-financial-analyst/
├── CLAUDE.md        # プロジェクト説明・開発ガイド
├── TODO.md          # 未完了タスク
├── DONE.md          # 完了タスク
├── README.md        # リポジトリ説明
├── LICENSE
├── workflows/       # 対話フロー定義
│   ├── help.md              # ヘルプ・初回案内フロー
│   ├── download-filings.md  # 決算資料ダウンロードフロー
│   ├── generate-financials.md # 業績データxlsx生成フロー
│   ├── validate-xlsx.md      # xlsx数値検証フロー
│   ├── analyze-and-visualize.md # データ分析・可視化フロー
│   ├── full-build.md         # フルビルド（DL→抽出→xlsx→ページ生成）
│   └── update-earnings.md   # 決算更新（既存企業の新四半期追加）
├── companies/       # 企業別の分析データ・スクリプト（全10社）
│   ├── nvidia/      # NVIDIA (NVDA)
│   ├── broadcom/    # Broadcom (AVGO)
│   ├── alphabet/    # Alphabet (GOOGL)
│   ├── intel/       # Intel (INTC)
│   ├── meta/        # Meta Platforms (META)
│   ├── palantir/    # Palantir (PLTR)
│   ├── tesla/       # Tesla (TSLA)
│   ├── apple/       # Apple (AAPL)
│   ├── microsoft/   # Microsoft (MSFT)
│   ├── tsmc/        # Taiwan Semiconductor Manufacturing (TSM)
│   └── <企業名>/    # 各社共通構成:
│       ├── config.json        # 期間設定（pageYears, chartYears, nextEarningsDate）
│       ├── filings/           # 決算資料の原本
│       │   ├── FY20XX/
│       │   │   ├── Q1/ ... Q4/
│       │   │   │   ├── press-release.*  # 決算プレスリリース（共通名称）
│       │   │   │   ├── 10-Q.pdf        # 四半期報告書（Q1〜Q3）
│       │   │   │   ├── 10-K.pdf        # 年次報告書（Q4のみ）
│       │   │   │   └── ...              # その他資料（企業固有の名前で保存）
│       │   │   └── ...
│       │   └── README.md      # 資料一覧・URL対応表・ファイル説明
│       ├── scripts/           # 処理コード（JSスクリプト）
│       │   ├── extract-financials.js  # P/Lデータ抽出
│       │   ├── extract-segments.js    # セグメント別売上抽出
│       │   ├── extract-segment-profit.js # セグメント別損益抽出
│       │   ├── extract-balance-sheet.js  # B/Sデータ抽出
│       │   ├── extract-cash-flows.js  # キャッシュフロー抽出
│       │   ├── extract-investments.js # 投資コミットメント抽出
│       │   ├── fetch-stock-prices.js  # 四半期末株価取得
│       │   ├── generate-xlsx.js       # xlsx生成
│       │   ├── validate-xlsx.js       # xlsx数値検証
│       │   ├── generate-data-json.js  # GitHub Pages用data.json生成
│       │   ├── generate-ir-links.js   # 決算資料リンクJSON生成
│       │   ├── generate-pages.js      # HTMLページ生成
│       │   ├── download-filings.js    # 決算資料ダウンロード
│       │   └── download-10q-10k.js    # 10-Q/10-Kダウンロード
│       └── data/              # データファイル（JSON, xlsx）
│           ├── financials.json        # 抽出済みP/Lデータ
│           ├── segments.json          # セグメント別売上データ
│           ├── segment-profit.json    # セグメント別損益データ
│           ├── balance-sheet.json     # B/Sデータ
│           ├── cash-flows.json        # キャッシュフローデータ
│           ├── investments.json       # 投資コミットメントデータ
│           ├── stock-prices.json      # 取得済み株価データ
│           ├── quarterly-links.json   # 四半期別資料リンク
│           ├── template.xlsx          # xlsx生成用テンプレート
│           └── Financials.xlsx        # 生成されたxlsx
├── assets/          # ソースアセット
│   └── character/             # キャラクター画像（原本）
├── docs/            # GitHub Pages公開ディレクトリ
│   ├── index.html             # 企業一覧トップページ（WSJ風デザイン）
│   ├── ogp.png                # OGP画像（SNS共有用）
│   ├── css/
│   │   └── style.css          # 共通スタイル
│   ├── js/
│   │   ├── chart-builder.js   # 共通チャート生成ロジック（13チャート）
│   │   └── quarter-detail.js  # 四半期詳細ページのロジック
│   ├── character/             # キャラクター画像（公開用・assets/character/ からコピー）
│   └── <企業名>/              # 全10社共通構成（nvidia, broadcom, alphabet 等）
│       ├── index.html         # 企業ランディングページ（WSJ風デザイン）
│       ├── data.json          # 統合データ（全四半期）
│       ├── analysis-text.json # チャート解説・決算サマリーテキスト
│       ├── ir-links.json      # 決算資料リンク一覧
│       └── quarters/          # 四半期別分析ページ
│           ├── index.html     # 四半期選択ページ
│           ├── template.html  # 詳細ページテンプレート
│           └── <YYYYQN>/     # 例: 2026Q3/
│               ├── index.html # 四半期詳細ページ（テンプレートコピー）
│               └── data.json  # その四半期までのデータ
```

## 作業フロー: 決算資料の取得

- 作業開始時に [workflows/download-filings.md](workflows/download-filings.md) を読み、その指示に従うこと
- 詳細な手順・ルールはすべてワークフローファイルに記載

## 作業フロー: 業績データxlsx生成

- [workflows/generate-financials.md](workflows/generate-financials.md) を読み、その指示に従うこと
- press-release.html → financials.json → stock-prices.json → Financials.xlsx

## 作業フロー: xlsx数値検証

- [workflows/validate-xlsx.md](workflows/validate-xlsx.md) を読み、その指示に従うこと
- 生成済みxlsxの数値をソースデータ・原本と突合する

## 作業フロー: データ分析・可視化

- [workflows/analyze-and-visualize.md](workflows/analyze-and-visualize.md) を読み、その指示に従うこと
- GitHub Pagesで業績レポートダッシュボードを公開する

## 作業フロー: フルビルド

- [workflows/full-build.md](workflows/full-build.md) を読み、その指示に従うこと
- DL → データ抽出 → xlsx生成 → ページ生成 を一気通貫で実行する

## 作業フロー: 決算更新

- [workflows/update-earnings.md](workflows/update-earnings.md) を読み、その指示に従うこと
- 既存企業に新四半期の決算データを追加する差分更新フロー

## 開発ルール

### ワークフロー中心の運用
- **このプロジェクトのすべての作業は `workflows/` のワークフローに基づいて実行される**
- ワークフローはページの構成・コンテンツ仕様・生成手順を定義する唯一の情報源（Single Source of Truth）である
- コードやページを変更する際は、必ず先にワークフローを確認し、変更後はワークフローも合わせて更新すること
- ワークフローに記載のない変更は行わない。新しい機能・構成変更が必要な場合は、まずワークフローに仕様を追記してから実装する

### モードの区別
- **実装モード**（コード作成・設計変更）: プランを作成しユーザーの許可を求める。実装後にワークフローを更新する
- **実行モード**（ワークフローに沿った作業）: プラン不要。該当するワークフローファイルを読み、その手順に従って進める
- **フルビルド一括実行モード**: full-build.md の Step 0（企業選択）と Step 1（config.json設定）でユーザーの承認を得たら、Step 2〜7 はエラーが発生しない限り確認なしで一気通貫で実行する。スクリプトの新規作成・実行・ファイル生成もすべて自動で進める

### 共通ルール
- **ユーザーの明示的な指示なしにコードやファイルを変更しない。** 提案・質問だけの場面で勝手に実装してはならない（ただしフルビルド一括実行モード中を除く）
- プランが承認されても勝手に作業を開始しない。ユーザーの明示的な指示を待つこと（ただしフルビルド一括実行モード中を除く）
- コードは日本語コメントで記述する
- コミットメッセージは日本語で書く
- コミットはユーザーの指示があるまで行わない（勝手にコミットしない）
- **TODO管理:** タスク完了時は TODO.md の項目にチェックを付けるのではなく、DONE.md に移動する
- **コミット前チェックリスト（必須）:**
  1. CLAUDE.md: ディレクトリ構成等に変更があれば更新する
  - これらの更新を行わずにコミットしてはならない
