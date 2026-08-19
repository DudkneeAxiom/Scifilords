// Can the company pay itself?
//
// The melee overhaul raised the deploy ceiling to 68 and rebuilt the wage
// scale under it, and a company that cannot make payroll deserts. Nobody has
// ever run the books forward. This does — no browser, no renderer, just the
// campaign's own money functions — and asks the only question that matters:
// at each renown tier, does contract income cover wages and food, or does
// the company bleed out?
import { newCampaign, payrollOf, upkeepOf, payday, generateContract, payScale }
  from '../src/state.js';
import { makeSoldier, STATUS } from '../src/roster.js';
import { RENOWN_TIERS } from '../src/data.js';

// The renown that unlocks a company of this size.
const renownFor = (n) => {
  let at = 0;
  for (const t of RENOWN_TIERS) if (t.deploy <= n) at = t.at;
  return at;
};

let seed = 20260819;
const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const S = newCampaign(4242);
const living = () => S.roster.filter((s) => s.status !== STATUS.DEAD);

console.log('The books, by company size:\n');
console.log('  roster  payroll/day  food/day  pay scale   contract pay (median of 40)');
for (const target of [12, 18, 24, 32, 48, 68]) {
  while (living().length < target) {
    S.roster.push(makeSoldier(r, { rank: Math.floor(r() * 3) }));
  }
  S.renown = renownFor(target);
  const up = upkeepOf(S);
  const pays = [];
  for (let i = 0; i < 40; i++) {
    const c = generateContract(S, r);
    if (c && c.pay) pays.push(c.pay);
  }
  pays.sort((a, b) => a - b);
  const med = pays.length ? pays[Math.floor(pays.length / 2)] : 0;
  console.log(`  ${String(living().length).padStart(6)}  ${String(up.wages).padStart(11)}`
    + `  ${String(up.food).padStart(8)}  ${payScale(S).toFixed(2).padStart(9)}`
    + `   ${String(med).padStart(6)}  = ${med ? (med / Math.max(1, up.wages)).toFixed(1) : '--'} days of wages`);
}

// And forward: a company that takes one contract every five days and pays
// its people every day. Does the balance climb or fall?
console.log('\nNinety days, one contract every five, wages every day:\n');
for (const size of [12, 24, 48]) {
  const C = newCampaign(4242);
  while (C.roster.filter((s) => s.status !== STATUS.DEAD).length < size) {
    C.roster.push(makeSoldier(r, { rank: Math.floor(r() * 3) }));
  }
  C.credits = 3000;
  C.renown = renownFor(size);
  let lowest = C.credits, unpaid = 0, spentOnFood = 0;
  for (let day = 1; day <= 90; day++) {
    // Kept stocked, and paid for, so food shows up as a COST rather than as
    // a morale collapse.
    const need = Math.max(1, Math.ceil(
      C.roster.filter((x) => x.status !== 'dead').length * 0.5));
    if ((C.rations || 0) < need * 2) {
      const buy = need * 5;
      C.rations = (C.rations || 0) + buy;
      C.credits -= buy * 4; spentOnFood += buy * 4;
    }
    if (day % 5 === 0) {
      const c = generateContract(C, r);
      if (c && c.pay) C.credits += c.pay;
    }
    payday(C, r);
    lowest = Math.min(lowest, C.credits);
    if (C.unpaidDays > 0) unpaid++;
  }
  const left = C.roster.filter((s) => s.status !== STATUS.DEAD).length;
  console.log(`  ${String(size).padStart(2)} strong: ended ${String(C.credits).padStart(6)} credits`
    + `  (lowest ${String(lowest).padStart(6)})  ${unpaid} days unpaid  food ${spentOnFood}`
    + `  roster ${size} -> ${left}`);
}
