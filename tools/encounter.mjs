// Meeting somebody on the road, and every way out of it.
//
// Travel, run a party down, and decide what to do about it — the loop
// between every deployment. Each option gets a FRESH encounter in a fresh
// page: the first draft reused one meeting and the second option onwards
// found no panel to click, reporting four undefined results that looked
// like three dead buttons.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const OUT = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });

async function meet(pick) {
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
  await page.waitForTimeout(800);
  const staged = await page.evaluate(async () => {
    const UI = await import('/src/ui.js');
    const S = window.KR.campaign, W = window.KR.world;
    const p = S.parties.find((x) => x.strength > 0 && x.hostileToPlayer)
      || S.parties.find((x) => x.strength > 0);
    if (!p) return null;
    p.x = S.pos.x + 60; p.z = S.pos.z + 40;
    W.stopTravel(); W.setDestination(p.x, p.z);
    for (let i = 0; i < 3000; i++) {
      if (UI.modalOpen && UI.modalOpen()) break;
      p.x = S.pos.x + 18; p.z = S.pos.z + 12;
      W.update(0.2);
    }
    await new Promise((r) => setTimeout(r, 700));
    const m = document.querySelector('#modal');
    return {
      party: `${p.name || p.kind} (${Math.round(p.strength)})`,
      open: !!m && !m.classList.contains('hidden'),
      title: (m?.querySelector('.modal-title')?.textContent || '').trim(),
      acts: [...(m?.querySelectorAll('[data-x]') || [])].map((b) => ({
        x: b.dataset.x, t: (b.textContent || '').trim().slice(0, 24) })),
      credits: S.credits, roster: S.roster.length, day: S.day,
    };
  });
  if (!staged || !staged.open) { await page.close(); return { failed: true, errors }; }
  if (!pick) { await page.close(); return { staged, errors }; }

  const before = errors.length;
  const res = await page.evaluate(async (x) => {
    const el = document.querySelector(`#modal [data-x="${x}"]`);
    if (!el) return { missing: true };
    el.click();
    await new Promise((r) => setTimeout(r, 1400));
    const m = document.querySelector('#modal');
    const open = m && !m.classList.contains('hidden');
    const S = window.KR.campaign;
    return {
      screen: window.KR.screen, mission: !!window.KR.mission,
      open, title: open ? (m.querySelector('.modal-title')?.textContent || '').trim() : null,
      body: open ? (m.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) : '',
      credits: S.credits, roster: S.roster.length, day: S.day,
    };
  }, pick);
  await page.screenshot({ path: `${OUT}/e-${pick}.png` });
  await page.close();
  return { staged, pick, res, errs: errors.length - before, errors };
}

const first = await meet(null);
if (first.failed) { console.log('no encounter could be staged'); await browser.close(); process.exit(0); }
console.log(`met: ${first.staged.party} — "${first.staged.title}"`);
console.log(`offers: ${first.staged.acts.map((a) => `${a.x}(${a.t})`).join('  ')}\n`);
console.log('option      screen   mission  panel                 credits  roster  day');
for (const a of first.staged.acts) {
  let r = await meet(a.x);
  for (let k = 0; k < 4 && (r.failed || !r.res || r.res.missing); k++) r = await meet(a.x);
  if (r.failed || !r.res || r.res.missing) { console.log(`${a.x.padEnd(11)} could not be exercised`); continue; }
  const b = r.staged, e = r.res;
  console.log(`${a.x.padEnd(11)} ${String(e.screen).padEnd(8)} ${String(e.mission).padEnd(8)}`
    + ` ${String(e.title || '—').padEnd(21)} ${String(b.credits).padStart(4)}->${String(e.credits).padEnd(5)}`
    + ` ${b.roster}->${e.roster}    ${b.day}->${e.day}`
    + (r.errs ? `  ERRORS ${r.errs}` : ''));
  if (e.body) console.log(`            "${e.body}"`);
}
await browser.close();
