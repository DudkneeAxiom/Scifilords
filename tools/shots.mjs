// Look at every screen that changed.
//
// The acceptance suite proves behaviour; it cannot see a panel with white text
// on a white ground, a number running off the edge of its box, or a menu that
// is technically correct and unreadable. This walks the screens that this round
// of work touched and photographs each one.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-shots', { recursive: true });

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });

const shot = async (name) => {
  await page.screenshot({ path: `qa-shots/${name}.png` });
  console.log(`  ${name}`);
};

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });
await shot('01-title');

await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 20000 });
await shot('02-brief');
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 20000 });
await shot('03-commission');
await page.click('#modal [data-perk]');
await page.waitForTimeout(700);
await shot('04-board');
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});
await page.waitForTimeout(900);
await shot('05-world-map');

// Company screens, with the tab strip.
await page.keyboard.press('c');
await page.waitForSelector('#modal .mtabs', { timeout: 15000 });
await shot('06-roster-creeds');
await page.click('#modal [data-tab="inventory"]');
await page.waitForTimeout(400);
await shot('07-stores');
await page.click('#modal [data-tab="character"]');
await page.waitForTimeout(400);
await shot('08-equipment');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// A settlement: the verb menu, then the panels behind it.
await page.evaluate(async () => {
  const DATA = await import('/src/data.js');
  const S = window.KR.campaign;
  S.seed = 12345;
  S.credits = 24000;
  const loc = DATA.LOCATIONS.find((l) => ['market', 'recruit', 'medical', 'contracts']
    .every((s) => l.services?.includes(s)));
  S.pos.x = loc.x; S.pos.z = loc.z;
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal .sm-verbs', { timeout: 15000 });
await shot('09-settlement-menu');
const fav = await page.$('#modal [data-verb="favour"]');
if (fav) { await fav.click(); await page.waitForTimeout(400); await shot('10-favour');
  const back = await page.$('#modal [data-x="close"]'); if (back) await back.click();
  await page.waitForTimeout(300); }
await page.click('#modal [data-verb="recruit"]');
await page.waitForTimeout(500);
await shot('11-recruits');
await page.click('#modal [data-x="close"]');
await page.waitForTimeout(400);

// The broker, with people in the truck.
await page.evaluate(async () => {
  const Roster = await import('/src/roster.js');
  const { rng } = await import('/src/util.js');
  const S = window.KR.campaign;
  const r = rng(5);
  S.prisoners = [2, 1, 0].map((rank) => {
    const p = Roster.makeSoldier(r, { rank });
    p.captiveFaction = 'trust';
    return p;
  });
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-verb="broker"]', { timeout: 15000 });
await page.click('#modal [data-verb="broker"]');
await page.waitForTimeout(400);
await shot('12-broker');
await page.click('#modal [data-x="close"]');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// A road encounter with the new options.
await page.evaluate(() => {
  const S = window.KR.campaign;
  const p = S.parties.find((x) => x.hostileToPlayer) || S.parties[0];
  p.x = S.pos.x + 6; p.z = S.pos.z + 6;
  window.KR.dev.UI.encounterPanel(S, p, {
    onClose: () => {}, onAvoid: () => {}, onFight: () => {}, onAid: () => {},
    onTalk: () => {}, onSend: () => {}, onToll: () => {}, onInspect: () => {}, onRefuse: () => {},
  });
});
await page.waitForTimeout(500);
await shot('13-encounter');
await page.evaluate(() => window.KR.dev.UI.closeModal());
await page.waitForTimeout(300);

// The controls reference.
await page.evaluate(() => window.KR.dev.UI.controlsPanel({ onClose: () => {} }));
await page.waitForTimeout(400);
await shot('14-controls');
await page.evaluate(() => window.KR.dev.UI.closeModal());

// A deployment: the cinematic, then gameplay on the enlarged ground.
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
      enemyFaction: 'trust' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
    onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  G.mission.paused = false; G.mission.hadLock = true;
});
await page.waitForTimeout(1200);
await shot('15-insertion');

await page.evaluate(() => {
  const m = window.KR.mission;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
});
await page.waitForTimeout(1400);
await shot('16-deployment');

// In cover.
await page.evaluate(() => {
  const m = window.KR.mission;
  const cov = m.level.covers.find((o) => o.h > 0.7 && o.h < 1.6);
  m.player.x = cov.x; m.player.z = cov.z + cov.hd + 0.6;
  m.grounded = true;
  m.takeCover();
});
await page.waitForTimeout(900);
await shot('17-in-cover');

// Being shot at, from behind.
await page.evaluate(() => {
  const m = window.KR.mission;
  const foe = m.entities.find((e) => e.side === 'enemy');
  foe.x = m.player.x; foe.z = m.player.z - 18;
  foe.dead = false; foe.down = false;
  m.applyDamage(m.player, 12, foe, { x: m.player.x, y: 1.2, z: m.player.z });
});
await page.waitForTimeout(500);
await shot('18-under-fire');

// The order wheel.
await page.evaluate(() => { window.KR.mission.openWheel(); });
await page.waitForTimeout(600);
await shot('19-order-wheel');
await page.evaluate(() => { window.KR.mission.closeWheel(false); });

// The whole site from above, to judge the new scale.
await page.evaluate(() => {
  const m = window.KR.mission;
  // The loop re-renders with the chase camera every frame, so a staged shot
  // was silently overwritten before the screenshot — this frame has been
  // photographing the player's shoulder for as long as it has existed. Kill
  // the loop (it is the last shot; nothing needs it back) and render by hand.
  cancelAnimationFrame(m.raf);
  m.camera.position.set(0, 190, 130);
  m.camera.lookAt(0, 0, 0);
  m.renderer.render(m.scene, m.camera);
});
await page.waitForTimeout(400);
await shot('20-site-from-above');

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  ' + e);
await browser.close();
