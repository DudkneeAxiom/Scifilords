// Why does a recovery deployment refuse to finish? Traces one mission frame by
// frame: what the player is standing next to, whether the interact is
// progressing, and what the objective thinks is happening.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
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

await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  G.mission?.dispose();
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'recovery', site: 'compound', layout: 'compound', siteName: 'Trace' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onEnd: () => {},
  });
  await G.mission.start();
});
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

const trace = await page.evaluate(() => {
  const m = window.KR.mission;
  const out = [];
  m.paused = false; m.hadLock = true;
  const pen = m.level.objectivePoint;
  const inter = m.interactables.map((it) => ({
    kind: it.kind, x: it.x, z: it.z, need: it.need,
    distFromPen: +Math.hypot(it.x - pen.x, it.z - pen.z).toFixed(2),
  }));

  for (let f = 0; f < 900; f++) {
    const near = m.nearInteract;
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
    for (const e of m.entities) if (e.side === 'enemy' && !e.dead) { e.hp = 0; e.dead = true; }
    if (f % 300 === 0 || m.over) {
      out.push({
        t: +(f / 60).toFixed(1),
        pos: [+m.player.x.toFixed(1), +m.player.z.toFixed(1)],
        goal: [+goal.x.toFixed(1), +goal.z.toFixed(1)],
        dist: +d.toFixed(1),
        intro: !!m.intro?.active,
        inserting: m.inserting,
        near: near ? near.kind : null,
        nearProg: near ? +(near.progress || 0).toFixed(2) : null,
        interactProg: +(m.interactProgress || 0).toFixed(2),
        objective: `${m.objective.progress}/${m.objective.need}`,
        done: !!m.objective.done,
        failed: !!m.objective.failed,
        extractArmed: !!m.extractArmed,
        prisoners: m.prisoners.map((p) => `${p.dead ? 'dead' : (p.released ? 'free' : 'held')}@${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' '),
        playerDown: !!m.player.down,
        over: !!m.over,
      });
    }
    if (m.over) break;
  }
  return { inter, out, extraction: m.level.extraction, pen };
});

console.log('interactables:', JSON.stringify(trace.inter));
console.log('objective point:', JSON.stringify(trace.pen), ' extraction:', JSON.stringify(trace.extraction));
console.log('\ntrace:');
for (const r of trace.out) console.log('  ' + JSON.stringify(r));
await browser.close();
