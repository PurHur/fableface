// emotions.js — DOM-free emotion & gesture definitions for the companion driver.
// An EMOTION is a target vector over the driver's expression channels; the driver
// blends toward it (per-channel rates) and layers behavior (blink/saccade/breath).
// A GESTURE is a short one-shot timeline of additive channel deltas.
// Pure logic: node-testable.

// Channel defaults — every emotion is a partial override of this.
export const EMO_BASE = {
  spread: 0.08,   // mouth corners: + smile, - purse           (-1..1)
  browL: 0.02, browR: 0.02, // brow raise (+) / furrow (-)     (-1..1)
  lid: 0.0,       // sustained lid droop 0..1; NEGATIVE = eyes widen
  jawIdle: 0.0,   // resting jaw parting (awe/surprise/tension)
  gazeX: 0.0, gazeY: 0.0,   // gaze bias
  wander: 1.0,    // gaze wander amplitude multiplier
  pitch: 0.0, yaw: 0.0, roll: 0.0, // head pose bias, radians (keep ≤ ~0.08)
  energy: 1.0,    // movement amplitude multiplier
  breathRate: 1.0,// 1 = one breath / 4.6s
  blinkMul: 1.0,  // blink interval multiplier (>1 = rarer)
  blinkSlow: 1.0, // blink duration multiplier (sleepy = slow lids)
  sacc: 1.0,      // saccade interval multiplier (>1 = longer fixations)
  pupil: 1.0,     // pupil dilation (0.6 constricted .. 1.6 dilated)
  glow: 0.15,     // ambient emotive glow 0..1 (feeds face accent glow)
  coh: 0.72,      // collective coherence 0..1 — Kuramoto coupling: calm/confident
                  // minds shimmer in unison, confused/afraid ones scintillate apart
};

export const EMOTIONS = {
  neutral: {},
  // ---- positive ----
  joy: { coh: 0.78, spread: 0.62, browL: 0.25, browR: 0.22, pupil: 1.15, energy: 1.2, glow: 0.4, breathRate: 1.1 },
  delight: { coh: 0.7, spread: 0.82, browL: 0.4, browR: 0.36, lid: -0.06, pupil: 1.25, energy: 1.35, glow: 0.55, blinkMul: 0.9 },
  warm: { coh: 0.85, spread: 0.42, browL: 0.18, browR: 0.16, lid: 0.12, pupil: 1.3, glow: 0.32, breathRate: 0.9 },
  love: { coh: 0.88, spread: 0.5, browL: 0.2, browR: 0.2, lid: 0.24, pupil: 1.55, glow: 0.6, roll: 0.03, breathRate: 0.85, blinkSlow: 1.4 },
  proud: { coh: 0.9, spread: 0.3, browL: 0.12, browR: 0.12, lid: 0.12, pitch: 0.05, energy: 0.9, glow: 0.3 },
  mischievous: { coh: 0.6, spread: 0.48, browL: -0.22, browR: 0.38, lid: 0.2, roll: 0.03, pupil: 1.1, glow: 0.4 },
  awe: { coh: 0.82, spread: 0.1, browL: 0.5, browR: 0.5, lid: -0.2, jawIdle: 0.22, pupil: 1.5, energy: 0.7, breathRate: 0.7, wander: 0.4, glow: 0.6 },
  // ---- negative ----
  sad: { coh: 0.55, spread: -0.4, browL: 0.35, browR: 0.35, lid: 0.3, gazeY: -0.12, pitch: -0.05, energy: 0.6, breathRate: 0.8, blinkSlow: 1.4, glow: 0.08 },
  angry: { coh: 0.42, spread: -0.32, browL: -0.7, browR: -0.7, lid: -0.08, jawIdle: 0.05, pitch: -0.03, pupil: 0.8, energy: 1.3, breathRate: 1.5, sacc: 0.7, glow: 0.55 },
  irritated: { coh: 0.5, spread: -0.22, browL: -0.42, browR: -0.4, roll: 0.015, blinkMul: 1.3, pupil: 0.9, glow: 0.3 },
  fear: { coh: 0.2, spread: -0.25, browL: 0.55, browR: 0.55, lid: -0.22, pupil: 1.45, blinkMul: 2.6, energy: 1.4, breathRate: 2.2, wander: 1.6, pitch: -0.02, glow: 0.4 },
  disgust: { coh: 0.5, spread: -0.5, browL: -0.35, browR: 0.15, lid: 0.18, pitch: 0.04, yaw: 0.02, pupil: 0.85, glow: 0.2 },
  embarrassed: { coh: 0.38, spread: 0.26, browL: 0.28, browR: 0.22, gazeX: 0.18, gazeY: -0.2, pitch: -0.04, roll: 0.04, blinkMul: 0.7, breathRate: 1.3, glow: 0.25 },
  // ---- cognitive ----
  curious: { coh: 0.65, spread: 0.18, browL: 0.45, browR: 0.06, roll: 0.055, pupil: 1.2, wander: 0.7, sacc: 0.8, glow: 0.3 },
  confused: { coh: 0.12, spread: -0.12, browL: -0.25, browR: 0.45, roll: -0.06, jawIdle: 0.04, wander: 1.3, blinkMul: 0.8, glow: 0.25 },
  thinking: { coh: 0.6, spread: -0.16, browL: -0.15, browR: 0.1, lid: 0.08, gazeX: 0.12, gazeY: 0.16, blinkMul: 1.6, sacc: 1.8, roll: 0.03, glow: 0.35 },
  skeptical: { coh: 0.55, spread: -0.2, browL: -0.5, browR: 0.4, lid: 0.15, roll: -0.02, pupil: 0.9, glow: 0.25 },
  determined: { coh: 0.95, spread: -0.1, browL: -0.35, browR: -0.35, lid: 0.05, energy: 1.15, pupil: 0.9, sacc: 0.75, glow: 0.45 },
  concerned: { coh: 0.48, spread: -0.2, browL: 0.45, browR: 0.42, pitch: -0.02, roll: 0.025, pupil: 1.1, breathRate: 0.9, glow: 0.22 },
  // ---- arousal states ----
  surprise: { coh: 0.32, spread: 0.05, browL: 0.8, browR: 0.78, lid: -0.3, jawIdle: 0.3, pupil: 1.35, blinkMul: 3, breathRate: 1.4, glow: 0.5 },
  bored: { coh: 0.65, spread: -0.08, lid: 0.35, gazeY: -0.05, wander: 1.4, blinkSlow: 1.5, blinkMul: 1.2, energy: 0.55, breathRate: 0.75, sacc: 1.4, glow: 0.08 },
  sleepy: { coh: 0.85, lid: 0.55, pitch: -0.06, gazeY: -0.1, energy: 0.35, breathRate: 0.6, blinkSlow: 2.2, blinkMul: 1.6, glow: 0.05 },
  alarm: { coh: 0.28, spread: -0.35, browL: 0.7, browR: 0.7, lid: -0.28, jawIdle: 0.1, pupil: 1.3, energy: 1.6, breathRate: 2.4, sacc: 0.5, glow: 0.85 },
};
export const EMOTION_NAMES = Object.keys(EMOTIONS);

