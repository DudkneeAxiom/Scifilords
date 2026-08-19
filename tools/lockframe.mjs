// How big is the fight on screen?
//
// The lock-on, the weight spring and the swing arcs all check out in
// numbers, and are still hard to SEE: at the lock camera's distance two men
// at reach occupy a small, dark part of a 1280-wide frame. That is a
// framing question, and framing is measurable — how far back the camera
// sits, how high, and how many pixels tall the commander actually is.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
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
await page.evaluate(async () => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
  const { LOCATIONS } = await import('/src/data.js');
  const S = window.KR.campaign;
  const here = LOCATIONS.find((l) => l.id === 'grellan') || LOCATIONS[0];
  S.contracts.forEach((c) => { c.accepted = false; });
  S.contracts.push({ id: 'lf_1', type: 'skirmish', site: here.id, employer: 'syndic',
    title: 'Framing', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
  S.pos.x = here.x; S.pos.z = here.z;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
await page.waitForFunction(() => window.KR.mission && !window.KR.mission.intro?.active
  && !window.KR.mission.inserting, null, { timeout: 60000 });
await page.evaluate(() => {
  const m = window.KR.mission;
  m.paused = false; m.hadLock = true;
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  const foe = foes[0];
  for (const e of foes.slice(1)) { e.x = 800; e.z = 800; }
  foe.hp = foe.maxHp = 1e6; m.player.hp = m.player.maxHp = 1e6;
  window.__foe = foe;
});

const measure = () => page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.min.js');
  const m = window.KR.mission, p = m.player, f = window.__foe;
  const cx = m.camera.position.x, cz = m.camera.position.z;
  const bx = p.x - cx, bz = p.z - cz;
  const bl = Math.hypot(bx, bz) || 1;
  f.x = p.x + (bx / bl) * 2.1; f.z = p.z + (bz / bl) * 2.1; f.moveSpeed = 0;
  p.yaw = Math.atan2(f.x - p.x, f.z - p.z);
  const el = m.renderer.domElement, W = el.clientWidth, H = el.clientHeight;
  const proj = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(m.camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
  };
  // A soldier is about 1.8m: project head and heel and measure the gap.
  const heel = proj(p.x, p.y || 0, p.z), head = proj(p.x, (p.y || 0) + 1.8, p.z);
  const fh = proj(f.x, (f.y || 0) + 1.8, f.z), ff = proj(f.x, f.y || 0, f.z);
  return {
    lock: !!m.lockOn,
    dist: +Math.hypot(m.camera.position.x - p.x, m.camera.position.z - p.z).toFixed(2),
    height: +(m.camera.position.y - (p.y || 0)).toFixed(2),
    playerPx: +Math.abs(heel.y - head.y).toFixed(0),
    foePx: +Math.abs(ff.y - fh.y).toFixed(0),
    screen: `${W}x${H}`,
    // How much of the frame the pair occupies, corner to corner.
    pairPx: +Math.hypot(head.x - fh.x, head.y - fh.y).toFixed(0),
  };
});

await page.waitForTimeout(1200);
const free = await measure();
await page.evaluate(() => window.KR.mission.toggleLock());
await page.waitForTimeout(1200);
const locked = await measure();
for (const [name, r] of [['free look', free], ['locked on', locked]]) {
  console.log(`${name.padEnd(10)} camera ${String(r.dist).padStart(5)}m back, ${String(r.height).padStart(5)}m up`
    + `  commander ${String(r.playerPx).padStart(3)}px tall, opponent ${String(r.foePx).padStart(3)}px`
    + `  (screen ${r.screen})`);
}
console.log(`\nA 1.8m man is ${locked.playerPx}px in a ${locked.screen.split('x')[1]}px frame`
  + ` — ${((locked.playerPx / Number(locked.screen.split('x')[1])) * 100).toFixed(0)}% of screen height.`);
await browser.close();
