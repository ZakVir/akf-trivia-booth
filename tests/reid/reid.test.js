// Run: node tests/reid/reid.test.js   (from anywhere)
// Real reid.js preprocessing + real OSNet ONNX via onnxruntime-web (wasm, node) on tests/yolo/bus.jpg
// (pre-decoded to tests/reid/bus.rgb.gz, 810x1080 RGB). Person boxes come from the real yolo26n-pose model
// through yolo-pose.js (same pipeline as tests/yolo). For each model: embed each person, then again from a
// shifted+scaled crop and a horizontally flipped frame; same-person distance must be clearly below every
// different-person distance. Also checks batched == looped embeddings and prints the distance matrix + timings.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..', '..');
const ReId = require(path.join(ROOT, 'reid.js'));
const YoloPose = require(path.join(ROOT, 'yolo-pose.js'));
const FW = 810, FH = 1080;

const rgb = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'bus.rgb.gz')));
assert.strictEqual(rgb.length, FW * FH * 3);
const rgba = new Uint8ClampedArray(FW * FH * 4);
for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { rgba[j] = rgb[i]; rgba[j + 1] = rgb[i + 1]; rgba[j + 2] = rgb[i + 2]; rgba[j + 3] = 255; }
const frame = { data: rgba, width: FW, height: FH };
const flipped = new Uint8ClampedArray(rgba.length);
for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const a = (y * FW + x) * 4, b = (y * FW + (FW - 1 - x)) * 4; for (let k = 0; k < 4; k++) flipped[b + k] = rgba[a + k]; }
const flipFrame = { data: flipped, width: FW, height: FH };

const f2 = v => v.toFixed(3);
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];

// 1) pure helpers
{
  const r = ReId._cropRect(1000, 1000, { x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.6 });
  assert(Math.abs(r.sx - 194) < 1e-6 && Math.abs(r.sw - 212) < 1e-6 && Math.abs(r.sy - 188) < 1e-6 && Math.abs(r.sh - 424) < 1e-6);
  const c = ReId._cropRect(1000, 500, { x0: -0.1, y0: 0.9, x1: 0.3, y1: 1.4 });          // clamped to frame
  assert(c.sx === 0 && c.sy + c.sh <= 500 + 1e-9 && c.sw > 0);
  const t = ReId._cropRect(100, 100, { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 });             // degenerate -> 2x2 min
  assert(t.sw >= 2 && t.sh >= 2);
  const a = new Float32Array(3), b = new Float32Array([1, 0, 0]); a[0] = 1;
  assert(Math.abs(ReId.cosDist(a, b)) < 1e-9 && Math.abs(ReId.cosDist(a, new Float32Array([0, 1, 0])) - 1) < 1e-9);
  // flat gray crop -> every channel = (v/255-mean)/std
  const flat = { data: new Uint8ClampedArray(64 * 64 * 4).fill(128), width: 64, height: 64 };
  const out = new Uint8ClampedArray(128 * 256 * 4); ReId._cropResizeRGBA(flat.data, 64, 64, { sx: 0, sy: 0, sw: 64, sh: 64 }, out);
  assert(out[0] === 128 && out[3] === 255);
  const f = new Float32Array(3 * 128 * 256); ReId._rgbaToNchw(out, f, 0);
  assert(Math.abs(f[0] - (128 / 255 - 0.485) / 0.229) < 1e-5 && Math.abs(f[2 * 128 * 256] - (128 / 255 - 0.406) / 0.225) < 1e-5);
  console.log('ok  crop rect / bilinear / normalise / cosDist helpers');
}

