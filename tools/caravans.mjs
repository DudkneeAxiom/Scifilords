// Caravans of your own.
//
// A holding pays a fixed yield whether or not the roads around it are safe,
// which makes it a number that goes up rather than a place you have to look
// after. A caravan is money that has to physically survive the map: it earns
// more where you are welcome, and anything hostile can take it off you.
//
// The failure modes worth checking are the quiet ones. A caravan that gets
// culled by the party-population housekeeping, or that the player's own
// encounter logic points at as a target, would both look like a bug with no
// error attached.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-caravans', { recursive: true });

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

// ---- what it takes to get one --------------------------------------------
const gates = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement');
  const out = [];
  S.credits = 50000;

  out.push({ case: 'somewhere you do not hold', ...State.canBuyCaravan(S, loc.id) });
  State.seizeLocation(S, loc.id);
  out.push({ case: 'held, but no depot', ...State.canBuyCaravan(S, loc.id) });
  S.holdings[loc.id].upgrades.depot = 1;
  out.push({ case: 'held, depot 1', ...State.canBuyCaravan(S, loc.id) });
  State.buyCaravan(S, loc.id);
  out.push({ case: 'one already running', ...State.canBuyCaravan(S, loc.id) });
  S.holdings[loc.id].upgrades.depot = 2;
  out.push({ case: 'depot raised to 2', ...State.canBuyCaravan(S, loc.id) });
  S.credits = 100;
  out.push({ case: 'no money', ...State.canBuyCaravan(S, loc.id) });
  return { loc: loc.name, out, cost: State.CARAVAN_COST };
});
console.log(`Fitting one out at ${gates.loc} (costs ${gates.cost}):`);
for (const g of gates.out) {
  console.log(`  ${g.case.padEnd(28)} ${g.ok ? 'ALLOWED' : 'refused'}  ${g.why || ''}`);
}

// ---- it must survive the housekeeping ------------------------------------
const survives = await page.evaluate(() => {
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  S.credits = 50000;
  const before = S.parties.filter((p) => p.kind === 'own_caravan').length;
  // Run a long stretch: maintainParties trims the party furthest from the
  // player whenever a region is crowded, and an owned caravan must never be
  // the one it picks.
  for (let d = 0; d < 60; d++) State.advanceTime(S, 24);
  const mine = S.parties.filter((p) => p.kind === 'own_caravan');
  return {
    before, after: mine.length,
    everHostile: mine.some((p) => p.hostileToPlayer),
    totalParties: S.parties.length,
  };
});
console.log(`\nAfter 60 days: ${survives.before} caravan(s) -> ${survives.after},`
  + ` ${survives.totalParties} parties on the map`);
console.log(`  ever flagged hostile to the player: ${survives.everHostile}`);

// ---- takings, and how standing bends them --------------------------------
const takings = await page.evaluate(() => {
  const { State, DATA, makeRng } = window.KR.dev;
  const S = window.KR.campaign;
  const measure = (rel) => {
    const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement');
    S.relations = {};
    S.credits = 0;
    // One caravan, parked on a known circuit, with the road to itself.
    S.parties = S.parties.filter((p) => p.kind === 'own_caravan').slice(0, 1);
    if (!S.parties.length) {
      S.credits = 50000;
      if (!S.holdings[loc.id]) State.seizeLocation(S, loc.id);
      S.holdings[loc.id].upgrades.depot = 3;
      State.buyCaravan(S, loc.id);
    }
    const c = S.parties.find((p) => p.kind === 'own_caravan');
    if (!c) return null;
    c.homeHolding = loc.id;
    c.target = loc.id;
    S.relations[loc.id] = rel;
    let paid = 0;
    for (let d = 0; d < 60; d++) {
      const r = makeRng(4000 + d);
      S.day++;
      c.nextPayDay = 0;              // force a completed leg every day
      const before = S.credits;
      State.tickCaravans(S, r);
      paid += S.credits - before;
    }
    return Math.round(paid / 60);
  };
  return { hated: measure(-100), neutral: measure(0), loved: measure(100) };
});
console.log('\nAverage takings per completed leg:');
console.log(`  where they are hated   ${takings.hated}`);
console.log(`  neutral ground         ${takings.neutral}`);
console.log(`  where you are Ours     ${takings.loved}`);

// ---- and the road can take it off you ------------------------------------
const risk = await page.evaluate(() => {
  const { State, DATA, makeRng } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement');
  S.credits = 500000;
  if (!S.holdings[loc.id]) State.seizeLocation(S, loc.id);
  S.holdings[loc.id].upgrades.depot = 3;

  let lost = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    S.parties = S.parties.filter((p) => p.kind !== 'own_caravan');
    const c = State.buyCaravan(S, loc.id);
    if (!c) break;
    // Put a pack of hostiles right on top of it.
    for (let k = 0; k < 4; k++) {
      S.parties.push({ id: `bad${i}_${k}`, kind: 'looters', name: 'Looters', strength: 6,
        faction: 'raider', x: c.x + 10, z: c.z + 10, hostileToPlayer: true, baseHostile: true });
    }
    const r = makeRng(9000 + i);
    for (let d = 0; d < 12; d++) { S.day++; State.tickCaravans(S, r); }
    if (!S.parties.some((p) => p.id === c.id)) lost++;
    S.parties = S.parties.filter((p) => !String(p.id).startsWith(`bad${i}_`));
  }
  return { lost, N, logMentions: S.log.filter((l) => /taken on the road/.test(l.text)).length };
});
console.log(`\nWith four hostile bands sitting on it for twelve days:`);
console.log(`  lost ${risk.lost} of ${risk.N} caravans, ${risk.logMentions} reported in the log`);

// ---- the holdings screen has to offer it ---------------------------------
await page.evaluate(() => {
  const { State, DATA, UI } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement');
  S.credits = 40000;
  if (!S.holdings[loc.id]) State.seizeLocation(S, loc.id);
  S.holdings[loc.id].upgrades.depot = 2;
  UI.holdingsPanel(S, { onClose: () => {} });
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'qa-caravans/01-holdings.png' });
const box = await page.evaluate(() => {
  const el = document.querySelector('#modal .caravan-box');
  return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 130) : null;
});
console.log(`\nOn the holdings screen: ${box}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const gated = !gates.out[0].ok && !gates.out[1].ok && gates.out[2].ok
  && !gates.out[3].ok && gates.out[4].ok && !gates.out[5].ok;
const kept = survives.after === survives.before && survives.after > 0 && !survives.everHostile;
const bends = takings.loved > takings.neutral && takings.neutral > takings.hated;
const risky = risk.lost > 0 && risk.lost < risk.N && risk.logMentions > 0;
const ok = gated && kept && bends && risky && box && errors.length === 0;
console.log(ok
  ? '\nOK — caravans need a depot, survive the housekeeping, pay by standing, and can be lost on the road.'
  : '\nFAIL — caravans are not behaving.');
await browser.close();
