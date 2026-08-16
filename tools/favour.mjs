// Do the people in a town ever want anything?
//
// Every settlement has named contacts with a line of dialogue each, and they
// have been decoration since the first version: a quartermaster who says the
// company is an expense and never does anything about it. A favour is that
// person asking for something specific.
//
// The thing being checked is that a favour is not just a contract with a name
// on it. What it pays in is STANDING — agreeing and then not turning up has to
// cost, and turning them down flat has to be free, because that asymmetry is
// what makes accepting a decision rather than free money.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-favour', { recursive: true });

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

// ---- who asks, and for what ----------------------------------------------
const asks = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const DATA = await import('/src/data.js');
  const { rng } = await import('/src/util.js');
  const rows = [];
  const towns = DATA.LOCATIONS.filter((l) => l.services?.length && l.contacts?.length);
  for (const loc of towns) {
    for (let seed = 0; seed < 3; seed++) {
      const S = State.newCampaign(500 + seed);
      const f = State.offerFavour(S, loc.id, rng(seed * 31 + loc.id.length));
      if (f) rows.push({ town: loc.name, who: f.who, kind: f.kind, pay: f.pay,
        ask: State.favourAsk(f) });
    }
  }
  return rows;
});
console.log('\n=== what the notables want ===');
for (const a of asks.slice(0, 8)) {
  console.log(`  ${a.town} — ${a.who} (${a.kind}, ${a.pay})`);
  console.log(`      ${a.ask}`);
}
console.log(`  ...${asks.length} offers rolled across every serviced town`);

// ---- the stream must not be degenerate ------------------------------------
// The bug: the stream was seeded off the LENGTH of the location id, so any two
// towns whose names happened to be the same length rolled a byte-identical
// request. Some repetition across a dozen towns is unavoidable — there are only
// four templates — so the honest measure is how many DISTINCT things are being
// asked for on a given day, old scheme against new.
const clash = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const DATA = await import('/src/data.js');
  const { rng } = await import('/src/util.js');
  const towns = DATA.LOCATIONS.filter((l) => l.services?.length && l.contacts?.length);
  const hashed = (loc) => {
    let h = 0;
    for (let i = 0; i < loc.id.length; i++) h = (h * 31 + loc.id.charCodeAt(i)) | 0;
    return Math.abs(h);
  };
  const measure = (salt) => {
    let distinct = 0, days = 0, twins = 0, twinPairs = 0;
    for (let day = 1; day <= 40; day++) {
      const S = State.newCampaign(1234);
      S.day = day;
      const keys = new Map();
      for (const loc of towns) {
        const f = State.offerFavour(S, loc.id, rng(S.seed + day * 977 + salt(loc)));
        // Deliberately NOT keyed on who is asking: the contact is drawn from
        // each town's own list, so it always differs and would mask the thing
        // being looked for — two towns wanting the same goods, in the same
        // quantity, at the same price, on the same day.
        if (f) keys.set(loc.id, `${f.tplId}|${f.good || ''}|${f.qty || ''}|${f.pay}`);
      }
      distinct += new Set(keys.values()).size;
      days++;
      // Specifically: towns whose ids are the same length.
      for (const a of towns) {
        for (const b of towns) {
          if (a.id >= b.id || a.id.length !== b.id.length) continue;
          twinPairs++;
          if (keys.get(a.id) && keys.get(a.id) === keys.get(b.id)) twins++;
        }
      }
    }
    return { perDay: distinct / days, twins, twinPairs };
  };
  return {
    towns: towns.length,
    old: measure((loc) => loc.id.length),
    now: measure(hashed),
  };
});
console.log(`\n=== is the stream degenerate? (${clash.towns} towns, 40 days) ===`);
for (const [name, m] of [['seeded off id length', clash.old], ['seeded off the id', clash.now]]) {
  console.log(`  ${name.padEnd(22)} ${m.perDay.toFixed(1)} distinct asks/day`
    + `   same-length towns identical: ${m.twins}/${m.twinPairs}`);
}

