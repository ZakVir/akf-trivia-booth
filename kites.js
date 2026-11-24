/* The floating marker over each head.
   Normally: a slowly turning 3D diamond (Sims-style plumbob) in the player's color.
   When that player raises a hand it spins up, shrinks, and POPS into a chunky number in the same color:
   the order they raised their hand (1 = first, 2 = second, ...). morph 0 = diamond, 1 = number. */
const Kites = (() => {
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (c, to, a) => c.map((v, i) => Math.round(v + (to[i] - v) * a));
  const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const R = 0.78, TOP = 1.5, BOT = 1.1;                       // diamond: equator radius, half-heights
  const LIGHT = (() => { const v = [-0.45, -0.55, 0.7], n = Math.hypot(...v); return v.map(x => x / n); })();
  const FONT = "'Lilita One', 'Fredoka', 'Arial Rounded MT Bold', ui-rounded, system-ui, sans-serif";
  const backOut = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

  function glow(ctx, cx, cy, r, base, a) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, css(base, a)); g.addColorStop(1, css(base, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  }

  function diamond(ctx, cx, cy, size, base, ang, t, phase) {
    const sc = size * 0.5;
    glow(ctx, cx, cy, sc * 2.1, base, 0.38);
    const V = [[0, -TOP, 0], [0, BOT, 0]];
    for (let k = 0; k < 4; k++) { const a = ang + k * Math.PI / 2; V.push([Math.cos(a) * R, 0, Math.sin(a) * R]); }
    const faces = [];
    for (let k = 0; k < 4; k++) { const a = V[2 + k], b = V[2 + (k + 1) % 4]; faces.push([V[0], b, a], [V[1], a, b]); }
    const out = faces.map(f => {
      const u = f[1].map((v, i) => v - f[0][i]), w = f[2].map((v, i) => v - f[0][i]);
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const m = Math.hypot(...n) || 1; n = n.map(v => v / m);
      return { f, n, dz: (f[0][2] + f[1][2] + f[2][2]) / 3 };
    }).sort((p, q) => p.dz - q.dz);
    for (const { f, n } of out) {
      const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const col = lit > 0.5 ? mix(base, [255, 255, 255], (lit - 0.5) * 1.1) : mix(base, [20, 24, 40], (0.5 - lit) * 0.7);
      ctx.beginPath();
      f.forEach((v, i) => { const px = cx + v[0] * sc, py = cy + v[1] * sc; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.closePath(); ctx.fillStyle = css(col, 0.96); ctx.fill();
      ctx.strokeStyle = css(mix(base, [255, 255, 255], 0.55), 0.7); ctx.lineWidth = Math.max(1, size * 0.02); ctx.stroke();
    }
    const sa = t * 1.6 + phase, sx = cx + Math.cos(sa) * sc * 1.1, sy = cy - sc * 0.6 + Math.sin(sa * 1.3) * sc * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, size * 0.035), 0, 7); ctx.fill();
  }

  function number(ctx, cx, cy, size, base, t, phase, text) {
    const ang = Math.sin(t * 0.9 + phase) * 0.7, fs = size * 1.35;
    const sx = Math.cos(ang), dx = Math.sin(ang) * fs * 0.16;
    glow(ctx, cx, cy, fs * 0.95, base, 0.45);
    ctx.save();
    ctx.font = `700 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const dark = mix(base, [20, 24, 40], 0.5), layers = 9;
    for (let k = layers; k >= 1; k--) {                          // extrusion, back to front
      ctx.setTransform(sx, 0, 0, 1, cx + dx * k / layers, cy);
      ctx.lineWidth = fs * 0.12; ctx.strokeStyle = css(dark); ctx.strokeText(text, 0, 0);
      ctx.fillStyle = css(dark); ctx.fillText(text, 0, 0);
    }
    ctx.setTransform(sx, 0, 0, 1, cx, cy);
    ctx.lineWidth = fs * 0.12; ctx.strokeStyle = 'rgba(255,255,255,.96)'; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = css(base); ctx.fillText(text, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    const hl = ctx.createLinearGradient(0, -fs * 0.45, 0, fs * 0.45);
    hl.addColorStop(0, 'rgba(255,255,255,.45)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.fillText(text, 0, 0);
    ctx.restore();
    const sa = t * 1.6 + phase, spx = cx + Math.cos(sa) * fs * 0.55, spy = cy - fs * 0.25 + Math.sin(sa * 1.3) * fs * 0.3;
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(spx, spy, Math.max(1.8, size * 0.04), 0, 7); ctx.fill();
  }

  function draw(ctx, x, y, size, colorHex, t, phase, label, morph) {
    const base = hex(colorHex), m = (label === '' || label == null) ? 0 : Math.max(0, Math.min(1, morph || 0));
    const bob = Math.sin(t * 2.1 + phase) * size * 0.03, cx = x, cy = y + bob;
    if (m < 0.5) {                                              // diamond, spinning faster and shrinking as it changes
      const k = 1 - m * 2;
      diamond(ctx, cx, cy, size * (0.3 + 0.7 * k), base, t * (0.85 + (1 - k) * 9) + phase, t, phase);
    } else {                                                    // number pops in with a little overshoot
      const k = (m - 0.5) * 2;
      number(ctx, cx, cy, size * Math.max(0.05, backOut(k)), base, t, phase, String(label));
    }
  }
  return { draw };
})();
