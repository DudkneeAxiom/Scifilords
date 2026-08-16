// QA for the equipment screen.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('qa5', { recursive: true });
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
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
  const S = window.KR.campaign;
  S.credits = 6000;
  // Stock stores and drop some spoils in the bag.
  S.armourPool = { head_combat: 1, head_heavy: 1, body_carrier: 1, body_heavy: 1, legs_plated: 1, legs_reinforced: 1 };
  S.armoury = { dmr: 1, lmg: 1, smg: 1 };
  S.kitPool = { optic: 1, plate: 1 };
  S.spoils = { credits: 340, cargo: { salvage: 5 }, armoury: { shotgun: 2 }, armourPool: { head_light: 3 }, kitPool: {} };
});
await page.waitForTimeout(400);
await page.keyboard.press('v');
await page.waitForSelector('#cp-view canvas', { timeout: 15000 });
await page.waitForTimeout(1600);
await page.screenshot({ path: 'qa5/01-equipment.png' });
console.log('  equipment');
// Equip a helmet, body and legs.
for (const sel of ['[data-equip="armour:head_heavy"]', '[data-equip="armour:body_heavy"]', '[data-equip="armour:legs_plated"]']) {
  const el = await page.$(`#modal ${sel}`);
  if (el) { await el.click(); await page.waitForTimeout(900); }
}
await page.waitForTimeout(1200);
await page.screenshot({ path: 'qa5/02-armoured.png' });
console.log('  armoured');
const stats = await page.evaluate(() => {
  const S = window.KR.campaign;
  const c = S.roster.find((x) => x.isCommander);
  return { equip: c.equip, maxHp: c.maxHp };
});
console.log('  equipped:', JSON.stringify(stats));
writeFileSync('qa5/errors.txt', errors.join('\n') || 'none');
console.log(`\n=== ${errors.length} errors ===`);
errors.slice(0, 6).forEach((e) => console.log(e.slice(0, 200)));
await browser.close();
