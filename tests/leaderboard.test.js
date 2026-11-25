// leaderboard.js: top-3 ranking and the "kite flies up, comes back in the new colour" animation timing
const L = require('../leaderboard.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const ORDER = ['red', 'orange', 'gold', 'green', 'teal', 'blue', 'purple', 'pink'];

ok(JSON.stringify(L.top3({}, ['red', 'blue'], ORDER)) === '[null,null,null]', 'nobody scored: empty podium (design look)');
ok(JSON.stringify(L.top3({ red: 2, blue: 5, gold: 1 }, ['red', 'blue', 'gold'], ORDER)) === '["blue","red","gold"]', 'ranked by points');
ok(JSON.stringify(L.top3({ red: 3, blue: 3, gold: 0 }, ['blue', 'red', 'gold'], ORDER)) === '["red","blue",null]', 'tie: stable team order; 0 points not on the podium');
ok(L.top3({ red: 1, blue: 2, gold: 3, green: 4 }, ['red', 'blue', 'gold', 'green'], ORDER).length === 3, 'only three places');

const P = new L.Podium(); let now = 1000;
P.set(['red', null, null], now);
let f = P.frame(now + 10);
ok(f[0].kiteY < 0 && f[0].kiteY > -0.1 && f[0].star, 'new leader: the empty slot\'s kite starts flying up');
f = P.frame(now + L.UP_MS + 5);
ok(f[0].team === 'red' && f[0].kiteY < -0.5, 'at the top it switches to the new team\'s colour');
f = P.frame(now + L.UP_MS + L.DOWN_MS + 5);
ok(f[0].team === 'red' && f[0].kiteY === 0 && f[0].mix === 1, 'then it is back on its bar, fully the new colour');
// overshoot (bounce) while landing
let min = 0, max = -1; for (let e = L.UP_MS; e < L.UP_MS + L.DOWN_MS; e += 10) { const y = P.frame(now + e)[0].kiteY; min = Math.min(min, y); max = Math.max(max, y); }
ok(max > 0, 'it bounces a little when it lands');

now += 5000; P.set(['blue', 'red', null], now);
f = P.frame(now + 50);
ok(f[0].team === 'red' && f[1].star, 'places change: during the fly-up each slot still shows its old team');
f = P.frame(now + 2000);
ok(f[0].team === 'blue' && f[1].team === 'red' && !f[1].star, '...and lands with the new teams');
f = P.frame(now + 2000); P.set(['blue', 'red', null], now + 2000);
ok(P.frame(now + 2010)[0].kiteY === 0, 'same standings again: nothing moves');
// a second change during the animation lands in the newest colour, no restart glitch
now += 5000; P.set(['gold', 'red', null], now); P.set(['green', 'red', null], now + 100);
ok(P.frame(now + 2000)[0].team === 'green', 'a change during the animation lands in the newest colour');

if (fails) { console.log(`FAIL: ${fails} leaderboard check(s)`); process.exit(1); }
console.log('leaderboard: all checks passed'); process.exit(0);
