// The other half of the soak.
//
// tools/soak.mjs drives State.advanceTime() directly, so everything that lives
// in WorldMap.update() — pursuit pacing, the continuous clock, click-to-chase,
// terrain travel, encounter triggering and the contested withdrawal — has only
// ever been checked by short targeted probes. This one plays the map the way a
// player does: the real WorldMap with its rAF loop rendering underneath, real
// encounter panels answered by clicking their buttons, real settlement visits
// through the E-key path.
//
// The trick that makes it fast: the map's own clock is HALTED (setSpeed(0) —
// a legitimate game state the resume guard leaves alone, unlike paused) and
// update() is driven by hand at DT = 0.2 scaled seconds, which is exactly the
// cadence the real loop runs at under fast-forward (dt capped at 0.05 × FAST).
// Nothing double-ticks, pursuit give-up ranges see the same step sizes they see
// in play, and a chunk of days runs in seconds. The rAF loop keeps rendering
// and running updateCamera between chunks, so the camera path is live too.
//
// Usage: node tools/mapsoak.mjs [DAYS=240]
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = Number(process.argv[2] || 240);
mkdirSync(join(ROOT, 'qa-soak'), { recursive: true });

// Serve ourselves if nothing is listening — same server the game uses.
const up = () => fetch('http://localhost:8124/').then(() => true).catch(() => false);
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs')], { stdio: 'ignore', cwd: ROOT });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await up())) { console.error('could not start a server on 8124'); process.exit(1); }
}

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
await page.click('#modal [data-x="close"]');
await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
await page.click('#modal [data-perk]');
await page.waitForTimeout(600);

const seed = await page.evaluate(async () => {
  const { HALF, travelFactor } = await import('/src/region.js');
  const G = window.KR;
  const S = G.campaign;
  document.getElementById('overlay').classList.add('hidden');
  G.world.setPaused(false);
  // The world's own clock stops; every hour from here on comes from our calls.
  G.world.setSpeed(0);
  // Wages and tolls always clear — the roster bleeding out from an unpaid
  // ledger is the OTHER soak's known ending, and it would smother everything
  // this one is here to watch. Rations are bought at real markets en route.
  S.credits = 300000;
  S.renown = 1500;
  window.__soak = {
    HALF, travelFactor,
    step: 0, pending: null, pendingLoc: null, retries: 0,
    steerLeft: 0, steerKeys: [], chaseLeft: 0,
  };
  return S.seed;
});
console.log(`Map soak: ${DAYS} days through WorldMap.update(), campaign seed ${seed}`);

