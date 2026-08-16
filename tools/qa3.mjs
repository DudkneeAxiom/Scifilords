// QA pass over the progression and tactical systems: commission, promotion,
// loadout, the settlement armoury, and squad commands in the field.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'qa3';
mkdirSync(OUT, { recursive: true });
const errors = [];
let n = 0;

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${e.stack || ''}`));

const shot = async (name, wait = 450) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` });
  console.log(`  ${name}`);
};

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await shot('commission');
await page.click('#modal [data-perk]');
await page.waitForTimeout(700);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

// ---- loadout ---------------------------------------------------------------
await page.evaluate(() => { window.KR.campaign.credits = 4000; });
await page.keyboard.press('l');
await shot('loadout', 800);

// Equip a spare weapon onto the selected soldier.
const arm = await page.$('#modal [data-arm]');
if (arm) { await arm.click(); await page.waitForTimeout(500); }
const kit = await page.$('#modal [data-kit]');
if (kit) { await kit.click(); await page.waitForTimeout(500); }
await shot('loadout-equipped');

// Pick a different soldier to show the roster switching.
const sels = await page.$$('#modal [data-sel]');
if (sels[2]) { await sels[2].click(); await page.waitForTimeout(500); }
await shot('loadout-other-soldier');
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(400);

// ---- settlement armoury ----------------------------------------------------
await page.evaluate(() => {
  const S = window.KR.campaign;
  window.KR.world.stopTravel();
  S.pos.x = -210; S.pos.z = -150;
  S.credits = 4000;
});
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const el = document.querySelector('#modal [data-x="avoid"]');
  if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
});
await page.waitForTimeout(400);
await page.keyboard.press('e');
await page.waitForTimeout(800);
// Scroll the shop into view.
await page.evaluate(() => {
  const m = document.getElementById('modal');
  if (m) m.scrollTop = m.scrollHeight * 0.55;
});
await shot('settlement-armoury');
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(400);

// ---- promotion perk panel --------------------------------------------------
await page.evaluate(async () => {
  const { addXp } = await import('/src/roster.js');
  const { rng } = await import('/src/util.js');
  const S = window.KR.campaign;
  const s = S.roster.find((x) => !x.isCommander);
  addXp(s, 400, rng(7));
});
await page.evaluate(async () => {
  const UI = await import('/src/ui.js');
  UI.resolvePendingPerks(window.KR.campaign, () => UI.closeModal());
});
await shot('promotion', 700);
await page.evaluate(() => document.querySelector('#modal [data-perk]')?.click());
await page.waitForTimeout(500);

// Roster now shows perks and kit.
await page.keyboard.press('c');
await shot('roster-with-perks', 800);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(400);

// ---- tactical commands in the field ---------------------------------------
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.contracts.forEach((c) => { c.accepted = false; });
  let c = S.contracts.find((x) => x.site === 'grellan');
  if (!c) {
    c = { id: 'qa_g', type: 'recovery', site: 'grellan', employer: 'syndic',
      title: 'QA', text: 'qa', pay: 500, expiresDay: S.day + 9, accepted: true };
    S.contracts.push(c);
  }
  c.accepted = true;
  window.KR.world.stopTravel();
  S.pos.x = 200; S.pos.z = -218;
});
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const el = document.querySelector('#modal [data-x="avoid"]');
  if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const S = window.KR.campaign; S.pos.x = 200; S.pos.z = -218;
});
await page.waitForTimeout(500);
await page.keyboard.press('e');
await page.waitForSelector('#modal [data-p]', { timeout: 15000 });
// Take everyone (the panel re-renders, so re-query each time).
const count = (await page.$$('#modal [data-p]')).length;
for (let i = 0; i < count; i++) {
  const els = await page.$$('#modal [data-p]');
  if (els[i]) await els[i].click().catch(() => {});
  await page.waitForTimeout(60);
}
await shot('deploy-picker');
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
// The insertion cinematic locks out input and holds all fire; anything
// measured across it is measuring a frozen game. waitForControlHelper
await page.waitForFunction(
  () => window.KR.mission && !window.KR.mission.intro?.active && !window.KR.mission.inserting,
  null, { timeout: 30000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  window.__god = setInterval(() => {
    const m = window.KR.mission;
    if (m && m.player && !m.over) { m.player.hp = m.player.maxHp; m.player.down = false; }
  }, 150);
});

// Move into contact so the squad panel has something to report.
await page.mouse.move(640, 400);
await page.evaluate(() => {
  const m = window.KR.mission;
  m.player.x = 8; m.player.z = -10;
  m.squad.forEach((s, i) => { s.x = 6 + i * 2; s.z = -6; });
});
await shot('in-contact', 2500);

// Select one soldier, then order suppression.
await page.keyboard.press('1');
await shot('selection-one', 500);
await page.keyboard.press('x');
await shot('order-suppress', 1800);

// Select another and send them flanking.
await page.keyboard.press('1');
await page.keyboard.press('2');
await page.keyboard.press('z');
await shot('order-flank', 1500);

// Back to the whole squad and fall back.
await page.keyboard.press('`');
await page.keyboard.press('v');
await shot('order-fallback', 1200);

writeFileSync(`${OUT}/errors.txt`, errors.length ? errors.join('\n\n') : 'no console errors');
console.log(`\n=== ${errors.length} errors ===`);
errors.slice(0, 8).forEach((e) => console.log(e.slice(0, 300)));
await browser.close();
