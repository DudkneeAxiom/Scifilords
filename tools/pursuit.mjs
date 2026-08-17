// Do hostile bands actually come after you?
//
// The report was that low-tier bandits ignore a starting company — nothing
// stalks you the way looters do in Mount & Blade. They were right, and it was
// structural rather than a tuning miss: moveParties() walked every band toward
// a patrol target and never once read the player's position, and patrol speeds
// (21-23) are a fraction of the company's (55-165), so even a band that wanted
// the player could not have closed.
//
// This measures the three things that have to be true for a chase to mean
// anything, none of which a "does it compile" check would catch:
//
//   1. a weak band closes on a weak company;
//   2. a lean company can still run away, so the answer to a chase is a
//      decision rather than a cutscene;
//   3. a laden one cannot, so speed is a resource you spend.
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

// Driven entirely through State, headless of the renderer: this is a question
// about the strategic simulation, and playing it through the map would just add
// twenty minutes and a dozen ways to flake.
const run = (opts) => page.evaluate(async (o) => {
  const State = window.KR.dev.State;
  const S = State.newCampaign(4242);
  // Open road, well clear of any settlement. Bands do not press an attack near
  // a location, so testing pursuit next to one measures the sanctuary rule
  // instead of the chase — and a fleeing company can wander into one mid-run,
  // which silently ends the pursuit and looks like an escape.
  S.pos.x = 0; S.pos.z = 0;
  for (let ring = 0; ring < 4000 && State.locationAt(S, 220); ring += 40) {
    S.pos.x = ring; S.pos.z = ring;
  }
  S.parties = [];
  const band = {
    id: 'probe_band', kind: o.kind, name: 'probe', faction: 'raider',
    model: 'wm_party_raider', x: S.pos.x, z: S.pos.z - o.startDist,
    speed: 22, strength: o.strength, tier: 1, quality: 0.55,
    armour: 0, vehicles: 0, baseHostile: true, hostileToPlayer: true,
    cargo: null, target: null, home: 'grellan', heading: 0,
  };
  S.parties.push(band);

  // Optionally weigh the company down — the whole point of pursuit is that
  // this changes the answer.
  if (o.laden) {
    const cap = State.cargoCapacity ? State.cargoCapacity(S) : 60;
    S.cargo = { salvage: Math.max(40, cap) };
    S.rations = 0;
  }

  const trace = [];
  const pace = State.partySpeed(S);
  for (let step = 0; step < o.steps; step++) {
    // The company runs directly away from the band, at its real travel speed.
    if (o.flee) {
      const dx = S.pos.x - band.x, dz = S.pos.z - band.z;
      const d = Math.hypot(dx, dz) || 1;
      S.pos.x += (dx / d) * pace.speed * o.hours;
      S.pos.z += (dz / d) * pace.speed * o.hours;
    }
    State.advanceTime(S, o.hours);
    const b = S.parties.find((p) => p.id === 'probe_band');
    if (!b) break;
    trace.push(+Math.hypot(b.x - S.pos.x, b.z - S.pos.z).toFixed(0));
  }
  return { trace, chasing: !!S.parties.find((p) => p.id === 'probe_band')?.chasing,
    companySpeed: +pace.speed.toFixed(0), mul: +pace.mul.toFixed(2) };
}, opts);

console.log('\nDistance from the company, hour by hour:\n');

const standing = await run({ kind: 'looters', strength: 5, startDist: 150, steps: 8, hours: 1, flee: false });
console.log(`  band closing on a stationary company   ${standing.trace.join(' -> ')}`);
console.log(`    still chasing: ${standing.chasing}`);

const lean = await run({ kind: 'looters', strength: 5, startDist: 120, steps: 8, hours: 1, flee: true });
console.log(`\n  lean company running (speed ${lean.companySpeed})  ${lean.trace.join(' -> ')}`);

const laden = await run({ kind: 'looters', strength: 5, startDist: 120, steps: 8, hours: 1, flee: true, laden: true });
console.log(`  laden company running (speed ${laden.companySpeed})  ${laden.trace.join(' -> ')}`);

