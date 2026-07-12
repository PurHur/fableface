// quick boot sanity: page reveals, no pageerrors, status live, screenshot
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(process.env.URL || 'http://localhost:8799/?sim=0', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__fableface && window.__fableface.api, { timeout: 20000 });
await page.waitForTimeout(9000);
const st = await page.evaluate(() => window.__fableface.api.status());
console.log('status:', JSON.stringify(st));
console.log('errors:', JSON.stringify(errors));
await page.evaluate(() => window.__fableface.api.setEmotion('confused', 1));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test/shot-math-confused.png' });
await page.evaluate(() => window.__fableface.api.setEmotion('determined', 1));
await page.waitForTimeout(6000);
await page.screenshot({ path: 'test/shot-math-determined.png' });
await browser.close();
if (errors.length) { console.error('BOOT FAIL'); process.exit(1); }
console.log('BOOT PASS');
