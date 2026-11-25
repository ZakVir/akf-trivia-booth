/*
 * yolo-pose.js  --  YOLO26 pose (COCO-17) person detector for the browser, via onnxruntime-web, fully offline.
 *
 *   const det = await YoloPose.create({ model:'n'|'s', ortBase:'vendor/ort/', modelBase:'models/',
 *                                       providers:['webgpu','wasm'], scoreThr:0.35, maxPeople:12 });
 *   det.provider   // 'webgpu' | 'wasm' (what actually loaded)
 *   det.lastMs     // last inference time (ms, session.run only)
 *   const people = await det.detect(source, region?)   // source: video | canvas | ImageBitmap
 *   // -> [{ box:{x0,y0,x1,y1}, score, kp:[{x,y,v} x17] }], everything normalized 0..1 in the ORIGINAL source frame
 *
 * Models: models/yolo26{n,s}-pose.onnx, exported from the Ultralytics yolo26n-pose.pt / yolo26s-pose.pt
 * weights (AGPL-3.0) with  export(format='onnx', imgsz=640, dynamic=False, opset=17, end2end=True).
 * Input : "images"  float32 [1,3,640,640], RGB planar, 0..1, letterboxed (gray 114 padding, centered).
 * Output: "output0" float32 [1,300,57] = END-TO-END / NMS-FREE (top-300 already filtered inside the graph):
 *         per row: x1,y1,x2,y2 (pixels in the 640x640 letterboxed frame), score, class(0=person),
 *                  then 17 * (kx, ky, kconf) also in 640-letterbox pixels. Rows are sorted by score, so we
 *                  just threshold + cap at maxPeople; no NMS is needed.
 * Fallback decode: if a model with the legacy head [1,56,8400] is dropped in (rows = cx,cy,w,h,score,17*3 per
 * anchor, columns = anchors), it is detected from the output dims and decoded + NMS'd (IoU 0.5) automatically.
 *
 * Providers: tries `providers` in order (webgpu only when navigator.gpu exists). A provider is accepted only
 * if session creation AND one warm-up run succeed; otherwise falls back to the next. wasm uses SIMD (always
 * on in ort-web) and multiple threads only when crossOriginIsolated is true (needs COOP/COEP headers).
 * Input/output tensors and the 640x640 offscreen canvas are allocated once and reused. Calls are serialised.
 */
