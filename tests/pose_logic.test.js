// pose-logic.js: raised-hand rules and "one person = one marker" on hand-built skeletons that copy cases seen in real clips
// (tests/eval): straight and bent raises count; a hand on the face or over the eye does not; people side by side and a
// child on a parent's shoulders stay two people; a duplicate pose of the same body is merged.
const assert = require('assert'), P = require('../pose-logic.js');
let fails = 0;
const check = (name, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) fails++; };

// a standing person facing the camera, head at (cx, hy), shoulders 0.12 wide; arms down unless overridden
function body(cx, hy, over = {}) {
  const P0 = {
    0: [cx, hy], 1: [cx + 0.015, hy - 0.015], 2: [cx - 0.015, hy - 0.015], 3: [cx + 0.03, hy - 0.005], 4: [cx - 0.03, hy - 0.005],
    5: [cx + 0.06, hy + 0.09], 6: [cx - 0.06, hy + 0.09], 7: [cx + 0.075, hy + 0.2], 8: [cx - 0.075, hy + 0.2],
    9: [cx + 0.08, hy + 0.3], 10: [cx - 0.08, hy + 0.3], 11: [cx + 0.045, hy + 0.32], 12: [cx - 0.045, hy + 0.32],
    13: [cx + 0.05, hy + 0.48], 14: [cx - 0.05, hy + 0.48], 15: [cx + 0.05, hy + 0.62], 16: [cx - 0.05, hy + 0.62]
  };
  Object.assign(P0, over);
  const kp = []; for (let i = 0; i < 17; i++) kp.push({ x: P0[i][0], y: P0[i][1], v: 0.95 });
  const xs = kp.map(k => k.x), ys = kp.map(k => k.y);
  return { box: { x0: Math.min(...xs) - 0.02, y0: Math.min(...ys) - 0.04, x1: Math.max(...xs) + 0.02, y1: Math.max(...ys) + 0.02 }, score: 0.9, kp };
}
const det = (p, o) => P.toDet(p, o || {});

// raised hands
check('arms down: not raised', !det(body(0.5, 0.3)).raised);
check('straight arm up: raised', det(body(0.5, 0.3, { 8: [0.43, 0.2], 10: [0.43, 0.1] })).raised);
check('bent "polite" raise (hand at forehead, elbow at shoulder, forearm upright): raised', det(body(0.5, 0.3, { 8: [0.41, 0.39], 10: [0.42, 0.25] })).raised);
check('hand touching the face, elbow down: not raised', !det(body(0.5, 0.3, { 8: [0.46, 0.45], 10: [0.49, 0.31] })).raised);
check('hand over the eye, elbow out sideways (forearm across): not raised', !det(body(0.5, 0.3, { 8: [0.36, 0.38], 10: [0.47, 0.31] })).raised);
check('hand scratching the top of the head, elbow out: not raised in strict mode', !det(body(0.5, 0.3, { 8: [0.4, 0.33], 10: [0.47, 0.25] }), { handSens: 'strict' }).raised);
check('easy mode: hand clearly above the shoulder with elbow lifted counts', det(body(0.5, 0.3, { 8: [0.4, 0.38], 10: [0.42, 0.3] }), { handSens: 'easy' }).raised);
const half = det(body(0.5, 0.3, { 8: [0.42, 0.47], 10: [0.43, 0.4] }));
check('hand lowered to shoulder level after a raise: no longer held', !half.held);
const still = det(body(0.5, 0.3, { 8: [0.42, 0.4], 10: [0.43, 0.36] }));
check('hand a bit above the shoulder: still held (raise not dropped)', still.held && !still.raised);
const hidden = body(0.5, 0.3, { 10: [0.43, 0.05] }); hidden.kp[10].v = 0.1;
check('a hidden (low-confidence) wrist never counts', !det(hidden).raised && !det(hidden).held);

// marker spot sits above the head and does not jump when one face point flickers
const a = det(body(0.5, 0.3)), b0 = body(0.5, 0.3); b0.kp[3].v = 0.2; const b = det(b0);
check('marker above the head', a.y < 0.3 - 0.02 && Math.abs(a.x - 0.5) < 0.01);
check('one ear flickering out moves the marker < 1% of the picture', Math.hypot(a.x - b.x, a.y - b.y) < 0.01);

// one person = one marker
const two = P.clean([det(body(0.42, 0.3)), det(body(0.56, 0.31))], {});
check('two people side by side (heads 0.14 apart) stay two', two.length === 2);
const kid = body(0.5, 0.12), dad = body(0.5, 0.3); kid.kp.forEach(k => { k.x = 0.5 + (k.x - 0.5) * 0.6; k.y = 0.12 + (k.y - 0.12) * 0.55; });
const fam = P.clean([det(dad), det({ ...kid, box: { x0: 0.45, y0: 0.07, x1: 0.55, y1: 0.47 } })], {});
check('child on a parent\'s shoulders: two people', fam.length === 2);
const d1 = body(0.5, 0.3), d2 = body(0.503, 0.302); d2.score = 0.7;
check('a second (jittered) pose of the same body is merged', P.clean([det(d1), det(d2)], {}).length === 1);
const up1 = body(0.5, 0.3, { 8: [0.43, 0.2], 10: [0.43, 0.1] }), up2 = body(0.503, 0.302, { 8: [0.43, 0.2], 10: [0.43, 0.1] }); up1.kp[10].v = 0.2; up2.score = 0.7;   // the better pose missed the wrist
const merged = P.clean([det(up1), det(up2)], {});
check('...and a raised hand on the duplicate still counts', merged.length === 1 && merged[0].raised);

// MediaPipe landmarks go through the same rules
const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, visibility: 0.1 });
const map = { 0: 0, 2: 1, 5: 2, 7: 3, 8: 4, 11: 5, 12: 6, 13: 7, 14: 8, 15: 9, 16: 10, 23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16 };
const src = body(0.5, 0.3, { 8: [0.43, 0.2], 10: [0.43, 0.1] });
for (const [m, c] of Object.entries(map)) lm[m] = { x: src.kp[c].x, y: src.kp[c].y, visibility: 0.95 };
const mp = P.fromMediaPipe(lm);
check('MediaPipe pose with a straight arm up: raised', mp && det(mp).raised);

if (fails) { console.log(`FAIL: ${fails} pose-logic check(s) failed`); process.exit(1); }
console.log('pose-logic: all checks passed'); process.exit(0);
