// Is losing a setback, or a reload prompt?
//
// A lost fight used to cost a line of log and two points of standing with
// whoever hired you. That is not a difficulty curve, it is a patience curve:
// the correct play on a bad afternoon was to reload, and every consequence
// system in the game — creeds, standing, favours, the broker — is worth nothing
// if defeat is free.
//
// The company gets taken instead. The whole design rests on one asymmetry, and
// it is the thing this probe exists to hold: EVERYTHING portable is gone, and
// NOBODY is dead who was not already dead. Get that backwards — kill people on
// a loss — and the player reloads anyway, and the feature has achieved nothing
// except a longer path back to the same save.
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
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

// ---- a company that loses everything except its people -------------------
const run = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const Roster = await import('/src/roster.js');
  const S = State.newCampaign(1717);
  S.credits = 9000;
  S.cargo = { water: 10, fuel_cells: 6, optics: 3 };
  S.armoury = { rifle: 2, smg: 1, shotgun: 1 };
  S.renown = 400;
  S.prisoners = [Roster.makeSoldier((await import('/src/util.js')).rng(2), { rank: 1 })];
  // Somebody carrying a wound, to see whether the time inside closes it.
  const hurt = S.roster[1];
  hurt.status = Roster.STATUS.WOUNDED;
  hurt.wound = { id: 'leg', name: 'Shattered shin', days: 6 };
  hurt.hp = 12;

  const before = {
    day: S.day, credits: S.credits, renown: S.renown,
    cargo: Object.values(S.cargo).reduce((a, b) => a + b, 0),
    arms: Object.values(S.armoury).reduce((a, b) => a + b, 0),
    roster: S.roster.length, alive: State.living(S).length,
    names: S.roster.map((s) => s.name).join('|'),
    pos: { x: S.pos.x, z: S.pos.z }, prisoners: S.prisoners.length,
    wounded: State.living(S).filter((s) => s.wound).length,
  };

  const notes = State.applyMissionResult(S, {
    success: false, reason: 'wiped', type: 'skirmish', site: null,
    enemyFaction: 'trust', kills: 3, soldierResults: [], recruits: [],
    loot: { credits: 0, weapons: [] }, stats: { shotsFired: 40, medkitsUsed: 0 },
    levelName: 'The Scour', partyId: null, suppliesUsed: 2, medicalUsed: 0,
  });

  const after = {
    day: S.day, credits: S.credits, renown: S.renown,
    cargo: Object.values(S.cargo).reduce((a, b) => a + b, 0),
    arms: Object.values(S.armoury).reduce((a, b) => a + b, 0),
    roster: S.roster.length, alive: State.living(S).length,
    names: S.roster.map((s) => s.name).join('|'),
    pos: { x: S.pos.x, z: S.pos.z }, prisoners: S.prisoners.length,
    wounded: State.living(S).filter((s) => s.wound).length,
  };
  return { before, after, notes: notes.map((n) => n.text) };
});

const { before: b, after: a } = run;
console.log('\n=== broken in the field ===');
const row = (label, x, y, want) => console.log(
  `  ${label.padEnd(16)} ${String(x).padStart(7)} → ${String(y).padStart(7)}   ${want}`);
row('day', b.day, a.day, 'time gone');
row('credits', b.credits, a.credits, 'most of it taken');
row('cargo', b.cargo, a.cargo, 'stripped');
row('armoury', b.arms, a.arms, 'weapons off the truck');
row('renown', b.renown, a.renown, 'word gets round');
row('prisoners', b.prisoners, a.prisoners, 'walked out with their own side');
row('wounded', b.wounded, a.wounded, 'the time inside closes wounds');
row('ON THE ROSTER', b.roster, a.roster, 'NOBODY DIES');
row('still alive', b.alive, a.alive, 'NOBODY DIES');
const moved = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
console.log(`  moved ${moved.toFixed(0)} units — put out in the captor's country`);
console.log('\n  ' + run.notes.join('\n  '));

