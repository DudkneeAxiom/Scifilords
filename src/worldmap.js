// Strategic layer.
//
// This is a place, not a menu. The player drives a vehicle token across real
// terrain, roads connect settlements that actually sit on the ground, and the
// other parties move whether or not anyone is watching them. Everything the
// player can see here is read from the campaign state each frame, so a mission
// result changes the map the moment they come back to it.

import * as THREE from '../vendor/three/three.module.min.js';
import * as Models from './models.js';
import * as Audio from './audio.js';
import { LOCATIONS, REGION, REGIONS, FACTIONS, PARTY_TIERS } from './data.js';
import * as State from './state.js';
import * as Dip from './diplomacy.js';
import { clamp, lerp, rng, range, pick } from './util.js';
// The ground lives in its own module so the simulation can read it too. It used
// to be defined here, which meant state.js — imported by this file — could not
// see the terrain its parties were walking across without a cycle.
import { regionHeight, regionMoisture, travelFactor, clampToRegion, ROADS, HALF } from './region.js';

export { regionHeight, regionMoisture };
// Fast-forward. Four is about the most you can run the map at before you drive
// straight past the parties you were meant to notice.
const FAST = 4;
// Game hours per real second at normal speed. Chosen to preserve the pace
// travel already had — the old rule worked out at 1.6 hours per second on the
// road, and this keeps a company at full speed covering exactly the same ground
// per second as before. Only standing still changes, from 3% of that to all
// of it.
const HOURS_PER_SECOND = 1.6;

// Border-line hues. These are drawn as thin surveyed boundaries rather than a
// wash over the terrain, so they can afford to be saturated — the ground stays
// visible on both sides of them, and the line is what carries the meaning.
const TERRITORY_TINTS = {
  trust: 0x3fb8c4,   // cold cyan — the chartered administration
  syndic: 0xd8434f,  // signal red — the work-councils
  raider: 0xa855c8,  // violet — nobody's writ, everybody's problem
};

// --------------------------------------------------------------------------
// Terrain
// --------------------------------------------------------------------------

/**
 * The Reach is a basin: high broken ground around the rim, a flat drained pan
 * in the middle. Settlements sit in the pan; the rim is what makes the region
 * feel enclosed and the fog do its work.
 */

export class WorldMap {
  constructor({ campaign, container, onEnterLocation, onEncounter, onHud, onBattle, onEvent }) {
    this.S = campaign;
    this.container = container;
    this.onEnterLocation = onEnterLocation;
    this.onEncounter = onEncounter;
    this.onHud = onHud || (() => {});
    this.onBattle = onBattle || null;
    this.onEvent = onEvent || null;
    this.partyMeshes = new Map();
    this.zoom = 1;
    this.disposed = false;
    this.travelling = false;
    // Which band the company is running down, if any. Held by id rather than by
    // reference, so a party that dies or is culled simply stops resolving and
    // the chase ends on its own.
    this.chaseId = null;
    // How far the view has been pushed off the company by dragging. Cleared by
    // recentre() and by anything that means the player wants to see themselves.
    this.camPan = { x: 0, z: 0 };
    this.panning = null;
    this.encounterCooldown = {};
    this.nearSet = new Set();
    this.nearSeeded = false;
    this.keys = new Set();
    // How fast the world runs. Time on the map used to pass only while the
    // company was physically moving, which meant that waiting — for a contract
    // to appear, a caravan to come back, a wound to close — was something you
    // could only do by driving in circles. Halting is the other half of it:
    // the map is where you make decisions, and you should be able to stop it
    // while you make one.
    this.timeScale = 1;
    this._handlers = [];
  }

  start() {
    this.build();
    this.bindInput();
    Audio.ambience('world');
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  build() {
    const w = this.container.clientWidth || 1280;
    const h = this.container.clientHeight || 800;
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * 0.85);
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2c26);
    // Fog is set well beyond the camera distance so the rim reads as haze
    // rather than swallowing the middle of the basin.
    this.scene.fog = new THREE.Fog(0x3c3e34, 900, 4200);

    // Far plane has to clear a continent: at full zoom-out the eye sits ~3.5km
    // back, and the old 2200 clipped the entire landmass away.
    this.camera = new THREE.PerspectiveCamera(46, w / h, 5, 22000);

    // Ambient down, sun up.
    //
    // A hemisphere light at 1.5 lights every normal to nearly the same value,
    // which is exactly the wrong thing for terrain: it flattens the ground into
    // a single flat colour no matter what shape it is. The relief cannot read
    // unless a slope facing the sun is meaningfully brighter than one facing
    // away, and that difference is what the faceted look is made of.
    this.scene.add(new THREE.HemisphereLight(0x6a7480, 0x201f18, 0.62));
    const sun = new THREE.DirectionalLight(0xe8c489, 3.1);
    sun.position.set(-620, 900, 460);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 1500;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 4200;
    // A shadow texel covers ~0.4 world units here, so the default-ish bias
    // produced blotchy self-shadowing across the whole basin. normalBias is in
    // world units and is the correct control at this scale.
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 2.6;
    this.scene.add(sun);
    this.sun = sun;

    this.buildTerrain();
    this.buildBackdrop();
    this.buildTerritory();
    this.buildRoads();
    this.buildLocations();
    this.buildPlayerToken();
    this.buildLabels();
    this.buildRegionLabels();

    this.destMarker = this.makeRing(0xb8863f, 14);
    this.destMarker.visible = false;
    this.scene.add(this.destMarker);

