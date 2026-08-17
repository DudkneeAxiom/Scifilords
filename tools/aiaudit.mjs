// What is the AI actually doing?
//
// Combat "feel" complaints are usually specific behaviours that nobody has
// measured: soldiers who stand in the open, squadmates who walk into each
// other, enemies who hold a target for a tenth of a second before switching,
// people who get wedged on a corner and vibrate. None of those throw an error,
// none of them fail a test, and all of them make a firefight feel wrong.
//
// So this runs a real engagement and instruments every entity for the
// pathologies that are invisible from the outside.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-ai', { recursive: true });

const SECONDS = Number(process.argv[2] || 45);
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

const run = async (layout, label) => {
  await page.evaluate(async (layout) => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    for (const s of S.roster) { s.hp = s.maxHp; s.status = 'healthy'; s.wound = null; }
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: layout, layout, siteName: 'Audit',
        party: { id: 'a', kind: 'scrappers', name: 'Audit', strength: 16, tier: 2, quality: 0.8 } },
      squad: S.roster.slice(0, 5),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  }, layout);
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  return page.evaluate(async ({ seconds }) => {
    const Level = await import('/src/level.js');
    const m = window.KR.mission;
    const track = new Map();
    const note = (e) => {
      if (!track.has(e.id)) {
        track.set(e.id, {
          id: e.id, side: e.side, role: e.soldier?.role || 'enemy',
          lastX: e.x, lastZ: e.z, moved: 0,
          stuckFrames: 0, wantedToMove: 0,
          target: e.target?.id || null, switches: 0,
          shots: 0, losNoFire: 0, losFrames: 0,
          inCoverFrames: 0, engagedFrames: 0,
          overlaps: 0,
          minSep: 99,
        });
      }
      return track.get(e.id);
    };

    const shotsBefore = new Map();
    const frames = seconds * 60;
    for (let f = 0; f < frames; f++) {
      const alive = m.entities.filter((e) => !e.dead);
      for (const e of alive) {
        const t = note(e);
        const d = Math.hypot(e.x - t.lastX, e.z - t.lastZ);
        t.moved += d;
        // "Wanted to move but did not" — the signature of being wedged.
        const wants = !!(e.orderPoint || e.flankPoint
          || (e.side === 'enemy' && e.state === 'hunt'));
        if (wants) {
          t.wantedToMove++;
          if (d < 0.002) t.stuckFrames++;
        }
        t.lastX = e.x; t.lastZ = e.z;

        const tid = e.target?.id || null;
        if (tid !== t.target) { if (t.target && tid) t.switches++; t.target = tid; }

        if (e.target && !e.target.dead) {
          t.engagedFrames++;
          const los = Level.hasLOS(m.level.obstacles, e.x, e.z, e.target.x, e.target.z, 1.5);
          if (los) {
            t.losFrames++;
            const fired = (e.shotsFired || 0) > (shotsBefore.get(e.id) || 0);
            // Not firing is only a pathology when nothing is legitimately
            // stopping the shot. Reload and cooldown were already excluded;
            // burstRest and the first-contact reaction delay were not, and
            // between them they account for most of a soldier's time in a
            // firefight — burstRest alone is 1.0-2.6s between every burst.
            // Counting those read as "19 entities with a clear shot refusing
            // to take it" when the truth was "soldiers pacing their bursts",
            // which is the behaviour the design asks for.
            const paused = e.burstRest > 0
              || (e.reaction !== undefined && (e.seenFor || 0) < e.reaction);
            if (!fired && e.reloading <= 0 && e.cooldown <= 0 && !paused) t.losNoFire++;
          }
          // Standing in the open with a wall a couple of paces away.
          const cover = Level.findCover(m.level.obstacles, m.level.covers,
            e.x, e.z, e.target.x, e.target.z, 8);
          const inCover = !Level.hasLOS(m.level.obstacles, e.x, e.z, e.target.x, e.target.z, 1.5)
            || (cover && Math.hypot(cover.x - e.x, cover.z - e.z) < 1.5);
          if (inCover) t.inCoverFrames++;
        }
        shotsBefore.set(e.id, e.shotsFired || 0);

        // Bunching: how close does anybody actually get?
        for (const o of alive) {
          if (o === e) continue;
          const sep = Math.hypot(o.x - e.x, o.z - e.z);
          if (sep < t.minSep) t.minSep = sep;
          if (sep < 0.55) t.overlaps++;
        }
      }
      m.step(1 / 60);
    }

    const rows = [...track.values()].map((t) => ({
      side: t.side, role: t.role,
      moved: +t.moved.toFixed(1),
      stuckPct: t.wantedToMove ? Math.round((t.stuckFrames / t.wantedToMove) * 100) : 0,
      switchesPerMin: +((t.switches / (frames / 3600))).toFixed(1),
      idleLosPct: t.losFrames ? Math.round((t.losNoFire / t.losFrames) * 100) : 0,
      coverPct: t.engagedFrames ? Math.round((t.inCoverFrames / t.engagedFrames) * 100) : 0,
      overlapPct: Math.round((t.overlaps / frames) * 100),
      minSep: +t.minSep.toFixed(2),
    }));
    return {
      rows,
      alive: m.entities.filter((e) => !e.dead).length,
      enemiesLeft: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
    };
  }, { seconds: SECONDS });
};

