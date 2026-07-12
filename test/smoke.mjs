// smoke.mjs — pure-logic tests, run in node (no DOM, no GL):
//   docker run --rm -v "$PWD":/app:ro -w /app node:22-alpine node test/smoke.mjs

import { PresenceDriver, MOODS, STATES } from '../site/js/driver.js';
import { EMOTIONS, EMOTION_NAMES, GESTURES, GESTURE_NAMES, emotionVector, parseCues, autoCues, EMO_BASE } from '../site/js/emotions.js';
import { surfaceNets, sampleSurface, sampleSurfaceWeighted, extractFeatureEdges, mulberry32 } from '../site/js/gridmesh.js';
import { GRID, NEUTRAL } from '../site/js/headsdf.js';
import { Speech } from '../site/js/speech.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', msg); }
}
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, `${msg} (${a} vs ${b})`); }

// ---------- mulberry32 ----------
{
  const r1 = mulberry32(42), r2 = mulberry32(42);
  const a = [r1(), r1(), r1()], b = [r2(), r2(), r2()];
  ok(a.every((v, i) => v === b[i]), 'mulberry32 deterministic');
  ok(a.every(v => v >= 0 && v < 1), 'mulberry32 in [0,1)');
}

// ---------- driver ----------
{
  const rand = mulberry32(7);
  const d = new PresenceDriver(rand);
  let minBlink = 1, maxBlink = 0, maxJawIdle = 0;
  for (let i = 0; i < 60 * 30; i++) {
    const s = d.update(1 / 60);
    minBlink = Math.min(minBlink, s.blink);
    maxBlink = Math.max(maxBlink, s.blink);
    maxJawIdle = Math.max(maxJawIdle, s.jaw);
    ok(s.blink >= -0.01 && s.blink <= 1.01, 'blink in range');
    ok(Math.abs(s.gazeX) <= 0.45 && Math.abs(s.gazeY) <= 0.4, 'gaze bounded');
    ok(Math.abs(s.yaw) <= 0.3 && Math.abs(s.pitch) <= 0.3 && Math.abs(s.roll) <= 0.2, 'head pose bounded');
    ok(s.level >= 0 && s.level <= 1.01, 'level in range');
    if (failed > 5) break;
  }
  ok(maxBlink > 0.5, `idle blinking happens (max ${maxBlink.toFixed(2)})`);
  ok(minBlink < 0.1, 'eyes reopen after blink');
  ok(maxJawIdle < 0.15, `idle mouth stays shut-ish (max ${maxJawIdle.toFixed(2)})`);

  // speaking animates the jaw
  d.onSpeechStart();
  let maxJawTalk = 0, minJawTalk = 1, maxLevel = 0;
  for (let i = 0; i < 60 * 5; i++) {
    if (i % 20 === 0) d.onWord();
    const s = d.update(1 / 60);
    if (i > 30) { maxJawTalk = Math.max(maxJawTalk, s.jaw); minJawTalk = Math.min(minJawTalk, s.jaw); }
    maxLevel = Math.max(maxLevel, s.level);
  }
  ok(maxJawTalk > 0.45, `talking opens the jaw (max ${maxJawTalk.toFixed(2)})`);
  ok(minJawTalk < 0.25, `mouth closes between syllables (min ${minJawTalk.toFixed(2)})`);
  ok(maxLevel > 0.5, `speech level rises (max ${maxLevel.toFixed(2)})`);
  d.onSpeechEnd();
  let s;
  for (let i = 0; i < 120; i++) s = d.update(1 / 60);
  ok(s.jaw < 0.12, `jaw settles after speech (${s.jaw.toFixed(2)})`);

  // moods
  for (const m of Object.keys(MOODS)) { d.setMood(m); ok(d.mood === m, `mood ${m} settable`); }
  d.setMood('bogus');
  ok(d.mood !== 'bogus', 'bogus mood rejected');

  const warm = new PresenceDriver(mulberry32(9));
  warm.setMood('warm');
  const neutral = new PresenceDriver(mulberry32(9));
  let sw, sn;
  for (let i = 0; i < 240; i++) { sw = warm.update(1 / 60); sn = neutral.update(1 / 60); }
  ok(sw.spread > sn.spread + 0.1, `warm mood smiles more (${sw.spread.toFixed(2)} vs ${sn.spread.toFixed(2)})`);

  // pointer pulls gaze
  const p = new PresenceDriver(mulberry32(11));
  p.setPointer(1, 0);
  let sp;
  for (let i = 0; i < 60 * 6; i++) sp = p.update(1 / 60);
  ok(sp.gazeX > 0.1, `pointer pulls gaze (${sp.gazeX.toFixed(2)})`);
}

