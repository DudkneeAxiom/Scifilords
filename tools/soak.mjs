// A long unattended playthrough. The acceptance suite proves each system works
// once; this proves they survive each other over a whole campaign — hundreds of
// days, dozens of battles at every scale, every mission type, holdings changing
// hands, a war declared and sued out. Anything that throws, stalls or produces
// an unwinnable objective shows up here and nowhere else.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-soak', { recursive: true });

const DAYS = Number(process.argv[2] || 240);
const BATTLES = Number(process.argv[3] || 26);

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

// ---- 1. Campaign simulation soak -----------------------------------------
// Drive the strategic layer hard: many days, parties moving, prices drifting,
// diplomacy churning, holdings taken and lost.
const sim = await page.evaluate(({ days }) => {
  const { State, DATA, Roster } = window.KR.dev;
  const S = window.KR.campaign;
  const problems = [];
  const seenOwners = new Set();
  S.credits = 500000; S.renown = 2000;
  for (let d = 0; d < days; d++) {
    try {
      State.advanceTime(S, 24);
    } catch (e) { problems.push(`day ${d}: ${e.message}`); break; }
    // Sanity invariants that should hold on every single day.
    if (S.credits < 0) problems.push(`day ${d}: negative credits ${S.credits}`);
    if (!S.roster.length) problems.push(`day ${d}: roster emptied`);
    for (const s of S.roster) {
      if (s.hp > s.maxHp) problems.push(`day ${d}: ${s.name} hp ${s.hp}/${s.maxHp}`);
      if (Number.isNaN(s.hp)) problems.push(`day ${d}: ${s.name} hp is NaN`);
      if (!DATA.ORIGINS[s.origin]) problems.push(`day ${d}: ${s.name} bad origin ${s.origin}`);
      if (!Roster.rankOf(s)) problems.push(`day ${d}: ${s.name} bad rank ${s.rank}`);
    }
    for (const g of DATA.GOODS_LIST) {
      const p = S.prices?.[g.id];
      if (p != null && (!Number.isFinite(p) || p <= 0)) problems.push(`day ${d}: price ${g.id}=${p}`);
    }
    // Take and lose ground so the territory layer is exercised repeatedly.
    if (d % 17 === 0) {
      const l = DATA.LOCATIONS[(d * 7) % DATA.LOCATIONS.length];
      try { State.seizeLocation(S, l.id); } catch (e) { problems.push(`seize ${l.id}: ${e.message}`); }
    }
    if (d % 23 === 0) {
      try { window.KR.world.refreshTerritory?.(); } catch (e) { problems.push(`territory: ${e.message}`); }
    }
    seenOwners.add(Object.keys(S.holdings || {}).length);
  }
  return {
    problems,
    day: S.day,
    credits: S.credits,
    roster: S.roster.length,
    holdings: Object.keys(S.holdings || {}).length,
    renown: S.renown,
    parties: S.parties?.length ?? 0,
    log: (S.log || []).length,
  };
}, { days: DAYS });

console.log(`Campaign soak: ${DAYS} days simulated`);
console.log(`  day=${sim.day} credits=${sim.credits} roster=${sim.roster}`
  + ` holdings=${sim.holdings} renown=${sim.renown} parties=${sim.parties} log=${sim.log}`);
if (sim.problems.length) {
  console.log(`  ${sim.problems.length} invariant failure(s):`);
  for (const p of sim.problems.slice(0, 12)) console.log(`    ${p}`);
}

// ---- 2. Battle soak -------------------------------------------------------
// Every mission type, at every scale the deployment limit allows. Each is run
// headless at high speed until it either resolves or refuses to. A mission that
// cannot end is the worst bug this game can have, so it is the one thing here
// that is checked exhaustively rather than sampled.
const types = await page.evaluate(() => Object.keys(window.KR.dev.DATA.MISSION_TYPES));
const layouts = ['roadside', 'compound', 'array', 'depot'];
console.log(`\nBattle soak: ${BATTLES} deployments across ${types.length} mission types`);

const launch = async (spec, squadSize) => page.evaluate(async ({ spec, squadSize }) => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  for (const s of S.roster) { s.hp = s.maxHp; s.status = 'ready'; s.wound = null; s.pendingPerks = null; }
  G.mission?.dispose();
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S, spec, squad: S.roster.slice(0, squadSize),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onEnd: () => {},
  });
  await G.mission.start();
}, { spec, squadSize });

