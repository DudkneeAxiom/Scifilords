// Is a captured commander leverage, or just a log line?
//
// Taking a lord alive used to set a flag and release them on a timer twenty to
// forty days later. The player was told it had happened and then it happened TO
// them — no decision, no money, no consequence either way.
//
// A held lord is now the player's to spend: ransom them and their faction pays
// well and resents being made to, or let them go and buy more goodwill than the
// money was worth. The two failure modes are opposite and both quiet — a
// hostage the game frees behind your back takes the decision away again, and a
// hostage who can never escape is a bank account rather than a prisoner.
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
  const { State } = window.KR.dev;
  const mk = () => {
    const S = State.newCampaign(9090);
    const lord = {
      id: 'L1', name: 'Tessa Vance', faction: 'trust', defeats: 1, wins: 2,
      captured: true, heldByPlayer: true, tookDay: S.day, freeDay: 0,
    };
    S.lords = [lord];
    return { S, lord };
  };

  const A = mk();
  const cr0 = A.S.credits, rep0 = A.S.rep.trust || 0;
  const price = State.lordRansom(A.S, A.lord);
  const r1 = State.ransomLord(A.S, 'L1');

  const B = mk();
  const rep0b = B.S.rep.trust || 0;
  const r2 = State.releaseLord(B.S, 'L1');

  // Not freed behind the player's back.
  const C = mk();
  for (let d = 0; d < 4; d++) State.advanceTime(C.S, 24);
  const stillHeld = State.heldLords(C.S).length === 1;

  // But holding one indefinitely is not free either.
  const D = mk();
  let escapedOn = null;
  for (let d = 1; d <= 120 && escapedOn === null; d++) {
    State.advanceTime(D.S, 24);
    if (!State.heldLords(D.S).length) escapedOn = d;
  }

  // A lord nobody holds still comes back on their own.
  const E = State.newCampaign(9090);
  E.lords = [{ id: 'L2', name: 'Other', faction: 'syndic', defeats: 0, wins: 0,
    captured: true, heldByPlayer: false, freeDay: E.day + 3 }];
  for (let d = 0; d < 6; d++) State.advanceTime(E, 24);
  const otherFreed = !E.lords[0].captured;

  return {
    price,
    ransom: { ok: r1.ok, gained: A.S.credits - cr0, rep: (A.S.rep.trust || 0) - rep0,
      held: State.heldLords(A.S).length },
    release: { ok: r2.ok, rep: (B.S.rep.trust || 0) - rep0b, held: State.heldLords(B.S).length },
    stillHeld, escapedOn, otherFreed,
  };
});

console.log('\nA commander taken alive:\n');
console.log(`  their people will pay        ${out.price}`);
console.log(`  ransom: +${out.ransom.gained} credits, ${out.ransom.rep} standing,`
  + ` ${out.ransom.held} still held`);
console.log(`  release: ${out.release.rep > 0 ? '+' : ''}${out.release.rep} standing,`
  + ` ${out.release.held} still held`);
console.log(`  four days on, still yours:   ${out.stillHeld}`);
console.log(`  got out on their own by day: ${out.escapedOn ?? 'never'}`);
console.log(`  a lord you are NOT holding comes home: ${out.otherFreed}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`);

const paysWell = out.ransom.ok && out.ransom.gained > 500 && out.ransom.held === 0;
const costsStanding = out.ransom.rep < 0;
const releaseBuysMore = out.release.ok && out.release.rep > Math.abs(out.ransom.rep);
const playerKeepsTheChoice = out.stillHeld;
const captivityIsNotABank = out.escapedOn !== null;
const othersStillReturn = out.otherFreed;

console.log(`\n  ransom pays, and lands:        ${paysWell}`);
console.log(`  and costs standing:            ${costsStanding}`);
console.log(`  release buys more than it cost:${releaseBuysMore}`);
console.log(`  the choice stays the player's: ${playerKeepsTheChoice}`);
console.log(`  but holding one is not free:   ${captivityIsNotABank}`);
console.log(`  lords held elsewhere return:   ${othersStillReturn}`);
console.log((paysWell && costsStanding && releaseBuysMore && playerKeepsTheChoice
  && captivityIsNotABank && othersStillReturn)
  ? '\nOK — a hostage is a decision with two real answers'
  : '\nFAIL — holding a commander does not behave the way it needs to');

await browser.close();
