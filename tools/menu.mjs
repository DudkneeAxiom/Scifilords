// Arriving somewhere should be a place, not a form.
//
// The settlement screen used to be one panel with every service on it at once.
// This checks the thing that replaced it: a list of verbs, where each verb opens
// its own screen and — the part that is easy to get wrong — comes BACK to the
// menu rather than dumping you on the world map. A menu you fall out of is
// worse than the panel it replaced, because you lose your place every time you
// look at anything.
//
// So the real assertion here is round-tripping. Every verb is opened and closed
// in turn, and after each one we must still be standing in the settlement.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-menu', { recursive: true });

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

// Put the company on a full-service town with money in hand, so every verb the
// menu can offer is actually offered.
const open = async () => page.evaluate(() => {
  const { DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => ['market', 'recruit', 'medical', 'contracts']
    .every((s) => l.services?.includes(s)));
  S.credits = 20000;
  // enterLocation() finds the town under the company, so put the company on it.
  S.pos.x = loc.x; S.pos.z = loc.z;
  window.KR.dev.enterLocation();
  return loc.name;
});

const town = await open();
await page.waitForSelector('#modal .sm-verbs', { timeout: 10000 });

// ---- what the menu offers -------------------------------------------------
const menu = await page.evaluate(() => ({
  title: document.querySelector('#modal .modal-title')?.textContent.trim(),
  standing: document.querySelector('#modal .sm-tier')?.textContent.trim(),
  verbs: [...document.querySelectorAll('#modal .sm-verb')].map((b) => ({
    id: b.dataset.verb,
    label: b.querySelector('.sv-label')?.textContent.trim(),
    note: b.querySelector('.sv-note')?.textContent.trim(),
  })),
}));

console.log(`\n=== ${town} — the menu ===`);
console.log(`title "${menu.title}"  standing "${menu.standing}"`);
for (const v of menu.verbs) console.log(`  ${v.id.padEnd(9)} ${v.label}  —  ${v.note}`);

// ---- every verb round-trips ----------------------------------------------
// Deploy, raid, seize and pit all leave for a mission by design, so they are
// checked for reachability rather than for return.
//
// `rest` is different again: it does its thing and re-opens the menu directly,
// so it never has a screen of its own to close. It is checked for staying put.
const ROUNDTRIP = ['market', 'board', 'holdings', 'recruit', 'medical'];
const STAYS = ['rest'];
console.log('\n=== round trip ===');
const trips = [];
for (const id of ROUNDTRIP) {
  if (!menu.verbs.some((v) => v.id === id)) { console.log(`  ${id.padEnd(9)} not offered`); continue; }
  const before = errors.length;
  await page.click(`#modal [data-verb="${id}"]`);
  await page.waitForTimeout(400);
  // closeModal() empties the persistent #modal div rather than removing it, so
  // "is a panel up" is the overlay, not the presence of the element.
  const opened = await page.evaluate(() => ({
    open: window.KR.dev.UI.modalOpen(),
    title: document.querySelector('#modal .modal-title')?.textContent.trim(),
    isMenu: !!document.querySelector('#modal .sm-verbs'),
  }));
  // Close whatever it opened and see where we land.
  const closer = await page.$('#modal [data-x="close"]');
  if (closer) await closer.click();
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => !!document.querySelector('#modal .sm-verbs'));
  const ok = opened.open && back;
  trips.push({ id, ok });
  console.log(`  ${id.padEnd(9)} opened "${opened.title || '-'}"${opened.isMenu ? ' (stayed on menu)' : ''}`
    + ` → back to menu: ${back ? 'yes' : 'NO'}${errors.length > before ? '  ERRORED' : ''}`);
  if (!back) { await open(); await page.waitForSelector('#modal .sm-verbs', { timeout: 10000 }); }
}

// ---- resting keeps you where you are --------------------------------------
console.log('\n=== stays on the menu ===');
for (const id of STAYS) {
  if (!menu.verbs.some((v) => v.id === id)) continue;
  const before = await page.evaluate(() => window.KR.campaign.day);
  await page.click(`#modal [data-verb="${id}"]`);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    day: window.KR.campaign.day,
    onMenu: !!document.querySelector('#modal .sm-verbs'),
  }));
  const ok = after.onMenu && after.day !== before;
  trips.push({ id, ok });
  console.log(`  ${id.padEnd(9)} day ${before} → ${after.day}, still on the menu: `
    + `${after.onMenu ? 'yes' : 'NO'}`);
}

// ---- leaving actually leaves ----------------------------------------------
await page.click('#modal [data-x="close"]');
await page.waitForTimeout(500);
const left = await page.evaluate(() => ({
  modal: window.KR.dev.UI.modalOpen(),
  paused: window.KR.world.paused,
}));
console.log(`\nback to the road: modal closed ${!left.modal}, map running ${left.paused === false}`);

await page.screenshot({ path: 'qa-menu/menu.png' });
console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);

const bad = trips.filter((t) => !t.ok).map((t) => t.id);
console.log(bad.length ? `FAIL: ${bad.join(', ')} did not round-trip` : 'PASS: every verb round-trips');
await browser.close();
