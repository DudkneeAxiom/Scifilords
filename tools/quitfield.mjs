// Does a beaten remnant actually leave?
//
// There is a safety net in updateEnemyCommander: a force that has been
// giving ground and has not been in contact for thirty seconds has quit —
// they break, and the field is called. It exists because of a measured
// failure (22 v 30 leaving three survivors standing in a field at ten
// minutes), and it is the guard against a battle that never ends. Nothing
// has ever exercised it, because in practice the remnant gets killed first.
//
// So: cut them to a remnant, keep our line pinned well away so contact
// cannot happen, and see whether they go and whether the field is called.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(700);
}
const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const { WEAPONS } = await import('/src/data.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = ''; UI.show('hud');
  const toasts = [];
  let ended = null;
  G.mission = new Mission({ campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Quit',
      party: { id: 'q', kind: 'scrappers', name: 'Foe', strength: 16, tier: 3, quality: 0.8 } },
    squad: S.roster.slice(0, 12), container: document.getElementById('viewport'),
    onHud: () => {}, onToast: (a, b) => toasts.push(b), onIntro: () => {},
    onWheel: () => {}, onEnd: (o) => { ended = o; } });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true; m.inserting = false;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  for (const e of m.entities) e.inserting = false;
  const realEnd = m.endMission.bind(m);
  let why = null;
  m.endMission = (ok, reason) => { why = why || reason; return realEnd(ok, reason); };
  const realStep = m.step.bind(m); m.step = () => {};

  const foes = () => m.entities.filter((e) => e.side === 'enemy' && !e.dead && !e.down);
  // A remnant: odds well under the 0.55 that picks 'withdraw'.
  for (const e of foes().slice(3)) { e.dead = true; e.hp = 0; }
  const ours = m.squad.filter((e) => !e.dead);
  for (const e of ours) e.weapon = WEAPONS.blade;

  // Our line, and the commander with it, pinned a long way off so that
  // contact genuinely cannot happen — that is the condition the rule is for.
  const anchor = ours.map((e, i) => ({ e, x: (i - ours.length / 2) * 2.4, z: -120 }));
  const pin = () => {
    m.player.x = 0; m.player.z = -120;
    m.player.hp = m.player.maxHp; m.player.down = false; m.player.dead = false;
    for (const a of anchor) {
      a.e.x = a.x; a.e.z = a.z; a.e.moveSpeed = 0;
      a.e.hp = a.e.maxHp; a.e.down = false; a.e.dead = false;
      a.e.order = 'hold'; a.e.orderPoint = { x: a.x, z: a.z };
    }
  };
  pin();
  for (const e of foes()) { e.z = 30; }
  const track = [];
  for (let i = 0; i <= 6000 && !m.over; i++) {
    pin();
    realStep(1 / 60);
    if (i % 900 === 0) {
      track.push(`t${i / 60}s posture=${m.foePosture} left=${foes().length}`
        + ` quitFor=${m.foeQuitFor || 0} over=${m.over ? 'Y' : 'n'}`);
    }
  }
  return { track, why, over: !!m.over,
    quit: toasts.some((t) => /HAD ENOUGH/.test(t)),
    left: foes().length, outcome: ended ? (ended.outcome || 'ended') : null,
    toasts: [...new Set(toasts)].slice(0, 6) };
});
console.log(r.track.join('\n'));
console.log(`\nquit toast=${r.quit ? 'Y' : 'n'}  field called=${r.over ? 'Y' : 'n'}`
  + `  reason=${r.why}  outcome=${r.outcome}  still standing=${r.left}`);
console.log('toasts: ' + r.toasts.join(' | '));
await browser.close();
