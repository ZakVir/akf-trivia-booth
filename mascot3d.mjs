/*
 * mascot3d.mjs -- the 3D screen-buddy mascot in the top tab of the TV screen (8 animated states, models/mascot/*.glb).
 * Adapted from the model maker's import guide (same camera, lighting and per-state motion), without a build step.
 * If WebGL or the models are unavailable the flat SVG face in the tab simply stays (nothing breaks).
 *
 *   window.Mascot3D.setState(key)            idle_happy | hosts_speaking | timer_pocket_watch | thinking_ponder |
 *                                            hand_raised_alert | correct_answer | wrong_answer | grand_winner
 *   window.Mascot3D.updateTimer(secLeft, totalSec)   shows the pocket watch, hands turn, shakes near 0
 *   window.Mascot3D.lookAt(nx, ny)            -1..1 screen direction (e.g. towards the player who raised a hand)
 * The game decides WHEN (audience.js, MascotDirector); this file only draws.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FILES = {
  idle_happy: '01_idle_happy.glb', hosts_speaking: '02_hosts_speaking.glb', timer_pocket_watch: '03_timer_pocket_watch.glb',
  thinking_ponder: '04_thinking_ponder.glb', hand_raised_alert: '05_hand_raised_alert.glb', correct_answer: '06_correct_answer.glb',
  wrong_answer: '07_wrong_answer.glb', grand_winner: '08_grand_winner.glb'
};

class MascotController {
  constructor(container, base) {
    this.container = container; this.base = base;
    this.models = new Map(); this.state = 'idle_happy'; this.stateEnter = 0;
    this.timerActive = false; this.timerProgress = 0; this.timerUrgency = 0;
    this.look = { x: 0, y: 0 }; this.lookNow = { x: 0, y: 0 };
    this.blinkT = 0; this.nextBlink = 2.5; this.disposed = false;
    const w = container.clientWidth || 149, h = container.clientHeight || 135;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 15);
    this.camera.position.set(0, -0.02, 2.35); this.camera.lookAt(0, -0.02, 0);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(2);                                   // the TV stage is scaled; render crisp
    this.renderer.setSize(w, h, false);
    container.appendChild(this.renderer.domElement);
    const amb = new THREE.AmbientLight(0xffffff, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-1.5, 2.2, 2.5);
    const fill = new THREE.DirectionalLight(0xffffff, 1.4); fill.position.set(2.0, -0.6, 1.8);
    const rim = new THREE.DirectionalLight(0xffffff, 1.8); rim.position.set(0, 2.4, -1.8);
    this.scene.add(amb, key, fill, rim);
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ'); this.q = new THREE.Quaternion();
  }

  async load() {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
      const gltf = await loader.loadAsync(this.base + file);
      const root = gltf.scene, nodes = {}, rest = {};
      root.visible = false;
      root.traverse(o => { if (o.name) { nodes[o.name] = o; rest[o.name] = { pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() }; } });
      this.scene.add(root);
      this.models.set(key, { root, nodes, rest });
    }));
    this.setState(this.state);
    this.clock = new THREE.Clock();
    const loop = () => { if (this.disposed) return; requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  setState(key) {
    if (!this.models.has(key) || (key === this.state && this.models.get(key).root.visible)) return;
    for (const [k, e] of this.models) {
      e.root.visible = k === key;
      if (k === key) for (const [n, o] of Object.entries(e.nodes)) { o.position.copy(e.rest[n].pos); o.quaternion.copy(e.rest[n].quat); o.scale.copy(e.rest[n].scale); }
    }
    if (key !== 'timer_pocket_watch') this.timerActive = false;
    this.state = key; this.stateEnter = performance.now() / 1000;
  }

  updateTimer(secLeft, total) {
    const tot = Math.max(total, 1), sec = Math.max(0, Math.min(tot, secLeft));
    this.timerActive = true; this.timerProgress = 1 - sec / tot;
    this.timerUrgency = sec <= 0 ? 1 : sec <= 4 ? 0.55 + 0.45 * (1 - sec / 4) : sec / tot <= 0.45 ? 0.25 * (1 - (sec / tot) / 0.45) : 0;
    if (this.state !== 'timer_pocket_watch') this.setState('timer_pocket_watch');
  }

  restart() { this.stateEnter = performance.now() / 1000; }                  // play the current state's animation again (a second point)

  lookAt(nx, ny) { this.look.x = Math.max(-1, Math.min(1, nx)); this.look.y = Math.max(-1, Math.min(1, ny)); }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = performance.now() / 1000, el = t - this.stateEnter;
    const e = this.models.get(this.state); if (!e) return;
    const { nodes, rest } = e, eu = this.euler, q = this.q;
    const apply = (name, dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const n = nodes[name], r = rest[name]; if (!n || !r) return;
      n.position.set(r.pos.x + dx, r.pos.y + dy, r.pos.z + dz);
      eu.set(rx, ry, rz, 'YXZ'); q.setFromEuler(eu); n.quaternion.copy(r.quat).multiply(q);
      n.scale.set(r.scale.x * sx, r.scale.y * sy, r.scale.z * sz);
    };
    // gaze eases towards its target (no snapping)
    this.lookNow.x += (this.look.x - this.lookNow.x) * Math.min(1, dt * 6); this.lookNow.y += (this.look.y - this.lookNow.y) * Math.min(1, dt * 6);
    const yaw = this.lookNow.x * 0.28, pitch = this.lookNow.y * 0.22;          // +x rotation turns the face down: look y > 0 is below the mascot
    if (['idle_happy', 'hosts_speaking', 'thinking_ponder', 'timer_pocket_watch'].includes(this.state)) {     // natural blink
      let sy = 1;
      if (this.blinkT > 0) { this.blinkT = Math.max(0, this.blinkT - dt); sy = Math.max(0.14, 1 - 0.88 * Math.sin((this.blinkT / 0.16) * Math.PI)); }
      else if ((this.nextBlink -= dt) <= 0) { this.blinkT = 0.16; this.nextBlink = 2.8 + Math.random() * 2.2; }
      apply('LeftEye', 0, 0, 0, 0, 0, 0, 1, sy, 1); apply('RightEye', 0, 0, 0, 0, 0, 0, 1, sy, 1);
    }
    switch (this.state) {
      case 'idle_happy': apply('FaceRoot', 0, Math.sin(t * 1.8) * 0.026, 0, pitch, yaw, Math.sin(t * 0.9) * 0.03); break;
      case 'hosts_speaking': {
        const talk = 0.35 + 0.35 * Math.abs(Math.sin(t * 6.5));
        apply('FaceRoot', 0, Math.sin(t * 2.8) * 0.018, 0, pitch + Math.sin(t * 2.8) * 0.075, yaw, 0);
        apply('Mouth', 0, 0, 0, 0, 0, 0, 1 - talk * 0.08, 1 + talk * 0.42, 1); break;
      }
      case 'timer_pocket_watch': {
        const prog = this.timerActive ? this.timerProgress : (el % 9) / 9;
        const urg = this.timerActive ? this.timerUrgency : (prog > 0.55 ? Math.pow((prog - 0.55) / 0.45, 1.35) : 0);
        apply('MinuteHand', 0, 0, 0, 0, 0, -prog * Math.PI * 6); apply('HourHand', 0, 0, 0, 0, 0, -prog * Math.PI * 0.75);
        apply('PocketWatch', urg * 0.032 * Math.sin(t * 38), urg * 0.032 * Math.cos(t * 34) + Math.sin(t * 2.2) * 0.016, 0, 0, 0, urg * 0.26 * Math.sin(t * 44));
        apply('FaceRoot', urg * 0.016 * Math.cos(t * 35), Math.sin(t * 2.2) * 0.015 + urg * 0.014 * Math.sin(t * 31), 0, Math.sin(t * 2.2) * 0.03, 0, 0); break;
      }
      case 'thinking_ponder':
        apply('FaceRoot', 0, Math.sin(t * 1.5) * 0.022, 0, pitch, yaw + Math.sin(t * 1.1) * 0.05, 0);
        apply('Prop', 0, Math.sin(t * 2.4 + 0.7) * 0.038, 0, 0, Math.sin(t * 1.4) * 0.22, Math.sin(t * 1.8) * 0.11); break;
      case 'hand_raised_alert': {
        const pop = Math.exp(-el * 3.5) * Math.abs(Math.sin(el * 12));
        apply('FaceRoot', 0, pop * 0.07 + Math.sin(t * 2.4) * 0.016, 0, pitch, yaw, 0);
        apply('Prop', 0, pop * 0.12 + Math.abs(Math.sin(t * 3.4)) * 0.035, 0, 0, 0, Math.sin(t * 4) * 0.06); break;
      }
      case 'correct_answer': {
        const spin = el < 1.05 ? (1 - Math.cos((el / 1.05) * Math.PI)) * Math.PI : Math.sin(t * 2.4) * 0.14;
        apply('FaceRoot', 0, Math.abs(Math.sin(t * 3.6)) * 0.065, 0, 0, spin + yaw, Math.sin(t * 1.8) * 0.07); break;
      }
      case 'wrong_answer': {
        const decay = Math.max(0.22, Math.exp(-el * 0.9));
        apply('FaceRoot', 0, -0.015 + Math.sin(t * 1.5) * 0.01, 0, 0, Math.sin(t * 8.5) * 0.24 * decay + yaw, 0); break;
      }
      case 'grand_winner':
        apply('FaceRoot', 0, Math.abs(Math.sin(t * 3.4)) * 0.055, 0, 0, Math.sin(t * 1.7) * 0.14 + yaw, Math.sin(t * 1.7) * 0.09);
        apply('Prop', 0, Math.abs(Math.sin(t * 3.4 + 0.35)) * 0.065, 0, 0, t * 1.4, Math.sin(t * 1.7) * 0.08); break;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

(async () => {
  const box = document.getElementById('mascot3d');
  if (!box || new URLSearchParams(location.search).has('noMascot3d')) return;
  try {
    const c = new MascotController(box, 'models/mascot/');
    await c.load();
    document.body.classList.add('mascot3d-on');                      // hides the flat face
    window.Mascot3D = { setState: k => c.setState(k), restart: () => c.restart(), updateTimer: (s, t) => c.updateTimer(s, t), lookAt: (x, y) => c.lookAt(x, y), get state() { return c.state; } };
    window.dispatchEvent(new Event('mascot3d-ready'));
  } catch (e) { console.warn('[mascot3d] staying with the flat face:', (e && e.message) || e); }
})();
