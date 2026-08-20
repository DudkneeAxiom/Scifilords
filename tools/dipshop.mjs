// Diplomacy and stalls, by their own rules.
//
// Both are gated: a commission needs standing and renown, declaring for
// yourself needs renown and holdings, a stall needs a market and a town that
// does not hate you, and what a stall pays depends on the town's health and
// whether its holder is at war. Gates are where the bugs are — one that
// never opens is a feature nobody can reach, one that never closes is an
// exploit. This walks each boundary from both sides.
import { newCampaign, buyWorkshop, sellWorkshop, workshopIncome, changeRelation,
  relationOf } from '../src/state.js';
import * as State from '../src/state.js';
import * as Dip from '../src/diplomacy.js';
import { LOCATIONS } from '../src/data.js';

const market = LOCATIONS.find((l) => l.services?.includes('market'));
const noMarket = LOCATIONS.find((l) => !l.services?.includes('market'));
console.log(`a market town: ${market?.name}   a town with no market: ${noMarket?.name}\n`);

// ---- stalls ------------------------------------------------------------
console.log('STALLS');
{
  const S = newCampaign(4242);
  S.credits = 200;
  const poor = buyWorkshop(S, market.id);
  S.credits = 50000;
  const wrongPlace = noMarket ? buyWorkshop(S, noMarket.id) : { ok: false, why: '(no such town)' };
  const first = buyWorkshop(S, market.id);
  const again = buyWorkshop(S, market.id);
  const spent = 50000 - S.credits;
  console.log(`  broke:           ${poor.ok ? 'BOUGHT ANYWAY' : 'refused — ' + poor.why}`);
  console.log(`  town w/o market: ${wrongPlace.ok ? 'BOUGHT ANYWAY' : 'refused — ' + wrongPlace.why}`);
  console.log(`  first purchase:  ${first.ok ? `bought for ${spent}` : 'refused — ' + first.why}`);
  console.log(`  second purchase: ${again.ok ? 'BOUGHT TWICE' : 'refused — ' + again.why}`);
  const back = S.credits;
  const sold = sellWorkshop(S, market.id);
  console.log(`  selling it back: ${sold.ok ? `+${S.credits - back}` : 'refused — ' + sold.why}`
    + `  ${sold.ok && (S.credits - back) > spent ? '!! SELLS FOR MORE THAN IT COST' : 'costs you something, as it should'}`);
  const twice = sellWorkshop(S, market.id);
  console.log(`  selling again:   ${twice.ok ? '!! SOLD A STALL IT NO LONGER OWNS' : 'refused — ' + twice.why}`);
}

// ---- what a stall pays -------------------------------------------------
{
  const S = newCampaign(4242);
  S.credits = 50000;
  buyWorkshop(S, market.id);
  console.log('\n  what it pays, by standing with the town:');
  for (const rel of [-40, -25, -10, 0, 20, 40, 80]) {
    if (S.relations) S.relations[market.id] = rel;
    console.log(`    relation ${String(rel).padStart(4)}  ->  ${String(workshopIncome(S, market.id)).padStart(3)}/day`);
  }
}

// ---- diplomacy ---------------------------------------------------------
console.log('\nDIPLOMACY');
{
  const S = newCampaign(4242);
  console.log(`  standing tiers: ${Dip.STANDING_TIERS.map((t) => t.name).join(' < ')}`);
  for (const f of Dip.MAJOR_FACTIONS) {
    console.log(`    ${f}: ${Dip.standingOf(S, f)} — ${Dip.standingName(S, f)}`);
  }
  // A commission: standing and renown, both required.
  const tryCommission = (rep, renown) => {
    S.rep[Dip.MAJOR_FACTIONS[0]] = rep; S.renown = renown;
    const c = Dip.canTakeCommission(S, Dip.MAJOR_FACTIONS[0]);
    return typeof c === 'object' ? (c.ok ?? false) : !!c;
  };
  console.log(`\n  a commission needs standing ${Dip.COMMISSION_STANDING} and renown ${Dip.COMMISSION_RENOWN}:`);
  for (const [rep, ren] of [[0, 0], [Dip.COMMISSION_STANDING, 0], [0, Dip.COMMISSION_RENOWN],
    [Dip.COMMISSION_STANDING, Dip.COMMISSION_RENOWN], [60, 900]]) {
    console.log(`    standing ${String(rep).padStart(3)} renown ${String(ren).padStart(4)}  ->  ${tryCommission(rep, ren) ? 'offered' : 'refused'}`);
  }
  // Declaring for yourself.
  console.log(`\n  declaring needs renown ${Dip.DECLARE_RENOWN} and ${Dip.DECLARE_HOLDINGS} holdings:`);
  for (const [ren, holds] of [[0, 0], [Dip.DECLARE_RENOWN, 0], [0, Dip.DECLARE_HOLDINGS],
    [Dip.DECLARE_RENOWN, Dip.DECLARE_HOLDINGS], [4000, 9]]) {
    S.renown = ren;
    S.holdings = Array.from({ length: holds }, (_, i) => ({ id: `h${i}` }));
    const c = Dip.canDeclare(S);
    console.log(`    renown ${String(ren).padStart(4)} holdings ${holds}  ->  `
      + (typeof c === 'object' ? (c.ok ? 'allowed' : `refused — ${c.why || ''}`) : (c ? 'allowed' : 'refused')));
  }
  // War and peace between the two majors.
  const [a, b] = Dip.MAJOR_FACTIONS;
  console.log(`\n  ${a} vs ${b}: ${Dip.relationBetween(S, a, b)}`);
  Dip.setRelation(S, a, b, 'war', 30);
  console.log(`    after declaring war: ${Dip.relationBetween(S, a, b)}`);
  console.log(`    enemies of ${a}: ${Dip.enemiesOf(S, a).join(', ') || 'none'}`);
  Dip.setRelation(S, a, b, 'truce', 30);
  console.log(`    after a truce:      ${Dip.relationBetween(S, a, b)}`);
}