    this.onResize = () => {
      const cw = this.container.clientWidth, ch = this.container.clientHeight;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(cw, ch);
    };
    window.addEventListener('resize', this.onResize);
  }

  buildTerrain() {
    // The mesh runs well past the playable region so the camera never sees the
    // edge of the world at full zoom-out; the overspill is all rim.
    // Finer than it was: the terrain now carries features down to ~170 units,
    // and at 210 segments those fell below the sample spacing and turned to
    // noise. 288 puts roughly five samples across the smallest landform.
    // The mesh runs far past the crest, because the world has to CONTINUE
    // over it: outer steppe and further ranges dissolving into haze, not a
    // wall with nothing behind it. The extra ground is cheap — it is the
    // same vertex budget spent wider — and it is the difference between "the
    // map ends here" and "the Reach ends here".
    const seg = 336;
    const geo = new THREE.PlaneGeometry(REGION.size * 2.4, REGION.size * 2.4, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // A wider ramp than the terrain strictly needs. The political layer no
    // longer paints over the ground, so the ground has to carry the map on its
    // own: cold silt in the deepest pan, dry scrub through the basin, bare rock
    // and pale stone up the rim.
    // Biomes, not an elevation ramp.
    //
    // Colour used to be a pure function of height, so the whole continent was
    // one gradient repeated everywhere and no two places looked like different
    // country. Elevation still decides the broad band, but moisture decides
    // WHICH band — so the map has a wet green side and a dry ochre one, with
    // the change happening over hundreds of units rather than per vertex, and
    // the same elevation reads differently depending on where you are.
    // Pulled further apart than looks sensible in a swatch. Two palettes that
    // differ only slightly average out to one colour across a whole screen, and
    // the map went back to reading as uniform olive — at this camera height the
    // separation has to survive being seen a thousand units away through haze.
    const cMarsh = new THREE.Color(0x27403a);  // standing water in the deep pan
    const cSilt = new THREE.Color(0x453f30);
    const cGrass = new THREE.Color(0x44602f);  // the watered side of the basin
    const cScrub = new THREE.Color(0x6b5c37);
    const cDust = new THREE.Color(0x8a7748);   // the dry side
    const cUpland = new THREE.Color(0x5d6a4a);
    const cRock = new THREE.Color(0x7e7264);   // exposed stone on the rim
    const cPeak = new THREE.Color(0xa79d88);
    const c = new THREE.Color();
    const wet = new THREE.Color();
    const dry = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = regionHeight(x, z);
      pos.setY(i, y);
      const m = regionMoisture(x, z);
      // Two ramps of the same shape, one for wet country and one for dry, mixed
      // by the moisture field. Keeping the ramps parallel is what stops the
      // boundary reading as a seam.
      const t = clamp((y + 60) / 200, 0, 1);
      if (t < 0.28) {
        wet.copy(cMarsh).lerp(cGrass, t / 0.28);
        dry.copy(cSilt).lerp(cScrub, t / 0.28);
      } else if (t < 0.62) {
        wet.copy(cGrass).lerp(cUpland, (t - 0.28) / 0.34);
        dry.copy(cScrub).lerp(cDust, (t - 0.28) / 0.34);
      } else {
        wet.copy(cUpland).lerp(cPeak, (t - 0.62) / 0.38);
        dry.copy(cDust).lerp(cRock, (t - 0.62) / 0.38);
      }
      c.copy(dry).lerp(wet, m);

      // Steep ground is bare rock whatever the climate. This is what makes the
      // relief legible as relief: a hillside catches a different colour from
      // the ground either side of it, so the facets describe a shape instead of
      // just being darker.
      const gx = (regionHeight(x + 26, z) - regionHeight(x - 26, z)) / 52;
      const gz = (regionHeight(x, z + 26) - regionHeight(x, z - 26)) / 52;
      const slope = clamp(Math.hypot(gx, gz) * 1.5, 0, 1);
      c.lerp(cRock, slope * 0.55);
      // Contour banding. Quantising elevation into steps and darkening the
      // seam between them turns the basin into something that reads as a
      // surveyed map sheet rather than a smooth brown expanse — the terrain
      // becomes legible at a glance instead of merely present. This is why the
      // political layer no longer needs to paint over it.
      // One contour every 15m. In the basin — where the player spends the
      // whole early game — a 20m interval produced two lines and nothing else.
      // Contours, lighter than they were. They existed to make a flat plate
      // legible; now that the ground has shape of its own they only need to
      // help read gradient, and at the old strength they fought the landforms.
      const band = y / 25;
      const seam = Math.abs(band - Math.round(band));
      const contour = seam < 0.06 ? -0.05 : 0;
      c.offsetHSL(0, 0, contour);

      // No grain term.
      //
      // There used to be two, at 30 and 82 units of wavelength, against a mesh
      // that samples every 35. Both were at or under the sample spacing, so
      // neither could ever resolve as texture — each vertex simply picked an
      // arbitrary point on the wave, which is precisely the per-vertex speckle
      // that made this look pixelated. Facets and slope shading do the job that
      // grain was reaching for, and they do it at a scale the mesh can carry.
      colors[i * 3] = clamp(c.r, 0, 1);
      colors[i * 3 + 1] = clamp(c.g, 0, 1);
      colors[i * 3 + 2] = clamp(c.b, 0, 1);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;

    // Rim scatter. Scales are kept well under the settlement models — earlier
    // these were large enough to produce 60m trees that dwarfed towns — and
    // none of it casts shadows: at this camera height a scatter shadow is just
    // an unreadable dark smear on the terrain.
    const r = rng(this.S.seed ^ 0x5eed);
    const place = (m, x, z, s) => {
      m.position.set(x, regionHeight(x, z) - 0.6, z);
      m.scale.setScalar(s);
      m.rotation.y = r() * 6.28;
      m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this.scene.add(m);
    };
    for (let i = 0; i < 210; i++) {
      const a = r() * Math.PI * 2;
      const dd = range(r, 0.5, 0.99) * HALF;
      const x = Math.cos(a) * dd, z = Math.sin(a) * dd;
      const isRock = r() < 0.84;
      place(Models.get(isRock ? pick(r, ['rock_0', 'rock_1', 'rock_2', 'rock_3']) : 'dead_tree'),
        x, z, isRock ? range(r, 4, 11) : range(r, 1.6, 3.0));
    }
    for (let i = 0; i < 70; i++) {
      const x = range(r, -HALF * 0.62, HALF * 0.62);
      const z = range(r, -HALF * 0.62, HALF * 0.62);
      const isRock = r() < 0.6;
      place(Models.get(isRock ? pick(r, ['rock_0', 'rock_2']) : 'dead_tree'),
        x, z, isRock ? range(r, 2.5, 6) : range(r, 1.2, 2.4));
    }
  }

  /**
   * The world beyond the Reach, in silhouette.
   *
   * Colossal structures on the outer steppe, past the rim, past the clamp:
   * dead dishes, a cooling stack, an antenna field, one half-buried hulk.
   * None of it is reachable and none of it needs collision — it exists so
   * that from anywhere inside the basin, looking outward shows a world that
   * keeps going, with places in it nobody is taking you. They are also the
   * region's compass: "the twin dishes" ARE north the way a mountain is,
   * which is navigation no UI marker provides.
   */
  buildBackdrop() {
    const put = (model, x, z, s, ry = 0) => {
      const m = Models.get(model);
      m.position.set(x, regionHeight(x, z) - s * 0.3, z);
      m.scale.setScalar(s);
      m.rotation.y = ry;
      m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this.scene.add(m);
    };
    // The twin dishes, north — dead deep-signal hardware on the Sarn steppe.
    put('radar_dish', -1250, -4550, 34, 0.6);
    put('radar_dish', -650, -4780, 26, -0.4);
    // A cooling stack cluster, southeast, past the Littoral.
    put('fuel_tank', 3850, 3350, 42, 0.2);
    put('fuel_tank', 4230, 3180, 34, 1.1);
    put('fuel_tank', 4030, 3640, 30, 2.0);
    // The antenna field, west of the Scour.
    for (let i = 0; i < 5; i++) {
      put('comms_mast', -4550 + (i % 3) * 260, 240 + i * 210, 16 + (i % 2) * 5, i);
    }
    // A half-buried hulk on the eastern steppe — nobody knows either.
    put('container', 4650, -1450, 52, 0.5);
    put('catwalk', 4480, -1650, 38, 0.9);
    // An old-regime tower alone in the north-west gap.
    put('gate_tower', -3900, -3300, 26, 0);
  }

  /**
   * Who owns what, drawn on the ground.
   *
   * Ownership is decided per point by the nearest settled location weighted by
   * its region — which produces contiguous, state-shaped domains rather than a
   * scatter of dots — and the result is laid over the terrain as a tinted
   * sheet. Where the owner changes between adjacent samples the sheet is
   * darkened, which reads as a border without needing a line renderer.
   */
  ownerAt(x, z) {
    let best = null, bestScore = Infinity;
    for (const l of LOCATIONS) {
      const owner = State.isHolding(this.S, l.id)
        ? (this.S.ownFaction?.id || 'player')
        : State.ownerOf(this.S, l.id);      // not l.faction: borders move now
      if (!owner) continue;
      const d = Math.hypot(l.x - x, l.z - z);
      // Settlements project authority further than an outpost does.
      const weight = l.kind === 'settlement' ? 0.72 : 1.0;
      const score = d * weight;
      if (score < bestScore) { bestScore = score; best = owner; }
    }
    // Authority runs out. Past that it is nobody's country.
    return bestScore > 900 ? null : best;
  }

  /** How many settled places each power actually holds right now. */
  countHoldings() {
    const S = this.S;
    const out = { trust: 0, syndic: 0, player: 0 };
    for (const l of LOCATIONS) {
      if (l.kind === 'open') continue;
      if (State.isHolding(S, l.id)) { out.player++; continue; }
      const owner = State.ownerOf(S, l.id);
      if (owner === 'trust') out.trust++;
      else if (owner === 'syndic') out.syndic++;
    }
    return out;
  }

  territoryColour(owner) {
    if (!owner) return null;
    if (owner === 'player' || owner === this.S.ownFaction?.id) {
      return new THREE.Color(this.S.ownFaction?.colour ?? 0xc08d3f);
    }
    // The political map gets its own palette. The faction colours are chosen to
    // sit believably on a uniform, which makes them muddy siblings when laid
    // flat over terrain — Trust olive and Syndic khaki are nearly the same
    // wash. On the map each power gets a hue nobody else uses.
    return new THREE.Color(TERRITORY_TINTS[owner] ?? FACTIONS[owner]?.color ?? 0x6a6458);
  }

  buildTerritory() {
    // Borders, not paint.
    //
    // A tinted sheet over the whole continent tells you who owns what at the
    // cost of the map underneath — the terrain you are actually navigating
    // turns into a colour wash. So this draws only the FRONTIER: the line where
    // one power's authority stops and another's begins, in that power's colour,
    // laid on the ground like a surveyed boundary.
    //
    // Traced, not stepped.
    //
    // This used to emit an axis-aligned quad for every grid cell that disagreed
    // with a neighbour, so a border could only ever run along grid lines and
    // came out as a staircase of little blocks — the single most artificial
    // thing on the map. Instead each power's claim is expressed as a continuous
    // field, and the line where that field meets its rivals is traced through
    // the cells with interpolation, which puts the border wherever it actually
    // falls rather than on the nearest grid edge.
    const seg = 300;
    const size = REGION.size * 1.25;
    const step = size / seg;
    const cols = seg + 1;
    const half = size / 2;

    // Every power that actually holds ground, and how strongly each one claims
    // each sample. Score is distance weighted by the kind of place claiming it,
    // so the strongest claim is the smallest number.
    const powers = [];
    for (const l of LOCATIONS) {
      if (l.kind === 'open') continue;
      const o = State.isHolding(this.S, l.id)
        ? (this.S.ownFaction?.id || 'player') : State.ownerOf(this.S, l.id);
      if (o && !powers.includes(o)) powers.push(o);
    }
    const REACH = 900;                        // past this, nobody's country
    const BORDER_INSET = 26;                  // how far inside its own ground each line sits
    const nP = powers.length;
    // score[p][i]: best claim power p has on sample i.
    const score = powers.map(() => new Float32Array(cols * cols).fill(Infinity));
    for (const l of LOCATIONS) {
      if (l.kind === 'open') continue;
      const o = State.isHolding(this.S, l.id)
        ? (this.S.ownFaction?.id || 'player') : State.ownerOf(this.S, l.id);
      if (!o) continue;
      const pi = powers.indexOf(o);
      const weight = l.kind === 'settlement' ? 0.72 : 1.0;
      const s = score[pi];
      for (let gz = 0; gz < cols; gz++) {
        const z = -half + gz * step;
        for (let gx = 0; gx < cols; gx++) {
          const x = -half + gx * step;
          const d = Math.hypot(l.x - x, l.z - z) * weight;
          const i = gz * cols + gx;
          if (d < s[i]) s[i] = d;
        }
      }
    }

    // Every frontier sample becomes a short ribbon segment facing the neighbour
    // it disagrees with, so a border is drawn twice — once in each owner's
    // colour — and a coastline against unclaimed ground is drawn once.
    const verts = [];
    const colors = [];
    // A surveyed line, not a slab: a fixed handful of metres wide regardless
    // of how finely the ownership grid is sampled.
    const W = 7;
    const LIFT = 6.0;           // clear of the terrain, under the labels

    const push = (x, z, c) => {
      verts.push(x, regionHeight(x, z) + LIFT, z);
      colors.push(c.r, c.g, c.b);
    };
    const quad = (ax, az, bx, bz, nx, nz, c) => {
      const p1x = ax + nx * W, p1z = az + nz * W;
      const p2x = ax - nx * W, p2z = az - nz * W;
      const p3x = bx + nx * W, p3z = bz + nz * W;
      const p4x = bx - nx * W, p4z = bz - nz * W;
      push(p1x, p1z, c); push(p2x, p2z, c); push(p3x, p3z, c);
      push(p3x, p3z, c); push(p2x, p2z, c); push(p4x, p4z, c);
    };

    // A ribbon between two points, mitred by the segment's own direction, so
    // consecutive pieces of a traced line meet instead of overlapping in a
    // stack of little rectangles.
    const ribbon = (ax, az, bx, bz, c) => {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;     // perpendicular, unit length
      quad(ax, az, bx, bz, nx, nz, c);
    };

    // Marching squares, one power at a time.
    //
    // phi is how much better this power's claim is than its best rival, so the
    // border is the contour phi = 0. Interpolating where that crossing falls
    // along each cell edge is what turns a staircase into a line: the vertex
    // lands at the true crossing point rather than at a grid corner.
    for (let pi = 0; pi < nP; pi++) {
      const c = this.territoryColour(powers[pi]);
      if (!c) continue;
      const mine = score[pi];
      const phi = new Float32Array(cols * cols);
      for (let i = 0; i < phi.length; i++) {
        let other = Infinity;
        for (let q = 0; q < nP; q++) {
          if (q !== pi && score[q][i] < other) other = score[q][i];
        }
        // Authority also simply runs out, so unclaimed ground bounds a power
        // exactly as a rival does.
        const bound = Math.min(other, REACH);
        // Traced just INSIDE this power's own ground rather than exactly on the
        // frontier. Two rivals share one frontier, so contouring both at zero
        // draws both lines through identical points and whichever is drawn
        // second simply hides the first — the map lost a colour. Offsetting
        // each inward runs them alongside each other, which is also how a real
        // survey draws a disputed line.
        phi[i] = (bound - mine[i]) - BORDER_INSET;
      }

      // Where along an edge between two samples does phi cross zero?
      const cross = (i0, i1, x0, z0, x1, z1) => {
        const a = phi[i0], b = phi[i1];
        const t = Math.abs(a - b) < 1e-6 ? 0.5 : a / (a - b);
        return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
      };

      for (let gz = 0; gz < cols - 1; gz++) {
        for (let gx = 0; gx < cols - 1; gx++) {
          const i00 = gz * cols + gx, i10 = i00 + 1;
          const i01 = i00 + cols, i11 = i01 + 1;
          const code = (phi[i00] > 0 ? 1 : 0) | (phi[i10] > 0 ? 2 : 0)
            | (phi[i11] > 0 ? 4 : 0) | (phi[i01] > 0 ? 8 : 0);
          if (code === 0 || code === 15) continue;   // wholly in or wholly out
          const x0 = -half + gx * step, z0 = -half + gz * step;
          const x1 = x0 + step, z1 = z0 + step;
          // Midpoints of the four cell edges, placed at the true crossing.
          const eB = () => cross(i00, i10, x0, z0, x1, z0);
          const eR = () => cross(i10, i11, x1, z0, x1, z1);
          const eT = () => cross(i01, i11, x0, z1, x1, z1);
          const eL = () => cross(i00, i01, x0, z0, x0, z1);
          let a = null, b = null;
          switch (code) {
            case 1: case 14: a = eL(); b = eB(); break;
            case 2: case 13: a = eB(); b = eR(); break;
            case 3: case 12: a = eL(); b = eR(); break;
            case 4: case 11: a = eR(); b = eT(); break;
            case 6: case 9: a = eB(); b = eT(); break;
            case 7: case 8: a = eL(); b = eT(); break;
            // Saddles: two separate crossings through one cell.
            case 5: ribbon(...eL(), ...eT(), c); a = eB(); b = eR(); break;
            case 10: ribbon(...eL(), ...eB(), c); a = eT(); b = eR(); break;
            default: break;
          }
          if (a && b) ribbon(a[0], a[1], b[0], b[1], c);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.92,
      depthWrite: false, side: THREE.DoubleSide,
    });

    this.territory = new THREE.Mesh(geo, mat);
    // Above the roads so a border crossing a road still reads as a border.
    this.territory.renderOrder = 3;
    this.scene.add(this.territory);
    this.territoryStamp = this.territorySignature();
  }

  /** Cheap fingerprint of who owns what, so the overlay only rebuilds on change. */
  territorySignature() {
    // Settlements change hands between the major factions now, so the overlay
    // has to notice a border moving and not only the player taking ground —
    // without the third term the map keeps drawing a front line that has moved.
    const war = Object.entries(this.S.mapOwner || {})
      .map(([k, v]) => `${k}:${v}`).sort().join(',');
    return `${Object.keys(this.S.holdings || {}).sort().join(',')}`
      + `|${this.S.ownFaction?.id || ''}|${war}`;
  }

  refreshTerritory() {
    if (this.territorySignature() === this.territoryStamp) return;
    if (this.territory) {
      this.scene.remove(this.territory);
      this.territory.geometry.dispose();
      this.territory.material.dispose();
      this.territory = null;
    }
    this.buildTerritory();
  }

  buildRoads() {
    // Roads are thin ribbons laid on the terrain — the clearest possible signal
    // of "these two places are connected", and they double as travel guidance.
    const geo = new THREE.BufferGeometry();
    const verts = [];
    const push = (x, z, nx, nz, wdt) => {
      // Height is sampled at the ribbon EDGE, not at the centreline — taking it
      // from the centre leaves the outer edge buried on any cross-slope.
      const ex = x + nx * wdt, ez = z + nz * wdt;
      verts.push(ex, regionHeight(ex, ez) + 2.2, ez);
    };
    for (const [aId, bId] of ROADS) {
      const A = State.locById(aId), B = State.locById(bId);
      // Sample by LENGTH, not by a fixed count. At continental scale a flat
      // 26 segments meant each quad spanned well over a hundred metres of
      // undulating ground, so the ribbon cut in and out of the hill it was
      // supposed to be lying on — which is the striped, torn look on the map.
      const span = Math.hypot(B.x - A.x, B.z - A.z);
      const steps = Math.max(28, Math.ceil(span / 26));
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Slight sag toward the basin centre so roads curve like real ones.
        const bend = Math.sin(t * Math.PI) * 26;
        const x = lerp(A.x, B.x, t) + bend * 0.16;
        const z = lerp(A.z, B.z, t) + bend * 0.1;
        if (prev) {
          const dx = x - prev.x, dz = z - prev.z;
          const l = Math.hypot(dx, dz) || 1;
          const nx = -dz / l, nz = dx / l;
          const W = 13;
          push(prev.x, prev.z, nx, nz, W); push(prev.x, prev.z, nx, nz, -W); push(x, z, nx, nz, W);
          push(x, z, nx, nz, -W); push(prev.x, prev.z, nx, nz, -W); push(x, z, nx, nz, W);
        }
        prev = { x, z };
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x23200f, transparent: true, opacity: 0.72, depthWrite: false,
      // The two triangles of each road quad are wound in opposite directions,
      // so with the default FrontSide culling exactly half of every quad was
      // thrown away — which is the row of little sawtooth triangles that showed
      // up along every road instead of a road.
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    mesh.renderOrder = 2;
    this.scene.add(mesh);
  }

  buildLocations() {
    this.locMeshes = [];
    for (const l of LOCATIONS) {
      const g = new THREE.Group();
      if (l.model) {
        const m = Models.get(l.model);
        // Scaled to be legible from the strategic camera height, not to metric
        // scale — a settlement has to read as a place from 400m up.
        m.scale.setScalar(l.kind === 'settlement' ? 6.4 : 5.6);
        m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.add(m);
      } else {
        // The Sump has no structures — it is marked by what grows there.
        const r = rng(l.id.length * 977);
        for (let i = 0; i < 16; i++) {
          const t = Models.get(pick(r, ['dead_tree', 'rock_1']));
          t.position.set(range(r, -34, 34), 0, range(r, -34, 34));
          t.scale.setScalar(range(r, 4, 9));
          g.add(t);
        }
      }
      g.position.set(l.x, regionHeight(l.x, l.z), l.z);
      this.scene.add(g);

      // Ground ring keyed to ownership. Holdings fly the player's colours,
      // which is the whole point of taking them.
      const col = State.isHolding(this.S, l.id)
        ? (this.S.ownFaction?.colour ?? 0xc08d3f)
        : (l.faction ? FACTIONS[l.faction].color : 0x6a6458);
      const ring = this.makeRing(col, l.kind === 'settlement' ? 74 : 60);
      ring.position.set(l.x, regionHeight(l.x, l.z) + 0.8, l.z);
      this.scene.add(ring);
      this.locMeshes.push({ loc: l, group: g, ring });
    }
  }

  /**
   * DOM labels projected from each location's world position. A 3D map of
   * unlabelled shapes is unnavigable when a contract says "go to Grellan
   * Array" — the player needs to be able to find it by name.
   */
  /** Big faint region names, so the continent has provinces you can name. */
  buildRegionLabels() {
    if (!this.labelHost) return;
    this.regionLabels = Object.values(REGIONS).map((reg) => {
      const el = document.createElement('div');
      el.className = `rlbl ${reg.owner || 'free'}`;
      el.innerHTML = `<div class="rn">${reg.name}</div>`
        + `<div class="ro">${reg.owner ? FACTIONS[reg.owner].short : 'UNCLAIMED'}</div>`;
      this.labelHost.appendChild(el);
      return { reg, el };
    });
  }

  updateRegionLabels() {
    if (!this.regionLabels) return;
    const el = this.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    for (const { reg, el: node } of this.regionLabels) {
      this._proj.set(reg.centre.x, regionHeight(reg.centre.x, reg.centre.z) + 40, reg.centre.z);
      this._proj.project(this.camera);
      const behind = this._proj.z > 1;
      const x = (this._proj.x * 0.5 + 0.5) * w;
      const y = (-this._proj.y * 0.5 + 0.5) * h;
      // Only worth showing when zoomed out far enough to see a province.
      const show = !behind && this.zoom > 1.5 && x > 0 && x < w && y > 40 && y < h - 60;
      node.style.display = show ? 'block' : 'none';
      if (show) { node.style.left = `${x}px`; node.style.top = `${y}px`; }
    }
  }

  buildLabels() {
    this.labelHost = document.getElementById('map-labels');
    if (!this.labelHost) return;
    this.labelHost.innerHTML = '';
    this.labels = LOCATIONS.map((l) => {
      const el = document.createElement('div');
      const f = l.faction ? FACTIONS[l.faction] : null;
      el.className = `mlbl ${l.faction || ''}`;
      el.innerHTML = `<i class="mtick"></i><div class="mn">${l.name}</div>`
        + `<div class="mf">${f ? f.short : (l.kind === 'wild' ? 'LAWLESS' : 'UNALIGNED')}</div>`;
      this.labelHost.appendChild(el);
      return { loc: l, el, y: regionHeight(l.x, l.z) };
    });
    this._proj = new THREE.Vector3();
  }

  /**
   * Floating strength markers over every party. The number is the whole point:
   * the player has to be able to look at something on the road and know
   * whether it is four looters or an eighty-strong column before they commit.
   */
  updatePartyLabels() {
    if (!this.labelHost) return;
    this.partyLabels = this.partyLabels || new Map();
    const el = this.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    const seen = new Set();

    for (const p of this.S.parties) {
      if (p.strength <= 0) continue;
      const d = Math.hypot(p.x - this.S.pos.x, p.z - this.S.pos.z);
      if (d > (this.zoom > 1.5 ? 2600 : 1500)) continue;
      seen.add(p.id);
      let lab = this.partyLabels.get(p.id);
      if (!lab) {
        lab = document.createElement('div');
        lab.className = 'plbl';
        this.labelHost.appendChild(lab);
        this.partyLabels.set(p.id, lab);
      }
      // Colour by how it compares to what the player can field.
      const limit = State.deployLimit(this.S);
      const ratio = p.strength / Math.max(1, limit);
      const risk = p.hostileToPlayer ? 'hostile' : '';
      const band = ratio > 3 ? 'lethal' : ratio > 1.6 ? 'hard' : ratio > 0.8 ? 'even' : 'weak';
      lab.className = `plbl ${band} ${risk}${p.grudge ? ' grudge' : ''}`;
      // The people holding your things are named on the map rather than being
      // one more number among a dozen bands — you are meant to be able to spot
      // them from across the Reach.
      // Rounded: battle attrition runs on fractions, and a band of
      // 14.6564115676482837 is a debugger's number, not a scout's.
      const shown = Math.max(1, Math.round(p.strength));
      lab.textContent = p.grudge ? `${p.commander || p.name} ${shown}` : String(shown);
      lab.title = p.name;

      this._proj.set(p.x, regionHeight(p.x, p.z) + 34, p.z);
      this._proj.project(this.camera);
      const behind = this._proj.z > 1;
      const px = (this._proj.x * 0.5 + 0.5) * w;
      const py = (-this._proj.y * 0.5 + 0.5) * h;
      const on = !behind && px > -40 && px < w + 40 && py > -20 && py < h - 30;
      lab.style.display = on ? 'block' : 'none';
      if (on) { lab.style.left = `${px}px`; lab.style.top = `${py}px`; }
    }
    for (const [id, lab] of this.partyLabels) {
      if (!seen.has(id)) { lab.remove(); this.partyLabels.delete(id); }
    }
  }

  /** Keep ownership rings in step with holdings changing hands. */
  updateOwnership() {
    if (!this.locMeshes) return;
    for (const { loc, ring } of this.locMeshes) {
      const col = State.isHolding(this.S, loc.id)
        ? (this.S.ownFaction?.colour ?? 0xc08d3f)
        : (loc.faction ? FACTIONS[loc.faction].color : 0x6a6458);
      if (ring.material.color.getHex() !== col) ring.material.color.setHex(col);
    }
  }

  updateLabels() {
    if (!this.labels) return;
    const el = this.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    const contract = State.activeContract(this.S);
    for (const L of this.labels) {
      // Anchor above the model so the text never sits on top of the buildings.
      this._proj.set(L.loc.x, L.y + (L.loc.kind === 'settlement' ? 96 : 80), L.loc.z);
      this._proj.project(this.camera);
      const behind = this._proj.z > 1;
      const x = (this._proj.x * 0.5 + 0.5) * w;
      const y = (-this._proj.y * 0.5 + 0.5) * h;
      // At province zoom the settlement names collide into an unreadable mass;
      // the region names carry the map instead.
      const zoomedOut = this.zoom > 1.5;
      const onScreen = !behind && !zoomedOut
        && x > -60 && x < w + 60 && y > -20 && y < h - 40;
      L.el.style.display = onScreen ? 'block' : 'none';
      if (!onScreen) continue;
      L.el.style.left = `${x}px`;
      L.el.style.top = `${y}px`;
      const active = contract && contract.site === L.loc.id;
      L.el.classList.toggle('active', !!active);
      // Fade with distance so the near ground stays uncluttered.
      const d = Math.hypot(L.loc.x - this.S.pos.x, L.loc.z - this.S.pos.z);
      L.el.style.opacity = String(clamp(1.25 - d / 620, 0.35, 1));
    }
  }

  makeRing(color, radius) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.86, radius, 22),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 2;
    return m;
  }

  buildPlayerToken() {
    this.playerToken = Models.get('wm_party_player');
    this.playerToken.scale.setScalar(8.0);
    this.playerToken.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.playerToken);

    // A soft pool of light under the player token: the map is dark, and the
    // player must never lose track of where they are.
    const halo = this.makeRing(0xb8863f, 34);
    halo.material.opacity = 0.6;
    this.playerHalo = halo;
    this.scene.add(halo);
  }

  // ----------------------------------------------------------------------

  bindInput() {
    const el = this.renderer.domElement;
    const add = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); this._handlers.push([t, ev, fn]); };
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    const toNdc = (e) => {
      const rect = el.getBoundingClientRect();
      this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.ndc, this.camera);
    };

    add(el, 'pointerdown', (e) => {
      // Right button drags the map around, and does not open a context menu on
      // top of it.
      if (e.button === 2) {
        this.panning = { x: e.clientX, y: e.clientY };
        el.setPointerCapture?.(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      toNdc(e);

      // A party first, the ground second.
      //
      // Clicking a moving band used to drop a destination pin on the patch of
      // dirt it happened to be standing on, so chasing anything meant clicking
      // once a second and watching it walk out from under the marker. Picking
      // the party itself and following it is the whole verb: you set off after
      // something and close on it, or you do not.
      const tokens = [...this.partyMeshes.entries()];
      const hitParty = this.raycaster.intersectObjects(tokens.map(([, m]) => m), true)[0];
      if (hitParty) {
        let obj = hitParty.object;
        while (obj && !tokens.some(([, m]) => m === obj)) obj = obj.parent;
        const entry = tokens.find(([, m]) => m === obj);
        if (entry) { this.chase(entry[0]); return; }
      }

      const hits = this.raycaster.intersectObject(this.terrain, false);
      if (hits.length) {
        const p = hits[0].point;
        this.setDestination(p.x, p.z);
      }
    });
    add(el, 'contextmenu', (e) => e.preventDefault());
    add(el, 'pointermove', (e) => {
      if (!this.panning) return;
      // Drag distance is scaled by zoom so the ground keeps pace with the
      // cursor whether you are looking at a province or a crossroads.
      const k = 2.6 * this.zoom;
      this.camPan.x -= (e.clientX - this.panning.x) * k;
      this.camPan.z -= (e.clientY - this.panning.y) * k;
      this.panning = { x: e.clientX, y: e.clientY };
    });
    const endPan = () => { this.panning = null; };
    add(el, 'pointerup', endPan);
    add(el, 'pointercancel', endPan);
    add(el, 'pointerleave', endPan);
    add(el, 'wheel', (e) => {
      e.preventDefault();
      // The far stop is deliberately SHORT of framing the whole region. At
      // 2.8 the entire Reach fit on one screen — every province, every
      // border, both fronts — and a world you can see all of at once is a
      // board game, however good the terrain. You understand your
      // surroundings; the rest you learn by going there.
      this.zoom = clamp(this.zoom * (1 + Math.sign(e.deltaY) * 0.12), 0.28, 1.9);
    }, { passive: false });
    add(window, 'keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (['w', 'a', 's', 'd', ' '].includes(k)) e.preventDefault();
      // Held keys auto-repeat. Steering wants that; a toggle very much does not.
      if (e.repeat) return;
      // Space halts. It also drops the destination, because a halt you have to
      // press twice is not a halt.
      if (k === ' ') { this.stopTravel(); this.setSpeed(this.timeScale ? 0 : 1); }
      if (k === 'f') this.setSpeed(this.timeScale === FAST ? 1 : FAST);
      // Put the camera back on the company. A map you can push around needs a
      // way home, or being lost two provinces away is a mouse-hunt.
      //
      // H for home. C opens the roster and V the character sheet — both were
      // tried first, and either would have fired its panel every single time
      // the player wanted the camera back. The world screen already spends
      // c l i k v p b e, so this is one of the few letters actually free.
      if (k === 'h') this.recentre();
    });
    add(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  /** Run something down. The destination becomes wherever it is, each frame. */
  chase(partyId) {
    const p = this.S.parties.find((x) => x.id === partyId);
    if (!p) return;
    this.chaseId = partyId;
    this.recentre();
    this.setDestination(p.x, p.z, true);
    Audio.uiSelect();
  }

  /** Put the view back over the company. */
  recentre() {
    this.camPan.x = 0;
    this.camPan.z = 0;
  }

  setDestination(x, z, keepChase = false) {
    // Clicking the ground is a decision to go THERE, so it calls off a chase —
    // otherwise the destination is overwritten again on the very next frame and
    // the click appears to do nothing at all.
    if (!keepChase) this.chaseId = null;
    this.S.dest = clampToRegion(x, z);
    this.travelling = true;
    this.destMarker.position.set(this.S.dest.x, regionHeight(this.S.dest.x, this.S.dest.z) + 1.2, this.S.dest.z);
    this.destMarker.visible = true;
    Audio.uiSelect();
  }

  stopTravel() {
    this.travelling = false;
    this.chaseId = null;
    this.S.dest = null;
    this.destMarker.visible = false;
  }

  // ----------------------------------------------------------------------

  update(dt) {
    const S = this.S;
    let moved = 0;

    // Direct steering always overrides a click destination — it is what a
    // player reaches for first, and fighting the pathing feels awful.
    let mx = 0, mz = 0;
    if (this.keys.has('w')) mz -= 1;
    if (this.keys.has('s')) mz += 1;
    if (this.keys.has('a')) mx -= 1;
    if (this.keys.has('d')) mx += 1;
    // The company's real speed, not the constant. Recomputed per frame so a
    // sale at a market or a soldier recovering is felt immediately.
    // What the company can do, and what the ground under it allows. Crossing a
    // range is slower than following a road, which is what makes a route a
    // choice rather than a straight line between two dots.
    const pace = State.partySpeed(S).speed * travelFactor(S.pos.x, S.pos.z);
    // The clock, and then the distance — not the other way round.
    //
    // Time used to be DERIVED from how far the company had walked, so the Reach
    // ran at full speed while you travelled and at about three per cent of it
    // while you stood still. That made standing still a way of stopping the
    // world: nothing closed on you, nothing arrived, no band you had provoked
    // ever caught up. It also meant a laden company made the whole world slower,
    // because time was distance over a constant.
    //
    // Now the hour hand moves at a fixed rate and speed decides how much ground
    // you cover in an hour, which is the way the strategic layer this is aiming
    // at has always worked. `dt` arrives already multiplied by timeScale, so
    // halt and fast-forward both fall out of it for free.
    const hours = dt * HOURS_PER_SECOND;

    // A chase re-aims at its quarry every frame. Losing it — killed on the road
    // by somebody else, or culled at the far edge of the map — simply ends the
    // pursuit rather than leaving the company marching at a ghost.
    if (this.chaseId) {
      const quarry = S.parties.find((p) => p.id === this.chaseId);
      if (!quarry) this.stopTravel();
      else this.setDestination(quarry.x, quarry.z, true);
    }

    if (mx || mz) {
      // Steering by hand means you want to see where you are going.
      this.recentre();
      this.stopTravel();
      const m = Math.hypot(mx, mz);
      const step = pace * hours;
      // The fence is the geography: the clamp follows the rim's own angular
      // profile, so "as far as you can drive" and "where the mountains start"
      // are the same place — the old rectangular clamp had corners a third
      // again past the rim, on ground no road leads to.
      const to = clampToRegion(S.pos.x + (mx / m) * step, S.pos.z + (mz / m) * step);
      S.pos.x = to.x;
      S.pos.z = to.z;
      this.playerHeading = Math.atan2(mx, mz);
      moved = step;
    } else if (this.travelling && S.dest) {
      const dx = S.dest.x - S.pos.x, dz = S.dest.z - S.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 3) {
        this.stopTravel();
      } else {
        const step = Math.min(d, pace * hours);
        S.pos.x += (dx / d) * step;
        S.pos.z += (dz / d) * step;
        this.playerHeading = Math.atan2(dx, dz);
        moved = step;
      }
    }

    // One clock, whether or not you went anywhere.
    //
    // This deliberately reverses an older rule that standing still should never
    // burn a contract deadline. It was protecting the player from the calendar
    // and it cost the map its life: a world that only moves when you do is a
    // world you cannot be caught in, and a chase you can end by letting go of
    // the key is not a chase. Deadlines now run while you sit, which is the
    // trade — and halt is a key away, panels pause the Reach on their own, and
    // the speed chips are right there.
    State.advanceTime(S, hours);

    this.syncParties();
    this.syncEvents();
    this.checkProximity();
  }

  /**
   * Battles and battlefields, drawn where they are happening. A fight is a
   * pulsing ring you can see across the basin and steer toward or around; a
   * finished one leaves wreckage on the ground for a few days. The world
   * showing its own events is the entire difference between a map you watch
   * and a list you read.
   */
  syncEvents() {
    this.eventMeshes = this.eventMeshes || new Map();
    const seen = new Set();
    const S = this.S;
    for (const b of S.mapBattles || []) {
      seen.add(b.id);
      let m = this.eventMeshes.get(b.id);
      if (!m) {
        m = this.makeRing(0xd8434f, 30);
        m.material.opacity = 0.55;
        this.scene.add(m);
        this.eventMeshes.set(b.id, m);
      }
      m.position.set(b.x, regionHeight(b.x, b.z) + 1.4, b.z);
      m.material.opacity = 0.35 + Math.sin(performance.now() * 0.004) * 0.2;
    }
    for (const s of S.mapSites || []) {
      seen.add(s.id);
      let m = this.eventMeshes.get(s.id);
      if (!m) {
        m = Models.get('truck_wreck');
        m.scale.setScalar(6);
        m.rotation.y = (s.x * 7 + s.z) % 6.28;
        m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        this.scene.add(m);
        this.eventMeshes.set(s.id, m);
      }
      m.position.set(s.x, regionHeight(s.x, s.z), s.z);
    }
    for (const e of S.mapEvents || []) {
      seen.add(e.id);
      let m = this.eventMeshes.get(e.id);
      if (!m) {
        m = this.makeRing(e.kind === 'oldsignal' ? 0xa855c8 : 0xd8a83f, 22);
        m.material.opacity = 0.6;
        this.scene.add(m);
        this.eventMeshes.set(e.id, m);
      }
      m.position.set(e.x, regionHeight(e.x, e.z) + 1.6, e.z);
      // A beacon blinks; a transponder breathes. Different cadence, same glance.
      m.material.opacity = e.kind === 'oldsignal'
        ? 0.35 + Math.sin(performance.now() * 0.0012) * 0.25
        : (Math.floor(performance.now() / 500) % 2 ? 0.75 : 0.2);
    }
    for (const [id, m] of this.eventMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.eventMeshes.delete(id);
      }
    }
  }

  syncParties() {
    const seen = new Set();
    for (const p of this.S.parties) {
      seen.add(p.id);
      let m = this.partyMeshes.get(p.id);
      if (!m) {
        m = Models.get(p.model);
        m.scale.setScalar(7.0);
        m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const ring = this.makeRing(
          p.owner === 'player'
            ? (this.S.ownFaction?.colour ?? 0xc08d3f)
            : (p.faction ? FACTIONS[p.faction].color : 0x7a7468), 24);
        ring.material.opacity = 0.4;
        this.scene.add(m); this.scene.add(ring);
        m.userData.ring = ring;
        this.partyMeshes.set(p.id, m);
      }
      const y = regionHeight(p.x, p.z);
      m.position.set(p.x, y, p.z);
      m.rotation.y = p.heading;
      m.userData.ring.position.set(p.x, y + 0.9, p.z);
    }
    for (const [id, m] of this.partyMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.scene.remove(m.userData.ring);
        this.partyMeshes.delete(id);
      }
    }
  }

  checkProximity() {
    const S = this.S;
    const loc = State.locationAt(S, 38);
    S.atLocation = loc ? loc.id : null;
    this.nearLocation = loc;

    // Encounters fire on APPROACH — the frame a party crosses into range —
    // not merely on proximity. Firing on proximity means a party that happens
    // to be parked next to the player's start interrupts them before they have
    // touched anything, and a party being deliberately ignored nags forever.
    const near = State.nearbyParties(S, 26);
    this.nearParties = State.nearbyParties(S, 60);
    const nowNear = new Set(near.map((p) => p.id));

    if (!this.nearSeeded) {
      // First tick of a session: whatever is already alongside us is not an
      // approach, it is scenery.
      this.nearSet = nowNear;
      this.nearSeeded = true;
      return;
    }

    // Signals and battlefields are arrived at the same way battles are: once,
    // on approach, with the choice left standing.
    this.eventSeen = this.eventSeen || new Set();
    const arrivables = [
      ...(S.mapEvents || []).map((e) => ({ ...e, _t: 'event' })),
      ...(S.mapSites || []).filter((s) => s.loot).map((s) => ({ ...s, _t: 'site' })),
    ];
    for (const ev of arrivables) {
      // continue, not break: one already-answered signal must not shadow
      // every other arrival for as long as it lives.
      if (loc) break;
      if (this.eventSeen.has(ev.id)) continue;
      if (Math.hypot(ev.x - S.pos.x, ev.z - S.pos.z) > 42) continue;
      this.eventSeen.add(ev.id);
      this.stopTravel();
      Audio.uiAlert();
      this.onEvent?.(ev);
      break;
    }

    // A battle in progress is something you ARRIVE AT — observed first, never
    // auto-joined. Once seen it does not renag; the rings stay on the map.
    this.battleSeen = this.battleSeen || new Set();
    for (const btl of S.mapBattles || []) {
      if (loc) break;
      if (this.battleSeen.has(btl.id)) continue;
      if (Math.hypot(btl.x - S.pos.x, btl.z - S.pos.z) > 70) continue;
      this.battleSeen.add(btl.id);
      this.stopTravel();
      Audio.uiAlert();
      this.onBattle?.(btl);
      break;
    }

    for (const p of near) {
      if (this.nearSet.has(p.id)) continue;
      // Nothing accosts you inside a settlement. Anything at all.
      //
      // Patrol routes lead TO locations, so parties are constantly arriving at
      // the place the company is standing in — and the clock runs while you
      // stand there now, so it happens often. This first suppressed only
      // HOSTILE parties, which left the hole open: a caravan or a patrol
      // wandering in still threw a panel over the town, which is both wrong
      // (you deal with people through the settlement, not by ambush on its
      // steps) and the cause of an intermittent failure where closing the
      // settlement panel dropped the player straight into another one.
      if (loc) continue;
      const cd = this.encounterCooldown[p.id] || 0;
      if (S.day * 24 + S.hour < cd) continue;
      this.encounterCooldown[p.id] = S.day * 24 + S.hour + 6;
      this.stopTravel();
      Audio.uiAlert();
      this.onEncounter(p);
      break;
    }
    this.nearSet = nowNear;
  }

  updateCamera(dt) {
    const S = this.S;
    const y = regionHeight(S.pos.x, S.pos.z);
    // Fixed angle, follows the player, zoom on the wheel. Rotating the
    // strategic camera adds nothing and costs orientation.
    // Far enough back that several landmarks and the roads between them are on
    // screen at once — at close range this reads as rocks, not as a region.
    // Steep enough (~55°) that the frame is mostly ground rather than empty
    // horizon, while still oblique enough to read the terrain as terrain.
    // The camera flattens as it pulls back. Close in it stays steep so the
    // ground under the company is readable; zoomed out it drops toward the
    // horizon, so the frame fills with terrain LAYERS — near country sharp,
    // the rim silhhouetted, the outer steppe dissolving in haze — instead of
    // a top-down plate. The horizon is what sells that the world continues.
    const flat = clamp((this.zoom - 0.9) / 1.0, 0, 1);
    const dist = (1250 + flat * 420) * this.zoom;
    const height = (1400 - flat * 560) * this.zoom;
    // Fixed fog distances made a zoomed-out map dissolve into flat haze.
    const eye = Math.hypot(dist, height);
    // Fog begins past the ground being looked at, not on top of it. At 0.55 the
    // focus point itself sat about a quarter of the way into the haze, so every
    // landform was washed toward the fog colour before it could be seen at all
    // — the terrain read as flat because most of it was half fog.
    this.scene.fog.near = eye * 0.95;
    this.scene.fog.far = eye * 3.0;
    // Where the view is looking: the company, plus however far it has been
    // dragged off them. Clamped to the playable area so the map cannot be
    // pushed out into empty space and lost.
    const lim = HALF;
    this.camPan.x = clamp(this.camPan.x, -lim, lim);
    this.camPan.z = clamp(this.camPan.z, -lim, lim);
    const cx = S.pos.x + this.camPan.x;
    const cz = S.pos.z + this.camPan.z;
    // Elevation of the ground actually being looked at, not of the company —
    // dragging across a range otherwise keeps the camera at the height of
    // wherever the company happens to be standing and buries the view in a hill.
    const cy = regionHeight(cx, cz);

    const want = new THREE.Vector3(cx, cy + height, cz + dist);
    if (!this.camInit) { this.camera.position.copy(want); this.camInit = true; }
    else this.camera.position.lerp(want, 1 - Math.exp(-dt * 4.5));
    this.camera.lookAt(cx, cy + 8, cz);

    this.sun.position.set(S.pos.x - 260, 300, S.pos.z + 180);
    this.sun.target.position.set(S.pos.x, 0, S.pos.z);
    this.sun.target.updateMatrixWorld();

    // Inside a settlement the company is INSIDE — not a truck idling on the
    // doorstep. The token leaves the map for the duration of the visit, the
    // way the games this is modelled on do it; the halo goes with it so
    // nothing glows on an empty road.
    const inside = !!this.inside;
    this.playerToken.visible = !inside;
    this.playerHalo.visible = !inside;
    this.playerToken.position.set(S.pos.x, y, S.pos.z);
    this.playerToken.rotation.y = lerp(
      this.playerToken.rotation.y, this.playerHeading || 0, 1 - Math.exp(-dt * 6));
    this.playerHalo.position.set(S.pos.x, y + 1.0, S.pos.z);
    this.playerHalo.material.opacity = 0.42 + Math.sin(performance.now() * 0.002) * 0.14;
  }

  buildHud() {
    const S = this.S;
    return {
      day: S.day,
      hour: S.hour,
      credits: S.credits,
      supplies: S.supplies,
      medical: S.medical,
      roster: S.roster,
      ready: State.ready(S).length,
      wounded: State.living(S).filter((s) => s.status === 'wounded').length,
      location: this.nearLocation,
      // Who flies a flag over it today. LOCATIONS carries the founding owner,
      // and after a war those are different things — the panel should not still
      // be calling a captured town by its old allegiance.
      locationOwner: this.nearLocation ? State.ownerOf(S, this.nearLocation.id) : null,
      travelling: this.travelling,
      // What the company is running down, and whether the view has been pushed
      // off them — the interface has to be able to offer a way back.
      chasing: this.chaseId
        ? (this.S.parties.find((p) => p.id === this.chaseId)?.name || null) : null,
      panned: Math.hypot(this.camPan.x, this.camPan.z) > 1,
      // What the ground is doing to the company right now, so the pace readout
      // can say "slowed by broken ground" rather than silently dropping.
      ground: travelFactor(this.S.pos.x, this.S.pos.z),
      contract: State.activeContract(S),
      contracts: S.contracts,
      nearParties: (this.nearParties || []).map((p) => {
        const dist = Math.hypot(p.x - S.pos.x, p.z - S.pos.z);
        // What they are DOING is most of what a contact report is worth.
        const intent = p.battle ? 'FIGHTING'
          : p.chasing ? 'PURSUING YOU'
            : p.routed ? 'ROUTED'
              : p.reinforce ? 'MOVING TO A FIGHT'
                : p.siegeTarget ? 'MARCHING'
                  : (PARTY_TIERS[p.kind]?.static ? 'DUG IN' : 'PATROLLING');
        // Numbers harden as they close: a column at the edge of sight is an
        // estimate, not a count.
        const close = dist < 80;
        const est = close ? String(Math.round(p.strength))
          : `${Math.max(1, Math.floor(p.strength * 0.75))}–${Math.ceil(p.strength * 1.3)}`;
        return {
          id: p.id, name: close ? p.name : (p.hostileToPlayer ? 'Unknown armed group' : p.name),
          faction: p.faction, strength: p.strength, est, intent,
          tier: p.tier, hostile: p.hostileToPlayer, dist,
        };
      }),
      renown: S.renown || 0,
      allegiance: S.allegiance,
      ownFaction: S.ownFaction,
      // Holdings per power, for the map legend.
      tiles: this.countHoldings(),
      // The payroll is the pressure the whole campaign runs on, so it lives on
      // the top bar next to the money rather than three screens deep.
      pace: State.partySpeed(S),
      morale: Math.round(S.morale ?? 70),
      moraleTier: State.moraleTier(S).name,
      rations: S.rations || 0,
      payroll: State.payrollOf(S),
      unpaidDays: S.unpaidDays || 0,
      renownName: State.renownName(S),
      deployLimit: State.deployLimit(S),
      region: State.regionAt(S.pos.x, S.pos.z),
      rep: S.rep,
      world: S.world,
      log: S.log,
      finale: S.finale,
      speed: this.paused ? 0 : this.timeScale,
      fast: FAST,
      grudge: S.grudge ? {
        who: S.grudge.who,
        credits: S.grudge.credits,
        arms: (S.grudge.arms || []).length,
        daysLeft: State.GRUDGE_DAYS - (S.day - S.grudge.since),
      } : null,
    };
  }

  loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    // The world runs on scaled time; the camera does not, so panning and easing
    // feel the same whether you are halted or running fast.
    if (!this.paused && this.timeScale > 0) this.update(dt * this.timeScale);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateOwnership();
    this.refreshTerritory();
    this.updateLabels();
    this.updateRegionLabels();
    this.updatePartyLabels();
    this.onHud(this.buildHud());
  }

  setPaused(p) { this.paused = p; }

  /** The company is indoors: token off the map until they come back out. */
  setInside(v) { this.inside = !!v; }

  /**
   * Halted, running, or running fast.
   *
   * Deliberately three settings rather than a slider: the question a player has
   * on the map is "do I want this to happen now, or not yet", and three answers
   * covers it. Coming off a halt always resumes at normal rather than at
   * whatever it was before, so unhalting can never surprise you by sprinting.
   */
  setSpeed(s) {
    const was = this.timeScale;
    this.timeScale = s === 0 ? 0 : (s === FAST ? FAST : 1);
    if (was !== this.timeScale) Audio.uiSelect();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    for (const [t, ev, fn] of this._handlers) t.removeEventListener(ev, fn);
    this._handlers = [];
    if (this.labelHost) this.labelHost.innerHTML = '';
    this.partyLabels?.clear();
    Audio.stopAmbience();
    // Same rule as the mission's teardown: the map draws rocks, dead trees and
    // party tokens straight out of the shared cache, so disposing them here
    // would break the deployment that comes next just as surely.
    Models.disposeScene(this.scene);
    Models.releaseRenderer(this.renderer);
    if (this.renderer?.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
