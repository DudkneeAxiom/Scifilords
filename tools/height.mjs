// Is there anywhere to stand except the floor?
//
// Every layout was an arrangement of cover on flat ground, because an entity's
// ground was always heightAt() — there was no way to be on top of anything. The
// works is described in its own comment as "taller, tighter and more vertical"
// and was exactly as flat as everywhere else.
//
// Three things have to be true for height to be a feature rather than scenery:
// you can get up, you cannot get up where you should not, and being up there
// changes what you can see and shoot. The last one is the whole point — a
// catwalk that grants no sightline is just an awkward floor.
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

const out = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const Level = await import('/src/level.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';

  const decks = {};
  for (const id of ['grellan', 'rampart', 'perran', 'settlement', 'works', 'fort', 'reclaimer']) {
    let lvl = null;
    try { lvl = Level.build(id, 7); } catch { continue; }
    const walk = lvl.obstacles.filter((o) => o.walk);
    const tops = walk.map((o) => +(o.y + o.h).toFixed(1));
    decks[id] = {
      n: walk.length,
      highest: tops.length ? Math.max(...tops) : 0,
    };
  }

  // Walk the works catwalk for real: start on the ground by the steps and drive
  // the player up them one frame at a time.
  const m = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'works', layout: 'works', siteName: 'T',
      enemyFaction: 'trust' },
    squad: S.roster.slice(0, 3),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await m.start();
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

  const p = m.player;
  const climb = [];
  // Find the actual foot of a flight rather than assuming where it was put:
  // the builder places stairs on whichever approach is clear, so hard-coding a
  // start position tests a patch of empty ground instead of the staircase.
  const treads = m.level.obstacles
    .filter((o) => o.walk && o.h > 0.3 && o.h < 4.2 && (o.hw === 0.5 || o.hd === 0.5) && o.x < 0)
    .sort((a, b) => a.h - b.h);
  const foot = treads[0];
  const nextUp = treads[1];
  const dirX = Math.sign(nextUp.x - foot.x);
  const dirZ = Math.sign(nextUp.z - foot.z);
  p.x = foot.x - dirX * 2.2; p.z = foot.z - dirZ * 2.2;
  m.airY = 0; m.grounded = true;
  // Camera-relative movement: 'w' drives along -z at yaw 0, along +x at -PI/2.
  m.camYaw = dirZ !== 0 ? (dirZ < 0 ? 0 : Math.PI) : (dirX > 0 ? -Math.PI / 2 : Math.PI / 2);
  m.keys.add('w');
  for (let i = 0; i < 400; i++) {
    m.updatePlayer(0.016);
    if (i % 20 === 0) climb.push({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), up: +m.airY.toFixed(2) });
  }
  m.keys.delete('w');
  const topReached = m.airY;
  const onDeck = { x: p.x, z: p.z, up: m.airY };

  // From up there, how much of the tank line can be seen that could not be
  // seen from the same ground position?
  const targets = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    targets.push({ x: p.x + Math.cos(a) * 26, z: p.z + Math.sin(a) * 26 });
  }
  const eye = 1.5;
  let seenHigh = 0, seenLow = 0;
  const base = Level.heightAt(p.x, p.z);
  for (const t of targets) {
    const ty = Level.heightAt(t.x, t.z) + 1.0;
    const hi = { x: p.x, y: base + m.airY + eye, z: p.z };
    const lo = { x: p.x, y: base + eye, z: p.z };
    const ray = (o) => {
      const dx = t.x - o.x, dy = ty - o.y, dz = t.z - o.z;
      const len = Math.hypot(dx, dy, dz);
      const hit = m.rayHit(o, { x: dx / len, y: dy / len, z: dz / len }, len - 0.4, m.player);
      return hit.kind === 'sky';
    };
    if (ray(hi)) seenHigh++;
    if (ray(lo)) seenLow++;
  }

  // And you must not be able to stroll up the outside of the fort wall.
  const fort = Level.build('fort', 7);
  const wallTop = Math.max(...fort.obstacles.filter((o) => o.walk).map((o) => o.y + o.h));
  const outside = Level.surfaceAt(fort.obstacles, 0, -4, Level.heightAt(0, -4), 0.62);
  const strollable = outside - Level.heightAt(0, -4) > 1;

  return {
    decks, climb, topReached: +topReached.toFixed(2), onDeck,
    seenHigh, seenLow, n: targets.length,
    wallTop: +wallTop.toFixed(1), strollable,
  };
});

console.log('\n=== walkable decks per layout ===');
for (const [id, d] of Object.entries(out.decks)) {
  console.log(`  ${id.padEnd(12)} ${String(d.n).padStart(3)} walkable surfaces,`
    + ` highest ${d.highest}m`);
}

console.log('\n=== walking up the works catwalk ===');
console.log('  ' + out.climb.map((c) => `(${c.x},${c.z}):${c.up}`).join('  '));
console.log(`  ended at ${out.topReached}m above the terrain`);

console.log('\n=== what the height buys ===');
console.log(`  targets visible from the deck:   ${out.seenHigh}/${out.n}`);
console.log(`  from the same spot on the floor: ${out.seenLow}/${out.n}`);

console.log(`\n  fort wall walk is ${out.wallTop}m up;`
  + ` climbable from outside: ${out.strollable}`);

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log('  ' + e);

const fails = [];
if (!(out.decks.works?.n > 0)) fails.push('the works has no walkable deck');
if (!(out.decks.fort?.n > 0)) fails.push('the fort wall cannot be stood on');
if (out.topReached < 2) fails.push(`could not climb — ended ${out.topReached}m up`);
if (out.seenHigh <= out.seenLow) fails.push('height grants no sightline it did not already have');
if (out.strollable) fails.push('the fort wall can be walked up from the attacking side');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: there is somewhere to stand, and it is worth standing there');
await browser.close();
