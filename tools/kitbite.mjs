// Does the kit you paid for do anything?
//
// Two items were selling gun statistics into a game with no guns: a
// bandolier multiplying a magazine of 999, and a stabiliser resisting a
// suppression that only a Titan can generate. Both were WIRED — the keys
// existed and were read — which is exactly why nobody noticed. A stat that
// is plumbed and inert looks identical to one that works.
//
// So the check is not "is the key read" but "does equipping this change a
// number the melee uses".
import { newCampaign } from '../src/state.js';
import { makeSoldier, effective } from '../src/roster.js';
import { KIT } from '../src/data.js';

let seed = 4242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The keys the melee layer actually reads each frame.
const MELEE_KEYS = ['wind', 'guardStr', 'staggerRes', 'swingSpeed', 'reachBonus',
  'maxHp', 'speed', 'accuracy', 'sight', 'bleedMul', 'nerveBonus'];

console.log('kit            price   what it changes for a soldier');
for (const [id, k] of Object.entries(KIT)) {
  const s2 = makeSoldier(rnd, {});
  s2.kit = null;
  const a = { ...effective(s2) };
  s2.kit = id;
  const b = { ...effective(s2) };
  const diffs = [];
  for (const key of MELEE_KEYS) {
    const av = a[key] ?? 0, bv = b[key] ?? 0;
    if (Math.abs(bv - av) > 1e-9) diffs.push(`${key} ${av.toFixed(2)}->${bv.toFixed(2)}`);
  }
  console.log(`  ${id.padEnd(12)} ${String(k.price).padStart(5)}   `
    + (diffs.length ? diffs.join(', ') : 'NOTHING THE MELEE READS'));
}
