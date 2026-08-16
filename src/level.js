// Deployment site construction.
//
// Levels are assembled from the Blender kit into three hand-laid layouts, one
// per mission template. They are not procedural mazes — each site has an
// intended approach, a piece of ground worth fighting over, and an extraction
// that is deliberately not where you started.
//
// Ground is a gently displaced plane. Everything that moves samples the same
// heightAt() the mesh was built from, so nothing ever floats or sinks.

import * as THREE from '../vendor/three/three.module.min.js';
import * as Models from './models.js';
import { rng, range, irange, pick } from './util.js';

// --------------------------------------------------------------------------
// Terrain
// --------------------------------------------------------------------------

/**
 * Basin floor. Deliberately shallow relief — this is a drained industrial
 * pan, and flat ground keeps sightlines honest and AI pathing reliable.
 */
export function heightAt(x, z) {
  // Kept shallow on purpose, and it is a constraint rather than a preference.
  //
  // Real relief was tried — swells of five metres across the enlarged pan — and
  // it broke the game underneath: every obstacle is an axis-aligned box
  // anchored to ONE ground sample, so a nine-metre rampart standing across a
  // slope has daylight under one end and rounds go beneath the wall. Closing
  // that by sinking the boxes changes what an obstacle's height means, and its
  // height is what classifies it as shoot-over cover, so the cover list empties.
  // Making the ground properly three-dimensional needs obstacles that follow
  // the terrain, which is a larger job than a visual tweak.
  //
  // Depth in the sites comes from fog range, structure and scatter instead.
  return (
    Math.sin(x * 0.021) * Math.cos(z * 0.019) * 0.75 +
    Math.sin(x * 0.058 + 1.7) * 0.28 +
    Math.cos(z * 0.047 - 0.6) * 0.24
  );
}

