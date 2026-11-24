/* Host view core: owns ALL game state and tells the TV window what to show. */
const KEY = 'akf-booth-state-v3', QKEY = 'akf-questions-v1';
const $ = id => document.getElementById(id);
const SOLO = true;   // one window only: the live view runs inside this page; the Mac screen is what gets projected

const stored = (() => { try { const l = JSON.parse(localStorage.getItem(QKEY)); return Array.isArray(l) && l.length ? l : null; } catch (e) { return null; } })();
const SAMPLE_QUESTIONS = (window.QUESTIONS || []).slice();     // the built-in set from questions.js (copied before a saved import replaces it)
if (stored) window.QUESTIONS = stored;

const DEFAULT_CAM = { on: true, deviceId: '', detect: true, sim: false, simN: 5, mirror: true, showQuad: false, kites: true, gpu: false, detHz: 12, ignoreQuad: true, debug: false, mode: 'fast', sens: 'normal', engine: 'auto', handSens: 'normal', simDup: false, buzzer: true, preferBuiltIn: true, quad: DEFAULT_QUAD, tape: null };
const zeroScores = () => Object.fromEntries(TEAM_ORDER.map(t => [t, 0]));
const fresh = () => ({
  qId: 0, step: 0, kid: false, filter: 'all', teams: ['red', 'blue', 'gold'],
  scores: zeroScores(), streaks: zeroScores(),
  timer: { duration: 30, total: 30000, left: 30000, running: false, endsAt: 0 },
  cam: { ...DEFAULT_CAM }, board: []
});
let S;
try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); S = Object.assign(fresh(), o); S.cam = Object.assign({}, DEFAULT_CAM, o.cam || {}); S.scores = Object.assign(zeroScores(), S.scores); S.streaks = Object.assign(zeroScores(), S.streaks); }
catch (e) { S = fresh(); }
if (S.qId >= QUESTIONS.length) S.qId = 0;
S.cam.sim = false; S.cam.debug = false;      // a reload never comes back in practice mode or with debug dots

let buzz = null, orderList = [];
let history = [], tvSeen = 0, tvInfo = null, camStatus = { phase: 'off', devices: [], det: { state: 'off' }, people: { frame: 0, square: 0 } }, live = [];

/* ---------- board: which colors are playing ---------- */
const camDriving = () => (S.cam.sim) || (S.cam.on && S.cam.detect && camStatus.phase === 'live' && camStatus.det && camStatus.det.state === 'running');   // detector down = fall back to manual player tiles
function computeBoard() {
  const base = new Set(camDriving() ? live : S.teams);
  for (const t of TEAM_ORDER) if (S.scores[t] > 0) base.add(t);
  for (const o of orderList) base.add(o.color);                         // whoever raised a hand can always be given the point
  return TEAM_ORDER.filter(t => base.has(t));
}

function commit(event) {
  S.board = computeBoard();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  CH.postMessage({ type: 'state', state: S, event: event || null });
  renderHost();
}
const evt = (type, extra) => Object.assign({ type, id: Date.now() + Math.random() }, extra);
function setCam(patch) { Object.assign(S.cam, patch); commit(); }
function publishQuestions() { CH.postMessage({ type: 'questions', list: window.QUESTIONS }); }
function saveQuestions(list) {
  window.QUESTIONS = list;
  try { localStorage.setItem(QKEY, JSON.stringify(list)); } catch (e) {}
  if (S.qId >= list.length) S.qId = 0;
  S.step = 0; publishQuestions(); commit();
}

/* ---------- navigation ---------- */
const visible = () => QUESTIONS.map((q, i) => i).filter(i => S.filter === 'all' || QUESTIONS[i].level === S.filter);
function resetTimer() { const d = S.timer.duration * 1000; S.timer = { duration: S.timer.duration, total: d, left: d, running: false, endsAt: 0 }; }
const clearBuzz = () => { buzz = null; orderList = []; CH.postMessage({ type: 'buzz-clear' }); };   // live view: forget the old hands-up order
function goto(id) { clearBuzz(); S.qId = id; S.step = 0; resetTimer(); commit(); }
function move(dir) {
  const v = visible(); if (!v.length) return;
  const p = v.indexOf(S.qId);
  if (p < 0) { goto(dir > 0 ? v[0] : v[v.length - 1]); return; }
  goto(v[(p + dir + v.length) % v.length]);
}
function stepForward() { if (S.step < 2) { S.step++; pauseTimer(); commit(); } }
function stepBack() { if (S.step > 0) { S.step--; if (S.step === 0) clearBuzz(); commit(); } }

