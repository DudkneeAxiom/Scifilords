// Does a flanking soldier actually get round the building?
//
// Places a soldier on one side of a solid obstacle with the goal on the far
// side, orders them there, and tracks whether they arrive — and how far they
// deviate from the straight line, which is the evidence they routed around
// rather than grinding along the wall.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('qa-nav', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
  const S = window.KR.campaign;
  S.contracts.forEach((c) => { c.accepted = false; });
  const c = S.contracts.find((x) => x.site === 'grellan') || S.contracts[0];
  c.accepted = true; c.site = 'grellan'; c.type = 'recovery';
  window.KR.world.stopTravel();
  S.pos.x = 200; S.pos.z = -218;
});
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const el = document.querySelector('#modal [data-x="avoid"]');
  if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => { const S = window.KR.campaign; S.pos.x = 200; S.pos.z = -218; });
await page.waitForTimeout(400);
await page.keyboard.press('e');
await page.waitForSelector('#modal [data-p]', { timeout: 15000 });
const count = (await page.$$('#modal [data-p]')).length;
for (let i = 0; i < count; i++) {
  const els = await page.$$('#modal [data-p]');
  if (els[i]) await els[i].click().catch(() => {});
  await page.waitForTimeout(50);
}
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
await page.waitForTimeout(1800);

// --- unit check on the grid itself -----------------------------------------
const grid = await page.evaluate(() => {
  const m = window.KR.mission;
  const nav = m.nav;
  // The bunker at (-22,-12) is a big solid. Path from one side to the other.
  const a = { x: -22, z: 6 };
  const b = { x: -22, z: -30 };
  const straightBlocked = !nav.lineClear(a.x, a.z, b.x, b.z);
  const path = nav.findPath(a.x, a.z, b.x, b.z);
  let maxDev = 0;
  if (path) {
    for (const p of path) {
      // Perpendicular distance from the straight A->B line.
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const dev = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len;
      maxDev = Math.max(maxDev, dev);
    }
  }
  return {
    gridSize: nav.size,
    blockedCells: nav.blocked.reduce((s, v) => s + v, 0),
    straightBlocked,
    pathFound: !!path,
    waypoints: path ? path.length : 0,
    maxDeviation: +maxDev.toFixed(1),
  };
});
console.log('grid:', JSON.stringify(grid));

// --- behavioural check: order a soldier across the obstacle ----------------
const walk = await page.evaluate(() => new Promise((resolve) => {
  const m = window.KR.mission;
  const s = m.squad.find((e) => !e.militia);
  // Park them one side of the bunker; goal is directly through it.
  s.x = -22; s.z = 8;
  s.order = 'move';
  s.orderPoint = { x: -22, z: -30 };
  s.path = null; s.pathGoal = null;
  s.target = null; s.forceTarget = null;
  const start = { x: s.x, z: s.z };
  const goal = s.orderPoint;
  let maxDev = 0;
  let ticks = 0;
  const t = setInterval(() => {
    const dx = goal.x - start.x, dz = goal.z - start.z;
    const len = Math.hypot(dx, dz);
    const dev = Math.abs((s.x - start.x) * dz - (s.z - start.z) * dx) / len;
    maxDev = Math.max(maxDev, dev);
    // Keep re-issuing so combat AI does not steal the order.
    s.order = 'move'; s.orderPoint = goal;
    if (++ticks > 160 || Math.hypot(s.x - goal.x, s.z - goal.z) < 3) {
      clearInterval(t);
      resolve({
        arrived: Math.hypot(s.x - goal.x, s.z - goal.z) < 3.5,
        remaining: +Math.hypot(s.x - goal.x, s.z - goal.z).toFixed(1),
        maxDeviation: +maxDev.toFixed(1),
        seconds: +(ticks * 0.1).toFixed(1),
      });
    }
  }, 100);
}));
console.log('walk:', JSON.stringify(walk));

await page.screenshot({ path: 'qa-nav/after-walk.png' });

const fails = [];
if (!grid.straightBlocked) fails.push('test obstacle did not block the straight line');
if (!grid.pathFound) fails.push('no path found around the obstacle');
if (grid.maxDeviation < 3) fails.push(`path did not detour (max deviation ${grid.maxDeviation}m)`);
if (!walk.arrived) fails.push(`soldier did not arrive (${walk.remaining}m short)`);
if (walk.maxDeviation < 2) fails.push('soldier walked straight — did not route around');

if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((f) => console.log('  ! ' + f));
  process.exitCode = 1;
} else {
  console.log(`\nOK — routed around the obstacle (${grid.maxDeviation}m detour in the plan,`
    + ` ${walk.maxDeviation}m walked) and arrived in ${walk.seconds}s.`);
}

await browser.close();
