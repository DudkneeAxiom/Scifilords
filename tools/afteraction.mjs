// The screen at the end of a fight.
//
// Winning and losing both end in a report — what it cost, who came back,
// what was taken off the field. It is the last thing a player reads before
// returning to the map, and it is built from the casualty resolution that
// nothing has ever looked at. This finishes a real deployment and reads the
// report, both ways.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
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
for (const win of [true, false]) {
  await page.evaluate(async () => {
    document.getElementById('overlay')?.classList.add('hidden');
    window.KR.world?.setPaused(false);
    const { LOCATIONS } = await import('/src/data.js');
    const S = window.KR.campaign;
    const here = LOCATIONS.find((l) => l.id === 'grellan') || LOCATIONS[0];
    S.contracts.forEach((c) => { c.accepted = false; });
    S.contracts.push({ id: 'aa_' + S.day, type: 'skirmish', site: here.id, employer: 'syndic',
      title: 'After action', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
    S.pos.x = here.x; S.pos.z = here.z;
    window.KR.world.stopTravel();
    window.KR.dev.enterLocation();
  });
  await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
  await page.waitForFunction(() => window.KR.mission && !window.KR.mission.intro?.active
    && !window.KR.mission.inserting, null, { timeout: 60000 });
  // Settle it, one way or the other.
  await page.evaluate((w) => {
    const m = window.KR.mission;
    m.paused = false;
    if (w) for (const e of m.entities) { if (e.side === 'enemy') { e.dead = true; e.hp = 0; } }
    else for (const e of m.entities) { if (e.side === 'player') { e.dead = true; e.hp = 0; e.down = false; } }
    m.endMission(w, w ? 'carried' : 'wiped');
  }, win);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const open = m && !m.classList.contains('hidden');
    const body = open ? (m.querySelector('.modal-body') || m) : null;
    const txt = body ? (body.textContent || '') : '';
    return { open, title: open ? (m.querySelector('.modal-title')?.textContent || '').trim() : null,
      chars: txt.trim().length,
      nan: /NaN|undefined|Infinity|\[object/.test(txt),
      acts: [...(m?.querySelectorAll('[data-x]') || [])].map((b) => b.dataset.x),
      snippet: txt.replace(/\s+/g, ' ').trim().slice(0, 150) };
  });
  await page.screenshot({ path: `${process.argv[2]}/aa-${win ? 'win' : 'loss'}.png` });
  console.log(`\n${win ? 'VICTORY' : 'DEFEAT'}: panel=${r.open ? `"${r.title}"` : 'NONE'} ${r.chars} chars`
    + `${r.nan ? '  BAD VALUES' : ''}`);
  console.log(`  buttons: ${r.acts.join(' ') || 'none'}`);
  console.log(`  "${r.snippet}"`);
  // Back to the map for the next one.
  await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const c = m?.querySelector('[data-x="close"]') || m?.querySelector('[data-x="ok"]')
      || m?.querySelector('[data-x]');
    if (c) c.click();
  });
  await page.waitForTimeout(2000);
}
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 5).join('\n') : '\nno console errors');
await browser.close();
