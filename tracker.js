/* Keeps a stable color on each person while they stay in the play square.
   Input each detection round: dets = [{x, y, s, inside, insideExp}] in normalized camera coords. */
function iouBox(a, b) {                       // boxes {x0,y0,x1,y1}
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)), i = ix * iy;
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
}
function appDist(a, b) {                       // clothing-colour histograms: 0 = identical, 1 = completely different
  let bc = 0; for (let i = 0; i < a.length; i++) bc += Math.sqrt(a[i] * b[i]);
  return Math.sqrt(Math.max(0, 1 - bc));
}

/* One-Euro filter: very steady when the person is still, quick when they really move. Units: normalised picture coordinates. */
const HOLD_MS = 250;
const EURO_MIN = 0.6, EURO_BETA = 5, EURO_D = 1.0;
const _alpha = (cut, dt) => { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); };
function oneEuro(st, x, dt) {
  if (st.x === undefined) { st.x = x; st.dx = 0; return x; }
  const dx = (x - st.x) / dt;
  st.dx += _alpha(EURO_D, dt) * (dx - st.dx);
  const cut = EURO_MIN + EURO_BETA * Math.abs(st.dx);
  st.x += _alpha(cut, dt) * (x - st.x);
  return st.x;
}

class Tracker {
  constructor() { this.tracks = []; this.cands = []; this.cool = {}; this.events = []; this.lost = []; this.close = {}; this.nid = 0; }
  drain() { const e = this.events; this.events = []; return e; }
  drainSwaps() { const q = this.swapQ || []; this.swapQ = []; return q; }       // [colorA, colorB] pairs whose identities were exchanged

  freeColor(now) {
    const used = new Set(this.tracks.map(t => t.color));
    const free = PALETTE.map(p => p.id).filter(id => !used.has(id));
    return free.find(id => now - (this.cool[id] || -1e9) > 4000) || free[0] || null;
  }

  update(dets, now) {
    const usedDet = new Set(), matched = new Set();
    const pairs = [];
    for (const t of this.tracks) {
      const dts = Math.min(0.6, (now - (t.updAt || now)) / 1000);
      const px = t.tx + (t.vx || 0) * dts, py = t.ty + (t.vy || 0) * dts;       // where we expect them now
      dets.forEach((d, i) => {
        const scale = 0.7 * Math.max(t.s, d.s) + 0.03;
        const nd = Math.hypot(d.x - px, d.y - py) / scale;                        // distance in "person sizes"
        const iou = (t.box && d.box) ? iouBox(t.box, d.box) : null;
        const ad = (t.app && d.app) ? appDist(t.app, d.app) : null;
        if (nd > 2.4 && !(iou > 0.3)) return;                                      // far away: not the same person
        if (ad != null && ad > 0.6 && nd > 0.6 && !(iou > 0.5)) return;            // clearly different clothes: not them
        pairs.push([nd * 0.5 + (iou == null ? 0 : (1 - iou) * 0.4) + (ad == null ? 0 : ad * 0.8), t, i]);
      });
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, t, i] of pairs) {
      if (matched.has(t) || usedDet.has(i)) continue;
      matched.add(t); usedDet.add(i);
      const d = dets[i], dtr = Math.max(0.05, (now - (t.updAt || now)) / 1000);
      const clamp = v => Math.max(-1.5, Math.min(1.5, v));
      const rx0 = t.rx === undefined ? t.tx : t.rx, ry0 = t.ry === undefined ? t.ty : t.ry;
      t.vx = 0.6 * (t.vx || 0) + 0.4 * clamp((d.x - rx0) / dtr); t.vy = 0.6 * (t.vy || 0) + 0.4 * clamp((d.y - ry0) / dtr);
      t.rx = d.x; t.ry = d.y;
      t.updAt = now; t.box = d.box || t.box;
      if (d.app) { if (!t.app) t.app = d.app.slice(); else for (let k = 0; k < t.app.length; k++) t.app[k] = 0.9 * t.app[k] + 0.1 * d.app[k]; }
      // steady marker: smooth the raw detection, then ignore movement smaller than ~12% of the person's width
      t.fx = t.fx || {}; t.fy = t.fy || {};
      const ox = oneEuro(t.fx, d.x, dtr), oy = oneEuro(t.fy, d.y, dtr);
      const speed = Math.hypot(t.fx.dx, t.fy.dx);                                    // how fast they are really moving (picture widths per second)
      t.moving = speed > 0.45 * t.s;                                                  // walking pace and up
      if (t.moving || Math.hypot(ox - t.tx, oy - t.ty) > 0.12 * t.s) { t.tx = ox; t.ty = oy; }   // moving: follow every update; resting: ignore jitter
      t.evx = t.moving ? t.fx.dx : 0; t.evy = t.moving ? t.fy.dx : 0;                 // used to glide the drawing between detections
      if (Math.abs(d.s - t.s) > 0.12 * t.s) t.s += (d.s - t.s) * 0.3;
      t.seen = now;
      if (d.insideExp) t.outSince = 0; else if (!t.outSince) t.outSince = now;
      this._gesture(t, d, now);
    }

