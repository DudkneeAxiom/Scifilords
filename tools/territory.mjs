// Is the political map actually telling the truth? Samples ownerAt() on a grid
// and reports how much of the continent each power is shown to hold, plus what
// the overlay resolves to at every named location. A border you cannot read is
// a bug; so is a border that says the wrong thing.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(700);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

const r = await page.evaluate(() => {
  const w = window.KR.world;
  const { REGION, LOCATIONS } = window.KR.dev.DATA;
  const HALF = REGION.size / 2;
  const N = 90;
  const counts = {};
  const tints = {};
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = -HALF + (i / (N - 1)) * REGION.size;
      const z = -HALF + (j / (N - 1)) * REGION.size;
      const o = w.ownerAt(x, z) || 'unclaimed';
      counts[o] = (counts[o] || 0) + 1;
      if (!tints[o]) {
        const c = w.territoryColour(o === 'unclaimed' ? null : o);
        tints[o] = c ? '#' + c.getHexString() : 'none';
      }
    }
  }
  const atLoc = LOCATIONS.filter((l) => l.kind !== 'open').map((l) => ({
    name: l.name, faction: l.faction || '—', shown: w.ownerAt(l.x, l.z) || 'unclaimed',
  }));
  return { total: N * N, counts, tints, atLoc };
});

console.log('Share of the continent each power is shown to hold:');
for (const [k, v] of Object.entries(r.counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(11)} ${String(((v / r.total) * 100).toFixed(1)).padStart(5)}%  ${r.tints[k]}`);
}

const wrong = r.atLoc.filter((l) => l.faction !== '—' && l.shown !== l.faction);
console.log(`\nOverlay vs. the flag actually flying, at ${r.atLoc.length} named places:`);
for (const l of r.atLoc) {
  const bad = l.faction !== '—' && l.shown !== l.faction;
  console.log(`  ${l.name.padEnd(20)} flies ${l.faction.padEnd(8)} shown ${String(l.shown).padEnd(10)}`
    + (bad ? ' <-- MISMATCH' : ''));
}

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
const claimed = 1 - (r.counts.unclaimed || 0) / r.total;
const ok = wrong.length === 0 && errors.length === 0 && claimed > 0.15
  && (r.counts.trust || 0) > 0 && (r.counts.syndic || 0) > 0;
console.log(ok
  ? `\nOK — ${(claimed * 100).toFixed(0)}% of the map is claimed and every settlement flies what it is painted.`
  : `\nFAIL — ${wrong.length} mismatch(es), ${(claimed * 100).toFixed(0)}% claimed.`);
await browser.close();