const summarise = (label, res) => {
  const side = (s) => res.rows.filter((r) => r.side === s);
  const avg = (rows, k) => (rows.length
    ? +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(1) : 0);
  const worst = (rows, k) => (rows.length ? Math.max(...rows.map((r) => r[k])) : 0);
  console.log(`\n=== ${label} — ${SECONDS}s, ${res.enemiesLeft} hostiles left`);
  console.log('  side     n   moved  stuck%  switches/min  idleLOS%  cover%  overlap%  closest');
  for (const s of ['player', 'enemy']) {
    const rows = side(s);
    if (!rows.length) continue;
    console.log(`  ${s.padEnd(7)} ${String(rows.length).padStart(2)}`
      + ` ${String(avg(rows, 'moved')).padStart(7)}`
      + ` ${String(avg(rows, 'stuckPct')).padStart(7)}`
      + ` ${String(avg(rows, 'switchesPerMin')).padStart(13)}`
      + ` ${String(avg(rows, 'idleLosPct')).padStart(9)}`
      + ` ${String(avg(rows, 'coverPct')).padStart(7)}`
      + ` ${String(avg(rows, 'overlapPct')).padStart(9)}`
      + ` ${String(Math.min(...rows.map((r) => r.minSep))).padStart(8)}`);
  }
  console.log(`  worst individual: stuck ${worst(side('player').concat(side('enemy')), 'stuckPct')}%,`
    + ` idle-with-LOS ${worst(side('player').concat(side('enemy')), 'idleLosPct')}%,`
    + ` overlap ${worst(side('player').concat(side('enemy')), 'overlapPct')}%`);
  return res;
};

const results = {};
for (const [layout, label] of [['roadside', 'open ground'], ['settlement', 'a town'],
  ['depot', 'a depot']]) {
  results[layout] = summarise(label, await run(layout, label));
}

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

// What counts as a problem worth fixing.
const all = Object.values(results).flatMap((r) => r.rows);
const stuck = all.filter((r) => r.stuckPct > 25);
const thrash = all.filter((r) => r.switchesPerMin > 25);
const idle = all.filter((r) => r.idleLosPct > 60);
const bunched = all.filter((r) => r.overlapPct > 10);
console.log(`\n  ${stuck.length} entities wedged >25% of the time they wanted to move`);
console.log(`  ${thrash.length} switching targets more than 25x a minute`);
console.log(`  ${idle.length} with a clear shot but not taking it >60% of the time`);
console.log(`  ${bunched.length} standing inside somebody else >10% of the time`);
await browser.close();
