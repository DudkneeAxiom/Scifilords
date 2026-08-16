// Are the company screens one window, or seven?
//
// Roster, kit, stores, commander, holdings, contracts and standing were each a
// separate modal, so comparing a soldier's kit against what was in the truck
// meant close, key, look, close, key. They are the same screens as before —
// what is new is a strip that says they are siblings.
//
// Two things worth checking that are easy to get wrong. The strip has to be on
// EVERY one of them, or the one that lacks it becomes a dead end. And switching
// must not go via the map: the world stays paused for the whole visit and
// unpauses exactly once, when you finally close.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-tabs', { recursive: true });

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
// Enough of a company that holdings and standing have something to show.
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.credits = 30000; S.renown = 800;
});

const TABS = await page.evaluate(() => window.KR.dev.UI.COMPANY_TABS);
const state = () => page.evaluate(() => ({
  title: document.querySelector('#modal .modal-title')?.textContent.trim(),
  strip: [...document.querySelectorAll('#modal .mtab')].map((b) => b.dataset.tab),
  on: document.querySelector('#modal .mtab.on')?.dataset.tab || null,
  paused: window.KR.world.paused,
}));

// ---- open the first one from the map, then never touch the map again ------
await page.keyboard.press('c');
await page.waitForSelector('#modal .mtabs', { timeout: 10000 });

console.log('\n=== clicking along the strip ===');
const rows = [];
for (const t of TABS) {
  await page.click(`#modal [data-tab="${t.id}"]`).catch(() => {});
  await page.waitForTimeout(320);
  const s = await state();
  rows.push({ id: t.id, ...s });
  console.log(`  ${t.id.padEnd(10)} "${(s.title || '-').padEnd(18)}" `
    + `strip ${s.strip.length}/${TABS.length}  lit "${s.on}"  map paused ${s.paused}`);
}

// ---- and by key ----------------------------------------------------------
console.log('\n=== and by key ===');
const byKey = [];
for (const t of TABS) {
  await page.keyboard.press(t.key.toLowerCase());
  await page.waitForTimeout(300);
  const s = await state();
  byKey.push({ want: t.id, got: s.on });
  console.log(`  ${t.key} → "${s.on}"${s.on === t.id ? '' : `  WANTED ${t.id}`}`);
}

// ---- leaving unpauses, once ----------------------------------------------
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  open: window.KR.dev.UI.modalOpen(),
  paused: window.KR.world.paused,
}));
console.log(`\nescape closes: ${!after.open}, map running again: ${after.paused === false}`);

await page.keyboard.press('c');
await page.waitForTimeout(400);
await page.screenshot({ path: 'qa-tabs/tabs.png' });

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);

const fails = [];
const missing = rows.filter((r) => r.strip.length !== TABS.length).map((r) => r.id);
if (missing.length) fails.push(`no strip on ${missing.join(', ')}`);
const unlit = rows.filter((r) => r.on !== r.id).map((r) => r.id);
if (unlit.length) fails.push(`wrong tab lit on ${unlit.join(', ')}`);
if (rows.some((r) => r.paused !== true)) fails.push('the map ran while a screen was open');
const badKeys = byKey.filter((k) => k.got !== k.want).map((k) => k.want);
if (badKeys.length) fails.push(`keys missed ${badKeys.join(', ')}`);
if (after.open || after.paused !== false) fails.push('closing did not put the map back');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: one window, seven tabs');
await browser.close();
