// What is left after somebody breaks a column?
//
// A destroyed party used to simply vanish from the list, so the war consumed
// armies and produced nothing: the roads were exactly as dangerous the day
// after a battle as the day before, and a faction offensive that got wrecked
// left no trace on the country it was wrecked in. Survivors now go to ground
// and turn up as stragglers — weak, hostile to everybody, somebody else's
// problem.
//
// The thing to watch is volume rather than presence. Every broken column
// leaving a band would fill the map with debris faster than anyone could clear
// it, and maintainParties() would then quietly delete whatever the player was
// actually travelling toward. So this checks that they appear AND that the
// party list stays bounded across a long war.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage();
p.on('pageerror', e=>console.log('ERR', e.message));
await p.goto('http://localhost:8124/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#title:not(.hidden)',{timeout:90000});
console.log(JSON.stringify(await p.evaluate(() => {
  const { State, Dip } = window.KR.dev;
  const S = State.newCampaign(3210);
  Dip.setRelation(S, 'trust', 'syndic', 'war', 100000);
  // Left where the campaign starts: parking the company 900k units away makes
  // every party "furthest from the player", so maintainParties culls essentially
  // at random and stragglers vanish for reasons that have nothing to do with them.
  let seen = 0, maxParties = 0;
  for (let d = 0; d < 300; d++) {
    State.advanceTime(S, 24);
    const strag = S.parties.filter(x => x.name === 'Stragglers');
    seen = Math.max(seen, strag.length);
    maxParties = Math.max(maxParties, S.parties.length);
  }
  const strag = S.parties.filter(x => x.name === 'Stragglers');
  return { everSeen: seen, atEnd: strag.length, maxParties,
    sample: strag.slice(0,3).map(x => `${x.name} str ${x.strength} ${x.faction} hostile ${x.hostileToPlayer}`) };
}, null), null, 2));
await b.close();
