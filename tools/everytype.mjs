// Play one of everything, with a player who actually plays.
//
// Most battle work lands on skirmishes because that is what the probes reach
// for. The other nine types have their own build, objective and completion
// logic, and a change to the shared melee layer lands in all of them. This
// boots each in turn, marches the line, walks the commander at whatever the
// mission wants doing, and asks: does it build, does it advance, does it
// RESOLVE, and does the console stay quiet.
//
// Two lessons are baked in. Count standing/down/dead the way the game counts
// (a company entirely on the floor is legitimately wiped — counting !dead
// alone reports ten men standing as the field is lost). And take each
// interactable once, filtering on done OR taken, which is the game's own test.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });
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

const SPECS = [
  ['skirmish', { type: 'skirmish', site: 'roadside', layout: 'roadside' }],
  ['lair', { type: 'lair', site: 'quarry', layout: 'quarry' }],
  ['recovery', { type: 'recovery', site: 'array', layout: 'array' }],
  ['sabotage', { type: 'sabotage', site: 'depot', layout: 'depot' }],
  ['seize', { type: 'seize', site: 'outpost', layout: 'outpost' }],
  ['raid', { type: 'raid', site: 'wreckyard', layout: 'wreckyard' }],
  ['defense', { type: 'defense', site: 'relay', layout: 'relay' }],
  ['siege', { type: 'siege', site: 'fort', layout: 'fort' }],
  ['siege-defend', { type: 'siege', site: 'bastion', layout: 'bastion', defend: true, enemyArmy: 50 }],
  ['pit', { type: 'pit', site: 'arena', layout: 'arena' }],
];

for (const [label, base] of SPECS) {
  const before = errors.length;
  const r = await page.evaluate(async ({ base }) => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR, S = G.campaign;
    G.mission?.dispose(); G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = ''; UI.show('hud');
    try {
      G.mission = new Mission({ campaign: S,
        spec: { ...base, siteName: base.type.toUpperCase(),
          party: { id: 'et', kind: 'scrappers', name: 'Foe', strength: 18, tier: 3, quality: 0.8 } },
        squad: S.roster.slice(0, 10), container: document.getElementById('viewport'),
        onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {} });
      await G.mission.start();
    } catch (e) { return { built: false, why: String(e && e.message || e) }; }
    const m = G.mission;
    m.paused = false; m.hadLock = true; m.inserting = false;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    for (const e of m.entities) e.inserting = false;
    const realStep = m.step.bind(m); m.step = () => {};
    let ended = null;
    const realEnd = m.endMission.bind(m);
    m.endMission = (ok, why) => {
      ended = ended || `${why}/${ok ? 'win' : 'loss'}@${m.time.toFixed(0)}s`; return realEnd(ok, why);
    };
    for (const s of m.squad) { s.order = 'attack'; s.orderPoint = null; s.forceTarget = null; }
    const stand = (side) => m.entities.filter(
      (e) => e.side === side && !e.dead && !e.down && !e.militia).length;
    const start = { p: stand('player'), e: stand('enemy'), need: m.objective?.need ?? null };
    const taken = new Set();
    let used = 0;
    for (let i = 0; i < 14400 && !m.over; i++) {
      const it = m.interactables.find((x) => !x.done && !x.taken && !taken.has(x));
      const goal = it || m.level.objectivePoint;
      if (goal) {
        const dx = goal.x - m.player.x, dz = goal.z - m.player.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.4) { m.player.x += (dx / d) * 5.6 / 60; m.player.z += (dz / d) * 5.6 / 60; }
        else if (it) { m.completeInteraction(it); taken.add(it); used++; }
      }
      realStep(1 / 60);
    }
    return { built: true, start, used, ended,
      progress: m.objective?.progress ?? null, done: !!m.objective?.done,
      over: !!m.over, extract: !!m.extractArmed,
      endP: stand('player'), endE: stand('enemy'),
      down: m.entities.filter((e) => e.side === 'player' && !e.dead && e.down).length };
  }, { base });
  if (!r.built) { console.log(`${label.padEnd(13)} DID NOT BUILD — ${r.why}`); continue; }
  console.log(`${label.padEnd(13)} ${r.start.p}v${String(r.start.e).padEnd(3)} used ${r.used}`
    + `  obj ${String(r.progress).padStart(3)}/${String(r.start.need).padEnd(4)} done=${r.done ? 'Y' : 'n'}`
    + `  ${String(r.ended || 'NEVER RESOLVED').padEnd(22)} end ${r.endP}+${r.down}dn v${r.endE}`);
  for (const e of [...new Set(errors.slice(before))].slice(0, 2)) console.log(`              ! ${e}`);
}
console.log(errors.length ? `\n${errors.length} console errors total` : '\nno console errors');
await browser.close();
