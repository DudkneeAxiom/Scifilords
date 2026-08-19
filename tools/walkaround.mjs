// Ordered behind a wall: does the commander get there?
//
// The tactical-camera test fails about one run in eight on one assertion —
// order the commander to a point on the far side of a solid block and they
// should be within four metres after twenty-five seconds. On a bad run they
// stop eighteen metres short. The campaign seed is pinned and the mission
// RNG is derived from it, so the level is the same every time; something
// else is varying, or the pathing genuinely gives up on some geometry.
//
// This runs the same order against many different walls on the same level
// and reports how often the commander arrives, so the answer is a rate
// rather than an anecdote.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(700);
}
const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const State = await import('/src/state.js');
  const G = window.KR;
  G.campaign = State.newCampaign(4242);
  const S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = ''; UI.show('hud');
  G.mission = new Mission({ campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Walk',
      party: { id: 'w', kind: 'looters', name: 'Foe', strength: 6, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 4), container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {} });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true; m.inserting = false;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  const p = m.player;
  const home = { x: p.x, z: p.z };

  // Every wall the test's own filter would consider, tried in turn.
  const walls = m.level.obstacles.filter((o) => (o.coverH ?? o.h) > 1.7 && o.hw > 1.2
    && Math.hypot(o.x - home.x, o.z - home.z) < 30 && Math.hypot(o.x - home.x, o.z - home.z) > 6);
  const out = [];
  for (const wall of walls) {
    p.x = home.x; p.z = home.z;
    const dx = wall.x - p.x, dz = wall.z - p.z, dd = Math.hypot(dx, dz) || 1;
    const raw = { x: wall.x + (dx / dd) * (wall.hw + 3.5), z: wall.z + (dz / dd) * (wall.hd + 3.5) };
    const safe = m.safeSpawn(raw.x, raw.z);
    m.playerAuto = { x: safe.x, z: safe.z };
    let stuckAt = null, last = Infinity, still = 0;
    for (let i = 0; i < 500; i++) {
      m.updatePlayer(0.05);
      const d = Math.hypot(safe.x - p.x, safe.z - p.z);
      // Standing still while still short of the goal is the failure shape.
      if (Math.abs(last - d) < 0.005) { still++; if (still > 40 && stuckAt === null) stuckAt = d; }
      else still = 0;
      last = d;
    }
    const left = Math.hypot(safe.x - p.x, safe.z - p.z);
    out.push({ wall: `${wall.x.toFixed(0)},${wall.z.toFixed(0)}`,
      hw: wall.hw.toFixed(1), hd: (wall.hd ?? 0).toFixed(1),
      left: +left.toFixed(1), arrived: left < 4, stuckAt: stuckAt === null ? null : +stuckAt.toFixed(1),
      path: m.playerPath ? m.playerPath.length : null });
  }
  return { walls: walls.length, out };
});
console.log(`${r.walls} candidate walls on this level (the test picks whichever comes first)\n`);
console.log('  wall          hw   hd   left   arrived  stuck-at  path');
for (const o of r.out) {
  console.log(`  ${o.wall.padEnd(12)} ${o.hw.padStart(4)} ${o.hd.padStart(4)}`
    + ` ${String(o.left).padStart(6)}   ${o.arrived ? 'yes' : 'NO '}`
    + `      ${String(o.stuckAt ?? '-').padStart(6)}  ${o.path ?? '-'}`);
}
const bad = r.out.filter((o) => !o.arrived).length;
console.log(`\n${bad} of ${r.out.length} walls leave the commander short.`);
await browser.close();
