// A turn in the pit.
//
// The arena is its own mission type with its own stakes — you bet on
// yourself, round by round — and the only time a probe has touched it, an
// idle commander died in sixteen seconds and it was written off as correct.
// This walks it the way a player does: into the town, take the pit verb,
// read what it offers, fight a round, and check the money and the roster
// come back changed in the right direction.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const OUT = process.argv[2] || '.';
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
await page.evaluate(async () => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
  const { LOCATIONS } = await import('/src/data.js');
  const S = window.KR.campaign;
  const town = LOCATIONS.find((l) => l.kind === 'settlement') || LOCATIONS[0];
  S.pos.x = town.x; S.pos.z = town.z; S.credits = 4000;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForTimeout(1400);

// Find the pit verb by its words, since the settlement options are not
// data-x buttons.
const took = await page.evaluate(() => {
  const m = document.querySelector('#modal');
  if (!m) return null;
  const opts = [...m.querySelectorAll('*')].filter((e) => e.children.length === 0
    || [...e.children].every((c) => c.children.length === 0));
  const hit = opts.find((e) => /take a turn in the pit/i.test(e.textContent || ''));
  if (!hit) return { missing: [...m.querySelectorAll('*')].length };
  const clickable = hit.closest('[data-o],[data-x],button,.opt,.choice,li,div');
  clickable.click();
  return { clicked: (hit.textContent || '').trim().slice(0, 40) };
});
await page.waitForTimeout(1200);
console.log(`pit verb: ${took?.clicked ? `"${took.clicked}"` : 'NOT FOUND'}`);

const panel = await page.evaluate(() => {
  const m = document.querySelector('#modal');
  const open = m && !m.classList.contains('hidden');
  const txt = open ? (m.textContent || '') : '';
  return { open, title: (m?.querySelector('.modal-title')?.textContent || '').trim(),
    chars: txt.trim().length,
    stakes: /stake|purse|bet|wager|round/i.test(txt),
    nan: /NaN|undefined|Infinity|\[object/.test(txt),
    acts: [...(m?.querySelectorAll('[data-x]') || [])].map((b) => b.dataset.x),
    snippet: txt.replace(/\s+/g, ' ').trim().slice(0, 170) };
});
await page.screenshot({ path: `${OUT}/p01-pit-offer.png` });
console.log(`panel: "${panel.title}" ${panel.chars} chars  stakes-mentioned=${panel.stakes}`
  + `${panel.nan ? '  BAD VALUES' : ''}`);
console.log(`  buttons: ${panel.acts.join(' ') || 'none'}`);
console.log(`  "${panel.snippet}"`);

// Take the fight, if it is offered.
const before = await page.evaluate(() => ({ credits: window.KR.campaign.credits }));
const go = await page.evaluate(() => {
  const m = document.querySelector('#modal');
  const b = m?.querySelector('[data-x="go"]') || m?.querySelector('[data-x="fight"]')
    || [...(m?.querySelectorAll('button') || [])].find((x) => /fight|enter|take/i.test(x.textContent));
  if (!b) return false; b.click(); return true;
});
if (!go) console.log('\nno way to actually take the fight from this panel');
else {
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const fight = await page.evaluate(() => {
    const m = window.KR.mission;
    if (!m) return null;
    return { type: m.spec?.type, mine: m.entities.filter((e) => e.side === 'player' && !e.dead).length,
      theirs: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
      objective: m.objective?.text, need: m.objective?.need, squad: m.squad.length };
  });
  await page.screenshot({ path: `${OUT}/p02-pit-fight.png` });
  if (!fight) console.log('\nno mission started');
  else {
    console.log(`\nin the pit: type=${fight.type} ${fight.mine}v${fight.theirs}`
      + ` squad=${fight.squad}  objective="${fight.objective}" of ${fight.need}`);
    console.log(`  ${fight.squad === 0 ? 'you fight alone, as a pit should be' : 'SQUAD CAME WITH YOU — that is not a duel'}`);
  }
  console.log(`  credits ${before.credits} -> ${await page.evaluate(() => window.KR.campaign.credits)}`);
}
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
