// Pressed troops in their faction kit: the roster badges, and the mixed-
// uniform squad on the field under amber rings.
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
// Press one Trust regular and one Syndic muster into the company.
await page.evaluate(async () => {
  const { State } = window.KR.dev;
  const Roster = await import('/src/roster.js');
  const { rng } = await import('/src/util.js');
  const S = window.KR.campaign;
  const r = rng(41);
  for (const [id, fac] of [['cap_t', 'trust'], ['cap_s', 'syndic']]) {
    const c = Roster.makeSoldier(r, { role: 'rifleman', rank: 1 });
    c.captiveFaction = fac;
    c.id = id;
    S.prisoners.push(c);
    State.pressPrisoner(S, id);
  }
  // Put the pressed pair right behind the commander in deploy order.
  const roster = S.roster;
  const t = roster.findIndex((x) => x.id === 'cap_t');
  roster.splice(1, 0, roster.splice(t, 1)[0]);
  const sy = roster.findIndex((x) => x.id === 'cap_s');
  roster.splice(2, 0, roster.splice(sy, 1)[0]);
});
// The roster card with lineage badges.
await page.evaluate(() => {
  const { UI } = window.KR.dev;
  const S = window.KR.campaign;
  UI.rosterPanel(S, { onClose: () => {} });
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'qa-shots/lin-1-roster.png' });
console.log('  lin-1-roster');
await page.evaluate(() => window.KR.dev.UI.closeModal());
// On the field: the pressed pair in their trainers' kit, your rings under them.
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
      party: { id: 'l', kind: 'scrappers', name: 'L', strength: 5, tier: 2, quality: 0.6 } },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
    onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  // Line abreast so the mixed kit reads in one frame.
  m.issueOrder('line');
  for (const e of m.entities) {
    if (e.side === 'enemy') { e.x = 200; e.z = 200; e.state = 'guard'; e.alert = 0; }
  }
});
await page.waitForTimeout(2600);
await page.evaluate(() => {
  const m = window.KR.mission;
  const p = m.player;
  m.toggleTactical();
  m.rtsZoom = 23; m.rtsZoomT = 23;
  const cx = (m.squad.reduce((a, s) => a + s.x, p.x)) / (m.squad.length + 1);
  const cz = (m.squad.reduce((a, s) => a + s.z, p.z)) / (m.squad.length + 1);
  m.rtsFocus = { x: cx, z: cz };
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'qa-shots/lin-2-field.png' });
console.log('  lin-2-field');
console.log('errors: ' + errors.length);
await browser.close();
// (appended) reframe: the line from the front, uniforms legible.
