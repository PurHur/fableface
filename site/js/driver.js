// driver.js — DOM-free presence driver. Produces the animation signal that all
// faces consume. Pure logic: testable in node.
//
// v2 (companion upgrade): full emotion engine (24 blendable emotions with
// per-channel targets), transient reactions, one-shot gestures, a companion
// state machine (idle/listening/thinking/speaking/sleeping/alert), autopilot
// idle arc (bored → sleepy → asleep), micro-expressions, poke/wake, external
// listen-level, pupil + glow channels. Back-compat: MOODS/setMood still work,
// output channel names unchanged.
//
// Output signal (all smoothed):
//   jaw spread blink browL browR gazeX gazeY yaw pitch roll level breath
//   pupil (0.6..1.6)  glow (0..1)  mood (legacy key)  emotion state intensity

import { EMOTIONS, EMO_BASE, emotionVector, GESTURES } from './emotions.js';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(cur, target, rate, dt) { return lerp(target, cur, Math.exp(-rate * dt)); }
function wander(t, seed) {
  return (
    Math.sin(t * 0.31 + seed * 12.9) * 0.55 +
    Math.sin(t * 0.73 + seed * 78.2) * 0.30 +
    Math.sin(t * 1.31 + seed * 45.1) * 0.15
  );
}
// 1/f pink rhythm: octaved sines, amplitude 2^(-k/2) — the "same but never
// identical" cadence of biological rhythms (HRV, postural sway are 1/f)
function pink(t, seed) {
  let sum = 0, norm = 0;
  for (let k = 0; k < 5; k++) {
    const a = Math.pow(2, -k * 0.5);
    sum += a * Math.sin(2 * Math.PI * 0.013 * (1 << k) * t + seed * (k * 17.7 + 3.1));
    norm += a;
  }
  return sum / norm;
}

// legacy mood keys → emotion names (kept so old callers/tests keep working)
export const MOODS = {
  neutral: 'neutral', warm: 'warm', focused: 'determined',
  amused: 'delight', concerned: 'concerned',
};

export const STATES = ['idle', 'listening', 'thinking', 'speaking', 'sleeping', 'alert'];

// implicit expression overlays per state (blended on top of the chosen emotion)
const STATE_OVERLAY = {
  listening: { vec: { spread: 0.14, browL: 0.16, browR: 0.12, roll: 0.03, pupil: 1.15, glow: 0.3, sacc: 1.6, wander: 0.25 }, w: 0.65 },
  thinking: { vec: { spread: -0.14, browL: -0.12, browR: 0.1, lid: 0.06, gazeY: 0.14, gazeX: 0.1, blinkMul: 1.6, sacc: 1.7, roll: 0.03, glow: 0.4, wander: 0.5 }, w: 0.6 },
  sleeping: { vec: { lid: 0.92, pitch: -0.1, energy: 0.18, breathRate: 0.45, glow: 0.04, spread: 0.02, blinkMul: 99, wander: 0.05, pupil: 0.8 }, w: 0.92 },
  alert: { vec: { browL: 0.65, browR: 0.65, lid: -0.25, pupil: 1.3, energy: 1.5, sacc: 0.5, glow: 0.8, breathRate: 2 }, w: 0.7 },
};

const AUTOPILOT = { boredAt: 40, sleepyAt: 85, sleepAt: 135 };

export class PresenceDriver {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.t = 0;
    this.mood = 'neutral';

    // ---- emotion engine ----
    this.emotion = 'neutral';
    this.intensity = 1;
    this._emoTarget = emotionVector('neutral', 1);
    this._emo = { ...this._emoTarget };  // current blended channel vector
    this._reactions = [];                // transient overlays: {vec, w, decay}
    this._gestures = [];                 // active one-shots: {g, t}
    this.state = 'idle';
    this.autopilot = true;
    this._idleT = 0;
    this._microT = 8;
    this._listenLvl = 0;
    this._listenBurst = 0;
    this._mhmCd = 0;

