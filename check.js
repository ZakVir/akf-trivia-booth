/* One-click self-check for the booth machine. Tests never overlap; one failure never stops the rest. */
const $ = id => document.getElementById(id);
const rows = $('rows'), out = $('out'), report = [];
let stream = null, busy = false;
const BLOCKED = /imaging edge|sony camera/i, VIRTUAL = /imaging edge|sony camera|\bobs\b|virtual|\bndi\b|snap camera|manycam|\bcamo\b|epoccam|droidcam|splitcam|xsplit|streamlabs|mmhmm|ecamm|yosei|zoom|teams|blackmagic|screen/i;
const rank = l => VIRTUAL.test(l) ? 9 : /desk view/i.test(l) ? 5 : /facetime|built-in|macbook/i.test(l) ? 0 : /iphone|ipad|continuity/i.test(l) ? 2 : 3;
function add(state, k, v) {
  const d = document.createElement('div'); d.className = 'row';
  d.innerHTML = `<div class="dot ${state}"></div><div class="k"></div><div class="v"></div>`; d.children[1].textContent = k; d.children[2].textContent = v; rows.appendChild(d);
  report.push(`[${{ ok: 'OK ', warn: 'WARN', bad: 'FAIL', '': '    ' }[state]}] ${k}: ${v}`); out.textContent = report.join('\n');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// every test runs through here: only one at a time, buttons disabled while busy
async function run(name, fn) {
  if (busy) { add('warn', name, 'skipped: another test is still running'); return; }
  busy = true; document.querySelectorAll('button').forEach(b => { if (b.id !== 'bCopy') b.disabled = true; });
  try { await fn(); } catch (e) { add('bad', name, 'error: ' + ((e && e.message) || e)); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
}

async function basic() {
  add('', 'Browser', navigator.userAgent);
  add(location.protocol === 'http:' && location.hostname === 'localhost' || location.protocol === 'https:' ? 'ok' : 'bad', 'Secure page', `${location.protocol}//${location.host} (needs http://localhost, not a file)`);
  add(self.crossOriginIsolated ? 'ok' : 'warn', 'Cross-origin isolated', String(self.crossOriginIsolated) + (self.crossOriginIsolated ? ' (multi-threaded wasm possible)' : ' (single-threaded wasm only; restart start.command so the server sends the new headers)'));
  const need = [['getUserMedia', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)], ['requestVideoFrameCallback', 'requestVideoFrameCallback' in HTMLVideoElement.prototype],
    ['createImageBitmap', typeof createImageBitmap === 'function'], ['canvas.toBlob', typeof HTMLCanvasElement.prototype.toBlob === 'function'], ['BroadcastChannel', typeof BroadcastChannel === 'function'],
    ['ResizeObserver', typeof ResizeObserver === 'function'], ['WebAssembly', typeof WebAssembly === 'object']];
  for (const [n, ok] of need) add(ok ? 'ok' : (n === 'requestVideoFrameCallback' ? 'warn' : 'bad'), n, ok ? 'supported' : 'MISSING' + (n === 'requestVideoFrameCallback' ? ' (recorder falls back to a 60/s timer)' : ''));
  if (navigator.gpu) {
    try { const a = await navigator.gpu.requestAdapter(); add(a ? 'ok' : 'warn', 'WebGPU', a ? 'adapter found: ' + ((a.info && (a.info.description || a.info.vendor)) || 'yes') : 'navigator.gpu exists but no adapter'); }
    catch (e) { add('warn', 'WebGPU', 'adapter request failed: ' + e.message); }
  } else add('warn', 'WebGPU', 'not available in this browser');
  for (const f of ['models/yolo26n-pose.onnx', 'models/yolo26s-pose.onnx', 'models/osnet_ain_x1_0.onnx', 'models/osnet_x0_25.onnx', 'models/pose_landmarker_lite.task', 'vendor/ort/ort.min.js', 'vendor/ort/ort-wasm-simd-threaded.jsep.wasm', 'vendor/mediapipe/vision_bundle.mjs', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm']) {
    try { const r = await fetch(f, { method: 'HEAD', cache: 'no-store' }); const n = +r.headers.get('content-length') || 0; add(r.ok ? 'ok' : (f.includes('osnet') ? 'warn' : 'bad'), f, r.ok ? (n / 1048576).toFixed(1) + ' MB' : 'missing (' + r.status + ')'); }
    catch (e) { add('bad', f, 'could not fetch'); }
  }
  try {
    const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d'); g.fillStyle = '#f90'; g.fillRect(0, 0, 480, 270);
    const t0 = performance.now(); const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72)); const t1 = performance.now(); const bmp = await createImageBitmap(blob); const t2 = performance.now();
    add(blob && bmp ? 'ok' : 'bad', 'Replay image round trip', `JPEG ${(blob.size / 1024).toFixed(0)} KB, encode ${(t1 - t0).toFixed(1)} ms, decode ${(t2 - t1).toFixed(1)} ms`); bmp.close();
  } catch (e) { add('bad', 'Replay image round trip', e.message); }
}

