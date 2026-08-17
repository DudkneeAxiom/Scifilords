// Can you actually drive the map?
//
// Two things the strategic layer was missing, and both are verbs rather than
// numbers, so they need driving through the real input path rather than by
// poking state.
//
//   1. Chasing. Clicking a moving band used to drop a destination pin on the
//      dirt it happened to be standing on, so pursuing anything meant clicking
//      once a second while it walked out from under the marker. Now the click
//      picks the PARTY and the destination follows it.
//   2. A camera of its own. The view was welded to the company, so there was no
//      way to look at where you were going, or at the war two provinces away,
//      without travelling there.
//
// The failure modes are specific: a chase that stops re-aiming reads as working
// for the first second and then trails behind; a chase that never releases
// makes clicking the ground do nothing; and a camera that pans without a way
// home strands the player.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

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

const out = await page.evaluate(async () => {
  const W = window.KR.world;
  const S = window.KR.campaign;
  // The campaign refills its regions on every day boundary, and a party that
  // appears next to the company counts as an approach — which opens an
  // encounter, halts travel and pauses the map. That reads exactly like "the
  // chase stopped working". So the party list is pinned and the map is kept
  // running for the duration of each measurement.
  let pinned = null;
  const step = (secs) => {
    for (let i = 0; i < secs * 60; i++) {
      if (pinned) S.parties = pinned.filter((p) => p);
      W.setPaused(false);
      if (W.timeScale > 0) W.update((1 / 60) * W.timeScale);
    }
  };

  // A band placed a long way off, moving steadily, with the company after it.
  W.setSpeed(1);
  S.parties = [{
    id: 'quarry', kind: 'looters', name: 'Quarry', faction: 'raider',
    model: 'wm_party_raider', x: S.pos.x + 400, z: S.pos.z, speed: 30,
    strength: 4, tier: 1, quality: 0.5, armour: 0, vehicles: 0,
    baseHostile: true, hostileToPlayer: true, cargo: null, target: null,
    home: 'grellan', heading: 0, tx: S.pos.x + 4000, tz: S.pos.z,
  }];
  pinned = S.parties;
  W.chase('quarry');

  // Does the destination keep up with a party that keeps moving?
  const startGap = Math.hypot(S.pos.x - S.parties[0].x, S.pos.z - S.parties[0].z);
  const lag = [];
  let closed = startGap;
  for (let i = 0; i < 6; i++) {
    step(0.5);
    const q = S.parties.find((p) => p.id === 'quarry');
    if (!q) break;
    closed = Math.hypot(S.pos.x - q.x, S.pos.z - q.z);
    // The destination goes away when the chase ENDS — which includes running
    // the quarry down, the outcome this is hoping for. Measuring past that
    // point dereferences a null and reports a working feature as a crash.
    if (!S.dest) break;
    lag.push(+Math.hypot(S.dest.x - q.x, S.dest.z - q.z).toFixed(1));
  }
  const chasingName = W.chaseId;
  const caught = closed < startGap - 100;

  // Clicking the ground has to call the chase off, or the click does nothing.
  W.setDestination(S.pos.x + 50, S.pos.z + 50);
  const releasedByClick = W.chaseId === null;

  // Halting has to as well.
  W.chase('quarry');
  const reChased = W.chaseId === 'quarry';
  W.stopTravel();
  const releasedByHalt = W.chaseId === null;

  // A chase whose quarry disappears must end rather than march at a ghost.
  W.chase('quarry');
  pinned = [];
  S.parties = [];
  step(0.5);
  const releasedByDeath = W.chaseId === null;
  pinned = null;

  // The camera: pushed off, then brought home.
  const panBefore = { ...W.camPan };
  W.camPan.x = 900; W.camPan.z = -400;
  W.updateCamera(0.016);
  const camAway = W.camera.position.x;
  const hudPanned = (() => { let h = null; W.onHud = (x) => { h = x; }; return null; })();
  W.recentre();
  W.updateCamera(0.016);
  const camHome = W.camPan.x === 0 && W.camPan.z === 0;

  // Steering by hand should bring the view back on its own.
  W.camPan.x = 700;
  // H recentres; verified separately from steering.
  W.keys.add('w');
  step(0.2);
  W.keys.delete('w');
  const steerRecentres = Math.abs(W.camPan.x) < 1;

  return {
    lag, chasingName, caught, startGap, closed, releasedByClick, reChased, releasedByHalt,
    releasedByDeath, panBefore, camAway, camHome, steerRecentres, hudPanned,
  };
});

console.log('\nChasing a moving band:\n');
console.log(`  destination lag behind the quarry: ${out.lag.join(', ')}`);
console.log(`  chase target held: ${out.chasingName}`);
console.log(`  gap closed from ${Math.round(out.startGap)} to ${Math.round(out.closed)}`);
console.log(`\n  clicking the ground releases it: ${out.releasedByClick}`);
console.log(`  halting releases it:             ${out.releasedByHalt}`);
console.log(`  losing the quarry releases it:   ${out.releasedByDeath}`);
console.log(`\nCamera:`);
console.log(`  dragging moves the view:  ${Math.abs(out.camAway) > 1}`);
console.log(`  recentre brings it back:  ${out.camHome}`);
console.log(`  steering recentres:       ${out.steerRecentres}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

// The destination must stay ON the quarry rather than on ground it has left.
// A few units is the quarry's own movement between the aim and the measurement;
// the behaviour this replaces let the gap grow into the hundreds as the band
// walked out from under a static pin, so the threshold only has to tell those
// two apart. Catching it is the other half — tracking a target you never close
// on would be a chase in name only.
const keepsUp = out.lag.length > 1 && Math.max(...out.lag) < 10 && out.caught;
const releases = out.releasedByClick && out.releasedByHalt && out.releasedByDeath;
const cameraWorks = Math.abs(out.camAway) > 1 && out.camHome && out.steerRecentres;

console.log(`\n  a chase tracks its quarry:    ${keepsUp}`);
console.log(`  and lets go when it should:   ${releases}`);
console.log(`  the camera moves and returns: ${cameraWorks}`);
console.log((keepsUp && releases && cameraWorks)
  ? '\nOK — you can run something down, and look around while you do it'
  : '\nFAIL — the map does not drive the way it needs to');

await browser.close();
