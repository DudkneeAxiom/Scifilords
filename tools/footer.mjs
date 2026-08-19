// The three buttons along the bottom.
//
// The sweep says clicking EQUIPMENT, ENTER <TOWN> and MENU changes nothing.
// Each is a primary verb — your kit, going inside, and the game menu — so
// "nothing happened" is either three dead buttons or three wrong clicks.
// This presses each one by its element and by its keyboard shortcut, and
// reports what the game did in response.
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
await page.evaluate(() => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
});
await page.waitForTimeout(1500);

const snap = () => page.evaluate(() => ({
  screen: window.KR.screen || null,
  modal: !!(document.querySelector('#modal') && !document.querySelector('#modal').classList.contains('hidden')),
  modalTitle: (document.querySelector('#modal .modal-title')?.textContent || '').trim(),
  overlay: !document.getElementById('overlay')?.classList.contains('hidden'),
  mission: !!window.KR.mission,
  sideTitle: (document.querySelector('#wh-side')?.textContent || '').trim().slice(0, 22),
}));

// The footer buttons, found by their text rather than by position.
const btns = await page.evaluate(() => [...document.querySelectorAll('#worldhud button, #worldhud [data-x], #worldhud .clickable')]
  .map((el, i) => ({ i, text: (el.textContent || '').trim().replace(/\s+/g, ' ') }))
  .filter((b) => /EQUIPMENT|ENTER|MENU/i.test(b.text)));

for (const b of btns) {
  const before = await snap();
  const eb = errors.length;
  await page.evaluate((i) => {
    const el = [...document.querySelectorAll('#worldhud button, #worldhud [data-x], #worldhud .clickable')][i];
    el.click();
  }, b.i);
  await page.waitForTimeout(900);
  const after = await snap();
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  console.log(`click "${b.text}"`.padEnd(34) + (changed ? 'CHANGED' : 'no change')
    + `  screen=${after.screen} modal=${after.modal ? '"' + after.modalTitle + '"' : 'no'}`
    + ` mission=${after.mission}` + (errors.length > eb ? `  ERRORS ${errors.length - eb}` : ''));
  // Put it back if something opened.
  await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const c = m?.querySelector('[data-x="close"]');
    if (c) c.click(); else m?.classList.add('hidden');
  });
  await page.waitForTimeout(400);
}

// And the keyboard shortcuts the labels advertise.
for (const [key, label] of [['v', 'V (equipment)'], ['e', 'E (enter)'], ['Escape', 'ESC (menu)']]) {
  const before = await snap();
  const eb = errors.length;
  await page.keyboard.press(key);
  await page.waitForTimeout(900);
  const after = await snap();
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  console.log(`key ${label}`.padEnd(34) + (changed ? 'CHANGED' : 'no change')
    + `  screen=${after.screen} modal=${after.modal ? '"' + after.modalTitle + '"' : 'no'}`
    + ` mission=${after.mission}` + (errors.length > eb ? `  ERRORS ${errors.length - eb}` : ''));
  await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const c = m?.querySelector('[data-x="close"]');
    if (c) c.click(); else m?.classList.add('hidden');
  });
  await page.waitForTimeout(400);
}
console.log(errors.length ? '\nerrors:\n' + [...new Set(errors)].slice(0, 5).join('\n') : '\nno console errors');
await browser.close();
