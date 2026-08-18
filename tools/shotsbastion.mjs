// THE BASTION at army scale, from the tactical camera: the whole siege in
// one frame, the assault forming in the lanes, and the streets behind the
// wall after the eye jumps inside.
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
    spec: { type: 'siege', site: 'bastion', layout: 'bastion', siteName: 'The Bastion',
      enemyFaction: 'syndic', allies: 160, allyFaction: 'trust', enemyArmy: 150 },
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
  m.rtsZoom = 74; m.rtsZoomT = 74;
  m.rtsFocus = { x: 0, z: 6 };
});
await page.waitForTimeout(2400);
await page.screenshot({ path: 'qa-shots/bastion-1-whole-siege.png' });
console.log('  bastion-1-whole-siege');
// The assault forming in the lanes, mid zoom at a staging post.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.rtsZoomT = 34;
  m.rtsFocus = { x: -24, z: 34 };
});
await page.waitForTimeout(2200);
await page.screenshot({ path: 'qa-shots/bastion-2-staging.png' });
console.log('  bastion-2-staging');
// Behind the wall: the streets and the keep.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.rtsZoomT = 44;
  m.rtsFocus = { x: 0, z: -44 };
});
await page.waitForTimeout(2200);
await page.screenshot({ path: 'qa-shots/bastion-3-inside.png' });
console.log('  bastion-3-inside');
console.log('errors: ' + errors.length);
await browser.close();
