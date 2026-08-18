// Navigation for the deployment layer.
//
// Local steering alone cannot get a soldier around a building — it slides them
// along the wall until the wall happens to end, which looks like the AI has no
// idea where it is going, and makes a flank order across a container yard
// useless. This is a coarse occupancy grid with A* over it, plus a string-pull
// pass so the resulting path is a handful of corners rather than a staircase.
//
// The grid is deliberately coarse (1.5m). It is rebuilt once per deployment
// and queried a few times a second by at most a dozen agents, so the cost is
// irrelevant and the resolution is enough for the open industrial sites here.

const CELL = 1.5;
const DIAG = Math.SQRT2;

export class NavGrid {
  /**
   * @param obstacles level obstacle boxes
   * @param bounds    half-extent of the playable square
   * @param radius    agent radius, inflated into the blocked set
   */
  constructor(obstacles, bounds, radius = 0.6) {
    this.bounds = bounds;
    this.size = Math.ceil((bounds * 2) / CELL) + 1;
    this.blocked = new Uint8Array(this.size * this.size);

    for (const o of obstacles) {
      // Only things tall enough to actually stop a person block movement;
      // ankle-height scenery should not carve holes in the navigation.
      if ((o.coverH ?? o.h) < 0.7) continue;
      // Walkable tops — stair treads, catwalk decking, crates — are ROUTES,
      // not walls. Blocking them meant no path ever led up a flight of
      // stairs, which is why ordered troops stood at the foot of a wall walk
      // they were told to hold. The blocked set stays two-dimensional; the
      // vertical legality of each step is resolveMove's job (feet + STEP_UP).
      if (o.walk) continue;
      const pad = radius;
      const minX = o.x - o.hw - pad, maxX = o.x + o.hw + pad;
      const minZ = o.z - o.hd - pad, maxZ = o.z + o.hd + pad;
      const c0 = this.cellOf(minX, minZ), c1 = this.cellOf(maxX, maxZ);
      for (let gz = c0.gz; gz <= c1.gz; gz++) {
        for (let gx = c0.gx; gx <= c1.gx; gx++) {
          if (gx < 0 || gz < 0 || gx >= this.size || gz >= this.size) continue;
          this.blocked[gz * this.size + gx] = 1;
        }
      }
    }

    // Scratch buffers reused across queries so pathing allocates nothing.
    this.g = new Float32Array(this.size * this.size);
    this.f = new Float32Array(this.size * this.size);
    this.from = new Int32Array(this.size * this.size);
    this.state = new Uint8Array(this.size * this.size);
    this.stamp = new Int32Array(this.size * this.size);
    this.run = 0;
    this.open = [];
  }

  cellOf(x, z) {
    return {
      gx: Math.round((x + this.bounds) / CELL),
      gz: Math.round((z + this.bounds) / CELL),
    };
  }

  worldOf(gx, gz) {
    return { x: gx * CELL - this.bounds, z: gz * CELL - this.bounds };
  }

  inside(gx, gz) {
    return gx >= 0 && gz >= 0 && gx < this.size && gz < this.size;
  }

  isBlocked(gx, gz) {
    if (!this.inside(gx, gz)) return true;
    return this.blocked[gz * this.size + gx] === 1;
  }

  isBlockedWorld(x, z) {
    const c = this.cellOf(x, z);
    return this.isBlocked(c.gx, c.gz);
  }

  /** Nearest open cell, spiralling outward. Used when a target sits in a wall. */
  nearestOpen(gx, gz, maxRing = 8) {
    if (!this.isBlocked(gx, gz)) return { gx, gz };
    for (let r = 1; r <= maxRing; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = gx + dx, nz = gz + dz;
          if (!this.isBlocked(nx, nz)) return { gx: nx, gz: nz };
        }
      }
    }
    return null;
  }

  /** True if a straight line between two world points stays on open ground. */
  lineClear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) / (CELL * 0.5));
    if (steps <= 0) return true;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlockedWorld(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /**
   * A* between two world points. Returns an array of world waypoints
   * (excluding the start), or null when no route exists.
   */
  findPath(ax, az, bx, bz, maxNodes = 4000) {
    // The overwhelmingly common case: nothing in the way at all.
    if (this.lineClear(ax, az, bx, bz)) return [{ x: bx, z: bz }];

    const s = this.cellOf(ax, az);
    const e = this.cellOf(bx, bz);
    const start = this.nearestOpen(s.gx, s.gz);
    const goal = this.nearestOpen(e.gx, e.gz);
    if (!start || !goal) return null;

    const N = this.size;
    const sIdx = start.gz * N + start.gx;
    const gIdx = goal.gz * N + goal.gx;
    if (sIdx === gIdx) return [{ x: bx, z: bz }];

    this.run++;
    const run = this.run;
    const { g, f, from, state, stamp } = this;
    const open = this.open;
    open.length = 0;

    const h = (i) => {
      const gx = i % N, gz = (i / N) | 0;
      return Math.hypot(gx - goal.gx, gz - goal.gz);
    };

    stamp[sIdx] = run; g[sIdx] = 0; f[sIdx] = h(sIdx); from[sIdx] = -1; state[sIdx] = 1;
    open.push(sIdx);

    let expanded = 0;
    while (open.length) {
      // Linear scan for the cheapest node. The frontier stays small at this
      // grid size, and a scan beats maintaining a heap here.
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();

      if (cur === gIdx) return this.reconstruct(cur, bx, bz);
      if (++expanded > maxNodes) return null;
      state[cur] = 2;

      const cx = cur % N, cz = (cur / N) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (this.isBlocked(nx, nz)) continue;
          // No cutting diagonally through the corner of a solid.
          if (dx && dz && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
          const ni = nz * N + nx;
          if (stamp[ni] === run && state[ni] === 2) continue;
          const step = dx && dz ? DIAG : 1;
          const tentative = g[cur] + step;
          if (stamp[ni] !== run) {
            stamp[ni] = run; state[ni] = 0; g[ni] = Infinity;
          }
          if (tentative < g[ni]) {
            g[ni] = tentative;
            f[ni] = tentative + h(ni);
            from[ni] = cur;
            if (state[ni] !== 1) { state[ni] = 1; open.push(ni); }
          }
        }
      }
    }
    return null;
  }

  reconstruct(endIdx, bx, bz) {
    const N = this.size;
    const cells = [];
    let cur = endIdx;
    while (cur !== -1) {
      cells.push(cur);
      cur = this.from[cur];
    }
    cells.reverse();
    const pts = cells.map((i) => this.worldOf(i % N, (i / N) | 0));
    pts.push({ x: bx, z: bz });
    return this.smooth(pts);
  }

  /**
   * String-pulling: drop any waypoint that can be skipped with a clear straight
   * line. Turns a 40-cell staircase into three or four real corners, which is
   * what stops the movement looking like grid-walking.
   */
  smooth(pts) {
    if (pts.length <= 2) return pts.slice(1);
    const out = [];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.lineClear(pts[anchor].x, pts[anchor].z, pts[i].x, pts[i].z)) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
}
