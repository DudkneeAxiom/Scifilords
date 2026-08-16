// Handing a fight to your sergeants.
//
// Wages come out every day, so the company has to fight often — and a five
// minute deployment for six looters is a tax on the player's evening, not a
// decision. Autoresolve exists to skip those. But it has to be genuinely WORSE
// than doing it yourself, or there is no reason ever to play a mission again.
//
// So this measures the thing that matters: across many fights at the same odds,
// does sending them in cost more people than being there would? And does it run
// through the same consequence pipeline, so XP, wounds, permadeath and spoils
// cannot drift away from the played version?
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

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

// Odds should track the strength gap rather than being a coin flip.
const odds = await page.evaluate(() => {
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  const squad = State.ready(S).slice(0, State.deployLimit(S));
  return [3, 6, 12, 24, 48, 90].map((strength) => {
    const e = State.estimateFight(S, squad, { strength, quality: 0.75 });
    return { strength, odds: +e.odds.toFixed(2), power: e.power, enemy: e.enemy };
  });
});
console.log(`A four-person company's odds without the commander on the ground:`);
console.log('  hostiles   their power   odds');
for (const o of odds) {
  console.log(`  ${String(o.strength).padStart(8)}   ${String(o.enemy).padStart(11)}   ${o.odds}`);
}

// Run many fights at a fixed strength and see what it actually costs.
const trials = await page.evaluate(() => {
  const { State, Roster, makeRng } = window.KR.dev;
  const runs = [];
  for (const strength of [6, 14, 30]) {
    let wins = 0; let dead = 0; let wounded = 0; let kills = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      // A fresh identical company each time, so the only variable is the dice.
      const S = window.KR.campaign;
      const rng = makeRng(1000 + i);
      S.roster = S.roster.slice(0, 1);
      for (let k = 0; k < 4; k++) {
        S.roster.push(Roster.makeSoldier(rng, { role: 'rifleman', rank: 1, day: 1,
          avoid: S.roster.map((x) => x.name) }));
      }
      for (const s of S.roster) { s.status = 'healthy'; s.hp = s.maxHp; s.wound = null; }
      S.stats.missions = i;
      const squad = State.ready(S).slice(0, 5);
      const res = State.autoResolve(S,
        { type: 'skirmish', site: 'roadside', party: { strength, quality: 0.75 } }, squad);
      if (res.success) wins++;
      kills += res.kills;
      for (const r of res.soldierResults) {
        if (r.status === 'dead') dead++;
        else if (r.status === 'wounded') wounded++;
      }
    }
    runs.push({ strength, N, winRate: +(wins / N).toFixed(2),
      deadPerFight: +(dead / N).toFixed(2), woundedPerFight: +(wounded / N).toFixed(2),
      killsPerFight: +(kills / N).toFixed(1) });
  }
  return runs;
});
console.log('\n60 auto-resolved fights at each size, five rank-1 soldiers each time:');
console.log('  hostiles  win rate  killed/fight  wounded/fight  kills/fight');
for (const r of trials) {
  console.log(`  ${String(r.strength).padStart(8)}  ${String(r.winRate).padStart(8)}`
    + `  ${String(r.deadPerFight).padStart(12)}  ${String(r.woundedPerFight).padStart(13)}`
    + `  ${String(r.killsPerFight).padStart(11)}`);
}

// It has to run through the same consequences a played mission does — and that
// includes the spoils path, which is keyed off the party actually being on the
// map. So this puts a real party there and keeps rolling until it wins, because
// a loss pays nothing and would tell us nothing about whether payment works.
const pipeline = await page.evaluate(() => {
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  let attempt = 0;
  let out = null;
  while (attempt < 40 && !out) {
    attempt++;
    for (const s of S.roster) { s.status = 'healthy'; s.hp = s.maxHp; s.wound = null; }
    const squad = State.ready(S).slice(0, 4);
    if (squad.length < 2) break;

    // A real party, on the map, the way a road encounter would present it.
    const party = { id: `auto${attempt}`, kind: 'looters', name: 'Looters',
      strength: 6, tier: 1, quality: 0.6, faction: 'raider', x: 0, z: 0,
      hostileToPlayer: true };
    S.parties.push(party);

    const before = {
      missions: S.stats.missions,
      deployments: squad.map((s) => s.deployments),
      xp: Object.fromEntries(squad.map((s) => [s.id, s.xp])),
      credits: S.credits,
      renown: Math.round(S.renown || 0),
      supplies: S.supplies,
      parties: S.parties.length,
    };
    const res = State.autoResolve(S,
      { type: 'skirmish', site: 'roadside', party }, squad);
    const notes = State.applyMissionResult(S, res);
    if (!res.success) { S.parties = S.parties.filter((x) => x.id !== party.id); continue; }

    const survivors = squad.filter((s) => s.status !== 'dead');
    out = {
      attempts: attempt,
      auto: res.auto, kills: res.kills, notes: notes.length,
      missions: [before.missions, S.stats.missions],
      deployments: [before.deployments, squad.map((s) => s.deployments)],
      xpGained: survivors.every((s) => s.xp > before.xp[s.id]),
      credits: [before.credits, S.credits],
      renown: [before.renown, Math.round(S.renown || 0)],
      supplies: [before.supplies, S.supplies],
      partyCleared: !S.parties.some((x) => x.id === party.id),
    };
  }
  return out;
});
console.log('\nRunning a winning one through the campaign:');
if (!pipeline) {
  console.log('  never won in 40 attempts');
} else {
  console.log(`  won on attempt ${pipeline.attempts} (auto: ${pipeline.auto}),`
    + ` ${pipeline.kills} hostiles down, ${pipeline.notes} after-action notes`);
  console.log(`  mission count ${pipeline.missions[0]} -> ${pipeline.missions[1]}`);
  console.log(`  deployments   ${pipeline.deployments[0].join(',')} -> ${pipeline.deployments[1].join(',')}`);
  console.log(`  survivors all gained experience: ${pipeline.xpGained}`);
  console.log(`  credits       ${pipeline.credits[0]} -> ${pipeline.credits[1]}`);
  console.log(`  renown        ${pipeline.renown[0]} -> ${pipeline.renown[1]}`);
  console.log(`  supplies      ${pipeline.supplies[0]} -> ${pipeline.supplies[1]}`);
  console.log(`  party removed from the map: ${pipeline.partyCleared}`);
}

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const scales = odds[0].odds > odds[odds.length - 1].odds + 0.4;
const costly = trials.every((r) => r.deadPerFight + r.woundedPerFight > 0);
// ...but not so costly that nobody would ever use it. An easy fight must not
// average a permadeath, or "skip the trivial encounter" means "feed it a
// soldier" and the option is worse than useless.
const survivable = trials[0].deadPerFight < 0.5;
const harder = trials[0].winRate > trials[trials.length - 1].winRate;
const counted = !!pipeline
  && pipeline.missions[1] === pipeline.missions[0] + 1
  && pipeline.deployments[1].every((d, i) => d === pipeline.deployments[0][i] + 1)
  && pipeline.xpGained
  && pipeline.supplies[1] < pipeline.supplies[0]
  && pipeline.renown[1] > pipeline.renown[0]
  && pipeline.partyCleared;
const ok = scales && costly && survivable && harder && counted && errors.length === 0;
console.log(ok
  ? '\nOK — the odds track the gap, sending them in always costs somebody, and it counts like a real deployment.'
  : '\nFAIL — autoresolve is not pulling its weight.');
await browser.close();
