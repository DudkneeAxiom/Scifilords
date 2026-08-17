// Where does the frame actually go?
//
// Two rounds of work have quietly added per-frame cost in places that were free
// when the ground was flat: hasLOS() now samples the terrain along every
// sightline, acquire() calls it once per candidate per think, findCover() calls
// it once per candidate cover, and every character samples the ground four more
// times to find the slope it is standing on. Each of those is defensible on its
// own and nobody has measured them together.
//
// This separates the simulation from the render, because they have completely
// different fixes, and counts the calls underneath so the number points at
// something. Run it before optimising anything.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const FRAMES = Number(process.argv[2] || 400);
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });

const out = await page.evaluate(async (FRAMES) => {
  const { Mission } = await import('/src/mission.js');
  const Level = await import('/src/level.js');
  const State = window.KR.dev.State;
  const S = State.newCampaign(12345);
  window.KR.campaign = S;
  S.renown = 4000;

  const m = new Mission({
    campaign: S,
    // A heavy contract: the big field, the big garrison, the worst case.
    spec: { type: 'sabotage', site: 'grellan', layout: 'array', strength: 60 },
    squad: State.ready(S).slice(0, 4),
    container: document.getElementById('viewport'),
    onHud() {}, onToast() {}, onIntro() {}, onWheel() {}, onEnd() {},
  });
  await m.start();
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

  // Fill the field. A contract spec alone does not reliably produce a big
  // fight, and the whole question here is what happens at forty combatants.
  let guard = 0;
  while (m.entities.filter((e) => !e.dead).length < 40 && guard++ < 60) {
    const a = Math.random() * Math.PI * 2;
    m.reinforce(Math.cos(a) * 55, Math.sin(a) * 55, 'rifleman');
  }
  // Wake everybody up so this measures a firefight and not a stroll.
  for (const e of m.entities) {
    if (e.side === 'enemy' && !e.dead) m.sendHunting(e, m.player.x, m.player.z, 600);
  }

  const entities = m.entities.filter((e) => !e.dead).length;

  // Phase timings, by wrapping the class's own methods. The geometry helpers
  // live in an ES module namespace whose bindings are immutable, so they cannot
  // be wrapped from out here — an earlier version of this probe tried and
  // silently counted zero of everything, which looked like "the terrain work is
  // free" rather than "the instrument is not attached".
  const phase = { ai: 0, visuals: 0 };
  const proto = Object.getPrototypeOf(m);
  const realEnemy = proto.updateEnemy;
  const realFriendly = proto.updateFriendly;
  const realSync = proto.syncVisuals;
  proto.updateEnemy = function (...a) {
    const t = performance.now(); const v = realEnemy.apply(this, a);
    phase.ai += performance.now() - t; return v;
  };
  proto.updateFriendly = function (...a) {
    const t = performance.now(); const v = realFriendly.apply(this, a);
    phase.ai += performance.now() - t; return v;
  };
  proto.syncVisuals = function (...a) {
    const t = performance.now(); const v = realSync.apply(this, a);
    phase.visuals += performance.now() - t; return v;
  };

  const stepMs = [];
  const drawMs = [];
  for (let i = 0; i < FRAMES; i++) {
    const t0 = performance.now();
    m.step(1 / 60);
    // syncVisuals runs in loop(), not step() — the same trap the handoff
    // records for updateCamera. Stepping alone never animates anybody, so the
    // per-character ground sampling costs nothing and looks free.
    m.syncVisuals(1 / 60);
    const t1 = performance.now();
    m.updateCamera(1 / 60);
    m.renderer.render(m.scene, m.camera);
    const t2 = performance.now();
    stepMs.push(t1 - t0);
    drawMs.push(t2 - t1);
  }

  proto.updateEnemy = realEnemy;
  proto.updateFriendly = realFriendly;
  proto.syncVisuals = realSync;

  const stat = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    return {
      mean: +(a.reduce((p, c) => p + c, 0) / a.length).toFixed(2),
      p50: +s[Math.floor(s.length * 0.5)].toFixed(2),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(2),
      max: +s[s.length - 1].toFixed(2),
    };
  };

  return {
    entities,
    obstacles: m.level.obstacles.length,
    covers: m.level.covers.length,
    step: stat(stepMs),
    draw: stat(drawMs),
    phase: {
      ai: +(phase.ai / FRAMES).toFixed(3),
      visuals: +(phase.visuals / FRAMES).toFixed(3),
    },
    info: {
      calls: m.renderer.info.render.calls,
      triangles: m.renderer.info.render.triangles,
    },
  };
}, FRAMES);

console.log(`\n${out.entities} combatants, ${out.obstacles} obstacles, ${out.covers} covers`);
console.log(`\n  simulation   mean ${out.step.mean}ms  p50 ${out.step.p50}  p95 ${out.step.p95}  max ${out.step.max}`);
console.log(`  render       mean ${out.draw.mean}ms  p50 ${out.draw.p50}  p95 ${out.draw.p95}  max ${out.draw.max}`);
console.log(`  of the simulation: AI ${out.phase.ai}ms, character visuals ${out.phase.visuals}ms`);
console.log(`\n  draw calls ${out.info.calls}, triangles ${out.info.triangles}`);
console.log('\n  NOTE: render ms is software rasterised (swiftshader) and says nothing');
console.log('  about frame rate on a real GPU. Draw calls and triangles do.');
// --------------------------------------------------------------------------
// The other clock.
//
// The world tick got more expensive this round: every hostile band now asks
// whether it fancies the company, which costs an estimateFight(), and every
// band checks whether it is near a garrisoned holding. Both are hoisted out of
// the per-band loop, and this is the check that they stayed hoisted — the
// failure mode is quadratic in parties times holdings and it will not show up
// on a new campaign with eleven bands and no ground.
// --------------------------------------------------------------------------
const world = await page.evaluate(() => {
  const State = window.KR.dev.State;
  const run = (parties, holdings) => {
    const S = State.newCampaign(999);
    for (const id of ['grellan', 'perran', 'rampart', 'vetch', 'sump'].slice(0, holdings)) {
      State.seizeLocation(S, id);
      // Somebody in it, so garrisonStrength() does real work rather than
      // returning zero on the first line.
      const spare = State.ready(S).filter((s) => !s.isCommander);
      if (spare[0]) State.stationSoldier(S, id, spare[0].id);
    }
    while (S.parties.length < parties) {
      S.parties.push({ ...S.parties[0], id: `p${S.parties.length}`,
        x: (Math.random() - 0.5) * 900, z: (Math.random() - 0.5) * 900 });
    }
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) State.advanceTime(S, 0.25);
    return +((performance.now() - t0) / 400).toFixed(4);
  };
  return {
    small: run(12, 0),
    many: run(60, 0),
    manyHeld: run(60, 5),
  };
});

console.log('\nWorld tick, ms per advanceTime(0.25h):');
console.log(`  12 bands, no holdings   ${world.small}ms`);
console.log(`  60 bands, no holdings   ${world.many}ms`);
console.log(`  60 bands, 5 garrisons   ${world.manyHeld}ms`);
console.log(`  scaling 12->60 bands: ${(world.many / world.small).toFixed(1)}x for 5x the parties`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

await browser.close();
