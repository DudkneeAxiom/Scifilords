// Is a fair fight fair?
//
// Ten of mine against eighteen ends with ten of mine on the floor and five
// of theirs, at HEAD as well as with today's changes. Losing while
// outnumbered is correct; the question is the EXCHANGE RATE, and the only
// way to read that is even numbers on both sides. If ten against ten ends
// nine-nil, player-side soldiers are weaker than enemy ones and every
// balance number in the game is built on sand.
//
// The player is excluded: they stand still in a probe, and a man who does
// not swing or block is not evidence about the melee.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(700);
}
const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = ''; UI.show('hud');
  G.mission = new Mission({ campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Fair',
      party: { id: 'x', kind: 'scrappers', name: 'Foe', strength: 18, tier: 3, quality: 0.8 } },
    squad: S.roster.slice(0, 10), container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {} });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true; m.inserting = false;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  for (const e of m.entities) e.inserting = false;
  const realStep = m.step.bind(m); m.step = () => {};

  // Take the player out of the sum entirely: parked far off the field and
  // untargetable, so neither side is fighting a statue.
  m.player.x = 900; m.player.z = 900; m.player.follower = true; m.player.invuln = true;

  const mine = m.squad.filter((e) => !e.dead);
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  const n = Math.min(mine.length, foes.length);
  // Even numbers, facing each other across forty metres of open ground.
  for (const e of foes.slice(n)) { e.dead = true; e.hp = 0; }
  mine.slice(0, n).forEach((e, i) => {
    e.x = (i - n / 2) * 2.4; e.z = -20; e.order = 'attack'; e.orderPoint = null; e.forceTarget = null;
  });
  foes.slice(0, n).forEach((e, i) => { e.x = (i - n / 2) * 2.4; e.z = 20; });

  const stat = (e) => `hp${Math.round(e.hp)} dmg${e.weapon?.damage ?? '?'} rng${e.weapon?.range ?? '?'}`;
  const sample = { mine: stat(mine[0]), theirs: stat(foes[0]) };
  const stand = (s) => m.entities.filter(
    (e) => e.side === s && !e.dead && !e.down && !e.militia && !e.follower).length;
  const out = [];
  for (let i = 0; i <= 10800; i++) {
    if (i % 1200 === 0) out.push(`t${i / 60}s ${stand('player')}v${stand('enemy')}`);
    realStep(1 / 60);
  }
  return { n, sample, out };
});
console.log(`even fight, ${r.n} a side`);
console.log(`  mine   ${r.sample.mine}`);
console.log(`  theirs ${r.sample.theirs}`);
console.log('  ' + r.out.join('  '));
await browser.close();
