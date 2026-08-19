// Does one press do one thing?
//
// The control scheme is inherited from a third-person shooter and every
// round has turned up another verb that no longer fits. This checks the two
// claims that matter after the command audit: middle mouse taps to lock and
// holds for orders, and no key issues two orders at once.
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
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Ctl',
      party: { id: 'ct', kind: 'looters', name: 'Ctl', strength: 6, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 6),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  m.step = () => {};
  for (const e of m.entities) e.inserting = false;

  const p = m.player;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  foe.x = p.x + 5; foe.z = p.z;
  m.camYaw = Math.atan2(foe.x - p.x, foe.z - p.z) + Math.PI;

  // Every order the player can name, and the verbs behind them.
  const orders = m.ORDERS.map((o) => ({ id: o.id, name: o.name, key: o.key, desc: o.desc }));
  const GUN = /\b(fire|gun|burst|shoot|rifle|ammo|magazine|reload|suppress)\w*\b/i;
  const gunWords = orders.filter((o) => GUN.test(o.desc) || GUN.test(o.name))
    .map((o) => `${o.name}: ${o.desc}`);

  // No key may name two different orders.
  const keyed = orders.filter((o) => o.key);
  const dupes = keyed.filter((o, i) => keyed.findIndex((q) => q.key === o.key) !== i)
    .map((o) => o.key);

  return { orders, gunWords, dupes, hasSuppress: orders.some((o) => o.id === 'suppress') };
});

console.log('\nORDERS');
for (const o of r.orders) console.log(`  ${(o.key || '-').padEnd(3)} ${o.name}`);
console.log('\nSUPPRESS still offered :', r.hasSuppress);
console.log('duplicate order keys   :', r.dupes.length ? r.dupes.join(', ') : 'none');
console.log('gun language in orders :', r.gunWords.length ? r.gunWords.join(' | ') : 'none');

// And the mouse: tap locks, hold opens the wheel.
await page.evaluate(() => {
  const m = window.KR.mission;
  const el = window.KR.mission.renderer.domElement;
  window.__el = el;
  // Pointer lock is not grantable headlessly; the handler checks it first.
  Object.defineProperty(document, 'pointerLockElement', { value: el, configurable: true });
});
const mmb = async (holdMs) => page.evaluate(async (ms) => {
  const el = window.KR.mission.renderer.domElement;
  const ev = (t) => el.dispatchEvent(new MouseEvent(t, { button: 1, bubbles: true }));
  ev('mousedown');
  await new Promise((r) => setTimeout(r, ms));
  window.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const m = window.KR.mission;
  return { locked: !!m.lockOn, wheel: !!m.wheel?.open, sawPress: m.mmbAt !== undefined, cand: !!m.acquireLock() };
}, holdMs);

const afterTap = await mmb(60);
await page.evaluate(() => { window.KR.mission.lockOn = null; window.KR.mission.closeWheel(false); });
const duringHold = await page.evaluate(async () => {
  const el = window.KR.mission.renderer.domElement;
  el.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));
  const open = !!window.KR.mission.wheel?.open;
  window.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }));
  return { wheel: open };
});

console.log('\nmiddle-mouse TAP  -> locked:', afterTap.locked, ' wheel:', afterTap.wheel);
console.log('middle-mouse HOLD -> wheel :', duringHold.wheel);

const bad = [];
if (r.hasSuppress) bad.push('SUPPRESS is still an order');
if (r.dupes.length) bad.push('two orders share a key: ' + r.dupes.join(','));
if (r.gunWords.length) bad.push('orders still described in gun language');
if (!afterTap.locked) bad.push('a middle-mouse tap did not lock on');
if (afterTap.wheel) bad.push('a tap opened the order wheel');
if (!duringHold.wheel) bad.push('holding middle mouse did not open the wheel');
console.log(bad.length ? `\nFAIL:\n  ${bad.join('\n  ')}` : '\nOne press, one thing.');
await browser.close();
