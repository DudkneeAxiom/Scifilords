// Does morale reach the field?
//
// It decided desertion and nothing else, so a company on the edge of walking
// out fought exactly as well as one that had just been paid, fed and told it
// had won. That makes every wage day and every ration an accounting exercise
// rather than something you feel at the moment it matters.
//
// Two things have to be true, and the second is the one that keeps this from
// being a death spiral: unhappy soldiers must be measurably worse, and a
// miserable company must still be able to fight. A multiplier that bottoms out
// near zero turns one bad payday into a campaign you cannot recover from,
// because you need to win a fight to afford to fix it.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });

const out = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const { State } = window.KR.dev;
  const run = async (morale) => {
    const S = State.newCampaign(5566);
    S.morale = morale;
    window.KR.campaign = S;
    const m = new Mission({ campaign: S, spec: { type: 'skirmish', site: 'grellan', layout: 'array' },
      squad: State.ready(S).slice(0, 4), container: document.getElementById('viewport'),
      onHud() {}, onToast() {}, onIntro() {}, onWheel() {}, onEnd() {} });
    await m.start();
    const acc = m.squad.map((e) => +e.acc.toFixed(3));
    const edge = +m.moraleEdge.toFixed(3);
    m.dispose();
    return { acc, edge, mean: +(acc.reduce((a, b) => a + b, 0) / acc.length).toFixed(3) };
  };
  return { broken: await run(0), settled: await run(70), devoted: await run(100) };
});

console.log('\nHow well the company shoots, by how it feels:\n');
console.log(`  morale 0    edge ${out.broken.edge}  mean accuracy ${out.broken.mean}`);
console.log(`  morale 70   edge ${out.settled.edge}  mean accuracy ${out.settled.mean}`);
console.log(`  morale 100  edge ${out.devoted.edge}  mean accuracy ${out.devoted.mean}`);
console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 4)) console.log(`  ${e}`);

const worseWhenBroken = out.broken.mean < out.settled.mean;
const betterWhenDevoted = out.devoted.mean > out.settled.mean;
// An ordinary company must fight exactly as it always did, or this change
// silently rebalances every encounter in the game rather than adding a lever.
const settledIsNeutral = Math.abs(out.settled.edge - 1) < 0.02;
// And misery must not be a spiral: you have to win a fight to afford to fix it.
const stillFunctional = out.broken.edge > 0.75;

console.log(`\n  a miserable company shoots worse: ${worseWhenBroken}`);
console.log(`  a devoted one shoots better:      ${betterWhenDevoted}`);
console.log(`  an ordinary one is unchanged:     ${settledIsNeutral}`);
console.log(`  misery is not a death spiral:     ${stillFunctional}`);
console.log((worseWhenBroken && betterWhenDevoted && settledIsNeutral && stillFunctional)
  ? '\nOK — how the company feels is something you meet in the field'
  : '\nFAIL — morale does not reach the fighting the way it should');
await browser.close();
