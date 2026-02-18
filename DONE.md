# DONE

## 完了タスク
- [x] リポジトリ作成（Initial commit）
- [x] CLAUDE.md / TODO.md / DONE.md を作成
- [x] プロジェクトの基本構成を決定（companies/nvidia、Node.js + xlsx）
- [x] 開発環境のセットアップ（package.json、xlsxパッケージ導入）
- [x] 財務データの取得方法を決定（エクセル + xlsxパッケージ）
- [x] エクセルの業績データとNVIDIA公式IRの実績値を突合（44件中42件一致、2件軽微な差異）
- [x] NVIDIA決算資料のダウンロード（FY2022〜FY2026 Q3、10-K/10-Q 19件 + プレスリリース 19件 = 全38ファイル）
- [x] 決算資料から業績データxlsxを生成するワークフローを作成
  - extract-financials.js: press-release.html からP/Lデータ抽出（19四半期、FY2022 Q1〜FY2026 Q3）
  - fetch-stock-prices.js: Yahoo Finance APIから四半期末株価取得
  - generate-xlsx.js: template.xlsxベースでNVDA業績.xlsx生成
  - 既存xlsxとの突合: 売上高・粗利・R&D・SGA・営業利益・純利益は100%一致
- [x] テンプレート・スクリプトの整備
  - template.xlsxから年度・Qラベル・設定パラメータを削除（スクリプトで動的設定）
  - 不要行を削除（ROE・計算PER・時価総額・設定パラメータ）
  - カテゴリ別色分けデザイン（売上:緑、利益:青、費用:橙、株式:紫）
- [x] FY2026 Q4 Outlookデータの反映（ガイダンスベースの予想値）
- [x] xlsx数値検証ワークフローを作成・実行（全437項目一致）
- [x] データ分析・可視化の要件定義（workflows/analyze-and-visualize.md）
  - グラフ4種類: P/L推移、利益率推移、株価&PER複合、費用構造
  - 技術スタック: GitHub Pages + Chart.js（静的HTML、ビルド不要）
  - 複数企業対応のディレクトリ構成を設計
- [x] GitHub Pages ダッシュボードの実装（ステップ1〜4）
  - generate-data-json.js: financials.json + stock-prices.json → data.json 統合
  - docs/nvidia/data.json: 20四半期分の統合データ生成
  - docs/js/chart-builder.js: 4種類のグラフ描画ロジック
  - docs/css/style.css, docs/index.html, docs/nvidia/index.html
