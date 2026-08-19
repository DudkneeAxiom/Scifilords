// Press everything.
//
// "Test every function" means the buttons, not the simulation. This walks
// the shell and clicks every control it can find — the side rail, the
// footer, every tab inside every panel — screenshotting each state and
// recording anything the console says. A panel that opens empty, a tab that
// throws, a button that does nothing: all of it shows up here and nowhere
// in the acceptance suite, which drives the model rather than the interface.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const OUT = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });

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

let n = 0;
const rows = [];
const closeAny = async () => {
  await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const b = m?.querySelector('[data-x="close"]');
    if (b) b.click(); else if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
    document.getElementById('overlay')?.classList.add('hidden');
  });
  await page.waitForTimeout(200);
};

// What the shell is offering right now: the side rail and the footer.
const controls = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('#worldhud button, #worldhud [data-x], #worldhud .clickable, .rail-btn, [data-rail]')) {
    const b = el.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    out.push({
      label: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) || el.className,
      x: b.x + b.width / 2, y: b.y + b.height / 2,
    });
  }
  return out;
});
console.log(`${controls.length} controls on the world screen\n`);

for (const c of controls) {
  const before = errors.length;
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const modalOpen = m && !m.classList.contains('hidden');
    const side = document.querySelector('#wh-side');
    const host = modalOpen ? (m.querySelector('.modal-body') || m) : side;
    const title = modalOpen
      ? (m.querySelector('.modal-title')?.textContent || '').trim()
      : (side?.querySelector('.sp-title, h2, h3, .panel-title')?.textContent || '').trim();
    return {
      open: !!host, where: modalOpen ? 'modal' : 'side', title,
      // A panel that opens EMPTY is the failure worth catching.
      chars: host ? (host.textContent || '').trim().length : 0,
      rows: host ? host.querySelectorAll('.row, .card, li, tr, .sb-row, .rst-row, .pers-row, button').length : 0,
      tabs: host ? [...host.querySelectorAll('[data-tab]')].map((t) => t.dataset.tab) : [],
    };
  });
  const file = `${OUT}/c${String(++n).padStart(2, '0')}-${c.label.replace(/[^a-z0-9]+/gi, '-').slice(0, 20)}.png`;
  await page.screenshot({ path: file });
  rows.push({ ctrl: c.label, ...state, errs: errors.length - before, file });

  // And every tab inside whatever opened.
  for (const t of state.tabs) {
    const eb = errors.length;
    const clicked = await page.evaluate((tab) => {
      const el = document.querySelector(`#modal [data-tab="${tab}"]`);
      if (!el) return false; el.click(); return true;
    }, t);
    if (!clicked) continue;
    await page.waitForTimeout(500);
    const ts = await page.evaluate(() => {
      const m = document.querySelector('#modal');
      const body = m?.querySelector('.modal-body') || m;
      return { chars: (body?.textContent || '').trim().length,
        rows: body ? body.querySelectorAll('.row, .card, li, tr, .sb-row, .rst-row').length : 0 };
    });
    const tf = `${OUT}/c${String(n).padStart(2, '0')}-tab-${t.replace(/[^a-z0-9]+/gi, '-').slice(0, 14)}.png`;
    await page.screenshot({ path: tf });
    rows.push({ ctrl: `   tab:${t}`, open: true, title: null, ...ts, tabs: [], errs: errors.length - eb, file: tf });
  }
  await closeAny();
}

console.log('control                  where  title                     chars  rows  errors');
for (const r of rows) {
  console.log(`${r.ctrl.padEnd(24)} ${String(r.where || '-').padEnd(6)}`
    + ` ${String(r.title || '').padEnd(25).slice(0, 25)} ${String(r.chars).padStart(5)}`
    + ` ${String(r.rows).padStart(5)}  ${r.errs ? 'ERR ' + r.errs : ''}`);
}
fs.writeFileSync(`${OUT}/clickall-errors.txt`, [...new Set(errors)].join('\n') || 'none');
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
await browser.close();
