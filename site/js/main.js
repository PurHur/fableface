// main.js — boot, per-frame common state, UI wiring.

import { createGL, mat4Perspective, mat4LookAt, mat4Multiply, mat4RotateX, mat4RotateY, mat4RotateZ } from './gl.js';
import { buildHeadAssets } from './gridmesh.js';
import { PresenceDriver, MOODS, STATES } from './driver.js';
import { EMOTION_NAMES, GESTURE_NAMES } from './emotions.js';
import { SCENES } from './scenes.js';
import { Speech } from './speech.js';
import { makeSimulation } from './simulation.js';
import { WispFace } from './face-dots.js';
import { Wisp2Face } from './face-wisp2.js';
import { Wisp3Face } from './face-wisp3.js';
import { Wisp4Face } from './face-wisp4.js';
import { Wisp5Face } from './face-wisp5.js';
import { Wisp6Face } from './face-wisp6.js';
import { Wisp7Face } from './face-wisp7.js';
// (EVE/RONIN/SONNY/ORACLE/VESSEL classes remain in the repo but are hidden
// from the exhibit — the companion is the WISP lineage now.)

const $ = sel => document.querySelector(sel);

const PRESETS = [
  'Hello. I am a synthetic presence, rendered live on your GPU.',
  '[joy] Wonderful news! [thinking] Although… hmm. [nod] Yes. [delight] It works!',
  'I have no body, but I can still look you in the eye.',
  'Every blink, every syllable you see is procedural. Nothing is recorded.',
  '[concerned] I am sorry about that. [warm] Let me make it right.',
];

