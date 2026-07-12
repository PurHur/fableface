// E2E: simulated operator panel — runs the scripted conversation and asserts
// transcript bubbles + live event chips render while the face performs.
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8799/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__fableface && window.__fableface.sim, { timeout: 20000 });
await page.evaluate(() => window.__fableface.sim.run());

// mid-simulation snapshot (during the emotion-tour reply)
await page.waitForFunction(() => document.querySelectorAll('#sim-feed .sim-msg.ai').length >= 3, { timeout: 90000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test/shot-sim-mid.png' });

// let it get to the scene change
await page.waitForFunction(() =>
  [...document.querySelectorAll('#sim-feed .sim-chip.scenechange')].some(c => c.textContent.includes('aurora')),
  { timeout: 90000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'test/shot-sim-aurora.png' });

const stats = await page.evaluate(() => ({
  op: document.querySelectorAll('#sim-feed .sim-msg.op').length,
  ai: document.querySelectorAll('#sim-feed .sim-msg.ai:not(.sim-think)').length,
  emoChips: document.querySelectorAll('#sim-feed .sim-chip.emotionchange').length,
  stateMarks: document.querySelectorAll('#sim-feed .sim-state').length,
  gestureChips: document.querySelectorAll('#sim-feed .sim-chip.gesture').length,
  sceneChips: document.querySelectorAll('#sim-feed .sim-chip.scenechange').length,
  wordsOn: document.querySelectorAll('#sim-feed .sim-w.on').length,
  wordsPending: document.querySelectorAll('#sim-feed .sim-w:not(.on)').length,
  btnLabel: document.getElementById('sim-btn').textContent,
  running: window.__fableface.sim.running,
}));
console.log('stats:', JSON.stringify(stats));
console.log('errors:', JSON.stringify(errors));

const finished = !stats.running && stats.btnLabel.includes('REPLAY');
const ok = stats.op >= 4 && stats.ai >= 4 && stats.emoChips >= 8 && stats.stateMarks >= 6 &&
  stats.gestureChips >= 2 && stats.sceneChips >= 1 && stats.wordsOn >= 30 &&
  (stats.running || finished) && (!finished || stats.wordsPending === 0) && errors.length === 0;
await browser.close();
if (!ok) { console.error('E2E SIM FAILED'); process.exit(1); }
console.log('E2E SIM PASS');