(async () => {
  // person boxes from the real detector, on the same letterboxed bus fixture tests/yolo uses
  const lbrgb = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'tests/yolo/bus640_letterbox.rgb.gz')));
  const lbrgba = new Uint8Array(640 * 640 * 4);
  for (let i = 0, j = 0; i < lbrgb.length; i += 3, j += 4) { lbrgba[j] = lbrgb[i]; lbrgba[j + 1] = lbrgb[i + 1]; lbrgba[j + 2] = lbrgb[i + 2]; lbrgba[j + 3] = 255; }
  const det = await YoloPose.create({ model: 'n', ortBase: path.join(ROOT, 'vendor/ort'), modelBase: path.join(ROOT, 'models'), providers: ['wasm'] });
  det._fillFromRGBA(lbrgba);
  let people = await det._infer(YoloPose._letterbox(FW, FH));
  det.dispose();
  console.log('all detections:', people.map(p => p.score.toFixed(2) + '@' + [p.box.x0, p.box.y0, p.box.x1, p.box.y1].map(f2).join(',')).join(' '));
  people = people.filter(p => p.score > 0.5 && (p.box.y1 - p.box.y0) > 0.2 && (p.box.x1 - p.box.x0) > 0.04);
  assert(people.length >= 3, 'need >=3 people, got ' + people.length);
  people.sort((a, b) => a.box.x0 - b.box.x0);
  const boxes = people.map(p => p.box);
  console.log('persons:', boxes.map((b, i) => `#${i}[${f2(b.x0)},${f2(b.y0)},${f2(b.x1)},${f2(b.y1)}]`).join(' '));
  fs.writeFileSync(path.join(__dirname, 'boxes.json'), JSON.stringify(boxes.map(b => [b.x0, b.y0, b.x1, b.y1].map(v => +v.toFixed(5)))));

  const shifted = boxes.map(b => {            // +2.5% of box size shifted, 6% larger
    const w = b.x1 - b.x0, h = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2 + 0.025 * w, cy = (b.y0 + b.y1) / 2 - 0.025 * h;
    return { x0: cx - 0.53 * w, x1: cx + 0.53 * w, y0: cy - 0.53 * h, y1: cy + 0.53 * h };
  });
  const flipBoxes = boxes.map(b => ({ x0: 1 - b.x1, x1: 1 - b.x0, y0: b.y0, y1: b.y1 }));

  for (const m of ['ain', 'x025']) {
    const r = await ReId.create({ model: m, ortBase: path.join(ROOT, 'vendor/ort'), modelBase: path.join(ROOT, 'models'), providers: ['wasm'] });
    assert.strictEqual(r.provider, 'wasm'); assert.strictEqual(r.dim, 512);
    const A = await r.embedMany(frame, boxes);                       // batched
    const B = await r.embedMany(frame, shifted);
    const C = await r.embedMany(flipFrame, flipBoxes);
    for (const e of [].concat(A, B, C)) {
      assert(e instanceof Float32Array && e.length === 512);
      let n = 0; for (const v of e) n += v * v; assert(Math.abs(n - 1) < 1e-4, 'L2 norm ' + n);
    }
    // batch == loop
    const single = [];
    for (const b of boxes) single.push(await r.embed(frame, b));
    let worst = 0; single.forEach((e, i) => { worst = Math.max(worst, ReId.cosDist(e, A[i])); });
    assert(worst < 1e-4, 'batched vs single cosDist ' + worst);
    // timings (single embed, wasm, node)
    const ts = []; for (let i = 0; i < 15; i++) { await r.embed(frame, boxes[0]); ts.push(r.lastMs); }
    await r.embedMany(frame, boxes); const batchMs = r.lastMs;

    const N = boxes.length;
    console.log(`\nmodel ${m}: provider=${r.provider} threads=${r.threads} dim=${r.dim} batched=${r.batched}  ${med(ts).toFixed(1)} ms/embed (median of 15), ${N} people in one embedMany: ${batchMs.toFixed(1)} ms total (${(batchMs / N).toFixed(1)} ms each)`);
    console.log('cosDist matrix, rows = original crop, cols = [shifted/scaled #0..] | [flipped #0..]');
    let maxSame = 0, minDiff = 9;
    for (let i = 0; i < N; i++) {
      const row = [];
      for (let j = 0; j < N; j++) { const d = ReId.cosDist(A[i], B[j]); row.push(f2(d)); if (i === j) maxSame = Math.max(maxSame, d); else minDiff = Math.min(minDiff, d); }
      row.push('|');
      for (let j = 0; j < N; j++) { const d = ReId.cosDist(A[i], C[j]); row.push(f2(d)); if (i === j) maxSame = Math.max(maxSame, d); else minDiff = Math.min(minDiff, d); }
      console.log(`  #${i}  ` + row.join(' '));
    }
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) minDiff = Math.min(minDiff, ReId.cosDist(A[i], A[j]));
    console.log(`  same-person max ${f2(maxSame)}   different-person min ${f2(minDiff)}   margin x${(minDiff / maxSame).toFixed(1)}`);
    assert(maxSame < minDiff, 'same-person must be below every different-person distance');
    assert(minDiff - maxSame > 0.05 && maxSame < 0.5 * minDiff, 'clear separation required');
    // nearest-neighbour identity for every variant
    for (let i = 0; i < N; i++) for (const V of [B, C]) {
      let best = 0; for (let j = 1; j < N; j++) if (ReId.cosDist(A[i], V[j]) < ReId.cosDist(A[i], V[best])) best = j;
      assert.strictEqual(best, i);
    }
    r.dispose();
    console.log('ok  model ' + m);
  }
  console.log('\nALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
