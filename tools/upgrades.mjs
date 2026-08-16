// Can a player who has just taken their first holding work out how to upgrade it?
//
// The complaint this probe exists for: "upgrading captured areas seems confusing
// on how to get the resources." So it sets up the worst case — a holding, an
// empty truck, no goods at all — and checks that every unaffordable cost names
// the good, says how many you have, and says where to buy it.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-upgrades', { recursive: true });

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

// A fresh holding and nothing to spend.
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.cargo = {};
  S.credits = 120;
  window.KR.dev.State.seizeLocation(S, 'grellan');
});
await page.keyboard.press('k');
await page.waitForTimeout(900);
await page.screenshot({ path: 'qa-upgrades/01-empty-truck.png' });

const rows = await page.evaluate(() => [...document.querySelectorAll('#modal .cost-row')]
  .map((r) => ({
    short: r.classList.contains('short'),
    need: r.querySelector('.cost-need')?.textContent.trim(),
    good: r.querySelector('.cost-good')?.textContent.trim(),
    have: r.querySelector('.cost-have')?.textContent.trim(),
    src: r.querySelector('.cost-src')?.textContent.trim(),
  })));

console.log(`cost lines on an empty truck: ${rows.length}`);
for (const r of rows.slice(0, 10)) {
  console.log(`  ${r.short ? 'SHORT' : '  ok '} ${String(r.need).padStart(5)} ${r.good.padEnd(16)}`
    + ` | ${r.have.padEnd(20)} | ${r.src}`);
}

const stores = await page.evaluate(() =>
  document.querySelector('#modal .hold-stores')?.textContent.replace(/\s+/g, ' ').trim());
console.log(`\nstores line: ${stores}`);

const goodsShort = rows.filter((r) => r.short && r.good !== 'CREDITS');
const withSource = goodsShort.filter((r) => /buy at .+\d+cr/.test(r.src));
console.log(`\n  ${goodsShort.length} goods the player cannot afford;`
  + ` ${withSource.length} of them name a market and a price`);

// And once the goods are in the truck the advice should disappear rather than
// nag — a solved problem should stop talking.
await page.evaluate(() => {
  document.querySelector('#modal [data-x="close"]')?.click();
  const S = window.KR.campaign;
  S.credits = 50000;
  // GOODS_LIST is a list of ids, not of goods.
  for (const id of window.KR.dev.DATA.GOODS_LIST) S.cargo[id] = 40;
});
await page.waitForTimeout(300);
await page.keyboard.press('k');
await page.waitForTimeout(800);
await page.screenshot({ path: 'qa-upgrades/02-stocked.png' });
const after = await page.evaluate(() => {
  const rs = [...document.querySelectorAll('#modal .cost-row')];
  return {
    total: rs.length,
    short: rs.filter((r) => r.classList.contains('short')).length,
    advice: rs.filter((r) => r.querySelector('.cost-src')?.textContent.trim()).length,
    buildable: [...document.querySelectorAll('#modal [data-up]')].filter((b) => !b.disabled).length,
  };
});
console.log(`\n  stocked: ${after.total} cost lines, ${after.short} short,`
  + ` ${after.advice} still showing advice, ${after.buildable} upgrades buildable`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
const ok = goodsShort.length > 0 && withSource.length === goodsShort.length
  && after.short === 0 && after.advice === 0 && after.buildable > 0
  && /no goods/.test(stores || '') && errors.length === 0;
console.log(ok
  ? '\nOK — every cost you cannot meet names the good, your stock, and where to buy it.'
  : '\nFAIL — the upgrade costs still do not explain themselves.');
await browser.close();
