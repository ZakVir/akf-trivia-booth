/*
 * leaderboard.js -- the podium in the scores panel is a live top-3 leaderboard.
 *   middle (tallest) bar = 1st place, left = 2nd, right = 3rd (as in the design).
 *   Each bar takes its team's colour and carries that team's spinning kite. When a place changes hands, the kite
 *   flies up out of the tab, the bar changes colour, and the kite drops back with a bounce in the new team's colour.
 *   Before anyone scores, the podium looks exactly like the design (teal / coral / gold bars with stars).
 *
 *   Leaderboard.top3(scores, teams, order)  -> ['red', 'blue', null]  (only teams with points; ties: earlier in `order`)
 *   const p = new Leaderboard.Podium();  p.set(top3, nowMs);  p.frame(nowMs) -> per slot { team, kiteY (0 = resting,
 *       < 0 = above), barFrom, barTo, mix 0..1, star (no team) }
 *   Leaderboard.draw(ctx, podium, nowMs, teams, Kites)   draws it on a 229 x 224 canvas (design units)
 * Pure logic is DOM-free so tests can check it in node.
 */
(function (root) {
  'use strict';
  var UP_MS = 380, DOWN_MS = 620;
  var EMPTY = ['#FB5D46', '#02A5A7', '#FCB502'];        // design colours of the 1st / 2nd / 3rd bars

  function top3(scores, teams, order) {
    var list = (teams || []).filter(function (t) { return (scores && scores[t]) > 0; });
    list.sort(function (a, b) { return (scores[b] - scores[a]) || (order.indexOf(a) - order.indexOf(b)); });
    var out = list.slice(0, 3); while (out.length < 3) out.push(null);
    return out;
  }

  function Podium() { this.slots = [0, 1, 2].map(function () { return { team: null, shown: null, t0: -1e9, from: null }; }); }
  Podium.prototype.set = function (teams, now) {
    for (var i = 0; i < 3; i++) {
      var s = this.slots[i], want = teams[i] || null;
      if (want === s.team) continue;
      // a change while still animating: keep flying, the kite just lands in the newest colour
      var busy = now - s.t0 < UP_MS + DOWN_MS;
      if (!busy) s.from = s.team;
      s.team = want;
      if (!busy) s.t0 = now;
    }
  };
  // per-slot state for drawing at time `now`
  Podium.prototype.frame = function (now) {
    return this.slots.map(function (s) {
      var e = now - s.t0, kiteY = 0, showTeam = s.team, mix = 1, from = s.from;
      if (e < UP_MS) {                                   // flying up (ease-in) with the OLD colour
        var u = e / UP_MS; kiteY = -(u * u); showTeam = s.from; mix = 0;
      } else if (e < UP_MS + DOWN_MS) {                  // dropping back (ease-out with a small bounce) in the NEW colour
        var d = (e - UP_MS) / DOWN_MS, c = 1.70158;
        var back = 1 + (c + 1) * Math.pow(d - 1, 3) + c * Math.pow(d - 1, 2);   // easeOutBack 0 -> 1 (overshoots a little)
        kiteY = -(1 - back); mix = Math.min(1, d * 2.5);
      }
      return { team: showTeam, kiteY: kiteY, barFrom: from, barTo: s.team, mix: mix, star: !showTeam };
    });
  };

  // ----- drawing (browser only) -----
  var BARS = [ // design geometry, 229 x 224 tab: [x, top, width] ; slot 0 = 1st (middle), 1 = 2nd (left), 2 = 3rd (right)
    [93, 71, 49], [45, 105, 47], [143, 128, 42]
  ], BOTTOM = 186;
  function hexMix(a, b, k) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) * (1 - k) + ((pb >> 16) & 255) * k), g = Math.round(((pa >> 8) & 255) * (1 - k) + ((pb >> 8) & 255) * k), bl = Math.round((pa & 255) * (1 - k) + (pb & 255) * k);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function star(ctx, cx, cy, r, color) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function draw(ctx, podium, now, TEAMS, Kites) {
    ctx.clearRect(0, 0, 229, 224);
    var f = podium.frame(now), t = now / 1000;
    for (var i = 0; i < 3; i++) {
      var b = BARS[i], s = f[i];
      var cFrom = s.barFrom ? TEAMS[s.barFrom].color : EMPTY[i], cTo = s.barTo ? TEAMS[s.barTo].color : EMPTY[i];
      rrect(ctx, b[0], b[1], b[2], BOTTOM - b[1], 4); ctx.fillStyle = hexMix(cFrom, cTo, s.mix); ctx.fill();
      var cx = b[0] + b[2] / 2, rest = b[1] - 20, y = rest + s.kiteY * (rest + 40);   // kiteY -1 = just above the top edge
      if (s.star) star(ctx, cx, b[1] - 12 + Math.min(0, y - rest), i === 0 ? 12 : 9, i === 1 ? '#02A3AA' : '#FAB603');
      else if (Kites) Kites.draw(ctx, cx, y, i === 0 ? 34 : 28, TEAMS[s.team].color, t, i * 1.7, '', 0);
    }
  }

  var api = { top3: top3, Podium: Podium, draw: draw, UP_MS: UP_MS, DOWN_MS: DOWN_MS };
  root.Leaderboard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