// One chunk: up to maxTicks ticks of the real map loop, breaking out the
// moment a panel opens so the driver can answer it like a player.
const chunk = (maxTicks) => page.evaluate(({ maxTicks }) => {
  const G = window.KR;
  const S = G.campaign;
  const W = G.world;
  const { State, DATA, UI } = G.dev;
  const T = window.__soak;
  const DT = 0.2;                              // the real loop under fast-forward
  const out = {
    ticks: 0, hours: 0, dist: 0, chaseTicks: 0, chasedTicks: 0, factorSum: 0,
    problems: [], events: [], reason: 'quota', chasingAtBreak: false,
  };
  const clock = () => S.day * 24 + S.hour;

  for (; out.ticks < maxTicks; out.ticks++) {
    // checkProximity() clears the chase BEFORE it opens the panel, so "was a
    // chase live moments ago" is the only honest way to tell that an encounter
    // ended one. Asking W.chaseId at the break reads 0 forever — the first
    // draft did, and reported 115 chases with no endings at all.
    if (UI.modalOpen()) {
      out.reason = 'modal';
      out.chasingAtBreak = T.tickAbs - (T.lastChaseTick ?? -9) <= 2;
      break;
    }
    T.tickAbs = (T.tickAbs || 0) + 1;
    if (W.chaseId) T.lastChaseTick = T.tickAbs;

    // ---- what the player is doing ----
    const atLoc = State.locationAt(S, 38);
    if (T.steerLeft > 0) {
      if (--T.steerLeft === 0) for (const k of T.steerKeys) W.keys.delete(k);
    } else if (T.pending === 'visit' && !W.travelling && !W.chaseId) {
      if (atLoc && atLoc.id === T.pendingLoc) {
        T.pending = null;
        // Do the shopping while we are here, off the real market ledger.
        if ((S.rations || 0) < 8) State.buyRations(S, atLoc.id, 14);
        G.dev.enterLocation();
        out.events.push(`visit:${atLoc.id}`);
        continue;                              // panel is up; next pass breaks
      } else if (T.retries++ < 3) {
        // An encounter en route dropped the destination; set out again.
        const l = DATA.LOCATIONS.find((x) => x.id === T.pendingLoc);
        W.setDestination(l.x, l.z);
      } else { T.pending = null; }
    } else if (W.chaseId) {
      out.chaseTicks++;
      if (--T.chaseLeft <= 0) { W.stopTravel(); out.events.push('chase:abandoned'); }
    } else if (!W.travelling) {
      // A fixed rotation rather than a random walk, so every verb the map
      // offers is exercised however long or short the run.
      const mode = T.step++ % 5;
      if (mode === 0 || mode === 3) {
        // Travel to a market town and go inside. Roads, arrival, the menu.
        const towns = DATA.LOCATIONS.filter((l) => l.services?.includes('market'));
        const l = towns[T.step % towns.length];
        T.pending = 'visit'; T.pendingLoc = l.id; T.retries = 0;
        W.setDestination(l.x, l.z);
      } else if (mode === 1) {
        // Run something down: click-to-chase against a live quarry.
        const h = S.parties
          .filter((p) => p.hostileToPlayer && p.strength > 0)
          .sort((a, b) => Math.hypot(a.x - S.pos.x, a.z - S.pos.z)
            - Math.hypot(b.x - S.pos.x, b.z - S.pos.z))[0];
        if (h) { W.chase(h.id); T.chaseLeft = 220; out.events.push('chase:start'); }
      } else if (mode === 4) {
        // A stretch of hand steering, which recentres and overrides pathing.
        T.steerKeys = [['w', 'a', 's', 'd'][T.step % 4]];
        for (const k of T.steerKeys) W.keys.add(k);
        T.steerLeft = 30;
      } else {
        // Open ground, off the roads: terrain travel decided by the click.
        const a = (T.step * 2.399) % (Math.PI * 2);
        const r = 0.15 + ((T.step * 7919) % 100) / 145;
        W.setDestination(Math.cos(a) * T.HALF * r, Math.sin(a) * T.HALF * r);
      }
    }

    // Camera abuse, cheap and clamped: drag far off the company, zoom about,
    // come home. The rAF loop consumes these between chunks.
    if (out.ticks % 97 === 0) {
      W.camPan.x += 4000; W.camPan.z -= 4000;
      W.zoom = 0.3 + (T.step % 5) * 0.5;
      if (T.step % 2) W.recentre();
    }

    // ---- one tick of the real map loop ----
    const before = clock();
    const px = S.pos.x, pz = S.pos.z;
    try { W.update(DT); } catch (e) {
      out.problems.push(`day ${S.day}: update() threw: ${e.message}`);
      out.reason = 'error'; break;
    }
    const after = clock();
    out.hours += after - before;
    out.dist += Math.hypot(S.pos.x - px, S.pos.z - pz);
    out.factorSum += T.travelFactor(S.pos.x, S.pos.z);

    // ---- invariants, every tick ----
    if (after < before) out.problems.push(`day ${S.day}: clock ran backwards ${before} -> ${after}`);
    if (!Number.isFinite(S.pos.x) || !Number.isFinite(S.pos.z)) {
      out.problems.push(`day ${S.day}: company position not finite`);
      out.reason = 'error'; break;
    }
    if (Math.abs(S.pos.x) > T.HALF || Math.abs(S.pos.z) > T.HALF) {
      out.problems.push(`day ${S.day}: company out of bounds at ${Math.round(S.pos.x)},${Math.round(S.pos.z)}`);
    }
    if (W.chaseId && !S.parties.some((p) => p.id === W.chaseId)) {
      // advanceTime() can cull the quarry at the END of a tick, and update()
      // notices at the TOP of the next one — one tick of ghost is the designed
      // lifecycle. A ghost that survives a second tick is a chase that will
      // never end.
      if (T.ghostChase === W.chaseId) {
        out.problems.push(`day ${S.day}: chasing a party that no longer exists`);
      }
      T.ghostChase = W.chaseId;
    } else T.ghostChase = null;
    if (S.parties.some((p) => p.chasing)) out.chasedTicks++;

    // Heavier sweeps, sampled.
    if (out.ticks % 25 === 0) {
      for (const p of S.parties) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
          out.problems.push(`day ${S.day}: party ${p.id} (${p.kind}) position not finite`);
        }
      }
      const f = T.travelFactor(S.pos.x, S.pos.z);
      if (!Number.isFinite(f) || f <= 0) out.problems.push(`day ${S.day}: travelFactor ${f} under the company`);
      if (!Number.isFinite(S.credits)) out.problems.push(`day ${S.day}: credits ${S.credits}`);
    }
    if (out.problems.length > 20) { out.reason = 'error'; break; }
  }
  out.day = S.day; out.parties = S.parties.length; out.roster = S.roster.length;
  out.credits = Math.round(S.credits); out.rations = S.rations || 0;
  out.morale = Math.round(S.morale ?? 0);
  return out;
}, { maxTicks });

