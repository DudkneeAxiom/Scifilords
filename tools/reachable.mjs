// Content that exists and can never happen.
//
// The seize and lair contracts were written, playable, declared by twelve
// locations — and unreachable, because the board looked up wording that was
// never authored and a missing entry returns null, which reads exactly like
// "no job today". That class of bug is silent by construction: the data
// says the feature is there and no code path ever proves otherwise.
//
// So: for each content table, does every entry get REFERENCED anywhere in
// src/? An id that appears only in its own definition is either dead or
// reached by some computed lookup — either way it is worth a look.
import fs from 'node:fs';
import * as D from '../src/data.js';

const files = fs.readdirSync(new URL('../src/', import.meta.url))
  .filter((f) => f.endsWith('.js'));
const src = new Map(files.map((f) =>
  [f, fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')]));
const all = [...src.values()].join('\n');

// Tables keyed by id, where a missing reference means the entry is unused.
const TABLES = ['WEAPONS', 'KIT', 'ARMOUR', 'ROLES', 'ORIGINS', 'TRAITS', 'OFFICERS',
  'GOODS', 'HOLDING_UPGRADES', 'POLICIES', 'MISSION_TYPES', 'FAVOURS', 'TROOP_PATHS',
  'CREEDS', 'REGIONS'];

for (const name of TABLES) {
  const t = D[name];
  if (!t) continue;
  const ids = Array.isArray(t) ? t.map((x) => x.id).filter(Boolean) : Object.keys(t);
  const orphans = [];
  for (const id of ids) {
    // Where else does this id appear? Its own definition line does not count,
    // so require it quoted somewhere — as a string literal in a lookup, a
    // list, a comparison. Ids referenced only via computed keys will show up
    // here too, which is why this prints rather than fails.
    const quoted = new RegExp(`['"\`]${id}['"\`]`, 'g');
    const hits = (all.match(quoted) || []).length;
    if (hits <= 1) orphans.push(id);
  }
  if (orphans.length) {
    console.log(`${name}: ${orphans.length} of ${ids.length} appear only in their own definition`);
    console.log(`   ${orphans.join(', ')}`);
  }
}

// And the specific shape that bit before: a mission type a site offers, or
// a mission type the code can build, with no counterpart on the other side.
const built = [...(src.get('mission.js') || '').matchAll(/t === '([a-z]+)'/g)].map((m) => m[1]);
const offered = new Set();
for (const l of D.LOCATIONS) for (const t of (l.missions || [])) offered.add(t);
const typed = Object.keys(D.MISSION_TYPES || {});
console.log('\nmission types:');
console.log(`  described in MISSION_TYPES: ${typed.join(', ')}`);
console.log(`  offered by locations:       ${[...offered].sort().join(', ')}`);
const cannotBuild = [...offered].filter((t) => !built.includes(t));
const neverOffered = typed.filter((t) => !offered.has(t));
console.log(cannotBuild.length
  ? `  OFFERED BUT NO BUILDER: ${cannotBuild.join(', ')}`
  : '  every offered type has a builder');
console.log(neverOffered.length
  ? `  described but never offered by a site: ${neverOffered.join(', ')} (may come from events)`
  : '  every described type is offered somewhere');
