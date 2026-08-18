// The shape of the continent, and what crossing it costs.
//
// This exists so the simulation and the renderer can agree about the ground.
// regionHeight() used to live in worldmap.js, which imports state.js — so
// state.js could not read the terrain back without a cycle, and the strategic
// layer moved parties across a landscape it could not see. Everything here is
// pure geometry: no Three.js, no DOM, nothing that cannot be driven headlessly.

import { LOCATIONS, REGION } from './data.js';
import { clamp } from './util.js';

export const HALF = REGION.size / 2;

// Bearings for the terrain octaves, precomputed because regionHeight() is
// called for every terrain vertex, every border sample and every label, frame
// after frame.
const A1 = 0.00, A2 = 0.85, A3 = 2.20;
const C1 = Math.cos(A1), S1 = Math.sin(A1);
const C2 = Math.cos(A2), S2 = Math.sin(A2);
const C3 = Math.cos(A3), S3 = Math.sin(A3);

/**
 * The shape of the Reach.
 *
 * The interior used to have nothing in it above a 1000-unit wavelength, which
 * at this camera height means barely one undulation on screen — so a continent
 * built to be crossed read as a flat brown plate with a wall around it. The
 * terrain now runs in bands: the rim that encloses the region, long ranges that
 * divide it into country, hills that give each stretch of road a profile, and
 * finer grain for the close zoom.
 *
 * Nothing here goes below ~140 units of wavelength on purpose. The mesh samples
 * every ~35 units, and an earlier version carried grain at 30 and 82 — under
 * and barely over the sample spacing — which does not render as texture, it
 * renders as per-vertex speckle. That was the "pixel" look: aliasing, not art.
 *
 * Each octave is sampled on its own rotated axes. Sampling every band on the
 * same two axes does not make hills, it makes corduroy: all the ridges come out
 * parallel and the continent reads as a ploughed field seen from orbit.
 */
const smooth01 = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

// Settlements in the outer provinces, precomputed for the rim carve below.
// Only places past half-radius matter — the interior never meets the rim.
const OUTER_TOWNS = LOCATIONS
  .filter((l) => Math.hypot(l.x, l.z) / HALF > 0.5)
  .map((l) => ({ x: l.x, z: l.z }));

/**
 * The highland wall, and the world beyond it.
 *
 * The old rim was a radial power curve: a circular wall at a fixed distance,
 * rising forever. Three things were wrong with that. It was CONCENTRIC, so
 * from any height the region read as a round board with a raised edge. It
 * BURIED half the outer provinces — a dozen settlements sit at 0.56..0.84 of
 * the region radius, inside what the curve had already made mountains. And it
 * never came DOWN, so there was no "over the crest": the world visibly ended
 * at a wall rather than continuing past it.
 *
 * Now the rim is a mountain BAND with an angular profile — its start, height
 * and thickness all vary by bearing, so no circle is ever visible — it falls
 * away on the far side into outer country that runs to the horizon, and it is
 * CARVED: roads cut passes through it and every outer settlement sits in its
 * own cleared basin. Geography does the enclosing, not geometry.
 */