async function fillCameraList() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.label && !BLOCKED.test(d.label));
  const sel = $('camSel'), keep = sel.value;
  sel.innerHTML = '<option value="">Automatic (best real camera)</option>' + devs.sort((a, b) => rank(a.label) - rank(b.label)).map(d => `<option value="${d.deviceId}">${d.label}${VIRTUAL.test(d.label) ? ' (virtual camera)' : ''}</option>`).join('');
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  return devs;
}
async function openCamera(deviceId) {
  return navigator.mediaDevices.getUserMedia({ video: Object.assign({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 120 } }, deviceId ? { deviceId: { exact: deviceId } } : {}), audio: false });
}
async function camera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  let s = await openCamera($('camSel').value);
  let devs = await fillCameraList();
  const first = s.getVideoTracks()[0].label;
  if (!$('camSel').value && (BLOCKED.test(first) || (devs[0] && rank(first) > rank(devs[0].label)))) {          // the browser's default is a blocked/virtual camera: use the best real one
    s.getTracks().forEach(t => t.stop());
    if (devs[0]) { s = await openCamera(devs[0].deviceId); add('warn', 'Default camera skipped', `${first} is not a real camera; using ${devs[0].label}`); }
    else { add('bad', 'Camera', `Only a blocked or virtual camera is available (${first})`); return; }
  }
  stream = s;
  const v = $('v'); v.srcObject = stream; await v.play();
  const tr = stream.getVideoTracks()[0], st = tr.getSettings();
  add('ok', 'Camera', `${tr.label}  ${st.width}x${st.height}  asked 60 fps, setting says ${st.frameRate || '?'} fps`);
  add('', 'Cameras shown to the app', devs.map(d => d.label).join(' | ') + '  (Sony Imaging Edge is blocked and hidden)');
  if (!v.requestVideoFrameCallback) { add('warn', 'Real frame rate', 'cannot measure (no requestVideoFrameCallback)'); return; }
  let n = 0, t0 = 0, last = 0, maxGap = 0;
  await new Promise(res => { const cb = (now) => { if (!t0) t0 = now; else maxGap = Math.max(maxGap, now - last); last = now; n++; if (now - t0 < 3000) v.requestVideoFrameCallback(cb); else res(); }; v.requestVideoFrameCallback(cb); });
  const fps = (n - 1) * 1000 / (last - t0);
  add(fps >= 55 ? 'ok' : fps >= 28 ? 'warn' : 'bad', 'Real camera frame rate', `${fps.toFixed(1)} fps over 3 s (longest gap ${maxGap.toFixed(0)} ms). ` + (fps >= 55 ? 'Great for slow motion.' : fps >= 28 ? 'Normal webcam speed; slow motion uses frame blending.' : 'Very slow: wrong camera, a busy Mac, or a virtual camera.'));
}

