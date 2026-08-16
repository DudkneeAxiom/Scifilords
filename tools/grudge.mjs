// Is there somebody out there with your rifles?
//
// Capture on its own is a tax paid to nobody: a fortnight and most of the money
// vanish, and the only response available is to earn it again. Handing the loot
// to a named commander who stays on the map turns the worst afternoon in the
// game into the start of something.
//
// The claim being tested is exactness. If beating them pays a rough consolation
// sum rather than returning the specific credits, crates and weapons that were
// taken, then this is a bounty with a name attached and not a recovery — so
// every figure is compared against what capture actually took, not against a
// plausible range.
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

const loseTo = (faction) => `
  const S = State.newCampaign(2024);
  S.credits = 9000;
  S.cargo = { water: 10, fuel_cells: 6, optics: 3 };
  S.armoury = { rifle: 2, smg: 1, shotgun: 1 };
  S.renown = 500;
  const notes = State.applyMissionResult(S, {
    success: false, reason: 'wiped', type: 'skirmish', site: null,
    enemyFaction: '${faction}', kills: 2, soldierResults: [], recruits: [],
    loot: { credits: 0, weapons: [] }, stats: { shotsFired: 30, medkitsUsed: 0 },
    levelName: 'The Scour', partyId: null, suppliesUsed: 2, medicalUsed: 0,
  });`;

// ---- taken, and by somebody -----------------------------------------------
const taken = await page.evaluate(async (src) => {
  const State = await import('/src/state.js');
  // eslint-disable-next-line no-new-func
  const fn = new Function('State', `${src}
    const g = S.grudge;
    const p = S.parties.find((x) => x.id === g.partyId);
    return {
      who: g.who, captor: g.captor, name: p.name, strength: p.strength,
      hostile: p.hostileToPlayer, marked: !!p.grudge,
      holdsCredits: p.holds.credits, holdsArms: p.holds.arms.length,
      grudgeCredits: g.credits, grudgeCargo: g.cargo, grudgeArms: g.arms,
      credits: S.credits, cargo: S.cargo, armoury: S.armoury,
      notes: notes.map((n) => n.text),
    };`);
  return fn(State);
}, loseTo('trust'));

console.log('\n=== somebody took it ===');
console.log(`  ${taken.who} (${taken.captor}) — "${taken.name}", ${taken.strength} strong, hostile ${taken.hostile}`);
console.log(`  holding ${taken.holdsCredits} credits and ${taken.holdsArms} weapons`);
console.log(`  you have ${taken.credits} credits left`);
console.log(`  cargo left: ${JSON.stringify(taken.cargo)}`);
console.log(`  they hold:  ${JSON.stringify(taken.grudgeCargo)}`);

// ---- and beating them gives it back, exactly ------------------------------
const back = await page.evaluate(async (src) => {
  const State = await import('/src/state.js');
  // eslint-disable-next-line no-new-func
  const fn = new Function('State', `${src}
    const g = { ...S.grudge, cargo: { ...S.grudge.cargo }, arms: [...S.grudge.arms] };
    const before = {
      credits: S.credits, cargo: { ...S.cargo }, armoury: { ...S.armoury },
      renown: S.renown, parties: S.parties.length,
    };
    // Settled directly rather than by playing the fight, because
    // applyMissionResult advances the clock and a day tick pays wages — so a
    // net-credits reading is short by a day's payroll whenever the fight
    // crosses midnight, which makes the balance the wrong instrument for an
    // exactness claim. It passed here only by not crossing one.
    State.settleGrudge(S, g.partyId);
    S.parties = S.parties.filter((p) => p.id !== g.partyId);
    return {
      owed: g,
      creditsBack: S.credits - before.credits,
      cargoBack: Object.fromEntries(Object.keys(g.cargo).map((k) =>
        [k, (S.cargo[k] || 0) - (before.cargo[k] || 0)])),
      armsBack: g.arms.map((id) => (S.armoury[id] || 0) - (before.armoury[id] || 0)),
      renownGain: S.renown - before.renown,
      grudgeGone: !S.grudge,
      partyGone: !S.parties.some((p) => p.id === g.partyId),
    };`);
  return fn(State);
}, loseTo('trust'));

console.log('\n=== and taking it back ===');
console.log(`  owed ${back.owed.credits} credits — got back ${back.creditsBack}`
  + `  ${back.creditsBack >= back.owed.credits ? 'OK' : 'SHORT'}`);
console.log(`  owed cargo ${JSON.stringify(back.owed.cargo)} — got ${JSON.stringify(back.cargoBack)}`);
console.log(`  owed ${back.owed.arms.length} weapons — each returned: [${back.armsBack.join(', ')}]`);
console.log(`  renown +${back.renownGain}, grudge closed ${back.grudgeGone}, party swept ${back.partyGone}`);

