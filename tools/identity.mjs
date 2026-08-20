// Does a side look like itself everywhere?
//
// One palette now serves the map's borders, its party tokens, the bodies on
// a battlefield and the faces in a roster. The claim is that a Trust column
// is the same cold cyan in all four places, and that two soldiers from
// different places do not wear the same cloth. Both are checkable: sample
// the pixels a portrait actually draws, and read the material a token
// actually got.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
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

// ---- portraits: one shoulder pixel per origin --------------------------
const faces = await page.evaluate(async () => {
  const Roster = await import('/src/roster.js');
  const { ORIGINS, FACTION_SIGNAL } = await import('/src/data.js');
  const out = [];
  for (const origin of Object.keys(ORIGINS)) {
    const s = Roster.makeSoldier(Math.random, { origin });
    s.origin = origin;
    const img = Roster.portrait(s, 64);
    // Draw it and read the shoulder, which is where the cloth is.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const im = new Image();
    await new Promise((res) => { im.onload = res; im.src = img; });
    g.drawImage(im, 0, 0);
    const px = g.getImageData(8, 56, 1, 1).data;
    const hex = ((px[0] << 16) | (px[1] << 8) | px[2]).toString(16).padStart(6, '0');
    out.push({ origin, cloth: '#' + hex,
      signal: '#' + (FACTION_SIGNAL[origin] ?? 0).toString(16).padStart(6, '0') });
  }
  return out;
});
console.log('portrait cloth, by where the soldier came up:');
for (const f of faces) {
  console.log(`  ${f.origin.padEnd(10)} cloth ${f.cloth}   (signal ${f.signal})`);
}
const distinct = new Set(faces.map((f) => f.cloth)).size;
console.log(`  ${distinct} distinct of ${faces.length} origins`
  + `  ${distinct === faces.length ? 'OK — every origin reads differently' : 'SOME SHARE CLOTH'}`);

// ---- map tokens: the band itself, not the ring -------------------------
await page.evaluate(() => {
  document.getElementById('overlay')?.classList.add('hidden');
  window.KR.world?.setPaused(false);
});
await page.waitForTimeout(1500);
const tokens = await page.evaluate(() => {
  const W = window.KR.world, S = window.KR.campaign;
  const out = [];
  for (const p of S.parties.slice(0, 40)) {
    const m = W.partyMeshes?.get(p.id);
    if (!m) continue;
    let hex = null;
    m.traverse((o) => { if (!hex && o.isMesh && o.material?.color) hex = o.material.color.getHex(); });
    if (hex == null) continue;
    out.push({ faction: p.faction || (p.owner === 'player' ? 'player' : '—'),
      hex: '#' + hex.toString(16).padStart(6, '0') });
  }
  const byFaction = new Map();
  for (const t of out) if (!byFaction.has(t.faction)) byFaction.set(t.faction, t.hex);
  return { n: out.length, byFaction: [...byFaction] };
});
console.log(`\nparty tokens on the map (${tokens.n} sampled):`);
for (const [f, hex] of tokens.byFaction) console.log(`  ${String(f).padEnd(10)} ${hex}`);
const uniq = new Set(tokens.byFaction.map(([, h]) => h)).size;
console.log(`  ${uniq} distinct of ${tokens.byFaction.length} factions`
  + `  ${uniq === tokens.byFaction.length ? 'OK — each side reads differently' : 'SOME SHARE A COLOUR'}`);
console.log(errors.length ? `\n${errors.length} console errors:\n` + [...new Set(errors)].slice(0, 3).join('\n') : '\nno console errors');
await browser.close();