// Answer whatever is on screen the way a player would. Encounters get the
// interesting buttons — WITHDRAW above all, because the contested withdrawal
// is exactly the thing no probe has ever exercised through this path.
const problems = [];
const stats = {
  panels: 0, withdrawAttempts: 0, cornered: 0, tolls: 0, sends: 0,
  inspections: 0, talks: 0, aids: 0, visits: 0, rests: 0, perks: 0,
  escTried: 0, escBlocked: 0, cancelTried: 0, cancelReturned: 0,
  stuckModals: 0, chaseStarts: 0, chaseAbandoned: 0, chaseCaught: 0,
};
async function settleModals() {
  // The ENGAGE-then-cancel probe spans two rounds: 'pending' between clicking
  // into the deploy picker and seeing what cancelling it lands on.
  let cancelTest = null;
  for (let round = 0; round < 60; round++) {
    // Long enough to cover the 260ms cornered re-open in handleEncounter.
    await page.waitForTimeout(380);
    const info = await page.evaluate(() => {
      const { UI } = window.KR.dev;
      if (!UI.modalOpen()) return null;
      return {
        title: document.querySelector('#modal .modal-title')?.textContent?.trim() || '',
        blocking: UI.modalBlocking(),
        perk: !!document.querySelector('#modal [data-perk]'),
        verbs: [...document.querySelectorAll('#modal [data-verb]')].map((b) => b.dataset.verb),
        btns: [...document.querySelectorAll('#modal [data-x]')]
          .filter((b) => !b.disabled).map((b) => b.dataset.x),
      };
    });
    if (!info) {
      if (cancelTest === 'pending') {
        problems.push('cancelling the deploy picker exited a cornered encounter for free');
      }
      return;
    }
    stats.panels++;
    const has = (x) => info.btns.includes(x);

    // The deploy picker, reached by the cancel probe below (or by accident):
    // cancelling a cornered ENGAGE must land back on the encounter.
    if (has('go') && has('cancel')) {
      await page.click('#modal [data-x="cancel"]');
      continue;
    }

    if (info.perk) {
      stats.perks++;
      await page.click('#modal [data-perk]');
      continue;
    }
    if (info.verbs.length) {
      // The settlement menu. Rest occasionally — 20 hours through the real
      // advanceTime path — then back to the road.
      if (stats.visits++ % 3 === 0 && info.verbs.includes('rest')) {
        stats.rests++;
        await page.click('#modal [data-verb="rest"]');
        await page.waitForTimeout(120);
      }
      await page.click('#modal [data-x="close"]');
      continue;
    }
    if (has('fight')) {
      // A hostile band. First, rattle the doors that used to be unlocked.
      //
      // Escape must be refused — a hostile panel that dismisses is a free pass
      // around the contested withdrawal, no roll, no toll, no fight.
      if (stats.escTried < 3) {
        stats.escTried++;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        const still = await page.evaluate(() => window.KR.dev.UI.modalOpen());
        if (still) stats.escBlocked++;
        else {
          problems.push('a hostile encounter panel was dismissed with Escape');
          continue;
        }
      }
      if (has('avoid')) {
        stats.withdrawAttempts++;
        await page.click('#modal [data-x="avoid"]');
        continue;
      }
      // Run down. The other door: ENGAGE, then cancel the deploy picker. It
      // must put this panel straight back up, or the fight was never forced.
      if (cancelTest === 'pending') { cancelTest = 'done'; stats.cancelReturned++; }
      else if (cancelTest === null && stats.cancelTried < 3) {
        stats.cancelTried++;
        cancelTest = 'pending';
        await page.click('#modal [data-x="fight"]');
        continue;                    // the go/cancel branch above cancels it
      }
      stats.cornered++;
      if (has('send')) { stats.sends++; await page.click('#modal [data-x="send"]'); continue; }
      if (has('toll')) { stats.tolls++; await page.click('#modal [data-x="toll"]'); continue; }
      // Broke, nobody fit to send: the fight is genuinely unavoidable now, and
      // playing a mission is outside this soak's remit. Fund the toll and take
      // it — the ledger is not what is being measured.
      await page.evaluate(() => { window.KR.campaign.credits += 500000; });
      stats.tolls++;
      await page.evaluate(() => {
        document.querySelector('#modal [data-x="toll"]')?.removeAttribute('disabled');
      });
      await page.click('#modal [data-x="toll"]');
      continue;
    }
    if (has('inspect')) {
      stats.inspections++;
      await page.click(`#modal [data-x="${stats.inspections % 2 ? 'inspect' : 'avoid'}"]`);
      continue;
    }
    if (has('aid')) { stats.aids++; await page.click('#modal [data-x="aid"]'); continue; }
    if (has('drink')) { stats.talks++; await page.click('#modal [data-x="drink"]'); continue; }
    if (has('talk')) { stats.talks++; await page.click('#modal [data-x="talk"]'); continue; }
    if (has('avoid')) { await page.click('#modal [data-x="avoid"]'); continue; }
    if (has('close')) { await page.click('#modal [data-x="close"]'); continue; }
    if (!info.blocking) {
      await page.keyboard.press('Escape');
      continue;
    }
    // A blocking panel with no button we recognise: press the first thing that
    // is not obviously a commitment.
    const safe = info.btns.find((x) => !['go', 'deploy', 'seize', 'fight'].includes(x));
    if (safe) { await page.click(`#modal [data-x="${safe}"]`); continue; }
    break;
  }
  // Sixty rounds and still up: that is a panel the game cannot leave.
  stats.stuckModals++;
  const title = await page.evaluate(() => {
    const t = document.querySelector('#modal .modal-title')?.textContent || '?';
    window.KR.dev.UI.closeModal();
    return t;
  });
  console.log(`  STUCK PANEL: "${title}" would not close; forced it`);
  await page.screenshot({ path: join(ROOT, 'qa-soak', 'mapsoak-stuck.png') });
}

