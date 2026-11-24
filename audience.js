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

/* ---- snow ---- */
(() => {
  const el = $('snow');
  for (let i = 0; i < 46; i++) {
    const f = document.createElement('i');
    const sz = 6 + Math.random() * 14;
    f.style.cssText = `left:${Math.random() * 100}%;width:${sz}px;height:${sz}px;--dx:${(Math.random() * 120 - 60) | 0}px;` +
      `animation-duration:${9 + Math.random() * 12}s;animation-delay:${-Math.random() * 20}s;opacity:${.4 + Math.random() * .6}`;
    el.appendChild(f);
  }
})();

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

/* ---- mascot ---- */
const BUBBLES = {
  idle: 'Ready? Step in!', look: 'Listen up!', think: 'Huddle with your team!',
  happy: 'Yes! Great job!', cool: "You're on fire!", oops: 'Ooh, so close!', fact: 'Did you know?'
};
function baseMood() {
  if (!S) return 'idle';
  if (S.step >= 2) return 'fact';
  if (S.timer.running) return 'think';
  if (S.step === 0 && S.qId != null) return 'look';
  return 'idle';
}
function renderMascot() {
  if (transient && Date.now() > transient.until) transient = null;
  const m = transient ? transient.mood : baseMood();
  Mascot.render($('mascot'), m);
  $('bubble').textContent = BUBBLES[m];
}

function handleEvent(ev) {
  if (!ev || ev.id === lastEventId) return;
  lastEventId = ev.id;
  if (ev.type === 'win' || ev.type === 'test') {
    const t = TEAMS[ev.team] || TEAMS.gold, bar = document.querySelector(`.bar[data-team="${ev.team}"]`);
    const pos = bar ? stagePos(bar.querySelector('.track')) : { x: 600, y: 850 };
    Confetti.burst(pos.x, pos.y, [t.color, '#F2B01E', '#FFFFFF', '#6FAFCB']);
    setTimeout(() => Confetti.burst(960, 760, [t.color, '#F2B01E', '#6FAFCB', '#E5484D'], 70), 250);
    transient = { mood: ev.streak >= 3 ? 'cool' : 'happy', until: Date.now() + 3600 };
  } else if (ev.type === 'oops') {
    transient = { mood: 'oops', until: Date.now() + 3200 };
  }
  renderMascot();
  setTimeout(renderMascot, 3700);
}

/* ---- render ---- */
function render() {
  if (!S) return;
  $('wait').style.display = 'none';
  document.body.classList.toggle('step2', S.step >= 2);
  document.body.classList.toggle('sim-on', !!(S.cam && S.cam.sim));
  Cam.apply(S.cam);
  Buzz.arm(S);
  renderQuestion();
  renderBars();
  renderMascot();
}

function renderQuestion() {
  const q = QUESTIONS[S.qId];
  if (!q) return;
  const key = [S.qId, S.step, S.kid, QUESTIONS.length, q.q].join('|');
  if (key === qKey) return;
  qKey = key;
  $('qnum').textContent = `Question ${S.qId + 1} of ${QUESTIONS.length}`;
  const lv = $('level'); lv.textContent = LEVELS[q.level] || 'Everyone';
  const free = qType(q);
  let html = `<div id="emoji">${esc(q.emoji || '❓')}</div><div id="qtext">${esc(q.q)}</div>`;
  if (free === 'free') {
    if (S.step === 0) html += `<div class="free"><big>🎤</big>Shout it out!<br>Say your answer</div>`;
    else html += `<div class="free ans"><big>✅</big>${q.answerText ? esc(q.answerText) : 'Great answers, everyone!'}</div>`;
    if (S.step >= 2) html += factHtml(q);
  } else if (S.step >= 2) {
    html += `<div id="choices"><div class="choice right"><b>${LETTERS[q.answer]}</b>${esc(q.choices[q.answer])}</div></div>` + factHtml(q);
  } else {
    html += '<div id="choices">' + q.choices.map((c, i) =>
      `<div class="choice ${S.step === 1 ? (i === q.answer ? 'right' : 'dim') : ''}"><b>${LETTERS[i]}</b>${esc(c)}</div>`).join('') + '</div>';
  }
  $('body').innerHTML = html;
}
function factHtml(q) {
  const f = S.kid ? (q.kidFact || q.fact) : (q.fact || q.kidFact);
  return f ? `<div id="fact"><h3>💡 Did you know?</h3><p>${esc(f)}</p></div>` : '';
}

function renderBars() {
  const board = S.board || [];
  const key = board.join(',');
  const wrap = $('bars');
  wrap.classList.toggle('many', board.length > 4);
  if (key !== barsKey) {
    barsKey = key;
    wrap.innerHTML = board.length ? board.map(t =>
      `<div class="bar" data-team="${t}" style="--c:${TEAMS[t].color}"><div class="lbl"><i></i>${TEAMS[t].name}</div>` +
      `<div class="track"><div class="fill"></div></div><div class="num">0</div></div>`).join('')
      : '<div id="emptyBars">Step in front of the camera to join!</div>';
  }
  const max = Math.max(5, ...board.map(t => S.scores[t] || 0));
  for (const t of board) {
    const bar = wrap.querySelector(`[data-team="${t}"]`), v = S.scores[t] || 0;
    if (!bar) continue;
    bar.querySelector('.fill').style.width = (v / max * 100) + '%';
    bar.querySelector('.num').textContent = v;
    if (prevScores[t] != null && v > prevScores[t]) {
      bar.classList.remove('bounce'); void bar.offsetWidth; bar.classList.add('bounce');
    }
    prevScores[t] = v;
  }
}

/* ---- timer bar ---- */
function tick() {
  if (S) {
    const T = S.timer, left = T.running ? Math.max(0, T.endsAt - Date.now()) : T.left;
    const fill = $('timerFill');
    fill.style.width = Math.min(100, left / T.total * 100) + '%';
    fill.classList.toggle('low', left < 6000 && left > 0 || (T.running && left === 0));
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
  const t = TEAMS[color];
  Confetti.burst(600, 330, [t.color, '#F2B01E', '#FFFFFF', '#6FAFCB'], 120);
  transient = { mood: 'happy', until: Date.now() + 3600 };
  renderMascot(); setTimeout(renderMascot, 3700);
};
