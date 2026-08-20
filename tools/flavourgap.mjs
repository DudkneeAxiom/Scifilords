// Work that is offered and can never be posted.
//
// generateContract() picks a mission type from the site's own list and then
// looks up CONTRACT_FLAVOUR[type] for the wording. No wording, no posting —
// it returns null and the caller sees nothing. That is silent: the site
// advertises the work in its data and the board simply never carries it.
import fs from 'node:fs';
import { LOCATIONS } from '../src/data.js';

const src = fs.readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const m = src.match(/const CONTRACT_FLAVOUR = \{([\s\S]*?)\n\};/);
const keys = m ? [...m[1].matchAll(/^ {2}([a-z]+):/gm)].map((x) => x[1]) : [];
console.log('contract wording written for:', keys.join(', ') || '(none found)');

const offered = new Map();
for (const l of LOCATIONS) {
  for (const t of (l.missions || [])) {
    if (!offered.has(t)) offered.set(t, []);
    offered.get(t).push(l.name);
  }
}
console.log('\ntype        sites offering   postable?');
let dead = 0;
for (const [t, sites] of [...offered].sort((a, b) => b[1].length - a[1].length)) {
  const ok = keys.includes(t);
  if (!ok) dead += sites.length;
  console.log(`  ${t.padEnd(10)} ${String(sites.length).padStart(3)}            ${ok ? 'yes' : 'NO — never reaches the board'}`);
  if (!ok) console.log(`      offered at: ${sites.slice(0, 6).join(', ')}${sites.length > 6 ? ' …' : ''}`);
}
const total = [...offered.values()].reduce((a, b) => a + b.length, 0);
console.log(`\n${dead} of ${total} site/type offers cannot produce a posting`
  + ` (${((dead / total) * 100).toFixed(0)}%).`);