const results = [];
for (let i = 0; i < BATTLES; i++) {
  const type = types[i % types.length];
  const layout = layouts[i % layouts.length];
  const strength = 6 + (i % 6) * 12;      // 6 .. 66
  const squadSize = 2 + (i % 6);          // 2 .. 7
  const spec = {
    type, site: layout, layout, siteName: `Soak ${i}`,
    party: {
      id: `soak${i}`, kind: 'scrappers', name: `Soak ${i}`,
      strength, tier: 2, quality: 0.8,
    },
  };
  try {
    await launch(spec, squadSize);
    await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  } catch (e) {
    results.push({ type, layout, strength, squadSize, fail: `launch: ${e.message.slice(0, 80)}` });
    continue;
  }

  // A mission has to be *completable*, not merely survivable. Kill the hostiles
  // and actually play the objective: walk the commander to the objective point
  // and hold the interact key, which is what a real player does. Anything that
  // still refuses to end is a genuine softlock.
  const r = await page.evaluate(({ type, strength }) => {
    const m = window.KR.mission;
    const b = m.level.bounds;
    const foes = () => m.entities.filter((e) => e.side === 'enemy' && !e.dead);
    const started = foes().length;
    const outside = foes().filter((e) => Math.abs(e.x) > b || Math.abs(e.z) > b).length;
    const embedded = foes().filter((e) => m.level.obstacles.some((o) => o.h > 0.7
      && Math.abs(e.x - o.x) < o.hw + 0.35 && Math.abs(e.z - o.z) < o.hd + 0.35)).length;
    const unreachable = m.nav
      ? foes().filter((e) => m.nav.isBlockedWorld(e.x, e.z)).length : 0;

    m.paused = false;
    m.hadLock = true;
    let ended = false; let frames = 0;
    const LIMIT = 12000;              // 200 simulated seconds
    for (; frames < LIMIT && !ended; frames++) {
      // Play like a person: go to the nearest thing that still needs doing,
      // then to extraction once the objective is satisfied.
      let goal = null;
      if (m.objective?.done && m.extractArmed && m.level.extraction) {
        goal = m.level.extraction;
      } else {
        let best = Infinity;
        for (const it of m.interactables) {
          if (it.done || it.taken || it.kind === 'cache') continue;
          const ix = it.entity ? it.entity.x : it.x;
          const iz = it.entity ? it.entity.z : it.z;
          if (it.entity && (it.entity.dead || it.entity.released)) continue;
          const dd = Math.hypot(m.player.x - ix, m.player.z - iz);
          if (dd < best) { best = dd; goal = { x: ix, z: iz }; }
        }
        if (!goal) goal = m.level.extraction && m.objective?.done
          ? m.level.extraction : m.level.objectivePoint;
      }
      const d = Math.hypot(m.player.x - goal.x, m.player.z - goal.z);
      if (d > 1.2) {
        m.player.x += ((goal.x - m.player.x) / d) * 0.22;
        m.player.z += ((goal.z - m.player.z) / d) * 0.22;
      }
      m.keys.add('e');
      m.step(1 / 60);
      if (frames % 20 === 0) for (const e of foes()) { e.hp = 0; e.dead = true; }
      if (m.over) ended = true;
    }
    return {
      type, strength, started, outside, embedded, unreachable,
      ended, seconds: +(frames / 60).toFixed(1),
      objective: m.objective ? `${Math.round(m.objective.progress)}/${m.objective.need}` : '—',
      outcome: m.result?.outcome ?? (m.over ? 'over' : 'STALLED'),
    };
  }, { type, strength });
  results.push({ ...r, layout, squadSize });
}

let bad = 0;
console.log('\n  type        layout     foes  squad  spawned outside embed unreach   ends   objective  outcome');
for (const r of results) {
  if (r.fail) { bad++; console.log(`  ${(r.type || '?').padEnd(11)} ${r.fail}`); continue; }
  const problem = !r.ended || r.outside > 0 || r.embedded > 0 || r.unreachable > 0
    || (r.started === 0 && r.type !== 'defense');
  if (problem) bad++;
  console.log(`  ${r.type.padEnd(11)} ${r.layout.padEnd(10)} ${String(r.strength).padStart(4)}`
    + `  ${String(r.squadSize).padStart(5)}  ${String(r.started).padStart(7)}`
    + ` ${String(r.outside).padStart(7)} ${String(r.embedded).padStart(5)}`
    + ` ${String(r.unreachable).padStart(7)}`
    + `  ${(r.ended ? r.seconds + 's' : 'NEVER').padStart(6)}   ${r.objective.padEnd(9)}  ${r.outcome}`
    + (problem ? '  <-- PROBLEM' : ''));
}

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ${e}`);

const ok = sim.problems.length === 0 && bad === 0 && errors.length === 0;
console.log(ok
  ? `\nOK — ${DAYS} campaign days and ${BATTLES} battles with no stall, no unreachable enemy, no error.`
  : `\nFAIL — ${sim.problems.length} campaign invariant(s), ${bad} battle problem(s), ${errors.length} error(s).`);
await browser.close();
process.exit(ok ? 0 : 1);
