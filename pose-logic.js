/*
 * pose-logic.js -- turns one detected body (17 COCO keypoints + box) into what the booth needs, and removes duplicates.
 * Pure functions (no DOM), shared by the browser (cam.js) and the offline accuracy harness (tests/eval).
 *
 *   PoseLogic.toDet(person, opt)        person: { box:{x0,y0,x1,y1}, score, kp:[{x,y,v} x17] } (all 0..1)
 *   PoseLogic.fromMediaPipe(landmarks)  MediaPipe's 33 landmarks -> the same person shape (COCO order)
 *   PoseLogic.clean(dets, opt)          drop tiny background figures, merge true duplicates only
 *   opt: { handSens:'easy'|'normal'|'strict', sens:'strict'|'normal'|'loose', inQuad:(pt, grow) => bool }
 *
 * Marker spot: the middle of the head (nose, eyes and ears blended by confidence, so it does not jump when one
 * of them flickers), lifted by about one head height. Body size: shoulder width, or neck length when side-on.
 *
 * Raised hand (per arm, using that arm's own shoulder and elbow):
 *   strict : wrist above the top of the head and above the elbow
 *   normal : wrist above the top of the head, OR a bent "polite" raise: wrist at forehead height or higher, elbow
 *            lifted near the shoulder and the forearm fairly upright. A hand touching the face/hair (elbow down, or
 *            forearm across the face) is not a raise.
 *   easy   : wrist clearly above the shoulder with the elbow lifted, or above the head
 *   seen from behind (not strict): the person's box reaches well above the head. From behind the model often
 *            misplaces a raised wrist, but the box still stretches up to include the hand.
 * Held (for letting go): the wrist stays above the shoulder. The tracker drops a raise only after 3 frames below.
 *
 * Duplicates: two detections are the same person only if their boxes almost coincide or their skeletons match
 * keypoint by keypoint. Two people standing close (or a child on a parent's shoulders) are never merged.
 */