function mat3FromMat4(m) {
  return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
}
function mat3Transpose(m) {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

async function boot() {
  const qs = new URLSearchParams(location.search);
  const canvas = $('#stage');
  const gl = createGL(canvas);
  const loading = $('#loading');
  if (!gl) {
    loading.textContent = 'WebGL2 unavailable — this exhibit needs a GPU-capable browser.';
    return;
  }

  loading.textContent = 'EVALUATING DISTANCE FIELD…';
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

  let assets;
  try {
    assets = buildHeadAssets(gl, 90000);
  } catch (err) {
    loading.textContent = 'Head build failed: ' + err.message;
    throw err;
  }

  loading.textContent = 'COMPILING RENDERERS…';
  await new Promise(r => setTimeout(r, 20));

  const faces = {
    wisp7: new Wisp7Face(gl, assets),
    wisp6: new Wisp6Face(gl, assets),
    wisp5: new Wisp5Face(gl, assets),
    wisp4: new Wisp4Face(gl, assets),
    wisp3: new Wisp3Face(gl, assets),
    wisp2: new Wisp2Face(gl, assets),
    wisp: new WispFace(gl, assets),
  };
  const order = ['wisp7', 'wisp6', 'wisp5', 'wisp4', 'wisp3', 'wisp2', 'wisp'];

  const driver = new PresenceDriver();
  const speech = new Speech(driver);

  // ---- event contract (production SDK surface) ----
  // events: ready, speechstart, word, speechend, statechange, emotionchange, scenechange
  const listeners = {};
  let wsLive = null; // hoisted so emit() can push to a connected backend
  function emit(event, data = {}) {
    const payload = { event, ...data, t: Date.now() };
    (listeners[event] || []).forEach(cb => { try { cb(payload); } catch (e) { } });
    (listeners['*'] || []).forEach(cb => { try { cb(payload); } catch (e) { } });
    if (window.parent !== window) { try { window.parent.postMessage({ ff: true, ...payload }, '*'); } catch (e) { } }
    if (wsLive && wsLive.readyState === 1) { try { wsLive.send(JSON.stringify({ ff: true, ...payload })); } catch (e) { } }
  }
  {
    const _oss = driver.onSpeechStart.bind(driver);
    driver.onSpeechStart = () => { _oss(); emit('speechstart'); };
    const _ow = driver.onWord.bind(driver);
    driver.onWord = () => { _ow(); emit('word'); };
    const _ose = driver.onSpeechEnd.bind(driver);
    driver.onSpeechEnd = () => { _ose(); emit('speechend'); };
    const _st = driver.setState.bind(driver);
    let thinkWatch = null;
    driver.setState = (st) => {
      const prev = driver.state;
      const ok = _st(st);
      if (ok) {
        emit('statechange', { state: st });
        clearTimeout(thinkWatch);
        if (st === 'thinking') {
          if (prev === 'listening') driver.emote('nod'); // instant acknowledgment (<200ms beats any spinner)
          thinkWatch = setTimeout(() => { // watchdog: a dead backend must not freeze the face
            if (driver.state === 'thinking' && !speech.speaking) driver.setState('idle');
          }, 30000);
        }
      }
      return ok;
    };
    const _se = driver.setEmotion.bind(driver);
    driver.setEmotion = (n, i, o) => { const ok = _se(n, i, o); if (ok) emit('emotionchange', { emotion: n, intensity: i ?? 1 }); return ok; };
    const _em = driver.emote.bind(driver);
    driver.emote = (n) => { const ok = _em(n); if (ok) emit('gesture', { gesture: n }); return ok; };
  }

  // ---- sayStream(): feed LLM tokens as they arrive; speaks sentence-by-sentence ----
  const streamQ = [];
  let streamBuf = '';
  let streamOpen = false;
  let streamGen = 0;          // bumped on interrupt: stale chunks are dropped
  let streamFirst = true;     // first chunk flushes AGGRESSIVELY (latency)
  let streamStall = null;
  let uttSeq = 0;
  function streamPump() {
    if (speech.speaking || !streamQ.length) return;
    const next = streamQ.shift();
    if (next.gen !== streamGen) return streamPump(); // stale after interrupt
    speech.speak(next.text);
  }
  function streamFlush(text) {
    streamQ.push({ text: text.trim(), gen: streamGen, id: 'u' + (++uttSeq) });
    emit('speechqueued', { queueDepth: streamQ.length });
    streamFirst = false;
    streamPump();
  }
  function sayStream(chunk, opts = {}) {
    if (typeof chunk === 'string' && chunk) { streamBuf += chunk; streamOpen = true; }
    clearTimeout(streamStall);
    let m;
    while ((m = streamBuf.match(/^([\s\S]*?[.!?…]+["')\]]?)(\s|$)/))) {
      streamFlush(m[1]);
      streamBuf = streamBuf.slice(m[0].length);
    }
    // FIRST chunk: don't wait for a full stop — flush at a clause break past
    // ~120 chars, or after a 500ms stall with a few words buffered.
    if (streamFirst && streamBuf.length > 120) {
      const cm = streamBuf.lastIndexOf(',', 160);
      if (cm > 30) { streamFlush(streamBuf.slice(0, cm + 1)); streamBuf = streamBuf.slice(cm + 1); }
    }
    if (streamFirst && streamOpen && streamBuf.split(/\s+/).length >= 3) {
      streamStall = setTimeout(() => {
        if (streamFirst && streamBuf.trim()) { streamFlush(streamBuf); streamBuf = ''; }
      }, 500);
    }
    if (opts.done) {
      clearTimeout(streamStall);
      if (streamBuf.trim()) streamFlush(streamBuf);
      streamBuf = '';
      streamOpen = false;
      streamFirst = true;
    }
    if (!speech.speaking && !streamQ.length && streamOpen) driver.setState('thinking'); // latency mask
    streamPump();
    return streamQ.length;
  }

  let active = 'wisp7';
  let sceneIx = 0;
  let revealStart = performance.now();

  // ---- UI ----
  const tabs = $('#tabs');
  order.forEach((key, i) => {
    const F = faces[key].constructor;
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.face = key;
    b.innerHTML = `<span class="tab-num">0${i + 1}</span><span class="tab-name">${F.title}</span><span class="tab-tech">${F.tech}</span>`;
    b.addEventListener('click', () => select(key));
    tabs.appendChild(b);
  });

  const chips = $('#presets');
  PRESETS.forEach((p, i) => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = ['greeting', 'the pitch', 'eye contact', 'procedural', 'renderer'][i];
    c.title = p;
    c.addEventListener('click', () => { $('#say').value = p; speak(); });
    chips.appendChild(c);
  });

  // ---- companion console: emotions / gestures / states ----
  const emoSel = $('#emotions');
  EMOTION_NAMES.forEach(m => {
    const c = document.createElement('button');
    c.className = 'chip emo' + (m === 'neutral' ? ' on' : '');
    c.dataset.emo = m;
    c.textContent = m;
    c.addEventListener('click', () => {
      driver.setEmotion(m, 1);
      syncChips();
    });
    emoSel.appendChild(c);
  });
  const gestSel = $('#gestures');
  GESTURE_NAMES.forEach(g => {
    const c = document.createElement('button');
    c.className = 'chip gest';
    c.textContent = g;
    c.addEventListener('click', () => driver.emote(g));
    gestSel.appendChild(c);
  });
  const stateSel = $('#states');
  STATES.filter(st => st !== 'speaking').forEach(st => {
    const c = document.createElement('button');
    c.className = 'chip state' + (st === 'idle' ? ' on' : '');
    c.dataset.state = st;
    c.textContent = st;
    c.addEventListener('click', () => {
      driver.setState(st);
      syncChips();
    });
    stateSel.appendChild(c);
  });
  const sceneSel = $('#scenes');
  SCENES.forEach((sc, i) => {
    const c = document.createElement('button');
    c.className = 'chip scene' + (i === 0 ? ' on' : '');
    c.dataset.scene = String(i);
    c.textContent = sc.name;
    c.addEventListener('click', () => { setScene(i); });
    sceneSel.appendChild(c);
  });
  function setScene(i) {
    if (typeof i === 'string') {
      const found = SCENES.findIndex(sc => sc.key === i.toLowerCase());
      i = found >= 0 ? found : parseInt(i, 10) || 0;
    }
    sceneIx = Math.max(0, Math.min(SCENES.length - 1, i | 0));
    sceneSel.querySelectorAll('.scene').forEach(x => x.classList.toggle('on', +x.dataset.scene === sceneIx));
    if (typeof emit === 'function') emit('scenechange', { scene: SCENES[sceneIx].key });
    return SCENES[sceneIx].key;
  }
  function syncChips() {
    emoSel.querySelectorAll('.emo').forEach(x => x.classList.toggle('on', x.dataset.emo === driver.emotion));
    stateSel.querySelectorAll('.state').forEach(x => x.classList.toggle('on', x.dataset.state === driver.state));
  }

  function updateVoiceLabel() {
    $('#voice-mode').textContent = speech.blockedText
      ? 'VOICE: 🔇 CLICK TO UNMUTE'
      : (speech.available ? 'VOICE: TTS' : 'VOICE: MIME');
  }
  function speak() {
    const text = $('#say').value.trim() || PRESETS[0];
    speech.speak(text);
    updateVoiceLabel();
  }
  $('#speak').addEventListener('click', speak);
  $('#say').addEventListener('keydown', e => { if (e.key === 'Enter') speak(); });

  function select(key) {
    if (!faces[key] || key === active) return;
    active = key;
    revealStart = performance.now();
    document.body.dataset.face = key;
    const F = faces[key].constructor;
    $('#panel-title').textContent = F.title;
    $('#panel-tech').textContent = F.tech;
    $('#panel-blurb').textContent = F.blurb;
    tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.face === key));
  }
  document.body.dataset.face = active;
  tabs.querySelector('.tab').classList.add('on');
  {
    const F = faces[active].constructor;
    $('#panel-title').textContent = F.title;
    $('#panel-tech').textContent = F.tech;
    $('#panel-blurb').textContent = F.blurb;
  }
  $('#panel-stats').textContent =
    `${(assets.mesh.positions.length / 3).toLocaleString('en')} verts · ` +
    `${(assets.mesh.indices.length / 3).toLocaleString('en')} tris · ` +
    `${assets.points.count.toLocaleString('en')} particles`;

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const i = parseInt(e.key, 10);
    if (i >= 1 && i <= order.length) select(order[i - 1]);
  });

  window.addEventListener('pointermove', e => {
    const x = (e.clientX / innerWidth) * 2 - 1;
    const y = -((e.clientY / innerHeight) * 2 - 1);
    driver.setPointer(x, y);
  });
  window.addEventListener('pointerleave', () => driver.clearPointer());

  // poke: click on the face itself (center region of the canvas)
  canvas.addEventListener('pointerdown', e => {
    const x = (e.clientX / innerWidth) * 2 - 1;
    const y = -((e.clientY / innerHeight) * 2 - 1);
    if (Math.abs(x) < 0.35 && Math.abs(y) < 0.55) driver.poke();
    else driver.interaction();
  });

  updateVoiceLabel();

  // ---- production hardening ----
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    loadingShow('SIGNAL LOST — REACQUIRING…');
    setTimeout(() => location.reload(), 600); // full rebuild is the safe recovery
  });
  function loadingShow(text) {
    let l = document.getElementById('loading');
    if (!l) { l = document.createElement('div'); l.id = 'loading'; document.body.appendChild(l); }
    l.textContent = text;
  }
  let hidden = false;
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden; // RAF self-throttles, but skip sim work too
    if (!hidden) last = performance.now();
  });
  const quality = qs.get('quality') || 'auto'; // low | auto

  // ---- render loop ----
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.0 : 1.75);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
  }
  window.addEventListener('resize', resize);
  resize();

  const FOV_DEFAULT = 33;
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsShown = 0;

  function frame(now) {
    if (hidden) { requestAnimationFrame(frame); return; } // tab in background: idle
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const t = now / 1000;
    resize();

    const s = driver.update(dt);
    const revealT = Math.min((now - revealStart) / 1700, 1);

    const headRot4 = mat4Multiply(mat4RotateY(s.yaw), mat4Multiply(mat4RotateX(s.pitch), mat4RotateZ(s.roll)));
    const headRot = mat3FromMat4(headRot4);
    const invHeadRot = mat3Transpose(headRot);
    const headPos = new Float32Array([
      Math.sin(t * 0.14) * 0.0025,
      -0.018 + s.breath * 0.004,
      0,
    ]);

    const camCfg = faces[active].constructor.CAM || { dist: 0.66, targetY: -0.045 };
    const FOV = (camCfg.fov || FOV_DEFAULT) * Math.PI / 180; // long-lens faces compress like an 85mm portrait
    const camPos = new Float32Array([
      Math.sin(t * 0.11) * 0.010,
      camCfg.targetY + 0.009 + Math.sin(t * 0.083) * 0.006,
      camCfg.dist,
    ]);
    const target = [0, camCfg.targetY, 0];
    const view = mat4LookAt(camPos, target, [0, 1, 0]);
    const aspect = canvas.width / canvas.height;
    const proj = mat4Perspective(FOV, aspect, 0.05, 5);

    // camera basis for the raymarcher
    const fwd = [target[0] - camPos[0], target[1] - camPos[1], target[2] - camPos[2]];
    const fl = Math.hypot(...fwd);
    fwd[0] /= fl; fwd[1] /= fl; fwd[2] /= fl;
    const right = [-fwd[2], 0, fwd[0]]; // cross(fwd, up) for up=(0,1,0)
    const rl = Math.hypot(...right);
    right[0] /= rl; right[1] /= rl; right[2] /= rl;
    const up = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];

    const gx = s.gazeX, gy = s.gazeY;
    const gazeDir = new Float32Array([Math.sin(gx), Math.sin(gy), Math.cos(gx) * Math.cos(gy)]);

    const cm = {
      width: canvas.width, height: canvas.height, aspect,
      t, dt, s, reveal: revealT,
      proj, view,
      camPos, camRight: new Float32Array(right), camUp: new Float32Array(up), camFwd: new Float32Array(fwd),
      tanHalf: Math.tan(FOV / 2),
      headRot, invHeadRot, headPos,
      gazeDir,
      scene: SCENES[sceneIx],
    };

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    faces[active].draw(cm);

    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) {
      fpsShown = Math.round(fpsN / fpsAcc);
      $('#fps').textContent = fpsShown + ' FPS';
      $('#state-live').textContent = driver.state.toUpperCase() + ' · ' + driver.emotion.toUpperCase();
      updateVoiceLabel();
      fpsAcc = 0; fpsN = 0;
      syncChips(); // API/postMessage/WS changes reflect in the console chips
    }
    requestAnimationFrame(frame);
  }

  loading.remove();
  requestAnimationFrame(frame);

  // ================= COMPANION API =================
  // The integration surface for a real AI companion. Three transports, one
  // command set: window.FableFace (same-page), postMessage (iframe embed),
  // WebSocket (?ws=wss://…  — a backend drives the face directly).
  const api = {
    // expression
    setEmotion: (name, intensity = 1) => driver.setEmotion(name, intensity),
    react: (name, intensity = 0.8, decay = 1.4) => driver.react(name, intensity, decay),
    emote: (name) => driver.emote(name),
    setState: (st) => driver.setState(st),
    // speech — supports inline [emotion]/[gesture] tags + auto cues
    say: (text, opts = {}) => { speech.speak(text, opts); return true; },
    stop: () => {
      const wasSpeaking = speech.speaking;
      const spokenWords = speech._wordIx || 0;
      streamGen++; streamQ.length = 0; streamBuf = ''; streamOpen = false; streamFirst = true;
      speech.stop();
      if (wasSpeaking) emit('speechinterrupted', { spokenWords }); // host truncates LLM history to reality
      return true;
    },
    // attention
    lookAt: (x, y) => { driver.setPointer(x, y); return true; },
    clearLook: () => { driver.clearPointer(); return true; },
    listen: (level = 0.6) => { if (driver.state !== 'listening') driver.setState('listening'); driver.listenLevel(level); return true; },
    poke: () => { driver.poke(); return true; },
    sleep: () => driver.sleep(),
    wake: () => driver.wake(),
    setAutopilot: (on) => { driver.setAutopilot(on); return true; },
    setFace: (key) => { select(key); return active === key; },
    setScene: (which) => setScene(which),
    // choreography: one call scripts a whole beat.
    // perform([{at:0, cmd:'setEmotion', args:['joy']}, {at:1.2, cmd:'emote', args:['nod']},
    //          {at:1.5, cmd:'say', args:['[delight] It works!']}])
    perform: (steps) => {
      if (!Array.isArray(steps)) return false;
      for (const st of steps) {
        if (!st || typeof st.cmd !== 'string' || st.cmd === 'perform' || !(st.cmd in api)) continue;
        setTimeout(() => { try { api[st.cmd](...(Array.isArray(st.args) ? st.args : [])); } catch (e) { } },
          Math.max(0, (+st.at || 0) * 1000));
      }
      return true;
    },
    // introspection
    list: () => ({ emotions: EMOTION_NAMES, gestures: GESTURE_NAMES, states: STATES, faces: order, scenes: SCENES.map(x => x.key) }),
    status: () => ({
      face: active, emotion: driver.emotion, intensity: driver.intensity, scene: SCENES[sceneIx].key,
      state: driver.state, speaking: speech.speaking, autopilot: driver.autopilot, fps: fpsShown,
    }),
  };
  api.on = (event, cb) => { (listeners[event] = listeners[event] || []).push(cb); return () => api.off(event, cb); };
  api.off = (event, cb) => { listeners[event] = (listeners[event] || []).filter(f => f !== cb); };
  api.sayStream = sayStream;
  api.on('speechend', () => {
    if (streamQ.length) setTimeout(streamPump, 120);
    else if (!streamOpen && driver.state === 'thinking') driver.setState('idle');
  });
  window.FableFace = api;

  // postMessage transport: parent posts {ff: true, cmd: 'setEmotion', args: ['joy', 0.8], id?}
  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.ff !== true || typeof m.cmd !== 'string' || !(m.cmd in api)) return;
    let result = null, error = null;
    try { result = api[m.cmd](...(Array.isArray(m.args) ? m.args : [])); }
    catch (err) { error = String(err && err.message || err); }
    if (m.id != null && e.source && e.source.postMessage) {
      e.source.postMessage({ ff: true, id: m.id, result, error }, '*');
    }
  });

  // WebSocket transport: JSON messages {cmd, args}; status events pushed back.
  const wsUrl = qs.get('ws');
  if (wsUrl) {
    let retry = 1000;
    const connect = () => {
      let ws;
      try { ws = new WebSocket(wsUrl); } catch (e) { return; }
      ws.onopen = () => {
        retry = 1000;
        wsLive = ws;
        driver.setAutopilot(false); // a backend is in charge now
        ws.send(JSON.stringify({ ff: true, event: 'ready', ...api.status() }));
      };
      ws.onmessage = ev => {
        try {
          const m = JSON.parse(ev.data);
          if (m && typeof m.cmd === 'string' && m.cmd in api) {
            const result = api[m.cmd](...(Array.isArray(m.args) ? m.args : []));
            if (m.id != null) ws.send(JSON.stringify({ ff: true, id: m.id, result }));
          }
        } catch (e) { /* ignore malformed */ }
      };
      ws.onclose = () => { if (wsLive === ws) wsLive = null; setTimeout(connect, retry); retry = Math.min(retry * 1.6, 15000); };
      ws.onerror = () => ws.close();
    };
    connect();
  }

  // URL params: ?face=eve&emotion=joy&state=listening&embed=1&autopilot=0&say=Hello
  if (qs.get('face') && faces[qs.get('face')]) select(qs.get('face'));
  if (qs.get('scene')) setScene(qs.get('scene'));
  if (qs.get('emotion')) driver.setEmotion(qs.get('emotion'), parseFloat(qs.get('intensity') || '1'));
  if (qs.get('state')) driver.setState(qs.get('state'));
  if (qs.get('autopilot') === '0') driver.setAutopilot(false);
  if (qs.get('embed') === '1') document.body.classList.add('embed');

  // a first hello so the exhibit is alive even before any interaction
  const hello = qs.get('say') || (qs.get('embed') === '1' ? null : PRESETS[0]);
  if (hello) setTimeout(() => { if (!speech.speaking) speech.speakWhenReady(hello); }, 2200);

  // autoplay policies mute TTS until the first gesture — unlock & re-voice then
  const unlockAudio = () => {
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.resume(); } catch (e) { }
    if (speech.retryBlocked()) updateVoiceLabel();
  };
  window.addEventListener('pointerdown', unlockAudio, { once: false });
  window.addEventListener('keydown', unlockAudio, { once: false });

  window.__fableface = {
    driver, speech, select, faces, assets, api,
    get active() { return active; }, get fps() { return fpsShown; },
  };
  // ---- simulated operator (right panel): showcase driven through the SDK ----
  const simPanel = document.getElementById('sim-panel');
  let sim = null;
  if (simPanel && qs.get('sim') !== '0') {
    sim = makeSimulation(api, simPanel);
    window.__fableface.sim = sim;
    // manual speech takes the stage back from the simulation
    $('#speak').addEventListener('click', () => { if (sim.running) sim.stop(); });
    if (qs.get('embed') !== '1' && !qs.get('say')) {
      // wait out the boot greeting (or any user speech), then take the stage
      let simTries = 0;
      const simTick = setInterval(() => {
        if (sim.running || ++simTries > 20) return clearInterval(simTick);
        if (!speech.speaking && driver.state === 'idle') { clearInterval(simTick); sim.run(); }
      }, 3000);
    }
  } else if (simPanel && qs.get('sim') === '0') simPanel.style.display = 'none';

  window.dispatchEvent(new Event('fableface-ready'));
}

boot().catch(err => {
  console.error(err);
  const l = $('#loading');
  if (l) l.textContent = 'BOOT FAILURE: ' + err.message;
});
