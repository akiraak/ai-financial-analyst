# Apple Inc. (AAPL) 決算資料

## 企業情報
- **企業名**: Apple Inc.
- **ティッカー**: AAPL (NASDAQ)
- **CIK**: 0000320193
- **会計年度**: 10月〜9月（例: FY2026 = 2025年10月〜2026年9月）
- **IRページ**: https://investor.apple.com/investor-relations/default.aspx
- **SEC EDGAR**: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-Q&dateb=&owner=include&count=40

## 収録期間
FY2021 Q1 〜 FY2026 Q1（21四半期分）

## ファイル構成

各四半期フォルダ（`FY20XX/QN/`）には以下のファイルが格納されています：

| ファイル名 | 説明 | 取得元 |
|-----------|------|--------|
| `press-release.htm` | 決算プレスリリース（8-K EX-99.1） | SEC EDGAR |
| `10-Q.htm` | 四半期報告書（Q1〜Q3） | SEC EDGAR |
| `10-K.htm` | 年次報告書（Q4のみ） | SEC EDGAR |

## 会計年度と暦年の対応

| 会計四半期 | 期間 | 四半期末日（近似） |
|-----------|------|-----------------|
| Q1 | 10月〜12月 | 12月最終土曜日 |
| Q2 | 1月〜3月 | 3月最終土曜日 |
| Q3 | 4月〜6月 | 6月最終土曜日 |
| Q4 | 7月〜9月 | 9月最終土曜日 |

※ Appleは52/53週制のため、正確な四半期末日は年度により異なる。

## 注意事項

- プレスリリースのキャッシュフロー計算書はQ2以降累積表示（6ヶ月/9ヶ月/12ヶ月）
  - extract-cash-flows.js で自動的に四半期値に変換済み
- 地域セグメント: Americas, Europe, Greater China, Japan, Rest of Asia Pacific
- 製品カテゴリ: iPhone, Mac, iPad, Wearables/Home/Accessories, Services
