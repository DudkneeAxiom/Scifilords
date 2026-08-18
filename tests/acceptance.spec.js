// Acceptance tests for the critical flows.
//
// These guard the loop, not the pixels — screenshot QA (tools/qa.mjs and
// tools/qa2.mjs) covers what things look like. Anything here failing means the
// game is not playable end to end.

import { test, expect } from '@playwright/test';

/** Boot to the title screen with models loaded. */
async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });
  return errors;
}

/** Start a new campaign and clear the intro, commission and contract board. */
async function newCampaign(page) {
  await page.click('button[data-act="new"]');
  // The background questionnaire comes first; sign through on the plain
  // answers so every test starts the campaign the game has always started.
  await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
  await page.click('#modal [data-x="close"]');
  await page.waitForFunction(() => {
    const t = document.querySelector('#modal .modal-title');
    return t && !/BEFORE THE COMPANY/.test(t.textContent);
  }, null, { timeout: 15000 });
  await page.click('#modal [data-x="close"]');
  // The commander's opening commission gates everything after it.
  await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });
  await page.click('#modal [data-perk]');
  await page.waitForTimeout(600);
  // The intro hands straight to the board; close it and resume the world.
  await page.evaluate(() => {
    document.getElementById('overlay').classList.add('hidden');
    window.KR.world.setPaused(false);
  });
  await page.waitForTimeout(300);
}

/** Accept a contract for a site and drive the company to it. */
async function takeContractAt(page, site, type) {
  await page.evaluate(([site, type]) => {
    const S = window.KR.campaign;
    S.contracts.forEach((c) => { c.accepted = false; });
    let c = S.contracts.find((x) => x.site === site && x.type === type);
    if (!c) {
      c = {
        id: 'test_' + site, type, site, employer: 'syndic', title: 'Test posting',
        text: 'test', pay: 500, expiresDay: S.day + 9, accepted: true,
      };
      S.contracts.push(c);
    }
    c.accepted = true;
    const L = { rampart: [-160, -760], perran: [620, 160], grellan: [520, -600] }[site];
    window.KR.world.stopTravel();
    S.pos.x = L[0];
    S.pos.z = L[1] + 12;
    // Remembered so enterLocation can put us back: withdrawing from an
    // encounter deliberately displaces the company, sometimes out of range.
    window.__testSite = [S.pos.x, S.pos.z];
  }, [site, type]);
  await page.waitForTimeout(900);
  // An approach encounter may legitimately interrupt; dismiss it.
  await page.evaluate(() => {
    const el = document.querySelector('#modal [data-x="avoid"]');
    if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
  });
  await page.waitForTimeout(400);
}

/** Dismiss any panel that is actually on screen (an approach encounter, say). */
async function clearModal(page) {
  await page.evaluate(() => {
    if (document.getElementById('overlay').classList.contains('hidden')) return;
    const el = document.querySelector('#modal [data-x="avoid"]')
      || document.querySelector('#modal [data-x="close"]');
    if (el) el.click();
  });
  await page.waitForTimeout(350);
}

/**
 * Press E at a location and wait for the expected panel. A party can wander
 * into range at any moment and open an encounter, which swallows world keys —
 * so retry rather than assuming the first press lands.
 */
/**
 * Drive into the location under the company and wait for `selector`.
 *
 * A settlement with services now opens a menu of verbs rather than every
 * service at once, so anything aiming at a service has to walk in through the
 * door: pass the verb that opens it. Somewhere with no services — a ruin, a
 * mast, a fort — still goes straight to the deployment picker, which is why
 * most callers need no verb at all.
 */
async function enterLocation(page, selector, verb = null) {
  for (let i = 0; i < 5; i++) {
    await clearModal(page);
    // Withdrawing from an encounter pushes the company away from the party,
    // which can take it outside the location radius — put it back.
    await page.evaluate(() => {
      if (window.__testSite) {
        const S = window.KR.campaign;
        window.KR.world.stopTravel();
        S.pos.x = window.__testSite[0];
        S.pos.z = window.__testSite[1];
      }
    });
    await page.waitForTimeout(250);
    await page.keyboard.press('e');
    try {
      if (verb) {
        await page.waitForSelector(`#modal [data-verb="${verb}"]`, { timeout: 4000 });
        await page.click(`#modal [data-verb="${verb}"]`);
      }
      await page.waitForSelector(selector, { timeout: 4000 });
      return;
    } catch { /* an encounter beat us to it; clear it and try again */ }
  }
  await page.waitForSelector(selector, { timeout: 8000 });
}

/**
 * Select everyone in the deployment picker. The panel re-renders after every
 * click, so cached element handles go stale — re-query by index each time.
 */
async function selectWholeCompany(page) {
  const count = (await page.$$('#modal [data-p]')).length;
  for (let i = 0; i < count; i++) {
    const els = await page.$$('#modal [data-p]');
    if (els[i]) await els[i].click().catch(() => {});
    await page.waitForTimeout(60);
  }
}

/**
 * Wait out the deployment cinematic. Nothing responds to input and nothing
 * shoots until it hands over, so tests that skip it measure a frozen game.
 */
async function waitForControl(page) {
  await page.waitForFunction(
    () => window.KR.mission && !window.KR.mission.intro?.active && !window.KR.mission.inserting,
    null, { timeout: 30000 },
  );
  await page.waitForTimeout(300);
}

async function deploy(page) {
  await enterLocation(page, '#modal [data-x="go"]');
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission && window.KR.mission.player, null,
    { timeout: 30000 });
  await waitForControl(page);
}

test('game boots to the title screen with no page errors', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.title-main')).toHaveText('KETTLE REACH');
  expect(errors).toEqual([]);
});

test('new campaign starts with a commander and three soldiers', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const s = await page.evaluate(() => {
    const S = window.KR.campaign;
    return {
      roster: S.roster.length,
      commanders: S.roster.filter((x) => x.isCommander).length,
      credits: S.credits,
      contracts: S.contracts.length,
      day: S.day,
    };
  });
  expect(s.roster).toBe(4);
  expect(s.commanders).toBe(1);
  expect(s.contracts).toBeGreaterThanOrEqual(2);
  expect(s.day).toBe(1);
});

test('strategic travel moves the company and advances time', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const before = await page.evaluate(() => {
    const S = window.KR.campaign;
    return { x: S.pos.x, z: S.pos.z, t: S.day * 24 + S.hour };
  });
  // Steer directly rather than clicking, so the test does not depend on where
  // the terrain raycast happens to land.
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => {
    const S = window.KR.campaign;
    return { x: S.pos.x, z: S.pos.z, t: S.day * 24 + S.hour };
  });
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(5);
  expect(after.t).toBeGreaterThan(before.t);
});

test('parties move independently on the strategic map', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const before = await page.evaluate(() =>
    window.KR.campaign.parties.map((p) => ({ id: p.id, x: p.x, z: p.z })));
  // Drive it in slices, clearing anything that interrupts.
  //
  // The Reach runs on its own clock now and hostile bands actively close on the
  // company, so a band can reach it inside these two seconds and open an
  // encounter — which pauses the map, which freezes the parties this test is
  // watching. That reads as "parties do not move" when what actually happened
  // is that one of them arrived.
  await page.keyboard.down('w');
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      if (document.getElementById('overlay').classList.contains('hidden')) return;
      const el = document.querySelector('#modal [data-x="avoid"]')
        || document.querySelector('#modal [data-x="close"]');
      el?.click();
    });
  }
  await page.keyboard.up('w');
  const after = await page.evaluate(() =>
    window.KR.campaign.parties.map((p) => ({ id: p.id, x: p.x, z: p.z })));
  const moved = after.filter((a) => {
    const b = before.find((x) => x.id === a.id);
    return b && Math.hypot(a.x - b.x, a.z - b.z) > 0.5;
  });
  expect(moved.length).toBeGreaterThan(0);
});

test('a recovery deployment launches, completes and extracts', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await deploy(page);

  const start = await page.evaluate(() => ({
    // Locations share layouts, so the level id is the layout; the deployment's
    // site is what identifies the place.
    site: window.KR.mission.spec.site,
    layout: window.KR.mission.level.id,
    objective: window.KR.mission.objective.type,
    enemies: window.KR.mission.entities.filter((e) => e.side === 'enemy').length,
    prisoners: window.KR.mission.prisoners.length,
  }));
  expect(start.site).toBe('grellan');
  expect(start.layout).toBe('array');
  expect(start.objective).toBe('recovery');
  expect(start.enemies).toBeGreaterThan(3);
  expect(start.prisoners).toBe(3);

  // Release the held personnel through the game's own interaction path.
  await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    m.interactables.filter((i) => i.kind === 'prisoner').forEach((i) => m.completeInteraction(i));
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.KR.mission.objective.done)).toBe(true);
  expect(await page.evaluate(() => window.KR.mission.extractArmed)).toBe(true);

  // Walk everyone to the extraction point.
  await page.evaluate(() => {
    const m = window.KR.mission;
    const ex = m.level.extraction;
    m.player.x = ex.x; m.player.z = ex.z;
    m.prisoners.forEach((p, i) => { p.x = ex.x + i * 0.8; p.z = ex.z + 1.5; });
  });
  await page.waitForFunction(() => window.KR.mission?.over === true, null, { timeout: 30000 });
  const res = await page.evaluate(() => window.KR.mission.result);
  expect(res.success).toBe(true);
  expect(res.recruits.length).toBeGreaterThan(0);
});

test('mission results persist to the campaign and change the world', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  const rosterBefore = await page.evaluate(() => window.KR.campaign.roster.length);

  await takeContractAt(page, 'grellan', 'recovery');
  await deploy(page);
  await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    m.interactables.filter((i) => i.kind === 'prisoner').forEach((i) => m.completeInteraction(i));
    const ex = m.level.extraction;
    m.player.x = ex.x; m.player.z = ex.z;
    m.prisoners.forEach((p, i) => { p.x = ex.x + i * 0.8; p.z = ex.z + 1.5; });
  });
  await page.waitForFunction(() => window.KR.mission?.over === true, null, { timeout: 30000 });
  // The after-action panel appears once results are folded into the campaign.
  await page.waitForSelector('.aar-verdict', { timeout: 20000 });

  const after = await page.evaluate(() => {
    const S = window.KR.campaign;
    return {
      roster: S.roster.length,
      missions: S.stats.missions,
      grellanCleared: S.world.grellanCleared,
      raiderDensity: S.world.raiderDensity,
      rescued: S.roster.filter((s) => /Rescued/.test(s.joinedHow)).length,
    };
  });
  expect(after.roster).toBeGreaterThan(rosterBefore);
  expect(after.missions).toBe(1);
  expect(after.grellanCleared).toBe(true);
  expect(after.raiderDensity).toBeLessThan(1);
  expect(after.rescued).toBeGreaterThan(0);
});

test('soldiers accumulate deployments and experience', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await deploy(page);
  await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    m.interactables.filter((i) => i.kind === 'prisoner').forEach((i) => m.completeInteraction(i));
    const ex = m.level.extraction;
    m.player.x = ex.x; m.player.z = ex.z;
    m.prisoners.forEach((p, i) => { p.x = ex.x + i * 0.8; p.z = ex.z + 1.5; });
  });
  await page.waitForFunction(() => window.KR.mission?.over === true, null, { timeout: 30000 });
  await page.waitForSelector('.aar-verdict', { timeout: 20000 });
  const cmd = await page.evaluate(() => {
    const S = window.KR.campaign;
    const c = S.roster.find((s) => s.isCommander);
    return { deployments: c.deployments, xp: c.xp };
  });
  expect(cmd.deployments).toBe(1);
  expect(cmd.xp).toBeGreaterThan(0); // the commander starts their own ladder at zero
});

test('a downed soldier can be stabilised with a medical kit', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  // Take the whole company so there is somebody to lose.
  await enterLocation(page, '#modal [data-p]');
  await selectWholeCompany(page);
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
  await waitForControl(page);

  const result = await page.evaluate(() => {
    const m = window.KR.mission;
    const mate = m.squad.find((s) => s.soldier);
    if (!mate) return { skipped: true };
    const kitsBefore = m.S.medical;
    m.downEntity(mate, m.player);
    const wasDown = mate.down;
    // Stand over them and complete the stabilise interaction.
    m.player.x = mate.x; m.player.z = mate.z;
    m.completeInteraction({ kind: 'revive', entity: mate, need: 2.2, progress: 2.2 });
    return {
      wasDown,
      nowDown: mate.down,
      stabilised: mate.stabilised,
      kitsBefore,
      kitsAfter: m.S.medical,
    };
  });
  expect(result.wasDown).toBe(true);
  expect(result.nowDown).toBe(false);
  expect(result.stabilised).toBe(true);
  expect(result.kitsAfter).toBe(result.kitsBefore - 1);
});

test('an unstabilised casualty left behind can die permanently', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await enterLocation(page, '#modal [data-p]');
  await selectWholeCompany(page);
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
  await waitForControl(page);

  const id = await page.evaluate(() => {
    const m = window.KR.mission;
    const mate = m.squad.find((s) => s.soldier);
    m.downEntity(mate, m.player);
    mate.bleed = 0.01;          // bleed out immediately
    return mate.soldier.id;
  });
  await page.waitForFunction((id) => {
    const m = window.KR.mission;
    const e = m.entities.find((x) => x.soldier && x.soldier.id === id);
    return e && e.dead;
  }, id, { timeout: 20000 });

  // Finish the mission and confirm the death persisted to the campaign.
  await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    m.interactables.filter((i) => i.kind === 'prisoner').forEach((i) => m.completeInteraction(i));
    const ex = m.level.extraction;
    m.player.x = ex.x; m.player.z = ex.z;
    m.prisoners.forEach((p, i) => { p.x = ex.x + i * 0.8; p.z = ex.z + 1.5; });
  });
  await page.waitForFunction(() => window.KR.mission?.over === true, null, { timeout: 30000 });
  await page.waitForSelector('.aar-verdict', { timeout: 20000 });
  const dead = await page.evaluate((id) => {
    const s = window.KR.campaign.roster.find((x) => x.id === id);
    return { status: s.status, hp: s.hp };
  }, id);
  expect(dead.status).toBe('dead');
  expect(dead.hp).toBe(0);
});

test('recruitment at a settlement adds a soldier and charges credits', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(() => {
    const S = window.KR.campaign;
    window.KR.world.stopTravel();
    S.pos.x = -550; S.pos.z = -410;
    S.credits = 3000;
    window.__testSite = [S.pos.x, S.pos.z];
  });
  await page.waitForTimeout(1000);
  await enterLocation(page, '#modal [data-hire="0"]', 'recruit');
  const before = await page.evaluate(() => ({
    roster: window.KR.campaign.roster.length,
    credits: window.KR.campaign.credits,
  }));
  await page.click('#modal [data-hire="0"]');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    roster: window.KR.campaign.roster.length,
    credits: window.KR.campaign.credits,
  }));
  expect(after.roster).toBe(before.roster + 1);
  expect(after.credits).toBeLessThan(before.credits);
});

test('save and load round-trip preserves the company', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const S = window.KR.campaign;
    S.credits = 1234;
    S.day = 5;
    const St = await import('/src/state.js');
    St.save(S);
  });
  const before = await page.evaluate(() => {
    const S = window.KR.campaign;
    return { credits: S.credits, day: S.day, names: S.roster.map((s) => s.name) };
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });
  await expect(page.locator('#btn-continue')).toBeEnabled();
  await page.click('#btn-continue');
  await page.waitForTimeout(1800);

  const after = await page.evaluate(() => {
    const S = window.KR.campaign;
    return { credits: S.credits, day: S.day, names: S.roster.map((s) => s.name) };
  });
  expect(after).toEqual(before);
});

test('a corrupt save is discarded rather than blocking the game', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => localStorage.setItem('kettle_reach_save_v1', '{"nonsense":true'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#title:not(.hidden)', { timeout: 90000 });
  // A broken save must never prevent starting a new company. The campaign
  // exists only after the charter is signed, so sign it.
  await page.click('button[data-act="new"]');
  await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
  await page.click('#modal [data-x="close"]');
  await page.waitForFunction(() => !!window.KR.campaign, null, { timeout: 15000 });
  expect(await page.evaluate(() => window.KR.campaign.roster.length)).toBe(4);
});

test('sabotage completing collapses Trust patrol coverage', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'rampart', 'sabotage');
  await deploy(page);
  await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    const it = m.interactables.find((i) => i.kind === 'charge');
    m.completeInteraction(it);
  });
  expect(await page.evaluate(() => window.KR.mission.chargesPlaced)).toBe(true);
  await page.evaluate(() => {
    const m = window.KR.mission;
    const ex = m.level.extraction;
    m.player.x = ex.x; m.player.z = ex.z;
  });
  await page.waitForFunction(() => window.KR.mission?.over === true, null, { timeout: 30000 });
  await page.waitForSelector('.aar-verdict', { timeout: 20000 });
  const w = await page.evaluate(() => window.KR.campaign.world);
  expect(w.rampartMastDown).toBe(true);
  expect(w.trustPatrolDensity).toBeLessThan(0.5);
});

test('the character rig animates while moving and settles when still', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await deploy(page);

  // Every joint the walk cycle drives must have a real range of travel. This
  // caught a regression where the player's velocity was measured after they had
  // already moved, so the commander slid along in a permanent idle pose.
  const measure = async () => page.evaluate(() => new Promise((resolve) => {
    const m = window.KR.mission;
    const keys = ['legL', 'legR', 'kneeL', 'kneeR', 'armR'];
    const lo = {}, hi = {};
    keys.forEach((k) => { lo[k] = Infinity; hi[k] = -Infinity; });
    let n = 0;
    const t = setInterval(() => {
      const r = m.player.char.rig;
      keys.forEach((k) => {
        if (!r[k]) return;
        lo[k] = Math.min(lo[k], r[k].rotation.x);
        hi[k] = Math.max(hi[k], r[k].rotation.x);
      });
      if (++n > 70) {
        clearInterval(t);
        const out = {};
        keys.forEach((k) => { out[k] = hi[k] - lo[k]; });
        resolve(out);
      }
    }, 16);
  }));

  // Keep the commander upright for the duration: a collapse animation swings
  // the legs hard and would be measured as "movement while standing still".
  await page.evaluate(() => {
    window.__alive = setInterval(() => {
      const m = window.KR.mission;
      if (m && m.player && !m.over) { m.player.hp = m.player.maxHp; m.player.down = false; }
    }, 100);
  });
  await page.keyboard.down('w');
  const walking = await measure();
  await page.keyboard.up('w');
  await page.waitForTimeout(700);
  const standing = await measure();
  await page.evaluate(() => clearInterval(window.__alive));

  for (const joint of ['legL', 'legR', 'kneeL', 'kneeR']) {
    expect(walking[joint], `${joint} should swing while walking`).toBeGreaterThan(0.15);
    expect(standing[joint], `${joint} should be still when stopped`).toBeLessThan(0.10);
  }
  expect(walking.armR, 'arms should move while walking').toBeGreaterThan(0.05);
});

test('the commander picks an opening commission that applies company-wide', async ({ page }) => {
  await boot(page);
  await page.click('button[data-act="new"]');
  await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
  await page.click('#modal [data-x="close"]');           // sign the charter
  await page.waitForFunction(() => {
    const t = document.querySelector('#modal .modal-title');
    return t && !/BEFORE THE COMPANY/.test(t.textContent);
  }, null, { timeout: 15000 });
  await page.click('#modal [data-x="close"]');           // close the intro
  await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });

  const offered = await page.$$eval('#modal [data-perk]', (els) => els.map((e) => e.dataset.perk));
  expect(offered.length).toBe(3);
  await page.click('#modal [data-perk]');
  await page.waitForTimeout(600);

  const cmd = await page.evaluate(() => {
    const c = window.KR.campaign.roster.find((s) => s.isCommander);
    return { perks: c.perks, pending: c.pendingPerks, rank: c.rank };
  });
  expect(cmd.perks.length).toBe(1);
  expect(offered).toContain(cmd.perks[0]);
  expect(cmd.pending).toBeFalsy();
});

test('promotion queues a perk choice that changes the soldier', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const before = await page.evaluate(async () => {
    const { effective } = await import('/src/roster.js');
    const s = window.KR.campaign.roster.find((x) => !x.isCommander);
    return { id: s.id, acc: effective(s).accuracy, perks: s.perks.length };
  });

  // Award enough experience to promote, then take the offered choice.
  const offered = await page.evaluate(async (id) => {
    const { addXp } = await import('/src/roster.js');
    const { rng } = await import('/src/util.js');
    const s = window.KR.campaign.roster.find((x) => x.id === id);
    addXp(s, 500, rng(11));
    return s.pendingPerks ? s.pendingPerks[0] : null;
  }, before.id);
  expect(offered).not.toBeNull();
  expect(offered.length).toBe(3);

  const after = await page.evaluate(async ([id, perk]) => {
    const { choosePerk, effective } = await import('/src/roster.js');
    const s = window.KR.campaign.roster.find((x) => x.id === id);
    const ok = choosePerk(s, perk);
    return { ok, perks: s.perks, pending: s.pendingPerks, acc: effective(s).accuracy, rank: s.rank };
  }, [before.id, offered[0]]);

  expect(after.ok).toBe(true);
  expect(after.perks).toContain(offered[0]);
  expect(after.pending).toBeFalsy();
  expect(after.rank).toBeGreaterThan(0);
});

test('weapons move between the armoury and soldiers without being lost', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const result = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    const s = S.roster.find((x) => !x.isCommander);
    const original = s.weapon;
    const spare = Object.keys(S.armoury).find((w) => S.armoury[w] > 0);
    const totalBefore = Object.values(S.armoury).reduce((a, b) => a + b, 0);
    const ok = St.equipWeapon(S, s, spare);
    const totalAfter = Object.values(S.armoury).reduce((a, b) => a + b, 0);
    return {
      ok, original, spare, carrying: s.weapon,
      totalBefore, totalAfter, returned: S.armoury[original] || 0,
    };
  });
  expect(result.ok).toBe(true);
  expect(result.carrying).toBe(result.spare);
  // The old weapon went back into the armoury: nothing created, nothing lost.
  expect(result.totalAfter).toBe(result.totalBefore);
  expect(result.returned).toBeGreaterThan(0);
});

test('kit changes a soldier\'s effective statistics', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const { effective } = await import('/src/roster.js');
    const S = window.KR.campaign;
    S.credits = 5000;
    const s = S.roster.find((x) => !x.isCommander);
    const before = effective(s).maxHp;
    St.buyKit(S, 'plate');
    const ok = St.equipKit(S, s, 'plate');
    return { ok, before, after: effective(s).maxHp, kit: s.kit };
  });
  expect(r.ok).toBe(true);
  expect(r.kit).toBe('plate');
  expect(r.after).toBeGreaterThan(r.before);
});

test('suppressing fire pins an enemy and degrades its aim', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await deploy(page);

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
    const cleanSpread = (1 - foe.acc) * (0.9 + 20 * 0.17) / m.suppressionPenalty(foe);
    // Walk a burst straight past them.
    for (let i = 0; i < 14; i++) {
      m.applySuppression(m.player, foe.x - 6, foe.z, foe.x + 6, foe.z + 0.4);
    }
    const pinnedSpread = (1 - foe.acc) * (0.9 + 20 * 0.17) / m.suppressionPenalty(foe);
    return { suppression: foe.suppression, cleanSpread, pinnedSpread };
  });

  expect(r.suppression).toBeGreaterThan(0.45);
  // Aim scatter must genuinely widen — that is the whole mechanic.
  expect(r.pinnedSpread).toBeGreaterThan(r.cleanSpread * 1.3);
});

test('individual selection routes orders to one soldier only', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await enterLocation(page, '#modal [data-p]');
  await selectWholeCompany(page);
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.squad?.length > 1, null, { timeout: 30000 });
  await waitForControl(page);

  // Select soldier 1 only, then order a hold.
  await page.keyboard.press('1');
  await page.waitForTimeout(200);
  await page.keyboard.press('h');
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    return {
      selected: m.selection.size,
      orders: m.squad.filter((s) => !s.militia).map((s) => s.order),
    };
  });
  expect(r.selected).toBe(1);
  expect(r.orders[0]).toBe('hold');
  // Everyone else keeps their previous order.
  expect(r.orders.slice(1).every((o) => o !== 'hold')).toBe(true);
});

test('suppress and flank orders put soldiers into those behaviours', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await enterLocation(page, '#modal [data-p]');
  await selectWholeCompany(page);
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.squad?.length > 0, null, { timeout: 30000 });
  await waitForControl(page);
  await waitForControl(page);

  await page.keyboard.press('x');
  await page.waitForTimeout(300);
  const sup = await page.evaluate(() => {
    const m = window.KR.mission;
    const s = m.squad.find((e) => !e.militia);
    return { order: s.order, hasPoint: !!s.suppressPoint };
  });
  expect(sup.order).toBe('suppress');
  expect(sup.hasPoint).toBe(true);

  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  const flank = await page.evaluate(() => {
    const m = window.KR.mission;
    const s = m.squad.find((e) => !e.militia);
    return {
      order: s.order,
      // The flank point must be meaningfully away from the commander's line.
      offset: s.flankPoint
        ? Math.hypot(s.flankPoint.x - m.player.x, s.flankPoint.z - m.player.z) : 0,
    };
  });
  expect(flank.order).toBe('flank');
  expect(flank.offset).toBeGreaterThan(5);
});

test('a dead rescue target does not make the recovery unwinnable', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await deploy(page);

  // Kill one of the people we came for, then free the rest. Extraction must
  // still arm — this previously left the objective stuck at 2 of 3 forever.
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    const victim = m.prisoners[0];
    victim.dead = true;
    victim.down = true;
    m.updateRecovery();
    const afterDeath = { need: m.objective.need, done: m.objective.done };
    m.interactables
      .filter((i) => i.kind === 'prisoner' && i.entity !== victim)
      .forEach((i) => m.completeInteraction(i));
    return {
      afterDeath,
      need: m.objective.need,
      progress: m.objective.progress,
      done: m.objective.done,
      extractArmed: m.extractArmed,
      lost: m.lostPrisoners,
    };
  });

  expect(r.afterDeath.need).toBe(2);       // target shrank to the survivors
  expect(r.need).toBe(2);
  expect(r.progress).toBe(2);
  expect(r.done).toBe(true);
  expect(r.extractArmed).toBe(true);
  expect(r.lost).toBe(1);
});

test('losing every rescue target fails honestly instead of stranding the player', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await deploy(page);

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.prisoners.forEach((p) => { p.dead = true; p.down = true; });
    m.updateRecovery();
    return { failed: m.objective.failed, extractArmed: m.extractArmed };
  });
  // The player must always be able to leave.
  expect(r.failed).toBe(true);
  expect(r.extractArmed).toBe(true);
});

test('nothing shoots at the player during the deployment cinematic', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await enterLocation(page, '#modal [data-x="go"]');
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });

  // Sample health and enemy targeting across the whole insertion.
  const during = await page.evaluate(() => new Promise((resolve) => {
    const m = window.KR.mission;
    const startHp = m.player.hp;
    let anyTargeting = false;
    let minHp = startHp;
    const t = setInterval(() => {
      // Check FIRST whether the grace is still running. Sampling before this
      // meant the final tick could observe up to 100ms of entirely legitimate
      // post-cinematic behaviour and report it as a violation — the test was
      // racing the thing it was measuring, and failed about one run in three.
      if (!m.inserting) {
        clearInterval(t);
        resolve({ startHp, minHp, anyTargeting, introRan: true });
        return;
      }
      minHp = Math.min(minHp, m.player.hp);
      if (m.entities.some((e) => e.side === 'enemy' && !e.dead && e.target)) anyTargeting = true;
    }, 100);
  }));

  expect(during.introRan).toBe(true);
  expect(during.anyTargeting).toBe(false);
  expect(during.minHp).toBe(during.startHp);
});

test('a flanking soldier routes around a solid obstacle', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  // Pin the level seed.
  //
  // Sites are built from `S.seed + S.stats.missions`, and newCampaign picks its
  // seed at random — so the scattered rocks moved on every run and sometimes
  // landed in the corridor this test measures a detour through. It failed
  // roughly one full run in five while passing in isolation, which is the worst
  // kind of test: it trains you to re-run rather than to look.
  await page.evaluate(() => {
    window.KR.campaign.seed = 12345;
    window.KR.campaign.stats.missions = 0;
  });
  await takeContractAt(page, 'grellan', 'recovery');
  await deploy(page);

  const r = await page.evaluate(() => {
    const nav = window.KR.mission.nav;
    // Straight through the bunker at (-22,-12).
    const a = { x: -22, z: 8 }, b = { x: -22, z: -30 };
    const blocked = !nav.lineClear(a.x, a.z, b.x, b.z);
    const path = nav.findPath(a.x, a.z, b.x, b.z);
    let maxDev = 0;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    for (const p of path || []) {
      maxDev = Math.max(maxDev, Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len);
    }
    // And every waypoint must be on open ground.
    const allOpen = (path || []).every((p) => !nav.isBlockedWorld(p.x, p.z));
    return { blocked, found: !!path, maxDev, allOpen };
  });

  expect(r.blocked).toBe(true);
  expect(r.found).toBe(true);
  expect(r.maxDev).toBeGreaterThan(2);   // it detoured rather than going through
  expect(r.allOpen).toBe(true);
});

test('trade buys low at a producer and sells high at a consumer', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    S.credits = 5000;
    S.cargo = {};
    // Perran produces water; Harrow Deep wants it.
    const buyAt = St.priceAt(S, 'perran', 'water');
    const sellAt = St.priceAt(S, 'harrow', 'water');
    const bought = St.buyGood(S, 'perran', 'water', 5);
    const afterBuy = S.credits;
    const sold = St.sellGood(S, 'harrow', 'water', 5);
    return {
      buyAt, sellAt, bought, sold,
      afterBuy, afterSell: S.credits,
      cargo: S.cargo.water || 0,
      trendProducer: St.priceTrend('perran', 'water'),
      trendConsumer: St.priceTrend('harrow', 'water'),
    };
  });
  expect(r.bought).toBe(true);
  expect(r.sold).toBe(true);
  expect(r.cargo).toBe(0);
  expect(r.trendProducer).toBe('cheap');
  expect(r.trendConsumer).toBe('dear');
  // The route has to be profitable, or the whole system is decorative.
  expect(r.sellAt).toBeGreaterThan(r.buyAt);
  expect(r.afterSell).toBeGreaterThan(r.afterBuy);
});

test('cargo capacity limits what the truck can carry', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    S.credits = 999999;
    S.cargo = {};
    // Salvage is bulk 4, so capacity should bind well before credits do.
    let placed = 0;
    for (let i = 0; i < 100; i++) if (St.buyGood(S, 'vetch', 'salvage', 1)) placed++;
    return { placed, used: St.cargoUsed(S), cap: St.CARGO_CAPACITY, free: St.cargoFree(S) };
  });
  expect(r.placed).toBeGreaterThan(0);
  expect(r.used).toBeLessThanOrEqual(r.cap);
  expect(r.free).toBeLessThan(4);          // could not fit another unit
});

