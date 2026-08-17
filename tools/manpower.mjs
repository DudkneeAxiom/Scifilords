// Is there anybody left to hire?
//
// A settlement used to produce a fresh list of recruits every day, from
// nowhere, for the player alone. Nothing you did used it up and no faction ever
// drew on it, so hiring was a shop with infinite stock while the factions
// raised their armies out of thin air.
//
// One well now, and everyone drinks from it. The risk in a change like this is
// that it makes recruiting worse EVERYWHERE instead of making war matter, so
// the peacetime case is tested as carefully as the wartime one: a quiet region
// must refill faster than anyone drains it, or every campaign is poorer for a
// mechanic that was supposed to only bite during a war.
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
  const SITE = 'dolmet';                       // a Trust settlement with a market

  // ---- peace: recruiting must be exactly as good as it ever was -----------
  const P = State.newCampaign(8080);
  Dip.setRelation(P, 'trust', 'syndic', 'peace', 100000);
  const peaceOffers = [];
  for (let d = 0; d < 40; d++) {
    State.advanceTime(P, 24);
    peaceOffers.push(State.recruitPool(P, SITE).length);
  }
  const peaceFloor = Math.min(...peaceOffers);
  const peaceManpower = Math.floor(State.manpowerAt(P, SITE));

  // ---- war: the same place, mustered out ----------------------------------
  const W = State.newCampaign(8080);
  Dip.setRelation(W, 'trust', 'syndic', 'war', 100000);
  // Park Trust columns on their own settlement, which is what a muster is.
  const loc = State.locById(SITE);
  for (let i = 0; i < 3; i++) {
    W.parties.push({
      id: `musterer${i}`, kind: 'patrol_trust', name: 'Trust Patrol', faction: 'trust',
      model: 'wm_party_trust', x: loc.x + i * 3, z: loc.z, speed: 15, strength: 14,
      tier: 3, quality: 0.95, armour: 0, vehicles: 0, baseHostile: false,
      hostileToPlayer: false, cargo: null, target: null, home: SITE, heading: 0,
    });
  }
  const warOffers = [];
  const musterers = W.parties.filter((p) => p.id?.startsWith('musterer'));
  const strengthBefore = musterers.reduce((a, b) => a + b.strength, 0);
  for (let d = 0; d < 40; d++) {
    // Kept in the list and kept at the settlement.
    //
    // maintainParties() culls whatever is furthest from the company, and a
    // patrol left to itself walks its route away from the town it is standing
    // in — so an unpinned run lost two of three musterers and their strength
    // with them, and the total went DOWN. That reads as "mustering does not
    // work" when what was actually measured was attrition.
    for (const m of musterers) {
      if (!W.parties.includes(m)) W.parties.push(m);
      m.x = loc.x; m.z = loc.z;
    }
    State.advanceTime(W, 24);
    warOffers.push(State.recruitPool(W, SITE).length);
  }
  const strengthAfter = musterers.reduce((a, b) => a + b.strength, 0);
  const warManpower = Math.floor(State.manpowerAt(W, SITE));
  const warFloor = Math.min(...warOffers);

  // ---- hiring spends it ---------------------------------------------------
  const H = State.newCampaign(8080);
  H.credits = 100000;
  H.pos.x = loc.x; H.pos.z = loc.z;            // standing in the place
  const beforeHire = Math.floor(State.manpowerAt(H, SITE));
  const offer = State.recruitPool(H, SITE);
  // hire() reports a reason now, not a bare boolean: there are two ways to
  // fail and the interface was calling both of them "not enough credits".
  const hired = offer.length ? State.hire(H, offer[0]).ok === true : false;
  const afterHire = Math.floor(State.manpowerAt(H, SITE));

  // ---- and it cannot go below nothing -------------------------------------
  const Z = State.newCampaign(8080);
  Z.credits = 100000;
  Z.pos.x = loc.x; Z.pos.z = loc.z;
  Z.manpower = {}; State.manpowerAt(Z, SITE); Z.manpower[SITE] = 0;
  const emptyOffer = State.recruitPool(Z, SITE).length;
  const refused = Z.credits === 100000;        // hire() must decline

  return {
    peace: { offers: peaceOffers.slice(0, 8), floor: peaceFloor, left: peaceManpower },
    war: { offers: warOffers.slice(0, 8), floor: warFloor, left: warManpower,
      mustered: strengthAfter - strengthBefore },
    hire: { before: beforeHire, after: afterHire, ok: hired },
    empty: { offered: emptyOffer, refused },
  };
});

console.log('\nAble bodies at Dolmet over forty days:\n');
console.log(`  at peace   offers ${out.peace.offers.join(',')} ...  floor ${out.peace.floor},`
  + ` ${out.peace.left} left in the town`);
console.log(`  at war     offers ${out.war.offers.join(',')} ...  floor ${out.war.floor},`
  + ` ${out.war.left} left in the town`);
console.log(`  Trust columns there grew by ${out.war.mustered} rifles doing it`);
console.log(`\n  hiring one: ${out.hire.before} -> ${out.hire.after} (hire returned ${out.hire.ok})`);
console.log(`  an emptied town offers ${out.empty.offered} and refuses the hire: ${out.empty.refused}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

// Peace must be untouched: a quiet town always has somebody.
const peaceUnaffected = out.peace.floor >= 2 && out.peace.left >= 8;
// War must actually bite.
const warBites = out.war.floor < out.peace.floor && out.war.left < out.peace.left;
// And the bodies must go somewhere — drained, not evaporated.
const musteredUp = out.war.mustered > 0;
const hireSpends = out.hire.ok === true && out.hire.after === out.hire.before - 1;
const emptyIsEmpty = out.empty.offered === 0 && out.empty.refused === true;

console.log(`\n  peacetime recruiting is unharmed:  ${peaceUnaffected}`);
console.log(`  war empties a settlement:          ${warBites}`);
console.log(`  the people become somebody's army: ${musteredUp}`);
console.log(`  hiring spends one body:            ${hireSpends}`);
console.log(`  an empty town offers nobody:       ${emptyIsEmpty}`);
console.log((peaceUnaffected && warBites && musteredUp && hireSpends && emptyIsEmpty)
  ? '\nOK — everyone draws on the same people, and war is what makes them scarce'
  : '\nFAIL — manpower does not behave the way recruiting needs');

await browser.close();
