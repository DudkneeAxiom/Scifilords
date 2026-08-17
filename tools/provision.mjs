// Is being fed the same as being looked after?
//
// Food was a switch: rations or no rations, minus seven either way. A company
// living on ration packs with nothing to drink and no medical stock was in
// exactly the same spirits as one that was properly provisioned, so the only
// supply decision worth making was "do not hit zero" — and the stores screen
// existed to sell things rather than to keep them.
//
// The constraint is that this must stay a nudge. A company that has not been
// paid should not cheer up because somebody found the water, or provisioning
// becomes a way to ignore the economy entirely.
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
  const { State } = window.KR.dev;
  const run = ({ stocked, paid }) => {
    const S = State.newCampaign(4747);
    S.morale = 50;
    for (let d = 0; d < 12; d++) {
      S.credits = paid ? 9e4 : 0;
      S.rations = 60;
      S.medical = stocked ? 8 : 0;
      S.cargo = stocked ? { water: 5, medical_stock: 3 } : {};
      State.advanceTime(S, 24);
    }
    return Math.round(S.morale);
  };
  return {
    bare: run({ stocked: false, paid: true }),
    stocked: run({ stocked: true, paid: true }),
    stockedUnpaid: run({ stocked: true, paid: false }),
    bareUnpaid: run({ stocked: false, paid: false }),
  };
});

console.log('\nMorale after twelve days, starting from 50:\n');
console.log(`  fed and paid, nothing else carried:  ${out.bare}`);
console.log(`  fed, paid and properly provisioned:  ${out.stocked}`);
console.log(`  provisioned but NOT paid:            ${out.stockedUnpaid}`);
console.log(`  neither provisioned nor paid:        ${out.bareUnpaid}`);
console.log(`\nconsole errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 4)) console.log(`  ${e}`);

const provisioningHelps = out.stocked > out.bare;
// The load-bearing one: supplies must not paper over an unpaid company.
const cannotBuyOffWages = out.stockedUnpaid < out.bare;
console.log(`\n  looking after them is worth something: ${provisioningHelps}`);
console.log(`  it does not substitute for wages:      ${cannotBuyOffWages}`);
console.log((provisioningHelps && cannotBuyOffWages)
  ? '\nOK — provisioning is a nudge, not a way around the payroll'
  : '\nFAIL — provisioning does not sit where it should');
await browser.close();