// ---------- surface nets on a synthetic sphere field ----------
{
  const { nx, ny, nz, min, max } = GRID;
  const R = 0.085;
  const cx = 0, cy = -0.002, cz = 0; // center it inside the grid bounds
  const dist = new Float32Array(nx * ny * nz);
  const mats = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    const pz = min[2] + z / (nz - 1) * (max[2] - min[2]);
    for (let y = 0; y < ny; y++) {
      const py = min[1] + y / (ny - 1) * (max[1] - min[1]);
      for (let x = 0; x < nx; x++) {
        const px = min[0] + x / (nx - 1) * (max[0] - min[0]);
        dist[x + nx * (y + ny * z)] = Math.hypot(px - cx, py - cy, pz - cz) - R;
      }
    }
  }
  const mesh = surfaceNets(dist, mats);
  const nVerts = mesh.positions.length / 3;
  ok(nVerts > 5000, `sphere mesh has verts (${nVerts})`);
  ok(mesh.indices.length >= nVerts * 3, `sphere mesh has faces (${mesh.indices.length / 3} tris)`);
  let maxRadErr = 0, badNrm = 0;
  for (let i = 0; i < nVerts; i++) {
    const px = mesh.positions[i * 3] - cx, py = mesh.positions[i * 3 + 1] - cy, pz = mesh.positions[i * 3 + 2] - cz;
    const r = Math.hypot(px, py, pz);
    maxRadErr = Math.max(maxRadErr, Math.abs(r - R));
    // normal should point radially out
    const dot = (px * mesh.normals[i * 3] + py * mesh.normals[i * 3 + 1] + pz * mesh.normals[i * 3 + 2]) / r;
    if (dot < 0.9) badNrm++;
  }
  ok(maxRadErr < 0.004, `verts on the sphere (max err ${(maxRadErr * 1000).toFixed(2)}mm)`);
  ok(badNrm === 0, `normals radial (${badNrm} bad)`);
  let badIdx = 0;
  for (const ix of mesh.indices) if (ix >= nVerts) badIdx++;
  ok(badIdx === 0, 'indices in range');

  const pts = sampleSurface(mesh, 5000, mulberry32(3));
  ok(pts.count === 5000, 'sample count');
  let maxPtErr = 0;
  for (let i = 0; i < pts.count; i++) {
    const r = Math.hypot(pts.positions[i * 3] - cx, pts.positions[i * 3 + 1] - cy, pts.positions[i * 3 + 2] - cz);
    maxPtErr = Math.max(maxPtErr, Math.abs(r - R));
  }
  ok(maxPtErr < 0.005, `sampled points on the surface (max err ${(maxPtErr * 1000).toFixed(2)}mm)`);
  // spread across octants -> uniform-ish sampling
  const oct = new Set();
  for (let i = 0; i < pts.count; i++) {
    oct.add((pts.positions[i * 3] > cx ? 1 : 0) + (pts.positions[i * 3 + 1] > cy ? 2 : 0) + (pts.positions[i * 3 + 2] > cz ? 4 : 0));
  }
  ok(oct.size === 8, `samples cover all octants (${oct.size})`);
}

// ---------- speech (mime path, no DOM) ----------
{
  const d = new PresenceDriver(mulberry32(5));
  const sp = new Speech(d);
  ok(sp.available === false, 'no TTS in node');
  let words = 0;
  const origWord = d.onWord.bind(d);
  d.onWord = () => { words++; origWord(); };
  sp.speak('hello brave new world');
  ok(sp.speaking === true, 'mime starts speaking');
  ok(d.speaking === true, 'driver notified of speech start');
  await new Promise(r => setTimeout(r, 3500));
  ok(words === 4, `word pulses fired (${words})`);
  ok(sp.speaking === false, 'mime ends');
  ok(d.speaking === false, 'driver notified of speech end');

  sp.speak('one two');
  sp.stop();
  ok(sp.speaking === false && d.speaking === false, 'stop() cancels');
}


