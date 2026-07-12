// shots.mjs — screenshot each face idle + talking, dump console errors.
// Recipe (no node on host):
//   cp test/shots.mjs /tmp/ffshots/ && cd /tmp/ffshots && npm i playwright@1.49.0
//   docker run --rm --network=host -v /tmp/ffshots:/work -v /root/fableface/shots:/shots \
//     -w /work mcr.microsoft.com/playwright:v1.49.0-noble node shots.mjs
import { chromium } from 'playwright';

const URL = process.env.FF_URL || 'http://127.0.0.1:8799';
const OUT = process.env.FF_OUT || '/shots';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__fableface, null, { timeout: 60000 });
console.log('boot ok; assets:', await page.evaluate(() =>
  document.querySelector('#panel-stats')?.textContent));

for (const face of ['wisp7', 'wisp6', 'wisp5', 'wisp4', 'wisp3', 'wisp2', 'wisp']) {
  await page.evaluate(f => { window.__fableface.speech.stop(); window.__fableface.select(f); }, face);
  await page.waitForTimeout(2600); // reveal + settle
  await page.screenshot({ path: `${OUT}/${face}-idle.png` });
  // deterministic open-mouth pose (mid-vowel) instead of racing the oscillator
  await page.evaluate(() => {
    window.__fableface.driver.override = { jaw: 0.7, spread: 0.15, level: 0.8 };
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${face}-talk.png` });
  await page.evaluate(() => { window.__fableface.driver.override = null; });
  console.log(face, 'shot; fps=', await page.evaluate(() => window.__fableface.fps));
}

// a close-up of the flagship for detail checking — deterministic eye contact
await page.evaluate(() => {
  window.__fableface.select('eve');
  window.__fableface.driver.override = { gazeX: 0, gazeY: 0, blink: 0.05, yaw: 0, pitch: 0, roll: 0 };
});
await page.setViewportSize({ width: 900, height: 1100 });
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/eve-portrait.png` });

console.log('CONSOLE_ERRORS=' + JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length ? 2 : 0);
