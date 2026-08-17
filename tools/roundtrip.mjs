// Does the world map survive coming back from a deployment?
//
// The report: finish an engagement, return to the Reach, and the map is black.
// The icons are still there and the company still moves, which is the detail
// that matters — party labels are DOM elements sitting on top of the canvas, so
// "labels but no world" means the canvas is dead while the game underneath it
// is running perfectly well.
//
// Two candidates, and they are distinguished by whether the failure is gradual:
//
//   1. Shared assets disposed. get() hands out clones that share geometry with
//      the model cache, so a teardown that walks its scene calling dispose()
//      frees the asset for everybody. Three re-uploads from the JS-side arrays
//      on the next frame, so this alone tends to recover — which is why it has
//      to be measured rather than assumed.
//   2. WebGL contexts exhausted. Every mission and every map builds its own
//      renderer, and dispose() does not release the context on its own. A
//      browser keeps about sixteen; after that the oldest is killed and the
//      newest canvas draws nothing. This fails on the Nth transition, not the
//      first, which is exactly the shape of "it happened after a while".
//
// So this drives real round trips and reports, per trip, what the map actually
// drew and what the browser said about it.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const TRIPS = Number(process.argv[2] || 6);

const errors = [];
const contextWarnings = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  const t = m.text();
  if (/context|WebGL|GL_/i.test(t)) contextWarnings.push(t);
  else if (m.type() === 'error') errors.push(t);
});

// Set KR_DISPOSE_SHARED=1 to restore the old teardown, which disposed cached
// geometry along with the scene's own. That is the counterfactual: without it,
// a clean run proves only that the code in front of you works, not that it
// fixed anything.
if (process.env.KR_DISPOSE_SHARED) {
  await page.addInitScript(() => { window.__KR_DISPOSE_SHARED = true; });
  console.log('running with the OLD teardown (shared assets disposed)');
}

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 20000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 20000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});
await page.waitForTimeout(400);

/** What the map's renderer actually put on screen this frame. */
const mapReport = () => page.evaluate(() => {
  const w = window.KR.world;
  if (!w?.renderer) return { alive: false };
  const info = w.renderer.info;
  const gl = w.renderer.getContext();
  return {
    alive: true,
    lost: gl.isContextLost(),
    calls: info.render.calls,
    triangles: info.render.triangles,
    // Geometries/textures the renderer is currently holding.
    geometries: info.memory.geometries,
  };
});

