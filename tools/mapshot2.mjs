// Photograph the world map with nothing on top of it.
//
// mapshot.mjs takes its picture whenever it happens to be ready, and since
// hostile bands now come looking for the company an encounter panel is often
// over the map by then — which dims the whole thing and makes the terrain
// impossible to judge. This clears panels, parks the company somewhere
// specific, and shoots at several zooms.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 20000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 20000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);

const clear = async () => page.evaluate(() => {
  // Nothing on top of the terrain, and nothing that will wander into range and
  // put something there while the shutter is open.
  document.getElementById('overlay').classList.add('hidden');
  window.KR.campaign.parties = [];
  window.KR.world.setPaused(true);
});

for (const [name, zoom, pos] of [
  ['wide', 2.4, { x: 0, z: 0 }],
  ['mid', 1.1, { x: 200, z: -230 }],
  ['close', 0.5, { x: 200, z: -230 }],
  ['rim', 1.4, { x: 1900, z: 1500 }],
]) {
  await clear();
  await page.evaluate(([z, p]) => {
    const W = window.KR.world;
    W.zoom = z;
    window.KR.campaign.pos.x = p.x;
    window.KR.campaign.pos.z = p.z;
    W.recentre();
    W.camInit = false;                 // snap rather than glide
    for (let i = 0; i < 30; i++) { W.updateCamera(0.016); W.render?.(); }
  }, [zoom, pos]);
  await page.waitForTimeout(700);
  await clear();
  await page.screenshot({ path: `qa/world-${name}.png` });
  console.log(`  qa/world-${name}.png`);
}
await browser.close();
