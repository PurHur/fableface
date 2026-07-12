import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8799/?sim=0', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__fableface && window.__fableface.api, { timeout: 20000 });
await page.waitForTimeout(16000); // fully settled reveal
await page.evaluate(() => window.__fableface.api.setEmotion('determined', 1));
await page.waitForTimeout(9000);  // Kuramoto locks
await page.screenshot({ path: 'test/shot-m3-coherent.png' });
await page.evaluate(() => window.__fableface.api.setEmotion('confused', 1));
await page.waitForTimeout(9000);  // bank desyncs, Thomas currents appear
await page.screenshot({ path: 'test/shot-m3-chaos.png' });
await page.evaluate(() => { window.__fableface.api.setEmotion('joy', 1); window.__fableface.api.say('Standing waves ripple over my skin as I speak — the mathematics of my own voice, resonating through a hundred thousand particles in real time.'); });
await page.waitForTimeout(5000);
await page.screenshot({ path: 'test/shot-m3-speaking.png' });
const perf = await page.evaluate(() => window.__fableface.api.status().fps);
console.log('fps:', perf, 'errors:', JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
console.log('PASS');
