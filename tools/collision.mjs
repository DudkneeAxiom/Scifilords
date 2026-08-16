// Does the collision match what you can see?
//
// The report from play was: "certain structures aren't meshed well and while it
// seems empty your bullets can't go through the invisible walls." That is a
// measurable claim, not a matter of taste — every obstacle in a level is an
// axis-aligned box, and every prop is a mesh with a real bounding box, so the
// two can simply be compared.
//
// The number that matters is the ratio of declared footprint to drawn footprint.
// At 1.0 the box is the model. Much above 1.0 and there is invisible geometry
// stopping bullets in open air; much below 1.0 and shots pass through things
// that are plainly solid, which reads as just as broken.
import { chromium } from 'file:///C:/Users/xxwjs/SciFiLords/node_modules/playwright/index.mjs';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
// Models have to be in the cache before anything can be measured.
await page.click('button[data-act="new"]');
await page.waitForSelector('#modal .modal-title', { timeout: 60000 });
await page.click('#modal [data-x="close"]');
await page.waitForTimeout(400);

// ---- every prop in every layout, box against mesh ------------------------
const audit = await page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.min.js');
  const Models = await import('/src/models.js');
  const Level = await import('/src/level.js');

  // The real drawn extent of a model at scale 1.
  const meshBox = (name) => {
    const o = Models.get(name);
    if (!o) return null;
    const b = new THREE.Box3().setFromObject(o);
    if (!isFinite(b.min.x) || b.isEmpty()) return null;
    return {
      hw: (b.max.x - b.min.x) / 2,
      hd: (b.max.z - b.min.z) / 2,
      h: b.max.y - b.min.y,
    };
  };

  const layouts = ['grellan', 'rampart', 'perran', 'settlement', 'works', 'fort', 'reclaimer'];
  const rows = [];
  const seenModels = new Map();

  for (const id of layouts) {
    let lvl = null;
    try { lvl = Level.build(id, 7); } catch (e) { continue; }
    if (!lvl) continue;
    // Props and obstacles are built in lockstep, but only props carry a model
    // name — so match them back by position.
    for (const o of lvl.obstacles) {
      const p = (lvl.props || []).find((q) =>
        Math.abs(q.x - o.x) < 0.001 && Math.abs(q.z - o.z) < 0.001);
      if (!p) continue;
      const m = meshBox(p.model);
      if (!m) continue;
      const drawnHw = m.hw * p.scale, drawnHd = m.hd * p.scale, drawnH = m.h * p.scale;
      if (drawnHw < 0.01 || drawnHd < 0.01) continue;
      const areaBox = (o.hw * 2) * (o.hd * 2);
      const areaMesh = (drawnHw * 2) * (drawnHd * 2);
      rows.push({
        layout: id, model: p.model, scale: +p.scale.toFixed(2),
        boxHw: +o.hw.toFixed(2), boxHd: +o.hd.toFixed(2), boxH: +o.h.toFixed(2),
        meshHw: +drawnHw.toFixed(2), meshHd: +drawnHd.toFixed(2), meshH: +drawnH.toFixed(2),
        areaRatio: +(areaBox / areaMesh).toFixed(2),
        hRatio: +(o.h / Math.max(0.01, drawnH)).toFixed(2),
      });
      if (!seenModels.has(p.model)) seenModels.set(p.model, []);
      seenModels.get(p.model).push(areaBox / areaMesh);
    }
  }

  const perModel = [...seenModels.entries()].map(([model, rs]) => ({
    model, n: rs.length,
    worst: +Math.max(...rs).toFixed(2),
    median: +rs.sort((x, y) => x - y)[Math.floor(rs.length / 2)].toFixed(2),
  })).sort((a, b) => b.worst - a.worst);

  return { rows, perModel, total: rows.length };
});

if (!audit.total) {
  console.log('\nNo props could be matched to obstacles — level.build does not expose the');
  console.log('prop list, so the audit cannot line boxes up with meshes.');
} else {
  console.log(`\n=== footprint declared vs drawn (${audit.total} obstacles) ===`);
  console.log('  model              n   median   worst    (1.00 = the box is the model)');
  for (const m of audit.perModel) {
    const flag = m.worst > 4 ? '  <-- invisible wall' : (m.worst < 0.4 ? '  <-- shoots through' : '');
    console.log(`  ${m.model.padEnd(16)} ${String(m.n).padStart(3)}   `
      + `${m.median.toFixed(2).padStart(6)}  ${m.worst.toFixed(2).padStart(6)}${flag}`);
  }

  const bad = audit.rows.filter((r) => r.areaRatio > 4).sort((a, b) => b.areaRatio - a.areaRatio);
  console.log(`\n=== the worst individual offenders ===`);
  for (const r of bad.slice(0, 10)) {
    console.log(`  ${r.layout}/${r.model} scale ${r.scale}: box ${r.boxHw}x${r.boxHd}`
      + ` vs mesh ${r.meshHw}x${r.meshHd} — ${r.areaRatio}x the area, ${r.hRatio}x the height`);
  }
  const overArea = audit.rows.filter((r) => r.areaRatio > 4).length;
  console.log(`\n  ${overArea} of ${audit.total} obstacles cover 4x their drawn footprint or more`);
}

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log('  ' + e);
await browser.close();
