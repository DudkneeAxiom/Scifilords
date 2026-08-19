// Why does nothing happen?
//
// Two mission types came out of the sweep looking frozen: a siege where
// nobody moved at all, and a lair where my side was cut down without
// inflicting a single casualty. Both look like stalls rather than losses.
// This asks each unit what it thinks it is doing.
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

for (const base of [{ type: 'siege', site: 'fort', layout: 'fort' }, { type: 'lair', site: 'quarry', layout: 'quarry' }]) {
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
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    for (const e of m.entities) e.inserting = false;
    const realStep = m.step.bind(m); m.step = () => {};
    for (const s of m.squad) { s.order = 'attack'; s.orderPoint = null; s.forceTarget = null; }
    const snap = () => {
      const live = m.entities.filter((e) => !e.dead);
      const near = (a, side) => {
        let best = 1e9;
        for (const b of live) if (b.side === side && b !== a) best = Math.min(best, Math.hypot(b.x - a.x, b.z - a.z));
        return best;
      };
      const grab = (side) => live.filter((e) => e.side === side).slice(0, 5).map((e) => ({
        st: e.state, ord: e.order || '-', tgt: e.target ? 'Y' : 'n',
        spd: +(e.moveSpeed || 0).toFixed(1), y: +e.y.toFixed(1),
        gap: +near(e, side === 'player' ? 'enemy' : 'player').toFixed(0),
      }));
      return { mine: grab('player'), theirs: grab('enemy'),
        counts: { p: live.filter((e) => e.side === 'player').length, e: live.filter((e) => e.side === 'enemy').length } };
    };
    const t0 = snap();
    for (let i = 0; i < 1800; i++) realStep(1 / 60);
    const t30 = snap();
    for (let i = 0; i < 3600; i++) realStep(1 / 60);
    return { t0, t30, t90: snap(), phase: m.phase, objective: m.objective?.text,
      gate: m.level.breachPoints ? m.level.breachPoints.length : null };
  }, { base });
  console.log(`\n=== ${base.type} @ ${base.site} — phase=${r.phase} obj="${r.objective}" breaches=${r.gate}`);
  for (const [t, s] of [['t0', r.t0], ['t30', r.t30], ['t90', r.t90]]) {
    console.log(` ${t} ${s.counts.p}v${s.counts.e}`);
    console.log(`   mine   ` + s.mine.map((e) => `${e.st}/${e.ord} tgt=${e.tgt} v=${e.spd} y=${e.y} gap=${e.gap}`).join(' | '));
    console.log(`   theirs ` + s.theirs.map((e) => `${e.st}/${e.ord} tgt=${e.tgt} v=${e.spd} y=${e.y} gap=${e.gap}`).join(' | '));
  }
}
await browser.close();
