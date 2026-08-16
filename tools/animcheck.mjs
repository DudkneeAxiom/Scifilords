// Verifies the rig is actually moving in live play rather than posing.
// Samples joint rotations over consecutive frames while the player walks, and
// reports the range each joint travels through.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('#modal [data-x="close"]')?.click());
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.getElementById('overlay').classList.add('hidden');
  const S = window.KR.campaign;
  S.contracts[0].accepted = true;
  window.KR.world.stopTravel();
  S.pos.x = 200; S.pos.z = -220;
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const el = document.querySelector('#modal [data-x="avoid"]');
  if (el && !document.getElementById('overlay').classList.contains('hidden')) el.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => { const S = window.KR.campaign; S.pos.x = 200; S.pos.z = -220; });
await page.waitForTimeout(600);
await page.keyboard.press('e');
await page.waitForSelector('#modal [data-x="go"]', { timeout: 15000 });
await page.click('#modal [data-x="go"]');
await page.waitForFunction(() => window.KR.mission?.player, null, { timeout: 30000 });
// The insertion cinematic locks out input and holds all fire; anything
// measured across it is measuring a frozen game. waitForControlHelper
await page.waitForFunction(
  () => window.KR.mission && !window.KR.mission.intro?.active && !window.KR.mission.inserting,
  null, { timeout: 30000 });
await page.waitForTimeout(1500);

const JOINTS = ['legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR', 'torso'];

const sample = async (label, action) => {
  await page.evaluate(() => {
    window.__samples = [];
    const m = window.KR.mission;
    m.player.hp = m.player.maxHp;
    window.__tick = setInterval(() => {
      const r = m.player.char.rig;
      const row = {};
      for (const k of ['legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR', 'torso']) {
        row[k] = r[k] ? r[k].rotation.x : 0;
      }
      row.speed = m.player.moveSpeed || 0;
      window.__samples.push(row);
    }, 16);
  });
  await action();
  const rows = await page.evaluate(() => {
    clearInterval(window.__tick);
    return window.__samples;
  });
  const ranges = {};
  for (const k of JOINTS) {
    const vals = rows.map((r) => r[k]);
    ranges[k] = +(Math.max(...vals) - Math.min(...vals)).toFixed(3);
  }
  const maxSpeed = Math.max(...rows.map((r) => r.speed)).toFixed(1);
  console.log(`${label} (${rows.length} frames, peak speed ${maxSpeed})`);
  for (const k of JOINTS) {
    const bar = '#'.repeat(Math.min(40, Math.round(ranges[k] * 30)));
    console.log(`  ${k.padEnd(8)} range ${String(ranges[k]).padStart(6)} ${bar}`);
  }
  console.log('');
  return ranges;
};

const walking = await sample('WALKING FORWARD', async () => {
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
});

const standing = await sample('STANDING STILL', async () => {
  await page.waitForTimeout(1500);
});

// A walk must move the legs and knees appreciably; standing must not.
const fails = [];
for (const k of ['legL', 'legR', 'kneeL', 'kneeR']) {
  if (walking[k] < 0.15) fails.push(`${k} barely moves while walking (${walking[k]})`);
  if (standing[k] > 0.08) fails.push(`${k} moves while standing still (${standing[k]})`);
}
if (walking.armL < 0.05 && walking.armR < 0.05) fails.push('arms do not swing while walking');

if (fails.length) {
  console.log('FAILURES:');
  fails.forEach((f) => console.log('  ! ' + f));
  process.exitCode = 1;
} else {
  console.log('OK — rig animates while moving and settles when still.');
}

await browser.close();
