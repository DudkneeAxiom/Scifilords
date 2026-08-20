// From the field to a soldier's hands.
//
// Kept spoils are staged in S.spoils and only reach the company when the
// equipment screen claims them. That is the last link in the chain the
// spoils decision starts, and if it is broken everything the player chose
// to keep sits in a bag nobody ever opens. This walks the whole way: stage
// a take, claim it, and check the stores actually grew.
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
const staged = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const S = window.KR.campaign;
  document.getElementById('overlay')?.classList.add('hidden');
  // Exactly what the spoils screen does with a kept piece.
  State.addSpoils(S, 'armoury', 'heavy', 1);
  State.addSpoils(S, 'kitPool', 'medkit', 2);
  State.addSpoils(S, 'armourPool', 'body_carrier', 1);
  return {
    bag: JSON.stringify(S.spoils),
    stores: { armoury: JSON.stringify(S.armoury), kitPool: JSON.stringify(S.kitPool || {}) },
    hasSpoils: State.hasSpoils(S),
  };
});
console.log(`staged in the bag: ${staged.bag}`);
console.log(`  stores before claiming: armoury ${staged.stores.armoury}`);
console.log(`  hasSpoils flag: ${staged.hasSpoils}`);

// Open the equipment screen and find the way to claim.
const opened = await page.evaluate(async () => {
  const UI = await import('/src/ui.js');
  const S = window.KR.campaign;
  if (typeof UI.characterPanel !== 'function') return { missing: true };
  UI.characterPanel(S, { onClose: () => {} });
  await new Promise((r) => setTimeout(r, 600));
  const m = document.querySelector('#modal');
  const txt = (m?.textContent || '');
  return {
    open: !!m && !m.classList.contains('hidden'),
    mentionsSpoils: /spoil|stripped|claim|field/i.test(txt),
    claimAll: !!m?.querySelector('[data-x="claimall"]'),
    perItem: (m?.querySelectorAll('[data-claim]') || []).length,
    buttons: [...(m?.querySelectorAll('[data-x]') || [])].map((b) => b.dataset.x).join(' '),
  };
});
if (opened.missing) { console.log('no loadoutPanel'); await browser.close(); process.exit(0); }
console.log(`\nequipment screen: open=${opened.open} mentions the take=${opened.mentionsSpoils}`);
console.log(`  claim-all button: ${opened.claimAll}  per-item claims: ${opened.perItem}`);
console.log(`  buttons: ${opened.buttons}`);
await page.screenshot({ path: `${OUT}/c01-equipment.png` });

const claimed = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const S = window.KR.campaign;
  const btn = document.querySelector('#modal [data-x="claimall"]');
  if (btn) btn.click(); else State.claimSpoils(S);
  await new Promise((r) => setTimeout(r, 500));
  return {
    viaButton: !!btn,
    bag: JSON.stringify(S.spoils),
    armoury: JSON.stringify(S.armoury),
    kitPool: JSON.stringify(S.kitPool || {}),
    armourPool: JSON.stringify(S.armourPool || {}),
  };
});
console.log(`\nclaimed ${claimed.viaButton ? 'with the screen button' : 'through claimSpoils() directly'}`);
console.log(`  bag after:    ${claimed.bag}`);
console.log(`  armoury:      ${claimed.armoury}`);
console.log(`  kitPool:      ${claimed.kitPool}`);
console.log(`  armourPool:   ${claimed.armourPool}`);
const gotHeavy = /"heavy":\s*[1-9]/.test(claimed.armoury);
const gotKits = /"medkit":\s*[1-9]/.test(claimed.kitPool);
console.log(`\n  the kept weapon reached the armoury: ${gotHeavy ? 'yes' : 'NO'}`);
console.log(`  the kept kit reached the stores:     ${gotKits ? 'yes' : 'NO'}`);
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
