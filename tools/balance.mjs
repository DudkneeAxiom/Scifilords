// Combat balance probe.
//
// "How long does a stationary player survive contact?" is the single number
// that tells you whether the shooter is tuned. Too short and the game is
// unreadable; too long and nothing matters.
//
// This used to run one firefight and quote the result. That was wrong: a single
// burst landing or not is worth ~30 HP, so consecutive runs of the identical
// scenario produced "dead in 7s", "44 HP left after 14s" and "78 HP left after
// 14s". One sample is an anecdote. This runs the same scenario many times
// headlessly — using Mission.step() rather than the render loop — and reports
// the distribution, which is the only form of this claim worth believing.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const TRIALS = Number(process.argv[2] || 6);
const CAP = 45;   // seconds of standing in the open before we call it survivable
// One number cannot describe this. Standing 10m from a garrison and standing
// 32m from it are different games, and the interesting property is the shape of
// the curve between them: close range should be lethal fast enough that nobody
// tries it twice, and long range should give you time to read the fight and
// break contact.
const RANGES = [12, 22, 34];

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

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

const byRange = new Map();
for (const RANGE of RANGES) {
const results = [];
for (let i = 0; i < TRIALS; i++) {
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    for (const s of S.roster) { s.hp = s.maxHp; s.status = 'ready'; s.wound = null; s.pendingPerks = null; }
    S.stats.missions = (S.stats.missions || 0) + 1;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'recovery', site: 'array', layout: 'array', siteName: 'Balance' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onEnd: () => {},
    });
    await G.mission.start();
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(({ cap, range }) => {
    const m = window.KR.mission;
    m.paused = false; m.hadLock = true;
    // Skip the insertion cinematic: nothing may shoot during it, and measuring
    // across it reports a survival time that is mostly grace period.
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

    // Park the player in the open, in front of the garrison, and leave them
    // there. No cover, no movement, no return fire beyond what the AI squad
    // does on its own — the worst case a player can put themselves in.
    const o = m.level.objectivePoint;
    m.player.x = o.x + 6; m.player.z = o.z + range;
    m.squad.forEach((s, k) => { s.x = o.x + 4 + k * 2; s.z = o.z + range + 3; });
    const startHp = m.player.hp;

    let t = 0;
    const frames = cap * 60;
    for (let f = 0; f < frames; f++) {
      m.player.hp = Math.min(m.player.hp, m.player.maxHp);
      m.step(1 / 60);
      t = f / 60;
      // step() early-returns once the mission is over, so without this the
      // loop spins and reports a frozen HP value as if it were survival.
      if (m.player.down || m.player.hp <= 0 || m.over) break;
    }
    return {
      startHp,
      endHp: Math.max(0, Math.round(m.player.hp)),
      down: !!m.player.down,
      seconds: +t.toFixed(1),
      enemies: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
      range: +Math.min(...m.entities.filter((e) => e.side === 'enemy' && !e.dead)
        .map((e) => Math.hypot(e.x - m.player.x, e.z - m.player.z))).toFixed(0),
      over: !!m.over,
      squadUp: m.squad.filter((e) => !e.down && !e.dead).length,
    };
  }, { cap: CAP, range: RANGE });
  results.push(r);
  console.log(`  ${String(RANGE).padStart(2)}m trial ${String(i + 1).padStart(2)}: `
    + (r.down ? `down after ${r.seconds}s` : (r.over ? `mission ended at ${r.seconds}s on ${r.endHp} HP` : `survived ${CAP}s with ${r.endHp} HP`))
    + `  (${r.enemies} hostiles up, nearest ${r.range}m)`);
}

const downs = results.filter((r) => r.down);
const times = downs.map((r) => r.seconds).sort((a, b) => a - b);
const median = times.length
  ? (times.length % 2 ? times[(times.length - 1) / 2]
    : (times[times.length / 2 - 1] + times[times.length / 2]) / 2)
  : null;
const survivors = results.filter((r) => !r.down && !r.over);
const resolved = results.filter((r) => r.down || !r.over);
byRange.set(RANGE, {
  downs: downs.length, resolved: resolved.length, median,
  lo: times[0] ?? null, hi: times[times.length - 1] ?? null,
  hp: survivors.length ? survivors.map((r) => r.endHp) : [],
});
}

console.log(`\nStanding still in the open, ${TRIALS} trials at each range:\n`);
console.log('  range   incapacitated   time to down        survivors left on');
for (const [range, s] of byRange) {
  console.log(`  ${String(range).padStart(3)}m   ${String(s.downs).padStart(2)}/${TRIALS}`
    + `           ${(s.median === null ? '—' : `median ${s.median}s (${s.lo}-${s.hi}s)`).padEnd(20)}`
    + ` ${s.hp.length ? `${Math.min(...s.hp)}-${Math.max(...s.hp)} HP` : '—'}`);
}

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

// The design target is a steep curve, not a single number: closing with a
// garrison in the open should kill you before you can react, and standing off
// at rifle range should give you time to read the fight and break contact.
const near = byRange.get(RANGES[0]);
const far = byRange.get(RANGES[RANGES.length - 1]);
const lethalClose = near.resolved > 0 && near.downs / near.resolved >= 0.6
  && near.median !== null && near.median < 8;
const survivableFar = far.resolved > 0 && far.downs / far.resolved <= 0.4;
console.log(lethalClose && survivableFar
  ? `\nOK — ${RANGES[0]}m kills you in a median of ${near.median}s; at ${RANGES[RANGES.length - 1]}m`
    + ` you live long enough to do something about it. Range is the whole game.`
  : '\nFAIL — range does not change the outcome enough to matter.');
await browser.close();
