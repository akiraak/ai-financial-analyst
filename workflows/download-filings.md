# 決算資料のダウンロード

## 方針

- ファイルのダウンロード実行に許可は不要（確認なしで進めてよい）
- **企業IRの四半期決算ページを資料の一覧元（マスター）とする**

## 手順

### 1. 調査

対象企業の以下の情報を調べる:

- 公式IRページのURL
- **四半期決算の一覧ページのURL**（例: investor.nvidia.com/financial-info/quarterly-results/）
- SEC EDGAR上のCIK番号
- 会計年度（Fiscal Year）の定義（期末月）
- 取得可能な決算資料の種類と期間

調査結果をユーザーに提示し、以下を確認する:

1. **四半期決算の一覧ページURL**が正しいか
2. **取得対象の期間**（例: 「直近3年分」「FY2023〜FY2026」「全期間」など）

### 2. フォルダ作成

`companies/<企業名>/filings/` 配下にFY/Q単位のフォルダを作成する。

```
companies/<企業名>/filings/
├── FY2025/
│   ├── Q1/
│   ├── Q2/
│   ├── Q3/
│   └── Q4/
├── FY2024/
│   ├── Q1/
│   ...
└── README.md
```

### 3. ダウンロード

#### 3-1. IRページから資料リンクを取得

企業IRの四半期決算ページにアクセスし、各四半期の資料リンクをすべて取得する。

- Cloudflare等の保護がある場合は **Playwright** を使用する
  - インストール: `npx playwright install chromium`
- 取得したリンク一覧をJSON等で保存しておくと再利用しやすい

#### 3-2. 資料をダウンロード

取得したリンクから**全資料**をダウンロードする。

- IRページに掲載されているダウンロード可能な資料はすべて取得する
- ウェブキャスト（ストリーミング動画）は除外する
- 10-Q/10-K がIRページから直接取得できない場合は、SEC EDGAR から取得する
  - SEC EDGAR Filing URL: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=<CIK>&type=10-Q&dateb=&owner=include&count=40`
  - PDF直リンクが無い場合は Filing Detail ページから "10-Q" / "10-K" 本体のHTMファイルを特定し取得する

#### 3-3. ファイル名のルール

| 資料 | ファイル名 |
|------|-----------|
| 決算プレスリリース | `press-release.*` |
| 10-Q（四半期報告書） | `10-Q.pdf` |
| 10-K（年次報告書） | `10-K.pdf` |
| CFO Commentary | `cfo-commentary.pdf` |
| その他の資料 | 企業が付けた名前をそのまま使用する |

### 4. README.md の記録

`companies/<企業名>/filings/README.md` に以下を記録する:

- 企業の基本情報（IRページURL、CIK番号、会計年度定義）
- 各ファイルの取得元URL
- IRページ上での資料名称
- ファイルの説明

### 5. 確認

ダウンロード結果を確認し、不足があれば追加取得する。
