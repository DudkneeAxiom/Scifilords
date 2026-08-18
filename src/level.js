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
function rawHeight(x, z) {
  // The ground has relief now. It was flat for a long time, and the reason was
  // real: every obstacle is an axis-aligned box that used to be anchored to ONE
  // ground sample, so a rampart across a slope had daylight under its downhill
  // end and rounds went beneath the wall. Sinking the boxes to close that gap
  // changed what an obstacle's height meant, and height was what classified a
  // box as shoot-over cover, so the cover list emptied instead.
  //
  // What unlocked it was separating the two meanings — see seatObstacle().
  // A box now reaches down to the LOWEST ground under its own footprint, which
  // seals the gap, while `coverH` measures it from the HIGHEST, which is what
  // every gameplay judgement reads. Sinking no longer costs anything.
  //
  // Scale is chosen against the play space rather than for looks: swells about
  // 70m across, so a 189m heavy fight crosses three or four of them, and the
  // steepest gradient is around ten degrees, which walks and paths normally.
  // Peak to trough is roughly nine metres — enough that a fold in the ground is
  // somewhere to be, which is the point.
  return (
    Math.sin(x * 0.0165) * Math.cos(z * 0.0148) * 2.6 +           // the basin's tilt
    Math.sin(x * 0.049 + 1.7) * Math.cos(z * 0.041 - 0.6) * 1.35  // long folds
    // The term that makes the ground tactical rather than scenic. The two
    // above have wavelengths longer than a firefight, so they read as a tilted
    // plain: pretty, but there is nowhere to get down into. This one runs at
    // about 60m, so a hollow is roughly one bound across and dropping into it
    // genuinely breaks a sightline — dead ground you can use, which is the
    // difference between relief and decoration.
    + Math.sin(x * 0.105 - 0.4) * Math.cos(z * 0.098 + 0.3) * 2.0
    + Math.cos(z * 0.19 + 1.1) * 0.3                              // grain
  );
}

// A levelled pad under a built-up site. People do not build a town on swells —
// they grade the ground first — and a street that rolls under buildings that
// stand on stilts of collision reads as exactly what it is. Set per-build from
// the layout's meta (see build()); null for every site that fights on raw
// terrain. Module state is safe here for the same reason the model cache is:
// one level exists at a time, and the next build() overwrites it.
let FLAT = null;

export function heightAt(x, z) {
  const h = rawHeight(x, z);
  if (!FLAT) return h;
  const d = Math.hypot(x - FLAT.x, z - FLAT.z);
  if (d >= FLAT.r + FLAT.fade) return h;
  if (d <= FLAT.r) return FLAT.y;
  // Smoothstep out to the raw terrain, so the pad has an edge you can see
  // but not a cliff you fall off.
  const t = (d - FLAT.r) / FLAT.fade;
  const s = t * t * (3 - 2 * t);
  return FLAT.y * (1 - s) + h * s;
}

// Peak-to-trough of heightAt(), used to normalise anything that shades by
// elevation. Kept beside the function so the two cannot drift apart.
export const RELIEF = 6.0;

function buildGround(size, colorTop, colorLow, colorAcc) {
  // Enough segments that the swells read as ground and not as facets. The
  // pan is now more than twice as wide, so the old grid gave a 5m triangle.
  const seg = 150;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cTop = new THREE.Color(colorTop);
  const cLow = new THREE.Color(colorLow);
  // The second country. Height-lerping two shades of one hue gave the floor a
  // single colour at two brightnesses, which is most of why a site read as one
  // brown carpet — the same uniform-olive failure the world map had before its
  // moisture field. Each palette names an accent (scrub, rust, stained gravel
  // — whatever that site's OTHER material is) and a slow patch field decides
  // which country each stretch of ground belongs to.
  const cAcc = new THREE.Color(colorAcc ?? colorTop);
  // Bare rock where the ground stands up, for the world map's reason: a slope
  // that catches its own colour describes a shape instead of being a darker
  // smear, and it breaks the carpet exactly where the relief is.
  const cRock = new THREE.Color(0x6e6a60);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    // Vertex colour by height plus a coarse blotch, so the floor has grain
    // without a texture. Low ground is darker and wetter-looking.
    const n = (Math.sin(x * 0.13) * Math.cos(z * 0.11) + 1) * 0.5;
    // Normalised against the actual relief. This ramp was written for ground
    // that never left +/-1m; feeding it real elevation pins every high slope at
    // full brightness and every hollow at black.
    const e = (y + RELIEF) / (RELIEF * 2);
    c.copy(cLow).lerp(cTop, Math.min(1, Math.max(0, e * 0.7 + n * 0.4)));
    // Accent patches tens of metres across with soft edges — big enough to
    // read as country from eye level, never per-vertex speckle.
    const patch = (Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.017 - 0.6) + 1) * 0.5;
    const pt = Math.min(1, Math.max(0, (patch - 0.5) / 0.25));
    c.lerp(cAcc, pt * 0.55);
    const gx = (heightAt(x + 4, z) - heightAt(x - 4, z)) / 8;
    const gz = (heightAt(x, z + 4) - heightAt(x, z - 4)) / 8;
    const slope = Math.min(1, Math.hypot(gx, gz) * 2.2);
    c.lerp(cRock, slope * 0.5);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/**
 * The lowest and highest ground under a footprint.
 *
 * This is what makes relief survivable. An obstacle is a single axis-aligned
 * box, and on sloping ground one ground sample cannot describe it: anchor the
 * box at its centre and the downhill end has daylight under it, which bullets
 * go through — rayHit() tests the true 3D box, so the gap is real and not
 * cosmetic. Sampling the whole footprint gives both numbers the box needs: a
 * bottom low enough to seal, and the ground a person standing beside it is
 * actually on.
 */
