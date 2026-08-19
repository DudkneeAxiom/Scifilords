// The town, walked.
//
// Every probe in this tree fights. The visit scene is a whole mission type
// that never fights — traders, a posting clerk, a hiring agent, a medic, a
// notable with a favour, and a gate watch to see you out — and nothing has
// ever walked it. It is also the type most likely to rot quietly, because
// it is built from the services a settlement happens to offer and those are
// campaign data that keeps changing.
//
// So: enter a town, walk to every person in it, speak to each, and check
// that each one opens what it promises and that the gate lets you leave.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const { LOCATIONS } = await import('/src/data.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = ''; UI.show('hud');
  // A real settlement, with whatever services the data says it staffs.
  const town = LOCATIONS.find((l) => l.kind === 'settlement') || LOCATIONS[0];
  const areasOpened = [];
  let ended = null;
  G.mission = new Mission({ campaign: S,
    spec: { type: 'visit', site: town.id, layout: town.layout || 'settlement',
      siteName: town.name, services: town.services || ['market', 'board', 'recruit', 'medical'],
      hasFavour: true, favourWho: 'The syndic' },
    squad: S.roster.slice(0, 3), container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {},
    onArea: (a) => areasOpened.push(a),
    onEnd: (o) => { ended = o && (o.outcome || 'ended'); } });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true; m.inserting = false;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  for (const e of m.entities) e.inserting = false;
  const realStep = m.step.bind(m); m.step = () => {};

  const people = m.interactables.map((it) => ({
    kind: it.kind, area: it.area || null, label: it.label || null,
    hasEntity: !!it.entity, x: it.x, z: it.z,
  }));
  // Walk to each in turn and speak. A town that cannot be walked is the
  // failure this is looking for, so movement is real rather than teleported.
  const visited = [];
  for (const it of m.interactables.slice()) {
    let steps = 0;
    while (steps++ < 3000) {
      const dx = it.x - m.player.x, dz = it.z - m.player.z, d = Math.hypot(dx, dz);
      if (d <= 1.3) break;
      m.player.x += (dx / d) * 5.6 / 60; m.player.z += (dz / d) * 5.6 / 60;
      realStep(1 / 60);
    }
    const reached = Math.hypot(it.x - m.player.x, it.z - m.player.z) <= 1.5;
    const before = areasOpened.length;
    if (reached) m.completeInteraction(it);
    visited.push({ label: it.label || it.kind, reached,
      opened: areasOpened.length > before ? areasOpened[areasOpened.length - 1] : null });
  }
  // And nobody in a town should be swinging at anybody.
  const armed = m.entities.filter((e) => !e.dead && e.side === 'enemy').length;
  return { town: m.level.name, people, visited, areasOpened, armed,
    civilians: m.entities.filter((e) => e.side === 'civil').length, ended };
});

console.log(`${r.town} — ${r.civilians} people, ${r.armed} hostiles\n`);
for (const v of r.visited) {
  console.log(`  ${v.reached ? 'reached' : 'UNREACHABLE'}  ${String(v.label).padEnd(34)}`
    + ` opened=${v.opened || '-'}`);
}
console.log(`\nareas opened: ${r.areasOpened.join(', ') || 'NONE'}`);
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n')
  : '\nno console errors');
await browser.close();
