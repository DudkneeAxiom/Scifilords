// Can a company actually become an army?
//
// The deploy ceiling is an army number and the starting roster was four,
// which meant every encounter for the first several hours was four bodies
// pretending to be a battle line. Raising the ceiling did nothing on its own;
// what matters is the curve BETWEEN them — how long a player has to spend
// visiting towns and paying wages before they can form the three arms the
// combat overhaul is built around.
//
// This plays the recruiting loop: travel the Reach, take everyone a town will
// put forward that you can afford, pay the bill every day, and report the
// company you actually have.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const done = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]')
      || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (done) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(600);

const r = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const { DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const rows = [];

  const towns = DATA.LOCATIONS.filter((l) => l.kind !== 'open');
  let ti = 0;
  // A player earns as they go; without SOME income this measures poverty
  // rather than recruiting. One contract's worth every three days, at the
  // rate the campaign actually pays a company of this standing.
  for (let day = 1; day <= 60; day++) {
    const loc = towns[ti++ % towns.length];
    S.atLocation = loc.id;
    S.pos.x = loc.x; S.pos.z = loc.z;
    const pool = State.recruitPool(S, loc.id);
    for (const cand of pool) {
      const res = State.hire(S, cand);
      if (!res || res.ok === false) break;
    }
    if (day % 3 === 0) S.credits += Math.round(600 * State.payScale(S));
    State.advanceTime(S, 24);
    if (day % 10 === 0) {
      const up = State.upkeepOf(S);
      rows.push({
        day, roster: State.living(S).length, credits: Math.round(S.credits),
        wages: up.wages, deploy: State.deployLimit(S), renown: Math.round(S.renown || 0),
      });
    }
  }
  return { rows, start: 0 };
});

console.log('\n day   company  deploy   credits   wages/day');
for (const row of r.rows) {
  console.log(`  ${String(row.day).padStart(3)}   ${String(row.roster).padStart(7)}  `
    + `${String(row.deploy).padStart(6)}   ${String(row.credits).padStart(7)}   ${row.wages}`);
}
if (errors.length) console.log('\nerrors:\n  ' + [...new Set(errors)].slice(0, 6).join('\n  '));
await browser.close();