    // speech state (fed by the speech adapter)
    this.speaking = false;
    this.speechT = 0;
    this.wordPulse = 0;
    this.syllRate = 11;
    this._visJaw = 1; this._visSpread = 0; this._prevSyll = 0; // procedural visemes

    // blink machinery
    this.blinkPhase = -1;
    this.nextBlink = 1.2 + this.rand() * 2.5;
    this.blinkDur = 0.15;

    // gaze machinery
    this.gazeTarget = { x: 0, y: 0 };
    this.nextSaccade = 0.8;
    this.pointer = null;
    this._thinkSide = 1;

    this._breathPhase = 0;
    this._freeze = 0; // pause-freeze pulse (Joi emanator-call state)

    // living-motion math (research round): OU gaze drift, Kuramoto coherence bank
    this._ou = { x: 0, y: 0 };
    this._msT = 0.6; // next Poisson microsaccade
    this._kN = 24;
    this._kPh = []; this._kOm = [];
    for (let i = 0; i < this._kN; i++) {
      this._kPh.push(this.rand() * Math.PI * 2);
      // ~gaussian ω spread via Irwin-Hall(3): base 1.35 rad/s, σ≈0.28
      this._kOm.push(1.35 + (this.rand() + this.rand() + this.rand() - 1.5) * 0.56);
    }
    this._pinkSeed = this.rand() * 10;
    this._sh = [0, 0, 0, 0, 0]; // SH silhouette coeffs (springs): swell, droop/lift, lean, stretch, sparkle

