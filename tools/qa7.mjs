// QA for faction-unique recruits: do different places raise different people,
// and do those people actually differ in the field?
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa7', { recursive: true });
const errors = []; let n = 0;
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
const shot = async (name, w = 500) => {
  await page.waitForTimeout(w);
  await page.screenshot({ path: `qa7/${String(++n).padStart(2, '0')}-${name}.png` });
  console.log(`  ${name}`);
};
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(700);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.world.setPaused(false);
});

// 1. Every settlement's pool, by origin — do the borders actually mean anything?
const pools = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const out = [];
  for (const l of DATA.LOCATIONS) {
    if (l.kind !== 'settlement') continue;
    const pool = State.recruitPool(S, l.id);
    if (!pool.length) continue;
    const origins = {};
    for (const s of pool) origins[s.origin] = (origins[s.origin] || 0) + 1;
    const st = window.KR.dev.Roster.effective(pool[0], S.roster);
    out.push({
      loc: l.name,
      faction: l.faction || '—',
      region: l.region,
      origins: Object.keys(origins).join('+'),
      model: DATA.ORIGINS[pool[0].origin].model.replace('soldier_', ''),
      roles: [...new Set(pool.map((s) => s.role))].join(','),
      cost: State.hireCost(S, pool[0]),
      acc: +st.accuracy.toFixed(3),
      hp: pool[0].maxHp,
      spd: +st.speed.toFixed(2),
    });
  }
  return out;
});
console.log('\nRecruit pools by settlement');
for (const p of pools) {
  console.log(`  ${p.loc.padEnd(16)} ${p.faction.padEnd(8)} -> ${p.origins.padEnd(9)}`
    + ` model=${p.model.padEnd(10)} cost=${String(p.cost).padEnd(5)}`
    + ` acc=${p.acc} hp=${p.hp} spd=${p.spd}`);
  console.log(`  ${''.padEnd(16)} roles: ${p.roles}`);
}

// 2. Do the stat profiles actually separate? Compare like-for-like riflemen.
const profile = await page.evaluate(() => {
  const { State, Roster, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const rng = window.KR.dev.makeRng(4242);
  const rows = [];
  for (const id of Object.keys(DATA.ORIGINS)) {
    // Average out trait noise: 40 samples of the same role and rank.
    let acc = 0; let hp = 0; let spd = 0; let cost = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const s = Roster.makeSoldier(rng, { role: 'rifleman', rank: 0, day: 1, origin: id });
      const o = DATA.ORIGINS[id];
      if (o.kit.armour) s.equip.body = o.kit.armour;
      if (o.kit.head) s.equip.head = o.kit.head;
      s.maxHp = Roster.maxHpOf(s);
      const st = Roster.effective(s, S.roster);
      acc += st.accuracy; hp += s.maxHp; spd += st.speed; cost += State.hireCost(S, s);
    }
    rows.push({
      id, name: DATA.ORIGINS[id].name,
      acc: +(acc / N).toFixed(3), hp: +(hp / N).toFixed(1),
      spd: +(spd / N).toFixed(2), cost: Math.round(cost / N),
    });
  }
  return rows;
});
console.log('\nOrigin profiles (rifleman, rank 0, mean of 40)');
for (const r of profile) {
  console.log(`  ${r.name.padEnd(16)} acc=${r.acc}  hp=${r.hp}  speed=${r.spd}  cost=${r.cost}`);
}
const accSpread = Math.max(...profile.map((r) => r.acc)) - Math.min(...profile.map((r) => r.acc));
const spdSpread = Math.max(...profile.map((r) => r.spd)) - Math.min(...profile.map((r) => r.spd));
const models = new Set(profile.map((r) => r.id));
console.log(`\n  accuracy spread ${accSpread.toFixed(3)}, speed spread ${spdSpread.toFixed(2)},`
  + ` ${models.size} distinct origins`);

// 3. Hire from a Trust settlement and confirm the card and roster name the origin.
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.credits = 40000;
  const l = window.KR.dev.DATA.LOCATIONS.find(
    (x) => x.faction === 'trust' && x.kind === 'settlement' && x.services.includes('recruit'));
  S.atLocation = l.id;
  window.KR.dev.UI.settlementPanel(S, l, { onClose: () => {}, onHire: () => {}, onBuy: () => {} });
});
await page.waitForTimeout(900);
await shot('trust-hire-board', 700);

const cards = await page.evaluate(() => [...document.querySelectorAll('#modal .card[data-hire]')]
  .map((c) => c.querySelector('.card-meta')?.textContent.trim()));
console.log('\nHire cards at a Trust settlement:');
for (const c of cards) console.log(`  ${c}`);

// Hire the first one directly through the simulation, so the roster shows a
// second origin alongside the founders.
await page.evaluate(() => {
  const S = window.KR.campaign;
  const l = window.KR.dev.DATA.LOCATIONS.find(
    (x) => x.faction === 'trust' && x.kind === 'settlement' && x.services.includes('recruit'));
  const pool = window.KR.dev.State.recruitPool(S, l.id);
  S.atLocation = l.id;
  window.KR.dev.State.hire(S, pool[0]);
});
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(400);

// 4. The roster and character screen should agree about who this person is.
await page.keyboard.press('c');
await page.waitForTimeout(1200);
await shot('character-screen', 900);
const roster = await page.evaluate(() => window.KR.campaign.roster
  .map((s) => `${s.name} [${s.origin}]${s.isCommander ? ' (cmd)' : ''}`));
console.log('\nRoster after hiring:');
for (const s of roster) console.log(`  ${s}`);

// 5. Deploy and confirm the field models differ.
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(300);
const fielded = await page.evaluate(() => {
  const { DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const seen = {};
  for (const s of S.roster) {
    const m = s.isCommander ? 'soldier_commander' : DATA.ORIGINS[s.origin].model;
    seen[m] = (seen[m] || 0) + 1;
  }
  return seen;
});
console.log('\nModels the company would field:', JSON.stringify(fielded));

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
const ok = accSpread > 0.05 && spdSpread > 0.15 && Object.keys(fielded).length >= 3
  && errors.length === 0;
console.log(ok
  ? '\nOK — origins are visually and mechanically distinct.'
  : '\nFAIL — origins are not separating enough.');
await browser.close();