// ---- beating somebody else does not settle it ----------------------------
const other = await page.evaluate(async (src) => {
  const State = await import('/src/state.js');
  // eslint-disable-next-line no-new-func
  const fn = new Function('State', `${src}
    const g = S.grudge;
    const someoneElse = S.parties.find((p) => p.id !== g.partyId);
    const before = S.credits;
    State.applyMissionResult(S, {
      success: true, reason: 'cleared', type: 'skirmish', site: null,
      enemyFaction: 'raider', kills: 4, soldierResults: [], recruits: [],
      loot: { credits: 0, weapons: [] }, stats: { shotsFired: 40, medkitsUsed: 0 },
      levelName: 'The Scour', partyId: someoneElse.id, suppliesUsed: 1, medicalUsed: 0,
    });
    return { stillOwed: !!S.grudge, windfall: S.credits - before };`);
  return fn(State);
}, loseTo('trust'));
console.log(`\n=== beating a different band ===`);
console.log(`  grudge still open: ${other.stillOwed}  (they picked up ${other.windfall} in ordinary spoils)`);

// ---- they do not carry it forever ----------------------------------------
const cold = await page.evaluate(async (src) => {
  const State = await import('/src/state.js');
  // eslint-disable-next-line no-new-func
  const fn = new Function('State', `${src}
    const g = S.grudge;
    const rows = [];
    for (const d of [10, 30, State.GRUDGE_DAYS + 1]) {
      const S2 = State.newCampaign(2024);
      S2.grudge = { ...g, cargo: { ...g.cargo }, arms: [...g.arms] };
      S2.parties = [{ id: g.partyId, name: g.who + "'s command", grudge: true, holds: {} }];
      S2.day = g.since + d;
      State.tickGrudge(S2);
      rows.push({ d, open: !!S2.grudge, name: S2.parties[0].name });
    }
    return rows;`);
  return fn(State);
}, loseTo('trust'));
console.log(`\n=== how long they hold it (expires after ${'GRUDGE_DAYS'}) ===`);
for (const r of cold) console.log(`  ${String(r.d).padStart(3)} days later: still owed ${r.open}  "${r.name}"`);

// ---- and you can see it from the map -------------------------------------
const onMap = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const S = window.KR.campaign;
  S.credits = 9000;
  S.cargo = { water: 8 };
  S.armoury = { rifle: 2, smg: 1 };
  State.applyMissionResult(S, {
    success: false, reason: 'wiped', type: 'skirmish', site: null,
    enemyFaction: 'syndic', kills: 1, soldierResults: [], recruits: [],
    loot: { credits: 0, weapons: [] }, stats: { shotsFired: 20, medkitsUsed: 0 },
    levelName: 'The Weal', partyId: null, suppliesUsed: 1, medicalUsed: 0,
  });
  // Stand next to them so the label is definitely on screen.
  const p = S.parties.find((x) => x.grudge);
  S.pos.x = p.x + 40; S.pos.z = p.z + 40;
  return new Promise((res) => setTimeout(() => res({
    panel: document.getElementById('wh-grudge')?.classList.contains('hidden') === false,
    text: document.getElementById('wh-grudge')?.textContent.replace(/\s+/g, ' ').trim(),
    label: [...document.querySelectorAll('.plbl.grudge')].map((l) => l.textContent),
  }), 900));
});
await page.screenshot({ path: 'qa-grudge.png' });
console.log(`\n=== on the map ===`);
console.log(`  panel shown: ${onMap.panel}`);
console.log(`  "${onMap.text}"`);
console.log(`  named label on the map: [${onMap.label.join(', ')}]`);

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);

const fails = [];
if (!taken.who || !/'s command$/.test(taken.name)) fails.push('the captor has no name');
if (!taken.hostile || !taken.marked) fails.push('the captor is not on the map as an enemy');
if (taken.holdsCredits !== taken.grudgeCredits) fails.push('the party is not carrying what was taken');
// Exactness, in both directions.
if (back.creditsBack !== back.owed.credits) fails.push('credits came back wrong');
for (const [k, v] of Object.entries(back.cargoBack)) {
  if (v !== back.owed.cargo[k]) fails.push(`${k} came back ${v}, owed ${back.owed.cargo[k]}`);
}
if (back.armsBack.some((n) => n !== 1)) fails.push('the weapons did not come back');
if (!(back.renownGain > 0)) fails.push('no renown for settling it');
if (!back.grudgeGone) fails.push('the grudge stayed open after being settled');
if (!other.stillOwed) fails.push('beating an unrelated band closed the grudge');
if (cold[0].open !== true || cold[2].open !== false) fails.push('the grudge does not go cold on schedule');
if (!onMap.panel) fails.push('the world HUD never mentions it');
if (!/days before it is spent/.test(onMap.text || '')) fails.push('no countdown, so no reason to hurry');
if (!onMap.label.length) fails.push('they are just another number on the map');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: they take it, they carry it, you can take it back');
await browser.close();
