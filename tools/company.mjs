// Does growing a company involve decisions, or just addition?
//
// Two systems here. Troop advancement should be a branching choice you pay for,
// gated on rank you cannot buy — the old screen let anybody become anything for
// a flat fee, which made rank and role both meaningless. And party speed should
// come out of the choices you have already made, so that a fat slow company is
// something you did rather than something that happened.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-company', { recursive: true });

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

// ---- 1. the tree ----------------------------------------------------------
const tree = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const out = {};
  for (const role of DATA.ROLE_LIST) {
    out[role] = (DATA.TROOP_PATHS[role] || []).map((p) => ({
      to: p.to, rank: p.rank, cost: p.cost,
    }));
  }
  // A raw recruit should be able to see the road without walking it yet.
  const raw = State.living(S).find((s) => !s.isCommander && s.rank === 0);
  const opts = State.upgradesFor(S, raw);
  return { out, rawRank: raw.rank, rawRole: raw.role,
    opts: opts.map((o) => ({ to: o.to, ok: o.ok, rankOk: o.rankOk, why: o.why })) };
});
console.log('Advancement paths:');
for (const [role, paths] of Object.entries(tree.out)) {
  console.log(`  ${role.padEnd(10)} -> ${paths.length
    ? paths.map((p) => `${p.to} (rank ${p.rank}, ${p.cost}cr)`).join(', ')
    : 'end of the road'}`);
}
console.log(`\nA rank-${tree.rawRank} ${tree.rawRole} is offered:`);
for (const o of tree.opts) console.log(`  ${o.to.padEnd(10)} ${o.ok ? 'OPEN  ' : 'LOCKED'} ${o.why}`);

// ---- 2. promotion actually costs, and sticks ------------------------------
const promo = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const s = State.living(S).find((x) => !x.isCommander);
  s.rank = 1;                                  // earned in the field
  S.credits = 20000;
  const before = { role: s.role, wage: State.wageOf(s), credits: S.credits,
    weapon: s.weapon, xp: s.xp, name: s.name };
  const opt = State.upgradesFor(S, s).find((o) => o.ok);
  const done = State.upgradeTroop(S, s.id, opt.to);
  const after = { role: s.role, wage: State.wageOf(s), credits: S.credits,
    weapon: s.weapon, xp: s.xp, name: s.name };

  // Rank cannot be bought: a rank-0 soldier must be refused.
  const green = State.living(S).find((x) => !x.isCommander && x.rank === 0);
  const refused = green ? State.upgradeTroop(S, green.id, 'marksman') : null;

  // And you cannot promote what you cannot pay for.
  const rich = State.living(S).find((x) => !x.isCommander && x.rank >= 1);
  S.credits = 0;
  const broke = State.upgradeTroop(S, rich.id, (State.upgradesFor(S, rich)[0] || {}).to);
  return { before, after, done, cost: opt.cost, to: opt.to, refused, broke };
});
console.log(`\nPromoting a rank-1 soldier to ${promo.to}:`);
console.log(`  role   ${promo.before.role} -> ${promo.after.role}`);
console.log(`  weapon ${promo.before.weapon} -> ${promo.after.weapon}`);
console.log(`  wage   ${promo.before.wage} -> ${promo.after.wage} a day`);
console.log(`  paid   ${promo.before.credits - promo.after.credits} (quoted ${promo.cost})`);
console.log(`  same person: name kept ${promo.before.name === promo.after.name},`
  + ` experience kept ${promo.before.xp === promo.after.xp}`);
console.log(`  refused a rank-0 soldier: ${promo.refused === false}`);
console.log(`  refused with no money:    ${promo.broke === false}`);

// ---- 3. party speed -------------------------------------------------------
const pace = await page.evaluate(() => {
  const { State, Roster, makeRng } = window.KR.dev;
  const S = window.KR.campaign;
  const rng = makeRng(3);
  const read = (label) => {
    const p = State.partySpeed(S);
    return { label, mul: +p.mul.toFixed(2), speed: Math.round(p.speed),
      why: p.factors.map((f) => `${Math.round(f.effect * 100)}% ${f.label}`).join(', ') || '—' };
  };
  const rows = [];
  S.cargo = {}; S.rations = 20; S.morale = 70;
  rows.push(read('light, fed, 4 people'));

  for (let i = 0; i < 10; i++) {
    S.roster.push(Roster.makeSoldier(rng, { role: 'rifleman', day: 1,
      avoid: S.roster.map((x) => x.name) }));
  }
  rows.push(read('14 people'));

  for (const id of window.KR.dev.DATA.GOODS_LIST) S.cargo[id] = 6;
  rows.push(read('14 people, truck loaded'));

  S.rations = 0;
  rows.push(read('...and nobody has eaten'));

  S.rations = 20; S.morale = 95;
  rows.push(read('fed and devoted'));
  return rows;
});
console.log('\nHow fast the company moves:');
console.log('  case                          pace   units/hr  because');
for (const r of pace) {
  console.log(`  ${r.label.padEnd(28)} ${String(Math.round(r.mul * 100) + '%').padStart(5)}`
    + `  ${String(r.speed).padStart(8)}  ${r.why}`);
}

// Give somebody the rank and the money, then look at what they are offered.
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.credits = 20000;
  const s = window.KR.dev.State.living(S).find((x) => !x.isCommander);
  s.rank = 1;
  window.__pick = s.id;
});
await page.keyboard.press('l');
await page.waitForTimeout(700);
await page.evaluate(() => {
  document.querySelector(`#modal [data-sel="${window.__pick}"]`)?.click();
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'qa-company/01-advancement.png' });

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const branches = Object.values(tree.out).filter((p) => p.length > 1).length;
const spread = Math.max(...pace.map((r) => r.mul)) - Math.min(...pace.map((r) => r.mul));
const ok = branches >= 2
  && tree.opts.every((o) => !o.ok)                    // rank 0 can buy nothing
  && promo.done && promo.after.role !== promo.before.role
  && promo.after.wage > promo.before.wage
  && promo.before.credits - promo.after.credits === promo.cost
  && promo.before.xp === promo.after.xp
  && promo.refused === false && promo.broke === false
  && spread > 0.3
  && errors.length === 0;
console.log(ok
  ? '\nOK — advancement is a branching choice you pay for, and the company you built decides how fast it moves.'
  : '\nFAIL — growing the company is still just addition.');
await browser.close();
