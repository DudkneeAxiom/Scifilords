// Does a hideout left alone actually ruin the country around it?
//
// Raiders used to exist purely to inconvenience the player, so clearing a lair
// was a contract rather than a rescue: the road got quieter and nothing else
// changed. Now a band camped on a settlement takes people off it AND the place
// stops recruiting while it buries them — which is what gives "something has
// dug in near Vetch" a consequence you can feel two regions away, and what
// makes garrisoning a town worth doing.
//
// Two traps, both of which this probe fell into first:
//
//   - The control is not free. The campaign spawns its own parties, so a naive
//     "no raiders" run grows raiders and measures the same thing as the test.
//     The party list is pinned every day.
//   - Final manpower recovers. Comparing the last value reported no effect from
//     a mechanic that was working; the minimum is what a raid actually costs.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage();
p.on('pageerror', e=>console.log('ERR', e.message));
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
const out = await p.evaluate(() => {
  const { State } = window.KR.dev;
  const SITE = 'dolmet';                    // a full-size settlement, cap 14
  const loc = State.locById(SITE);
  const band = (id) => ({ id, kind:'looters', name:'Looters', faction:'raider',
    model:'wm_party_raider', x: loc.x, z: loc.z, speed:0, strength:6, tier:1,
    quality:0.62, armour:0, vehicles:0, baseHostile:true, hostileToPlayer:true,
    cargo:null, target:null, home:SITE, heading:0, tx:loc.x, tz:loc.z });

  // The campaign keeps spawning its own parties, so the party list is pinned
  // every day — otherwise the "no raiders" control quietly grows raiders and
  // measures the same thing as the test.
  const run = (plant, garrison) => {
    const S = State.newCampaign(5150);
    S.pos.x = loc.x + 3000; S.pos.z = loc.z + 3000;
    if (garrison) {
      State.seizeLocation(S, SITE);
      while (S.roster.length < 8) S.roster.push({ ...S.roster[1], id:`x${S.roster.length}`, garrison:null });
      const spare = State.ready(S).filter(s => !s.isCommander);
      for (let i = 0; i < 3; i++) State.stationSoldier(S, SITE, spare[i].id);
    }
    const trace = [];
    for (let d = 0; d < 30; d++) {
      S.parties = plant ? [band('r1')] : [];
      if (garrison) S.holdings[SITE].threat = 0;
      State.advanceTime(S, 24);
      trace.push(Math.floor(State.manpowerAt(S, SITE)));
    }
    return trace;
  };
  return { raided: run(true,false), calm: run(false,false), held: run(true,true) };
});
const last = a => a[a.length-1];
console.log('manpower at Dolmet over 30 days (cap 14)');
console.log('  raiders camped   ', out.raided.join(','));
console.log('  nobody there     ', out.calm.join(','));
console.log('  garrisoned       ', out.held.join(','));
const bleeds = Math.min(...out.raided) < Math.min(...out.calm) - 3;
const calmFull = last(out.calm) >= 12;
const garrisonProtects = Math.min(...out.held) > Math.min(...out.raided);
console.log(`\n  raiders bleed a settlement:  ${bleeds}`);
console.log(`  a quiet one stays healthy:   ${calmFull}`);
console.log(`  a garrison turns them away:  ${garrisonProtects}`);
console.log((bleeds && calmFull && garrisonProtects) ? '\nOK' : '\nFAIL');
await b.close();