function groundSpan(x, z, hw, hd) {
  let lo = Infinity, hi = -Infinity;
  // Corners, edge midpoints and centre. Nine samples is enough for the broad
  // swells this terrain has; it is not trying to catch a knife-edge ridge,
  // because there are none and the ground function is smooth.
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const y = heightAt(x + i * hw, z + j * hd);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return { lo, hi };
}

/**
 * Fill in an obstacle's vertical extent from the ground beneath it.
 *
 * Two heights, because the old single `h` was being asked to mean two
 * different things and could only stay honest while the ground was flat:
 *
 *   h       the physical box, bottom to top. Collision and both ray systems
 *           use this. It grows as the ground falls away, which is exactly what
 *           seals the underside.
 *   coverH  how tall the thing is as drawn — its top above the ground at its
 *           own centre, which is where the model sits. Every gameplay
 *           judgement uses this: whether it is shoot-over cover, whether it
 *           blocks navigation, whether it is a wall worth sliding around.
 *
 * Keeping them separate is the whole trick. Sinking the boxes to close the gap
 * used to empty the cover list, because a sunk box measured as too tall to
 * shoot over. Now sinking changes h and leaves coverH alone.
 *
 * coverH is deliberately measured from the CENTRE and not from the highest
 * ground under the footprint. Measuring the worst case sounds more careful and
 * is worse: it shortens every object on a slope, and cover only counts when it
 * breaks a standing sightline at ~1.45m against a list capped at 1.7m, so a
 * conservative measure pushes most of the world out of that narrow band and
 * findCover() starts returning nothing. It did exactly that — the squad walked
 * to a wall and stood beside it in the open. Centre-sampled, coverH is just the
 * authored height, so classification is identical to how it behaved on flat
 * ground and only the box's underside actually moves.
 */
