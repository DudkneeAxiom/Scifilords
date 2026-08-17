// Is the map inhabited, or just populated?
//
// Every faction party was an anonymous token — "Trust Patrol", one of nine,
// interchangeable and forgotten the moment it was beaten. Nothing that happened
// to one meant anything later, so there was no such thing as a rival.
//
// A lord outlives their command: break their column and they are captured or
// they get away, and either way they come back with a record of what has passed
// between you. The failure modes are specific — lords accumulating without
// limit as parties churn, a captured lord never returning (which quietly
// removes them from the game), or the same lord leading two columns at once.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });

const out = await page.evaluate(() => {
  const { State, Dip } = window.KR.dev;
  const S = State.newCampaign(6161);
  Dip.setRelation(S, 'trust', 'syndic', 'war', 100000);

  const named = () => S.parties.filter((p) => p.lordId).length;
  const factionParties = () => S.parties.filter((p) => p.faction
    && p.faction !== 'raider' && (window.KR.dev.DATA.PARTY_TIERS[p.kind]?.tier || 0) >= 3).length;

  const startNamed = named();
  const startFaction = factionParties();

  // A long war: parties are made and broken constantly.
  for (let d = 0; d < 300; d++) State.advanceTime(S, 24);

  // Nobody leads two columns at once.
  const ids = S.parties.map((p) => p.lordId).filter(Boolean);
  const doubled = ids.length !== new Set(ids).size;

  // Captivity has to end, or taking a lord removes them from the game.
  const everCaptured = (S.lords || []).some((l) => l.captured || l.freeDay > 0);
  const stuckCaptive = (S.lords || []).some((l) => l.captured && S.day > l.freeDay + 5);

  // The roll of names must not grow without bound as parties churn.
  const lords = (S.lords || []).length;

  // And a beaten lord comes back rather than vanishing.
  const withRecord = (S.lords || []).filter((l) => l.defeats > 0 || l.wins > 0).length;

  return {
    startNamed, startFaction, endNamed: named(), endFaction: factionParties(),
    doubled, everCaptured, stuckCaptive, lords, withRecord,
    sample: (S.lords || []).slice(0, 3).map((l) =>
      `${l.name} (${l.faction}) defeats ${l.defeats} wins ${l.wins}`),
  };
});

console.log('\nCommanders over 300 days of war:\n');
console.log(`  faction columns at the start: ${out.startFaction}, named: ${out.startNamed}`);
console.log(`  at the end:                   ${out.endFaction}, named: ${out.endNamed}`);
console.log(`  lords on the books: ${out.lords}, of whom ${out.withRecord} have a record`);
for (const s of out.sample) console.log(`    ${s}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

const allNamed = out.endNamed === out.endFaction && out.endFaction > 0;
const noDoubles = !out.doubled;
const noneStuck = !out.stuckCaptive;
// Reused, not minted fresh every time a column is broken.
const bounded = out.lords <= out.endFaction * 4 + 8;
const remembers = out.withRecord > 0;

console.log(`\n  every faction column has a leader: ${allNamed}`);
console.log(`  nobody leads two at once:          ${noDoubles}`);
console.log(`  captivity ends:                    ${noneStuck}`);
console.log(`  the roll stays bounded:            ${bounded} (${out.lords})`);
console.log(`  and they remember:                 ${remembers}`);
console.log((allNamed && noDoubles && noneStuck && bounded && remembers)
  ? '\nOK — the columns belong to people, and the people outlive the columns'
  : '\nFAIL — commanders do not behave the way the map needs');
await browser.close();
