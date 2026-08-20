// Kill the last man and see what happens.
//
// Two claims: a field with nobody left on it ends without walking back
// across it, and what came off the field is put in front of the player to
// keep or leave rather than banked behind their back.
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
await page.evaluate(async () => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
  const { LOCATIONS } = await import('/src/data.js');
  const S = window.KR.campaign;
  const here = LOCATIONS.find((l) => l.id === 'grellan') || LOCATIONS[0];
  S.contracts.forEach((c) => { c.accepted = false; });
  S.contracts.push({ id: 'sw_1', type: 'skirmish', site: here.id, employer: 'syndic',
    title: 'Spoils', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
  S.pos.x = here.x; S.pos.z = here.z;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
await page.waitForFunction(() => window.KR.mission && !window.KR.mission.intro?.active
  && !window.KR.mission.inserting, null, { timeout: 60000 });
await page.evaluate(() => { const m = window.KR.mission; m.paused = false; m.hadLock = true; });
await page.waitForTimeout(1200);

const before = await page.evaluate(() => {
  const m = window.KR.mission;
  return { far: Math.hypot(m.player.x - m.level.extraction.x, m.player.z - m.level.extraction.z),
    credits: window.KR.campaign.credits };
});
// Kill the field, and leave the commander exactly where they are standing.
const killed = await page.evaluate(() => {
  const m = window.KR.mission;
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  // Put something on the truck to decide about.
  m.loot.armoury.spear = (m.loot.armoury.spear || 0) + 2;
  m.loot.kitPool.medkit = (m.loot.kitPool.medkit || 0) + 1;
  for (const e of foes) { e.hp = 0; e.dead = true; }
  m.skirmishTotal = 0; m.skirmishCommitted = 0;
  m.checkRout?.();
  return foes.length;
});
console.log(`killed ${killed}; the commander is ${before.far.toFixed(0)}m from the old extraction point`);

// Wait for the mission to close ITSELF, without moving anybody.
const ended = await page.waitForFunction(() => window.KR.mission?.over || !window.KR.mission,
  null, { timeout: 15000 }).then(() => true).catch(() => false);
console.log(`the field ended on its own: ${ended ? 'YES' : 'NO — still waiting for a walk'}`);
await page.waitForTimeout(2200);
const report = await page.evaluate(() => {
  const m = document.querySelector('#modal');
  return { open: !!m && !m.classList.contains('hidden'),
    title: (m?.querySelector('.modal-title')?.textContent || '').trim() };
});
console.log(`report: "${report.title}"`);
await page.screenshot({ path: `${OUT}/s01-report.png` });

// Move past the after-action to the spoils decision.
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(1400);
const spoils = await page.evaluate(() => {
  const m = document.querySelector('#modal');
  const open = m && !m.classList.contains('hidden');
  return { open, title: (m?.querySelector('.modal-title')?.textContent || '').trim(),
    pieces: [...(m?.querySelectorAll('[data-spoil]') || [])].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
    armoury: JSON.stringify(window.KR.campaign.spoils?.armoury || {}),
    kits: JSON.stringify(window.KR.campaign.spoils?.kitPool || {}) };
});
console.log(`\nspoils screen: "${spoils.title}"  pieces offered: ${spoils.pieces.length}`);
for (const p of spoils.pieces) console.log(`   ${p}`);
console.log(`  before deciding — staged armoury ${spoils.armoury}  kitPool ${spoils.kits}`);
await page.screenshot({ path: `${OUT}/s02-spoils.png` });

// Leave one kind behind, keep the rest, and check the truck agrees.
const after = await page.evaluate(async () => {
  const first = document.querySelector('#modal [data-spoil]');
  const leftId = first?.dataset.spoil;
  first?.click();
  await new Promise((r) => setTimeout(r, 350));
  document.querySelector('#modal [data-x="close"]')?.click();
  await new Promise((r) => setTimeout(r, 900));
  return { leftId, armoury: JSON.stringify(window.KR.campaign.spoils?.armoury || {}),
    kits: JSON.stringify(window.KR.campaign.spoils?.kitPool || {}) };
});
console.log(`  left "${after.leftId}" behind -> staged armoury ${after.armoury}  kitPool ${after.kits}`);
console.log(`  the piece that was KEPT should have arrived in one of those two.`);
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
