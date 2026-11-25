// Accuracy harness: replays cached YOLO detections (from detect-clips.js) through the booth's real per-person logic
// (pose-logic.js) and tracker (tracker.js), the way the browser does (12 detections/s, drawing at 60/s), and scores it.
// Usage: node tests/eval/eval.js <cache.json> [more...]      env: OUT=<dir> writes per-frame markers for overlays,
//        LEGACY=<dir> scores an older version instead (dir with tracker.js + pose-legacy.js)
//
// "People" (ground-truth stand-in): confident, reasonably large detections, linked frame to frame by box overlap.
// Scores per clip:
//   coverage   share of (person, frame) pairs that have a marker (after the first 3 frames a person is seen)
//   switches   times a person's marker colour changed (identity swaps / re-spawns)          lower is better
//   merged     frames where two people were shown as one marker                              lower is better
//   ghosts     marker-frames with nobody under them for > 0.4 s                               lower is better
//   shake      how much the drawn marker's motion changes frame to frame (px, 60 fps, 1280 wide) lower is better
//   lag px     average distance marker -> person's head while they move (px, 1280 wide)       lower is better
//   raises     hand-raise events (colour @ time)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const LEG = process.env.LEGACY;

function load() {
  const PALETTE = ['red', 'orange', 'gold', 'green', 'teal', 'blue', 'purple', 'pink'].map(id => ({ id }));
  const ctx = { PALETTE, TEAM_ORDER: PALETTE.map(p => p.id), Math, Date, console, Float32Array, Set, Object, Array, Number };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(LEG ? path.join(LEG, 'tracker.js') : (process.env.TRACKER_FILE || path.join(ROOT, 'tracker.js')), 'utf8') + '\nthis.Tracker = Tracker;', ctx);
  let logic;
  const opt = { handSens: 'normal', sens: 'normal', inQuad: () => true };
  if (LEG) { global.pointInQuad = () => true; const L = require(path.join(LEG, 'pose-legacy.js'))({ handSens: 'normal', sens: 'normal', ignoreQuad: true }); logic = { toDet: p => L.toDet(p), clean: d => L.clean(d) }; }
  else { const P = require(path.join(ROOT, 'pose-logic.js')); logic = { toDet: p => P.toDet(p, opt), clean: d => P.clean(d, opt) }; }
  return { Tracker: ctx.Tracker, logic };
}
const iou = (a, b) => { const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)), i = ix * iy; const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i; return u > 0 ? i / u : 0; };

