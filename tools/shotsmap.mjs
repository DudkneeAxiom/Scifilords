// The field map: whole ground on the radar panel in tactical mode, and the
// click that steers the eye. Full frames plus close crops of the map itself.
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
    spec: { type: 'skirmish', site: 'field', layout: 'field', siteName: 'The Approaches',
      party: { id: 'f', kind: 'warband_syndic', name: 'Syndic Muster', strength: 60,
        tier: 4, quality: 0.9 },
      allies: 50, allyFaction: 'trust' },
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
  m.rtsZoom = 40; m.rtsZoomT = 40;
});
await page.waitForTimeout(1800);
await page.screenshot({ path: 'qa-shots/map-1-fieldmap.png' });
console.log('  map-1-fieldmap');
const radarBox = await page.evaluate(() => {
  const r = document.getElementById('radar').getBoundingClientRect();
  return { x: r.left - 6, y: r.top - 6, width: r.width + 12, height: r.height + 30 };
});
await page.screenshot({ path: 'qa-shots/map-2-closeup.png', clip: radarBox });
console.log('  map-2-closeup');
// The click: jump the eye to the enemy compound at the north end.
await page.evaluate(() => {
  const m = window.KR.mission;
  const c = document.getElementById('radar');
  const R = c.width / 2;
  const scale = (R - 4) / m.level.bounds;
  m.rtsMapClick(R + 0 * scale, R + -62 * scale);
});
await page.waitForTimeout(900);
await page.screenshot({ path: 'qa-shots/map-3-clicked.png' });
console.log('  map-3-clicked');
await page.screenshot({ path: 'qa-shots/map-4-clicked-closeup.png', clip: radarBox });
console.log('  map-4-clicked-closeup');
console.log('errors: ' + errors.length);
await browser.close();
