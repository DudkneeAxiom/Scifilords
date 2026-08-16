// Does the company cost anything to keep?
//
// Before this, credits only ever went up: there was no reason not to recruit
// everybody you could afford, and party size was never a decision. This checks
// the whole pressure loop — wages leave every day, food runs out, morale falls
// when either fails, and people eventually walk — and that each of those is
// recoverable rather than a death spiral.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-payroll', { recursive: true });

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

// 1. What does the starting company cost?
const base = await page.evaluate(() => {
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  const up = State.upkeepOf(S);
  return {
    people: State.living(S).length,
    wages: up.wages, food: up.food,
    credits: S.credits, rations: S.rations, morale: S.morale,
    perHead: State.living(S).map((s) => ({
      name: s.name.split(' ')[0], role: s.role, rank: s.rank, wage: State.wageOf(s),
    })),
  };
});
console.log(`The starting company: ${base.people} people, ${base.wages} credits a day,`
  + ` ${base.food} rations a day`);
for (const s of base.perHead) {
  console.log(`  ${s.name.padEnd(10)} ${s.role.padEnd(9)} rank ${s.rank}  ${s.wage}/day`);
}
console.log(`  purse ${base.credits}, food ${base.rations} days, morale ${base.morale}`);
console.log(`  -> the purse alone covers ${Math.floor(base.credits / base.wages)} days of idleness`);

// 2. Run it dry and watch what happens.
const decline = await page.evaluate(() => {
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  const log = [];
  for (let d = 0; d < 30; d++) {
    State.advanceTime(S, 24);
    log.push({
      day: S.day,
      credits: Math.round(S.credits),
      rations: S.rations,
      morale: Math.round(S.morale),
      roster: State.living(S).length,
      unpaid: S.unpaidDays,
    });
  }
  return { log, deserted: S.stats.deserted || 0 };
});
console.log('\nThirty days with no work taken:');
console.log('  day  credits  food  morale  roster  unpaid');
for (const r of decline.log.filter((_, i) => i % 3 === 0 || i === decline.log.length - 1)) {
  console.log(`  ${String(r.day).padStart(3)} ${String(r.credits).padStart(8)}`
    + ` ${String(r.rations).padStart(5)} ${String(r.morale).padStart(7)}`
    + ` ${String(r.roster).padStart(7)} ${String(r.unpaid).padStart(7)}`);
}
console.log(`  desertions: ${decline.deserted}`);

// 3. And it has to be recoverable — a spiral you cannot climb out of is a bug.
const recovery = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const low = { morale: Math.round(S.morale), roster: State.living(S).length };
  S.credits = 9000;
  const market = DATA.LOCATIONS.find((l) => l.services?.includes('market'));
  const cost = State.rationCost(S, market.id, 7);
  const bought = State.buyRations(S, market.id, 14);
  for (let d = 0; d < 12; d++) State.advanceTime(S, 24);
  return {
    low, bought, cost,
    morale: Math.round(S.morale),
    rations: S.rations,
    roster: State.living(S).length,
    tier: State.moraleTier(S).name,
  };
});
console.log(`\nPaid up and fed again (7 days of food costs ${recovery.cost} at a market):`);
console.log(`  morale ${recovery.low.morale} -> ${recovery.morale} (${recovery.tier}),`
  + ` food ${recovery.rations} days, roster ${recovery.low.roster} -> ${recovery.roster}`);

// 4. Prisoners have to actually do something.
const pris = await page.evaluate(() => {
  const { State, Roster, makeRng } = window.KR.dev;
  const S = window.KR.campaign;
  const r = makeRng(11);
  const mk = (n) => Object.assign(
    Roster.makeSoldier(r, { role: 'rifleman', rank: 1, day: 1, name: n }),
    { captiveFaction: 'trust' },
  );
  S.prisoners = [mk('A One'), mk('B Two'), mk('C Three')];
  const before = { roster: State.living(S).length, credits: S.credits,
    rep: S.rep.trust, morale: Math.round(S.morale) };
  const pressed = State.pressPrisoner(S, S.prisoners[0].id);
  const afterPress = { roster: State.living(S).length, morale: Math.round(S.morale) };
  const value = State.ransomValue(S, S.prisoners[0]);
  const ransomed = State.ransomPrisoner(S, S.prisoners[0].id);
  const afterRansom = { credits: S.credits, rep: S.rep.trust };
  const released = State.releasePrisoner(S, S.prisoners[0].id);
  return { before, pressed, afterPress, value, ransomed, afterRansom,
    released, rep: S.rep.trust, left: S.prisoners.length };
});
console.log('\nThree prisoners, one of each outcome:');
console.log(`  press   roster ${pris.before.roster} -> ${pris.afterPress.roster},`
  + ` morale ${pris.before.morale} -> ${pris.afterPress.morale}`);
console.log(`  ransom  +${pris.value} credits, Trust standing ${pris.before.rep} -> ${pris.afterRansom.rep}`);
console.log(`  release Trust standing ${pris.afterRansom.rep} -> ${pris.rep}`);
console.log(`  prisoners left: ${pris.left}`);

await page.keyboard.press('c');
await page.waitForTimeout(700);
await page.screenshot({ path: 'qa-payroll/01-roster.png' });

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const ranOut = decline.log.some((r) => r.credits === 0);
const moraleFell = decline.log[decline.log.length - 1].morale < 45;
const recovered = recovery.morale > recovery.low.morale;
const prisWorks = pris.pressed && pris.ransomed && pris.released
  && pris.afterPress.roster === pris.before.roster + 1
  && pris.afterRansom.credits > pris.before.credits
  && pris.rep > pris.afterRansom.rep
  && pris.left === 0;
const ok = base.wages > 0 && ranOut && moraleFell && recovered && prisWorks
  && errors.length === 0;
console.log(ok
  ? '\nOK — the company costs money, running it badly has consequences, and both are recoverable.'
  : '\nFAIL — the upkeep loop does not hold together.');
await browser.close();
