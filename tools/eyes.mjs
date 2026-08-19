// Look at the game.
//
// Every probe in this tree reads numbers out of the simulation. None of them
// has ever LOOKED at the screen, and a game can pass every assertion while
// rendering a black rectangle with the text off the edge. This walks the
// shell the way a player does and photographs each screen so the pictures
// can be examined one by one.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const OUT = process.argv[2] || '.';
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });

let n = 0;
const shot = async (name, waitMs = 500) => {
  await page.waitForTimeout(waitMs);
  const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(`  shot ${file}`);
};

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await shot('title', 1500);

await page.click('button[data-act="new"]');
await page.waitForTimeout(1000);
// The opening questionnaire, photographed before it is signed through.
await shot('creation');
for (let i = 0; i < 6; i++) {
  const done = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]')
      || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (done) break;
  await page.waitForTimeout(600);
}
await page.evaluate(() => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
});
await shot('worldmap', 2000);

// Every panel the shell can open, by the same route the buttons use.
const panels = await page.evaluate(() => Object.keys(window.KR.dev || {}));
console.log('dev entry points:', panels.join(', ') || 'none');

for (const [name, fn] of [
  ['roster', 'openRoster'], ['company', 'openCompany'], ['contracts', 'openContracts'],
  ['market', 'openMarket'], ['recruit', 'openRecruit'], ['stores', 'openStores'],
  ['map-legend', 'openLegend'], ['log', 'openLog'],
]) {
  const ok = await page.evaluate((f) => {
    const d = window.KR.dev || {};
    if (typeof d[f] === 'function') { try { d[f](); return true; } catch (e) { return String(e.message); } }
    return false;
  }, fn);
  if (ok === true) await shot(name);
  else console.log(`  (no ${name}: ${ok})`);
  await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const b = m?.querySelector('[data-x="close"]');
    if (b) b.click(); else m?.classList.add('hidden');
  });
  await page.waitForTimeout(250);
}

fs.writeFileSync(`${OUT}/errors.txt`, errors.join('\n') || 'none');
console.log(errors.length ? `\n${errors.length} console errors (see errors.txt)` : '\nno console errors');
await browser.close();