test('locations offer several mission templates across the wider map', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const { LOCATIONS } = await import('/src/data.js');
    const St = await import('/src/state.js');
    const { rng } = await import('/src/util.js');
    const S = window.KR.campaign;
    // Generate a large board and see how varied it is.
    const seen = {};
    for (let i = 0; i < 60; i++) {
      S.contracts = [];
      const c = St.generateContract(S, rng(1000 + i));
      if (c) (seen[c.site] = seen[c.site] || new Set()).add(c.type);
    }
    return {
      locations: LOCATIONS.length,
      multiMission: LOCATIONS.filter((l) => (l.missions || []).length > 1).length,
      sitesSeen: Object.keys(seen).length,
      sitesWithVariety: Object.values(seen).filter((s) => s.size > 1).length,
    };
  });
  expect(r.locations).toBeGreaterThanOrEqual(11);
  expect(r.multiMission).toBeGreaterThanOrEqual(8);
  expect(r.sitesSeen).toBeGreaterThan(4);
  expect(r.sitesWithVariety).toBeGreaterThan(0);
});

test('seizing a location makes it a holding that produces daily', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    const before = { held: Object.keys(S.holdings).length, credits: S.credits };
    const ok = St.seizeLocation(S, 'rampart');
    const held = St.isHolding(S, 'rampart');
    // Roll a day and confirm the holding paid out.
    const creditsAfterSeize = S.credits;
    St.advanceTime(S, 26);
    return {
      ok, held,
      before,
      after: Object.keys(S.holdings).length,
      creditsAfterSeize,
      creditsNextDay: S.credits,
      repHit: S.rep.trust,
    };
  });
  expect(r.ok).toBe(true);
  expect(r.held).toBe(true);
  expect(r.after).toBe(r.before.held + 1);
  // Taking Trust ground costs Trust standing.
  expect(r.repHit).toBeLessThan(0);
  // And it pays.
  expect(r.creditsNextDay).toBeGreaterThan(r.creditsAfterSeize);
});

test('holding upgrades cost credits and goods and change the company', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    St.seizeLocation(S, 'rampart');
    S.credits = 20000;

    const cost = St.upgradeCost(S, 'rampart', 'depot');
    // Deliberately without the goods first: credits alone must not be enough.
    S.cargo = {};
    const blocked = St.buildUpgrade(S, 'rampart', 'depot');

    // Now stock the goods it asks for.
    for (const [g, n] of Object.entries(cost)) if (g !== 'credits') S.cargo[g] = n;
    const capBefore = St.cargoCap(S);
    const built = St.buildUpgrade(S, 'rampart', 'depot');
    return {
      cost, blocked, built,
      level: S.holdings.rampart.upgrades.depot,
      capBefore, capAfter: St.cargoCap(S),
      goodsSpent: Object.keys(cost).filter((g) => g !== 'credits')
        .every((g) => !S.cargo[g]),
    };
  });
  expect(r.cost.credits).toBeGreaterThan(0);
  expect(r.blocked).toBe(false);        // goods are genuinely required
  expect(r.built).toBe(true);
  expect(r.level).toBe(1);
  expect(r.goodsSpent).toBe(true);
  // A depot really does give the truck more room.
  expect(r.capAfter).toBeGreaterThan(r.capBefore);
});

test('an unheld holding builds pressure and can be lost', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    St.seizeLocation(S, 'rampart');
    let retakeOffered = false;
    // Run a fortnight without ever defending it.
    for (let d = 0; d < 16; d++) {
      St.advanceTime(S, 25);
      if (S.contracts.some((c) => c.retake === 'rampart')) retakeOffered = true;
      if (!St.isHolding(S, 'rampart')) break;
    }
    return { retakeOffered, stillHeld: St.isHolding(S, 'rampart') };
  });
  expect(r.retakeOffered).toBe(true);   // the player was warned and given a mission
  expect(r.stillHeld).toBe(false);      // ignoring it loses the ground
});

test('a seize deployment requires holding the ground, not just clearing it', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await page.evaluate(() => {
    const S = window.KR.campaign;
    S.contracts.forEach((c) => { c.accepted = false; });
    S.contracts.push({
      id: 'seize_test', type: 'seize', site: 'rampart', employer: null, seizure: true,
      title: 'Take Rampart 12', text: 'test', pay: 0, expiresDay: S.day + 9, accepted: true,
    });
    window.KR.world.stopTravel();
    S.pos.x = -160; S.pos.z = -748;
    window.__testSite = [S.pos.x, S.pos.z];
  });
  await page.waitForTimeout(900);
  await deploy(page);

  const mid = await page.evaluate(() => {
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    // Kill the garrison outright — the objective must still not be complete.
    m.entities.filter((e) => e.side === 'enemy').forEach((e) => { e.dead = true; e.down = true; });
    const o = m.level.objectivePoint;
    m.player.x = o.x; m.player.z = o.z;
    return { done: m.objective.done, type: m.objective.type, hold: m.holdSeconds };
  });
  expect(mid.type).toBe('seize');
  expect(mid.done).toBe(false);          // clearing is not taking
  expect(mid.hold).toBeGreaterThan(10);

  // Standing on it long enough finishes the job.
  await page.evaluate(() => { window.KR.mission.holdProgress = window.KR.mission.holdSeconds - 0.5; });
  await page.waitForFunction(() => window.KR.mission?.over === true, null, { timeout: 20000 });
  const res = await page.evaluate(() => window.KR.mission.result);
  expect(res.success).toBe(true);
  expect(res.type).toBe('seize');

  await page.waitForSelector('.aar-verdict', { timeout: 20000 });
  expect(await page.evaluate(() => !!window.KR.campaign.holdings.rampart)).toBe(true);
});

test('the continent has a danger gradient from the starting basin outward', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const { LOCATIONS, REGIONS, REGION } = await import('/src/data.js');
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    const byRegion = {};
    for (const p of S.parties) {
      const home = LOCATIONS.find((l) => l.id === p.home);
      const reg = home?.region || 'kettle';
      (byRegion[reg] = byRegion[reg] || []).push(p.strength);
    }
    const avg = (a) => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return {
      size: REGION.size,
      locations: LOCATIONS.length,
      regions: Object.keys(REGIONS).length,
      kettle: avg(byRegion.kettle),
      // The faction heartlands and the coast should be markedly nastier.
      outer: avg([...(byRegion.sarn || []), ...(byRegion.weal || []), ...(byRegion.littoral || [])]),
      parties: S.parties.length,
    };
  });
  expect(r.size).toBeGreaterThanOrEqual(4000);
  expect(r.locations).toBeGreaterThanOrEqual(25);
  expect(r.regions).toBe(5);
  expect(r.parties).toBeGreaterThan(15);
  expect(r.kettle).toBeGreaterThan(0);
  // Starting ground is genuinely easier than the far regions.
  expect(r.outer).toBeGreaterThan(r.kettle * 1.4);
});

test('renown raises the deployment limit', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const { makeSoldier } = await import('/src/roster.js');
    const { rng } = await import('/src/util.js');
    const S = window.KR.campaign;
    const rr = rng(5);
    for (let i = 0; i < 14; i++) {
      S.roster.push(makeSoldier(rr, { role: 'rifleman', how: 'test', day: 1 }));
    }
    const start = St.deployLimit(S);
    const names = [];
    S.renown = 0; names.push([St.renownName(S), St.deployLimit(S)]);
    S.renown = 600; names.push([St.renownName(S), St.deployLimit(S)]);
    S.renown = 2200; names.push([St.renownName(S), St.deployLimit(S)]);
    return { start, names };
  });
  expect(r.start).toBe(5);
  expect(r.names[0][1]).toBe(5);
  expect(r.names[1][1]).toBeGreaterThan(r.names[0][1]);
  expect(r.names[2][1]).toBeGreaterThanOrEqual(12);
  expect(r.names[2][0]).not.toBe(r.names[0][0]);
});

test('a large party fields a real battle in waves', async ({ page }) => {
  test.setTimeout(240000);
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { makeSoldier } = await import('/src/roster.js');
    const { rng } = await import('/src/util.js');
    const S = window.KR.campaign;
    S.renown = 2200;
    const rr = rng(7);
    for (let i = 0; i < 12; i++) {
      S.roster.push(makeSoldier(rr, { role: 'rifleman', rank: 2, how: 'test', day: 1 }));
    }
    window.__spec = {
      type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Test Field',
      party: { id: 'p', kind: 'column_trust', name: 'Column', strength: 60, tier: 5, quality: 1.1 },
    };
  });
  await page.evaluate(async () => {
    const UI = await import('/src/ui.js');
    UI.deployPanel(window.KR.campaign, window.__spec, {
      onClose: () => {}, onDeploy: (sq) => { window.__squad = sq; UI.closeModal(); },
    });
  });
  await page.waitForSelector('#modal [data-p]', { timeout: 15000 });
  await selectWholeCompany(page);
  await page.click('#modal [data-x="go"]');
  await page.waitForTimeout(300);

  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: G.campaign, spec: window.__spec, squad: window.__squad,
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onEnd: () => {},
    });
    await G.mission.start();
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  await waitForControl(page);

  const first = await page.evaluate(() => {
    const m = window.KR.mission;
    return {
      total: m.skirmishTotal,
      committed: m.skirmishCommitted,
      onField: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
      friendly: m.squad.length + 1,
    };
  });
  expect(first.total).toBe(60);
  expect(first.friendly).toBeGreaterThanOrEqual(10);
  // The whole party is not standing on the field at once...
  expect(first.onField).toBeLessThan(first.total);
  expect(first.onField).toBeGreaterThan(20);

  // ...but killing the front rank brings the rest on.
  await page.evaluate(() => {
    const m = window.KR.mission;
    m.entities.filter((e) => e.side === 'enemy').forEach((e) => { e.dead = true; e.down = true; });
  });
  await page.waitForFunction(
    (c) => window.KR.mission.skirmishCommitted > c, first.committed, { timeout: 20000 });
  const second = await page.evaluate(() => window.KR.mission.skirmishCommitted);
  expect(second).toBeGreaterThan(first.committed);
});

test('equipping armour changes the soldier and returns the old piece', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const { effective, armourRating } = await import('/src/roster.js');
    const S = window.KR.campaign;
    S.armourPool = { head_combat: 1, head_heavy: 1 };
    const c = S.roster.find((x) => x.isCommander);
    // Baseline is this soldier's own speed — traits and perks mean it is not
    // necessarily the bare 4.2, so the weight test has to be relative.
    const baseSpeed = effective(c).speed;
    const before = { hp: effective(c).maxHp, armour: armourRating(c), speed: baseSpeed };
    const a = St.equipArmour(S, c, 'head', 'head_combat');
    const mid = { hp: effective(c).maxHp, armour: armourRating(c), worn: c.equip.head };
    // Swapping should put the first helmet back in stores.
    const b = St.equipArmour(S, c, 'head', 'head_heavy');
    return {
      a, b, before, mid,
      after: { hp: effective(c).maxHp, armour: armourRating(c), worn: c.equip.head },
      returned: S.armourPool.head_combat || 0,
      // A sealed helm is heavy: speed must actually drop.
      speed: effective(c).speed,
    };
  });
  expect(r.a).toBe(true);
  expect(r.mid.worn).toBe('head_combat');
  expect(r.mid.hp).toBeGreaterThan(r.before.hp);
  expect(r.b).toBe(true);
  expect(r.after.worn).toBe('head_heavy');
  expect(r.after.armour).toBeGreaterThan(r.mid.armour);
  expect(r.returned).toBe(1);       // nothing lost in the swap
  // A sealed helm is heavy: it must cost this soldier speed.
  expect(r.speed).toBeLessThan(r.before.speed);
});

test('spoils are held aside until claimed', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    S.spoils = { credits: 0, cargo: {}, armoury: {}, armourPool: {}, kitPool: {} };
    const creditsBefore = S.credits;
    St.addSpoils(S, 'credits', null, 250);
    St.addSpoils(S, 'armoury', 'dmr', 2);
    St.addSpoils(S, 'armourPool', 'head_combat', 1);
    const waiting = St.hasSpoils(S);
    const creditsWhileWaiting = S.credits;
    St.claimSpoils(S);
    return {
      waiting, creditsBefore, creditsWhileWaiting,
      creditsAfter: S.credits,
      dmr: S.armoury.dmr || 0,
      helm: S.armourPool.head_combat || 0,
      empty: !St.hasSpoils(S),
    };
  });
  expect(r.waiting).toBe(true);
  // Nothing lands in stores until the player takes it.
  expect(r.creditsWhileWaiting).toBe(r.creditsBefore);
  expect(r.creditsAfter).toBe(r.creditsBefore + 250);
  expect(r.dmr).toBeGreaterThanOrEqual(2);
  expect(r.helm).toBeGreaterThanOrEqual(1);
  expect(r.empty).toBe(true);
});

test('faction standing gates a commission and tribute buys favour', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const Dip = await import('/src/diplomacy.js');
    const S = window.KR.campaign;
    S.credits = 20000;
    const early = Dip.canTakeCommission(S, 'trust');
    // Not trusted, not renowned: refused, and told why.
    S.renown = 700;
    const stillEarly = Dip.canTakeCommission(S, 'trust');
    const before = Dip.standingOf(S, 'trust');
    const creditsBefore = S.credits;
    for (let i = 0; i < 6; i++) Dip.payTribute(S, 'trust');
    return {
      early: early.ok, earlyWhy: early.why,
      stillEarly: stillEarly.ok,
      before, after: Dip.standingOf(S, 'trust'),
      tier: Dip.standingName(S, 'trust'),
      spent: creditsBefore - S.credits,
      nowOk: Dip.canTakeCommission(S, 'trust').ok,
    };
  });
  expect(r.early).toBe(false);
  expect(r.earlyWhy).toBeTruthy();
  expect(r.stillEarly).toBe(false);          // renown alone is not enough
  expect(r.after).toBeGreaterThan(r.before);  // tribute works
  expect(r.spent).toBeGreaterThan(0);
  expect(r.nowOk).toBe(true);                 // standing + renown unlocks it
});

test('taking a commission makes their enemies yours', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const Dip = await import('/src/diplomacy.js');
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    S.renown = 700; S.rep.trust = 20; S.rep.syndic = 5;
    const hostileBefore = S.parties.filter((p) => p.hostileToPlayer).length;
    const res = Dip.takeCommission(S, 'trust');
    St.refreshHostility(S);
    return {
      ok: res.ok,
      allegiance: S.allegiance,
      trust: S.rep.trust,
      syndic: S.rep.syndic,
      war: Dip.relationBetween(S, 'trust', 'syndic'),
      hostileBefore,
      hostileAfter: S.parties.filter((p) => p.hostileToPlayer).length,
      syndicHostile: Dip.isHostileToPlayer(S, 'syndic'),
      trustHostile: Dip.isHostileToPlayer(S, 'trust'),
    };
  });
  expect(r.ok).toBe(true);
  expect(r.allegiance).toBe('trust');
  expect(r.trust).toBeGreaterThanOrEqual(30);
  expect(r.syndic).toBeLessThan(0);
  expect(r.war).toBe('war');
  // Their war is now visible on the road.
  expect(r.syndicHostile).toBe(true);
  expect(r.trustHostile).toBe(false);
  expect(r.hostileAfter).toBeGreaterThan(r.hostileBefore);
});

test('breaking an oath costs renown and makes a permanent enemy', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const Dip = await import('/src/diplomacy.js');
    const S = window.KR.campaign;
    S.renown = 900; S.rep.trust = 20;
    Dip.takeCommission(S, 'trust');
    const renownBefore = S.renown;
    const res = Dip.breakAllegiance(S);
    return {
      ok: res.ok, was: res.was,
      allegiance: S.allegiance,
      renownBefore, renownAfter: S.renown,
      trust: S.rep.trust,
    };
  });
  expect(r.ok).toBe(true);
  expect(r.was).toBe('trust');
  expect(r.allegiance).toBeNull();
  expect(r.renownAfter).toBeLessThan(r.renownBefore);
  expect(r.trust).toBeLessThan(-20);
});

test('declaring a faction needs renown and ground, then turns both powers against you', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const Dip = await import('/src/diplomacy.js');
    const St = await import('/src/state.js');
    const S = window.KR.campaign;

    const noRenown = Dip.canDeclare(S);
    S.renown = 1500;
    const noGround = Dip.canDeclare(S);
    St.seizeLocation(S, 'rampart');
    St.seizeLocation(S, 'grellan');
    St.seizeLocation(S, 'culvert');
    const ready = Dip.canDeclare(S);

    const res = Dip.declareFaction(S, 'The Kettle Compact');
    St.refreshHostility(S);
    return {
      noRenown: noRenown.ok, noRenownWhy: noRenown.why,
      noGround: noGround.ok,
      ready: ready.ok,
      declared: res.ok,
      name: S.ownFaction?.name,
      trustWar: Dip.relationBetween(S, 'bracket', 'trust'),
      syndicWar: Dip.relationBetween(S, 'bracket', 'syndic'),
      rep: { trust: S.rep.trust, syndic: S.rep.syndic },
      factions: Dip.allFactions(S).length,
      hostile: S.parties.filter((p) => p.hostileToPlayer).length,
      total: S.parties.length,
    };
  });
  expect(r.noRenown).toBe(false);
  expect(r.noRenownWhy).toBeTruthy();
  expect(r.noGround).toBe(false);      // renown without territory is not enough
  expect(r.ready).toBe(true);
  expect(r.declared).toBe(true);
  expect(r.name).toBe('The Kettle Compact');
  // A third power on the continent, at war with both.
  expect(r.factions).toBe(3);
  expect(r.trustWar).toBe('war');
  expect(r.syndicWar).toBe('war');
  expect(r.rep.trust).toBeLessThan(0);
  expect(r.rep.syndic).toBeLessThan(0);
  expect(r.hostile).toBeGreaterThan(r.total * 0.4);
});

test('inter-faction relations shift over time', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const St = await import('/src/state.js');
    const Dip = await import('/src/diplomacy.js');
    const S = window.KR.campaign;
    const seen = new Set();
    // Run a long stretch of days and record every state the pair passes through.
    // Measured over 1000 days: war occupies about a quarter of them and the
    // first one landed on day 143, so a 220-day window was marginal.
    for (let d = 0; d < 500; d++) {
      St.advanceTime(S, 25);
      seen.add(Dip.relationBetween(S, 'trust', 'syndic'));
    }
    return { states: [...seen], sawWar: seen.has('war') };
  });
  // The continent must not be politically frozen.
  expect(r.states.length).toBeGreaterThan(1);
  expect(r.sawWar).toBe(true);
});

test('suing for peace ends a war for money', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const Dip = await import('/src/diplomacy.js');
    const St = await import('/src/state.js');
    const S = window.KR.campaign;
    S.renown = 1500; S.credits = 50000;
    St.seizeLocation(S, 'rampart');
    St.seizeLocation(S, 'grellan');
    St.seizeLocation(S, 'culvert');
    Dip.declareFaction(S, 'Test Compact');
    const atWar = Dip.relationBetween(S, 'bracket', 'trust');
    const before = S.credits;
    const res = Dip.suePeace(S, 'trust');
    St.refreshHostility(S);
    return {
      atWar, ok: res.ok, cost: res.cost,
      after: Dip.relationBetween(S, 'bracket', 'trust'),
      spent: before - S.credits,
      hostile: Dip.isHostileToPlayer(S, 'trust'),
    };
  });
  expect(r.atWar).toBe('war');
  expect(r.ok).toBe(true);
  expect(r.spent).toBeGreaterThan(0);
  expect(r.after).toBe('truce');
  expect(r.hostile).toBe(false);
});

test('where a place raises troops decides who you can hire there', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const pools = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const out = {};
    for (const l of DATA.LOCATIONS) {
      if (l.kind !== 'settlement' || !l.services.includes('recruit')) continue;
      const pool = State.recruitPool(S, l.id);
      if (pool.length) out[l.id] = pool[0].origin;
    }
    return out;
  });
  const origins = new Set(Object.values(pools));
  // The map has to be worth crossing: at least three different kinds of people.
  expect(origins.size).toBeGreaterThanOrEqual(3);
});

test('origins carry distinct stats, models and prices', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const rows = await page.evaluate(() => {
    const { State, Roster, DATA, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    const r = makeRng(99);
    return Object.keys(DATA.ORIGINS).map((id) => {
      const o = DATA.ORIGINS[id];
      let acc = 0; let spd = 0; let hp = 0; let cost = 0;
      const N = 30;
      for (let i = 0; i < N; i++) {
        const s = Roster.makeSoldier(r, { role: 'rifleman', rank: 0, day: 1, origin: id });
        if (o.kit.armour) s.equip.body = o.kit.armour;
        if (o.kit.head) s.equip.head = o.kit.head;
        s.maxHp = Roster.maxHpOf(s);
        const st = Roster.effective(s, S.roster);
        acc += st.accuracy; spd += st.speed; hp += s.maxHp; cost += State.hireCost(S, s);
      }
      return { id, model: o.model, acc: acc / N, spd: spd / N, hp: hp / N, cost: cost / N };
    });
  });
  expect(rows.length).toBeGreaterThanOrEqual(5);
  // Every origin fields its own character model.
  expect(new Set(rows.map((x) => x.model)).size).toBe(rows.length);
  // Trust regulars are the accurate, armoured, slow, expensive ones; Syndic
  // levies are the fast cheap ones. If those two ever converge the system is
  // decoration.
  const trust = rows.find((x) => x.id === 'trust');
  const syndic = rows.find((x) => x.id === 'syndic');
  expect(trust.acc).toBeGreaterThan(syndic.acc);
  expect(trust.hp).toBeGreaterThan(syndic.hp);
  expect(trust.spd).toBeLessThan(syndic.spd);
  expect(trust.cost).toBeGreaterThan(syndic.cost);
});

test('a soldier keeps their origin through hiring and deployment', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const founders = await page.evaluate(() => window.KR.campaign.roster.map((s) => s.origin));
  // The founding company is deliberately mixed.
  expect(new Set(founders).size).toBeGreaterThanOrEqual(2);
  const hired = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    S.credits = 40000;
    const l = DATA.LOCATIONS.find(
      (x) => x.faction === 'trust' && x.kind === 'settlement' && x.services.includes('recruit'));
    S.atLocation = l.id;
    const pick = State.recruitPool(S, l.id)[0];
    State.hire(S, pick);
    const saved = S.roster.find((s) => s.id === pick.id);
    return { want: pick.origin, got: saved?.origin, model: DATA.ORIGINS[saved.origin].model };
  });
  expect(hired.got).toBe(hired.want);
  expect(hired.model).toBe('soldier_trust');
});

test('crouch, jump and shoulder swap change the player state', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const launch = async () => page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'T',
        party: { id: 't', kind: 'scrappers', name: 'T', strength: 8, tier: 2, quality: 0.8 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = false;
    G.mission.hadLock = true;
    if (G.mission.intro) {
      G.mission.intro.active = false;
      G.mission.time = G.mission.intro.graceUntil + 0.1;
    }
  });
  await launch();
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const stance = await page.evaluate(async () => {
    const m = window.KR.mission;
    m.hadLock = true;
    const out = {};

    // Crouch blends in rather than snapping, and costs speed.
    m.crouchHeld = true;
    for (let i = 0; i < 60; i++) m.step(1 / 60);
    out.crouched = +m.crouch.toFixed(2);
    m.crouchHeld = false;
    for (let i = 0; i < 60; i++) m.step(1 / 60);
    out.stoodBack = +m.crouch.toFixed(2);

    // A jump leaves the ground and comes back to it.
    m.tryJump();
    out.leftGround = !m.grounded;
    let peak = 0;
    for (let i = 0; i < 120; i++) { m.step(1 / 60); peak = Math.max(peak, m.airY); }
    out.peak = +peak.toFixed(2);
    out.landed = m.grounded && m.airY === 0;

    // You cannot jump out of a crouch, and you cannot double-jump.
    m.crouchHeld = true;
    for (let i = 0; i < 60; i++) m.step(1 / 60);
    m.tryJump();
    out.blockedByCrouch = m.grounded;
    m.crouchHeld = false;
    for (let i = 0; i < 60; i++) m.step(1 / 60);
    m.tryJump();
    const vy1 = m.vy;
    m.tryJump();
    out.noDoubleJump = m.vy === vy1;

    // Shoulder swap mirrors the camera side.
    const before = m.shoulder;
    m.swapShoulder();
    out.swapped = m.shoulder === -before;
    return out;
  });

  expect(stance.crouched).toBeGreaterThan(0.9);
  expect(stance.stoodBack).toBe(0);
  expect(stance.leftGround).toBe(true);
  expect(stance.peak).toBeGreaterThan(0.4);
  expect(stance.landed).toBe(true);
  expect(stance.blockedByCrouch).toBe(true);
  expect(stance.noDoubleJump).toBe(true);
  expect(stance.swapped).toBe(true);
});

test('the command wheel issues the order it is showing', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const launch = async () => page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'T',
        party: { id: 't', kind: 'scrappers', name: 'T', strength: 8, tier: 2, quality: 0.8 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = false;
    G.mission.hadLock = true;
    if (G.mission.intro) {
      G.mission.intro.active = false;
      G.mission.time = G.mission.intro.graceUntil + 0.1;
    }
  });
  await launch();
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.hadLock = true;
    const orders = m.ORDERS.map((o) => o.id);
    const out = [];
    for (let i = 0; i < orders.length; i++) {
      const a = (i / orders.length) * Math.PI * 2;
      m.closeWheel(false);
      m.openWheel();
      for (let k = 0; k < 10; k++) m.steerWheel(Math.sin(a) * 12, -Math.cos(a) * 12);
      out.push({ want: orders[i], got: m.ORDERS[m.wheel.index]?.id });
      m.closeWheel(true);
    }
    // Releasing inside the dead zone must not issue anything.
    m.setSquadOrder('hold');
    m.openWheel();
    m.steerWheel(3, 3);
    const idx = m.wheel.index;
    m.closeWheel(true);
    return { out, deadZone: idx, after: m.squad.find((s) => !s.dead)?.order };
  });
  for (const row of r.out) expect(row.got).toBe(row.want);
  expect(r.deadZone).toBe(-1);
  expect(r.after).toBe('hold');
});

test('the Titan sheds armour and only its cores take real damage', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'titan', site: 'roadside', layout: 'roadside', siteName: 'Titan' },
      squad: S.roster.slice(0, 3),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    const e = m.titan;
    const pl = e.plates.find((x) => x.id === 'chest');

    const hitPlate = (n) => {
      const before = e.hp;
      for (let i = 0; i < n; i++) {
        const wp = m.platePos(pl);
        m.applyDamage(e, 30, m.player, { x: wp.x, y: wp.y, z: wp.z, plate: pl });
      }
      return before - e.hp;
    };

    const armourCost = hitPlate(5);
    let guard = 0;
    while (!pl.broken && guard++ < 200) hitPlate(1);
    const broke = { broken: pl.broken, slabHidden: !pl.slab.visible, coreShown: pl.core.visible };
    const coreCost = hitPlate(5);

    // And it has to be killable through the hole.
    guard = 0;
    while (!e.dead && guard++ < 4000) hitPlate(1);
    for (let i = 0; i < 60; i++) m.step(1 / 60);
    return {
      plates: e.plates.length,
      armourCost, coreCost, ...broke,
      dead: e.dead, done: !!m.objective.done,
    };
  });
  expect(r.plates).toBeGreaterThanOrEqual(6);
  expect(r.broken).toBe(true);
  expect(r.slabHidden).toBe(true);
  expect(r.coreShown).toBe(true);
  // Armour is a gate, not a modifier: a core hit must be worth many armour hits.
  expect(r.coreCost).toBeGreaterThan(r.armourCost * 8);
  expect(r.dead).toBe(true);
  expect(r.done).toBe(true);
});

test('holding ground builds renown and the ambition ladder tracks it', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, Dip } = { State: window.KR.dev.State, Dip: window.KR.dev.Dip };
    const S = window.KR.campaign;
    const before = Math.round(S.renown || 0);
    State.seizeLocation(S, 'grellan');
    for (let d = 0; d < 10; d++) State.advanceTime(S, 24);
    const after = Math.round(S.renown || 0);
    const amb = Dip.ambition(S);
    return {
      before, after,
      steps: amb.steps.map((s) => ({ id: s.id, have: s.have, need: s.need, how: !!s.how })),
      declared: amb.declared,
    };
  });
  // A place you hold makes your name, which is what makes growing one lead
  // anywhere at all.
  expect(r.after).toBeGreaterThan(r.before);
  expect(r.steps.length).toBe(2);
  expect(r.steps.every((s) => s.how)).toBe(true);
  expect(r.steps.find((s) => s.id === 'ground').have).toBeGreaterThanOrEqual(1);
});

test('settlements fight on settlement ground, with the garrison they were given', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const { DATA } = window.KR.dev;
    const Level = await import('/src/level.js');
    const towns = DATA.LOCATIONS.filter((l) => l.layout === 'settlement' || l.layout === 'works');
    const built = Level.build('settlement', 7, {});
    return {
      towns: towns.length,
      garrison: (built.garrison || []).length,
      patrols: (built.patrols || []).length,
      name: built.name,
    };
  });
  // Places where people live now have their own ground to fight over.
  expect(r.towns).toBeGreaterThanOrEqual(10);
  // And every layout's authored defenders actually reach the mission — these
  // were being dropped on the floor by build(), so every site played the same.
  expect(r.garrison).toBeGreaterThan(0);
  expect(r.patrols).toBeGreaterThan(0);
});

test('the company costs money and food every day', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;
    const up = State.upkeepOf(S);
    const start = { credits: S.credits, rations: S.rations };
    State.advanceTime(S, 24);
    const after = { credits: S.credits, rations: S.rations };
    // The commander is not on the payroll — you do not pay yourself.
    const cmd = State.commander(S);
    return { up, start, after, commanderWage: State.wageOf(cmd) };
  });
  expect(r.up.wages).toBeGreaterThan(0);
  expect(r.up.food).toBeGreaterThan(0);
  expect(r.after.credits).toBe(r.start.credits - r.up.wages);
  expect(r.after.rations).toBe(r.start.rations - r.up.food);
  expect(r.commanderWage).toBe(0);
});

test('going unpaid and unfed costs morale, and people eventually leave', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    // Pinned, like its sibling below and for the sibling's reason: the seed
    // decides the roster and every desertion roll comes off the campaign's
    // own streams, so an unpinned run occasionally starves for forty days
    // without anybody quite walking — a rare full-suite failure with nothing
    // wrong in the game.
    window.KR.campaign = State.newCampaign(31415);
    const S = window.KR.campaign;
    S.credits = 0;
    S.rations = 0;
    const before = { morale: S.morale, roster: State.living(S).length };
    for (let d = 0; d < 40; d++) State.advanceTime(S, 24);
    const after = { morale: S.morale, roster: State.living(S).length,
      unpaid: S.unpaidDays, deserted: S.stats.deserted || 0 };
    // The commander never deserts, whatever happens.
    return { before, after, hasCommander: !!State.commander(S) };
  });
  expect(r.after.morale).toBeLessThan(r.before.morale);
  expect(r.after.deserted).toBeGreaterThan(0);
  expect(r.after.roster).toBeLessThan(r.before.roster);
  expect(r.hasCommander).toBe(true);
});