// A band that is plainly outgunned should break contact rather than close.
const scared = await page.evaluate(() => {
  const State = window.KR.dev.State;
  const S = State.newCampaign(4242);
  S.pos.x = 0; S.pos.z = 0;
  for (let ring = 0; ring < 4000 && State.locationAt(S, 220); ring += 40) {
    S.pos.x = ring; S.pos.z = ring;
  }
  S.parties = [{
    id: 'weak', kind: 'strays', name: 'probe', faction: 'raider',
    model: 'wm_party_raider', x: S.pos.x, z: S.pos.z - 110, speed: 22, strength: 2, tier: 1,
    quality: 0.3, armour: 0, vehicles: 0, baseHostile: true,
    hostileToPlayer: true, cargo: null, target: null, home: 'grellan', heading: 0,
  }];
  // A company that plainly outguns them.
  for (let i = 0; i < 8; i++) S.roster.push({ ...S.roster[0], id: `x${i}`, rank: 4 });
  const trace = [];
  for (let i = 0; i < 6; i++) {
    State.advanceTime(S, 1);
    const b = S.parties.find((p) => p.id === 'weak');
    if (!b) break;
    trace.push(+Math.hypot(b.x - S.pos.x, b.z - S.pos.z).toFixed(0));
  }
  return trace;
});
console.log(`\n  outgunned band near a strong company   ${scared.join(' -> ')}`);

// A settlement has to be a haven, or leaving one drops you into an encounter
// on the doorstep every single time — with the map paused behind the panel.
const sanctuary = await page.evaluate(() => {
  const State = window.KR.dev.State;
  const S = State.newCampaign(4242);
  const loc = State.locationAt(S, 1e9) || { x: 0, z: 0 };
  S.pos.x = loc.x; S.pos.z = loc.z + 10;      // just outside the gate
  S.parties = [{
    id: 'gate', kind: 'looters', name: 'probe', faction: 'raider',
    model: 'wm_party_raider', x: loc.x, z: loc.z - 120, speed: 22, strength: 6,
    tier: 1, quality: 0.62, armour: 0, vehicles: 0, baseHostile: true,
    hostileToPlayer: true, cargo: null, target: null, home: 'grellan', heading: 0,
  }];
  // Intent, not distance. Locations are exactly where patrol routes lead, so a
  // band wandering to within arm's reach of a town is ordinary traffic and says
  // nothing about whether it is hunting the company. `chasing` is the thing
  // itself; distance is a proxy that cannot tell the two apart.
  const trace = [];
  let everChased = false;
  for (let i = 0; i < 6; i++) {
    State.advanceTime(S, 1);
    const b = S.parties.find((p) => p.id === 'gate');
    if (!b) break;
    if (b.chasing) everChased = true;
    trace.push(+Math.hypot(b.x - S.pos.x, b.z - S.pos.z).toFixed(0));
  }
  return { trace, everChased };
});
console.log(`\n  band while the company sits at a settlement  ${sanctuary.trace.join(' -> ')}`);
console.log(`    ever switched to a chase: ${sanctuary.everChased}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

const closed = standing.trace[standing.trace.length - 1] < standing.trace[0] - 40;
const escaped = lean.trace[lean.trace.length - 1] > lean.trace[0];
// Did the band ever gain on them, rather than where the chase happened to end.
// A company fleeing in a straight line eventually runs into a settlement and is
// legitimately safe from that moment, so the final distance measures which way
// it ran as much as how fast.
const caught = Math.min(...laden.trace) < laden.trace[0];
const ranAway = scared[scared.length - 1] > scared[0];
const safeInTown = !sanctuary.everChased;
console.log(`\n  band closes on a stationary company: ${closed}`);
console.log(`  lean company escapes:                ${escaped}`);
console.log(`  laden company does not:              ${caught}`);
console.log(`  outgunned band breaks contact:       ${ranAway}`);
console.log(`  a settlement is a haven:             ${safeInTown}`);
console.log((closed && escaped && caught && ranAway && safeInTown)
  ? '\nOK — the road has predators, and outrunning them is a decision you can lose'
  : '\nFAIL — pursuit does not behave the way the design needs');

await browser.close();
