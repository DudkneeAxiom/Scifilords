// The pit.
//
// Wages come out every day from day one, and until this the only answers were a
// contract or a fight on the road — both of which can cost a soldier you cannot
// replace. The pit is meant to be the answer that costs nothing but time and
// pride, which only works if two things are true: the purse genuinely rises
// with the rounds, and NOBODY comes out of it maimed. The second is the whole
// promise, so it is the thing checked hardest here.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-pit', { recursive: true });

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

// ---- the fight itself -----------------------------------------------------
await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  G.mission?.dispose();
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'pit', site: 'vetch', layout: 'settlement', siteName: 'Vetch',
      enemyFaction: 'raider' },
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

const shape = await page.evaluate(() => {
  const m = window.KR.mission;
  const rows = [];
  // You go in alone: whoever came with you is in the crowd.
  const alone = m.squad.length === 0;
  for (let round = 1; round <= 8; round++) {
    const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
    rows.push({
      round: m.pitRound,
      against: foes.length,
      acc: +(foes.reduce((a, e) => a + e.acc, 0) / Math.max(1, foes.length)).toFixed(2),
    });
    // Win the round.
    for (const e of foes) { e.hp = 0; e.dead = true; }
    // The rest between rounds, then the next lot.
    for (let i = 0; i < 400; i++) m.step(1 / 60);
    if (m.objective.done) break;
  }
  return { alone, rows, done: !!m.objective.done, best: m.pitBest };
});
console.log(`You go in alone: ${shape.alone}`);
console.log('\n  round  against  their accuracy');
for (const r of shape.rows) {
  console.log(`  ${String(r.round).padStart(5)}  ${String(r.against).padStart(7)}  ${r.acc}`);
}
console.log(`  cleared the pit: ${shape.done}, best round reached: ${shape.best}`);

// ---- losing costs you nothing you cannot replace -------------------------
const losing = await page.evaluate(() => {
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  const cmd = State.commander(S);
  // Walk in already hurt, and lose badly.
  cmd.status = 'healthy'; cmd.wound = null; cmd.hp = cmd.maxHp;
  const before = { status: cmd.status, wound: cmd.wound, credits: S.credits };
  State.applyMissionResult(S, {
    success: false, type: 'pit', site: 'vetch', pitRounds: 0,
    kills: 0, suppliesUsed: 1,
    // The mission layer would normally hand back a mauled commander.
    soldierResults: [{ id: cmd.id, kills: 0, status: 'wounded',
      wound: { id: 'gut', name: 'Abdominal, serious' }, hp: 4 }],
  });
  return {
    before,
    status: cmd.status,
    wound: cmd.wound,
    hp: cmd.hp,
    deployable: State.ready(S).some((s) => s.id === cmd.id),
  };
});
console.log('\nLosing in the first round, having been handed a serious wound:');
console.log(`  status ${losing.before.status} -> ${losing.status}, wound: ${losing.wound || 'none'}`);
console.log(`  still fit to deploy: ${losing.deployable}`);

// ---- and the purse rises with the rounds ---------------------------------
const purses = await page.evaluate(() => {
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  const out = [];
  for (const rounds of [0, 1, 3, 5, 8]) {
    S.credits = 0;
    S.relations = {};
    const relBefore = State.relationOf(S, 'vetch');
    const moraleBefore = S.morale;
    State.applyMissionResult(S, {
      success: rounds >= 8, type: 'pit', site: 'vetch', pitRounds: rounds,
      kills: rounds, soldierResults: [], suppliesUsed: 1,
    });
    out.push({
      rounds, purse: S.credits,
      rel: State.relationOf(S, 'vetch') - relBefore,
      morale: Math.round(S.morale - moraleBefore),
    });
  }
  return out;
});
console.log('\n  rounds  purse  standing gained  morale');
for (const p of purses) {
  console.log(`  ${String(p.rounds).padStart(6)}  ${String(p.purse).padStart(5)}`
    + `  ${String(p.rel).padStart(15)}  ${String(p.morale).padStart(6)}`);
}

// ---- and it has to be on the settlement screen ---------------------------
await page.evaluate(() => {
  const { DATA, UI } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.services?.includes('market'));
  UI.settlementPanel(S, loc, { onClose: () => {}, onPit: () => {}, onRefresh: () => {} });
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'qa-pit/01-settlement.png' });
const offered = await page.evaluate(() => !!document.querySelector('#modal [data-x="pit"]'));
console.log(`\nOffered at a market settlement: ${offered}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const escalates = shape.rows.length > 2
  && shape.rows[shape.rows.length - 1].against >= shape.rows[0].against
  && shape.rows[shape.rows.length - 1].acc > shape.rows[0].acc;
const harmless = losing.status === 'healthy' && !losing.wound && losing.deployable;
const rising = purses.every((p, i) => i === 0 || p.purse > purses[i - 1].purse);
const ok = shape.alone && escalates && harmless && rising
  && purses[purses.length - 1].rel > 0 && offered && errors.length === 0;
console.log(ok
  ? '\nOK — the pit escalates, pays by the round, and nobody comes out of it maimed.'
  : '\nFAIL — the pit is not keeping its promise.');
await browser.close();
