// Every modifier a soldier can carry, and whether it reaches the melee.
//
// The kit round found two items whose statistics were wired and inert —
// read by real code, attached to a mechanic that no longer exists. That is
// not a kit problem, it is a shape: any modifier authored for the shooter
// can still be summed correctly into a stat nothing melee consults.
//
// So this sweeps ALL of them — traits, origins, kit — and reports what each
// actually moves. It carries a control: modifiers known to work must show
// up, and if they do not, the sweep is wrong rather than the game. That is
// the check that caught three bad probes last round.
import { makeSoldier, effective } from '../src/roster.js';
import { TRAITS, ORIGINS, KIT } from '../src/data.js';

let seed = 20260819;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// What the melee layer reads every frame, versus what only a gun would.
const MELEE = ['maxHp', 'speed', 'wind', 'guardStr', 'staggerRes', 'swingSpeed',
  'reachBonus', 'luck', 'nerveBonus', 'rally', 'bleedMul', 'sight',
  // Bladework. Melee damage scales by it directly.
  'accuracy'];
const RANGED_ONLY = ['rangeAcc', 'magMul', 'reloadMul', 'burstBonus',
  'burstRest', 'suppressResist', 'suppressPower'];
// Cover is a grey area: nobody is ORDERED into it any more, but soldiers
// still use it to break a bowman's sightline.
const GREY = ['cover', 'coverRange'];

const diff = (before, after) => {
  const out = { melee: [], ranged: [], grey: [] };
  for (const k of [...MELEE, ...RANGED_ONLY, ...GREY]) {
    if (Math.abs((after[k] ?? 0) - (before[k] ?? 0)) < 1e-9) continue;
    if (MELEE.includes(k)) out.melee.push(k);
    else if (GREY.includes(k)) out.grey.push(k);
    else out.ranged.push(k);
  }
  return out;
};

const report = (label, rows) => {
  console.log(`\n${label}`);
  for (const { id, d } of rows) {
    const verdict = d.melee.length ? 'reaches the melee'
      : d.grey.length ? 'cover only — soldiers still use it against bows'
        : d.ranged.length ? 'RANGED STATS ONLY' : 'MOVES NOTHING';
    console.log(`  ${id.padEnd(12)} ${verdict.padEnd(46)}`
      + `${[...d.melee, ...d.grey, ...d.ranged].join(', ')}`);
  }
};

// --- traits --------------------------------------------------------------
report('TRAIT', TRAITS.map((t) => {
  const s = makeSoldier(rnd, {});
  s.traits = [];
  const a = { ...effective(s) };
  s.traits = [t.id];
  return { id: t.id, d: diff(a, effective(s)) };
}));

// --- origins -------------------------------------------------------------
report('ORIGIN', Object.keys(ORIGINS).map((o) => {
  const s = makeSoldier(rnd, {});
  s.traits = [];
  s.origin = 'free';
  const a = { ...effective(s) };
  s.origin = o;
  return { id: o, d: diff(a, effective(s)) };
}));

// --- kit, as the control -------------------------------------------------
// plate and shield are known to work. If they read as moving nothing, the
// sweep is broken and every other line in it is worthless.
report('KIT (control: plate and shield must reach the melee)',
  Object.keys(KIT).map((k) => {
    const s = makeSoldier(rnd, {});
    s.traits = [];
    s.kit = null;
    const a = { ...effective(s) };
    s.kit = k;
    return { id: k, d: diff(a, effective(s)) };
  }));

// --- armour --------------------------------------------------------------
import { ARMOUR } from '../src/data.js';
report('ARMOUR', Object.keys(ARMOUR).map((id) => {
  const s2 = makeSoldier(rnd, {});
  s2.traits = [];
  s2.equip = {};
  const a = { ...effective(s2) };
  s2.equip = { [ARMOUR[id].slot]: id };
  return { id, d: diff(a, effective(s2)) };
}));
