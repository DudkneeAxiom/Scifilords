// How long do you actually get to answer a blow?
//
// The report is that the melee has no read on timing or direction and the
// guard rose feels useless. The rose is FED the right things — the
// direction of the blow coming down and how far through its wind-up it is
// — so the question is whether the window it shows is long enough for a
// person to do anything with. On paper a sword is 303ms and a blade 254ms,
// which is at or under visual reaction time. This measures the real thing:
// from the first frame the rose could show a blow, to the frame it lands.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1000);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(600);
}
const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const { WEAPONS } = await import('/src/data.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = ''; UI.show('hud');
  G.mission = new Mission({ campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Telegraph',
      party: { id: 'tg', kind: 'looters', name: 'Foe', strength: 4, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 2), container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {} });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true; m.inserting = false;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  for (const e of m.entities) e.inserting = false;
  const realStep = m.step.bind(m); m.step = () => {};

  const p = m.player;
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  const foe = foes[0];
  for (const e of foes.slice(1)) { e.x = 900; e.z = 900; }
  for (const s of m.squad) { s.x = p.x - 60; s.z = p.z - 60; s.order = 'hold'; }
  p.hp = p.maxHp = 1e6; foe.hp = foe.maxHp = 1e6;

  const out = [];
  for (const wid of ['blade', 'sword', 'spear', 'heavy']) {
    foe.weapon = WEAPONS[wid];
    const windows = [];
    for (let bout = 0; bout < 6 && windows.length < 4; bout++) {
      // Reset and stand them at reach, facing each other.
      foe.swing = null; foe.cooldown = 0; foe.wind = 1;
      foe.x = p.x; foe.z = p.z + (WEAPONS[wid].reach || 2) - 0.2;
      foe.yaw = Math.atan2(p.x - foe.x, p.z - foe.z);
      let firstSeen = -1, landed = -1;
      for (let i = 0; i < 400; i++) {
        foe.x = p.x; foe.z = p.z + (WEAPONS[wid].reach || 2) - 0.2;
        foe.yaw = Math.atan2(p.x - foe.x, p.z - foe.z);
        realStep(1 / 60);
        const read = m.meleeRead?.();
        // The first frame the shell could TELL the player a blow is coming.
        if (firstSeen < 0 && read?.incoming) firstSeen = i;
        // And the frame the blow resolves.
        if (firstSeen >= 0 && foe.swing && foe.swing.hitDone) { landed = i; break; }
        if (firstSeen >= 0 && !foe.swing) { landed = i; break; }
      }
      if (firstSeen >= 0 && landed > firstSeen) windows.push((landed - firstSeen) * (1000 / 60));
    }
    const w = WEAPONS[wid];
    out.push({
      wid, rpm: w.rpm, onPaper: Math.round((60 / w.rpm) * 0.55 * 1000),
      measured: windows.length ? Math.round(windows.reduce((a, b) => a + b, 0) / windows.length) : null,
      samples: windows.length,
    });
  }
  return out;
});
console.log('weapon   rpm   telegraph on paper   MEASURED window   verdict');
for (const o of r) {
  const v = o.measured == null ? 'no swing seen'
    : o.measured < 200 ? 'UNREACTABLE'
      : o.measured < 300 ? 'reflex only'
        : o.measured < 450 ? 'tight but fair'
          : 'readable';
  console.log(`  ${o.wid.padEnd(7)} ${String(o.rpm).padStart(4)}   ${String(o.onPaper).padStart(14)}ms`
    + `   ${String(o.measured ?? '--').padStart(12)}ms   ${v}  (n=${o.samples})`);
}
console.log('\nhuman visual reaction is ~250ms to NOTICE, plus the time to move the mouse.');
await browser.close();
