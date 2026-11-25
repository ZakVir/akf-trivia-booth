const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.body.classList.add('preview', 'pv');

const $ = id => document.getElementById(id);
const stage = $('stage');
let S = null, lastEventId = 0, transient = null, qKey = '', barsKey = '', prevScores = {};

/* ---- scale the 1920x1080 stage to whatever screen we are on ---- */
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%,-50%) scale(${s})`;
}
addEventListener('resize', fit); fit();

/* ---- tiny confetti (no libraries, works offline) ---- */
const Confetti = (() => {
  const cv = $('confetti'), ctx = cv.getContext('2d');
  let parts = [], running = false;
  function burst(x, y, colors, n = 110) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.3, v = 10 + Math.random() * 16;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
        w: 12 + Math.random() * 12, h: 7 + Math.random() * 8, c: colors[i % colors.length], life: 0 });
    }
    if (!running) { running = true; requestAnimationFrame(loop); }
  }
  function loop() {
    ctx.clearRect(0, 0, 1920, 1080);
    parts = parts.filter(p => p.life < 130 && p.y < 1120);
    for (const p of parts) {
      p.vy += .5; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.globalAlpha = Math.min(1, (130 - p.life) / 30);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (parts.length) requestAnimationFrame(loop); else running = false;
  }
  return { burst };
})();

function stagePos(el) {
  const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(), k = s.width / 1920;
  return { x: (r.left + r.width / 2 - s.left) / k, y: (r.top + r.height / 2 - s.top) / k };
}

function handleEvent(ev) {
  if (!ev || ev.id === lastEventId) return;
  lastEventId = ev.id;
  if (ev.type === 'win' || ev.type === 'test') {
    const st = cardStyle(ev.team), card = document.querySelector(`.card[data-team="${ev.team}"]`);
    const pos = card ? stagePos(card.querySelector('.ring')) : { x: 1431, y: 880 };
    Confetti.burst(pos.x, pos.y, [st.ring, '#FAB603', '#FFFFFF', '#0879FE']);
    setTimeout(() => Confetti.burst(485, 560, [st.ring, '#FB5D46', '#02A5A7', '#FAB603'], 70), 250);
  }
}

/* ---- render ---- */
function render() {
  if (!S) return;
  $('wait').style.display = 'none';
  document.body.classList.toggle('step2', S.step >= 2);
  document.body.classList.toggle('sim-on', !!(S.cam && S.cam.sim));
  Cam.apply(S.cam);
  Buzz.arm(S);
  document.body.classList.toggle('timer-on', !!(S.timer && (S.timer.running || S.timer.left < S.timer.total)));
  renderQuestion();
  renderCards();
}

function renderQuestion() {
  const q = QUESTIONS[S.qId];
  if (!q) return;
  const key = [S.qId, S.step, S.kid, QUESTIONS.length, q.q].join('|');
  if (key === qKey) return;
  qKey = key;
  $('qnum').textContent = `Question ${S.qId + 1} of ${QUESTIONS.length}`;
  $('level').textContent = LEVELS[q.level] || 'Everyone';
  const qt = $('qtext'); qt.textContent = (q.emoji ? q.emoji + ' ' : '') + q.q; fitText(qt, 64, 34);
  let html = '';
  if (qType(q) === 'free') {
    if (S.step === 0) html += `<div class="free"><big>🎤</big>Shout it out!<br>Say your answer</div>`;
    else html += `<div class="free ans">✅ ${q.answerText ? esc(q.answerText) : 'Great answers, everyone!'}</div>`;
    if (S.step >= 2) html += factHtml(q);
  } else if (S.step >= 2) {
    html += `<div id="choices"><div class="choice right"><b>${LETTERS[q.answer]}</b>${esc(q.choices[q.answer])}</div></div>` + factHtml(q);
  } else {
    html += '<div id="choices">' + q.choices.map((c, i) =>
      `<div class="choice ${S.step === 1 ? (i === q.answer ? 'right' : 'dim') : ''}"><b>${LETTERS[i]}</b>${esc(c)}</div>`).join('') + '</div>';
  }
  const body = $('body'); body.innerHTML = html;
  const ch = body.querySelectorAll('.choice');                            // long answers: shrink them all together so they still fit the box
  for (let fs = 34; fs > 20 && body.scrollHeight > body.clientHeight + 1; fs -= 2) ch.forEach(c => { c.style.fontSize = fs + 'px'; c.style.minHeight = Math.round(fs * 2.4) + 'px'; });
}
function fitText(el, max, min) {                                          // biggest size that fits the box
  let fs = max; el.style.fontSize = fs + 'px';
  while (fs > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) { fs -= 2; el.style.fontSize = fs + 'px'; }
}
function factHtml(q) {
  const f = S.kid ? (q.kidFact || q.fact) : (q.fact || q.kidFact);
  return f ? `<div id="fact"><h3>💡 Did you know?</h3><p>${esc(f)}</p></div>` : '';
}

/* card colors from the design (Yellow / Green / Red / Blue); the other wristband colors follow the same style */
const CARD = {
  gold: { bg: '#FFFFD4', ring: '#FECD08', name: 'Yellow' }, green: { bg: '#E2FFD4', ring: '#57FE08' }, red: { bg: '#FFD4D4', ring: '#FE0808' },
  blue: { bg: '#D4F2FF', ring: '#0879FE' }, orange: { bg: '#FFE4D0', ring: '#FE7A08' }, teal: { bg: '#D4FAF5', ring: '#08C9B4' },
  purple: { bg: '#EADDFF', ring: '#8A3DFE' }, pink: { bg: '#FFDAEE', ring: '#FE3D9E' }
};
const CARD_ORDER = ['gold', 'green', 'red', 'blue', 'orange', 'teal', 'purple', 'pink'];
const cardStyle = t => CARD[t] || { bg: '#F0F0F0', ring: (TEAMS[t] || {}).color || '#999' };
/* the podium: live top-3 leaderboard (team colours, spinning kites; a place change makes the kite fly up and drop back) */
const podium = new Leaderboard.Podium(), podCtx = $('podium').getContext('2d');
(function podLoop(now) {
  podCtx.setTransform(2, 0, 0, 2, 0, 0);                                  // drawn at 2x for a crisp TV picture
  Leaderboard.draw(podCtx, podium, now, TEAMS, typeof Kites !== 'undefined' ? Kites : null);
  requestAnimationFrame(podLoop);
})(performance.now());

function renderCards() {
  podium.set(Leaderboard.top3(S.scores, TEAM_ORDER, TEAM_ORDER), performance.now());
  const board = S.board || [];
  const teams = (board.length ? CARD_ORDER.filter(t => board.includes(t)) : ['gold', 'green', 'red', 'blue']);   // nobody in view yet: the four teams, as in the design
  const key = teams.join(','), wrap = $('cards');
  if (key !== barsKey) {
    barsKey = key;
    wrap.innerHTML = teams.map(t => { const c = cardStyle(t); return `<div class="card" data-team="${t}" style="--bg:${c.bg};--ring:${c.ring}"><div class="ring"><b>0</b><span>points</span></div><div class="nm">${c.name || TEAMS[t].name} Team</div></div>`; }).join('');
    const k = Math.min(1, 830 / (teams.length * 161 + (teams.length - 1) * 34));   // more than 4 teams: the row shrinks to fit
    wrap.style.transform = k < 1 ? `scale(${k})` : '';
  }
  for (const t of teams) {
    const card = wrap.querySelector(`[data-team="${t}"]`), v = (S.scores && S.scores[t]) || 0;
    if (!card) continue;
    card.querySelector('b').textContent = v;
    card.querySelector('span').textContent = v === 1 ? 'point' : 'points';
    if (prevScores[t] != null && v > prevScores[t]) { card.classList.remove('bounce'); void card.offsetWidth; card.classList.add('bounce'); }
    prevScores[t] = v;
  }
}

/* ---- timer bar ---- */
function tick() {
  if (S) {
    const T = S.timer, left = T.running ? Math.max(0, T.endsAt - Date.now()) : T.left;
    const fill = $('timerFill'), w = Math.min(100, left / (T.total || 1) * 100).toFixed(2) + '%', low = left < 6000 && left > 0 || (T.running && left === 0);
    if (w !== tick.w) { fill.style.width = w; tick.w = w; }                 // only touch the page when something changed
    if (low !== tick.low) { fill.classList.toggle('low', low); tick.low = low; }
  }
  requestAnimationFrame(tick);
}
tick();

/* ---- sync ---- */
CH.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'questions') { window.QUESTIONS = m.list; qKey = ''; if (S) render(); }
  else if (m.type === 'state') { S = m.state; render(); handleEvent(m.event); }
});
CH.postMessage({ type: 'hello', preview: PREVIEW });
if (!PREVIEW) setInterval(() => CH.postMessage({ type: 'hb', t: Date.now() }), 2000);

/* Click the TV window once to go fullscreen. */
if (!PREVIEW) addEventListener('click', () => {
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
});

/* reaction when someone buzzes in */
window.buzzFx = function (color) {
  const c = cardStyle(color);
  Confetti.burst(1431, 330, [c.ring, '#FAB603', '#FFFFFF', '#0879FE'], 120);
};

/* the design font loads a moment after the page: measure the question text again once it is there */
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { qKey = ''; if (S) render(); });
