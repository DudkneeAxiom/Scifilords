// Raiding a settlement.
//
// Standing could only ever fall from seizing a place, which made it a number
// that drifted upward and never came back down. A raid is the way to SPEND it:
// you can be a customer at a town or you can empty it once, and this checks
// that both halves of that trade are real — that the loot is worth taking, and
// that the place genuinely stops dealing with you afterwards.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-raid', { recursive: true });

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

// ---- the deployment itself ------------------------------------------------
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
    spec: { type: 'raid', site: 'vetch', layout: 'settlement', siteName: 'Vetch Crossing',
      enemyFaction: 'syndic' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
});
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

const setup = await page.evaluate(() => {
  const m = window.KR.mission;
  return {
    objective: m.objective.text,
    need: m.objective.need,
    stores: m.interactables.filter((i) => i.kind === 'loot').length,
    garrison: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
    extractIsSpawn: Math.hypot(m.level.extraction.x - m.level.playerSpawn.x,
      m.level.extraction.z - m.level.playerSpawn.z) < 3,
  };
});
console.log(`The raid: "${setup.objective}"`);
console.log(`  ${setup.stores} stores to break open, ${setup.garrison} defenders,`
  + ` extraction back where you came in: ${setup.extractIsSpawn}`);

// Breaking each store should bring more of them out — that is the whole shape
// of the mission.
const escalation = await page.evaluate(() => {
  const m = window.KR.mission;
  const rows = [];
  const stores = m.interactables.filter((i) => i.kind === 'loot');
  for (let i = 0; i < stores.length; i++) {
    const before = m.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
    m.completeInteraction(stores[i]);
    const after = m.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
    const hunting = m.entities.filter((e) => e.side === 'enemy' && !e.dead
      && e.state === 'hunt').length;
    rows.push({ n: i + 1, before, after, hunting, taken: m.raidTaken,
      progress: `${m.objective.progress}/${m.objective.need}` });
  }
  for (let i = 0; i < 60; i++) m.step(1 / 60);
  return { rows, done: !!m.objective.done, extract: !!m.extractArmed };
});
console.log('\n  store  defenders before  after  hunting  progress');
for (const r of escalation.rows) {
  console.log(`  ${String(r.n).padStart(5)}  ${String(r.before).padStart(16)}`
    + `  ${String(r.after).padStart(5)}  ${String(r.hunting).padStart(7)}  ${r.progress}`);
}
console.log(`  objective complete: ${escalation.done}, extraction armed: ${escalation.extract}`);

// ---- what it pays, and what it costs -------------------------------------
const consequences = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  // Somewhere that flies a flag, or the faction penalty has nothing to hit.
  const site = DATA.LOCATIONS.find((l) => l.kind === 'settlement' && l.faction).id;
  const loc = DATA.LOCATIONS.find((l) => l.id === site);
  // Somewhere you are welcome, so the fall has room to show.
  S.relations = {}; S.relations[site] = 60;
  S.cargo = {}; S.spoils = { credits: 0, cargo: {}, armoury: {}, armourPool: {}, kitPool: {} };
  const before = {
    rel: State.relationOf(S, site),
    tier: State.relationTier(S, site).name,
    rep: loc.faction ? S.rep[loc.faction] : null,
    morale: Math.round(S.morale),
    recruits: State.recruitPool(S, site).length,
  };
  const notes = State.applyMissionResult(S, {
    success: true, type: 'raid', site, raidTaken: 3, kills: 6,
    soldierResults: [], suppliesUsed: 2,
  });
  const after = {
    rel: State.relationOf(S, site),
    tier: State.relationTier(S, site).name,
    rep: loc.faction ? S.rep[loc.faction] : null,
    morale: Math.round(S.morale),
    recruits: State.recruitPool(S, site).length,
    spoilsCredits: S.spoils.credits,
    spoilsGoods: Object.entries(S.spoils.cargo || {}).map(([g, n]) => `${n} ${g}`),
  };
  return { before, after, notes: notes.map((n) => n.text) };
});
console.log('\nAfter raiding a place that regarded you well:');
console.log(`  standing  ${consequences.before.rel} (${consequences.before.tier})`
  + ` -> ${consequences.after.rel} (${consequences.after.tier})`);
console.log(`  faction   ${consequences.before.rep} -> ${consequences.after.rep}`);
console.log(`  morale    ${consequences.before.morale} -> ${consequences.after.morale}`);
console.log(`  recruits offered there  ${consequences.before.recruits} -> ${consequences.after.recruits}`);
console.log(`  carried out: ${consequences.after.spoilsCredits} credits,`
  + ` ${consequences.after.spoilsGoods.join(', ') || 'no goods'}`);
for (const n of consequences.notes) console.log(`    "${n}"`);

// ---- and it has to be reachable ------------------------------------------
await page.evaluate(() => {
  const { DATA, UI } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.id === 'vetch');
  UI.settlementPanel(S, loc, { onClose: () => {}, onRaid: () => {}, onRefresh: () => {} });
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'qa-raid/01-settlement.png' });
const offered = await page.evaluate(() =>
  !!document.querySelector('#modal [data-x="raid"]'));
console.log(`\nOffered on the settlement screen: ${offered}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const escalates = escalation.rows.every((r) => r.after > r.before)
  && escalation.rows[escalation.rows.length - 1].hunting > 0;
const paid = consequences.after.spoilsCredits > 0;
const cost = consequences.after.rel < consequences.before.rel - 30
  && consequences.after.rep < consequences.before.rep
  && consequences.after.morale < consequences.before.morale
  && consequences.after.recruits < consequences.before.recruits;
const ok = setup.stores === 3 && setup.extractIsSpawn && escalates
  && escalation.done && escalation.extract && paid && cost && offered
  && errors.length === 0;
console.log(ok
  ? '\nOK — a raid pays, brings the street out while you do it, and the place stops dealing with you.'
  : '\nFAIL — raiding is not a real trade.');
await browser.close();
