# AI Financial Analyst

本プロジェクトは Claude Code を使い、`workflows/` に定義された処理を実行することで財務分析を行うものです。

## プロジェクト概要
AIを活用した株価関連の財務分析ツール。株価データの取得・解析・可視化を行う。

## 分析対象
- 株価データ（日次・週次・月次）
- ファンダメンタルズ（PER、PBR、配当利回り等）
- 財務諸表（売上高、営業利益、純利益等）

## 技術スタック
- 進捗管理: TODO.md / DONE.md

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
│   └── analyze-and-visualize.md # データ分析・可視化フロー
├── companies/       # 企業別の分析データ・スクリプト
│   └── <企業名>/
│       ├── filings/           # 決算資料の原本
│       │   ├── FY20XX/
│       │   │   ├── Q1/ ... Q4/
│       │   │   │   ├── press-release.*  # 決算プレスリリース（共通名称）
│       │   │   │   └── ...              # その他資料（企業固有の名前で保存）
│       │   │   └── ...
│       │   └── README.md      # 資料一覧・URL対応表・ファイル説明
│       └── analysis/           # 分析用データ・スクリプト
│           ├── extract-financials.js  # P/Lデータ抽出
│           ├── fetch-stock-prices.js  # 四半期末株価取得
│           ├── generate-xlsx.js       # xlsx生成
│           ├── generate-data-json.js  # GitHub Pages用data.json生成
│           ├── template.xlsx          # xlsx生成用テンプレート
│           ├── financials.json        # 抽出済みP/Lデータ
│           ├── stock-prices.json      # 取得済み株価データ
│           └── NVDA-Financials.xlsx          # 生成されたxlsx
├── docs/            # GitHub Pages公開ディレクトリ
│   ├── index.html             # 企業一覧トップページ
│   ├── css/
│   │   └── style.css          # 共通スタイル
│   ├── js/
│   │   ├── chart-builder.js   # 共通チャート生成ロジック（13チャート）
│   │   └── quarter-detail.js  # 四半期詳細ページのロジック
│   └── nvidia/
│       ├── index.html         # NVIDIAレポートページ
│       ├── data.json          # 統合データ（全四半期）
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
- press-release.html → financials.json → stock-prices.json → NVDA-Financials.xlsx

## 作業フロー: xlsx数値検証

- [workflows/validate-xlsx.md](workflows/validate-xlsx.md) を読み、その指示に従うこと
- 生成済みxlsxの数値をソースデータ・原本と突合する

## 作業フロー: データ分析・可視化

- [workflows/analyze-and-visualize.md](workflows/analyze-and-visualize.md) を読み、その指示に従うこと
- GitHub Pagesで業績レポートダッシュボードを公開する

## 開発ルール

### ワークフロー中心の運用
- **このプロジェクトのすべての作業は `workflows/` のワークフローに基づいて実行される**
- ワークフローはページの構成・コンテンツ仕様・生成手順を定義する唯一の情報源（Single Source of Truth）である
- コードやページを変更する際は、必ず先にワークフローを確認し、変更後はワークフローも合わせて更新すること
- ワークフローに記載のない変更は行わない。新しい機能・構成変更が必要な場合は、まずワークフローに仕様を追記してから実装する

### モードの区別
- **実装モード**（コード作成・設計変更）: プランを作成しユーザーの許可を求める。実装後にワークフローを更新する
- **実行モード**（ワークフローに沿った作業）: プラン不要。該当するワークフローファイルを読み、その手順に従って進める

### 共通ルール
- **ユーザーの明示的な指示なしにコードやファイルを変更しない。** 提案・質問だけの場面で勝手に実装してはならない
- プランが承認されても勝手に作業を開始しない。ユーザーの明示的な指示を待つこと
- タスク着手前にTODO.mdを確認する
- タスク完了時にTODO.mdからDONE.mdへ移動する
- コードは日本語コメントで記述する
- コミットメッセージは日本語で書く
- コミットはユーザーの指示があるまで行わない（勝手にコミットしない）
- コミット前にCLAUDE.md、TODO.md、DONE.mdを最新の状態に更新する
- TODOを表示する際は、優先順に番号を振って次に処理すべきタスクが分かりやすいようにする
