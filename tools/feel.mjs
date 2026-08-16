// What is it actually like to shoot at somebody?
//
// The report is that combat feels terrible for the player. Rather than play a
// whole firefight and average everything together — where "I could not see him"
// and "I could see him and nothing happened" look identical — this stages three
// isolated engagements and reports them separately:
//
//   1. one enemy in the open at 20m, which is the floor: if holding the trigger
//      on an exposed man does not kill him promptly, the gun is broken;
//   2. the same enemy behind low cover, which is the trade the cover system is
//      supposed to create;
//   3. a real garrison, played by walking in and shooting, which is what the
//      player actually does.
//
// Kept separate because the first is a bug if it fails and the second is a
// design choice, and averaging them hides both.
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
await page.waitForTimeout(400);

const out = await page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.min.js');
  const { Mission, bodyCapsule } = await import('/src/mission.js');
  const State = await import('/src/state.js');
  const Level = await import('/src/level.js');
  const G = window.KR;
  const S = State.newCampaign(12345);
  G.campaign = S;
  S.renown = 4000;
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  const m = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'T',
      enemyFaction: 'trust' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await m.start();
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  const p = m.player;

  // A stretch of open ground with nothing in it — checked along its whole
  // length, not just at one end. Testing only where the shooter stands leaves
  // the target free to be standing inside a building, which is exactly how the
  // "open" duel came out completely unhittable.
  const openLane = (len) => {
    const free = (x, z) => !m.level.obstacles.some((o) =>
      Math.abs(x - o.x) < o.hw + 3 && Math.abs(z - o.z) < o.hd + 3);
    for (let r = 0; r < 900; r++) {
      const x = -50 + (r % 30) * 4, z = -55 + Math.floor(r / 30) * 4;
      let ok = true;
      for (let s = 0; s <= len && ok; s += 2) if (!free(x, z - s)) ok = false;
      if (ok) return { x, z };
    }
    return { x: 0, z: 0 };
  };

  // Hold the trigger on one target and time the kill.
  //
  // Driven through the game's own input path — mouse.down, and let updatePlayer
  // pick the aim point from the camera — rather than by calling fire() with
  // hand-computed coordinates. The player's rounds leave the CAMERA so that the
  // crosshair is truthful, so any probe that supplies its own origin is
  // measuring a gun the game does not have. A probe in this project made
  // exactly this mistake before by never setting mouse.down at all.
  const duel = (label, setup) => {
    const t = m.entities.find((e) => e.side === 'enemy');
    t.dead = false; t.down = false; t.hp = t.maxHp; t.tuck = 0;
    t.target = null; t.state = 'idle';
    p.hp = p.maxHp; p.down = false;
    m.over = false;
    setup(t);
    const hold = { x: t.x, z: t.z };
    m.aiming = true; m.mouse.right = true; m.mouse.down = false;
    // Let the camera reach its follow position before a shot is fired.
    for (let i = 0; i < 40; i++) {
      m.camYaw = Math.atan2(t.x - p.x, t.z - p.z) - Math.PI;
      m.camPitch = 0;
      m.step(0.016);
      m.updateCamera(0.016);
      t.x = hold.x; t.z = hold.z;
    }
    p.ammo = p.weapon.mag; p.reloading = 0; p.cooldown = 0;
    const startHp = t.hp;
    let frames = 0, hittable = 0, killAt = null;
    const shotsBefore = m.stats.shotsFired;
    const t0 = m.time;
    m.mouse.down = true;
    for (let i = 0; i < 900 && killAt === null; i++) {
      frames++;
      m.camYaw = Math.atan2(t.x - p.x, t.z - p.z) - Math.PI;
      m.camPitch = 0;
      const cap = bodyCapsule(t);
      const o = new THREE.Vector3();
      m.camera.getWorldPosition(o);
      const ty = (cap.lo + cap.hi) / 2;
      const dx = t.x - o.x, dy = ty - o.y, dz = t.z - o.z;
      const len = Math.hypot(dx, dy, dz);
      const probe = m.rayHit({ x: o.x, y: o.y, z: o.z },
        { x: dx / len, y: dy / len, z: dz / len }, 200, p);
      if (probe.entity === t) hittable++;
      m.step(0.016);
      m.updateCamera(0.016);
      if (t.dead || t.down) killAt = m.time - t0;
      else { t.x = hold.x; t.z = hold.z; }
    }
    m.mouse.down = false;
    const shots = m.stats.shotsFired - shotsBefore;
    return {
      label, shots, damage: Math.round(startHp - t.hp),
      killAt: killAt === null ? null : +killAt.toFixed(1),
      hittableShare: +(hittable / frames).toFixed(3),
    };
  };

  const spot = openLane(20);
  const open = duel('in the open, 20m', (t) => {
    p.x = spot.x; p.z = spot.z;
    t.x = spot.x; t.z = spot.z - 20;
  });

  const cov = m.level.covers.find((o) => o.h > 0.7 && o.h < 1.6);
  const behind = duel('behind cover, tucked', (t) => {
    p.x = cov.x; p.z = cov.z - 16;
    t.x = cov.x; t.z = cov.z + cov.hd + 0.6;
    t.tuck = 1;
  });
  const popped = duel('behind cover, firing back', (t) => {
    p.x = cov.x; p.z = cov.z - 16;
    t.x = cov.x; t.z = cov.z + cov.hd + 0.6;
    t.tuck = 0;
  });

  // How long does the player last, and to how many guns?
  //
  // This is the number behind "combat feels terrible": the player needs about a
  // second and a half per man, so what matters is how many seconds they get
  // before four of them together take the health bar off.
  const survival = (label, stance) => {
    const foes = m.entities.filter((e) => e.side === 'enemy');
    foes.forEach((e) => {
      e.dead = false; e.down = false; e.hp = e.maxHp; e.tuck = 0;
      e.target = p; e.state = 'engage'; e.alert = 1; e.suppression = 0;
    });
    p.hp = p.maxHp; p.down = false; p.tuck = 0;
    m.over = false;
    m.cover = null;
    const spot2 = openLane(26);
    p.x = spot2.x; p.z = spot2.z;
    foes.forEach((e, i) => {
      const a = -0.5 + i * 0.33;
      e.x = p.x + Math.sin(a) * 22; e.z = p.z - Math.cos(a) * 22;
    });
    stance();
    const hold = foes.map((e) => ({ x: e.x, z: e.z }));
    let downAt = null, incoming = 0;
    const t0 = m.time;
    let last = p.hp;
    for (let i = 0; i < 1800 && downAt === null; i++) {
      m.camYaw = Math.atan2(foes[0].x - p.x, foes[0].z - p.z) - Math.PI;
      m.step(0.016);
      m.updateCamera(0.016);
      // Pin them so this measures incoming fire, not a chase.
      foes.forEach((e, k) => { e.x = hold[k].x; e.z = hold[k].z; });
      if (p.hp < last) incoming += last - p.hp;
      last = p.hp;
      if (p.down || p.hp <= 0) downAt = m.time - t0;
    }
    return {
      label, guns: foes.length,
      downAt: downAt === null ? null : +downAt.toFixed(1),
      hpLeft: Math.round(p.hp),
      dps: +(incoming / Math.max(0.1, m.time - t0)).toFixed(1),
    };
  };

  const standing = survival('standing in the open', () => {});
  const tucked = survival('tucked, no cover', () => { p.tuck = 1; });

  return { open, behind, popped, standing, tucked };
});

