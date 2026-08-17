// Does the Reach keep going when you do not?
//
// Time used to be derived from how far the company had walked: full speed on
// the road, about three per cent of it standing still. Standing still was
// therefore a way of stopping the world — nothing closed on you, nothing
// arrived, and a band you had provoked could never catch up, because letting go
// of the key froze it in place. A laden company also made the whole world
// slower, since time was distance over a constant.
//
// This drives the real map rather than the simulation underneath it, because
// the bug lived in the map's update loop and State.advanceTime() was innocent.
// Four properties, in the order they matter:
//
//   1. the clock runs while the company stands still;
//   2. it runs at the SAME rate as when travelling — otherwise idling is still
//      a way to cheat the calendar, just a subtler one;
//   3. halt actually halts, or there is no way to stop and think;
//   4. other parties keep moving, and can close on a company that is not
//      running away. That is the whole point.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 20000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 20000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});
await page.waitForTimeout(300);

const out = await page.evaluate(async () => {
  const W = window.KR.world;
  const S = window.KR.campaign;
  const clock = () => S.day * 24 + S.hour;

  // Drive the map's own update at a fixed step, so this measures the loop and
  // not how fast the machine happens to be rendering.
  const run = (seconds, { travelling, speed = 1 }) => {
    // No hostiles for the clock-rate phases. A band wandering into range opens
    // an encounter panel, which pauses the Reach — and a paused map reports
    // "no time passed", which looks exactly like the bug under test. The first
    // version of this probe measured a paused world for three of its four
    // phases and blamed the clock.
    S.parties = [];
    W.setPaused(false);
    W.setSpeed(speed);
    W.stopTravel();
    if (travelling) {
      S.dest = { x: S.pos.x, z: S.pos.z - 4000 };   // somewhere far away
      W.travelling = true;
    }
    const t0 = clock();
    const p0 = { x: S.pos.x, z: S.pos.z };
    const FRAME = 1 / 60;
    for (let i = 0; i < seconds * 60; i++) {
      // Mirror loop(): dt is pre-multiplied by the speed setting, and a halted
      // map is not updated at all.
      if (!W.paused && W.timeScale > 0) W.update(FRAME * W.timeScale);
    }
    return {
      hours: +(clock() - t0).toFixed(2),
      moved: +Math.hypot(S.pos.x - p0.x, S.pos.z - p0.z).toFixed(0),
    };
  };

  const standing = run(5, { travelling: false });
  const travelling = run(5, { travelling: true });
  const halted = run(5, { travelling: false, speed: 0 });
  const fast = run(5, { travelling: false, speed: 4 });

  // A band left to its own devices, against a company that is standing still.
  W.setSpeed(1);
  W.stopTravel();
  S.dest = null;
  const loc = window.KR.dev.State.locById('grellan');
  S.pos.x = loc.x + 700; S.pos.z = loc.z + 700;      // clear of any sanctuary
  S.parties = [{
    id: 'hunter', kind: 'looters', name: 'probe', faction: 'raider',
    model: 'wm_party_raider', x: S.pos.x, z: S.pos.z - 150, speed: 22,
    strength: 5, tier: 1, quality: 0.62, armour: 0, vehicles: 0,
    baseHostile: true, hostileToPlayer: true, cargo: null, target: null,
    home: 'grellan', heading: 0,
  }];
  W.setPaused(false);
  const gap = [];
  let intercepted = false;
  for (let s = 0; s < 12; s++) {
    for (let i = 0; i < 60; i++) {
      if (!W.paused && W.timeScale > 0) W.update((1 / 60) * W.timeScale);
    }
    const b = S.parties.find((p) => p.id === 'hunter');
    if (!b) break;
    gap.push(+Math.hypot(b.x - S.pos.x, b.z - S.pos.z).toFixed(0));
    // Reaching the company opens an encounter, which pauses the Reach. That IS
    // the catch — the band ran a stationary player down — so record it and stop
    // rather than sitting in a paused world logging the same number.
    if (W.paused) { intercepted = true; break; }
  }

  return { standing, travelling, halted, fast, gap, intercepted };
});

console.log('\nFive seconds of real time on the world map:\n');
console.log(`  standing still   ${out.standing.hours} game hours, moved ${out.standing.moved}`);
console.log(`  travelling       ${out.travelling.hours} game hours, moved ${out.travelling.moved}`);
console.log(`  halted           ${out.halted.hours} game hours, moved ${out.halted.moved}`);
console.log(`  fast-forward     ${out.fast.hours} game hours, moved ${out.fast.moved}`);
console.log(`\n  a band closing on a company that is standing still, per second:`);
console.log(`    ${out.gap.join(' -> ')}${out.intercepted ? '  <- ran them down' : ''}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

const runsIdle = out.standing.hours > 0.5;
// Within a few per cent — travelling stops at the map edge or its destination,
// so an exact match is not the claim.
const sameRate = Math.abs(out.standing.hours - out.travelling.hours) < out.travelling.hours * 0.1;
const haltStops = out.halted.hours === 0 && out.halted.moved === 0;
const fastIsFaster = out.fast.hours > out.standing.hours * 2;
const caught = out.intercepted
  || (out.gap.length > 1 && out.gap[out.gap.length - 1] < out.gap[0] - 20);

console.log(`\n  the clock runs while standing still:  ${runsIdle}`);
console.log(`  at the same rate as travelling:      ${sameRate}`);
console.log(`  halt stops it dead:                  ${haltStops}`);
console.log(`  fast-forward is faster:              ${fastIsFaster}`);
console.log(`  a band can catch a stationary you:   ${caught}`);
console.log((runsIdle && sameRate && haltStops && fastIsFaster && caught)
  ? '\nOK — the Reach runs whether or not you do, and stops when you ask'
  : '\nFAIL — the world clock does not behave the way the map needs');

await browser.close();