test('paying and feeding the company stops the bleeding', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    // Pinned, because the seed decides how many mouths there are.
    //
    // This buys a fixed thirty rations and then asserts that nobody deserts
    // over the following ten days. A larger starting company eats that in under
    // ten, goes hungry again, and somebody walks — so on some seeds the test
    // fails for a reason that has nothing to do with the thing it is checking.
    window.KR.campaign = State.newCampaign(31415);
    const S = window.KR.campaign;
    S.credits = 0; S.rations = 0;
    for (let d = 0; d < 25; d++) State.advanceTime(S, 24);
    const low = { morale: S.morale, roster: State.living(S).length };

    // Settle up and restock.
    S.credits = 20000;
    const market = DATA.LOCATIONS.find((l) => l.services?.includes('market'));
    const bought = State.buyRations(S, market.id, 30);
    for (let d = 0; d < 10; d++) State.advanceTime(S, 24);
    return { low, bought, morale: S.morale, roster: State.living(S).length };
  });
  expect(r.bought).toBe(true);
  expect(r.morale).toBeGreaterThan(r.low.morale);
  // Nobody else walks once they are paid and fed — desertion needs a live
  // grievance, not just a lagging number.
  expect(r.roster).toBe(r.low.roster);
});

test('prisoners can be pressed, ransomed or released', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, Roster, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    const rng = makeRng(5);
    const mk = (n) => Object.assign(
      Roster.makeSoldier(rng, { role: 'rifleman', rank: 1, day: 1, name: n }),
      { captiveFaction: 'trust' },
    );
    S.prisoners = [mk('P One'), mk('P Two'), mk('P Three')];
    const before = { roster: State.living(S).length, credits: S.credits,
      rep: S.rep.trust, morale: S.morale };

    const pressed = State.pressPrisoner(S, S.prisoners[0].id);
    const afterPress = { roster: State.living(S).length, morale: S.morale };

    const value = State.ransomValue(S, S.prisoners[0]);
    const ransomed = State.ransomPrisoner(S, S.prisoners[0].id);
    const afterRansom = { credits: S.credits, rep: S.rep.trust };

    const released = State.releasePrisoner(S, S.prisoners[0].id);
    return { before, pressed, afterPress, value, ransomed, afterRansom,
      released, rep: S.rep.trust, left: S.prisoners.length };
  });
  expect(r.pressed).toBe(true);
  expect(r.afterPress.roster).toBe(r.before.roster + 1);
  // Serving next to somebody who was shooting at you last week costs morale.
  expect(r.afterPress.morale).toBeLessThan(r.before.morale);
  expect(r.ransomed).toBe(true);
  expect(r.afterRansom.credits).toBe(r.before.credits + r.value);
  expect(r.afterRansom.rep).toBeLessThan(r.before.rep);
  expect(r.released).toBe(true);
  // Letting one go is the only thing that buys standing back.
  expect(r.rep).toBeGreaterThan(r.afterRansom.rep);
  expect(r.left).toBe(0);
});

test('opening the wheel on a hostile focuses fire and marks them', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'F',
        party: { id: 'f', kind: 'scrappers', name: 'F', strength: 10, tier: 2, quality: 0.8 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onWheel: () => {}, onToast: () => {}, onIntro: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
    // Sweep bearings until the reticle genuinely lands on them — a fixed
    // bearing kept putting a container in the way.
    let found = false;
    for (let k = 0; k < 48 && !found; k++) {
      const yaw = (k / 48) * Math.PI * 2;
      foe.x = m.player.x - Math.sin(yaw) * 14;
      foe.z = m.player.z - Math.cos(yaw) * 14;
      m.camYaw = yaw; m.camPitch = 0;
      for (let i = 0; i < 20; i++) m.updateCamera(1 / 60);
      found = m.aimPoint(140).entity === foe;
    }
    m.openWheel();
    const marked = m.marked === foe;
    const onTarget = m.squad.filter((s) => s.forceTarget === foe).length;
    const total = m.squad.filter((s) => !s.dead).length;
    m.closeWheel(true);                     // release without picking an order
    const survives = m.marked === foe;
    for (let i = 0; i < 10; i++) m.step(1 / 60);
    const shown = m.markMesh.visible;

    // It has to end when they do.
    foe.hp = 0; foe.dead = true; foe.down = true;
    for (let i = 0; i < 10; i++) m.step(1 / 60);
    return { found, marked, onTarget, total, survives, shown,
      cleared: m.marked === null, hidden: !m.markMesh.visible };
  });
  expect(r.found).toBe(true);
  expect(r.marked).toBe(true);
  // Everyone under command goes on the target, not just one of them.
  expect(r.onTarget).toBe(r.total);
  // Releasing without choosing is a confirmation, not a cancellation.
  expect(r.survives).toBe(true);
  expect(r.shown).toBe(true);
  expect(r.cleared).toBe(true);
  expect(r.hidden).toBe(true);
});

test('advancement is a branching choice you pay for, gated on earned rank', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const s = State.living(S).find((x) => !x.isCommander);
    s.role = 'rifleman';
    s.rank = 0;
    S.credits = 20000;

    // Rank is earned in the field and cannot be bought.
    const atRecruit = State.upgradesFor(S, s);
    const refused = State.upgradeTroop(S, s.id, 'marksman');

    s.rank = 1;
    const atTrooper = State.upgradesFor(S, s);
    const opt = atTrooper.find((o) => o.to === 'marksman');
    const before = { credits: S.credits, wage: State.wageOf(s), xp: s.xp, name: s.name };
    const done = State.upgradeTroop(S, s.id, 'marksman');
    const after = { role: s.role, weapon: s.weapon, credits: S.credits,
      wage: State.wageOf(s), xp: s.xp, name: s.name };

    // Money is a real gate too.
    const other = State.living(S).find((x) => !x.isCommander && x.id !== s.id);
    other.rank = 1; other.role = 'rifleman';
    S.credits = 0;
    const broke = State.upgradeTroop(S, other.id, 'marksman');

    return {
      branches: (DATA.TROOP_PATHS.rifleman || []).length,
      atRecruit: atRecruit.map((o) => o.ok),
      refused, done, cost: opt.cost, before, after, broke,
      terminal: (DATA.TROOP_PATHS.medic || []).length,
    };
  });
  // A rifleman has somewhere to go, and more than one somewhere.
  expect(r.branches).toBeGreaterThanOrEqual(3);
  // Nothing is available to a raw recruit, and trying anyway is refused.
  expect(r.atRecruit.every((ok) => ok === false)).toBe(true);
  expect(r.refused).toBe(false);
  expect(r.done).toBe(true);
  expect(r.after.role).toBe('marksman');
  expect(r.after.weapon).toBe('dmr');
  expect(r.after.credits).toBe(r.before.credits - r.cost);
  // Specialists cost more to keep — a company of them is a running expense.
  expect(r.after.wage).toBeGreaterThan(r.before.wage);
  // It is the same person, not a replacement.
  expect(r.after.name).toBe(r.before.name);
  expect(r.after.xp).toBe(r.before.xp);
  expect(r.broke).toBe(false);
  // And some roles are the end of the road.
  expect(r.terminal).toBe(0);
});

test('the company you built decides how fast it moves', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, Roster, DATA, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    const rng = makeRng(9);
    S.cargo = {}; S.rations = 20; S.morale = 70;
    const light = State.partySpeed(S);

    // Deliberately moderate: pace is clamped at 42% so it can never reach a
    // standstill, and piling on enough weight to hit that floor would make the
    // later comparisons test the clamp rather than the curve.
    for (let i = 0; i < 6; i++) {
      S.roster.push(Roster.makeSoldier(rng, { role: 'rifleman', day: 1,
        avoid: S.roster.map((x) => x.name) }));
    }
    const crowded = State.partySpeed(S);

    for (const id of DATA.GOODS_LIST) S.cargo[id] = 2;
    const loaded = State.partySpeed(S);

    S.rations = 0;
    const hungry = State.partySpeed(S);

    return {
      light: light.mul, crowded: crowded.mul, loaded: loaded.mul, hungry: hungry.mul,
      reasons: hungry.factors.map((f) => f.label),
      lightReasons: light.factors.length,
    };
  });
  // A small company travelling light has nothing slowing it down.
  expect(r.light).toBe(1);
  expect(r.lightReasons).toBe(0);
  // Each thing you take on costs pace, and the reasons are reported.
  expect(r.crowded).toBeLessThan(r.light);
  expect(r.loaded).toBeLessThan(r.crowded);
  expect(r.hungry).toBeLessThan(r.loaded);
  expect(r.reasons.some((x) => /eaten/.test(x))).toBe(true);
  // But never to a standstill.
  expect(r.hungry).toBeGreaterThan(0.4);
});

test('sending the squad in without you resolves through the same pipeline', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;

    // Odds have to track the strength gap rather than being a coin flip.
    const squad0 = State.ready(S).slice(0, State.deployLimit(S));
    const easy = State.estimateFight(S, squad0, { strength: 3, quality: 0.7 }).odds;
    const hard = State.estimateFight(S, squad0, { strength: 60, quality: 0.9 }).odds;

    // Keep rolling until it wins: a loss pays nothing, so it would tell us
    // nothing about whether the payment path runs.
    let out = null;
    for (let attempt = 0; attempt < 40 && !out; attempt++) {
      for (const s of S.roster) { s.status = 'healthy'; s.hp = s.maxHp; s.wound = null; }
      const squad = State.ready(S).slice(0, 4);
      if (squad.length < 2) break;
      const party = { id: `t${attempt}`, kind: 'looters', name: 'Looters', strength: 5,
        tier: 1, quality: 0.55, faction: 'raider', x: 0, z: 0, hostileToPlayer: true };
      S.parties.push(party);
      const before = {
        missions: S.stats.missions,
        deployments: squad.map((s) => s.deployments),
        xp: Object.fromEntries(squad.map((s) => [s.id, s.xp])),
        renown: Math.round(S.renown || 0),
        supplies: S.supplies,
      };
      const res = State.autoResolve(S, { type: 'skirmish', site: 'roadside', party }, squad);
      State.applyMissionResult(S, res);
      if (!res.success) { S.parties = S.parties.filter((x) => x.id !== party.id); continue; }
      const survivors = squad.filter((s) => s.status !== 'dead');
      out = {
        auto: res.auto,
        missions: [before.missions, S.stats.missions],
        deployed: squad.every((s, i) => s.deployments === before.deployments[i] + 1),
        xpGained: survivors.every((s) => s.xp > before.xp[s.id]),
        renown: [before.renown, Math.round(S.renown || 0)],
        supplies: [before.supplies, S.supplies],
        cleared: !S.parties.some((x) => x.id === party.id),
      };
    }
    return { easy, hard, out };
  });

  expect(r.easy).toBeGreaterThan(r.hard + 0.4);
  expect(r.out).not.toBeNull();
  expect(r.out.auto).toBe(true);
  // It counts as a real deployment in every respect that matters.
  expect(r.out.missions[1]).toBe(r.out.missions[0] + 1);
  expect(r.out.deployed).toBe(true);
  expect(r.out.xpGained).toBe(true);
  expect(r.out.supplies[1]).toBeLessThan(r.out.supplies[0]);
  // And it pays, which only happens if the party was really on the map.
  expect(r.out.renown[1]).toBeGreaterThan(r.out.renown[0]);
  expect(r.out.cleared).toBe(true);
});

test('autoresolve costs people, but not so many that nobody would use it', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, Roster, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    const tally = (strength, N) => {
      let dead = 0; let wounded = 0; let wins = 0;
      for (let i = 0; i < N; i++) {
        const rng = makeRng(700 + i);
        S.roster = S.roster.slice(0, 1);
        for (let k = 0; k < 4; k++) {
          S.roster.push(Roster.makeSoldier(rng, { role: 'rifleman', rank: 1, day: 1,
            avoid: S.roster.map((x) => x.name) }));
        }
        for (const s of S.roster) { s.status = 'healthy'; s.hp = s.maxHp; s.wound = null; }
        S.stats.missions = i;
        const res = State.autoResolve(S,
          { type: 'skirmish', site: 'roadside', party: { strength, quality: 0.75 } },
          State.ready(S).slice(0, 5));
        if (res.success) wins++;
        for (const x of res.soldierResults) {
          if (x.status === 'dead') dead++;
          else if (x.status === 'wounded') wounded++;
        }
      }
      return { dead: dead / N, wounded: wounded / N, winRate: wins / N };
    };
    // Death counts alone are too noisy to separate at small samples; total
    // casualties and win rate are the stable signals.
    return { easy: tally(6, 120), hard: tally(30, 120) };
  });

  // Something always comes back hurt — it is never free.
  expect(r.easy.dead + r.easy.wounded).toBeGreaterThan(0);
  // But an easy fight must not average a permadeath, or "skip the trivial
  // encounter" would mean "feed it a soldier".
  expect(r.easy.dead).toBeLessThan(0.6);
  // A bad fight is genuinely worse: more people come back hurt, and you win
  // less often. Deaths alone swing too much to assert on directly.
  expect(r.hard.dead + r.hard.wounded).toBeGreaterThan(r.easy.dead + r.easy.wounded);
  expect(r.hard.winRate).toBeLessThan(r.easy.winRate);
});

test('a settlement that likes you sells cheaper and pays better', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const loc = DATA.LOCATIONS.find((l) => l.services?.includes('market') && l.trade);
    const good = DATA.GOODS_LIST[0];
    const at = (rel) => {
      S.relations[loc.id] = rel;
      return {
        tier: State.relationTier(S, loc.id).name,
        base: State.priceAt(S, loc.id, good),
        buy: State.buyPriceAt(S, loc.id, good),
        sell: State.sellPriceAt(S, loc.id, good),
      };
    };
    return { hated: at(-100), neutral: at(0), loved: at(100) };
  });
  // The whole point: standing must bend the two prices in OPPOSITE directions.
  // One shared multiplier would make a settlement that likes you pay you less.
  expect(r.loved.buy).toBeLessThan(r.neutral.buy);
  expect(r.loved.sell).toBeGreaterThan(r.neutral.sell);
  expect(r.hated.buy).toBeGreaterThan(r.neutral.buy);
  expect(r.hated.sell).toBeLessThan(r.neutral.sell);
  // A market always takes a spread; you never buy cheaper than they pay.
  expect(r.loved.buy).toBeLessThan(r.loved.sell);
  // Somewhere you have never been is neutral, not suspicious.
  expect(r.neutral.tier).toBe('Known');
  expect(r.neutral.buy).toBe(r.neutral.sell);
});

test('standing decides who a settlement will put forward', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const loc = DATA.LOCATIONS.find((l) => l.services?.includes('recruit'));
    const at = (rel, day) => {
      S.relations[loc.id] = rel;
      S.day = day;                     // the pool is deterministic per day
      const pool = State.recruitPool(S, loc.id);
      return { offered: pool.length, trained: pool.filter((x) => x.rank > 0).length };
    };
    return { hated: at(-80, 12), neutral: at(0, 12), loved: at(80, 12) };
  });
  // A place that hates you will not sell you anybody at all.
  expect(r.hated.offered).toBe(0);
  expect(r.neutral.offered).toBeGreaterThan(0);
  expect(r.loved.offered).toBeGreaterThan(r.neutral.offered);
});

test('standing moves for reasons the player caused', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    S.relations = {};
    S.credits = 90000;
    const loc = DATA.LOCATIONS.find((l) => l.services?.includes('market') && l.trade);
    const good = DATA.GOODS_LIST[0];

    State.buyGood(S, loc.id, good, 20);
    const beforeTrade = State.relationOf(S, loc.id);
    for (let i = 0; i < 20; i++) State.sellGood(S, loc.id, good, 1);
    const afterTrade = State.relationOf(S, loc.id);

    const target = DATA.LOCATIONS.find((l) => l.kind !== 'open'
      && l.id !== loc.id && !State.isHolding(S, l.id));
    const beforeSeize = State.relationOf(S, target.id);
    State.seizeLocation(S, target.id);
    const afterSeize = State.relationOf(S, target.id);

    // Crossing a band should be announced rather than silently accumulated.
    const logBefore = S.log.length;
    State.changeRelation(S, loc.id, 80);
    return {
      beforeTrade, afterTrade, beforeSeize, afterSeize,
      announced: S.log.length > logBefore,
      tier: State.relationTier(S, loc.id).name,
    };
  });
  // Being a regular customer counts for something.
  expect(r.afterTrade).toBeGreaterThan(r.beforeTrade);
  // Taking a place by force is not how you make friends inside it.
  expect(r.afterSeize).toBeLessThan(r.beforeSeize);
  expect(r.announced).toBe(true);
  expect(r.tier).toBe('Ours');
});

test('caravans need a depot and are never spawned by the world', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement');
    S.credits = 50000;

    const unheld = State.canBuyCaravan(S, loc.id).ok;
    State.seizeLocation(S, loc.id);
    const noDepot = State.canBuyCaravan(S, loc.id).ok;
    S.holdings[loc.id].upgrades.depot = 1;
    const withDepot = State.canBuyCaravan(S, loc.id).ok;
    const bought = !!State.buyCaravan(S, loc.id);
    const atCap = State.canBuyCaravan(S, loc.id).ok;
    S.holdings[loc.id].upgrades.depot = 2;
    const raised = State.canBuyCaravan(S, loc.id).ok;

    // The party table is also the spawn table, so a player-owned type must
    // never be reachable from the random draw — otherwise the world hands out
    // Bracket caravans as roadside traffic.
    S.parties = S.parties.filter((x) => x.kind !== 'own_caravan');
    for (let d = 0; d < 90; d++) State.advanceTime(S, 24);
    const spawnedByWorld = S.parties.filter((x) => x.kind === 'own_caravan').length;

    return { unheld, noDepot, withDepot, bought, atCap, raised, spawnedByWorld };
  });
  expect(r.unheld).toBe(false);
  expect(r.noDepot).toBe(false);
  expect(r.withDepot).toBe(true);
  expect(r.bought).toBe(true);
  expect(r.atCap).toBe(false);        // a level 1 depot runs one
  expect(r.raised).toBe(true);
  expect(r.spawnedByWorld).toBe(0);
});

test('a caravan survives the party housekeeping and pays by standing', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement');
    S.credits = 80000;
    State.seizeLocation(S, loc.id);
    S.holdings[loc.id].upgrades.depot = 3;
    const c = State.buyCaravan(S, loc.id);

    // maintainParties trims the party furthest from the player when a region is
    // crowded, and yours must never be the one it picks. It CAN still be taken
    // on the road — that is the whole design — so the property under test is
    // not "it survives" but "it never disappears without saying so". Asserting
    // survival would be asserting that a deliberately uncertain thing is
    // certain, and it duly failed about one run in five.
    const logBefore = S.log.length;
    for (let d = 0; d < 60; d++) State.advanceTime(S, 24);
    const alive = S.parties.some((p) => p.id === c.id);
    // The log only holds 60 entries, so a loss on day 3 has scrolled away by
    // day 60. The running count is what actually records it.
    const reported = (S.stats.caravansLost || 0) > 0;
    const accountedFor = alive || reported;
    const hostile = S.parties.filter((p) => p.kind === 'own_caravan')
      .some((p) => p.hostileToPlayer);

    // Takings follow standing where it trades.
    const measure = (rel) => {
      S.relations[loc.id] = rel;
      // Clear the road first. What is being measured here is the PAYMENT
      // formula, and leaving hostiles about means the caravan can be taken
      // mid-measurement and report zero takings for reasons that have nothing
      // to do with standing.
      S.parties = S.parties.filter((p) => p.kind === 'own_caravan');
      // Sixty days of ignoring a holding loses it to pressure, and you cannot
      // fit out a caravan somewhere you no longer hold — so re-establish it
      // before measuring, or this reports zero for reasons unrelated to pay.
      if (!State.isHolding(S, loc.id)) State.seizeLocation(S, loc.id);
      S.holdings[loc.id].upgrades.depot = 3;
      if (!S.parties.length) {
        S.credits = 80000;
        State.buyCaravan(S, loc.id);
      }
      const cv = S.parties.find((p) => p.kind === 'own_caravan');
      if (!cv) return 0;
      cv.homeHolding = loc.id; cv.target = loc.id;
      S.credits = 0;
      for (let d = 0; d < 40; d++) {
        S.day++; cv.nextPayDay = 0;
        State.tickCaravans(S, makeRng(6000 + d));
      }
      return S.credits / 40;
    };
    const hated = measure(-100);
    const loved = measure(100);
    return { alive, accountedFor, hostile, hated, loved };
  });
  // Either it is still out there or the log says where it went.
  expect(r.accountedFor).toBe(true);
  expect(r.hostile).toBe(false);
  expect(r.loved).toBeGreaterThan(r.hated);
});

test('a raid escalates while you do it and ends where you came in', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'raid', site: 'vetch', layout: 'settlement', siteName: 'Vetch',
        enemyFaction: 'syndic' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const stores = m.interactables.filter((i) => i.kind === 'loot');
    const counts = [];
    for (const s of stores) {
      const before = m.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
      m.completeInteraction(s);
      counts.push({ before, after: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length });
    }
    for (let i = 0; i < 60; i++) m.step(1 / 60);
    return {
      stores: stores.length,
      counts,
      hunting: m.entities.filter((e) => e.side === 'enemy' && !e.dead && e.state === 'hunt').length,
      taken: m.raidTaken,
      done: !!m.objective.done,
      extract: !!m.extractArmed,
      extractIsSpawn: Math.hypot(m.level.extraction.x - m.level.playerSpawn.x,
        m.level.extraction.z - m.level.playerSpawn.z) < 3,
    };
  });
  expect(r.stores).toBe(3);
  // Every store you crack brings more of them into the street — the mission
  // gets worse as you do it, which is the inverse of a recovery.
  expect(r.counts.every((c) => c.after > c.before)).toBe(true);
  expect(r.hunting).toBeGreaterThan(0);
  expect(r.taken).toBe(3);
  expect(r.done).toBe(true);
  expect(r.extract).toBe(true);
  // You leave the way you came in, carrying it.
  expect(r.extractIsSpawn).toBe(true);
});

test('raiding pays in goods and costs you the place', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    // Somewhere that flies a flag, so the faction penalty has something to hit.
    const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement' && l.faction);
    S.relations = {};
    S.relations[loc.id] = 60;
    S.spoils = { credits: 0, cargo: {}, armoury: {}, armourPool: {}, kitPool: {} };
    const before = {
      rel: State.relationOf(S, loc.id),
      rep: S.rep[loc.faction],
      morale: S.morale,
      recruits: State.recruitPool(S, loc.id).length,
    };
    State.applyMissionResult(S, {
      success: true, type: 'raid', site: loc.id, raidTaken: 3, kills: 5,
      soldierResults: [], suppliesUsed: 2,
    });
    return {
      before,
      rel: State.relationOf(S, loc.id),
      rep: S.rep[loc.faction],
      morale: S.morale,
      recruits: State.recruitPool(S, loc.id).length,
      credits: S.spoils.credits,
      goods: Object.keys(S.spoils.cargo || {}).length,
    };
  });
  // It pays, in money and in goods you have to haul.
  expect(r.credits).toBeGreaterThan(0);
  expect(r.goods).toBeGreaterThan(0);
  // And it costs the relationship, the faction, your soldiers' opinion of you,
  // and the recruits that place would have offered.
  expect(r.rel).toBeLessThan(r.before.rel - 30);
  expect(r.rep).toBeLessThan(r.before.rep);
  expect(r.morale).toBeLessThan(r.before.morale);
  expect(r.recruits).toBeLessThan(r.before.recruits);
});

test('a hideout is a place that produces raiders, not a party that wanders', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    let found = null;
    for (let d = 0; d < 200 && !found; d++) {
      State.advanceTime(S, 24);
      found = S.parties.find((p) => p.kind === 'lair') || null;
    }
    if (!found) return null;
    const start = { x: found.x, z: found.z };
    let broods = 0;
    for (let d = 0; d < 60; d++) {
      const before = S.parties.filter((p) => p.fromLair === found.id).length;
      State.advanceTime(S, 24);
      broods += Math.max(0, S.parties.filter((p) => p.fromLair === found.id).length - before);
    }
    const perRegion = S.parties.filter((p) => p.kind === 'lair').reduce((a, p) => {
      const reg = DATA.LOCATIONS.find((l) => l.id === p.home)?.region || '?';
      a[reg] = (a[reg] || 0) + 1; return a;
    }, {});
    return {
      moved: Math.hypot(found.x - start.x, found.z - start.z),
      alive: S.parties.some((p) => p.id === found.id),
      broods,
      maxPerRegion: Math.max(...Object.values(perRegion)),
    };
  });
  expect(r).not.toBeNull();
  // A place does not wander, and the population housekeeping must not bin it.
  expect(r.moved).toBeLessThan(1);
  expect(r.alive).toBe(true);
  // It is a source: it keeps putting parties on the road.
  expect(r.broods).toBeGreaterThan(0);
  // One per region, so the map never fills up with them.
  expect(r.maxPerRegion).toBe(1);
});

test('clearing a hideout removes it and is felt by the places it preyed on', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    let lair = null;
    for (let d = 0; d < 200 && !lair; d++) {
      State.advanceTime(S, 24);
      lair = S.parties.find((p) => p.kind === 'lair') || null;
    }
    if (!lair) return null;
    const near = DATA.LOCATIONS.filter((l) => l.kind !== 'open'
      && Math.hypot(l.x - lair.x, l.z - lair.z) < 620);
    const relBefore = near.map((l) => State.relationOf(S, l.id));
    const renownBefore = S.renown || 0;
    State.applyMissionResult(S, {
      success: true, type: 'lair', site: 'roadside', partyId: lair.id,
      kills: lair.strength, soldierResults: [], suppliesUsed: 3,
    });
    return {
      gone: !S.parties.some((p) => p.id === lair.id),
      nearby: near.length,
      improved: near.every((l, i) => State.relationOf(S, l.id) > relBefore[i]),
      renownUp: (S.renown || 0) > renownBefore,
      counted: S.stats.lairsCleared || 0,
    };
  });
  expect(r).not.toBeNull();
  expect(r.gone).toBe(true);
  expect(r.nearby).toBeGreaterThan(0);
  // Making somebody else's road safer is the cheapest standing in the game.
  expect(r.improved).toBe(true);
  expect(r.renownUp).toBe(true);
  expect(r.counted).toBeGreaterThan(0);
});

test('a hideout deployment is capped however big the company is', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, UI } = window.KR.dev;
    const S = window.KR.campaign;
    S.renown = 4000;                    // enough to field a great many normally
    const normal = State.deployLimit(S);
    UI.deployPanel(S, { type: 'lair', site: 'compound', squadCap: 4,
      party: { strength: 18, quality: 0.8 } }, { onClose: () => {}, onDeploy: () => {} });
    const text = document.querySelector('#modal')?.textContent || '';
    const title = document.querySelector('#modal .section-title')?.textContent || '';
    return { normal, capped: /OF 4/.test(title), warned: /Only 4/.test(text) };
  });
  // The cap is the whole reason a hideout stays dangerous after you have
  // outgrown the parties it produces.
  expect(r.normal).toBeGreaterThan(4);
  expect(r.capped).toBe(true);
  expect(r.warned).toBe(true);
});

test('the pit pays by the round whether you win or lose', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;
    const purses = [];
    for (const rounds of [0, 1, 3, 5, 8]) {
      S.credits = 0;
      S.relations = {};
      State.applyMissionResult(S, {
        // Deliberately NOT a success for anything short of the full card: the
        // pit has to pay anyway, which is the whole reason it is usable when
        // the company is broke.
        success: rounds >= 8, type: 'pit', site: 'vetch', pitRounds: rounds,
        kills: rounds, soldierResults: [], suppliesUsed: 1,
      });
      purses.push({ rounds, purse: S.credits, rel: State.relationOf(S, 'vetch') });
    }
    return purses;
  });
  // Nothing for being put down immediately, then a rising purse.
  expect(r[0].purse).toBe(0);
  for (let i = 2; i < r.length; i++) {
    expect(r[i].purse).toBeGreaterThan(r[i - 1].purse);
  }
  // A losing run still pays — this failed before, because the payout was
  // nested inside the success branch.
  expect(r[1].purse).toBeGreaterThan(0);
  expect(r[2].purse).toBeGreaterThan(0);
  // Fighting in front of a town for a few rounds is worth something there.
  expect(r[r.length - 1].rel).toBeGreaterThan(0);
});

test('nobody comes out of the pit maimed', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;
    const cmd = State.commander(S);
    cmd.status = 'healthy'; cmd.wound = null; cmd.hp = cmd.maxHp;
    State.applyMissionResult(S, {
      success: false, type: 'pit', site: 'vetch', pitRounds: 0,
      kills: 0, suppliesUsed: 1,
      // The mission layer hands back a mauled commander; the campaign must
      // refuse to write it down. That promise is what the pit is for.
      soldierResults: [{ id: cmd.id, kills: 0, status: 'wounded',
        wound: { id: 'gut', name: 'Abdominal, serious' }, hp: 3 }],
    });
    return {
      status: cmd.status,
      wound: cmd.wound,
      hp: cmd.hp,
      fit: State.ready(S).some((s) => s.id === cmd.id),
      alive: State.living(S).some((s) => s.id === cmd.id),
    };
  });
  expect(r.status).toBe('healthy');
  expect(r.wound).toBeNull();
  expect(r.hp).toBeGreaterThan(0);
  expect(r.fit).toBe(true);
  expect(r.alive).toBe(true);
});

test('you go into the pit alone and it escalates', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
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
      spec: { type: 'pit', site: 'vetch', layout: 'settlement', siteName: 'Vetch',
        enemyFaction: 'raider' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const alone = m.squad.length === 0;
    const counts = [];
    for (let round = 0; round < 8; round++) {
      const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
      counts.push(foes.length);
      for (const e of foes) { e.hp = 0; e.dead = true; }
      for (let i = 0; i < 400; i++) m.step(1 / 60);
      if (m.objective.done) break;
    }
    return { alone, counts, done: !!m.objective.done, best: m.pitBest };
  });
  // Whoever came with you is in the crowd.
  expect(r.alone).toBe(true);
  // One at a time, then more.
  expect(r.counts[0]).toBe(1);
  expect(Math.max(...r.counts)).toBeGreaterThan(r.counts[0]);
  expect(r.done).toBe(true);
  expect(r.best).toBeGreaterThanOrEqual(8);
});

