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
export function regionHeight(x, z) {
  const d = Math.hypot(x, z) / HALF;
  // The rim starts much further out on a continent — the playable interior has
  // to be genuinely large, with the highlands only closing in at the edges.
  const rim = Math.pow(clamp((d - 0.66) / 0.34, 0, 1), 1.7) * 240;
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
  const relief = 0.55 + d * 0.9;
  return rim + swell + (ranges + hills + broken + grain) * relief;
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
