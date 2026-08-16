// Small shared helpers. Kept deliberately tiny — anything that grows past a
// few lines belongs in the system that owns it.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Angle difference wrapped to [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Move `a` toward `b` by at most `max` radians. */
export function approachAngle(a, b, max) {
  const d = angleDelta(a, b);
  return a + clamp(d, -max, max);
}

/**
 * Deterministic PRNG (mulberry32). The campaign seeds one of these so a given
 * save regenerates identical world detail — patrol routes, mission layouts,
 * recruit names — instead of shimmering every time the player reloads.
 */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export const range = (r, lo, hi) => lo + r() * (hi - lo);
export const irange = (r, lo, hi) => Math.floor(lo + r() * (hi - lo + 1));

/** Fisher-Yates against a seeded rng. */
export function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _uid = 1;
export const uid = (p = 'id') => `${p}_${(_uid++).toString(36)}`;
export const setUidFloor = (n) => { _uid = Math.max(_uid, n); };
export const uidFloor = () => _uid;
