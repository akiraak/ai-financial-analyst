// 欠けているプレスリリースを補完ダウンロードするスクリプト
const { chromium } = require('playwright');
const fs = require('fs');

const missing = [
  {
    dir: '/home/ubuntu/ai-financial-analyst/companies/nvidia/filings/FY2024/Q4',
    url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-fourth-quarter-and-fiscal-2024',
    file: 'press-release.html'
  },
  {
    dir: '/home/ubuntu/ai-financial-analyst/companies/nvidia/filings/FY2024/Q1',
    url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2024',
    file: 'press-release.html'
  }
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });

  for (const item of missing) {
    const filePath = `${item.dir}/${item.file}`;
    console.log(`Downloading ${filePath} ...`);
    const page = await context.newPage();
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    fs.writeFileSync(filePath, html);
    await page.close();
    console.log(`  Done (${html.length} bytes)`);
  }

  await browser.close();
  console.log('All missing files downloaded.');
})();