// ---------- emotion engine ----------
{
  // table sanity: every emotion stays inside safe channel bounds
  for (const name of EMOTION_NAMES) {
    const v = emotionVector(name, 1);
    ok(Math.abs(v.spread) <= 1 && Math.abs(v.browL) <= 1 && Math.abs(v.browR) <= 1, `${name} mouth/brow bounded`);
    ok(v.lid >= -0.35 && v.lid <= 1, `${name} lid bounded`);
    ok(Math.abs(v.pitch) <= 0.12 && Math.abs(v.yaw) <= 0.12 && Math.abs(v.roll) <= 0.12, `${name} head bias small`);
    ok(v.pupil >= 0.5 && v.pupil <= 1.7, `${name} pupil sane`);
    ok(v.breathRate >= 0.3 && v.breathRate <= 3, `${name} breath sane`);
    ok(v.glow >= 0 && v.glow <= 1, `${name} glow 0..1`);
  }
  ok(EMOTION_NAMES.length >= 20, `rich emotion set (${EMOTION_NAMES.length})`);
  ok(GESTURE_NAMES.length >= 10, `rich gesture set (${GESTURE_NAMES.length})`);
  // intensity scales toward base
  const half = emotionVector('joy', 0.5), full = emotionVector('joy', 1);
  ok(Math.abs(half.spread - (EMO_BASE.spread + (full.spread - EMO_BASE.spread) * 0.5)) < 1e-9, 'intensity lerps channels');

  // setEmotion converges
  const d = new PresenceDriver(mulberry32(21));
  d.setAutopilot(false);
  ok(d.setEmotion('joy', 1), 'setEmotion accepts joy');
  ok(!d.setEmotion('nope'), 'setEmotion rejects unknown');
  let s1;
  for (let i = 0; i < 240; i++) s1 = d.update(1 / 60);
  ok(s1.spread > 0.4, `joy smiles (${s1.spread.toFixed(2)})`);
  ok(s1.emotion === 'joy', 'emotion reported');
  // pupil dilation channels through
  d.setEmotion('love', 1);
  for (let i = 0; i < 300; i++) s1 = d.update(1 / 60);
  ok(s1.pupil > 1.3, `love dilates pupils (${s1.pupil.toFixed(2)})`);
  d.setEmotion('angry', 1);
  for (let i = 0; i < 300; i++) s1 = d.update(1 / 60);
  ok(s1.pupil < 0.95, `anger constricts pupils (${s1.pupil.toFixed(2)})`);
  ok(s1.browL < -0.3, `anger furrows brows (${s1.browL.toFixed(2)})`);
  ok(s1.glow > 0.35, `anger glows (${s1.glow.toFixed(2)})`);

  // surprise widens the eyes (negative blink) then decays back
  const d2 = new PresenceDriver(mulberry32(22));
  d2.setAutopilot(false);
  d2.setEmotion('surprise', 1);
  let minB = 1;
  for (let i = 0; i < 180; i++) { const st = d2.update(1 / 60); minB = Math.min(minB, st.blink); }
  ok(minB < -0.1, `surprise widens eyes (min blink ${minB.toFixed(2)})`);
  d2.setEmotion('neutral', 1);
  let sN;
  for (let i = 0; i < 300; i++) sN = d2.update(1 / 60);
  ok(sN.blink > -0.06, `widen returns to neutral (${sN.blink.toFixed(2)})`);

  // transient reaction decays on its own
  const d3 = new PresenceDriver(mulberry32(23));
  d3.setAutopilot(false);
  d3.react('surprise', 0.9, 2.5);
  let widest = 1;
  for (let i = 0; i < 90; i++) { const st = d3.update(1 / 60); widest = Math.min(widest, st.blink); }
  ok(widest < 0, `reaction shows (${widest.toFixed(2)})`);
  for (let i = 0; i < 360; i++) sN = d3.update(1 / 60);
  ok(Math.abs(sN.spread - 0.08) < 0.2 && d3._reactions.length === 0, 'reaction decayed away');
}

