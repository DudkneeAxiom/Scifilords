// Does the interface fit on the screen, and can you read it?
//
// The world screen photographs badly in two specific ways: the status strip
// runs off the right-hand edge, and the map's place labels sit on top of one
// another in the dense middle of the Reach. Both are measurable rather than
// matters of taste — an element wider than its container is clipped, and two
// labels whose boxes intersect are covering each other's text.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const SIZES = [[1440, 900], [1280, 800], [1920, 1080]];
for (const [w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
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
  await page.waitForTimeout(2000);

  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // Anything the viewport cuts off, and anything scrolling inside itself.
    const clipped = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.offsetParent && el.tagName !== 'BODY') continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      if (b.right > vw + 0.5) {
        clipped.push({ sel: el.id ? '#' + el.id : '.' + (el.className || '').toString().split(' ')[0],
          over: +(b.right - vw).toFixed(0), text: (el.textContent || '').trim().slice(0, 40) });
      }
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'hidden') {
        clipped.push({ sel: (el.id ? '#' + el.id : '.' + (el.className || '').toString().split(' ')[0]) + ' (inner)',
          over: el.scrollWidth - el.clientWidth, text: (el.textContent || '').trim().slice(0, 40) });
      }
    }
    // Map labels sitting on top of each other.
    const labels = [...document.querySelectorAll('#map-labels > *')]
      .map((el) => ({ t: (el.textContent || '').trim().split('\n')[0], b: el.getBoundingClientRect() }))
      .filter((l) => l.b.width > 1);
    let overlaps = 0;
    const worst = [];
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const A = labels[i].b, B = labels[j].b;
        const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (ox > 2 && oy > 2) {
          overlaps++;
          worst.push(`${labels[i].t} / ${labels[j].t} (${ox.toFixed(0)}x${oy.toFixed(0)}px)`);
        }
      }
    }
    return { vw, clipped: clipped.slice(0, 8), labels: labels.length, overlaps, worst: worst.slice(0, 6) };
  });
  console.log(`\n=== ${w}x${h} ===`);
  if (r.clipped.length) {
    console.log('  running off the right edge:');
    for (const c of r.clipped) console.log(`    ${c.sel} by ${c.over}px — "${c.text}"`);
  } else console.log('  nothing clipped horizontally');
  console.log(`  map labels: ${r.labels}, overlapping pairs: ${r.overlaps}`);
  for (const wst of r.worst) console.log(`    ${wst}`);
  await page.close();
}
await browser.close();
