// Is holding ground worth anything?
//
// A holding used to defend itself with one upgrade that slowed a number down.
// The only real defence was to be standing in the place on the day, and if you
// were somewhere else it fell regardless of what you had built — so a domain
// was a set of income lines with a countdown attached, not something you could
// invest in defending.
//
// Four things have to be true for a garrison to mean anything, and none of them
// are visible from "does it compile":
//
//   1. posting people slows the pressure building;
//   2. a garrisoned holding can hold WITHOUT the player, and an empty one still
//      falls — otherwise the retake contract stops mattering;
//   3. it costs something, or garrisoning beats turning up in person;
//   4. raiders visibly give a defended place a wide berth, which is the half of
//      it the player can actually watch happen.
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
  const State = window.KR.dev.State;

  // A campaign holding one place, with people to spare.
  const build = (garrisonCount, works = 0) => {
    const S = State.newCampaign(31337);
    State.seizeLocation(S, 'grellan');
    S.holdings.grellan.upgrades.works = works;
    // Enough hands that garrisoning does not trip the "somebody has to fight"
    // guard, which is itself one of the things under test.
    while (S.roster.length < garrisonCount + 4) {
      S.roster.push({ ...S.roster[1], id: `extra_${S.roster.length}`, garrison: null });
    }
    const spare = State.ready(S).filter((s) => !s.isCommander);
    for (let i = 0; i < garrisonCount; i++) {
      State.stationSoldier(S, 'grellan', spare[i].id);
    }
    return S;
  };

  // 1. Pressure over a fortnight, with and without a garrison.
  const pressure = (n, works) => {
    const S = build(n, works);
    for (let d = 0; d < 14; d++) State.advanceTime(S, 24);
    const h = S.holdings.grellan;
    return h ? +(h.threat || 0).toFixed(2) : 'LOST';
  };

  // 2. Does it hold on its own? Run the boil-over many times.
  const standsAlone = (n) => {
    let held = 0;
    const TRIALS = 40;
    for (let t = 0; t < TRIALS; t++) {
      const S = build(n);
      S.seed = 1000 + t;                       // vary the roll, not the setup
      S.holdings.grellan.threat = 1.39;
      // One more day tips it over.
      State.advanceTime(S, 24);
      if (State.isHolding(S, 'grellan')) held++;
    }
    return Math.round((held / TRIALS) * 100);
  };

  // 3. What holding it costs, and that the defenders come home if it falls.
  const S3 = build(4);
  const before = State.ready(S3).length;
  const garrisoned = State.garrisonOf(S3, 'grellan').length;
  S3.holdings.grellan.threat = 1.39;
  State.advanceTime(S3, 24);
  const survivedHolding = State.isHolding(S3, 'grellan');
  const stillPosted = State.garrisonOf(S3, 'grellan').length;
  const hurt = S3.roster.filter((s) => s.status === 'wounded').length;
  const orphaned = S3.roster.filter((s) => s.garrison && !S3.holdings[s.garrison]).length;

  // 4. Raiders steering clear of a defended place.
  const berth = (n) => {
    const S = build(n);
    const loc = State.locById('grellan');
    // Park the company far away so this measures the holding, not the player.
    S.pos.x = loc.x + 900; S.pos.z = loc.z + 900;
    S.parties = [{
      id: 'band', kind: 'looters', name: 'probe', faction: 'raider',
      model: 'wm_party_raider', x: loc.x + 60, z: loc.z, speed: 22, strength: 5,
      tier: 1, quality: 0.62, armour: 0, vehicles: 0, baseHostile: true,
      hostileToPlayer: true, cargo: null, target: null, home: 'grellan', heading: 0,
    }];
    const trace = [];
    for (let i = 0; i < 6; i++) {
      State.advanceTime(S, 1);
      const b = S.parties.find((p) => p.id === 'band');
      if (!b) break;
      trace.push(+Math.hypot(b.x - loc.x, b.z - loc.z).toFixed(0));
    }
    return trace;
  };

  return {
    strength: { none: +State.garrisonStrength(build(0), 'grellan').toFixed(1),
      four: +State.garrisonStrength(build(4), 'grellan').toFixed(1),
      fourWorks: +State.garrisonStrength(build(4, 2), 'grellan').toFixed(1) },
    odds: { none: +State.assaultOdds(build(0), 'grellan').toFixed(2),
      two: +State.assaultOdds(build(2), 'grellan').toFixed(2),
      six: +State.assaultOdds(build(6), 'grellan').toFixed(2) },
    pressure14: { none: pressure(0, 0), four: pressure(4, 0), fourWorks: pressure(4, 2) },
    holds: { none: standsAlone(0), two: standsAlone(2), six: standsAlone(6) },
    cost: { before, garrisoned, survivedHolding, stillPosted, hurt, orphaned },
    berth: { undefended: berth(0), defended: berth(5) },
  };
});

console.log('\nWhat a garrison is worth:\n');
console.log(`  strength    empty ${out.strength.none}`
  + `   four posted ${out.strength.four}`
  + `   four behind works ${out.strength.fourWorks}`);
console.log(`  holds a raid   empty ${out.odds.none}   two ${out.odds.two}   six ${out.odds.six}`);
console.log(`\n  pressure after a fortnight`);
console.log(`    undefended        ${out.pressure14.none}`);
console.log(`    four posted       ${out.pressure14.four}`);
console.log(`    four + works 2    ${out.pressure14.fourWorks}`);
console.log(`\n  survives the assault without you, over 40 runs`);
console.log(`    empty ${out.holds.none}%   two posted ${out.holds.two}%   six posted ${out.holds.six}%`);
console.log(`\n  the cost: ${out.cost.garrisoned} posted, held: ${out.cost.survivedHolding},`
  + ` ${out.cost.hurt} wounded, ${out.cost.orphaned} left pointing at a holding that is gone`);
console.log(`\n  raider distance from the place, hour by hour`);
console.log(`    undefended  ${out.berth.undefended.join(' -> ')}`);
console.log(`    defended    ${out.berth.defended.join(' -> ')}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

const slowsPressure = out.pressure14.four !== 'LOST'
  && (out.pressure14.none === 'LOST' || out.pressure14.four < out.pressure14.none);
const emptyFalls = out.holds.none === 0;
const defendedHolds = out.holds.six > out.holds.two && out.holds.two > 0;
const costsSomething = out.cost.hurt > 0;
const noOrphans = out.cost.orphaned === 0;
// Comparative, because an undefended holding does not pin anybody in place —
// a band with no reason to stay simply wanders off on its patrol route, and
// requiring it to sit still measures patrol traffic rather than deterrence.
// What must be true is that a defended place pushes them markedly further out.
const defEnd = out.berth.defended[out.berth.defended.length - 1];
const undEnd = out.berth.undefended[out.berth.undefended.length - 1];
const givesBerth = defEnd > undEnd + 40 && defEnd > out.berth.defended[0];

console.log(`\n  posting people slows the pressure:   ${slowsPressure}`);
console.log(`  an empty holding still falls:        ${emptyFalls}`);
console.log(`  a defended one holds, more with more:${defendedHolds}`);
console.log(`  holding it costs something:          ${costsSomething}`);
console.log(`  nobody is left posted to nowhere:    ${noOrphans}`);
console.log(`  raiders give it a wide berth:        ${givesBerth}`);
console.log((slowsPressure && emptyFalls && defendedHolds && costsSomething && noOrphans && givesBerth)
  ? '\nOK — ground you hold is ground you can defend, and it costs to defend it'
  : '\nFAIL — a garrison does not yet earn its place');

await browser.close();
