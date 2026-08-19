// Can a soldier still swing for ever?
//
// "Players and AI can just spam" is a measurable claim: count the blows one
// body throws over a fixed stretch of a real fight, and see whether the arm
// ever has to stop. A duel that never pauses has no openings in it, and a
// fight with no openings is two people mashing.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
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
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Spam',
      party: { id: 'sp', kind: 'looters', name: 'Spam', strength: 4, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 2),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  const realStep = m.step.bind(m);
  m.step = () => {};

  const p = m.player;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  // A duel that cannot end: both immortal, so this measures CADENCE and not
  // who won.
  p.hp = p.maxHp = 1e6; foe.hp = foe.maxHp = 1e6;
  foe.x = p.x + 1.6; foe.z = p.z;
  foe.yaw = Math.atan2(p.x - foe.x, p.z - foe.z);
  p.yaw = Math.atan2(foe.x - p.x, foe.z - p.z);

  // 1) The AI, left to itself for thirty seconds.
  let foeSwings = 0, foeIdleTicks = 0;
  let lastSwing = null;
  const TICKS = 30 * 60;
  for (let i = 0; i < TICKS; i++) {
    realStep(1 / 60);
    if (foe.swing && foe.swing !== lastSwing) { foeSwings++; lastSwing = foe.swing; }
    if (!foe.swing && foe.cooldown <= 0) foeIdleTicks++;
    foe.x = p.x + 1.6; foe.z = p.z;      // hold the distance
  }
  const foeWindLow = foe.wind;

  // 2) The player mashing the button as fast as it can be pressed.
  let mine = 0;
  for (let i = 0; i < TICKS; i++) {
    p.cooldown = Math.min(p.cooldown, 99);
    if (!p.swing && p.cooldown <= 0) { const before = p.swing; m.strike(p, 'right'); if (p.swing !== before) mine++; }
    realStep(1 / 60);
  }
  return {
    seconds: TICKS / 60, foeSwings, foeIdleTicks, foeWindLow: +(foeWindLow ?? -1).toFixed(2),
    mine, staminaEnd: +m.pStamina.toFixed(2),
  };
});

console.log(`\nover ${r.seconds}s of a duel that cannot end:`);
console.log(`  AI blows thrown   : ${r.foeSwings}  (${(r.foeSwings / r.seconds).toFixed(2)}/s)`);
console.log(`  AI ticks blown    : ${r.foeIdleTicks} (${(r.foeIdleTicks / 60).toFixed(1)}s spent getting breath back)`);
console.log(`  AI wind at the end: ${r.foeWindLow}`);
console.log(`  player blows      : ${r.mine}  (${(r.mine / r.seconds).toFixed(2)}/s), stamina ${r.staminaEnd}`);
const bad = [];
if (r.foeIdleTicks < 60) bad.push('the AI never had to stop for breath');
if (r.foeSwings / r.seconds > 1.4) bad.push('the AI is still throwing blows faster than once a second');
console.log(bad.length ? `\nFAIL:\n  ${bad.join('\n  ')}` : '\nBoth sides have to breathe.');
await browser.close();
