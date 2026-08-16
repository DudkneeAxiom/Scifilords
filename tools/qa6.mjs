// QA for diplomacy: standing, taking a commission, declaring a faction.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('qa6', { recursive: true });
const errors = []; let n = 0;
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
const shot = async (name, w = 500) => {
  await page.waitForTimeout(w);
  await page.screenshot({ path: `qa6/${String(++n).padStart(2, '0')}-${name}.png` });
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

// Early game: nothing unlocked.
await page.keyboard.press('p');
await shot('diplomacy-early', 900);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(300);

// Earn standing and renown, then take a commission.
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.renown = 700; S.credits = 20000;
  S.rep.trust = 18; S.rep.syndic = 3;
});
await page.keyboard.press('p');
await shot('diplomacy-trusted', 900);
const join = await page.$('#modal [data-join="trust"]');
if (join) { await join.click(); await page.waitForTimeout(700); }
await shot('commission-taken');
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(500);
await shot('diplomacy-sworn', 700);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(300);

// Now build up to declaring independence.
await page.evaluate(async () => {
  const St = await import('/src/state.js');
  const S = window.KR.campaign;
  S.renown = 1800;
  St.seizeLocation(S, 'rampart');
  St.seizeLocation(S, 'grellan');
  St.seizeLocation(S, 'culvert');
});
await page.keyboard.press('p');
await shot('can-declare', 900);
await page.evaluate(() => {
  const el = document.getElementById('fac-name');
  if (el) el.value = 'The Kettle Compact';
});
const dec = await page.$('#modal [data-x="declare"]');
if (dec) { await dec.click(); await page.waitForTimeout(800); }
await shot('declared');
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(600);
await shot('diplomacy-own-faction', 800);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => { const S = window.KR.campaign; S.pos.x = 0; S.pos.z = -150; });
await shot('map-own-banner', 1800);

const st = await page.evaluate(() => {
  const S = window.KR.campaign;
  return {
    own: S.ownFaction?.name, allegiance: S.allegiance,
    rep: S.rep, holdings: Object.keys(S.holdings).length,
    hostileParties: S.parties.filter((p) => p.hostileToPlayer).length,
    total: S.parties.length,
  };
});
console.log('  state:', JSON.stringify(st));
writeFileSync('qa6/errors.txt', errors.join('\n') || 'none');
console.log(`\n=== ${errors.length} errors ===`);
errors.slice(0, 6).forEach((e) => console.log(e.slice(0, 220)));
await browser.close();
