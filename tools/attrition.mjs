// What does a downed man's day look like?
//
// OVERHAUL.md has carried a line for several rounds saying wounded/dead
// resolution was inherited from the gun era and never re-tuned for melee.
// That is a claim about NUMBERS, and nobody has ever printed them. This
// calls resolveCasualty directly — no browser, no renderer — across a
// realistic company and both outcomes, and reports how many men a campaign
// actually buries.
import { makeSoldier, resolveCasualty, STATUS } from '../src/roster.js';

// A plain deterministic source, so two runs of this say the same thing.
let seed = 20260819;
const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const CAUSES = ['cut', 'crush', 'shot', null];
const N = 4000;

function batch({ stabilised, hasMedic, cause }) {
  let dead = 0, days = 0;
  for (let i = 0; i < N; i++) {
    const s = makeSoldier(r, {});
    const st = resolveCasualty(r, s, { stabilised, hasMedic, cause });
    if (st === STATUS.DEAD) dead++; else days += s.wound ? s.wound.days : 0;
  }
  return { dead: (dead / N) * 100, days: days / Math.max(1, N - dead) };
}

console.log('A man who goes down, by what put him there:\n');
console.log('  outcome            medic   cut     crush   shot    unknown');
for (const [label, stabilised, hasMedic] of [
  ['won, extracted', true, true], ['won, no medic', true, false],
  ['LOST, medic', false, true], ['LOST, no medic', false, false],
]) {
  const cells = CAUSES.map((c) => {
    const b = batch({ stabilised, hasMedic, cause: c });
    return `${b.dead.toFixed(0)}% ${b.days.toFixed(0)}d`.padEnd(8);
  });
  console.log(`  ${label.padEnd(19)}${hasMedic ? 'yes' : 'no '}     ${cells.join('')}`);
}

// What that means over a campaign: a company that fights, takes losses and
// recruits back up. The question is whether the roster can hold a line.
console.log('\nOver twenty engagements, a company of 20 that loses a quarter down each time:');
for (const [label, winRate] of [['winning 3 in 4', 0.75], ['even', 0.5], ['losing 3 in 4', 0.25]]) {
  let buried = 0, hurt = 0;
  for (let f = 0; f < 20; f++) {
    const won = r() < winRate;
    for (let i = 0; i < 5; i++) {
      const s = makeSoldier(r, {});
      const st = resolveCasualty(r, s, { stabilised: won, hasMedic: true, cause: 'cut' });
      if (st === STATUS.DEAD) buried++; else hurt++;
    }
  }
  console.log(`  ${label.padEnd(16)} ${buried} buried, ${hurt} came back hurt`
    + `  (${((buried / (buried + hurt)) * 100).toFixed(0)}% of casualties are permanent)`);
}
