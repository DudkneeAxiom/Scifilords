// Who actually goes when you press GO?
//
// A real deployment landed the commander alone against four, and the
// mission was lost inside a few seconds — "COMMANDER DOWN, Bracket is
// breaking contact" before the player has done anything. Either the
// deployment panel sends nobody unless you tick them, or the squad it
// builds is being dropped on the way to the field.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
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
  const here = LOCATIONS.find((l) => l.id === 'grellan') || LOCATIONS[0];
  S.contracts.forEach((c) => { c.accepted = false; });
  S.contracts.push({ id: 'dc_1', type: 'skirmish', site: here.id, employer: 'syndic',
    title: 'Who goes', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
  S.pos.x = here.x; S.pos.z = here.z;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });

// What the panel is showing before anything is clicked.
const panel = await page.evaluate(() => {
  const m = document.querySelector('#modal');
  const boxes = [...m.querySelectorAll('input[type=checkbox]')];
  return {
    title: (m.querySelector('.modal-title')?.textContent || '').trim(),
    rosterReady: window.KR.campaign.roster.filter((s) => s.status !== 'dead').length,
    checkboxes: boxes.length,
    checked: boxes.filter((b) => b.checked).length,
    picked: [...m.querySelectorAll('.picked, .sel, .on, [data-picked="1"]')].length,
    goText: (m.querySelector('[data-x="go"]')?.textContent || '').trim(),
  };
});
console.log('deployment panel:');
console.log(`  title       ${panel.title}`);
console.log(`  roster fit  ${panel.rosterReady}`);
console.log(`  tick boxes  ${panel.checkboxes} (${panel.checked} ticked)`);
console.log(`  marked sel  ${panel.picked}`);
console.log(`  go button   "${panel.goText}"`);

await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
await page.waitForTimeout(2500);
const field = await page.evaluate(() => {
  const m = window.KR.mission;
  return {
    squad: m.squad.length,
    mine: m.entities.filter((e) => e.side === 'player' && !e.dead).length,
    theirs: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
    playerDown: !!m.player.down, playerHp: Math.round(m.player.hp),
    over: !!m.over,
  };
});
console.log('\non the field, two and a half seconds in:');
console.log(`  squad deployed  ${field.squad}`);
console.log(`  mine alive      ${field.mine}   theirs ${field.theirs}`);
console.log(`  commander       hp ${field.playerHp}${field.playerDown ? ' DOWN' : ''}`);
console.log(`  mission over    ${field.over}`);
await browser.close();