// ---- the run ---------------------------------------------------------------
const targetHours = DAYS * 24;
let hours = 0, ticks = 0, dist = 0, factorSum = 0, chaseT = 0, chasedT = 0;
let zeroStreak = 0, lastReport = 0, last = null;

while (hours < targetHours) {
  const r = await chunk(400);
  hours += r.hours; ticks += r.ticks; dist += r.dist; factorSum += r.factorSum;
  chaseT += r.chaseTicks; chasedT += r.chasedTicks;
  problems.push(...r.problems);
  for (const e of r.events) {
    if (e === 'chase:start') stats.chaseStarts++;
    else if (e === 'chase:abandoned') stats.chaseAbandoned++;
  }
  last = r;
  if (r.reason === 'error') break;
  if (r.reason === 'modal') {
    if (r.chasingAtBreak) stats.chaseCaught++;
    await settleModals();
  }
  zeroStreak = r.hours > 0 ? 0 : zeroStreak + 1;
  if (zeroStreak > 10) {
    problems.push(`day ${r.day}: soak stalled — no hours pass and no panel to answer`);
    await page.screenshot({ path: join(ROOT, 'qa-soak', 'mapsoak-stall.png') });
    break;
  }
  // Keep the toll payable however long the war has run; the ledger is not
  // what this soak is measuring.
  await page.evaluate(() => {
    const S = window.KR.campaign;
    if (S.credits < 100000) S.credits = 200000;
  });
  if (hours - lastReport >= 40 * 24) {
    lastReport = hours;
    console.log(`  day ${last.day}: roster=${last.roster} parties=${last.parties}`
      + ` rations=${last.rations} morale=${last.morale}`
      + ` panels=${stats.panels} withdrawals=${stats.withdrawAttempts}`);
  }
}