function rimAndBeyond(x, z, d) {
  if (d < 0.52) return 0;
  const th = Math.atan2(z, x);
  const start = 0.80 + 0.05 * Math.sin(th * 3 + 0.9) + 0.035 * Math.sin(th * 7 - 1.4);
  const height = 220 * (1 + 0.45 * Math.sin(th * 2 + 2.2) * Math.sin(th * 5 - 0.7));
  const up = smooth01((d - start) / 0.26);
  const down = smooth01((d - start - 0.30) / 0.42);
  let rim = (up - down * 0.74) * height;

  // Passes. A road that meets the wall goes THROUGH it — a saddle, not a
  // climb — and an outer town stands in a basin the mountains stand around.
  // This is also what keeps every settlement in the outer provinces livable.
  if (rim > 0) {
    let carve = clamp(1 - roadDistance(x, z) / 210, 0, 1) * 0.78;
    for (const t of OUTER_TOWNS) {
      const w = clamp(1 - Math.hypot(x - t.x, z - t.z) / 320, 0, 1);
      if (w > carve) carve = w;
    }
    rim *= 1 - smooth01(carve) * 0.92;
  }

  // Over the crest the world CONTINUES: a high outer steppe with its own
  // ranges, running out to the mesh edge and into the haze. Nothing out
  // there is reachable; all of it is the reason the Reach reads as one
  // region of a continent rather than the whole of one.
  const beyond = smooth01((d - 1.02) / 0.4);
  const outer = beyond * (46
    + Math.sin(x * 0.0041 + 2.0) * Math.cos(z * 0.0037 - 0.9) * 52
    + Math.sin(x * 0.0016 - 0.6) * Math.cos(z * 0.0019 + 1.3) * 30);
  return rim + outer;
}

export function regionHeight(x, z) {
  const d = Math.hypot(x, z) / HALF;
  const rim = rimAndBeyond(x, z, d);
  // Continental tilt: which half of the map is high country at all.
  const swell = Math.sin(x * 0.0011 + 0.7) * Math.cos(z * 0.0013 - 0.3) * 34;
  const rx1 = x * C1 - z * S1, rz1 = x * S1 + z * C1;
  const rx2 = x * C2 - z * S2, rz2 = x * S2 + z * C2;
  const rx3 = x * C3 - z * S3, rz3 = x * S3 + z * C3;
  const ranges = Math.sin(rx1 * 0.0070 + 1.2) * Math.cos(rz1 * 0.0064 - 0.4) * 46;
  const hills = Math.sin(rx2 * 0.0165 - 0.9) * Math.cos(rz2 * 0.0172 + 0.5) * 21
    + Math.cos(rx3 * 0.0139 + 2.1) * Math.sin(rz3 * 0.0128 - 1.1) * 13;
  const broken = Math.sin(rx3 * 0.0370 + 0.3) * Math.cos(rz1 * 0.0355 - 0.8) * 7;
  const grain = Math.sin(rx2 * 0.0450 - 1.4) * Math.cos(rz3 * 0.0435 + 0.9) * 3.5;
  // Relief grows toward the rim: the pan stays walkable, the edges get savage.
  const relief = 0.55 + Math.min(d, 1.1) * 0.9;
  return rim + swell + (ranges + hills + broken + grain) * relief;
}

/**
 * Keep a mover inside the world that can be walked. The limit follows the
 * rim's own angular profile — the fence IS the geography — replacing the old
 * rectangular clamp, whose corners reached 1.37 of the region radius: deep
 * inside the mountains, on ground no road has ever led to.
 */
export function clampToRegion(x, z) {
  const d = Math.hypot(x, z) / HALF;
  const th = Math.atan2(z, x);
  const limit = 0.86 + 0.05 * Math.sin(th * 3 + 0.9) + 0.035 * Math.sin(th * 7 - 1.4);
  if (d <= limit) return { x, z };
  const k = (limit * HALF) / Math.hypot(x, z);
  return { x: x * k, z: z * k };
}

/**
 * How wet a place is, 0 dry to 1 wet. Low frequency on purpose — biomes have to
 * be large enough to be somewhere you are, rather than a per-vertex mottle —
 * but not SO low that a whole screen sits inside one band and the map looks
 * uniform, which is what a 7400-unit wavelength did against a 2000-unit view.
 */
export function regionMoisture(x, z) {
  const m = Math.sin(x * 0.0022 - 1.1) * Math.cos(z * 0.0025 + 0.6) * 0.42
    + Math.sin(x * 0.0048 + 2.3) * Math.cos(z * 0.0043 - 0.7) * 0.2
    + Math.sin(x * 0.00082 + 0.4) * 0.16;      // a damp half and a dry half
  return clamp(0.5 + m, 0, 1);
}

