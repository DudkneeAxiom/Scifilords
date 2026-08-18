// The commander routing AROUND buildings on the squad's nav grid, shown as a
// sequence of tactical frames with the camera held still.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-shots', { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 20000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 20000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(700);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.dev.UI.closeModal();
});
const staged = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'works', layout: 'works', siteName: 'The Works',
      party: { id: 'p', kind: 'scrappers', name: 'P', strength: 6, tier: 2, quality: 0.6 } },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
    onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  // Clean stage: hostiles parked far away, squad holding where they stand.
  for (const e of m.entities) {
    if (e.side === 'enemy') { e.x = 200; e.z = 200; e.state = 'guard'; e.alert = 0; }
  }
  for (const s of m.squad) { s.order = 'hold'; s.orderPoint = { x: s.x, z: s.z }; }
  m.toggleTactical();
  m.rtsZoom = 34;
  // A big block near the commander, and a destination on its FAR side.
  const p = m.player;
  const wall = m.level.obstacles
    .filter((o) => (o.coverH ?? o.h) > 2 && o.hw > 2.5
      && Math.hypot(o.x - p.x, o.z - p.z) > 8 && Math.hypot(o.x - p.x, o.z - p.z) < 34)
    .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  const dx = wall.x - p.x, dz = wall.z - p.z;
  const dd = Math.hypot(dx, dz) || 1;
  const raw = { x: wall.x + (dx / dd) * (wall.hw + 5), z: wall.z + (dz / dd) * (wall.hd + 5) };
  const safe = m.safeSpawn(raw.x, raw.z);
  // Frame the whole route: camera midway between commander and destination.
  m.rtsFocus = { x: (p.x + safe.x) / 2, z: (p.z + safe.z) / 2 };
  m.playerSelected = true;
  m.playerAuto = { x: safe.x, z: safe.z };
  m.showMarker(safe.x, safe.z, 30);
  return { from: { x: p.x, z: p.z }, to: safe, wall: { x: wall.x, z: wall.z, hw: wall.hw } };
});
console.log('staged', JSON.stringify(staged));
for (let i = 1; i <= 6; i++) {
  await page.screenshot({ path: `qa-shots/path-${i}.png` });
  await page.waitForTimeout(650);
}
console.log('6 frames, errors: ' + errors.length);
await browser.close();
