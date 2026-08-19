// Can you feel the thing in your hands?
//
// Impact used to be one scalar that jittered the view identically whatever
// caused it. Weight is not noise: it has a DIRECTION and a MASS. This
// measures both — how far the eye is driven and which way — for a blade and
// for a maul, landing, being blocked, and hitting nothing at all.
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
  const { WEAPONS } = await import('/src/data.js');
  const UI = await import('/src/ui.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Weight',
      party: { id: 'wt', kind: 'looters', name: 'Weight', strength: 6, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  for (const e of m.entities) e.inserting = false;
  const realStep = m.step.bind(m);
  m.step = () => {};

  const p = m.player;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  p.hp = p.maxHp = 1e6; foe.hp = foe.maxHp = 1e6;

  // Peak displacement of the eye, and which way it went first.
  const measure = (setup) => {
    m.camPush = { x: 0, y: 0, z: 0 };
    m.camPushV = { x: 0, y: 0, z: 0 };
    // And the RIG's reactions, which decay over seconds rather than frames —
    // without this each case inherited the last one's follow-through and two
    // different blows reported identical numbers.
    for (const e of [p, foe]) {
      if (e.char?.state) { e.char.state.jar = 0; e.char.state.carry = 0; }
    }
    p.swing = null; p.cooldown = 0; p.guard = 0; p.guardBreak = 0;
    foe.swing = null; foe.cooldown = 0; foe.guard = 0; foe.shieldHp = 0;
    foe.x = p.x + 1.5; foe.z = p.z;
    foe.yaw = Math.atan2(p.x - foe.x, p.z - foe.z);
    p.yaw = Math.atan2(foe.x - p.x, foe.z - p.z);
    setup();
    let peak = 0, at = null, bodyPeak = 0, bodyAt = null;
    for (let i = 0; i < 90; i++) {
      realStep(1 / 120);
      const q = m.camPush;
      const mag = Math.hypot(q.x, q.y, q.z);
      if (mag > peak) { peak = mag; at = { x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2) }; }
      const st = p.char?.state;
      const bm = st ? Math.abs(st.jar) + Math.abs(st.carry) : 0;
      if (bm > bodyPeak) { bodyPeak = bm; bodyAt = { jar: +st.jar.toFixed(2), carry: +st.carry.toFixed(2) }; }
    }
    return { peak: +peak.toFixed(2), at, body: +bodyPeak.toFixed(2), bodyAt };
  };

  const withWeapon = (id, fn) => { p.weapon = WEAPONS[id]; return fn(); };

  const out = {};
  // Landing a blow: blade against maul.
  out.bladeLand = withWeapon('sword', () => measure(() => {
    m.strike(p, 'right');
    for (let i = 0; i < 200 && p.swing && !p.swing.hitDone; i++) m.updateSwing(1 / 240, p);
  }));
  out.maulLand = withWeapon('heavy', () => measure(() => {
    m.strike(p, 'overhead');
    for (let i = 0; i < 400 && p.swing && !p.swing.hitDone; i++) m.updateSwing(1 / 240, p);
  }));
  // Catching one on the guard.
  out.blocked = withWeapon('sword', () => measure(() => {
    p.guard = 1; p.guardDir = 'overhead';
    foe.weapon = WEAPONS.heavy; foe.cooldown = 0;
    m.strike(foe, 'overhead');
    for (let i = 0; i < 400 && foe.swing && !foe.swing.hitDone; i++) m.updateSwing(1 / 240, foe);
  }));
  // A swing that finds nothing.
  out.whiff = withWeapon('heavy', () => measure(() => {
    foe.x = p.x + 40; foe.z = p.z + 40;
    m.strike(p, 'right');
    for (let i = 0; i < 400 && p.swing && !p.swing.hitDone; i++) m.updateSwing(1 / 240, p);
  }));
  // And locked, the same blow should carry further.
  out.lockedLand = withWeapon('sword', () => {
    foe.x = p.x + 1.5; foe.z = p.z;
    m.lockOn = foe;
    const v = measure(() => {
      m.lockOn = foe;
      m.strike(p, 'right');
      for (let i = 0; i < 200 && p.swing && !p.swing.hitDone; i++) m.updateSwing(1 / 240, p);
    });
    m.lockOn = null;
    return v;
  });
  return out;
});

const row = (k, v) => console.log(`  ${k.padEnd(12)} eye ${String(v.peak).padStart(6)} `
  + `${JSON.stringify(v.at)}`.padEnd(34)
  + ` body ${String(v.body).padStart(5)} ${JSON.stringify(v.bodyAt)}`);
console.log('\nTHE EYE, AND THE BODY');
for (const [k, v] of Object.entries(r)) row(k, v);

const bad = [];
if (!(r.bladeLand.peak > 0.05)) bad.push('landing a blade moved nothing');
if (!(r.maulLand.peak > r.bladeLand.peak)) bad.push('a maul lands no heavier than a blade');
if (!(r.blocked.peak > 0.05)) bad.push('catching a blow on the guard moved nothing');
if (!(r.blocked.at && r.blocked.at.z < 0)) bad.push('a blocked blow did not drive the eye back');
if (!(r.whiff.peak > 0.05)) bad.push('a swing through empty air had no follow-through');
if (!(r.lockedLand.peak > r.bladeLand.peak)) bad.push('locked on, the same blow carries no further');
if (!(r.bladeLand.body > 0)) bad.push('the body did not answer a landed blow');
if (!(r.blocked.body > 0)) bad.push('the body did not answer a blocked blow');
if (!(r.whiff.body > r.bladeLand.body)) bad.push('a miss follows through no further than a hit');
console.log(bad.length ? `\nFAIL:\n  ${bad.join('\n  ')}` : '\nThe steel has weight, and it has a direction.');
await browser.close();
