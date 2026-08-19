// How the steel is actually held.
//
// "The way they hold the weapons is way off" is a claim about a pose, and a
// pose has to be looked at. A bare scene, one soldier, one weapon, the rig
// driven straight into each state and photographed from a fixed
// three-quarter view — so the poses can be compared with each other rather
// than with a memory of the last screenshot.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 520, height: 620 } });
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
  renderer.setSize(520, 620);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 520 / 620, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0x9aa4b6, 0x1a1a16, 2.2));
  const key = new THREE.DirectionalLight(0xf2dcb0, 3.2);
  key.position.set(2.6, 3.4, 2.4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6a7c94, 1.6);
  rim.position.set(-2.4, 1.8, -2.4);
  scene.add(rim);

  window.__rig = { THREE, Models, renderer, scene, camera, current: null };
});

const shots = [
  ['sword-carry', 'sword', { guard: 0, ph: 0 }],
  ['sword-guard-high', 'sword', { guard: 1, guardDir: 'overhead', ph: 0 }],
  ['sword-guard-right', 'sword', { guard: 1, guardDir: 'right', ph: 0 }],
  ['sword-windup', 'sword', { guard: 0, ph: 0.45, dir: 'right' }],
  ['sword-impact', 'sword', { guard: 0, ph: 0.62, dir: 'right' }],
  ['spear-carry', 'spear', { guard: 0, ph: 0 }],
  ['spear-brace', 'spear', { guard: 1, guardDir: 'thrust', ph: 0 }],
  ['spear-thrust', 'spear', { guard: 0, ph: 0.6, dir: 'thrust' }],
  ['maul-carry', 'heavy', { guard: 0, ph: 0 }],
  ['maul-overhead', 'heavy', { guard: 0, ph: 0.6, dir: 'overhead' }],
  ['bow-carry', 'bow', { guard: 0, ph: 0 }],
];

for (const [name, wid, st] of shots) {
  await page.evaluate(async ({ wid, st }) => {
    const { THREE, Models, renderer, scene, camera } = window.__rig;
    const { WEAPONS } = await import('/src/data.js');
    const def = WEAPONS[wid];
    if (window.__rig.current) {
      scene.remove(window.__rig.current.group);
      window.__rig.current.dispose?.();
    }
    const ch = Models.makeCharacter('soldier_bracket', `wpn_${wid}`);
    scene.add(ch.group);
    window.__rig.current = ch;
    for (let i = 0; i < 120; i++) {
      ch.update(1 / 60, {
        melee: !!def.melee, swing: st.ph, swingDir: st.dir || 'right',
        guard: st.guard, guardDir: st.guardDir || 'overhead',
        hold: def.hold, guardPose: def.guard,
        speed: 0, moving: 0, pitch: 0,
      });
    }
    // Three-quarter, chest height, close enough to read the hands.
    camera.position.set(2.15, 1.42, 2.15);
    camera.lookAt(0, 1.0, 0);
    renderer.render(scene, camera);
  }, { wid, st });
  await page.waitForTimeout(140);
  await page.screenshot({ path: `qa/hold-${name}.png` });
}
console.log('wrote qa/hold-*.png');
await browser.close();
