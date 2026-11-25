// mascot-director.js: which 3D mascot state shows for each game moment
const D = require('../mascot-director.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const S = (o = {}) => Object.assign({ qId: 0, step: 0, timer: { running: false, left: 30000, total: 30000, endsAt: 0 } }, o);

let d = new D(), now = 1e6;
ok(d.decide(null, now).state === 'idle_happy', 'no game yet: happy idle');
ok(d.decide(S(), now).state === 'hosts_speaking', 'new question: hosts speaking');
ok(d.decide(S(), now + 6000).state === 'thinking_ponder', '...then players thinking');
ok(d.decide(S({ qId: 1 }), now + 6100).state === 'hosts_speaking', 'next question: hosts speaking again');
ok(d.decide(S({ qId: 1, step: 1 }), now + 7000).state === 'idle_happy', 'answer revealed: happy idle');

d = new D(); now = 2e6;
const T = (leftMs) => S({ timer: { running: true, total: 30000, left: 0, endsAt: Date.now() + leftMs } });
let r = d.decide(T(12000), now);
ok(r.state === 'timer_pocket_watch' && Math.abs(r.timer[0] - 12) < 0.5 && r.timer[1] === 30, 'timer running: pocket watch with seconds left / total');
r = d.decide(T(-10), now + 100);
ok(r.state === 'wrong_answer', 'time ran out: wrong answer');
ok(d.decide(T(-10), now + 100 + D.HOLD.wrong + 10).state !== 'wrong_answer', '...only for a few seconds');

d = new D(); now = 3e6; d.decide(S(), now);
d.event('hand', now + 6000, { look: [0.4, -0.2] });
r = d.decide(S(), now + 6100);
ok(r.state === 'hand_raised_alert' && r.look[0] === 0.4, 'hand raised: alert, looking towards the player');
d.event('correct', now + 6500);
ok(d.decide(S({ step: 1 }), now + 6600).state === 'correct_answer', 'point given: correct answer');
d.event('hand', now + 6700);
ok(d.decide(S({ step: 1 }), now + 6800).state === 'correct_answer', 'a hand going up does not cut the celebration short');
ok(d.decide(S({ step: 1 }), now + 6500 + D.HOLD.correct + 10).state === 'idle_happy', 'then back to idle');
d.event('winner', now + 20000);
ok(d.decide(S({ step: 1 }), now + 20100).state === 'grand_winner', 'third point in a row: grand winner');
d.event('wrong', now + 30000);
ok(d.decide(S({ step: 1 }), now + 30100).state === 'wrong_answer', 'nobody got it / wrong: wrong answer');

// review fixes: a reaction ends when the question changes; every reaction gets a new serial (animation restarts)
d = new D(); now = 4e6; d.decide(S(), now);
d.event('winner', now + 100, { q: 0 });
ok(d.decide(S({ qId: 1 }), now + 600).state === 'hosts_speaking', 'next question right after a crown: hosts speaking, not the old crown');
d.event('correct', now + 1000, { q: 1 }); const s1 = d.decide(S({ qId: 1, step: 1 }), now + 1100).serial;
d.event('correct', now + 2500, { q: 1 }); const s2 = d.decide(S({ qId: 1, step: 1 }), now + 2600).serial;
ok(s2 > s1, 'a second point restarts the celebration');

d = new D(); now = 5e6; d.decide(S({ step: 1 }), now);
d.event('winner', now + 100, { q: 0 }); d.event('correct', now + 2100, { q: 0 });
ok(d.decide(S({ step: 1 }), now + 2200).state === 'correct_answer', 'a 4th point during the crown still gets its spin');

if (fails) { console.log(`FAIL: ${fails} mascot director check(s)`); process.exit(1); }
console.log('mascot director: all checks passed'); process.exit(0);
