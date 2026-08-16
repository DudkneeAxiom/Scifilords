// Large-battle probe. Engages a big party, then measures how many combatants
// are on the field, the draw-call count and the achieved frame time. If the
// numbers do not hold up, "larger battles" is a claim rather than a feature.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-battle', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

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

// Give the company renown and bodies so a big deployment is legal.
const setup = await page.evaluate(async () => {
  const St = await import('/src/state.js');
  const { makeSoldier } = await import('/src/roster.js');
  const { rng } = await import('/src/util.js');
  const S = window.KR.campaign;
  S.renown = 2200;
  const r = rng(99);
  for (let i = 0; i < 12; i++) {
    S.roster.push(makeSoldier(r, {
      role: ['rifleman', 'breacher', 'marksman', 'gunner'][i % 4],
      rank: 2, how: 'Probe', day: 1, avoid: S.roster.map((x) => x.name),
    }));
  }
  return { renown: S.renown, limit: St.deployLimit(S), roster: S.roster.length };
});
console.log(`renown ${setup.renown} -> deploy limit ${setup.limit}, roster ${setup.roster}`);

// Drop straight into a large road engagement.
await page.evaluate(() => {
  const S = window.KR.campaign;
  const party = {
    id: 'probe_party', kind: 'column_trust', name: 'Trust Armoured Column',
    faction: 'trust', strength: 70, tier: 5, quality: 1.15, hostileToPlayer: true,
    x: S.pos.x, z: S.pos.z,
  };
  S.parties.push(party);
  window.__probeParty = party;
});
await page.evaluate(() => {
  const G = window.KR;
  // Reach into the same path the encounter "ENGAGE" button uses.
  const ev = new KeyboardEvent('keydown', { key: 'Escape' });
  window.dispatchEvent(ev);
});
await page.evaluate(async () => {
  const UI = await import('/src/ui.js');
  UI.closeModal();
});

// Use the deploy panel directly against the probe party.
await page.evaluate(() => {
  window.__spec = {
    type: 'skirmish', site: 'roadside', layout: 'roadside',
    siteName: 'Probe Field', party: window.__probeParty,
  };
});
await page.evaluate(async () => {
  const UI = await import('/src/ui.js');
  const S = window.KR.campaign;
  UI.deployPanel(S, window.__spec, {
    onClose: () => {},
    onDeploy: (squad) => { window.__squad = squad; UI.closeModal(); },
  });
});
await page.waitForSelector('#modal [data-p]', { timeout: 15000 });
const count = (await page.$$('#modal [data-p]')).length;
for (let i = 0; i < count; i++) {
  const els = await page.$$('#modal [data-p]');
  if (els[i]) await els[i].click().catch(() => {});
  await page.waitForTimeout(30);
}
const chosen = await page.$$eval('#modal .pick.on', (e) => e.length);
await page.click('#modal [data-x="go"]');
await page.waitForTimeout(400);

// Launch the mission with that squad.
await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: G.campaign, spec: window.__spec, squad: window.__squad,
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h),
    onToast: () => {},
    onIntro: (info) => UI.missionIntro(info, 6.0),
    onEnd: () => {},
  });
  await G.mission.start();
});
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
await page.waitForFunction(
  () => window.KR.mission && !window.KR.mission.intro?.active && !window.KR.mission.inserting,
  null, { timeout: 40000 });
await page.waitForTimeout(1500);

// Measure over a live stretch of combat.
const perf = await page.evaluate(() => new Promise((resolve) => {
  const m = window.KR.mission;
  const frames = [];
  let last = performance.now();
  let n = 0;
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (++n < 180) requestAnimationFrame(tick);
    else {
      frames.sort((a, b) => a - b);
      const info = m.renderer.info;
      resolve({
        entities: m.entities.length,
        enemiesAlive: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
        friendlies: m.squad.length + 1,
        partyTotal: m.skirmishTotal,
        committed: m.skirmishCommitted,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        medianMs: +frames[Math.floor(frames.length / 2)].toFixed(1),
        p95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(1),
      });
    }
  };
  requestAnimationFrame(tick);
}));

console.log('\nlarge battle:');
console.log(`  squad selected      ${chosen} (limit ${setup.limit})`);
console.log(`  party strength      ${perf.partyTotal} (committed ${perf.committed})`);
console.log(`  combatants on field ${perf.entities} (${perf.enemiesAlive} hostile + ${perf.friendlies} friendly)`);
console.log(`  draw calls          ${perf.drawCalls}`);
console.log(`  triangles           ${perf.triangles}`);
console.log(`  frame time          median ${perf.medianMs}ms, p95 ${perf.p95Ms}ms  (software renderer)`);

await page.screenshot({ path: 'qa-battle/large-battle.png' });
console.log('\nwrote qa-battle/large-battle.png');

const fails = [];
if (chosen < 8) fails.push(`only ${chosen} deployable at renown ${setup.renown}`);
if (perf.entities < 30) fails.push(`only ${perf.entities} combatants on the field`);
if (perf.drawCalls > 1400) fails.push(`draw calls too high (${perf.drawCalls})`);
if (fails.length) { fails.forEach((f) => console.log('  ! ' + f)); process.exitCode = 1; }
else console.log('\nOK — large battle runs at the intended scale.');

await browser.close();