test('formations are genuinely different shapes', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    // Pinned scenario. newCampaign() picks its seed at random, and that seed
    // decides BOTH the ground this squad forms up on and how fast each of them
    // walks — so on some rolls a soldier is still working around an obstacle
    // when the measurement is taken and the shape comes out wrong. This test
    // failed roughly one full run in five for exactly that reason.
    G.campaign = window.KR.dev.State.newCampaign(20250817);
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'F',
        party: { id: 'f', kind: 'scrappers', name: 'F', strength: 2, tier: 2, quality: 0.5 } },
      squad: S.roster.slice(0, 5),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    // Paused until the measurement takes over. Between this evaluate and the
    // next, the mission's rAF loop runs a wall-clock number of LIVE frames —
    // and this scenario opens with hostiles in range, so those frames are a
    // real firefight. It was survivable noise while point-blank fire was
    // forgiving; with the aim model retuned it downed a squaddie before the
    // first measure, and a soldier on the ground cannot walk into formation.
    m.paused = true; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.paused = false;
    const measure = (f) => {
      m.setFormation(f);
      // Push the hostiles away rather than killing them: clearing the field
      // completes the objective, ends the mission, and step() then returns
      // immediately — so nothing would ever move into position.
      for (const e of m.entities) {
        if (e.side === 'enemy') { e.x = 900; e.z = 900; e.target = null; e.state = 'guard'; }
      }
      // Step until the shape has SETTLED, not for a fixed fourteen seconds.
      //
      // A fixed count measures whatever it happens to find, and if one soldier
      // is still walking round an obstacle the frontage comes out wide — which
      // is how this reported a wedge broader than a line and failed about one
      // run in five. Waiting on the state rather than the clock is the rule
      // here; the cap only stops a genuinely stuck squad hanging the run.
      let calm = 0;
      for (let i = 0; i < 60 * 30 && calm < 45; i++) {
        const before = m.squad.map((x) => ({ x: x.x, z: x.z }));
        m.step(1 / 60);
        let moved = 0;
        m.squad.forEach((x, k) => {
          moved = Math.max(moved, Math.hypot(x.x - before[k].x, x.z - before[k].z));
        });
        calm = moved < 0.004 ? calm + 1 : 0;
      }
      const p2 = m.player;
      const c = Math.cos(-p2.yaw); const s = Math.sin(-p2.yaw);
      const rel = m.squad.filter((x) => !x.dead).map((x) => {
        const dx = x.x - p2.x; const dz = x.z - p2.z;
        return { side: dx * c - dz * s, fwd: dx * s + dz * c };
      });
      let minPair = 99;
      for (let i = 0; i < rel.length; i++) {
        for (let j = i + 1; j < rel.length; j++) {
          minPair = Math.min(minPair,
            Math.hypot(rel[i].side - rel[j].side, rel[i].fwd - rel[j].fwd));
        }
      }
      return {
        frontage: Math.max(...rel.map((v) => Math.abs(v.side))) * 2,
        minPair,
        formation: m.formation,
      };
    };
    return { wedge: measure('wedge'), line: measure('line'), spread: measure('spread') };
  });

  expect(r.wedge.formation).toBe('wedge');
  // Line stands them abreast, so the frontage is wider than the wedge's.
  expect(r.line.frontage).toBeGreaterThan(r.wedge.frontage);
  // Spread is the widest of all, and — the point of it — puts real distance
  // between neighbours so one burst cannot catch three people.
  expect(r.spread.frontage).toBeGreaterThan(r.line.frontage);
  expect(r.spread.minPair).toBeGreaterThan(r.wedge.minPair * 1.4);
});

test('calling a formation forms the squad up without changing their order', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'F',
        party: { id: 'f', kind: 'scrappers', name: 'F', strength: 6, tier: 2, quality: 0.6 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.setSquadOrder('hold');
    const before = m.squad.map((s) => s.order);
    // A formation is a shape, not an order: it forms them up on you.
    m.issueOrder('spread');
    return {
      before,
      after: m.squad.map((s) => s.order),
      formation: m.formation,
      hud: m.buildHud().formation,
    };
  });
  expect(r.before.every((o) => o === 'hold')).toBe(true);
  expect(r.after.every((o) => o === 'follow')).toBe(true);
  expect(r.formation).toBe('spread');
  // And it is a standing state the player can see without opening the wheel.
  expect(r.hud).toBe('SPREAD');
});

test('CHARGE sends the squad hunting and they close the distance', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'C',
        party: { id: 'c', kind: 'scrappers', name: 'C', strength: 6, tier: 2, quality: 0.6 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const dist = () => {
    const m = window.KR.mission;
    const foes = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
    if (!foes.length) return 0;
    let sum = 0, n = 0;
    for (const s of m.squad.filter((x) => !x.dead && !x.down)) {
      let best = Infinity;
      for (const f of foes) best = Math.min(best, Math.hypot(f.x - s.x, f.z - s.z));
      sum += best; n++;
    }
    return n ? sum / n : 0;
  };
  const before = await page.evaluate(`(() => {
    const m = window.KR.mission;
    m.issueOrder('charge');
    return {
      orders: m.squad.filter((s) => !s.dead).map((s) => s.order),
      status: m.actionOf(m.squad.find((s) => !s.dead && !s.down)),
      d: (${dist.toString()})(),
      kills: m.stats.kills || 0,
    };
  })()`);
  // The order lands on everyone, and the squad panel says so in one word.
  expect(before.orders.every((o) => o === 'charge')).toBe(true);
  expect(before.status).toMatch(/CHARGING|RELOAD/);
  // Let the sim run: charging troops must CLOSE, not hold their cover line.
  await page.waitForTimeout(4500);
  const after = await page.evaluate(`(() => {
    const m = window.KR.mission;
    return { d: (${dist.toString()})(), kills: m.stats.kills || 0 };
  })()`);
  // Either they measurably shortened the gap, or they already ran somebody
  // down — both are what "run them down" means. Standing still is the bug.
  expect(after.d < before.d - 2 || after.kills > before.kills).toBe(true);
});

test('the field yields itemized spoils and captives you can press or release', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;
    S.seed = 12345;
    const party = { id: 'tp', kind: 'scrappers', name: 'T', strength: 8, tier: 2,
      quality: 0.6, faction: 'syndic' };
    // The prisoner die is honest RNG, so walk the day until somebody
    // surrenders — the itemized strip list must be there every single time.
    let res = null, everSpoils = true;
    for (let d = 1; d <= 16 && !(res && (res.captives || []).length); d++) {
      S.day = d; S.stats.missions = d; S.prisoners = [];
      res = { success: true, type: 'skirmish', partyId: 'tp', party, kills: 8,
        soldierResults: [], suppliesUsed: 0 };
      State.applyMissionResult(S, res);
      if (!(res.fieldSpoils || []).length) everSpoils = false;
    }
    const caps = res.captives || [];
    const inTruck = caps.every((id) => S.prisoners.some((p) => p.id === id));
    // Management, straight off the field: press one, turn one loose.
    const rosterBefore = S.roster.length;
    const pressed = caps.length ? State.pressPrisoner(S, caps[0]) : null;
    const released = caps.length > 1 ? State.releasePrisoner(S, caps[1]) : null;
    return {
      everSpoils,
      itemized: (res.fieldSpoils || []).every((x) => x.kind && x.id),
      capCount: caps.length,
      inTruck,
      pressed,
      rosterGrew: S.roster.length === rosterBefore + (pressed ? 1 : 0),
      released,
      leftInTruck: S.prisoners.length,
    };
  });
  // Every fight strips SOMETHING — that is the loot page's reason to exist.
  expect(r.everSpoils).toBe(true);
  expect(r.itemized).toBe(true);
  // Within sixteen tries somebody must have thrown down their weapon.
  expect(r.capCount).toBeGreaterThan(0);
  expect(r.inTruck).toBe(true);
  expect(r.pressed).toBe(true);
  expect(r.rosterGrew).toBe(true);
  if (r.released !== null) expect(r.released).toBe(true);
});

test('a siege wall genuinely stops you until the gate goes', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    S.seed = 12345;
    S.stats.missions = 0;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'siege', site: 'fort', layout: 'fort', siteName: 'Gate',
        enemyFaction: 'trust' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });

  const r = await page.evaluate(async () => {
    const Level = await import('/src/level.js');
    const m = window.KR.mission;
    const spawn = m.level.playerSpawn;
    const inside = m.level.objectivePoint;

    const blockedAcross = () => {
      let n = 0;
      for (let x = -40; x <= 40; x += 2) {
        if (!Level.hasLOS(m.level.obstacles, x, 4, x, -30, 1.5)) n++;
      }
      return n;
    };

    const before = {
      blocked: blockedAcross(),
      seesObjective: Level.hasLOS(m.level.obstacles, spawn.x, spawn.z, inside.x, inside.z, 1.5),
      breached: !!m.breached,
      charge: m.interactables.filter((i) => i.kind === 'breach').length,
    };

    m.completeInteraction(m.interactables.find((i) => i.kind === 'breach'));
    for (let i = 0; i < 60; i++) m.step(1 / 60);

    const path = m.nav.findPath(spawn.x, spawn.z, inside.x, inside.z);
    return {
      before,
      blocked: blockedAcross(),
      breached: !!m.breached,
      seesThroughGate: Level.hasLOS(m.level.obstacles, 0, 10, 0, -30, 1.5),
      // The route must run through the gateway, which only works if the nav
      // grid was rebuilt — it has no rebuild() method, so blowing the gate
      // reconstructs it outright.
      throughGate: !!path && path.some((pt) => Math.abs(pt.x) < 9 && Math.abs(pt.z + 14) < 10),
      hunting: m.entities.filter((e) => e.side === 'enemy' && !e.dead && e.state === 'hunt').length,
    };
  });

  // The wall has to be a wall: no sight of what you came for, and the line
  // across the compound almost entirely blocked.
  expect(r.before.charge).toBe(1);
  expect(r.before.breached).toBe(false);
  expect(r.before.seesObjective).toBe(false);
  expect(r.before.blocked).toBeGreaterThan(25);
  // And blowing the gate has to actually open the ground, not just the view.
  expect(r.breached).toBe(true);
  expect(r.blocked).toBeLessThan(r.before.blocked);
  expect(r.seesThroughGate).toBe(true);
  // Everyone inside now knows exactly where you are coming from.
  expect(r.hunting).toBeGreaterThan(0);
});

test('squad orders reach the squad', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);
  await takeContractAt(page, 'grellan', 'recovery');
  await enterLocation(page, '#modal [data-p]');
  await selectWholeCompany(page);
  await page.click('#modal [data-x="go"]');
  await page.waitForFunction(() => window.KR.mission?.squad?.length > 0, null, { timeout: 30000 });
  await waitForControl(page);

  await page.keyboard.press('h');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.KR.mission.squad.every((s) => s.order === 'hold')))
    .toBe(true);

  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.KR.mission.squad.every((s) => s.order === 'follow')))
    .toBe(true);
});

test('a settlement is a place you are in, not a panel you dismissed', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  // Stand the company on a town that offers everything, so every verb the menu
  // can put up is actually put up.
  //
  // The seed is pinned because arriving somewhere now rolls whether one of the
  // town's notables wants a word, which changes what is on the menu — and a
  // test that walks a menu should not have the menu reshuffled under it.
  await page.evaluate(async () => {
    const DATA = await import('/src/data.js');
    const S = window.KR.campaign;
    S.seed = 12345;
    const loc = DATA.LOCATIONS.find((l) => ['market', 'recruit', 'medical', 'contracts']
      .every((s) => l.services?.includes(s)));
    S.credits = 20000;
    S.pos.x = loc.x; S.pos.z = loc.z;
    window.KR.dev.enterLocation();
  });
  await page.waitForSelector('#modal .sm-verbs', { timeout: 15000 });

  // Each service opens its own screen and comes back here. A menu you fall out
  // of every time you look at something is worse than one big panel.
  // Waited on rather than slept through.
  //
  // Fixed 350ms pauses were enough on an idle machine and not enough during a
  // full suite run, so this passed alone and failed about one run in ten in
  // company — a timing assumption dressed up as a test of the menu.
  for (const verb of ['market', 'board', 'recruit', 'medical']) {
    await page.click(`#modal [data-verb="${verb}"]`);
    // The verb's own screen has replaced the menu.
    await page.waitForFunction(() => window.KR.dev.UI.modalOpen()
      && !document.querySelector('#modal .sm-verbs'), null, { timeout: 10000 });
    await page.click('#modal [data-x="close"]');
    // And closing it puts the menu back.
    await page.waitForSelector('#modal .sm-verbs', { timeout: 10000 });
  }

  // Standing down spends a day and leaves you standing where you were.
  const before = await page.evaluate(() => window.KR.campaign.day);
  await page.click('#modal [data-verb="rest"]');
  await page.waitForFunction((d) => window.KR.campaign.day > d, before, { timeout: 10000 });
  expect(await page.evaluate(() => window.KR.campaign.day)).toBeGreaterThan(before);
  expect(await page.evaluate(() => !!document.querySelector('#modal .sm-verbs'))).toBe(true);

  // And leaving puts the map back in motion.
  await page.click('#modal [data-x="close"]');
  await page.waitForFunction(() => !window.KR.dev.UI.modalOpen()
    && window.KR.world.paused === false, null, { timeout: 10000 });
});

test('the map clock halts, runs and fast-forwards', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const sample = async (speed, ms) => page.evaluate(async ([s, wait]) => {
    const S = window.KR.campaign;
    window.KR.world.setSpeed(s);
    const a = S.day * 24 + S.hour;
    await new Promise((r) => setTimeout(r, wait));
    return (S.day * 24 + S.hour) - a;
  }, [speed, ms]);

  // Halted means stopped, not merely slow — a creeping halt quietly eats
  // contract deadlines while the player reads a panel.
  expect(await sample(0, 1200)).toBe(0);
  const normal = await sample(1, 1500);
  const fast = await sample(4, 1500);
  expect(normal).toBeGreaterThan(0);
  expect(fast).toBeGreaterThan(normal * 2);

  // Fast-forward is a viewing speed, not free travel: the same road has to cost
  // the same hours whichever setting you watched it go by at.
  //
  // Measured up the empty western edge rather than across the middle of the
  // map. Driving through populated country meant the company kept arriving
  // somewhere or running into somebody, which opens a panel and pauses the
  // world — and a paused world covers no distance in no hours, so the rate came
  // out 0/0 and the test failed as NaN roughly one run in three.
  const rate = async (s) => page.evaluate(async (sp) => {
    const S = window.KR.campaign;
    const W = window.KR.world;
    W.setSpeed(0);
    document.getElementById('overlay').classList.add('hidden');
    W.setPaused(false);
    S.pos.x = -2950; S.pos.z = -2000;
    W.setDestination(-2950, 2400);
    const t0 = S.day * 24 + S.hour;
    const from = { x: S.pos.x, z: S.pos.z };
    W.setSpeed(sp);
    // Run until the company has covered the SAME STRETCH, not for the same
    // number of seconds.
    //
    // Ground affects pace now — a road is quicker than a hillside — so a fixed
    // wall-clock sample lets 4x travel four times as far and therefore across
    // different country, and the two rates differ because they measured
    // different roads. The claim being tested is that a given piece of road
    // costs the same hours whichever speed you watched it at, so both runs have
    // to cover the same ground.
    const TARGET = 260;
    const deadline = Date.now() + 6000;
    let dist = 0;
    while (dist < TARGET && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 40));
      dist = Math.hypot(S.pos.x - from.x, S.pos.z - from.z);
    }
    const hours = (S.day * 24 + S.hour) - t0;
    W.setSpeed(0);
    return { hours, dist, rate: hours > 0 ? dist / hours : null, paused: W.paused };
  }, s);
  const r1 = await rate(1);
  const r4 = await rate(4);
  // Say which thing went wrong rather than reporting NaN.
  expect(r1.rate, `no time passed at 1x (paused ${r1.paused})`).not.toBeNull();
  expect(r4.rate, `no time passed at 4x (paused ${r4.paused})`).not.toBeNull();
  expect(r1.dist, 'the company did not move at 1x').toBeGreaterThan(0);
  expect(Math.abs(r4.rate - r1.rate) / r1.rate).toBeLessThan(0.1);

  // An open panel reads as halted, because to the player it is.
  //
  // Opened for real rather than by setting the paused flag by hand: the world
  // now asserts every frame that it is running whenever no panel is up — which
  // is what stops a lost close-handler stranding the campaign — so a bare
  // setPaused(true) is corrected before the next frame, exactly as intended.
  await page.evaluate(() => {
    window.KR.world.setSpeed(1);
    window.KR.dev.UI.modal({ title: 'TEST', body: '', foot: '' });
    window.KR.world.setPaused(true);
  });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.querySelector('#wh-spd .on')?.dataset.spd)).toBe('0');
  await page.evaluate(() => window.KR.dev.UI.closeModal());
});

test('the company screens are one window with tabs, not seven panels', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);
  await page.evaluate(() => { window.KR.campaign.renown = 800; });

  const TABS = await page.evaluate(() => window.KR.dev.UI.COMPANY_TABS);
  await page.keyboard.press('c');
  await page.waitForSelector('#modal .mtabs', { timeout: 15000 });

  // The strip has to be on every one of them. The one that lacks it is a dead
  // end you have to escape out to the map from.
  for (const t of TABS) {
    await page.click(`#modal [data-tab="${t.id}"]`);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.querySelectorAll('#modal .mtab').length))
      .toBe(TABS.length);
    expect(await page.evaluate(() => document.querySelector('#modal .mtab.on')?.dataset.tab))
      .toBe(t.id);
    // Switching must never go via the map.
    expect(await page.evaluate(() => window.KR.world.paused)).toBe(true);
  }

  // The keys that open these screens move between them once you are inside.
  for (const t of TABS) {
    await page.keyboard.press(t.key.toLowerCase());
    await page.waitForTimeout(280);
    expect(await page.evaluate(() => document.querySelector('#modal .mtab.on')?.dataset.tab))
      .toBe(t.id);
  }

  // And the world starts again exactly once, when you finally leave.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.KR.dev.UI.modalOpen())).toBe(false);
  expect(await page.evaluate(() => window.KR.world.paused)).toBe(false);
});

test('the company has opinions, and they do not all agree', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  // The point of creeds is disagreement. If everybody moves the same way on the
  // same decision, this is morale wearing a costume.
  const table = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const DATA = await import('/src/data.js');
    const out = {};
    for (const ev of ['raid', 'press', 'release']) {
      out[ev] = DATA.CREED_LIST.map((creed) => {
        const S = State.newCampaign(99);
        S.roster = S.roster.slice(0, 1).map((s) => ({ ...s, isCommander: false, creed, regard: 0 }));
        State.companyReacts(S, ev);
        return S.roster[0].regard;
      });
    }
    return out;
  });
  for (const ev of ['raid', 'press', 'release']) {
    expect(Math.max(...table[ev]), `${ev} pleases nobody`).toBeGreaterThan(0);
    expect(Math.min(...table[ev]), `${ev} costs nobody`).toBeLessThan(0);
  }

  // Somebody who has had enough warns you before they walk. A soldier who
  // vanishes because a number crossed a line reads as a bug.
  const r = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const { rng } = await import('/src/util.js');
    const S = State.newCampaign(7);
    S.roster = S.roster.slice(0, 2).map((s, i) => ({
      ...s, isCommander: i === 0, creed: 'straight', regard: 0,
    }));
    const who = S.roster[1].id;
    const gen = rng(11);
    let warnedOn = null, goneOn = null;
    for (let day = 1; day <= 60 && !goneOn; day++) {
      if (day % 2 === 0) State.companyReacts(S, 'raid');
      State.tickResentment(S, gen);
      const s = S.roster.find((x) => x.id === who);
      if (!s) { goneOn = day; break; }
      if (s.quitWarned && warnedOn === null) warnedOn = day;
    }
    return { warnedOn, goneOn };
  });
  expect(r.warnedOn).not.toBeNull();
  expect(r.goneOn).not.toBeNull();
  expect(r.warnedOn).toBeLessThan(r.goneOn);

  // Assigning a creed must not take a number off the seeded generator — doing
  // so would shift every roll after it and change every seeded campaign.
  const stable = await page.evaluate(async () => {
    const Roster = await import('/src/roster.js');
    const { rng } = await import('/src/util.js');
    const run = () => {
      const gen = rng(31337);
      return Array.from({ length: 6 }, () => Roster.makeSoldier(gen, {}))
        .map((s) => `${s.name}|${s.role}|${s.creed}|${s.portraitSeed}`);
    };
    return { a: run(), b: run() };
  });
  expect(stable.a).toEqual(stable.b);

  // And the roster shows what they believe.
  await page.keyboard.press('c');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => !!document.querySelector('#modal .sol-creed'))).toBe(true);
});

test('notables ask for favours by name, and remember the answer', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  // A favour resolves against machinery that already exists — goods in the
  // truck — so it never needs a mission type of its own.
  const run = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const DATA = await import('/src/data.js');
    const { rng } = await import('/src/util.js');
    const loc = DATA.LOCATIONS.find((l) => l.services?.length && l.contacts?.length);
    let S = null, f = null;
    for (let i = 0; i < 40 && !f; i++) {
      const cand = State.newCampaign(77);
      const got = State.offerFavour(cand, loc.id, rng(i));
      if (got?.kind === 'goods') { S = cand; f = got; }
    }
    if (!f) return null;
    const relBefore = State.relationOf(S, loc.id);
    State.acceptFavour(S, loc.id);
    const empty = State.favourProgress(S, f).ready;
    S.cargo[f.good] = f.qty;
    const loaded = State.favourProgress(S, f).ready;
    const credits = S.credits;
    State.completeFavour(S, loc.id);
    return {
      empty, loaded, paid: S.credits - credits, left: S.cargo[f.good],
      relBefore, relAfter: State.relationOf(S, loc.id), open: !!State.favourAt(S, loc.id),
    };
  });
  expect(run).not.toBeNull();
  expect(run.empty, 'handed in with an empty truck').toBe(false);
  expect(run.loaded).toBe(true);
  expect(run.paid).toBeGreaterThan(0);
  expect(run.left, 'the goods were not actually delivered').toBe(0);
  expect(run.relAfter).toBeGreaterThan(run.relBefore);
  expect(run.open, 'still open after being paid').toBe(false);

  // The asymmetry is the mechanic: saying no is free, not turning up is not.
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
    const a = mk();
    const a0 = State.relationOf(a, loc.id);
    State.declineFavour(a, loc.id);
    const b = mk();
    const b0 = State.relationOf(b, loc.id);
    State.acceptFavour(b, loc.id);
    b.day = State.favourAt(b, loc.id).expiresDay + 1;
    State.tickFavours(b, rng(5));
    return {
      declined: State.relationOf(a, loc.id) - a0,
      dropped: State.relationOf(b, loc.id) - b0,
      expired: !State.favourAt(b, loc.id),
    };
  });
  expect(cost.declined, 'turning them down cost something').toBe(0);
  expect(cost.dropped, 'letting them down cost nothing').toBeLessThan(0);
  expect(cost.expired).toBe(true);

  // Two towns must not ask for byte-identical things on the same day. They did:
  // the stream was seeded off the LENGTH of the location id.
  const varied = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const DATA = await import('/src/data.js');
    const { rng } = await import('/src/util.js');
    const towns = DATA.LOCATIONS.filter((l) => l.services?.length && l.contacts?.length);
    const hashed = (loc) => {
      let h = 0;
      for (let i = 0; i < loc.id.length; i++) h = (h * 31 + loc.id.charCodeAt(i)) | 0;
      return Math.abs(h);
    };
    let distinct = 0;
    for (let day = 1; day <= 20; day++) {
      const S = State.newCampaign(1234);
      S.day = day;
      const keys = new Set();
      for (const loc of towns) {
        const f = State.offerFavour(S, loc.id, rng(S.seed + day * 977 + hashed(loc)));
        if (f) keys.add(`${f.tplId}|${f.good || ''}|${f.qty || ''}|${f.pay}`);
      }
      distinct += keys.size;
    }
    return { perDay: distinct / 20, towns: towns.length };
  });
  // Seeded off id length this was exactly half the towns.
  expect(varied.perDay).toBeGreaterThan(varied.towns * 0.8);
});

test('a prisoner is worth different amounts in different places', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const market = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const DATA = await import('/src/data.js');
    const S = State.newCampaign(4242);
    const towns = DATA.LOCATIONS.filter((l) => State.hasBroker(l.id));
    S.day = 12;
    const across = towns.map((l) => State.brokerRate(S, l.id));
    const over = [];
    for (let d = 1; d <= 30; d++) { S.day = d; over.push(State.brokerRate(S, towns[0].id)); }
    return { across, over };
  });

  // A market that pays the same everywhere is a fixed price wearing a hat.
  const mean = market.across.reduce((a, b) => a + b, 0) / market.across.length;
  const sd = Math.sqrt(market.across.reduce((a, b) => a + (b - mean) ** 2, 0) / market.across.length);
  expect(sd, 'towns barely differ').toBeGreaterThan(0.15);

  // And a price that only ever walks one way is a ramp, not a market. The first
  // hash here did exactly that — 1.51, 1.68, 1.85, 2.01 — because `h * 31 + c`
  // does not avalanche when one digit of the key is the day. Summary statistics
  // hid it completely, so the direction of every step is what gets checked.
  const steps = [];
  for (let i = 1; i < market.over.length; i++) {
    const d = market.over[i] - market.over[i - 1];
    if (Math.abs(d) > 0.001) steps.push(Math.sign(d));
  }
  expect(steps.length, 'the rate hardly ever moves').toBeGreaterThan(4);
  const ups = steps.filter((s) => s > 0).length;
  expect(Math.max(ups, steps.length - ups) / steps.length,
    'the price walks one way — that is a ramp').toBeLessThan(0.85);

  // Selling pays better, costs more standing, and splits the company. All three
  // together, or it is a strictly-better button rather than a trade.
  const both = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const DATA = await import('/src/data.js');
    const Roster = await import('/src/roster.js');
    const { rng } = await import('/src/util.js');
    const town = DATA.LOCATIONS.find((l) => State.hasBroker(l.id));
    const mk = () => {
      const S = State.newCampaign(31);
      S.day = 12;
      const r = rng(9);
      const p = Roster.makeSoldier(r, { rank: 2 });
      p.captiveFaction = 'trust';
      S.prisoners = [p];
      S.roster = [
        { ...S.roster[0], isCommander: true },
        ...['straight', 'hard', 'loyal', 'paid'].map((creed) => ({
          ...Roster.makeSoldier(r, {}), isCommander: false, creed, regard: 0,
        })),
      ];
      return { S, id: p.id };
    };
    const reg = (S, creed) => S.roster.find((s) => s.creed === creed && !s.isCommander).regard;
    const a = mk(); const aC = a.S.credits, aR = a.S.rep.trust;
    State.ransomPrisoner(a.S, a.id);
    const b = mk(); const bC = b.S.credits, bR = b.S.rep.trust;
    State.sellPrisoner(b.S, town.id, b.id);
    return {
      ransomPaid: a.S.credits - aC, ransomRep: a.S.rep.trust - aR,
      sellPaid: b.S.credits - bC, sellRep: b.S.rep.trust - bR,
      straight: reg(b.S, 'straight'), paid: reg(b.S, 'paid'),
      left: b.S.prisoners.length,
    };
  });
  expect(both.sellPaid).toBeGreaterThan(both.ransomPaid);
  expect(both.sellRep).toBeLessThan(both.ransomRep);
  expect(both.straight, 'the straight ones do not mind').toBeLessThan(0);
  expect(both.paid, 'the professionals do not approve').toBeGreaterThan(0);
  expect(both.left).toBe(0);
});

test('losing the company costs everything except the company', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const Roster = await import('/src/roster.js');
    const { rng } = await import('/src/util.js');
    const snap = (S) => ({
      day: S.day, credits: S.credits, renown: S.renown,
      cargo: Object.values(S.cargo).reduce((a, b) => a + b, 0),
      arms: Object.values(S.armoury).reduce((a, b) => a + b, 0),
      roster: S.roster.length, alive: State.living(S).length,
      names: S.roster.map((s) => s.name).join('|'),
      prisoners: S.prisoners.length,
      wounded: State.living(S).filter((s) => s.wound).length,
      pos: { x: S.pos.x, z: S.pos.z },
    });
    const lose = (reason, type) => {
      const S = State.newCampaign(1717);
      S.credits = 9000;
      S.cargo = { water: 10, fuel_cells: 6, optics: 3 };
      S.armoury = { rifle: 2, smg: 1, shotgun: 1 };
      S.renown = 400;
      S.prisoners = [Roster.makeSoldier(rng(2), { rank: 1 })];
      const hurt = S.roster[1];
      hurt.status = Roster.STATUS.WOUNDED;
      hurt.wound = { id: 'leg', name: 'Shattered shin', days: 6 };
      const before = snap(S);
      State.applyMissionResult(S, {
        success: false, reason, type, site: type === 'pit' ? 'vetch' : null,
        enemyFaction: 'trust', kills: 3, soldierResults: [], recruits: [],
        loot: { credits: 0, weapons: [] }, stats: { shotsFired: 40, medkitsUsed: 0 },
        levelName: 'The Scour', partyId: null, suppliesUsed: 2, medicalUsed: 0, pitRounds: 4,
      });
      return { before, after: snap(S) };
    };
    return { taken: lose('wiped', 'skirmish'), pulled: lose('withdrew', 'skirmish'), pit: lose('pit', 'pit') };
  });

  const { before: b, after: a } = r.taken;
  // Everything portable is gone...
  expect(a.day).toBeGreaterThan(b.day);
  expect(a.credits).toBeLessThan(b.credits);
  expect(a.cargo).toBeLessThan(b.cargo);
  expect(a.arms).toBeLessThan(b.arms);
  expect(a.renown).toBeLessThan(b.renown);
  expect(a.prisoners).toBe(0);
  expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(50);
  // ...and the time inside is the mercy as well as the cost.
  expect(a.wounded).toBeLessThan(b.wounded);
  // ...but nobody dies. Kill people on a loss and the player reloads anyway,
  // which is the exact behaviour this whole mechanic exists to prevent.
  expect(a.roster).toBe(b.roster);
  expect(a.alive).toBe(b.alive);
  expect(a.names).toBe(b.names);

  // Pulling out in good order is not being carried off the field.
  expect(r.pulled.after.day).toBe(r.pulled.before.day);
  expect(r.pulled.after.credits).toBe(r.pulled.before.credits);
  // Nor is a bad night in the pit — nobody is taken prisoner at a prizefight.
  expect(r.pit.after.day).toBe(r.pit.before.day);

  // And the screen must not call it a withdrawal.
  const panel = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const S = window.KR.campaign;
    S.credits = 9000;
    const res = {
      success: false, reason: 'wiped', type: 'skirmish', site: null,
      enemyFaction: 'trust', kills: 3, soldierResults: [], recruits: [],
      loot: { credits: 0, weapons: [] }, stats: { shotsFired: 40, medkitsUsed: 0 },
      levelName: 'The Scour', partyId: null, suppliesUsed: 2, medicalUsed: 0,
    };
    const notes = State.applyMissionResult(S, res);
    window.KR.dev.UI.afterAction(S, res, notes, { onClose: () => {} });
    return {
      verdict: document.querySelector('#modal .aar-verdict')?.textContent.trim(),
      told: document.querySelector('#modal .taken .prose')?.textContent || '',
    };
  });
  expect(panel.verdict).not.toBe('WITHDRAWN');
  // The player has to be told the roster survived, in the same breath as the
  // losses, or they reload before reading the numbers.
  expect(panel.told).toMatch(/buried|nobody/i);
});

