// Photograph the M&B rounds: the Pit's wager door, and a summons siege with
// the liege's column on the field.
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
await page.waitForTimeout(400);

// --- The Pit's wager door, with every stake affordable ---------------------
await page.evaluate(async () => {
  const DATA = await import('/src/data.js');
  const S = window.KR.campaign;
  S.credits = 2400;
  const loc = DATA.LOCATIONS.find((l) => l.id === 'draypits');
  S.pos.x = loc.x; S.pos.z = loc.z;
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-verb="pit"]', { timeout: 15000 });
await page.click('#modal [data-verb="pit"]');
await page.waitForSelector('#modal [data-wager]', { timeout: 15000 });
await shot('mb-01-pit-wager');
await page.evaluate(() => window.KR.dev.UI.closeModal());
await page.waitForTimeout(400);

// --- A summons siege: the column's fighters on the approach ----------------
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
      enemyFaction: 'syndic', allies: 6, allyFaction: 'trust' },
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
await page.waitForTimeout(1800);
await shot('mb-02-siege-column-chase');

// Staged: the assault group massed on the approach, wall ahead.
await page.evaluate(() => {
  const m = window.KR.mission;
  cancelAnimationFrame(m.raf);
  const sp = m.level.playerSpawn;
  m.camera.position.set(sp.x + 10, 30, sp.z + 26);
  m.camera.lookAt(sp.x, 0, sp.z - 24);
  m.renderer.render(m.scene, m.camera);
});
await page.waitForTimeout(300);
await shot('mb-03-siege-column-massed');

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  ' + e);
await browser.close();
