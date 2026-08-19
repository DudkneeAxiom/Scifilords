// The enemy commander's four minds.
//
// OVERHAUL.md has said for several rounds that two of the four postures —
// hold and snipe — are lightly exercised in play. They are chosen by a
// couple of ratios, and nothing has ever set those ratios deliberately and
// watched what the host DOES. So: build each condition on purpose, run it,
// and check the behaviour matches the name.
//
//   advance   closes the distance
//   hold      stands off and shoots; does NOT close
//   snipe     peels a detail onto archers standing alone
//   withdraw  gives ground, and eventually quits the field entirely
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(700);
}

for (const want of ['advance', 'hold', 'snipe', 'withdraw']) {
  const r = await page.evaluate(async ({ want }) => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR, S = G.campaign;
    G.mission?.dispose(); G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = ''; UI.show('hud');
    const toasts = [];
    G.mission = new Mission({ campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Postures',
        party: { id: 'p', kind: 'scrappers', name: 'Foe', strength: 16, tier: 3, quality: 0.8 } },
      squad: S.roster.slice(0, 10), container: document.getElementById('viewport'),
      onHud: () => {}, onToast: (a, b) => toasts.push(b), onIntro: () => {},
      onWheel: () => {}, onEnd: () => {} });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true; m.inserting = false;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    for (const e of m.entities) e.inserting = false;
    const realStep = m.step.bind(m); m.step = () => {};
    // The commander is parked well off the field: this is about the HOST.
    m.player.x = 900; m.player.z = 900; m.player.follower = true;

    const foes = () => m.entities.filter((e) => e.side === 'enemy' && !e.dead && !e.down);
    const ours = () => m.squad.filter((e) => !e.dead && !e.down);
    const giveBow = (e, on) => {
      if (on) { e.weapon = { ...e.weapon, bow: true, range: 40, damage: 18 }; e.bowStowed = false; }
      else { e.weapon = { ...e.weapon, bow: false, melee: true, range: 2.2 }; e.bowStowed = false; }
    };

    // Build the condition the posture is chosen by, rather than hoping for it.
    const F = foes(), O = ours();
    if (want === 'withdraw') {
      // odds < 0.55: cut them down to a remnant.
      for (const e of F.slice(3)) { e.dead = true; e.hp = 0; }
    } else if (want === 'hold') {
      // rangedEdge > 1.6 with at least two bows of theirs, and none of ours.
      for (const e of F) giveBow(e, true);
      for (const e of O) giveBow(e, false);
    } else if (want === 'snipe') {
      // Ranged parity so hold does not win first, and OUR archers left
      // standing alone — that is what 'exposed' means.
      for (const e of F) giveBow(e, false);
      for (const e of O.slice(0, 4)) giveBow(e, true);
      for (const e of F.slice(0, 2)) giveBow(e, true);
    } else {
      for (const e of F) giveBow(e, false);
      for (const e of O) giveBow(e, false);
    }
    // Lines drawn up facing each other; our archers off on the left flank
    // so 'moving on them' is a distinguishable motion rather than 'forward'.
    O.forEach((e, i) => {
      const bow = e.weapon?.bow;
      e.x = bow ? -55 + i * 2 : (i - O.length / 2) * 2.4;
      e.z = bow ? -30 : -25;
      e.order = 'hold'; e.orderPoint = { x: e.x, z: e.z };
    });
    F.forEach((e, i) => { e.x = (i - F.length / 2) * 2.4; e.z = 25; });

    const dist = () => {
      const f = foes(), o = ours();
      if (!f.length || !o.length) return null;
      let s = 0;
      for (const a of f) {
        let best = Infinity;
        for (const b of o) best = Math.min(best, Math.hypot(a.x - b.x, a.z - b.z));
        s += best;
      }
      return s / f.length;
    };
    // How close the host gets to our ARCHERS specifically.
    const toBows = () => {
      const bows = ours().filter((e) => e.weapon?.bow);
      if (!bows.length) return null;
      let best = Infinity;
      for (const a of foes()) for (const b of bows) best = Math.min(best, Math.hypot(a.x - b.x, a.z - b.z));
      return best;
    };
    const mid = (list) => {
      if (!list.length) return null;
      return { x: list.reduce((a, e) => a + e.x, 0) / list.length,
        z: list.reduce((a, e) => a + e.z, 0) / list.length };
    };
    const foe0 = mid(foes());          // where the host stood at the opening
    const our0 = mid(ours());          // and where our line stood
    const reach = () => {
      const f = mid(foes());
      return f && our0 ? Math.hypot(f.x - our0.x, f.z - our0.z) : null;
    };
    const d0 = dist(), b0 = toBows(), r0 = reach();
    let shots = 0;
    const seen = new Set();
    for (let i = 0; i < 3600; i++) {
      realStep(1 / 60);
      // The list is 'arrows', and it is FILTERED each frame as they land, so
      // counting its length samples what is in the air, not what was loosed.
      for (const a of (m.arrows || [])) if (!seen.has(a)) { seen.add(a); shots++; }
    }
    const foe1 = mid(foes());
    return { posture: m.foePosture, d0, d1: dist(), b0, b1: toBows(), shots,
      r0, r1: reach(),
      moved: foe0 && foe1 ? Math.hypot(foe1.x - foe0.x, foe1.z - foe0.z) : null,
      quit: toasts.some((t) => /HAD ENOUGH/.test(t)), over: !!m.over,
      left: foes().length, toast: toasts.filter((t) => /THEY/.test(t))[0] || null };
  }, { want });
  const fmt = (n) => (n == null ? ' -- ' : n.toFixed(0).padStart(4));
  console.log(`${want.padEnd(9)} got=${String(r.posture).padEnd(9)}`
    + ` host-to-our-line ${fmt(r.r0)} ->${fmt(r.r1)}  host walked ${fmt(r.moved)}m`
    + `  to-archers ${fmt(r.b0)} ->${fmt(r.b1)}`
    + `  shots ${String(r.shots).padStart(3)}  left ${String(r.left).padStart(2)}`
    + `  quit=${r.quit ? 'Y' : 'n'} over=${r.over ? 'Y' : 'n'}`);
  if (r.toast) console.log(`          "${r.toast}"`);
}
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 3).join('\n') : '\nno console errors');
await browser.close();
