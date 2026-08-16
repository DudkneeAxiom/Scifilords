// Do enemies pop in on top of you?
//
// The report from play was that waves "auto spawn and pop in sometimes
// instantly dealing damage to the player who might have been standing next to
// the invisible spawn". That is three separate faults wearing one coat:
//
//   - the spawn ring was measured from the middle of the map, not from the
//     player, so on a small site it could land anywhere including your lap,
//   - nothing checked whether you were looking at the spot, so people appeared
//     out of nothing in plain view,
//   - and an arrival could fire on the frame it was created.
//
// Each is measured separately below, because fixing two of three still leaves
// somebody materialising behind you and shooting.
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
await page.waitForTimeout(500);

// Stand a mission up headlessly and drive reinforcements into it from a range
// of player positions — including hard up against the boundary, which is where
// the original ring-from-the-origin behaviour was at its worst.
const out = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const Level = await import('/src/level.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';

  const m = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'Test',
      enemyFaction: 'trust' },
    squad: S.roster.slice(0, 3),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await m.start();
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

  const b = m.level.bounds;
  const spots = [
    { name: 'centre', x: 0, z: 0 },
    { name: 'mid-field', x: 24, z: -18 },
    { name: 'at the edge', x: b - 6, z: b - 6 },
    { name: 'far corner', x: -(b - 5), z: b - 5 },
  ];
  const rows = [];
  for (const s of spots) {
    m.player.x = s.x; m.player.z = s.z;
    // Baseline: exactly what the old code did — a ring about the map origin,
    // with no reference to the player at all.
    const oldD = [];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const e = m.spawnEnemy(Math.cos(a) * 48, Math.sin(a) * 48, 'rifleman');
      oldD.push(Math.hypot(e.x - m.player.x, e.z - m.player.z));
      m.entities = m.entities.filter((x) => x !== e);
    }
    oldD.sort((x, y) => x - y);

    const dists = [];
    let seen = 0, canFire = 0;
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      // Ask for a spawn on the old terms: a fixed radius about the map origin.
      const e = m.reinforce(Math.cos(a) * 48, Math.sin(a) * 48, 'rifleman');
      const d = Math.hypot(e.x - m.player.x, e.z - m.player.z);
      dists.push(d);
      if (Level.hasLOS(m.level.obstacles, e.x, e.z, m.player.x, m.player.z, 1.5)) seen++;
      // Could it shoot the instant it existed?
      const ammo = e.ammo;
      m.fire(e, m.player.x, 1.2, m.player.z);
      if (e.ammo !== ammo) canFire++;
      m.entities = m.entities.filter((x) => x !== e);
    }
    dists.sort((x, y) => x - y);
    rows.push({
      spot: s.name, n: dists.length,
      min: +dists[0].toFixed(1),
      median: +dists[Math.floor(dists.length / 2)].toFixed(1),
      wasMin: +oldD[0].toFixed(1),
      inSight: seen, firedAtOnce: canFire,
    });
  }

  // The pit is the worst case and the likeliest source of the complaint: the
  // ring is only sixteen metres across and the player is standing in the middle
  // of it, so a fighter arriving on the side the player has drifted towards
  // used to appear almost on top of them.
  const o = m.level.objectivePoint;
  const pit = { old: [], now: [] };
  for (const off of [0, 6, 11, 14]) {
    m.player.x = o.x + off; m.player.z = o.z;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const px = o.x + Math.cos(a) * 16, pz = o.z + Math.sin(a) * 16;
      const a1 = m.spawnEnemy(px, pz, 'rifleman');
      pit.old.push(Math.hypot(a1.x - m.player.x, a1.z - m.player.z));
      m.entities = m.entities.filter((x) => x !== a1);
      const a2 = m.reinforce(px, pz, 'rifleman', 17);
      pit.now.push(Math.hypot(a2.x - m.player.x, a2.z - m.player.z));
      m.entities = m.entities.filter((x) => x !== a2);
    }
  }
  pit.oldMin = Math.min(...pit.old);
  pit.nowMin = Math.min(...pit.now);
  pit.oldClose = pit.old.filter((d) => d < 8).length;
  pit.nowClose = pit.now.filter((d) => d < 8).length;
  pit.n = pit.old.length;

  m.player.x = 0; m.player.z = 0;
  // And the grace has to actually expire, or arrivals are permanently harmless.
  const e = m.reinforce(40, 40, 'rifleman');
  const before = e.ammo;
  m.fire(e, m.player.x, 1.2, m.player.z);
  const blocked = e.ammo === before;
  e.arriving = 0;
  e.cooldown = 0;
  m.fire(e, m.player.x, 1.2, m.player.z);
  const firesAfter = e.ammo !== before;

  return { rows, pit, blocked, firesAfter, bounds: b };
});

console.log(`\n=== where reinforcements arrive (site is ${out.bounds}m to the boundary) ===`);
console.log('  player at        was nearest   now nearest   median   in sight   fired instantly');
for (const r of out.rows) {
  console.log(`  ${r.spot.padEnd(14)} ${String(r.wasMin).padStart(11)}   ${String(r.min).padStart(11)}`
    + `  ${String(r.median).padStart(7)}   ${String(r.inSight).padStart(5)}/${r.n}`
    + `   ${String(r.firedAtOnce).padStart(9)}/${r.n}`);
}
console.log(`\n=== the pit, where the ring is only 16m across ===`);
console.log(`  nearest arrival — old rule ${out.pit.oldMin.toFixed(1)}m,`
  + ` now ${out.pit.nowMin.toFixed(1)}m`);
console.log(`  arrived within 8m of the player: ${out.pit.oldClose}/${out.pit.n} before,`
  + ` ${out.pit.nowClose}/${out.pit.n} now`);

console.log(`\n  a fresh arrival is stopped from firing: ${out.blocked}`);
console.log(`  and can fire once the grace expires:    ${out.firesAfter}`);

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log('  ' + e);

const fails = [];
const worst = Math.min(...out.rows.map((r) => r.min));
if (worst < 20) fails.push(`something arrived ${worst}m away`);
if (out.rows.some((r) => r.firedAtOnce > 0)) fails.push('an arrival fired on its first frame');
if (!out.blocked) fails.push('the arrival grace does nothing');
if (!out.firesAfter) fails.push('the grace never expires');
// Out of sight is a preference, not a guarantee — on open ground there may be
// nowhere hidden — so this is a proportion rather than an absolute.
const sightRatio = out.rows.reduce((a, r) => a + r.inSight, 0)
  / out.rows.reduce((a, r) => a + r.n, 0);
if (sightRatio > 0.5) fails.push(`${Math.round(sightRatio * 100)}% arrived in plain view`);
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: they come from somewhere, and not at your shoulder');
await browser.close();
