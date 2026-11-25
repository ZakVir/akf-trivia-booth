// Offline detection cache for the accuracy harness: runs the REAL YOLO26 model (onnxruntime-web wasm, in node) on
// video clips at the booth's detection rate and saves every person (box, score, 17 keypoints) per frame to JSON.
// Usage: node tests/eval/detect-clips.js <outDir> <clip.mp4> [more clips...]   (env FPS=12, MODEL=n|s)
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const YoloPose = require(path.join(ROOT, 'yolo-pose.js'));
const FPS = +(process.env.FPS || 12), MODEL = process.env.MODEL || 'n', S = 640;

function probe(f) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);
  return { w, h };
}
async function run(det, clip, outDir) {
  const { w, h } = probe(clip), lb = YoloPose._letterbox(w, h);
  const vf = `fps=${FPS},scale=${Math.round(lb.dw)}:${Math.round(lb.dh)},pad=${S}:${S}:${Math.round(lb.padX)}:${Math.round(lb.padY)}:color=0x727272`;
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', clip, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  const FRAME = S * S * 4, frames = []; let buf = Buffer.alloc(0), ms = 0;
  const queue = []; ff.stdout.on('data', c => { buf = Buffer.concat([buf, c]); while (buf.length >= FRAME) { queue.push(buf.subarray(0, FRAME)); buf = buf.subarray(FRAME); } });
  const done = new Promise(r => ff.on('close', r)); let closed = false; done.then(() => { closed = true; });
  for (let i = 0; ; i++) {
    while (!queue.length && !closed) await new Promise(r => setTimeout(r, 5));
    if (!queue.length) break;
    const f = queue.shift(); det._fillFromRGBA(new Uint8Array(f.buffer, f.byteOffset, FRAME));
    const t0 = Date.now(), people = await det._infer(lb); ms += Date.now() - t0;
    frames.push({ t: i / FPS, people: people.map(p => ({ box: p.box, score: +p.score.toFixed(3), kp: p.kp.map(k => [+k.x.toFixed(4), +k.y.toFixed(4), +k.v.toFixed(3)]) })) });
  }
  const name = path.basename(clip, path.extname(clip));
  fs.writeFileSync(path.join(outDir, `${name}.${MODEL}.json`), JSON.stringify({ clip: name, w, h, fps: FPS, model: MODEL, frames }));
  console.log(`${name}: ${frames.length} frames, ${(ms / frames.length).toFixed(0)} ms/frame, avg people ${(frames.reduce((a, f) => a + f.people.length, 0) / frames.length).toFixed(1)}`);
}
(async () => {
  const [outDir, ...clips] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
  const det = await YoloPose.create({ model: MODEL, ortBase: path.join(ROOT, 'vendor/ort'), modelBase: path.join(ROOT, 'models'), providers: ['wasm'], scoreThr: 0.2, maxPeople: 20 });
  for (const c of clips) await run(det, c, outDir);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
