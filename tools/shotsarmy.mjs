// Photograph an army-scale siege: ranks on the field, the host on the ticker.
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
    spec: { type: 'siege', site: 'fort', layout: 'fort', siteName: 'The Gate',
      enemyFaction: 'syndic', allies: 180, allyFaction: 'trust', enemyArmy: 150 },
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
await page.waitForTimeout(2500);
await page.screenshot({ path: 'qa-shots/army-01-siege-ticker.png' });
console.log('  army-01-siege-ticker');
await page.evaluate(() => {
  const m = window.KR.mission;
  cancelAnimationFrame(m.raf);
  if (m.scene.fog) { m.scene.fog.far = 1600; m.scene.fog.near = 400; }
  m.camera.position.set(26, 42, 66);
  m.camera.lookAt(0, 0, -14);
  m.renderer.render(m.scene, m.camera);
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'qa-shots/army-02-siege-field.png' });
console.log('  army-02-siege-field');
console.log('errors: ' + errors.length);
await browser.close();