/* ---------- scoring ---------- */
function snap() { history.push(JSON.stringify({ scores: S.scores, streaks: S.streaks, step: S.step, qId: S.qId })); if (history.length > 60) history.shift(); }
function score(team, d) {
  if (!S.board.includes(team)) return;
  if (d < 0 && !S.scores[team]) return;                                   // nothing to take away: no empty undo step
  snap();
  S.scores[team] = Math.max(0, S.scores[team] + d);
  if (d > 0) {
    for (const t of TEAM_ORDER) S.streaks[t] = t === team ? S.streaks[t] + 1 : 0;
    S.step = Math.max(S.step, qType(QUESTIONS[S.qId]) === 'free' ? S.step : 1); pauseTimer();
    commit(evt('win', { team, streak: S.streaks[team] }));
  } else { S.streaks[team] = Math.max(0, S.streaks[team] - 1); commit(); }
}
function nobody() { snap(); for (const t of TEAM_ORDER) S.streaks[t] = 0; S.step = Math.max(S.step, 1); pauseTimer(); commit(evt('oops')); }
function undo() { const h = history.pop(); if (!h) return; const o = JSON.parse(h); S.scores = o.scores; S.streaks = o.streaks; if (o.qId === S.qId) S.step = o.step; commit(); }   // never reveal another question's answer
function resetScores() { if (!confirm('Reset all scores?')) return; snap(); S.scores = zeroScores(); S.streaks = zeroScores(); commit(); }
function newGroup() { snap(); clearBuzz(); S.scores = zeroScores(); S.streaks = zeroScores(); S.step = 0; resetTimer(); commit(); }

/* ---------- timer ---------- */
const timerLeft = () => S.timer.running ? Math.max(0, S.timer.endsAt - Date.now()) : S.timer.left;
function pauseTimer() { if (S.timer.running) { S.timer.left = timerLeft(); S.timer.running = false; } }
function toggleTimer() {
  if (S.timer.running) pauseTimer();
  else { if (S.timer.left <= 0) resetTimer(); S.timer.running = true; S.timer.endsAt = Date.now() + S.timer.left; }
  commit();
}
function addTime() { if (S.timer.running) S.timer.endsAt = Math.max(S.timer.endsAt, Date.now()) + 10000; else S.timer.left += 10000; S.timer.total = Math.max(S.timer.total, timerLeft()); commit(); }

