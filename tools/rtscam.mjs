// Does D go right, and how long does the eye take to get there?
//
// Two reports: the tactical pan is inverted left-to-right, and the move
// between the shoulder and the board is poor. Both are measurable against
// the camera itself rather than by eye — take the camera's own right
// vector, press a key, and see which way the board actually went; and time
// the blend from the keypress to the frame it settles.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(1000);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => { const m = document.querySelector('#modal');
    if (!m || m.classList.contains('hidden')) return true;
    const b = m.querySelector('[data-x="close"]') || m.querySelector('[data-perk]') || m.querySelector('[data-x]') || m.querySelector('button');
    if (b) { b.click(); return false; } return true; });
  if (d) break; await page.waitForTimeout(600);
}
const r = await page.evaluate(async () => {
  const { Mission } = await import('/src/mission.js');
  const UI = await import('/src/ui.js');
  const THREE = await import('/vendor/three/three.module.min.js');
  const G = window.KR, S = G.campaign;
  G.mission?.dispose(); G.world?.dispose(); G.world = null;
  document.getElementById('viewport').innerHTML = ''; UI.show('hud');
  G.mission = new Mission({ campaign: S,
    spec: { type: 'skirmish', site: 'roadside', layout: 'roadside', siteName: 'Cam',
      party: { id: 'cm', kind: 'looters', name: 'Foe', strength: 5, tier: 1, quality: 0.6 } },
    squad: S.roster.slice(0, 4), container: document.getElementById('viewport'),
    onHud: () => {}, onToast: () => {}, onIntro: () => {}, onWheel: () => {}, onEnd: () => {} });
  await G.mission.start();
  const m = G.mission;
  m.paused = false; m.hadLock = true; m.inserting = false;
  if (m.intro) { m.intro.active = false; m.time = m.intro.graceUntil + 0.1; }
  const realStep = m.step.bind(m); m.step = () => {};
  const tick = (n2) => { for (let i = 0; i < n2; i++) { realStep(1 / 60); m.updateCamera(1 / 60); } };

  // --- the transition, timed both ways ---------------------------------
  const settle = (want) => {
    let frames = 0;
    for (; frames < 600; frames++) {
      tick(1);
      if (want ? m.tacBlend >= 1 : m.tacBlend <= 0) break;
    }
    return Math.round((frames / 60) * 1000);
  };
  tick(60);
  m.toggleTactical();
  const intoBoard = settle(true);
  tick(30);
  m.toggleTactical();
  const backToLine = settle(false);

  // --- the pan, against the camera's own right vector -------------------
  m.toggleTactical();
  settle(true);
  tick(30);
  const cam = m.camera;
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const probe = (key) => {
    m.rtsVel = { x: 0, z: 0 };
    const f0 = { x: m.rtsFocus.x, z: m.rtsFocus.z };
    m.keys.add(key);
    tick(40);
    m.keys.delete(key);
    const dx = m.rtsFocus.x - f0.x, dz = m.rtsFocus.z - f0.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    return {
      alongRight: +((dx * right.x + dz * right.z) / len).toFixed(2),
      alongFwd: +((dx * fwd.x + dz * fwd.z) / len).toFixed(2),
      moved: +len.toFixed(1),
    };
  };
  return { intoBoard, backToLine, d: probe('d'), a: probe('a'), w: probe('w'), s: probe('s') };
});
console.log(`transition into the board: ${r.intoBoard}ms   back to the line: ${r.backToLine}ms`);
console.log('\nkey  moved   along screen-RIGHT   along screen-FORWARD   verdict');
for (const [k, v] of [['D', r.d], ['A', r.a], ['W', r.w], ['S', r.s]]) {
  const want = { D: ['right', 1], A: ['right', -1], W: ['fwd', 1], S: ['fwd', -1] }[k];
  const got = want[0] === 'right' ? v.alongRight : v.alongFwd;
  const ok = Math.sign(got) === Math.sign(want[1]) && Math.abs(got) > 0.8;
  console.log(`  ${k}  ${String(v.moved).padStart(5)}m  ${String(v.alongRight).padStart(18)}`
    + `  ${String(v.alongFwd).padStart(20)}   ${ok ? 'correct' : 'INVERTED'}`);
}
await browser.close();
