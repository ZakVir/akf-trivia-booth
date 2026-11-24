// Identity correction from appearance embeddings: swap colors back when two markers got mixed up, restore a returning person.
const fs = require('fs'), vm = require('vm');
const PALETTE = ['red','orange','gold','green','teal','blue','purple','pink'].map(id => ({ id }));
const ctx = { PALETTE, TEAM_ORDER: PALETTE.map(p => p.id), Math, Date, console, Float32Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../tracker.js', 'utf8') + '\nthis.Tracker = Tracker;', ctx);
let fails = 0; const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); fails++; } else console.log('ok: ' + m); };
const norm = v => { const n = Math.hypot(...v); return Float32Array.from(v.map(x => x / n)); };
const E = [norm([1, .1, 0, 0, .1, 0, 0, 0]), norm([0, 1, .1, 0, 0, .1, 0, 0]), norm([0, 0, 1, .1, 0, 0, .1, 0])];   // three distinct people
const jit = e => norm(Array.from(e).map(x => x + (Math.random() - .5) * 0.05));
const det = (x, k) => ({ x, y: 0.3, s: 0.09, score: 1, good: true, inside: true, insideExp: true });
const T = new ctx.Tracker(); let now = 1000;
for (let i = 0; i < 8; i++) { T.update([det(0.2), det(0.5), det(0.8)], now); now += 83; }
const at = x => T.tracks.reduce((b, t) => (!b || Math.abs(t.tx - x) < Math.abs(b.tx - x)) ? t : b, null);
const pass = () => [0.2, 0.5, 0.8].map((x, k) => ({ x, y: 0.3, s: 0.09, emb: jit(E[k]) }));
for (let i = 0; i < 4; i++) T.applyEmbeddings(pass(), now);                                  // learn who is who
const colors = [0.2, 0.5, 0.8].map(x => at(x).color);
// simulate a bad identity switch: markers at 0.2 and 0.5 exchange colors (and what they remember)
const a = at(0.2), b = at(0.5); [a.color, b.color] = [b.color, a.color]; [a.emb, b.emb] = [b.emb, a.emb];
for (let i = 0; i < 3; i++) T.applyEmbeddings(pass(), now);
ok([0.2, 0.5, 0.8].every((x, k) => at(x).color === colors[k]), 're-ID swaps two mixed-up markers back (' + (T.swaps || 0) + ' swap)');
// a person that was removed and comes back at a different place gets their old color
const gone = at(0.5); const goneColor = gone.color, goneEmb = Float32Array.from(gone.emb);
T.tracks = T.tracks.filter(t => t !== gone); T.lost.push({ color: goneColor, x: 0.5, y: 0.3, s: 0.09, app: null, emb: goneEmb, at: now });
for (let i = 0; i < 6; i++) { T.update([det(0.2), det(0.8), det(0.55)], now); now += 83; }                 // new marker appears with a fresh color
const nt = at(0.55); const fresh = nt.color;
const back = () => [{ x: 0.55, y: 0.3, s: 0.09, emb: jit(E[1]) }];
for (let i = 0; i < 4; i++) T.applyEmbeddings(back(), now);
ok(nt.color === goneColor || fresh === goneColor, 'returning person is recognised and gets their old color (' + nt.color + ' vs ' + goneColor + ')');
ok(new Set(T.tracks.map(t => t.color)).size === T.tracks.length, 'no two markers share a color');
process.exit(fails ? 1 : 0);
