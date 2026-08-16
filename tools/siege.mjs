// A siege.
//
// The whole claim is that a wall changes the question. If the wall does not
// genuinely stop movement and fire, a siege is just a firefight with scenery —
// so this checks the wall is real BEFORE the breach, that blowing the gate
// actually opens the ground, and that the navigation grid learns about the hole
// rather than routing the squad the long way round something that is no longer
// there.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-siege', { recursive: true });

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
    spec: { type: 'siege', site: 'fort', layout: 'fort', siteName: 'The Works Gate',
      enemyFaction: 'trust' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
});
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

// ---- is the wall real? ---------------------------------------------------
const before = await page.evaluate(async () => {
  const Level = await import('/src/level.js');
  const m = window.KR.mission;
  const spawn = m.level.playerSpawn;
  const inside = m.level.objectivePoint;
  // Sample the wall line for gaps a person could walk through.
  let blockedSpans = 0;
  for (let x = -40; x <= 40; x += 2) {
    if (!Level.hasLOS(m.level.obstacles, x, 4, x, -30, 1.5)) blockedSpans++;
  }
  return {
    objective: m.objective.text,
    tall: m.level.obstacles.filter((o) => o.h > 5).length,
    losToInside: Level.hasLOS(m.level.obstacles, spawn.x, spawn.z, inside.x, inside.z, 1.5),
    pathIn: !!m.nav.findPath(spawn.x, spawn.z, inside.x, inside.z),
    blockedSpans,
    charge: m.interactables.filter((i) => i.kind === 'breach').length,
    chargeTime: m.interactables.find((i) => i.kind === 'breach')?.need,
    garrison: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
    breached: !!m.breached,
  };
});
console.log('Before the breach:');
console.log(`  objective          "${before.objective}"`);
console.log(`  wall sections      ${before.tall} pieces over 5m`);
console.log(`  ${before.blockedSpans} of 41 samples across the wall line are blocked`);
console.log(`  can see the objective from the start line: ${before.losToInside}`);
console.log(`  a route exists to it:                     ${before.pathIn}`);
console.log(`  charges: ${before.charge}, taking ${before.chargeTime}s to set`);
console.log(`  garrison: ${before.garrison}`);

await page.evaluate(() => {
  const m = window.KR.mission;
  m.player.x = 0; m.player.z = 20;
  m.camYaw = 0; m.camPitch = 0.05;
  m.loop();
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'qa-siege/01-approach.png' });

// ---- blow it -------------------------------------------------------------
const after = await page.evaluate(async () => {
  const Level = await import('/src/level.js');
  const m = window.KR.mission;
  const spawn = m.level.playerSpawn;
  const inside = m.level.objectivePoint;
  const charge = m.interactables.find((i) => i.kind === 'breach');
  m.completeInteraction(charge);
  for (let i = 0; i < 60; i++) m.step(1 / 60);
  let blockedSpans = 0;
  for (let x = -40; x <= 40; x += 2) {
    if (!Level.hasLOS(m.level.obstacles, x, 4, x, -30, 1.5)) blockedSpans++;
  }
  const path = m.nav.findPath(spawn.x, spawn.z, inside.x, inside.z);
  return {
    breached: !!m.breached,
    objective: m.objective.text,
    blockedSpans,
    losThroughGate: Level.hasLOS(m.level.obstacles, 0, 10, 0, -30, 1.5),
    pathIn: !!path,
    // The route has to go THROUGH the gate now, not around the whole wall.
    pathCrossesGate: !!path && path.some((pt) => Math.abs(pt.x) < 9 && Math.abs(pt.z + 14) < 10),
    waypoints: (path || []).map((pt) => [Math.round(pt.x), Math.round(pt.z)]),
    hunting: m.entities.filter((e) => e.side === 'enemy' && !e.dead && e.state === 'hunt').length,
    garrison: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
  };
});
console.log('\nAfter the charge goes off:');
console.log(`  breached: ${after.breached}, objective now "${after.objective}"`);
console.log(`  blocked samples across the wall: ${before.blockedSpans} -> ${after.blockedSpans}`);
console.log(`  can see through the gateway:     ${after.losThroughGate}`);
console.log(`  route exists: ${after.pathIn}, and it goes through the gate: ${after.pathCrossesGate}`);
console.log(`  waypoints: ${JSON.stringify(after.waypoints)}`);
console.log(`  defenders now hunting the breach: ${after.hunting} of ${after.garrison}`);

await page.evaluate(() => {
  const m = window.KR.mission;
  m.player.x = 0; m.player.z = 8;
  m.camYaw = 0; m.camPitch = 0.02;
  m.loop();
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'qa-siege/02-breached.png' });

// ---- and taking the place ends it ----------------------------------------
const taken = await page.evaluate(() => {
  const m = window.KR.mission;
  for (let g = 0; g < 400 && !m.objective.done; g++) {
    for (const e of m.entities) if (e.side === 'enemy' && !e.dead) { e.hp = 0; e.dead = true; }
    for (let i = 0; i < 30; i++) m.step(1 / 60);
  }
  return { done: !!m.objective.done, extract: !!m.extractArmed, progress: m.objective.progress };
});
console.log(`\nClearing the compound: objective complete ${taken.done},`
  + ` extraction armed ${taken.extract} (${taken.progress}/2)`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const wallWasReal = before.blockedSpans > 25 && !before.losToInside;
const breachOpened = after.blockedSpans < before.blockedSpans && after.losThroughGate
  && after.pathCrossesGate;
const ok = wallWasReal && !before.breached && after.breached && breachOpened
  && after.hunting > 0 && taken.done && taken.extract && errors.length === 0;
console.log(ok
  ? '\nOK — the wall genuinely stops you, the gate is the way through, and blowing it opens the ground.'
  : '\nFAIL — the wall is scenery.');
await browser.close();