function buildGround(size, colorTop, colorLow) {
  // Enough segments that the swells read as ground and not as facets. The
  // pan is now more than twice as wide, so the old grid gave a 5m triangle.
  const seg = 150;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cTop = new THREE.Color(colorTop);
  const cLow = new THREE.Color(colorLow);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    // Vertex colour by height plus a coarse blotch, so the floor has grain
    // without a texture. Low ground is darker and wetter-looking.
    const n = (Math.sin(x * 0.13) * Math.cos(z * 0.11) + 1) * 0.5;
    c.copy(cLow).lerp(cTop, Math.min(1, Math.max(0, (y + 1.1) / 2.0 * 0.7 + n * 0.4)));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// --------------------------------------------------------------------------
// Placement helpers
// --------------------------------------------------------------------------

class Builder {
  constructor(seed) {
    this.r = rng(seed);
    this.props = [];
    this.obstacles = [];
    this.covers = [];
  }

  /**
   * Place a kit model. `box` is the collision footprint [halfWidth, halfDepth,
   * height]; omit it for scenery that should not block movement or bullets.
   */
  prop(model, x, z, ry = 0, box = null, scale = 1, yOff = 0) {
    this.props.push({ model, x, z, ry, scale, y: heightAt(x, z) + yOff });
    // 'auto' takes the footprint from the mesh itself. Anything placed at a
    // random scale must use it — a hand-written box multiplied by a random
    // number stops bearing any relation to what is drawn.
    if (box === 'auto') {
      const fp = Models.footprint(model);
      box = fp ? [fp.hw, fp.hd, fp.h] : null;
    }
    if (box) {
      const [hw, hd, h] = box;
      // Footprints stay axis-aligned at right-angle rotations so collision
      // and line-of-sight stay exact and cheap.
      const swap = Math.abs(Math.sin(ry)) > 0.7;
      const o = {
        x, z,
        hw: (swap ? hd : hw) * scale,
        hd: (swap ? hw : hd) * scale,
        h: h * scale,
        y: heightAt(x, z),
      };
      this.obstacles.push(o);
      if (h <= 1.7) this.covers.push(o); // low enough to shoot over
    }
    return this;
  }

  /**
   * A piece of ground above the ground.
   *
   * Marked walkable, so surfaceAt() will stand a soldier on it and resolveMove
   * will let them walk across rather than into it. Everything else about it is
   * an ordinary obstacle: it blocks movement and stops bullets from below,
   * which is what makes an elevated firing position worth taking and worth
   * shooting at.
   */
  deck(model, x, z, ry, box, scale = 1, lift = 0) {
    this.props.push({ model, x, z, ry, scale, y: heightAt(x, z) + lift });
    const [hw, hd] = box;
    const swap = Math.abs(Math.sin(ry)) > 0.7;
    // The collision is the DECKING, not the whole model. A walkway's walkable
    // surface is the plate you stand on; taking the model's full height would
    // put the floor at the top of its railings, several metres above where it
    // is drawn, and make the underside a solid pillar.
    const o = {
      x, z,
      hw: (swap ? hd : hw) * scale,
      hd: (swap ? hw : hd) * scale,
      h: 0.25,
      y: heightAt(x, z) + lift,
      walk: true,
    };
    this.obstacles.push(o);
    return this;
  }

  /**
   * Is there room here, clear of everything already placed?
   *
   * `ignoreWalk` skips decks and other stairs, which a flight is expected to
   * meet rather than avoid — without it a staircase can never touch the walkway
   * it climbs to, and every candidate approach is rejected.
   */
  clear(x, z, r, ignoreWalk = false) {
    for (const o of this.obstacles) {
      if (ignoreWalk && o.walk) continue;
      if (Math.abs(x - o.x) < o.hw + r && Math.abs(z - o.z) < o.hd + r) return false;
    }
    return true;
  }

  /**
   * A flight of stairs up to `top`, placed on whichever of the offered
   * approaches is actually clear.
   *
   * Hand-picked stair coordinates went straight through a fuel tank that had
   * been standing there since the layout was written — the flight looked right
   * in the source and was impassable in play. Letting the builder check its own
   * ground is the difference between a level that reads correctly and one that
   * works.
   */
  stairsTo(edges, top, width = 2.2) {
    const n = Math.max(1, Math.round(top / 0.5));
    // Each candidate says where the flight must ARRIVE — the lip of the deck —
    // and which way it climbs. The foot is derived from that, so a flight can
    // never end three metres short of the thing it is supposed to reach, which
    // is what happens when the start is specified by hand instead.
    for (const [edgeX, edgeZ, dirX, dirZ] of edges) {
      const footX = edgeX - dirX * n;
      const footZ = edgeZ - dirZ * n;
      let ok = true;
      for (let i = 1; i <= n && ok; i++) {
        if (!this.clear(footX + dirX * i, footZ + dirZ * i, width / 2 + 0.3, true)) ok = false;
      }
      if (ok) { this.steps(footX, footZ, top, dirX, dirZ, width); return true; }
    }
    return false;
  }

  steps(x, z, top, dirX, dirZ, width = 2.2) {
    const rise = 0.5;
    const n = Math.max(1, Math.round(top / rise));
    for (let i = 1; i <= n; i++) {
      // One metre of run per half-metre of rise. Kept tight on purpose: a
      // shallower flight has to start so far out that the treads end up
      // underneath the deck they climb to, and then the underside of the deck
      // stops being headroom and becomes a wall halfway up.
      const sx = x + dirX * i * 1.0;
      const sz = z + dirZ * i * 1.0;
      const h = (i / n) * top;
      // Draw the whole tread, not one crate on top of four metres of nothing.
      //
      // Each step used to place a single crate against a collision box as tall
      // as the step itself — by the top of a flight that was a 0.94m crate in
      // front of a 4.1m wall. Rounds stopped in mid air, which is precisely the
      // invisible geometry the collision audit was written to catch; it only
      // ever compared FOOTPRINT AREA and never height, so a box the right width
      // and four times too tall sailed through it.
      const CRATE_H = 0.94;
      for (let s = 0; s * CRATE_H < h - 0.05; s++) {
        this.props.push({
          model: 'crate', x: sx, z: sz, ry: 0, scale: 1,
          y: heightAt(sx, sz) + s * CRATE_H,
        });
      }
      // A tread is exactly as deep as the stride between treads. Making them
      // wider than the spacing means every tread overlaps the two beyond it, so
      // a climber standing on the first is already inside the third — which is
      // too tall to step onto and pushes them back down the flight.
      const along = Math.abs(dirX) > 0;
      this.obstacles.push({
        x: sx, z: sz,
        hw: along ? 0.5 : width / 2,
        hd: along ? width / 2 : 0.5,
        h,
        y: heightAt(sx, sz), walk: true,
      });
    }
    return this;
  }

  scatter(models, n, cx, cz, radius, boxFn = null) {
    for (let i = 0; i < n; i++) {
      const a = this.r() * Math.PI * 2;
      const d = Math.sqrt(this.r()) * radius;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const m = pick(this.r, models);
      this.prop(m, x, z, this.r() * Math.PI * 2, boxFn ? boxFn(m) : null,
        range(this.r, 0.8, 1.35));
    }
  }

  /**
   * The edge of the site: a broken ridge, not a fence.
   *
   * This used to lay an even ring of rocks at a fixed radius, which made every
   * deployment the same shape — a small circular arena with a kerb round it.
   * You could read the boundary at a glance and there was nothing beyond it.
   *
   * Now the rim wanders in and out, opens into gaps where the ground leads
   * somewhere, and thins into outlying stone rather than stopping dead. The
   * point is that the edge should be somewhere you stop bothering to go, not a
   * wall you can see.
   */
  rim(radius, count = 96) {
    // Three or four mouths in the ring: approaches, and lines of retreat.
    const gaps = [];
    const nGaps = irange(this.r, 3, 4);
    for (let g = 0; g < nGaps; g++) {
      gaps.push({ at: (g / nGaps) * Math.PI * 2 + range(this.r, -0.5, 0.5), w: range(this.r, 0.28, 0.5) });
    }
    const inGap = (a) => gaps.some((g) => {
      let d = Math.abs(((a - g.at + Math.PI) % (Math.PI * 2)) - Math.PI);
      return d < g.w;
    });

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + range(this.r, -0.03, 0.03);
      if (inGap(a)) continue;
      // A wandering edge rather than a drawn circle.
      const wobble = Math.sin(a * 2.3) * 11 + Math.cos(a * 3.7 + 1.1) * 7;
      const d = radius + wobble + range(this.r, -6, 10);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (this.r() < 0.2) {
        this.prop('dead_tree', x, z, this.r() * 6.28, null, range(this.r, 0.8, 1.4));
      } else {
        this.prop(pick(this.r, ['rock_0', 'rock_1', 'rock_2', 'rock_3']), x, z,
          this.r() * 6.28, 'auto', range(this.r, 1.8, 3.8));
      }
      // Outlying stone, so the ridge frays instead of ending.
      if (this.r() < 0.45) {
        const od = d + range(this.r, 10, 30);
        this.prop(pick(this.r, ['rock_0', 'rock_1', 'rock_2', 'rock_3']),
          Math.cos(a + range(this.r, -0.1, 0.1)) * od,
          Math.sin(a + range(this.r, -0.1, 0.1)) * od,
          this.r() * 6.28, 'auto', range(this.r, 1.4, 3.0));
      }
    }
  }

  /**
   * Fill the ground between the objective and the rim.
   *
   * Enlarging the field is worthless if the extra space is empty — a longer walk
   * across nothing is worse than a small arena. This scatters clusters of hard
   * cover across the middle distance, in clumps rather than evenly, so crossing
   * the site is a series of decisions about which piece to run to next.
   */
  outskirts(inner, outer, clusters = 14) {
    for (let c = 0; c < clusters; c++) {
      const a = this.r() * Math.PI * 2;
      const d = inner + Math.sqrt(this.r()) * (outer - inner);
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      if (!this.clear(cx, cz, 7)) continue;
      const kind = this.r();
      if (kind < 0.3) {
        // A wrecked vehicle and the stuff that spilled out of it.
        this.prop('truck_wreck', cx, cz, this.r() * 6.28, BOX.truck_wreck, 1);
        for (let i = 0; i < irange(this.r, 1, 3); i++) {
          this.prop('crate', cx + range(this.r, -4, 4), cz + range(this.r, -4, 4),
            this.r() * 6.28, BOX.crate, 1);
        }
      } else if (kind < 0.55) {
        // A firing position somebody left behind.
        for (let i = 0; i < irange(this.r, 2, 4); i++) {
          const aa = this.r() * Math.PI * 2;
          this.prop('sandbags', cx + Math.cos(aa) * 2.4, cz + Math.sin(aa) * 2.4,
            aa + Math.PI / 2, BOX.sandbags, 1.1);
        }
      } else if (kind < 0.78) {
        this.prop('container', cx, cz, this.r() < 0.5 ? 0 : Math.PI / 2, BOX.container, 1);
        if (this.r() < 0.5) {
          this.prop('container', cx + range(this.r, -7, 7), cz + range(this.r, -7, 7),
            Math.PI / 2, BOX.container, 1);
        }
      } else {
        for (let i = 0; i < irange(this.r, 2, 5); i++) {
          this.prop(pick(this.r, ['rock_0', 'rock_1', 'rock_2', 'rock_3']),
            cx + range(this.r, -6, 6), cz + range(this.r, -6, 6),
            this.r() * 6.28, 'auto', range(this.r, 1.2, 2.4));
        }
      }
    }
  }

  /** Kept so existing layouts keep working; the rim is the real edge now. */
  perimeter(radius) { this.rim(radius * 1.7); }
}

