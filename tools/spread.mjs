// Can you make money without leaving town?
//
// buyPriceAt and sellPriceAt are the same base price pushed apart by your
// RELATION with the town: liked, you buy below base and sell above it. That
// is a deliberate reward — the comment in state.js says so. But it also
// means the buy price can fall BELOW the sell price in the same market, and
// if it does, the loop is: buy a crate, sell the crate, repeat, for ever.
// This walks relation from hostile to beloved and prices the round trip.
import { newCampaign, buyPriceAt, sellPriceAt, buyGood, sellGood } from '../src/state.js';
import * as State from '../src/state.js';

const GOOD = 'rations', LOC = 'dolmet', QTY = 10;
console.log('relation  buy/u  sell/u   buy 10   sell 10   round trip');
for (const rel of [-100, -50, 0, 25, 50, 75, 100]) {
  const S = newCampaign(4242);
  S.credits = 100000;
  // Set standing with this town however the campaign stores it.
  if (S.relations) S.relations[LOC] = rel;
  if (S.rep) for (const k of Object.keys(S.rep)) S.rep[k] = rel;
  const b = buyPriceAt(S, LOC, GOOD), sl = sellPriceAt(S, LOC, GOOD);
  const c0 = S.credits;
  const had = (S.cargo && S.cargo[GOOD]) || 0;
  buyGood(S, LOC, GOOD, QTY);
  const spent = c0 - S.credits;
  const got = ((S.cargo && S.cargo[GOOD]) || 0) - had;
  const c1 = S.credits;
  if (got > 0) sellGood(S, LOC, GOOD, got);
  const back = S.credits - c1;
  const net = back - spent;
  console.log(`${String(rel).padStart(8)}  ${String(b).padStart(5)}  ${String(sl).padStart(6)}`
    + `  ${String(spent).padStart(7)}  ${String(back).padStart(8)}`
    + `  ${net > 0 ? '+' + net + '  FREE MONEY' : net === 0 ? '0  break-even' : String(net)}`);
}
