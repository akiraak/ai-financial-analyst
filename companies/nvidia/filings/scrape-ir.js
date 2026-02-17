// NVIDIAのIRページから全年度の四半期決算資料リンクを取得するスクリプト
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  console.log('Accessing NVIDIA quarterly results page...');
  await page.goto('https://investor.nvidia.com/financial-info/quarterly-results/default.aspx', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await page.waitForTimeout(5000);

  // 年度セレクタから利用可能な年度を取得
  const years = await page.evaluate(() => {
    const options = document.querySelectorAll('.module-quarterly-results select option, select option');
    return Array.from(options).map(o => o.value).filter(v => v && !isNaN(v));
  });
  console.log('Available years:', years);

  const allData = {};

  for (const year of years) {
    console.log(`\nFetching FY${year}...`);

    // 年度を選択
    await page.selectOption('select', year);
    await page.waitForTimeout(3000);

    // アコーディオンの各四半期セクションを展開してリンクを取得
    const quarterData = await page.evaluate((yr) => {
      const results = [];
      // アコーディオンのアイテムを探す
      const items = document.querySelectorAll('.module-quarterly-results_item, .accordion-item, [class*="quarterly"]  .item, .module_item');

      if (items.length === 0) {
        // フォールバック: ページ全体からリンクを取得
        const allLinks = document.querySelectorAll('a[href]');
        const docLinks = Array.from(allLinks).filter(a => {
          const href = a.href || '';
          const text = a.innerText || '';
          return (href.includes('q4cdn.com') || href.includes('nvidianews') || href.includes('sec.gov')) &&
                 (text.includes('Press Release') || text.includes('10-Q') || text.includes('10-K') ||
                  text.includes('CFO') || text.includes('Transcript') || text.includes('Presentation') ||
                  text.includes('Revenue Trend') || text.includes('Webcast'));
        });

        if (docLinks.length > 0) {
          results.push({
            quarter: 'unknown',
            documents: docLinks.map(a => ({
              name: a.innerText.trim().split('\n')[0].trim(),
              url: a.href,
              description: a.getAttribute('aria-label') || a.innerText.trim()
            }))
          });
        }
        return results;
      }

      items.forEach(item => {
        const header = item.querySelector('h2, h3, h4, .header, button, [class*="header"]');
        const quarterName = header ? header.innerText.trim() : 'Unknown';

        const links = item.querySelectorAll('a[href]');
        const docs = Array.from(links)
          .filter(a => a.href && (a.href.includes('q4cdn.com') || a.href.includes('nvidianews') ||
                                   a.href.includes('sec.gov') || a.href.includes('events.q4inc')))
          .map(a => ({
            name: a.innerText.trim().split('\n')[0].trim(),
            url: a.href,
            description: a.getAttribute('aria-label') || a.innerText.trim()
          }));

        if (docs.length > 0) {
          results.push({ quarter: quarterName, documents: docs });
        }
      });

      return results;
    }, year);

    allData[`FY${year}`] = quarterData;
    console.log(`  Found ${quarterData.length} quarter(s) with ${quarterData.reduce((s, q) => s + q.documents.length, 0)} document(s)`);
  }

  // JSONとして保存
  const outputPath = '/home/ubuntu/ai-financial-analyst/companies/nvidia/filings/ir-links.json';
  fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2));
  console.log(`\nAll data saved to ${outputPath}`);

  await browser.close();
})();
