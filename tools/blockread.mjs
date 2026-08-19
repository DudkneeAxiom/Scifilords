// Can the player tell what is coming, and does blocking it require the right
// guard? Two claims, both measured in a real mission rather than eyeballed.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const done = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]')
      || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; }
    return true;
  });
  if (done) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(600);

const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const G = window.KR;
  const S = G.campaign;
  G.mission?.dispose();
  G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = '';
  UI.show('hud');
  G.mission = new Mission({
    campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Block',
      party: { id: 'bk', kind: 'looters', name: 'Block', strength: 6, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 4),
    container: document.getElementById('viewport'),
    onHud: (h) => UI.renderMissionHud(h),
    onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
  });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

  const p = m.player;
  // A single attacker, put where they can reach, aimed at the player.
  const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
  foe.x = p.x + 1.4; foe.z = p.z; foe.hp = 500; foe.maxHp = 500;
  foe.yaw = Math.atan2(p.x - foe.x, p.z - foe.z);
  p.yaw = Math.atan2(foe.x - p.x, foe.z - p.z);
  p.hp = 400; p.maxHp = 400;
  p.shieldHp = 0;                       // bare steel: direction must matter

  const out = { tell: null, right: null, wrong: null, noGuard: null };

  // 1. The tell: an enemy mid-swing shows up in the read with its direction.
  foe.cooldown = 0; foe.swing = null;
  m.strike(foe, 'overhead');
  const read = m.meleeRead();
  out.tell = {
    incomingDir: read?.incoming?.dir ?? null,
    threatDist: read?.threat ? +read.threat.dist.toFixed(2) : null,
    inside: read?.threat?.inside ?? null,
    reach: read?.reach ?? null,
  };
  // And the rose renders it.
  UI.renderMissionHud(m.buildHud());
  const rose = document.getElementById('guard-rose');
  out.rose = {
    shown: rose && !rose.classList.contains('hidden'),
    lit: [...rose.querySelectorAll('i')].filter((b) => b.classList.contains('inc'))
      .map((b) => b.dataset.d),
    threat: rose?.classList.contains('threat'),
  };

  // 2. Blocking with the RIGHT guard, and 3. the WRONG one, and 4. none.
  const trial = (guardDir) => {
    p.hp = 400;
    p.guard = guardDir ? 1 : 0;
    p.guardDir = guardDir;
    p.swing = null; p.guardBreak = 0;
    foe.cooldown = 0; foe.swing = null;
    m.strike(foe, 'overhead');
    // Drive the swing to its apex so the blow actually resolves.
    for (let i = 0; i < 200 && foe.swing && !foe.swing.hitDone; i++) m.updateSwing(1 / 120, foe);
    return Math.round(400 - p.hp);
  };
  out.right = trial('overhead');
  out.wrong = trial('left');
  out.noGuard = trial(null);
  return out;
});

console.log('\nTHE TELL');
console.log(`  incoming direction : ${r.tell.incomingDir}`);
console.log(`  nearest threat     : ${r.tell.threatDist}m (inside their reach: ${r.tell.inside})`);
console.log(`  my own reach       : ${r.tell.reach}m`);
console.log(`  rose shown=${r.rose.shown} lit=[${r.rose.lit}] threat=${r.rose.threat}`);
console.log('\nDAMAGE TAKEN FROM AN OVERHEAD');
console.log(`  guard overhead (right way) : ${r.right}`);
console.log(`  guard left     (wrong way) : ${r.wrong}`);
console.log(`  no guard at all            : ${r.noGuard}`);

const bad = [];
if (r.tell.incomingDir !== 'overhead') bad.push('the tell did not report the swing direction');
if (!r.rose.shown) bad.push('the guard rose did not appear');
if (!r.rose.lit.includes('overhead')) bad.push('the rose did not light the incoming blade');
if (!(r.right < r.wrong)) bad.push('the right guard was no better than the wrong one');
if (!(r.wrong <= r.noGuard)) bad.push('a wrong guard beat no guard');
console.log(bad.length ? `\nFAIL:\n  ${bad.join('\n  ')}` : '\nThe read and the block both work.');
if (errors.length) console.log('errors:', [...new Set(errors)].slice(0, 5));
await browser.close();
