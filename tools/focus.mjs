// Press the wheel open over a body and the squad should already be shooting it.
//
// The claim: middle mouse while aimed at a hostile puts every commanded soldier
// onto that target, marks them on screen, and the mark survives until they are
// dead or out of range. Each of those is checked here, including the two ways
// it should END — because a marker left on a corpse or on somebody nobody can
// reach is worse than no marker at all.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-focus', { recursive: true });


// Put a hostile somewhere the reticle can actually reach, and return it.
// Sweeps bearings around the player until aimPoint() reports the body itself
// rather than whatever prop happens to be in the way.
const AIM_AT_FOE = `(m, foe, dist) => {
  for (let k = 0; k < 48; k++) {
    const yaw = (k / 48) * Math.PI * 2;
    // The camera orbits to player + dir(camYaw) * back and looks back through
    // the player, so the reticle runs along -dir(camYaw).
    foe.x = m.player.x - Math.sin(yaw) * dist;
    foe.z = m.player.z - Math.cos(yaw) * dist;
    m.camYaw = yaw; m.camPitch = 0;
    for (let i = 0; i < 20; i++) m.updateCamera(1 / 60);
    if (m.aimPoint(140).entity === foe) return true;
  }
  return false;
}`;

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

const UI_HOOK = `onWheel: (w) => UI.renderCommandWheel(w), onHud: (h) => UI.renderMissionHud(h),`;
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
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Focus',
      party: { id: 'f', kind: 'scrappers', name: 'Focus', strength: 10, tier: 2, quality: 0.8 } },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h),
    onWheel: (w) => UI.renderCommandWheel(w),
    onToast: () => {}, onIntro: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
});
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

// 1. Open the wheel while looking at somebody.
const marked = await page.evaluate((AIM_AT_FOE) => {
  const m = window.KR.mission;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  // Put the target directly under the reticle.
  const aimed = eval(AIM_AT_FOE)(m, foe, 14);
  m.openWheel();
  const aimedAt = m.wheel.aim.entity === foe;
  const state = {
    aimedAt,
    marked: m.marked === foe,
    markVisible: m.markMesh.visible,
    squadOnTarget: m.squad.filter((s) => s.forceTarget === foe).length,
    squadTotal: m.squad.filter((s) => !s.dead).length,
    order: m.squad.find((s) => !s.dead)?.order,
  };
  m.closeWheel(true);          // release without choosing — must not undo it
  state.afterRelease = m.marked === foe;
  for (let i = 0; i < 10; i++) m.step(1 / 60);
  m.onHud(m.buildHud());
  state.markShown = m.markMesh.visible;
  state.hud = !document.getElementById('mark-hud').classList.contains('hidden');
  state.hudName = document.getElementById('mk-name').textContent;
  state.foundLine = aimed;
  return state;
}, AIM_AT_FOE);
console.log('Opening the wheel over a hostile:');
console.log(`  aim caught the body     ${marked.aimedAt}`);
console.log(`  target marked           ${marked.marked}`);
console.log(`  squad put on it         ${marked.squadOnTarget}/${marked.squadTotal} (order: ${marked.order})`);
console.log(`  survives release        ${marked.afterRelease}`);
console.log(`  caret drawn in world    ${marked.markShown}`);
console.log(`  readout on screen       ${marked.hud} "${marked.hudName}"`);

await page.waitForTimeout(200);
await page.screenshot({ path: 'qa-focus/01-marked.png' });

// 2. It must end when they die.
const onDeath = await page.evaluate(() => {
  const m = window.KR.mission;
  const t = m.marked;
  t.hp = 0; t.dead = true; t.down = true;
  for (let i = 0; i < 10; i++) m.step(1 / 60);
  m.onHud(m.buildHud());
  return {
    cleared: m.marked === null,
    meshHidden: !m.markMesh.visible,
    squadReleased: m.squad.every((s) => s.forceTarget !== t),
    hudHidden: document.getElementById('mark-hud').classList.contains('hidden'),
  };
});
console.log('\nWhen the target dies:');
console.log(`  mark cleared ${onDeath.cleared}, caret hidden ${onDeath.meshHidden},`
  + ` squad released ${onDeath.squadReleased}, readout hidden ${onDeath.hudHidden}`);

// 3. And when they break contact.
const onRange = await page.evaluate((AIM_AT_FOE) => {
  const m = window.KR.mission;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  eval(AIM_AT_FOE)(m, foe, 12);
  m.openWheel(); m.closeWheel(true);
  const held = m.marked === foe;
  // Opposite corners of the arena: entities are clamped to the bounds every
  // frame, so this is genuinely the furthest two people can be apart here.
  const b = m.level.bounds - 2;
  m.player.x = -b; m.player.z = -b;
  foe.x = b; foe.z = b;
  for (let i = 0; i < 10; i++) m.step(1 / 60);
  return { held, cleared: m.marked === null };
}, AIM_AT_FOE);
console.log(`\nWhen the target breaks contact: marked ${onRange.held} -> cleared ${onRange.cleared}`);

// 4. Opening the wheel over empty ground must not mark anything.
const onGround = await page.evaluate(() => {
  const m = window.KR.mission;
  m.camPitch = 0.5;                 // look at the dirt
  for (let i = 0; i < 12; i++) m.updateCamera(1 / 60);
  m.openWheel();
  const none = m.marked === null;
  m.closeWheel(true);
  return { none };
});
console.log(`Opening it over open ground marks nothing: ${onGround.none}`);

// 5. Any other order should release the squad from the mark.
const overridden = await page.evaluate((AIM_AT_FOE) => {
  const m = window.KR.mission;
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  eval(AIM_AT_FOE)(m, foe, 12);
  m.openWheel(); m.closeWheel(true);
  const before = m.marked === foe;
  m.setSquadOrder('follow');
  return { before, after: m.marked === null };
}, AIM_AT_FOE);
console.log(`A different order drops the mark: ${overridden.before} -> ${overridden.after}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
const ok = marked.aimedAt && marked.marked && marked.squadOnTarget === marked.squadTotal
  && marked.afterRelease && marked.markShown && marked.hud
  && onDeath.cleared && onDeath.meshHidden && onDeath.squadReleased && onDeath.hudHidden
  && onRange.held && onRange.cleared && onGround.none
  && overridden.before && overridden.after && errors.length === 0;
console.log(ok
  ? '\nOK — press over a body and the squad is already on it; the mark lasts exactly as long as it should.'
  : '\nFAIL — focus fire does not behave.');
await browser.close();
