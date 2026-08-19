// Walk into a town the way the game walks into one.
//
// handleTownArea() lives inside main.js and is wired when the shell builds
// the visit — calling a Mission by hand skips it, which is why a hand-rolled
// probe reported every service panel as dead. So: stand on a settlement,
// press enter, and take whatever the game offers, screenshotting each step.
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
await page.evaluate(async () => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
  const { LOCATIONS } = await import('/src/data.js');
  const S = window.KR.campaign;
  const town = LOCATIONS.find((l) => l.kind === 'settlement') || LOCATIONS[0];
  S.pos.x = town.x; S.pos.z = town.z;
  S.credits = 5000;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForTimeout(1500);

let n = 0;
const shot = async (name) => {
  const f = `${OUT}/w${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: f });
  return f;
};
const readModal = () => page.evaluate(() => {
  const m = document.querySelector('#modal');
  const open = m && !m.classList.contains('hidden');
  if (!open) return { open: false };
  const body = m.querySelector('.modal-body') || m;
  const txt = (body.textContent || '');
  return {
    open: true,
    title: (m.querySelector('.modal-title')?.textContent || '').trim(),
    chars: txt.trim().length,
    // Every button the panel offers, so the walk can follow them.
    acts: [...m.querySelectorAll('[data-x]')].map((b) => ({
      x: b.dataset.x, t: (b.textContent || '').trim().slice(0, 20) })),
    nan: /NaN|undefined|Infinity|\[object/.test(txt),
  };
});

const first = await readModal();
await shot('settlement');
console.log(`entered: "${first.title}" — ${first.chars} chars`);
console.log('  offers: ' + (first.acts || []).map((a) => `${a.x}(${a.t})`).join(' '));
if (first.nan) console.log('  !! BAD VALUES IN TEXT');

// Follow every verb the settlement offers, one at a time, returning after each.
for (const act of (first.acts || [])) {
  if (/close|cancel|leave/i.test(act.x)) continue;
  const before = errors.length;
  await page.evaluate((x) => document.querySelector(`#modal [data-x="${x}"]`)?.click(), act.x);
  await page.waitForTimeout(800);
  const st = await readModal();
  const f = await shot(act.x);
  console.log(`  ${act.x.padEnd(12)} -> ${st.open ? `"${st.title}"` : 'nothing opened'}`
    + ` ${String(st.chars || 0).padStart(5)} chars`
    + `${st.nan ? '  BAD VALUES' : ''}`
    + `${errors.length > before ? '  ERRORS ' + (errors.length - before) : ''}`);
  // Back to the settlement panel for the next verb.
  await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const c = m?.querySelector('[data-x="close"]') || m?.querySelector('[data-x="back"]');
    if (c) c.click(); else m?.classList.add('hidden');
  });
  await page.waitForTimeout(500);
  const still = await readModal();
  if (!still.open) {
    await page.evaluate(() => window.KR.dev.enterLocation());
    await page.waitForTimeout(900);
  }
}
fs.writeFileSync(`${OUT}/townreal-errors.txt`, [...new Set(errors)].join('\n') || 'none');
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
await browser.close();
