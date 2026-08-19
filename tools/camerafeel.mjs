// Is the eye continuous?
//
// "One continuous eye" has been the claim in the comments since the tactical
// view was built, and the code was flipping a boolean. A cut and a move look
// identical in a still; what separates them is the SIZE OF THE LARGEST STEP
// between consecutive frames. A move has none bigger than a stride. A cut
// has exactly one enormous one.
//
// Also samples the lock-on rig: how far the framing travels as an opponent
// backs away, which is what keeps both men on screen.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]')
      || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (d) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(500);

const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Cam',
      party: { id: 'cm', kind: 'looters', name: 'Cam', strength: 8, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 6),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  for (const e of m.entities) e.inserting = false;
  const realStep = m.step.bind(m);
  m.step = () => {};
  const tick = (dt) => { realStep(dt); m.updateCamera(dt); };
  for (let i = 0; i < 60; i++) tick(1 / 60);

  // Largest single-frame jump across a transition, in metres.
  const sweep = (label, act, frames) => {
    const path = [];
    act();
    let last = m.camera.position.clone();
    let worst = 0;
    const start = m.camera.position.clone();
    for (let i = 0; i < frames; i++) {
      tick(1 / 60);
      const d = m.camera.position.distanceTo(last);
      if (d > worst) worst = d;
      last = m.camera.position.clone();
      if (i % 12 === 0) path.push(+m.camera.position.y.toFixed(1));
    }
    const travel = start.distanceTo(m.camera.position);
    return { label, worst: +worst.toFixed(2), heights: path, travel: +travel.toFixed(1) };
  };

  const out = [];
  out.push(sweep('line -> tactical', () => m.toggleTactical(), 90));
  out.push(sweep('tactical -> line', () => m.toggleTactical(), 90));

  // The lock rig: how the framing opens as he backs off.
  const p = m.player;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  foe.x = p.x + 2; foe.z = p.z;
  m.camYaw = Math.atan2(foe.x - p.x, foe.z - p.z) + Math.PI;
  m.toggleLock();
  // Hold the range: left alone he charges straight back in, so the far
  // sample was never actually taken at eight metres.
  const at = (d) => { foe.x = p.x + d; foe.z = p.z; };
  for (let i = 0; i < 60; i++) { at(2); tick(1 / 60); }
  const near = m.camLerp.back;
  for (let i = 0; i < 120; i++) { at(8); tick(1 / 60); }
  const far = m.camLerp.back;

  return { out, locked: !!m.lockOn, near: +near.toFixed(2), far: +far.toFixed(2) };
});

console.log('\nTRANSITIONS — largest single-frame move');
for (const o of r.out) {
  console.log(`  ${o.label.padEnd(18)} worst step ${String(o.worst).padStart(6)}m   `
    + `height ${o.heights.join(' -> ')}`);
}
console.log(`\nLOCK FRAMING — eye distance ${r.near}m at 2m range, ${r.far}m at 8m`);

const bad = [];
for (const o of r.out) {
  const frac = o.travel > 1 ? o.worst / o.travel : 0;
  if (frac > 0.15) bad.push(`${o.label}: one frame covers ${Math.round(frac*100)}% of the whole move — that is a cut`);
}
if (!r.locked) bad.push('lock did not hold');
if (!(r.far > r.near)) bad.push('the eye does not pull back as the duel opens');
console.log(bad.length ? `\nFAIL:\n  ${bad.join('\n  ')}` : '\nThe eye moves; it does not cut.');
await browser.close();