// Collision footprints for the kit, in metres. Measured from the Blender source.
const BOX = {
  bunker: [3.6, 3.1, 3.6],
  hab_block: [3.1, 2.6, 6.6],
  watchtower: [1.8, 1.8, 6.2],
  comms_mast: [1.7, 1.7, 4.0],
  radar_dish: [1.4, 1.4, 4.0],
  container: [2.9, 1.3, 2.5],
  crate: [0.6, 0.6, 0.95],
  barrier: [1.35, 0.5, 1.1],
  // Cover has to be exactly where it is drawn, or the player learns to distrust
  // it — these were blocking well outside the visible bags and pipework.
  sandbags: 'auto',
  fuel_tank: [2.0, 2.4, 4.6],
  generator: [1.7, 1.1, 1.6],
  truck_wreck: [1.3, 2.9, 2.3],
  blast_door: [2.7, 0.5, 4.4],
  pipe_run: 'auto',
  // Was a quarter of its drawn footprint: you could shoot through the sides of
  // a booth that plainly is not open.
  checkpoint: 'auto',
  catwalk: [4.1, 1.0, 3.8],
  antenna_small: [0.5, 0.5, 1.0],
  // Tall enough that nothing shoots over it and nobody walks through it. The
  // wall is the whole reason a siege is a different problem from a firefight.
  rampart: [4.6, 0.9, 6.2],
  gate: [3.6, 1.2, 6.4],
  gate_tower: [1.3, 1.3, 7.2],
};

// --------------------------------------------------------------------------
// Site layouts
// --------------------------------------------------------------------------

function siteGrellan(b) {
  // GRELLAN ARRAY — the dead deep-signal station. The player comes in from the
  // south road, works up through the pylon yard, and finds the holding pen in
  // the lee of the dish. Extraction is back down the road, so recovering the
  // prisoners means walking the length of the site again with slower people.
  b.prop('radar_dish', 0, -18, 0, BOX.radar_dish, 2.4);
  b.prop('bunker', -22, -12, Math.PI / 2, BOX.bunker, 1.1);
  b.prop('blast_door', -22, -1.5, 0, BOX.blast_door, 1.0);

  // Pylon yard — containers in rough rows make lanes and crossings.
  const rows = [[-30, 12], [-16, 16], [-2, 12], [12, 17], [26, 11]];
  rows.forEach(([x, z], i) => {
    b.prop('container', x, z, i % 2 ? Math.PI / 2 : 0, BOX.container, 1);
    if (i % 2 === 0) b.prop('container', x + 3, z + 9, Math.PI / 2, BOX.container, 1);
  });
  b.prop('catwalk', -8, 20, 0, BOX.catwalk, 1);
  b.prop('pipe_run', 18, -6, Math.PI / 2, BOX.pipe_run, 1);
  b.prop('pipe_run', 18, 8, Math.PI / 2, BOX.pipe_run, 1);

  // Holding pen: sandbag horseshoe behind the dish. Cover for the defenders,
  // and an obvious "something is kept here" read from a distance.
  b.prop('sandbags', 4, -30, 0, BOX.sandbags, 1.2);
  b.prop('sandbags', 10, -28, -0.5, BOX.sandbags, 1.2);
  b.prop('sandbags', -2, -28, 0.5, BOX.sandbags, 1.2);
  b.prop('generator', 12, -34, 0, BOX.generator, 1);
  b.prop('crate', 6, -34, 0.3, BOX.crate, 1);
  b.prop('crate', 7.4, -33, 1.1, BOX.crate, 1);
  b.prop('antenna_small', -6, -36, 0, BOX.antenna_small, 1);

  b.prop('truck_wreck', -12, 30, 0.6, BOX.truck_wreck, 1);
  b.prop('truck_wreck', 22, 26, -1.2, BOX.truck_wreck, 1);
  b.prop('barrier', -4, 34, 0, BOX.barrier, 1);
  b.prop('barrier', 2, 34, 0, BOX.barrier, 1);
  b.scatter(['crate'], 7, 0, 0, 34, () => BOX.crate);
  b.scatter(['rock_0', 'rock_1', 'rock_2', 'rock_3'], 16, 0, 0, 46);
  b.perimeter(58);

  return {
    name: 'GRELLAN ARRAY',
    // Grellan sits under a dirty overcast — cold haze, weak ochre sun.
    palette: { fog: 0x4a4a44, ground: 0x4c4a3c, groundLow: 0x2a2a22, sky: 0x3e4044, sun: 0xd8bd8a, sunI: 3.0, amb: 0x5a6470, ambI: 1.9 },
    playerSpawn: { x: 0, z: 44, ry: 0 },
    extraction: { x: 0, z: 46 },
    enemyFaction: 'raider',
    objectivePoint: { x: 4, z: -31 },
    garrison: [[6, -24], [-4, -24], [12, -30], [-8, -32], [2, -38], [10, -20]],
    patrols: [
      [[-16, 16], [-16, -2], [2, -6], [-16, 16]],
      [[26, 11], [12, 17], [-2, 12], [26, 11]],
      [[0, 28], [18, 20], [0, 28]],
    ],
  };
}