// resolve an emotion to a full channel vector at a given intensity (0..1)
export function emotionVector(name, intensity = 1) {
  const e = EMOTIONS[name] || {};
  const out = {};
  for (const k in EMO_BASE) {
    const base = EMO_BASE[k];
    const target = (k in e) ? e[k] : base;
    out[k] = base + (target - base) * intensity;
  }
  return out;
}

// ---------------- gestures: one-shot additive timelines ----------------
// def(u) with u in 0..1 returns channel deltas. env helpers:
const S = Math.sin, PI = Math.PI;
const bump = u => S(PI * Math.min(1, Math.max(0, u)));       // 0..1..0
const decay = u => 1 - u;

export const GESTURES = {
  nod: { dur: 0.8, def: u => ({ pitch: -0.065 * S(u * 2 * PI) * decay(u * 0.5) }) },
  nod2: { dur: 1.2, def: u => ({ pitch: -0.05 * S(u * 4 * PI) * decay(u * 0.4) }) },
  shake: { dur: 1.0, def: u => ({ yaw: 0.07 * S(u * 3 * PI) * decay(u) }) },
  tilt: { dur: 1.5, def: u => ({ roll: 0.09 * bump(u) }) },
  wink: { dur: 0.55, def: u => ({ blink: 0.95 * bump(u * 1.6 > 1 ? 0 : u * 1.6), spread: 0.3 * bump(u), roll: 0.02 * bump(u) }) },
  gasp: { dur: 1.2, def: u => ({ jaw: 0.45 * Math.pow(bump(Math.min(1, u * 1.4)), 0.5), browL: 0.6 * bump(u), browR: 0.6 * bump(u), lid: -0.25 * bump(u) }) },
  laugh: {
    dur: 1.7, def: u => ({
      jaw: (0.2 + 0.25 * Math.abs(S(u * 14))) * decay(u * 0.7),
      spread: 0.55 * bump(Math.min(1, u * 2)),
      pitch: 0.02 * S(u * 14) * decay(u),
      browL: 0.3 * bump(u), browR: 0.3 * bump(u),
      level: 0.55 * decay(u * 0.6),
    })
  },
  sigh: {
    dur: 2.0, def: u => ({
      pitch: u < 0.4 ? 0.035 * bump(u / 0.4) : -0.05 * bump((u - 0.4) / 0.6),
      jaw: u > 0.35 ? 0.12 * bump((u - 0.35) / 0.65) : 0,
      lid: u > 0.4 ? 0.3 * bump((u - 0.4) / 0.6) : 0,
      spread: -0.15 * bump(u),
    })
  },
  eyeroll: { dur: 1.2, def: u => ({ gazeX: 0.3 * S(2 * PI * u) * decay(u * 0.3), gazeY: 0.35 * bump(u), lid: u > 0.6 ? 0.25 * bump((u - 0.6) / 0.4) : 0, roll: 0.02 * bump(u) }) },
  wince: { dur: 0.9, def: u => ({ blink: 0.7 * bump(u), browL: -0.4 * bump(u), browR: -0.35 * bump(u), spread: -0.4 * bump(u), roll: -0.03 * bump(u), pitch: 0.02 * bump(u) }) },
  alert: { dur: 0.7, def: u => ({ lid: -0.3 * bump(u), browL: 0.6 * bump(u), browR: 0.6 * bump(u), pitch: 0.03 * bump(u) }) },
  bow: { dur: 1.3, def: u => ({ pitch: -0.09 * bump(u), spread: 0.35 * bump(u) }) },
  lookup: { dur: 1.0, def: u => ({ gazeY: 0.3 * bump(u), gazeX: 0.2 * S(PI * u) * (u < 0.5 ? 1 : -1) }) },
};
export const GESTURE_NAMES = Object.keys(GESTURES);

