# DONE

## 完了タスク
- [x] リポジトリ作成（Initial commit）
- [x] CLAUDE.md / TODO.md / DONE.md を作成
- [x] プロジェクトの基本構成を決定（companies/nvidia、Node.js + xlsx）
- [x] 開発環境のセットアップ（package.json、xlsxパッケージ導入）
- [x] 財務データの取得方法を決定（エクセル + xlsxパッケージ）
- [x] エクセルの業績データとNVIDIA公式IRの実績値を突合（44件中42件一致、2件軽微な差異）
- [x] NVIDIA決算資料のダウンロード（FY2023〜FY2026 Q3、10-K/10-Q 15件 + プレスリリース 15件 = 全30ファイル）
- [x] 決算資料から業績データxlsxを生成するワークフローを作成
  - extract-financials.js: press-release.html からP/Lデータ抽出（19四半期、FY2022 Q1〜FY2026 Q3）
  - fetch-stock-prices.js: Yahoo Finance APIから四半期末株価取得
  - generate-xlsx.js: NVDA業績.xlsx生成（AI企業の業績と予想.xlsxと同一レイアウト）
  - 既存xlsxとの突合: 売上高・粗利・R&D・SGA・営業利益・純利益は100%一致
