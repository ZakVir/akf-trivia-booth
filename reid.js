/*
 * reid.js  --  person re-identification ("appearance fingerprint") for the browser, via onnxruntime-web, offline.
 *
 *   const r = await ReId.create({ model:'ain'|'x025', ortBase:'vendor/ort/', modelBase:'models/',
 *                                 providers:['webgpu','wasm'], maxBatch:8 });
 *   r.dim        // embedding length (512)
 *   r.provider   // 'webgpu' | 'wasm' (what actually loaded)
 *   r.lastMs     // last inference time (ms, session.run only; for embedMany the whole batch)
 *   r.batched    // true if one session.run handles several people (dynamic batch verified at start-up)
 *   const emb  = await r.embed(source, box)        // -> Float32Array(512), L2-normalised
 *   const embs = await r.embedMany(source, boxes)  // -> Float32Array[] (one batched run per maxBatch people)
 *   ReId.cosDist(a, b)                             // 1 - cos(a,b): ~0 same person, ~1 unrelated (can exceed 1)
 *   r.dispose()
 *   source: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap | {data:RGBA bytes,width,height}
 *   box   : {x0,y0,x1,y1} normalised 0..1 in the source frame (e.g. YoloPose person.box)
 *
 * Models (BODY re-ID only, no face model): models/osnet_ain_x1_0.onnx (8.7 MB) and models/osnet_x0_25.onnx (0.9 MB),
 * exported from the official torchreid (KaiyangZhou/deep-person-reid, MIT) MSMT17-trained checkpoints hosted by the
 * author at huggingface.co/kaiyangzhou/osnet (MIT): osnet_ain_x1_0 (MSMT17, 256x128, amsgrad ep50) and
 * osnet_x0_25 (MSMT17 combineall). Classifier dropped; opset 17, dynamic batch axis.
 * Input : "input"     float32 [N,3,256,128] NCHW RGB, (px/255 - mean)/std with ImageNet mean/std.
 * Output: "embedding" float32 [N,512] (not normalised in the graph; we L2-normalise here).
 * Preprocess as torchreid: crop box (+3% margin each side, clamped to the frame), stretch-resize to 128w x 256h
 * bilinear. In a browser the resize is done by a reused 128x256 canvas; for raw {data,width,height} sources (node
 * tests) an equivalent pure-JS bilinear resize is used.
 * Providers: same logic as yolo-pose.js: tried in order, accepted only if create + warm-up run succeed.
 * Calls are serialised on one promise chain; tensors and canvas are allocated once and reused.
 */