// ---------------- speech cue parsing ----------------
// Inline tags: "[joy] Great!", "[sad:0.6] oh…", "[nod] sure." — emotion names set
// the emotion (with optional :intensity), gesture names play a gesture, "[reset]"
// returns to neutral. Tags bind to the FOLLOWING word index.
export function parseCues(text) {
  const cues = [];
  let clean = [];
  let wordIx = 0;
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const m = tok.match(/^\[([a-z_]+)(?::([\d.]+))?\]$/i);
    if (m) {
      const name = m[1].toLowerCase();
      const inten = m[2] !== undefined ? Math.max(0, Math.min(1, parseFloat(m[2]))) : 1;
      if (name === 'reset') cues.push({ atWord: wordIx, kind: 'emotion', name: 'neutral', intensity: 1 });
      else if (EMOTIONS[name]) cues.push({ atWord: wordIx, kind: 'emotion', name, intensity: inten });
      else if (GESTURES[name]) cues.push({ atWord: wordIx, kind: 'gesture', name });
      continue; // tag tokens never reach the TTS text
    }
    clean.push(tok);
    wordIx++;
  }
  return { text: clean.join(' '), cues, words: wordIx };
}

// Heuristic cues from plain text (used when opts.auto !== false).
// rand injectable for deterministic tests.
export function autoCues(text, existing = [], rand = Math.random) {
  const cues = [];
  const taken = new Set(existing.map(c => c.atWord));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    if (taken.has(i)) return;
    const lower = w.toLowerCase();
    if (/^(haha|hahaha|lol)[!.]*$/.test(lower)) cues.push({ atWord: i, kind: 'gesture', name: 'laugh' });
    else if (/^(hmm+|uhm+|äh+m*)[.…]*$/.test(lower)) cues.push({ atWord: i, kind: 'emotion', name: 'thinking', intensity: 0.7, transient: 2 });
    else if (/(sorry|leider|entschuldig)/.test(lower)) cues.push({ atWord: i, kind: 'emotion', name: 'concerned', intensity: 0.6, transient: 3 });
    else if (/(great|wunderbar|super|fantastisch|toll|perfekt|yay)/.test(lower)) cues.push({ atWord: i, kind: 'emotion', name: 'joy', intensity: 0.7, transient: 3 });
    else if (/wow[!.]*$/.test(lower)) cues.push({ atWord: i, kind: 'emotion', name: 'awe', intensity: 0.8, transient: 3 });
    else if (/\?$/.test(w)) cues.push({ atWord: Math.max(0, i - 2), kind: 'emotion', name: 'curious', intensity: 0.55, transient: 2.5 });
    else if (/!$/.test(w) && rand() < 0.8) cues.push({ atWord: i, kind: 'gesture', name: 'nod' });
    else if (/(…|\.\.\.)$/.test(w)) cues.push({ atWord: i, kind: 'emotion', name: 'thinking', intensity: 0.5, transient: 2 });
  });
  return cues;
}
