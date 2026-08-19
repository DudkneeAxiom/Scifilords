// Did the advance order make the line WORSE?
//
// Telling every soldier under an attack order to march on the nearest enemy
// fixed a siege that never started, but it can also strip a line of its
// shape: ten men each running at their own nearest opponent arrive strung
// out and get beaten in detail. Same ground, same seed, player standing
// still, squad on attack — run it here and again under git stash.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
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
for (const base of [{ type: 'skirmish', site: 'roadside', layout: 'roadside' },
                    { type: 'lair', site: 'quarry', layout: 'quarry' }]) {
  const r = await page.evaluate(async ({ base }) => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR, S = G.campaign;
    G.mission?.dispose(); G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = ''; UI.show('hud');
    G.mission = new Mission({ campaign: S,
      spec: { ...base, siteName: 'X', party: { id: 'x', kind: 'scrappers', name: 'Foe', strength: 18, tier: 3, quality: 0.8 } },
      squad: S.roster.slice(0, 10), container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {} });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true; m.inserting = false;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    for (const e of m.entities) e.inserting = false;
    const realStep = m.step.bind(m); m.step = () => {};
    for (const s of m.squad) { s.order = 'attack'; s.orderPoint = null; s.forceTarget = null; }
    const stand = (s) => m.entities.filter((e) => e.side === s && !e.dead && !e.down && !e.militia).length;
    // How strung out is the line? Mean distance from the squad's own centre.
    const spread = () => {
      const live = m.squad.filter((e) => !e.dead && !e.down);
      if (live.length < 2) return 0;
      const cx = live.reduce((a, e) => a + e.x, 0) / live.length;
      const cz = live.reduce((a, e) => a + e.z, 0) / live.length;
      return live.reduce((a, e) => a + Math.hypot(e.x - cx, e.z - cz), 0) / live.length;
    };
    const out = [];
    for (let i = 0; i <= 7200; i++) {
      if (i % 1800 === 0) out.push(`t${i / 60}s ${stand('player')}v${stand('enemy')} spread=${spread().toFixed(0)}m`);
      realStep(1 / 60);
    }
    return out;
  }, { base });
  console.log(`${base.type.padEnd(9)} ${r.join('  ')}`);
}
await browser.close();
