// speech.js — talk via Web Speech API when voices exist; otherwise MIME the
// speech visually for an estimated duration so the faces always animate.
// v2: emotion-aware. speak(text, opts) supports inline cue tags ("[joy] Great
// news! [nod] Really.") plus automatic cues from punctuation/keywords; cues
// fire word-synced in both TTS and mime mode. No microphone use.

import { parseCues, autoCues } from './emotions.js';

export class Speech {
  constructor(driver) {
    this.driver = driver;
    this.speaking = false;
    this.mode = 'none'; // 'tts' | 'mime'
    this.blockedText = null;   // TTS refused pre-gesture (autoplay policy)
    this.blockedOpts = null;
    this._timers = [];
    this._voice = null;
    this._cues = [];
    this._wordIx = 0;
    if (typeof speechSynthesis !== 'undefined') {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this._voice =
          vs.find(v => /en[-_]/i.test(v.lang) && /female|zira|samantha|karen|google uk english female/i.test(v.name)) ||
          vs.find(v => /^en/i.test(v.lang)) || vs[0] || null;
      };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  get available() {
    return typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length > 0;
  }

  stop(isInterrupt = true) {
    // a true interrupt (external stop mid-speech) briefly freezes the hologram;
    // internal stops (the start of every speak()) do not.
    if (isInterrupt && this.speaking) this.driver.pauseFreeze?.();
    this._timers.forEach(clearTimeout);
    this._timers = [];
    this._cues = [];
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.driver.onSpeechEnd();
    }
  }

  // opts: { emotion, intensity, auto (default true: heuristic cues), rate, pitch }
  speak(text, opts = {}) {
    text = String(text || '').trim();
    if (!text) return;
    this.stop(false);
    this._raw = text; // kept for autoplay-block retry (tags intact)
    const parsed = parseCues(text);
    this._cues = parsed.cues.slice();
    if (opts.auto !== false) this._cues.push(...autoCues(parsed.text, this._cues));
    this._cues.sort((a, b) => a.atWord - b.atWord);
    this._wordIx = 0;
    if (opts.emotion) this.driver.setEmotion(opts.emotion, opts.intensity ?? 1);
    if (!parsed.text) { // tags only: fire immediately, nothing to say
      this._fireCues(1e9);
      return;
    }
    if (this.available) this._speakTTS(parsed.text, opts);
    else this._mime(parsed.text);
  }

  _fireCues(uptoWord) {
    while (this._cues.length && this._cues[0].atWord <= uptoWord) {
      const c = this._cues.shift();
      if (c.kind === 'gesture') this.driver.emote(c.name);
      else if (c.transient) this.driver.react(c.name, c.intensity ?? 0.7, 1 / Math.max(0.5, c.transient));
      else this.driver.setEmotion(c.name, c.intensity ?? 1);
    }
  }

  _word() {
    this._fireCues(this._wordIx);
    this._wordIx++;
    this.driver.onWord();
  }

  _speakTTS(text, opts = {}) {
    this.mode = 'tts';
    const u = new SpeechSynthesisUtterance(text);
    if (this._voice) u.voice = this._voice;
    u.rate = opts.rate ?? 1.0;
    u.pitch = opts.pitch ?? 1.0;
    let started = false;
    u.onstart = () => {
      started = true;
      this.blockedText = null; // audio is flowing — nothing pending
      this.speaking = true;
      this.driver.onSpeechStart();
      this._fireCues(-1); // pre-first-word cues
    };
    u.onboundary = e => {
      if (e.name === 'word' || e.charIndex != null) this._word();
    };
    const done = () => {
      if (this.speaking) {
        this.speaking = false;
        this._fireCues(1e9); // any remaining cues
        this.driver.onSpeechEnd();
      }
    };
    u.onend = done;
    u.onerror = (e) => {
      done();
      if (!started) {
        // 'not-allowed' = autoplay policy: remember it, retry on first gesture
        if (e && /not-allowed|denied/i.test(e.error || '')) { this.blockedText = this._raw || text; this.blockedOpts = opts; }
        this._mime(text);
      }
    };
    speechSynthesis.speak(u);
    this._timers.push(setTimeout(() => {
      if (!started && !this.speaking) {
        speechSynthesis.cancel();
        this.blockedText = this._raw || text; this.blockedOpts = opts; // engine mute pre-gesture
        this._mime(text);
      }
    }, 700));
  }

  // called from the first user gesture: audio is now allowed — voice the line
  // that got silently mimed at page load.
  retryBlocked() {
    if (!this.blockedText || !this.available) return false;
    const text = this.blockedText, opts = this.blockedOpts || {};
    this.blockedText = null;
    this.speak(text, opts); // full re-parse: emotion tags fire again, now with audio
    return true;
  }

  // speak once voices are loaded (some engines populate getVoices() late)
  speakWhenReady(text, opts = {}, timeoutMs = 1800) {
    if (this.available || typeof speechSynthesis === 'undefined') { this.speak(text, opts); return; }
    let done = false;
    const go = () => { if (!done) { done = true; this.speak(text, opts); } };
    speechSynthesis.addEventListener?.('voiceschanged', go, { once: true });
    this._timers.push(setTimeout(go, timeoutMs));
  }

  _mime(text) {
    this.mode = 'mime';
    const words = text.split(/\s+/).filter(Boolean);
    this.speaking = true;
    this.driver.onSpeechStart();
    this._fireCues(-1);
    let t = 0;
    for (const w of words) {
      const dur = 180 + w.length * 55 + (/[,.;:!?]$/.test(w) ? 260 : 0);
      this._timers.push(setTimeout(() => this._word(), t));
      t += dur;
    }
    this._timers.push(setTimeout(() => {
      this.speaking = false;
      this._fireCues(1e9);
      this.driver.onSpeechEnd();
    }, t + 220));
  }
}
