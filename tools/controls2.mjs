// Does the new scheme actually do what the strip says?
//
// Four claims to check: R sends the company in, Ctrl no longer crouches you
// while you bind a group, the order strip teaches its own shortcuts, and
// the controls screen opens with the handful of things that matter rather
// than thirty bindings in one weight.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const OUT = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });

// The controls screen, straight off the title.
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#title button')].find((x) => /controls/i.test(x.textContent));
  if (b) b.click();
});
await page.waitForTimeout(700);
const ctl = await page.evaluate(() => {
  const m = document.querySelector('#modal');
  const t = (m?.textContent || '');
  return { open: !!m && !m.classList.contains('hidden'),
    leads: /IF YOU LEARN FOUR THINGS/.test(t),
    sendsIn: /SEND THEM IN/.test(t),
    noReload: !/Reload/i.test(t),
    ctrlNote: /group modifier only/.test(t) };
});
await page.screenshot({ path: `${OUT}/x01-controls.png` });
console.log(`controls screen: open=${ctl.open} leads-with-essentials=${ctl.leads}`
  + ` names-send-them-in=${ctl.sendsIn} reload-gone=${ctl.noReload} ctrl-explained=${ctl.ctrlNote}`);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(300);

// Into a real battle.
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
  S.contracts.push({ id: 'ct_1', type: 'skirmish', site: here.id, employer: 'syndic',
    title: 'Controls', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true });
  S.pos.x = here.x; S.pos.z = here.z;
  window.KR.world.stopTravel();
  window.KR.dev.enterLocation();
});
await page.waitForSelector('#modal [data-x="go"]', { timeout: 30000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 60000 });
await page.waitForFunction(() => window.KR.mission && !window.KR.mission.intro?.active
  && !window.KR.mission.inserting, null, { timeout: 60000 });
await page.evaluate(() => { const m = window.KR.mission; m.paused = false; m.hadLock = true; });
await page.waitForTimeout(1200);

// The strip: does it carry its own keys now?
const strip = await page.evaluate(() => {
  const els = [...document.querySelectorAll('#hud-orders .ord')];
  return {
    orders: els.length,
    withKeys: els.filter((e) => e.querySelector('kbd')).length,
    major: els.filter((e) => e.classList.contains('ord-major')).map((e) => e.textContent.trim()),
    text: els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
  };
});
console.log(`\norder strip: ${strip.orders} entries, ${strip.withKeys} showing a key`);
console.log(`  primary: ${strip.major.join(' / ') || 'NONE MARKED'}`);
console.log(`  ${strip.text.join('  |  ')}`);
await page.screenshot({ path: `${OUT}/x02-strip.png` });

// R: does the company actually go in?
const r = await page.evaluate(async () => {
  const m = window.KR.mission;
  // Look at a live opponent, the way a player would before ordering.
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  foe.x = m.player.x; foe.z = m.player.z + 6;
  m.camYaw = Math.atan2(foe.x - m.player.x, foe.z - m.player.z) + Math.PI;
  m.player.yaw = Math.atan2(foe.x - m.player.x, foe.z - m.player.z);
  const before = m.squad.map((s) => s.order);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
  await new Promise((res) => setTimeout(res, 400));
  return { before, after: m.squad.map((s) => s.order), squadOrder: m.squadOrder };
});
const went = r.after.filter((o) => o === 'attack' || o === 'move').length;
console.log(`\nR pressed: ${went} of ${r.after.length} took the order (squadOrder now "${r.squadOrder}")`
  + `  ${went > 0 ? 'OK' : 'NOTHING HAPPENED'}`);

// Ctrl+1: bind a group without dropping to one knee.
const c = await page.evaluate(async () => {
  const m = window.KR.mission;
  m.crouchHeld = false;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }));
  await new Promise((res) => setTimeout(res, 250));
  const crouched = !!m.crouchHeld;
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
  return { crouched };
});
console.log(`Ctrl+1 to bind a group: crouched=${c.crouched ? 'YES — still conflicting' : 'no'}`);
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 4).join('\n') : '\nno console errors');
await browser.close();
