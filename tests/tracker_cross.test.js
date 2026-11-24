// Two people walk past each other; each must keep the same color all the way through.
const fs = require('fs'), vm = require('vm');
const PALETTE = ['red','orange','gold','green','teal','blue','purple','pink'].map(id => ({ id }));
const ctx = { PALETTE, TEAM_ORDER: PALETTE.map(p => p.id), Math, Date, console, Float32Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../tracker.js', 'utf8') + '\nthis.Tracker = Tracker;', ctx);
const hist = (bin) => { const h = new Float32Array(64); h[bin] = 0.8; h[(bin + 5) % 64] = 0.2; return h; };
function run(useApp) {
  const T = new ctx.Tracker(); let now = 1000, swaps = 0, first = null;
  const det = (x, y, bin) => ({ x, y, s: 0.1, score: 1, good: true, inside: true, insideExp: true, app: useApp ? hist(bin) : null });
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const f = i / N;                                   // A: left -> right, B: right -> left, passing at f = 0.5 on the same line
    const dets = [det(0.2 + 0.6 * f, 0.3, 10), det(0.8 - 0.6 * f, 0.3, 40)];
    T.update(dets, now); now += 100;
    if (i === 6) first = T.tracks.map(t => ({ color: t.color, x: t.tx }));
  }
  const end = T.tracks.map(t => ({ color: t.color, x: t.tx }));
  const leftStart = first.find(t => t.x < 0.5).color, rightEnd = end.find(t => t.x > 0.5).color;
  return { tracks: T.tracks.length, aKeepsColor: leftStart === rightEnd };
}
const a = run(true), b = run(false);
console.log('with clothing colour:', JSON.stringify(a), ' without:', JSON.stringify(b));
if (a.tracks !== 2 || !a.aKeepsColor) { console.error('FAIL: colors swapped or extra tracks with clothing colour'); process.exit(1); }

// Harder: they meet in the middle, stand close together for a second, then each goes back where they came from.
function meet(useApp) {
  const T = new ctx.Tracker(); let now = 1000, A0 = null;
  const det = (x, bin) => ({ x, y: 0.3, s: 0.1, score: 1, good: true, inside: true, insideExp: true, app: useApp ? hist(bin) : null });
  const xs = [];
  for (let i = 0; i < 25; i++) xs.push([0.2 + 0.012 * i * 1.0, 0.8 - 0.012 * i]);            // approach to ~0.49 / 0.51
  for (let i = 0; i < 12; i++) xs.push([0.5 - 0.005 * (i % 2), 0.5 + 0.005 * (i % 2)]);      // jostle in the middle
  for (let i = 0; i < 25; i++) xs.push([0.49 - 0.012 * i, 0.51 + 0.012 * i]);               // each walks back
  xs.forEach(([a, b], i) => { T.update([det(a, 10), det(b, 40)], now); now += 100; if (i === 8) A0 = T.tracks.find(t => t.tx < 0.5).color; });
  const left = T.tracks.find(t => t.tx < 0.5);
  return { tracks: T.tracks.length, aKeepsColor: left && left.color === A0 };
}
const m1 = meet(true), m2 = meet(false);
console.log('meet & return, with clothing colour:', JSON.stringify(m1), ' without:', JSON.stringify(m2));
if (m1.tracks !== 2 || !m1.aKeepsColor) { console.error('FAIL: meet-and-return swapped colors'); process.exit(1); }
console.log('tracker crossing test passed'); process.exit(0);
