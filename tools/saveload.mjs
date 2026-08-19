// Does CONTINUE bring your company back?
//
// The title screen offers CONTINUE, greyed out until there is something to
// continue. Nothing has ever checked that the button works across a real
// page reload — which is the only way a player ever uses it. This plays a
// little, saves, reloads the browser, presses CONTINUE, and compares the
// company that comes back against the one that went away.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });

const continueState = () => page.evaluate(() => {
  const b = document.querySelector('button[data-act="continue"]')
    || [...document.querySelectorAll('#title button')].find((x) => /continue/i.test(x.textContent));
  if (!b) return 'NO BUTTON';
  return b.disabled || b.classList.contains('disabled') ? 'disabled' : 'enabled';
});
console.log(`fresh browser, CONTINUE is ${await continueState()}`);

await page.click('button[data-act="new"]');
await page.waitForTimeout(1000);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(600);
}
// Make the campaign distinctive, then let the game save the way it does.
const before = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  document.getElementById('overlay')?.classList.add('hidden');
  const S = window.KR.campaign;
  window.KR.world?.setPaused(false);
  S.credits = 7777;
  S.renown = 321;
  State.advanceTime(S, 48);
  if (State.saveCampaign) State.saveCampaign(S);
  return { credits: S.credits, renown: S.renown, day: S.day,
    roster: S.roster.length, name: S.roster[0]?.name || null,
    saved: !!State.saveCampaign };
});
console.log(`played a little: day ${before.day}, ${before.credits} credits, renown ${before.renown},`
  + ` ${before.roster} on the books, first soldier ${before.name}`);

// A REAL reload — not a re-import. This is what closing the tab does.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
console.log(`after reload, CONTINUE is ${await continueState()}`);

const clicked = await page.evaluate(() => {
  const b = document.querySelector('button[data-act="continue"]')
    || [...document.querySelectorAll('#title button')].find((x) => /continue/i.test(x.textContent));
  if (!b || b.disabled || b.classList.contains('disabled')) return false;
  b.click(); return true;
});
if (!clicked) { console.log('  CONTINUE could not be pressed'); }
else {
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => {
    const S = window.KR.campaign;
    if (!S) return null;
    return { credits: S.credits, renown: S.renown, day: S.day,
      roster: S.roster.length, name: S.roster[0]?.name || null, screen: window.KR.screen };
  });
  if (!after) console.log('  no campaign after CONTINUE');
  else {
    const same = (k) => before[k] === after[k];
    console.log(`restored: day ${after.day}, ${after.credits} credits, renown ${after.renown},`
      + ` ${after.roster} on the books, first soldier ${after.name} (screen ${after.screen})`);
    const bad = ['credits', 'renown', 'day', 'roster', 'name'].filter((k) => !same(k));
    console.log(bad.length ? `  MISMATCH on: ${bad.map((k) => `${k} ${before[k]} -> ${after[k]}`).join(', ')}`
      : '  everything came back identical');
  }
}
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 5).join('\n') : '\nno console errors');
await browser.close();
