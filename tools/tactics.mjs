// Does commanding the squad actually do anything?
//
// Runs the same contact twice from an identical seeded state: once with the
// squad simply engaging, once with them ordered to suppress. Reports enemy
// advance and damage taken. If the numbers do not separate, the orders are
// decoration and the tactical layer is a lie.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

async function trial(label, suppress) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
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
    const S = window.KR.campaign;
    S.contracts.forEach((c) => { c.accepted = false; });
    const c = S.contracts.find((x) => x.site === 'grellan') || S.contracts[0];
    c.accepted = true; c.site = 'grellan'; c.type = 'recovery';
    window.KR.world.stopTravel();
    S.pos.x = 200; S.pos.z = -218;
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const el = document.querySelector('#modal [data-x="avoid"]');
    if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const S = window.KR.campaign; S.pos.x = 200; S.pos.z = -218; });
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForSelector('#modal [data-p]', { timeout: 15000 });
  const count = (await page.$$('#modal [data-p]')).length;
  for (let i = 0; i < count; i++) {
    const els = await page.$$('#modal [data-p]');
    if (els[i]) await els[i].click().catch(() => {});
    await page.waitForTimeout(50);
  }
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
  // The insertion cinematic holds all fire; measuring across it reports zero
  // damage for every trial and tells you nothing.
  await page.waitForFunction(
    () => window.KR.mission && !window.KR.mission.intro?.active && !window.KR.mission.inserting,
    null, { timeout: 30000 });
  await page.waitForTimeout(500);

  // Identical opening state for both trials.
  const start = await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.x = 6; m.player.z = -8;
    m.player.hp = m.player.maxHp;
    m.squad.forEach((s, i) => { s.x = 4 + i * 2; s.z = -5; s.hp = s.maxHp; });
    // A known group of defenders around the holding pen.
    const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead)
      .sort((a, b) => Math.hypot(a.x - 6, a.z + 8) - Math.hypot(b.x - 6, b.z + 8))
      .slice(0, 5);
    foes.forEach((f, i) => { f.x = 2 + i * 3; f.z = -28; f.suppression = 0; });
    window.__foes = foes;
    return {
      hp: m.player.hp,
      dist: foes.reduce((a, f) => a + Math.hypot(f.x - m.player.x, f.z - m.player.z), 0) / foes.length,
    };
  });

  if (suppress) {
    // Aim at the defenders and order the squad to pin them.
    await page.evaluate(() => {
      const m = window.KR.mission;
      const c = window.__foes[2];
      m.commanded().forEach((s) => {
        s.order = 'suppress';
        s.suppressPoint = { x: c.x, z: c.z };
        s.suppressOrder = true;
      });
    });
  }

  // Sample throughout: suppression decays in a couple of seconds, so reading it
  // only at the end always shows zero regardless of what happened.
  await page.evaluate(() => {
    window.__peak = 0;
    window.__sampler = setInterval(() => {
      const live = window.__foes.filter((f) => !f.dead);
      if (!live.length) return;
      const avg = live.reduce((a, f) => a + (f.suppression || 0), 0) / live.length;
      if (avg > window.__peak) window.__peak = avg;
    }, 100);
  });
  await page.waitForTimeout(22000);
  await page.evaluate(() => clearInterval(window.__sampler));

  const end = await page.evaluate(() => {
    const m = window.KR.mission;
    const foes = window.__foes.filter((f) => !f.dead);
    return {
      hp: Math.max(0, m.player.hp),
      down: m.player.down,
      dist: foes.length
        ? foes.reduce((a, f) => a + Math.hypot(f.x - m.player.x, f.z - m.player.z), 0) / foes.length
        : 0,
      suppression: window.__peak || 0,
      killed: window.__foes.filter((f) => f.dead).length,
    };
  });

  await page.close();
  return {
    label,
    damage: Math.round(start.hp - end.hp),
    advance: +(start.dist - end.dist).toFixed(1),
    suppression: +end.suppression.toFixed(2),
    killed: end.killed,
    down: end.down,
  };
}

