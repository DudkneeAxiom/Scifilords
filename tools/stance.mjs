// Do soldiers stand on the slope, or in it?
//
// Everyone is placed at one heightAt() sample and drawn upright, which was
// exactly right on a flat pan. With relief it means a rigid body on tilted
// ground: one boot in the air, the other buried. This measures the thing that
// actually matters — how far each foot is from the ground it is supposed to be
// standing on — rather than eyeballing a screenshot, because a lean applied
// about the wrong axis looks fine head-on and is wrong from the side.
//
// It also checks the sign, in both axes and at several facings. Getting a lean
// backwards is the classic version of this bug and it is invisible in a still.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });

const out = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const Level = await import('/src/level.js');
  const State = window.KR.dev.State;
  const S = State.newCampaign(12345);
  window.KR.campaign = S;
  const m = new Mission({
    campaign: S, spec: { type: 'sabotage', site: 'grellan', layout: 'array' },
    squad: State.ready(S).slice(0, 4), container: document.getElementById('viewport'),
    onHud() {}, onToast() {}, onIntro() {}, onWheel() {}, onEnd() {},
  });
  await m.start();
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

  const e = m.squad[0];
  const THREE = (await import('/vendor/three/three.module.min.js'));

  // Find the steepest ground on the site to test against — a lean that shows on
  // gentle ground is not evidence it holds where it matters.
  let best = { g: 0, x: 0, z: 0 };
  for (let x = -90; x <= 90; x += 3) {
    for (let z = -90; z <= 90; z += 3) {
      const gx = (Level.heightAt(x + 1, z) - Level.heightAt(x - 1, z)) / 2;
      const gz = (Level.heightAt(x, z + 1) - Level.heightAt(x, z - 1)) / 2;
      const g = Math.hypot(gx, gz);
      if (g > best.g) best = { g, x, z };
    }
  }

  // Where the feet actually are, in world space, versus the ground under them.
  const footGap = () => {
    e.char.group.updateMatrixWorld(true);
    const gaps = [];
    for (const name of ['kneeL', 'kneeR']) {
      const node = e.char.rig[name];
      if (!node) continue;
      const p = new THREE.Vector3();
      node.getWorldPosition(p);
      // The knee hangs about 0.5m above the sole on this rig; what matters is
      // the DIFFERENCE between the two sides, not the absolute offset.
      gaps.push(p.y - Level.heightAt(p.x, p.z));
    }
    return gaps;
  };

  const sample = (yaw, useSlope) => {
    e.x = best.x; e.z = best.z; e.yaw = yaw;
    e.down = false; e.dead = false;
    m.syncVisuals(0.016);
    // Settle the smoothing so this measures the target lean, not the approach.
    for (let i = 0; i < 200; i++) m.syncVisuals(0.016);
    const g = footGap();
    return {
      yaw: +yaw.toFixed(2),
      pitch: +e.char.group.rotation.x.toFixed(3),
      roll: +e.char.group.rotation.z.toFixed(3),
      footSpread: +Math.abs(g[0] - g[1]).toFixed(3),
    };
  };

  const slope = { gx: 0, gz: 0 };
  slope.gx = (Level.heightAt(best.x + 1, best.z) - Level.heightAt(best.x - 1, best.z)) / 2;
  slope.gz = (Level.heightAt(best.x, best.z + 1) - Level.heightAt(best.x, best.z - 1)) / 2;

  const facings = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const withSlope = facings.map((y) => sample(y, true));

  // Turn the feature off and measure the same spots, so the improvement is a
  // comparison rather than a number with nothing to sit against.
  const realUpdate = e.char.update;
  e.char.update = (dt, o) => realUpdate(dt, { ...o, slopePitch: 0, slopeRoll: 0 });
  const without = facings.map((y) => sample(y, false));
  e.char.update = realUpdate;

  // A body on a hillside should lie along it, not float level.
  e.x = best.x; e.z = best.z; e.yaw = 0; e.dead = true;
  for (let i = 0; i < 300; i++) m.syncVisuals(0.016);
  const deadRoll = +e.char.group.rotation.z.toFixed(3);

  // Somebody on a walkway stays level however the ground under it runs.
  //
  // Driven by setting elev directly on the STEEPEST ground rather than by
  // finding a real deck: not every layout has one — `array` has none at all —
  // and a deck that happens to sit on flat ground proves nothing, because the
  // lean would be zero anyway. e.elev is what the guard actually keys on, and
  // this is the spot where failing to honour it would be most obvious.
  e.dead = false; e.x = best.x; e.z = best.z; e.yaw = 0;
  e.elev = 3;
  for (let i = 0; i < 300; i++) m.syncVisuals(0.016);
  const onDeck = {
    pitch: +e.char.group.rotation.x.toFixed(3),
    roll: +e.char.group.rotation.z.toFixed(3),
  };
  e.elev = 0;

  return {
    steepest: { x: best.x, z: best.z, deg: +(Math.atan(best.g) * 57.3).toFixed(1) },
    slope: { alongX: +slope.gx.toFixed(3), alongZ: +slope.gz.toFixed(3) },
    withSlope, without, deadRoll, onDeck,
    order: e.char.group.rotation.order,
  };
});

console.log(`\nSteepest ground on the site: ${out.steepest.deg}deg at`
  + ` (${out.steepest.x}, ${out.steepest.z})`);
console.log(`  ground falls ${out.slope.alongX > 0 ? 'up' : 'down'} +X (${out.slope.alongX}),`
  + ` ${out.slope.alongZ > 0 ? 'up' : 'down'} +Z (${out.slope.alongZ})`);
console.log(`  rotation order: ${out.order}`);

console.log('\nStanding on it, facing four ways:\n');
console.log('  facing    pitch    roll   feet out of level');
for (let i = 0; i < out.withSlope.length; i++) {
  const w = out.withSlope[i], n = out.without[i];
  console.log(`  ${String(w.yaw).padStart(6)}`
    + `  ${String(w.pitch).padStart(7)}`
    + `  ${String(w.roll).padStart(6)}`
    + `   ${String(w.footSpread).padStart(5)}  (was ${n.footSpread} upright)`);
}

console.log(`\n  a body lying on the hillside rolls ${out.deadRoll}`);
console.log(`  somebody standing on a walkway: pitch ${out.onDeck?.pitch}, roll ${out.onDeck?.roll}`);
console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

// The lean has to actually level the feet, at every facing, and it has to leave
// anyone standing on a structure alone.
const improved = out.withSlope.every((w, i) => w.footSpread <= out.without[i].footSpread + 1e-6);
const anyLean = out.withSlope.some((w) => Math.abs(w.pitch) > 0.02 || Math.abs(w.roll) > 0.02);
const deckLevel = !!out.onDeck
  && Math.abs(out.onDeck.pitch) < 0.02 && Math.abs(out.onDeck.roll) < 0.02;
console.log((improved && anyLean && deckLevel)
  ? '\nOK — they stand on the ground they are on, and stay level on a walkway'
  : '\nFAIL — the lean is missing, backwards, or applied where it should not be');

await browser.close();
