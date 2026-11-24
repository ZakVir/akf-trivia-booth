// Raise intent: held raise = event at the moment the wrist crossed the line; a quick up-and-down = false start, no event.
const fs = require('fs'), vm = require('vm');
const PALETTE = ['red','orange','gold','green','teal','blue','purple','pink'].map(id => ({ id }));
const ctx = { PALETTE, TEAM_ORDER: PALETTE.map(p => p.id), Math, Date, console, Float32Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../tracker.js', 'utf8') + '\nthis.Tracker = Tracker;', ctx);
const LINE = 0.40;
const person = (x, wy) => ({ x, y: 0.3, s: 0.1, score: 1, good: true, inside: true, insideExp: true, wy, line: LINE, raised: wy < LINE, hx: x, hy: wy });
let fails = 0; const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); fails++; } else console.log('ok: ' + m); };
const settle = T => { let now = 1000; for (let i = 0; i < 5; i++) { T.update([person(0.3, 0.7), person(0.7, 0.7)], now); now += 83; } return now; };

// 1) up for two detections (166 ms), then down again: false start
{
  const T = new ctx.Tracker(); let now = settle(T);
  for (const wy of [0.3, 0.3, 0.7, 0.7, 0.7]) { T.update([person(0.3, wy), person(0.7, 0.7)], now); now += 83; }
  ok(T.drain().length === 0, 'quick up-and-down gives no raise event');
  ok(T.tracks.some(t => t.falseStarts === 1), 'it is counted as a false start');
}
// 2) held up: one event, timestamped at the line crossing (between the last low and first high detection)
{
  const T = new ctx.Tracker(); let now = settle(T); const before = now - 83;
  for (const wy of [0.2, 0.2, 0.2, 0.2, 0.2]) { T.update([person(0.3, wy), person(0.7, 0.7)], now); now += 83; }
  const ev = T.drain();
  ok(ev.length === 1, 'held raise gives exactly one event');
  ok(ev[0] && ev[0].at > before && ev[0].at < before + 83, 'event time is interpolated inside the detection gap (' + (ev[0] && Math.round(ev[0].at - before)) + ' ms after the last low sample)');
}
// 3) two people cross the line in the same detection interval, B a little earlier than A: order must be B then A
{
  const T = new ctx.Tracker(); let now = settle(T); const t0 = now;
  // previous samples: both low (0.7). Now A ends at 0.35 (just over the line), B ends at 0.05 (far over): B was moving faster/earlier
  for (let i = 0; i < 6; i++) { T.update([person(0.3, i === 0 ? 0.35 : 0.2), person(0.7, i === 0 ? 0.05 : 0.2)], now); now += 83; }
  const ev = T.drain().sort((a, b) => a.at - b.at);
  ok(ev.length === 2, 'both raises are reported');
  ok(ev[0].color !== ev[1].color && ev[0].at < ev[1].at, 'they are ordered by crossing time, finer than one detection (' + Math.round(ev[1].at - ev[0].at) + ' ms apart)');
  const first = T.tracks.find(t => t.color === ev[0].color);
  ok(first && first.tx > 0.5, 'the faster hand (right person) is first');
}
process.exit(fails ? 1 : 0);
