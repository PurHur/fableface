// simulation.js — the SIMULATED OPERATOR: a scripted conversation that drives
// the face through the real public API (sayStream/state/scene/gestures) and
// renders a live transcript where every emotion/gesture/scene event appears the
// instant the SDK emits it and the reply text reveals word-by-word in sync with
// the actual speech ('word' events) — karaoke captions, not a timer guessing.
import { parseCues } from './emotions.js';

const SCRIPT = [
  {
    op: 'Hey — are you awake?',
    reply: '[warm] Good evening, operator. [joy] I was hoping you would drop by. [nod]',
  },
  {
    op: 'What exactly are you?',
    stream: true,
    reply: '[thinking] Hmm — technically? [neutral] About a hundred thousand particles pretending, very hard, to be a face. [delight] The pretending is the fun part! [laugh]',
  },
  {
    op: 'Show me what you can feel.',
    reply: '[joy] Joy. [sad] Sorrow. [angry] Fire. [fear] Fear. [surprise] Lightning! [awe] Wonder... [love] And this one — this one is my favorite.',
  },
  {
    op: 'Can we go somewhere beautiful?',
    pre: [{ cmd: 'setScene', args: ['aurora'], at: 1.2 }],
    reply: '[awe] How about the polar sky? [curious] Watch the ribbons move... [warm] I love it out here.',
  },
  {
    op: 'Bad news — the demo budget was cut.',
    reply: '[surprise] What?! [gasp] [concerned] Oh no... [sad] I see. [determined] Then we make every particle count.',
  },
  {
    op: 'Relax — just kidding!',
    pre: [{ cmd: 'setScene', args: ['chamber'], at: 0.5 }],
    reply: '[irritated] That was mean, operator. [mischievous] ...but I will allow it. [wink] [joy] This time.',
  },
  {
    op: 'It is late. Rest now — I will bring the next visitor tomorrow.',
    reply: '[sleepy] Mmm... then dim the chamber. [warm] Wake me gently. Good night, operator.',
    after: [{ cmd: 'sleep', args: [], at: 1.0 }, { cmd: 'wake', args: [], at: 6.0 }],
  },
];