function siteRampart(b) {
  // RAMPART 12 — a hard little Trust post. Walled, overlooked by two towers,
  // with the mast dead centre. There is no quiet approach; the design intent
  // is that the player picks a side to breach and accepts the other tower.
  b.prop('comms_mast', 0, 0, 0, BOX.comms_mast, 1.0);
  b.prop('generator', 7, 4, 0, BOX.generator, 1);
  b.prop('fuel_tank', -10, 8, Math.PI / 2, BOX.fuel_tank, 1);
  b.prop('watchtower', -18, -18, 0, BOX.watchtower, 1);
  b.prop('watchtower', 18, 18, 0, BOX.watchtower, 1);
  b.prop('bunker', 16, -14, -Math.PI / 2, BOX.bunker, 1);
  b.prop('checkpoint', 0, 30, Math.PI, BOX.checkpoint, 1);

  // Perimeter wall of barriers with two deliberate gaps (N and W).
  for (let i = -5; i <= 5; i++) {
    if (Math.abs(i) > 1) {
      b.prop('barrier', i * 5.2, -26, 0, BOX.barrier, 1.1);
      b.prop('barrier', i * 5.2, 26, 0, BOX.barrier, 1.1);
    }
    if (i !== 0 && i !== 1) {
      b.prop('barrier', -26, i * 5.2, Math.PI / 2, BOX.barrier, 1.1);
      b.prop('barrier', 26, i * 5.2, Math.PI / 2, BOX.barrier, 1.1);
    }
  }
  b.prop('sandbags', -6, -20, 0, BOX.sandbags, 1.2);
  b.prop('sandbags', 6, -20, 0, BOX.sandbags, 1.2);
  b.prop('sandbags', -20, 6, Math.PI / 2, BOX.sandbags, 1.2);
  b.prop('container', -14, -6, 0, BOX.container, 1);
  b.prop('container', 12, 10, Math.PI / 2, BOX.container, 1);
  b.prop('pipe_run', -4, 16, 0, BOX.pipe_run, 1);
  b.prop('crate', 4, -6, 0.2, BOX.crate, 1);
  b.prop('crate', 5.2, -5, 0.9, BOX.crate, 1);
  b.prop('crate', -3, 8, 0.5, BOX.crate, 1);
  b.prop('truck_wreck', 20, -2, 1.4, BOX.truck_wreck, 1);
  b.scatter(['rock_0', 'rock_1', 'rock_2', 'rock_3'], 20, 0, 0, 52);
  b.perimeter(62);

  return {
    name: 'RAMPART 12',
    // Rampart is a night-into-dawn raid: blue, cold, the sun barely up.
    palette: { fog: 0x2e3440, ground: 0x35372f, groundLow: 0x1c1e1a, sky: 0x252b36, sun: 0x9aa8c4, sunI: 2.2, amb: 0x4a5670, ambI: 2.1 },
    playerSpawn: { x: 0, z: 40, ry: 0 },
    extraction: { x: -40, z: -6 },   // out the west gap, not back the way in
    enemyFaction: 'trust',
    objectivePoint: { x: 0, z: 0 },
    garrison: [[-8, -14], [8, -14], [-14, 6], [14, 6], [0, -20], [18, 16], [-18, -18]],
    patrols: [
      [[-22, -22], [22, -22], [22, 22], [-22, 22], [-22, -22]],
      [[0, 22], [0, -18], [0, 22]],
    ],
  };
}

function sitePerran(b) {
  // PERRAN RECLAIMER — the plant the player has to keep. Open approach lanes
  // from the north and east so an attacking force has somewhere to come FROM,
  // and a tight core of hard cover worth holding.
  b.prop('fuel_tank', 0, 0, 0, BOX.fuel_tank, 1.4);        // the reclaimer stack
  b.prop('pipe_run', -9, 4, 0, BOX.pipe_run, 1);
  b.prop('pipe_run', 9, 4, 0, BOX.pipe_run, 1);
  b.prop('pipe_run', 0, 12, Math.PI / 2, BOX.pipe_run, 1);
  b.prop('generator', -7, -7, 0, BOX.generator, 1);
  b.prop('generator', 7, -7, 0, BOX.generator, 1);
  b.prop('hab_block', -20, 14, 0, BOX.hab_block, 1);
  b.prop('hab_block', 20, 16, Math.PI / 2, BOX.hab_block, 1);
  b.prop('hab_block', -22, -14, Math.PI / 2, BOX.hab_block, 1);
  b.prop('catwalk', 0, -14, 0, BOX.catwalk, 1);
  b.prop('watchtower', 16, -18, 0, BOX.watchtower, 1);

  // Barricade ring the defenders actually use.
  const ring = [[-8, -12], [8, -12], [-13, -4], [13, -4], [-13, 8], [13, 8], [-5, 15], [5, 15]];
  ring.forEach(([x, z], i) => b.prop('barrier', x, z, i % 2 ? Math.PI / 2 : 0, BOX.barrier, 1.1));
  b.prop('sandbags', 0, -18, 0, BOX.sandbags, 1.3);
  b.prop('sandbags', -17, 0, Math.PI / 2, BOX.sandbags, 1.3);
  b.prop('sandbags', 17, 0, Math.PI / 2, BOX.sandbags, 1.3);
  b.prop('container', -26, 2, 0, BOX.container, 1);
  b.prop('container', 26, -8, 0, BOX.container, 1);
  b.prop('truck_wreck', -30, -22, 0.4, BOX.truck_wreck, 1);
  b.prop('crate', -4, -9, 0.2, BOX.crate, 1);
  b.prop('crate', 4, -9, 1.0, BOX.crate, 1);
  b.prop('antenna_small', -11, 18, 0, BOX.antenna_small, 1);
  b.scatter(['crate'], 5, 0, 0, 22, () => BOX.crate);
  b.scatter(['rock_0', 'rock_1', 'rock_2', 'rock_3'], 18, 0, 0, 50);
  b.perimeter(60);

  return {
    name: 'PERRAN RECLAIMER',
    // Perran is late afternoon, dust in the air, everything gone amber.
    palette: { fog: 0x5c4c34, ground: 0x54492e, groundLow: 0x2e2818, sky: 0x4e4030, sun: 0xf0c078, sunI: 3.2, amb: 0x6a5c48, ambI: 1.8 },
    playerSpawn: { x: 0, z: 6, ry: 0 },
    extraction: { x: 0, z: 6 },     // you are already where you must stay
    enemyFaction: 'trust',
    objectivePoint: { x: 0, z: 0 },
    garrison: [[-10, -16], [10, -16], [-18, 4], [18, 4], [0, -22], [14, 14]],
    patrols: [
      [[-24, -18], [24, -18], [24, 18], [-24, 18], [-24, -18]],
    ],
  };
}

function siteRoadside(b) {
  // ROADSIDE — where a travel encounter turns into a fight. Deliberately the
  // most open site in the game: little hard cover, long sightlines, and the
  // wrecks that ARE cover are exactly what both sides run for.
  b.prop('truck_wreck', -6, 4, 0.3, BOX.truck_wreck, 1);
  b.prop('truck_wreck', 8, -10, -1.1, BOX.truck_wreck, 1);
  b.prop('truck_wreck', 2, 22, 2.2, BOX.truck_wreck, 1);
  b.prop('container', -18, -8, Math.PI / 2, BOX.container, 1);
  b.prop('container', 16, 12, 0, BOX.container, 1);
  b.prop('barrier', -3, -4, 0, BOX.barrier, 1);
  b.prop('barrier', 5, 6, Math.PI / 2, BOX.barrier, 1);
  b.prop('sandbags', -11, 12, 0.4, BOX.sandbags, 1.2);
  b.prop('pipe_run', 20, -2, Math.PI / 2, BOX.pipe_run, 1);
  b.prop('checkpoint', -22, 20, -0.6, BOX.checkpoint, 1);
  b.prop('crate', -7, -14, 0.2, BOX.crate, 1);
  b.prop('crate', -5.8, -13, 1.0, BOX.crate, 1);
  b.scatter(['rock_0', 'rock_1', 'rock_2', 'rock_3'], 26, 0, 0, 44);
  b.scatter(['dead_tree'], 9, 0, 0, 40);
  b.perimeter(54);

  return {
    name: 'ROADSIDE — THE REACH',
    palette: { fog: 0x4e4a3c, ground: 0x494330, groundLow: 0x28251a, sky: 0x44443a, sun: 0xdcb878, sunI: 2.8, amb: 0x5a6070, ambI: 1.9 },
    playerSpawn: { x: 0, z: 32, ry: 0 },
    extraction: { x: 0, z: 34 },
    enemyFaction: 'raider',
    objectivePoint: { x: 0, z: -6 },
    garrison: [[-6, -12], [6, -14], [0, -20], [-14, -4], [12, -2]],
    patrols: [[[-18, -8], [18, -10], [-18, -8]]],
  };
}

