// Defenders ordered ONTO the wall walk, holding it above the parapet while
// the assault comes up the lanes.
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
    spec: { type: 'defense', defend: true, site: 'bastion', layout: 'bastion',
      siteName: 'The Bastion', enemyFaction: 'syndic',
      enemyArmy: 120, allies: 90, allyFaction: 'trust' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
    onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  m.gateBlowAt = 9999;                       // hold the gate for the photo
  // Everyone commanded onto the wall walk, spread along the defended face.
  const alive = m.squad.filter((s) => !s.dead);
  alive.forEach((s, i) => {
    s.order = 'move';
    s.orderPoint = { x: -30 + (i % 12) * 5.5, z: -12.2 };
  });
  m.playerAuto = { x: -13, z: -12.2 };
  m.playerSelected = true;
  m.toggleTactical();
  m.rtsZoom = 30; m.rtsZoomT = 30;
  m.rtsFocus = { x: -4, z: -10 };
});
await page.waitForTimeout(14000);
await page.screenshot({ path: 'qa-shots/wall-1-manned.png' });
console.log('  wall-1-manned');
// The shoulder view from the walk: what a defender actually sees.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.toggleTactical();
  m.camYaw = Math.PI;   // camera behind the body, body faces the approach
  m.camPitch = 0.12;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'qa-shots/wall-2-parapet-view.png' });
console.log('  wall-2-parapet-view');
console.log('errors: ' + errors.length);
await browser.close();