// ---------- gestures ----------
{
  const d = new PresenceDriver(mulberry32(31));
  d.setAutopilot(false);
  ok(d.emote('nod'), 'nod accepted');
  ok(!d.emote('macarena'), 'unknown gesture rejected');
  let minPitch = 1;
  for (let i = 0; i < 60; i++) { const st = d.update(1 / 60); minPitch = Math.min(minPitch, st.pitch); }
  ok(minPitch < -0.02, `nod dips the head (${minPitch.toFixed(3)})`);
  // laugh animates jaw + level without speech
  d.emote('laugh');
  let maxJaw = 0, maxLvl = 0;
  for (let i = 0; i < 110; i++) { const st = d.update(1 / 60); maxJaw = Math.max(maxJaw, st.jaw); maxLvl = Math.max(maxLvl, st.level); }
  ok(maxJaw > 0.2, `laugh moves the jaw (${maxJaw.toFixed(2)})`);
  ok(maxLvl > 0.15, `laugh lights the voice glow (${maxLvl.toFixed(2)})`);
  // gestures end
  for (let i = 0; i < 240; i++) d.update(1 / 60);
  ok(d._gestures.length === 0, 'gestures finish');
}

// ---------- companion states ----------
{
  const d = new PresenceDriver(mulberry32(41));
  d.setAutopilot(false);
  ok(d.setState('thinking'), 'thinking settable');
  ok(!d.setState('discombobulated'), 'unknown state rejected');
  let maxLvl = 0, gazeYSum = 0, n = 0;
  for (let i = 0; i < 60 * 6; i++) { const st = d.update(1 / 60); maxLvl = Math.max(maxLvl, st.level); if (i > 120) { gazeYSum += st.gazeY; n++; } }
  ok(maxLvl > 0.08, `thinking pulses the glow/level (${maxLvl.toFixed(2)})`);
  ok(gazeYSum / n > 0.03, `thinking looks up (${(gazeYSum / n).toFixed(3)})`);

  d.setState('sleeping');
  let sSt;
  for (let i = 0; i < 60 * 4; i++) sSt = d.update(1 / 60);
  ok(sSt.blink > 0.6, `sleeping closes lids (${sSt.blink.toFixed(2)})`);
  ok(sSt.state === 'sleeping', 'state reported');
  d.wake();
  for (let i = 0; i < 60 * 3; i++) sSt = d.update(1 / 60);
  ok(sSt.blink < 0.45, `wake reopens eyes (${sSt.blink.toFixed(2)})`);
  ok(d.state === 'idle', 'wake returns to idle');

  // listening: sustained user speech burst then silence -> acknowledgement nod
  const dl = new PresenceDriver(mulberry32(43));
  dl.setAutopilot(false);
  dl.setState('listening');
  for (let i = 0; i < 60 * 2; i++) { dl.listenLevel(0.8); dl.update(1 / 60); }
  for (let i = 0; i < 30; i++) { dl.listenLevel(0); dl.update(1 / 60); }
  ok(dl._mhmCd > 0, 'listening acknowledges a finished user utterance (mhm nod)');

  // poke: startle reaction
  const dp = new PresenceDriver(mulberry32(44));
  dp.setAutopilot(false);
  dp.poke();
  let pMin = 1;
  for (let i = 0; i < 60; i++) { const st = dp.update(1 / 60); pMin = Math.min(pMin, st.blink); }
  ok(pMin < -0.05, `poke startles (${pMin.toFixed(2)})`);
}

// ---------- autopilot idle arc ----------
{
  const d = new PresenceDriver(mulberry32(51));
  for (let i = 0; i < 60 * 140; i++) d.update(1 / 60); // 140 idle seconds
  ok(d.state === 'sleeping', `autopilot fell asleep (${d.state})`);
  d.poke();
  ok(d.state === 'idle', 'poke wakes the sleeper');
  const d2 = new PresenceDriver(mulberry32(52));
  d2.setAutopilot(false);
  for (let i = 0; i < 60 * 150; i++) d2.update(1 / 60);
  ok(d2.state === 'idle', 'autopilot off: stays awake');
}