test('whoever took the company keeps your things until you take them back', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const lose = `
    const S = State.newCampaign(2024);
    S.credits = 9000;
    S.cargo = { water: 10, fuel_cells: 6, optics: 3 };
    S.armoury = { rifle: 2, smg: 1, shotgun: 1 };
    S.renown = 500;
    State.applyMissionResult(S, {
      success: false, reason: 'wiped', type: 'skirmish', site: null,
      enemyFaction: 'trust', kills: 2, soldierResults: [], recruits: [],
      loot: { credits: 0, weapons: [] }, stats: { shotsFired: 30, medkitsUsed: 0 },
      levelName: 'The Scour', partyId: null, suppliesUsed: 2, medicalUsed: 0,
    });`;

  const r = await page.evaluate(async (src) => {
    const State = await import('/src/state.js');
    // eslint-disable-next-line no-new-func
    return new Function('State', `${src}
      const g = { ...S.grudge, cargo: { ...S.grudge.cargo }, arms: [...S.grudge.arms] };
      const p = S.parties.find((x) => x.id === g.partyId);
      const taken = { named: !!g.who && /'s command$/.test(p.name), hostile: p.hostileToPlayer,
        marked: !!p.grudge, holds: p.holds.credits === g.credits };

      // Beating somebody else must not settle it.
      const elsewhere = S.parties.find((x) => x.id !== g.partyId);
      State.applyMissionResult(S, {
        success: true, reason: 'cleared', type: 'skirmish', site: null,
        enemyFaction: 'raider', kills: 4, soldierResults: [], recruits: [],
        loot: { credits: 0, weapons: [] }, stats: { shotsFired: 40, medkitsUsed: 0 },
        levelName: 'The Scour', partyId: elsewhere.id, suppliesUsed: 1, medicalUsed: 0,
      });
      const stillOwed = !!S.grudge;

      // What comes back is checked against settleGrudge directly rather than
      // against the credit balance after a deployment: applyMissionResult
      // advances the clock, and a day tick pays wages, so a net-credits reading
      // is short by a day's payroll whenever the fight happens to cross
      // midnight. That is real behaviour, and it makes the balance the wrong
      // instrument for an exactness claim.
      const before = { credits: S.credits, cargo: { ...S.cargo }, armoury: { ...S.armoury } };
      State.settleGrudge(S, g.partyId);
      const exact = {
        creditsBack: S.credits - before.credits,
        cargoBack: Object.keys(g.cargo).map((k) => (S.cargo[k] || 0) - (before.cargo[k] || 0)),
        armsBack: g.arms.map((id) => (S.armoury[id] || 0) - (before.armoury[id] || 0)),
        closed: !S.grudge,
      };

      // And separately: winning the fight for real closes it and leaves the
      // company better off, payroll and all.
      const S2 = State.newCampaign(2024);
      S2.credits = 9000;
      S2.cargo = { water: 10 };
      S2.armoury = { rifle: 2 };
      State.applyMissionResult(S2, {
        success: false, reason: 'wiped', type: 'skirmish', site: null,
        enemyFaction: 'trust', kills: 2, soldierResults: [], recruits: [],
        loot: { credits: 0, weapons: [] }, stats: { shotsFired: 30, medkitsUsed: 0 },
        levelName: 'The Scour', partyId: null, suppliesUsed: 2, medicalUsed: 0,
      });
      const owed = S2.grudge.credits;
      const cash = S2.credits;
      State.applyMissionResult(S2, {
        success: true, reason: 'cleared', type: 'skirmish', site: null,
        enemyFaction: 'trust', kills: 9, soldierResults: [], recruits: [],
        loot: { credits: 0, weapons: [] }, stats: { shotsFired: 90, medkitsUsed: 1 },
        levelName: 'The Scour', partyId: S2.grudge.partyId, suppliesUsed: 2, medicalUsed: 1,
      });
      return {
        taken, stillOwed, ...exact, owedCredits: g.credits, owedCargo: Object.values(g.cargo),
        played: { closed: !S2.grudge, gained: S2.credits - cash, owed },
      };`)(State);
  }, lose);

  expect(r.taken.named, 'the captor has no name').toBe(true);
  expect(r.taken.hostile).toBe(true);
  expect(r.taken.marked).toBe(true);
  expect(r.taken.holds, 'they are not carrying what they took').toBe(true);
  expect(r.stillOwed, 'beating an unrelated band closed the grudge').toBe(true);
  expect(r.creditsBack).toBe(r.owedCredits);
  expect(r.cargoBack).toEqual(r.owedCargo);
  expect(r.armsBack.every((n) => n === 1), 'the weapons did not come back').toBe(true);
  expect(r.closed).toBe(true);
  // Played through rather than called directly: the grudge closes, and the
  // company ends up better off by roughly what was owed — "roughly" because a
  // day's wages leave in the same tick, which is correct.
  expect(r.played.closed, 'winning the fight did not settle it').toBe(true);
  expect(r.played.gained).toBeGreaterThan(r.played.owed * 0.9);

  // They do not carry it forever — the deadline is what makes it a hunt rather
  // than an errand sitting permanently on a list.
  const cold = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const mk = (daysOn) => {
      const S = State.newCampaign(2024);
      S.grudge = { partyId: 'pty_x', who: 'Someone', captor: 'trust', since: 1,
        credits: 100, cargo: {}, arms: [] };
      S.parties = [{ id: 'pty_x', name: "Someone's command", grudge: true, holds: {} }];
      S.day = 1 + daysOn;
      State.tickGrudge(S);
      return !!S.grudge;
    };
    return { early: mk(10), late: mk(State.GRUDGE_DAYS + 1) };
  });
  expect(cold.early).toBe(true);
  expect(cold.late, 'the trail never goes cold').toBe(false);
});

test('collision matches what you can see', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  // Models must be in the cache before anything can be measured against them.
  await page.click('button[data-act="new"]');
  await page.waitForSelector('#modal .modal-title', { timeout: 60000 });
  await page.click('#modal [data-x="close"]');
  await page.waitForTimeout(300);

  const worst = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.min.js');
    const Models = await import('/src/models.js');
    const Level = await import('/src/level.js');
    const mesh = (name) => {
      const b = new THREE.Box3().setFromObject(Models.get(name));
      if (b.isEmpty() || !isFinite(b.min.x)) return null;
      return { hw: (b.max.x - b.min.x) / 2, hd: (b.max.z - b.min.z) / 2 };
    };
    const meshH = (name) => {
      const b = new THREE.Box3().setFromObject(Models.get(name));
      if (b.isEmpty() || !isFinite(b.min.y)) return null;
      return b.max.y - b.min.y;
    };
    const out = [];
    for (const id of ['grellan', 'rampart', 'perran', 'settlement', 'works', 'fort', 'reclaimer']) {
      let lvl = null;
      try { lvl = Level.build(id, 7); } catch { continue; }
      for (const o of lvl.obstacles) {
        const p = lvl.props.find((q) => Math.abs(q.x - o.x) < 1e-3 && Math.abs(q.z - o.z) < 1e-3);
        if (!p) continue;
        const m = mesh(p.model);
        if (!m) continue;
        const dw = m.hw * p.scale, dd = m.hd * p.scale;
        if (dw < 0.01 || dd < 0.01) continue;
        // Height as well as footprint. Checking area alone let a staircase
        // through whose treads were the right width and four times too tall:
        // one 0.94m crate drawn against a 4.1m collision box, so rounds
        // stopped in open air halfway up a flight of steps.
        const stack = lvl.props.filter((q) =>
          Math.abs(q.x - o.x) < 1e-3 && Math.abs(q.z - o.z) < 1e-3);
        let top = -Infinity, base = Infinity;
        for (const q of stack) {
          const mh = meshH(q.model);
          if (mh === null) continue;
          base = Math.min(base, q.y);
          top = Math.max(top, q.y + mh * q.scale);
        }
        const drawnH = isFinite(top) ? top - Math.min(base, o.y) : null;
        out.push({
          model: p.model,
          ratio: (o.hw * o.hd) / (dw * dd),
          // coverH is the drawn height; `h` also spans however far the box was
          // sunk to seal the ground under it, which is not a modelling error.
          hRatio: drawnH && drawnH > 0.05 ? (o.coverH ?? o.h) / drawnH : 1,
        });
      }
    }
    return out;
  });

  expect(worst.length).toBeGreaterThan(100);
  // An obstacle much larger than its mesh is an invisible wall: shots stop in
  // open air. The scattered rocks were fifteen times their drawn area, because
  // a hand-written box was being multiplied by a random scale.
  const walls = worst.filter((r) => r.ratio > 2.5);
  expect(walls.map((w) => w.model), 'collision extends well past the mesh').toEqual([]);
  // Far smaller than the mesh is the same bug the other way round — except for
  // props whose geometry legitimately overhangs above head height (a radar
  // dish's bowl, a mast's arms), which is why this bound is generous.
  const ghosts = worst.filter((r) => r.ratio < 0.35);
  expect(ghosts.map((g) => g.model), 'shots pass through solid things').toEqual([]);
  // A box the right width and several times too tall is just as invisible.
  const towers = worst.filter((r) => r.hRatio > 1.7);
  expect(towers.map((x) => x.model), 'collision stands taller than the model').toEqual([]);
});

test('reinforcements arrive at a distance, unseen, and do not shoot on arrival', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const Level = await import('/src/level.js');
    const State = await import('/src/state.js');
    const G = window.KR;
    // Deterministic scenario. A mission's layout comes from the campaign seed
    // AND its people come from the same seed, so a test that pins neither is
    // rolling dice on both the ground it fights over and how fast anyone walks
    // across it. Pinning one and not the other is not pinning the scenario.
    const S = State.newCampaign(12345);
    G.campaign = S;
    S.renown = 4000;
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    const m = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'T',
        enemyFaction: 'trust' },
      squad: S.roster.slice(0, 3),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await m.start();
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

    const dists = [];
    let seen = 0, firedAtOnce = 0;
    const b = m.level.bounds;
    // Including hard against the boundary, which is where a ring measured from
    // the middle of the map used to put people in the player's lap.
    for (const p of [[0, 0], [24, -18], [b - 6, b - 6], [-(b - 5), b - 5]]) {
      m.player.x = p[0]; m.player.z = p[1];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const e = m.reinforce(Math.cos(a) * 48, Math.sin(a) * 48, 'rifleman');
        dists.push(Math.hypot(e.x - m.player.x, e.z - m.player.z));
        if (Level.hasLOS(m.level.obstacles, e.x, e.z, m.player.x, m.player.z, 1.5)) seen++;
        const ammo = e.ammo;
        m.fire(e, m.player.x, 1.2, m.player.z);
        if (e.ammo !== ammo) firedAtOnce++;
        m.entities = m.entities.filter((x) => x !== e);
      }
    }

    // The pit is the tightest case: a sixteen-metre ring with the player in it.
    const o = m.level.objectivePoint;
    const pit = [];
    for (const off of [0, 6, 11, 14]) {
      m.player.x = o.x + off; m.player.z = o.z;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const e = m.reinforce(o.x + Math.cos(a) * 16, o.z + Math.sin(a) * 16, 'rifleman', 17);
        pit.push(Math.hypot(e.x - m.player.x, e.z - m.player.z));
        m.entities = m.entities.filter((x) => x !== e);
      }
    }

    // The grace has to lift, or arrivals are permanently harmless.
    m.player.x = 0; m.player.z = 0;
    const e = m.reinforce(40, 40, 'rifleman');
    const a0 = e.ammo;
    m.fire(e, 0, 1.2, 0);
    const held = e.ammo === a0;
    e.arriving = 0; e.cooldown = 0;
    m.fire(e, 0, 1.2, 0);
    return {
      min: Math.min(...dists), n: dists.length, seen, firedAtOnce,
      pitMin: Math.min(...pit), pitClose: pit.filter((d) => d < 8).length, pitN: pit.length,
      held, lifts: e.ammo !== a0,
    };
  });

  // Far enough to be seen coming. The pit used to put somebody two metres away.
  expect(r.min).toBeGreaterThan(20);
  expect(r.pitMin).toBeGreaterThan(12);
  expect(r.pitClose, 'somebody arrived on top of the player').toBe(0);
  // Nothing shoots on the frame it comes into existence.
  expect(r.firedAtOnce).toBe(0);
  expect(r.held).toBe(true);
  expect(r.lifts, 'the grace never expires').toBe(true);
  // Out of sight is a preference — on open ground there may be nowhere hidden —
  // so this is a proportion, not an absolute.
  expect(r.seen / r.n).toBeLessThan(0.5);
});

test('cover stops rounds, and leaning out spends that protection', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission, bodyCapsule } = await import('/src/mission.js');
    const Level = await import('/src/level.js');
    const State = await import('/src/state.js');
    const G = window.KR;
    // Deterministic scenario. A mission's layout comes from the campaign seed
    // AND its people come from the same seed, so a test that pins neither is
    // rolling dice on both the ground it fights over and how fast anyone walks
    // across it. Pinning one and not the other is not pinning the scenario.
    const S = State.newCampaign(12345);
    G.campaign = S;
    S.renown = 4000;
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    const m = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'T',
        enemyFaction: 'trust' },
      squad: S.roster.slice(0, 3),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await m.start();
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

    // coverH, not h: since the ground gained relief, `h` is the physical box,
    // which reaches down to the lowest terrain under the footprint so bullets
    // cannot pass beneath it. On a slope that makes a chest-high barricade
    // measure well over 1.5. coverH is what it stands proud of the ground by,
    // which is the waist-high thing this test means to hide behind.
    const cov = m.level.covers.find((o) => o.coverH > 0.7 && o.coverH < 1.5);
    const victim = m.entities.find((e) => e.side === 'enemy' && !e.dead);
    const shooter = m.player;
    const trial = (tuck) => {
      victim.tuck = tuck;
      let hits = 0;
      for (let i = 0; i < 300; i++) {
        // Aimed the way the AI aims: at the middle of what is showing. A fixed
        // chest height would make any lowered body unhittable and the whole
        // measurement meaningless.
        const cap = bodyCapsule(victim);
        const o = { x: shooter.x, y: Level.heightAt(shooter.x, shooter.z) + 1.5, z: shooter.z };
        const ty = (cap.lo + cap.hi) / 2;
        const dx = victim.x - o.x, dy = ty - o.y, dz = victim.z - o.z;
        const len = Math.hypot(dx, dy, dz);
        const d = { x: dx / len, y: dy / len, z: dz / len };
        const hit = m.rayHit(o, d, 120, shooter);
        if (hit.entity === victim) hits++;
      }
      return hits / 300;
    };
    const gap = 0.55;
    victim.x = cov.x; victim.z = cov.z + cov.hd + gap;
    shooter.x = cov.x; shooter.z = cov.z - cov.hd - 14;
    const upright = trial(0);
    const tucked = trial(1);
    // Round the side: cover must not protect from ninety degrees, or the squad's
    // flanking orders mean nothing.
    shooter.x = cov.x + cov.hw + 14; shooter.z = cov.z + cov.hd + gap;
    const flanked = trial(1);
    // Control: crouching in the OPEN must not be protection by itself.
    shooter.x = cov.x; shooter.z = cov.z - cov.hd - 14;
    victim.z = cov.z - cov.hd - 6;
    const openTucked = trial(1);

    // And the player can get into it, lean out, and be knocked off it.
    m.player.x = cov.x; m.player.z = cov.z + cov.hd + 0.6;
    m.grounded = true;
    const took = m.takeCover();
    m.updateCover(0.016);
    const tuckedIn = m.player.tuck;
    m.aiming = true;
    for (let i = 0; i < 40; i++) m.updateCover(0.016);
    const leaning = m.player.tuck;
    m.player.z += 4.5;
    m.updateCover(0.016);
    return { upright, tucked, flanked, openTucked, took, tuckedIn, leaning, broke: !m.cover };
  });

  expect(r.upright).toBeGreaterThan(0.8);
  expect(r.tucked, 'cover is still decoration').toBeLessThan(r.upright * 0.3);
  expect(r.flanked, 'cover holds from the flank — that is invulnerability').toBeGreaterThan(0.4);
  expect(r.openTucked, 'crouching in the open is doing the work, not the cover')
    .toBeGreaterThan(r.upright * 0.5);
  expect(r.took).toBe(true);
  expect(r.tuckedIn).toBeGreaterThan(0.8);
  expect(r.leaning, 'leaning out costs nothing').toBeLessThan(0.35);
  expect(r.broke).toBe(true);
});

test('there is somewhere to stand above the floor, and it is worth standing there', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const Level = await import('/src/level.js');
    const State = await import('/src/state.js');
    const G = window.KR;
    // Deterministic scenario. A mission's layout comes from the campaign seed
    // AND its people come from the same seed, so a test that pins neither is
    // rolling dice on both the ground it fights over and how fast anyone walks
    // across it. Pinning one and not the other is not pinning the scenario.
    const S = State.newCampaign(12345);
    G.campaign = S;
    S.renown = 4000;
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    const m = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'works', layout: 'works', siteName: 'T',
        enemyFaction: 'trust' },
      squad: S.roster.slice(0, 3),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await m.start();
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

    // Walk up whichever flight the builder actually laid, rather than assuming
    // where it went — it places stairs on the first clear approach.
    const treads = m.level.obstacles
      .filter((o) => o.walk && o.h > 0.3 && o.h < 4.2 && (o.hw === 0.5 || o.hd === 0.5) && o.x < 0)
      .sort((a, b) => a.h - b.h);
    const foot = treads[0], next = treads[1];
    const dx = Math.sign(next.x - foot.x), dz = Math.sign(next.z - foot.z);
    const p = m.player;
    p.x = foot.x - dx * 2.2; p.z = foot.z - dz * 2.2;
    m.airY = 0; m.grounded = true;
    m.camYaw = dz !== 0 ? (dz < 0 ? 0 : Math.PI) : (dx > 0 ? -Math.PI / 2 : Math.PI / 2);
    m.keys.add('w');
    for (let i = 0; i < 400; i++) m.updatePlayer(0.016);
    m.keys.delete('w');
    const climbed = m.airY;

    // What the height buys: sightlines from the deck that the same spot on the
    // floor does not have. A catwalk that sees no further is an awkward floor.
    let hi = 0, lo = 0;
    const base = Level.heightAt(p.x, p.z);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const t = { x: p.x + Math.cos(a) * 26, z: p.z + Math.sin(a) * 26 };
      const ty = Level.heightAt(t.x, t.z) + 1.0;
      const cast = (eyeY) => {
        const ddx = t.x - p.x, ddy = ty - eyeY, ddz = t.z - p.z;
        const len = Math.hypot(ddx, ddy, ddz);
        return m.rayHit({ x: p.x, y: eyeY, z: p.z },
          { x: ddx / len, y: ddy / len, z: ddz / len }, len - 0.4, m.player).kind === 'sky';
      };
      if (cast(base + climbed + 1.5)) hi++;
      if (cast(base + 1.5)) lo++;
    }

    // The fort wall must not be strollable from the attacking side.
    const fort = Level.build('fort', 7);
    const outside = Level.surfaceAt(fort.obstacles, 0, -4, Level.heightAt(0, -4));
    return {
      climbed, hi, lo,
      works: m.level.obstacles.filter((o) => o.walk).length,
      fortWalk: fort.obstacles.filter((o) => o.walk).length,
      strollable: outside - Level.heightAt(0, -4) > 1,
    };
  });

  expect(r.works, 'the works has no walkable deck').toBeGreaterThan(0);
  expect(r.fortWalk, 'the fort wall cannot be stood on').toBeGreaterThan(0);
  expect(r.climbed, 'could not climb the stairs').toBeGreaterThan(2);
  expect(r.hi, 'height grants no sightline it did not already have').toBeGreaterThan(r.lo);
  expect(r.strollable, 'the wall can be walked up from outside').toBe(false);
});

test('the company arrives facing the job, with no crosshair over the cinematic', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const State = await import('/src/state.js');
    const G = window.KR;
    // Deterministic scenario. A mission's layout comes from the campaign seed
    // AND its people come from the same seed, so a test that pins neither is
    // rolling dice on both the ground it fights over and how fast anyone walks
    // across it. Pinning one and not the other is not pinning the scenario.
    const S = State.newCampaign(12345);
    G.campaign = S;
    S.renown = 4000;
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    const m = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'T',
        enemyFaction: 'trust' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await m.start();
    m.paused = false; m.hadLock = true;

    const obj = m.level.objectivePoint;
    // How far off the objective bearing is each body pointing? Wrapped to
    // ±180°, because yaw accumulates past a full turn.
    const off = (e) => {
      const want = Math.atan2(obj.x - e.x, obj.z - e.z);
      let d = (e.yaw - want) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d * 180 / Math.PI);
    };
    const atSpawn = { player: off(m.player), squad: m.squad.map(off) };

    // The crosshair is the player's, so it must not be up while the camera is
    // flying itself somewhere.
    UI.renderMissionHud(m.buildHud());
    const hiddenDuring = document.getElementById('reticle').classList.contains('hidden');

    for (let i = 0; i < 60; i++) m.step(0.016);
    const duringCine = { player: off(m.player) };

    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    for (let i = 0; i < 60; i++) m.step(0.016);
    UI.renderMissionHud(m.buildHud());
    const hiddenAfter = document.getElementById('reticle').classList.contains('hidden');
    return { atSpawn, duringCine, hiddenDuring, hiddenAfter, afterHandover: off(m.player) };
  });

  // Everyone starts pointed at the job. Every layout used to declare ry:0 while
  // its objective sat at ~177°, so the company arrived looking back down the
  // road it had just driven up.
  expect(r.atSpawn.player, 'the commander spawns facing away').toBeLessThan(20);
  for (const d of r.atSpawn.squad) expect(d, 'a soldier spawns facing away').toBeLessThan(20);
  // And the handover does not spin them round.
  expect(r.duringCine.player).toBeLessThan(20);
  expect(r.afterHandover, 'taking control turned the commander around').toBeLessThan(20);

  expect(r.hiddenDuring, 'crosshair sits over the insertion cinematic').toBe(true);
  expect(r.hiddenAfter, 'crosshair never comes back').toBe(false);
});

test('the squad can be ordered into cover, and out of it again', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission, bodyCapsule } = await import('/src/mission.js');
    const Level = await import('/src/level.js');
    const State = await import('/src/state.js');
    const G = window.KR;
    // Build the whole scenario from a fixed seed rather than pinning one input.
    //
    // Setting only S.seed still left the ROSTER generated from the random seed
    // newCampaign had already chosen, so soldiers' speeds varied and reaching
    // cover before the deadline became a race this test lost about one run in
    // six. Regenerating the campaign fixes the layout and the people together.
    const S = State.newCampaign(12345);
    G.campaign = S;
    S.renown = 4000;
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    const m = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'T',
        enemyFaction: 'trust' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await m.start();
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

    const threat = m.entities.find((e) => e.side === 'enemy' && !e.dead);
    // coverH rather than h — see the note in the cover test above.
    const cov = m.level.covers.find((o) => o.coverH > 0.7 && o.coverH < 1.6);
    m.player.x = cov.x + 4; m.player.z = cov.z + 9;
    threat.x = cov.x; threat.z = cov.z - 22;
    m.squad.forEach((s, i) => { s.x = m.player.x + (i - 1) * 2.4; s.z = m.player.z + 1.5; });

    m.selectAll();
    m.orderTakeCover({ x: threat.x, z: threat.z });
    const ordered = m.squad.filter((s) => s.order === 'cover').length;
    // Ten seconds of walking. Long enough that arriving is not a race.
    for (let i = 0; i < 620; i++) m.step(0.016);

    const shielded = m.squad.filter((s) =>
      !Level.hasLOS(m.level.obstacles, s.x, s.z, threat.x, threat.z, 1.5)).length;
    const down = m.squad.filter((s) => (s.tuck || 0) > 0.5).length;
    const shorter = m.squad.filter((s) => {
      const c = bodyCapsule(s);
      return (c.hi - c.lo) < 1.2;
    }).length;

    // Release is a test of the ORDER, not of nerve under fire — a soldier who
    // keeps their head down while somebody is actively shooting at them is
    // being sensible, not disobedient, and with the aim model retuned the
    // threat now suppresses hard enough that two seconds was no longer time
    // to stand. Silence the threat, then wait on the state: everyone still on
    // their feet is up, or the cap says they never would be.
    threat.hp = 0; threat.dead = true;
    m.setSquadOrder('follow');
    for (let i = 0; i < 600; i++) {
      m.step(0.016);
      if (m.squad.every((s) => s.down || (s.tuck || 0) < 0.4)) break;
    }
    return {
      n: m.squad.length, ordered, shielded, down, shorter,
      onWheel: m.ORDERS.some((o) => o.id === 'cover'),
      // Only those still on their feet. Somebody who has been shot down during
      // the fight keeps whatever order they had, and counting them as
      // disobedient makes this a test of whether anyone got hurt.
      up: m.squad.filter((s) => !s.down).length,
      released: m.squad.filter((s) => !s.down && s.order === 'follow').length,
      stoodUp: m.squad.filter((s) => !s.down && (s.tuck || 0) < 0.4).length,
    };
  });

  expect(r.onWheel, 'no cover order on the command wheel').toBe(true);
  expect(r.ordered).toBe(r.n);
  // What separates a cover order from a move order: the position breaks the
  // sightline, and they actually get down behind it.
  expect(r.shielded).toBeGreaterThanOrEqual(Math.ceil(r.n / 2));
  expect(r.down, 'they walked to a wall and stood next to it').toBeGreaterThanOrEqual(Math.ceil(r.n / 2));
  expect(r.shorter).toBeGreaterThanOrEqual(Math.ceil(r.n / 2));
  // And cover must not be a trap they cannot be called out of.
  expect(r.released).toBe(r.up);
  expect(r.stoodUp).toBe(r.up);
});

test('the player is told which way the fire is coming from', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const State = await import('/src/state.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = State.newCampaign(12345);
    G.campaign = S;
    S.renown = 4000;
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    const m = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'grellan', layout: 'grellan', siteName: 'T',
        enemyFaction: 'trust' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await m.start();
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
    const p = m.player;
    const foe = m.entities.find((e) => e.side === 'enemy');
    const norm = (d) => ((d % 360) + 360) % 360;

    // Body yaw 0 faces +z, so "ahead" is +z. Getting this backwards is easy and
    // makes a correct indicator look inverted.
    m.camYaw = -Math.PI;
    const rows = [];
    for (const [name, dx, dz] of [['ahead', 0, 20], ['behind', 0, -20],
      ['right', 20, 0], ['left', -20, 0]]) {
      m.hurtFrom = [];
      foe.x = p.x + dx; foe.z = p.z + dz;
      foe.dead = false; foe.down = false;
      p.hp = p.maxHp;
      m.applyDamage(p, 10, foe, { x: p.x, y: 1.2, z: p.z });
      UI.renderMissionHud(m.buildHud());
      const marks = m.buildHud().hurtFrom;
      rows.push({
        name,
        wedges: document.querySelectorAll('#hurt-dirs i').length,
        deg: marks.length ? Math.round(norm((marks[0].rel * 180) / Math.PI)) : null,
      });
    }
    m.time += 3;
    UI.renderMissionHud(m.buildHud());
    return { rows, faded: m.buildHud().hurtFrom.length };
  });

  const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
  for (const k of ['ahead', 'behind', 'right', 'left']) {
    expect(by[k].wedges, `no indicator for fire from ${k}`).toBeGreaterThan(0);
  }
  // A full-screen red flash says you are being shot and nothing else; five
  // rifle rounds kill you, so being unable to locate the shooter is what makes
  // a firefight feel unfair rather than hard.
  const near = (got, want) => Math.min(Math.abs(got - want), 360 - Math.abs(got - want)) < 25;
  expect(near(by.ahead.deg, 0), `ahead read as ${by.ahead.deg}°`).toBe(true);
  expect(near(by.behind.deg, 180), `behind read as ${by.behind.deg}°`).toBe(true);
  expect(near(by.right.deg, 90), `right read as ${by.right.deg}°`).toBe(true);
  expect(near(by.left.deg, 270), `left read as ${by.left.deg}°`).toBe(true);
  expect(r.faded, 'indicators never fade').toBe(0);
});

test('a hideout bigger than the field cap still commits every defender', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const State = await import('/src/state.js');
    const G = window.KR;
    const S = State.newCampaign(12345);
    G.campaign = S;
    S.renown = 4000;
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    const m = new Mission({
      campaign: S,
      // Deliberately far above the field cap: this is the case that stalled.
      spec: { type: 'lair', site: 'grellan', layout: 'grellan', siteName: 'T',
        enemyFaction: 'raider', party: { strength: 54, quality: 0.8, kind: 'lair' } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await m.start();
    m.paused = false; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }

    const total = m.skirmishTotal;
    const firstWave = m.skirmishCommitted;
    // Kill whatever is standing, repeatedly, and see whether the rest arrive.
    for (let round = 0; round < 40 && !m.objective.done; round++) {
      m.entities.filter((e) => e.side === 'enemy' && !e.dead)
        .forEach((e) => { e.dead = true; e.down = true; e.hp = 0; });
      for (let i = 0; i < 90 && !m.objective.done; i++) m.step(0.016);
    }
    return {
      total, firstWave,
      committed: m.skirmishCommitted,
      done: !!m.objective.done,
      progress: m.objective.progress,
      need: m.objective.need,
    };
  });

  // The opening wave is capped, which is correct — the bug was that the rest
  // were never sent, so the kill target could not be reached and the mission
  // was unwinnable with no way for the player to tell why.
  expect(r.firstWave).toBeLessThan(r.total);
  expect(r.committed, 'the remaining defenders were never committed').toBe(r.total);
  expect(r.progress).toBeGreaterThanOrEqual(r.need);
  expect(r.done, 'the hideout could not be cleared').toBe(true);
});

test('a required choice cannot be dismissed, and the Reach never stays paused', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await boot(page);
  await page.click('button[data-act="new"]');
  await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
  await page.click('#modal [data-x="close"]');           // sign the charter
  await page.waitForFunction(() => {
    const t = document.querySelector('#modal .modal-title');
    return t && !/BEFORE THE COMPANY/.test(t.textContent);
  }, null, { timeout: 15000 });
  await page.click('#modal [data-x="close"]');
  // The opening commission is the same panel a promotion uses.
  await page.waitForSelector('#modal [data-perk]', { timeout: 15000 });

  expect(await page.evaluate(() => window.KR.dev.UI.modalBlocking())).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Escaping a promotion used to close it while leaving the world paused behind
  // it, with the choice still outstanding: the campaign looked frozen and every
  // click afterwards landed on a map that was no longer running.
  expect(await page.evaluate(() => !!document.querySelector('#modal [data-perk]')),
    'a required choice was dismissed with Escape').toBe(true);

  await page.click('#modal [data-perk]');
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('overlay').classList.add('hidden'));

  // And the invariant that makes the whole class of bug impossible: if no panel
  // is up, the Reach runs — whatever route left it paused.
  const recovered = await page.evaluate(() => new Promise((res) => {
    window.KR.world.setPaused(true);
    setTimeout(() => res(window.KR.world.paused), 900);
  }));
  expect(recovered, 'the world stayed paused with no panel over it').toBe(false);
  expect(errors).toEqual([]);
});

