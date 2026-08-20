// The two screens behind those rules.
//
// The rules underneath diplomacy and stalls check out. What a player meets
// is the panels: whether the standings read, whether a commission you cannot
// take says WHY, whether the holdings board shows a stall you own and what
// it pays. A correct gate behind a screen that never mentions it is a
// feature nobody finds.
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
await page.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));

const read = (name) => page.evaluate(() => {
  const m = document.querySelector('#modal');
  const open = m && !m.classList.contains('hidden');
  const txt = open ? (m.textContent || '') : '';
  return { open, title: (m?.querySelector('.modal-title')?.textContent || '').trim(),
    chars: txt.trim().length,
    acts: [...(m?.querySelectorAll('[data-x]') || [])].map((b) => b.dataset.x).join(' '),
    nan: /NaN|undefined|Infinity|\[object/.test(txt),
    body: txt.replace(/\s+/g, ' ').trim().slice(0, 200) };
});

// --- diplomacy, as a nobody and as a power ------------------------------
for (const [label, setup] of [
  ['a nobody', () => {}],
  ['a power', (S) => { S.renown = 4000; S.rep.trust = 60; S.rep.syndic = 40;
    S.holdings = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]; }],
]) {
  await page.evaluate(async (which) => {
    const UI = await import('/src/ui.js');
    const S = window.KR.campaign;
    if (which === 'a power') {
      S.renown = 4000; S.rep.trust = 60; S.rep.syndic = 40;
      S.holdings = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    }
    UI.diplomacyPanel(S, { onClose: () => {} });
    await new Promise((r) => setTimeout(r, 500));
  }, label);
  const r = await read();
  console.log(`\nDIPLOMACY as ${label}: "${r.title}" ${r.chars} chars${r.nan ? '  BAD VALUES' : ''}`);
  console.log(`  buttons: ${r.acts || 'none'}`);
  console.log(`  "${r.body}"`);
  await page.screenshot({ path: `${OUT}/d-${label.replace(/\s+/g, '-')}.png` });
  await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
  await page.waitForTimeout(300);
}

// --- holdings, with and without a stall ---------------------------------
for (const [label, own] of [['with nothing', false], ['holding a stall', true]]) {
  await page.evaluate(async (buy) => {
    const UI = await import('/src/ui.js');
    const State = await import('/src/state.js');
    const { LOCATIONS } = await import('/src/data.js');
    const S = window.KR.campaign;
    S.credits = 50000;
    const mk = LOCATIONS.find((l) => l.services?.includes('market'));
    if (buy) State.buyWorkshop(S, mk.id); else S.workshops = {};
    UI.holdingsPanel(S, { onClose: () => {} });
    await new Promise((r) => setTimeout(r, 500));
  }, own);
  const r = await read();
  console.log(`\nHOLDINGS ${label}: "${r.title}" ${r.chars} chars${r.nan ? '  BAD VALUES' : ''}`);
  console.log(`  buttons: ${r.acts || 'none'}`);
  console.log(`  "${r.body}"`);
  await page.screenshot({ path: `${OUT}/h-${label.replace(/\s+/g, '-')}.png` });
  await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
  await page.waitForTimeout(300);
}
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