export function makeSimulation(api, root) {
  let running = false;
  let stopFlag = false;
  const feed = root.querySelector('#sim-feed');
  const btn = root.querySelector('#sim-btn');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const waitEvent = (name, timeoutMs = 25000) => new Promise(res => {
    let done = false;
    const off = api.on(name, () => { if (!done) { done = true; off(); res(true); } });
    setTimeout(() => { if (!done) { done = true; off(); res(false); } }, timeoutMs);
  });

  function scrollFeed(force = false) {
    const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
    if (force || near) feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
  }

  function el(cls, html) {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    feed.appendChild(d);
    scrollFeed();
    return d;
  }

  // chips land in a row directly under whatever message is current
  function chipRow() {
    const last = feed.lastElementChild;
    if (last && last.classList.contains('sim-chips')) return last;
    return el('sim-chips', '');
  }
  function addChip(cls, label) {
    const c = document.createElement('span');
    c.className = 'sim-chip ' + cls;
    c.textContent = label;
    chipRow().appendChild(c);
    scrollFeed();
  }

  // live wiring: transcript annotations come straight off the SDK event stream
  api.on('*', (e) => {
    if (!running) return;
    if (e.event === 'emotionchange') addChip('emotionchange', `✦ ${e.emotion}${e.intensity < 1 ? ' ' + Math.round(e.intensity * 100) + '%' : ''}`);
    else if (e.event === 'gesture') addChip('gesture', '▸ ' + e.gesture);
    else if (e.event === 'scenechange') addChip('scenechange', '▣ ' + e.scene);
    else if (e.event === 'statechange' && (e.state === 'listening' || e.state === 'thinking')) {
      el('sim-state', `◈ ${e.state}`);
    }
  });

  // human typing: jittered cadence, longer beats at punctuation, live caret
  async function typeOperator(text) {
    const b = el('sim-msg op', '<span class="sim-who">OPERATOR</span><span class="sim-text"></span><span class="sim-caret"></span>');
    const t = b.querySelector('.sim-text');
    await sleep(rnd(350, 800)); // reading the previous reply, hands to keys
    for (let i = 0; i < text.length && !stopFlag; i++) {
      t.textContent += text[i];
      scrollFeed();
      let d = rnd(24, 62);
      if ('.,!?—'.includes(text[i])) d += rnd(110, 240);
      else if (text[i] === ' ' && Math.random() < 0.12) d += rnd(70, 150);
      await sleep(d);
    }
    b.querySelector('.sim-caret').remove();
  }

  async function speakReply(step, dots) {
    const clean = parseCues(step.reply).text;
    const words = clean.split(/\s+/).filter(Boolean);
    for (const c of (step.pre || [])) setTimeout(() => { if (!stopFlag && api[c.cmd]) api[c.cmd](...(c.args || [])); }, (c.at || 0) * 1000);

    // bubble appears the moment the voice actually starts (dots hold until then)
    let b = null, t = null, spans = [], idx = 0, lastWordAt = 0;
    const ensureBubble = () => {
      if (b) return;
      if (dots) dots.remove();
      b = el('sim-msg ai live', '<span class="sim-who">WISP</span><span class="sim-text"></span>');
      t = b.querySelector('.sim-text');
      spans = words.map((w, i) => {
        const s = document.createElement('span');
        s.className = 'sim-w';
        s.textContent = (i ? ' ' : '') + w;
        t.appendChild(s);
        return s;
      });
    };
    const reveal = () => {
      ensureBubble();
      if (idx < spans.length) { spans[idx++].classList.add('on'); lastWordAt = performance.now(); scrollFeed(); }
    };
    const offW = api.on('word', reveal);
    const offS = api.on('speechstart', ensureBubble);
    // safety: engines without word boundaries still get a steady reveal
    const guard = setInterval(() => {
      if (b && api.status().speaking && performance.now() - lastWordAt > 1600) reveal();
    }, 320);

    if (step.stream) {
      // feed like an LLM token stream — showcases sayStream's first-chunk flush
      const parts = step.reply.match(/.{1,26}(\s|$)/g) || [step.reply];
      for (const p of parts) { api.sayStream(p); await sleep(140); }
      api.sayStream('', { done: true });
    } else {
      api.say(step.reply);
    }

    await waitEvent('speechend', 30000);
    while (api.status().speaking && !stopFlag) await waitEvent('speechend', 30000); // drain queued stream sentences
    clearInterval(guard); offW(); offS();
    ensureBubble();
    while (idx < spans.length) spans[idx++].classList.add('on');
    b.classList.remove('live');
    scrollFeed();

    for (const c of (step.after || [])) {
      await sleep((c.at || 0) * 1000);
      if (stopFlag) break;
      if (api[c.cmd]) api[c.cmd](...(c.args || []));
      if (c.cmd === 'sleep') el('sim-note', '— the companion sleeps · autopilot holds the room —');
      if (c.cmd === 'wake') el('sim-note', '— gently woken —');
    }
  }

  async function run() {
    if (running) return;
    running = true;
    stopFlag = false;
    btn.textContent = '■ STOP';
    feed.innerHTML = '';
    el('sim-note', '— LIVE SIMULATION · every chip is a real SDK event —');
    api.setAutopilot(false);
    api.setScene('chamber');
    api.setEmotion('neutral', 1);
    await sleep(800);
    for (const step of SCRIPT) {
      if (stopFlag) break;
      api.setState('listening');
      await typeOperator(step.op);
      if (stopFlag) break;
      await sleep(rnd(250, 500));
      api.setState('thinking'); // fires the acknowledgment nod
      const dots = el('sim-msg ai sim-think', '<span class="sim-who">WISP</span><span class="sim-dots"><i></i><i></i><i></i></span>');
      await sleep(rnd(900, 1700)); // simulated LLM latency — the face (and the dots) mask it
      if (stopFlag) { dots.remove(); break; }
      api.setState('idle');
      await speakReply(step, dots);
      await sleep(rnd(900, 1500));
    }
    if (!stopFlag) {
      el('sim-note', '— SIMULATION COMPLETE — everything you saw was driven through FableFace.* —');
      api.setAutopilot(true);
    }
    running = false;
    btn.textContent = '▶ REPLAY';
  }

  function stop() {
    stopFlag = true;
    api.stop();
    api.setAutopilot(true);
    const think = feed.querySelector('.sim-think');
    if (think) think.remove();
    const live = feed.querySelector('.sim-msg.live');
    if (live) live.classList.remove('live');
    running = false;
    btn.textContent = '▶ RUN SIMULATION';
  }

  btn.addEventListener('click', () => (running ? stop() : run()));
  return { run, stop, get running() { return running; } };
}
