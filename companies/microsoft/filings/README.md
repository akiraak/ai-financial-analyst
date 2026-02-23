# Microsoft Corporation (MSFT) 決算資料

CIK: 789019
会計年度: 7月〜6月（FY2026 = 2025年7月〜2026年6月）

## ファイル構成

各四半期フォルダに以下のファイルが格納されている:

| ファイル名 | 内容 | ソース |
|---|---|---|
| `press-release.html` | 決算プレスリリース（8-K Exhibit 99.1） | SEC EDGAR |
| `10-Q.pdf` | 四半期報告書（Q1〜Q3） | SEC EDGAR → Playwright PDF変換 |
| `10-K.pdf` | 年次報告書（Q4のみ） | SEC EDGAR → Playwright PDF変換 |

## 期間

- FY2021 Q1（2020年7月-9月）〜 FY2026 Q2（2025年10月-12月）
- 全22四半期

## データ抽出スクリプト

| スクリプト | 入力 | 出力 | 内容 |
|---|---|---|---|
| `extract-financials.js` | press-release.html | financials.json | P/L（売上・利益・EPS） |
| `extract-segments.js` | press-release.html | segments.json, segment-profit.json | セグメント売上・営業利益 |
| `extract-balance-sheet.js` | press-release.html | balance-sheet.json | B/S（資産・負債・純資産） |
| `extract-cash-flows.js` | press-release.html | cash-flows.json | CF（営業・投資・財務CF、FCF） |
| `extract-investments.js` | 10-Q/10-K PDF | investments.json | エクイティ投資残高 |

## SEC EDGAR URL パターン

プレスリリース（8-K Exhibit 99.1）:
- 旧形式: `https://www.sec.gov/Archives/edgar/data/789019/{ADSH}/{FILE}`
- FY2021 Q1 例: `0001193125-20-278410` / `d10535dex991.htm`
- FY2026 Q2 例: `0000950170-26-010903` / `msft-ex99_1.htm`

10-Q/10-K:
- `https://www.sec.gov/Archives/edgar/data/789019/{ADSH_NO_DASH}/{FILE}`
- FY2021 Q1 例: `0001564590-20-047996` / `msft-10q_20200930.htm`

## HTML形式の違い

プレスリリースHTMLには2つの形式がある:

- **旧形式（FY2021 Q1 〜 FY2023 Q3）**: 大文字HTMLタグ（`<TD>`, `<TR>`）、`BGCOLOR`属性、`VALIGN="top"` でラベルを表示
- **新形式（FY2023 Q4以降）**: 小文字タグ、inline CSS、`text-align:center` + 内部 `<p style="text-align:right">` で値を表示、現期データは `font-weight:bold`

## 注意事項

- FY2025（2024年7月以降）にセグメント再編あり（一部製品のセグメント間移管）
- 株式分割は2003年以降なし
- MicrosoftはFCFをnon-GAAP指標として開示しないため、FCF = 営業CF - |設備投資| で算出