// ---------- speech cue parsing ----------
{
  const p1 = parseCues('[joy] hello [nod] world');
  ok(p1.text === 'hello world', `tags stripped ("${p1.text}")`);
  ok(p1.cues.length === 2, `two cues (${p1.cues.length})`);
  ok(p1.cues[0].kind === 'emotion' && p1.cues[0].name === 'joy' && p1.cues[0].atWord === 0, 'emotion cue at word 0');
  ok(p1.cues[1].kind === 'gesture' && p1.cues[1].name === 'nod' && p1.cues[1].atWord === 1, 'gesture cue at word 1');
  const p2 = parseCues('[sad:0.6] oh dear');
  ok(Math.abs(p2.cues[0].intensity - 0.6) < 1e-9, 'intensity parsed');
  const p3 = parseCues('[bogus] plain text');
  ok(p3.text === 'plain text' && p3.cues.length === 0, 'unknown tag stripped, no cue');
  const p4 = parseCues('no tags at all');
  ok(p4.text === 'no tags at all' && p4.cues.length === 0, 'plain text untouched');

  const rand = mulberry32(5);
  const a1 = autoCues('Is that really true?', [], rand);
  ok(a1.some(c => c.name === 'curious'), 'question mark -> curious');
  const a2 = autoCues('haha that is funny', [], rand);
  ok(a2.some(c => c.name === 'laugh'), 'haha -> laugh gesture');
  const a3 = autoCues('I am sorry about the delay', [], rand);
  ok(a3.some(c => c.name === 'concerned'), 'sorry -> concerned');
}


// ---------- weighted sampling + feature edges (WISP II) ----------
{
  // reuse the synthetic sphere mesh machinery
  const { nx, ny, nz, min, max } = GRID;
  const R = 0.085;
  const dist = new Float32Array(nx * ny * nz);
  const mats = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    const pz = min[2] + z / (nz - 1) * (max[2] - min[2]);
    for (let y = 0; y < ny; y++) {
      const py = min[1] + y / (ny - 1) * (max[1] - min[1]);
      for (let x = 0; x < nx; x++) {
        const px = min[0] + x / (nx - 1) * (max[0] - min[0]);
        const i = x + nx * (y + ny * z);
        dist[i] = Math.hypot(px, py + 0.002, pz) - R;
        mats[i] = pz > 0 ? 2 : 0; // front hemisphere "lips", back "skin"
      }
    }
  }
  const mesh = surfaceNets(dist, mats);

  // weighted sampling concentrates the budget where the weight is
  const w = sampleSurfaceWeighted(mesh, 6000, (x, y, z) => (z > 0 ? 8 : 1), mulberry32(3));
  let front = 0;
  for (let i = 0; i < w.count; i++) if (w.positions[i * 3 + 2] > 0) front++;
  ok(front / w.count > 0.75, `weighted sampling concentrates front (${(front / w.count * 100).toFixed(0)}%)`);
  ok(w.count === 6000 && w.normals.length === 18000, 'weighted sample arrays sized');

  // a smooth sphere has (almost) no curvature feature edges…
  const smoothEdges = extractFeatureEdges({ ...mesh, mats: new Float32Array(mesh.mats.length) }, { angleDeg: 13, minZ: -1 });
  // …but the material boundary at the equator IS a feature line
  const matEdges = extractFeatureEdges(mesh, { angleDeg: 13, minZ: -1 });
  ok(matEdges.count > smoothEdges.count + 50, `material boundary detected (${matEdges.count} vs ${smoothEdges.count} pts)`);
  ok(matEdges.count < 17000, 'feature-edge cap respected');
  // boundary points sit near z=0 (the equator)
  let nearEq = 0, checked = 0;
  for (let i = 0; i < matEdges.count; i++) {
    if (matEdges.mats[i] === 2) { checked++; if (Math.abs(matEdges.positions[i * 3 + 2]) < 0.01) nearEq++; }
  }
  ok(checked === 0 || nearEq / checked > 0.5, `boundary points hug the equator (${nearEq}/${checked})`);

  // driver reactW output exists for the glitch hook
  const d = new PresenceDriver(mulberry32(61));
  d.setAutopilot(false);
  d.react('surprise', 0.9, 1);
  const st = d.update(1 / 60);
  ok(st.reactW > 0.5, `reactW exposes live reactions (${st.reactW.toFixed(2)})`);
}


