// Does a guard LOOK like the line it is holding?
//
// Directional blocking is only half a feature if the body does not show it:
// the player has to be able to read an opponent's guard off the opponent,
// and their own off their own hands. This drives one rig through all four
// lines and reports the arm and weapon angles, so "the pose changes" is a
// measurement rather than an impression.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });

const r = await page.evaluate(async () => {
  const Models = await import('/src/models.js');
  const { WEAPONS } = (await import('/src/data.js'));
  await Models.load?.();
  const ch = Models.character
    ? Models.character('soldier_commander')
    : Models.makeCharacter('soldier_commander');
  const w = WEAPONS.sword;
  const out = {};
  for (const dir of ['overhead', 'thrust', 'left', 'right']) {
    // Settle the blend so this is the held pose, not a frame of the way in.
    for (let i = 0; i < 120; i++) {
      ch.update(1 / 60, {
        melee: true, swing: 0, swingDir: 'right', guard: 1, guardDir: dir,
        hold: w.hold, guardPose: w.guard, moving: 0, speed: 0,
      });
    }
    const rig = ch.rig || ch;
    out[dir] = {
      armRx: +(rig.armR?.rotation.x ?? 0).toFixed(3),
      armRz: +(rig.armR?.rotation.z ?? 0).toFixed(3),
      armLz: +(rig.armL?.rotation.z ?? 0).toFixed(3),
      wpitch: +(ch.weapon?.rotation.x ?? 0).toFixed(3),
    };
  }
  return out;
});

console.log('\n line        armR.x   armR.z   armL.z   weapon pitch');
for (const [d, v] of Object.entries(r)) {
  console.log(`  ${d.padEnd(10)} ${String(v.armRx).padStart(7)} ${String(v.armRz).padStart(8)} `
    + `${String(v.armLz).padStart(8)} ${String(v.wpitch).padStart(9)}`);
}
const keys = Object.keys(r);
const sigs = new Set(keys.map((k) => JSON.stringify(r[k])));
console.log(sigs.size === keys.length
  ? '\nAll four guards are visibly different poses.'
  : `\nFAIL: only ${sigs.size} distinct poses across ${keys.length} guard lines.`);
await browser.close();
