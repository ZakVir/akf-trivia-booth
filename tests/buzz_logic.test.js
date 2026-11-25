// Runs the real buzz.js (hands-up order, close-call window, replay trigger) in Node against a stand-in page.
const fs = require('fs'), vm = require('vm');
const sent = [], handlers = [];
const CHs = { postMessage: m => sent.push(m), addEventListener: (t, h) => handlers.push(h) };
const proxyCtx = new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? {} : proxyCtx), set: () => true, apply: () => proxyCtx });
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, innerHTML: '', getContext: () => proxyCtx, offsetWidth: 0, width: 0, height: 0 });
const els = {}; const bodyClasses = new Set();
const document = { getElementById: id => els[id] || (els[id] = el()), body: { classList: { add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c), contains: c => bodyClasses.has(c) } }, createElement: () => el() };
const PALETTE = ['red','orange','gold','green','teal','blue','purple','pink'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), color: '#888' }));
const ctx = { document, CH: CHs, location: { search: '' }, URLSearchParams, performance, setTimeout, clearTimeout, setInterval, clearInterval, console, Math, Date, Promise,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16), cancelAnimationFrame: clearTimeout, createImageBitmap: async () => ({ close() {} }),
  PALETTE, TEAM_ORDER: PALETTE.map(p => p.id), TEAMS: Object.fromEntries(PALETTE.map(p => [p.id, p])), Kites: { draw() {} }, window: {}, Float32Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../tracker.js', 'utf8') + '\nthis.Tracker = Tracker;', ctx);
const tracker = new ctx.Tracker();
ctx.Cam = { tracker, snapshot: () => ({ show: true, video: null, tracks: tracker.tracks }), cfg: () => ({ mirror: true }) };
vm.runInContext(fs.readFileSync(__dirname + '/../buzz.js', 'utf8') + '\nthis.Buzz = Buzz;', ctx);
const Buzz = ctx.Buzz;
const emit = m => handlers.forEach(h => h({ data: m }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); fails++; } else console.log('ok: ' + m); };
const types = t => sent.filter(m => m.type === t);
const clear = () => sent.length = 0;
const det = x => ({ x, y: 0.3, s: 0.09, score: 1, good: true, inside: true, insideExp: true });
let now0 = performance.now();
for (let i = 0; i < 6; i++) tracker.update([det(0.2), det(0.5), det(0.8)], now0 + i * 80);
const cols = tracker.tracks.slice().sort((a, b) => a.tx - b.tx).map(t => t.color);   // left, middle, right person
const arm = (q = 0, step = 0, buzzer = true) => Buzz.arm({ qId: q, step, cam: { buzzer } });