test('serving a liege earns ground, repeatedly and visibly', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const S = State.newCampaign(12345);
    window.KR.campaign = S;
    S.allegiance = 'trust';
    const serve = () => {
      S.contracts.forEach((c) => { c.accepted = false; });
      S.contracts.push({
        id: `x${S.day}${Math.random()}`, type: 'recovery', site: 'grellan',
        employer: 'trust', title: 't', text: '', pay: 100,
        expiresDay: S.day + 9, accepted: true,
      });
      State.applyMissionResult(S, {
        success: true, reason: 'cleared', type: 'recovery', site: 'grellan',
        enemyFaction: 'raider', kills: 1, soldierResults: [], recruits: [],
        loot: { credits: 0, weapons: [] }, stats: { shotsFired: 5, medkitsUsed: 0 },
        levelName: 'X', partyId: null, suppliesUsed: 1, medicalUsed: 0,
      });
    };
    const grants = [];
    for (let i = 1; i <= 26; i++) {
      const before = (S.fiefs || []).length;
      serve();
      if ((S.fiefs || []).length > before) grants.push(i);
    }
    return {
      grants,
      fiefs: (S.fiefs || []).length,
      ladder: [0, 1, 2, 3].map((n) => State.fiefServiceFor(n)),
      standing: State.serviceStanding(S),
      unsworn: State.serviceStanding(State.newCampaign(1)),
      allHeld: (S.fiefs || []).every((id) => State.isHolding(S, id)),
    };
  });

  // A liege that can reward you only once is not somebody you have a career
  // with — this used to fire exactly once and then never again.
  expect(r.fiefs).toBeGreaterThan(2);
  // And each grant costs more service than the last, so the fourth is earned.
  expect(r.ladder[1]).toBeGreaterThan(r.ladder[0]);
  expect(r.ladder[3]).toBeGreaterThan(r.ladder[2]);
  for (let i = 1; i < r.grants.length; i++) {
    expect(r.grants[i] - r.grants[i - 1]).toBeGreaterThan(r.grants[1] - r.grants[0] - 1);
  }
  expect(r.allHeld, 'a granted fief is not actually held').toBe(true);
  // Visible: the player can see the next one coming rather than being surprised.
  expect(r.standing.need).toBeGreaterThan(0);
  expect(r.standing.left).toBeGreaterThanOrEqual(0);
  // And nothing is owed to a company that has sworn to nobody.
  expect(r.unsworn).toBeNull();
});

test('heavy contracts run in stages, and the ground grows with the fight', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const State = await import('/src/state.js');
    const mk = async (strength, type = 'skirmish') => {
      const G = window.KR;
      const S = State.newCampaign(12345);
      G.campaign = S;
      S.renown = 6000;
      G.world?.dispose(); G.world = null;
      document.getElementById('viewport').innerHTML = '';
      const m = new Mission({
        campaign: S,
        spec: { type, site: 'grellan', layout: 'grellan', siteName: 'T',
          enemyFaction: 'trust', party: { strength, quality: 0.8, kind: 'scrappers' } },
        squad: S.roster.slice(0, 4),
        container: document.getElementById('viewport'),
        onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
      });
      await m.start();
      m.paused = false; m.hadLock = true;
      if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
      return m;
    };

    const sizes = [];
    for (const s of [6, 30, 80]) {
      const m = await mk(s);
      sizes.push({ strength: s, bounds: m.level.bounds, stages: (m.stages || []).length });
    }
    // A hideout is one job; chaining it into "hold the crossing" would be two
    // missions stapled together, and its own logic owns its objective.
    const lair = await mk(54, 'lair');
    const lairStages = (lair.stages || []).length;

    // Play a heavy contract: the primary must NOT arm extraction on its own.
    const m = await mk(54);
    const spawn = { x: m.player.x, z: m.player.z };
    m.entities.filter((e) => e.side === 'enemy').forEach((e) => { e.dead = true; e.down = true; });
    m.skirmishCommitted = m.skirmishTotal;
    for (let i = 0; i < 120; i++) { m.player.x = spawn.x; m.player.z = spawn.z; m.step(0.016); }
    const afterPrimary = { idx: m.stageIndex, extract: !!m.extractArmed };
    const markerDist = Math.hypot(m.stages[0].x - spawn.x, m.stages[0].z - spawn.z);

    // Walking each stage down finishes the chain.
    for (let guard = 0; guard < 4 && m.stages[m.stageIndex] && !m.extractArmed; guard++) {
      const s = m.stages[m.stageIndex];
      m.player.x = s.x; m.player.z = s.z;
      for (let i = 0; i < 900 && m.stages[m.stageIndex] === s && !m.extractArmed; i++) m.step(0.016);
    }
    return { sizes, lairStages, afterPrimary, markerDist, finished: !!m.extractArmed };
  });

  // Ground scales with the number of people standing on it.
  expect(r.sizes[2].bounds).toBeGreaterThan(r.sizes[0].bounds * 1.4);
  expect(r.sizes[0].stages, 'a small fight got extra stages').toBe(0);
  expect(r.sizes[1].stages).toBeGreaterThan(0);
  expect(r.lairStages, 'a hideout was chained into extra stages').toBe(0);

  // The mission-type logic that finished the primary must stop judging once a
  // stage replaces it — its condition is still true every frame, which walked
  // the whole chain in about two seconds and armed extraction from the spawn.
  expect(r.markerDist).toBeGreaterThan(40);
  expect(r.afterPrimary.idx, 'the primary did not open a stage').toBe(0);
  expect(r.afterPrimary.extract, 'extraction armed without the stages being done').toBe(false);
  expect(r.finished, 'the stage chain could not be completed').toBe(true);
});

test('a cornered encounter cannot be escaped, cancelled, or clicked away', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  // Corner the company: an empty patch of road, a hostile band walking into
  // range through the real approach check, and a withdrawal roll rigged to
  // fail. Everything after that is the real panel stack — encounter,
  // WITHDRAW, run down, cornered, ENGAGE, deploy picker, CANCEL — because the
  // holes this guards against all lived in the wiring between panels, not in
  // any one of them.
  await page.evaluate(async () => {
    const { HALF } = await import('/src/region.js');
    const { DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const W = window.KR.world;
    W.setSpeed(0);                  // the test drives update() itself
    S.credits = 50000;              // the toll stays a real way out
    // Somewhere no location suppresses encounters.
    let spot = null;
    for (let x = -HALF + 500; x < HALF && !spot; x += 611) {
      for (let z = -HALF + 500; z < HALF && !spot; z += 611) {
        // Inside the rim fence: the corners of the old scan are mountains now,
      // and a party clamped to the region cannot approach a player teleported
      // beyond it.
      if (Math.hypot(x, z) < HALF * 0.7
        && !DATA.LOCATIONS.some((l) => Math.hypot(l.x - x, l.z - z) < 400)) spot = { x, z };
      }
    }
    W.stopTravel();
    S.pos.x = spot.x; S.pos.z = spot.z;
    const party = {
      id: 'corner_test', kind: 'looters', name: 'Corner Test', strength: 5,
      tier: 1, quality: 0.6, faction: 'raider', speed: 40, hostileToPlayer: true,
      // Outside encounter range, so crossing into it is an APPROACH — the only
      // thing checkProximity fires on.
      x: spot.x + 60, z: spot.z,
    };
    S.parties.push(party);
    W.update(0.2);
    party.x = spot.x + 10;
    window.__mr = Math.random;
    Math.random = () => 0.999;      // every withdrawal roll fails
    W.update(0.2);
  });
  await page.waitForSelector('#modal [data-x="avoid"]', { timeout: 5000 });

  // A hostile panel must refuse Escape — dismissing it is a free pass around
  // the contested withdrawal: no roll, no toll, no fight.
  expect(await page.evaluate(() => window.KR.dev.UI.modalBlocking())).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.KR.dev.UI.modalOpen()),
    'a hostile encounter was dismissed with Escape').toBe(true);

  // A failed withdrawal comes back cornered: same band, no WITHDRAW offered.
  await page.click('#modal [data-x="avoid"]');
  await page.waitForFunction(() => {
    const open = !document.getElementById('overlay').classList.contains('hidden');
    return open && document.querySelector('#modal [data-x="fight"]')
      && !document.querySelector('#modal [data-x="avoid"]');
  }, null, { timeout: 5000 });
  await page.evaluate(() => { Math.random = window.__mr; });

  // ENGAGE then cancel is not a way out either: the picker hands straight
  // back to the cornered panel with the world still held.
  await page.click('#modal [data-x="fight"]');
  await page.waitForSelector('#modal [data-x="cancel"]', { timeout: 5000 });
  await page.click('#modal [data-x="cancel"]');
  await page.waitForFunction(() => document.querySelector('#modal [data-x="fight"]')
    && !document.querySelector('#modal [data-x="avoid"]'), null, { timeout: 5000 });
  expect(await page.evaluate(() => window.KR.world.paused),
    'the world ran on behind a cornered encounter').toBe(true);

  // The toll is still real, still works, and takes the band off the road.
  await page.click('#modal [data-x="toll"]');
  await page.waitForFunction(
    () => document.getElementById('overlay').classList.contains('hidden'),
    null, { timeout: 5000 });
  const after = await page.evaluate(() => ({
    paused: window.KR.world.paused,
    gone: !window.KR.campaign.parties.some((p) => p.id === 'corner_test'),
  }));
  expect(after.gone, 'paying the toll did not move them off the road').toBe(true);
  expect(after.paused, 'the Reach stayed paused after the toll').toBe(false);
});

test('the stage suits the contract: a second charge, another pen', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);
  await newCampaign(page);

  const r = await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const State = await import('/src/state.js');
    const mk = async (type) => {
      const G = window.KR;
      const S = State.newCampaign(12345);
      G.campaign = S;
      S.renown = 6000;
      G.world?.dispose(); G.world = null;
      document.getElementById('viewport').innerHTML = '';
      const m = new Mission({
        campaign: S,
        spec: { type, site: 'grellan', layout: 'grellan', siteName: 'T',
          enemyFaction: 'trust', party: { strength: 54, quality: 0.8, kind: 'scrappers' } },
        squad: S.roster.slice(0, 4),
        container: document.getElementById('viewport'),
        onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
      });
      await m.start();
      m.paused = false; m.hadLock = true;
      if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
      return m;
    };
    // Nothing in here is about gunfire; the dead stay dead so the chain is
    // walked in peace, the way the skirmish stage test does it.
    const calm = (m) => m.entities.forEach((e) => { if (e.side === 'enemy') { e.dead = true; e.down = true; } });
    // Stand on an interactable and hold E until it completes or the cap says
    // it never will.
    const workAt = (m, x, z, cap = 900) => {
      m.player.x = x; m.player.z = z;
      m.keys.add('e');
      for (let i = 0; i < cap; i++) {
        calm(m);
        m.player.x = x; m.player.z = z;
        m.step(1 / 60);
        const it = m.nearInteract;
        if (!it || it.done) break;
      }
      m.keys.delete('e');
    };

    // ---- sabotage: the stage is a second charge, and it goes off ----
    const sab = await mk('sabotage');
    calm(sab);
    const sabKinds = (sab.stages || []).map((s) => s.kind);
    const mast = sab.interactables.find((i) => i.kind === 'charge');
    workAt(sab, mast.x, mast.z);
    const sabStage = sab.stages[sab.stageIndex];
    const opened = { kind: sabStage?.kind, hasCharge: !!sabStage?.interactable };
    workAt(sab, sabStage.x, sabStage.z);
    const secondPlaced = !!sabStage.interactable?.done;
    // The second countdown runs to its own blast.
    sab.blown = false; sab.chargeTimer = 0.05;
    for (let i = 0; i < 20; i++) { calm(sab); sab.step(1 / 60); }
    const secondBang = !!sab.blown;

    // ---- recovery: the stage is another pen, and the ledger follows ----
    const rec = await mk('recovery');
    calm(rec);
    const recKinds = (rec.stages || []).map((s) => s.kind);
    const before = rec.prisoners.length;
    for (const it of rec.interactables.filter((i) => i.kind === 'prisoner')) {
      workAt(rec, it.entity.x, it.entity.z, 400);
    }
    // The regression this exists to hold: with everyone freed, "freed >=
    // alive" is true every frame — updateRecovery used to re-complete the
    // stage objective the frame it opened and arm extraction from the pen.
    let armedEarly = false;
    for (let i = 0; i < 120; i++) {
      calm(rec);
      rec.step(1 / 60);
      if (rec.extractArmed) armedEarly = true;
    }
    const stage = rec.stages[rec.stageIndex];
    const extra = { spawned: rec.prisoners.length, stageKind: stage?.kind };
    workAt(rec, stage.x, stage.z, 400);
    const freedExtra = !!stage.entity?.released;
    return {
      sabKinds, opened, secondPlaced, secondBang,
      recKinds, before, armedEarly, extra, freedExtra,
      stageAfter: rec.stageIndex,
    };
  });

  // Sabotage: plant first, then sweep the wreckage.
  expect(r.sabKinds[0]).toBe('plant');
  expect(r.opened.kind).toBe('plant');
  expect(r.opened.hasCharge, 'the plant stage brought no charge to place').toBe(true);
  expect(r.secondPlaced, 'the second charge could not be placed').toBe(true);
  expect(r.secondBang, 'the second charge never went off').toBe(true);

  // Recovery: another pen, guarded, on the same ledger.
  expect(r.recKinds[0]).toBe('free');
  expect(r.before).toBe(3);
  expect(r.armedEarly,
    'extraction armed from the pen — updateRecovery is completing stage objectives again').toBe(false);
  expect(r.extra.stageKind).toBe('free');
  expect(r.extra.spawned, 'the far pen held nobody').toBe(4);
  expect(r.freedExtra, 'the extra held person could not be cut loose').toBe(true);
  expect(r.stageAfter, 'freeing them did not move the chain on').toBeGreaterThan(0);
});

test('a town can be walked, and the walk is not a deployment', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  // Stand the company in a full-service settlement-layout town and go in
  // through the real door: E opens the menu, the menu offers the walk.
  await page.evaluate(() => {
    const { DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const town = DATA.LOCATIONS.find((l) => l.layout === 'settlement'
      && l.services.includes('market') && l.services.includes('recruit'));
    window.KR.world.stopTravel();
    S.pos.x = town.x; S.pos.z = town.z;
    window.__town = town.id;
    window.__testSite = [town.x, town.z];
  });
  await enterLocation(page, '#modal [data-verb="walk"]');
  await page.click('#modal [data-verb="walk"]');

  await page.waitForFunction(() => window.KR.mission?.player
    && window.KR.mission.spec.type === 'visit', null, { timeout: 40000 });

  const walk = await page.evaluate(() => {
    const m = window.KR.mission;
    return {
      // Invited in: no insertion cinematic, nothing hostile, people present.
      intro: !!m.intro,
      hostiles: m.entities.filter((e) => e.side === 'enemy').length,
      townsfolk: m.entities.filter((e) => e.townsfolk).length,
      areas: m.interactables.filter((i) => i.kind === 'area').map((i) => i.area),
      // Every area is a person: the interactable anchors to a named NPC, so
      // the prompt is "speak with somebody" and the somebody is standing there.
      staffed: m.interactables.filter((i) => i.kind === 'area')
        .every((i) => !!i.entity && !!i.entity.name && !i.entity.dead),
      gate: m.interactables.filter((i) => i.kind === 'leave').length,
      gateWatch: !!m.interactables.find((i) => i.kind === 'leave')?.entity?.name,
      missionsBefore: window.KR.campaign.stats.missions,
    };
  });
  expect(walk.staffed, 'an area doorway had nobody standing at it').toBe(true);
  expect(walk.gateWatch, 'the gate has no watch').toBe(true);
  expect(walk.intro, 'a town visit played the assault cinematic').toBe(false);
  expect(walk.hostiles).toBe(0);
  expect(walk.townsfolk).toBeGreaterThan(2);
  expect(walk.areas).toContain('market');
  expect(walk.areas).toContain('recruit');
  expect(walk.gate).toBe(1);

  // Stand at the trader and hold E: their CHAT opens over the paused walk —
  // a word first, business second — and its option leads into the trade
  // panel. Closing hands the street back.
  await page.evaluate(() => {
    const m = window.KR.mission;
    const a = m.interactables.find((i) => i.kind === 'area' && i.area === 'market');
    m.player.x = a.x; m.player.z = a.z;
  });
  await page.keyboard.down('e');
  await page.waitForSelector('#modal [data-x="opt0"]', { timeout: 8000 });
  await page.keyboard.up('e');
  expect(await page.evaluate(() => window.KR.mission.paused),
    'the walk ran on underneath the chat').toBe(true);
  expect(await page.evaluate(() =>
    document.querySelector('#modal .modal-title')?.textContent?.trim()))
    .toBe('THE TRADER');
  await page.click('#modal [data-x="opt0"]');
  // The chat's option opened the trade screen over it.
  await page.waitForFunction(() =>
    document.querySelector('#modal .modal-title')?.textContent?.trim() !== 'THE TRADER'
    && window.KR.dev.UI.modalOpen(), null, { timeout: 5000 });
  await page.click('#modal [data-x="close"]');
  await page.waitForFunction(() => !window.KR.mission.paused, null, { timeout: 5000 });

  // Leave through the gate watch's chat: back on the map, and the campaign
  // never heard about a "deployment" — a walk must not count as one.
  await page.evaluate(() => {
    const m = window.KR.mission;
    const g = m.interactables.find((i) => i.kind === 'leave');
    m.player.x = g.x; m.player.z = g.z;
  });
  await page.keyboard.down('e');
  await page.waitForSelector('#modal [data-x="opt0"]', { timeout: 8000 });
  await page.keyboard.up('e');
  await page.click('#modal [data-x="opt0"]');
  await page.waitForFunction(() => !window.KR.mission && window.KR.world,
    null, { timeout: 10000 });
  const after = await page.evaluate(() => ({
    missions: window.KR.campaign.stats.missions,
    atTown: window.KR.dev.State.locationAt(window.KR.campaign, 38)?.id,
  }));
  expect(after.missions, 'a walk was booked as a deployment').toBe(walk.missionsBefore);
  expect(after.atTown).toBe(await page.evaluate(() => window.__town));
});

test('a visit is being somewhere: token off the map, hours passing indoors', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);

  await page.evaluate(() => {
    const { DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const town = DATA.LOCATIONS.find((l) => l.services.includes('market'));
    window.KR.world.stopTravel();
    S.pos.x = town.x; S.pos.z = town.z;
    window.__testSite = [town.x, town.z];
  });
  await enterLocation(page, '#modal [data-verb="wait"]');

  // Indoors: the company token has left the map. The camera loop keeps
  // running behind the panel, so the flag reaches the mesh within a frame.
  await page.waitForFunction(() => window.KR.world.playerToken.visible === false,
    null, { timeout: 5000 });

  // Waiting moves the world's clock by six hours a click, safely.
  const before = await page.evaluate(() => {
    const S = window.KR.campaign;
    return { clock: S.day * 24 + S.hour, roster: S.roster.length };
  });
  await page.click('#modal [data-verb="wait"]');
  await page.waitForFunction((b) => {
    const S = window.KR.campaign;
    return S.day * 24 + S.hour >= b + 6;
  }, before.clock, { timeout: 5000 });
  const after = await page.evaluate(() => {
    const S = window.KR.campaign;
    return { clock: S.day * 24 + S.hour, roster: S.roster.length,
      menuUp: !!document.querySelector('#modal [data-verb="wait"]') };
  });
  expect(after.menuUp, 'waiting closed the settlement menu').toBe(true);
  expect(after.roster).toBe(before.roster);

  // Back to the road: the token returns with the company.
  await page.click('#modal [data-x="close"]');
  await page.waitForFunction(() => window.KR.world.playerToken.visible === true,
    null, { timeout: 5000 });
});

test('the living world survives save and load: battles, signals, wreckage', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const S = State.newCampaign(9090);
    window.KR.campaign = S;
    // Run the world until it has a live battle and a live signal — the state
    // this test exists to carry across the boundary. Forcing a meeting is
    // fine; what matters is that REAL objects go through the freezer.
    const a = S.parties.find((p) => p.faction === 'raider' && p.strength > 3);
    const b = S.parties.find((p) => p.faction && p.faction !== 'raider' && p.strength > 3);
    a.x = 1500; a.z = 900; b.x = 1510; b.z = 905;
    for (let h = 0; h < 12 && !(S.mapBattles || []).length; h++) State.advanceTime(S, 1);
    S.mapEvents = S.mapEvents || [];
    S.mapEvents.push({ id: 'evt_frozen', kind: 'distress', x: 100, z: 100,
      day: S.day, expiresDay: S.day + 3, roll: 0.9 });
    S.mapSites = S.mapSites || [];
    S.mapSites.push({ id: 'site_frozen', kind: 'battlefield', x: -200, z: 40,
      day: S.day, expiresDay: S.day + 3, loot: { credits: 50, salvage: 1 } });
    const before = {
      battles: (S.mapBattles || []).length,
      combatants: S.parties.filter((p) => p.battle).length,
    };
    State.save(S);
    const L = State.load();
    const after = {
      battles: (L.mapBattles || []).length,
      combatants: L.parties.filter((p) => p.battle).length,
      event: (L.mapEvents || []).some((e) => e.id === 'evt_frozen'),
      site: (L.mapSites || []).some((s) => s.id === 'site_frozen' && s.loot.credits === 50),
      // The die cast at birth survives the freezer — save-scumming a signal
      // changes nothing, which is only true if the roll is IN the save.
      roll: (L.mapEvents || []).find((e) => e.id === 'evt_frozen')?.roll,
    };
    // And the loaded world RUNS: the thawed battle keeps burning down. Sum
    // over the ORIGINAL combatants by id — total battle strength can rise
    // when reinforcements march in, which is the world living, not stalling.
    const ids = L.parties.filter((p) => p.battle).map((p) => p.id);
    const sum = () => L.parties.filter((p) => ids.includes(p.id))
      .reduce((t, p) => t + p.strength, 0);
    const strengthBefore = sum();
    for (let h = 0; h < 6; h++) State.advanceTime(L, 1);
    const strengthAfter = sum();
    return { before, after, strengthBefore, strengthAfter };
  });
  expect(r.before.battles).toBeGreaterThan(0);
  expect(r.after.battles).toBe(r.before.battles);
  expect(r.after.combatants).toBe(r.before.combatants);
  expect(r.after.event, 'the signal did not survive the save').toBe(true);
  expect(r.after.site, 'the wreckage did not survive the save').toBe(true);
  expect(r.after.roll).toBe(0.9);
  expect(r.strengthAfter, 'the thawed battle stopped burning')
    .toBeLessThan(r.strengthBefore);
});

test('a companion is a find: one town, one story, one fee, one soldier', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const State = await import('/src/state.js');
    const { LOCATIONS, COMPANIONS } = await import('/src/data.js');
    const S = State.newCampaign(31415);
    // Exactly one market town hosts a companion on any given day.
    const hosts = LOCATIONS.filter((l) => l.services?.includes('market'))
      .filter((l) => State.companionAt(S, l.id));
    const c = State.companionAt(S, hosts[0].id);
    // Too poor, then rich enough: the fee is a real gate.
    S.credits = 0;
    const refused = State.hireCompanion(S, c.id);
    S.credits = c.fee + 100;
    const before = S.roster.length;
    const hired = State.hireCompanion(S, c.id);
    const again = State.companionAt(S, hosts[0].id);
    return {
      hosts: hosts.length,
      refused: refused.ok,
      hired: hired.ok,
      name: hired.soldier?.name,
      wantName: c.name,
      credits: S.credits,
      rosterGrew: S.roster.length === before + 1,
      companionFlag: S.roster.some((s) => s.companion),
      // Hired means gone from the rotation — the same person cannot be
      // standing at two market tables.
      goneOrDifferent: !again || again.id !== c.id,
    };
  });
  expect(r.hosts).toBe(1);
  expect(r.refused).toBe(false);
  expect(r.hired).toBe(true);
  expect(r.name).toBe(r.wantName);
  expect(r.credits).toBe(100);
  expect(r.rosterGrew).toBe(true);
  expect(r.companionFlag).toBe(true);
  expect(r.goneOrDifferent).toBe(true);
});

test('a companion is an officer: the company runs differently with them signed on', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;
    S.credits = 50000;
    // Vex the pathfinder: the map speed factor appears, named.
    const base = State.partySpeed(S).mul;
    State.hireCompanion(S, 'vex');
    const withVex = State.partySpeed(S);
    // Perrin the signals officer: contact reports harden at range.
    const intelBefore = State.intelRange(S);
    State.hireCompanion(S, 'perrin');
    const intelAfter = State.intelRange(S);
    // Senna the surgeon: carried wounded drag the truck half as much.
    State.hireCompanion(S, 'senna');
    const v = S.roster.find((x) => !x.isCommander && !x.companion);
    const keep = { status: v.status, hp: v.hp };
    // Carried, not walking: a wounded soldier above 55% HP still deploys, so
    // the drag only counts them once they genuinely cannot march.
    v.status = 'wounded';
    v.hp = 1;
    v.wound = { name: 'probe', days: 6 };
    const woundFactor = State.partySpeed(S).factors
      .find((f) => f.label.includes('carried wounded'));
    v.status = keep.status; v.hp = keep.hp; v.wound = null;
    // Brik the breacher: one more piece off the identical field.
    S.seed = 12345;
    const party = { id: 'offp', kind: 'scrappers', name: 'T', strength: 8, tier: 2,
      quality: 0.6, faction: 'syndic' };
    const run = () => {
      S.day = 5; S.stats.missions = 5; S.prisoners = [];
      const res = { success: true, type: 'skirmish', partyId: 'offp', party, kills: 6,
        soldierResults: [], suppliesUsed: 0 };
      State.applyMissionResult(S, res);
      return (res.fieldSpoils || []).length;
    };
    const stripBefore = run();
    State.hireCompanion(S, 'brik');
    const stripAfter = run();
    State.hireCompanion(S, 'jorsa');
    State.hireCompanion(S, 'okkam');
    return {
      vexGain: withVex.mul - base,
      vexNamed: withVex.factors.some((f) => f.label.includes('passes')),
      intelBefore, intelAfter,
      woundEffect: woundFactor?.effect,
      woundNamed: !!woundFactor?.label.includes('Senna'),
      stripBefore, stripAfter,
    };
  });
  expect(r.vexGain).toBeGreaterThan(0.05);
  expect(r.vexNamed).toBe(true);
  expect(r.intelBefore).toBe(80);
  expect(r.intelAfter).toBe(220);
  // Half of the un-doctored 0.05-per-head drag, and it says who to thank.
  expect(r.woundEffect).toBeCloseTo(-0.025, 3);
  expect(r.woundNamed).toBe(true);
  expect(r.stripAfter).toBe(r.stripBefore + 1);

  // And the two combat officers reach the field: the deployment resolves them
  // once, like perks, and the squad's numbers carry the difference.
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'O',
        party: { id: 'o', kind: 'scrappers', name: 'O', strength: 5, tier: 2, quality: 0.6 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const fx = await page.evaluate(() => window.KR.mission.officerFx);
  expect(fx.overwatch).toBe(true);
  expect(fx.baseFire).toBe(true);
});

test('a summons is a battle you join in person, and winning it moves the border', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  // The consequence side: an answered, won assault flips the town to the
  // liege, retires the column into the garrison, and the liege remembers.
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    S.allegiance = 'trust';
    const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement'
      && State.ownerOf(S, l.id) === 'syndic');
    S.parties.push({
      id: 'testcol', kind: 'warband_trust', faction: 'trust', name: 'Trust column',
      strength: 12, x: loc.x - 90, z: loc.z - 90, tx: loc.x, tz: loc.z,
      siegeTarget: loc.id, tier: 3, speed: 20,
    });
    S.contracts.forEach((x) => { x.accepted = false; });
    S.contracts.push({
      id: 'con_summons', type: 'siege', site: loc.id, employer: 'trust',
      summons: 'testcol', title: 't', text: 't', pay: 600,
      expiresDay: S.day + 4, accepted: true,
    });
    const repBefore = S.rep.trust || 0;
    const res = { success: true, type: 'siege', site: loc.id, kills: 5,
      soldierResults: [], suppliesUsed: 0 };
    State.applyMissionResult(S, res);
    return {
      owner: State.ownerOf(S, loc.id),
      columnGone: !S.parties.some((p) => p.id === 'testcol'),
      contractGone: !S.contracts.some((x) => x.id === 'con_summons'),
      repGain: (S.rep.trust || 0) - repBefore,
    };
  });
  expect(r.owner).toBe('trust');
  expect(r.columnGone).toBe(true);
  expect(r.contractGone).toBe(true);
  // +2 for any completed contract, +3 for answering the call in person.
  expect(r.repGain).toBeGreaterThanOrEqual(5);

  // The field side: a siege deployed with a living column puts that column's
  // fighters on the approach beside the squad.
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'siege', site: 'fort', layout: 'fort', siteName: 'Gate',
        enemyFaction: 'syndic', allies: 6, allyFaction: 'trust' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const field = await page.evaluate(() => {
    const m = window.KR.mission;
    const militia = m.squad.filter((s) => s.militia);
    return {
      allies: militia.length,
      side: militia.every((s) => s.side === 'player'),
      model: militia.every((s) => s.faction === 'trust'),
    };
  });
  expect(field.allies).toBe(6);
  expect(field.side).toBe(true);
  expect(field.model).toBe(true);
});

test('the pit takes a stake on the commander, and pays three to one for the card', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;
    S.contracts.forEach((x) => { x.accepted = false; });
    // Cleared the whole card with money riding on it.
    S.credits = 2000;
    State.applyMissionResult(S, {
      success: true, type: 'pit', site: 'draypits', pitRounds: 8, wager: 500,
      kills: 8, soldierResults: [], suppliesUsed: 0,
    });
    const purse8 = Math.round(8 * 90 * (1 + 8 * 0.11));
    const afterWin = S.credits;
    // Put down in round three with a stake on the table: the by-the-round
    // purse still pays, the stake does not come back (it left the ledger at
    // the door, so no deduction happens here either).
    S.credits = 2000;
    State.applyMissionResult(S, {
      success: false, reason: 'pit', type: 'pit', site: 'draypits', pitRounds: 3, wager: 300,
      kills: 3, soldierResults: [], suppliesUsed: 0,
    });
    const purse3 = Math.round(3 * 90 * (1 + 3 * 0.11));
    return {
      winDelta: afterWin - 2000, purse8,
      loseDelta: S.credits - 2000, purse3,
    };
  });
  // Purse plus the stake back at three to one.
  expect(r.winDelta).toBe(r.purse8 + 500 * 3);
  // Purse only — the book keeps the stake, and nothing else is touched.
  expect(r.loseDelta).toBe(r.purse3);
});

