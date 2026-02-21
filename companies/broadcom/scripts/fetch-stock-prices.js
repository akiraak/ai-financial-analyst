// Yahoo Finance APIからBroadcom(AVGO)の四半期末株価を取得するスクリプト
// 出力: stock-prices.json

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'stock-prices.json');
const FINANCIALS_PATH = path.join(__dirname, '..', 'data', 'financials.json');
const TICKER = 'AVGO';

// Broadcomの四半期末日（概算）
// 52/53週制: 10月末に最も近い日曜日が期末
// Q1: 1月末〜2月初旬, Q2: 4月末〜5月初旬, Q3: 7月末〜8月初旬, Q4: 10月末〜11月初旬
function getQuarterEndDate(fy, q) {
  const fyNum = parseInt(fy.replace('FY', ''));
  // Broadcomの会計年度は前年11月〜当年10月
  // FY2025: 2024年11月〜2025年10月

  switch (q) {
    case 'Q1': return new Date(fyNum, 0, 31);   // 1月末頃
    case 'Q2': return new Date(fyNum, 4, 3);    // 5月初旬頃
    case 'Q3': return new Date(fyNum, 7, 3);    // 8月初旬頃
    case 'Q4': return new Date(fyNum, 10, 2);   // 11月初旬頃
    default: return null;
  }
}

// HTTPSリクエスト
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSONパースエラー: ${e.message}\nレスポンス: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('タイムアウト'));
    });
  });
}

// 指定日付付近の株価を取得
async function getStockPrice(targetDate) {
  const startDate = new Date(targetDate);
  startDate.setDate(startDate.getDate() - 7);
  const endDate = new Date(targetDate);
  endDate.setDate(endDate.getDate() + 3);

  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${TICKER}?period1=${period1}&period2=${period2}&interval=1d`;

  const data = await fetchJSON(url);

  if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
    throw new Error('株価データが取得できません');
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  const closes = result.indicators.quote[0].close;

  if (!timestamps || timestamps.length === 0) {
    throw new Error('株価データが空です');
  }

  // 目標日以前で最も近い取引日の終値を取得
  const targetTimestamp = Math.floor(targetDate.getTime() / 1000);
  let bestIdx = -1;
  let bestDiff = Infinity;

  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] <= targetTimestamp + 86400) {
      const diff = targetTimestamp - timestamps[i];
      if (diff >= -86400 && diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
  }

  if (bestIdx === -1) {
    for (let i = 0; i < timestamps.length; i++) {
      const diff = Math.abs(timestamps[i] - targetTimestamp);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
  }

  if (bestIdx === -1) {
    throw new Error('適切な取引日が見つかりません');
  }

  const date = new Date(timestamps[bestIdx] * 1000);
  const dateStr = date.toISOString().split('T')[0];
  const price = Math.round(closes[bestIdx] * 100) / 100;

  return { price, date: dateStr };
}

// メイン処理
async function main() {
  if (!fs.existsSync(FINANCIALS_PATH)) {
    console.error('financials.json が見つかりません。先に extract-financials.js を実行してください。');
    process.exit(1);
  }

  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = {};

  const quarters = [];
  for (const fy of Object.keys(financials).sort()) {
    for (const q of Object.keys(financials[fy]).sort()) {
      quarters.push({ fy, q });
    }
  }

  console.log(`${quarters.length} 四半期分の株価を取得します...\n`);

  for (const { fy, q } of quarters) {
    const targetDate = getQuarterEndDate(fy, q);
    if (!targetDate) {
      console.warn(`  スキップ: ${fy}/${q} - 日付計算エラー`);
      continue;
    }

    try {
      // APIレートリミット対策: 1秒間隔
      await new Promise(resolve => setTimeout(resolve, 1000));

      const result = await getStockPrice(targetDate);
      if (!stockPrices[fy]) stockPrices[fy] = {};
      stockPrices[fy][q] = result;
      console.log(`${fy}/${q}: $${result.price} (${result.date})`);
    } catch (err) {
      console.error(`  エラー: ${fy}/${q} - ${err.message}`);
    }
  }

  // JSON出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stockPrices, null, 2));
  console.log(`\n出力: ${OUTPUT_PATH}`);
  console.log(`合計: ${Object.values(stockPrices).reduce((sum, fy) => sum + Object.keys(fy).length, 0)} 四半期分の株価を取得`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