// ---- one favour, start to finish -----------------------------------------
const run = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const DATA = await import('/src/data.js');
  const { rng } = await import('/src/util.js');
  const S = State.newCampaign(77);
  const loc = DATA.LOCATIONS.find((l) => l.services?.length && l.contacts?.length);
  // Force the goods kind so the whole delivery path gets walked.
  let f = null;
  for (let i = 0; i < 40 && !f; i++) {
    const S2 = State.newCampaign(77);
    const cand = State.offerFavour(S2, loc.id, rng(i));
    if (cand?.kind === 'goods') { S.favours = S2.favours; f = State.favourAt(S, loc.id); }
  }
  if (!f) return { skip: true };

  const before = State.relationOf(S, loc.id);
  State.acceptFavour(S, loc.id);
  const empty = State.favourProgress(S, f);
  // Put the goods in the truck.
  S.cargo[f.good] = f.qty;
  const full = State.favourProgress(S, f);
  const credits = S.credits;
  const res = State.completeFavour(S, loc.id);
  return {
    who: f.who, good: DATA.GOODS[f.good].name, qty: f.qty,
    emptyNote: empty.note, emptyReady: empty.ready,
    fullNote: full.note, fullReady: full.ready,
    paid: S.credits - credits, expected: res?.pay,
    relBefore: before, relAfter: State.relationOf(S, loc.id),
    cargoLeft: S.cargo[f.good], gone: !State.favourAt(S, loc.id),
  };
});
console.log('\n=== one favour, start to finish ===');
console.log(`  ${run.who} wants ${run.qty} x ${run.good}`);
console.log(`  empty truck: ready ${run.emptyReady} — "${run.emptyNote}"`);
console.log(`  loaded:      ready ${run.fullReady} — "${run.fullNote}"`);
console.log(`  paid ${run.paid}, goods left ${run.cargoLeft}, standing ${run.relBefore} → ${run.relAfter}`);

// ---- saying no is free; not turning up is not -----------------------------
const cost = await page.evaluate(async () => {
  const State = await import('/src/state.js');
  const DATA = await import('/src/data.js');
  const { rng } = await import('/src/util.js');
  const loc = DATA.LOCATIONS.find((l) => l.services?.length && l.contacts?.length);
  const mk = () => {
    const S = State.newCampaign(88);
    State.offerFavour(S, loc.id, rng(3));
    return S;
  };
  // Turned down flat.
  const a = mk();
  const a0 = State.relationOf(a, loc.id);
  State.declineFavour(a, loc.id);
  const declined = State.relationOf(a, loc.id) - a0;
  // Agreed, then never came back.
  const b = mk();
  const b0 = State.relationOf(b, loc.id);
  State.acceptFavour(b, loc.id);
  b.day = State.favourAt(b, loc.id).expiresDay + 1;
  State.tickFavours(b, rng(5));
  const dropped = State.relationOf(b, loc.id) - b0;
  return { declined, dropped, stillThere: !!State.favourAt(b, loc.id) };
});
console.log('\n=== the asymmetry ===');
console.log(`  turned them down flat:      ${cost.declined >= 0 ? '+' : ''}${cost.declined} standing`);
console.log(`  agreed, then never came:    ${cost.dropped} standing`);

// ---- and it reaches the player -------------------------------------------
const seen = await page.evaluate(async () => {
  const { DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const loc = DATA.LOCATIONS.find((l) => l.services?.length && l.contacts?.length);
  S.pos.x = loc.x; S.pos.z = loc.z;
  window.KR.dev.enterLocation();
  return !!document.querySelector('#modal [data-verb="favour"]');
});
let panel = null;
if (seen) {
  await page.click('#modal [data-verb="favour"]');
  await page.waitForTimeout(400);
  panel = await page.evaluate(() => ({
    who: document.querySelector('#modal .fw-name')?.textContent.trim(),
    ask: document.querySelector('#modal .fav-ask')?.textContent.trim(),
    buttons: [...document.querySelectorAll('#modal .modal-foot .btn')].map((b) => b.textContent.trim()),
  }));
  await page.screenshot({ path: 'qa-favour/ask.png' });
}
console.log(`\nmenu offers a word with somebody: ${seen}`);
if (panel) {
  console.log(`  ${panel.who}: "${panel.ask}"`);
  console.log(`  [${panel.buttons.join('] [')}]`);
}

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);

const fails = [];
if (!asks.length) fails.push('nobody ever asks for anything');
if (run.skip) fails.push('never rolled a goods favour to walk through');
else {
  if (run.emptyReady) fails.push('handed in with an empty truck');
  if (!run.fullReady) fails.push('a loaded truck is still not enough');
  if (run.paid !== run.expected || !run.paid) fails.push('the pay did not arrive');
  if (run.cargoLeft !== 0) fails.push('the goods were not actually delivered');
  if (!(run.relAfter > run.relBefore)) fails.push('doing a favour bought no standing');
  if (!run.gone) fails.push('the favour is still open after being paid');
}
if (cost.declined !== 0) fails.push('turning them down cost something');
if (!(cost.dropped < 0)) fails.push('letting them down cost nothing');
if (cost.stillThere) fails.push('an expired favour is still open');
if (!seen || !panel?.who) fails.push('none of it reaches the player');
// Two towns of the same name-length must not be twins, and the day's asks have
// to be more varied than they were.
if (clash.now.twins >= clash.old.twins) fails.push('same-length towns still ask for identical things');
if (!(clash.now.perDay > clash.old.perDay)) fails.push('the new stream is no more varied than the old');
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS: they ask by name, and remember the answer');
await browser.close();
