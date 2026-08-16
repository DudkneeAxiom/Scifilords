// Animation inspection rig.
//
// Parks a fixed camera beside a soldier and photographs each pose the game can
// produce — idle, mid-stride, shouldered, reloading, collapsing — plus a strip
// of frames through the walk cycle so the gait can be judged as a sequence
// rather than from a single lucky frame.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'qa-anim';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  const S = window.KR.campaign;
  S.contracts[0].accepted = true;
  window.KR.world.stopTravel();
  S.pos.x = 200; S.pos.z = -220;
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const el = document.querySelector('#modal [data-x="avoid"]');
  if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const S = window.KR.campaign; S.pos.x = 200; S.pos.z = -220;
});
await page.waitForTimeout(600);
await page.keyboard.press('e');
await page.waitForSelector('#modal [data-x="go"]', { timeout: 15000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
// The insertion cinematic locks out input and holds all fire; anything
// measured across it is measuring a frozen game. waitForControlHelper
await page.waitForFunction(
  () => window.KR.mission && !window.KR.mission.intro?.active && !window.KR.mission.inserting,
  null, { timeout: 30000 });
await page.waitForTimeout(2000);

// Freeze the world: stop the loop, clear the level away from the subject, and
// drive the character update by hand so each pose is exact and repeatable.
await page.evaluate(() => {
  const m = window.KR.mission;
  cancelAnimationFrame(m.raf);
  m.paused = true;
  // Remove everyone else so nothing occludes the subject.
  m.entities.filter((e) => e !== m.player).forEach((e) => { e.char.group.visible = false; });
  m.player.x = 74; m.player.z = 74; m.player.yaw = 0;
  m.player.char.group.position.set(74, 0, 74);
  m.hidePlayerModel = false;
  m.player.char.group.visible = true;
  window.__pose = (opts, frames = 40, dt = 1 / 60) => {
    const c = m.player.char;
    // Run the state blends forward so lerped values actually settle.
    for (let i = 0; i < frames; i++) c.update(dt, opts);
    c.group.position.set(74, 0, 74);
    c.group.rotation.y = 0;
    m.camera.position.set(77.6, 1.30, 76.9);
    m.camera.lookAt(74, 0.95, 74);
    m.camera.updateMatrixWorld(true);
    m.renderer.render(m.scene, m.camera);
  };
  window.__poseFront = (opts, frames = 40) => {
    const c = m.player.char;
    for (let i = 0; i < frames; i++) c.update(1 / 60, opts);
    c.group.position.set(74, 0, 74);
    c.group.rotation.y = 0;
    m.camera.position.set(74.2, 1.35, 78.2);
    m.camera.lookAt(74, 0.95, 74);
    m.camera.updateMatrixWorld(true);
    m.renderer.render(m.scene, m.camera);
  };
});

const shot = async (name) => {
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
};

const POSES = {
  idle: { speed: 0, aiming: false },
  'idle-aiming': { speed: 0, aiming: true },
  'walk-forward': { speed: 4.2, moveZ: 1, aiming: false },
  'walk-aiming': { speed: 2.0, moveZ: 1, aiming: true },
  sprint: { speed: 6.3, moveZ: 1, aiming: false, sprint: true },
  backpedal: { speed: 3.0, moveZ: -1, aiming: true },
  strafe: { speed: 3.4, moveX: 1, aiming: true },
  'aim-up': { speed: 0, aiming: true, pitch: -0.45 },
  'aim-down': { speed: 0, aiming: true, pitch: 0.5 },
  reloading: { speed: 0, aiming: true, reload: 0.5 },
  down: { speed: 0, down: true },
  dead: { speed: 0, dead: true },
};

for (const [name, opts] of Object.entries(POSES)) {
  await page.evaluate((o) => window.__pose(o, 80), opts);
  await shot(`side-${name}`);
}
for (const name of ['idle-aiming', 'walk-forward', 'reloading']) {
  await page.evaluate((o) => window.__poseFront(o, 80), POSES[name]);
  await shot(`front-${name}`);
}

// Walk cycle strip: eight evenly spaced frames of one full stride.
for (let i = 0; i < 8; i++) {
  await page.evaluate((i) => {
    const m = window.KR.mission;
    const c = m.player.char;
    c.state.phase = i / 8;
    // One tiny step so the pose is applied without advancing the phase much.
    c.update(0.0001, { speed: 4.2, moveZ: 1, aiming: false });
    c.group.position.set(74, 0, 74);
    c.group.rotation.y = 0;
    m.camera.position.set(77.6, 1.30, 76.9);
    m.camera.lookAt(74, 0.95, 74);
    m.camera.updateMatrixWorld(true);
    m.renderer.render(m.scene, m.camera);
  }, i);
  await shot(`cycle-${i}`);
}

console.log('\nwrote qa-anim/');
await browser.close();
