// Apple四半期末の株価をYahoo Financeから取得するスクリプト
// 入力: data/financials.json（四半期一覧）
// 出力: data/stock-prices.json

const fs = require('fs');
const path = require('path');
const https = require('https');

const FINANCIALS_PATH = path.join(__dirname, '..', 'data', 'financials.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'stock-prices.json');

const TICKER = 'AAPL';

/**
 * AppleのFY四半期末日を取得
 * Apple会計年度: 10月〜9月
 *   Q1: 10月〜12月末（12月最終土曜日付近）
 *   Q2: 1月〜3月末（3月最終土曜日付近）
 *   Q3: 4月〜6月末（6月最終土曜日付近）
 *   Q4: 7月〜9月末（9月最終土曜日付近）
 *
 * Appleの会計年度は52/53週制で正確な日付は年によって変わるため、
 * 月末日を近似として使用する
 */
function getQuarterEndDate(fy, q) {
  const year = parseInt(fy.replace('FY', ''));
  switch (q) {
    case 'Q1': return new Date(year - 1, 11, 31); // 前年12月末
    case 'Q2': return new Date(year, 2, 31);       // 3月末
    case 'Q3': return new Date(year, 5, 30);       // 6月末
    case 'Q4': return new Date(year, 8, 30);       // 9月末
    default: throw new Error(`Unknown quarter: ${q}`);
  }
}

/**
 * Yahoo Finance APIから株価を取得
 */
function fetchPrice(date) {
  return new Promise((resolve, reject) => {
    // 対象日の前後10日間のデータを取得
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - 10);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);

    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(endDate.getTime() / 1000);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${TICKER}?period1=${period1}&period2=${period2}&interval=1d`;

    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const result = json.chart.result[0];
          const timestamps = result.timestamp;
          const closes = result.indicators.quote[0].close;

          // 対象日以前で最も近い取引日の終値を取得
          const targetTs = Math.floor(date.getTime() / 1000);
          let bestIdx = -1;
          let bestTs = 0;

          for (let i = 0; i < timestamps.length; i++) {
            if (timestamps[i] <= targetTs && timestamps[i] > bestTs && closes[i] != null) {
              bestTs = timestamps[i];
              bestIdx = i;
            }
          }

          if (bestIdx === -1) {
            reject(new Error(`No price data found for ${date.toISOString().split('T')[0]}`));
            return;
          }

          const priceDate = new Date(timestamps[bestIdx] * 1000);
          resolve({
            price: Math.round(closes[bestIdx] * 100) / 100,
            date: priceDate.toISOString().split('T')[0],
          });
        } catch (err) {
          reject(new Error(`Parse error: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const financials = JSON.parse(fs.readFileSync(FINANCIALS_PATH, 'utf-8'));
  const stockPrices = {};

  const quarters = [];
  for (const fy of Object.keys(financials).sort()) {
    for (const q of Object.keys(financials[fy]).sort()) {
      quarters.push({ fy, q });
    }
  }

  console.log(`Apple (${TICKER}) 株価取得: ${quarters.length}四半期分\n`);

  let success = 0, failed = 0;
  for (const { fy, q } of quarters) {
    const date = getQuarterEndDate(fy, q);

    try {
      const result = await fetchPrice(date);
      if (!stockPrices[fy]) stockPrices[fy] = {};
      stockPrices[fy][q] = result;
      console.log(`[OK] ${fy} ${q} - $${result.price} (${result.date})`);
      success++;
    } catch (err) {
      console.error(`[ERR] ${fy} ${q}: ${err.message}`);
      failed++;
    }

    // レートリミット対策（1秒待機）
    await new Promise(r => setTimeout(r, 1000));
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stockPrices, null, 2));
  console.log(`\n=== 結果: 成功 ${success}件, 失敗 ${failed}件 ===`);
  console.log(`出力: ${OUTPUT_PATH}`);
}

main();
