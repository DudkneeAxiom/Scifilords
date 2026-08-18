// Photograph the tactical camera: the board, a selection box, an order marker.
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
    spec: { type: 'skirmish', site: 'works', layout: 'works', siteName: 'The Works',
      party: { id: 's', kind: 'scrappers', name: 'S', strength: 10, tier: 2, quality: 0.6 },
      allies: 6, allyFaction: 'trust' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
    onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
});
await page.waitForTimeout(1400);
// Into tactical, with a selection box mid-drag.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.toggleTactical();
  m.updateTacticalCamera(1 / 60);
  m.rtsDrag = { x0: 480, y0: 300, x1: 950, y1: 640 };
  m.rtsDrawBox();
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'qa-shots/rts-01-select.png' });
console.log('  rts-01-select');
// Finish the selection, order the lot across the field: marker + movement.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.rtsFinishSelect();
  const p = m.player;
  const sp = m.worldToScreen(p.x + 16, p.z - 14);
  if (sp) m.rtsOrderAt(sp.x, sp.y);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: 'qa-shots/rts-02-ordered.png' });
console.log('  rts-02-ordered');
console.log('errors: ' + errors.length);
await browser.close();