function siteDepot(b) {
  // A supply depot: rows of stacked containers with wide lanes between them,
  // a fuel farm on one flank and a hard core of blast doors. The lanes are the
  // point — they are long, straight and lethal, so crossing one is a decision
  // and flanking means going the long way round through the stacks.
  b.prop('blast_door', 0, -14, 0, BOX.blast_door, 1.1);
  b.prop('bunker', 0, -22, 0, BOX.bunker, 1.2);
  for (let row = 0; row < 4; row++) {
    const z = -4 + row * 11;
    for (let i = -2; i <= 2; i++) {
      if (row % 2 === 0 && i === 0) continue;   // deliberate gaps in the stacks
      b.prop('container', i * 9, z, 0, BOX.container, 1);
      if (row % 2) b.prop('container', i * 9, z + 3.2, 0, BOX.container, 1, 2.45);
    }
  }
  b.prop('fuel_tank', -24, 6, 0, BOX.fuel_tank, 1.1);
  b.prop('fuel_tank', -24, 16, 0, BOX.fuel_tank, 1.1);
  b.prop('pipe_run', -24, 11, Math.PI / 2, BOX.pipe_run, 1);
  b.prop('generator', 24, 4, 0, BOX.generator, 1);
  b.prop('generator', 24, 12, 0, BOX.generator, 1);
  b.prop('watchtower', -26, -18, 0, BOX.watchtower, 1);
  b.prop('watchtower', 26, -18, 0, BOX.watchtower, 1);
  b.prop('checkpoint', 0, 40, Math.PI, BOX.checkpoint, 1);
  b.prop('catwalk', 0, 24, 0, BOX.catwalk, 1);
  for (let i = -4; i <= 4; i++) {
    if (Math.abs(i) > 1) {
      b.prop('barrier', i * 6, 34, 0, BOX.barrier, 1.1);
    }
  }
  b.prop('sandbags', -8, 28, 0, BOX.sandbags, 1.2);
  b.prop('sandbags', 8, 28, 0, BOX.sandbags, 1.2);
  b.prop('truck_wreck', -18, 32, 0.5, BOX.truck_wreck, 1);
  b.scatter(['crate'], 10, 0, 8, 28, () => BOX.crate);
  b.scatter(['rock_0', 'rock_1', 'rock_2', 'rock_3'], 18, 0, 0, 50);
  b.perimeter(58);

  return {
    name: 'SUPPLY DEPOT',
    palette: { fog: 0x3e4448, ground: 0x40423a, groundLow: 0x232520, sky: 0x363c42, sun: 0xc8bc98, sunI: 2.6, amb: 0x525c68, ambI: 1.9 },
    playerSpawn: { x: 0, z: 44, ry: 0 },
    extraction: { x: -38, z: 30 },
    enemyFaction: 'trust',
    objectivePoint: { x: 0, z: -18 },
    garrison: [[-9, -8], [9, -8], [0, -26], [-18, 0], [18, 0], [-26, -18], [26, -18]],
    patrols: [
      [[-20, 30], [-20, -10], [20, -10], [20, 30], [-20, 30]],
      [[0, 34], [0, 4], [0, 34]],
    ],
  };
}


// --------------------------------------------------------------------------
// Inhabited places
// --------------------------------------------------------------------------
//
// Every deployment used to happen in the same handful of industrial yards, so a
// fight in a town where people actually live read exactly like a fight at a
// dead relay station. These two layouts exist to break that: they are built out
// of streets rather than scattered cover, which changes how the fight goes as
// much as how it looks. Lanes channel movement, junctions become the contested
// ground, and flanking means going around a block instead of around a crate.

/** A street grid. Blocks of habitation with lanes between them. */
function habQuarter(b, { blocks, street, origin = [0, 0], jitter = 0 }) {
  const [ox, oz] = origin;
  for (const [bx, bz, rot] of blocks) {
    const x = ox + bx * street + (jitter ? (b.r() - 0.5) * jitter : 0);
    const z = oz + bz * street + (jitter ? (b.r() - 0.5) * jitter : 0);
    b.prop('hab_block', x, z, rot, BOX.hab_block, 1);
  }
}

function siteSettlement(b) {
  // THE TOWN — two streets crossing at a market square, hab blocks packed in
  // rows either side. The player comes up the south road into the square, and
  // everything above it is close work: doorways, corners, and lanes barely wide
  // enough for two people to pass.
  //
  // The square is deliberately open. It is the only place on the map with long
  // sightlines, so holding it is worth something and crossing it costs you.

  // ---- the two street-facing rows either side of the main north road ----
  habQuarter(b, {
    street: 13,
    blocks: [
      [-2, -2, 0], [-2, -1, 0], [-2, 1, 0], [-2, 2, 0],
      [2, -2, 0], [2, -1, 0], [2, 1, 0], [2, 2, 0],
    ],
  });
  // ---- an east-west row along the top, closing the square off ----
  habQuarter(b, {
    street: 13,
    blocks: [[-1, -3, Math.PI / 2], [0, -3, Math.PI / 2], [1, -3, Math.PI / 2]],
  });

  // The market square itself: awnings and stalls improvised out of containers
  // and crates, left where the traders dropped them.
  b.prop('container', -7, -4, 0, BOX.container, 1);
  b.prop('container', 7, -3, 0, BOX.container, 1);
  b.prop('crate', -4, 1, 0.4, BOX.crate, 1);
  b.prop('crate', -3, 2.4, 1.2, BOX.crate, 1);
  b.prop('crate', 4.5, 0.5, 0.8, BOX.crate, 1);
  b.prop('barrier', -2, 6, 0, BOX.barrier, 1);
  b.prop('barrier', 2, 6, 0, BOX.barrier, 1);
  b.prop('generator', 9, 5, 0, BOX.generator, 1);

  // A checkpoint on the south approach — the way in, and the first thing the
  // garrison will try to hold.
  b.prop('checkpoint', -4, 22, 0, BOX.checkpoint, 1);
  b.prop('checkpoint', 4, 22, 0, BOX.checkpoint, 1);
  b.prop('sandbags', -8, 20, 0.3, BOX.sandbags, 1.2);
  b.prop('sandbags', 8, 20, -0.3, BOX.sandbags, 1.2);
  b.prop('truck_wreck', 12, 17, 0.9, BOX.truck_wreck, 1);

  // Watchtowers on the corners. They are what makes an approach across the
  // open south side genuinely expensive.
  b.prop('watchtower', -20, 14, 0, BOX.watchtower, 1);
  b.prop('watchtower', 20, 14, 0, BOX.watchtower, 1);

  // Back lanes: rubbish, drums and a catwalk between two roofs.
  b.prop('catwalk', -13, -8, Math.PI / 2, BOX.catwalk, 1);
  b.prop('pipe_run', 15, -10, 0, BOX.pipe_run, 1);
  b.scatter(['crate'], 9, 0, -6, 26, () => BOX.crate);
  b.scatter(['rock_0', 'rock_1'], 8, 0, 26, 30);
  b.perimeter(56);

  return {
    name: 'THE TOWN',
    // Lived-in: warmer light, dust in the air, smoke from something burning.
    palette: {
      fog: 0x55483a, ground: 0x5a5142, groundLow: 0x312b22,
      sky: 0x4a4038, sun: 0xf0c88c, sunI: 3.2, amb: 0x6a6a74, ambI: 2.0,
    },
    playerSpawn: { x: 0, z: 42, ry: 0 },
    extraction: { x: 0, z: 45 },
    enemyFaction: 'syndic',
    objectivePoint: { x: 0, z: -2 },
    garrison: [[-6, 4], [6, 3], [0, -10], [-12, -6], [12, -5], [0, 14], [-16, 2], [16, 1]],
    patrols: [
      [[-13, 14], [-13, -14], [13, -14], [13, 14], [-13, 14]],
      [[0, 18], [0, -6], [0, 18]],
      [[-20, -2], [20, -2], [-20, -2]],
    ],
  };
}

