/*
 * logo-sprites.mjs -- the player marker is the 3D AKF lattice logo (models/logo/akf-logo.glb) in each team's colour.
 * Markers are drawn on 2D canvases (live feed, replay, podium), so the logo is rendered ONCE per colour into a strip of
 * FRAMES turning angles (lazily, the first time a colour is needed, spread over a few animation frames so nothing
 * stutters). kites.js then just picks the frame for the current angle: real 3D shading, almost no cost per frame.
 *
 *   window.LogoSprites.get('#E5484D') -> { img: canvas strip, frames, px, aspect } once ready, else null (kites.js keeps the
 *   old diamond for that moment). Fails quietly without WebGL: the diamond stays.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FRAMES = 40, PX = 160, PER_TICK = 8;
const ready = new Map(), queue = [], queued = new Set();
let renderer, scene, camera, logo, mat, working = false;

async function init() {
  const gltf = await new GLTFLoader().loadAsync('models/logo/akf-logo.glb');
  logo = gltf.scene;
  const box = new THREE.Box3().setFromObject(logo), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  logo.position.sub(centre);                                                  // turn around its own middle
  const pivot = new THREE.Group(); pivot.add(logo); logo = pivot;
  mat = null; pivot.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); mat = mat || o.material; o.material = mat; } });
  scene = new THREE.Scene(); scene.add(pivot);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(-1.2, 1.8, 2.4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.0); fill.position.set(1.8, -0.4, 1.6); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.6); rim.position.set(0, 1.5, -2.0); scene.add(rim);
  const h = Math.max(size.y, size.x, size.z) * 1.12;                          // the logo fills the frame height with a small margin
  camera = new THREE.OrthographicCamera(-h / 2, h / 2, h / 2, -h / 2, -1, 1);
  camera.position.set(0, 0, 0.5); camera.lookAt(0, 0, 0);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(1); renderer.setSize(PX, PX, false); renderer.setClearColor(0x000000, 0);
  return size.y / Math.max(1e-6, h);                                         // logo height as a share of the frame
}

function pump(aspect) {
  if (working || !queue.length) return;
  working = true;
  const hex = queue[0];
  let job = pump.job;
  if (!job || job.hex !== hex) {
    const strip = document.createElement('canvas'); strip.width = PX * FRAMES; strip.height = PX;
    job = pump.job = { hex, strip, g: strip.getContext('2d'), i: 0 };
    mat.color.set(hex);                                                       // sRGB team colour (three converts to linear)
  }
  for (let n = 0; n < PER_TICK && job.i < FRAMES; n++, job.i++) {
    logo.rotation.y = job.i / FRAMES * Math.PI * 2;
    renderer.render(scene, camera);
    job.g.drawImage(renderer.domElement, job.i * PX, 0);
  }
  if (job.i >= FRAMES) { ready.set(hex, { img: job.strip, frames: FRAMES, px: PX, fill: aspect }); queue.shift(); pump.job = null; }
  working = false;
  if (queue.length) requestAnimationFrame(() => pump(aspect));
}

(async () => {
  if (new URLSearchParams(location.search).has('noLogo3d')) return;
  try {
    const fill = await init();
    window.LogoSprites = {
      get(hex) {
        const k = String(hex).toUpperCase(), r = ready.get(k);
        if (r) return r;
        if (!queued.has(k)) { const start = queue.length === 0; queued.add(k); queue.push(k); if (start) requestAnimationFrame(() => pump(fill)); }   // one pump works through the queue
        return null;
      }
    };
    if (typeof TEAMS !== 'undefined') Object.values(TEAMS).forEach(t => window.LogoSprites.get(t.color));   // warm up every team colour
  } catch (e) { console.warn('[logo] keeping the diamond markers:', (e && e.message) || e); }
})();