async function yolo() {
  if (typeof YoloPose === 'undefined') { add('bad', 'YOLO', 'yolo-pose.js did not load'); return; }
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d');
  const src = stream && $('v').videoWidth ? $('v') : c; if (src === c) { g.fillStyle = '#888'; g.fillRect(0, 0, 1280, 720); }
  const best = {};
  for (const size of ['n', 's']) for (const prov of ['webgpu', 'wasm']) {
    try {
      const t0 = performance.now();
      const d = await YoloPose.create({ model: size, ortBase: 'vendor/ort/', modelBase: 'models/', providers: [prov], scoreThr: 0.35, maxPeople: 10 });
      const load = performance.now() - t0; const ms = [];
      for (let i = 0; i < 12; i++) { const a = performance.now(); await d.detect(src); ms.push(performance.now() - a); await sleep(5); }
      ms.sort((a, b) => a - b); const med = ms[Math.floor(ms.length / 2)];
      add(med < 100 ? 'ok' : med < 200 ? 'warn' : 'bad', `YOLO26${size} on ${prov}${prov === 'wasm' ? ' (' + (d.threads || 1) + ' threads)' : ''}`, `load ${(load / 1000).toFixed(1)} s, median ${med.toFixed(0)} ms per frame (about ${(1000 / med).toFixed(0)} detections/s)`);
      if (!best[size] || med < best[size].ms) best[size] = { prov, ms: med };
      if (d.dispose) d.dispose();
    } catch (e) { add('warn', `YOLO26${size} on ${prov}`, 'could not run: ' + ((e && e.message) || e)); }
  }
  for (const size of Object.keys(best)) add('ok', `Fastest for YOLO26${size}`, `${best[size].prov} at ${best[size].ms.toFixed(0)} ms. The booth app measures this itself on first start and remembers it.`);
}

async function recorder() {
  if (!stream) await camera();
  const v = $('v'), c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d');
  let frames = 0, done = 0, pending = 0, shed = 0, bytes = 0; const t0 = performance.now();
  await new Promise(res => {
    const cb = () => {
      frames++;
      if (pending < 4) { g.drawImage(v, 0, 0, 480, 270); pending++; c.toBlob(b => { pending--; if (b) { done++; bytes += b.size; } }, 'image/jpeg', 0.72); } else shed++;
      if (performance.now() - t0 < 4000) v.requestVideoFrameCallback(cb); else res();
    };
    v.requestVideoFrameCallback(cb);
  });
  await sleep(300);
  const sec = (performance.now() - t0) / 1000, fps = done / sec;
  add(fps >= 55 ? 'ok' : fps >= 28 ? 'warn' : 'bad', 'Replay recorder speed', `saved ${done} of ${frames} camera frames in ${sec.toFixed(1)} s = ${fps.toFixed(0)}/s, skipped ${shed}. 9 s of replay memory is about ${(bytes / sec * 9 / 1048576).toFixed(1)} MB.`);
}

$('bBasic').onclick = () => run('Browser + files', basic);
$('bCam').onclick = () => run('Camera', camera);
$('bYolo').onclick = () => run('YOLO', yolo);
$('bRec').onclick = () => run('Recorder', recorder);
$('bAll').onclick = () => run('Run all', async () => {
  const steps = [['Browser + files', basic], ['Camera', camera], ['YOLO', yolo], ['Recorder', recorder]];
  for (const [n, f] of steps) { try { await f(); } catch (e) { add('bad', n, 'error: ' + ((e && e.message) || e)); } }
  add('', 'Done', 'Copy the report and send it over.');
});
$('bCopy').onclick = async () => { try { await navigator.clipboard.writeText(report.join('\n')); $('bCopy').textContent = 'Copied!'; } catch (e) { const r = document.createRange(); r.selectNodeContents(out); getSelection().removeAllRanges(); getSelection().addRange(r); } };
