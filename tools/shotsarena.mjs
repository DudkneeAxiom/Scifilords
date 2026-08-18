// Photograph the arena pit and the sealed fort curtain.
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

const bootMission = async (spec) => {
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
      squad: sp.type === 'pit' ? [S.roster[0]] : S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
      onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  }, spec);
  await page.waitForTimeout(1500);
};

// The arena, from the fighter's eye and from the stands.
await bootMission({ type: 'pit', site: 'draypits', layout: 'arena',
  siteName: 'Dray Pits', enemyFaction: 'raider', wager: 500 });
await shot('ar-01-pit-floor');
await page.evaluate(() => {
  const m = window.KR.mission;
  cancelAnimationFrame(m.raf);
  m.camera.position.set(30, 26, 34);
  m.camera.lookAt(0, 2, 0);
  m.renderer.render(m.scene, m.camera);
});
await page.waitForTimeout(300);
await shot('ar-02-pit-bowl');

// The fort: whole curtain from above — no way around.
await bootMission({ type: 'siege', site: 'fort', layout: 'fort',
  siteName: 'The Gate', enemyFaction: 'syndic' });
await page.evaluate(() => {
  const m = window.KR.mission;
  cancelAnimationFrame(m.raf);
  // The staged altitude sits inside the gameplay fog — push it out for the
  // photograph or the frame is a grey card.
  if (m.scene.fog) { m.scene.fog.far = 1600; m.scene.fog.near = 400; }
  m.camera.position.set(0, 210, 150);
  m.camera.lookAt(0, 0, -20);
  m.renderer.render(m.scene, m.camera);
});
await page.waitForTimeout(300);
await shot('ar-03-fort-sealed');

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  ' + e);
await browser.close();
