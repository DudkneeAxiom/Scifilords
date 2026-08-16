// Screenshot-driven QA harness.
//
// Boots the real game in Chromium, drives it through the actual loop, and
// writes numbered screenshots plus every console error to qa/. This is the
// tool that catches the things unit tests never do: overlapping panels,
// characters standing inside containers, unreadable text, broken framing.
//
//   node tools/qa.mjs            full pass
//   node tools/qa.mjs combat     just the combat shots

import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'qa';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2] || null;
const errors = [];
let shotN = 0;

const run = async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${e.stack || ''}`));

  const shot = async (name, waitMs = 400) => {
    await page.waitForTimeout(waitMs);
    const n = String(++shotN).padStart(2, '0');
    await page.screenshot({ path: `${OUT}/${n}-${name}.png` });
    console.log(`  shot ${n}-${name}`);
  };

  console.log('booting...');
  await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await shot('boot');

  // Wait for the title screen (model preload finishes).
  await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
  await shot('title', 700);

  await page.click('button[data-act="controls"]');
  await shot('controls');
  await page.click('#modal [data-x="close"]');

  await page.click('button[data-act="about"]');
  await shot('about');
  await page.click('#modal [data-x="close"]');

  // New company -> intro modal
  await page.click('button[data-act="new"]');
  await page.waitForSelector('#modal', { timeout: 10000 });
  await shot('intro', 900);
  await page.click('#modal [data-x="close"]');

  // The intro hands off to the commander's opening commission — the first
  // real decision in the game — and only then to the contract board.
  await page.waitForSelector('#modal [data-perk]', { timeout: 10000 });
  await shot('commission', 700);
  await page.click('#modal [data-perk]');
  await page.waitForTimeout(800);
  await shot('contract-board');

  // Accept the Grellan recovery contract.
  const cards = await page.$$('#modal .card[data-c]');
  if (cards.length) {
    await cards[0].click();
    await page.waitForTimeout(400);
  } else {
    throw new Error('contract board did not open after the commission');
  }
  await shot('world-map', 900);

  // Roster
  await page.keyboard.press('c');
  await shot('roster', 700);
  await page.click('#modal [data-x="close"]');

  // Travel: click toward the Grellan Array (north-east of the map).
  await page.mouse.click(880, 250);
  await page.waitForTimeout(2500);
  await shot('travelling');

  // Drive to the contract site directly via the campaign state, then enter.
  const where = await page.evaluate(() => {
    const S = window.KR.campaign;
    window.KR.world.stopTravel();
    S.pos.x = 200; S.pos.z = -220;
    return { x: S.pos.x, z: S.pos.z, accepted: S.contracts.filter((c) => c.accepted).map((c) => c.site) };
  });
  await page.waitForTimeout(1500);
  // Arriving beside the Array's scrapper band is a real approach encounter —
  // dismiss it the way a player would before entering the site.
  if (await page.$('#modal [data-x="avoid"]')) {
    await page.click('#modal [data-x="avoid"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const S = window.KR.campaign;
      S.pos.x = 200; S.pos.z = -220;
    });
    await page.waitForTimeout(700);
  }
  const atLoc = await page.evaluate(() => ({
    near: window.KR.world.nearLocation?.id || null,
    paused: !!window.KR.world.paused,
    pos: { x: Math.round(window.KR.campaign.pos.x), z: Math.round(window.KR.campaign.pos.z) },
    modal: !document.getElementById('overlay').classList.contains('hidden'),
    modalTitle: document.querySelector('#modal .modal-title')?.textContent || null,
  })).then((v) => { console.log('  state', JSON.stringify(v)); return v.near; });
  console.log(`  position ${JSON.stringify(where)} -> at ${atLoc}`);
  if (atLoc !== 'grellan') throw new Error(`expected to be at grellan, was at ${atLoc}`);
  await shot('at-array');

  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  await shot('deploy-picker');

  // Take everyone.
  for (const el of await page.$$('#modal [data-p]')) {
    await el.click().catch(() => {});
  }
  await shot('deploy-selected', 300);
  await page.click('#modal [data-x="go"]');

  console.log('deploying...');
  await page.waitForTimeout(3000);
  await shot('mission-start');

  // This harness stands still in the open, which is correctly lethal, so the
  // commander is kept alive for the duration of the photo shoot. Survivability
  // is measured separately by tools/balance.mjs — never inferred from here.
  await page.evaluate(() => {
    window.__qaGod = setInterval(() => {
      const m = window.KR.mission;
      if (m && m.player && !m.over) { m.player.hp = m.player.maxHp; m.player.down = false; }
    }, 150);
  });

  if (only !== 'strategic') {
    // Look around and move so the camera, animation and AI all get exercised.
    await page.mouse.move(640, 400);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.down('w');
      await page.waitForTimeout(400);
      await page.mouse.move(640 + i * 30, 400);
      await page.keyboard.up('w');
      await page.waitForTimeout(120);
    }
    await shot('mission-moved', 500);

    // Aim
    await page.mouse.down({ button: 'right' });
    await shot('mission-ads', 600);
    await page.mouse.up({ button: 'right' });

    // Squad orders
    await page.keyboard.press('h');
    await shot('order-hold', 500);
    await page.keyboard.press('f');
    await page.waitForTimeout(300);
    await page.keyboard.press('q');
    await shot('order-move', 500);

    // Fire a burst
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await shot('mission-firing', 200);

    await page.keyboard.press('r');
    await shot('mission-reload', 400);

    // Teleport to the objective so the pen, prisoners and interaction show up.
    // Health is topped up because this harness deliberately stands still in the
    // open, which is correctly lethal — we are photographing screens here, not
    // testing survivability (tools/balance.mjs does that).
    await page.evaluate(() => {
      const m = window.KR.mission;
      m.player.hp = m.player.maxHp;
      m.player.down = false;
      m.player.x = m.level.objectivePoint.x;
      m.player.z = m.level.objectivePoint.z + 5;
    });
    await page.waitForTimeout(900);
    await shot('objective-area');

    // Release everyone by driving the interactables directly.
    await page.evaluate(() => {
      const m = window.KR.mission;
      for (const it of m.interactables) {
        if (it.kind === 'prisoner') m.completeInteraction(it);
      }
    });
    await page.waitForTimeout(800);
    await shot('prisoners-released');

    // Head to extraction.
    await page.evaluate(() => {
      const m = window.KR.mission;
      const ex = m.level.extraction;
      m.player.hp = m.player.maxHp;
      m.player.x = ex.x; m.player.z = ex.z + 9;
      for (const p of m.prisoners) { p.x = ex.x + Math.random() * 2; p.z = ex.z + 2; }
    });
    await page.waitForTimeout(1000);
    await shot('extraction');

    await page.evaluate(() => {
      const m = window.KR.mission;
      const ex = m.level.extraction;
      m.player.x = ex.x; m.player.z = ex.z;
    });
    await page.waitForTimeout(3200);
    await shot('after-action');

    // Back to the map with consequences applied.
    const closeBtn = await page.$('#modal [data-x="close"]');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(1800);
    await shot('world-after');

    await page.keyboard.press('c');
    await shot('roster-after', 700);
    const c2 = await page.$('#modal [data-x="close"]');
    if (c2) await c2.click();
  }

  writeFileSync(`${OUT}/errors.txt`,
    errors.length ? errors.join('\n\n') : 'no console errors');
  console.log(`\n=== ${errors.length} console errors ===`);
  errors.slice(0, 14).forEach((e) => console.log(e.slice(0, 400)));

  await browser.close();
};

run().catch((e) => {
  console.error('QA HARNESS FAILED:', e.message);
  writeFileSync(`${OUT}/errors.txt`, `HARNESS: ${e.stack}\n\n${errors.join('\n\n')}`);
  process.exit(1);
});
