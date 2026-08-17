// Can a beaten commander be turned into somebody who holds your ground?
//
// The obvious thing to do with a prisoner is sell them back. This is the other
// thing, and it is the one that builds something: ground you hold has to be
// garrisoned out of the same finite roster you deploy with, so every place you
// take makes the company weaker in the field. A vassal on a fief breaks that
// trade — they defend it with their own household and you get your soldiers
// back.
//
// What has to hold: nobody swears to a company with no flag, beating somebody
// repeatedly makes them likelier to listen, a refusal costs something, and a
// granted fief actually defends itself.
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
  const { State } = window.KR.dev;
  const mk = (flag, defeats, wins) => {
    const S = State.newCampaign(2727);
    if (flag) S.ownFaction = { id: 'bracket', name: 'Bracket', colour: 0xc08d3f };
    State.seizeLocation(S, 'grellan');
    S.lords = [{ id: 'L', name: 'Corrin Vale', faction: 'trust', defeats, wins,
      captured: true, heldByPlayer: true, tookDay: S.day, freeDay: 0 }];
    return S;
  };

  const noFlag = State.offerService(mk(false, 3, 0), 'L');
  const odds = {
    fresh: +State.lordServiceOdds(mk(true, 0, 0), mk(true, 0, 0).lords[0]).toFixed(2),
    beaten: +State.lordServiceOdds(mk(true, 3, 0), mk(true, 3, 0).lords[0]).toFixed(2),
    proud: +State.lordServiceOdds(mk(true, 0, 4), mk(true, 0, 4).lords[0]).toFixed(2),
  };

  // Take one into service by trying until the roll lands, then grant a fief.
  let S = null, took = false;
  for (let i = 0; i < 40 && !took; i++) {
    S = mk(true, 3, 0);
    S.seed = 1000 + i * 37;
    S.renown = 3000;
    took = State.offerService(S, 'L').took === true;
  }
  const before = +State.garrisonStrength(S, 'grellan').toFixed(1);
  const granted = State.grantFief(S, 'L', 'grellan');
  const after = +State.garrisonStrength(S, 'grellan').toFixed(1);
  const odds0 = +State.assaultOdds(S, 'grellan').toFixed(2);
  // A second vassal cannot be given ground somebody already holds.
  S.lords.push({ id: 'L2', name: 'Other', faction: 'bracket', vassal: true, wins: 0, defeats: 0 });
  const clash = State.grantFief(S, 'L2', 'grellan');

  return { noFlag, odds, took, before, after, granted, odds0, clash,
    vassals: State.vassals(S).length };
});

console.log('\nTaking a beaten commander into service:\n');
console.log(`  asked without a flag of your own: ${out.noFlag.ok} — ${out.noFlag.why || ''}`);
console.log(`  odds: never beaten ${out.odds.fresh}, beaten 3x ${out.odds.beaten},`
  + ` 4 wins to their name ${out.odds.proud}`);
console.log(`\n  sworn: ${out.took}, vassals now ${out.vassals}`);
console.log(`  granting them a fief: defence ${out.before} -> ${out.after}`
  + ` (holds a raid ${Math.round(out.odds0 * 100)}%)`);
console.log(`  granting the same ground twice: ${out.clash.ok} — ${out.clash.why || ''}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

const needsFlag = out.noFlag.ok === false;
const beatingHelps = out.odds.beaten > out.odds.fresh;
const prideResists = out.odds.proud < out.odds.fresh;
const fiefDefends = out.after > out.before && out.granted.ok;
const noDoubleGrant = out.clash.ok === false;

console.log(`\n  nobody swears to a company:     ${needsFlag}`);
console.log(`  beating them makes them listen: ${beatingHelps}`);
console.log(`  a proud one resists:            ${prideResists}`);
console.log(`  a granted fief defends itself:  ${fiefDefends}`);
console.log(`  two lords cannot hold one place:${noDoubleGrant}`);
console.log((needsFlag && beatingHelps && prideResists && fiefDefends && noDoubleGrant)
  ? '\nOK — a beaten enemy can become the reason you keep your soldiers'
  : '\nFAIL — vassalage does not behave the way the realm needs');
await browser.close();