function seatObstacle(o, topY) {
  const { lo } = groundSpan(o.x, o.z, o.hw, o.hd);
  o.y = lo;
  o.h = topY - lo;
  o.coverH = topY - heightAt(o.x, o.z);
  return o;
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
    // No-build ground: rectangles clear() treats as occupied without putting
    // an obstacle there. A road is a fact about where things must NOT stand,
    // and until this existed only luck kept the random dressing passes out of
    // one — the town's gate arch was open or blocked depending on the seed.
    this.reserved = [];
  }

  /** Reserve open ground: nothing random may be placed inside it. */
  protect(x, z, hw, hd) {
    this.reserved.push({ x, z, hw, hd });
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
      };
      // The top stays where the art is — the model is drawn from the centre
      // sample, so that is where its roofline sits. Only the underside moves.
      seatObstacle(o, heightAt(x, z) + h * scale);
      this.obstacles.push(o);
      // Deliberately the AUTHORED height, before `scale`, which is what this
      // has always used. It is not what it looks like: a rock authored at 1.5m
      // and placed at scale 2.4 stands 3.6m and still counts as shoot-over
      // cover. That looks like a bug and is load-bearing — findCover() only
      // accepts a position that breaks a STANDING sightline at 1.45m, so the
      // scaled-up entries are the only things in the list tall enough to
      // shield anybody. Classifying on true height instead drops the list from
      // 89 covers to 61, findCover starts returning null, and the squad walks
      // to a wall and stands beside it in the open.
      //
      // Worth fixing properly one day, by widening the band to "tall enough to
      // hide behind, short enough to shoot over" measured on o.coverH. That is
      // a cover-balance change and wants its own round with the cover probe,
      // not a side effect of making the ground three-dimensional.
      if (h <= 1.7) this.covers.push(o);
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
    // Not seated to the ground like a solid obstacle: a deck's underside is
    // headroom on purpose, and sealing it to the terrain would turn a walkway
    // you pass beneath into a pillar.
    const o = {
      x, z,
      hw: (swap ? hd : hw) * scale,
      hd: (swap ? hw : hd) * scale,
      h: 0.25,
      coverH: 0.25,
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
    for (const o of this.reserved) {
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
        // A tread is a step, never cover — climbing one is the point.
        coverH: h,
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

  /**
   * Dress the ground you actually arrive on.
   *
   * outskirts() fills the middle distance and deliberately starts 26m out, and
   * its sqrt() radial bias pushes clusters further out still, so the one piece
   * of ground every single deployment begins on was the barest on the site. You
   * land, and the first thing the game shows you is an empty plain.
   *
   * This is scatter rather than cover on purpose. Hard cover at the insertion
   * point would turn every mission into a defensible start and remove the
   * reason to move; what the near ground needs is texture — something for the
   * eye to measure distance against, and the relief to read against.
   */
  nearGround(cx, cz, radius, n) {
    // A clearing at the exact spawn, or soldiers materialise inside a boulder.
    const KEEP = 5.5;
    for (let i = 0; i < n; i++) {
      const a = this.r() * Math.PI * 2;
      const d = KEEP + this.r() * (radius - KEEP);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!this.clear(x, z, 2.4, true)) continue;
      const k = this.r();
      if (k < 0.62) {
        // Loose stone, small enough to walk over and be shot across.
        this.prop(pick(this.r, ['rock_0', 'rock_1', 'rock_2', 'rock_3']),
          x, z, this.r() * 6.28, 'auto', range(this.r, 0.45, 1.05));
      } else if (k < 0.85) {
        this.prop('crate', x, z, this.r() * 6.28, BOX.crate, range(this.r, 0.8, 1));
      } else {
        // The occasional abandoned position, so the ground has a history.
        const aa = this.r() * Math.PI * 2;
        this.prop('sandbags', x, z, aa, BOX.sandbags, 1);
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
  // The town kit, authored to the person walking past: doors at 2.05m, one
  // storey at 3.1, two at 5.8. Boxes match the drawn bodies.
  town_house: [2.9, 2.4, 3.4],
  town_house_2: [3.1, 2.6, 6.1],
  town_hall: [4.6, 3.6, 5.6],
  // Counter height on the full footprint: a stall is shoot-over cover you
  // walk around, and the canvas overhead stops nothing.
  market_stall: [1.5, 1.2, 1.0],
  town_wall: [3.0, 0.62, 3.5],
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
  // Height is the CAP, not the merlon tops: collision at 6.2 made the wall
  // walk blind — a defender's eye at walk+1.55 sat inside the "wall" and no
  // sightline ever cleared the parapet. At 5.3 the crenellation is real:
  // troops on the walk fire over the cap, troops below stare at concrete.
  rampart: [4.6, 0.9, 5.3],
  // A run of earth-filled gabions: the lane wall that reads as fortification.
  hesco_line: [4.7, 0.9, 2.2],
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
    palette: { fog: 0x4a4a44, ground: 0x4c4a3c, groundLow: 0x2a2a22, acc: 0x46543e, sky: 0x3e4044, sun: 0xd8bd8a, sunI: 3.0, amb: 0x5a6470, ambI: 1.9 },
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
  b.prop('checkpoint_boom', 0, 30, Math.PI, null, 1);

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
    palette: { fog: 0x2e3440, ground: 0x35372f, groundLow: 0x1c1e1a, acc: 0x2c3e38, sky: 0x252b36, sun: 0x9aa8c4, sunI: 2.2, amb: 0x4a5670, ambI: 2.1 },
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
    palette: { fog: 0x5c4c34, ground: 0x54492e, groundLow: 0x2e2818, acc: 0x5e3a28, sky: 0x4e4030, sun: 0xf0c078, sunI: 3.2, amb: 0x6a5c48, ambI: 1.8 },
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
  b.prop('checkpoint_boom', -22, 20, -0.6, null, 1);
  b.prop('crate', -7, -14, 0.2, BOX.crate, 1);
  b.prop('crate', -5.8, -13, 1.0, BOX.crate, 1);
  b.scatter(['rock_0', 'rock_1', 'rock_2', 'rock_3'], 26, 0, 0, 44);
  b.scatter(['dead_tree'], 9, 0, 0, 40);
  b.perimeter(54);

  return {
    name: 'ROADSIDE — THE REACH',
    palette: { fog: 0x4e4a3c, ground: 0x494330, groundLow: 0x28251a, acc: 0x525a32, sky: 0x44443a, sun: 0xdcb878, sunI: 2.8, amb: 0x5a6070, ambI: 1.9 },
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
  b.prop('checkpoint_boom', 0, 40, Math.PI, null, 1);
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
    palette: { fog: 0x3e4448, ground: 0x40423a, groundLow: 0x232520, acc: 0x3a444e, sky: 0x363c42, sun: 0xc8bc98, sunI: 2.6, amb: 0x525c68, ambI: 1.9 },
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
  // THE TOWN — a walled settlement with an anatomy: one gate in the south
  // wall, a main street running up from it, and a framed market square at the
  // top of the street with the trades around its edges. The old version was
  // eleven identical cubes scattered on a grid, which read as an encounter
  // site with houses for cover; this reads as a place, because the buildings
  // AGREE about where the street is — continuous frontages, an alley behind
  // each row, and every quarter reachable by a lane rather than by open field.
  //
  // The square is still deliberately open: the only long sightlines inside
  // the walls, so holding it is worth something and crossing it costs you.
  //
  // The gateway is an OPEN arch — wall and towers, no gate mesh. A door here
  // would need the siege's breach mechanic in every raid, defense and visit;
  // an open gate makes the wall a fact about where you can walk, not a lock.
  const WALL_Z = 26;
  // ---- the wall: a full circuit, four corner towers, one arch ----
  // The enclosure is 84 x 64 — big enough that the quarters inside have air
  // between them, which is most of what makes a town read as a town rather
  // than a barracks. town_wall, not rampart: a town encloses itself without
  // dressing as a fortress, and the rampart stays the siege piece.
  // Segment runs are sized so every joint overlaps its neighbour or the
  // corner tower — the wall-integrity probe walks all four lines, and it has
  // already caught a five-metre hole beside each gate pier and daylight at
  // two corners. A wall with gaps is scenery.
  for (const i of [-6, -5, -4, -3, -2, 2, 3, 4, 5, 6]) {
    b.prop('town_wall', i * 6.0 + (i > 0 ? 3.4 : -3.4), WALL_Z, 0, BOX.town_wall, 1);
  }
  b.prop('town_wall', -10.2, WALL_Z, 0, BOX.town_wall, 1);
  b.prop('town_wall', 10.2, WALL_Z, 0, BOX.town_wall, 1);
  for (let i = -7; i <= 7; i++) {
    b.prop('town_wall', i * 6.0, -38, 0, BOX.town_wall, 1);
  }
  for (const sx of [-42, 42]) {
    for (let i = 0; i < 12; i++) {
      b.prop('town_wall', sx, -39 + i * 6.0, Math.PI / 2, BOX.town_wall, 1);
    }
  }
  for (const [cx, cz] of [[-42, 26], [42, 26], [-42, -38], [42, -38]]) {
    b.prop('gate_tower', cx, cz, 0, BOX.gate_tower, 1);
  }
  // The gate: real piers (the model existed only as a name until this round —
  // the fort's flanks were invisible colliders), and the arch beam over the
  // opening as pure scenery: no box, walk through.
  b.prop('gate_tower', -5.9, WALL_Z, 0, BOX.gate_tower, 1);
  b.prop('gate_tower', 5.9, WALL_Z, 0, BOX.gate_tower, 1);
  b.prop('town_arch', 0, WALL_Z, 0, null, 1);
  // Outside the wall: the road up, and what the last fight left on it.
  b.prop('truck_wreck', 11, 33, 0.9, BOX.truck_wreck, 1);
  b.prop('sandbags', -8, 31, 0.3, BOX.sandbags, 1.2);
  // A guard post just inside the arch.
  b.prop('checkpoint', -7, 22, 0, BOX.checkpoint, 1);
  b.prop('checkpoint_boom', -5.5, 22, 0, null, 1);
  b.prop('sandbags', 7, 22.5, -0.2, BOX.sandbags, 1.1);

  // ---- the road in: a loose gate row, then it opens onto the square ----
  // Three buildings, not four parallel rows: the road is ~13m wide and the
  // town breathes around it, the way the model games' towns do.
  b.prop('town_house_2', -8.4, 16, Math.PI / 2, BOX.town_house_2, 1);
  b.prop('town_house', 8.6, 17.5, -Math.PI / 2, BOX.town_house, 1);
  b.prop('town_house_2', 8.8, 9.5, -Math.PI / 2, BOX.town_house_2, 1);

  // ---- the square: stalls around a well, the hall at its head ----
  b.prop('market_stall', -7, 2, 0, BOX.market_stall, 1);
  b.prop('market_stall', -7, -7, 0, BOX.market_stall, 1);
  b.prop('market_stall', 7, 2, Math.PI, BOX.market_stall, 1);
  b.prop('market_stall', 7, -7, Math.PI, BOX.market_stall, 1);
  // The pump house is the well: offset from the centre like a real one.
  b.prop('generator', 3.4, -1.5, 0.15, BOX.generator, 1);
  b.prop('crate', -2.4, 1.4, 0.4, BOX.crate, 1);
  b.prop('town_hall', 0, -17, 0, BOX.town_hall, 1);

  // ---- the west quarter: housing, staggered, with air between ----
  b.prop('town_house', -20, 10, 0, BOX.town_house, 1);
  b.prop('town_house_2', -28, 4, Math.PI / 2, BOX.town_house_2, 1);
  b.prop('town_house', -19, -2, Math.PI / 2, BOX.town_house, 1);
  b.prop('town_house', -28, -12, 0, BOX.town_house, 1);
  b.prop('town_house_2', -20, -14, Math.PI, BOX.town_house_2, 1);
  b.prop('pipe_run', -24, -3, 0, BOX.pipe_run, 1);

  // ---- the east quarter: the trade yard ----
  b.prop('town_house_2', 24, 6, -Math.PI / 2, BOX.town_house_2, 1);
  b.prop('container', 27, -2, 0.15, BOX.container, 1);
  b.prop('container', 30, -8, 0, BOX.container, 1);
  b.prop('generator', 25, -13, 0, BOX.generator, 1);

  // ---- the north quarter: the station the town is named for ----
  b.prop('bunker', -12, -28, 0, BOX.bunker, 1.1);
  b.prop('comms_mast', -3, -30, 0, BOX.comms_mast, 1.2);
  b.prop('antenna_small', -7, -27, 0, BOX.antenna_small, 1);
  b.prop('town_house', 14, -27, Math.PI, BOX.town_house, 1);
  b.prop('town_house_2', 24, -26, Math.PI / 2, BOX.town_house_2, 1);

  // Rubbish where people live: in the quarters' pockets, never in the road.
  b.scatter(['crate'], 5, 6, -24, 5, () => BOX.crate);
  b.scatter(['crate'], 5, -15, 15, 5, () => BOX.crate);
  b.scatter(['crate'], 4, 17, 12, 4, () => BOX.crate);

  // Reserved AFTER the authored scatters (which use clear() and would refuse
  // reserved ground) and BEFORE the random passes build() runs next: the
  // road out to the spawn, and the whole interior, so outskirt clusters land
  // outside the walls where they belong.
  b.protect(0, 36, 4.4, 24);
  b.protect(0, -6, 41, 31);
  b.scatter(['rock_0', 'rock_1'], 8, 0, 44, 34);
  b.perimeter(64);

  return {
    name: 'THE TOWN',
    // Lived-in: warmer light, dust in the air, smoke from something burning.
    palette: {
      fog: 0x55483a, ground: 0x5a5142, groundLow: 0x312b22, acc: 0x565c38,
      sky: 0x4a4038, sun: 0xf0c88c, sunI: 3.2, amb: 0x6a6a74, ambI: 2.0,
    },
    playerSpawn: { x: 0, z: 50, ry: 0 },
    extraction: { x: 0, z: 53 },
    enemyFaction: 'syndic',
    objectivePoint: { x: 0, z: -5 },
    // Where things are in town, for the walking visit. Each anchor sits on
    // open ground beside its structure: the trader in the stall aisle, the
    // clerk where the road opens onto the square, the hiring agent at the
    // trade yard, the medic in the west quarter, the notable behind the hall.
    // The way out is just inside the arch. A layout that declares no areas
    // cannot be walked; add these to its builder to open it up.
    areas: [
      { id: 'market', x: -4.4, z: -3, service: 'market', label: 'The market' },
      { id: 'board', x: 4.4, z: 10, service: 'contracts', label: 'The posting board' },
      { id: 'recruit', x: 19.5, z: -2, service: 'recruit', label: 'The hiring row' },
      { id: 'medical', x: -15, z: -2, service: 'medical', label: 'The infirmary' },
      { id: 'favour', x: 0, z: -22.6, label: 'A door with a name on it' },
    ],
    gate: { x: 0, z: 22.8 },
    garrison: [[-3.2, 19], [3.2, 19], [-8, -3], [8, 4.6], [0, -10.5], [-24, -7], [24, -16], [0, -26]],
    patrols: [
      [[-10.5, 1], [-10.5, -9.5], [10.5, -9.5], [10.5, 1], [-10.5, 1]],
      [[0, 21], [0, 3.6], [0, 21]],
      [[-35, 18], [-35, -33], [35, -33], [35, 18], [-35, 18]],
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
  b.prop('checkpoint_boom', -1.5, 24, 0, null, 1);
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
      fog: 0x46443a, ground: 0x4e4a3e, groundLow: 0x282721, acc: 0x545830,
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
  // The curtain runs PAST the largest bounds any fight can have — spread
  // caps at 1.75, so ±112 × 1.75 ≈ ±196, and the segments reach ±198. It
  // used to stop at ±72 (walk around the castle), was fixed to ±117, and
  // then army sieges started sizing the site by the host (spread from
  // enemyArmy) — which made ±117 flankable again at exactly the scale where
  // walls matter most. A wall that can be flanked on foot is scenery.
  for (let i = -22; i <= 22; i++) {
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
  // 4.9, not 4.1: the walk has to put a standing eye ABOVE the 5.3 parapet
  // cap, or everyone posted up there is walled off from their own war.
  const WALK = 4.9;
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
      fog: 0x48453c, ground: 0x55503f, groundLow: 0x2b2820, acc: 0x4a5642,
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

/**
 * THE PIT — an arena, not a battlefield.
 *
 * Every other site is an arrangement of cover on open ground; the pit is the
 * opposite on purpose. A clean square floor with nothing to hide behind, a
 * wall the fight cannot leave, and the town standing on the rim watching —
 * because a commander who fights in front of the town is the entire point of
 * the pit, and a paintball field of random debris said none of that.
 */
function siteArena(b) {
  const R = 26;
  // The bowl: a full circuit of wall, the corners plugged with towers. The
  // ring is what makes it an arena — there is no third place to be. Axis-
  // aligned segments only, because prop collision is axis-aligned.
  for (let i = -3; i <= 3; i++) {
    b.prop('rampart', i * 9, -R, 0, BOX.rampart, 1);
    b.prop('rampart', i * 9, R, 0, BOX.rampart, 1);
    b.prop('rampart', -R, i * 9, Math.PI / 2, BOX.rampart, 1);
    b.prop('rampart', R, i * 9, Math.PI / 2, BOX.rampart, 1);
  }
  for (const [cx, cz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
    b.prop('gate_tower', cx, cz, 0, BOX.gate_tower, 1);
  }
  // The crowd, up on the rim. Static like every townsperson in the Reach —
  // they are an audience, not participants, so no collision and no AI. Faces
  // and stances vary by deterministic jitter, not rng: the same arena should
  // photograph the same twice.
  const faces = ['soldier_prisoner', 'soldier_scour', 'soldier_littoral',
    'soldier_trust', 'soldier_syndic', 'soldier_bracket'];
  const TOP = 6.2;                                   // standing on the wall
  let k = 0;
  for (let i = -3; i <= 3; i++) {
    for (const [x, z] of [
      [i * 9 + ((i * 37) % 5) - 2, -R], [i * 9 + ((i * 53) % 5) - 2, R],
      [-R, i * 9 + ((i * 41) % 5) - 2], [R, i * 9 + ((i * 29) % 5) - 2],
    ]) {
      // Facing the floor, with a little lean either way so the rim reads as
      // a crowd rather than a parade.
      const face = Math.atan2(0 - x, 0 - z) + (((k * 7) % 3) - 1) * 0.22;
      b.prop(faces[k % faces.length], x, z, face, null, 1, TOP);
      k++;
    }
  }
  // A clean floor is the design. Reserve the whole bowl and rim so the
  // generic dressing passes cannot scatter crates across a fighting floor.
  b.protect(0, 0, 44, 44);

  return {
    name: 'THE PIT',
    palette: {
      fog: 0x453f38, ground: 0x5a5142, groundLow: 0x2e2a22, acc: 0x6a5136,
      sky: 0x3b3d40, sun: 0xe8b070, sunI: 3.1, amb: 0x6a6a78, ambI: 1.9,
    },
    playerSpawn: { x: 0, z: 14, ry: Math.PI },
    extraction: { x: 0, z: 14 },
    objectivePoint: { x: 0, z: 0 },
    enemyFaction: 'raider',
    garrison: [],
    patrols: [],
  };
}

/**
 * THE APPROACHES — a battlefield authored for the tactical camera.
 *
 * Every older site was dressed for the shoulder view: cover that reads at
 * eye height, scattered so any direction works. From above that is noise.
 * This one is built to be READ from the tactical camera: a fast, exposed
 * road up the middle; two cover-rich flank lanes walled off from it by
 * container trains with deliberate crossover gaps; garrison posts at
 * intervals a control group can be ordered to hold; and a compound at the
 * north end that is unmistakably the objective. Lanes are decisions —
 * which one, and when to cross — which is what a top-down battle is FOR.
 */
function siteField(b) {
  // The road: a clear strip the whole length of the field. Reserved, so no
  // dressing pass ever parks a crate on the one fast lane.
  b.protect(0, 0, 8, 78);

  // Gabion lines wall the road from the flank lanes — built fortification,
  // not a freight yard. Every fourth bay is left open: the crossovers are
  // where fights happen, so they are authored, not accidental.
  for (let i = -6; i <= 6; i++) {
    if (((i + 60) % 4) === 3) continue;               // the crossover gaps
    b.prop('hesco_line', -15, i * 10.5, Math.PI / 2, BOX.hesco_line, 1.05);
    b.prop('hesco_line', 15, i * 10.5 + 5, Math.PI / 2, BOX.hesco_line, 1.05);
  }

  // Garrison posts: a tower and a sandbag arc, both flanks, three depths.
  // A post is somewhere a control group can be SENT — visible from high up,
  // defensible when it gets there.
  for (const pz of [-44, 2, 46]) {
    for (const px of [-32, 32]) {
      b.prop('watchtower', px, pz, 0, BOX.watchtower, 1);
      b.prop('sandbags', px - 4, pz + 4, 0.4, BOX.sandbags, 1.2);
      b.prop('sandbags', px + 4, pz + 4, -0.4, BOX.sandbags, 1.2);
      b.prop('barrier', px, pz + 6, 0, BOX.barrier, 1);
    }
  }

  // West lane: industrial wreckage — hard cover, tight sightlines.
  b.prop('truck_wreck', -38, -20, 0.7, BOX.truck_wreck, 1);
  b.prop('truck_wreck', -44, 24, -0.4, BOX.truck_wreck, 1);
  b.prop('pipe_run', -40, -2, 0, BOX.pipe_run, 1);
  b.prop('container', -48, -34, 0.3, BOX.container, 1);
  b.prop('container', -34, 36, Math.PI / 2, BOX.container, 1);
  b.scatter(['crate'], 8, -41, 0, 26, () => BOX.crate);

  // East lane: a ruined hab row — rooms to clear, roofs to hold.
  b.prop('hab_block', 38, -26, Math.PI / 2, BOX.hab_block, 1);
  b.prop('hab_block', 44, 12, 0, BOX.hab_block, 1);
  b.prop('hab_block', 36, 34, Math.PI / 2, BOX.hab_block, 1);
  b.prop('generator', 42, -8, 0, BOX.generator, 1);
  b.scatter(['crate'], 8, 41, 4, 26, () => BOX.crate);

  // The compound: what the whole field is walked toward.
  b.prop('bunker', 0, -64, 0, BOX.bunker, 1.15);
  b.prop('comms_mast', -8, -68, 0, BOX.comms_mast, 1.2);
  b.prop('sandbags', -6, -57, 0.5, BOX.sandbags, 1.3);
  b.prop('sandbags', 6, -57, -0.5, BOX.sandbags, 1.3);
  b.prop('barrier', 0, -55, 0, BOX.barrier, 1);
  b.prop('fuel_tank', 10, -66, 0, BOX.fuel_tank, 1.2);

  b.perimeter(80);

  return {
    name: 'THE APPROACHES',
    palette: {
      fog: 0x4a463c, ground: 0x585243, groundLow: 0x2c2921, acc: 0x505c46,
      sky: 0x40424a, sun: 0xe6bc82, sunI: 2.9, amb: 0x687080, ambI: 2.0,
    },
    playerSpawn: { x: 0, z: 72, ry: 0 },
    extraction: { x: 0, z: 74 },
    objectivePoint: { x: 0, z: -62 },
    enemyFaction: 'syndic',
    // The posts and the compound, held from the start.
    garrison: [
      [-32, -44], [32, -44], [-32, 2], [32, 2],
      [0, -58], [-8, -62], [8, -62], [0, -50],
    ],
    patrols: [
      [[-32, -44], [-32, 46], [-32, -44]],
      [[32, 46], [32, -44], [32, 46]],
      [[0, -50], [0, -20], [0, -50]],
    ],
  };
}

/**
 * THE BASTION — the army siege map, authored like THE APPROACHES.
 *
 * A summoned siege used to play on whatever layout the town happened to
 * have. This is ground built for the thing itself: an approach half with
 * lanes and staging posts the attacker maneuvers a host up, a full-span
 * curtain with one gate that is genuinely the only way in, and an inside
 * laid out as streets around an inner keep so the post-breach clearance
 * reads from the tactical camera too. The siege is two battles — getting
 * to the wall, and what is behind it — and the map says so.
 */
function siteBastion(b) {
  const WALL_Z = -10;

  // ---- the approach half -------------------------------------------------
  // The road to the gate: clear, fast, and watched by the whole wall.
  b.protect(0, 30, 8, 46);
  // Gabion lines wall the road from the flank lanes, crossovers every
  // fourth bay — same grammar as THE APPROACHES, so a commander who learned
  // one map has learned the other.
  for (let i = 1; i <= 6; i++) {
    if ((i % 4) === 3) continue;
    b.prop('hesco_line', -15, 4 + i * 10.5, Math.PI / 2, BOX.hesco_line, 1.05);
    b.prop('hesco_line', 15, 9 + i * 10.5, Math.PI / 2, BOX.hesco_line, 1.05);
  }
  // Staging posts: where the attacker forms up OUT of the wall's best arcs.
  for (const [px, pz] of [[-36, 22], [36, 22], [-36, 58], [36, 58]]) {
    b.prop('watchtower', px, pz, 0, BOX.watchtower, 1);
    b.prop('sandbags', px - 4, pz + 4, 0.4, BOX.sandbags, 1.2);
    b.prop('sandbags', px + 4, pz + 4, -0.4, BOX.sandbags, 1.2);
    b.prop('barrier', px, pz + 6, 0, BOX.barrier, 1);
  }
  b.prop('truck_wreck', -44, 40, 0.6, BOX.truck_wreck, 1);
  b.prop('truck_wreck', 46, 44, -0.5, BOX.truck_wreck, 1);
  b.scatter(['crate'], 6, -42, 40, 18, () => BOX.crate);
  b.scatter(['crate'], 6, 42, 40, 18, () => BOX.crate);

  // ---- the curtain ---------------------------------------------------------
  // Full span past the largest possible bounds (spread caps at 1.75 →
  // ±196; segments reach ±198). One gate. That is the whole argument.
  for (let i = -22; i <= 22; i++) {
    if (i === 0) continue;
    b.prop('rampart', i * 9.0, WALL_Z, 0, BOX.rampart, 1);
  }
  b.prop('gate', 0, WALL_Z, 0, 'auto', 1);
  b.prop('gate_tower', -7.6, WALL_Z, 0, BOX.gate_tower, 1);
  b.prop('gate_tower', 7.6, WALL_Z, 0, BOX.gate_tower, 1);
  b.prop('watchtower', -24, WALL_Z - 3, 0, BOX.watchtower, 1);
  b.prop('watchtower', 24, WALL_Z - 3, 0, BOX.watchtower, 1);
  // The wall walk, and stairs up from INSIDE only. 4.9 puts a standing eye
  // above the 5.3 parapet cap — see the fort for the whole argument.
  const WALK = 4.9;
  for (let i = -8; i <= 8; i++) {
    if (i === 0) continue;
    b.deck('catwalk', i * 9.0, WALL_Z + 2.2, 0, BOX.catwalk, 1.1, WALK);
  }
  b.stairsTo([[-18, WALL_Z + 3.4, 0, -1], [-27, WALL_Z + 3.4, 0, -1]], WALK);
  b.stairsTo([[18, WALL_Z + 3.4, 0, -1], [27, WALL_Z + 3.4, 0, -1]], WALK);

  // ---- inside: streets, then the keep -------------------------------------
  // The avenue continues the road so the breach pours somewhere legible.
  b.protect(0, -34, 7, 24);
  for (const [hx, hz, r] of [
    [-14, -24, Math.PI / 2], [14, -26, Math.PI / 2],
    [-16, -40, 0], [16, -42, 0],
    [-13, -56, Math.PI / 2], [14, -55, Math.PI / 2],
  ]) {
    b.prop('hab_block', hx, hz, r, BOX.hab_block, 1);
  }
  b.prop('generator', -24, -33, 0, BOX.generator, 1);
  b.prop('container', 26, -30, 0.2, BOX.container, 1);
  b.prop('container', -26, -48, Math.PI / 2, BOX.container, 1);
  // The keep: the reason the town matters, ringed and defended.
  b.prop('bunker', 0, -72, 0, BOX.bunker, 1.2);
  b.prop('comms_mast', -9, -76, 0, BOX.comms_mast, 1.2);
  b.prop('fuel_tank', 10, -74, 0, BOX.fuel_tank, 1.2);
  b.prop('sandbags', -6, -64, 0.5, BOX.sandbags, 1.3);
  b.prop('sandbags', 6, -64, -0.5, BOX.sandbags, 1.3);
  b.prop('barrier', 0, -62, 0, BOX.barrier, 1);
  b.scatter(['rock_0', 'rock_2'], 8, 0, 78, 26);
  b.perimeter(86);

  return {
    name: 'THE BASTION',
    palette: {
      fog: 0x46423a, ground: 0x544e40, groundLow: 0x2a2720, acc: 0x4c5844,
      sky: 0x3e4046, sun: 0xe8bc84, sunI: 2.9, amb: 0x667080, ambI: 2.0,
    },
    playerSpawn: { x: 0, z: 74, ry: 0 },
    extraction: { x: 0, z: 76 },
    // Deep inside: the gate is the beginning, the keep is the end.
    objectivePoint: { x: 0, z: -70 },
    enemyFaction: 'syndic',
    // Wall posts make the approach expensive; street and keep posts make
    // the breach expensive. Same doctrine as the fort, twice the depth.
    garrison: [
      [-9, -12], [9, -12], [-18, -12], [18, -12],
      [0, -20], [-14, -33], [14, -34], [0, -46],
      [-10, -60], [10, -60], [0, -66], [-6, -72], [6, -72],
    ],
    patrols: [
      [[-20, -22], [20, -22], [-20, -22]],
      [[0, -30], [0, -56], [0, -30]],
      [[-14, -64], [14, -64], [-14, -64]],
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
  arena: siteArena,
  field: siteField,
  bastion: siteBastion,
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
  // Graded ground, decided BEFORE the layout runs: every prop seats itself
  // against heightAt() as it is placed, so the pad cannot come from the
  // layout's own return value. Keyed here, beside the site table. The pad
  // covers the walled town; the fade reaches the terrain outside the gate.
  const FLATTENS = {
    settlement: { x: 0, z: -6, r: 56, fade: 14 },
    // A fighting floor is FLAT. A pit fought on a hillside is a joke.
    arena: { x: 0, z: 0, r: 44, fade: 12 },
  };
  const fl = FLATTENS[siteId];
  FLAT = null;                                     // never inherit a pad
  if (fl) FLAT = { ...fl, y: rawHeight(fl.x, fl.z) };
  // How much ground this particular fight gets.
  //
  // Every site used to be the same size whatever was happening on it, so a
  // four-man ambush and a sixty-strong assault were fought in an identically
  // sized box — which left the small fights empty and the large ones playing
  // like a crowd in a corridor. The spread override scales the playable
  // radius with the weight of the encounter, and the scatter with its area.
  const BOUND = Math.round(BOUNDS * (override.spread || 1));
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
  b.outskirts(26, BOUND - 14, Math.round(34 * (override.spread || 1) ** 2));
  // ...and the spawn's own surroundings, which the ring above starts outside of.
  // Run after it so the clear() checks see everything already placed.
  if (meta.playerSpawn) {
    b.nearGround(meta.playerSpawn.x, meta.playerSpawn.z, 26, 30);
  }

  const group = new THREE.Group();
  const ground = buildGround(BOUND * 4.2, meta.palette.ground, meta.palette.groundLow,
    meta.palette.acc);
  group.add(ground);

  // Scenery is baked into one mesh per model rather than placed as a clone
  // each. A clone of a kit model is several meshes with several materials, so a
  // dressed site was spending most of its draw calls on rocks that never move.
  // Nothing here needs individual identity — anything that does (interactables,
  // the gate, characters) is built elsewhere and stays its own object.
  group.add(Models.mergeProps(b.props));

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
    // Same lesson as the two lines above: this return is a whitelist, and a
    // meta field that is not named here silently never reaches the mission.
    areas: meta.areas || null,
    gate: meta.gate || null,
    bounds: BOUND,
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
    // What it stands proud of the ground by, not how far its sealed base
    // reaches down — a kerb on a slope is still a kerb you step over.
    if ((o.coverH ?? o.h) < 0.5) continue;
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
export function raycast(obstacles, ax, az, bx, bz, height = 1.2, maxT = 1, ay = null, by = null) {
  let best = null;
  const dx = bx - ax, dz = bz - az;
  for (const o of obstacles) {
    const t = segBox(ax, az, dx, dz, o);
    if (t === null || t > maxT) continue;
    // The sightline's height WHERE IT CROSSES this box.
    //
    // `height` is an absolute world y, and every caller was passing an eye
    // height — 1.45, 1.5 — which is a height above the ground. Those are the
    // same number only while the ground is at y=0, which it was for a long
    // time. With real relief a barricade standing on ground at -3m has its top
    // at -1.5m, which is below 1.45, so this concluded the shot passed over it.
    // Cover on low ground stopped blocking anything at all, findCover() could
    // not find a position that broke a sightline, and the squad walked to a
    // wall and stood beside it in the open.
    const y = ay !== null ? ay + (by - ay) * t : height;
    if (o.y + o.h < y) continue; // passes over this one
    // ...and under this one. Only decks and walkways are ever raised clear of
    // the ground, but without this the sight model disagreed with the bullet
    // model: rayHit() has always tested a true 3D box and let rounds through
    // the gap, while this said the same box was solid to the floor. Two ray
    // systems answering differently is what makes cover unreadable.
    if (o.y > y) continue;
    if (!best || t < best.t) {
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
  // `eye` is a height above the ground at each end, so the sightline runs
  // between two absolute points that are only equal on flat ground.
  const ay = heightAt(ax, az) + eye;
  const by = heightAt(bx, bz) + eye;
  if (raycast(obstacles, ax, az, bx, bz, eye, 1, ay, by)) return false;
  // The ground blocks too, now that there is some.
  //
  // This was safe to leave out while the pan was flat, and became a bug the
  // moment it was not: rayHit() has always walked the terrain and stopped
  // rounds in a hillside, so without the same test here the AI would hold a
  // target through a ridge, shoot the near slope for as long as it took to
  // reload, and never understand why nobody died. Every mismatch between what
  // the AI believes it can see and where its bullets actually go reads to the
  // player as the game cheating in one direction or the other.
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d < 6) return true;              // too short for relief to matter
  // One sample per ~8m. The swells are 60m across, so this cannot step over a
  // crest, and it keeps the cost sane where hasLOS is called per candidate.
  const steps = Math.min(16, Math.max(3, Math.round(d / 8)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (heightAt(ax + dx * t, az + dz * t) > ay + (by - ay) * t) return false;
  }
  return true;
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
