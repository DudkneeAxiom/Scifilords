// The order wheel, opened and read.
//
// Every order lives on this wheel and the letters are only shortcuts for
// people who already know them — so for a new player the wheel IS the
// command system. It has never been opened and looked at. This holds the
// middle mouse, photographs what comes up, and checks each slice names an
// order and says what it does.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
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
  const here = LOCATIONS.find((l) => l.id === 'grellan') || LOCATIONS[0];
  S.contracts.forEach((c) => { c.accepted = false; });
  S.contracts.push({ id: 'wh_1', type: 'skirmish', site: here.id, employer: 'syndic',
    title: 'Wheel', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
  S.pos.x = here.x; S.pos.z = here.z;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
await page.waitForFunction(() => window.KR.mission && !window.KR.mission.intro?.active
  && !window.KR.mission.inserting, null, { timeout: 60000 });
await page.evaluate(() => { const m = window.KR.mission; m.paused = false; m.hadLock = true; });
await page.waitForTimeout(1200);

// Open it the way the game does, then read it.
await page.evaluate(() => window.KR.mission.openWheel());
await page.waitForTimeout(700);
const w = await page.evaluate(() => {
  const el = document.getElementById('wheel');
  const open = el && !el.classList.contains('hidden');
  const svg = document.getElementById('wheel-svg');
  return {
    open,
    who: (document.getElementById('wheel-who')?.textContent || '').trim(),
    pick: (document.getElementById('wheel-pick')?.textContent || '').trim(),
    desc: (document.getElementById('wheel-desc')?.textContent || '').trim(),
    slices: svg ? svg.querySelectorAll('path, g').length : 0,
    labels: svg ? [...svg.querySelectorAll('text')].map((t) => t.textContent.trim()).filter(Boolean) : [],
    slowed: window.KR.mission.wheelOpen === true || !!window.KR.mission.wheel,
  };
});
await page.screenshot({ path: `${OUT}/w-wheel.png` });
console.log(`wheel: open=${w.open}  who="${w.who}"  ${w.slices} shapes, ${w.labels.length} labels`);
console.log(`  orders: ${w.labels.join(' | ') || 'NONE'}`);
console.log(`  centre reads: "${w.pick}" — "${w.desc}"`);

// Hover each slice and confirm the centre names it and explains it.
const n = await page.evaluate(async () => {
  const m = window.KR.mission;
  const out = [];
  const list = m.wheelItems || m.wheelOrders || [];
  for (let i = 0; i < list.length; i++) {
    if (m.setWheelPick) m.setWheelPick(i);
    else if (m.wheelPick !== undefined) m.wheelPick = i;
    await new Promise((r) => setTimeout(r, 60));
    out.push({
      i, name: (document.getElementById('wheel-pick')?.textContent || '').trim(),
      desc: (document.getElementById('wheel-desc')?.textContent || '').trim(),
    });
  }
  return out;
});
if (n.length) {
  console.log('\n  hovering each slice:');
  for (const o of n) console.log(`    ${String(o.i).padStart(2)}  ${o.name.padEnd(16)} ${o.desc.slice(0, 52)}`);
} else console.log('\n  (wheel items are not exposed by name; read the picture)');
await page.evaluate(() => window.KR.mission.closeWheel(false));
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