// ---- withdrawing in good order is not the same thing ---------------------
const orderly = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const S = State.newCampaign(1717);
  S.credits = 9000;
  const before = { day: S.day, credits: S.credits };
  State.applyMissionResult(S, {
    success: false, reason: 'withdrew', type: 'skirmish', site: null,
    enemyFaction: 'trust', kills: 3, soldierResults: [], recruits: [],
    loot: { credits: 0, weapons: [] }, stats: { shotsFired: 40, medkitsUsed: 0 },
    levelName: 'The Scour', partyId: null, suppliesUsed: 2, medicalUsed: 0,
  });
  return { daysLost: S.day - before.day, creditsLost: before.credits - S.credits };
});
console.log(`\n=== pulling out in good order ===`);
console.log(`  days lost ${orderly.daysLost}, credits lost ${orderly.creditsLost}`);

// ---- and the pit never takes anybody -------------------------------------
const pit = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const S = State.newCampaign(1717);
  S.credits = 9000;
  const day = S.day;
  State.applyMissionResult(S, {
    success: false, reason: 'pit', type: 'pit', site: 'vetch',
    enemyFaction: null, kills: 3, soldierResults: [], recruits: [],
    loot: { credits: 0, weapons: [] }, stats: { shotsFired: 40, medkitsUsed: 0 },
    levelName: 'The Pit', partyId: null, pitRounds: 4, suppliesUsed: 0, medicalUsed: 0,
  });
  return { daysLost: S.day - day, creditsLost: 9000 - S.credits };
});
console.log(`\n=== losing in the pit ===`);
console.log(`  days lost ${pit.daysLost}, credits lost ${pit.creditsLost}`);

// ---- what the player is actually told ------------------------------------
// The sentence that matters is the one saying nobody is dead. A player who has
// just lost everything reloads before reading the numbers unless they are told,
// in the same breath, that the roster came out.
const panel = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const S = window.KR.campaign;
  S.credits = 9000;
  S.cargo = { water: 10, fuel_cells: 6 };
  S.armoury = { rifle: 2, smg: 1 };
  const res = {
    success: false, reason: 'wiped', type: 'skirmish', site: null,
    enemyFaction: 'trust', kills: 3, soldierResults: [], recruits: [],
    loot: { credits: 0, weapons: [] }, stats: { shotsFired: 40, medkitsUsed: 0 },
    levelName: 'The Scour', partyId: null, suppliesUsed: 2, medicalUsed: 0,
  };
  const notes = State.applyMissionResult(S, res);
  window.KR.dev.UI.afterAction(S, res, notes, { onClose: () => {} });
  return {
    verdict: document.querySelector('#modal .aar-verdict')?.textContent.trim(),
    tag: document.querySelector('#modal .modal-tag')?.textContent.trim(),
    told: document.querySelector('#modal .taken .prose')?.textContent.replace(/\s+/g, ' ').trim(),
    costs: [...document.querySelectorAll('#modal .taken-cost .val')].map((v) => v.textContent.trim()),
  };
});
await page.screenshot({ path: 'qa-capture.png' });
console.log(`\n=== what the player sees ===`);
console.log(`  verdict "${panel.verdict}"   tag "${panel.tag}"`);
console.log(`  ${panel.told}`);
console.log(`  costs [${panel.costs.join(', ')}]`);

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);

const fails = [];
// The asymmetry, in both directions.
if (a.roster !== b.roster || a.alive !== b.alive || a.names !== b.names) {
  fails.push('somebody died in captivity — the player will just reload');
}
if (!(a.day > b.day)) fails.push('no time passed');
if (!(a.credits < b.credits)) fails.push('they took no money');
if (!(a.cargo < b.cargo)) fails.push('the cargo was not touched');
if (!(a.arms < b.arms)) fails.push('the armoury was not touched');
if (!(a.renown < b.renown)) fails.push('no renown lost');
if (a.prisoners !== 0) fails.push('captives stayed captive while their side held you');
if (a.wounded >= b.wounded) fails.push('the time inside healed nobody');
if (moved < 50) fails.push('released exactly where you fell');
// A withdrawal must not be a capture.
if (orderly.daysLost > 0 || orderly.creditsLost > 0) fails.push('an orderly withdrawal was treated as a capture');
// Nor a bad night in the pit.
if (pit.daysLost > 0 || pit.creditsLost > 0) fails.push('losing in the pit got the company taken');
if (panel.verdict === 'WITHDRAWN') fails.push('being carried off the field reads as an orderly withdrawal');
if (!/buried|nobody/i.test(panel.told || '')) fails.push('the player is never told the roster survived');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: everything portable gone, everybody still alive');
await browser.close();
