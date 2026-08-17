// Does the war do anything?
//
// Trust and Syndic could be at war for two hundred days and the continent would
// end exactly as it started: a war was a diplomatic state that decided who shot
// at you on the road, and nothing else. The argument you are paid to fight in
// had no visible stake, and taking a commission could not go badly, because the
// side you swore to could not lose ground.
//
// Two things now move without the player: settlements change hands along a
// front, and bands that hate each other fight when they meet. Both are easy to
// get wrong in ways that look fine for ten days and ruin a campaign by day two
// hundred — a border that oscillates between the same two towns forever, or a
// faction wiped off the map, taking its contracts with it.
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

const out = await page.evaluate(() => {
  const { State, Dip } = window.KR.dev;

  const census = (S) => ({
    trust: State.settlementsOf(S, 'trust').length,
    syndic: State.settlementsOf(S, 'syndic').length,
  });

  // ---- a long war, driven to its conclusion ------------------------------
  const S = State.newCampaign(777);
  const before = census(S);
  Dip.setRelation(S, 'trust', 'syndic', 'war', 100000);
  const flips = [];
  let lastSig = JSON.stringify(S.mapOwner);
  for (let d = 0; d < 300; d++) {
    State.advanceTime(S, 24);
    const sig = JSON.stringify(S.mapOwner);
    if (sig !== lastSig) { flips.push(d); lastSig = sig; }
  }
  const after = census(S);

  // A war with no war in it: the control. Nothing should move.
  const P = State.newCampaign(777);
  Dip.setRelation(P, 'trust', 'syndic', 'peace', 100000);
  for (let d = 0; d < 300; d++) State.advanceTime(P, 24);
  const peaceCensus = census(P);

  // ---- bands that hate each other ----------------------------------------
  const B = State.newCampaign(4242);
  // Two raider bands cannot fight (same faction), so pit raiders against a
  // patrol, which is the pairing a player actually watches happen.
  const loc = State.locById('grellan');
  B.pos.x = loc.x + 2000; B.pos.z = loc.z + 2000;   // keep the player out of it
  B.parties = [
    { id: 'raid', kind: 'looters', name: 'Looters', faction: 'raider',
      model: 'wm_party_raider', x: loc.x, z: loc.z, speed: 22, strength: 6,
      tier: 1, quality: 0.62, armour: 0, vehicles: 0, baseHostile: true,
      hostileToPlayer: true, cargo: null, target: null, home: 'grellan', heading: 0 },
    { id: 'patrol', kind: 'patrol_trust', name: 'Trust Patrol', faction: 'trust',
      model: 'wm_party_trust', x: loc.x + 8, z: loc.z, speed: 24, strength: 9,
      tier: 2, quality: 0.8, armour: 0, vehicles: 0, baseHostile: false,
      hostileToPlayer: false, cargo: null, target: null, home: 'grellan', heading: 0 },
  ];
  State.advanceTime(B, 1);
  const left = B.parties.filter((p) => p.id === 'raid' || p.id === 'patrol');
  const survivor = left[0];

  // Same faction, standing on each other: must NOT fight.
  const F = State.newCampaign(4242);
  F.pos.x = loc.x + 2000; F.pos.z = loc.z + 2000;
  F.parties = [
    { id: 'a', kind: 'looters', name: 'A', faction: 'raider', model: 'wm_party_raider',
      x: loc.x, z: loc.z, speed: 22, strength: 6, tier: 1, quality: 0.62, armour: 0,
      vehicles: 0, baseHostile: true, hostileToPlayer: true, cargo: null,
      target: null, home: 'grellan', heading: 0 },
    { id: 'b', kind: 'looters', name: 'B', faction: 'raider', model: 'wm_party_raider',
      x: loc.x + 4, z: loc.z, speed: 22, strength: 6, tier: 1, quality: 0.62, armour: 0,
      vehicles: 0, baseHostile: true, hostileToPlayer: true, cargo: null,
      target: null, home: 'grellan', heading: 0 },
  ];
  State.advanceTime(F, 1);
  const sameFactionLeft = F.parties.filter((p) => p.id === 'a' || p.id === 'b').length;

  // ---- the column is a thing on the map, not a dice roll -----------------
  // Killing it must stop the capture, or intercepting one is theatre.
  const C = State.newCampaign(31337);
  Dip.setRelation(C, 'trust', 'syndic', 'war', 100000);
  // Caught in two-hour steps, not daily ones.
  //
  // tickWar() launches a column on a day boundary and a column covers roughly
  // three hundred units in the twenty-four hours that follow, so advancing a
  // whole day at a time meant first sight of it was already on the target's
  // doorstep — the trace read "10 -> 10" and looked like a column that never
  // moved, when it had in fact marched the entire way unobserved.
  let column = null;
  for (let i = 0; i < 120 * 12 && !column; i++) {
    State.advanceTime(C, 2);
    column = C.parties.find((p) => p.siegeTarget);
  }
  const marched = [];
  let besieged = null;
  if (column) {
    besieged = column.siegeTarget;
    const loc = State.locById(besieged);
    // Sampled hourly and stopped the moment it arrives. Six-hour steps were
    // long enough for the column to reach the town, take it and wander off on
    // patrol, so the trace read 0 -> 0 -> 78 -> 156 and looked like a column
    // running AWAY from its own objective.
    for (let i = 0; i < 60; i++) {
      State.advanceTime(C, 1);
      const c = C.parties.find((p) => p.id === column.id);
      if (!c) break;
      marched.push(+Math.hypot(c.x - loc.x, c.z - loc.z).toFixed(0));
      if (!c.siegeTarget) break;              // arrived; stop measuring
    }
  }

  // Same war, but the column is destroyed the moment it appears.
  const K = State.newCampaign(31337);
  Dip.setRelation(K, 'trust', 'syndic', 'war', 100000);
  let killedTarget = null;
  for (let d = 0; d < 400; d++) {
    State.advanceTime(K, 24);
    const c = K.parties.find((p) => p.siegeTarget);
    if (c) {
      if (!killedTarget) killedTarget = c.siegeTarget;
      K.parties = K.parties.filter((p) => p.id !== c.id);   // intercepted
    }
  }
  const heldAfterKills = killedTarget ? State.ownerOf(K, killedTarget) : null;
  const foundedOwner = killedTarget ? State.locById(killedTarget).faction : null;

  // A column must never take the player's own ground.
  //
  // Aimed directly at the holding rather than waiting for the war to wander
  // into one. An earlier version just seized a place and ran 200 days, which
  // lost it to the ORDINARY pressure system — a true result about garrisons and
  // no evidence at all about columns. The two paths have to be separated or the
  // assertion cannot fail for the reason it claims.
  const H = State.newCampaign(31337);
  State.seizeLocation(H, 'grellan');
  const target = State.locById('grellan');
  H.parties.push({
    id: 'col', kind: 'warband_trust', name: 'Trust column', faction: 'trust',
    model: 'wm_party_trust', x: target.x + 120, z: target.z, speed: 16,
    strength: 40, tier: 4, quality: 1.05, armour: 1, vehicles: 0,
    baseHostile: false, hostileToPlayer: false, cargo: null,
    target: null, home: 'grellan', heading: 0,
    siegeTarget: 'grellan', tx: target.x, tz: target.z,
  });
  for (let i = 0; i < 40; i++) {
    State.advanceTime(H, 1);
    H.holdings.grellan.threat = 0;            // isolate: no ordinary pressure
  }
  const colArrived = !H.parties.find((p) => p.id === 'col')?.siegeTarget;
  const stillMine = State.isHolding(H, 'grellan') && State.ownerOf(H, 'grellan') !== 'trust';

  return {
    before, after, peaceCensus,
    column: column ? { target: besieged, marched } : null,
    killed: { target: killedTarget, owner: heldAfterKills, founded: foundedOwner },
    stillMine, colArrived,
    flips: flips.length,
    firstFlip: flips[0] ?? null,
    lastFlip: flips[flips.length - 1] ?? null,
    ownerKeys: Object.keys(S.mapOwner).length,
    battle: { left: left.length, survivor: survivor?.name || null,
      strength: survivor?.strength ?? null },
    sameFactionLeft,
  };
});

