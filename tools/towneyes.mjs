// The panels you spend money in.
//
// The town walk was verified as "every person is reachable and opens
// something". What that something LOOKS like has never been checked, and
// these are the screens the whole economy passes through — the market, the
// posting board, the hiring agent, the medic. A panel that opens with an
// empty list, a price of NaN, or a column off the edge is invisible to any
// test that only asks whether it opened.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const OUT = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1000);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(600);
}
await page.evaluate(() => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
});
await page.waitForTimeout(1200);

// Walk into a real settlement and speak to everybody in it.
const areas = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const { LOCATIONS } = await import('/src/data.js');
  const G = window.KR, S = G.campaign;
  const town = LOCATIONS.find((l) => l.kind === 'settlement') || LOCATIONS[0];
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  document.getElementById('viewport').classList.remove('world-framed');
  document.getElementById('wh-side')?.classList.remove('framed');
  document.getElementById('worldhud')?.classList.remove('framed');
  UI.show('hud');
  const opened = [];
  G.mission = new Mission({ campaign: S,
    spec: { type: 'visit', site: town.id, layout: town.layout || 'settlement', siteName: town.name,
      services: town.services || ['market', 'board', 'recruit', 'medical'], hasFavour: true,
      favourWho: 'The syndic' },
    squad: S.roster.slice(0, 3), container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {}, onWheel: () => {},
    onArea: (a) => { opened.push(a); UI.openArea?.(a, S, {}); },
    onEnd: () => {} });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true; m.inserting = false;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  window.__areas = opened;
  return m.interactables.filter((i) => i.kind === 'area').map((i) => i.area);
});
console.log('services in this town:', areas.join(', ') || 'NONE');

let n = 0;
for (const a of areas) {
  const before = errors.length;
  // Open each one the way walking into the person does.
  const info = await page.evaluate(async (area) => {
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const it = G.mission.interactables.find((x) => x.area === area);
    if (!it) return { missing: true };
    G.mission.completeInteraction(it);
    await new Promise((r) => setTimeout(r, 400));
    const m = document.querySelector('#modal');
    const open = m && !m.classList.contains('hidden');
    const body = open ? (m.querySelector('.modal-body') || m) : null;
    const txt = body ? (body.textContent || '') : '';
    return {
      open, title: open ? (m.querySelector('.modal-title')?.textContent || '').trim() : null,
      chars: txt.trim().length,
      buys: body ? body.querySelectorAll('[data-buy], [data-hire], [data-take], .card, .row').length : 0,
      // The things that make a shop look broken.
      nan: /NaN|undefined|Infinity|\[object/.test(txt),
      empty: /nothing (here|on offer|to)|no stock|empty/i.test(txt),
    };
  }, a);
  const f = `${OUT}/t${String(++n).padStart(2, '0')}-${a}.png`;
  await page.screenshot({ path: f });
  console.log(`  ${a.padEnd(9)} open=${info.open ? 'yes' : 'NO '} "${(info.title || '').slice(0, 22).padEnd(22)}"`
    + ` chars ${String(info.chars).padStart(5)} items ${String(info.buys).padStart(3)}`
    + `${info.nan ? '  BAD VALUES' : ''}${info.empty ? '  reads empty' : ''}`
    + `${errors.length > before ? '  ERRORS ' + (errors.length - before) : ''}`);
  await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const c = m?.querySelector('[data-x="close"]');
    if (c) c.click(); else m?.classList.add('hidden');
  });
  await page.waitForTimeout(250);
}
fs.writeFileSync(`${OUT}/town-errors.txt`, [...new Set(errors)].join('\n') || 'none');
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 5).join('\n') : '\nno console errors');
await browser.close();