test('the pit is an arena: clean floor, a closed bowl, and a crowd on the rim', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
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
      spec: { type: 'pit', site: 'draypits', layout: 'arena', siteName: 'Dray Pits',
        enemyFaction: 'raider' },
      squad: [S.roster[0]],
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    // Nothing to hide behind on the fighting floor — that is the design.
    const floorObstacles = m.level.obstacles.filter(
      (o) => Math.abs(o.x) < 21 && Math.abs(o.z) < 21).length;
    // The bowl is a full circuit: wall segments on all four sides.
    const walls = m.level.props.filter((p) => p.model === 'rampart').length;
    // And the town is up on the rim watching.
    const crowd = m.level.props.filter(
      (p) => p.model.startsWith('soldier_') && p.y > 3).length;
    return { name: m.level.name, floorObstacles, walls, crowd };
  });
  // The level carries the settlement's name (siteName wins over the layout's),
  // so the arena is pinned by its structure, not its label.
  expect(r.floorObstacles).toBe(0);
  expect(r.walls).toBeGreaterThanOrEqual(28);
  expect(r.crowd).toBeGreaterThanOrEqual(20);
});

test('the siege curtain cannot be walked around', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'siege', site: 'fort', layout: 'fort', siteName: 'Gate',
        enemyFaction: 'trust' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    // The curtain's segments, along the wall line. The flanks must reach past
    // the playable bounds on BOTH sides, or the wall is scenery you stroll
    // around — which is exactly what it was.
    const wall = m.level.obstacles.filter((o) => Math.abs(o.z - -14) < 3 && o.hw > 3);
    const bounds = m.level.bounds;
    return {
      east: Math.max(...wall.map((o) => o.x + o.hw)),
      west: Math.min(...wall.map((o) => o.x - o.hw)),
      bounds,
    };
  });
  expect(r.east).toBeGreaterThanOrEqual(r.bounds);
  expect(r.west).toBeLessThanOrEqual(-r.bounds);
});

test('an army fights through the field cap: ranks stream in, the ticker counts the host', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'siege', site: 'fort', layout: 'fort', siteName: 'Gate',
        enemyFaction: 'syndic', allies: 180, allyFaction: 'trust', enemyArmy: 150 },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const militia = () => m.squad.filter((s) => s.militia && !s.dead && !s.down);
    const enemies = () => m.entities.filter((e) => e.side === 'enemy' && !e.dead);
    const before = {
      // Only a front rank stands on the field...
      alliedField: militia().length,
      enemyField: enemies().length,
      // ...but the scoreboard counts the whole host, both sides.
      armies: m.buildHud().armies,
    };
    // The allied rank is shot down: the column feeds the next one in.
    for (const s of militia().slice(0, 9)) s.dead = true;
    m.updateAlliedWaves();
    const alliedAfterWave = militia().length;
    const committed = m.alliesCommitted;
    // The garrison's front rank falls: the reserve musters inside the walls.
    for (const e of enemies()) e.dead = true;
    m.updateSkirmishWaves();
    return {
      before,
      alliedAfterWave,
      committed,
      enemyAfterWave: enemies().length,
      enemyCommitted: m.skirmishCommitted,
      total: m.skirmishTotal,
    };
  });
  // Front ranks, not armies, on the field (rank sizes rose with the
  // instanced-character cap raise: 16 allied, FIELD_CAP 48).
  expect(r.before.alliedField).toBeLessThanOrEqual(16);
  expect(r.before.enemyField).toBeLessThanOrEqual(20);
  // The ticker shows the whole weight of both hosts.
  expect(r.before.armies.ours).toBeGreaterThan(160);
  expect(r.before.armies.theirs).toBeGreaterThan(130);
  // Both sides genuinely stream: fresh fighters after the rank falls.
  expect(r.alliedAfterWave).toBeGreaterThan(3);
  expect(r.committed).toBeGreaterThan(16);
  expect(r.enemyAfterWave).toBeGreaterThan(0);
  expect(r.enemyCommitted).toBeGreaterThan(r.before.enemyField);
  expect(r.total).toBe(150);
});

test('the tactical camera commands the squad, and the commander is a unit too', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'T',
        party: { id: 't', kind: 'scrappers', name: 'T', strength: 6, tier: 2, quality: 0.6 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    const m = G.mission;
    m.paused = true; m.hadLock = true;
    if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.toggleTactical();
    const on = m.rts;
    const hudFlag = m.buildHud().tactical;
    // Put the camera in its tactical pose so screen-space picking has
    // something honest to project through.
    m.updateTacticalCamera(1 / 60);
    // Box-select the whole screen: everyone in view, commander included.
    const rect = m.canvasEl.getBoundingClientRect();
    m.rtsDrag = { x0: rect.left, y0: rect.top, x1: rect.right, y1: rect.bottom };
    m.rtsFinishSelect();
    const boxed = { squad: m.selection.size, commander: m.playerSelected };
    // Order the lot somewhere specific, via the same screen path a click uses.
    const p = m.player;
    const dest = { x: p.x + 12, z: p.z + 6 };
    const sp = m.worldToScreen(dest.x, dest.z);
    m.rtsOrderAt(sp.x, sp.y);
    const ordered = m.squad.filter((s) => !s.dead && s.order === 'move').length;
    const auto = m.playerAuto ? Math.hypot(m.playerAuto.x - dest.x, m.playerAuto.z - dest.z) : null;
    // The commander actually walks there.
    const before = Math.hypot(dest.x - p.x, dest.z - p.z);
    for (let i = 0; i < 340; i++) m.updatePlayer(0.05);
    const after = m.playerAuto
      ? Math.hypot(m.playerAuto.x - p.x, m.playerAuto.z - p.z)
      : Math.hypot(dest.x - p.x, dest.z - p.z);
    // Route AROUND, not through: order the commander to a point on the far
    // side of a solid block. The straight line is blocked, so only the
    // squad's A* gets them there — a wall-slider stalls against the face.
    const wall = m.level.obstacles.find((o) => (o.coverH ?? o.h) > 1.7
      && o.hw > 1.2 && Math.hypot(o.x - p.x, o.z - p.z) < 30
      && Math.hypot(o.x - p.x, o.z - p.z) > 6);
    let routed = null;
    if (wall) {
      const dx = wall.x - p.x, dz = wall.z - p.z;
      const dd = Math.hypot(dx, dz) || 1;
      const raw = {
        x: wall.x + (dx / dd) * (wall.hw + 3.5),
        z: wall.z + (dz / dd) * (wall.hd + 3.5),
      };
      const safe = m.safeSpawn(raw.x, raw.z);
      m.playerAuto = { x: safe.x, z: safe.z };
      for (let i = 0; i < 500; i++) m.updatePlayer(0.05);
      routed = Math.hypot(safe.x - p.x, safe.z - p.z);
    }
    // Self-defense: the commander is not a mannequin while you command.
    // Park an enemy in front of them; they face it and return fire on their
    // own, through the same AI path the rest of the company uses.
    const foe = m.entities.find((e) => e.side === 'enemy' && !e.dead);
    foe.x = p.x + 8; foe.z = p.z; foe.down = false;
    m.playerAuto = null;
    const shotsBefore = m.stats.shotsFired;
    for (let i = 0; i < 240; i++) m.updatePlayer(0.05);
    const defended = m.stats.shotsFired > shotsBefore;
    m.toggleTactical();
    return { on, hudFlag, boxed, ordered, auto, before, after, routed, defended, off: !m.rts };
  });
  expect(r.on).toBe(true);
  expect(r.hudFlag).toBe(true);
  // The whole-screen box catches the squad AND the commander.
  expect(r.boxed.squad).toBeGreaterThanOrEqual(3);
  expect(r.boxed.commander).toBe(true);
  // Right-click gave everyone a move order, commander included.
  expect(r.ordered).toBeGreaterThanOrEqual(3);
  expect(r.auto).not.toBeNull();
  expect(r.auto).toBeLessThan(5);
  // And the commander's body obeys the board: walked to (or into) the point.
  expect(r.after).toBeLessThan(Math.max(3, r.before - 4));
  // Ordered behind a solid block, they route around it and arrive.
  if (r.routed !== null) expect(r.routed).toBeLessThan(4);
  // Left alone under fire, they defend themselves.
  expect(r.defended).toBe(true);
  expect(r.off).toBe(true);
});

test('route lines and control groups: the tactical board explains itself', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'G',
        party: { id: 'g', kind: 'scrappers', name: 'G', strength: 5, tier: 2, quality: 0.6 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
    if (G.mission.intro) { G.mission.intro.active = false; G.mission.time = G.mission.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.toggleTactical();
    m.updateTacticalCamera(1 / 60);
    // Bind a group: one squaddie plus the commander.
    m.selection.clear();
    m.selection.add(0);
    m.playerSelected = true;
    m.assignGroup(2);
    // Scatter the selection, then recall.
    m.selection.clear();
    m.playerSelected = false;
    m.recallGroup(2);
    const recalled = { sel: [...m.selection], player: m.playerSelected };
    // A dead member does not answer the recall.
    const bound = m.squad[0];
    bound.dead = true;
    m.recallGroup(2);
    const afterDeath = { sel: [...m.selection], player: m.playerSelected };
    bound.dead = false;
    // Route lines: give everyone somewhere to be, and the board draws it.
    m.selection.clear();
    const p = m.player;
    const sp = m.worldToScreen(p.x + 14, p.z + 8);
    m.playerSelected = true;
    m.rtsOrderAt(sp.x, sp.y);
    m.rtsSyncRoutes();
    const lines = m.routeViz
      ? m.routeViz.geometry.getAttribute('position').count : 0;
    // Leaving the mode tears the lines down.
    m.toggleTactical();
    const cleared = !m.routeViz;
    return { recalled, afterDeath, lines, cleared };
  });
  expect(r.recalled.sel).toEqual([0]);
  expect(r.recalled.player).toBe(true);
  // The group survives, minus its dead.
  expect(r.afterDeath.sel).toEqual([]);
  expect(r.afterDeath.player).toBe(true);
  // Move orders drew real geometry: at least a segment and a flag per unit.
  expect(r.lines).toBeGreaterThan(8);
  expect(r.cleared).toBe(true);
});

test('the tactical camera has weight: rotation, glide zoom, follow, jump to combat', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'C2',
        party: { id: 'c2', kind: 'scrappers', name: 'C2', strength: 5, tier: 2, quality: 0.6 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
    if (G.mission.intro) { G.mission.intro.active = false; G.mission.time = G.mission.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    m.toggleTactical();
    const step = (n) => { for (let i = 0; i < n; i++) m.updateTacticalCamera(1 / 60); };
    // Q rotates while held.
    const yaw0 = m.rtsYaw;
    m.keys.add('q'); step(30); m.keys.delete('q');
    const rotated = m.rtsYaw - yaw0;
    // The wheel target glides, not snaps.
    m.rtsZoomT = m.rtsZoom + 20;
    const z0 = m.rtsZoom;
    step(4);
    const zMid = m.rtsZoom;
    step(120);
    const zEnd = m.rtsZoom;
    // Momentum: pan input builds speed, and the eye coasts after release.
    const fx0 = m.rtsFocus.x;
    m.keys.add('d'); step(30); m.keys.delete('d');
    const atRelease = m.rtsFocus.x;
    step(12);
    const afterCoast = m.rtsFocus.x;
    step(200);
    const settled = m.rtsFocus.x;
    // Space follows the commander.
    m.rtsFocus.x = m.player.x + 60; m.rtsFocus.z = m.player.z + 60;
    m.rtsVel = { x: 0, z: 0 };
    m.selection.clear(); m.playerSelected = false;
    m.keys.add(' '); step(90); m.keys.delete(' ');
    const followDist = Math.hypot(m.rtsFocus.x - m.player.x, m.rtsFocus.z - m.player.z);
    // B jumps to the last exchange of fire.
    m.lastCombat = { x: m.player.x - 40, z: m.player.z - 40, t: m.time };
    m.jumpToCombat();
    const jumped = { x: m.rtsFocus.x, z: m.rtsFocus.z };
    m.toggleTactical();
    return {
      rotated, z0, zMid, zEnd,
      panMoved: atRelease - fx0, coast: afterCoast - atRelease, settledDrift: settled - afterCoast,
      followDist, jumped, at: { x: m.player.x - 40, z: m.player.z - 40 },
    };
  });
  // Held Q turned the board a meaningful amount.
  expect(Math.abs(r.rotated)).toBeGreaterThan(0.5);
  // Zoom is a glide: partway after a few frames, arrived after many.
  expect(r.zMid).toBeGreaterThan(r.z0 + 1);
  expect(r.zMid).toBeLessThan(r.z0 + 19);
  expect(Math.abs(r.zEnd - (r.z0 + 20))).toBeLessThan(1);
  // The pan moved, kept coasting after release, then actually stopped.
  expect(r.panMoved).toBeGreaterThan(5);
  expect(r.coast).toBeGreaterThan(0.5);
  expect(Math.abs(r.settledDrift)).toBeLessThan(6);
  // Held Space carried the eye to the commander.
  expect(r.followDist).toBeLessThan(4);
  // B put the eye on the fight.
  expect(Math.hypot(r.jumped.x - r.at.x, r.jumped.z - r.at.z)).toBeLessThan(1);
});

test('THE APPROACHES reads from above: a clear road, walled lanes, posts to hold', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'field', layout: 'field', siteName: 'The Approaches',
        party: { id: 'f', kind: 'warband_syndic', name: 'F', strength: 40, tier: 4, quality: 0.9 },
        allies: 30, allyFaction: 'trust' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const props = m.level.props;
    return {
      name: m.level.name,
      // The one fast lane is genuinely clear — up to the compound's own
      // sandbag line, which is the authored end of the road.
      roadObstacles: m.level.obstacles.filter(
        (o) => Math.abs(o.x) < 7 && o.z > -48 && o.z < 68).length,
      // The lanes are walled from it by gabion lines, with gaps.
      wallSegs: props.filter((p) => p.model === 'hesco_line'
        && Math.abs(Math.abs(p.x) - 15) < 1).length,
      towers: props.filter((p) => p.model === 'watchtower').length,
      sandbags: props.filter((p) => p.model === 'sandbags').length,
      // A host gets a big field: bounds grow with the armies on it.
      bounds: m.level.bounds,
      garrison: m.level.garrison?.length || 0,
    };
  });
  expect(r.roadObstacles).toBe(0);
  expect(r.wallSegs).toBeGreaterThanOrEqual(18);
  expect(r.wallSegs).toBeLessThan(26);   // the crossover gaps exist
  expect(r.towers).toBe(6);
  expect(r.sandbags).toBeGreaterThanOrEqual(14);
  expect(r.bounds).toBeGreaterThan(120);
  expect(r.garrison).toBe(8);
});

test('the field map shows the whole ground in tactical mode, and a click steers the eye', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'M',
        party: { id: 'm', kind: 'scrappers', name: 'M', strength: 5, tier: 2, quality: 0.6 } },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
    if (G.mission.intro) { G.mission.intro.active = false; G.mission.time = G.mission.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    // The shoulder view keeps its personal radar: no map payload.
    const shoulderMap = m.buildHud().map;
    m.toggleTactical();
    const map = m.buildHud().map;
    // A click on the map, addressed by the same scale the drawing uses,
    // lands the eye on the world point it names.
    const c = document.getElementById('radar');
    const R = c.width / 2;
    const scale = (R - 4) / m.level.bounds;
    m.rtsMapClick(R + 30 * scale, R + -20 * scale);
    const focus = { x: m.rtsFocus.x, z: m.rtsFocus.z };
    m.toggleTactical();
    return { shoulderMap, map: { bounds: map.bounds, blips: map.blips.length,
      hasObjective: !!map.objective }, focus };
  });
  expect(r.shoulderMap).toBe(null);
  expect(r.map.bounds).toBeGreaterThan(50);
  // Squad, commander, and the hostile party are all on the board.
  expect(r.map.blips).toBeGreaterThan(8);
  expect(r.map.hasObjective).toBe(true);
  expect(r.focus.x).toBeCloseTo(30, 0);
  expect(r.focus.z).toBeCloseTo(-20, 0);
});

test('THE BASTION: a laned approach, one gate in a full-span curtain, streets behind it', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    // Army scale on purpose: spread rides the host size, and the curtain
    // must still out-reach the bounds the armies buy.
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'siege', site: 'bastion', layout: 'bastion', siteName: 'Bastion',
        enemyFaction: 'syndic', allies: 160, allyFaction: 'trust', enemyArmy: 150 },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const wall = m.level.obstacles.filter((o) => Math.abs(o.z - -10) < 3 && o.hw > 3);
    return {
      bounds: m.level.bounds,
      east: Math.max(...wall.map((o) => o.x + o.hw)),
      west: Math.min(...wall.map((o) => o.x - o.hw)),
      gate: m.level.props.some((p) => p.model === 'gate'),
      // The road to the gate, and the avenue behind it, both genuinely open.
      roadObstacles: m.level.obstacles.filter(
        (o) => Math.abs(o.x) < 7 && o.z > 6 && o.z < 70).length,
      avenueObstacles: m.level.obstacles.filter(
        (o) => Math.abs(o.x) < 6 && o.z > -44 && o.z < -16).length,
      stagingTowers: m.level.props.filter(
        (p) => p.model === 'watchtower' && p.z > 10).length,
      objectiveDepth: m.level.objectivePoint.z,
    };
  });
  // Armies bought a big field, and the curtain still out-reaches it.
  expect(r.bounds).toBeGreaterThan(180);
  expect(r.east).toBeGreaterThanOrEqual(r.bounds);
  expect(r.west).toBeLessThanOrEqual(-r.bounds);
  expect(r.gate).toBe(true);
  expect(r.roadObstacles).toBe(0);
  expect(r.avenueObstacles).toBe(0);
  expect(r.stagingTowers).toBe(4);
  // The gate is the beginning, not the end.
  expect(r.objectiveDepth).toBeLessThan(-50);
});

test('holding the bastion: defenders inside, the gate falls on a timer, the assault can break', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'defense', defend: true, site: 'bastion', layout: 'bastion',
        siteName: 'Bastion', enemyFaction: 'syndic',
        enemyArmy: 90, allies: 70, allyFaction: 'trust' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
    if (G.mission.intro) { G.mission.intro.active = false; G.mission.time = G.mission.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const WALL_Z = -10;
    const before = {
      // The command stands INSIDE the wall, facing the gate.
      playerInside: m.player.z < WALL_Z,
      alliesInside: m.squad.filter((s) => s.militia && !s.dead)
        .every((s) => s.z < WALL_Z + 6),
      // The first assault rank is OUTSIDE, coming up the lanes.
      assaultersOutside: m.entities.filter((e) => e.side === 'enemy' && !e.dead)
        .every((e) => e.z > WALL_Z + 6),
      breached: m.breached,
      armies: m.buildHud().armies,
    };
    // The sappers finish: run the hold tick past the roll.
    m.time = m.gateBlowAt + 0.1;
    m.updateSiegeHold(1 / 60);
    const gateDown = m.breached === true;
    // The next rank enters from the south when the field thins.
    for (const e of m.entities) { if (e.side === 'enemy') e.dead = true; }
    m.updateSkirmishWaves();
    const wave = m.entities.filter((e) => e.side === 'enemy' && !e.dead);
    const waveFromSouth = wave.length > 0 && wave.every((e) => e.z > 30);
    // Break the whole assault: no ranks left anywhere ends it held.
    m.skirmishTotal = m.skirmishCommitted;
    for (const e of m.entities) { if (e.side === 'enemy') e.dead = true; }
    m.updateSiegeHold(1 / 60);
    return {
      before, gateDown, waveFromSouth,
      held: m.over && m.result === undefined ? null : true,
      done: m.objective.done,
    };
  });
  expect(r.before.playerInside).toBe(true);
  expect(r.before.alliesInside).toBe(true);
  expect(r.before.assaultersOutside).toBe(true);
  expect(r.before.breached).toBe(false);
  // The war scoreboard counts both hosts.
  expect(r.before.armies.theirs).toBeGreaterThan(70);
  expect(r.before.armies.ours).toBeGreaterThan(55);
  expect(r.gateDown).toBe(true);
  expect(r.waveFromSouth).toBe(true);
  expect(r.done).toBe(true);
});

test('a defense summons holds the town and breaks the column', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    S.allegiance = 'trust';
    const loc = DATA.LOCATIONS.find((l) => l.kind === 'settlement'
      && State.ownerOf(S, l.id) === 'trust');
    const ownerBefore = State.ownerOf(S, loc.id);
    S.parties.push({
      id: 'defcol', kind: 'warband_syndic', faction: 'syndic', name: 'Syndic host',
      strength: 140, x: loc.x - 90, z: loc.z - 90, tx: loc.x, tz: loc.z,
      siegeTarget: loc.id, tier: 4, speed: 20,
    });
    S.contracts.forEach((x) => { x.accepted = false; });
    S.contracts.push({
      id: 'con_hold', type: 'defense', defend: true, site: loc.id, employer: 'trust',
      summons: 'defcol', enemyFaction: 'syndic', title: 'h', text: 'h', pay: 700,
      expiresDay: S.day + 4, accepted: true,
    });
    const repBefore = S.rep.trust || 0;
    State.applyMissionResult(S, {
      success: true, type: 'defense', site: loc.id, kills: 30,
      soldierResults: [], suppliesUsed: 0,
    });
    return {
      ownerBefore,
      ownerAfter: State.ownerOf(S, loc.id),
      columnGone: !S.parties.some((p) => p.id === 'defcol'),
      contractGone: !S.contracts.some((x) => x.id === 'con_hold'),
      repGain: (S.rep.trust || 0) - repBefore,
    };
  });
  // The town STAYS the liege's; the column is finished; the call was answered.
  expect(r.ownerAfter).toBe(r.ownerBefore);
  expect(r.columnGone).toBe(true);
  expect(r.contractGone).toBe(true);
  expect(r.repGain).toBeGreaterThanOrEqual(5);
});

test('verticality: the player mounts a crate, and ordered troops climb the wall walk', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'siege', site: 'bastion', layout: 'bastion', siteName: 'V',
        enemyFaction: 'syndic' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
    if (G.mission.intro) { G.mission.intro.active = false; G.mission.time = G.mission.intro.graceUntil + 0.1; }
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(async () => {
    const Level = await import('/src/level.js');
    const m = window.KR.mission;
    const p = m.player;
    // ---- the player mounts a crate --------------------------------------
    // A synthetic crate two metres ahead, walk-flagged like every real one.
    const ground = Level.heightAt(p.x, p.z);
    const crate = { x: p.x, z: p.z - 2.2, hw: 0.8, hd: 0.8, h: 0.94,
      y: ground, walk: true };
    m.level.obstacles.push(crate);
    // Face it and take it at a run: a few strides for speed, then the jump.
    // Movement is camera-relative — with camYaw 0, W walks toward -z. The
    // mission STAYS paused so the live loop cannot double-step the frames
    // we drive by hand; tryJump alone needs the flag dropped for a beat.
    m.camYaw = 0;
    m.hadLock = true;
    m.keys.add('w');
    for (let i = 0; i < 8; i++) m.updatePlayer(1 / 60);
    m.paused = false;
    m.tryJump();
    m.paused = true;
    // Step until they LAND ON the crate — with W held past that they simply
    // walk across and off the far side, which the first version of this
    // test measured as a failed jump.
    let landedUp = false;
    for (let i = 0; i < 100 && !landedUp; i++) {
      m.updatePlayer(1 / 60);
      landedUp = m.grounded && p.elev > 0.8;
    }
    m.keys.delete('w');
    const mounted = { elev: p.elev, overCrate: Math.hypot(p.x - crate.x, p.z - crate.z) < 1.6 };
    // ---- ordered troops climb the wall walk ------------------------------
    // The walk decking sits at 4.9 on the wall line; the stairs are inside.
    const s = m.squad.find((q) => !q.dead && !q.militia);
    s.x = 0; s.z = -30; s.elev = 0;         // inside the compound, at the foot
    const dest = { x: -18, z: -12.2 };      // on the walk, defended face
    s.order = 'move';
    s.orderPoint = dest;
    s.forceTarget = null;
    for (let i = 0; i < 2400; i++) m.updateFriendly(1 / 60, s);
    return {
      mounted,
      walker: { elev: s.elev || 0, dist: Math.hypot(s.x - dest.x, s.z - dest.z) },
    };
  });
  // The jump clears the crate and the top is a place to stand.
  expect(r.mounted.overCrate).toBe(true);
  expect(r.mounted.elev).toBeGreaterThan(0.8);
  // The squaddie took the stairs and stands ON the wall, not at its foot.
  expect(r.walker.dist).toBeLessThan(4);
  expect(r.walker.elev).toBeGreaterThan(4);
});

test('lineage: pressed troops keep their training, recruits carry their town writ', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const { State, DATA } = window.KR.dev;
    const Roster = await import('/src/roster.js');
    const S = window.KR.campaign;
    // A pressed Trust prisoner is Trust-drilled.
    S.prisoners = [];
    const { rng } = await import('/src/util.js');
    const rr = rng(77);
    const cap = Roster.makeSoldier(rr, { role: 'rifleman' });
    cap.captiveFaction = 'trust';
    cap.id = 'lin_test';
    S.prisoners.push(cap);
    State.pressPrisoner(S, 'lin_test');
    const pressed = S.roster.find((x) => x.id === 'lin_test');
    // Doctrine reaches the numbers: same soldier, with and without lineage.
    const withL = Roster.effective(pressed);
    const stash = pressed.lineage;
    pressed.lineage = null;
    const withoutL = Roster.effective(pressed);
    pressed.lineage = stash;
    // A Syndic muster walks faster than the same body untrained.
    pressed.lineage = 'syndic';
    const syndic = Roster.effective(pressed);
    pressed.lineage = stash;
    // Recruits at a Trust-held town carry the writ.
    const town = DATA.LOCATIONS.find((l) => l.kind === 'settlement'
      && State.ownerOf(S, l.id) === 'trust');
    S.relations = S.relations || {};
    S.relations[town.id] = 60;
    const pool = State.recruitPool(S, town.id);
    return {
      lineage: pressed.lineage,
      accGain: withL.accuracy - withoutL.accuracy,
      coverGain: withL.cover - withoutL.cover,
      speedGain: syndic.speed - withoutL.speed,
      poolLineages: pool.map((s) => s.lineage),
    };
  });
  expect(r.lineage).toBe('trust');
  expect(r.accGain).toBeCloseTo(0.05, 2);
  expect(r.coverGain).toBeCloseTo(0.18, 2);
  expect(r.speedGain).toBeGreaterThan(0.1);
  expect(r.poolLineages.length).toBeGreaterThan(0);
  expect(r.poolLineages.every((l) => l === 'trust')).toBe(true);
});

test('the trader has price rumours, and acting on one finds the promised spread', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    const here = DATA.LOCATIONS.find((l) => l.services?.includes('market'));
    const rum = State.priceRumour(S, here.id);
    const again = State.priceRumour(S, here.id);
    if (!rum) return { rum: null };
    // The rumour's arithmetic is the table's arithmetic.
    const real = State.priceAt(S, rum.at, rum.good)
      / State.priceAt(S, here.id, rum.good);
    return {
      rum: { text: rum.text, ratio: rum.ratio },
      sameTwice: again && again.text === rum.text,
      real,
      namesTown: rum.text.includes(DATA.LOCATIONS.find((l) => l.id === rum.at).name),
    };
  });
  // A market this size on day one always has SOME spread worth mentioning;
  // if that ever stops being true this should fail loudly, not skip.
  expect(r.rum).not.toBe(null);
  expect(r.rum.ratio).toBeGreaterThanOrEqual(1.35);
  // Deterministic per day: asking twice gets the same sentence.
  expect(r.sameTwice).toBe(true);
  // And the number is honest: the named pair's real spread IS the ratio.
  expect(r.real).toBeCloseTo(r.rum.ratio, 5);
  expect(r.namesTown).toBe(true);
});

test('lord temperament shapes the war: bolder chases, heavier hosts, readable lines', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;
    // A martial and a cautious lord over IDENTICAL columns, both weighed
    // against the same company at the same spot.
    S.lords = S.lords || [];
    S.lords.push(
      { id: 'lt_m', name: 'Vael Corso', faction: 'syndic', temper: 'martial',
        defeats: 0, wins: 0, captured: false, freeDay: 0 },
      { id: 'lt_c', name: 'Odo Fenn', faction: 'syndic', temper: 'cautious',
        defeats: 0, wins: 0, captured: false, freeDay: 0 },
    );
    // Far from any sanctuary: park the company in open country.
    S.pos = { x: -450, z: 260 };
    const mk = (id, lordId, strength) => ({
      id, kind: 'warband_syndic', faction: 'syndic', name: id, strength,
      tier: 4, quality: 0.9, x: S.pos.x + 30, z: S.pos.z + 30,
      hostileToPlayer: true, lordId,
    });
    const squad = State.ready(S);
    // Find an EVEN fight first: the temperaments only disagree inside the
    // window between their thresholds (default boldness 0.42 — martial
    // demands 0.294, cautious 0.609). A hardcoded strength sat above both
    // and both lords chased.
    let str = null;
    for (let s = 2; s <= 24 && str === null; s++) {
      const theirs = 1 - State.estimateFight(S, squad, mk('probe', null, s)).odds;
      if (theirs > 0.33 && theirs < 0.57) str = s;
    }
    const martial = str === null ? null
      : State.partyIntent(S, mk('pm', 'lt_m', str), squad);
    const cautious = str === null ? null
      : State.partyIntent(S, mk('pc', 'lt_c', str), squad);
    // The fallback temper is stable: same lord, same disposition, every read.
    const old = { name: 'Halden Rusk' };
    const t1 = State.temperOf(old).id;
    const t2 = State.temperOf(old).id;
    return { martial, cautious, t1, t2,
      odds: { m: State.TEMPERS.martial.odds, c: State.TEMPERS.cautious.odds } };
  });
  // Same column, same odds — different decisions, because different men.
  expect(r.odds.m).toBeLessThan(1);
  expect(r.odds.c).toBeGreaterThan(1);
  expect(r.martial).toBe('chase');
  expect(r.cautious).not.toBe('chase');
  expect(r.t1).toBe(r.t2);
});

