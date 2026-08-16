// Does the map clock actually have three settings?
//
// Time used to pass only while the company was physically moving, so waiting
// for anything — a contract to appear, a caravan to come home, a wound to close
// — meant driving in circles. This checks the fix in the only way worth
// checking it: by running the map for a fixed wall-clock stretch at each
// setting and measuring how much game time went by.
//
// Halted has to be exactly zero, not merely slow. A halt that still creeps is
// the bug that eats contract deadlines while the player reads a panel.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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

const clockOf = () => page.evaluate(() => {
  const S = window.KR.campaign;
  return S.day * 24 + S.hour;
});

// Measure elapsed game-hours over a fixed real interval at one setting.
const sample = async (speed, ms) => {
  await page.evaluate((s) => window.KR.world.setSpeed(s), speed);
  const a = await clockOf();
  await page.waitForTimeout(ms);
  const b = await clockOf();
  return b - a;
};

console.log('\n=== standing still ===');
const idle = {};
for (const s of [0, 1, 4]) idle[s] = await sample(s, 2500);
for (const s of [0, 1, 4]) {
  // Hours per second is abstract; "how long to wait out a day" is the number a
  // player actually experiences.
  const perSec = idle[s] / 2.5;
  console.log(`  speed ${s}: ${idle[s].toFixed(3)} game-hours per 2.5s`
    + (perSec > 0 ? `  — a day of waiting takes ${(24 / perSec).toFixed(0)}s` : '  — stopped'));
}

// ---- and while actually travelling ---------------------------------------
// Distance covered must scale too, otherwise fast-forward is a way to make
// journeys cost fewer hours — free travel by holding F.
console.log('\n=== travelling ===');
const trip = {};
for (const s of [1, 4]) {
  // Up the empty western edge, not across the middle: driving through populated
  // country means arriving somewhere or meeting somebody, which opens a panel
  // and pauses the world — and a paused world covers no distance in no hours.
  const r = await page.evaluate(async (sp) => {
    const S = window.KR.campaign;
    const W = window.KR.world;
    W.setSpeed(0);
    document.getElementById('overlay').classList.add('hidden');
    W.setPaused(false);
    S.pos.x = -2950; S.pos.z = -2000;
    const from = { x: S.pos.x, z: S.pos.z };
    W.setDestination(-2950, 2400);
    const t0 = S.day * 24 + S.hour;
    W.setSpeed(sp);
    await new Promise((res) => setTimeout(res, 2500));
    const d = Math.hypot(S.pos.x - from.x, S.pos.z - from.z);
    const t1 = S.day * 24 + S.hour;
    W.setSpeed(0);
    return { dist: d, hours: t1 - t0 };
  }, s);
  trip[s] = r;
  console.log(`  speed ${s}: ${r.dist.toFixed(0)} units in ${r.hours.toFixed(2)}h`
    + `  (${(r.dist / (r.hours || 1)).toFixed(1)} units/hour)`);
}

// ---- the HUD says which one is lit ---------------------------------------
console.log('\n=== the chips ===');
for (const s of [0, 1, 4]) {
  const lit = await page.evaluate((sp) => {
    window.KR.world.setSpeed(sp);
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      res([...document.getElementById('wh-spd').children]
        .filter((b) => b.classList.contains('on')).map((b) => b.dataset.spd));
    })));
  }, s);
  console.log(`  setSpeed(${s}) lights [${lit.join(',')}]`);
}

// A modal must read as halted even though the speed setting is untouched.
const underModal = await page.evaluate(() => {
  window.KR.world.setSpeed(1);
  window.KR.world.setPaused(true);
  return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
    res([...document.getElementById('wh-spd').children]
      .filter((b) => b.classList.contains('on')).map((b) => b.dataset.spd));
  })));
});
console.log(`  a panel open lights [${underModal.join(',')}]`);
await page.evaluate(() => window.KR.world.setPaused(false));

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);

const fails = [];
if (idle[0] !== 0) fails.push('halted still advances the clock');
if (!(idle[4] > idle[1] * 2)) fails.push('fast is not meaningfully faster than normal');
// Same road, same hours per unit, whatever speed you watched it at.
const rate1 = trip[1].dist / (trip[1].hours || 1);
const rate4 = trip[4].dist / (trip[4].hours || 1);
if (Math.abs(rate4 - rate1) / rate1 > 0.1) fails.push('fast-forward changes what a journey costs');
if (underModal.join() !== '0') fails.push('an open panel does not read as halted');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: three real settings, journeys cost the same');
await browser.close();
