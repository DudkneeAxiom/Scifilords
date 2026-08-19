// A battle at the new scale, played rather than tabulated.
//
// Raising the deploy ladder is a data change; whether sixty soldiers can
// actually stand on a field, hold a formation, find an enemy and finish a
// fight is not. This deploys a full company against a real party and watches
// the body budget, the formation, and the outcome.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
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
await page.waitForTimeout(600);

for (const [label, company, strength] of [
  ['green 8 v 12', 8, 12],
  ['notable 22 v 30', 22, 30],
  ['legendary 60 v 100', 60, 100],
]) {
  const r = await page.evaluate(async ({ company, strength }) => {
    const { Mission } = await import('/src/mission.js');
    const Roster = await import('/src/roster.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;

    // A company of the requested size, so the deployment is the variable.
    let seed = 4242;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    S.roster = [];
    for (let i = 0; i < company; i++) {
      const s = Roster.makeSoldier(rng, {
        role: ['rifleman', 'gunner', 'marksman', 'breacher'][i % 4], rank: 1,
      });
      s.id = `bf${i}`; s.equip = {}; s.perks = [];
      if (i === 0) s.isCommander = true;
      S.roster.push(s);
    }

    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Scale',
        party: { id: 'bf', kind: 'scrappers', name: 'Scale', strength, tier: 3, quality: 0.8 } },
      squad: S.roster,
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {},
      onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

    const count = (side) => m.entities.filter((e) => e.side === side && !e.dead).length;
    const atStart = { mine: count('player'), theirs: count('enemy'), total: m.entities.length };

    // Play it out: drive the sim by hand so nothing depends on rAF timing.
    let endReason = null;
    const realEnd = m.endMission.bind(m);
    m.endMission = (ok, why) => {
      if (!endReason) endReason = why + (ok ? ' (win)' : ' (loss)');
      return realEnd(ok, why);
    };
    const realStep = m.step.bind(m);
    m.step = () => {};
    let peak = atStart.total;
    let ticks = 0;
    const trace = [];
    for (; ticks < 36000 && !m.over; ticks++) {
      realStep(1 / 60);
      const live = m.entities.filter((e) => !e.dead).length;
      if (live > peak) peak = live;
      if (ticks % 900 === 0) {
        const mine = m.entities.filter((e) => e.side === 'player' && !e.dead);
        const theirs = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
        let gap = Infinity;
        for (const a of mine) for (const b of theirs) {
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d < gap) gap = d;
        }
        const orders = {};
        for (const e of mine) orders[e.order || 'none'] = (orders[e.order || 'none'] || 0) + 1;
        const eorders = {};
        for (const e of theirs) eorders[e.order || 'none'] = (eorders[e.order || 'none'] || 0) + 1;
        trace.push({
          t: Math.round(ticks / 60), gap: Math.round(gap),
          mine: mine.length, theirs: theirs.length,
          swinging: m.entities.filter((e) => e.swing).length,
          orders, eorders,
          phase: m.foePosture || null,
          nerve: (() => {
            const ns = theirs.map((e) => e.nerve).filter((n) => n != null);
            if (!ns.length) return null;
            return { min: Math.round(Math.min(...ns)), avg: Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) };
          })(),
          seen: theirs.reduce((a, e) => a + (e.casualtySeen || 0), 0),
        });
      }
    }

    return {
      atStart, peak, ticks, over: m.over,
      endMine: count('player'), endTheirs: count('enemy'),
      committed: m.skirmishCommitted, total: m.skirmishTotal,
      routed: m.entities.filter((e) => e.routing).length, trace, endReason,
      survivors: m.entities.filter((e) => e.side === 'enemy' && !e.dead && !e.down && !e.routing)
        .slice(0, 6).map((e) => ({
          state: e.state, order: e.order, routing: !!e.routing,
          hold: !!e.holdGround, withdraw: !!e.withdrawing, nerve: Math.round(e.nerve || -1),
          dist: Math.round(Math.min(...m.entities
            .filter((o) => o.side === 'player' && !o.dead && !o.down)
            .map((o) => Math.hypot(o.x - e.x, o.z - e.z)))),
        })),
      posture: m.foePosture, quitFor: m.foeQuitFor || 0,
      committed: m.skirmishCommitted, totalWave: m.skirmishTotal,
      stallFor: Math.round(m.stallFor || 0), extractArmed: !!m.extractArmed,
      exDist: Math.round(Math.hypot(m.player.x - m.level.extraction.x,
        m.player.z - m.level.extraction.z)),
    };
  }, { company, strength });

  console.log(`\n--- ${label}`);
  console.log(`  on the field at start: ${r.atStart.mine} mine, ${r.atStart.theirs} theirs `
    + `(${r.atStart.total} bodies; first wave ${r.committed} of ${r.total})`);
  console.log(`  peak bodies alive: ${r.peak}`);
  console.log(`  after ${(r.ticks / 60).toFixed(0)}s: ${r.endMine} mine, ${r.endTheirs} theirs, `
    + `${r.routed} routing, resolved=${r.over}`);
  console.log(`  ended by: ${r.endReason} (stall ${r.stallFor}s, extraction armed=${r.extractArmed}, ${r.exDist}m away)`);
  console.log(`  posture=${r.posture} quitFor=${r.quitFor} committed=${r.committed}/${r.totalWave}`);
  for (const sv of r.survivors || []) console.log(`    survivor ${JSON.stringify(sv)}`);
  for (const t of r.trace) {
    console.log(`    t=${String(t.t).padStart(3)}s gap=${String(t.gap).padStart(4)}m ` +
      `${t.mine}v${t.theirs} swinging=${t.swinging} phase=${t.phase} ` +
      `nerve=${JSON.stringify(t.nerve)}`);
  }
}

console.log(errors.length ? `\nerrors:\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : '\nerrors: none');
await browser.close();
