// Where does the tactical camera go, and why is nobody in shot?
//
// Switching to the tactical eye shows a hillside with no soldiers on it —
// the banner poles render, the enemy's range bar reads 9.2m, and the field
// map is nearly empty. So the camera is near the fight but framing nothing.
// This asks for the numbers: where the camera is, where it is looking, where
// the troops are, and whether their models are on screen.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  S.contracts.push({ id: 'tc_1', type: 'skirmish', site: here.id, employer: 'syndic',
    title: 'Tactical', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
  S.pos.x = here.x; S.pos.z = here.z;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
await page.waitForFunction(() => window.KR.mission && !window.KR.mission.intro?.active
  && !window.KR.mission.inserting, null, { timeout: 60000 });
await page.evaluate(() => { const m = window.KR.mission; m.paused = false; m.hadLock = true; });
await page.waitForTimeout(2000);

const look = () => page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.min.js');
  const m = window.KR.mission;
  const cam = m.camera;
  cam.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const live = m.entities.filter((e) => !e.dead);
  const v = new THREE.Vector3();
  const W = m.renderer.domElement.clientWidth, H = m.renderer.domElement.clientHeight;
  let onScreen = 0, behind = 0;
  const pts = [];
  for (const e of live) {
    v.set(e.x, (e.y || 0) + 1, e.z).project(cam);
    const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
    const on = v.z < 1 && sx > 0 && sx < W && sy > 0 && sy < H;
    if (v.z > 1) behind++; else if (on) onScreen++;
    if (pts.length < 4) pts.push(`${e.side === 'player' ? 'us' : 'them'}@${sx.toFixed(0)},${sy.toFixed(0)}${v.z > 1 ? ' BEHIND' : ''}`);
  }
  // Where is the camera actually pointing?
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  return {
    rts: !!m.rts,
    cam: { x: +cam.position.x.toFixed(1), y: +cam.position.y.toFixed(1), z: +cam.position.z.toFixed(1) },
    player: { x: +m.player.x.toFixed(1), z: +m.player.z.toFixed(1) },
    distToPlayer: +Math.hypot(cam.position.x - m.player.x, cam.position.z - m.player.z).toFixed(1),
    // Negative pitch means looking down; near zero means looking at the horizon.
    pitch: +(Math.asin(dir.y) * 180 / Math.PI).toFixed(1),
    live: live.length, onScreen, behind, pts, screen: `${W}x${H}`,
  };
});

const field = await look();
await page.screenshot({ path: process.argv[2] + '/t-field-measured.png' });
console.log('FIELD VIEW');
console.log(`  camera ${JSON.stringify(field.cam)}  player ${JSON.stringify(field.player)}`);
console.log(`  pitch ${field.pitch}deg  of ${field.live} bodies, ${field.onScreen} on screen, ${field.behind} behind the camera`);
console.log(`  ${field.pts.join('  ')}`);

await page.evaluate(() => window.KR.mission.toggleTactical());
await page.waitForTimeout(2200);
const tac = await look();
await page.screenshot({ path: process.argv[2] + '/t-tactical-measured.png' });
console.log('\nTACTICAL VIEW');
console.log(`  rts=${tac.rts}  camera ${JSON.stringify(tac.cam)}  player ${JSON.stringify(tac.player)}`);
console.log(`  camera is ${tac.distToPlayer}m from the commander, ${tac.cam.y}m up`);
console.log(`  pitch ${tac.pitch}deg  of ${tac.live} bodies, ${tac.onScreen} on screen, ${tac.behind} behind the camera`);
console.log(`  ${tac.pts.join('  ')}`);
await browser.close();
