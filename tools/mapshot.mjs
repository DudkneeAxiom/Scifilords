// Fast iteration on the strategic camera: boot, start, screenshot the map.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
  const S = window.KR.campaign;
  S.contracts[0].accepted = true;
  // Centre of the basin, so the framing test is not biased by a rim position.
  S.pos.x = 0; S.pos.z = 0;
});
await page.waitForTimeout(1800);
await page.screenshot({ path: 'qa/map-centre.png' });
await page.evaluate(() => { const S = window.KR.campaign; S.pos.x = 40; S.pos.z = 250; });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'qa/map-vetch.png' });
console.log('wrote qa/map-centre.png and qa/map-vetch.png');
await browser.close();
