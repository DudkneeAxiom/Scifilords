// Do different places actually fight differently?
//
// Two questions. First the visual one: a fight in a town should look like a
// town. Second, and more important, the mechanical one — every layout in this
// game hand-places its defenders and its patrol routes, and for a long time
// none of that reached the mission, so every site spawned the same ring of six
// around the objective. This renders each layout and reports where its
// defenders actually stood.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-sites', { recursive: true });

const LAYOUTS = ['settlement', 'works', 'array', 'outpost', 'reclaimer', 'roadside', 'depot'];
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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

const rows = [];
for (const layout of LAYOUTS) {
  await page.evaluate(async (layout) => {
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
      campaign: S,
      spec: { type: 'sabotage', site: layout, layout, siteName: layout.toUpperCase() },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
  }, layout);
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
    const o = m.level.objectivePoint;
    // If the authored posts are being ignored, every defender sits on a circle
    // of exactly one radius around the objective. Spread of the radii is the
    // tell.
    const radii = foes.map((e) => Math.hypot(e.x - o.x, e.z - o.z));
    const mean = radii.reduce((a, b) => a + b, 0) / (radii.length || 1);
    const spread = Math.max(...radii) - Math.min(...radii);
    return {
      name: m.level.name,
      // Triangles of scenery in hundreds, not scene children. Dressing is baked
      // into one mesh per model now, so counting children reports "2" for a
      // fully dressed site — and would go on reporting 2 if every rock on it
      // disappeared. Geometry is the thing; children is a proxy that just
      // stopped tracking it.
      props: (() => {
        let tris = 0;
        m.level.group.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          const g = o.geometry;
          tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
        });
        return Math.round(tris / 100);
      })(),
      obstacles: m.level.obstacles.length,
      tall: m.level.obstacles.filter((x) => x.h > 2.4).length,
      foes: foes.length,
      patrolling: foes.filter((e) => e.patrol && e.patrol.length).length,
      authored: !!(m.level.garrison && m.level.garrison.length),
      meanR: +mean.toFixed(1),
      spreadR: +spread.toFixed(1),
    };
  });
  rows.push({ layout, ...r });

  // Look down the site from the player's approach.
  await page.evaluate(() => {
    const m = window.KR.mission;
    const o = m.level.objectivePoint;
    m.player.x = o.x; m.player.z = o.z + 34;
    m.camYaw = 0; m.camPitch = 0.30;
    for (let i = 0; i < 8; i++) m.step(1 / 60);
    m.loop();
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `qa-sites/${layout}.png` });
}

console.log('  layout       name              props  solid  tall  foes  patrol  posts   mean r  spread');
for (const r of rows) {
  console.log(`  ${r.layout.padEnd(12)} ${r.name.padEnd(17)} ${String(r.props).padStart(5)}`
    + ` ${String(r.obstacles).padStart(6)} ${String(r.tall).padStart(5)}`
    + ` ${String(r.foes).padStart(5)} ${String(r.patrolling).padStart(7)}`
    + ` ${(r.authored ? 'yes' : 'NO').padStart(6)} ${String(r.meanR).padStart(7)}`
    + ` ${String(r.spreadR).padStart(7)}`);
}

const noPosts = rows.filter((r) => !r.authored);
const ringed = rows.filter((r) => r.spreadR < 3);
const noPatrols = rows.filter((r) => r.patrolling === 0);
console.log(`\n  ${noPosts.length} layouts with no authored garrison,`
  + ` ${ringed.length} still spawning on a bare ring, ${noPatrols.length} with no patrols`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
const ok = noPosts.length === 0 && ringed.length === 0 && noPatrols.length === 0
  && errors.length === 0;
console.log(ok
  ? '\nOK — every site fields the defenders it was authored with, patrols included.'
  : '\nFAIL — some sites are still falling back to the generic ring.');
await browser.close();
