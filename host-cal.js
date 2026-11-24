/* Camera settings + play-square calibration (drag corners, or pick the tape color and auto-detect). */
const Cal = (() => {
  const cv = $('cal'), ctx = cv.getContext('2d');
  const raw = document.createElement('canvas'); raw.width = 640; raw.height = 360;
  const rawCtx = raw.getContext('2d', { willReadFrequently: true });
  const img = new Image();
  let haveFrame = false, running = false, picking = false, drag = -1, mask = null, pending = false, devKey = '';

  img.onload = () => { rawCtx.drawImage(img, 0, 0, 640, 360); haveFrame = true; draw(); };
  const onFrame = m => { if (running) img.src = m.data; };
  function start() { running = true; CH.postMessage({ type: 'cam-snap', on: true }); CH.postMessage({ type: 'cam-list' }); draw(); }
  function stop() { if (running) { running = false; CH.postMessage({ type: 'cam-snap', on: false }); } }

  const mir = () => !!S.cam.mirror;
  const toDisp = ([x, y]) => [(mir() ? 1 - x : x) * 640, y * 360];

  function draw() {
    ctx.clearRect(0, 0, 640, 360);
    if (haveFrame && !S.cam.sim) {
      ctx.save(); if (mir()) { ctx.translate(640, 0); ctx.scale(-1, 1); } ctx.drawImage(raw, 0, 0); ctx.restore();
    } else {
      ctx.fillStyle = '#E9E3D2'; ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#5B5F70'; ctx.font = '700 20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(S.cam.sim ? 'Practice mode: no camera picture' : 'Turn the camera on to see the floor here', 320, 185);
    }
    if (mask && haveFrame) {
      ctx.save(); if (mir()) { ctx.translate(640, 0); ctx.scale(-1, 1); } ctx.globalAlpha = 0.55; ctx.imageSmoothingEnabled = false; ctx.drawImage(mask, 0, 0, 640, 360); ctx.restore();
    }
    const pts = S.cam.quad.map(toDisp);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.fillStyle = 'rgba(111,175,203,.18)'; ctx.fill();
    ctx.lineWidth = 3; ctx.setLineDash([10, 7]); ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#2A2D3A'; ctx.stroke();
    pts.forEach((p, i) => { ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 7); ctx.fillStyle = '#CBE6F2'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#2A2D3A'; ctx.stroke(); });
  }

  /* ---------- dragging ---------- */
  const evPt = e => { const r = cv.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width, dy = (e.clientY - r.top) / r.height; return { dx, dy, x: mir() ? 1 - dx : dx, y: dy }; };
  cv.addEventListener('pointerdown', e => {
    const p = evPt(e);
    if (picking) { pickColor(p); return; }
    let best = -1, bd = 0.06;
    S.cam.quad.forEach((q, i) => { const d = Math.hypot(((mir() ? 1 - q[0] : q[0]) - p.dx) * 16 / 9, q[1] - p.dy); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { drag = best; S.cam.quad = S.cam.quad.map(q => q.slice()); cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', e => {
    if (drag < 0) return;
    const p = evPt(e);
    S.cam.quad[drag] = [Math.min(1, Math.max(0, p.x)), Math.min(1, Math.max(0, p.y))];
    mask = null; draw();
    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; commit(); }); }
  });
  const endDrag = () => { if (drag >= 0) { drag = -1; commit(); } };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

  /* ---------- tape color + auto-detect ---------- */
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  function pickColor(p) {
    picking = false; $('calPick').textContent = 'Pick tape color';
    if (!haveFrame) return setHint('No camera picture yet.');
    const cx = Math.round(p.x * 640), cy = Math.round(p.y * 360);
    const d = rawCtx.getImageData(Math.max(0, cx - 4), Math.max(0, cy - 4), 9, 9).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    setCam({ tape: [Math.round(r / n), Math.round(g / n), Math.round(b / n)] });
    setHint('Got the tape color. Now press Auto-detect tape.');
  }
  function detectTape() {
    if (!haveFrame) return setHint('Turn the camera on first so there is a picture to look at.');
    if (!S.cam.tape) return setHint('Press “Pick tape color”, then click a piece of tape in the picture.');
    const W = 160, H = 90, sc = document.createElement('canvas'); sc.width = W; sc.height = H;
    const sx = sc.getContext('2d', { willReadFrequently: true }); sx.drawImage(raw, 0, 0, W, H);
    const px = sx.getImageData(0, 0, W, H).data, [h0, s0, v0] = rgb2hsv(...S.cam.tape), sens = +$('calSens').value / 100;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const [h, s, v] = rgb2hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      if (s0 < 0.22) m[i] = (s < 0.22 + sens * 0.1 && Math.abs(v - v0) < 0.1 + sens * 0.2) ? 1 : 0;
      else { const dh = Math.min(Math.abs(h - h0), 360 - Math.abs(h - h0)); m[i] = (dh < 8 + sens * 24 && s > s0 * (0.75 - sens * 0.3) && v > v0 * (0.75 - sens * 0.3)) ? 1 : 0; }
    }
    // keep the big pieces of tape, drop speckles
    const comp = new Int32Array(W * H), sizes = [];
    for (let i = 0; i < W * H; i++) {
      if (!m[i] || comp[i]) continue;
      const id = sizes.length + 1, st = [i]; comp[i] = id; let n = 0;
      while (st.length) {
        const c = st.pop(); n++; const x = c % W, y = (c / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx; if (m[k] && !comp[k]) { comp[k] = id; st.push(k); }
        }
      }
      sizes.push(n);
    }
    const big = Math.max(0, ...sizes);
    if (big < 12) { mask = null; draw(); return setHint('Could not find that tape. Try picking the color again, or raise Sensitivity.'); }
    const keep = sizes.map(n => n >= Math.max(8, big * 0.15));
    const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
    const mx = mc.getContext('2d'), out = mx.createImageData(W, H);
    let TL = null, TR = null, BR = null, BL = null, cnt = 0;
    for (let i = 0; i < W * H; i++) {
      if (!comp[i] || !keep[comp[i] - 1]) continue;
      const x = (i % W) / W, y = ((i / W) | 0) / H; cnt++;
      out.data[i * 4] = 236; out.data[i * 4 + 1] = 72; out.data[i * 4 + 2] = 153; out.data[i * 4 + 3] = 255;
      if (!TL || x + y < TL[0] + TL[1]) TL = [x, y];
      if (!BR || x + y > BR[0] + BR[1]) BR = [x, y];
      if (!TR || x - y > TR[0] - TR[1]) TR = [x, y];
      if (!BL || x - y < BL[0] - BL[1]) BL = [x, y];
    }
    mx.putImageData(out, 0, 0); mask = mc;
    if (cnt < 20 || !TL || !TR || !BR || !BL) { draw(); return setHint('Found too little tape. Try again.'); }
    S.cam.quad = [TL, TR, BR, BL]; commit(); draw();
    setHint(`Found the tape (pink). Corners moved onto it. Drag any corner to fine-tune. If it looks off, adjust Sensitivity and detect again.`);
  }

  const setHint = t => { $('calHint').textContent = t; };

  /* ---------- camera controls ---------- */
  $('calPick').onclick = () => { picking = !picking; $('calPick').textContent = picking ? 'Now click the tape…' : 'Pick tape color'; };
  $('calAuto').onclick = detectTape;
  $('calReset').onclick = () => { mask = null; setCam({ quad: DEFAULT_QUAD.map(p => p.slice()) }); draw(); };
  $('camOn').onclick = () => { if (!S.cam.on && !tvOpen()) openTv(); setCam({ on: !S.cam.on }); };
  $('camMac').onclick = () => {
    if (!tvOpen()) openTv();
    const d = (camStatus.devices || []).find(d => /facetime|built-in|macbook|isight/i.test(d.label));
    setCam({ on: true, sim: false, deviceId: d ? d.id : '', detect: true, kites: true, mirror: true, ignoreQuad: true, showQuad: false, preferBuiltIn: true });     // names only appear after the first Allow; press again then
    CH.postMessage({ type: 'cam-list' });
    setHint('Click Allow in the TV window (press Open TV window first if it is closed). If the iPhone camera is used, press this button again once the camera list fills in.');
  };
  $('camRefresh').onclick = () => CH.postMessage({ type: 'cam-list' });
  $('camDev').onchange = e => { const d = (camStatus.devices || []).find(x => x.id === e.target.value); setCam({ deviceId: e.target.value, deviceLabel: d ? d.label : '' }); };
  const bind = (id, key) => { $(id).onchange = e => setCam({ [key]: e.target.checked }); };
  bind('optDetect', 'detect'); bind('optKites', 'kites'); bind('optQuad', 'showQuad'); bind('optMirror', 'mirror'); bind('optGpu', 'gpu'); bind('optSim', 'sim'); bind('optIgnore', 'ignoreQuad'); bind('optSimDup', 'simDup'); $('optEngine').onchange = e => setCam({ engine: e.target.value }); $('optHand').onchange = e => setCam({ handSens: e.target.value }); $('optMode').onchange = e => setCam({ mode: e.target.value }); $('optSens').onchange = e => setCam({ sens: e.target.value }); bind('optDebug', 'debug');
  $('optHz').onchange = e => setCam({ detHz: +e.target.value });
  $('optSimN').onchange = e => setCam({ simN: +e.target.value });

  function sync() {
    $('camOn').textContent = S.cam.on ? 'Turn off' : 'Turn on';
    for (const [id, k] of [['optDetect', 'detect'], ['optKites', 'kites'], ['optQuad', 'showQuad'], ['optMirror', 'mirror'], ['optGpu', 'gpu'], ['optSim', 'sim'], ['optIgnore', 'ignoreQuad'], ['optDebug', 'debug'], ['optSimDup', 'simDup']]) $(id).checked = !!S.cam[k];
    $('optEngine').value = S.cam.engine || 'auto'; $('optHand').value = S.cam.handSens || 'normal'; $('optMode').value = S.cam.mode || 'fast'; $('optSens').value = S.cam.sens || 'normal';
    $('optHz').value = String(S.cam.detHz); $('optSimN').value = String(S.cam.simN);
    const devs = (camStatus.devices || []), key = devs.map(d => d.id + d.label).join('|') + '|' + S.cam.deviceId;
    if (key !== devKey) {
      devKey = key;
      const sorted = devs.slice().sort((a, b) => (a.rank ?? 3) - (b.rank ?? 3));
      $('camDev').innerHTML = `<option value="">Automatic (best real camera)</option>` + sorted.map(d => `<option value="${esc(d.id)}" ${d.id === S.cam.deviceId ? 'selected' : ''}>${esc(d.label)}${d.virtual ? ' (virtual camera)' : ''}</option>`).join('');
    }
    const sw = $('calSwatch');
    if (S.cam.tape) { sw.textContent = 'tape color'; sw.style.background = `rgb(${S.cam.tape.join(',')})`; sw.style.color = '#fff'; sw.style.textShadow = '0 0 3px #000'; }
    draw();
  }

  return { start, stop, onFrame, sync };
})();
window.Cal = Cal;
