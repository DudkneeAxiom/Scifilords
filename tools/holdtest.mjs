// Does a host told to HOLD actually hold?
//
// The posture probe says a holding host walks 129 metres and looses nothing.
// But our own melee line routs under archery and runs, so the host may
// simply be following a fleeing enemy — the measurement cannot tell those
// apart. So: pin our line where it stands, every tick, immortal. It cannot
// rout, it cannot run, it cannot die. Whatever the host does now is the
// posture and nothing else.
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
  const { WEAPONS } = await import('/src/data.js');
  const UI = await import('/src/ui.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = ''; UI.show('hud');
  G.mission = new Mission({ campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Hold',
      party: { id: 'h', kind: 'scrappers', name: 'Foe', strength: 16, tier: 3, quality: 0.8 } },
    squad: S.roster.slice(0, 10), container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {} });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true; m.inserting = false;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  for (const e of m.entities) e.inserting = false;
  const realStep = m.step.bind(m); m.step = () => {};
  m.player.x = 0; m.player.z = -25;

  const foes = () => m.entities.filter((e) => e.side === 'enemy' && !e.dead && !e.down);
  const ours = m.squad.filter((e) => !e.dead);
  // Their bows, our none: that is the ranged edge the hold posture needs.
  for (const e of foes()) { e.weapon = WEAPONS.bow; e.bowStowed = false; e.ammo = 999; }
  for (const e of ours) { e.weapon = WEAPONS.blade; e.bowStowed = false; }

  // A wall our line cannot leave and cannot lose.
  const anchor = ours.map((e, i) => ({ e, x: (i - ours.length / 2) * 2.4, z: -25 }));
  for (const a of anchor) { a.e.x = a.x; a.e.z = a.z; }
  for (const e of foes()) { e.z = 25; }
  const pin = () => {
    m.player.x = 0; m.player.z = -25; m.player.hp = m.player.maxHp;
    m.player.down = false; m.player.dead = false;
    for (const a of anchor) {
      a.e.x = a.x; a.e.z = a.z; a.e.moveSpeed = 0;
      a.e.hp = a.e.maxHp; a.e.down = false; a.e.dead = false;
      a.e.routing = false; a.e.fled = false; a.e.morale = 100;
    }
  };
  const mid = () => {
    const f = foes();
    return f.length ? { x: f.reduce((a, e) => a + e.x, 0) / f.length,
      z: f.reduce((a, e) => a + e.z, 0) / f.length } : null;
  };
  pin();
  const start = mid();
  let shots = 0; const seen = new Set();
  const track = [];
  for (let i = 0; i <= 3600; i++) {
    pin();
    realStep(1 / 60);
    for (const a of (m.arrows || [])) if (!seen.has(a)) { seen.add(a); shots++; }
    if (i % 600 === 0) {
      const c = mid();
      const e = foes()[0];
      const lp = e && e.linePost ? e.linePost.z.toFixed(0) : "none";
      track.push("t" + (i / 60) + "s host z=" + c.z.toFixed(0)
        + " (" + Math.hypot(c.x - start.x, c.z - start.z).toFixed(0) + "m off)"
        + " | one: z=" + e.z.toFixed(0) + " st=" + e.state
        + " tgt=" + (e.target ? "Y" : "n") + " sight=" + e.sight
        + " v=" + (e.moveSpeed || 0).toFixed(1) + " post=" + lp
        + " hg=" + (e.holdGround ? "Y" : "n")
        + " adv=" + (e.advanceOn ? "Y" : "n"));
    }
  }
  const f = foes();
  return { posture: m.foePosture, track, shots,
    holdGround: f.filter((e) => e.holdGround).length, n: f.length,
    states: [...new Set(f.map((e) => e.state))].join(','),
    routing: f.filter((e) => e.routing).length,
    ourLineAt: -25, theirStartZ: 25 };
});
console.log(`posture=${r.posture}  host=${r.n}  holdGround=${r.holdGround}  states=${r.states}  routing=${r.routing}`);
console.log(`our line pinned at z=${r.ourLineAt}, host opened at z=${r.theirStartZ} (50m apart)`);
console.log('  ' + r.track.join('\n  '));
console.log(`arrows loosed in 60s: ${r.shots}`);
await browser.close();
