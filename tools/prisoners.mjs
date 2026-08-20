// Press them or let them go.
//
// The spoils screen has two halves: the kit, which was rebuilt this round,
// and the people, which was not. Pressing a prisoner is free manpower paid
// for in morale; releasing one is the opposite. Both live on the screen I
// just changed, so both need walking — a rebuilt render that quietly
// stopped wiring the prisoner buttons would look perfect and do nothing.
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

const setup = await page.evaluate(async () => {
  const UI = await import('/src/ui.js');
  const S = window.KR.campaign;
  document.getElementById('overlay')?.classList.add('hidden');
  S.prisoners = S.prisoners || [];
  const mk = (id, name, role) => ({ id, name, role, captiveFaction: 'trust', hp: 40 });
  S.prisoners.push(mk('pz1', 'Corvo Tallis', 'Swordsman'), mk('pz2', 'Wren Halloway', 'Archer'));
  const result = {
    fieldSpoils: [{ id: 'spear', pool: 'armoury' }],
    captives: ['pz1', 'pz2'],
  };
  window.__res = result;
  UI.spoilsPanel(S, result, { onClose: () => { window.__closed = true; } });
  await new Promise((r) => setTimeout(r, 600));
  const m = document.querySelector('#modal');
  return {
    open: !!m && !m.classList.contains('hidden'),
    title: (m?.querySelector('.modal-title')?.textContent || '').trim(),
    press: (m?.querySelectorAll('[data-cap-press]') || []).length,
    free: (m?.querySelectorAll('[data-cap-free]') || []).length,
    spoilPieces: (m?.querySelectorAll('[data-spoil]') || []).length,
    roster: S.roster.length, morale: S.morale, prisoners: S.prisoners.length,
  };
});
console.log(`spoils screen: "${setup.title}" open=${setup.open}`);
console.log(`  ${setup.spoilPieces} piece(s) of kit, ${setup.press} press buttons, ${setup.free} release buttons`);
console.log(`  before: roster ${setup.roster}, morale ${setup.morale}, prisoners ${setup.prisoners}`);
await page.screenshot({ path: `${OUT}/pr01-spoils.png` });

const pressed = await page.evaluate(async () => {
  const S = window.KR.campaign;
  document.querySelector('#modal [data-cap-press]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  return { roster: S.roster.length, morale: S.morale, prisoners: S.prisoners.length,
    stillPress: (document.querySelectorAll('#modal [data-cap-press]') || []).length };
});
console.log(`\npressed one: roster ${setup.roster}->${pressed.roster}`
  + `  morale ${setup.morale}->${pressed.morale}  prisoners ${setup.prisoners}->${pressed.prisoners}`
  + `  ${pressed.roster > setup.roster ? 'OK — they joined' : 'NOTHING HAPPENED'}`);

const freed = await page.evaluate(async () => {
  const S = window.KR.campaign;
  document.querySelector('#modal [data-cap-free]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  return { roster: S.roster.length, morale: S.morale, prisoners: S.prisoners.length };
});
console.log(`released one: roster ${pressed.roster}->${freed.roster}`
  + `  morale ${pressed.morale}->${freed.morale}  prisoners ${pressed.prisoners}->${freed.prisoners}`
  + `  ${freed.prisoners < pressed.prisoners ? 'OK — they went' : 'NOTHING HAPPENED'}`);

// And the kit half still banks on the way out, after all that re-rendering.
const out = await page.evaluate(async () => {
  const S = window.KR.campaign;
  document.querySelector('#modal [data-x="close"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  return { closed: !!window.__closed, staged: JSON.stringify(S.spoils?.armoury || {}),
    kept: window.__res.fieldSpoilsKept };
});
console.log(`\nleaving: closed=${out.closed}  kept ${out.kept} piece(s)  staged armoury ${out.staged}`);
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
