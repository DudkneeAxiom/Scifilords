// What work is actually on offer?
//
// Contracts are the campaign's income and its variety — the ledger showed
// they pay 10 to 14 days of wages at every company size, but nothing has
// looked at WHAT is being offered. A board that serves the same two jobs,
// or names a site the player cannot reach, or quotes a pay of NaN, would
// pass every test in the tree.
import { newCampaign, generateContract } from '../src/state.js';
import * as State from '../src/state.js';
import { LOCATIONS } from '../src/data.js';

let seed = 20260819;
const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const S = newCampaign(4242);
const byType = new Map(), byEmployer = new Map(), bySite = new Map();
const bad = [];
const N = 400;
for (let i = 0; i < N; i++) {
  // A FRESH DRAW each time. Leaving the board to fill up meant every later
  // call was rejected as a duplicate — 288 of 400 came back null, which is
  // the generator working, not failing.
  S.contracts.length = 0;
  const c = generateContract(S, r);
  if (!c) { bad.push('generateContract returned nothing'); continue; }
  byType.set(c.type, (byType.get(c.type) || 0) + 1);
  byEmployer.set(c.employer || '(none)', (byEmployer.get(c.employer || '(none)') || 0) + 1);
  bySite.set(c.site, (bySite.get(c.site) || 0) + 1);
  if (!Number.isFinite(c.pay) || c.pay <= 0) bad.push(`${c.type}: pay ${c.pay}`);
  if (!c.site || !LOCATIONS.some((l) => l.id === c.site)) bad.push(`${c.type}: site "${c.site}" is not on the map`);
  if (!c.title || /undefined|NaN/.test(String(c.title))) bad.push(`${c.type}: title "${c.title}"`);
  if (!c.text || /undefined|NaN/.test(String(c.text))) bad.push(`${c.type}: text "${String(c.text).slice(0, 40)}"`);
  if (c.expiresDay != null && c.expiresDay <= S.day) bad.push(`${c.type}: already expired on posting`);
}
console.log(`${N} postings generated\n`);
console.log('  by kind of work:');
for (const [k, v] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(k).padEnd(10)} ${String(v).padStart(4)}  ${'#'.repeat(Math.round(v / N * 60))}`);
}
console.log(`\n  employers: ${[...byEmployer].map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`  distinct sites used: ${bySite.size} of ${LOCATIONS.length} on the map`);
// A board that only ever points at three places makes the Reach feel small.
const unused = LOCATIONS.filter((l) => !bySite.has(l.id));
if (unused.length) {
  console.log(`  never offered work: ${unused.length} — ${unused.slice(0, 8).map((l) => l.name).join(', ')}`
    + (unused.length > 8 ? ' …' : ''));
}
console.log(bad.length ? `\n  ${bad.length} malformed postings:\n    ` + [...new Set(bad)].slice(0, 8).join('\n    ')
  : '\n  every posting well-formed: pay, site, title, text, expiry');
