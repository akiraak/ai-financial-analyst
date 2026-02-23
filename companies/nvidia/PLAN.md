# NVIDIA業績分析 充実化プラン

## Context
現在のダッシュボードはP/L推移・利益率・株価&PER・費用構造の4チャートのみ。
セグメント別売上、B/S・CF、バリュエーション指標、成長率分析を追加し、計10チャートの包括的な分析ダッシュボードにする。

---

## Phase 1: セグメント別売上（新規チャート×2）

press-release.html の本文テキストからセグメント別売上を抽出する。

- **新規**: `extract-segments.js` → `segments.json`
  - Data Center / Gaming / Professional Visualization / Automotive / OEM & Other
  - 年度によるセグメント名変更を正規化（例: "Gaming and AI PC" → gaming）
  - 本文のbullet pointから `$X.XX billion` / `$XXX million` を正規表現で抽出
- **修正**: `generate-data-json.js` に segments データを統合
- **修正**: `chart-builder.js` にチャート2種追加
  - セグメント別売上（積み上げ棒グラフ）
  - セグメント別 売上比率（100%積み上げ棒グラフ）
- **修正**: `docs/nvidia/index.html` にcanvas要素追加

## Phase 2: B/S・キャッシュフロー（新規チャート×2）

press-release.htmlの構造化テーブルからB/S・CF を抽出する。

- **新規**: `extract-balance-sheet.js` → `balance-sheet.json`
  - "CONDENSED CONSOLIDATED BALANCE SHEETS" テーブルを解析
  - Cash, Total Assets, Total Liabilities, Equity, Short/Long-term Debt
  - 2列中の1列目（当四半期末）のみ取得
- **新規**: `extract-cash-flows.js` → `cash-flows.json`
  - "CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS" テーブルを解析
  - Operating CF, Investing CF, Financing CF
  - Free Cash FlowはGAAP reconciliationテーブルから抽出
  - Q1〜Q4で列数が異なる（2〜4列）→ 常に1列目を取得
- **修正**: `generate-data-json.js` に balanceSheet, cashFlow データを統合
- **修正**: `chart-builder.js` にチャート2種追加
  - B/S概要（棒グラフ: Total Assets, Liabilities, Equity, Cash）
  - キャッシュフロー（棒+折れ線: Operating/Investing/Financing CF + FCFライン）
- **修正**: `docs/nvidia/index.html` にcanvas要素追加

## Phase 3: バリュエーション指標（新規チャート×1）

Phase 2のB/Sデータを使い、追加指標を算出する（**Phase 2完了後に着手**）。

- **修正**: `generate-data-json.js` に `sharesDiluted`（スプリット調整済み）を追加
- **修正**: `chart-builder.js` にチャート1種追加
  - バリュエーション指標（複合折れ線: PER / PSR / PBR / EV/EBITDA）
  - PSR = 時価総額 / 直近4Q売上合計
  - PBR = 時価総額 / 純資産
  - EV/EBITDA = (時価総額 + 有利子負債 - 現金) / 直近4Q EBITDA
  - 全てchart-builder.js内でクライアントサイド計算
- **修正**: `docs/nvidia/index.html` にcanvas要素追加

## Phase 4: 成長率・トレンド分析（新規チャート×1）

既存P/Lデータのみで算出可能。抽出スクリプト不要。

- **修正**: `chart-builder.js` にチャート1種追加
  - 成長率推移（折れ線: 売上高・営業利益・純利益・EPSのYoY成長率）
  - 0%ラインを基準線として表示
- **修正**: `docs/nvidia/index.html` にcanvas要素追加

---

## ダッシュボード最終レイアウト（全10チャート）

1. P/L推移 ← 既存
2. **セグメント別売上** ← Phase 1
3. **セグメント別 売上比率** ← Phase 1
4. 利益率推移 ← 既存
5. **成長率推移（YoY）** ← Phase 4
6. 株価 & PER ← 既存
7. **バリュエーション指標** ← Phase 3
8. **B/S概要** ← Phase 2
9. **キャッシュフロー** ← Phase 2
10. 費用構造 ← 既存

## 変更ファイル一覧

| Phase | ファイル | 操作 |
|-------|---------|------|
| 1 | `analysis/extract-segments.js` | 新規 |
| 1 | `analysis/segments.json` | 生成 |
| 2 | `analysis/extract-balance-sheet.js` | 新規 |
| 2 | `analysis/extract-cash-flows.js` | 新規 |
| 2 | `analysis/balance-sheet.json` | 生成 |
| 2 | `analysis/cash-flows.json` | 生成 |
| 1-3 | `analysis/generate-data-json.js` | 修正 |
| 1-4 | `docs/js/chart-builder.js` | 修正 |
| 1-4 | `docs/nvidia/index.html` | 修正 |
| 1-3 | `docs/nvidia/data.json` | 再生成 |