function siteWorks(b) {
  // THE WORKS — a company town built around the plant that owns it. Housing on
  // one side, the plant on the other, and a yard between them where everything
  // gets fought over. Taller, tighter and more vertical than the town: the
  // tanks and pipe runs break the site into compartments you cannot see across.
  b.prop('fuel_tank', -14, -16, 0, BOX.fuel_tank, 1.5);
  b.prop('fuel_tank', -3, -18, 0, BOX.fuel_tank, 1.5);
  b.prop('fuel_tank', 8, -16, 0, BOX.fuel_tank, 1.3);
  b.prop('pipe_run', -9, -8, 0, BOX.pipe_run, 1);
  b.prop('pipe_run', 2, -8, 0, BOX.pipe_run, 1);
  b.prop('pipe_run', 13, -8, 0, BOX.pipe_run, 1);
  b.prop('comms_mast', 18, -20, 0, BOX.comms_mast, 1.4);


  // Worker housing, packed tight along the east side.
  habQuarter(b, {
    street: 12, origin: [22, 6],
    blocks: [[0, 0, 0], [0, 1, 0], [0, 2, 0], [-1, 0, 0], [-1, 1, 0]],
  });

  // The yard: hardstanding, containers stacked in rows, a crane gantry.
  b.prop('container', -18, 6, 0, BOX.container, 1);
  b.prop('container', -18, 11, 0, BOX.container, 1);
  b.prop('container', -12, 8, Math.PI / 2, BOX.container, 1);
  b.prop('container', -6, 6, 0, BOX.container, 1);
  b.prop('container', -6, 12, 0, BOX.container, 1);
  b.prop('catwalk', -12, 0, 0, BOX.catwalk, 1.2);
  b.prop('generator', -20, -2, 0, BOX.generator, 1);
  b.prop('blast_door', -24, -8, Math.PI / 2, BOX.blast_door, 1);
  b.prop('bunker', -24, -14, Math.PI / 2, BOX.bunker, 1.1);

  b.prop('checkpoint', -3, 24, 0, BOX.checkpoint, 1);
  b.prop('sandbags', 3, 23, -0.4, BOX.sandbags, 1.2);
  b.prop('watchtower', -22, 20, 0, BOX.watchtower, 1);
  b.prop('truck_wreck', 10, 20, -0.7, BOX.truck_wreck, 1);
  b.scatter(['crate'], 12, -6, 4, 24, () => BOX.crate);
  b.scatter(['rock_0', 'rock_2'], 9, 0, 28, 30);
  b.perimeter(58);

  // A maintenance catwalk over the tank farm, with steps up from the yard.
  //
  // The site was described as "taller, tighter and more vertical" and was in
  // fact as flat as everywhere else — the tanks broke sightlines but there was
  // never anywhere to stand above them. This is the piece of ground the fight
  // over the works should actually be about: it overlooks the whole tank line,
  // it can be taken from either end, and standing on it means being visible
  // from the housing.
  const DECK = 3.4;
  for (let i = -3; i <= 3; i++) {
    b.deck('catwalk', i * 8.2, -12, 0, BOX.catwalk, 1, DECK);
  }
  // Stairs at each end of the run, outside the decking rather than beneath it,
  // and on ground the builder has checked is actually empty.
  b.stairsTo([[-24, -11, 0, -1], [-16, -11, 0, -1], [-24.6, -12, 1, 0]], DECK);
  b.stairsTo([[24, -11, 0, -1], [16, -11, 0, -1], [24.6, -12, -1, 0]], DECK);
  // Something to get behind once you are up there, or it is a shooting gallery
  // for whoever is still on the ground.
  b.deck('crate', -8, -12, 0, BOX.crate, 1, DECK);
  b.deck('crate', 9, -12, 0, BOX.crate, 1, DECK);

  return {
    name: 'THE WORKS',
    // Under the plant's own light: sodium glare, chemical haze, no sky to speak of.
    palette: {
      fog: 0x46443a, ground: 0x4e4a3e, groundLow: 0x282721,
      sky: 0x3a3c3e, sun: 0xe8b070, sunI: 2.9, amb: 0x5e6a78, ambI: 2.1,
    },
    playerSpawn: { x: 0, z: 42, ry: 0 },
    extraction: { x: 0, z: 45 },
    enemyFaction: 'syndic',
    objectivePoint: { x: -10, z: -4 },
    garrison: [[-10, 4], [-18, 2], [-4, -4], [4, 2], [-14, -10], [12, 6], [16, 12], [-2, 14]],
    patrols: [
      [[-20, 16], [-20, -6], [-2, -6], [-20, 16]],
      [[16, 18], [16, 2], [0, 2], [16, 18]],
      [[-8, 20], [-8, -2], [-8, 20]],
    ],
  };
}

