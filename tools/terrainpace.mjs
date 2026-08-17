// Does the ground cost anything to cross?
//
// The map grew real terrain and movement ignored every bit of it: a company
// crossed a mountain range at exactly the speed it crossed a dry pan, which
// makes the landscape scenery with a travel time laid over the top. Roads were
// decoration for the same reason — they connected the places you were going
// without being worth following.
//
// Three things have to hold, and the third is the one that is easy to get
// wrong: the rule has to apply to EVERYONE. If only the company pays for slope,
// a chase across a range is decided by which side the rule applies to rather
// than by anything the player did.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });

const out = await page.evaluate(async () => {
  const R = await import('/src/region.js');
  const { State } = window.KR.dev;

  // Sample the whole playable area to see the spread the rule actually produces.
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let x = -2600; x <= 2600; x += 60) {
    for (let z = -2600; z <= 2600; z += 60) {
      const f = R.travelFactor(x, z);
      if (f < lo) lo = f;
      if (f > hi) hi = f;
      sum += f; n++;
    }
  }

  // On a road versus off it, at the same place.
  const a = State.locById('vetch'), b = State.locById('perran');
  const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
  const onRoad = R.travelFactor(midX, midZ);
  // Step away perpendicular to the road until well clear of it.
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  const offX = midX + (-dz / len) * 260, offZ = midZ + (dx / len) * 260;
  const offRoad = R.travelFactor(offX, offZ);
  const roadDistOn = R.roadDistance(midX, midZ);
  const roadDistOff = R.roadDistance(offX, offZ);

  // Steep ground versus flat, found by search rather than assumed.
  let steep = { f: 2, x: 0, z: 0 }, flat = { f: 0, x: 0, z: 0 };
  for (let x = -2600; x <= 2600; x += 80) {
    for (let z = -2600; z <= 2600; z += 80) {
      if (R.roadDistance(x, z) < 200) continue;      // isolate slope from roads
      const f = R.travelFactor(x, z);
      if (f < steep.f) steep = { f, x, z };
      if (f > flat.f) flat = { f, x, z };
    }
  }

  // And it must apply to parties, not just to the player.
  const S = State.newCampaign(2468);
  const band = (id, x, z) => ({ id, kind: 'looters', name: 'B', faction: 'raider',
    model: 'wm_party_raider', x, z, speed: 30, strength: 5, tier: 1, quality: 0.6,
    armour: 0, vehicles: 0, baseHostile: true, hostileToPlayer: true, cargo: null,
    target: 'x', tx: x + 4000, tz: z, home: 'grellan', heading: 0 });
  S.pos.x = 9e5; S.pos.z = 9e5;                      // player far away, no pursuit
  const onB = band('on', midX, midZ);
  const offB = band('off', steep.x, steep.z);
  S.parties = [onB, offB];
  const p0 = { on: { x: onB.x, z: onB.z }, off: { x: offB.x, z: offB.z } };
  for (let i = 0; i < 6; i++) {
    S.parties = [onB, offB];
    State.advanceTime(S, 1);
  }
  const movedOn = Math.hypot(onB.x - p0.on.x, onB.z - p0.on.z);
  const movedOff = Math.hypot(offB.x - p0.off.x, offB.z - p0.off.z);

  return {
    spread: { lo: +lo.toFixed(2), hi: +hi.toFixed(2), mean: +(sum / n).toFixed(2) },
    road: { on: +onRoad.toFixed(2), off: +offRoad.toFixed(2),
      dOn: Math.round(roadDistOn), dOff: Math.round(roadDistOff) },
    slope: { steep: +steep.f.toFixed(2), flat: +flat.f.toFixed(2) },
    parties: { onRoad: +movedOn.toFixed(0), roughGround: +movedOff.toFixed(0) },
  };
});

console.log('\nWhat the ground does to a traveller:\n');
console.log(`  factor across the playable area   ${out.spread.lo} to ${out.spread.hi}`
  + `  (mean ${out.spread.mean})`);
console.log(`  on the Vetch-Perran road (${out.road.dOn}m off it)   ${out.road.on}`);
console.log(`  the same stretch, ${out.road.dOff}m aside            ${out.road.off}`);
console.log(`  steepest ground found ${out.slope.steep}, flattest ${out.slope.flat}`);
console.log(`\n  a band travelling 6h on a road:   ${out.parties.onRoad} units`);
console.log(`  the same band on broken ground:   ${out.parties.roughGround} units`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

const roadHelps = out.road.on > out.road.off * 1.12;
const slopeCosts = out.slope.steep < out.slope.flat * 0.85;
// Bounded on purpose: ground that can halve your speed turns a bad route into a
// lost campaign, and this is a strategic layer rather than a survival game.
const bounded = out.spread.lo >= 0.5 && out.spread.hi <= 1.4;
// Ordinary ground must be NEUTRAL. A rule whose average is 0.65 is not terrain,
// it is a thirty-five per cent tax on every journey in the game, silently
// re-pricing contract deadlines and wage days that were balanced without it.
const neutralOnAverage = out.spread.mean > 0.93 && out.spread.mean < 1.07;
const appliesToParties = out.parties.onRoad > out.parties.roughGround * 1.1;

console.log(`\n  roads are worth following:      ${roadHelps}`);
console.log(`  slope costs you:                ${slopeCosts}`);
console.log(`  the effect stays bounded:       ${bounded}`);
console.log(`  ordinary ground is neutral:     ${neutralOnAverage}`);
console.log(`  parties obey it too:            ${appliesToParties}`);
console.log((roadHelps && slopeCosts && bounded && appliesToParties && neutralOnAverage)
  ? '\nOK — the ground is worth reading, and everyone crossing it pays the same'
  : '\nFAIL — terrain does not affect travel the way the map needs');

await browser.close();