// ---------- speech: autoplay-block retry (the sound-on-load fix) ----------
{
  // fake a TTS engine that refuses before a "gesture" (Chrome autoplay policy)
  let allowAudio = false;
  const utters = [];
  global.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  global.speechSynthesis = {
    getVoices: () => [{ lang: 'en-US', name: 'TestVoice' }],
    addEventListener: () => {},
    cancel: () => {},
    resume: () => {},
    speak: (u) => {
      utters.push(u.text);
      setTimeout(() => {
        if (allowAudio) { u.onstart?.(); setTimeout(() => u.onend?.(), 50); }
        else u.onerror?.({ error: 'not-allowed' });
      }, 5);
    },
  };
  const d = new PresenceDriver(mulberry32(71));
  d.setAutopilot(false);
  const sp = new Speech(d);
  ok(sp.available, 'fake voices detected');
  sp.speak('[joy] hello there friend');
  await new Promise(r => setTimeout(r, 120));
  ok(sp.blockedText !== null, 'blocked utterance remembered');
  ok(sp.blockedText.includes('[joy]'), 'raw tagged text kept for retry');
  ok(sp.mode === 'mime' && d.speaking, 'mimed visually while muted');
  // "user gesture" arrives:
  allowAudio = true;
  ok(sp.retryBlocked(), 'retryBlocked re-speaks');
  await new Promise(r => setTimeout(r, 120));
  ok(sp.blockedText === null, 'blocked slot cleared after successful voice');
  ok(utters.length >= 2, 'utterance re-submitted to the engine');
  ok(!sp.retryBlocked(), 'nothing pending -> retry is a no-op');
  delete global.speechSynthesis;
  delete global.SpeechSynthesisUtterance;
}


// ---------- WISP VI driver upgrades: visemes, Duchenne, flow params ----------
{
  // visemes: while speaking, the mouth ROUNDS (negative spread) and WIDENS
  const d = new PresenceDriver(mulberry32(81));
  d.setAutopilot(false);
  d.onSpeechStart();
  let sMin = 1, sMax = -1;
  for (let i = 0; i < 60 * 8; i++) {
    if (i % 18 === 0) d.onWord();
    const st = d.update(1 / 60);
    if (i > 60) { sMin = Math.min(sMin, st.spread); sMax = Math.max(sMax, st.spread); }
  }
  ok(sMin < -0.08, `visemes round the mouth (min spread ${sMin.toFixed(2)})`);
  ok(sMax > 0.2, `visemes widen the mouth (max spread ${sMax.toFixed(2)})`);
  d.onSpeechEnd();

  // Duchenne: joyful smiles narrow the lids (vs neutral), outside blink events
  const dj = new PresenceDriver(mulberry32(82));
  dj.setAutopilot(false);
  dj.setEmotion('joy', 1);
  const dn = new PresenceDriver(mulberry32(82));
  dn.setAutopilot(false);
  let joySum = 0, joyN = 0, neuSum = 0, neuN = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const sj = dj.update(1 / 60), sn = dn.update(1 / 60);
    if (i > 120 && dj.blinkPhase < 0) { joySum += sj.blink; joyN++; }
    if (i > 120 && dn.blinkPhase < 0) { neuSum += sn.blink; neuN++; }
  }
  ok(joySum / joyN > neuSum / neuN + 0.02, `Duchenne narrows smiling eyes (${(joySum / joyN).toFixed(3)} vs ${(neuSum / neuN).toFixed(3)})`);

  // feature edges now export a flow param per point
  const { nx, ny, nz, min, max } = GRID;
  const dist2 = new Float32Array(nx * ny * nz);
  const mats2 = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const px = min[0] + x / (nx - 1) * (max[0] - min[0]);
    const py = min[1] + y / (ny - 1) * (max[1] - min[1]);
    const pz = min[2] + z / (nz - 1) * (max[2] - min[2]);
    const i = x + nx * (y + ny * z);
    dist2[i] = Math.hypot(px, py + 0.002, pz) - 0.085;
    mats2[i] = pz > 0 ? 2 : 0;
  }
  const mesh2 = surfaceNets(dist2, mats2);
  const fe = extractFeatureEdges(mesh2, { angleDeg: 13, minZ: -1 });
  ok(fe.params && fe.params.length === fe.count, `flow params exported (${fe.params.length})`);
}

