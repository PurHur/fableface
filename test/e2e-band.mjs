import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.goto('http://localhost:8799/?sim=0', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__fableface && window.__fableface.api, { timeout: 20000 });
await page.waitForTimeout(8000);
await page.evaluate(() => window.__fableface.api.setScene('vault'));
await page.waitForTimeout(5000);
await page.screenshot({ path: 'test/shot-band-vault.png' });
await page.evaluate(() => window.__fableface.api.setScene('chamber'));
// switch face to WISP VI via its selector chip
await page.click('text=WISP VI');
await page.waitForTimeout(12000);
await page.screenshot({ path: 'test/shot-band-wisp6.png' });
await browser.close();
console.log('done');