const rows = [];
for (let trip = 1; trip <= TRIPS; trip++) {
  // Take a contract and deploy on it.
  // A fresh posting every trip. The previous one was satisfied and cleared, so
  // reusing it leaves nothing to deploy on and the location offers no panel.
  await page.evaluate((n) => {
    const S = window.KR.campaign;
    S.contracts.forEach((c) => { c.accepted = false; });
    const c = { id: `rt_${n}`, type: 'recovery', site: 'grellan', employer: 'syndic',
      title: 'Round trip', text: 'probe', pay: 500, expiresDay: S.day + 20, accepted: true };
    S.contracts.push(c);
    window.KR.world.stopTravel();
    S.pos.x = 200; S.pos.z = -218;
  }, trip);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const el = document.querySelector('#modal [data-x="avoid"]');
    if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
  });
  await page.waitForTimeout(300);
  // Driven through the game's own entry point rather than a keypress: world
  // keys are swallowed whenever a panel is up, and a wandering party can open
  // one at any moment, so a press is not a reliable way to get into a site.
  await page.evaluate(() => {
    const S = window.KR.campaign;
    S.pos.x = 200; S.pos.z = -218;
    window.KR.world.stopTravel();
    window.KR.dev.enterLocation();
  });
  try {
    await page.waitForSelector('#modal [data-x="go"]', { timeout: 20000 });
  } catch (err) {
    const diag = await page.evaluate(() => ({
      screen: window.KR.screen,
      pos: { ...window.KR.campaign.pos },
      contracts: window.KR.campaign.contracts.map((c) => `${c.id}:${c.site}:${c.accepted}`),
      modalTitle: document.querySelector('#modal .modal-title')?.textContent || null,
      buttons: [...document.querySelectorAll('#modal [data-x]')].map((b) => b.dataset.x),
    }));
    console.log(`\ntrip ${trip}: could not open the deployment panel`);
    console.log(JSON.stringify(diag, null, 2));
    throw err;
  }
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  await page.waitForFunction(
    () => window.KR.mission && !window.KR.mission.intro?.active && !window.KR.mission.inserting,
    null, { timeout: 40000 });

  // Finish it the way the game does: complete the objective, walk to extraction.
  await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    m.interactables.filter((i) => i.kind === 'prisoner').forEach((i) => m.completeInteraction(i));
    const ex = m.level.extraction;
    m.player.x = ex.x; m.player.z = ex.z;
    m.prisoners.forEach((p, i) => { p.x = ex.x + i * 0.8; p.z = ex.z + 1.5; });
  });
  await page.waitForFunction(() => window.KR.mission?.over === true, null, { timeout: 60000 });
  await page.waitForTimeout(900);

  // Close the after-action report, which is what actually returns to the Reach.
  // A promotion earned on the deployment opens straight afterwards, so this
  // clears whatever is on screen until the map is actually back rather than
  // assuming one click does it.
  for (let i = 0; i < 12; i++) {
    const onWorld = await page.evaluate(() => window.KR.screen === 'world' && !!window.KR.world?.renderer);
    if (onWorld) break;
    await page.evaluate(() => {
      const pick = document.querySelector('#modal [data-perk]')
        || document.querySelector('#modal [data-x="close"]')
        || document.querySelector('#modal .btn-major')
        || document.querySelector('#modal button');
      pick?.click();
    });
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => window.KR.screen === 'world' && !!window.KR.world?.renderer,
    null, { timeout: 30000 });
  // Let it render a few frames before asking what it drew.
  await page.waitForTimeout(700);

  const r = await mapReport();
  rows.push({ trip, ...r });
  await page.screenshot({ path: `qa-roundtrip-${trip}.png` });
}

console.log('\nReturning to the Reach after a deployment:\n');
console.log('  trip  ctx lost  draw calls  triangles  geometries');
for (const r of rows) {
  console.log(`  ${String(r.trip).padStart(4)}`
    + `  ${String(r.lost).padStart(8)}`
    + `  ${String(r.calls).padStart(10)}`
    + `  ${String(r.triangles).padStart(9)}`
    + `  ${String(r.geometries).padStart(10)}`);
}

if (contextWarnings.length) {
  console.log('\ncontext warnings from the browser:');
  for (const w of [...new Set(contextWarnings)]) console.log(`  ${w}`);
}
console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 6)) console.log(`  ${e}`);

const dead = rows.filter((r) => r.lost || r.triangles === 0 || r.calls === 0);
// The leak warning is a failure in its own right, and it shows up BEFORE the
// screen goes black: the browser only starts killing contexts once the limit
// is reached, and which one dies is luck. A run can draw perfectly and still be
// one engagement away from the reported bug, so this is the check that matters.
const leaking = contextWarnings.some((w) => /Too many active WebGL contexts/i.test(w));
if (leaking) {
  console.log('\nFAIL — WebGL contexts are leaking across transitions.'
    + '\n  Each deployment and each return builds a renderer; dispose() alone does'
    + '\n  not hand the context back. The map goes black once the browser starts'
    + '\n  reclaiming the oldest one.');
} else if (dead.length) {
  console.log(`\nFAIL — the map drew nothing on ${dead.length} of ${rows.length} returns`
    + ` (trips ${dead.map((d) => d.trip).join(', ')})`);
} else {
  console.log(`\nOK — the map still draws after ${rows.length} round trips, and no contexts leaked`);
}

await browser.close();
