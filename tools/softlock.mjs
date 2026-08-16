// Hunts for unreachable enemies in elimination missions.
//
// Spawns a road engagement, then checks every hostile against three questions:
// is it inside the playable bounds, can the player physically walk to it, and
// is it within reach of any weapon the squad carries. Anything that fails all
// three is a softlock waiting to happen.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0,200)); });

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

const results = [];
// Try a spread of party sizes — the bug is most likely with big waves.
for (const strength of [5, 12, 30, 70]) {
  await page.evaluate((st) => {
    const S = window.KR.campaign;
    S.renown = 2200;
    window.__spec = {
      type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Probe',
      party: { id: 'probe', kind: 'scrappers', name: 'Probe', strength: st, tier: 2, quality: 0.8 },
    };
    window.__squad = S.roster.slice(0, 4);
  }, strength);

  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: G.campaign, spec: window.__spec, squad: window.__squad,
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onEnd: () => {},
    });
    await G.mission.start();
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
  await page.waitForFunction(
    () => window.KR.mission && !window.KR.mission.inserting, null, { timeout: 40000 })
    .catch(async () => { const d = await page.evaluate(() => ({ t: window.KR.mission?.time, paused: window.KR.mission?.paused, intro: window.KR.mission?.intro })); console.log('STALL', JSON.stringify(d)); });
  await page.waitForTimeout(600);

  const initial = await page.evaluate(() => {
    const m = window.KR.mission;
    const b = m.level.bounds;
    const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
    const embedded = foes.filter((e) => m.level.obstacles.some((o) =>
      o.h > 0.7 && Math.abs(e.x - o.x) < o.hw + 0.35 && Math.abs(e.z - o.z) < o.hd + 0.35));
    return { total: foes.length, embedded: embedded.length,
      outside: foes.filter((e) => Math.abs(e.x) > b || Math.abs(e.z) > b).length };
  });
  console.log(`  initial wave: ${initial.total} on field, ${initial.embedded} embedded, ${initial.outside} outside`);

  // Force the reinforcement waves too — that is where the spawn ring is widest.
  await page.evaluate(() => {
    const m = window.KR.mission;
    m.paused = false;
    for (let i = 0; i < 3; i++) {
      m.entities.filter((e) => e.side === 'enemy').forEach((e) => { e.dead = true; e.down = true; });
      m.updateSkirmishWaves();
    }
  });
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const b = m.level.bounds;
    const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
    const outside = foes.filter((e) => Math.abs(e.x) > b || Math.abs(e.z) > b);
    // Longest weapon anyone on our side carries.
    const reach = Math.max(...[m.player, ...m.squad]
      .filter((e) => e.weapon).map((e) => e.weapon.range * 1.6));
    // Furthest the player can physically get toward each foe.
    const unreachable = foes.filter((e) => {
      const cx = Math.max(-b, Math.min(b, e.x));
      const cz = Math.max(-b, Math.min(b, e.z));
      return Math.hypot(e.x - cx, e.z - cz) > reach;
    });
    // Anything standing inside a solid is shielded by it: shots stop on the
    // obstacle before they ever reach the body.
    const embedded = foes.filter((e) => m.level.obstacles.some((o) =>
      o.h > 0.7
      && Math.abs(e.x - o.x) < o.hw + 0.35
      && Math.abs(e.z - o.z) < o.hd + 0.35));
    // And anything with no line of sight from anywhere the player can stand.
    const noLOS = foes.filter((e) => {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        for (const rad of [6, 14, 26]) {
          const px = Math.max(-b, Math.min(b, e.x + Math.cos(a) * rad));
          const pz = Math.max(-b, Math.min(b, e.z + Math.sin(a) * rad));
          if (m.nav.isBlockedWorld(px, pz)) continue;
          const Level = m.level;
          const ok = !m.rayHit(
            new (m.camera.position.constructor)(px, m.level.obstacles.length ? 1.5 : 1.5, pz),
            new (m.camera.position.constructor)(e.x - px, 0, e.z - pz).normalize(),
            Math.hypot(e.x - px, e.z - pz), null).entity !== null;
          if (ok) return false;
        }
      }
      return true;
    });
    return {
      bounds: b,
      total: foes.length,
      embedded: embedded.length,
      noLOS: noLOS.length,
      outside: outside.length,
      worstOverrun: outside.length
        ? Math.max(...outside.map((e) => Math.max(Math.abs(e.x), Math.abs(e.z)) - b)).toFixed(1) : 0,
      unreachable: unreachable.length,
      reach: reach.toFixed(0),
    };
  });
  results.push({ strength, ...r });
  console.log(`strength ${String(strength).padStart(3)}: ${r.total} on field, `
    + `${r.outside} outside bounds, ${r.unreachable} out of reach, `
    + `${r.embedded} embedded in geometry, ${r.noLOS} with no line of sight`);
}

const bad = results.filter((r) => r.outside > 0 || r.unreachable > 0 || r.embedded > 0);
if (bad.length) {
  console.log('\n! enemies can spawn outside the playable area — elimination objectives can stall');
  process.exitCode = 1;
} else {
  console.log('\nOK — every hostile is inside the bounds and reachable.');
}
await browser.close();
