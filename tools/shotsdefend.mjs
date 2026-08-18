// The commander returning fire on their own in the tactical view — staged
// tight: one hostile, close zoom, squad far out of frame.
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
await page.evaluate(async () => {
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
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Roadside',
      party: { id: 'd', kind: 'scrappers', name: 'D', strength: 8, tier: 2, quality: 0.6 } },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
    onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  m.toggleTactical();
  m.rtsZoom = 22;
  const p = m.player;
  // Squad ordered far away; every hostile but one parked at distance; the one
  // stands 9m from the commander in the open, already alert.
  for (const s of m.squad) { s.order = 'move'; s.orderPoint = { x: p.x - 50, z: p.z + 40 }; }
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  foes.forEach((f, i) => {
    if (i === 0) {
      f.x = p.x + 9; f.z = p.z - 2;
      f.state = 'hunt'; f.alert = 1; f.lastSeen = { x: p.x, z: p.z };
    } else {
      f.x = p.x + 90 + i * 4; f.z = p.z + 90;
    }
  });
});
await page.waitForTimeout(1500);
for (let i = 1; i <= 8; i++) {
  await page.screenshot({ path: `qa-shots/def-${i}.png` });
  await page.waitForTimeout(280);
}
console.log('8 frames, errors: ' + errors.length);
await browser.close();