// Roads are authored, not generated — they are the routes the player will
// actually learn, and one of them (Vetch → Sump → west) only matters after the
// north rim goes dark.
export const ROADS = [
  ['dolmet', 'rampart'],
  ['dolmet', 'vetch'],
  ['vetch', 'perran'],
  ['perran', 'grellan'],
  ['vetch', 'sump'],
  ['sump', 'dolmet'],
  ['rampart', 'grellan'],
  // The wider Reach.
  ['rampart', 'lowmark'],
  ['lowmark', 'grellan'],
  ['perran', 'kestrel'],
  ['kestrel', 'grellan'],
  ['sump', 'harrow'],
  ['harrow', 'culvert'],
  ['culvert', 'dolmet'],
  ['vetch', 'pale'],
  ['pale', 'harrow'],
  // ---- trunk roads out of the Reach to the rest of the continent ----
  ['rampart', 'pellcross'],
  ['lowmark', 'sarnhold'],
  ['sarnhold', 'vantree'],
  ['sarnhold', 'pellcross'],
  ['sarnhold', 'meridian'],
  ['pellcross', 'vantree'],
  // Pickets sit ON the routes they watch, or they watch nothing.
  ['dolmet', 'relay12'],
  ['relay12', 'sarnhold'],
  ['perran', 'tollgate'],
  ['tollgate', 'wealbastion'],
  ['gantry', 'anchorage'],
];

// Resolved once. The road list is names; the maths wants coordinates, and this
// is consulted for every party on every world tick.
const ROAD_SEGS = [];
for (const [a, b] of ROADS) {
  const la = LOCATIONS.find((l) => l.id === a);
  const lb = LOCATIONS.find((l) => l.id === b);
  if (la && lb) ROAD_SEGS.push({ ax: la.x, az: la.z, bx: lb.x, bz: lb.z });
}

/** Distance from a point to the nearest authored road. */
export function roadDistance(x, z) {
  let best = Infinity;
  for (const s of ROAD_SEGS) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    let t = len2 ? ((x - s.ax) * dx + (z - s.az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = s.ax + dx * t, pz = s.az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

// How wide a road's benefit reaches, and what it is worth. A road you have to
// be exactly on top of is a road nobody uses; one that helps from a province
// away is not a road at all.
const ROAD_REACH = 90;
const ROAD_BONUS = 0.34;

/**
 * What the ground does to anything crossing it, as a speed multiplier.
 *
 * The map had real terrain and movement ignored all of it: a company crossed a
 * mountain range at exactly the speed it crossed a dry pan, which makes the
 * landscape scenery. Now slope costs you and roads pay you back, so the line
 * between two places is a decision rather than a straight edge — and it feeds
 * the chase, because the band behind you is subject to the same ground.
 *
 * Deliberately bounded. Terrain that can halve your speed turns a bad route
 * into a lost campaign, and this is a strategic layer, not a survival game.
 */
export function travelFactor(x, z) {
  const S = 40;
  const gx = (regionHeight(x + S, z) - regionHeight(x - S, z)) / (2 * S);
  const gz = (regionHeight(x, z + S) - regionHeight(x, z - S)) / (2 * S);
  const slope = Math.hypot(gx, gz);
  // Normalised so ORDINARY ground is neutral.
  //
  // Without the constant this returned 0.65 on average, which is not a terrain
  // rule at all — it is a thirty-five per cent tax on every journey in the
  // game, quietly re-pricing every contract deadline and wage day that was
  // balanced without it. Terrain should decide which route is better, not make
  // all of them worse. NORM is the reciprocal of the mean factor measured
  // across the playable area, so a typical stretch of country comes out at 1.
  const NORM = 1.52;
  const rough = NORM / (1 + slope * 1.9);
  const road = clamp(1 - roadDistance(x, z) / ROAD_REACH, 0, 1) * ROAD_BONUS;
  return clamp(rough * (1 + road), 0.72, 1.26);
}
