// Does the settlement panel fit in the window?
//
// Dolmet Station offers eleven verbs. Photographed at 1440x900 the list runs
// to the bottom edge of the panel and something below it is sliced in half —
// which, if the footer button is what is being cut, means the way out of the
// panel is partly off the screen. Short windows are common; this measures
// the panel at several heights.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
for (const [w, h] of [[1440, 900], [1280, 720], [1600, 1000]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
  await page.click('button[data-act="new"]');
  await page.waitForTimeout(900);
  for (let i = 0; i < 6; i++) {
    const d = await page.evaluate(() => { const m = document.querySelector('#modal');
      if (!m || m.classList.contains('hidden')) return true;
      const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
      if (b) { b.click(); return false; } return true; });
    if (d) break; await page.waitForTimeout(600);
  }
  await page.evaluate(async () => {
    document.getElementById('overlay')?.classList.add('hidden');
    window.KR.world?.setPaused(false);
    const { LOCATIONS } = await import('/src/data.js');
    const S = window.KR.campaign;
    const town = LOCATIONS.find((l) => l.kind === 'settlement') || LOCATIONS[0];
    S.pos.x = town.x; S.pos.z = town.z;
    window.KR.world.stopTravel();
    window.KR.dev.enterLocation();
  });
  await page.waitForTimeout(1400);
  const r = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return { none: true };
    const inner = m.querySelector('.modal') || m;
    const box = inner.getBoundingClientRect();
    const body = m.querySelector('.modal-body');
    const foot = m.querySelector('.modal-foot');
    const bb = body?.getBoundingClientRect();
    const fb = foot?.getBoundingClientRect();
    // Every clickable choice, and whether the window actually shows it.
    const opts = [...m.querySelectorAll('.opt, .choice, [data-o], [data-act], button')]
      .map((o) => ({ t: (o.textContent || '').trim().split('\n')[0].slice(0, 26),
        bottom: o.getBoundingClientRect().bottom }));
    const offscreen = opts.filter((o) => o.bottom > innerHeight - 1);
    return {
      win: `${innerWidth}x${innerHeight}`,
      modal: `${box.width.toFixed(0)}x${box.height.toFixed(0)} top ${box.top.toFixed(0)} bottom ${box.bottom.toFixed(0)}`,
      scroller: inner === m ? '#modal' : '.modal',
      canScroll: inner.scrollHeight > inner.clientHeight + 2,
      hidden: Math.max(0, inner.scrollHeight - inner.clientHeight),
      overflowY: getComputedStyle(inner).overflowY,
      maxH: getComputedStyle(inner).maxHeight,
      // Scroll to the end and see whether the footer comes into view — that
      // is the difference between "needs a scroll" and "unreachable".
      footAfterScroll: (() => {
        inner.scrollTop = inner.scrollHeight;
        const f2 = m.querySelector('.modal-foot');
        return f2 ? (f2.getBoundingClientRect().bottom <= innerHeight + 1) : null;
      })(),
      foot: fb ? `${fb.top.toFixed(0)}-${fb.bottom.toFixed(0)}` : 'none',
      footVisible: fb ? fb.bottom <= innerHeight + 1 : null,
      options: opts.length, offscreen: offscreen.map((o) => o.t),
    };
  });
  console.log(`\n=== ${w}x${h} ===`);
  if (r.none) { console.log('  no panel'); await page.close(); continue; }
  console.log(`  modal ${r.modal}`);
  console.log(`  scroller ${r.scroller}: canScroll=${r.canScroll} overflow-y=${r.overflowY} max-height=${r.maxH}, ${r.hidden}px hidden`);
  console.log(`  footer reachable after scrolling to the end: ${r.footAfterScroll}`);
  console.log(`  footer ${r.foot} visible=${r.footVisible}`);
  console.log(`  ${r.options} choices, ${r.offscreen.length} below the window edge`);
  for (const o of r.offscreen) console.log(`    cut: "${o}"`);
  await page.close();
}
await browser.close();
