// A full playtest of the loop, measured rather than felt.
//
// The complaint this answers is "gameplay and scaling seems off", which is
// not a bug report you can grep for. So it puts the two halves of a fight
// side by side — what the player may bring, and what the map produces — and
// then asks the game's OWN resolver who wins. estimateFight is what the
// campaign uses when a fight is handed to the sergeants, so its odds are the
// game's opinion of the difficulty curve, not mine.
//
// Run:  node tools/playtest.mjs
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const done = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]')
      || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (done) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(600);

const report = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const Roster = await import('/src/roster.js');
  const { DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const out = { curve: [], parties: [], odds: [], upkeep: [] };

  for (const tier of DATA.RENOWN_TIERS) {
    S.renown = tier.at;
    out.curve.push({ tier: tier.name, renown: tier.at, deploy: State.deployLimit(S) });
  }
  S.renown = 0;

  for (const [id, t] of Object.entries(DATA.PARTY_TIERS)) {
    out.parties.push({
      id, name: t.name, tier: t.tier, min: t.strength[0], max: t.strength[1],
      hostile: !!t.hostile, faction: t.faction,
    });
  }

  const mk = (n) => {
    const sq = [];
    for (let i = 0; i < n; i++) {
      const s2 = Roster.makeSoldier(() => 0.5, { role: 'rifleman', rank: 1 });
      s2.equip = {}; s2.perks = []; s2.id = `pt${i}`;
      sq.push(s2);
    }
    sq[0].isCommander = true;
    return sq;
  };

  const SIZES = [8, 16, 22, 30, 40, 60];
  const STRENGTHS = [5, 10, 20, 40, 60, 100];
  for (const n of SIZES) {
    const row = { company: n, odds: {} };
    for (const str of STRENGTHS) {
      const keep = S.roster;
      S.roster = mk(n);
      const e = State.estimateFight(S, S.roster, { strength: str, quality: 0.7 });
      S.roster = keep;
      row.odds[str] = Math.round(e.odds * 100);
    }
    out.odds.push(row);
  }
  // What it costs to be that big.
  for (const n of SIZES) {
    const keep = S.roster;
    S.roster = mk(n);
    const up = State.upkeepOf(S);
    out.upkeep.push({ company: n, wages: up.wages, food: up.food });
    S.roster = keep;
  }

  return out;
});

console.log('\n=== WHAT YOU MAY BRING ===');
for (const r of report.curve) {
  console.log(`  ${String(r.renown).padStart(5)}  ${r.tier.padEnd(12)} deploy ${r.deploy}`);
}

console.log('\n=== WHAT TURNS UP ===');
for (const m of report.parties.sort((a, b) => a.tier - b.tier)) {
  const tag = m.hostile ? 'HOSTILE' : `${m.faction}`;
  console.log(`  t${m.tier}  ${m.name.padEnd(24)} ${String(m.min).padStart(3)}-${String(m.max).padEnd(4)} ${tag}`);
}

console.log('\n=== ODDS OF WINNING (%), company vs party strength ===');
console.log('  company |    5   10   20   40   60  100');
for (const e of report.odds) {
  const cells = [5, 10, 20, 40, 60, 100].map((k) => String(e.odds[k]).padStart(4)).join(' ');
  console.log(`  ${String(e.company).padStart(7)} |${cells}`);
}

console.log('\n=== WHAT IT COSTS TO BE THAT BIG ===');
for (const e of report.upkeep) {
  console.log(`  ${String(e.company).padStart(3)} soldiers  wages/day ${e.wages}  food/day ${e.food}`);
}

if (errors.length) {
  console.log('\n=== CONSOLE ===');
  for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
}
await browser.close();
