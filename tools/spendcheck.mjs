// Does money actually buy things?
//
// The market, the hiring agent and the infirmary have been verified as far
// as "a panel opens with content in it". That is not the same as working. A
// shop that renders a price and takes the credits without delivering the
// goods looks perfect in a screenshot. This performs each transaction
// through the game's own functions and checks BOTH sides: what left the
// purse, and what arrived.
import { newCampaign, hireCost, upkeepOf } from '../src/state.js';
import * as State from '../src/state.js';
import { STATUS } from '../src/roster.js';

const S = newCampaign(4242);
S.credits = 50000;
const fmt = (n) => String(n).padStart(6);
const living = () => S.roster.filter((s) => s.status !== STATUS.DEAD).length;

// --- rations -------------------------------------------------------------
{
  const c0 = S.credits, r0 = S.rations || 0;
  const quote = State.rationCost ? State.rationCost(S, 'dolmet', 7) : null;
  State.buyRations(S, 'dolmet', 7);
  console.log(`rations: quoted ${quote}  credits ${fmt(c0)} -> ${fmt(S.credits)}`
    + `  rations ${r0} -> ${S.rations || 0}`
    + `  ${(S.rations || 0) > r0 && S.credits < c0 ? 'OK' : 'NOTHING HAPPENED'}`);
}

// --- hiring --------------------------------------------------------------
{
  const before = living(), c0 = S.credits;
  const pool = State.recruitPool(S, 'dolmet') || [];
  if (!pool.length) {
    console.log('hiring: the pool at Dolmet is empty');
  } else {
    const who = pool[0];
    const price = hireCost(S, who);
    State.hire(S, who);
    console.log(`hiring: ${who.name} (${who.role}) at ${price}`
      + `  credits ${fmt(c0)} -> ${fmt(S.credits)}  roster ${before} -> ${living()}`
      + `  ${living() > before && S.credits < c0 ? 'OK' : 'NOTHING HAPPENED'}`);
  }
}

// --- goods, bought and sold straight back --------------------------------
// The round trip is the interesting half: if selling back where you bought
// turns a profit, the whole trade economy is a money printer.
{
  const good = 'rations';
  const c0 = S.credits;
  const had = (S.cargo && S.cargo[good]) || 0;
  const buyAt = State.buyPriceAt ? State.buyPriceAt(S, 'dolmet', good) : null;
  const sellAt = State.sellPriceAt ? State.sellPriceAt(S, 'dolmet', good) : null;
  State.buyGood(S, 'dolmet', good, 5);
  const afterBuy = S.credits;
  const got = ((S.cargo && S.cargo[good]) || 0) - had;
  console.log(`goods: buy ${buyAt}/unit, sell ${sellAt}/unit`);
  console.log(`  bought ${got} for ${c0 - afterBuy}`
    + `  ${got > 0 && afterBuy < c0 ? 'OK' : 'NOTHING ARRIVED'}`);
  if (got > 0) {
    State.sellGood(S, 'dolmet', good, got);
    const back = S.credits - afterBuy;
    console.log(`  sold ${got} straight back for ${back}`
      + `  ${back > (c0 - afterBuy) ? '!! PROFIT ON A ROUND TRIP — free money'
        : 'costs a spread, as it should'}`);
  }
}

// --- weapons and armour off the shelf ------------------------------------
{
  const c0 = S.credits;
  const arm0 = Object.values(S.armoury || {}).reduce((a, b) => a + b, 0);
  if (State.buyWeapon) State.buyWeapon(S, 'dolmet', 'spear');
  const arm1 = Object.values(S.armoury || {}).reduce((a, b) => a + b, 0);
  console.log(`weapon: credits ${fmt(c0)} -> ${fmt(S.credits)}  armoury ${arm0} -> ${arm1}`
    + `  ${arm1 > arm0 && S.credits < c0 ? 'OK' : 'NOTHING ARRIVED'}`);
}

console.log(`\nfinal: ${S.credits} credits, ${living()} on the books,`
  + ` ${S.rations || 0} rations, ${S.medical || 0} kits, wages ${upkeepOf(S).wages}/day`);
