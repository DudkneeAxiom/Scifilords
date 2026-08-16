// Is a prisoner worth different amounts in different places?
//
// A captive had one price, everywhere, forever, which made the whole prisoner
// list a button: there was never a reason to carry anyone anywhere. A broker is
// supposed to make that a market.
//
// The trap this probe is built to catch is a "market" that is really just a
// bigger fixed price. If every town pays within a few percent of the mean, or
// if the rate never moves as the days pass, then nothing has been added except
// a multiplier — so the spread ACROSS towns and the drift OVER time are the two
// numbers that decide whether this feature exists.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-broker', { recursive: true });

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

// ---- does the rate actually vary? ----------------------------------------
const market = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const DATA = await import('/src/data.js');
  const S = State.newCampaign(4242);
  const towns = DATA.LOCATIONS.filter((l) => State.hasBroker(l.id));
  // Across towns, on one day.
  S.day = 12;
  const across = towns.map((l) => ({ name: l.name, rate: State.brokerRate(S, l.id) }));
  // And over time, in one town.
  const one = towns[0];
  const over = [];
  for (let d = 1; d <= 30; d++) { S.day = d; over.push(State.brokerRate(S, one.id)); }
  return { across, over, town: one.name, floor: State.BROKER_FLOOR, ceil: State.BROKER_CEIL };
});

const rates = market.across.map((a) => a.rate);
const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length);
console.log(`\n=== what brokers pay on day 12 (band ${market.floor}–${market.ceil}) ===`);
for (const a of market.across.sort((x, y) => y.rate - x.rate)) {
  const bar = '#'.repeat(Math.round((a.rate - market.floor) / (market.ceil - market.floor) * 30));
  console.log(`  ${a.name.padEnd(22)} ${a.rate.toFixed(2)}x  ${bar}`);
}
console.log(`  mean ${mean.toFixed(2)}  sd ${sd.toFixed(2)}  spread ${(Math.max(...rates) - Math.min(...rates)).toFixed(2)}`);

// Drift: how often does the rate change, and by how much, over a month?
let moves = 0, biggest = 0;
for (let i = 1; i < market.over.length; i++) {
  const d = Math.abs(market.over[i] - market.over[i - 1]);
  if (d > 0.001) moves++;
  biggest = Math.max(biggest, d);
}
// A price that only ever walks one way is a ramp, not a market — and summary
// statistics hide it perfectly, so the direction of each step is counted.
const steps = [];
for (let i = 1; i < market.over.length; i++) {
  const d = market.over[i] - market.over[i - 1];
  if (Math.abs(d) > 0.001) steps.push(Math.sign(d));
}
const ups = steps.filter((s) => s > 0).length;
const oneWay = steps.length ? Math.max(ups, steps.length - ups) / steps.length : 1;
console.log(`\n=== ${market.town}, 30 days ===`);
console.log(`  rate moved on ${moves} of 29 day-steps, biggest single move ${biggest.toFixed(2)}x`);
console.log(`  ${ups} of ${steps.length} moves were upward (${Math.round(oneWay * 100)}% one direction)`);
console.log(`  ${market.over.slice(0, 15).map((r) => r.toFixed(2)).join(' ')}`);

// ---- selling against ransoming -------------------------------------------
const compare = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const DATA = await import('/src/data.js');
  const Roster = await import('/src/roster.js');
  const { rng } = await import('/src/util.js');
  const town = DATA.LOCATIONS.find((l) => State.hasBroker(l.id));

  const mk = () => {
    const S = State.newCampaign(31);
    S.day = 12;
    const r = rng(9);
    const p = Roster.makeSoldier(r, { rank: 2 });
    p.captiveFaction = 'trust';
    S.prisoners = [p];
    // One soldier of each creed, built rather than sliced off the starting
    // company — which has only four people, so slicing quietly dropped a creed
    // and the comparison was missing the one that likes being paid.
    S.roster = [
      { ...S.roster[0], isCommander: true },
      ...['straight', 'hard', 'loyal', 'paid'].map((creed) => ({
        ...Roster.makeSoldier(r, {}), isCommander: false, creed, regard: 0,
      })),
    ];
    return { S, id: p.id };
  };

  const regards = (S) => S.roster.filter((s) => !s.isCommander)
    .map((s) => ({ creed: s.creed, regard: s.regard }));

  const a = mk();
  const aCred = a.S.credits, aRep = a.S.rep.trust;
  State.ransomPrisoner(a.S, a.id);
  const b = mk();
  const bCred = b.S.credits, bRep = b.S.rep.trust;
  State.sellPrisoner(b.S, town.id, b.id);

  return {
    town: town.name,
    ransom: { paid: a.S.credits - aCred, rep: a.S.rep.trust - aRep, regards: regards(a.S) },
    sell: { paid: b.S.credits - bCred, rep: b.S.rep.trust - bRep, regards: regards(b.S) },
  };
});
console.log(`\n=== one sergeant, two fates (${compare.town}) ===`);
for (const [name, r] of [['ransomed home', compare.ransom], ['sold on', compare.sell]]) {
  console.log(`  ${name.padEnd(15)} ${String(r.paid).padStart(5)} credits   `
    + `trust standing ${r.rep > 0 ? '+' : ''}${r.rep}   `
    + r.regards.map((x) => `${x.creed} ${x.regard > 0 ? '+' : ''}${x.regard}`).join('  '));
}

