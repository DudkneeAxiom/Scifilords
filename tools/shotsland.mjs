// The new landforms, from the tactical eye — the view that shows whether a
// battlefield has anything on it worth manoeuvring around.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa', { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const done = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]')
      || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (done) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(600);

for (const site of ['roadside', 'quarry', 'array', 'works']) {
  const relief = await page.evaluate(async (layout) => {
    const { Mission } = await import('/src/mission.js');
    const Level = await import('/src/level.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    G.mission?.dispose(); G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: G.campaign,
      spec: { type: 'skirmish', site: layout, layout, siteName: layout.toUpperCase(),
        party: { id: 'ls', kind: 'scrappers', name: 'Land', strength: 28, tier: 3, quality: 0.8 } },
      squad: G.campaign.roster.slice(0, 12),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    m.step = () => {};
    document.getElementById('overlay')?.classList.add('hidden');
    // Open the tactical eye, which is the view the complaint is about.
    m.tactical = true;
    if (m.setTactical) m.setTactical(true);

    // How much relief this ground actually has, sampled across it.
    const B = m.level.bounds;
    let lo = Infinity, hi = -Infinity;
    for (let x = -B; x <= B; x += B / 12) {
      for (let z = -B; z <= B; z += B / 12) {
        const h = Level.heightAt(x, z);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    return { bounds: B, relief: +(hi - lo).toFixed(1) };
  }, site);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `qa/land-${site}.png` });
  console.log(`${site.padEnd(10)} bounds ${relief.bounds}m  relief ${relief.relief}m`);
}
await browser.close();
