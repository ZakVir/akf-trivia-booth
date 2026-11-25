// Realistic crowd scenarios run straight through the tracker (no browser). Detections are simulated with noise,
// missed frames, duplicate ghost poses and occlusions, at 12 detections per second.
const fs = require('fs'), vm = require('vm');
const PALETTE = ['red','orange','gold','green','teal','blue','purple','pink'].map(id => ({ id }));
const ctx = { PALETTE, TEAM_ORDER: PALETTE.map(p => p.id), Math, Date, console, Float32Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../tracker.js', 'utf8') + '\nthis.Tracker = Tracker;', ctx);
let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const noise = a => (rnd() - 0.5) * 2 * a;
const DT = 83;
let fails = 0; const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); fails++; } else console.log('ok: ' + m); };
// each person has a clothing colour histogram so appearance matching can be exercised
const hist = bin => { const h = new Float32Array(64); h[bin % 64] = 0.7; h[(bin * 7 + 3) % 64] += 0.3; return h; };
const det = (x, y, id, o = {}) => ({ x, y, s: 0.09, score: 1, good: true, inside: true, insideExp: true, app: hist(id * 9 + 2), wy: 0.7, line: 0.4, release: 0.47, raised: false, ...o });
const colorAt = (T, x) => { const t = T.tracks.reduce((b, t) => (!b || Math.abs(t.tx - x) < Math.abs(b.tx - x)) ? t : b, null); return t && t.color; };

// ---- S1: seven people standing in a row, noisy detections, 8% missed frames, 6% ghost duplicates
{
  const T = new ctx.Tracker(); let now = 1000; const xs = [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82];
  let firstColors = null, switches = 0, maxTracks = 0;
  for (let i = 0; i < 900; i++) {                                   // 75 s
    const dets = [];
    xs.forEach((x, k) => {
      if (rnd() < 0.08) return;                                      // missed detection
      dets.push(det(x + noise(0.004), 0.3 + noise(0.004), k));
      if (rnd() < 0.06) dets.push(det(x + 0.02 + noise(0.01), 0.3 + noise(0.01), k, { s: 0.07 }));   // ghost pose next to the person
    });
    T.update(dets, now); now += DT;
    maxTracks = Math.max(maxTracks, T.tracks.length);
    if (i === 60) firstColors = xs.map(x => colorAt(T, x));
    if (i > 60) xs.forEach((x, k) => { if (colorAt(T, x) !== firstColors[k]) switches++; });
  }
  ok(T.tracks.length === 7, 'S1: exactly 7 markers for 7 people (' + T.tracks.length + ', never more than ' + maxTracks + ')');
  ok(new Set(firstColors).size === 7, 'S1: seven different colors');
  ok(switches === 0, 'S1: no color switched in 75 s (' + switches + ' switches)');
}

// ---- S2: a person leaves for 1.2 s (hidden), and another leaves for 6 s; both come back and keep their color
{
  const T = new ctx.Tracker(); let now = 1000; const xs = [0.2, 0.5, 0.8], colors = [];
  for (let i = 0; i < 200; i++) {
    const dets = [];
    xs.forEach((x, k) => {
      const t = i * DT;
      if (k === 1 && t > 3000 && t < 4200) return;                  // hidden 1.2 s
      if (k === 2 && t > 6000 && t < 12000) return;                 // gone 6 s
      dets.push(det(x + noise(0.003), 0.3 + noise(0.003), k));
    });
    T.update(dets, now); now += DT;
    if (i === 30) xs.forEach(x => colors.push(colorAt(T, x)));
  }
  ok(T.tracks.length === 3, 'S2: three markers after everyone is back (' + T.tracks.length + ')');
  ok(xs.every((x, k) => colorAt(T, x) === colors[k]), 'S2: both returning people got their own color back');
}

// ---- S3: two people shoulder to shoulder for 30 s must stay two markers
{
  const T = new ctx.Tracker(); let now = 1000;
  for (let i = 0; i < 360; i++) { T.update([det(0.45 + noise(0.004), 0.3 + noise(0.004), 1), det(0.45 + 0.085 + noise(0.004), 0.3 + noise(0.004), 2)], now); now += DT; }
  ok(T.tracks.length === 2, 'S3: shoulder-to-shoulder people stay two markers (' + T.tracks.length + ')');
}

// ---- S4: two people cross; the detector misses both for 3 frames right at the crossing
{
  const T = new ctx.Tracker(); let now = 1000, A0, ok4 = true;
  for (let i = 0; i <= 80; i++) {
    const f = i / 80, a = 0.2 + 0.6 * f, b = 0.8 - 0.6 * f, dets = [];
    if (!(i >= 39 && i <= 41)) dets.push(det(a + noise(0.003), 0.3, 1), det(b + noise(0.003), 0.3, 2));
    T.update(dets, now); now += DT;
    if (i === 10) A0 = colorAt(T, a);
  }
  ok(T.tracks.length === 2 && colorAt(T, 0.8) === A0, 'S4: crossing with a missed detection keeps colors (' + T.tracks.length + ' markers)');
}

// ---- S5: a hand hovering right at the raise line must not flap or create more than one order event
{
  const T = new ctx.Tracker(); let now = 1000; let events = 0;
  for (let i = 0; i < 400; i++) {
    const wy = i < 20 ? 0.7 : 0.4 + noise(0.012);                 // wrist climbs to the line, then hovers around it
    T.update([det(0.4, 0.3, 1, { wy, raised: wy < 0.4, held: wy < 0.47, hx: 0.42, hy: wy })], now); now += DT;   // held = still above the lower release bar
    events += T.drain().length;
  }
  ok(events <= 3, 'S5: hovering hand makes at most a few events, not dozens (' + events + ')');
}

// ---- S6: someone who stays outside the square for a while is dropped and gets a new color only if nobody matches
{
  const T = new ctx.Tracker(); let now = 1000;
  for (let i = 0; i < 100; i++) { T.update([det(0.3, 0.3, 1)], now); now += DT; }
  for (let i = 0; i < 40; i++) { T.update([det(0.3, 0.3, 1, { inside: false, insideExp: false })], now); now += DT; }
  ok(T.tracks.length === 0, 'S6: a person who walked out of the play area loses their marker (' + T.tracks.length + ')');
}
process.exit(fails ? 1 : 0);
