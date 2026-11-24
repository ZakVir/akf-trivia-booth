// Run: node tests/yolo/yolo-pose.test.js   (from the project root or anywhere)
// Runs the REAL yolo-pose.js decode on REAL model output from onnxruntime-web (wasm backend, in node)
// for both models, using bus.jpg pre-letterboxed to 640x640 (810x1080 source, scale .5926, padX 80).
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..', '..');
const YoloPose = require(path.join(ROOT, 'yolo-pose.js'));

const rgb = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'bus640_letterbox.rgb.gz')));
assert.strictEqual(rgb.length, 640 * 640 * 3);
const rgba = new Uint8Array(640 * 640 * 4);
for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { rgba[j] = rgb[i]; rgba[j + 1] = rgb[i + 1]; rgba[j + 2] = rgb[i + 2]; rgba[j + 3] = 255; }

// 1) pure letterbox math incl. crop region
{
  const lb = YoloPose._letterbox(810, 1080);
  assert(Math.abs(lb.scale - 640 / 1080) < 1e-9 && Math.abs(lb.padX - 80) < 1e-6 && lb.padY === 0);
  const c = YoloPose._letterbox(1920, 1080, { x: 0.5, y: 0, w: 0.5, h: 1 });   // right half, 960x1080
  assert(Math.abs(c.sx - 960) < 1e-9 && Math.abs(c.scale - 640 / 1080) < 1e-9);
  // a point at the crop's center (letterbox 320,320) maps to source (1440, 540) -> normalized (.75,.5)
  const d = new Float32Array(300 * 57); d[0] = 300; d[1] = 300; d[2] = 340; d[3] = 340; d[4] = .9;
  const p = YoloPose._decode(d, [1, 300, 57], c, 0.35, 12)[0];
  assert(Math.abs((p.box.x0 + p.box.x1) / 2 - 0.75) < 0.01 && Math.abs((p.box.y0 + p.box.y1) / 2 - 0.5) < 0.01);
  console.log('ok  letterbox / crop un-mapping');
}

// 2) legacy [1,56,A] decode + NMS on a synthetic tensor
{
  const A = 10, d = new Float32Array(56 * A), lb = YoloPose._letterbox(640, 640);
  const put = (i, cx, cy, w, h, s) => { d[i] = cx; d[A + i] = cy; d[2 * A + i] = w; d[3 * A + i] = h; d[4 * A + i] = s; for (let k = 0; k < 17; k++) { d[(5 + 3 * k) * A + i] = cx; d[(6 + 3 * k) * A + i] = cy; d[(7 + 3 * k) * A + i] = .8; } };
  put(0, 200, 300, 100, 200, .9); put(1, 202, 301, 100, 200, .8); put(2, 500, 300, 80, 160, .7);
  const r = YoloPose._decode(d, [1, 56, A], lb, .35, 12);
  assert.strictEqual(r.length, 2); assert(r[0].score > r[1].score && r[0].kp.length === 17);
  console.log('ok  legacy [1,56,N] decode + NMS');
}

(async () => {
  const bus = { W: 810, H: 1080 };
  for (const m of ['n', 's']) {
    const det = await YoloPose.create({ model: m, ortBase: path.join(ROOT, 'vendor/ort'), modelBase: path.join(ROOT, 'models'), providers: ['wasm'] });
    assert.strictEqual(det.provider, 'wasm');
    det._fillFromRGBA(rgba);
    const lb = YoloPose._letterbox(bus.W, bus.H);
    let people = await det._infer(lb);
    const ms = [];
    for (let i = 0; i < 20; i++) { people = await det._infer(lb); ms.push(det.lastMs); }
    ms.sort((a, b) => a - b);
    const med = ms[ms.length >> 1];
    console.log(`model ${m}: provider=${det.provider} threads=${det.threads} people=${people.length} median ${med.toFixed(1)} ms (min ${ms[0].toFixed(1)}, max ${ms[ms.length - 1].toFixed(1)})`);
    assert(people.length >= 3, 'need >=3 people, got ' + people.length);
    assert(people.length <= 12);
    for (const p of people) {
      for (const v of [p.box.x0, p.box.y0, p.box.x1, p.box.y1]) assert(v >= 0 && v <= 1);
      assert(p.box.x1 > p.box.x0 && p.box.y1 > p.box.y0);
      assert.strictEqual(p.kp.length, 17);
      for (const k of p.kp) { assert(k.x >= 0 && k.x <= 1 && k.y >= 0 && k.y <= 1 && k.v >= 0 && k.v <= 1); }
      assert(p.score >= 0.35 && p.score <= 1);
    }
    // confident, tall (full-body) detections: wrists/ankles plausible
    const full = people.filter(p => p.score > 0.7);
    assert(full.length >= 3);
    for (const p of full) {
      const bw = p.box.x1 - p.box.x0, bh = p.box.y1 - p.box.y0;
      assert(bh > 0.15, 'person box height ' + bh);
      const nose = p.kp[0], ank = [p.kp[15], p.kp[16]], wr = [p.kp[9], p.kp[10]];
      const best = a => a.reduce((x, y) => (x.v >= y.v ? x : y));
      const a = best(ank), w = best(wr);
      assert(a.y > nose.y, 'ankle should be below nose');                    // feet below head
      assert(a.y > p.box.y0 + 0.6 * bh, 'ankle in lower part of the box');
      const inb = (k) => k.x >= p.box.x0 - 0.1 && k.x <= p.box.x1 + 0.1 && k.y >= p.box.y0 - 0.05 && k.y <= p.box.y1 + 0.05;
      assert(inb(a) && inb(w), 'wrist/ankle near the box');
      assert(w.y > nose.y && w.y < a.y, 'wrist between head and feet');
    }
    // known bus.jpg geometry: leftmost person's box around x 0.0-0.27 (source px 0..220 of 810 wide)
    const left = people.slice().sort((a, b) => a.box.x0 - b.box.x0)[0];
    console.log('   leftmost box', JSON.stringify(left.box, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
    people.forEach((p, i) => console.log(`   #${i} score ${p.score.toFixed(2)} nose(${p.kp[0].x.toFixed(2)},${p.kp[0].y.toFixed(2)},v${p.kp[0].v.toFixed(2)}) rwrist(${p.kp[10].x.toFixed(2)},${p.kp[10].y.toFixed(2)},v${p.kp[10].v.toFixed(2)}) lankle(${p.kp[15].x.toFixed(2)},${p.kp[15].y.toFixed(2)},v${p.kp[15].v.toFixed(2)})`));
    console.log('ok  model ' + m + ' decode assertions');
    det.dispose();
  }
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
