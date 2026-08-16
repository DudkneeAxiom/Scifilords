// Does the company have an opinion about how you run it?
//
// Soldiers persist and the player learns their names, but until now nobody on
// the roster cared what was done with them. This checks that the four creeds
// genuinely disagree — that raiding a town is not simply "bad for morale" but
// good for some of your people and intolerable to others — and that a soldier
// who has had enough warns you before they walk.
//
// The measurement that matters is the SPREAD. If every creed moves the same
// way on the same event, this is just morale with extra words.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

// ---- creeds are spread across a company, not all one thing ---------------
const spread = await page.evaluate(async () => {
  const Roster = await import('/src/roster.js');
  const DATA = await import('/src/data.js');
  const { rng } = await import('/src/util.js');
  const r = rng(4242);
  const tally = {};
  for (let i = 0; i < 400; i++) {
    const s = Roster.makeSoldier(r, {});
    tally[s.creed] = (tally[s.creed] || 0) + 1;
  }
  return { tally, all: DATA.CREED_LIST };
});
console.log('\n=== creeds across 400 soldiers ===');
for (const c of spread.all) {
  const n = spread.tally[c] || 0;
  console.log(`  ${c.padEnd(9)} ${String(n).padStart(3)}  ${'#'.repeat(Math.round(n / 4))}`);
}

// ---- the same decision lands differently on different people -------------
const EVENTS = ['raid', 'press', 'release', 'oathbreak', 'unpaid', 'win', 'lair'];
const table = await page.evaluate(async (events) => {
  const State = await import('/src/state.js');
  const DATA = await import('/src/data.js');
  const out = {};
  for (const ev of events) {
    out[ev] = {};
    for (const creed of DATA.CREED_LIST) {
      // A one-soldier company of a known creed, so the reading is not an
      // average across a mixed roster.
      const S = State.newCampaign(99);
      S.roster = S.roster.slice(0, 1).map((s) => ({ ...s, isCommander: false, creed, regard: 0 }));
      State.companyReacts(S, ev);
      out[ev][creed] = S.roster[0].regard;
    }
  }
  return out;
}, EVENTS);

console.log('\n=== how each creed takes it ===');
const creeds = spread.all;
console.log(`  ${''.padEnd(10)}${creeds.map((c) => c.padStart(10)).join('')}   spread`);
const spreads = {};
for (const ev of EVENTS) {
  const vals = creeds.map((c) => table[ev][c]);
  spreads[ev] = Math.max(...vals) - Math.min(...vals);
  console.log(`  ${ev.padEnd(10)}${vals.map((v) => String(v > 0 ? `+${v}` : v).padStart(10)).join('')}`
    + `   ${spreads[ev]}`);
}

// ---- somebody who has had enough warns you first -------------------------
const leaving = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const { rng } = await import('/src/util.js');
  const S = State.newCampaign(7);
  // A straight-arrow soldier in a company that robs people for a living.
  S.roster = S.roster.slice(0, 2).map((s, i) => ({
    ...s, isCommander: i === 0, creed: 'straight', regard: 0,
  }));
  const who = S.roster[1].id;
  const log = [];
  let warnedOn = null, goneOn = null;
  const r = rng(11);
  for (let day = 1; day <= 60 && !goneOn; day++) {
    if (day % 2 === 0) State.companyReacts(S, 'raid');
    State.tickResentment(S, r);
    const s = S.roster.find((x) => x.id === who);
    if (!s) { goneOn = day; break; }
    if (s.quitWarned && warnedOn === null) { warnedOn = day; log.push(`day ${day}: warned`); }
  }
  return { warnedOn, goneOn, still: !!S.roster.find((x) => x.id === who), quit: S.stats.quit || 0 };
});
console.log('\n=== a straight soldier in a company that robs people ===');
console.log(`  warned you on day ${leaving.warnedOn}`);
console.log(`  walked on day ${leaving.goneOn ?? '—'}  (still on the roster: ${leaving.still})`);

// ---- and the roster shows it ---------------------------------------------
await page.keyboard.press('c');
await page.waitForTimeout(700);
const shown = await page.evaluate(() => {
  const el = document.querySelector('#modal .sol-creed');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
});
console.log(`\nroster shows: "${shown}"`);

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);

const fails = [];
const kinds = Object.values(spread.tally).filter(Boolean).length;
if (kinds < spread.all.length) fails.push(`only ${kinds} of ${spread.all.length} creeds ever appear`);
// The whole point is disagreement. If nobody splits on the loaded decisions,
// this is morale wearing a costume.
for (const ev of ['raid', 'press', 'release']) {
  const vals = creeds.map((c) => table[ev][c]);
  if (!(Math.max(...vals) > 0 && Math.min(...vals) < 0)) {
    fails.push(`${ev} does not split the company`);
  }
}
if (leaving.warnedOn === null) fails.push('nobody ever warned you');
if (!leaving.goneOn) fails.push('nobody ever left');
if (leaving.warnedOn !== null && leaving.goneOn && leaving.warnedOn >= leaving.goneOn) {
  fails.push('they left before warning you');
}
if (!shown) fails.push('the roster does not show any of it');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: they disagree, and they warn you first');
await browser.close();