function siteFort(b) {
  // THE WORKS GATE — a walled compound with one way in.
  //
  // Every other layout in this game is an arrangement of cover on open ground,
  // which means every fight is decided by movement and angles. A wall changes
  // the question: the ground is only crossable where somebody decided it would
  // be, and the defenders know exactly where that is. That is what makes a
  // siege a siege rather than a firefight with more people.
  //
  // The wall runs east-west across the north of the site. The player comes from
  // the south, into a killing ground the defenders have had years to arrange.

  const WALL_Z = -14;
  // Curtain wall either side of the gate, with a gap at the centre exactly wide
  // enough for the gate to fill.
  //
  // The gap used to be three bays wide while the gate's collision was one — so
  // the wall had a ten-metre hole on either side of the doors that anyone could
  // simply walk through, which quietly undid the entire point of the layout.
  // The wall sampling in the siege test ran along the rampart line and never
  // looked at the flanks.
  for (let i = -8; i <= 8; i++) {
    if (i === 0) continue;                            // the gate stands here
    b.prop('rampart', i * 9.0, WALL_Z, 0, BOX.rampart, 1);
  }
  // The gate itself, collided from its own mesh so the doors block the whole
  // opening they are drawn across.
  b.prop('gate', 0, WALL_Z, 0, 'auto', 1);
  // Towers flanking the opening. Deliberately set outside the gate's span: they
  // are behind the curtain wall, so when the doors go the breach is clear.
  b.prop('gate_tower', -7.6, WALL_Z, 0, BOX.gate_tower, 1);
  b.prop('gate_tower', 7.6, WALL_Z, 0, BOX.gate_tower, 1);
  b.prop('watchtower', -22, WALL_Z - 3, 0, BOX.watchtower, 1);
  b.prop('watchtower', 22, WALL_Z - 3, 0, BOX.watchtower, 1);

  // The wall walk. A rampart with nobody able to stand on it is a fence; this
  // is what makes taking the gate worth doing, because the defenders shooting
  // down at the approach have to be dealt with rather than waited out — and
  // once you are through, the walk is yours to hold against the compound.
  const WALK = 4.1;
  for (let i = -8; i <= 8; i++) {
    if (i === 0) continue;
    b.deck('catwalk', i * 9.0, WALL_Z + 2.2, 0, BOX.catwalk, 1.1, WALK);
  }
  // Stairs up from inside the compound only. The attacker has to come through
  // the gate to reach them, which is the point of the whole layout.
  b.stairsTo([[-18, WALL_Z + 3.4, 0, -1], [-27, WALL_Z + 3.4, 0, -1], [-9, WALL_Z + 3.4, 0, -1]], WALK);
  b.stairsTo([[18, WALL_Z + 3.4, 0, -1], [27, WALL_Z + 3.4, 0, -1], [9, WALL_Z + 3.4, 0, -1]], WALK);

  // The approach: open, with just enough to break up a straight run. Crossing
  // this is the cost of the mission.
  b.prop('truck_wreck', -9, 12, 0.8, BOX.truck_wreck, 1);
  b.prop('truck_wreck', 11, 18, -0.5, BOX.truck_wreck, 1);
  b.prop('barrier', -3, 6, 0, BOX.barrier, 1);
  b.prop('barrier', 3, 6, 0, BOX.barrier, 1);
  b.prop('sandbags', -14, 2, 0.3, BOX.sandbags, 1.2);
  b.prop('sandbags', 15, 4, -0.3, BOX.sandbags, 1.2);
  b.scatter(['crate'], 6, 0, 14, 22, () => BOX.crate);

  // Inside: what they are defending, and what you have to walk into.
  b.prop('bunker', -14, -30, 0, BOX.bunker, 1.1);
  b.prop('hab_block', 12, -30, Math.PI / 2, BOX.hab_block, 1);
  b.prop('hab_block', 12, -38, Math.PI / 2, BOX.hab_block, 1);
  b.prop('fuel_tank', -6, -40, 0, BOX.fuel_tank, 1.3);
  b.prop('generator', 4, -24, 0, BOX.generator, 1);
  b.prop('container', -20, -22, 0, BOX.container, 1);
  b.prop('container', 18, -20, Math.PI / 2, BOX.container, 1);
  b.prop('comms_mast', 0, -44, 0, BOX.comms_mast, 1.3);
  b.scatter(['crate'], 8, 0, -30, 20, () => BOX.crate);
  b.scatter(['rock_0', 'rock_2'], 10, 0, 30, 34);
  b.perimeter(60);

  return {
    name: 'THE WORKS GATE',
    palette: {
      fog: 0x48453c, ground: 0x55503f, groundLow: 0x2b2820,
      sky: 0x3f4142, sun: 0xe8c088, sunI: 2.9, amb: 0x64707e, ambI: 2.0,
    },
    playerSpawn: { x: 0, z: 34, ry: 0 },
    extraction: { x: 0, z: 36 },
    enemyFaction: 'trust',
    // Deep inside, so taking the gate is the beginning and not the end.
    objectivePoint: { x: 0, z: -34 },
    // On the wall and behind it. The wall posts are what make the approach
    // expensive; the interior posts are what make the breach expensive.
    garrison: [
      [-9, -16], [9, -16], [-18, -16], [18, -16],
      [0, -22], [-12, -28], [12, -28], [0, -36], [-6, -42], [6, -42],
    ],
    patrols: [
      [[-20, -24], [20, -24], [-20, -24]],
      [[0, -30], [0, -46], [0, -30]],
    ],
  };
}

// Keyed by layout, not by location: several places in the Reach share a layout
// and every layout can host any mission template.
const SITES = {
  array: siteGrellan,
  outpost: siteRampart,
  reclaimer: sitePerran,
  roadside: siteRoadside,
  depot: siteDepot,
  settlement: siteSettlement,
  works: siteWorks,
  fort: siteFort,
};

// --------------------------------------------------------------------------
// Public build
// --------------------------------------------------------------------------

/**
 * Construct a deployment site. Returns the scene contents plus the collision
 * and gameplay metadata the mission runtime needs.
 */