console.log('\n300 days of war between Trust and Syndic:\n');
console.log(`  settlements before   trust ${out.before.trust}, syndic ${out.before.syndic}`);
console.log(`  settlements after    trust ${out.after.trust}, syndic ${out.after.syndic}`);
console.log(`  ${out.flips} settlements changed hands`
  + `${out.firstFlip !== null ? ` (first on day ${out.firstFlip}, last on day ${out.lastFlip})` : ''}`);
console.log(`\n  the same 300 days at peace   trust ${out.peaceCensus.trust},`
  + ` syndic ${out.peaceCensus.syndic}`);
console.log('\n  the offensive as a thing on the map:');
if (out.column) {
  console.log(`    a column marched on ${out.column.target}, closing:`
    + ` ${out.column.marched.join(' -> ')}`);
} else {
  console.log('    no column was ever sent');
}
console.log(`    intercepting every column: ${out.killed.target} still held by`
  + ` ${out.killed.owner} (founded ${out.killed.founded})`);
console.log(`    a column sent at your own holding arrived (${out.colArrived})`
  + ` and still could not take it: ${out.stillMine}`);

console.log(`\n  raiders meet a Trust patrol: ${out.battle.left} of 2 walked away`
  + `${out.battle.survivor ? ` — ${out.battle.survivor}, down to ${out.battle.strength}` : ''}`);
