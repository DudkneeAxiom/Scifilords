// Hideouts: giving road danger an address.
//
// Before this, danger was weather — parties appeared, you dealt with them, more
// appeared. A hideout is a CAUSE: it sits still, throws out raiders every few
// days, and keeps doing it until somebody goes and clears it.
//
// The properties that matter are the ones that would be invisible if broken. A
// hideout that drifts is not a place. One that gets culled by the population
// housekeeping vanishes for free. One that can be drawn from the random spawn
// table stops being a deliberate event. And clearing one has to actually pay in
// the currency it costs everyone else — standing with the places it was preying
// on.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-hideouts', { recursive: true });

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

// ---- they appear, they stay put, and they are never random traffic -------
const life = await page.evaluate(() => {
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  let firstDay = null;
  for (let d = 0; d < 200 && !firstDay; d++) {
    State.advanceTime(S, 24);
    if (S.parties.some((p) => p.kind === 'lair')) firstDay = S.day;
  }
  const lair = S.parties.find((p) => p.kind === 'lair');
  if (!lair) return null;
  const start = { x: lair.x, z: lair.z };

  // A place does not wander, and the housekeeping must not quietly bin it.
  let broods = 0;
  const before = S.parties.length;
  for (let d = 0; d < 90; d++) {
    const n = S.parties.filter((p) => p.fromLair === lair.id).length;
    State.advanceTime(S, 24);
    broods += Math.max(0, S.parties.filter((p) => p.fromLair === lair.id).length - n);
  }
  const moved = Math.hypot(lair.x - start.x, lair.z - start.z);
  return {
    firstDay,
    strength: lair.strength,
    moved: +moved.toFixed(1),
    stillThere: S.parties.some((p) => p.id === lair.id),
    broods,
    perRegion: Object.fromEntries(Object.entries(
      S.parties.filter((p) => p.kind === 'lair').reduce((a, p) => {
        const reg = window.KR.dev.DATA.LOCATIONS.find((l) => l.id === p.home)?.region || '?';
        a[reg] = (a[reg] || 0) + 1; return a;
      }, {}))),
    id: lair.id,
  };
});
if (!life) {
  console.log('no hideout appeared in 200 days');
} else {
  console.log(`First hideout on day ${life.firstDay}, ${life.strength} strong`);
  console.log(`  over 90 more days: moved ${life.moved} units, still on the map: ${life.stillThere}`);
  console.log(`  raider parties it put on the road: ${life.broods}`);
  console.log(`  hideouts per region: ${JSON.stringify(life.perRegion)}`);
}

// ---- clearing one --------------------------------------------------------
const cleared = await page.evaluate(() => {
  const { State, DATA } = window.KR.dev;
  const S = window.KR.campaign;
  const lair = S.parties.find((p) => p.kind === 'lair');
  if (!lair) return null;
  const near = DATA.LOCATIONS.filter((l) => l.kind !== 'open'
    && Math.hypot(l.x - lair.x, l.z - lair.z) < 620);
  const relBefore = near.map((l) => State.relationOf(S, l.id));
  const renownBefore = Math.round(S.renown || 0);
  S.spoils = { credits: 0, cargo: {}, armoury: {}, armourPool: {}, kitPool: {} };

  State.applyMissionResult(S, {
    success: true, type: 'lair', site: 'roadside', partyId: lair.id,
    kills: lair.strength, soldierResults: [], suppliesUsed: 3,
  });

  return {
    gone: !S.parties.some((p) => p.id === lair.id),
    nearby: near.length,
    relBefore,
    relAfter: near.map((l) => State.relationOf(S, l.id)),
    renown: [renownBefore, Math.round(S.renown || 0)],
    credits: S.spoils.credits,
    counted: S.stats.lairsCleared || 0,
  };
});
if (cleared) {
  console.log(`\nClearing it: removed from the map ${cleared.gone},`
    + ` ${cleared.nearby} settlements near enough to care`);
  console.log(`  their standing ${cleared.relBefore.join(',')} -> ${cleared.relAfter.join(',')}`);
  console.log(`  renown ${cleared.renown[0]} -> ${cleared.renown[1]}, spoils ${cleared.credits} credits`);
  console.log(`  recorded as cleared: ${cleared.counted}`);
}

// ---- and only a handful get in -------------------------------------------
const cap = await page.evaluate(() => {
  const { State, UI } = window.KR.dev;
  const S = window.KR.campaign;
  S.renown = 4000;                      // a company that could otherwise field many
  const big = State.deployLimit(S);
  UI.deployPanel(S, { type: 'lair', site: 'compound', squadCap: 4,
    party: { strength: 18, quality: 0.8 } }, { onClose: () => {}, onDeploy: () => {} });
  const title = document.querySelector('#modal .section-title')?.textContent || '';
  const warned = /Only 4/.test(document.querySelector('#modal')?.textContent || '');
  return { big, title: title.replace(/\s+/g, ' ').trim(), warned };
});
console.log(`\nDeployment cap: the company could field ${cap.big}`);
console.log(`  picker says "${cap.title}"`);
console.log(`  and warns about it: ${cap.warned}`);
await page.waitForTimeout(400);
await page.screenshot({ path: 'qa-hideouts/01-deploy-cap.png' });

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`  ${e}`);

const oneEach = life && Object.values(life.perRegion).every((n) => n <= 1);
const ok = !!life && life.moved < 1 && life.stillThere && life.broods > 0 && oneEach
  && !!cleared && cleared.gone && cleared.nearby > 0
  && cleared.relAfter.every((v, i) => v > cleared.relBefore[i])
  && cleared.renown[1] > cleared.renown[0] && cleared.counted > 0
  && /OF 4/.test(cap.title) && cap.warned
  && errors.length === 0;
console.log(ok
  ? '\nOK — a hideout is a place that produces danger, only four of you get in, and clearing it is felt by everyone nearby.'
  : '\nFAIL — hideouts are not doing their job.');
await browser.close();
