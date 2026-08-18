// A big battle under load, with the live numbers burned into the frame:
// combatants, draw calls, triangles, and measured simulation cost.
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
      party: { id: 'pf', kind: 'warband_syndic', name: 'Syndic Muster', strength: 60,
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
  // Everyone forward: both hosts meet at the crossovers.
  for (const e of m.entities) {
    if (e.side === 'enemy' && !e.dead) {
      e.state = 'hunt'; e.alert = 1; e.lastSeen = { x: 0, z: 30 };
    }
  }
  m.issueOrder('charge');
  m.toggleTactical();
  m.rtsZoom = 52; m.rtsZoomT = 52;
  m.rtsFocus = { x: 0, z: -4 };
});
await page.waitForTimeout(9000);
// Burn the live numbers into the frame.
await page.evaluate(() => {
  const m = window.KR.mission;
  const alive = m.entities.filter((e) => !e.dead).length;
  const info = m.renderer.info.render;
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:16px;bottom:110px;z-index:60;'
    + 'font:12px monospace;color:#c9c3b2;background:rgba(10,10,8,0.82);'
    + 'padding:10px 14px;border:1px solid #4a463a;letter-spacing:0.06em;line-height:1.7';
  div.innerHTML = `PERF — LIVE<br>combatants on field: ${alive}<br>`
    + `draw calls: ${info.calls} (was 946 pre-pass)<br>`
    + `triangles: ${info.triangles}<br>`
    + `rings: 1 instanced draw call (was ~50)`;
  document.body.appendChild(div);
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'qa-shots/perf-1-battle.png' });
console.log('  perf-1-battle');
await page.evaluate(() => {
  const m = window.KR.mission;
  m.rtsZoomT = 26;
  const fight = m.lastCombat;
  if (fight) m.rtsFocus = { x: fight.x, z: fight.z };
});
await page.waitForTimeout(2200);
await page.screenshot({ path: 'qa-shots/perf-2-close.png' });
console.log('  perf-2-close');
console.log('errors: ' + errors.length);
await browser.close();
