// THE APPROACHES from the tactical camera: overview and a held post.
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
  m.rtsZoom = 78; m.rtsZoomT = 78;
  m.rtsFocus = { x: 0, z: 6 };
});
await page.waitForTimeout(1600);
await page.screenshot({ path: 'qa-shots/field-1-overview.png' });
console.log('  field-1-overview');
// Pull in on a garrison post with the fight developing.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.rtsZoomT = 30;
  m.rtsFocus = { x: 32, z: 2 };
});
await page.waitForTimeout(2600);
await page.screenshot({ path: 'qa-shots/field-2-post.png' });
console.log('  field-2-post');
console.log('errors: ' + errors.length);
await browser.close();
