// A person standing still (detections shake by a few pixels) must keep a still marker; a person who walks must be followed.
const fs = require('fs'), vm = require('vm');
const PALETTE = ['red','orange','gold','green','teal','blue','purple','pink'].map(id => ({ id }));
const ctx = { PALETTE, TEAM_ORDER: PALETTE.map(p => p.id), Math, Date, console, Float32Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../tracker.js', 'utf8') + '\nthis.Tracker = Tracker;', ctx);
const DT = 83;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const W = 1920;                                                   // report movement in pixels of a 1920 wide picture
function run(label, pos, noise) {
  const T = new ctx.Tracker(); let now = 1000; const outs = [], raws = [];
  for (let i = 0; i < 180; i++) {                                 // 15 s at 12 detections per second
    const [x, y] = pos(i / 180), nx = x + rnd() * noise, ny = y + rnd() * noise;
    T.update([{ x: nx, y: ny, s: 0.1, score: 1, good: true, inside: true, insideExp: true }], now); now += 83;
    for (let k = 0; k < 5; k++) T.step(1 / 60, now - DT + (k + 1) * (DT / 5));                   // drawing runs faster than detection
    if (i > 20 && T.tracks[0]) { outs.push([T.tracks[0].x, T.tracks[0].y]); raws.push([nx, ny]); }
  }
  const path = a => a.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - a[i][0], p[1] - a[i][1]), 0) * W;
  console.log(`${label}: raw wiggle ${path(raws).toFixed(0)} px, marker wiggle ${path(outs).toFixed(0)} px`);
  return { raw: path(raws), out: path(outs), end: outs[outs.length - 1], rawEnd: raws[raws.length - 1] };
}
// Smoothness: a person drifting slowly (under walking pace) must move the marker every frame, not freeze then jump.
function stutter(speed) {
  const T = new ctx.Tracker(); let now = 1000, prev = null; const steps = [];
  for (let i = 0; i < 180; i++) {
    const x = 0.3 + speed * (i * 83 / 1000), nx = x + rnd() * 6 / W, ny = 0.3 + rnd() * 6 / W;
    T.update([{ x: nx, y: ny, s: 0.1, score: 1, good: true, inside: true, insideExp: true }], now); now += 83;
    for (let k = 0; k < 5; k++) { T.step(1 / 60, now - DT + (k + 1) * (DT / 5)); if (i > 40 && T.tracks[0]) { const x2 = T.tracks[0].x; if (prev !== null) steps.push(Math.abs(x2 - prev) * W); prev = x2; } }
  }
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length, frozen = steps.filter(v => v < mean * 0.25).length / steps.length, peak = Math.max(...steps) / mean;
  console.log(`drift ${speed}/s: mean step ${mean.toFixed(2)} px/frame, frozen frames ${(frozen * 100).toFixed(0)}%, peak/mean ${peak.toFixed(1)}`);
  return { frozen, peak };
}
const sm = [0.02, 0.04, 0.1].map(stutter);
const still = run('standing still (±6 px noise)', () => [0.5, 0.3], 12 / W);
const walk = run('walking across (±6 px noise)', f => [0.2 + 0.6 * f, 0.3], 12 / W);
const lag = Math.hypot(walk.end[0] - walk.rawEnd[0], walk.end[1] - walk.rawEnd[1]) * W;
let fail = false;
if (still.out > still.raw * 0.1) { console.error('FAIL: still person marker moves too much'); fail = true; }
if (lag > 90) { console.error('FAIL: walking marker lags by ' + lag.toFixed(0) + ' px'); fail = true; }
for (const m of sm) if (m.frozen > 0.1 || m.peak > 3) { console.error('FAIL: marker stutters (stop-and-go) on slow movement'); fail = true; }
console.log(`walking lag at the end: ${lag.toFixed(0)} px`);
if (fail) process.exit(1); console.log('tracker jitter test passed'); process.exit(0);
