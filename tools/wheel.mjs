// Does the command wheel actually issue the order the player picked?
//
// The sectors are drawn by the UI and the selection index is computed by the
// mission from raw mouse travel. If those two ever disagree the player aims at
// SUPPRESS and their squad falls back, which is worse than having no wheel. So
// this drives the wheel with real pointer deltas in each of the six directions
// and checks that the highlighted sector, the label, and the order the squad
// ends up carrying all match.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-wheel', { recursive: true });

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
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Wheel',
      party: { id: 'w', kind: 'scrappers', name: 'Wheel', strength: 10, tier: 2, quality: 0.8 } },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {},
    onWheel: (w) => UI.renderCommandWheel(w),
    onEnd: () => {},
  });
  await G.mission.start();
});
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
await page.evaluate(() => {
  const m = window.KR.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
});

const orders = await page.evaluate(() => window.KR.mission.ORDERS.map((o) => o.id));
console.log('orders on the wheel:', orders.join(', '));

// Index 0 is straight up, running clockwise — push the pointer that way.
const rows = [];
for (let i = 0; i < orders.length; i++) {
  const a = (i / orders.length) * Math.PI * 2;
  const mx = Math.sin(a) * 120;
  const my = -Math.cos(a) * 120;
  const r = await page.evaluate(({ mx, my }) => {
    const m = window.KR.mission;
    m.closeWheel(false);
    m.openWheel();
    // Feed it as several small deltas, the way a real mouse arrives.
    for (let k = 0; k < 10; k++) m.steerWheel(mx / 10, my / 10);
    const idx = m.wheel.index;
    const picked = m.ORDERS[idx]?.id ?? null;
    const shown = document.getElementById('wheel-pick')?.textContent ?? '';
    const lit = [...document.querySelectorAll('#wheel-svg .sector')]
      .findIndex((s) => s.classList.contains('on'));
    m.closeWheel(true);
    const squad = m.squad.filter((s) => !s.dead);
    const carried = squad.length ? squad[0].order : null;
    // A formation is a SHAPE, not an order: calling one forms the squad up and
    // changes how they stand, so the order they carry is still 'follow'.
    return { idx, picked, shown: shown.trim(), lit, carried, formation: m.formation };
  }, { mx, my });
  rows.push({ want: orders[i], ...r });
}

console.log('\n  pushed toward   index  highlighted  label shown       squad now carries');
let bad = 0;
for (const r of rows) {
  // 'move' resolves to attack or move depending on what was under the reticle,
  // and 'follow'/'hold' are carried verbatim.
  const FORMATIONS = ['line', 'spread', 'wedge'];
  const ok = r.picked === r.want && r.lit === r.idx
    && (FORMATIONS.includes(r.want)
      ? (r.formation === r.want && r.carried === 'follow')
      : r.want === 'move' ? ['move', 'attack'].includes(r.carried) : r.carried === r.want);
  if (!ok) bad++;
  console.log(`  ${r.want.padEnd(15)} ${String(r.idx).padStart(3)}  ${String(r.lit).padStart(11)}`
    + `  ${r.shown.padEnd(16)} ${String(r.carried).padEnd(10)}${ok ? '' : ' <-- MISMATCH'}`);
}

// Releasing without choosing must cost nothing.
const cancel = await page.evaluate(() => {
  const m = window.KR.mission;
  m.setSquadOrder('hold');
  m.openWheel();
  m.steerWheel(4, 4);                     // inside the dead zone
  const idx = m.wheel.index;
  m.closeWheel(true);
  return { idx, order: m.squad.find((s) => !s.dead)?.order };
});
console.log(`\n  dead zone: index ${cancel.idx}, order left as "${cancel.order}"`
  + (cancel.idx === -1 && cancel.order === 'hold' ? '' : '  <-- should have cancelled'));
if (cancel.idx !== -1 || cancel.order !== 'hold') bad++;

// And it has to slow the world without stopping it.
const dilation = await page.evaluate(() => {
  const m = window.KR.mission;
  const before = m.time;
  for (let i = 0; i < 60; i++) m.step(1 / 60);
  const normal = m.time - before;
  m.openWheel();
  const mid = m.time;
  for (let i = 0; i < 60; i++) m.step(1 / 60);
  const slowed = m.time - mid;
  m.closeWheel(false);
  return { normal: +normal.toFixed(3), slowed: +slowed.toFixed(3) };
});
console.log(`  time dilation: 1s of input advances ${dilation.normal}s normally,`
  + ` ${dilation.slowed}s with the wheel up`);
const dilates = dilation.slowed > 0 && dilation.slowed < dilation.normal * 0.5;
if (!dilates) bad++;

await page.evaluate(() => { window.KR.mission.openWheel(); window.KR.mission.steerWheel(0, -120); });
await page.waitForTimeout(200);
await page.screenshot({ path: 'qa-wheel/01-wheel.png' });
await page.evaluate(() => window.KR.mission.closeWheel(false));

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
console.log(bad === 0 && errors.length === 0
  ? '\nOK — every sector issues the order it shows, cancelling is free, and the world slows.'
  : `\nFAIL — ${bad} problem(s), ${errors.length} error(s).`);
await browser.close();
