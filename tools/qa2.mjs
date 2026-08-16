// Second QA pass: the screens and mission types the main loop harness does not
// reach — settlements, the sabotage and defence templates, the roadside
// skirmish, the pause menu, and save/load round-tripping.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'qa2';
mkdirSync(OUT, { recursive: true });
const errors = [];
let n = 0;

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${e.stack || ''}`));

const shot = async (name, wait = 500) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` });
  console.log(`  shot ${name}`);
};
// The modal markup persists while the overlay is hidden, so presence alone is
// not enough — only click something that is actually on screen.
const dismiss = async () => {
  const open = await page.evaluate(() =>
    !document.getElementById('overlay').classList.contains('hidden'));
  if (!open) return;
  for (const sel of ['#modal [data-x="avoid"]', '#modal [data-x="close"]']) {
    const el = await page.$(sel);
    if (el && await el.isVisible()) { await el.click(); await page.waitForTimeout(350); return; }
  }
  await page.evaluate(() => document.getElementById('overlay').classList.add('hidden'));
};

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('#overlay').classList.add('hidden'));

// ---- settlement: Dolmet Station (Trust) ----
await page.evaluate(() => {
  const S = window.KR.campaign;
  window.KR.world.stopTravel();
  S.pos.x = -210; S.pos.z = -150;
  S.credits = 2000;
});
await page.waitForTimeout(1200);
await dismiss();
await page.keyboard.press('e');
await shot('settlement-dolmet', 900);

// hire someone
const hire = await page.$('#modal [data-hire="0"]');
if (hire) { await hire.click(); await page.waitForTimeout(600); }
await shot('settlement-hired');
await dismiss();

// ---- settlement: Perran Flats (Syndic) ----
await page.evaluate(() => {
  const S = window.KR.campaign;
  S.pos.x = 240; S.pos.z = 70;
});
await page.waitForTimeout(1200);
await dismiss();
await page.keyboard.press('e');
await shot('settlement-perran', 900);
await dismiss();

// ---- pause menu ----
await page.keyboard.press('Escape');
await shot('pause-menu', 600);
await dismiss();

// ---- save / load round trip ----
const before = await page.evaluate(() => {
  const S = window.KR.campaign;
  window.KR.save = null;
  return { credits: S.credits, roster: S.roster.length, names: S.roster.map((s) => s.name), day: S.day };
});
await page.evaluate(async () => {
  const St = await import('/src/state.js');
  St.save(window.KR.campaign);
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await shot('title-with-save', 600);
await page.click('button[data-act="continue"]');
await page.waitForTimeout(2000);
const after = await page.evaluate(() => {
  const S = window.KR.campaign;
  return { credits: S.credits, roster: S.roster.length, names: S.roster.map((s) => s.name), day: S.day };
});
const saveOk = JSON.stringify(before) === JSON.stringify(after);
console.log(`  save/load round trip: ${saveOk ? 'OK' : 'MISMATCH'}`);
if (!saveOk) {
  console.log('   before', JSON.stringify(before));
  console.log('   after ', JSON.stringify(after));
  errors.push(`SAVE MISMATCH\n${JSON.stringify(before)}\n${JSON.stringify(after)}`);
}
await shot('loaded-campaign');

// ---- sabotage at Rampart 12 ----
const runMission = async (site, type, label) => {
  await page.evaluate(([site, type]) => {
    const S = window.KR.campaign;
    S.contracts.forEach((c) => { c.accepted = false; });
    let c = S.contracts.find((x) => x.site === site && x.type === type);
    if (!c) {
      c = { id: 'qa_' + site, type, site, employer: 'syndic', title: 'QA ' + type,
        text: 'qa', pay: 500, expiresDay: S.day + 9, accepted: true };
      S.contracts.push(c);
    }
    c.accepted = true;
    const L = { rampart: [-60, -290], perran: [240, 60], grellan: [200, -230] }[site];
    S.pos.x = L[0]; S.pos.z = L[1] + 12;
  }, [site, type]);
  await page.waitForTimeout(1200);
  await dismiss();
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  // Settlements need the appended DEPLOY button; ruins go straight to the picker.
  const deployBtn = await page.$('#modal .modal-foot .btn-major');
  if (deployBtn) { await deployBtn.click(); await page.waitForTimeout(700); }
  const go = await page.$('#modal [data-x="go"]');
  if (!go) { console.log(`  !! ${label}: no deploy button`); await dismiss(); return; }
  await go.click();
  await page.waitForTimeout(3200);
  await page.evaluate(() => {
    window.__qaGod = setInterval(() => {
      const m = window.KR.mission;
      if (m && m.player && !m.over) { m.player.hp = m.player.maxHp; m.player.down = false; }
    }, 150);
  });
  await shot(`${label}-start`, 600);
  return true;
};

await runMission('rampart', 'sabotage', 'sabotage');
// Drive the charge objective.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.player.x = m.level.objectivePoint.x + 2;
  m.player.z = m.level.objectivePoint.z + 3;
});
await shot('sabotage-mast', 900);
await page.evaluate(() => {
  const m = window.KR.mission;
  const it = m.interactables.find((i) => i.kind === 'charge');
  if (it) m.completeInteraction(it);
});
await shot('sabotage-charges-set', 900);
await page.evaluate(() => {
  const m = window.KR.mission;
  const ex = m.level.extraction;
  m.player.x = ex.x; m.player.z = ex.z;
});
await page.waitForTimeout(3400);
await shot('sabotage-aar');
await dismiss();
await page.waitForTimeout(1600);
await shot('world-after-sabotage');

// ---- defence at Perran ----
await runMission('perran', 'defense', 'defence');
await page.evaluate(() => { window.KR.mission.waveTimer = 0.4; });
await shot('defence-wave', 3000);
await page.evaluate(() => {
  const m = window.KR.mission;
  m.entities.filter((e) => e.side === 'enemy').forEach((e) => { e.dead = true; e.down = true; });
  m.wave = 3; m.waveActive = true;
});
await page.waitForTimeout(2500);
await page.evaluate(() => { window.KR.mission.waveTimer = 0.2; });
await page.waitForTimeout(3500);
await shot('defence-end');
await dismiss();
await page.waitForTimeout(1500);
await shot('world-final');

writeFileSync(`${OUT}/errors.txt`, errors.length ? errors.join('\n\n') : 'no console errors');
console.log(`\n=== ${errors.length} errors ===`);
errors.slice(0, 10).forEach((e) => console.log(e.slice(0, 400)));
await browser.close();
