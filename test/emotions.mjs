import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8799';
let failed = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await page.goto(BASE + '/?autopilot=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.FableFace && window.__fableface, null, { timeout: 60000 });
ok(true, 'booted, FableFace API present');

// API surface
const list = await page.evaluate(() => window.FableFace.list());
ok(list.emotions.length >= 20, `API lists ${list.emotions.length} emotions`);
ok(list.gestures.length >= 10, `API lists ${list.gestures.length} gestures`);

// postMessage transport round-trip
const pm = await page.evaluate(() => new Promise(res => {
  const id = 'test1';
  window.addEventListener('message', e => { if (e.data && e.data.ff && e.data.id === id && ('result' in e.data)) res(e.data); });
  window.postMessage({ ff: true, cmd: 'setEmotion', args: ['joy', 1], id }, '*');
}));
ok(pm.result === true && !pm.error, 'postMessage transport works');

// emotion screenshots on EVE (SDF raymarch = most expressive)
await page.evaluate(() => window.FableFace.setFace('eve'));
await page.waitForTimeout(2500);
for (const emo of ['joy', 'angry', 'sad', 'surprise', 'sleepy', 'mischievous']) {
  await page.evaluate(e => window.FableFace.setEmotion(e, 1), emo);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `test/shot-emo-${emo}.png` });
  const st = await page.evaluate(() => window.__fableface.driver.s);
  console.log(`  ${emo}: spread=${st.spread.toFixed(2)} browL=${st.browL.toFixed(2)} blink=${st.blink.toFixed(2)} pupil=${st.pupil.toFixed(2)} glow=${st.glow.toFixed(2)}`);
}
ok(true, 'emotion screenshots taken');

// states
await page.evaluate(() => window.FableFace.setEmotion('neutral', 1));
await page.evaluate(() => window.FableFace.setState('thinking'));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test/shot-state-thinking.png' });
const lvl = await page.evaluate(() => window.__fableface.driver.s.level);
ok(lvl > 0.03, `thinking glow pulse live (level ${lvl.toFixed(2)})`);
await page.evaluate(() => window.FableFace.setState('sleeping'));
await page.waitForTimeout(3000);
await page.screenshot({ path: 'test/shot-state-sleeping.png' });
const blink = await page.evaluate(() => window.__fableface.driver.s.blink);
ok(blink > 0.6, `sleeping lids closed (${blink.toFixed(2)})`);
await page.evaluate(() => window.FableFace.wake());

// tagged speech (mime mode headless) drives emotions word-synced
await page.evaluate(() => window.FableFace.say('[joy] Wonderful! [thinking] Hmm let me think [nod] yes.'));
await page.waitForTimeout(900);
const emoDuring = await page.evaluate(() => window.__fableface.driver.emotion);
ok(emoDuring === 'joy', `tag fired at speech start (${emoDuring})`);
await page.waitForTimeout(2600);
const emoLater = await page.evaluate(() => window.__fableface.driver.emotion);
ok(emoLater === 'thinking', `mid-speech tag switched emotion (${emoLater})`);

// gesture via API + embed mode check on a second page
await page.evaluate(() => window.FableFace.emote('laugh'));
await page.waitForTimeout(600);
await page.screenshot({ path: 'test/shot-gesture-laugh.png' });

const p2 = await browser.newPage({ viewport: { width: 700, height: 700 } });
await p2.goto(BASE + '/?embed=1&face=wisp&emotion=warm&autopilot=0', { waitUntil: 'load' });
await p2.waitForFunction(() => window.FableFace, null, { timeout: 60000 });
await p2.waitForTimeout(2500);
const chrome = await p2.evaluate(() => ({
  console: getComputedStyle(document.getElementById('console')).display,
  panel: getComputedStyle(document.getElementById('panel')).display,
  emo: window.__fableface.driver.emotion,
}));
ok(chrome.console === 'none' && chrome.panel === 'none', 'embed mode hides chrome');
ok(chrome.emo === 'warm', 'URL params set face+emotion');
await p2.screenshot({ path: 'test/shot-embed.png' });

ok(errors.length === 0, 'no JS errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nemotion E2E green');
process.exit(failed ? 1 : 0);