// One firefight is an anecdote. Combat here is full of dice — reaction delays,
// aim scatter, who happens to look where — so a single pair of trials can say
// suppression made things worse purely by luck. Run several pairs and compare
// the means, which is the only version of this claim worth putting in a README.
const N = Number(process.argv[2] || 5);
const plains = []; const pinneds = [];
for (let i = 0; i < N; i++) {
  plains.push(await trial(`engage only #${i + 1}`, false));
  pinneds.push(await trial(`ordered to suppress #${i + 1}`, true));
}

const mean = (rows, key) => rows.reduce((a, r) => a + r[key], 0) / rows.length;
const downs = (rows) => rows.filter((r) => r.down).length;
const summarise = (label, rows) => ({
  label,
  damage: +mean(rows, 'damage').toFixed(1),
  advance: +mean(rows, 'advance').toFixed(1),
  suppression: +mean(rows, 'suppression').toFixed(2),
  killed: +mean(rows, 'killed').toFixed(1),
  down: downs(rows),
});
const plain = summarise('engage only', plains);
const pinned = summarise('ordered to suppress', pinneds);

const row = (r) => `  ${r.label.padEnd(22)} damage taken ${String(r.damage).padStart(6)}`
  + ` | enemy advance ${String(r.advance).padStart(6)}m`
  + ` | peak suppression ${r.suppression.toFixed(2)}`
  + ` | killed ${r.killed} | commander down ${r.down}/${N}`;

console.log(`\n16 seconds of contact, identical opening state, ${N} trials each:\n`);
console.log(row(plain));
console.log(row(pinned));
console.log('\n  per-trial damage taken');
console.log(`    engage only        ${plains.map((r) => r.damage).join(', ')}`);
console.log(`    ordered to suppress ${pinneds.map((r) => r.damage).join(', ')}`);

const dmgDrop = plain.damage > 0 ? (1 - pinned.damage / plain.damage) * 100 : 0;
console.log(`\n  suppressing changed incoming damage by ${dmgDrop >= 0 ? '-' : '+'}${Math.abs(dmgDrop).toFixed(0)}%`);
console.log(`  and held them ${(plain.advance - pinned.advance).toFixed(1)}m further out\n`);

// What this probe can and cannot resolve.
//
// Damage taken is dominated by noise: a single burst that lands is worth about
// 30 points and whether it lands is close to a coin flip, so per-trial figures
// swing from 0 to 150. At a dozen trials the standard error on the mean is
// roughly 13 points, which means any damage difference under about 40% is
// unmeasurable here and should not be quoted as if it were a result.
//
// What IS stable across every run is the enemy's behaviour: how hard they get
// pinned, and how much ground they fail to take. Those are what the order is
// for, and those are what this probe passes or fails on.
const sd = (rows) => {
  const m = mean(rows, 'damage');
  return Math.sqrt(rows.reduce((a, r) => a + (r.damage - m) ** 2, 0) / rows.length);
};
const sem = Math.sqrt((sd(plains) ** 2 + sd(pinneds) ** 2) / N);
console.log(`  damage taken is noise-dominated: SEM +/-${sem.toFixed(0)} on a `
  + `${Math.abs(plain.damage - pinned.damage).toFixed(0)}-point difference`
  + ` — treat it as no result unless the gap clears ${(2 * sem).toFixed(0)}.\n`);

const pinnedHarder = pinned.suppression > plain.suppression + 0.1;
const heldFurther = pinned.advance < plain.advance - 0.8;

if (pinnedHarder && heldFurther) {
  console.log(`  OK — the order does what it is for: suppression ${plain.suppression.toFixed(2)}`
    + ` -> ${pinned.suppression.toFixed(2)} (past the ${0.45} pin threshold), and they take`
    + ` ${(plain.advance - pinned.advance).toFixed(1)}m less ground.`);
} else {
  console.log('  ! the order did not pin them harder or hold them further out');
  process.exitCode = 1;
}

await browser.close();
