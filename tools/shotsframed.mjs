// The framed world screen: map window, company board, campaign feed.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1400);
for (let i = 0; i < 6; i++) {
  const done = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (done) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(1600);

const geom = await page.evaluate(() => {
  const r = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  return { viewport: r('viewport'), side: r('wh-side'), feed: r('wh-feed'), win: [innerWidth, innerHeight] };
});
console.log(JSON.stringify(geom, null, 2));

await page.screenshot({ path: 'qa/framed-world.png' });
for (const tab of ['company', 'stores', 'standing']) {
  await page.evaluate((t) => window.KR.dev.UI.showSideTab(window.KR.campaign, t), tab);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `qa/framed-${tab}.png` });
}
await page.evaluate(() => document.getElementById('side-wide')?.click());
 await page.waitForTimeout(900);
 await page.screenshot({ path: 'qa/framed-wide.png' });
 await browser.close();
console.log('wrote qa/framed-*.png');