function evalClip(file) {
  const C = JSON.parse(fs.readFileSync(file, 'utf8')), { Tracker, logic } = load(), T = new Tracker();
  const PX = 1280 / 1, aspect = C.h / C.w, dt = 1000 / C.fps;
  const people = []; let chainN = 0, prev = [];
  const st = { jerk: 0, jerkN: 0, log: [], pf: 0, covered: 0, merged: 0, ghosts: 0, switches: 0, stillPath: 0, stillT: 0, lag: 0, lagN: 0, raises: [], tracksMax: 0 };
  const chainColor = {}, chainAge = {}, out = [];
  C.frames.forEach((F, fi) => {
    const now = 1000 + fi * dt;
    // real people this frame: confident and big enough (the stand-in for ground truth)
    const gt = F.people.filter(p => p.score >= 0.45 && (p.box.y1 - p.box.y0) > 0.18).map(p => ({ box: p.box }));
    // link to last frame's people by overlap
    const used = new Set();
    for (const g of gt) {
      let best = null, bi = 0.3;
      for (const q of prev) if (!used.has(q) && iou(g.box, q.box) > bi) { bi = iou(g.box, q.box); best = q; }
      if (best) { used.add(best); g.id = best.id; } else g.id = ++chainN;
      chainAge[g.id] = (chainAge[g.id] || 0) + 1;
    }
    prev = gt;
    // the booth's pipeline
    const raw = F.people.filter(p => p.score >= 0.35).map(p => logic.toDet({ box: p.box, score: p.score, kp: p.kp.map(([x, y, v]) => ({ x, y, v })) })).filter(Boolean);
    const dets = logic.clean(raw);
    T.update(dets, now);
    for (let k = 0; k < 5; k++) {
      T.step(1 / 60, now + (k + 1) * dt / 5);
      for (const t of T.tracks) {                                   // shake: frame-to-frame change of the drawn marker's velocity (jerk), px at 60 fps
        const p = [t.x * PX, t.y * PX * aspect];
        if (t.p1 && t.p2) { st.jerk += Math.hypot(p[0] - 2 * t.p1[0] + t.p2[0], p[1] - 2 * t.p1[1] + t.p2[1]); st.jerkN++; }
        t.p2 = t.p1; t.p1 = p;
      }
    }
    for (const e of T.drain()) st.raises.push(`${e.color}@${(e.at / 1000 - 1).toFixed(1)}s`);
    // which marker sits on each real person (marker's matched detection overlaps them most)
    const live = T.tracks.filter(t => now - t.born > 0);
    st.tracksMax = Math.max(st.tracksMax, live.length);
    const owner = new Map();
    for (const t of live) {
      if (!t.det || t.updAt !== now) { if (now - t.seen > 400) st.ghosts++; continue; }
      const b = t.det.box || t.det.bbox; let best = null, bi = 0.5;
      for (const g of gt) { const v = iou(b, g.box); if (v > bi) { bi = v; best = g; } }
      if (best) { if (!owner.has(best.id)) owner.set(best.id, t); }
    }
    for (const g of gt) {
      if (chainAge[g.id] <= 3) continue;
      st.pf++;
      const t = owner.get(g.id);
      if (t) {
        st.covered++;
        if (chainColor[g.id] && chainColor[g.id] !== t.color) { st.switches++; st.log.push(`switch @${F.t.toFixed(2)}s person ${g.id} ${chainColor[g.id]}->${t.color} x=${((g.box.x0 + g.box.x1) / 2).toFixed(2)}`); }
        chainColor[g.id] = t.color;
        // head of this person from their detection, to measure wobble and lag in pixels
        const d = t.det, hx = d.x, hy = d.y, mx = t.x, my = t.y;
        const pv = g.prevHead, moving = t.moving;
        if (t.prevM) {
          const step = Math.hypot((mx - t.prevM[0]) * PX, (my - t.prevM[1]) * PX * aspect);
          if (!moving) { st.stillPath += step; st.stillT += dt / 1000; }
          else { st.lag += Math.hypot((mx - hx) * PX, (my - hy) * PX * aspect); st.lagN++; }
        }
        t.prevM = [mx, my];
      } else {
        // missed: is it because it was folded into someone else's marker?
        if (live.some(t => t.det && t.updAt === now && iou(t.det.box || t.det.bbox, g.box) > 0.2)) { st.merged++; if (process.env.V) st.log.push(`merged @${F.t.toFixed(2)}s person ${g.id}`); }
      }
    }
    if (process.env.OUT) out.push({ t: F.t, markers: live.map(t => ({ c: t.color, x: +t.x.toFixed(4), y: +t.y.toFixed(4), s: +(t.rs || t.s).toFixed(4), r: !!t.raised, o: t.order || 0 })), gt: gt.map(g => g.box) });
  });
  if (process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, C.clip + '.markers.json'), JSON.stringify({ clip: C.clip, fps: C.fps, w: C.w, h: C.h, frames: out }));
  return {
    clip: C.clip, coverage: st.pf ? +(st.covered / st.pf * 100).toFixed(1) : 100, switches: st.switches, merged: st.merged, ghosts: st.ghosts,
    stillPx: st.jerkN ? +(st.jerk / st.jerkN).toFixed(2) : 0, log: st.log, lagPx: st.lagN ? +(st.lag / st.lagN).toFixed(1) : 0, maxMarkers: st.tracksMax, raises: st.raises.join(' ')
  };
}
if (require.main === module) {
const rows = process.argv.slice(2).map(evalClip);
console.log((LEG ? 'LEGACY ' : 'CURRENT ') + 'clip       cover%  switch  merged  ghosts   shake  lagpx  markers  raises');
for (const r of rows) { if (process.env.V) r.log.forEach(l => console.log('   ' + r.clip + ' ' + l)); }
for (const r of rows) console.log(`${r.clip.padEnd(18)} ${String(r.coverage).padStart(5)} ${String(r.switches).padStart(6)} ${String(r.merged).padStart(7)} ${String(r.ghosts).padStart(7)} ${String(r.stillPx).padStart(10)} ${String(r.lagPx).padStart(6)} ${String(r.maxMarkers).padStart(8)}  ${r.raises}`);
}
module.exports = { evalClip };
