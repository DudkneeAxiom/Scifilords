// The whole cycle, over and over.
//
// Contract, deploy, fight, the field ends itself, sort the take, claim it,
// back to the map, again. Each piece has been walked once; what has not
// been checked is what twenty of them in a row do to a campaign. Drift
// lives here: spoils that accumulate and never clear, a roster that only
// shrinks, credits that run away, a mission that stops ending.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const ROUNDS = Number(process.argv[3] || 12);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
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
await page.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));

console.log('round  ended-as   day  credits  roster  fit  spoils-bag  errors');
let lastErr = 0;
for (let n = 1; n <= ROUNDS; n++) {
  const r = await page.evaluate(async (round) => {
    const { Mission } = await import('/src/mission.js');
    const State = await import('/src/state.js');
    const UI = await import('/src/ui.js');
    const G = window.KR, S = G.campaign;
    G.mission?.dispose(); G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    let ended = null;
    const Roster = await import('/src/roster.js');
    const fit = State.living(S).filter((x) => Roster.deployable(x));
    if (fit.length < 2) {
      State.advanceTime(S, 24 * 3);   // rest up, the way a player would
      const back = State.living(S).filter((x) => Roster.deployable(x)).length;
      return { why: 'rested 3 days', day: S.day, credits: S.credits,
        roster: State.living(S).length, fit: back, bag: 0 };
    }
    // A real posting, so the work pays what the campaign says work pays.
    const contract = { id: `soak${round}`, type: 'skirmish', site: 'roadside',
      employer: 'syndic', title: `Soak ${round}`, text: 'probe',
      pay: 600, days: 8, expiresDay: S.day + 10, accepted: true };
    S.contracts.push(contract);
    G.mission = new Mission({ campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: `Round ${round}`,
        contract,
        party: { id: `r${round}`, kind: 'looters', name: 'Foe', strength: 6 + (round % 5), tier: 1, quality: 0.6 } },
      squad: fit.slice(0, 10),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {},
      onEnd: (o) => { ended = o; } });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true; m.inserting = false;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    for (const e of m.entities) e.inserting = false;
    const realStep = m.step.bind(m);
    m.step = () => {};
    let why = null;
    const realEnd = m.endMission.bind(m);
    m.endMission = (ok, reason) => { why = why || reason; return realEnd(ok, reason); };
    // Fight it: the squad goes in, and the field is settled by attrition.
    for (const s of m.squad) { s.order = 'attack'; s.orderPoint = null; }
    m.player.hp = m.player.maxHp = 1e6;
    for (let i = 0; i < 9000 && !m.over; i++) realStep(1 / 60);
    let stall = null;
    if (!m.over) {
      const live = (side) => m.entities.filter((e) => e.side === side && !e.dead && !e.down);
      const mine = live('player'), theirs = live('enemy');
      const gap = (a, list) => list.reduce((b, o) => Math.min(b, Math.hypot(o.x - a.x, o.z - a.z)), 1e9);
      stall = {
        mine: mine.length, theirs: theirs.length,
        downMine: m.entities.filter((e) => e.side === 'player' && e.down).length,
        theirStates: [...new Set(theirs.map((e) => e.state))].join(','),
        myStates: [...new Set(mine.map((e) => e.state))].join(','),
        nearest: theirs.length && mine.length ? Math.round(Math.min(...theirs.map((t) => gap(t, mine)))) : -1,
        objective: m.objective?.text, progress: m.objective?.progress, need: m.objective?.need,
        routing: theirs.filter((e) => e.routing).length,
      };
      m.endMission(false, 'timeout');
    }

    // The campaign takes the report, and the player keeps everything.
    const res = m.result;
    State.applyMissionResult(S, res);
    for (const it of (res.fieldSpoils || [])) State.addSpoils(S, it.pool, it.id, 1);
    State.claimSpoils(S);
    State.advanceTime(S, 20);
    return {
      why, day: S.day, credits: S.credits,
      roster: State.living(S).length,
      fit: State.living(S).filter((s) => s.status !== 'wounded' && s.status !== 'dead').length,
      stall,
      bag: Object.values(S.spoils || {}).reduce((a, b) =>
        a + (typeof b === 'number' ? b : Object.values(b || {}).reduce((x, y) => x + y, 0)), 0),
    };
  }, n);
  const errs = errors.length - lastErr; lastErr = errors.length;
  console.log(`${String(n).padStart(5)}  ${String(r.why).padEnd(10)} ${String(r.day).padStart(4)}`
    + ` ${String(r.credits).padStart(8)} ${String(r.roster).padStart(7)} ${String(r.fit).padStart(4)}`
    + ` ${String(r.bag).padStart(11)}  ${errs || ''}`);
  if (r.stall) console.log('    STALLED: ' + JSON.stringify(r.stall));
  if (r.roster === 0) { console.log('  the company is gone; stopping'); break; }
}
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 5).join('\n')
  : '\nno console errors across the whole run');
await browser.close();
