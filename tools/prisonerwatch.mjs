// Does holding prisoners cost anything?
//
// They accumulated with no pressure at all: taking them cost nothing to keep,
// so the sensible play was to hoard a column of captives until you happened to
// pass a broker. Guarding people takes people.
//
// The property that matters is the RATIO, not a flat cap — four prisoners is
// nothing to a company of twelve and impossible for a company of three. And a
// modest number must be genuinely safe, or every capture becomes a chore
// rather than a choice.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });

const out = await page.evaluate(() => {
  const { State, Roster, makeRng } = window.KR.dev;
  const run = (nPrisoners, roster) => {
    const S = State.newCampaign(8899);
    while (S.roster.length < roster) S.roster.push({ ...S.roster[1], id: `x${S.roster.length}` });
    const rng = makeRng(4);
    S.prisoners = [];
    for (let i = 0; i < nPrisoners; i++) {
      S.prisoners.push(Roster.makeSoldier(rng, { role: 'rifleman', rank: 0, how: 'taken', day: 1 }));
    }
    // Paid and fed throughout: an unfed company deserts, the roster shrinks,
    // and the prisoner-to-guard ratio climbs for reasons that have nothing to
    // do with prisoners. The first run of this lost a captive from a company
    // that should comfortably have held two.
    for (let d = 0; d < 30; d++) { S.credits = 9e4; S.rations = 99; State.advanceTime(S, 24); }
    return S.prisoners.length;
  };
  return {
    fewMany: run(2, 10),      // comfortably guarded
    manyFew: run(9, 4),       // far more than can be watched
    startedFew: 2, startedMany: 9,
  };
});

console.log('\nPrisoners still held after thirty days:\n');
console.log(`  2 captives, company of 10:  ${out.fewMany} of ${out.startedFew}`);
console.log(`  9 captives, company of 4:   ${out.manyFew} of ${out.startedMany}`);
console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 4)) console.log(`  ${e}`);

const modestIsSafe = out.fewMany === out.startedFew;
const overloadLeaks = out.manyFew < out.startedMany;
console.log(`\n  a few captives stay put:      ${modestIsSafe}`);
console.log(`  more than you can watch slip: ${overloadLeaks}`);
console.log((modestIsSafe && overloadLeaks)
  ? '\nOK — guarding people takes people, and only past what you can spare'
  : '\nFAIL — prisoner attrition does not behave the way it should');
await browser.close();
