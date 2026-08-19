// Kitting a soldier out.
//
// Loadout is where the money turns into fighting strength: pick a soldier,
// give them a weapon, armour and kit. It is reachable from the company panel
// and from a town, and nothing has ever opened it and checked that the slots
// fill, the prices read, and buying actually changes what the soldier carries.
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
const r = await page.evaluate(async () => {
  const UI = await import('/src/ui.js');
  const State = await import('/src/state.js');
  const S = window.KR.campaign;
  document.getElementById('overlay')?.classList.add('hidden');
  S.credits = 20000;
  if (typeof UI.loadoutPanel !== 'function') return { missing: Object.keys(UI).filter((k) => /load|kit|equip/i.test(k)) };
  UI.loadoutPanel(S, { onClose: () => {} });
  await new Promise((res) => setTimeout(res, 600));
  const m = document.querySelector('#modal');
  const open = m && !m.classList.contains('hidden');
  const body = open ? (m.querySelector('.modal-body') || m) : null;
  const txt = body ? body.textContent : '';
  const before = { weapon: S.roster[1]?.weapon, credits: S.credits };
  // Buy the first thing on offer and see whether it lands on the soldier.
  const buy = body?.querySelector('[data-buy]');
  const bought = buy ? buy.dataset.buy : null;
  if (buy) buy.click();
  await new Promise((res) => setTimeout(res, 500));
  return {
    open, title: open ? (m.querySelector('.modal-title')?.textContent || '').trim() : null,
    chars: txt.trim().length,
    slots: body ? body.querySelectorAll('[data-slot], .slot, .kit-slot').length : 0,
    offers: body ? body.querySelectorAll('[data-buy]').length : 0,
    nan: /NaN|undefined|Infinity|\[object/.test(txt),
    bought, before, after: { weapon: S.roster[1]?.weapon, credits: S.credits },
  };
});
if (r.missing) console.log('no loadoutPanel; UI exports matching load/kit/equip:', r.missing.join(', ') || 'none');
else {
  console.log(`loadout: open=${r.open ? 'yes' : 'NO'} "${r.title}" ${r.chars} chars`);
  console.log(`  slots ${r.slots}  purchasable ${r.offers}${r.nan ? '  BAD VALUES' : ''}`);
  console.log(`  clicked buy "${r.bought}" — credits ${r.before.credits} -> ${r.after.credits},`
    + ` soldier weapon ${r.before.weapon} -> ${r.after.weapon}`);
}
await page.screenshot({ path: process.argv[2] + '/k01-loadout.png' });
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