(function (root) {
  'use strict';
  var S = 640;                       // model input size
  var NK = 17;
  var isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!(process.versions && process.versions.node);

  /* ---------- pure helpers (unit-testable in node) ---------- */

  // Letterbox geometry for a source of size (W,H) pixels and optional normalized region.
  function letterbox(W, H, region) {
    var rx = 0, ry = 0, rw = 1, rh = 1;
    if (region) {
      rx = Math.max(0, Math.min(1, region.x)); ry = Math.max(0, Math.min(1, region.y));
      rw = Math.max(0.01, Math.min(1 - rx, region.w)); rh = Math.max(0.01, Math.min(1 - ry, region.h));
    }
    var sx = rx * W, sy = ry * H, sw = rw * W, sh = rh * H;
    var scale = Math.min(S / sw, S / sh);
    var dw = sw * scale, dh = sh * scale;
    return { W: W, H: H, sx: sx, sy: sy, sw: sw, sh: sh, scale: scale,
             padX: (S - dw) / 2, padY: (S - dh) / 2, dw: dw, dh: dh };
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // 640-letterbox pixel -> normalized original-frame coordinate
  function unmapX(lb, x) { return clamp01((lb.sx + (x - lb.padX) / lb.scale) / lb.W); }
  function unmapY(lb, y) { return clamp01((lb.sy + (y - lb.padY) / lb.scale) / lb.H); }

  // kpx/kpy/kpv: functions k -> value (raw 640-letterbox pixels / confidence)
  function makePerson(lb, x0, y0, x1, y1, score, kpx, kpy, kpv) {
    var kp = new Array(NK);
    for (var k = 0; k < NK; k++) kp[k] = { x: unmapX(lb, kpx(k)), y: unmapY(lb, kpy(k)), v: clamp01(kpv(k)) };
    return { box: { x0: unmapX(lb, x0), y0: unmapY(lb, y0), x1: unmapX(lb, x1), y1: unmapY(lb, y1) },
             score: score, kp: kp };
  }

  function iou(a, b) {
    var ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    var iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ix <= 0 || iy <= 0) return 0;
    var inter = ix * iy;
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter);
  }

  // data: Float32Array, dims: output tensor dims. Returns people array (see header).
  function decode(data, dims, lb, scoreThr, maxPeople) {
    var out = [], i, r;
    if (dims.length === 3 && dims[2] === 57) {                 // end-to-end [1,N,57]
      var n = dims[1];
      for (i = 0; i < n && out.length < maxPeople; i++) {
        r = i * 57;
        var sc = data[r + 4];
        if (sc < scoreThr) continue;                            // rows sorted by score, but don't rely on it
        out.push(makePerson(lb, data[r], data[r + 1], data[r + 2], data[r + 3], sc,
                            function (k) { return data[r + 6 + k * 3]; },
                            function (k) { return data[r + 7 + k * 3]; },
                            function (k) { return data[r + 8 + k * 3]; }));
      }
      out.sort(function (a, b) { return b.score - a.score; });
      return out;
    }
    if (dims.length === 3 && dims[1] === 56) {                 // legacy [1,56,A], channel-major
      var A = dims[2], cand = [];
      for (i = 0; i < A; i++) {
        var s = data[4 * A + i];
        if (s < scoreThr) continue;
        var cx = data[i], cy = data[A + i], w = data[2 * A + i], h = data[3 * A + i];
        cand.push({ i: i, s: s, b: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] });
      }
      cand.sort(function (a, b) { return b.s - a.s; });
      var keep = [];
      for (var c = 0; c < cand.length && keep.length < maxPeople; c++) {
        var ok = true;
        for (var j = 0; j < keep.length; j++) if (iou(cand[c].b, keep[j].b) > 0.5) { ok = false; break; }
        if (ok) keep.push(cand[c]);
      }
      for (var q = 0; q < keep.length; q++) {
        var K = keep[q], ai = K.i;
        out.push(makePerson(lb, K.b[0], K.b[1], K.b[2], K.b[3], K.s,
                            function (k) { return data[(5 + k * 3) * A + ai]; },
                            function (k) { return data[(6 + k * 3) * A + ai]; },
                            function (k) { return data[(7 + k * 3) * A + ai]; }));
      }
      return out;
    }
    throw new Error('YoloPose: unsupported output dims [' + dims.join(',') + ']');
  }

  // RGBA bytes (S*S*4) -> planar float RGB 0..1 into `dst` (Float32Array 3*S*S)
  function rgbaToPlanar(rgba, dst) {
    var n = S * S, g = n, b = 2 * n, inv = 1 / 255;
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      dst[i] = rgba[p] * inv; dst[g + i] = rgba[p + 1] * inv; dst[b + i] = rgba[p + 2] * inv;
    }
  }

  /* ---------- runtime ---------- */

  function loadScript(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url; s.onload = res; s.onerror = function () { rej(new Error('YoloPose: cannot load ' + url)); };
      document.head.appendChild(s);
    });
  }

  function srcSize(src) {
    if (src.videoWidth) return [src.videoWidth, src.videoHeight];
    return [src.naturalWidth || src.displayWidth || src.width, src.naturalHeight || src.displayHeight || src.height];
  }

  // Without a working WebGPU, inference runs on the CPU (wasm). In the page that blocks the main thread for ~100 ms a
  // frame, which made the whole host page (one window: the live view is an iframe in it) freeze. So wasm runs in
  // onnxruntime's worker (env.wasm.proxy) unless a WebGPU adapter exists. The env is set once per page (first create wins).
  async function wantProxy(ort, providers, isNode) {
    if (isNode || typeof Worker === 'undefined') return false;
    if (root.__ortProxy != null) return root.__ortProxy;
    var gpu = false;
    if (providers.indexOf('webgpu') >= 0 && typeof navigator !== 'undefined' && navigator.gpu) {
      try { gpu = !!(await Promise.race([navigator.gpu.requestAdapter(), new Promise(function (r) { setTimeout(function () { r(null); }, 3000); })])); } catch (e) { gpu = false; }
    }
    root.__ortProxy = !gpu;
    return root.__ortProxy;
  }

  // one model load at a time (onnxruntime-web throws "Session already started" when two creates overlap)
  async function create(opts) {
    var prev = root.__ortCreateLock || Promise.resolve(), release;
    root.__ortCreateLock = new Promise(function (r) { release = r; });
    try { await prev.catch(function () {}); return await createInner(opts); } finally { release(); }
  }
  async function createInner(opts) {
    opts = opts || {};
    var model = opts.model === 's' ? 's' : 'n';
    var ortBase = opts.ortBase || 'vendor/ort/';
    var modelBase = opts.modelBase || 'models/';
    var providers = (opts.providers && opts.providers.length) ? opts.providers : ['webgpu', 'wasm'];
    var scoreThr = opts.scoreThr == null ? 0.35 : opts.scoreThr;
    var maxPeople = opts.maxPeople || 12;
    var log = opts.log || function () {};

    // onnxruntime-web
    var ort = opts.ort || root.ort;
    if (!ort) {
      if (isNode) { ort = require(ortBase.replace(/\/?$/, '/') + 'ort.min.js'); }
      else {
        await loadScript(new URL(ortBase + 'ort.min.js', document.baseURI).href);
        ort = root.ort;
      }
    }
    var baseAbs = isNode ? ortBase.replace(/\/?$/, '/') : new URL(ortBase, document.baseURI).href;
    if (isNode) baseAbs = require('url').pathToFileURL(require('path').resolve(baseAbs)).href + '/';
    ort.env.wasm.wasmPaths = baseAbs;
    var isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
    var cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    ort.env.wasm.numThreads = opts.threads || (isolated ? Math.max(1, Math.min(4, cores - 1)) : 1);
    var proxied = await wantProxy(ort, providers, isNode);
    ort.env.wasm.proxy = proxied;
    if (proxied) providers = providers.filter(function (x) { return x !== 'webgpu'; });   // the worker runs wasm only

    // model bytes
    var bytes = opts.modelBytes;
    if (!bytes) {
      var name = 'yolo26' + model + '-pose.onnx';
      if (isNode) bytes = new Uint8Array(require('fs').readFileSync(require('path').join(modelBase, name)));
      else {
        var resp = await fetch(modelBase + name);
        if (!resp.ok) throw new Error('YoloPose: cannot fetch ' + modelBase + name + ' (' + resp.status + ')');
        bytes = new Uint8Array(await resp.arrayBuffer());
      }
    }

    var inputData = new Float32Array(3 * S * S);
    inputData.fill(114 / 255);
    var inputTensor = new ort.Tensor('float32', inputData, [1, 3, S, S]);
    // the worker takes ownership of what it is sent (the buffer is detached), so it always gets a fresh copy
    function feed() { return proxied ? new ort.Tensor('float32', inputData.slice(), [1, 3, S, S]) : inputTensor; }

    var session = null, provider = null, errors = [];
    var busyTries = 0;   // ORT builds one session at a time: "Session already started" means an earlier (failed/slow) create is still finishing, so wait and retry
    for (var pi = 0; pi < providers.length; pi++) {
      var p = providers[pi];
      if (p === 'webgpu' && !(typeof navigator !== 'undefined' && navigator.gpu)) { errors.push('webgpu: navigator.gpu missing'); continue; }
      try {
        // a provider that hangs (seen with WebGPU on some GPUs / software GPUs) must not freeze loading: give up after 20 s and try the next one
        var tmo, guard = new Promise(function (_, rej) { tmo = setTimeout(function () { rej(new Error('timed out after 20 s')); }, 20000); });
        var s, inner = (async function () {
          var s0 = await ort.InferenceSession.create(bytes, { executionProviders: [p], graphOptimizationLevel: 'all' });
          try { await s0.run({ [s0.inputNames[0]]: feed() }); }   // warm-up; WebGPU often fails here
          catch (we) { try { s0.release(); } catch (e2) {} throw we; }
          return s0;
        })();
        try { s = await Promise.race([inner, guard]); }
        catch (te) { inner.then(function (late) { try { late.release(); } catch (e2) {} }, function () {}); throw te; }   // timed out: free the session if it shows up later
        finally { clearTimeout(tmo); }
        session = s; provider = p; break;
      } catch (e) {
        if (/already started/i.test(String(e && e.message || e)) && busyTries++ < 12) { await new Promise(function (r) { setTimeout(r, 2000); }); pi--; continue; }
        errors.push(p + ': ' + (e && e.message || e));
        log('YoloPose provider ' + p + ' failed: ' + (e && e.message || e));
      }
    }
    if (!session) throw new Error('YoloPose: no execution provider worked (' + errors.join(' | ') + ')');

    var inName = session.inputNames[0];
    var canvas = null, ctx = null;
    function ensureCanvas() {
      if (canvas) return;
      if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(S, S);
      else { canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S; }
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
    }

    var chain = Promise.resolve();
    var det = { provider: provider, proxied: proxied && provider === 'wasm', lastMs: 0, model: model, threads: provider === 'wasm' ? ort.env.wasm.numThreads : 0,
                providerErrors: errors, scoreThr: scoreThr, maxPeople: maxPeople };

    // run the session on whatever is currently in inputTensor, decode with letterbox `lb`
    async function infer(lb) {
      var t0 = (typeof performance !== 'undefined' ? performance : Date).now();
      var res = await session.run({ [inName]: feed() });
      var o = res[session.outputNames[0]];
      det.lastMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
      var people = decode(o.data, o.dims, lb, det.scoreThr, det.maxPeople);
      return people;
    }
    det._infer = function (lb) { var r = chain.then(function () { return infer(lb); }); chain = r.catch(function () {}); return r; };
    det._fillFromRGBA = function (rgba) { rgbaToPlanar(rgba, inputData); };   // for tests (rgba = S*S*4 bytes)

    det.detect = function (source, region) {
      var run = chain.then(async function () {
        var wh = srcSize(source), W = wh[0], H = wh[1];
        if (!W || !H) return [];
        var lb = letterbox(W, H, region);
        ensureCanvas();
        ctx.fillStyle = 'rgb(114,114,114)';
        ctx.fillRect(0, 0, S, S);
        ctx.drawImage(source, lb.sx, lb.sy, lb.sw, lb.sh, lb.padX, lb.padY, lb.dw, lb.dh);
        rgbaToPlanar(ctx.getImageData(0, 0, S, S).data, inputData);
        return infer(lb);
      });
      chain = run.catch(function () {});
      return run;
    };
    det.dispose = function () { var c = chain; chain = new Promise(function () {}); return c.then(function () { try { return session.release(); } catch (e) {} }); };   // wait for a running detect, then release; later detects never start
    return det;
  }

  var api = { create: create, _decode: decode, _letterbox: letterbox, _rgbaToPlanar: rgbaToPlanar, INPUT_SIZE: S };
  root.YoloPose = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
