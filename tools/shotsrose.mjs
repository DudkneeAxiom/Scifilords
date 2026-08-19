// The guard rose, on screen, mid-fight.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa', { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const done = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]')
      || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (done) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(600);

await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: G.campaign,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Rose',
      party: { id: 'rs', kind: 'looters', name: 'Rose', strength: 8, tier: 1, quality: 0.6 } },
    squad: G.campaign.roster.slice(0, 8),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h),
    onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  m.step = () => {};
  document.getElementById('overlay')?.classList.add('hidden');
});
await page.waitForTimeout(400);

const shot = async (name, setup) => {
  await page.evaluate(setup);
  await page.waitForTimeout(120);
  await page.evaluate(async () => {
    const UI = await import('/src/ui.js');
    UI.renderMissionHud(window.KR.mission.buildHud());
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `qa/rose-${name}.png`, clip: { x: 390, y: 250, width: 500, height: 340 } });
};

await shot('incoming', () => {
  const m = window.KR.mission, p = m.player;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  foe.x = p.x + 1.5; foe.z = p.z;
  foe.yaw = Math.atan2(p.x - foe.x, p.z - foe.z);
  p.yaw = Math.atan2(foe.x - p.x, foe.z - p.z);
  p.guard = 1; p.guardDir = 'left';
  foe.cooldown = 0; foe.swing = null;
  m.strike(foe, 'overhead');
});
await shot('met', () => {
  const m = window.KR.mission, p = m.player;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  p.guard = 1; p.guardDir = 'overhead';
  foe.cooldown = 0; foe.swing = null;
  m.strike(foe, 'overhead');
});
await shot('far', () => {
  const m = window.KR.mission, p = m.player;
  for (const e of m.entities) if (e.side === 'enemy') { e.x = p.x + 40; e.z = p.z + 40; e.swing = null; }
  p.guard = 1; p.guardDir = 'right';
});
// The guard POSE, on the body, from behind the shoulder: four lines, four
// visibly different sets of hands.
for (const d of ['overhead', 'thrust', 'left', 'right']) {
  await page.evaluate((dir) => {
    const m = window.KR.mission, p = m.player;
    for (const e of m.entities) if (e.side === 'enemy') { e.x = p.x + 60; e.z = p.z + 60; e.swing = null; }
    p.guard = 1; p.guardDir = dir; p.swing = null;
    // Drive the model straight so the guard blend is fully in.
    for (let i = 0; i < 90; i++) p.char.update(1 / 60, {
      melee: true, swing: 0, swingDir: 'right', guard: 1, guardDir: dir,
      hold: p.weapon.hold, guardPose: p.weapon.guard, moving: 0, speed: 0,
    });
  }, d);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `qa/guard-${d}.png`, clip: { x: 440, y: 200, width: 400, height: 420 } });
}
console.log('wrote qa/rose-*.png and qa/guard-*.png');
await browser.close();