console.log(`  two raider bands on the same spot: ${out.sameFactionLeft} of 2 still there`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

const moved = out.flips > 0;
const peaceIsQuiet = out.peaceCensus.trust === out.before.trust
  && out.peaceCensus.syndic === out.before.syndic;
// Nobody is wiped out: a faction with no settlements has no contracts, no
// markets and no reason to exist, which would quietly gut the campaign.
const bothSurvive = out.after.trust > 0 && out.after.syndic > 0;
// The front should settle rather than churn forever.
const notEndless = out.flips < 40;
const battleResolved = out.battle.left === 1 && out.battle.strength < 9;
const alliesSpared = out.sameFactionLeft === 2;

// The column has to actually travel, or "marching" is a spawn next to the target.
const columnMarches = !!out.column && out.column.marched.length > 1
  && out.column.marched[out.column.marched.length - 1] < out.column.marched[0];
// And killing it has to save the town, or intercepting one means nothing.
const interceptionWorks = out.killed.target !== null
  && out.killed.owner === out.killed.founded;
// It has to have actually got there, or "could not take it" is just a column
// that never turned up.
const holdingsSafe = out.stillMine === true && out.colArrived === true;

console.log(`\n  war moves the border:            ${moved}`);
console.log(`  offensives march, visibly:       ${columnMarches}`);
console.log(`  intercepting one saves the town: ${interceptionWorks}`);
console.log(`  columns cannot take your ground: ${holdingsSafe}`);
console.log(`  peace leaves the map alone:      ${peaceIsQuiet}`);
console.log(`  neither faction is wiped out:    ${bothSurvive}`);
console.log(`  the front settles, not churns:   ${notEndless}`);
console.log(`  hostile bands fight, at a cost:  ${battleResolved}`);
console.log(`  bands of one faction do not:     ${alliesSpared}`);
console.log((moved && peaceIsQuiet && bothSurvive && notEndless && battleResolved && alliesSpared
  && columnMarches && interceptionWorks && holdingsSafe)
  ? '\nOK — the continent has an argument of its own, and it goes somewhere'
  : '\nFAIL — the war does not behave the way the map needs');

await browser.close();
