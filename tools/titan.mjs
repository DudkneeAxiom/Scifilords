// The Titan fight, checked against the thing it is supposed to teach.
//
// The design claim is: rifles do almost nothing to armour, concentrated fire
// beats a plate off, and the hole underneath takes crits. If those three are
// not measurably true then the boss is just a bullet sponge with extra steps.
// So this fires controlled bursts at armour, at a broken plate, and at bare
// hull, and compares what each one actually does.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-titan', { recursive: true });

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
    spec: { type: 'titan', site: 'roadside', layout: 'roadside', siteName: 'Titan' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
});
await page.waitForFunction(() => window.KR.mission?.titan, null, { timeout: 40000 });

const setup = await page.evaluate(() => {
  const m = window.KR.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  const e = m.titan;
  return {
    plates: e.plates.map((p) => ({ id: p.id, hp: p.maxHp, radius: p.radius })),
    hp: e.hp,
    height: e.char.group.children.length,
  };
});
console.log(`Titan: ${setup.hp} structure, ${setup.plates.length} armour sections`);
for (const p of setup.plates) console.log(`  ${p.id.padEnd(12)} ${p.hp} armour`);

// Fire a fixed number of identical rounds into a chosen region and report what
// it cost the machine. Damage is applied straight through applyDamage with a
// synthetic hit, so the only variable is which region was struck.
const burst = (region, rounds) => page.evaluate(({ region, rounds }) => {
  const m = window.KR.mission;
  const e = m.titan;
  const pl = region === 'hull' ? null : e.plates.find((p) => p.id === 'chest');
  const before = { hp: e.hp, plate: pl ? pl.hp : null, left: e.platesLeft };
  for (let i = 0; i < rounds; i++) {
    const wp = pl ? m.platePos(pl) : { x: e.x, y: 4, z: e.z };
    m.applyDamage(e, 30, m.player, { x: wp.x, y: wp.y, z: wp.z, plate: pl, kind: region });
  }
  return {
    structureLost: +(before.hp - e.hp).toFixed(1),
    plateLost: pl ? +(before.plate - Math.max(0, pl.hp)).toFixed(1) : null,
    broke: pl ? pl.broken : null,
    platesLeft: e.platesLeft,
  };
}, { region, rounds });

await page.evaluate(() => {
  const m = window.KR.mission;
  const e = m.titan;
  m.player.x = e.x; m.player.z = e.z + 20;
  m.camYaw = 0; m.camPitch = -0.12;
  m.loop();
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'qa-titan/01-intact.png' });

console.log('\n30-damage rounds, 10 of them, into each region:');
const armour = await burst('plate', 10);
console.log(`  intact armour    structure lost ${armour.structureLost}`
  + `  armour lost ${armour.plateLost}  broken: ${armour.broke}`);

const toBreak = await page.evaluate(() => {
  const m = window.KR.mission;
  const e = m.titan;
  const pl = e.plates.find((p) => p.id === 'chest');
  let n = 0;
  while (!pl.broken && n < 200) {
    const wp = m.platePos(pl);
    m.applyDamage(e, 30, m.player, { x: wp.x, y: wp.y, z: wp.z, plate: pl, kind: 'plate' });
    n++;
  }
  return { rounds: n, broken: pl.broken, slabHidden: !pl.slab.visible, coreShown: pl.core.visible,
    debris: m.effects.filter((f) => f.kind === 'debris').length, left: e.platesLeft };
});
console.log(`  breaking it took ${toBreak.rounds} more rounds`
  + ` — slab hidden: ${toBreak.slabHidden}, core exposed: ${toBreak.coreShown},`
  + ` debris on the ground: ${toBreak.debris}`);

await page.evaluate(() => {
  const m = window.KR.mission;
  const e = m.titan;
  m.player.x = e.x; m.player.z = e.z + 20;
  m.camYaw = 0; m.camPitch = -0.12;
  m.loop();
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'qa-titan/02-breached.png' });

const core = await burst('plate', 10);
console.log(`  exposed core     structure lost ${core.structureLost}`);
const hull = await burst('hull', 10);
console.log(`  bare hull        structure lost ${hull.structureLost}`);

const ratio = core.structureLost / Math.max(0.01, armour.structureLost);
const hullRatio = core.structureLost / Math.max(0.01, hull.structureLost);
console.log(`\n  a core hit is worth ${ratio.toFixed(0)}x an armour hit,`
  + ` and ${hullRatio.toFixed(1)}x a hull hit`);

// It has to be killable by shooting the cores, and it has to end the mission.
const kill = await page.evaluate(() => {
  const m = window.KR.mission;
  const e = m.titan;
  let rounds = 0;
  for (let guard = 0; guard < 4000 && !e.dead; guard++) {
    const open = e.plates.find((p) => p.broken) || e.plates[0];
    const wp = m.platePos(open);
    m.applyDamage(e, 30, m.player, { x: wp.x, y: wp.y, z: wp.z, plate: open, kind: 'core' });
    rounds++;
  }
  // Let the objective logic notice.
  for (let i = 0; i < 120; i++) m.step(1 / 60);
  return {
    dead: e.dead, rounds,
    objective: `${m.objective.progress}/${m.objective.need}`,
    done: !!m.objective.done, over: !!m.over, extract: !!m.extractArmed,
  };
});
console.log(`\n  killed after ${kill.rounds} rounds total`
  + ` — objective ${kill.objective}, complete: ${kill.done}, extraction armed: ${kill.extract}`);


console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
const ok = armour.structureLost < core.structureLost / 8 && toBreak.broken
  && toBreak.slabHidden && toBreak.coreShown && toBreak.debris > 0
  && kill.dead && kill.done && errors.length === 0;
console.log(ok
  ? '\nOK — armour blocks, breaking it exposes a core, and the core is where the fight is won.'
  : '\nFAIL — the boss does not teach what it is supposed to teach.');
await browser.close();