(async () => {
  arm(); await sleep(700);                                   // let the recorder fill a little (practice-style, no pictures)

  // 1) one hand: number + buzz message after the 1.5 s window, no replay
  clear(); Buzz.raise([{ color: cols[0], at: performance.now() - 100 }]);
  await sleep(2100);
  ok(types('buzz').length === 1 && !types('buzz')[0].contested, 'one hand: single buzz, not contested');
  ok(types('replay-play').length === 0, 'one hand: no replay');

  // 2) two hands 800 ms apart: contested, replay starts by itself
  emit({ type: 'buzz-reopen' }); await sleep(200); clear();
  const t0 = performance.now();
  Buzz.raise([{ color: cols[0], at: t0 - 300 }]); await sleep(300); Buzz.raise([{ color: cols[1], at: t0 + 500 }]);
  await sleep(900);
  ok(types('buzz').length === 1 && types('buzz')[0].contested && types('buzz')[0].list.length === 2, 'two hands 0.8 s apart: contested with both listed');
  ok(types('replay-play').length === 1, 'contested call starts a replay');
  emit({ type: 'replay-skip' }); await sleep(100);

  // 3) a second hand that ROSE 1.3 s after the first still counts (it is confirmed late, after HOLD + detection lag)
  emit({ type: 'buzz-reopen' }); await sleep(200); clear();
  const t1 = performance.now();
  Buzz.raise([{ color: cols[0], at: t1 - 400 }]); await sleep(1400); Buzz.raise([{ color: cols[2], at: t1 + 900 }]);   // rose 1.3 s after the first, confirmed 1.8 s after
  await sleep(1100);
  ok(types('buzz').length >= 1 && types('buzz')[0].contested, 'second hand 1.3 s after the first is inside the window');
  emit({ type: 'replay-skip' }); await sleep(100);

  // 4) order follows when hands ROSE, not when they were confirmed; no negative times
  emit({ type: 'buzz-reopen' }); await sleep(200); clear();
  const t2 = performance.now();
  Buzz.raise([{ color: cols[1], at: t2 + 200 }]); Buzz.raise([{ color: cols[2], at: t2 - 50 }]);       // confirmed in the wrong order
  const ord = types('order').pop();
  ok(ord && ord.list[0].color === cols[2] && ord.list[0].rank === 1 && ord.list.every(o => o.ms >= 0), 'earlier-rising hand is number 1, times never negative');
  await sleep(500); emit({ type: 'replay-skip' });

  // 5) wrong answer: others still holding a hand up are queued again
  emit({ type: 'buzz-reopen' }); await sleep(200); clear();
  const t3 = performance.now();
  tracker.tracks.forEach(t => { t.raised = true; });
  Buzz.raise([{ color: cols[0], at: t3 - 600 }, { color: cols[1], at: t3 - 300 }, { color: cols[2], at: t3 - 100 }]);
  await sleep(1000); emit({ type: 'replay-skip' }); clear();
  emit({ type: 'buzz-reopen' }); await sleep(100);
  const after = types('order').pop();
  ok(after && after.list.length === 2 && !after.list.some(o => o.color === cols[0]), 'reopen drops the wrong first hand and keeps the two still holding hands up');
  await sleep(900); emit({ type: 'replay-skip' });

  // 6) a re-ID identity swap moves the hands-up order with it
  arm(7); await sleep(200); clear();               // a new question starts with an empty order
  tracker.tracks.forEach(t => { t.raised = false; });
  Buzz.raise([{ color: cols[0], at: performance.now() }]);
  Buzz.swapColors(cols[0], cols[1]);
  const sw = types('order').pop();
  ok(sw && sw.list[0].color === cols[1], 'swapping two identities moves the order entry too');
  await sleep(2000); emit({ type: 'replay-skip' });

  // 6b) someone who left and came back gets their colour back (one-way restore): their hands-up place goes with them
  arm(8); await sleep(200); clear();
  Buzz.raise([{ color: 'pink', at: performance.now() }]);        // raised while wearing a temporary colour
  Buzz.swapColors('pink', 'purple', 'restore');
  let ro = types('order').pop();
  ok(ro && ro.list.length === 1 && ro.list[0].color === 'purple', 'restore: a raise made under the temporary colour moves to the restored colour');
  arm(9); await sleep(200); clear();
  Buzz.raise([{ color: 'red', at: performance.now() - 500 }]); Buzz.raise([{ color: 'pink', at: performance.now() }]);
  Buzz.swapColors('pink', 'red', 'restore');
  ro = types('order').pop();
  ok(ro && ro.list.length === 1 && ro.list[0].color === 'red' && ro.list[0].rank === 1, 'restore: a returning player keeps their earlier number (no rank moved to an unused colour)');
  await sleep(2000); emit({ type: 'replay-skip' });

  // 7) Replay key never plays stale footage
  emit({ type: 'buzz-reopen' }); await sleep(100); clear();
  emit({ type: 'replay-last' }); await sleep(600);
  ok(types('replay-play').length === 1, 'Replay key plays the last seconds when footage is fresh');
  emit({ type: 'replay-skip' }); await sleep(100);
  // 8) hands-up mode off must not stop recording (Replay still works)
  arm(0, 0, false); await sleep(300); clear(); emit({ type: 'replay-last' }); await sleep(600);
  ok(types('replay-play').length === 1, 'Replay key works even with hands-up mode switched off');
  process.exit(fails ? 1 : 0);
})();