// ---------- living-motion math: Kuramoto / OU / 1-f breath ----------
{
  const { EMO_BASE } = await import('../site/js/emotions.js');
  ok(typeof EMO_BASE.coh === 'number', 'coh channel exists in EMO_BASE');

  // Kuramoto: high-coherence emotion locks the bank (r -> ~1), confusion stays desynced
  const dHi = new PresenceDriver(mulberry32(21));
  dHi.setEmotion('determined', 1);
  let sHi;
  for (let i = 0; i < 60 * 25; i++) sHi = dHi.update(1 / 60);
  ok(sHi.cohR > 0.7, `Kuramoto syncs when determined (r=${sHi.cohR.toFixed(3)})`);

  const dLo = new PresenceDriver(mulberry32(21));
  dLo.setEmotion('confused', 1);
  let rSum = 0, rN = 0;
  for (let i = 0; i < 60 * 25; i++) {
    const st = dLo.update(1 / 60);
    if (i > 60 * 10) { rSum += st.cohR; rN++; }
  }
  ok(rSum / rN < 0.55, `Kuramoto stays desynced when confused (avg r=${(rSum / rN).toFixed(3)})`);
  ok(typeof sHi.cohPsi === 'number' && isFinite(sHi.cohPsi), 'cohPsi finite');

  // OU gaze: bounded, alive (nonzero variance), no NaN
  const dOu = new PresenceDriver(mulberry32(33));
  const gx = [];
  for (let i = 0; i < 60 * 12; i++) { const st = dOu.update(1 / 60); gx.push(st.gazeX); }
  ok(gx.every(v => isFinite(v) && Math.abs(v) < 0.8), 'OU gaze bounded and finite');
  const mean = gx.reduce((a, b) => a + b, 0) / gx.length;
  const varc = gx.reduce((a, b) => a + (b - mean) * (b - mean), 0) / gx.length;
  ok(varc > 1e-7, `OU gaze has live variance (${varc.toExponential(2)})`);

  // 1/f breath stays in [0,1]; pinkG bounded
  const dBr = new PresenceDriver(mulberry32(44));
  dBr.setEmotion('fear', 1); // fastest breath
  let bMin = 1, bMax = 0, pMax = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const st = dBr.update(1 / 60);
    bMin = Math.min(bMin, st.breath); bMax = Math.max(bMax, st.breath);
    pMax = Math.max(pMax, Math.abs(st.pinkG));
  }
  ok(bMin >= 0 && bMax <= 1, `breath in [0,1] (${bMin.toFixed(3)}..${bMax.toFixed(3)})`);
  ok(pMax <= 1.01 && pMax > 0.05, `pinkG bounded and alive (${pMax.toFixed(3)})`);
}

// ---------- SH emotion silhouette ----------
{
  const dJ = new PresenceDriver(mulberry32(55));
  dJ.setEmotion('delight', 1);
  let sJ; for (let i = 0; i < 60 * 6; i++) sJ = dJ.update(1 / 60);
  ok(Array.isArray(sJ.sh) && sJ.sh.length === 5, 'sh coeffs exported');
  ok(sJ.sh.every(v => Math.abs(v) <= 0.0062), `sh capped (~5% head radius) (${sJ.sh.map(v => v.toFixed(4)).join(',')})`);
  ok(sJ.sh[1] > 0.0015, `delight lifts Y1y (${sJ.sh[1].toFixed(4)})`);
  const dS = new PresenceDriver(mulberry32(55));
  dS.setEmotion('sad', 1);
  let sS; for (let i = 0; i < 60 * 6; i++) sS = dS.update(1 / 60);
  ok(sS.sh[1] < -0.001, `sadness droops Y1y (${sS.sh[1].toFixed(4)})`);
}

// ---------- NEUTRAL sanity ----------
ok(NEUTRAL.jaw > 0.05 && NEUTRAL.jaw < 0.5, 'neutral jaw slightly open for mesh topology');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
