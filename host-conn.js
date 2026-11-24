/* Connectivity checklist: every link in the chain, with a plain-language fix when one is broken.
   Chain: iPhone (Continuity Camera) -> Mac -> browser camera -> detection -> TV window -> TV/HDMI. */
const Conn = (() => {
  const checks = { files: null, ai: null };

  async function probe() {
    const head = async url => { try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch (e) { return false; } };
    const need = ['vendor/mediapipe/wasm/vision_wasm_internal.wasm', 'vendor/mediapipe/vision_bundle.mjs', 'models/pose_landmarker_lite.task', 'models/yolo26n-pose.onnx', 'vendor/ort/ort.min.js', 'vendor/ort/ort-wasm-simd-threaded.jsep.wasm'];
    const got = await Promise.all(need.map(head));
    checks.missing = need.filter((f, i) => !got[i]);
    checks.files = !checks.missing.length;
    checks.reid = await head('models/osnet_x0_25.onnx');
    try { const r = await fetch('/api/health', { cache: 'no-store' }); checks.ai = r.ok ? await r.json() : false; } catch (e) { checks.ai = false; }
    render();
  }

  function row(state, k, v) { return `<div class="dot ${state}"></div><div class="k">${k}</div><div class="v">${v}</div>`; }

  function render() {
    const el = document.getElementById('connList');
    if (!el || !document.getElementById('setup').open) return;
    const cs = camStatus, rows = [];
    const tvOk = Date.now() - tvSeen < 5000;

    rows.push(row(location.protocol === 'http:' ? 'ok' : 'bad', 'App server',
      location.protocol === 'http:' ? `Running at <b>${location.host}</b> (needed for the camera and for two windows to talk).`
        : `Opened as a file. Double-click <b>start.command</b> instead so the camera and TV window work.`));

    rows.push(row(tvOk ? 'ok' : 'bad', SOLO ? 'Live view' : 'TV window',
      SOLO ? (tvOk ? 'The live view runs inside this page. Project this screen (or press P for full screen) to the TV.' : 'Starting the built-in live view…') : tvOk ? `Connected. ${tvInfo ? `<b>${tvInfo.iw}×${tvInfo.ih}</b>${tvInfo.fs ? ' fullscreen' : ' (not fullscreen yet: click the TV window once)'}` : ''}`
        : `Not open. Press <b>Open TV window</b>, then drag it onto the TV.`));

    if (tvOk && tvInfo && !SOLO) {
      const hostL = screen.availLeft ?? screen.left ?? 0, hostT = screen.availTop ?? screen.top ?? 0;
      const sep = tvInfo.x < hostL - 40 || tvInfo.x >= hostL + screen.width - 40 || tvInfo.y < hostT - 40 || tvInfo.y >= hostT + screen.height - 40;
      rows.push(row(sep ? 'ok' : 'warn', 'TV display',
        sep ? 'The TV window is on a different screen from this one. 👍'
          : `The TV window looks like it is on this screen. Use <b>System Settings → Displays → Extend</b> (not Mirror) and drag the window onto the TV. (Ignore this if you are rehearsing on one screen.)`));
    }

    const cam = !S.cam.on ? ['', 'Camera is off. Turn it on in the Camera tab (or use Practice mode).']
      : ({
        live: [isVirtualCam(cs.label) ? 'warn' : 'ok', `${isVirtualCam(cs.label) ? '<b>This is a virtual camera</b> (software, often slow). Pick your real camera in Setup → Camera. ' : ''}Live: <b>${esc(cs.label || 'camera')}</b>${cs.vw ? ` · ${cs.vw}×${cs.vh}` : ''}${cs.fps ? ` · TV drawing ${cs.fps} fps` : ''}`],
        asking: ['warn', 'Waiting for permission. Click <b>Allow</b> in the <b>TV window</b>.'],
        noperm: ['bad', 'Camera blocked. In the browser: Settings → Websites → Camera → allow <b>localhost</b>, then reload this page. Also check System Settings → Privacy &amp; Security → Camera.'],
        lost: ['bad', `Camera disconnected. Retrying every 3 s. ${esc(cs.err || '')}`],
        error: ['bad', `Camera error: ${esc(cs.err || 'unknown')}`],
        off: ['warn', 'Starting…']
      }[cs.phase] || ['warn', esc(cs.phase)]);
    rows.push(row(cam[0], 'Camera', cam[1]));

    const iph = (cs.devices || []).filter(d => /iphone|continuity|desk view/i.test(d.label));
    if (S.cam.on || (cs.devices || []).length) {
      rows.push(row(iph.length ? 'ok' : (S.cam.on ? 'warn' : ''), 'iPhone (Continuity)',
        iph.length ? `Found: ${iph.map(d => '<b>' + esc(d.label) + '</b>').join(', ')}.${/iphone/i.test(cs.label || '') ? ' Using it now.' : ' Pick it under “Which camera”.'}`
          : `Not listed. Check: iPhone unlocked and near the Mac · same Apple ID on both · Wi-Fi and Bluetooth on (no hotspot or AirPlay in use) · iPhone on the tripod in landscape · no other app using the camera. Seen: ${(cs.devices || []).map(d => esc(d.label)).join(', ') || 'none'}.`));
    }
    if (cs.phase === 'live' && cs.vw) rows.push(row(cs.vw >= 1280 ? 'ok' : 'warn', 'Picture size', cs.vw >= 1280 ? `${cs.vw}×${cs.vh} is plenty.` : `Only ${cs.vw}×${cs.vh}. Detection still works, but the picture will look soft.`));

    const d = cs.det || {};
    const det = !S.cam.on && !S.cam.sim ? ['', 'Off.']
      : S.cam.sim ? ['warn', 'Practice mode: fake players, no model running.']
        : !S.cam.detect ? ['', 'Off (kites disabled).']
          : d.state === 'running' ? [d.ms > 140 ? 'warn' : 'ok', `${d.engine ? '<b>' + esc(d.engine) + '</b> · ' : ''}Running · <b>${d.ms} ms</b> per frame · ${d.hz ? d.hz.toFixed(1) : 0}/s. ${d.ms > 140 ? 'Slow: pick “Gentle”, close other tabs, let the Mac cool.' : 'Healthy.'}`]
            : d.state === 'loading' ? ['warn', 'Loading the model (a few seconds the first time)…']
              : d.state === 'error' ? ['bad', `Model failed: ${esc(d.err || 'unknown')}. Try turning GPU off, or reload the TV window.`]
                : ['warn', 'Waiting for the camera.'];
    rows.push(row(d.reid ? 'ok' : '', 'Re-identification', d.reid ? `<b>${esc(d.reid)}</b>${d.reidMs ? ' · ' + d.reidMs + ' ms' : ''}. Keeps each person's color when people cross or leave and come back.` : (d.reidErr ? 'Not available (' + esc(d.reidErr) + '). Using clothing colour matching instead.' : 'Clothing colour matching only (re-ID model not loaded).')));
    rows.push(row(det[0], 'Person detection', det[1] + (d.bench ? ` <i>Speed test: ${esc(d.bench)}.</i>` : '') + (d.provErr ? ` <i>Why not WebGPU: ${esc(d.provErr)}</i>` : '') + (d.yoloNote ? ` <i>${esc(d.yoloNote)}</i>` : '') + (d.err ? ` <i>${esc(d.err)}</i>` : '')));
    if (cs.phase === 'live' || S.cam.sim) rows.push(row('', 'People', `<b>${cs.people.frame}</b> in view · <b>${cs.people.square}</b> inside the play square · ${live.length} with a kite.`));

    if (cs.phase === 'live' || S.cam.sim) rows.push(row(cs.recSec >= 2 ? (cs.recFps >= 45 ? 'ok' : 'warn') : 'warn', 'Replay recorder', cs.recSec >= 2 ? `Recording <b>${cs.recFps} pictures/s</b>, last ${cs.recSec.toFixed(1)} s saved. ${cs.recFps >= 45 ? 'Smooth slow motion ready.' : 'Camera is giving under 45 fps, so slow motion is blended to stay smooth.'}` : `Filling up (${cs.buf || 0} pictures). Wait about 3 seconds after the camera starts.`));
    rows.push(row(checks.files == null ? '' : checks.files ? 'ok' : 'bad', 'Offline files', checks.files == null ? 'Checking…' : checks.files ? 'Detection library and model are on this Mac. No internet needed during the event.' : 'Missing: ' + checks.missing.join(', ') + '. Camera works but people detection may not.'));
    rows.push(row(checks.ai && checks.ai.ok ? (checks.ai.envKey || localStorage.getItem('akf-nim-key') ? 'ok' : 'warn') : '', 'AI parser (optional)',
      checks.ai && checks.ai.ok ? (checks.ai.envKey || localStorage.getItem('akf-nim-key') ? 'Ready (NVIDIA key set).' : 'Server ready; add a free NVIDIA key in the Questions import tab to use it.') : 'Not needed unless you press “Ask AI”.'));
    rows.push(row('', 'Sound', 'TV speakers are weak: use the Mac headphone jack or Bluetooth to a small speaker. Set the output in the Mac menu bar (Sound). Sound effects come in a later step.'));
    rows.push(row('warn', 'Heat &amp; power', 'The M2 Air has no fan. Keep it on a hard surface with airflow and plugged in, close other tabs, and keep the iPhone plugged in too (streaming drains it fast). Browsers cannot read battery or temperature here, so watch “ms per frame” above: if it climbs, switch detection to Gentle.'));
    rows.push(row('ok', 'Scores', 'Saved automatically in this browser, so a reload will not lose them.'));
    rows.push(row('', 'Full self-check', '<a href="check.html" target="_blank">Open the self-check page</a> in a new tab: tests your camera speed, WebGPU, the models and the replay recorder, and gives you a report to copy.'));
    el.innerHTML = rows.join('');
  }

  probe(); setInterval(probe, 20000);
  return { render };
})();
window.Conn = Conn;