    // new people must show up in the square a few rounds in a row before they get a kite.
    // A detection that sits inside an existing person's zone is that person (duplicate pose), never a new player.
    const newCands = [];
    dets.forEach((d, i) => {
      if (usedDet.has(i) || !d.inside || d.good === false) return;
      if (this.tracks.some(t => Math.hypot(d.x - t.tx, d.y - t.ty) < 0.5 * Math.max(d.s, t.s) + 0.02)) return;
      const c = this.cands.find(c => Math.hypot(c.x - d.x, c.y - d.y) < 0.08 + d.s);
      const hits = c ? c.hits + 1 : 1;
      if (hits >= 3 && this.tracks.length < PALETTE.length) {
        // someone who flickered out a moment ago gets their own color back
        const used = new Set(this.tracks.map(t => t.color));
        const L = this.lost.filter(l => !used.has(l.color) && (Math.hypot(l.x - d.x, l.y - d.y) < 0.14 + d.s || (l.app && d.app && appDist(l.app, d.app) < 0.3)))
          .sort((p, q) => (p.app && d.app ? appDist(p.app, d.app) : 1) - (q.app && d.app ? appDist(q.app, d.app) : 1))[0];
        const color = L ? L.color : this.freeColor(now);
        if (L) this.lost.splice(this.lost.indexOf(L), 1);
        if (color) { this.tracks.push({ id: ++this.nid, color, x: d.x, y: d.y, tx: d.x, ty: d.y, s: d.s, seen: now, born: now, outSince: 0, raised: false, rc: 0, low: 0, hand: null, force: 0, vx: 0, vy: 0, rx: d.x, ry: d.y, fx: { x: d.x, dx: 0 }, fy: { x: d.y, dx: 0 }, updAt: now, app: d.app ? d.app.slice() : null, box: d.box || null }); return; }
      }
      newCands.push({ x: d.x, y: d.y, hits });
    });
    this.cands = newCands;

    const keep = [];
    for (const t of this.tracks) {
      const gone = now - t.seen > 1800 || (t.outSince && now - t.outSince > 800);
      if (gone) { for (const k in this.close) if (k.split('-').includes(String(t.id))) delete this.close[k]; this.cool[t.color] = now; this.lost.push({ color: t.color, x: t.tx, y: t.ty, s: t.s, app: t.app, emb: t.emb, at: now }); } else keep.push(t);
    }
    this.tracks = keep;

