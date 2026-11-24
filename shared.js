const CH = new BroadcastChannel('akf-booth');

/* Eight player colors. Each person in the play square gets one; their kite wears it. */
const PALETTE = [
  { id: 'red',    name: 'Red',    color: '#E5484D' },
  { id: 'orange', name: 'Orange', color: '#F28C28' },
  { id: 'gold',   name: 'Gold',   color: '#F2B01E' },
  { id: 'green',  name: 'Green',  color: '#2FA562' },
  { id: 'teal',   name: 'Teal',   color: '#14B8A6' },
  { id: 'blue',   name: 'Blue',   color: '#3B82F6' },
  { id: 'purple', name: 'Purple', color: '#8B5CF6' },
  { id: 'pink',   name: 'Pink',   color: '#EC5CA8' }
];
const TEAMS = Object.fromEntries(PALETTE.map(p => [p.id, p]));
const TEAM_ORDER = PALETTE.map(p => p.id);
const LEVELS = { kids: 'Kids', everyone: 'Everyone', hard: 'Hard' };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const qType = q => (q && q.type === 'free') ? 'free' : 'mc';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Play square: four corners, normalized 0..1 in the camera frame, order TL, TR, BR, BL. */
const DEFAULT_QUAD = [[0.22, 0.42], [0.78, 0.42], [0.96, 0.96], [0.04, 0.96]];
function pointInQuad(p, quad, grow = 1) {
  const cx = quad.reduce((a, q) => a + q[0], 0) / 4, cy = quad.reduce((a, q) => a + q[1], 0) / 4;
  const q = quad.map(([x, y]) => [cx + (x - cx) * grow, cy + (y - cy) * grow]);
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function quadPoint(quad, u, v) { // bilinear point inside the quad
  const top = [quad[0][0] + (quad[1][0] - quad[0][0]) * u, quad[0][1] + (quad[1][1] - quad[0][1]) * u];
  const bot = [quad[3][0] + (quad[2][0] - quad[3][0]) * u, quad[3][1] + (quad[2][1] - quad[3][1]) * u];
  return { x: top[0] + (bot[0] - top[0]) * v, y: top[1] + (bot[1] - top[1]) * v };
}

/* Camera ranking: real cameras first, virtual ones (Sony Imaging Edge Webcam, OBS, Yosei, Snap, Zoom...) last.
   Lower is better. A virtual camera is only ever used when the host picks it by hand. */
const VIRTUAL_CAM = /imaging edge|sony camera|\bobs\b|virtual|\bndi\b|snap camera|manycam|\bcamo\b|epoccam|droidcam|splitcam|xsplit|streamlabs|mmhmm|ecamm|yosei|zoom|teams|blackmagic|screen/i;
const isVirtualCam = label => VIRTUAL_CAM.test(label || '');
/* HARD BLOCK: these cameras are removed from the list and never used, even if the browser makes them the default. */
const BLOCKED_CAM = /imaging edge|sony camera/i;
const isBlockedCam = label => BLOCKED_CAM.test(label || '');
function camRank(label, preferBuiltIn = true) {
  const l = label || '';
  if (isVirtualCam(l)) return 9;
  if (/desk view/i.test(l)) return 5;
  if (/facetime|built-in|macbook/i.test(l)) return preferBuiltIn ? 0 : 2;
  if (/iphone|ipad|continuity/i.test(l)) return preferBuiltIn ? 2 : 0;
  return 3;
}
