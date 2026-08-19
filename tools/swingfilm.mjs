// Film a swing, and a lock.
//
// The lock-on camera, the weight in a blow, the guard poses and the new
// swing animations have all been measured through the simulation and never
// once watched. An arc that reads correctly in numbers can still look like
// a man waving a stick. This puts one opponent in front of the commander,
// locks on, and photographs a whole swing frame by frame — then the same
// for taking a hit on the guard.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const OUT = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1000);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(600);
}
// Real deployment, so the canvas is full-bleed and the HUD is the real one.
await page.evaluate(async () => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
  const { LOCATIONS } = await import('/src/data.js');
  const S = window.KR.campaign;
  const here = LOCATIONS.find((l) => l.id === 'grellan') || LOCATIONS[0];
  S.contracts.forEach((c) => { c.accepted = false; });
  S.contracts.push({ id: 'sf_1', type: 'skirmish', site: here.id, employer: 'syndic',
    title: 'Film', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
  S.pos.x = here.x; S.pos.z = here.z;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
await page.waitForFunction(() => window.KR.mission && !window.KR.mission.intro?.active
  && !window.KR.mission.inserting, null, { timeout: 60000 });

// A duel, staged: everyone else off the field, one opponent at reach, both
// immortal so the film is not cut short by somebody dying.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.paused = false; m.hadLock = true;
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  const foe = foes[0];
  for (const e of foes.slice(1)) { e.x = 800; e.z = 800; }
  for (const e of m.squad) { e.x = m.player.x - 40; e.z = m.player.z - 40; e.order = 'hold'; }
  foe.x = m.player.x; foe.z = m.player.z + 2.4;
  foe.hp = foe.maxHp = 1e6;
  m.player.hp = m.player.maxHp = 1e6;
  m.camYaw = Math.atan2(foe.x - m.player.x, foe.z - m.player.z) + Math.PI;
  m.player.yaw = Math.atan2(foe.x - m.player.x, foe.z - m.player.z);
  window.__foe = foe;
});
await page.waitForTimeout(900);

const pin = () => page.evaluate(() => {
  const m = window.KR.mission, f = window.__foe, p = m.player;
  if (!f) return;
  f.x = p.x; f.z = p.z + 2.1;
  f.moveSpeed = 0; f.hp = f.maxHp; f.down = false; f.dead = false;
  f.routing = false; f.fled = false;
  p.yaw = Math.atan2(f.x - p.x, f.z - p.z);
});

const state = () => page.evaluate(() => {
  const m = window.KR.mission;
  const p = m.player;
  return {
    lock: !!m.lockOn, locked: m.lockOn ? (m.lockOn.name || 'foe') : null,
    swing: p.swing ? +(p.swing.t ?? p.swing.time ?? 0).toFixed(2) : null,
    aim: m.aimDir || null, guard: +(p.guard || 0).toFixed(2),
    stam: +(m.pStamina ?? 0).toFixed(2),
    cam: [+m.camera.position.x.toFixed(2), +m.camera.position.y.toFixed(2), +m.camera.position.z.toFixed(2)],
    // The weight spring: what the blow does to the camera.
    wt: m.camPush ? [+m.camPush.x.toFixed(3), +m.camPush.y.toFixed(3), +m.camPush.z.toFixed(3)] : null,
    wv: m.camPushV ? +Math.hypot(m.camPushV.x, m.camPushV.y, m.camPushV.z).toFixed(2) : null,
    rose: getComputedStyle(document.getElementById('guard-rose') || document.createElement('i')).display,
    lockHud: getComputedStyle(document.getElementById('lock-hud') || document.createElement('i')).display,
  };
});

let n = 0;
const frame = async (tag) => {
  const f = `${OUT}/f${String(++n).padStart(2, '0')}-${tag}.png`;
  // Where the commander is on screen this frame, so the crop follows him.
  const box = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.min.js');
    const m = window.KR.mission;
    const el = m.renderer.domElement;
    const v = new THREE.Vector3(m.player.x, (m.player.y || 0) + 1, m.player.z);
    v.project(m.camera);
    return { x: (v.x * 0.5 + 0.5) * el.clientWidth, y: (-v.y * 0.5 + 0.5) * el.clientHeight,
      w: el.clientWidth, h: el.clientHeight };
  });
  const W = 420, H = 340;
  const clip = {
    x: Math.max(0, Math.min(box.w - W, box.x - W / 2)),
    y: Math.max(0, Math.min(box.h - H, box.y - H * 0.62)),
    width: W, height: H,
  };
  await page.screenshot({ path: f, clip });
  return f;
};

console.log('BEFORE LOCK   ' + JSON.stringify(await state()));
await frame('01-before-lock');
await pin();
await page.evaluate(() => window.KR.mission.toggleLock());
await page.waitForTimeout(700);
console.log('AFTER LOCK    ' + JSON.stringify(await state()));
await frame('02-locked');

// The swing, frame by frame.
console.log('\nswinging overhead:');
await pin();
await page.evaluate(() => { const m = window.KR.mission; m.aimDir = 'over'; m.strike(m.player, 'over'); });
for (let i = 0; i < 10; i++) {
  await pin();
  await page.waitForTimeout(35);
  const s = await state();
  await frame(`03-swing-${String(i).padStart(2, '0')}`);
  console.log(`  ~${((i + 1) * 35).toString().padStart(3)}ms  swing=${s.swing}  aim=${s.aim}`
    + `  stam=${s.stam}  cam=${JSON.stringify(s.cam)}  push=${JSON.stringify(s.wt)} v=${s.wv}`);
}

// And taking one: the foe swings, the guard rose should call it.
console.log('\ntaking a blow on the guard:');
await page.evaluate(() => {
  const m = window.KR.mission;
  m.player.guard = 1; m.guardDir = 'over';
  m.strike(window.__foe, 'over');
});
for (let i = 0; i < 6; i++) {
  await pin();
  await page.waitForTimeout(40);
  const s = await state();
  await frame(`04-block-${String(i).padStart(2, '0')}`);
  console.log(`  ~${((i + 1) * 40).toString().padStart(3)}ms  guard=${s.guard}  rose=${s.rose}`
    + `  lockHud=${s.lockHud}  cam=${JSON.stringify(s.cam)}`);
}
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
