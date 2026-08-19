// Look at a battle.
//
// The combat work this round has all been measured through the simulation —
// swing directions, guard poses, camera springs — and never once looked at.
// The HUD is where a player reads the fight: the guard rose that says which
// way to block, the lock indicator, the order strip, the tactical view. This
// photographs each of them in a real engagement.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import fs from 'node:fs';

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

// Post a contract at a real site, stand on it, and take the deployment
// panel's own GO button — the whole entry path, not a shortcut past it.
await page.evaluate(async () => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
  const { LOCATIONS } = await import('/src/data.js');
  const S = window.KR.campaign;
  const here = LOCATIONS.find((l) => l.id === 'grellan') || LOCATIONS[0];
  S.contracts.forEach((c) => { c.accepted = false; });
  S.contracts.push({ id: 'eye_1', type: 'skirmish', site: here.id, employer: 'syndic',
    title: 'Look at it', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
  S.pos.x = here.x; S.pos.z = here.z;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
await page.waitForFunction(
  () => window.KR.mission && !window.KR.mission.intro?.active && !window.KR.mission.inserting,
  null, { timeout: 60000 });
await page.evaluate(() => { const m = window.KR.mission; m.paused = false; m.hadLock = true; });
await page.waitForTimeout(2500);
let n = 0;
const shot = async (name, ms = 700) => {
  await page.waitForTimeout(ms);
  const f = `${OUT}/b${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: f });
  console.log('  ' + f);
};
await shot('opening');

// Close to contact, so the guard rose and the melee read have something
// to say — a rose with nothing incoming is a picture of an idle UI.
await page.evaluate(() => {
  const m = window.KR.mission;
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  foes.slice(0, 6).forEach((e, i) => {
    e.x = m.player.x + Math.cos(i) * 3.2; e.z = m.player.z + Math.sin(i) * 3.2;
  });
  m.lockOn = foes[0] || null;
});
await shot('contact-and-rose', 1600);

// The tactical eye.
await page.evaluate(() => window.KR.mission.toggleTactical?.());
await shot('tactical', 1600);
await page.evaluate(() => window.KR.mission.toggleTactical?.());
await shot('back-to-field', 1200);

const geo = await page.evaluate(() => {
  const c = document.querySelector('#viewport canvas');
  const b = c ? c.getBoundingClientRect() : null;
  return { canvas: b ? `${b.width.toFixed(0)}x${b.height.toFixed(0)} at ${b.x.toFixed(0)},${b.y.toFixed(0)}` : 'NO CANVAS',
    win: `${innerWidth}x${innerHeight}`,
    framed: document.getElementById('viewport').classList.contains('world-framed') };
});
console.log(`
canvas ${geo.canvas}  window ${geo.win}  still-framed=${geo.framed}`);

const hud = await page.evaluate(() => {
  const ids = ['guard-rose', 'lock-hud', 'orders', 'mission-hud', 'objective', 'squadbar'];
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = 'MISSING'; continue; }
    const b = el.getBoundingClientRect();
    const vis = getComputedStyle(el).display !== 'none' && b.width > 1;
    out[id] = vis ? `${b.width.toFixed(0)}x${b.height.toFixed(0)} at ${b.x.toFixed(0)},${b.y.toFixed(0)}` : 'hidden';
  }
  return out;
});
console.log('\nHUD elements:');
for (const [k, v] of Object.entries(hud)) console.log(`  ${k.padEnd(14)} ${v}`);
fs.writeFileSync(`${OUT}/battle-errors.txt`, [...new Set(errors)].join('\n') || 'none');
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 5).join('\n') : '\nno console errors');
await browser.close();
