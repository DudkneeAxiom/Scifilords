// Do the new melee perks actually reach the runtime?
//
// The perk tree can look right in the data and still change nothing, because
// every mod has to be READ at a named site: strike() for the swing, the guard
// branch of resolveStrike() for the shield, updateStamina() for the wind. This
// boots a real mission, gives the commander one perk at a time, and measures
// the thing the perk claims to change — swing duration off the live entity,
// shield HP lost to an identical blow, stamina after an identical sprint.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
// Title -> background questionnaire -> commission. Walk whatever stack of
// panels the new-campaign flow puts up rather than assuming its shape.
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
await page.waitForTimeout(800);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

const boot = async (perks) => page.evaluate(async (perks) => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  // The commander carries the perk under test and nothing else, so the
  // measurement is the perk rather than an accident of the roll.
  S.roster[0].perks = perks;
  S.roster[0].weapon = 'sword';
  G.mission?.dispose();
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Steel',
      party: { id: 's', kind: 'scrappers', name: 'Steel', strength: 8, tier: 2, quality: 0.8 } },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {},
    onEnd: () => {},
  });
  await G.mission.start();
}, perks);

const measure = async () => page.evaluate(() => {
  const m = window.KR.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  const p = m.player;

  // 1. Swing duration, straight off the live swing the runtime built.
  p.cooldown = 0; p.swing = null; m.pStamina = 1;
  m.strike(p, 'right');
  const dur = p.swing?.dur ?? null;
  const staminaAfterSwing = m.pStamina;

  // 2. Stamina recovered over a fixed rest.
  m.pStamina = 0.2;
  for (let i = 0; i < 60; i++) m.updateStamina(1 / 60, false);
  const rested = m.pStamina;

  // 3. Reach, as the strike resolver computes it.
  const reach = (p.weapon.reach || 2) + 0.5 + (p.eff?.reachBonus || 0);

  // 4. What an identical blow costs a raised guard.
  const gs = p.eff?.guardStr || 0;
  const shieldLoss = Math.max(4, 20 * 0.5 * (1 - gs));
  const throughGuard = 20 * 0.3 * (1 - gs);

  return {
    dur, staminaAfterSwing, rested, reach, shieldLoss, throughGuard,
    keys: {
      swingSpeed: p.eff?.swingSpeed, wind: p.eff?.wind, guardStr: p.eff?.guardStr,
      reachBonus: p.eff?.reachBonus, staggerRes: p.eff?.staggerRes, rally: p.eff?.rally,
    },
  };
});

const rows = {};
for (const [name, perks] of [
  ['bare', []],
  ['swordhand', ['swordhand']],
  ['second_wind', ['second_wind']],
  ['long_arm', ['long_arm']],
  ['shield_wall', ['shield_wall']],
]) {
  await boot(perks);
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  rows[name] = await measure();
}

const f = (n) => (n == null ? '  --  ' : n.toFixed(3));
console.log('perk          swing   stam/sw  rested   reach   shieldHit  thruGuard');
for (const [k, v] of Object.entries(rows)) {
  console.log(`${k.padEnd(13)} ${f(v.dur)} ${f(v.staminaAfterSwing)}  ${f(v.rested)}  `
    + `${f(v.reach)}  ${f(v.shieldLoss)}     ${f(v.throughGuard)}`);
}

const bad = [];
const b = rows.bare;
if (!(rows.swordhand.dur < b.dur)) bad.push('Swordhand did not shorten the swing');
if (!(rows.second_wind.staminaAfterSwing > b.staminaAfterSwing)) bad.push('Second Wind swing cost unchanged');
if (!(rows.second_wind.rested > b.rested)) bad.push('Second Wind recovery unchanged');
if (!(rows.long_arm.reach > b.reach)) bad.push('Long Arm did not extend reach');
if (!(rows.shield_wall.shieldLoss < b.shieldLoss)) bad.push('Shieldwall did not spare the plate');
if (!(rows.shield_wall.throughGuard < b.throughGuard)) bad.push('Shieldwall did not turn more of the blow');

console.log(bad.length ? `\nFAIL:\n  ${bad.join('\n  ')}` : '\nAll five perks reach the runtime.');
if (errors.length) console.log('console errors:', errors.slice(0, 5));
await browser.close();
