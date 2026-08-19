// How big can a battle get?
//
// perf.mjs answers "where does the frame go" at one size. This answers the
// other question the overhaul has to settle: how many bodies can be on the
// field before the game stops being playable, now that every one of them
// swings steel, holds a slot in a formation, carries nerve, and walks ground
// that charges for its slopes.
//
// It sweeps sizes rather than measuring one, because the shape of the curve
// is the finding — a system that degrades gently has a different answer than
// one with a cliff, and only a sweep tells you which you have.
//
// Run:  node tools/scale.mjs [framesPerStep]
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const FRAMES = Number(process.argv[2] || 240);
const SIZES = [40, 80, 120, 160, 200];

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });

const rows = [];
for (const size of SIZES) {
  const row = await page.evaluate(async ({ FRAMES, size }) => {
    const { Mission } = await import('/src/mission.js');
    const State = window.KR.dev.State;
    const S = State.newCampaign(4242);
    window.KR.campaign = S;
    S.renown = 4000;
    // A real melee company: line, spears, bows.
    const kit = ['rifleman', 'rifleman', 'gunner', 'marksman'];
    S.roster.slice(0, 4).forEach((s, i) => {
      s.role = kit[i];
      s.weapon = { rifleman: 'sword', gunner: 'spear', marksman: 'bow' }[kit[i]];
    });

    window.KR.mission?.dispose();
    const m = new Mission({
      campaign: S,
      // THE APPROACHES: the widest ground, two hosts, tactical camera. This
      // is the load the overhaul actually has to carry.
      spec: { type: 'skirmish', site: 'field', layout: 'field', siteName: 'SCALE',
        enemyFaction: 'trust',
        party: { id: 'sc', kind: 'column_trust', name: 'SC', strength: size,
          tier: 4, quality: 0.9 },
        allies: Math.round(size * 0.7), allyFaction: 'syndic' },
      squad: State.ready(S).slice(0, 4),
      container: document.getElementById('viewport'),
      onHud() {}, onToast() {}, onIntro() {}, onWheel() {}, onEnd() {},
    });
    window.KR.mission = m;
    await m.start();
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

    // Fill to the requested size and make sure it is a FIGHT, not a parade.
    let guard = 0;
    while (m.entities.filter((e) => !e.dead).length < size && guard++ < 200) {
      const a = Math.random() * Math.PI * 2;
      m.reinforce(Math.cos(a) * 50, Math.sin(a) * 50,
        ['rifleman', 'gunner', 'marksman', 'breacher'][guard % 4]);
    }
    for (const e of m.entities) {
      if (e.side === 'enemy' && !e.dead) m.sendHunting(e, m.player.x, m.player.z, 600);
      // Nobody routs during a measurement: a shrinking battle measures the
      // wrong thing, and this is a frame-cost probe, not a balance probe.
      e.nerve = 999;
    }
    m.setSquadOrder('charge');
    // Measured from the tactical camera, the way a commander plays it.
    m.rts = true;
    m.rtsFocus = { x: 0, z: 0 };
    m.rtsVel = { x: 0, z: 0 };
    m.rtsZoom = 60; m.rtsZoomT = 60;

    const entities = m.entities.filter((e) => !e.dead).length;
    const step = [], draw = [];
    for (let i = 0; i < FRAMES; i++) {
      for (const e of m.entities) e.nerve = 999;      // keep the field full
      const t0 = performance.now();
      m.step(1 / 60);
      m.syncVisuals(1 / 60);
      const t1 = performance.now();
      m.updateCamera(1 / 60);
      m.renderer.render(m.scene, m.camera);
      const t2 = performance.now();
      step.push(t1 - t0);
      draw.push(t2 - t1);
    }
    const stat = (a) => {
      const s = a.slice().sort((x, y) => x - y);
      return {
        p50: +s[Math.floor(s.length * 0.5)].toFixed(2),
        p95: +s[Math.floor(s.length * 0.95)].toFixed(2),
      };
    };
    const info = m.renderer.info;
    const out = {
      entities,
      arrows: m.arrows.length,
      step: stat(step),
      draw: stat(draw),
      calls: info.render.calls,
      tris: info.render.triangles,
    };
    m.dispose();
    return out;
  }, { FRAMES, size });
  const total = +(row.step.p50 + row.draw.p50).toFixed(2);
  const fps = Math.round(1000 / Math.max(0.01, total));
  rows.push({ ...row, total, fps });
  console.log(
    `${String(row.entities).padStart(4)} bodies  `
    + `sim ${String(row.step.p50).padStart(6)}ms (p95 ${String(row.step.p95).padStart(6)})  `
    + `draw ${String(row.draw.p50).padStart(6)}ms  `
    + `= ${String(total).padStart(6)}ms  ~${String(fps).padStart(3)}fps  `
    + `calls ${row.calls}`);
}

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