export function build(siteId, seed, override = {}) {
  const b = new Builder(seed);
  const fn = SITES[siteId] || siteGrellan;
  const meta = fn(b);
  // A location can rename and re-light a shared layout, so Culvert Nine does
  // not announce itself as Grellan Array.
  if (override.name) meta.name = override.name;
  if (override.palette) meta.palette = { ...meta.palette, ...override.palette };
  if (override.enemyFaction) meta.enemyFaction = override.enemyFaction;

  // Everything the layout did not place, placed once here so all eight sites
  // grow together: the middle distance gets filled in, and the edge is pushed
  // out well past where the fighting happens.
  b.outskirts(26, BOUNDS - 14, 34);

  const group = new THREE.Group();
  const ground = buildGround(BOUNDS * 4.2, meta.palette.ground, meta.palette.groundLow);
  group.add(ground);

  // Instanced-ish placement: each prop is a clone of a preloaded GLB.
  for (const p of b.props) {
    const o = Models.get(p.model);
    o.position.set(p.x, p.y, p.z);
    o.rotation.y = p.ry;
    o.scale.setScalar(p.scale);
    group.add(o);
  }

  return {
    id: siteId,
    name: meta.name,
    palette: meta.palette,
    group,
    ground,
    obstacles: b.obstacles,
    covers: b.covers,
    // What was actually placed, kept so collision can be audited against the
    // meshes it is supposed to represent. An obstacle on its own cannot say
    // which model it belongs to, which makes a box that does not match what the
    // player can see impossible to find except by walking into it.
    props: b.props,
    playerSpawn: meta.playerSpawn,
    extraction: meta.extraction,
    enemyFaction: meta.enemyFaction,
    objectivePoint: meta.objectivePoint,
    // Every layout hand-places its defenders and its patrol routes, and for a
    // long time none of that reached the mission — these two lines were simply
    // missing from the returned object, so spawnGarrison() always fell through
    // to its ring-of-six fallback and no patrol ever existed. That is why every
    // site played the same regardless of what had been authored for it.
    garrison: meta.garrison || null,
    patrols: meta.patrols || null,
    bounds: BOUNDS,
  };
}

// --------------------------------------------------------------------------
// Collision & visibility, shared by the player and every AI
// --------------------------------------------------------------------------

const RADIUS = 0.45;

/**
 * The surface underfoot at a point: the terrain, or the top of anything
 * walkable you are standing on.
 *
 * Levels were flat arenas because ground was always heightAt() — there was no
 * way to be on top of something. A walkable obstacle is one whose top is a
 * floor rather than an obstruction, so a catwalk is somewhere to be and a fuel
 * tank is still just a wall.
 *
 * `fromFeet` is where the mover currently is. A surface only counts if it is
 * not above them by more than `stepUp`, which is what stops a soldier
 * teleporting onto a container by walking into its side.
 */
export const STEP_UP = 0.62;

/**
 * How far the playable ground runs from the centre.
 *
 * Was 66 — a 132-metre circle, which played as a small arena with a kerb of
 * rocks around it: you could see the whole site from the spawn and every fight
 * happened in the same doughnut. At 112 the field is nearly three times the
 * area, the objective is a walk rather than a glance, and there is room for an
 * approach, a flank and a line of retreat that are actually different places.
 */
export const BOUNDS = 112;

export function surfaceAt(obstacles, x, z, fromFeet = Infinity, stepUp = STEP_UP) {
  let best = heightAt(x, z);
  for (const o of obstacles) {
    if (!o.walk) continue;
    if (x < o.x - o.hw || x > o.x + o.hw || z < o.z - o.hd || z > o.z + o.hd) continue;
    const top = o.y + o.h;
    if (top <= best) continue;
    if (top > fromFeet + stepUp) continue;   // too high to step onto
    best = top;
  }
  return best;
}

/** Is there a walkable top at this point at all, and how high? */
export function highestSurface(obstacles, x, z) {
  return surfaceAt(obstacles, x, z, Infinity, Infinity);
}

/**
 * Slide-along-walls resolution against the obstacle list.
 *
 * `feet` lets a mover walk over the top of things they are standing on: a
 * catwalk is a wall from below and a floor from above, and without this the
 * player would be stopped in mid-air by the railing they are standing on.
 */
export function resolveMove(obstacles, x, z, nx, nz, feet = -Infinity) {
  let px = nx, pz = nz;
  for (const o of obstacles) {
    if (o.h < 0.5) continue;
    // Low enough to step onto — which includes anything you are already
    // standing on. Using the same limit as surfaceAt matters: if this were
    // stricter, the player would be stopped by the face of a stair tread they
    // are perfectly able to climb, which is exactly what happened.
    if (o.walk && o.y + o.h <= feet + STEP_UP) continue;
    // Walking underneath it. A catwalk overhead is headroom, not a pillar —
    // without this the player is stopped dead by the underside of a walkway
    // they are supposed to be able to pass beneath and climb onto.
    if (o.walk && o.y > feet + 1.9) continue;
    const dx = px - o.x, dz = pz - o.z;
    const ox = o.hw + RADIUS, oz = o.hd + RADIUS;
    if (Math.abs(dx) < ox && Math.abs(dz) < oz) {
      // Push out along the shallower penetration axis.
      const penX = ox - Math.abs(dx);
      const penZ = oz - Math.abs(dz);
      if (penX < penZ) px = o.x + Math.sign(dx || 1) * ox;
      else pz = o.z + Math.sign(dz || 1) * oz;
    }
  }
  return { x: px, z: pz };
}

/**
 * Segment-versus-box sweep. Returns the nearest blocking hit, or null.
 * `height` is the y the shot travels at, so a shooter can fire over low cover.
 */
export function raycast(obstacles, ax, az, bx, bz, height = 1.2, maxT = 1) {
  let best = null;
  const dx = bx - ax, dz = bz - az;
  for (const o of obstacles) {
    if (o.y + o.h < height) continue; // shot passes over this one
    const t = segBox(ax, az, dx, dz, o);
    if (t !== null && t <= maxT && (!best || t < best.t)) {
      best = { t, obstacle: o, x: ax + dx * t, z: az + dz * t };
    }
  }
  return best;
}

function segBox(ax, az, dx, dz, o) {
  let tmin = 0, tmax = 1;
  for (const [a, d, c, h] of [[ax, dx, o.x, o.hw], [az, dz, o.z, o.hd]]) {
    if (Math.abs(d) < 1e-8) {
      if (a < c - h || a > c + h) return null;
    } else {
      let t1 = (c - h - a) / d, t2 = (c + h - a) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Can A see B? Eye height matters — this is what makes low cover mean something. */
export function hasLOS(obstacles, ax, az, bx, bz, eye = 1.5) {
  return !raycast(obstacles, ax, az, bx, bz, eye, 1);
}

/**
 * Best cover position near `from` that breaks line of sight to `threat`.
 * Cheap and good enough: sample the far side of nearby low obstacles.
 */
export function findCover(obstacles, covers, fromX, fromZ, threatX, threatZ, maxDist = 16) {
  let best = null;
  for (const o of covers) {
    const d = Math.hypot(o.x - fromX, o.z - fromZ);
    if (d > maxDist) continue;
    const ang = Math.atan2(o.z - threatZ, o.x - threatX);
    const off = Math.max(o.hw, o.hd) + 0.9;
    const cx = o.x + Math.cos(ang) * off;
    const cz = o.z + Math.sin(ang) * off;
    // Must actually be shielded at standing height but able to shoot over.
    if (hasLOS(obstacles, cx, cz, threatX, threatZ, 1.45)) continue;
    const score = Math.hypot(cx - fromX, cz - fromZ);
    if (!best || score < best.score) best = { x: cx, z: cz, score, obstacle: o };
  }
  return best;
}
