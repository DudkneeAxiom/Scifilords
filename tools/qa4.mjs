// QA over the newest systems: stores and trade, holdings and upgrades, and the
// expanded strategic map.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'qa4';
mkdirSync(OUT, { recursive: true });
const errors = [];
let n = 0;

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const shot = async (name, w = 500) => {
  await page.waitForTimeout(w);
  await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` });
  console.log(`  ${name}`);
};

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(700);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

// Expanded map, zoomed out.
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.pos.x = 0; S.pos.z = 0;
  window.KR.world.zoom = 1.9;
});
await shot('expanded-map', 2200);

// Stores with cargo aboard, at a trading settlement.
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.credits = 9000;
  S.cargo = { water: 6, machine_parts: 3, salvage: 4 };
  window.KR.world.stopTravel();
  S.pos.x = 240; S.pos.z = 70;
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const el = document.querySelector('#modal [data-x="avoid"]');
  if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
});
await page.waitForTimeout(400);
await page.keyboard.press('i');
await shot('stores-trade', 1400);
await page.evaluate(() => {
  const m = document.getElementById('modal');
  if (m) m.scrollTop = m.scrollHeight * 0.42;
});
await shot('stores-market', 700);
await page.evaluate(() => {
  const m = document.getElementById('modal');
  if (m) m.scrollTop = m.scrollHeight;
});
await shot('stores-armoury', 700);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(400);

// Holdings: seize a couple and build them up.
await page.evaluate(async () => {
  const St = await import('/src/state.js');
  const S = window.KR.campaign;
  St.seizeLocation(S, 'rampart');
  St.seizeLocation(S, 'grellan');
  S.credits = 40000;
  S.cargo = { machine_parts: 40, salvage: 60, fuel_cells: 20, medical_stock: 20 };
  St.buildUpgrade(S, 'rampart', 'barracks');
  St.buildUpgrade(S, 'rampart', 'workshop');
  St.buildUpgrade(S, 'rampart', 'works');
  St.buildUpgrade(S, 'grellan', 'depot');
  S.holdings.grellan.threat = 0.75;
});
await page.keyboard.press('k');
await shot('holdings', 1000);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(400);

// The map with holdings marked.
await page.evaluate(() => { const S = window.KR.campaign; S.pos.x = 0; S.pos.z = -150; });
await shot('map-with-holdings', 1800);

writeFileSync(`${OUT}/errors.txt`, errors.length ? errors.join('\n\n') : 'no console errors');
console.log(`\n=== ${errors.length} errors ===`);
errors.slice(0, 8).forEach((e) => console.log(e.slice(0, 300)));
await browser.close();
