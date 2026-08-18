// Photograph the combat pass: the CHARGE order on the wheel and in motion,
// and the FIELD SPOILS page after a fight.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('qa-shots', { recursive: true });

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });

const shot = async (name) => {
  await page.screenshot({ path: `qa-shots/${name}.png` });
  console.log(`  ${name}`);
};

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 20000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 20000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(700);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  window.KR.dev.UI.closeModal();
});
await page.waitForTimeout(400);

// --- The FIELD SPOILS page, produced by the real pipeline -----------------
await page.evaluate(async () => {
  const UI = await import('/src/ui.js');
  const { State } = window.KR.dev;
  const S = window.KR.campaign;
  S.seed = 12345;
  const party = { id: 'shotp', kind: 'scrappers', name: 'Roadside Column',
    strength: 14, tier: 2, quality: 0.6, faction: 'syndic' };
  // Walk the day until the fight yields at least two captives, so the page
  // shows the management rows doing their job.
  let res = null;
  for (let d = 1; d <= 30 && !(res && (res.captives || []).length >= 2); d++) {
    S.day = d; S.stats.missions = d; S.prisoners = [];
    res = { success: true, type: 'skirmish', partyId: 'shotp', party, kills: 11,
      soldierResults: [], suppliesUsed: 0 };
    State.applyMissionResult(S, res);
  }
  UI.spoilsPanel(S, res, { onClose: () => {} });
});
await page.waitForTimeout(500);
await shot('cp-01-field-spoils');
await page.evaluate(() => window.KR.dev.UI.closeModal());
await page.waitForTimeout(300);

// --- A live skirmish for the order shots ----------------------------------
await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  S.renown = 4000;
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'works', layout: 'works', siteName: 'The Works',
      enemyFaction: 'trust' },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h), onToast: () => {}, onIntro: () => {},
    onWheel: (w) => UI.renderCommandWheel(w), onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
});
await page.waitForTimeout(1500);

// The wheel, with CHARGE steered to.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.openWheel();
  const i = m.ORDERS.findIndex((o) => o.id === 'charge');
  const a = (i / m.ORDERS.length) * Math.PI * 2;
  for (let k = 0; k < 10; k++) m.steerWheel(Math.sin(a) * 12, -Math.cos(a) * 12);
});
await page.waitForTimeout(500);
await shot('cp-02-wheel-charge');

// Call it, and photograph the squad breaking into the run.
await page.evaluate(() => {
  const m = window.KR.mission;
  m.closeWheel(true);
});
await page.waitForTimeout(1600);
await shot('cp-03-charging');

// Let the hunt develop until somebody is genuinely on top of an enemy.
await page.waitForFunction(() => {
  const m = window.KR.mission;
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  if (!foes.length) return true;
  return m.squad.some((s) => !s.dead && foes.some(
    (f) => Math.hypot(f.x - s.x, f.z - s.z) < 16));
}, null, { timeout: 30000 }).catch(() => {});

// The hunt from close overhead, framed on the squaddie nearest a live enemy —
// rings tell the sides apart, and the charge should read as troops IN the
// enemy's ground, not a line holding cover.
await page.evaluate(() => {
  const m = window.KR.mission;
  cancelAnimationFrame(m.raf);
  const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
  let best = null, bd = Infinity;
  for (const s of m.squad.filter((x) => !x.dead)) {
    for (const f of foes) {
      const d = Math.hypot(f.x - s.x, f.z - s.z);
      if (d < bd) { bd = d; best = { s, f }; }
    }
  }
  const cx = best ? (best.s.x + best.f.x) / 2 : m.player.x;
  const cz = best ? (best.s.z + best.f.z) / 2 : m.player.z;
  m.camera.position.set(cx + 4, 26, cz + 20);
  m.camera.lookAt(cx, 0, cz);
  m.renderer.render(m.scene, m.camera);
});
await page.waitForTimeout(300);
await shot('cp-04-running-them-down');

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  ' + e);
await browser.close();