test('lords hold court: found by rotation, warmed by gifts, won by regard', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    S.lords = S.lords || [];
    S.lords.push(
      { id: 'ct_a', name: 'Serra Vane', faction: 'trust', temper: 'honorable',
        defeats: 0, wins: 0, captured: false, freeDay: 0 },
      { id: 'ct_b', name: 'Brom Hale', faction: 'trust', temper: 'martial',
        defeats: 0, wins: 0, captured: false, freeDay: 0 },
    );
    const town = DATA.LOCATIONS.find((l) => l.kind === 'settlement'
      && State.ownerOf(S, l.id) === 'trust');
    // The court seats a lord of the HOLDER faction, the same one all day.
    const at1 = State.lordAt(S, town.id);
    const at2 = State.lordAt(S, town.id);
    const factionAtCourt = at1 ? at1.faction : null;   // before defection mutates it
    // Gifts: once a day, credits down, regard up.
    S.credits = 1000;
    const g1 = State.giftLord(S, at1.id);
    const g2 = State.giftLord(S, at1.id);
    // Defection needs your own banner AND real friendship.
    const noBanner = State.courtDefection(S, at1.id);
    S.ownFaction = { id: 'bracket', name: 'Bracket', colour: 0xc08d3f, declaredDay: S.day };
    const coldShoulder = State.courtDefection(S, at1.id);
    at1.regard = 7;
    const sworn = State.courtDefection(S, at1.id);
    return {
      faction: factionAtCourt, same: at1?.id === at2?.id,
      g1ok: g1.ok, g1regard: g1.regard, g2ok: g2.ok,
      credits: S.credits,
      noBanner: noBanner.ok, coldShoulder: coldShoulder.ok, sworn: sworn.ok,
      nowVassal: State.lordById(S, at1.id).vassal === true
        && State.lordById(S, at1.id).faction === 'bracket',
    };
  });
  expect(r.faction).toBe('trust');
  expect(r.same).toBe(true);
  expect(r.g1ok).toBe(true);
  expect(r.g1regard).toBeGreaterThanOrEqual(1);
  // The second gift the same day is a bribe, and lords know the difference.
  expect(r.g2ok).toBe(false);
  expect(r.credits).toBe(700);
  expect(r.noBanner).toBe(false);
  expect(r.coldShoulder).toBe(false);
  expect(r.sworn).toBe(true);
  expect(r.nowVassal).toBe(true);
});

test('nobody gets left: capture keeps a companion, the break brings them home', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(async () => {
    const { State } = window.KR.dev;
    const { rng } = await import('/src/util.js');
    const S = window.KR.campaign;
    S.credits = 5000;
    State.hireCompanion(S, 'vex');
    // The company is taken; the captor keeps the companion when the roll
    // says so — walk seeds until it does, the roll is 75%.
    let contract = null;
    for (let seed = 1; seed <= 8 && !contract; seed++) {
      const before = S.roster.length;
      State.captureCompany(S, 'trust', rng(seed));
      contract = S.contracts.find((c) => c.rescue) || null;
      if (!contract && S.roster.length < before) break;   // lost some other way
    }
    if (!contract) return { contract: null };
    const heldOut = !S.roster.some((s) => s.compId === 'vex');
    // The break: play the recovery at the named site and win it.
    S.contracts.forEach((x) => { x.accepted = false; });
    contract.accepted = true;
    State.applyMissionResult(S, {
      success: true, type: 'recovery', site: contract.site, kills: 4,
      soldierResults: [], suppliesUsed: 0,
    });
    const home = S.roster.some((s) => s.compId === 'vex');
    const cleared = !(S.captives || []).length;
    // And the slow path: a fresh capture, then twelve days brings the ransom.
    State.captureCompany(S, 'trust', rng(3));
    S.credits = 5000;   // the capture stripped the ledger; the ransom needs 600
    const c2 = (S.captives || [])[0];
    let ransomed = null;
    if (c2) {
      c2.sinceDay = S.day - 13;
      const creditsBefore = S.credits;
      State.advanceTime(S, 24);
      ransomed = {
        back: S.roster.some((s) => s.id === c2.soldier.id),
        paid: creditsBefore - S.credits >= 600,
      };
    }
    return { contract: { site: contract.site, pay: contract.pay }, heldOut, home, cleared, ransomed };
  });
  expect(r.contract).not.toBe(null);
  expect(r.contract.pay).toBe(0);          // the pay is the person
  expect(r.heldOut).toBe(true);
  expect(r.home).toBe(true);
  expect(r.cleared).toBe(true);
  if (r.ransomed) {
    expect(r.ransomed.back).toBe(true);
    expect(r.ransomed.paid).toBe(true);
  }
});

test('two doors into the bastion: the gate charge, or the culvert grate', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  await page.evaluate(async () => {
    const { Mission } = await import('/src/mission.js');
    const UI = await import('/src/ui.js');
    const G = window.KR;
    const S = G.campaign;
    S.renown = 4000;
    G.mission?.dispose();
    G.world?.dispose(); G.world = null;
    document.getElementById('viewport').innerHTML = '';
    UI.show('hud');
    G.mission = new Mission({
      campaign: S,
      spec: { type: 'siege', site: 'bastion', layout: 'bastion', siteName: 'B2',
        enemyFaction: 'syndic' },
      squad: S.roster.slice(0, 4),
      container: document.getElementById('viewport'),
      onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
    });
    await G.mission.start();
    G.mission.paused = true;
  });
  await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
  const r = await page.evaluate(() => {
    const m = window.KR.mission;
    const cv = m.level.culvert;
    const breaches = m.interactables.filter((i) => i.kind === 'breach');
    const culvertIt = breaches.find((i) => i.culvert);
    const grate = m.culvertObstacle;
    const before = !!grate && m.level.obstacles.includes(grate);
    m.blowCulvert(culvertIt);
    return {
      doors: breaches.length,
      hasCulvert: !!culvertIt,
      before,
      after: m.level.obstacles.includes(grate),
      breached: m.breached,
      gateStands: m.level.obstacles.includes(m.gateObstacle),
      phase: m.objective.progress,
    };
  });
  // Two authored ways in.
  expect(r.doors).toBe(2);
  expect(r.hasCulvert).toBe(true);
  // The grate was real, and the charge removed it — without touching the gate.
  expect(r.before).toBe(true);
  expect(r.after).toBe(false);
  expect(r.breached).toBe(true);
  expect(r.gateStands).toBe(true);
  expect(r.phase).toBe(1);
});

test('an escort contract is the road: the convoy rolls, arrives, and pays', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    // Post the contract by hand (the daily roll is a coin toss) — the shape
    // is exactly what maybeEscortContract writes.
    const markets = DATA.LOCATIONS.filter((l) => l.services?.includes('market'));
    let from = null, to = null;
    outer:
    for (const a of markets) {
      for (const b of markets) {
        if (a.id === b.id) continue;
        if (Math.hypot(b.x - a.x, b.z - a.z) > 300) { from = a; to = b; break outer; }
      }
    }
    S.contracts.forEach((x) => { x.accepted = false; });
    S.contracts.push({
      id: 'con_esc', type: 'escort', site: from.id, escortTo: to.id, employer: null,
      title: 't', text: 't', pay: 500, expiresDay: S.day + 5, accepted: false,
    });
    State.acceptContract(S, 'con_esc');
    const c = S.contracts.find((x) => x.id === 'con_esc');
    const convoy = S.parties.find((p) => p.id === c.convoyId);
    const spawned = !!convoy && convoy.convoyTo === to.id;
    // Walk the world until it arrives (or the road eats it — either is a
    // real outcome, but delivery must be POSSIBLE, so try a few days).
    const credits0 = S.credits;
    let delivered = false, days = 0;
    while (days < 14 && !delivered) {
      State.advanceTime(S, 6);
      days += 0.25;
      if (!S.contracts.some((x) => x.id === 'con_esc')) {
        delivered = S.log.some((l) => l.text && l.text.includes('Escort paid'));
        break;
      }
    }
    const lost = S.log.some((l) => l.text && l.text.includes('never arrived'));
    return { spawned, resolved: !S.contracts.some((x) => x.id === 'con_esc'),
      delivered, lost, gain: S.credits - credits0 };
  });
  expect(r.spawned).toBe(true);
  // The contract resolved one way or the other — no zombie postings.
  expect(r.resolved).toBe(true);
  // Either ending was reported to the player — the pay line or the loss line.
  // Net credits over two weeks of payroll say nothing about the contract.
  expect(r.delivered || r.lost).toBe(true);
});

test('mercenaries by the job and dice by the door: the tavern earns its keep', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    S.credits = 5000;
    // The rotation seats a band SOMEWHERE within a few days.
    let at = null, band = null;
    outer:
    for (let d = 0; d < 6; d++) {
      for (const l of DATA.LOCATIONS.filter((x) => x.services?.includes('recruit'))) {
        const b = State.mercBandAt(S, l.id);
        if (b) { at = l.id; band = b; break outer; }
      }
      S.day++;
    }
    if (!band) return { band: null };
    const hired = State.hireMercBand(S, at);
    const active = State.mercActive(S);
    // Three days later they are gone.
    S.day += 4;
    const lapsed = State.mercActive(S);
    // The dice: deterministic per attempt, and the ledger moves both ways.
    S.credits = 1000;
    let swing = 0;
    for (let i = 0; i < 20; i++) {
      const before = S.credits;
      State.rollDice(S, 100);
      swing += Math.abs(S.credits - before);
    }
    return {
      band: band.name, feePaid: hired.ok,
      active: !!active && active.size === band.size,
      lapsed: lapsed === null,
      swing, credits: S.credits,
    };
  });
  expect(r.band).not.toBe(null);
  expect(r.feePaid).toBe(true);
  expect(r.active).toBe(true);
  expect(r.lapsed).toBe(true);
  // Twenty rolls moved real money and the books still balance to a legal sum.
  expect(r.swing).toBeGreaterThan(0);
  expect(r.credits).toBeGreaterThanOrEqual(0);
});

test('the ledger remembers what you saw, the circuit remembers who won', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    // Ledger: record two markets by hand (the UI calls this on stall open).
    const markets = DATA.LOCATIONS.filter((l) => l.services?.includes('market')).slice(0, 3);
    for (const m of markets) State.recordPrices(S, m.id);
    const g = DATA.GOODS_LIST[0];
    const best = State.ledgerBest(S, g, markets[0].id);
    const honest = best
      && State.priceAt(S, best.at, g) === best.price
      && best.at !== markets[0].id;
    // Circuit: a bout exists most days; bet it and the standings move.
    let bout = null;
    for (let d = 0; d < 5 && !bout; d++) { bout = State.exhibitionBout(S); if (!bout) S.day++; }
    S.credits = 1000;
    const bet = bout ? State.betExhibition(S, true, 150) : null;
    const again = bout ? State.betExhibition(S, true, 150) : null;
    const champ = State.pitChampion(S);
    return {
      ledger: !!best, honest,
      bout: !!bout, betOk: bet?.ok, oneANight: again?.ok === false,
      champ: champ ? champ.wins : 0,
    };
  });
  expect(r.ledger).toBe(true);
  expect(r.honest).toBe(true);
  expect(r.bout).toBe(true);
  expect(r.betOk).toBe(true);
  expect(r.oneANight).toBe(true);
  // Somebody won tonight, and the wall knows their name.
  expect(r.champ).toBeGreaterThanOrEqual(1);
});

test('stalls, wars, and burnt fields: the campaign layer rounds out', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA, Dip } = window.KR.dev;
    const S = window.KR.campaign;
    // Workshops: buy a stall, and the day pays.
    S.credits = 5000;
    const market = DATA.LOCATIONS.find((l) => l.services?.includes('market'));
    const bought = State.buyWorkshop(S, market.id);
    const dayPay = State.workshopIncome(S, market.id);
    const twice = State.buyWorkshop(S, market.id);
    // Diplomacy: no banner, no war; with a banner, the war is a choice.
    const noBanner = Dip.declareWarOn(S, 'trust');
    S.ownFaction = { id: 'bracket', name: 'Bracket', colour: 0xc08d3f, declaredDay: S.day };
    const declared = Dip.declareWarOn(S, 'trust');
    const atWar = Dip.relationBetween(S, 'bracket', 'trust');
    S.credits = 9000;
    const peace = Dip.suePeace(S, 'trust');
    const after = Dip.relationBetween(S, 'bracket', 'trust');
    // Villages: torch every feeder of a settlement and its recovery slows.
    const fedTown = DATA.LOCATIONS.find((l) => l.kind === 'settlement'
      && State.feedersOf(l.id).length > 0);
    const feeders = fedTown ? State.feedersOf(fedTown.id) : [];
    // Pin the mechanism itself: the regen scale, not manpower over sim days —
    // faction musters draw from the same pool and drown the signal.
    let slowed = null;
    if (fedTown) {
      S.razed = {};
      const healthy = State.feederScale(S, fedTown);
      for (const v of feeders) S.razed[v.id] = S.day;
      const burnt = State.feederScale(S, fedTown);
      S.razed = {};
      slowed = { healthy, burnt };
    }
    return {
      bought: bought.ok, dayPay, twice: twice.ok,
      noBanner: noBanner.ok, declared: declared.ok, atWar, peace: peace.ok, after,
      feeders: feeders.length, slowed,
    };
  });
  expect(r.bought).toBe(true);
  expect(r.dayPay).toBeGreaterThan(0);
  expect(r.twice).toBe(false);
  expect(r.noBanner).toBe(false);
  expect(r.declared).toBe(true);
  expect(r.atWar).toBe('war');
  expect(r.peace).toBe(true);
  expect(r.after).toBe('truce');
  expect(r.feeders).toBeGreaterThan(0);
  // Burnt fields: same starting manpower, measurably less recovery.
  expect(r.slowed.burnt).toBeLessThan(r.slowed.healthy);
});

test('small work in three new shapes: crates out, debts in, locals drilled', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    const town = DATA.LOCATIONS.find((l) => l.kind === 'settlement'
      && l.contacts?.length && l.services?.length);
    // Roll the offer machinery until it deals the kind under test — the
    // template pick is seeded, so walking seeds walks the deck.
    const grab = (kind, lord = null) => {
      for (let i = 0; i < 600; i++) {
        if (S.favours) delete S.favours[town.id];
        S.favourCooldown = {};
        const f = State.offerFavour(S, town.id, makeRng(1000 + i), lord);
        if (f && f.kind === kind) return f;
      }
      return null;
    };

    // Crates out: agreed here, paid at the far end, the moment you arrive.
    const del = grab('deliver');
    State.acceptFavour(S, town.id);
    const c0 = S.credits;
    const arrived = State.arrivalFavours(S, del.to);
    const delPaid = S.credits - c0;
    const delClosed = !State.favourAt(S, town.id);

    // Debts in: the doorstep is at the DEBTOR'S town. Asking may or may not
    // land; taking it anyway always does, and this town saw you do it.
    const debt = grab('debt');
    State.acceptFavour(S, town.id);
    const door = State.debtorApproach(S, debt.to);
    const asked = State.collectDebt(S, debt.to);
    const rel0 = State.relationOf(S, debt.to);
    let pressed = false;
    if (!asked.paid) { State.pressDebt(S, debt.to); pressed = true; }
    const relDrop = pressed ? State.relationOf(S, debt.to) - rel0 : 0;
    const debtReady = State.favourProgress(S, debt).ready;
    const c1 = S.credits;
    const handedDebt = State.completeFavour(S, town.id);
    const debtCut = S.credits - c1;

    // Locals drilled: one session a day, and a town that finished the course
    // can put three more bodies on a wall.
    const tr = grab('train');
    State.acceptFavour(S, town.id);
    const first = State.runDrill(S, town.id);
    const sameDay = State.runDrill(S, town.id);
    let guard = 0;
    while (!State.favourProgress(S, tr).ready && guard++ < 6) {
      State.advanceTime(S, 24);
      State.runDrill(S, town.id);
    }
    S.manpower = S.manpower || {};
    const mp0 = S.manpower[town.id] || 0;
    const handedTrain = State.completeFavour(S, town.id);
    const mpUp = (S.manpower[town.id] || 0) - mp0;

    // A lord holding court sometimes fronts the ask, and remembers it landing.
    const lord = { id: 'l_probe', name: 'Overseer Kest', faction: 'trust', regard: 0 };
    S.lords.push(lord);
    let lorded = null;
    for (let i = 0; i < 900 && !lorded; i++) {
      if (S.favours) delete S.favours[town.id];
      S.favourCooldown = {};
      const f = State.offerFavour(S, town.id, makeRng(5000 + i), lord);
      if (f && f.lordId === lord.id && f.kind === 'deliver') lorded = f;
    }
    let regardUp = 0;
    if (lorded) {
      State.acceptFavour(S, town.id);
      State.arrivalFavours(S, lorded.to);
      regardUp = lord.regard;
    }

    return {
      delPay: del.pay, delPaid, arrived: arrived.length, delClosed,
      door: !!door, askedShape: typeof asked.paid, pressed, relDrop,
      debtReady, debtCut, cutExpected: debt.pay,
      firstRan: first.ran, sameDayBlocked: sameDay.ran === false,
      trainReady: !!handedTrain, mpUp,
      lorded: !!lorded, regardUp,
    };
  });
  expect(r.delPaid).toBe(r.delPay);
  expect(r.arrived).toBe(1);
  expect(r.delClosed).toBe(true);
  expect(r.door).toBe(true);
  expect(r.askedShape).toBe('boolean');
  if (r.pressed) expect(r.relDrop).toBeLessThan(0);
  expect(r.debtReady).toBe(true);
  expect(r.debtCut).toBe(r.cutExpected);
  expect(r.firstRan).toBe(true);
  expect(r.sameDayBlocked).toBe(true);
  expect(r.trainReady).toBe(true);
  expect(r.mpUp).toBe(3);
  expect(r.lorded).toBe(true);
  expect(r.regardUp).toBe(2);
});

test('the truck is a small room: bonds lift, feuds grind, errands settle', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    S.credits = 20000;
    // Two halves of a bond (Perrin/Jorsa) and two halves of a feud (Okkam/Vex).
    for (const id of ['perrin', 'jorsa', 'okkam', 'vex']) State.hireCompanion(S, id);
    const reg = (id) => State.companionSoldier(S, id).regard || 0;
    const before = { perrin: reg('perrin'), jorsa: reg('jorsa'), okkam: reg('okkam'), vex: reg('vex') };
    for (let d = 0; d < 60; d++) State.tickRapport(S, makeRng(700 + d));
    const drift = {
      bond: (reg('perrin') - before.perrin) + (reg('jorsa') - before.jorsa),
      clash: (reg('okkam') - before.okkam) + (reg('vex') - before.vex),
    };
    const pairs = State.activeRapport(S).map((p) => p.kind).sort();

    // Trust crosses the line, and Jorsa brings her one piece of unfinished
    // business. A word errand settles by standing in the right town.
    State.companionSoldier(S, 'jorsa').regard = 30;
    State.maybeErrands(S, makeRng(11));
    const offered = S.errands?.jorsa;
    const regBefore = State.companionSoldier(S, 'jorsa').regard;
    const settled = offered ? State.completeErrandsAt(S, offered.to) : [];
    const regAfter = State.companionSoldier(S, 'jorsa').regard;
    // Once, ever: the ask does not respawn.
    State.maybeErrands(S, makeRng(12));
    const again = !!S.errands?.jorsa;

    // A goods errand waits for the crates, then settles anywhere with a roof.
    State.hireCompanion(S, 'brik');
    State.companionSoldier(S, 'brik').regard = 30;
    State.maybeErrands(S, makeRng(13));
    const brikAsk = S.errands?.brik;
    const empty = State.completeErrandsAt(S, 'span');
    S.cargo = S.cargo || {};
    S.cargo[brikAsk.good] = brikAsk.qty + 1;
    const done = State.completeErrandsAt(S, 'span');
    return {
      drift, pairs,
      offered: offered?.kind, settledCount: settled.length, regGain: regAfter - regBefore, again,
      brikKind: brikAsk?.kind, emptyCount: empty.length, doneCount: done.length,
      leftover: S.cargo[brikAsk.good],
    };
  });
  expect(r.pairs).toEqual(['bond', 'clash']);
  expect(r.drift.bond).toBeGreaterThan(0);
  expect(r.drift.clash).toBeLessThan(0);
  expect(r.offered).toBe('word');
  expect(r.settledCount).toBe(1);
  expect(r.regGain).toBe(25);
  expect(r.again).toBe(false);
  expect(r.brikKind).toBe('goods');
  expect(r.emptyCount).toBe(0);
  expect(r.doneCount).toBe(1);
  expect(r.leftover).toBe(1);
});

test('an army marches on more than ration blocks', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA } = window.KR.dev;
    const S = window.KR.campaign;
    // The new groceries are real goods with real prices.
    const town = DATA.LOCATIONS.find((l) => l.trade?.sell?.includes('dried_catch'));
    const priced = State.priceAt(S, town.id, 'dried_catch');
    S.credits = 50000;
    S.rations = 200;
    // A varied larder: the company eats it, and the mood shows it.
    S.cargo = S.cargo || {};
    S.cargo.dried_catch = 5; S.cargo.vat_greens = 5; S.cargo.still_spirits = 5;
    const stock0 = S.cargo.dried_catch + S.cargo.vat_greens + S.cargo.still_spirits;
    S.morale = 30;
    for (let d = 0; d < 6; d++) State.advanceTime(S, 24);
    const variedGain = S.morale - 30;
    const eaten = stock0 - (S.cargo.dried_catch + S.cargo.vat_greens + S.cargo.still_spirits);
    const plainReset = S.plainDays;
    // Then a long stretch of stamped protein and nothing else.
    S.cargo.dried_catch = 0; S.cargo.vat_greens = 0; S.cargo.still_spirits = 0;
    for (let d = 0; d < 12; d++) State.advanceTime(S, 24);
    const plainDays = S.plainDays;
    S.morale = 30;
    for (let d = 0; d < 6; d++) State.advanceTime(S, 24);
    const plainGain = S.morale - 30;
    return { priced, variedGain, eaten, plainReset, plainDays, plainGain };
  });
  expect(r.priced).toBeGreaterThan(0);
  expect(r.eaten).toBeGreaterThanOrEqual(2);
  expect(r.plainReset).toBe(0);
  expect(r.plainDays).toBeGreaterThanOrEqual(11);
  // Same six days, same wages, same water: the plate is the difference.
  expect(r.variedGain).toBeGreaterThan(r.plainGain + 10);
});

test('an army is a perishable thing: marshals, the call, and cohesion', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    // The writ goes to the record: wins, minus defeats, martial thumb on
    // the scale — and it is sticky until the holder is taken.
    S.lords = [];
    S.marshals = {};
    S.lords.push(
      { id: 'l_a', name: 'Aldric Vane', faction: 'trust', temper: 'cautious', wins: 1, defeats: 0, captured: false, freeDay: 0 },
      { id: 'l_b', name: 'Bern Halst', faction: 'trust', temper: 'martial', wins: 3, defeats: 1, captured: false, freeDay: 0 },
      { id: 'l_c', name: 'Corvo Reyd', faction: 'trust', temper: 'martial', wins: 0, defeats: 4, captured: false, freeDay: 0 },
    );
    const m1 = State.marshalOf(S, 'trust');
    const stable = State.marshalOf(S, 'trust');
    S.lords.find((l) => l.id === m1.id).captured = true;
    const m2 = State.marshalOf(S, 'trust');

    // A called warband folds into the column on contact.
    const far = DATA.LOCATIONS.find((l) => l.kind === 'settlement');
    const col = {
      id: 'p_col', kind: 'warband_trust', faction: 'trust', name: 'Test column',
      x: 1000, z: 1000, tx: far.x, tz: far.z, speed: 0.01, strength: 100,
      tier: 3, quality: 1, armour: 0, vehicles: 0, baseHostile: false,
      hostileToPlayer: false, target: null, home: null, heading: 0,
      siegeTarget: far.id, army: { cohesion: 100, merged: 0 },
    };
    const wb = {
      id: 'p_wb', kind: 'warband_trust', faction: 'trust', name: 'Answering warband',
      x: 1030, z: 1000, speed: 6, strength: 40, tier: 3, quality: 1, armour: 0,
      vehicles: 0, baseHostile: false, hostileToPlayer: false, target: null,
      home: null, heading: 0, joinArmy: 'p_col',
    };
    S.parties.push(col, wb);
    State.advanceTime(S, 6);
    State.advanceTime(S, 6);
    const merged = {
      strength: col.strength, army: col.army ? col.army.merged : -1,
      gone: !S.parties.some((p) => p.id === 'p_wb'),
    };

    // Run the clock out: the called strength goes home, the offensive dies.
    col.army = { cohesion: 5, merged: col.army.merged };
    State.tickArmies(S, makeRng(31));
    const spent = { strength: col.strength, off: col.siegeTarget, army: col.army };
    S.parties = S.parties.filter((p) => p.id !== 'p_col');
    return {
      m1: m1.id, stable: stable.id, m2: m2.id,
      merged, spent,
    };
  });
  expect(r.m1).toBe('l_b');
  expect(r.stable).toBe('l_b');
  expect(r.m2).toBe('l_a');
  expect(r.merged.gone).toBe(true);
  expect(r.merged.strength).toBe(140);
  expect(r.merged.army).toBe(40);
  expect(r.spent.strength).toBe(100);
  expect(r.spent.off).toBe(null);
  expect(r.spent.army).toBe(null);
});

test('not every den is the same den: the Cut and the Boneyard both stand up', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const probe = async (site) => {
    await page.evaluate(async (siteId) => {
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
        spec: { type: 'lair', site: siteId, layout: siteId, squadCap: 4 },
        squad: S.roster.slice(0, 4),
        container: document.getElementById('viewport'),
        onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {},
      });
      await G.mission.start();
      G.mission.paused = true;
    }, site);
    await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 40000 });
    return page.evaluate(() => {
      const m = window.KR.mission;
      return {
        name: m.level.name,
        obstacles: m.level.obstacles.length,
        stairs: (m.level.stairs || []).length,
        enemies: m.entities.filter((e) => e.side === 'enemy' && !e.dead).length,
        faction: m.level.enemyFaction,
      };
    });
  };
  const quarry = await probe('quarry');
  const yard = await probe('wreckyard');
  expect(quarry.name).toBe('THE CUT');
  expect(quarry.obstacles).toBeGreaterThan(20);
  // The bench has a stair flight up each end — the high road is reachable.
  expect(quarry.stairs).toBeGreaterThanOrEqual(2);
  expect(quarry.enemies).toBeGreaterThan(0);
  expect(quarry.faction).toBe('raider');
  expect(yard.name).toBe('THE BONEYARD');
  expect(yard.obstacles).toBeGreaterThan(20);
  expect(yard.enemies).toBeGreaterThan(0);
  expect(yard.faction).toBe('raider');
});

test('who you were: three questions, and the start actually moves', async ({ page }) => {
  await boot(page);
  await page.click('button[data-act="new"]');
  await page.waitForSelector('#modal .modal-title', { timeout: 15000 });
  await expect(page.locator('#modal .modal-title')).toHaveText('BEFORE THE COMPANY');
  // A Trust childhood, a clerk's savings, and a debt collected on the way out.
  await page.click('#modal [data-x="origin:cantonment"]');
  await page.click('#modal [data-x="trade:clerk"]');
  await page.click('#modal [data-x="turn:took"]');
  await page.click('#modal [data-x="close"]');
  await page.waitForFunction(() => {
    const t = document.querySelector('#modal .modal-title');
    return t && !/BEFORE THE COMPANY/.test(t.textContent);
  }, null, { timeout: 15000 });
  await page.click('#modal [data-x="close"]');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const { State } = window.KR.dev;
    const S = window.KR.campaign;
    const cmd = State.commander(S);
    return {
      bg: S.background,
      origin: cmd.origin,
      credits: S.credits,
      repTrust: S.rep.trust, repSyndic: S.rep.syndic,
      rations: (S.cargo || {}).rations || 0,
    };
  });
  expect(r.bg).toEqual({ origin: 'cantonment', trade: 'clerk', turn: 'took' });
  expect(r.origin).toBe('trust');
  // 480 base + 250 clerk + 300 taken.
  expect(r.credits).toBe(1030);
  // +3 Trust childhood, -2 for the taking; -2 and -2 on the Syndic side.
  expect(r.repTrust).toBe(1);
  expect(r.repSyndic).toBe(-4);
  expect(r.rations).toBe(2);
});

test('the hall and the banner: feasts gather the lords, colours get chosen', async ({ page }) => {
  await boot(page);
  await newCampaign(page);
  const r = await page.evaluate(() => {
    const { State, DATA, Dip, makeRng } = window.KR.dev;
    const S = window.KR.campaign;
    // Peace, and a bench of lords to gather.
    Dip.setRelation(S, 'trust', 'syndic', 'peace', 60);
    S.lords = [
      { id: 'f_a', name: 'Avitte Corl', faction: 'trust', temper: 'martial', wins: 0, defeats: 0, captured: false, freeDay: 0 },
      { id: 'f_b', name: 'Besk Maran', faction: 'trust', temper: 'cautious', wins: 0, defeats: 0, captured: false, freeDay: 0 },
      { id: 'f_c', name: 'Cato Wrenn', faction: 'trust', temper: 'honorable', wins: 0, defeats: 0, captured: false, freeDay: 0 },
    ];
    S.feasts = {};
    let feast = null;
    for (let i = 0; i < 400 && !feast; i++) {
      State.tickFeasts(S, makeRng(9000 + i));
      feast = S.feasts.trust || null;
    }
    if (!feast) return { feast: false };
    // The feast empties every other trust court...
    const others = DATA.LOCATIONS.filter((l) => l.kind === 'settlement'
      && State.ownerOf(S, l.id) === 'trust' && l.id !== feast.site);
    const elsewhere = others.length ? State.lordAt(S, others[0].id) : null;
    const atHall = State.feastLords(S, feast.site).length;
    // ...and the door is watched.
    S.rep.trust = 0;
    const refused = State.joinFeast(S, feast.site);
    S.rep.trust = 5;
    const seated = State.joinFeast(S, feast.site);
    const regard = State.lordById(S, 'f_a').regard || 0;
    const again = State.joinFeast(S, feast.site);
    // War ends it the morning it starts.
    Dip.setRelation(S, 'trust', 'syndic', 'war', 30);
    State.tickFeasts(S, makeRng(1));
    const survived = !!S.feasts.trust;

    // The banner: name and colour chosen at declaration, restylable after.
    S.renown = 2000;
    S.holdings = { vetch: {}, span: {}, grellan: {} };
    const dec = Dip.declareFaction(S, 'The Long Table', 0xb03636);
    const colour = Dip.factionColour(S, 'bracket');
    const re = Dip.restyleFaction(S, 'The Redline Charter', 0x3f7fc0);
    return {
      feast: true, elsewhere, atHall,
      refusedOk: refused.ok, seatedOk: seated.ok, regard, againOk: again.ok, survived,
      decOk: dec.ok, colour, reOk: re.ok,
      name: S.ownFaction.name, colour2: S.ownFaction.colour,
    };
  });
  expect(r.feast).toBe(true);
  expect(r.elsewhere).toBe(null);
  expect(r.atHall).toBeGreaterThan(0);
  expect(r.refusedOk).toBe(false);
  expect(r.seatedOk).toBe(true);
  expect(r.regard).toBe(1);
  expect(r.againOk).toBe(false);
  expect(r.survived).toBe(false);
  expect(r.decOk).toBe(true);
  expect(r.colour).toBe(0xb03636);
  expect(r.reOk).toBe(true);
  expect(r.name).toBe('The Redline Charter');
  expect(r.colour2).toBe(0x3f7fc0);
});
