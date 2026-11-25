/* Camera, person detection, tracking and kites. Runs ONLY in the TV window (audience.html)
   so the laptop never processes video twice. Nothing is recorded or sent anywhere:
   frames stay in memory; the host window only gets small preview stills while calibrating. */
const Cam = (() => {
  const cv = document.getElementById('kites'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;            // drawing size = the kites canvas (same shape as the live-feed box on the stage)
  const KEEP_OUT = { x: W * 0.26, y: H * 0.21 };   // top-left corner of the feed covered by the mascot tab and the 'Live Feed' label (canvas units)
  const PREV = new URLSearchParams(location.search).has('preview');   // the little copy inside the host window never opens the camera
  const video = document.getElementById('video');
  const pvimg = document.getElementById('pvimg');
  let remoteItems = [], remoteFrameAt = 0, snapUntil = 0, lastKitePost = 0;
  const tracker = new Tracker();

  let cfg = { on: false, deviceId: '', detect: true, sim: false, simN: 5, mirror: true, showQuad: true, kites: true, gpu: false, detHz: 15, mode: 'fast', sens: 'normal', engine: 'auto', handSens: 'normal', simDup: false, quad: DEFAULT_QUAD };
  const badIds = new Set();
  let infer = false, detGen = 0, startSeq = 0, loadFailAt = 0, yoloFailedAt = 0, previewSeen = false, reid = null, reidFailed = false, reidBusy = false, lastEmb = 0, errN = 0, autoDevice = '', stream = null, phase = 'off', err = '', label = '', devices = [], retryT = null, fallbackTried = false;
  let det = { state: 'off', ms: 0, hz: 0, err: '' }, landmarker = null, yolo = null, yoloFailed = false, engineName = '', slowN = 0, loading = false, lastDetEnd = 0, detCount = 0, detT = performance.now();
  let people = { frame: 0, square: 0 }, lastLive = '', snapOn = false, snapT = 0, fps = 0, fpsN = 0, fpsT = performance.now();
  let sim = null, lastFrame = performance.now(), lastDets = [], preferTried = false;
  const snapCv = document.createElement('canvas'); snapCv.width = 640; snapCv.height = 360;

  const post = m => CH.postMessage(m);
  const showing = () => PREV ? (performance.now() - remoteFrameAt < 1500 || cfg.sim) : (phase === 'live' || cfg.sim);

  /* ---------- status ---------- */
  function report() {
    document.body.classList.toggle('cam-live', showing());
    if (PREV) return;
    post({
      type: 'cam-status', phase, err, label, devices, det: { ...det, ms: Math.round(det.ms) }, people, sim: cfg.sim, fps: Math.round(fps),
      vw: video.videoWidth || 0, vh: video.videoHeight || 0, buf: (window.Buzz && Buzz.stats) ? Buzz.stats().count : 0, recFps: (window.Buzz && Buzz.stats) ? Buzz.stats().fps : 0, recSec: (window.Buzz && Buzz.stats) ? Buzz.stats().sec : 0,
      screen: { x: screenX, y: screenY, w: screen.width, h: screen.height, fs: !!document.fullscreenElement, iw: innerWidth, ih: innerHeight }
    });
  }

  /* ---------- camera ---------- */
  async function refreshDevices() {
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && !isBlockedCam(d.label)).map(d => ({ id: d.deviceId, label: d.label || 'Camera', virtual: isVirtualCam(d.label), rank: camRank(d.label, cfg.preferBuiltIn !== false) })); } catch (e) { devices = []; }
    report();
  }
  function stopStream() {
    if (stream) stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
    stream = null; video.srcObject = null;
  }
  function scheduleRetry() { clearTimeout(retryT); if (cfg.on) retryT = setTimeout(start, 3000); }
  async function start() {
    if (PREV) return;
    const my = ++startSeq;
    clearTimeout(retryT); stopStream();
    if (!cfg.on) { phase = 'off'; report(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { phase = 'error'; err = 'This browser has no camera API (open over http://localhost, not a file).'; report(); return; }
    phase = 'asking'; err = ''; report();
    const c = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, max: 120 } }, audio: false };   // 720p: the booth never shows more, and every frame is cheaper to detect and record
    const want = autoDevice || cfg.deviceId;                                      // an automatic re-pick (e.g. saved camera found under a new id) wins over the stale saved id
    if (want && !fallbackTried) c.video.deviceId = { exact: want };
    let got;
    try { got = await navigator.mediaDevices.getUserMedia(c); }
    catch (e) {
      if (my !== startSeq) return;
      if ((e.name === 'OverconstrainedError' || e.name === 'NotFoundError') && want && c.video.deviceId) {
        if (want === autoDevice) { badIds.add(autoDevice); autoDevice = ''; return start(); }             // the camera we picked ourselves is gone (unplugged iPhone): choose again
        if (!fallbackTried) { fallbackTried = true; err = 'Chosen camera not found, using default.'; return start(); }
      }
      phase = e.name === 'NotAllowedError' ? 'noperm' : 'error'; err = (e.name || 'Error') + (e.message ? ': ' + e.message : '');
      report(); scheduleRetry(); return;
    }
    if (my !== startSeq) { got.getTracks().forEach(t => t.stop()); return; }          // a newer start() won: do not leak this camera stream
    const t0v = got.getVideoTracks()[0];
    if (t0v && isBlockedCam(t0v.label)) {                                              // the browser handed us a blocked camera (e.g. Sony Imaging Edge): refuse it
      got.getTracks().forEach(t => t.stop());
      await refreshDevices();                                                          // labels are readable now that permission was granted
      const alt = devices.filter(d => !badIds.has(d.id)).sort((a, b) => a.rank - b.rank)[0];
      if (alt && alt.id !== autoDevice) { autoDevice = alt.id; return start(); }
      phase = 'error'; err = 'The only camera found is blocked (' + t0v.label + '). Connect or enable another camera.'; report(); return;
    }
    stream = got; fallbackTried = false; badIds.clear();
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}
    if (my !== startSeq) return;
    const tr = stream.getVideoTracks()[0];
    label = tr ? tr.label : '';
    if (tr) tr.onended = () => { phase = 'lost'; err = 'Camera disconnected. Retrying...'; stopStream(); tracker.clear(); report(); scheduleRetry(); };
    phase = 'live'; err = ''; video.style.transform = cfg.mirror ? 'scaleX(-1)' : 'none';
    await refreshDevices();
    if (my !== startSeq) return;
    // Choose the camera. The host's own pick (by id, or by name if the id changed) always wins. Otherwise use the best REAL camera:
    // the Mac's own, then the iPhone. Virtual cameras (Sony Imaging Edge, OBS, ...) are never picked automatically.
    if (!autoDevice) {
      const curId = tr && tr.getSettings ? tr.getSettings().deviceId : '';
      const byLabel = cfg.deviceLabel && devices.find(d => d.label === cfg.deviceLabel);
      let best = null;
      if (cfg.deviceId && !devices.some(d => d.id === cfg.deviceId) && byLabel) best = byLabel;            // saved id is stale: find it by name
      else if (!cfg.deviceId || !devices.some(d => d.id === cfg.deviceId)) best = devices.filter(d => !badIds.has(d.id)).sort((a, b) => a.rank - b.rank)[0];     // no pick, or the pick is gone/blocked
      const cur = devices.find(d => d.id === curId || d.label === label);
      if (best && best.id !== (cur && cur.id) && (!cur || best.rank < cur.rank || (cfg.deviceId && best === byLabel))) { autoDevice = best.id; return start(); }
    }
    report();
  }

  /* ---------- detection ---------- */
  const conf = () => ({ strict: 0.6, normal: 0.45, loose: 0.3 }[cfg.sens] || 0.45);
  async function ensureLandmarker() {
    if (landmarker || loading) return;
    const gen = detGen;
    loading = true; det.state = 'loading'; det.err = ''; report();
    try {
      const { FilesetResolver, PoseLandmarker } = await import('./vendor/mediapipe/vision_bundle.mjs');
      const fs = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
      landmarker = await PoseLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: 'models/pose_landmarker_lite.task', delegate: cfg.gpu ? 'GPU' : 'CPU' },
        runningMode: cfg.mode === 'crowd' ? 'IMAGE' : 'VIDEO', numPoses: 8,
        minPoseDetectionConfidence: conf(), minPosePresenceConfidence: conf(), minTrackingConfidence: conf()
      });
      if (gen !== detGen) { try { landmarker.close(); } catch (e2) {} landmarker = null; }          // settings changed while loading
      else det.state = 'running';
    } catch (e) { det.state = 'error'; det.err = (e && e.message) || String(e); loadFailAt = performance.now(); }
    loading = false; report();
  }
  const benchCv = document.createElement('canvas'); benchCv.width = 1280; benchCv.height = 720;
  async function benchYolo(y) {                                           // median ms of 6 detections on the live picture (or a blank frame)
    let src = benchCv; if (video.videoWidth && video.readyState >= 2) src = video; else { const g = benchCv.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, 1280, 720); }
    const ms = []; for (let i = 0; i < 6; i++) { const a = performance.now(); await y.detect(src); ms.push(performance.now() - a); }
    ms.sort((p, q) => p - q); return ms[Math.floor(ms.length / 2)];
  }
  const yconf = () => ({ strict: 0.5, normal: 0.35, loose: 0.25 }[cfg.sens] || 0.35);
  async function ensureDetector() {
    if (loading || performance.now() - loadFailAt < 5000) return;            // back off after a failed load instead of retrying 12 times a second
    if (yoloFailed && cfg.engine === 'auto' && performance.now() - yoloFailedAt > 180000) yoloFailed = false;    // give YOLO another chance after 3 minutes
    if (cfg.engine !== 'mediapipe' && !yoloFailed && typeof YoloPose !== 'undefined') {
      loading = true; det.state = 'loading'; det.err = ''; report();
      const size = cfg.engine === 'yolo-s' ? 's' : 'n', gen = detGen, cacheKey = 'akf-yolo-provider-' + size;
      const mk = provs => YoloPose.create({ model: size, ortBase: 'vendor/ort/', modelBase: 'models/', providers: provs, scoreThr: yconf(), maxPeople: 10 });
      let cached = ''; try { cached = localStorage.getItem(cacheKey) || ''; } catch (e) {}
      try {
        let y = await mk(cached === 'wasm' ? ['wasm'] : ['webgpu', 'wasm']);
        // First run on this Mac: WebGPU is not always the fastest (multi-threaded wasm can win), so measure both and keep the quicker one.
        if (!cached && y.provider === 'webgpu') {
          let t1 = Infinity, win = '';
          try { t1 = await benchYolo(y); det.bench = `webgpu ${Math.round(t1)} ms`; } catch (e1) { det.bench = 'webgpu failed: ' + ((e1 && e1.message) || e1); }
          if (t1 > 90) {
            let w = null;
            try {
              w = await mk(['wasm']); const t2 = await benchYolo(w); det.bench += `, wasm ${Math.round(t2)} ms`;
              if (t2 < t1 * 0.9) {
                // the CPU is quicker here, but in this page it would run on the main thread and freeze the host: remember it, and
                // from the next launch it runs in onnxruntime's worker (see yolo-pose.js). Now: WebGPU, or the CPU only if WebGPU cannot run at all.
                win = 'wasm';
                if (t1 === Infinity) { const old = y; y = w; w = null; try { old.dispose && old.dispose(); } catch (e3) {} }
                else det.bench += ' (CPU in a worker from the next launch)';
              }
            } catch (e2) { det.bench += ', wasm failed'; }
            if (w) { try { w.dispose && w.dispose(); } catch (e3) {} }
            if (t1 === Infinity && y.provider === 'webgpu') throw new Error(det.bench);   // neither provider could run a detection
          }
          try { localStorage.setItem(cacheKey, win || y.provider); } catch (e) {}
        }
        det.provErr = (y.providerErrors && y.providerErrors.length) ? y.providerErrors.join(' | ') : '';
        if (gen !== detGen) { try { y.dispose && y.dispose(); } catch (e2) {} det.yoloNote = 'YOLO load discarded: settings changed while it loaded'; loading = false; return; }   // settings changed while loading
        det.yoloNote = ''; yolo = y; engineName = `YOLO26${size} (${y.provider})`; det.engine = engineName; det.state = 'running'; slowN = 0;
      } catch (e) { yoloFailed = true; yoloFailedAt = performance.now(); det.err = 'YOLO unavailable, using MediaPipe: ' + ((e && e.message) || e); det.yoloNote = det.err; console.error('[cam] YOLO failed', e); }
      loading = false; report();
      if (yolo) return;
    }
    await ensureLandmarker(); if (landmarker) { engineName = 'MediaPipe Lite'; det.engine = engineName; report(); }
  }
  function dropDetector() { detGen++; if (reid) { try { reid.dispose && reid.dispose(); } catch (e) {} } reid = null; reidFailed = false; det.reid = ''; dropLandmarker(); if (yolo) { try { yolo.dispose && yolo.dispose(); } catch (e) {} yolo = null; } yoloFailed = false; engineName = ''; det.engine = ''; }

  /* One body -> marker spot, size, raised hand; duplicates removed. Shared with the offline accuracy tests: pose-logic.js */
  const poseOpt = () => ({ handSens: cfg.handSens, sens: cfg.sens, inQuad: (pt, g) => cfg.ignoreQuad || pointInQuad(pt, cfg.quad, g) });
  const cocoToDet = p => PoseLogic.toDet(p, poseOpt());
  const poseToDet = lm => { const p = PoseLogic.fromMediaPipe(lm); return p ? PoseLogic.toDet(p, poseOpt()) : null; };
  const cleanDets = dets => PoseLogic.clean(dets, { sens: cfg.sens });
  function dropLandmarker() { if (landmarker) { try { landmarker.close(); } catch (e) {} landmarker = null; } }

  /* Crowd mode: look at the whole picture AND zoomed left/right halves, so small or crowded people are found too */
  const cropCv = document.createElement('canvas'), cropG = cropCv.getContext('2d');
  function crowdPoses() {
    const out = [], vw = video.videoWidth, vh = video.videoHeight;
    for (const [x0, y0, w, h] of [[0, 0, 1, 1], [0, 0, 0.6, 1], [0.4, 0, 0.6, 1]]) {
      let src = video;
      if (w < 1 || h < 1) {
        const cw = 960, ch = Math.max(2, Math.round(cw * (vh * h) / (vw * w)));
        if (cropCv.width !== cw || cropCv.height !== ch) { cropCv.width = cw; cropCv.height = ch; }
        cropG.drawImage(video, vw * x0, vh * y0, vw * w, vh * h, 0, 0, cw, ch); src = cropCv;
      }
      const res = landmarker.detect(src);
      for (const lm of (res.landmarks || [])) out.push(lm.map(p => ({ x: x0 + p.x * w, y: y0 + p.y * h, visibility: p.visibility })));
    }
    return out;
  }

  /* a tiny clothing-colour fingerprint of each person's torso, so two people who cross paths keep their own colors */
  // One small copy of the picture per detection round (not one full-size read per person): every torso is sampled from it.
  const AW = 192, AH = 108, appCv = document.createElement('canvas'); appCv.width = AW; appCv.height = AH;
  const appG = appCv.getContext('2d', { willReadFrequently: true });
  function appFrame() {
    if (!(phase === 'live' && !cfg.sim) || !video.videoWidth) return null;
    try { appG.drawImage(video, 0, 0, AW, AH); return appG.getImageData(0, 0, AW, AH).data; } catch (e) { return null; }
  }
  function appearance(d, px) {
    if (!px || !d.bbox) return null;
    const b = d.bbox, x0 = Math.max(0, b.x0), x1 = Math.min(1, b.x1), y0 = Math.max(0, b.y0 + (b.y1 - b.y0) * 0.3), y1 = Math.min(1, b.y1);
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return null;
    const h = new Float32Array(64);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 12; i++) {          // 12 x 16 sample grid over the torso
      const x = Math.min(AW - 1, Math.floor((x0 + (i + 0.5) / 12 * (x1 - x0)) * AW)), y = Math.min(AH - 1, Math.floor((y0 + (j + 0.5) / 16 * (y1 - y0)) * AH)), o = (y * AW + x) * 4;
      h[(px[o] >> 6) * 16 + (px[o + 1] >> 6) * 4 + (px[o + 2] >> 6)]++;
    }
    for (let i = 0; i < 64; i++) h[i] /= 192;
    return h;
  }

  /* body re-identification (OSNet): runs a few times a second in the background and only CORRECTS identities, never blocks tracking */
  async function ensureReId() {
    if (reid || reidFailed || typeof ReId === 'undefined' || cfg.reid === false || !yolo) return;
    reidFailed = true;                                                   // only try once per engine start
    const gen = detGen;
    try {
      const r = await ReId.create({ model: yolo.provider === 'webgpu' ? 'ain' : 'x025', ortBase: 'vendor/ort/', modelBase: 'models/', providers: ['webgpu', 'wasm'] });
      if (gen !== detGen || !yolo) { try { r.dispose && r.dispose(); } catch (e2) {} if (gen === detGen) reidFailed = false; return; }   // settings changed while loading
      reid = r; reidFailed = false; det.reid = `OSNet ${r.model || ''} (${r.provider})`; report();
    } catch (e) { if (gen === detGen) det.reidErr = (e && e.message) || String(e); }
  }
  function bodyBox(d) {
    if (d.box) return d.box;
    const b = d.bbox, h = b.y1 - b.y0;                                   // MediaPipe gives only head-to-hips: stretch down to the feet
    return { x0: Math.max(0, b.x0 - h * 0.15), x1: Math.min(1, b.x1 + h * 0.15), y0: Math.max(0, b.y0 - h * 0.1), y1: Math.min(1, b.y1 + h * 1.3) };
  }
  function reidTick(dets, t0) {
    if (!yolo) return;
    if (!reid) { ensureReId(); return; }
    if (reidBusy || t0 - lastEmb < 350 || !video.videoWidth) return;
    const cand = dets.filter(d => d.good && d.inside && (d.score || 1) >= 0.5);
    if (!cand.length) return;
    reidBusy = true; lastEmb = t0;
    const r = reid, gen = detGen;
    r.embedMany(video, cand.map(bodyBox)).then(embs => {
      if (gen !== detGen || r !== reid) return;                          // detector was reset meanwhile: these results are stale
      det.reidMs = Math.round(r.lastMs || 0);
      tracker.applyEmbeddings(cand.map((d, i) => ({ x: d.x, y: d.y, s: d.s, emb: embs[i] })), performance.now());
      for (const [a, b, kind] of tracker.drainSwaps()) if (window.Buzz && Buzz.swapColors) Buzz.swapColors(a, b, kind);
      pushTracks();
    }).catch(e => { if (gen !== detGen || r !== reid) return; det.reidErr = (e && e.message) || String(e); try { r.dispose && r.dispose(); } catch (e2) {} reid = null; reidFailed = true; }).finally(() => { reidBusy = false; });
  }

  function feed(dets, now) {
    dets = cleanDets(dets);
    const px = dets.length ? appFrame() : null;
    for (const d of dets) d.app = appearance(d, px);
    lastDets = dets; people.frame = dets.length; people.square = dets.filter(d => d.inside).length;
    tracker.update(dets, now);
    const ev = tracker.drain(); if (ev.length && window.Buzz) Buzz.raise(ev);
    pushTracks();
  }
  function pushTracks() {
    const colors = tracker.colors(), key = colors.join(',');
    if (key !== lastLive) { lastLive = key; post({ type: 'tracks', colors }); }
  }

  function simStep(now) {
    if (!sim || sim.length !== cfg.simN) sim = Array.from({ length: cfg.simN }, (_, i) => ({ ph: i * 1.7 + 0.5, sp: 0.07 + (i % 3) * 0.03, cu: (i + 0.5) / cfg.simN, cv: 0.3 + (i * 0.37 % 0.55) }));
    const t = now / 1000, dets = [];
    for (const p of sim) {
      const u = Math.min(0.92, Math.max(0.08, p.cu + Math.sin(t * p.sp * 3 + p.ph) * 0.1));
      const v = Math.min(0.95, Math.max(0.3, p.cv + Math.cos(t * p.sp * 2.3 + p.ph) * 0.16));
      const f = quadPoint(cfg.quad, u, v), s = 0.035 + 0.06 * v;
      const d = { x: f.x, y: f.y - (0.12 + 0.25 * v), s, score: 1, good: true, inside: true, insideExp: true };
      d.bbox = { x0: d.x - s, y0: d.y - 0.02, x1: d.x + s, y1: d.y + 0.3 * (0.5 + v) };
      dets.push(d);
      if (cfg.simDup) {                      // test: the model sometimes reports the same person twice, or a ghost nearby
        dets.push({ ...d, x: d.x + 0.012, y: d.y + 0.01, score: 0.6, bbox: { ...d.bbox } });
        dets.push({ ...d, x: d.x + 0.03, y: d.y - 0.02, s: s * 0.8, score: 0.5, bbox: { ...d.bbox } });
      }
    }
    feed(dets, now);
  }

  async function detectLoop() {
    if (PREV) return;
    if (document.body.classList.contains('replaying')) { setTimeout(detectLoop, 120); return; }
    const interval = 1000 / (cfg.detHz || 15);
    const now = performance.now();
    infer = false;
    try {
      if (cfg.sim) { det.state = 'running'; simStep(now); }
      else if (cfg.on && cfg.detect && phase === 'live' && !document.hidden) {
        if (yoloFailed && cfg.engine === 'auto' && now - yoloFailedAt > 180000) yoloFailed = false;   // give YOLO another chance after 3 minutes
        if (landmarker && !yolo && !yoloFailed && cfg.engine !== 'mediapipe' && typeof YoloPose !== 'undefined') dropLandmarker();   // YOLO is allowed again: switch back
        if (!yolo && !landmarker) await ensureDetector();
        else if (video.readyState >= 2 && video.videoWidth) {
          const t0 = performance.now();
          let dets = [];
          if (yolo) {
            const y = yolo, gen = detGen;                                  // this round's detector: a reset while we wait must not mix engines
            let ppl; infer = true;
            if (cfg.mode === 'crowd') {
              const a = await y.detect(video, { x: 0, y: 0, w: 0.6, h: 1 }), b = gen === detGen ? await y.detect(video, { x: 0.4, y: 0, w: 0.6, h: 1 }) : [];
              // each person comes from ONE half: the left half keeps who it sees whole (plus anyone wide enough to cross both seams),
              // the right half keeps only people starting right of the left seam. No half-cut ghosts at the seams.
              ppl = a.filter(p => p.box.x1 < 0.585 || p.box.x0 < 0.415).concat(b.filter(p => p.box.x0 > 0.415));
            }
            else ppl = await y.detect(video);
            infer = false;
            if (gen !== detGen || y !== yolo) { setTimeout(detectLoop, 0); return; }
            det.ms = det.ms ? det.ms * 0.8 + (performance.now() - t0) * 0.2 : performance.now() - t0;
            for (const p of ppl) { const d = cocoToDet(p); if (d) dets.push(d); }
            // no WebGPU and too slow? fall back to the lighter MediaPipe model automatically
            if (cfg.engine === 'auto' && y.provider === 'wasm') { if (det.ms <= 350) slowN = 0; else if (++slowN >= 10) { try { yolo.dispose && yolo.dispose(); } catch (e) {} yolo = null; yoloFailed = true; yoloFailedAt = performance.now(); det.yoloNote = det.err = 'YOLO is too slow without WebGPU here (' + Math.round(det.ms) + ' ms a frame), switched to MediaPipe.'; det.ms = 0; } }
          } else {
            infer = true;
            const poses = cfg.mode === 'crowd' ? crowdPoses() : (landmarker.detectForVideo(video, t0).landmarks || []);
            infer = false;
            det.ms = det.ms ? det.ms * 0.8 + (performance.now() - t0) * 0.2 : performance.now() - t0;
            for (const lm of poses) { const d = poseToDet(lm); if (d) dets.push(d); }
          }
          feed(dets, t0); detCount++;
          reidTick(lastDets, t0);
        }
      } else if (det.state === 'running' || det.state === 'loading') {
        det.state = 'off'; tracker.clear(); pushTracks(); people = { frame: 0, square: 0 };
      }
      errN = 0; if (det.state === 'error' && (yolo || landmarker)) det.state = 'running';
    } catch (e) {
      det.err = (e && e.message) || String(e);
      // detector keeps failing (e.g. WebGPU device lost): drop it and rebuild, falling back from YOLO to MediaPipe
      if (!infer) console.error('[cam] problem outside the detector', e);                 // not the detector's fault: do not swap engines for it
      else if (++errN >= 3) {
        errN = 0; det.state = 'loading';
        if (yolo) { try { yolo.dispose && yolo.dispose(); } catch (e2) {} yolo = null; yoloFailed = true; yoloFailedAt = performance.now(); det.yoloNote = det.err = 'YOLO stopped working, switched to MediaPipe: ' + det.err; }
        else dropLandmarker();
      } else det.state = 'error';
    }
    const nt = performance.now();
    if (nt - detT > 1000) { det.hz = detCount * 1000 / (nt - detT); detCount = 0; detT = nt; }
    // adaptive: if inference is slow, back off so the laptop stays cool and the game stays smooth
    const wait = Math.max(8, interval - (performance.now() - now)) + (det.ms > interval * 1.5 ? det.ms * 0.15 : 0);   // a slow detector gets only a small breather (a big one cut a 170 ms detector to ~4/s)
    setTimeout(detectLoop, wait);
  }

  /* ---------- drawing ---------- */
  function mapPt(nx, ny) {
    const vw = video.videoWidth || 1920, vh = video.videoHeight || 1080;
    const k = Math.max(W / vw, H / vh), dw = vw * k, dh = vh * k, ox = (W - dw) / 2, oy = (H - dh) / 2;
    let x = ox + nx * dw; const y = oy + ny * dh;
    if (cfg.mirror) x = W - x;
    return [x, y];
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    if (now - fpsT > 1000) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; } fpsN++;
    ctx.clearRect(0, 0, W, H);
    if (showing()) {
      if (cfg.showQuad) {
        const pts = cfg.quad.map(([x, y]) => mapPt(x, y));
        ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
        ctx.setLineDash([22, 14]); ctx.lineDashOffset = -now / 60; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke(); ctx.setLineDash([]);
      }
      if (cfg.kites) {
        if (!PREV) tracker.step(dt, now);
        const t = now / 1000;
        const items = (PREV ? remoteItems : tracker.tracks).slice().sort((a, b) => a.y - b.y);
        const covered = document.body.classList.contains('replaying');   // the full-screen replay hides this canvas: keep tracking, skip drawing
        for (const tr of items) {
          if (!PREV) { const target = tr.order ? 1 : 0, cur = tr.morph || 0; tr.morph = cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), dt / 0.5); }
          const [x, y] = mapPt(tr.x, tr.y), size = Math.max(74, Math.min(160, (tr.rs || tr.s) * W * 1.0));
          // float above the head, but never off the top of the picture
          let kx = Math.min(W - size * 0.6, Math.max(size * 0.6, x)), ky = Math.max(size * 0.75, y - size * 0.95);
          if (kx - size * 0.6 < KEEP_OUT.x && ky - size * 0.75 < KEEP_OUT.y) ky = KEEP_OUT.y + size * 0.75;   // never hidden under the mascot tab / 'Live Feed' label
          if (!covered) Kites.draw(ctx, kx, ky, size, TEAMS[tr.color].color, t, TEAM_ORDER.indexOf(tr.color) * 1.3, tr.order || '', tr.morph || 0);
        }
        if (!PREV && previewSeen && now - lastKitePost > 70) {      // let the host-window preview mirror the kites
          lastKitePost = now;
          post({ type: 'kites', items: tracker.tracks.map(t => ({ x: t.x, y: t.y, s: t.s, color: t.color, order: t.order || 0, morph: t.morph || 0 })) });
        }
      }
    }
    if (cfg.debug && !PREV) {
      ctx.font = '700 22px sans-serif'; ctx.textAlign = 'center';
      for (const d of lastDets) {
        const [x, y] = mapPt(d.x, d.y);
        ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.lineWidth = 4; ctx.strokeStyle = d.inside ? '#2FA562' : '#E5484D'; ctx.stroke();
        ctx.fillStyle = '#2A2D3A'; ctx.fillText(d.inside ? 'head' : 'outside', x, y - 22);
        if (d.line !== undefined) {                                     // pink: the height a wrist must reach; dots: wrists (green = raised)
          const [lx, ly] = mapPt(d.x - 0.1, d.line), [rx] = mapPt(d.x + 0.1, d.line);
          ctx.lineWidth = 3; ctx.strokeStyle = '#EC5CA8'; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ly); ctx.stroke();
        }
        if (d.kp) for (const i of [9, 10]) { const w = d.kp[i]; if (w.v < 0.35) continue; const [wx, wy] = mapPt(w.x, w.y); ctx.beginPath(); ctx.arc(wx, wy, 11, 0, 7); ctx.fillStyle = d.raised ? '#2FA562' : 'rgba(42,45,58,.5)'; ctx.fill(); }
        if (d.bbox) { const [ax, ay] = mapPt(d.bbox.x0, d.bbox.y0), [bx, by] = mapPt(d.bbox.x1, d.bbox.y1); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(42,45,58,.55)'; ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); }
      }
    }
    if (!PREV && (snapOn || now < snapUntil) && phase === 'live' && now - snapT > 300) {
      snapT = now; const c = snapCv.getContext('2d');
      try { c.drawImage(video, 0, 0, 640, 360); post({ type: 'cam-frame', data: snapCv.toDataURL('image/jpeg', 0.55), mirror: cfg.mirror }); } catch (e) {}
    }
    requestAnimationFrame(frame);
  }

  /* ---------- config from host ---------- */
  function apply(c) {
    if (!c) return;
    const old = cfg; cfg = Object.assign({}, cfg, c);
    video.style.transform = pvimg.style.transform = cfg.mirror ? 'scaleX(-1)' : 'none';
    if (PREV) { report(); return; }
    if (old.deviceId !== cfg.deviceId) { autoDevice = ''; badIds.clear(); }      // a new pick by the host always wins
    if (old.on !== cfg.on || (old.deviceId !== cfg.deviceId && cfg.on)) { fallbackTried = false; start(); }
    if (old.gpu !== cfg.gpu || old.mode !== cfg.mode || old.sens !== cfg.sens || old.engine !== cfg.engine) dropDetector();
    if (!cfg.detect && (yolo || landmarker || reid)) dropDetector();
    if (old.sim && !cfg.sim) { tracker.clear(); pushTracks(); }
    if (!cfg.on && phase !== 'off') { phase = 'off'; err = ''; }
    report();
  }

  CH.addEventListener('message', e => {
    const m = e.data;
    if (PREV) {
      if (m.type === 'cam-frame') { remoteFrameAt = performance.now(); pvimg.src = m.data; document.body.classList.add('cam-live'); }
      else if (m.type === 'kites') remoteItems = m.items;
      return;
    }
    if (m.type === 'hello' && m.preview) previewSeen = true;
    if (m.type === 'cam-snap') { snapOn = !!m.on && !m.preview; if (m.on) snapUntil = performance.now() + 8000; }
    else if (m.type === 'cam-list') refreshDevices();
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener)
    navigator.mediaDevices.addEventListener('devicechange', () => { refreshDevices(); if (cfg.on && phase !== 'live') start(); });
  document.addEventListener('fullscreenchange', report);
  setInterval(report, 1000);
  requestAnimationFrame(frame); detectLoop();

  // what the replay recorder should film right now (it runs on its own timer, not on the drawing loop)
  const snapshot = () => ({ show: showing(), video: (phase === 'live' && !cfg.sim && video.readyState >= 2) ? video : null, tracks: tracker.tracks });
  const debug = () => ({ engineName, yolo: !!yolo, provider: yolo && yolo.provider, landmarker: !!landmarker, yoloFailed, loading, detGen, errN, slowN, reid: !!reid, state: det.state, err: det.err });
  return { apply, report, tracker, cfg: () => cfg, snapshot, debug };
})();

window.Cam = Cam;
