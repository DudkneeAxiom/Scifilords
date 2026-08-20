// Can a company survive a career, now that winning costs something?
//
// The casualty cliff became a curve this round: a won-and-extracted field
// used to bury nobody and now buries a few per cent of the men who went
// down. That is the intended change, and it is also the kind of change that
// compounds — three per cent a battle, forty battles, no recruiting, and a
// company quietly ceases to exist.
//
// Autoresolve, not the 3D battle: it is what the campaign itself uses for a
// SEND THEM IN, it resolves rather than timing out, and it does not need an
// immortal commander propping it up. Pure state, no browser.
import { newCampaign, autoResolve, applyMissionResult, advanceTime, living,
  payday, buyRations, recruitPool, hire, hireCost } from '../src/state.js';
import * as State from '../src/state.js';
import { deployable, STATUS } from '../src/roster.js';
import { LOCATIONS } from '../src/data.js';

// Somewhere with an infirmary. Healing doubles within 38 units of one, and
// locationAt() reads the company's POSITION — a soak that never moves sits
// in open country convalescing at half speed for a hundred and fifty days,
// which is not a balance result, it is a company that never went to town.
const INFIRMARY = LOCATIONS.find((l) => l.services?.includes('medical'));

const BATTLES = Number(process.argv[2] || 40);
let seed = 20260819;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

for (const [label, replace] of [['never recruiting', false], ['hiring when short', true]]) {
  const S = newCampaign(4242);
  S.credits = 6000;
  let won = 0, lost = 0, buried = 0, hired = 0;
  const start = living(S).length;
  for (let b = 1; b <= BATTLES; b++) {
    const fit = living(S).filter(deployable);
    if (fit.length < Math.max(4, Math.ceil(living(S).length * 0.6))) {
      // Lay up somewhere with a medical bay: wounds close twice as fast
      // there, which is what a town is FOR after a bad week.
      if (INFIRMARY) { S.pos.x = INFIRMARY.x; S.pos.z = INFIRMARY.z; }
      advanceTime(S, 24 * 4);
      continue;
    }
    const before = living(S).length;
    // A posting off the real board, so the pay is what the campaign pays —
    // it scales with renown, which is the whole point of the ladder.
    S.contracts.length = 0;
    const posting = State.generateContract(S, rnd) || { pay: 700, type: 'skirmish', site: 'roadside' };
    posting.accepted = true;
    const spec = {
      type: 'skirmish', site: 'roadside',
      party: { id: `b${b}`, kind: 'looters', name: 'Foe',
        strength: Math.max(3, Math.round(fit.length * 0.8)), tier: 1, quality: 0.6 },
      contract: posting,
    };
    const res = autoResolve(S, spec, fit.slice(0, 10));
    applyMissionResult(S, res);
    if (res.success) { won++; S.renown += 45; } else lost++;
    buried += before - living(S).length;
    // A few days on the road, food, wages.
    if ((S.rations || 0) < 10) buyRations(S, 'dolmet', 14);
    advanceTime(S, 24 * 3);
    payday(S, rnd);
    // The half a player actually does: replace the dead.
    if (replace && living(S).length < start) {
      const pool = recruitPool(S, 'dolmet') || [];
      for (const who of pool) {
        if (living(S).length >= start) break;
        if (S.credits < hireCost(S, who)) break;
        hire(S, who); hired++;
      }
    }
  }
  const end = living(S).length;
  const dead = S.roster.filter((x) => x.status === STATUS.DEAD).length;
  const wounded = living(S).filter((x) => x.status === STATUS.WOUNDED).length;
  console.log('  breakdown: roster rows ' + S.roster.length + ', of them dead ' + dead
    + ', wounded ' + wounded + '; deserted (rows that vanished) '
    + (start + hired - S.roster.length)
    + '; morale ' + Math.round(S.morale) + ', unpaid days ' + (S.unpaidDays || 0));
  console.log(`${label}:`);
  console.log(`  ${BATTLES} battles — ${won} won, ${lost} lost`);
  console.log(`  roster ${start} -> ${end}   buried ${buried}   hired ${hired}`
    + `   credits ${S.credits}   day ${S.day}`);
  console.log(`  ${end === 0 ? 'THE COMPANY IS GONE'
    : end < start * 0.5 ? 'bled down badly but still standing'
      : 'held together'}`);
}
