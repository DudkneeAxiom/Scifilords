// Storm the fort, properly.
//
// A siege is the one mission type the company cannot finish on its own: the
// gate has to be blown by hand, and every earlier probe left the player
// standing still, so the assault read as a stall. This plays it — march the
// line up, walk the commander to the charge, set it, and see whether the
// fight that follows actually resolves.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
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

for (const spec of [{ type: 'siege', site: 'fort', layout: 'fort' },
                    { type: 'siege', site: 'bastion', layout: 'bastion', defend: true, enemyArmy: 50 }]) {
  const r = await page.evaluate(async ({ spec }) => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR, S = G.campaign;
    G.mission?.dispose(); G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = ''; UI.show('hud');
    const log = [];
    G.mission = new Mission({ campaign: S,
      spec: { ...spec, siteName: 'X', party: { id: 'x', kind: 'scrappers', name: 'Foe', strength: 20, tier: 3, quality: 0.8 } },
      squad: S.roster.slice(0, 10), container: document.getElementById('viewport'),
      onHud: () => {}, onToast: (a, b) => log.push(`${a}: ${b}`), onIntro: () => {},
      onWheel: () => {}, onEnd: (o) => log.push('END ' + JSON.stringify(o && o.outcome)) });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    for (const e of m.entities) e.inserting = false;
    m.inserting = false;
    const realStep = m.step.bind(m); m.step = () => {};
    // Why did it end? There is one endMission() and it takes a reason;
    // catch it rather than inferring from the wreckage.
    let ended = null;
    const realEnd = m.endMission.bind(m);
    m.endMission = (ok, why) => { ended = ended || `${why}(${ok ? 'win' : 'loss'}) at ${m.time.toFixed(0)}s`; return realEnd(ok, why); };
    for (const s of m.squad) { s.order = 'attack'; s.orderPoint = null; }

    const marks = [];
    // Count the way the GAME counts. 'wiped' and the commander rule both
    // test !dead && !down && !militia, so a company that is entirely on the
    // floor is legitimately finished — measuring !dead alone reports ten men
    // standing at the moment the field is lost and invents a bug.
    const stand = (side) => m.entities.filter(
      (e) => e.side === side && !e.dead && !e.down && !e.militia).length;
    const downed = () => m.entities.filter(
      (e) => e.side === 'player' && !e.dead && e.down).length;
    const alive = () => [stand('player') + '+' + downed() + 'dn', stand('enemy')];
    // Walk the commander at whatever the mission wants doing next, and take
    // it when in reach.
    let used = 0;
    // Take each thing ONCE. Reading the mission's own done flag is not
    // enough — one kind does not latch it, and the loop re-set the same
    // charge four hundred times, which is its own finding.
    const taken = new Set();
    let unlatched = null;
    for (let i = 0; i < 14400 && !m.over; i++) {
      const it = m.interactables.find((x) => !x.done && !taken.has(x));
      if (it) {
        const dx = it.x - m.player.x, dz = it.z - m.player.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.4) { m.player.x += (dx / d) * 5.6 / 60; m.player.z += (dz / d) * 5.6 / 60; }
        else if (m.completeInteraction) {
          m.completeInteraction(it); used++; taken.add(it);
          if (!it.done) unlatched = unlatched || it.kind;
        }
      }
      realStep(1 / 60);
      if (i % 1800 === 0) marks.push(`t${i / 60}s ${alive().join('v')} obj=${m.objective?.progress}`);
    }
    return { marks, used, unlatched, why: ended, over: !!m.over, done: !!m.objective?.done, breached: !!m.breached,
      end: alive(), log: log.slice(0, 6), extract: !!m.extractArmed };
  }, { spec });
  console.log(`\n=== ${spec.site}${spec.defend ? ' (defending)' : ''} — charges set ${r.used}, breached=${r.breached}`);
  console.log('  ' + r.marks.join('  '));
  console.log(`  unlatched=${r.unlatched || '-'} why=${r.why} resolved=${r.over ? 'Y' : 'n'} objectiveDone=${r.done ? 'Y' : 'n'} extract=${r.extract ? 'Y' : 'n'} end ${r.end.join('v')}`);
  for (const l of r.log) console.log('   · ' + l);
}
console.log(errs.length ? '\n' + errs.slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
