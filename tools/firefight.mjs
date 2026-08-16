// Is anybody actually shooting?
//
// The behaviour audit found nobody dying in forty seconds of "combat", which
// could mean three quite different things: nobody is firing, everybody is
// firing and missing, or nobody has noticed anybody. Those have different
// fixes, so this separates them — shots fired, rounds landed, damage dealt,
// and what each side thinks its situation is, sampled over time.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  G.mission?.dispose();
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Fire',
      party: { id: 'f', kind: 'scrappers', name: 'Fire', strength: 12, tier: 2, quality: 0.8 } },
    squad: S.roster.slice(0, 5),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
});
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

const r = await page.evaluate(async () => {
  const Level = await import('/src/level.js');
  const m = window.KR.mission;

  // Walk the commander toward the enemy so a contact genuinely develops,
  // rather than measuring two groups ignoring each other across a field.
  const foes = () => m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  const first = foes()[0];
  const samples = [];
  let shotsPlayer = 0; let shotsEnemy = 0;

  // Count fire by wrapping the one function every shot goes through.
  const realFire = m.fire.bind(m);
  m.fire = (e, x, y, z) => {
    if (e.side === 'enemy') shotsEnemy++; else shotsPlayer++;
    return realFire(e, x, y, z);
  };
  let damageToPlayers = 0; let damageToEnemies = 0;
  const realDamage = m.applyDamage.bind(m);
  m.applyDamage = (target, dmg, source, hit) => {
    if (target.side === 'enemy') damageToEnemies += dmg; else damageToPlayers += dmg;
    return realDamage(target, dmg, source, hit);
  };

  for (let f = 0; f < 60 * 60; f++) {
    // Close the distance at a walk.
    const t = foes()[0] || first;
    if (t) {
      const d = Math.hypot(t.x - m.player.x, t.z - m.player.z);
      if (d > 18) {
        m.player.x += ((t.x - m.player.x) / d) * 0.09;
        m.player.z += ((t.z - m.player.z) / d) * 0.09;
      }
    }
    m.step(1 / 60);
    if (f % 600 === 0) {
      const alive = foes();
      const squad = m.squad.filter((e) => !e.dead);
      samples.push({
        t: Math.round(f / 60),
        hostiles: alive.length,
        squad: squad.length,
        playerHp: Math.round(m.player.hp),
        dist: t ? Math.round(Math.hypot(t.x - m.player.x, t.z - m.player.z)) : -1,
        alerted: alive.filter((e) => e.alert > 0.1).length,
        withTarget: alive.filter((e) => e.target).length,
        states: [...new Set(alive.map((e) => e.state))].join('/'),
        squadWithTarget: squad.filter((e) => e.target).length,
        shotsPlayer, shotsEnemy,
      });
    }
  }
  const alive = foes();
  return {
    samples,
    shotsPlayer, shotsEnemy,
    damageToPlayers: Math.round(damageToPlayers),
    damageToEnemies: Math.round(damageToEnemies),
    killed: 12 - alive.length,
    squadLeft: m.squad.filter((e) => !e.dead).length,
    sightOf: alive.slice(0, 4).map((e) => ({ sight: Math.round(e.sight), acc: +e.acc.toFixed(2) })),
  };
});

console.log('  t(s)  hostiles  alerted  withTarget  states        squadTgt  dist  playerHP  shots P/E');
for (const s of r.samples) {
  console.log(`  ${String(s.t).padStart(4)}  ${String(s.hostiles).padStart(8)}`
    + `  ${String(s.alerted).padStart(7)}  ${String(s.withTarget).padStart(10)}`
    + `  ${(s.states || '-').padEnd(13)} ${String(s.squadWithTarget).padStart(8)}`
    + `  ${String(s.dist).padStart(4)}  ${String(s.playerHp).padStart(8)}`
    + `  ${s.shotsPlayer}/${s.shotsEnemy}`);
}
console.log(`\nOver 60 seconds of closing to contact:`);
console.log(`  shots fired    friendly ${r.shotsPlayer}, hostile ${r.shotsEnemy}`);
console.log(`  damage dealt   to hostiles ${r.damageToEnemies}, to friendlies ${r.damageToPlayers}`);
console.log(`  hostiles down  ${r.killed} of 12, squad left ${r.squadLeft}`);
console.log(`  hostile stats  ${JSON.stringify(r.sightOf)}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
const shooting = r.shotsPlayer > 0 && r.shotsEnemy > 0;
const landing = r.damageToEnemies > 0 && r.damageToPlayers > 0;
console.log(shooting && landing && r.killed > 0
  ? '\nOK — both sides engage, land rounds and take losses.'
  : '\nFAIL — a firefight is not happening.');
await browser.close();