const row = (d) => `  ${d.label.padEnd(26)} ${String(d.shots).padStart(4)} shots  `
  + `${String(d.damage).padStart(4)} damage  hittable ${(d.hittableShare * 100).toFixed(0).padStart(3)}%  `
  + `kill ${d.killAt === null ? 'never' : `${d.killAt}s`}`;

console.log('\n=== staged duels ===');
console.log(row(out.open));
console.log(row(out.behind));
console.log(row(out.popped));

console.log('\n=== how long the player lasts under fire ===');
for (const sv of [out.standing, out.tucked]) {
  console.log(`  ${sv.label.padEnd(24)} ${sv.guns} guns  ${String(sv.dps).padStart(5)} dmg/sec  `
    + `down after ${sv.downAt === null ? 'never' : `${sv.downAt}s`}  hp left ${sv.hpLeft}`);
}

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log('  ' + e);

const fails = [];
// The floor. An exposed man at 20m must die promptly to sustained aimed fire.
if (out.open.damage <= 0) fails.push('an exposed man at 20m took no damage at all');
if (out.open.hittableShare < 0.9) fails.push(`open target only hittable ${(out.open.hittableShare * 100).toFixed(0)}%`);
if (out.open.killAt === null) fails.push('an exposed man at 20m never died');
else if (out.open.killAt > 6) fails.push(`exposed man took ${out.open.killAt}s to kill`);
// The trade: cover protects, but coming up to shoot has to expose them.
if (out.popped.hittableShare < 0.6) fails.push('an enemy firing back is still not hittable');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: shooting people works');
await browser.close();
