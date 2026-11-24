/* Hands-up order + close-call detection + instant replay.
   - Every camera frame is recorded (at the camera's own speed, 60 fps if the camera gives it) as a small JPEG plus the
     marker positions at that moment. Only the last ~9 seconds are kept, in memory only, nothing is saved to disk.
   - Everyone who raises a hand gets the next number (1, 2, 3...). Two or more hands within 1.5 s = a close call:
     an instant replay plays by itself, in slow motion, with neighbouring frames blended so it stays smooth.
   - The host's Replay button (R) plays the last few seconds any time. */
const Buzz = (() => {
  const PREV = new URLSearchParams(location.search).has('preview');
  if (PREV) return { arm() {}, capture() {}, raise() {}, stats: () => ({ count: 0, fps: 0, sec: 0, enabled: false }) };

  const W = 1148, H = 646;                      // drawing space (the page scales it to full screen)
  const EW = 480, EH = 270;                     // recorded picture size
  const KEEP_MS = 9000, MAX_REPLAY_FRAMES = 260;
  const CONTEST_MS = 1500, QUIET_MS = 300, CLOSE_MS = 220, HOLD_MS = 250;   // HOLD_MS must match tracker.js
  const $ = id => document.getElementById(id);
  const post = m => CH.postMessage(m);
  const name = c => TEAMS[c].name.toUpperCase();
  const lerp = (a, b, k) => a + (b - a) * k;

  let enabled = true, ordering = true, armed = false, locked = false, lastQ = -1, lastRaisedAt = 0;
  let orderList = [], pend = [], pendTimer = null, lastClip = null, play = null;
  let lastRecAt = 0, lastRvfcAt = 0, rvfcGen = 0, replayToken = 0, building = false, clipTimer = null, lastSrc = null;
  const LEAD_MS = 900;                          // replay starts this long before the first hand began to rise
  const rcv = $('replay'), rg = rcv.getContext('2d');

  /* ---------------- state from the host ---------------- */
  function arm(S) {
    enabled = !(S.cam && S.cam.buzzer === false);
    if (S.qId !== lastQ) { lastQ = S.qId; unlock(); }
    ordering = S.step === 0;                  // numbers work while a question is up
    armed = enabled && ordering;              // winner banner + replay only in hands-up mode
    setHint(armed && !locked && !play);
  }
  function setHint(on) { $('buzzHint').style.display = on ? 'block' : 'none'; }
  function unlock() {
    locked = false; pend = []; clearTimeout(pendTimer); pendTimer = null; replayToken++; stop(); lastSrc = null;
    if (orderList.length) { orderList = []; post({ type: 'order', list: [] }); }
    try { Cam.tracker.tracks.forEach(t => { t.order = 0; }); } catch (e) {}
  }

  /* ---------------- recorder: every camera frame ---------------- */
  const rec = [];                               // {t, blob, tracks}
  let encPending = 0, recFps = 0;
  const enc = document.createElement('canvas'); enc.width = EW; enc.height = EH;
  const eg = enc.getContext('2d');
  const snapTracks = tr => tr.map(t => ({ x: t.x, y: t.y, s: t.rs || t.s, color: t.color, raised: !!t.raised, hand: t.hand, order: t.order || 0, morph: t.morph || 0 }));

  function record(t, video, tracks) {
    lastRecAt = performance.now();
    const e = { t, blob: null, tracks: snapTracks(tracks), vw: video ? video.videoWidth : 0, vh: video ? video.videoHeight : 0 };
    rec.push(e);
    const cutoff = t - KEEP_MS; while (rec.length && rec[0].t < cutoff) rec.shift();
    if (video && encPending < 4 && !play && !building) {   // shed load rather than fall behind; pause encoding while a replay runs
      try {
        const eh = Math.max(2, Math.round(EW * (e.vh || 9) / (e.vw || 16))); if (enc.height !== eh) enc.height = eh;
        eg.drawImage(video, 0, 0, EW, eh); encPending++;
        enc.toBlob(b => { encPending--; e.blob = b; }, 'image/jpeg', 0.72);
      } catch (err) {}
    }
    if (rec.length > 30) { const a = rec[rec.length - 30]; recFps = Math.round(29000 / Math.max(1, t - a.t)); }
  }
  function startRecorder() {
    const v = $('video');
    const hasRvfc = !!(v && v.requestVideoFrameCallback);
    const chain = () => {                       // fires once per real camera frame; a generation number stops duplicate chains
      const g = ++rvfcGen;
      const cb = () => {
        if (g !== rvfcGen) return;
        lastRvfcAt = performance.now();
        try { const sn = Cam.snapshot(); if (sn.video) record(performance.now(), sn.video, sn.tracks); } catch (e) {}
        v.requestVideoFrameCallback(cb);
      };
      v.requestVideoFrameCallback(cb);
    };
    if (hasRvfc) chain();
    setInterval(() => {                         // 60/s timer: practice mode (no picture), and a fallback if frame callbacks stop
      try {
        const sn = Cam.snapshot(), now = performance.now();
        if (sn.show && !sn.video) record(now, null, sn.tracks);
        else if (sn.video && (!hasRvfc || now - lastRvfcAt > 600)) {
          record(now, sn.video, sn.tracks);     // keep filming at timer speed meanwhile
          if (hasRvfc && now - lastRvfcAt > 1500) { lastRvfcAt = now; chain(); }   // e.g. the camera restarted: hook the frame callback up again
        }
      } catch (e) {}
    }, 16);
  }
  startRecorder();
  const stats = () => ({ count: rec.length, enabled, fps: recFps, sec: rec.length > 1 ? (rec[rec.length - 1].t - rec[0].t) / 1000 : 0 });
  const framesBetween = (t0, t1) => rec.filter(f => f.t >= t0 && f.t <= t1);
  function capture() {}                         // kept for older callers

  /* ---------------- hands up: order + close calls ---------------- */
  function syncOrders() { for (const t of Cam.tracker.tracks) { const o = orderList.find(x => x.color === t.color); t.order = o ? o.rank : 0; } }
  const orderMsg = () => post({ type: 'order', list: orderList.map(o => ({ color: o.color, rank: o.rank, ms: Math.max(0, Math.round(o.at - orderList[0].at)) })) });
  function raise(events) {
    if (!ordering) return;
    const evs = events.slice().sort((a, b) => a.at - b.at);
    let changed = false, joined = false;
    for (const e of evs) {                      // everyone who raises a hand gets the next number
      if (orderList.some(o => o.color === e.color)) continue;
      orderList.push({ color: e.color, rank: orderList.length + 1, at: e.at });
      changed = true;
      if (armed && !locked && !play && !pend.some(p => p.color === e.color)) { pend.push(e); joined = true; }
    }
    if (changed) {
      // numbers follow when hands ROSE, not when they were confirmed (once a winner is called, they keep number 1)
      if (!locked) orderList.sort((a, b) => a.at - b.at); else orderList = orderList.slice(0, 1).concat(orderList.slice(1).sort((a, b) => a.at - b.at));
      orderList.forEach((o, i) => { o.rank = i + 1; });
      syncOrders(); orderMsg();
    }
    if (joined && !locked && armed) {             // a hand that was already queued going up again does not delay the call
      clearTimeout(pendTimer);
      // two or more hands: go as soon as things go quiet. One hand: wait until 1.5 s after it ROSE (it was confirmed HOLD_MS + detection lag later)
      const delay = pend.length >= 2 ? QUIET_MS : Math.max(80, CONTEST_MS + HOLD_MS + 150 - (performance.now() - pend[0].at));
      pendTimer = setTimeout(resolve, delay);
    }
  }
  function swapColors(a, b) {                   // re-ID swapped two identities: move the hands-up order with them
    let ch = false;
    for (const o of orderList) { if (o.color === a) { o.color = b; ch = true; } else if (o.color === b) { o.color = a; ch = true; } }
    for (const p of pend) { if (p.color === a) p.color = b; else if (p.color === b) p.color = a; }
    if (ch) { syncOrders(); orderMsg(); }
  }
  function reopen() {                           // "wrong answer": the first hand is out, anyone still holding a hand up gets queued again
    const wrong = orderList[0] && orderList[0].color;
    const still = orderList.filter(o => o.color !== wrong && Cam.tracker.tracks.some(t => t.color === o.color && t.raised)).sort((a, b) => a.at - b.at);
    unlock();
    for (const o of still) { orderList.push({ color: o.color, rank: orderList.length + 1, at: o.at }); pend.push({ color: o.color, at: o.at, again: true }); }
    if (orderList.length) { syncOrders(); orderMsg(); }
    if (pend.length && armed) pendTimer = setTimeout(resolve, QUIET_MS); else if (armed) setHint(true);
  }
  function resolve() {
    pendTimer = null;
    if (!armed) { pend = []; return; }          // the answer was revealed in the meantime
    let list = pend.slice().sort((a, b) => a.at - b.at); pend = [];
    if (!list.length) return;
    list = list.filter(l => l.at - list[0].at <= CONTEST_MS);     // only hands within 1.5 s of the first are part of the close call
    locked = true;
    const first = list[0], margin = list[1] ? list[1].at - first.at : null;
    const info = { type: 'buzz', winner: first.color, list: list.map(l => ({ color: l.color, ms: Math.round(l.at - first.at) })), contested: list.length > 1, margin: margin == null ? null : Math.round(margin), tooClose: margin != null && margin < CLOSE_MS };
    post(info); setHint(false);
    if (info.contested) {                       // replay only for a real close call
      const last = list[list.length - 1], now = performance.now();
      // only footage that really shows these hands rising: never stale or substitute pictures (e.g. after 'wrong answer' re-queues old hands)
      const fresh = !list.every(l => l.again) && rec.length && rec[0].t <= first.at - 200;
      const frames = fresh ? framesBetween(first.at - LEAD_MS - 50, Math.min(now, last.at + 900)) : [];
      if (frames.length >= 2) { startReplay(frames, list, info); return; }
    }
    banner(first.color, info.contested ? 'first (no replay pictures yet)' : 'first hand up!');
    fx(first.color);
  }
  function fx(color) { if (window.buzzFx) buzzFx(color); }
  function banner(color, sub) {
    const b = $('buzzBanner');
    b.style.setProperty('--c', TEAMS[color].color);
    b.innerHTML = `<div class="big">🙋 ${name(color)}</div><div class="sm">${sub}</div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.remove('show'), 3200);
  }

  /* ---------------- instant replay ---------------- */
  function disposeClip(c) { if (!c) return; c.disposed = true; for (const f of c.frames) if (f.bmp && f.bmp.close) { try { f.bmp.close(); } catch (e) {} f.bmp = null; } }
  // Pictures are decoded IN ORDER, a few at a time, while the replay already plays (it starts once the first ones are ready).
  // At slow motion the decoder stays well ahead of the playhead, so the replay starts almost immediately.
  async function buildClip(frames, list, info, first, passes, manual) {
    let src = frames.some(f => f.blob) ? frames.filter(f => f.blob) : frames;       // practice mode has no pictures
    while (src.length > MAX_REPLAY_FRAMES) src = src.filter((f, i) => i % 2 === 0);  // keep memory in check
    const withSize = src.find(f => f.vw);
    const clip = { frames: src.map(f => ({ t: f.t, tracks: f.tracks, bmp: null, blob: f.blob })), list, info, first, passes, manual: !!manual, vw: withSize ? withSize.vw : 16, vh: withSize ? withSize.vh : 9 };
    let next = 0, readyN = 0, wake = null;
    const worker = async () => {
      while (next < clip.frames.length && !clip.disposed) {
        const f = clip.frames[next++];
        if (f.blob) { try { const b = await createImageBitmap(f.blob); if (clip.disposed) b.close(); else f.bmp = b; } catch (e) {} }
        readyN++; if (wake && readyN >= Math.min(8, clip.frames.length)) { wake(); wake = null; }
      }
    };
    const head = new Promise(r => { wake = r; });
    for (let i = 0; i < 3; i++) worker();
    if (!clip.frames.length) wake();
    await Promise.race([head, new Promise(r => setTimeout(r, 400))]);     // first frames ready (or 0.4 s at most)
    return clip;
  }
  async function startReplay(frames, list, info) {
    const first = list[0].at, span = list[list.length - 1].at - first;
    const start = frames[0].t - first, end = frames[frames.length - 1].t - first;
    const passes = [
      { from: Math.max(start, -LEAD_MS), to: Math.min(span + 700, Math.max(end, 300)), speed: 0.5 },
      { from: Math.max(start, -400), to: Math.min(span + 400, Math.max(end, 300)), speed: span > 800 ? 0.3 : 0.25 }
    ];
    const my = ++replayToken; building = true;
    if (!play) { disposeClip(lastClip); lastClip = null; }          // free the old pictures before decoding new ones
    lastSrc = { frames, list, info, first, passes, manual: false };   // kept so 'Replay again' works any time later
    let clip; try { clip = await buildClip(frames, list, info, first, passes, false); } finally { building = false; }
    if (my !== replayToken) { disposeClip(clip); return; }          // the host moved on while pictures were being prepared
    disposeClip(lastClip); lastClip = clip;
    runClip();
  }
  async function replayAgain() {
    if (lastClip && !lastClip.disposed) { runClip(); return; }
    if (!lastSrc || building) return;                                 // the decoded pictures were freed: decode them again
    const s = lastSrc, my = ++replayToken; building = true;
    let clip; try { clip = await buildClip(s.frames, s.list, s.info, s.first, s.passes, s.manual); } finally { building = false; }
    if (my !== replayToken) { disposeClip(clip); return; }
    lastClip = clip; runClip();
  }
  async function replayLast() {                 // host pressed Replay: the last few seconds, no matter what
    if (building) return;
    const now = performance.now();
    if (rec.length < 2 || now - rec[rec.length - 1].t > 10000) return;      // nothing recent (never replay stale footage)
    let frames = framesBetween(now - 4500, now);
    if (frames.length < 2) return;
    const my = ++replayToken; building = true;
    if (!play) { disposeClip(lastClip); lastClip = null; }
    const list = orderList.map(o => ({ color: o.color, at: o.at })), info = { winner: orderList[0] ? orderList[0].color : null }, passes = [{ from: frames[0].t - now, to: 0, speed: 0.55 }];
    lastSrc = { frames, list, info, first: now, passes, manual: true };
    let clip; try { clip = await buildClip(frames, list, info, now, passes, true); } finally { building = false; }
    if (my !== replayToken) { disposeClip(clip); return; }
    disposeClip(lastClip); lastClip = clip;
    runClip();
  }
  function runClip() {
    if (!lastClip) return;
    stop(); clearTimeout(clipTimer);
    post({ type: 'replay-play' });
    play = { clip: lastClip, pass: 0, startReal: performance.now(), t0: performance.now(), done: false, doneAt: 0 };
    document.body.classList.add('replaying');
    setHint(false);
    play.raf = requestAnimationFrame(tick);
  }
  function stop() {
    const was = !!play;
    if (play) { post({ type: 'replay-stop' }); cancelAnimationFrame(play.raf); play = null; }
    document.body.classList.remove('replaying');
    if (was) setHint(armed && !locked);                                 // bring the 'raise your hand' hint back after a manual replay
    rg.clearRect(0, 0, W, H);
    clearTimeout(clipTimer);                    // free the decoded pictures a few seconds after a replay (kept briefly for 'Replay again')
    clipTimer = setTimeout(() => { if (!play) { disposeClip(lastClip); lastClip = null; } }, 10000);
  }

  const cover = (vw, vh) => { vw = vw || 16; vh = vh || 9; const k = Math.max(W / vw, H / vh), dw = vw * k, dh = vh * k; return { ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh }; };   // same crop as the live view
  const mirror = () => { try { return !!Cam.cfg().mirror; } catch (e) { return true; } };
  function pill(x, y, w, h, r, fill) { rg.beginPath(); rg.moveTo(x + r, y); rg.arcTo(x + w, y, x + w, y + h, r); rg.arcTo(x + w, y + h, x, y + h, r); rg.arcTo(x, y + h, x, y, r); rg.arcTo(x, y, x + w, y, r); rg.closePath(); rg.fillStyle = fill; rg.fill(); }

  function tick(now) {
    if (!play) return;
    try {
      if (!play.done && now - play.t0 > 30000) { stop(); return; }   // hard cap on the slow-motion passes only (the 7 s verdict always finishes)
      const { clip } = play, PS = clip.passes;
      let pass = PS[Math.min(play.pass, PS.length - 1)], vt, frozen = false;
      if (!play.done) {
        vt = pass.from + (now - play.startReal) * pass.speed;           // continuous, real-time driven
        if (vt >= pass.to) {
          vt = pass.to; play.pass++;
          if (play.pass >= PS.length) { play.done = true; play.doneAt = now; } else play.startReal = now;
        }
      }
      if (play.done) { vt = 0; frozen = true; }
      draw(vt, pass, frozen, now);
      if (frozen && clip.manual && now - play.doneAt > 700) { stop(); return; }
      if (frozen && now - play.doneAt > 7000) {
        const w = clip.info.winner, tooClose = clip.info.tooClose; stop();
        if (w) { banner(w, tooClose ? 'first (host decides)' : 'first!'); fx(w); }
        return;
      }
      play.raf = requestAnimationFrame(tick);
    } catch (e) { console.error('[replay]', e); stop(); }              // a drawing bug must never leave the screen covered
  }

  function lerpTracks(A, B, a) {
    if (!B || a <= 0) return A;
    return A.map(ta => {
      const tb = B.find(x => x.color === ta.color); if (!tb) return ta;
      return { ...ta, x: lerp(ta.x, tb.x, a), y: lerp(ta.y, tb.y, a), s: lerp(ta.s, tb.s, a), morph: lerp(ta.morph, tb.morph, a),
        hand: (ta.hand && tb.hand) ? { x: lerp(ta.hand.x, tb.hand.x, a), y: lerp(ta.hand.y, tb.hand.y, a) } : (a > 0.5 ? tb.hand : ta.hand),
        raised: a > 0.5 ? tb.raised : ta.raised, order: a > 0.5 ? tb.order : ta.order };
    });
  }

  function draw(vt, pass, frozen, now) {
    const { clip } = play, mir = mirror(), F = clip.frames, first = clip.first, tNow = first + vt, m = cover(clip.vw, clip.vh);
    let lo = 0, hi = F.length - 1;                                    // last recorded frame at or before tNow
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (F[mid].t <= tNow) lo = mid; else hi = mid - 1; }
    const A = F[lo], B = F[lo + 1], a = B ? Math.min(1, Math.max(0, (tNow - A.t) / ((B.t - A.t) || 1))) : 0;
    let P = A; for (let i = lo; i >= 0 && !P.bmp; i--) if (F[i].bmp) P = F[i];          // picture still decoding: show the nearest earlier one

    rg.clearRect(0, 0, W, H);
    rg.save(); if (mir) { rg.translate(W, 0); rg.scale(-1, 1); }
    if (P.bmp) {
      rg.drawImage(P.bmp, m.ox, m.oy, m.dw, m.dh);
      if (P === A && B && B.bmp && a > 0.03) { rg.globalAlpha = a; rg.drawImage(B.bmp, m.ox, m.oy, m.dw, m.dh); rg.globalAlpha = 1; }   // blend neighbouring frames: smooth slow motion
    } else { rg.fillStyle = '#EEF6FA'; rg.fillRect(0, 0, W, H); }
    rg.restore();
    rg.fillStyle = 'rgba(20,30,70,.14)'; rg.fillRect(0, 0, W, H);
    const vg = rg.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(10,14,30,.55)'); rg.fillStyle = vg; rg.fillRect(0, 0, W, H);

    const sec = tNow / 1000;
    for (const tr of lerpTracks(A.tracks, B && B.tracks, a).slice().sort((p, q) => p.y - q.y)) {
      const px = m.ox + (mir ? 1 - tr.x : tr.x) * m.dw, py = m.oy + tr.y * m.dh, size = Math.max(74, Math.min(160, tr.s * W));
      Kites.draw(rg, Math.min(W - size * 0.6, Math.max(size * 0.6, px)), Math.max(size * 0.75, py - size * 0.95), size, TEAMS[tr.color].color, sec, TEAM_ORDER.indexOf(tr.color) * 1.3, tr.order || '', tr.morph || 0);
      if (tr.raised && tr.hand) {
        const hx = m.ox + (mir ? 1 - tr.hand.x : tr.hand.x) * m.dw, hy = m.oy + tr.hand.y * m.dh, pul = 1 + 0.18 * Math.sin(now / 120);
        rg.lineWidth = 7; rg.strokeStyle = TEAMS[tr.color].color; rg.beginPath(); rg.arc(hx, hy, 34 * pul, 0, 7); rg.stroke();
        rg.lineWidth = 3; rg.strokeStyle = '#fff'; rg.beginPath(); rg.arc(hx, hy, 42 * pul, 0, 7); rg.stroke();
      }
    }

    // who raised when: chips appear the moment each hand started to rise
    let row = 0; rg.textBaseline = 'middle';
    for (const c of clip.list) {
      const rel = c.at - first;
      if (!frozen && rel > vt) continue;
      const y = H - 110 - row * 52; row++;
      pill(28, y, 300, 44, 22, 'rgba(255,255,255,.94)');
      rg.fillStyle = TEAMS[c.color].color; rg.beginPath(); rg.arc(54, y + 22, 14, 0, 7); rg.fill();
      rg.fillStyle = '#2A2D3A'; rg.font = '700 24px "Fredoka","Arial Rounded MT Bold",ui-rounded,sans-serif'; rg.textAlign = 'left';
      rg.fillText(`${clip.list.indexOf(c) + 1}  ${name(c.color)}`, 80, y + 23);
      rg.textAlign = 'right'; rg.fillStyle = clip.list.indexOf(c) === 0 ? '#1B7A44' : '#B42318';
      rg.fillText(clip.list.indexOf(c) === 0 ? 'FIRST' : `+${((c.at - clip.list[0].at) / 1000).toFixed(2)} s`, 316, y + 23);
    }

    const blink = Math.floor(now / 450) % 2 === 0, PS = clip.passes;
    pill(24, 22, frozen ? 250 : 520, 52, 26, '#E5484D');
    rg.fillStyle = blink ? '#fff' : 'rgba(255,255,255,.35)'; rg.beginPath(); rg.arc(54, 48, 9, 0, 7); rg.fill();
    rg.fillStyle = '#fff'; rg.font = '700 30px "Fredoka","Arial Rounded MT Bold",ui-rounded,sans-serif'; rg.textAlign = 'left';
    rg.fillText(frozen ? 'FINAL CALL' : `INSTANT REPLAY   ${Math.min(play.pass + 1, PS.length)}/${PS.length}   ${pass.speed}x`, 76, 49);

    if (!frozen) {                                                    // timeline: moves smoothly with the video
      const x0 = 40, x1 = W - 40, y = H - 30, f = (vt - pass.from) / ((pass.to - pass.from) || 1);
      pill(x0, y - 5, x1 - x0, 10, 5, 'rgba(255,255,255,.35)'); pill(x0, y - 5, Math.max(10, (x1 - x0) * Math.min(1, Math.max(0, f))), 10, 5, '#fff');
      for (const c of clip.list) { const rel = c.at - first, ff = (rel - pass.from) / ((pass.to - pass.from) || 1); if (ff >= 0 && ff <= 1) { rg.fillStyle = TEAMS[c.color].color; rg.beginPath(); rg.arc(x0 + (x1 - x0) * ff, y, 11, 0, 7); rg.fill(); rg.lineWidth = 3; rg.strokeStyle = '#fff'; rg.stroke(); } }
    } else if (!clip.manual) {                                        // verdict
      const w = clip.list[0], info = clip.info;
      pill(W / 2 - 360, H / 2 - 120, 720, 240, 40, 'rgba(255,255,255,.95)');
      rg.textAlign = 'center'; rg.fillStyle = TEAMS[w.color].color; rg.font = '700 96px "Lilita One","Fredoka","Arial Rounded MT Bold",sans-serif';
      rg.fillText(`${name(w.color)} FIRST!`, W / 2, H / 2 - 28);
      rg.fillStyle = '#2A2D3A'; rg.font = '700 36px "Fredoka","Arial Rounded MT Bold",ui-rounded,sans-serif';
      rg.fillText(!info.contested ? 'first hand up' : info.tooClose ? 'Too close to call: host decides' : `by about ${(info.margin / 1000).toFixed(2)} s`, W / 2, H / 2 + 52);
    }
  }

  // without hands-up mode, numbers fade back to diamonds once every hand has been down for a few seconds
  setInterval(() => {
    try {
      const now = performance.now();
      if (Cam.tracker.tracks.some(t => t.raised)) lastRaisedAt = now;
      for (const t of Cam.tracker.tracks) { const o = orderList.find(x => x.color === t.color); t.order = o ? o.rank : 0; }   // a number follows the color, whoever wears it
      if (!enabled && orderList.length && now - lastRaisedAt > 3000) { orderList = []; post({ type: 'order', list: [] }); Cam.tracker.tracks.forEach(t => { t.order = 0; }); }
    } catch (e) {}
  }, 500);

  /* ---------------- commands from the host ---------------- */
  CH.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'buzz-reopen') { reopen(); $('buzzBanner').classList.remove('show'); }
    else if (m.type === 'buzz-clear') { unlock(); $('buzzBanner').classList.remove('show'); setHint(armed); }   // point given / new group: fresh hands-up round
    else if (m.type === 'replay-again') replayAgain();
    else if (m.type === 'replay-last') replayLast();
    else if (m.type === 'replay-skip') { replayToken++; stop(); }
    else if (m.type === 'sim-raise') {          // test button: pretend these players raised a hand, gaps in ms
      const tr = Cam.tracker.tracks;
      (m.colors || []).forEach((color, i) => {
        setTimeout(() => {
          const t = tr.find(x => x.color === color); if (!t) return;
          t.raised = true; t.force = performance.now() + 2800; t.hand = { x: t.x + 0.04, y: t.y - 0.03 };
          raise([{ color, at: performance.now(), hand: t.hand }]);
        }, (m.gaps && m.gaps[i]) || 0);
      });
    }
  });

  return { arm, capture, raise, stats, swapColors };
})();
window.Buzz = Buzz;
