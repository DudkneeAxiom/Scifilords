// Focused diagnostic: inspect the mission's entities, camera and rig from
// outside the game, and take controlled reference shots of a character.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('qa', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });

// Jump straight into a mission via the game's own API.
await page.evaluate(async () => {
  document.querySelector('button[data-act="new"]').click();
});
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(800);
await page.evaluate(() => window.KR && (document.querySelector('#overlay').classList.add('hidden')));

await page.evaluate(() => {
  const S = window.KR.campaign;
  S.contracts[0].accepted = true;
  S.pos.x = 200; S.pos.z = -220;
});
await page.waitForTimeout(1200);
await page.keyboard.press('e');
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('#modal [data-x="go"]')?.click());
await page.waitForTimeout(3500);

const info = await page.evaluate(() => {
  const m = window.KR.mission;
  if (!m) return { error: 'no mission' };
  const p = m.player;
  const box = new (Object.getPrototypeOf(m.scene).constructor === Object ? Object : Object)();
  const ents = m.entities.slice(0, 5).map((e) => ({
    name: e.name, side: e.side, x: +e.x.toFixed(1), z: +e.z.toFixed(1),
    y: +e.char.group.position.y.toFixed(2),
    hp: e.hp, maxHp: e.maxHp,
    visible: e.char.group.visible,
    children: e.char.group.children.length,
    rig: Object.keys(e.char.rig),
  }));
  return {
    playerHp: p.hp, playerMax: p.maxHp,
    camPos: { x: +m.camera.position.x.toFixed(2), y: +m.camera.position.y.toFixed(2), z: +m.camera.position.z.toFixed(2) },
    playerPos: { x: +p.x.toFixed(2), y: +p.char.group.position.y.toFixed(2), z: +p.z.toFixed(2) },
    camYaw: +m.camYaw.toFixed(2),
    entityCount: m.entities.length,
    ents,
    hudHp: document.getElementById('v-fill').style.width,
  };
});
console.log(JSON.stringify(info, null, 2));

// Reference shot. The render loop has to be stopped first or updateCamera
// immediately overwrites whatever we set and we photograph the game view.
const probe = await page.evaluate(() => {
  const m = window.KR.mission;
  cancelAnimationFrame(m.raf);
  m.paused = true;
  const p = m.player;
  m.camera.position.set(p.x + 3.0, 1.6, p.z + 3.0);
  m.camera.lookAt(p.x, 0.95, p.z);
  m.camera.updateMatrixWorld(true);
  m.renderer.render(m.scene, m.camera);

  // Measure the character's real bounding box in world space.
  const THREE = m.scene.constructor;
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  p.char.group.updateMatrixWorld(true);
  p.char.group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    for (const cx of [bb.min.x, bb.max.x]) {
      for (const cy of [bb.min.y, bb.max.y]) {
        for (const cz of [bb.min.z, bb.max.z]) {
          const v = new o.position.constructor(cx, cy, cz).applyMatrix4(o.matrixWorld);
          min = [Math.min(min[0], v.x), Math.min(min[1], v.y), Math.min(min[2], v.z)];
          max = [Math.max(max[0], v.x), Math.max(max[1], v.y), Math.max(max[2], v.z)];
        }
      }
    }
  });
  return {
    charMin: min.map((n) => +n.toFixed(2)),
    charMax: max.map((n) => +n.toFixed(2)),
    meshCount: (() => { let n = 0; p.char.group.traverse((o) => { if (o.isMesh) n++; }); return n; })(),
    groupScale: p.char.group.scale.toArray(),
  };
});
console.log('character bounds:', JSON.stringify(probe));
await page.waitForTimeout(200);
await page.screenshot({ path: 'qa/dbg-character.png' });
console.log('wrote qa/dbg-character.png');

await browser.close();