(function (root) {
  'use strict';
  var MP2COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  var HEAD_W = [1, 0.9, 0.9, 0.55, 0.55];             // nose, eyes, ears: how much each pulls the head centre

  function fromMediaPipe(lm) {
    var kp = MP2COCO.map(function (i) { var p = lm[i] || { x: 0, y: 0, visibility: 0 }; return { x: p.x, y: p.y, v: p.visibility == null ? 0.9 : p.visibility }; });
    var x0 = 9, y0 = 9, x1 = -9, y1 = -9, n = 0, sc = 0;
    kp.forEach(function (k) { if (k.v > 0.3) { x0 = Math.min(x0, k.x); y0 = Math.min(y0, k.y); x1 = Math.max(x1, k.x); y1 = Math.max(y1, k.y); } });
    [0, 5, 6].forEach(function (i) { sc += kp[i].v; n++; });
    if (x1 < x0) return null;
    var h = y1 - y0, pad = 0.08 * h;
    return { box: { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - 1.6 * pad), x1: Math.min(1, x1 + pad), y1: Math.min(1, y1 + pad) }, score: sc / n, kp: kp };
  }

  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function toDet(p, opt) {
    opt = opt || {};
    var k = p.kp, box = p.box, bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    var ok = function (i, t) { return k[i] && k[i].v > (t == null ? 0.3 : t); };
    var haveSh = ok(5) && ok(6), sh = haveSh ? mid(k[5], k[6]) : ok(5) ? k[5] : ok(6) ? k[6] : null;

    // head centre: confidence-weighted blend of nose / eyes / ears (soft weights: no jump when a point flickers)
    var hw = 0, hx = 0, hy = 0, faceN = 0;
    for (var i = 0; i < 5; i++) {
      var w = Math.max(0, k[i].v - 0.25) * HEAD_W[i];
      if (k[i].v > 0.4) faceN++;
      hw += w; hx += w * k[i].x; hy += w * k[i].y;
    }
    var head = hw > 0.05 ? { x: hx / hw, y: hy / hw } : null;
    var boxOnly = !head && !sh;
    if (boxOnly && !(p.score >= 0.5 && bh > 0.15)) return null;          // nothing to anchor on, and not clearly a body
    if (!head) head = sh ? { x: sh.x, y: sh.y - 0.45 * Math.max(0.04, haveSh ? Math.abs(k[5].x - k[6].x) : bw * 0.5) } : { x: (box.x0 + box.x1) / 2, y: box.y0 + 0.07 * bh };

    var sw = haveSh ? Math.hypot(k[5].x - k[6].x, k[5].y - k[6].y) : 0;
    var nh = sh ? Math.max(0.015, sh.y - head.y) : Math.max(0.02, 0.09 * bh);   // head-centre to shoulder line (vertical)
    var s = Math.max(0.04, sw, 1.1 * nh, sh ? 0 : bw * 0.5);
    var top = { x: head.x, y: head.y - 0.9 * nh };
    if (faceN === 0) {                                                       // face not seen (turned away / cut by the edge): the top of the body box IS the top of the head,
      var handHigh = [9, 10].some(function (j) { return ok(j, 0.35) && k[j].y < (sh ? sh.y : head.y) - 0.3 * nh; });   // unless a hand is up there
      if (!handHigh) top = { x: sh ? sh.x : (box.x0 + box.x1) / 2, y: box.y0 + 0.02 * bh };
    }

    var hipsOk = ok(11) && ok(12), hip = hipsOk ? mid(k[11], k[12]) : null;
    var torso = (hip && sh) ? Math.max(nh * 1.5, hip.y - sh.y) : 2.6 * nh;

    // feet (for the play-square check)
    var foot, ank = [15, 16].filter(function (j) { return ok(j); }).map(function (j) { return k[j]; });
    if (ank.length) foot = { x: ank.reduce(function (a, e) { return a + e.x; }, 0) / ank.length, y: ank.reduce(function (a, e) { return a + e.y; }, 0) / ank.length };
    else if (hip) foot = { x: hip.x, y: hip.y + torso * 1.8 };
    else foot = { x: (sh || head).x, y: (sh || head).y + nh * 6 };
    foot.y = Math.min(foot.y, 1.2);

    // hands
    var sens = opt.handSens || 'normal', raised = false, held = false, hand = null, wy, line, best = 9;
    if (sh) {
      var headTop = head.y - 0.75 * nh;
      line = sens === 'strict' ? headTop : sens === 'easy' ? sh.y - 0.6 * nh : head.y - 0.25 * nh;
      var arms = [[9, 7, 5], [10, 8, 6]];
      for (var a = 0; a < 2; a++) {
        var W = k[arms[a][0]], E = k[arms[a][1]], Sp = ok(arms[a][2]) ? k[arms[a][2]] : sh;
        if (!(W && W.v > 0.35)) continue;
        var elbowOk = E && E.v > 0.3;
        var armUp = W.y < (elbowOk ? E.y - 0.15 * nh : Sp.y - 0.3 * nh);       // forearm pointing up
        var elbowUp = elbowOk && E.y < Sp.y + 0.22 * torso;                       // elbow lifted to about shoulder height
        var aboveHead = W.y < headTop;
        var r;
        if (sens === 'strict') r = armUp && aboveHead;
        else if (sens === 'easy') r = armUp && (aboveHead || (W.y < Sp.y - 0.6 * nh && (elbowUp || !elbowOk)));
        else {                                                                   // a bent raise: hand at forehead height or higher, forearm fairly upright
          var steep = elbowOk && (E.y - W.y) > 1.1 * Math.abs(E.x - W.x);         // (a hand over the eye / in the hair has the forearm across)
          r = armUp && (aboveHead || (W.y < head.y - 0.25 * nh && elbowUp && steep));
        }
        var h = W.y < Sp.y - 0.15 * nh && (!elbowOk || W.y < E.y + 0.2 * nh);   // still up (lower bar than raising)
        if (r) raised = true;
        if (h) held = true;
        if ((r || h) && W.y < best) { best = W.y; hand = { x: W.x, y: W.y }; }
        wy = wy === undefined ? W.y : Math.min(wy, W.y);
      }
    }

    // Seen from behind, the model often misplaces a raised wrist (the arm passes behind the head), but the person's box
    // still stretches up to include the hand: a box reaching well above the head means a hand is up.
    var backView = k[0].v < 0.4 && k[1].v < 0.4 && k[2].v < 0.4;            // facing away: nose and eyes not seen
    var whole = box.x0 > 0.01 && box.x1 < 0.99 && box.y0 > 0.01;            // a box cut by the picture edge says nothing about a hand
    if (backView && whole && sh && sens !== 'strict' && head && bh > 3 * nh) {
      var reach = head.y - box.y0;                                           // a normal box top is about 1 x nh above the head centre
      if (reach > 1.75 * nh) { raised = true; if (!hand) hand = { x: (box.x0 + box.x1) / 2, y: box.y0 }; }
      if (reach > 1.45 * nh) held = true;
    }

    var bbox = { x0: box.x0, y0: Math.min(box.y0, top.y), x1: box.x1, y1: box.y1 };
    var inQ = opt.inQuad || function () { return true; };
    return {
      x: top.x, y: top.y, s: s, score: p.score, box: box, bbox: bbox, kp: k,
      good: boxOnly || (faceN > 0 && !!sh),
      raised: raised, held: raised || held, hx: hand ? hand.x : 0, hy: hand ? hand.y : 0, wy: wy, line: line,
      inside: inQ(foot, 1), insideExp: inQ(foot, 1.12)
    };
  }

  function boxIoU(A, B) {
    var ix = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), iy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
    if (ix <= 0 || iy <= 0) return 0;
    var inter = ix * iy, u = (A.x1 - A.x0) * (A.y1 - A.y0) + (B.x1 - B.x0) * (B.y1 - B.y0) - inter;
    return u > 0 ? inter / u : 0;
  }
  // skeleton match: mean distance of keypoints both detections are sure about, in units of body size
  function kpMatch(a, b) {
    if (!a.kp || !b.kp) return null;
    var n = 0, d = 0, sc = Math.max(a.s, b.s);
    for (var i = 0; i < 17; i++) if (a.kp[i].v > 0.5 && b.kp[i].v > 0.5) { n++; d += Math.hypot(a.kp[i].x - b.kp[i].x, a.kp[i].y - b.kp[i].y); }
    return n >= 5 ? d / n / sc : null;
  }
  function isDup(a, b) {
    if (a.box && b.box && boxIoU(a.box, b.box) > 0.8) return true;
    var m = kpMatch(a, b);
    if (m != null) return m < 0.18;
    return Math.hypot(a.x - b.x, a.y - b.y) < 0.2 * Math.max(a.s, b.s);       // no skeleton to compare: heads on the same spot
  }
  function clean(dets, opt) {
    var minS = { strict: 0.04, normal: 0.022, loose: 0.012 }[(opt && opt.sens) || 'normal'] || 0.022;
    var keep = [];
    dets.filter(function (d) { return d && d.s >= minS; }).sort(function (a, b) { return b.score - a.score; }).forEach(function (d) {
      var k = null;
      for (var i = 0; i < keep.length && !k; i++) if (isDup(keep[i], d)) k = keep[i];
      if (!k) keep.push(d);
      else if (d.raised && !k.raised) { k.raised = k.held = true; k.hx = d.hx; k.hy = d.hy; }   // a raised hand on a duplicate pose still counts
    });
    return keep;
  }

  var api = { toDet: toDet, fromMediaPipe: fromMediaPipe, clean: clean, isDup: isDup, boxIoU: boxIoU };
  root.PoseLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