    // two tracks sitting on the same spot for a while are one person: drop the newer one
    const dead = new Set();
    for (let i = 0; i < this.tracks.length; i++) for (let j = i + 1; j < this.tracks.length; j++) {
      const a = this.tracks[i], b = this.tracks[j], key = a.id + '-' + b.id;
      if (Math.hypot(a.tx - b.tx, a.ty - b.ty) < 0.5 * Math.max(a.s, b.s) + 0.02) {
        if (!this.close[key]) this.close[key] = now;
        else if (now - this.close[key] > 600) { dead.add(a.born > b.born ? a : b); delete this.close[key]; }
      } else delete this.close[key];
    }
    if (dead.size) this.tracks = this.tracks.filter(t => !dead.has(t));
    this.lost = this.lost.filter(l => now - l.at < 20000);
  }

  /* Raised hand = wrist above the shoulder line and HELD for HOLD_MS. A hand that goes up and drops again is a
     false start (no event). The event time is the moment the wrist crossed the line, interpolated between
     the two detections around it, so close calls between two people can be ordered finer than the detection rate. */
  _gesture(t, d, now) {
    if (t.force) { if (now < t.force) return; t.force = 0; t.raised = false; }
    const pwy = t.pwy, pline = t.pline, pT = t.pT;
    t.pwy = d.wy; t.pline = d.line; t.pT = now;
    const stillUp = t.raised && d.wy !== undefined && d.release !== undefined && d.wy < d.release;   // hand still above the (lower) release line
    if (d.raised || stillUp) {
      if (!t.rc) {
        let at = now;
        if (pwy !== undefined && d.wy !== undefined && pline !== undefined && pwy >= pline) {
          const s0 = pline - pwy, s1 = d.line - d.wy;                       // signed height above the line: before (<0) and now (>0)
          if (s1 > s0) at = pT + Math.min(1, Math.max(0, -s0 / (s1 - s0))) * (now - pT);
        }
        t.rcStart = at;
      }
      t.rc++; t.low = 0; if (d.raised) t.hand = { x: d.hx, y: d.hy };
      if (!t.raised && now - t.rcStart >= HOLD_MS) { t.raised = true; this.events.push({ color: t.color, at: t.rcStart, hand: t.hand }); }
    } else {
      if (t.rc && !t.raised) t.falseStarts = (t.falseStarts || 0) + 1;       // started to raise, changed their mind
      t.rc = 0;
      if (t.raised && ++t.low >= 3) { t.raised = false; t.low = 0; }
    }
  }

  /* Re-ID correction. items = [{x, y, s, emb}] (embeddings are L2-normalised). Each person's fingerprint is compared with the
     identity their marker carries. If it clearly belongs to ANOTHER marker (or to someone who left earlier) twice in a row,
     the identities are swapped back. Cheap enough to run a few times a second. */
  applyEmbeddings(items, now) {
    const dist = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return 1 - d; };
    const blend = (t, e) => { let n = 0; for (let i = 0; i < e.length; i++) { t.emb[i] = 0.9 * t.emb[i] + 0.1 * e[i]; n += t.emb[i] * t.emb[i]; } n = Math.sqrt(n) || 1; for (let i = 0; i < e.length; i++) t.emb[i] /= n; };
    const swapId = (a, b) => { const ca = a.color, cb = b.color; for (const k of ['color', 'emb', 'app']) { const x = a[k]; a[k] = b[k]; b[k] = x; } a.mis = b.mis = 0; this.swaps = (this.swaps || 0) + 1; (this.swapQ = this.swapQ || []).push([ca, cb]); };
    for (const it of items) {
      if (!it.emb) continue;
      let t = null, bd = 1e9;
      for (const c of this.tracks) { const d = Math.hypot(it.x - c.tx, it.y - c.ty); if (d < bd) { bd = d; t = c; } }
      if (!t || bd > 0.8 * Math.max(it.s, t.s) + 0.04) continue;
      if (!t.emb) { t.emb = Float32Array.from(it.emb); continue; }
      const same = dist(t.emb, it.emb);
      if (same <= 0.35) { blend(t, it.emb); t.mis = 0; continue; }
      let other = null, od = 1;
      for (const u of this.tracks) if (u !== t && u.emb) { const d = dist(u.emb, it.emb); if (d < od) { od = d; other = u; } }
      if (other && od < same - 0.15 && od < 0.4) {                       // this person looks like ANOTHER marker
        if (++t.mis >= 2) swapId(t, other);
        continue;
      }
      const used = new Set(this.tracks.map(c => c.color));
      const l = this.lost.filter(l => l.emb && !used.has(l.color) && dist(l.emb, it.emb) < 0.3 && now - l.at < 20000)[0];
      if (l && same > 0.5) {                                              // looks like someone who left earlier
        if (++t.mis >= 3) { this.cool[t.color] = now; t.color = l.color; t.emb = Float32Array.from(it.emb); t.mis = 0; this.lost.splice(this.lost.indexOf(l), 1); }
      } else t.mis = 0;
    }
  }

  step(dt, now) { // smooth motion for drawing, every screen frame
    const k = 1 - Math.exp(-dt / 0.085), ks = 1 - Math.exp(-dt / 0.18);
    for (const t of this.tracks) {
      const age = now && t.updAt ? Math.min(0.12, Math.max(0, (now - t.updAt) / 1000)) : 0;   // glide ahead for up to 120 ms while waiting for the next detection
      const gx = t.tx + (t.evx || 0) * age, gy = t.ty + (t.evy || 0) * age;
      t.x += (gx - t.x) * k; t.y += (gy - t.y) * k;
      t.rs = (t.rs === undefined ? t.s : t.rs) + (t.s - (t.rs === undefined ? t.s : t.rs)) * ks;   // size glides too
    }
  }


  colors() { return this.tracks.map(t => t.color).sort((a, b) => TEAM_ORDER.indexOf(a) - TEAM_ORDER.indexOf(b)); }
  clear() { this.tracks = []; this.cands = []; this.lost = []; this.close = {}; this.events = []; this.swapQ = []; }
}