    this.s = {
      jaw: 0, spread: 0, blink: 0, browL: 0, browR: 0,
      gazeX: 0, gazeY: 0, yaw: 0, pitch: 0, roll: 0,
      level: 0, breath: 0, pupil: 1, glow: 0.15,
      mood: 'neutral', emotion: 'neutral', state: 'idle', intensity: 1,
    };
    this._seed = this.rand() * 100;
  }

  // ---------------- public API ----------------
  setEmotion(name, intensity = 1, opts = {}) {
    if (!EMOTIONS[name]) return false;
    this.emotion = name;
    this.intensity = clamp(intensity, 0, 1);
    this._emoTarget = emotionVector(name, this.intensity);
    this.s.emotion = name;
    this.s.intensity = this.intensity;
    // keep the legacy mood key roughly in sync
    this.mood = this.s.mood = ({ warm: 'warm', delight: 'amused', determined: 'focused', concerned: 'concerned' })[name] || 'neutral';
    if (!opts.internal) this.interaction(false);
    return true;
  }

  // transient emotional reaction that decays back to the base emotion
  react(name, intensity = 0.8, decay = 1.4) {
    if (!EMOTIONS[name]) return false;
    this._reactions.push({ vec: emotionVector(name, 1), w: clamp(intensity, 0, 1), decay });
    if (this._reactions.length > 4) this._reactions.shift();
    return true;
  }

  emote(name) {
    const g = GESTURES[name];
    if (!g) return false;
    this._gestures.push({ g, t: 0 });
    if (this._gestures.length > 3) this._gestures.shift();
    return true;
  }

  setState(state) {
    if (!STATES.includes(state)) return false;
    if (state === 'sleeping') { this.blinkPhase = -1; }
    if (this.state === 'sleeping' && state !== 'sleeping') this._playWake();
    this.state = state;
    this.s.state = state;
    this._idleT = 0;
    return true;
  }

  sleep() { return this.setState('sleeping'); }
  wake() { if (this.state === 'sleeping') this.setState('idle'); return true; }
  _playWake() {
    this.emote('alert');
    this.react('surprise', 0.35, 2.2);
    this.nextBlink = 0.15; // quick double blink on wake
  }

  // an interrupt (external stop while speaking) — the hologram freezes a beat
  pauseFreeze() { this._freeze = 1; }

  poke() {
    if (this.state === 'sleeping') { this.wake(); return; }
    this.react('surprise', 0.95, 2.4);
    this.emote('alert');
    this.gazeTarget = { x: 0, y: 0 };
    this.interaction();
  }

  setAutopilot(on) { this.autopilot = !!on; }

  // external "the user is speaking" level (0..1), used in listening state
  listenLevel(v) {
    this._listenLvl = clamp(v, 0, 1);
    this.interaction(false);
  }

  // any outside interaction resets the idle arc (and wakes from autopilot sleep)
  interaction(wakeup = true) {
    this._idleT = 0;
    if (wakeup && this.state === 'sleeping' && this._autoSlept) this.wake();
  }

  setMood(m) { // legacy
    const target = MOODS[m];
    if (!target) return;
    this.setEmotion(target, 1, { internal: true });
    this.mood = this.s.mood = m;
  }

  setPointer(x, y) { this.pointer = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; this.interaction(false); }
  clearPointer() { this.pointer = null; }

  // -- speech adapter hooks --
  onSpeechStart() {
    this.speaking = true;
    this.speechT = 0;
    this.wordPulse = 1;
    this.interaction();
  }
  onWord() {
    this.wordPulse = 1;
    if (this.rand() < 0.28) this._nod = 1;
    if (this.rand() < 0.18) this._browFlash = 1;
  }
  onSpeechEnd() {
    this.speaking = false;
    this.gazeTarget = { x: 0, y: 0 };
    this.nextSaccade = 1.4 + this.rand();
  }

  // ---------------- update ----------------
  update(dt) {
    dt = clamp(dt, 0.001, 0.1);
    this.t += dt;
    const t = this.t;
    const s = this.s;

    // ---- blend the emotion channel vector ----
    // base target + decaying transient reactions + state overlay
    const target = { ...this._emoTarget };
    for (let i = this._reactions.length - 1; i >= 0; i--) {
      const r = this._reactions[i];
      r.w *= Math.exp(-r.decay * dt);
      if (r.w < 0.02) { this._reactions.splice(i, 1); continue; }
      for (const k in target) target[k] = lerp(target[k], r.vec[k], r.w);
    }
    // state overlay, CROSS-FADED: entering/leaving a state (or flipping between
    // states in a fast agent loop) ramps the overlay in/out instead of snapping,
    // so the pose is smooth at every instant — no pop on any transition.
    const ovT = STATE_OVERLAY[this.state] || { vec: {}, w: 0 };
    if (!this._ovVec) { this._ovVec = {}; this._ovW = 0; }
    for (const k in ovT.vec) if (!(k in this._ovVec)) this._ovVec[k] = (k in EMO_BASE) ? EMO_BASE[k] : 0;
    this._ovW = smooth(this._ovW, ovT.w, 4.5, dt);
    for (const k in this._ovVec) {
      const tv = (k in ovT.vec) ? ovT.vec[k] : ((k in EMO_BASE) ? EMO_BASE[k] : 0);
      this._ovVec[k] = smooth(this._ovVec[k], tv, 4.5, dt);
      if (k in target) target[k] = lerp(target[k], this._ovVec[k], this._ovW);
    }
    for (const k in this._emo) this._emo[k] = smooth(this._emo[k], target[k], 3.5, dt);
    const emo = this._emo;

    // ---- gestures: additive deltas on this frame's targets ----
    const gd = { jaw: 0, spread: 0, blink: 0, browL: 0, browR: 0, gazeX: 0, gazeY: 0, pitch: 0, yaw: 0, roll: 0, lid: 0, level: 0 };
    for (let i = this._gestures.length - 1; i >= 0; i--) {
      const G = this._gestures[i];
      G.t += dt;
      const u = G.t / G.g.dur;
      if (u >= 1) { this._gestures.splice(i, 1); continue; }
      const d = G.g.def(u);
      for (const k in d) gd[k] = (gd[k] || 0) + d[k];
    }

    // ---- autopilot idle arc + micro-expressions ----
    if (this.autopilot && !this.speaking && this.state === 'idle') {
      this._idleT += dt;
      if (this._idleT > AUTOPILOT.sleepAt) { this._autoSlept = true; this.setState('sleeping'); }
      else if (this._idleT > AUTOPILOT.sleepyAt && this.emotion === 'neutral') this.setEmotion('sleepy', 0.6, { internal: true });
      else if (this._idleT > AUTOPILOT.boredAt && this.emotion === 'neutral' && this._idleT < AUTOPILOT.boredAt + dt * 2) this.react('bored', 0.5, 0.12);
      this._microT -= dt;
      if (this._microT <= 0) {
        this._microT = 7 + this.rand() * 9;
        const picks = ['curious', 'joy', 'thinking', 'warm', 'mischievous'];
        this.react(picks[Math.floor(this.rand() * picks.length)], 0.2 + this.rand() * 0.12, 1.1);
      }
    } else if (this.state === 'sleeping' && !this._autoSleepChecked) {
      // stay asleep until wake()
    }

    // ---- blinking (rate/duration modulated by emotion; off while sleeping) ----
    if (this.state !== 'sleeping') {
      this.nextBlink -= dt / Math.max(0.2, emo.blinkMul);
      if (this.blinkPhase < 0 && this.nextBlink <= 0) {
        this.blinkPhase = 0;
        this.blinkDur = (0.13 + this.rand() * 0.06) * emo.blinkSlow;
        this.nextBlink = this.rand() < 0.18 ? 0.25 : 1.4 + this.rand() * 3.4;
      }
    }
    let blinkT = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / this.blinkDur;
      if (this.blinkPhase >= 1) this.blinkPhase = -1;
      else {
        const ph = this.blinkPhase;
        blinkT = ph < 0.4 ? ph / 0.4 : 1 - (ph - 0.4) / 0.6;
        blinkT = Math.pow(clamp(blinkT, 0, 1), 0.8);
      }
    }
    // effective lids = blink event + sustained droop/widen + gesture deltas
    // + DUCHENNE: a real smile narrows the eyes a touch (cheek raise)
    const duchenne = Math.max(0, s.spread - 0.22) * 0.16;
    const lidT = clamp(blinkT + emo.lid + duchenne + gd.lid + gd.blink, -0.35, 1);
    s.blink = smooth(s.blink, lidT, 28, dt);

    // ---- gaze: saccades + pointer pursuit + state patterns ----
    this.nextSaccade -= dt / Math.max(0.2, emo.sacc);
    if (this.nextSaccade <= 0) {
      this.nextSaccade = 0.7 + this.rand() * (this.speaking ? 1.3 : 2.6);
      if (this.state === 'listening') {
        this.gazeTarget = { x: (this.rand() - 0.5) * 0.06, y: (this.rand() - 0.5) * 0.04 }; // locked-on
      } else if (this.state === 'thinking') {
        this._thinkSide *= this.rand() < 0.3 ? -1 : 1;
        this.gazeTarget = { x: this._thinkSide * (0.16 + this.rand() * 0.1), y: 0.14 + this.rand() * 0.1 }; // up-corners
      } else if (this.pointer && this.rand() < 0.75) {
        this.gazeTarget = { x: this.pointer.x * 0.30, y: this.pointer.y * 0.22 };
      } else if (this.rand() < 0.7) {
        this.gazeTarget = {
          x: (this.rand() - 0.5) * 0.26 * emo.wander + emo.gazeX,
          y: (this.rand() - 0.5) * 0.16 * emo.wander + emo.gazeY,
        };
      } else {
        this.gazeTarget = { x: emo.gazeX * 0.5, y: emo.gazeY * 0.5 };
      }
    }
    if (this.pointer && this.state !== 'thinking' && this.state !== 'sleeping') {
      this.gazeTarget.x = lerp(this.gazeTarget.x, this.pointer.x * 0.30, 1 - Math.exp(-2.2 * dt));
      this.gazeTarget.y = lerp(this.gazeTarget.y, this.pointer.y * 0.22, 1 - Math.exp(-2.2 * dt));
    }
    // gaze micro-motion: exact-discretization Ornstein-Uhlenbeck (mean-reverting,
    // smooth, never repeats) + Poisson-timed microsaccade impulses that the same
    // OU pull relaxes — tuned to fixational-eye-movement statistics
    {
      const ouTh = 1.8 + 2.4 * emo.coh; // LMA "bound flow": control ⇒ faster reversion
      const ouSig = 0.0095 * (0.65 + 0.55 * emo.energy);
      const a = Math.exp(-ouTh * dt);
      const sd = ouSig * Math.sqrt(Math.max(0, (1 - a * a) / (2 * ouTh)));
      const g3 = () => (this.rand() + this.rand() + this.rand() - 1.5) * 1.63; // ~N(0,1)
      this._ou.x = this._ou.x * a + sd * g3();
      this._ou.y = this._ou.y * a + sd * g3() * 0.75;
      this._msT -= dt;
      if (this._msT <= 0 && this.state !== 'sleeping') {
        this._msT = -Math.log(Math.max(1e-6, this.rand())) * 0.7 * emo.sacc;
        const ang = this.rand() * Math.PI * 2, amp = 0.005 + this.rand() * 0.007;
        this._ou.x += Math.cos(ang) * amp;
        this._ou.y += Math.sin(ang) * amp * 0.6;
      }
    }
    s.gazeX = smooth(s.gazeX, clamp(this.gazeTarget.x + gd.gazeX, -0.42, 0.42), 14, dt) + this._ou.x;
    s.gazeY = smooth(s.gazeY, clamp(this.gazeTarget.y + gd.gazeY, -0.35, 0.38), 14, dt) + this._ou.y;

    // ---- listening: react to the user's voice level ----
    if (this.state === 'listening') {
      this._mhmCd = Math.max(0, this._mhmCd - dt);
      if (this._listenLvl > 0.25) this._listenBurst += dt;
      else {
        if (this._listenBurst > 1.2 && this._mhmCd <= 0) { this.emote('nod'); this._mhmCd = 3.5; } // "mhm"
        this._listenBurst = Math.max(0, this._listenBurst - dt * 2);
      }
      this._listenLvl = Math.max(0, this._listenLvl - dt * 1.5); // decays unless refreshed
    }

    // ---- head pose ----
    // (gesture deltas are added POST-smoothing: a nod/shake must be crisp,
    // the timeline envelopes are already smooth curves)
    this._nod = Math.max(0, (this._nod || 0) - dt * 4.5);
    const energy = emo.energy * (this.speaking ? 1.25 : 1);
    const hp = this._hp || (this._hp = { yaw: 0, pitch: 0, roll: 0 });
    const yawT = wander(t * 0.9, this._seed) * 0.045 * energy + s.gazeX * 0.30 + emo.yaw;
    const pitchT = wander(t * 0.8, this._seed + 31) * 0.030 * energy + s.gazeY * 0.35 + emo.pitch
      - this._nod * 0.035 * Math.sin(this._nod * Math.PI)
      + (this.state === 'listening' ? this._listenLvl * 0.012 : 0);
    const rollT = wander(t * 0.6, this._seed + 62) * 0.022 * energy + emo.roll;
    hp.yaw = smooth(hp.yaw, yawT, 3.2, dt);
    hp.pitch = smooth(hp.pitch, pitchT, 3.2, dt);
    hp.roll = smooth(hp.roll, rollT, 2.6, dt);
    s.yaw = hp.yaw + gd.yaw;
    s.pitch = hp.pitch + gd.pitch;
    s.roll = hp.roll + gd.roll;

    // ---- mouth ----
    this.wordPulse = Math.max(0, this.wordPulse - dt * 5.5);
    let jawT = emo.jawIdle, level = 0, visSpread = 0;
    if (this.speaking) {
      this.speechT += dt;
      const syll = Math.pow(Math.abs(Math.sin(this.speechT * this.syllRate + Math.sin(this.speechT * 3.1) * 1.7)), 1.7);
      // VISEMES: each syllable picks a mouth shape — AH open, OO round (pursed),
      // EE wide, or an M/B closure. Jaw scale + corner spread together read as
      // actual articulation instead of a flapping jaw.
      const visCyc = Math.floor(this.speechT * this.syllRate / Math.PI); // one per syllable
      if (visCyc !== this._prevSyll) {
        this._prevSyll = visCyc;
        const r = this.rand();
        if (r < 0.34) { this._visJaw = 1.0; this._visSpread = 0.05; }        // AH
        else if (r < 0.58) { this._visJaw = 0.62; this._visSpread = -0.55; } // OO
        else if (r < 0.82) { this._visJaw = 0.45; this._visSpread = 0.55; }  // EE
        else { this._visJaw = 0.22; this._visSpread = -0.12; }               // M/closure
      }
      const emph = 0.55 + 0.45 * this.wordPulse;
      jawT = (0.14 + 0.86 * syll) * emph * this._visJaw;
      visSpread = this._visSpread * syll * 0.8;
      level = clamp(syll * emph * 1.15, 0, 1);
      this.syllRate = lerp(this.syllRate, 9.5 + wander(this.speechT * 0.7, this._seed + 7) * 2.4, 0.02);
    }
    jawT += gd.jaw;
    s.jaw = smooth(s.jaw, clamp(jawT, 0, 1), this.speaking ? 22 : 9, dt);

    // ---- glow + level (state pulses make thinking/listening visible on every face) ----
    let glowT = emo.glow;
    if (!this.speaking) {
      if (this.state === 'thinking') level = Math.max(level, glowT * (0.35 + 0.25 * Math.sin(t * 2 * Math.PI * 1.15)));
      else if (this.state === 'listening') level = Math.max(level, 0.10 + 0.06 * Math.sin(t * 2 * Math.PI * 0.5) + this._listenLvl * 0.3);
      else if (this.state === 'alert') level = Math.max(level, glowT * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 2.6)));
    }
    level += gd.level;
    s.level = smooth(s.level, clamp(level, 0, 1), 16, dt);
    s.glow = smooth(s.glow, glowT, 4, dt);
    s.pupil = smooth(s.pupil, emo.pupil, 3, dt);

    // ---- spread / brows ----
    const spreadT = emo.spread + gd.spread + visSpread
      + wander(t * 0.23, this._seed + 90) * 0.05 * emo.energy;
    s.spread = smooth(s.spread, clamp(spreadT, -1, 1), 4.5, dt);

    this._browFlash = Math.max(0, (this._browFlash || 0) - dt * 3.2);
    const flash = this._browFlash * 0.5 * Math.sin(this._browFlash * Math.PI);
    const browWander = wander(t * 0.35, this._seed + 44) * 0.06 * emo.energy;
    s.browL = smooth(s.browL, clamp(emo.browL + browWander + flash + gd.browL, -1, 1), 6, dt);
    s.browR = smooth(s.browR, clamp(emo.browR + browWander + flash * 0.7 + gd.browR, -1, 1), 6, dt);

    // ---- breathing (variable rate, 1/f-modulated: periodic = robotic) ----
    const pinkR = pink(t, this._pinkSeed);
    const pinkD = pink(t * 1.31, this._pinkSeed + 5.7);
    this._breathPhase += dt * 2 * Math.PI / 4.6 * emo.breathRate * (1 + 0.16 * pinkR);
    s.breath = 0.5 + 0.5 * Math.sin(this._breathPhase) * (0.85 + 0.15 * pinkD);
    s.pinkG = pinkR; // slow 1/f drift channel — faces breathe glow/exposure with it

    // strongest live transient reaction (faces use this for glitch bursts etc.)
    let rw = 0;
    for (const r of this._reactions) rw = Math.max(rw, r.w);
    s.reactW = rw;
    s.energy = emo.energy; // blended movement energy — faces scale turbulence/sparkle/rings
    let gw = 0;            // live gesture envelope — faces pulse with nods/laughs/gasps
    for (const G of this._gestures) {
      const u = Math.min(1, G.t / G.g.dur);
      gw = Math.max(gw, Math.sin(u * Math.PI));
    }
    s.gestureW = gw;

    // ---- Kuramoto mean-field coherence ----
    // 24 real oscillators; emotion 'coh' sets coupling K (K = 7·coh² spans the
    // critical point), speech adds intent. Order r and mean phase ψ EMERGE —
    // faces blend each particle's own phase toward ψ by r: calm minds shimmer
    // in unison, confused ones scintillate apart, and the transition is real.
    {
      let kx = 0, ky = 0;
      for (let i = 0; i < this._kN; i++) { kx += Math.cos(this._kPh[i]); ky += Math.sin(this._kPh[i]); }
      const r = Math.sqrt(kx * kx + ky * ky) / this._kN;
      const psi = Math.atan2(ky, kx);
      const K = 7.0 * emo.coh * emo.coh * (this.speaking ? 1.2 : 1.0);
      const kdt = Math.min(dt, 0.05);
      for (let i = 0; i < this._kN; i++) {
        this._kPh[i] += kdt * (this._kOm[i] + K * r * Math.sin(psi - this._kPh[i]));
      }
      s.cohR = r;
      s.cohPsi = psi;
    }

    // ---- spherical-harmonic emotion silhouette ----
    // Targets from emotion channels; springs (tau~0.8s) + incommensurate LFOs so
    // the silhouette breathes without ever looping. |a| capped at 0.005 (~5% of
    // head radius) — beyond that facial features smear.
    {
      const cap = (v) => clamp(v, -0.005, 0.005);
      const tgt = [
        (emo.glow - 0.15) * 0.009,                              // Y00 swell: radiant emotions inflate the presence
        emo.spread * 0.006 + (emo.pitch < 0 ? emo.pitch * 0.04 : 0), // Y1y: smiles lift, sorrow droops
        (emo.yaw + emo.roll) * 0.05,                            // Y1x lean: curiosity/mischief tilt
        Math.max(0, emo.breathRate - 1.2) * 0.004,              // Y20 stretch: fear/alarm vertical tension
        Math.max(0, emo.energy - 1.1) * 0.008,                  // Y4p4 sparkle: excitement grows 4-fold lobes
      ];
      const om = [0.31, 0.47, 0.73, 1.09, 0.59];
      const k = 1 - Math.exp(-dt / 0.8);
      for (let i = 0; i < 5; i++) {
        const lfo = Math.sin(om[i] * t + this._pinkSeed * (i + 1) * 2.3) * 0.0006 * emo.energy;
        this._sh[i] += (cap(tgt[i]) + lfo - this._sh[i]) * k;
      }
      s.sh = this._sh;
    }

    // ---- SIGNAL-BEING channels (WISP IV) ----
    // doubt: uncertainty made visible (interference moiré) — high while
    // listening to the user, medium while confused/thinking, resolves at rest
    const doubtT = this.state === 'listening' ? 0.45 + this._listenLvl * 0.4
      : this.emotion === 'confused' ? 0.55
      : (this.state === 'thinking' || this.emotion === 'thinking') ? 0.30 : 0;
    s.doubt = smooth(s.doubt || 0, doubtT, 2, dt);
    // freeze: decaying interrupt pulse
    this._freeze = Math.max(0, this._freeze - dt * 1.1);
    s.freeze = this._freeze;
    // raw pointer (for reaction-at-a-distance startle dodge)
    s.px = this.pointer ? this.pointer.x : 0;
    s.py = this.pointer ? this.pointer.y : 0;
    s.pOn = this.pointer ? 1 : 0;

    if (this.override) Object.assign(s, this.override);
    return s;
  }
}
