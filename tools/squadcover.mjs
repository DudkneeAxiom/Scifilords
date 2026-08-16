// Can the player order the squad into cover?
//
// The squad already went to ground on its own when it had something to be
// afraid of, which meant cover was something that happened TO them rather than
// something you could ask for. As an order it becomes a move in the fight: pin
// one element behind a wall and take the other one round the side.
//
// What separates a real cover order from a move order is the pair of things
// underneath it — the position must actually break line of sight to the threat,
// and the soldier must go DOWN when they get there. A move order that happens
// to end near a wall does neither.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 60000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 20000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(400);

const out = await page.evaluate(async () => {
  const { Mission, bodyCapsule } = await import('/src/mission.js');
  const Level = await import('/src/level.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  const m = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'T',
      enemyFaction: 'trust' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await m.start();
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

  // Put the company in the open with a threat in front of them.
  const threat = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  const cov = m.level.covers.find((o) => o.h > 0.7 && o.h < 1.6);
  m.player.x = cov.x + 4; m.player.z = cov.z + 9;
  threat.x = cov.x; threat.z = cov.z - 22;
  m.squad.forEach((s, i) => { s.x = m.player.x + (i - 1) * 2.4; s.z = m.player.z + 1.5; });

  const exposedBefore = m.squad.filter((s) =>
    Level.hasLOS(m.level.obstacles, s.x, s.z, threat.x, threat.z, 1.5)).length;

  m.selectAll();
  m.orderTakeCover({ x: threat.x, z: threat.z });
  const ordered = m.squad.filter((s) => s.order === 'cover').length;
  const gotSpot = m.squad.filter((s) => s.coverPos).length;

  // Let them walk to it.
  for (let i = 0; i < 400; i++) m.step(0.016);

  const rows = m.squad.map((s) => {
    const cap = bodyCapsule(s);
    return {
      arrived: s.orderPoint
        ? Math.hypot(s.orderPoint.x - s.x, s.orderPoint.z - s.z) < 1.6 : false,
      // Does the position actually break the sightline it was chosen against?
      shielded: !Level.hasLOS(m.level.obstacles, s.x, s.z, threat.x, threat.z, 1.5),
      tuck: +(s.tuck || 0).toFixed(2),
      height: +(cap.hi - cap.lo).toFixed(2),
      order: s.order,
    };
  });

  // An order to form up has to release them again, or cover is a trap.
  m.setSquadOrder('follow');
  for (let i = 0; i < 120; i++) m.step(0.016);
  const released = m.squad.filter((s) => s.order === 'follow').length;
  const stoodUp = m.squad.filter((s) => (s.tuck || 0) < 0.4).length;

  return {
    exposedBefore, ordered, gotSpot, rows, released, stoodUp,
    n: m.squad.length,
    hasWheelEntry: m.ORDERS.some((o) => o.id === 'cover'),
  };
});

console.log(`\n=== ${out.n} soldiers, ${out.exposedBefore} of them in the open ===`);
console.log(`  order exists on the wheel: ${out.hasWheelEntry}`);
console.log(`  took the order: ${out.ordered}/${out.n}, found a position: ${out.gotSpot}/${out.n}`);
console.log('\n  arrived  shielded  tuck  body height  order');
for (const r of out.rows) {
  console.log(`  ${String(r.arrived).padEnd(8)} ${String(r.shielded).padEnd(9)} `
    + `${String(r.tuck).padEnd(5)} ${String(r.height).padEnd(12)} ${r.order}`);
}
console.log(`\n  form up released ${out.released}/${out.n} and stood ${out.stoodUp}/${out.n} back up`);

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log('  ' + e);

const fails = [];
if (!out.hasWheelEntry) fails.push('no cover order on the wheel');
if (out.ordered !== out.n) fails.push('not everyone took the order');
if (!out.gotSpot) fails.push('nobody found a position');
const shielded = out.rows.filter((r) => r.shielded).length;
const down = out.rows.filter((r) => r.tuck > 0.5).length;
// The two things that make it cover rather than a move order.
if (shielded < Math.ceil(out.n / 2)) fails.push(`only ${shielded}/${out.n} ended up out of sight`);
if (down < Math.ceil(out.n / 2)) fails.push(`only ${down}/${out.n} actually got down`);
if (out.released !== out.n) fails.push('form up did not release them');
if (out.stoodUp < out.n) fails.push('they stayed tucked after being released — cover is a trap');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: ordered into cover, and out of it again');
await browser.close();
