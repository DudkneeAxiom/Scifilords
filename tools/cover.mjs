// Is cover protection, or decoration?
//
// It was decoration. The target capsule was the same height whatever the target
// was doing, so a crouched soldier behind a sandbag wall presented exactly the
// same silhouette to the ray test as one standing in the open, and the only
// thing cover did was widen the shooter's spread a little. That is a number,
// not a wall.
//
// The fix is to make the body genuinely shorter when tucked, so the existing
// ray-versus-box test finds the cover first. This measures that directly: fire
// a thousand rounds at a body behind a barricade and count what reaches it,
// tucked and leaning. The pair of numbers is the mechanic — if tucking does not
// stop most of it, cover is still decoration; if leaning does not expose you,
// there is no cost to shooting back and the trade has no teeth.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 60000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 20000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(500);

const out = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  const m = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'T',
      enemyFaction: 'trust' },
    squad: S.roster.slice(0, 3),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await m.start();
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

  // A piece of low cover with a body directly behind it, and a shooter on the
  // far side at a realistic firefight range.
  // Selected on coverH, not h. Since the ground stopped being flat, `h` is the
  // physical box — it reaches down to the lowest terrain under the footprint to
  // seal the gap bullets used to fly through, so on a slope it is taller than
  // the thing looks. coverH is what it stands proud of the ground by, which is
  // the "chest-high sandbag" this probe means.
  const cov = m.level.covers.find((o) => o.coverH > 0.7 && o.coverH < 1.5);
  const victim = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  const shooter = m.player;

  const { bodyCapsule } = await import('/src/mission.js');
  window.__cap = bodyCapsule;

  const trial = (tuck) => {
    victim.tuck = tuck;
    let hits = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      // Aim exactly the way the AI does: at the middle of whatever is showing.
      // Aiming at a fixed chest height instead would make any lowered body
      // untouchable and the whole measurement meaningless — it would report
      // cover working when what was really happening is that the shot sailed
      // over a crouching man standing in the open.
      const cap = window.__cap(victim);
      const origin = { x: shooter.x, y: shooter.y0 + 1.5, z: shooter.z };
      const tx = victim.x, ty = (cap.lo + cap.hi) / 2, tz = victim.z;
      const dx = tx - origin.x, dy = ty - origin.y, dz = tz - origin.z;
      const len = Math.hypot(dx, dy, dz);
      // A little spread, so this is a burst and not one repeated ray.
      const s = 0.02;
      const dir = {
        x: dx / len + (Math.random() - 0.5) * s,
        y: dy / len + (Math.random() - 0.5) * s,
        z: dz / len + (Math.random() - 0.5) * s,
      };
      const n = Math.hypot(dir.x, dir.y, dir.z);
      dir.x /= n; dir.y /= n; dir.z /= n;
      const hit = m.rayHit(origin, dir, 120, shooter);
      if (hit.entity === victim) hits++;
    }
    return hits / N;
  };

  // Put the victim hard behind the cover and the shooter square in front of it.
  const Level = await import('/src/level.js');
  const gap = 0.55;
  victim.x = cov.x; victim.z = cov.z + cov.hd + gap;
  shooter.x = cov.x; shooter.z = cov.z - cov.hd - 14;
  shooter.y0 = Level.heightAt(shooter.x, shooter.z);
  window.__base = Level.heightAt(victim.x, victim.z);

  const upright = trial(0);
  const tucked = trial(1);
  const leaning = trial(0.25);

  // Cover only protects from the side it is on. If a shooter can walk round to
  // ninety degrees and still be denied, this is not cover, it is an
  // invulnerability button — and the flanking orders the squad already has
  // would mean nothing.
  shooter.x = cov.x + cov.hw + 14; shooter.z = cov.z + cov.hd + gap;
  shooter.y0 = Level.heightAt(shooter.x, shooter.z);
  const flankedTucked = trial(1);

  // And in the open, for a control — cover must be doing this, not distance.
  shooter.x = cov.x; shooter.z = cov.z - cov.hd - 14;
  shooter.y0 = Level.heightAt(shooter.x, shooter.z);
  victim.z = cov.z - cov.hd - 6;
  const open = trial(0);
  const openTucked = trial(1);

  // The player's own cover state: can it be entered, does it lower the body,
  // does aiming raise it, does walking off break it?
  m.player.x = cov.x; m.player.z = cov.z + cov.hd + 0.6;
  m.grounded = true;
  const took = m.takeCover();
  const tuckedIn = (m.updateCover(0.016), m.player.tuck);
  m.aiming = true;
  for (let i = 0; i < 40; i++) m.updateCover(0.016);
  const leanOut = m.player.tuck;
  m.aiming = false;
  for (let i = 0; i < 40; i++) m.updateCover(0.016);
  const backDown = m.player.tuck;
  m.player.z += 4.5;
  m.updateCover(0.016);
  const brokeOff = !m.cover;

  return {
    coverH: +cov.coverH.toFixed(2),
    upright, tucked, leaning, open, openTucked, flankedTucked,
    took, tuckedIn: +tuckedIn.toFixed(2), leanOut: +leanOut.toFixed(2),
    backDown: +backDown.toFixed(2), brokeOff,
  };
});

const pct = (v) => `${(v * 100).toFixed(1)}%`;
console.log(`\n=== rounds that reach a body behind ${out.coverH}m cover, 14m away ===`);
console.log(`  standing up behind it   ${pct(out.upright)}`);
console.log(`  leaning out to shoot    ${pct(out.leaning)}`);
console.log(`  tucked down             ${pct(out.tucked)}`);
console.log(`  tucked, shot from 90°   ${pct(out.flankedTucked)}   <- flanking beats cover`);
console.log(`\n=== the same body in the open, as a control ===`);
console.log(`  standing                ${pct(out.open)}`);
console.log(`  crouched, no cover      ${pct(out.openTucked)}`);

console.log(`\n=== the player getting into it ===`);
console.log(`  took cover: ${out.took}`);
console.log(`  tucked ${out.tuckedIn} → aiming ${out.leanOut} → released ${out.backDown}`);
console.log(`  walking away broke cover: ${out.brokeOff}`);

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log('  ' + e);

const fails = [];
if (!(out.tucked < out.upright * 0.3)) {
  fails.push(`tucking only cut hits from ${pct(out.upright)} to ${pct(out.tucked)} — cover is still decoration`);
}
if (!(out.leaning > out.tucked * 2)) fails.push('leaning out costs nothing, so the trade has no teeth');
// Control: crouching in the open must NOT be a magic shield. If it is, the
// effect is coming from the body height alone rather than from the cover.
if (out.openTucked < out.open * 0.35) fails.push('crouching in the open is doing the work, not the cover');
if (out.flankedTucked < 0.4) fails.push('cover holds from the flank too — that is invulnerability, not cover');
if (!out.took) fails.push('the player could not get into cover');
if (!(out.tuckedIn > 0.8 && out.leanOut < 0.35)) fails.push('leaning does not raise the body');
if (!(out.backDown > 0.8)) fails.push('releasing aim does not get back down');
if (!out.brokeOff) fails.push('walking away does not break cover');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: cover stops rounds, leaning out spends that protection');
await browser.close();