/* ---------- rendering ---------- */
function renderHost() {
  const q = QUESTIONS[S.qId] || { q: '(no questions loaded)', level: 'everyone', choices: [] };
  const free = qType(q) === 'free';
  let body = `<span class="chip ${free ? 'free' : ''}">${free ? 'Free response' : 'Multiple choice'}</span><span class="chip">${LEVELS[q.level] || 'Everyone'}</span>` +
    `<h2>${esc(q.emoji || '')} ${esc(q.q)}</h2>`;
  if (free) body += `<div class="ch right"><b>✓</b>${q.answerText ? esc(q.answerText) : 'No reference answer: you decide who earned it'}</div><p>Listen to the answers, then click the color of whoever earns the point.</p>`;
  else body += (q.choices || []).map((c, i) => `<div class="ch ${i === q.answer ? 'right' : ''}"><b>${LETTERS[i]}</b>${esc(c)}</div>`).join('');
  if (q.fact) body += `<p><b>Say out loud:</b> ${esc(q.fact)}</p>`;
  if (q.kidFact) body += `<p><b>Kid version:</b> ${esc(q.kidFact)}</p>`;
  $('now').innerHTML = body;

  $('step').innerHTML = (free ? ['Reveal answer', 'Show fact card', 'Fact showing'] : ['Reveal answer', 'Show fact card', 'Fact showing'])[S.step] + '<kbd>Space</kbd>';
  $('players').innerHTML = S.board.length ? S.board.map(t => {
    const i = TEAM_ORDER.indexOf(t) + 1;
    return `<div class="pl" style="--c:${TEAMS[t].color}"><div class="nm">${TEAMS[t].name}</div><div class="n">${S.scores[t]}</div>` +
      `<button class="go" data-t="${t}" data-d="1">+1<kbd style="color:#fff;background:rgba(255,255,255,.25);border-color:transparent">${i}</kbd></button>` +
      `<button class="m" data-t="${t}" data-d="-1">-1</button></div>`;
  }).join('') : `<div class="empty">No players yet. Turn the camera on (Setup ⚙), try Practice mode, or pick a player count below.</div>`;
  $('kid').firstChild.textContent = `Kid wording: ${S.kid ? 'ON' : 'off'}`;
  $('nTeams').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${n === S.teams.length ? 'selected' : ''}>${n}</option>`).join('');
  $('tDur').value = String(S.timer.duration);
  $('tStart').firstChild.textContent = S.timer.running ? 'Pause timer' : 'Start timer';
  const f = { all: 'All', kids: 'Kids', everyone: 'Everyone', hard: 'Hard' };
  $('filters').innerHTML = Object.keys(f).map(k => `<button class="fchip ${S.filter === k ? 'on' : ''}" data-f="${k}">${f[k]}</button>`).join('');
  $('list').innerHTML = visible().map(i => {
    const x = QUESTIONS[i];
    return `<button data-q="${i}" class="${i === S.qId ? 'cur' : ''}"><span>${esc(x.emoji || '•')}</span><span class="t">${i + 1}. ${esc(x.q)}</span><span class="lv">${qType(x) === 'free' ? 'free · ' : ''}${LEVELS[x.level] || ''}</span></button>`;
  }).join('');
  renderBuzz();
  renderPills();
  if (window.Conn) Conn.render();
  if (window.Cal) Cal.sync();
}

function renderPills() {
  const tv = Date.now() - tvSeen < 5000;
  const set = (id, text, cls) => { const e = $(id); e.textContent = text; e.className = 'pill ' + cls; };
  set('pTv', tv ? 'Live view: running' : 'Live view: starting', tv ? 'ok' : 'warn');
  const p = camStatus.phase;
  if (S.cam.sim) set('pCam', 'Camera: practice mode', 'warn');
  else if (!S.cam.on) set('pCam', 'Camera: off', '');
  else set('pCam', { live: 'Camera: live', asking: 'Camera: allow in TV window', noperm: 'Camera: blocked', lost: 'Camera: reconnecting', error: 'Camera: error', off: 'Camera: starting' }[p] || 'Camera: ' + p, p === 'live' ? 'ok' : (p === 'asking' || p === 'off' ? 'warn' : 'bad'));
  const d = camStatus.det || {};
  if (S.cam.sim) set('pDet', 'Detection: practice', 'warn');
  else if (!S.cam.on || !S.cam.detect) set('pDet', 'Detection: off', '');
  else set('pDet', d.state === 'running' ? `Detection: ${camStatus.people.square} in square` : d.state === 'loading' ? 'Detection: loading…' : d.state === 'error' ? 'Detection: error' : 'Detection: waiting', d.state === 'running' ? 'ok' : d.state === 'error' ? 'bad' : 'warn');
}

/* ---------- hand-raise buzzer ---------- */
function renderBuzz() {
  const c = $('buzzCard'), on = !!S.cam.buzzer;
  $('buzzToggle').firstChild.textContent = 'Hands-up mode: ' + (on ? 'ON' : 'off');
  if (!on) { c.hidden = true; return; }
  c.hidden = false;
  if (!orderList.length) { c.innerHTML = '<b>🙋 Hands-up mode is on.</b> Kites turn into 1, 2, 3… in the order hands go up. If two or more hands go up together, the TV plays an instant replay by itself.' + (S.step > 0 ? ' <i>(Answer is revealed, so the buzzer sleeps until the next question.)</i>' : ''); return; }
  const chip = l => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px"><b style="background:${TEAMS[l.color].color};color:#fff;border-radius:50%;width:26px;height:26px;display:inline-grid;place-items:center">${l.rank}</b>${TEAMS[l.color].name}${l.ms ? ` <small>+${(l.ms / 1000).toFixed(2)} s</small>` : ''}</span>`;
  let h = '<b>🙋 Hands up, in order:</b> ' + orderList.map(chip).join('');
  if (buzz && buzz.contested) h += `<div style="margin-top:4px">Close call between ${buzz.list.map(l => TEAMS[l.color].name).join(' and ')}.` + (buzz.tooClose ? ' <b style="color:#B42318">Too close for the camera. You decide, using the replay.</b>' : '') + '</div>';
  h += '<div class="bz">' + orderList.map(l => `<button data-act="award" data-t="${l.color}" style="--c:${TEAMS[l.color].color}">Point to ${l.rank}. ${TEAMS[l.color].name}</button>`).join('') +
    (buzz && buzz.contested ? '<button data-act="replay">Replay again</button><button data-act="skip">Skip replay</button>' : '') + '<button data-act="reopen">Wrong → reopen buzzers</button></div>';
  c.innerHTML = h;
}
$('buzzCard').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'award') { const t = b.dataset.t; score(t, 1); buzz = null; orderList = []; CH.postMessage({ type: 'buzz-clear' }); commit(); }
  else if (b.dataset.act === 'reopen') { buzz = null; orderList = []; CH.postMessage({ type: 'buzz-reopen' }); renderBuzz(); }
  else if (b.dataset.act === 'replay') CH.postMessage({ type: 'replay-again' });
  else if (b.dataset.act === 'skip') CH.postMessage({ type: 'replay-skip' });
};
$('buzzToggle').onclick = () => { buzz = null; orderList = []; setCam({ buzzer: !S.cam.buzzer }); };
$('buzzTest').onclick = () => {
  const cols = S.board.slice(0, 2);
  if (cols.length < 2) { alert('Need two players on the board first (turn on Practice mode, or have two people in view).'); return; }
  if (!S.cam.buzzer) setCam({ buzzer: true });
  S.step = 0; buzz = null; orderList = []; commit();
  CH.postMessage({ type: 'buzz-reopen' });                                   // unlock the live view so the test works every time
  setTimeout(() => CH.postMessage({ type: 'sim-raise', colors: cols, gaps: [0, 90] }), 700);
};

