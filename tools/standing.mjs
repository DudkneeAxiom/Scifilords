// Does a settlement remember you?
//
// Faction reputation is politics. This is the people who actually live in one
// place, and it is what stops a town being a vending machine: the place whose
// contracts you have been taking should offer you their better people and a
// fair price, and the place whose road you have been robbing should not.
//
// The subtle thing being checked here is DIRECTION. A settlement that likes you
// must sell to you cheaper AND pay you better. Folding one multiplier into the
// price would do the first and the exact opposite of the second.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-standing', { recursive: true });

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

// ---- prices bend the right way -------------------------------------------
const prices = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.services?.includes('market') && l.trade);
  const good = DATA.GOODS_LIST[0];
  const rows = [];
  for (const rel of [-100, -50, 0, 50, 100]) {
    S.relations[loc.id] = rel;
    rows.push({
      rel,
      tier: State.relationTier(S, loc.id).name,
      base: State.priceAt(S, loc.id, good),
      buy: State.buyPriceAt(S, loc.id, good),
      sell: State.sellPriceAt(S, loc.id, good),
    });
  }
  S.relations[loc.id] = 0;
  return { loc: loc.name, good: DATA.GOODS[good].name, rows };
});
console.log(`${prices.good} at ${prices.loc}:`);
console.log('  standing   tier        market   you pay   they pay you');
for (const r of prices.rows) {
  console.log(`  ${String(r.rel).padStart(8)}   ${r.tier.padEnd(10)}  ${String(r.base).padStart(6)}`
    + `  ${String(r.buy).padStart(8)}  ${String(r.sell).padStart(13)}`);
}

// ---- who they will put forward -------------------------------------------
const recruits = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.services?.includes('recruit'));
  const rows = [];
  for (const rel of [-80, -60, -30, 0, 40, 80]) {
    S.relations[loc.id] = rel;
    // Vary the day so the deterministic pool is not the same draw every time.
    S.day = 10 + rel;
    const pool = State.recruitPool(S, loc.id);
    rows.push({
      rel,
      tier: State.relationTier(S, loc.id).name,
      offered: pool.length,
      trained: pool.filter((p) => p.rank > 0).length,
    });
  }
  S.relations[loc.id] = 0; S.day = 1;
  return { loc: loc.name, rows };
});
console.log(`\nWho ${recruits.loc} will put forward:`);
console.log('  standing   tier        offered   already trained');
for (const r of recruits.rows) {
  console.log(`  ${String(r.rel).padStart(8)}   ${r.tier.padEnd(10)}  ${String(r.offered).padStart(7)}`
    + `  ${String(r.trained).padStart(15)}`);
}

// ---- and it has to move for reasons the player caused ---------------------
const drift = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.services?.includes('market') && l.trade);
  S.relations = {};
  const out = {};

  // Trading regularly makes you part of the furniture.
  S.credits = 90000;
  const good = DATA.GOODS_LIST[0];
  State.buyGood(S, loc.id, good, 20);
  const beforeTrade = State.relationOf(S, loc.id);
  for (let i = 0; i < 20; i++) State.sellGood(S, loc.id, good, 1);
  out.trade = [beforeTrade, State.relationOf(S, loc.id)];

  // Taking the place by force is not how you make friends inside it.
  const seizeAt = DATA.LOCATIONS.find((l) => l.kind !== 'open' && !State.isHolding(S, l.id));
  const beforeSeize = State.relationOf(S, seizeAt.id);
  State.seizeLocation(S, seizeAt.id);
  out.seize = [beforeSeize, State.relationOf(S, seizeAt.id), seizeAt.name];

  // Crossing a band should be announced, not silently accumulated.
  const logBefore = S.log.length;
  State.changeRelation(S, loc.id, 60);
  out.announced = S.log.length > logBefore;
  out.tierAfter = State.relationTier(S, loc.id).name;
  return out;
});
console.log('\nWhat moves it:');
console.log(`  twenty sales at a market   ${drift.trade[0]} -> ${drift.trade[1].toFixed(1)}`);
console.log(`  seizing ${drift.seize[2].padEnd(18)} ${drift.seize[1] - drift.seize[0]}`);
console.log(`  crossing a band is announced in the log: ${drift.announced} (now ${drift.tierAfter})`);

// ---- the settlement screen has to say so ---------------------------------
await page.evaluate(() => {
  const { State, DATA, UI } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.services?.includes('recruit') && l.services?.includes('market'));
  S.relations[loc.id] = 55;
  S.atLocation = loc.id;
  S.credits = 40000;
  UI.settlementPanel(S, loc, { onClose: () => {}, onHire: () => {}, onBuy: () => {}, onRefresh: () => {} });
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'qa-standing/01-settlement.png' });
const shown = await page.evaluate(() => {
  const box = document.querySelector('#modal .rel-box');
  return box ? box.textContent.replace(/\s+/g, ' ').trim() : null;
});
console.log(`\nOn the settlement screen: ${shown}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const hated = prices.rows[0];
const loved = prices.rows[prices.rows.length - 1];
const directional = loved.buy < hated.buy && loved.sell > hated.sell
  && loved.buy < loved.sell;
const gated = recruits.rows[0].offered === 0 && recruits.rows[1].offered === 0
  && recruits.rows[recruits.rows.length - 1].offered > recruits.rows[3].offered;
const moves = drift.trade[1] > drift.trade[0] && drift.seize[1] < drift.seize[0];
const ok = directional && gated && moves && drift.announced && shown && errors.length === 0;
console.log(ok
  ? '\nOK — a place remembers you, sells cheaper and pays better when it likes you, and shuts the door when it does not.'
  : '\nFAIL — settlement standing is not doing its job.');
await browser.close();