(function (root) {
  'use strict';
  var W = 128, H = 256, PLANE = W * H, PIX = 3 * PLANE, MARGIN = 0.03;
  var MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  var NAMES = { ain: 'osnet_ain_x1_0.onnx', x025: 'osnet_x0_25.onnx' };
  var isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!(process.versions && process.versions.node);

  /* ---------- pure helpers (unit-testable in node) ---------- */

  function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }

  // normalised box -> pixel crop rect {sx,sy,sw,sh} with margin, clamped to the frame (at least 2x2 px)
  function cropRect(fw, fh, box) {
    var x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
    var y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    var mx = (x1 - x0) * MARGIN, my = (y1 - y0) * MARGIN;
    var l = Math.max(0, (x0 - mx) * fw), r = Math.min(fw, (x1 + mx) * fw);
    var t = Math.max(0, (y0 - my) * fh), b = Math.min(fh, (y1 + my) * fh);
    if (r - l < 2) { var cx = Math.min(fw - 1, Math.max(1, (l + r) / 2)); l = cx - 1; r = cx + 1; }
    if (b - t < 2) { var cy = Math.min(fh - 1, Math.max(1, (t + b) / 2)); t = cy - 1; b = cy + 1; }
    return { sx: l, sy: t, sw: r - l, sh: b - t };
  }

  // RGBA bytes (W*H*4, already 128x256) -> normalised planar float into dst at element offset `off`
  function rgbaToNchw(rgba, dst, off) {
    var g = off + PLANE, b = off + 2 * PLANE;
    var m0 = 255 * STD[0], m1 = 255 * STD[1], m2 = 255 * STD[2];
    var o0 = MEAN[0] / STD[0], o1 = MEAN[1] / STD[1], o2 = MEAN[2] / STD[2];
    for (var i = 0, p = 0; i < PLANE; i++, p += 4) {
      dst[off + i] = rgba[p] / m0 - o0;
      dst[g + i] = rgba[p + 1] / m1 - o1;
      dst[b + i] = rgba[p + 2] / m2 - o2;
    }
  }

  // Pure-JS bilinear (pixel-centre convention, like cv2/PIL) crop+resize of an RGBA frame -> W*H*4 into `out`.
  // Source is sampled with edge clamping inside the crop rect.
  function cropResizeRGBA(src, fw, fh, rect, out) {
    var sxs = rect.sw / W, sys = rect.sh / H;
    var x0lim = Math.floor(rect.sx), x1lim = Math.min(fw - 1, Math.ceil(rect.sx + rect.sw) - 1);
    var y0lim = Math.floor(rect.sy), y1lim = Math.min(fh - 1, Math.ceil(rect.sy + rect.sh) - 1);
    var xi0 = new Int32Array(W), xi1 = new Int32Array(W), xw = new Float32Array(W), p = 0, x, y;
    for (x = 0; x < W; x++) {
      var fx = rect.sx + (x + 0.5) * sxs - 0.5, ix = Math.floor(fx), wx = fx - ix;
      xi0[x] = Math.max(x0lim, Math.min(x1lim, ix)) * 4; xi1[x] = Math.max(x0lim, Math.min(x1lim, ix + 1)) * 4; xw[x] = wx;
    }
    for (y = 0; y < H; y++) {
      var fy = rect.sy + (y + 0.5) * sys - 0.5, iy = Math.floor(fy), wy = fy - iy;
      var r0 = Math.max(y0lim, Math.min(y1lim, iy)) * fw * 4, r1 = Math.max(y0lim, Math.min(y1lim, iy + 1)) * fw * 4;
      for (x = 0; x < W; x++, p += 4) {
        var a = r0 + xi0[x], b = r0 + xi1[x], c = r1 + xi0[x], d = r1 + xi1[x], w = xw[x];
        for (var k = 0; k < 3; k++) {
          var top = src[a + k] + (src[b + k] - src[a + k]) * w;
          var bot = src[c + k] + (src[d + k] - src[c + k]) * w;
          out[p + k] = top + (bot - top) * wy ; // out must be a Uint8ClampedArray (rounds + clamps on store)
        }
        out[p + 3] = 255;
      }
    }
  }

  function l2norm(v) {
    var s = 0, i;
    for (i = 0; i < v.length; i++) s += v[i] * v[i];
    s = 1 / (Math.sqrt(s) + 1e-12);
    for (i = 0; i < v.length; i++) v[i] *= s;
    return v;
  }

  function cosDist(a, b) {
    var d = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return 1 - d / (Math.sqrt(na * nb) + 1e-12);
  }

  /* ---------- runtime ---------- */

  function loadScript(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url; s.onload = res; s.onerror = function () { rej(new Error('ReId: cannot load ' + url)); };
      document.head.appendChild(s);
    });
  }

  function srcSize(src) {
    if (src.videoWidth) return [src.videoWidth, src.videoHeight];
    return [src.naturalWidth || src.displayWidth || src.width, src.naturalHeight || src.displayHeight || src.height];
  }

  // one model load at a time (onnxruntime-web throws "Session already started" when two creates overlap)
  async function create(opts) {
    var prev = root.__ortCreateLock || Promise.resolve(), release;
    root.__ortCreateLock = new Promise(function (r) { release = r; });
    try { await prev.catch(function () {}); return await createInner(opts); } finally { release(); }
  }
  async function createInner(opts) {
    opts = opts || {};
    var model = opts.model === 'x025' ? 'x025' : 'ain';
    var ortBase = opts.ortBase || 'vendor/ort/';
    var modelBase = opts.modelBase || 'models/';
    var providers = (opts.providers && opts.providers.length) ? opts.providers : ['webgpu', 'wasm'];
    var maxBatch = Math.max(1, opts.maxBatch || 8);
    var log = opts.log || function () {};

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
    // the YOLO loader decides once per page whether onnxruntime runs in its worker (no WebGPU) and sets root.__ortProxy
    var proxied = !isNode && root.__ortProxy === true;
    ort.env.wasm.proxy = proxied;
    if (proxied) providers = providers.filter(function (x) { return x !== 'webgpu'; });

    var bytes = opts.modelBytes;
    if (!bytes) {
      var name = NAMES[model];
      if (isNode) bytes = new Uint8Array(require('fs').readFileSync(require('path').join(modelBase, name)));
      else {
        var resp = await fetch(modelBase + name);
        if (!resp.ok) throw new Error('ReId: cannot fetch ' + modelBase + name + ' (' + resp.status + ')');
        bytes = new Uint8Array(await resp.arrayBuffer());
      }
    }

    // one big input buffer; tensors per batch size are views onto it (created lazily, reused)
    var inputData = new Float32Array(maxBatch * PIX);
    var tensors = {};
    function tensorFor(n) {
      if (proxied) return new ort.Tensor('float32', inputData.slice(0, n * PIX), [n, 3, H, W]);   // the worker detaches what it is sent
      return tensors[n] || (tensors[n] = new ort.Tensor('float32', inputData.subarray(0, n * PIX), [n, 3, H, W]));
    }

    var session = null, provider = null, errors = [], dim = 0;
    for (var pi = 0; pi < providers.length; pi++) {
      var p = providers[pi];
      if (p === 'webgpu' && !(typeof navigator !== 'undefined' && navigator.gpu)) { errors.push('webgpu: navigator.gpu missing'); continue; }
      try {
        var s = await ort.InferenceSession.create(bytes, { executionProviders: [p], graphOptimizationLevel: 'all' });
        var o = await s.run({ [s.inputNames[0]]: tensorFor(1) });   // warm-up; WebGPU often fails here
        dim = o[s.outputNames[0]].dims[1];
        session = s; provider = p; break;
      } catch (e) {
        errors.push(p + ': ' + (e && e.message || e));
        log('ReId provider ' + p + ' failed: ' + (e && e.message || e));
      }
    }
    if (!session) throw new Error('ReId: no execution provider worked (' + errors.join(' | ') + ')');
    var inName = session.inputNames[0], outName = session.outputNames[0];

    // Batch sanity check (torchreid issue #585: some ONNX exports give wrong embeddings at batch>1): a batch of 2
    // distinct deterministic patterns must match the same patterns run one by one; else embedMany loops.
    var batched = false;
    if (maxBatch > 1) {
      try {
        for (var i = 0; i < 2 * PIX; i++) inputData[i] = Math.sin(i * 0.0013 + (i >= PIX ? 1.7 : 0)) * 1.2;
        var ob = (await session.run({ [inName]: tensorFor(2) }))[outName].data.slice();
        var o0 = (await session.run({ [inName]: tensorFor(1) }))[outName].data.slice();
        inputData.copyWithin(0, PIX, 2 * PIX);
        var o1 = (await session.run({ [inName]: tensorFor(1) }))[outName].data.slice();
        batched = cosDist(ob.subarray(0, dim), o0) < 1e-3 && cosDist(ob.subarray(dim, 2 * dim), o1) < 1e-3;
      } catch (e) { log('ReId batch check failed: ' + (e && e.message || e)); }
    }

    var canvas = null, ctx = null, rgbaTmp = null;
    function ensureCanvas() {
      if (canvas) return;
      if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(W, H);
      else { canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; }
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    }

    // fill slot `slot` of inputData with the preprocessed crop
    function prepare(source, fw, fh, box, slot) {
      var rect = cropRect(fw, fh, box), rgba;
      if (source.data && source.width && !source.getContext) {        // raw RGBA frame (node / tests)
        rgbaTmp = rgbaTmp || new Uint8ClampedArray(W * H * 4);
        cropResizeRGBA(source.data, fw, fh, rect, rgbaTmp); rgba = rgbaTmp;
      } else {
        ensureCanvas();
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, W, H);
        rgba = ctx.getImageData(0, 0, W, H).data;
      }
      rgbaToNchw(rgba, inputData, slot * PIX);
    }

    var chain = Promise.resolve();
    var r = { provider: provider, lastMs: 0, model: model, dim: dim, batched: batched, maxBatch: maxBatch,
              threads: provider === 'wasm' ? ort.env.wasm.numThreads : 0, providerErrors: errors };

    async function run(n) {
      var t0 = now();
      var res = await session.run({ [inName]: tensorFor(n) });
      r.lastMs = now() - t0;
      var d = res[outName].data, out = new Array(n);
      for (var k = 0; k < n; k++) out[k] = l2norm(Float32Array.prototype.slice.call(d, k * dim, (k + 1) * dim));
      return out;
    }

    r.embedMany = function (source, boxes) {
      var job = chain.then(async function () {
        var wh = srcSize(source), fw = wh[0], fh = wh[1], res = [];
        if (!fw || !fh) return boxes.map(function () { return null; });
        var step = batched ? maxBatch : 1, total = 0, ms = 0;
        for (var i = 0; i < boxes.length; i += step) {
          var n = Math.min(step, boxes.length - i);
          for (var k = 0; k < n; k++) prepare(source, fw, fh, boxes[i + k], k);
          var o = await run(n); total++; ms += r.lastMs;
          for (k = 0; k < n; k++) res.push(o[k]);
        }
        r.lastMs = ms; r.lastRuns = total;
        return res;
      });
      chain = job.catch(function () {});
      return job;
    };
    r.embed = function (source, box) { return r.embedMany(source, [box]).then(function (a) { return a[0]; }); };
    r.dispose = function () { var c = chain; chain = new Promise(function () {}); return c.then(function () { try { return session.release(); } catch (e) {} }); };   // wait for a running job, then release
    r._prepare = function (source, box) {                       // test hook: preprocessed NCHW floats of one crop
      var wh = srcSize(source); prepare(source, wh[0], wh[1], box, 0); return inputData.slice(0, PIX);
    };
    return r;
  }

  var api = { create: create, cosDist: cosDist, _cropRect: cropRect, _cropResizeRGBA: cropResizeRGBA,
              _rgbaToNchw: rgbaToNchw, _l2norm: l2norm, WIDTH: W, HEIGHT: H };
  root.ReId = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