/* ---------- events ---------- */
$('prev').onclick = () => move(-1);
$('next').onclick = () => move(1);
$('step').onclick = stepForward;
$('back').onclick = stepBack;
$('none').onclick = nobody;
$('undo').onclick = undo;
$('test').onclick = () => { const t = S.board[0] || 'gold'; CH.postMessage({ type: 'state', state: S, event: evt('test', { team: t, streak: 0 }) }); };
$('tStart').onclick = toggleTimer;
$('tAdd').onclick = addTime;
$('tDur').onchange = e => { S.timer.duration = +e.target.value; resetTimer(); commit(); };
$('kid').onclick = () => { S.kid = !S.kid; commit(); };
$('nTeams').onchange = e => { S.teams = TEAM_ORDER.slice(0, +e.target.value); commit(); };
$('resetRound').onclick = resetScores;
$('newGroup').onclick = newGroup;
$('players').onclick = e => { const b = e.target.closest('button'); if (b) score(b.dataset.t, +b.dataset.d); };
$('filters').onclick = e => { const b = e.target.closest('button'); if (b) { S.filter = b.dataset.f; commit(); } };
$('list').onclick = e => { const b = e.target.closest('button'); if (b) goto(+b.dataset.q); };
function openTv() { return true; }
const tvOpen = () => Date.now() - tvSeen < 5000;

const dlg = $('setup');
function openSetup(tab) { if (!dlg.open) dlg.showModal(); showTab(tab || 'camera'); }
function showTab(tab) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== tab);
  if (window.Cal) tab === 'camera' ? Cal.start() : Cal.stop();
  if (window.Conn) Conn.render();
}
$('openSetup').onclick = () => openSetup('camera');
$('openImport').onclick = () => openSetup('import');
$('closeSetup').onclick = () => dlg.close();
dlg.addEventListener('close', () => window.Cal && Cal.stop());
document.querySelectorAll('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));

document.addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.blur(); });     // a dropdown must not swallow the hotkeys afterwards
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || dlg.open || e.repeat) return;       // a held key must not score twice
  const tg = e.target;
  if (tg.tagName === 'SELECT' && /^[1-8]$/.test(e.key)) { e.preventDefault(); tg.blur(); score(TEAM_ORDER[+e.key - 1], 1); return; }   // a dropdown left focused must not eat a score key
  if (tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || (tg.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(tg.type))) return;
  const k = e.key.toLowerCase();
  if (/^[1-8]$/.test(k)) score(TEAM_ORDER[+k - 1], 1);
  else if (k === ' ' || k === 'f') stepForward();
  else if (k === 'backspace') stepBack();
  else if (k === 'arrowright') move(1);
  else if (k === 'arrowleft') move(-1);
  else if (k === 'n') nobody();
  else if (k === 't') toggleTimer();
  else if (k === 'u') undo();
  else if (k === 'k') { S.kid = !S.kid; commit(); }
  else if (k === 'c') $('test').click();
  else if (k === 'b') $('buzzToggle').click();
  else if (k === 'p') toggleFs();
  else if (k === 'r') $('replayBtn').click();
  else if (k === 'escape') { if (fsManual || fsReplay) { fsManual = false; fsReplay = false; CH.postMessage({ type: 'replay-skip' }); applyFs(); nativeFs(false); } else return; }
  else return;
  e.preventDefault();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
});

