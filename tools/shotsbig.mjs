// The raised cap in anger: an army field battle and a bastion assault, both
// with the biggest ranks the field has ever held.
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

const bootBattle = async (spec) => {
  await page.evaluate(async (sp) => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: sp,
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
      onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    for (const e of m.entities) {
      if (e.side === 'enemy' && !e.dead) {
        e.state = 'hunt'; e.alert = 1; e.lastSeen = { x: 0, z: 20 };
      }
    }
    m.issueOrder('charge');
    m.toggleTactical();
  }, spec);
};

// A 200 v 160 meeting engagement on THE APPROACHES.
await bootBattle({
  type: 'skirmish', site: 'field', layout: 'field', siteName: 'The Approaches',
  party: { id: 'big', kind: 'warband_syndic', name: 'Syndic Host', strength: 200,
    tier: 4, quality: 0.9 },
  allies: 160, allyFaction: 'trust',
});
await page.evaluate(() => {
  const m = window.KR.mission;
  m.rtsZoom = 56; m.rtsZoomT = 56;
  m.rtsFocus = { x: 0, z: 10 };
});
await page.waitForTimeout(8000);
await page.evaluate(() => {
  const m = window.KR.mission;
  const alive = m.entities.filter((e) => !e.dead).length;
  const div = document.createElement('div');
  div.id = 'shotnote';
  div.style.cssText = 'position:fixed;left:16px;bottom:110px;z-index:60;'
    + 'font:12px monospace;color:#c9c3b2;background:rgba(10,10,8,0.82);'
    + 'padding:8px 12px;border:1px solid #4a463a;letter-spacing:0.06em;line-height:1.6';
  div.innerHTML = `on field now: ${alive} combatants (cap was 34, now 48 per side)<br>`
    + `draw calls: ${m.renderer.info.render.calls}`;
  document.body.appendChild(div);
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'qa-shots/big-1-meeting.png' });
console.log('  big-1-meeting');
// Into the thick of it.
await page.evaluate(() => {
  const m = window.KR.mission;
  document.getElementById('shotnote')?.remove();
  m.rtsZoomT = 30;
  if (m.lastCombat) m.rtsFocus = { x: m.lastCombat.x, z: m.lastCombat.z };
});
await page.waitForTimeout(2400);
await page.screenshot({ path: 'qa-shots/big-2-melee.png' });
console.log('  big-2-melee');

// The bastion assault with full ranks at the wall.
await bootBattle({
  type: 'siege', site: 'bastion', layout: 'bastion', siteName: 'The Bastion',
  enemyFaction: 'syndic', allies: 200, allyFaction: 'trust', enemyArmy: 170,
});
await page.evaluate(() => {
  const m = window.KR.mission;
  m.rtsZoom = 46; m.rtsZoomT = 46;
  m.rtsFocus = { x: 0, z: -2 };
});
await page.waitForTimeout(9000);
await page.screenshot({ path: 'qa-shots/big-3-wall.png' });
console.log('  big-3-wall');
console.log('errors: ' + errors.length);
await browser.close();
