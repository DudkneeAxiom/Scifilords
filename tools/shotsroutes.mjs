// Route lines on the tactical board: several units ordered to different
// points, their remaining paths and destination flags drawn on the ground.
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
      party: { id: 'r', kind: 'scrappers', name: 'R', strength: 6, tier: 2, quality: 0.6 } },
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
    if (e.side === 'enemy') { e.x = 200; e.z = 200; e.state = 'guard'; e.alert = 0; }
  }
  m.toggleTactical();
  m.rtsZoom = 40;
  const p = m.player;
  // Fan the squad out to three separate points, and send the commander on a
  // route that must bend around the container block.
  const spots = [
    { x: p.x - 22, z: p.z - 18 }, { x: p.x + 4, z: p.z - 30 }, { x: p.x + 24, z: p.z - 12 },
  ];
  m.squad.filter((s) => !s.dead).forEach((s, i) => {
    const t = spots[i % spots.length];
    s.order = 'move';
    s.orderPoint = { x: t.x + (i % 2) * 3, z: t.z + (i % 2) * 2 };
  });
  m.playerSelected = true;
  m.playerAuto = { x: p.x + 30, z: p.z + 16 };
  m.selection.clear();   // no selection = every route on the board
});
await page.waitForTimeout(900);
await page.screenshot({ path: 'qa-shots/routes-1.png' });
console.log('  routes-1');
await page.waitForTimeout(1600);
await page.screenshot({ path: 'qa-shots/routes-2.png' });
console.log('  routes-2');
console.log('errors: ' + errors.length);
await browser.close();
