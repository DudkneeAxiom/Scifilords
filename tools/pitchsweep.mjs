// One pose, several weapon pitches, side by side. Tuning a hold by editing a
// number and re-rendering one image at a time is how an afternoon disappears.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa', { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 300, height: 380 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.min.js');
  const Models = await import('/src/models.js');
  await Models.preload?.(() => {});
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.style.background = '#16160f';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(300, 380);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 300 / 380, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0x9aa4b6, 0x1a1a16, 2.2));
  const key = new THREE.DirectionalLight(0xf2dcb0, 3.2);
  key.position.set(2.6, 3.4, 2.4); scene.add(key);
  window.__rig = { THREE, Models, renderer, scene, camera, current: null };
});

const dir = process.argv[2] || 'overhead';
const vals = (process.argv[3] || '-1.9,-1.4,-0.9,-0.4,0.2').split(',').map(Number);
for (const v of vals) {
  await page.evaluate(async ({ dir, v }) => {
    const { Models, renderer, scene, camera } = window.__rig;
    const { WEAPONS } = await import('/src/data.js');
    const def = WEAPONS.sword;
    if (window.__rig.current) { scene.remove(window.__rig.current.group); }
    const ch = Models.makeCharacter('soldier_bracket', 'wpn_sword');
    scene.add(ch.group);
    window.__rig.current = ch;
    for (let i = 0; i < 120; i++) {
      ch.update(1 / 60, {
        melee: true, swing: 0, swingDir: 'right', guard: 1, guardDir: dir,
        hold: def.hold, guardPose: { ...def.guard, pitch: v },
        speed: 0, moving: 0, pitch: 0,
      });
    }
    camera.position.set(2.15, 1.42, 2.15);
    camera.lookAt(0, 1.05, 0);
    renderer.render(scene, camera);
  }, { dir, v });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `qa/pitch-${dir}-${v}.png` });
}
console.log('wrote qa/pitch-' + dir + '-*.png for', vals.join(' '));
await browser.close();