// ---- the verdict -----------------------------------------------------------
const escapes = stats.withdrawAttempts - stats.cornered;
const chasedPct = ticks ? Math.round((chasedT / ticks) * 100) : 0;
const pace = hours ? (dist / hours).toFixed(1) : '0';
const meanFactor = ticks ? (factorSum / ticks).toFixed(3) : '0';

console.log(`\nSimulated ${Math.round(hours / 24)} days (${ticks} map ticks), ended day ${last?.day}.`);
console.log(`  travel: ${Math.round(dist / 1000)}k units, ${pace} units/hour,`
  + ` mean travelFactor ${meanFactor} under the company`);
console.log(`  panels answered: ${stats.panels} — visits=${stats.visits} rests=${stats.rests}`
  + ` talks=${stats.talks} inspections=${stats.inspections} aids=${stats.aids} perks=${stats.perks}`);
console.log(`  withdrawal: ${stats.withdrawAttempts} attempted, ${escapes} got away,`
  + ` ${stats.cornered} run down -> sends=${stats.sends} tolls=${stats.tolls}`);
console.log(`  back doors: Escape blocked ${stats.escBlocked}/${stats.escTried},`
  + ` deploy-cancel returned to the encounter ${stats.cancelReturned}/${stats.cancelTried}`);
console.log(`  chases: ${stats.chaseStarts} started, ${stats.chaseCaught} ended in an encounter,`
  + ` ${stats.chaseAbandoned} abandoned; hostile pursuit live ${chasedPct}% of ticks`);

if (problems.length) {
  console.log(`\n${problems.length} invariant failure(s):`);
  for (const p of problems.slice(0, 15)) console.log(`  ${p}`);
}
console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ${e}`);

// A withdrawal that never fails, or pursuit that never lets go, are both
// tuning holes this soak exists to see — flag, do not merely mention.
if (stats.withdrawAttempts >= 20 && stats.cornered === 0) {
  problems.push('withdrawal never failed once in ' + stats.withdrawAttempts
    + ' attempts — the contested withdrawal is not being contested');
}
if (chasedPct > 60) {
  problems.push(`hostile pursuit live ${chasedPct}% of the time — the map is a permanent chase`);
}

const ok = problems.length === 0 && errors.length === 0 && stats.stuckModals === 0;
console.log(ok
  ? `\nOK — ${Math.round(hours / 24)} days through the map loop; every panel closed,`
    + ' every invariant held.'
  : `\nFAIL — ${problems.length} problem(s), ${errors.length} console error(s),`
    + ` ${stats.stuckModals} stuck panel(s).`);
await browser.close();
server?.kill();
process.exit(ok ? 0 : 1);
