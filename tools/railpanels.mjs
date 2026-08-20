// The six side panels, read rather than counted.
//
// The click sweep proved each rail tab renders characters into the panel.
// That is not the same as working: a holdings board with nothing on it, a
// standing page that never names a faction, a stores page whose buttons do
// not buy — all render text and all would pass. This opens each, reports
// what is actually in it, and flags the tells.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const OUT = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1000);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(600);
}
await page.evaluate(() => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
  // Give the company something to show on every page: money, holdings,
  // standing and stock. An empty panel on a day-one company is not a bug.
  const S = window.KR.campaign;
  S.credits = 30000;
  if (S.rep) for (const k of Object.keys(S.rep)) S.rep[k] = 40;
});
await page.waitForTimeout(1200);

const rail = await page.evaluate(() => [...document.querySelectorAll('#wh-rail *, [data-rail]')]
  .filter((e) => (e.textContent || '').trim().length > 2 && e.getBoundingClientRect().width > 4)
  .map((e, i) => ({ i, label: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14) })));

const tabs = ['COMPANY', 'STORES', 'WORK', 'GROUND', 'STANDING', 'LOG'];
console.log('panel      chars  rows  buttons  numbers  tells');
for (const t of tabs) {
  const before = errors.length;
  const opened = await page.evaluate((name) => {
    const el = [...document.querySelectorAll('#worldhud *')]
      .find((e) => (e.textContent || '').trim().toUpperCase().startsWith(name)
        && e.getBoundingClientRect().width > 4 && e.children.length <= 2);
    if (!el) return false;
    (el.closest('button,[data-rail],.rail-btn') || el).click();
    return true;
  }, t);
  if (!opened) { console.log(`${t.padEnd(10)} tab not found on the rail`); continue; }
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const side = document.querySelector('#wh-side');
    const txt = (side?.textContent || '');
    return {
      chars: txt.trim().length,
      rows: side ? side.querySelectorAll('.sb-row, .row, li, tr, .pers-row').length : 0,
      buttons: side ? side.querySelectorAll('button, [data-x], .btn').length : 0,
      // Real content shows real numbers; a stub does not.
      numbers: (txt.match(/\d+/g) || []).length,
      nan: /NaN|undefined|Infinity|\[object/.test(txt),
      empty: /nothing|none yet|no holdings|no work|empty/i.test(txt),
      head: txt.replace(/\s+/g, ' ').trim().slice(0, 60),
    };
  });
  await page.screenshot({ path: `${OUT}/r-${t.toLowerCase()}.png` });
  console.log(`${t.padEnd(10)} ${String(r.chars).padStart(5)} ${String(r.rows).padStart(5)}`
    + ` ${String(r.buttons).padStart(8)} ${String(r.numbers).padStart(8)}`
    + `  ${r.nan ? 'BAD VALUES ' : ''}${r.empty ? 'reads empty ' : ''}`
    + `${errors.length > before ? 'ERRORS ' + (errors.length - before) : ''}`);
  console.log(`           "${r.head}"`);
}
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
