// Is a fight winnable by fighting it well?
//
// "Challenging but winnable" is not one number. Charging twelve guns in the
// open should kill you and always will; that is not the question. The question
// is whether a player who does the tactical things — holds at range, keeps
// something between themselves and the enemy, and uses the squad — comes out
// ahead of one who does not.
//
// So this runs the same engagement three ways and compares them. If the careful
// version does not clearly beat the careless one, the combat is not tactical,
// whatever the individual numbers say.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const TRIALS = Number(process.argv[2] || 6);
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
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
await page.evaluate((baseline) => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
  window.__baseline = baseline;
}, process.argv.includes('--baseline'));

const trial = (style, i) => page.evaluate(async ({ style, i }) => {
  const { Mission } = await import('/src/mission.js');
  const Level = await import('/src/level.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  for (const s of S.roster) { s.hp = s.maxHp; s.status = 'healthy'; s.wound = null; }
  S.stats.missions = i;                       // independent dice per trial
  G.mission?.dispose();
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'T',
      party: { id: 't', kind: 'scrappers', name: 'T', strength: 10, tier: 2, quality: 0.75 } },
    squad: S.roster.slice(0, 5),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

  const foes = () => m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  const start = foes().length;

  // Put the player where the style says.
  const centre = () => {
    const f = foes();
    if (!f.length) return null;
    return {
      x: f.reduce((a, e) => a + e.x, 0) / f.length,
      z: f.reduce((a, e) => a + e.z, 0) / f.length,
    };
  };
  const c0 = centre() || { x: 0, z: 0 };
  const ang = Math.atan2(m.player.x - c0.x, m.player.z - c0.z);

  if (style === 'charge') {
    // Straight at them, in the open.
    m.player.x = c0.x + Math.sin(ang) * 10;
    m.player.z = c0.z + Math.cos(ang) * 10;
  } else {
    // Hold at rifle range.
    m.player.x = c0.x + Math.sin(ang) * 30;
    m.player.z = c0.z + Math.cos(ang) * 30;
    if (style === 'cover') {
      // Put something between us and them.
      const cov = Level.findCover(m.level.obstacles, m.level.covers,
        m.player.x, m.player.z, c0.x, c0.z, 22);
      if (cov) { m.player.x = cov.x; m.player.z = cov.z; }
    }
  }
  // The squad forms on the commander either way.
  m.squad.forEach((s, k) => {
    s.x = m.player.x + (k - 2) * 2.2;
    s.z = m.player.z + 2.0;
    if (style === 'cover') { s.order = 'hold'; s.orderPoint = { x: s.x, z: s.z }; }
  });

  // The commander has to actually fight. Without this the probe measured a
  // stationary dummy who never pulled the trigger and then concluded that
  // combat was unwinnable — which it duly was, for that dummy.
  const nearest = () => {
    let best = null; let bd = 1e9;
    for (const e of foes()) {
      const d = Math.hypot(e.x - m.player.x, e.z - m.player.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  for (let f = 0; f < 90 * 60 && !m.over; f++) {
    const t = nearest();
    if (t) {
      // Look at them, settle the camera so aimPoint is honest, and fire.
      m.camYaw = Math.atan2(t.x - m.player.x, t.z - m.player.z) + Math.PI;
      m.camPitch = 0;
      m.updateCamera(1 / 60);
      m.mouse.down = true;
      m.aiming = true;
    }
    if (style === 'cover' && f === 60 && t) {
      // The one order that is supposed to matter.
      m.marked = null;
      m.selection.clear();
      m.orderSuppress({ entity: t, x: t.x, z: t.z });
    }
    m.step(1 / 60);
  }

  const squadAlive = m.squad.filter((e) => !e.dead && !e.down).length;
  return {
    style,
    killed: start - foes().length,
    start,
    playerHp: Math.max(0, Math.round(m.player.hp)),
    playerDown: !!m.player.down,
    squadAlive,
    squadStart: m.squad.length,
    seconds: +m.time.toFixed(0),
  };
}, { style, i });

const styles = ['charge', 'standoff', 'cover'];
const runs = {};
for (const s of styles) runs[s] = [];
for (let i = 0; i < TRIALS; i++) {
  for (const s of styles) runs[s].push(await trial(s, i * 7 + styles.indexOf(s)));
}

const mean = (rows, k) => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(1);
console.log(`\n${TRIALS} runs of each approach against ten scrappers:\n`);
console.log('  approach   killed  commander down  squad left  commander HP');
for (const s of styles) {
  const r = runs[s];
  console.log(`  ${s.padEnd(10)} ${String(mean(r, 'killed')).padStart(6)}`
    + `  ${String(r.filter((x) => x.playerDown).length + '/' + TRIALS).padStart(14)}`
    + `  ${String(mean(r, 'squadAlive')).padStart(10)}`
    + `  ${String(mean(r, 'playerHp')).padStart(12)}`);
}

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const charge = runs.charge;
const cover = runs.cover;
const downRate = (r) => r.filter((x) => x.playerDown).length / r.length;
// Charging must be punished, and fighting properly must be survivable.
const killsBetter = mean(cover, 'killed') > mean(charge, 'killed');
const standoffBetter = mean(runs.standoff, 'killed') > mean(charge, 'killed');
const ok = killsBetter && standoffBetter && errors.length === 0;
console.log(ok
  ? '\nOK — charging gets you killed, holding at range behind cover is survivable and kills them.'
  : '\nFAIL — how you fight does not decide how it goes.');
await browser.close();
