// Does the lock actually hold the man?
//
// Four claims, each measured in a live fight rather than eyeballed: the
// camera keeps him framed while he moves, the body stays turned to him, A/D
// circle him instead of steering off, and the lock drops when he does.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]')
      || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (d) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(500);

const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Lock',
      party: { id: 'lk', kind: 'looters', name: 'Lock', strength: 5, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 2),
    container: document.getElementById('viewport'),
    onHud: (hh) => UI.renderMissionHud(hh),
    onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  const realStep = m.step.bind(m);
  m.step = () => {};

  const p = m.player;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  const others = m.entities.filter((e) => e.side === 'enemy' && e !== foe);
  for (const o of others) { o.x = 500; o.z = 500; }
  p.hp = p.maxHp = 1e6; foe.hp = foe.maxHp = 1e6;
  foe.x = p.x + 5; foe.z = p.z;
  m.camYaw = Math.atan2(foe.x - p.x, foe.z - p.z) + Math.PI;

  // 1) ACQUIRE
  m.toggleLock();
  const acquired = !!m.lockOn;

  // 2) HE MOVES — does the camera hold him and the body stay turned to him?
  let worstFrame = 0, worstBody = 0;
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * Math.PI * 1.6;
    foe.x = p.x + Math.cos(a) * 5;
    foe.z = p.z + Math.sin(a) * 5;
    realStep(1 / 60); m.updateCamera(1 / 60);
    const bearing = Math.atan2(foe.x - p.x, foe.z - p.z);
    const dAng = (x) => Math.abs(Math.atan2(Math.sin(x), Math.cos(x)));
    // Ignore the first second: the body has to TURN to him once, and
    // counting that initial swing as tracking error measures the snap
    // rather than the hold.
    if (i > 60) {
      worstFrame = Math.max(worstFrame, dAng(m.camYaw + Math.PI - bearing));
      worstBody = Math.max(worstBody, dAng(p.yaw - bearing));
    }
  }

  // 3) FOOTWORK — 'd' must circle him, not walk off into the field.
  foe.x = p.x + 4; foe.z = p.z;
  for (let i = 0; i < 30; i++) realStep(1 / 60); m.updateCamera(1 / 60);
  const d0 = Math.hypot(foe.x - p.x, foe.z - p.z);
  const a0 = Math.atan2(p.x - foe.x, p.z - foe.z);
  m.keys.add('d');
  for (let i = 0; i < 60; i++) realStep(1 / 60); m.updateCamera(1 / 60);
  m.keys.delete('d');
  const d1 = Math.hypot(foe.x - p.x, foe.z - p.z);
  const a1 = Math.atan2(p.x - foe.x, p.z - foe.z);
  const swept = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));

  // 4) HE DIES — the lock lets go.
  foe.dead = true;
  realStep(1 / 60); m.updateCamera(1 / 60);
  const droppedOnDeath = !m.lockOn;

  const diag = { playerAuto: !!m.playerAuto, aiming: !!m.aiming, locked: !!m.lockOn };
  return {
    diag,
    acquired,
    worstFrame: +worstFrame.toFixed(2), worstBody: +worstBody.toFixed(2),
    d0: +d0.toFixed(2), d1: +d1.toFixed(2), swept: +swept.toFixed(2),
    droppedOnDeath,
  };
});

console.log('\nacquired            :', r.acquired);
console.log('worst camera error  :', r.worstFrame, 'rad  (he circled 290 degrees)');
console.log('worst body error    :', r.worstBody, 'rad');
console.log(`sidestep            : range ${r.d0}m -> ${r.d1}m, swept ${r.swept} rad round him`);
console.log('dropped on his death:', r.droppedOnDeath);
const bad = [];
if (!r.acquired) bad.push('nothing was locked');
if (r.worstFrame > 0.8) bad.push('the camera lost him while he moved');
if (r.worstBody > 0.6) bad.push('the body stopped facing him');
if (r.swept < 0.25) bad.push('sidestep did not circle him');
if (Math.abs(r.d1 - r.d0) > 1.6) bad.push('sidestep changed the range instead of circling');
if (!r.droppedOnDeath) bad.push('the lock held onto a dead man');
console.log(bad.length ? `\nFAIL:\n  ${bad.join('\n  ')}` : '\nThe lock holds.');
await browser.close();