// ---- and it reaches the player -------------------------------------------
const ui = await page.evaluate(async () => {
  const { DATA, State, Roster } = window.KR.dev;
  const { rng } = await import('/src/util.js');
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => State.hasBroker(l.id) && l.contacts?.length);
  const r = rng(5);
  S.prisoners = [2, 1].map((rank) => {
    const p = Roster.makeSoldier(r, { rank });
    p.captiveFaction = 'trust';
    return p;
  });
  S.pos.x = loc.x; S.pos.z = loc.z;
  window.KR.dev.enterLocation();
  return !!document.querySelector('#modal [data-verb="broker"]');
});
let shot = null;
if (ui) {
  await page.click('#modal [data-verb="broker"]');
  await page.waitForTimeout(400);
  shot = await page.evaluate(() => ({
    title: document.querySelector('#modal .modal-title')?.textContent.trim(),
    tag: document.querySelector('#modal .modal-tag')?.textContent.trim(),
    offers: [...document.querySelectorAll('#modal [data-sell]')].map((b) => b.textContent.trim()),
    homes: [...document.querySelectorAll('#modal .brk-cmp .val')].map((v) => v.textContent.trim()),
  }));
  await page.screenshot({ path: 'qa-broker/broker.png' });
  // Selling one must actually remove them and pay.
  const before = await page.evaluate(() => ({
    n: window.KR.campaign.prisoners.length, c: window.KR.campaign.credits,
  }));
  await page.click('#modal [data-sell]');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    n: window.KR.campaign.prisoners.length, c: window.KR.campaign.credits,
    back: !!document.querySelector('#modal .sm-verbs') || !!document.querySelector('#modal [data-sell]'),
  }));
  shot.sold = { removed: before.n - after.n, paid: after.c - before.c, back: after.back };
}
console.log(`\nmenu offers the broker: ${ui}`);
if (shot) {
  console.log(`  "${shot.title}" ${shot.tag}`);
  shot.offers.forEach((o, i) => console.log(`    ${o}   (their people: ${shot.homes[i]})`));
  console.log(`  sold one: removed ${shot.sold.removed}, paid ${shot.sold.paid}, still in town ${shot.sold.back}`);
}

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);

const fails = [];
// A market that always pays the same is a fixed price wearing a hat.
if (sd < 0.15) fails.push(`towns barely differ (sd ${sd.toFixed(2)})`);
if (moves < 5) fails.push(`the rate hardly ever moves (${moves} steps in 30 days)`);
if (oneWay > 0.8) fails.push(`the price walks one way (${Math.round(oneWay * 100)}% of moves) — that is a ramp`);
if (!(compare.sell.paid > compare.ransom.paid)) fails.push('a broker pays no better than their own people');
if (!(compare.sell.rep < compare.ransom.rep)) fails.push('selling costs no more standing than ransoming');
const straight = compare.sell.regards.find((r) => r.creed === 'straight');
const paid = compare.sell.regards.find((r) => r.creed === 'paid');
if (!(straight.regard < 0 && paid.regard > 0)) fails.push('the company does not split over it');
if (!ui) fails.push('the broker never reaches the player');
else if (!shot.offers.length || shot.sold.removed !== 1 || shot.sold.paid <= 0) {
  fails.push('selling through the panel did not work');
}
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: a real market, and it costs what it should');
await browser.close();