/* ---------- sync with the TV window ---------- */
CH.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'hello') { publishQuestions(); CH.postMessage({ type: 'state', state: S, event: null }); }
  else if (m.type === 'hb') { tvSeen = Date.now(); }
  else if (m.type === 'cam-status') {
    tvSeen = Date.now(); tvInfo = m.screen;
    const changed = camStatus.phase !== m.phase || (camStatus.det && camStatus.det.state) !== m.det.state;
    camStatus = m;
    const nb = computeBoard().join();
    if (nb !== S.board.join()) commit(); else if (changed) renderHost(); else { renderPills(); if (window.Conn) Conn.render(); }
  }
  else if (m.type === 'replay-play') { fsReplay = true; applyFs(); }
  else if (m.type === 'replay-stop') { fsReplay = false; applyFs(); }
  else if (m.type === 'buzz') { buzz = m; renderBuzz(); }
  else if (m.type === 'order') { orderList = m.list; if (!m.list.length) buzz = null; if (computeBoard().join() !== S.board.join()) commit(); else renderBuzz(); }
  else if (m.type === 'tracks') { live = m.colors; if (computeBoard().join() !== S.board.join()) commit(); }
  else if (m.type === 'cam-frame') { if (window.Cal) Cal.onFrame(m); }
});

function fitPreview() {
  const b = $('previewBox'), f = $('preview');
  if (b.classList.contains('fs')) {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    f.style.transform = `scale(${k})`; f.style.left = ((innerWidth - 1920 * k) / 2) + 'px'; f.style.top = ((innerHeight - 1080 * k) / 2) + 'px';
  } else { f.style.transform = `scale(${b.clientWidth / 1920})`; f.style.left = '0px'; f.style.top = '0px'; }
}
addEventListener('resize', fitPreview);
if (window.ResizeObserver) new ResizeObserver(() => fitPreview()).observe($('previewBox'));   // the live view always fills its box
setInterval(() => {
  renderPills();
  $('tLeft').textContent = (timerLeft() / 1000).toFixed(1) + ' s';
}, 250);
setInterval(() => { if (!SOLO) CH.postMessage({ type: 'cam-snap', on: true, preview: true }); }, 3000);   // keeps the little preview fed

if (/laptop/.test(location.search)) Object.assign(S.cam, { on: true, sim: false, deviceId: '', detect: true, kites: true, mirror: true, ignoreQuad: true, showQuad: false, preferBuiltIn: true });
fitPreview(); renderHost();
$('preview').addEventListener('load', () => { commit(); if (!SOLO) CH.postMessage({ type: 'cam-snap', on: true, preview: true }); });
document.body.classList.add('solo');
$('preview').src = 'audience.html';           // the only load: host.html leaves the frame empty so it is not loaded twice

/* Full screen: the live view fills the whole page (button / key P / Esc). Replays take over automatically, then give it back. */
let fsManual = false, fsReplay = false;
function applyFs() {
  const on = fsManual || fsReplay;
  $('previewBox').classList.toggle('fs', on);
  $('fsOverlay').innerHTML = on ? 'Exit full screen <kbd>Esc</kbd>' : '⛶ Full screen <kbd>P</kbd>';
  fitPreview();
}
function nativeFs(on) {            // also hide the browser's own bars, so projecting looks clean
  try {
    const el = document.documentElement;
    if (on && !document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    else if (!on && document.fullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
  } catch (e) {}
}
function toggleFs() { if (fsManual || fsReplay) { if (fsReplay) CH.postMessage({ type: 'replay-skip' }); fsManual = fsReplay = false; } else fsManual = true; applyFs(); }       // in-page only: for the browser's own full screen use Ctrl+Cmd+F
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && fsManual) { fsManual = false; applyFs(); } });
$('replayBtn').onclick = () => CH.postMessage({ type: 'replay-last' });
$('fsBtn').onclick = toggleFs; $('fsOverlay').onclick = toggleFs;

publishQuestions();
