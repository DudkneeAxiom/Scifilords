// Renders every origin's soldier side by side, standing and mid-stride, so the
// claim "each faction looks different" can be checked with an eye rather than
// asserted. Also reports joint travel per variant — a rig that loads but does
// not move is the failure mode that matters.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-origins', { recursive: true });
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 560 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });

const report = await page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.min.js');
  const Models = window.KR.dev.Models;
  const { ORIGINS } = window.KR.dev.DATA;
  const ids = Object.keys(ORIGINS);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#15161a';
  document.body.appendChild(host);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(1400, 560);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15161a);
  scene.add(new THREE.HemisphereLight(0x8a94a6, 0x1a1a16, 2.2));
  const key = new THREE.DirectionalLight(0xf2dcb0, 3.2);
  key.position.set(3, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6a7c94, 2.0);
  rim.position.set(-3, 2, -2.5);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(26, 1400 / 560, 0.1, 80);
  const span = ids.length;
  camera.position.set((span - 1) * 1.1, 1.5, 12.5);
  camera.lookAt((span - 1) * 1.1, 0.95, 0);

  const chars = [];
  for (let i = 0; i < ids.length; i++) {
    const c = Models.makeCharacter(ORIGINS[ids[i]].model, 'wpn_rifle');
    c.group.position.set(i * 2.2, 0, 0);
    c.group.rotation.y = 0.35;
    scene.add(c.group);
    chars.push(c);
  }

  // Joint travel: sample a walking pose over a full cycle and record how far
  // each rig's knee actually rotates. A frozen rig reports ~0.
  const travel = {};
  const step = (dt, opts) => { for (const c of chars) c.update(dt, opts); };
  const walking = { moving: true, speed: 4.2, aiming: false, fwd: 1, side: 0, dt: 0 };
  const kneeMin = ids.map(() => 9); const kneeMax = ids.map(() => -9);
  for (let f = 0; f < 90; f++) {
    step(1 / 30, walking);
    for (let i = 0; i < chars.length; i++) {
      const k = chars[i].rig.kneeL?.rotation.x ?? 0;
      if (k < kneeMin[i]) kneeMin[i] = k;
      if (k > kneeMax[i]) kneeMax[i] = k;
    }
  }
  for (let i = 0; i < ids.length; i++) travel[ids[i]] = +(kneeMax[i] - kneeMin[i]).toFixed(3);

  window.__originShot = async (pose) => {
    if (pose === 'stand') {
      for (const c of chars) c.update(0.016, { moving: false, speed: 0, aiming: false });
      for (let i = 0; i < 30; i++) step(1 / 30, { moving: false, speed: 0, aiming: false });
    } else {
      for (let i = 0; i < 8; i++) step(1 / 30, walking);
    }
    renderer.render(scene, camera);
  };
  await window.__originShot('stand');
  return { ids, travel, models: ids.map((i) => ORIGINS[i].model) };
});

console.log('Origins rendered:', report.ids.join(', '));
console.log('Models:', report.models.join(', '));
console.log('\nKnee travel over a walk cycle (radians):');
let frozen = 0;
for (const id of report.ids) {
  const t = report.travel[id];
  if (t < 0.5) frozen++;
  console.log(`  ${id.padEnd(10)} ${t}${t < 0.5 ? '   <-- FROZEN' : ''}`);
}
await page.evaluate(() => window.__originShot('stand'));
await page.screenshot({ path: 'qa-origins/01-standing.png' });
await page.evaluate(() => window.__originShot('walk'));
await page.screenshot({ path: 'qa-origins/02-walking.png' });
console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
console.log(frozen === 0 && errors.length === 0
  ? '\nOK — every origin rig loads and animates.'
  : `\nFAIL — ${frozen} frozen rig(s), ${errors.length} error(s).`);
await browser.close();
