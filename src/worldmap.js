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
import { LOCATIONS, REGION, REGIONS, FACTIONS } from './data.js';
import * as State from './state.js';
import * as Dip from './diplomacy.js';
import { clamp, lerp, rng, range, pick } from './util.js';

const HALF = REGION.size / 2;
// Fast-forward. Four is about the most you can run the map at before you drive
// straight past the parties you were meant to notice.
const FAST = 4;

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
export function regionHeight(x, z) {
  const d = Math.hypot(x, z) / HALF;
  // The rim starts much further out on a continent — the playable interior has
  // to be genuinely large, with the highlands only closing in at the edges.
  const rim = Math.pow(clamp((d - 0.66) / 0.34, 0, 1), 1.7) * 240;
  const ridge =
    Math.sin(x * 0.0062 + 1.2) * Math.cos(z * 0.0071 - 0.4) * 13 +
    Math.sin(x * 0.0141 - 0.9) * 5.5 +
    Math.cos(z * 0.0123 + 2.1) * 4.5;
  const basin = Math.sin(x * 0.0031) * Math.cos(z * 0.0029) * 6
    + Math.sin(x * 0.0011 + 0.7) * Math.cos(z * 0.0013 - 0.3) * 34;
  return rim + ridge * (0.35 + d) + basin;
}

// Roads are authored, not generated — they are the routes the player will
// actually learn, and one of them (Vetch → Sump → west) only matters after the
// north rim goes dark.
const ROADS = [
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
  ['kestrel', 'tallow'],
  ['tallow', 'wealbastion'],
  ['wealbastion', 'ondrel'],
  ['wealbastion', 'fenmarrow'],
  ['fenmarrow', 'kestrel'],
  ['culvert', 'scourgate'],
  ['scourgate', 'draypits'],
  ['scourgate', 'gallows'],
  ['gallows', 'harrow'],
  ['draypits', 'scourhold'],
  ['scourhold', 'scourgate'],
  ['pale', 'oldquay'],
  ['oldquay', 'anchorage'],
  ['anchorage', 'brine'],
  ['anchorage', 'wealbastion'],
];

export class WorldMap {
  constructor({ campaign, container, onEnterLocation, onEncounter, onHud }) {
    this.S = campaign;
    this.container = container;
    this.onEnterLocation = onEnterLocation;
    this.onEncounter = onEncounter;
    this.onHud = onHud || (() => {});
    this.partyMeshes = new Map();
    this.zoom = 1;
    this.disposed = false;
    this.travelling = false;
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

    this.scene.add(new THREE.HemisphereLight(0x6a7480, 0x201f18, 1.5));
    const sun = new THREE.DirectionalLight(0xe8c489, 2.6);
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
    const seg = 210;
    const geo = new THREE.PlaneGeometry(REGION.size * 1.6, REGION.size * 1.6, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // A wider ramp than the terrain strictly needs. The political layer no
    // longer paints over the ground, so the ground has to carry the map on its
    // own: cold silt in the deepest pan, dry scrub through the basin, bare rock
    // and pale stone up the rim.
    const cSilt = new THREE.Color(0x33403c);  // the wet bottom of the pan
    const cLow = new THREE.Color(0x4a4632);   // pan floor
    const cMid = new THREE.Color(0x60583e);
    const cHigh = new THREE.Color(0x74684f);  // rim rock
    const cPeak = new THREE.Color(0x99907c);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = regionHeight(x, z);
      pos.setY(i, y);
      // Below zero is the drained pan bottom, which the old ramp clamped flat.
      if (y < 0) c.copy(cSilt).lerp(cLow, clamp((y + 45) / 45, 0, 1));
      else {
        const t = clamp(y / 120, 0, 1);
        if (t < 0.20) c.copy(cLow).lerp(cMid, t / 0.20);
        else if (t < 0.55) c.copy(cMid).lerp(cHigh, (t - 0.20) / 0.35);
        else c.copy(cHigh).lerp(cPeak, (t - 0.55) / 0.45);
      }
      // Contour banding. Quantising elevation into steps and darkening the
      // seam between them turns the basin into something that reads as a
      // surveyed map sheet rather than a smooth brown expanse — the terrain
      // becomes legible at a glance instead of merely present. This is why the
      // political layer no longer needs to paint over it.
      // One contour every 15m. In the basin — where the player spends the
      // whole early game — a 20m interval produced two lines and nothing else.
      const band = y / 15;
      const seam = Math.abs(band - Math.round(band));
      // A dark hairline at each contour, plus a slight step in value so
      // successive bands separate even away from the line itself.
      const contour = seam < 0.07 ? -0.085 : 0;
      const terrace = (Math.round(band) % 2 === 0 ? 0.022 : -0.022);
      c.offsetHSL(0, 0, contour + terrace);
      // Grain, not blotches. At low frequency this reads as huge soft dark
      // patches across the basin; it has to be fine enough to look like ground
      // texture at the strategic camera height.
      const n = Math.sin(x * 0.21) * Math.cos(z * 0.19) * 0.015
        + Math.sin(x * 0.077) * Math.cos(z * 0.083) * 0.009;
      colors[i * 3] = clamp(c.r + n, 0, 1);
      colors[i * 3 + 1] = clamp(c.g + n, 0, 1);
      colors[i * 3 + 2] = clamp(c.b + n * 0.6, 0, 1);
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
        : l.faction;
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
      if (l.faction === 'trust') out.trust++;
      else if (l.faction === 'syndic') out.syndic++;
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
    // The sampling grid is coarse on purpose. A border wants to read as a
    // deliberate line on a map, not trace every fold in the ground.
    const seg = 420;
    const size = REGION.size * 1.25;
    const step = size / seg;
    const cols = seg + 1;
    const half = size / 2;

    const owners = new Array(cols * cols);
    for (let gz = 0; gz < cols; gz++) {
      for (let gx = 0; gx < cols; gx++) {
        owners[gz * cols + gx] = this.ownerAt(-half + gx * step, -half + gz * step);
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

    for (let gz = 0; gz < cols; gz++) {
      for (let gx = 0; gx < cols; gx++) {
        const o = owners[gz * cols + gx];
        if (!o) continue;                       // unclaimed ground draws nothing
        const c = this.territoryColour(o);
        if (!c) continue;
        const x = -half + gx * step, z = -half + gz * step;
        // Look right and down only; the mirrored comparison is made by the
        // neighbouring sample, which keeps each edge from being emitted twice
        // in the same colour.
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= cols) continue;
          if (owners[nz * cols + nx] === o) continue;
          // The segment runs perpendicular to the direction of disagreement,
          // sitting slightly inside this power's own ground.
          // Sit the line just inside this power's own ground, so where two
          // powers meet their colours run alongside each other rather than
          // fighting for the same pixels.
          const mx = x + dx * step * 0.34, mz = z + dz * step * 0.34;
          const ax = mx - dz * step * 0.52, az = mz - dx * step * 0.52;
          const bx = mx + dz * step * 0.52, bz = mz + dx * step * 0.52;
          quad(ax, az, bx, bz, dx, dz, c);
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
    return `${Object.keys(this.S.holdings || {}).sort().join(',')}|${this.S.ownFaction?.id || ''}`;
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
      lab.textContent = p.grudge ? `${p.commander || p.name} ${p.strength}` : String(p.strength);
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

    add(el, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const hits = this.raycaster.intersectObject(this.terrain, false);
      if (hits.length) {
        const p = hits[0].point;
        this.setDestination(p.x, p.z);
      }
    });
    add(el, 'wheel', (e) => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * (1 + Math.sign(e.deltaY) * 0.12), 0.28, 2.8);
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
    });
    add(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  setDestination(x, z) {
    const b = HALF - 40;
    this.S.dest = { x: clamp(x, -b, b), z: clamp(z, -b, b) };
    this.travelling = true;
    this.destMarker.position.set(this.S.dest.x, regionHeight(this.S.dest.x, this.S.dest.z) + 1.2, this.S.dest.z);
    this.destMarker.visible = true;
    Audio.uiSelect();
  }

  stopTravel() {
    this.travelling = false;
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
    const pace = State.partySpeed(S).speed;
    if (mx || mz) {
      this.stopTravel();
      const m = Math.hypot(mx, mz);
      const step = pace * dt * 1.6;
      S.pos.x = clamp(S.pos.x + (mx / m) * step, -HALF + 40, HALF - 40);
      S.pos.z = clamp(S.pos.z + (mz / m) * step, -HALF + 40, HALF - 40);
      this.playerHeading = Math.atan2(mx, mz);
      moved = step;
    } else if (this.travelling && S.dest) {
      const dx = S.dest.x - S.pos.x, dz = S.dest.z - S.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 3) {
        this.stopTravel();
      } else {
        const step = Math.min(d, pace * dt * 1.6);
        S.pos.x += (dx / d) * step;
        S.pos.z += (dz / d) * step;
        this.playerHeading = Math.atan2(dx, dz);
        moved = step;
      }
    }

    // Time only passes while the company is actually moving. Standing still on
    // the map should never quietly burn contract deadlines.
    //
    // Except when you have asked it to: fast-forward on the spot is how you
    // wait for a wound to close or a caravan to come home, and it can run much
    // harder than fast-forward on the road, because the reason FAST is capped
    // at four is that you drive past the parties you were meant to notice —
    // which cannot happen when you are not going anywhere.
    if (moved > 0) State.advanceTime(S, moved / State.TRAVEL_SPEED);
    else State.advanceTime(S, dt * 0.05 * (this.timeScale === FAST ? 3 : 1));

    this.syncParties();
    this.checkProximity();
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

    for (const p of near) {
      if (this.nearSet.has(p.id)) continue;
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
    const dist = 1250 * this.zoom;
    const height = 1400 * this.zoom;
    // Fixed fog distances made a zoomed-out map dissolve into flat haze.
    const eye = Math.hypot(dist, height);
    this.scene.fog.near = eye * 0.55;
    this.scene.fog.far = eye * 2.15;
    const want = new THREE.Vector3(S.pos.x, y + height, S.pos.z + dist);
    if (!this.camInit) { this.camera.position.copy(want); this.camInit = true; }
    else this.camera.position.lerp(want, 1 - Math.exp(-dt * 4.5));
    this.camera.lookAt(S.pos.x, y + 8, S.pos.z);

    this.sun.position.set(S.pos.x - 260, 300, S.pos.z + 180);
    this.sun.target.position.set(S.pos.x, 0, S.pos.z);
    this.sun.target.updateMatrixWorld();

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
      travelling: this.travelling,
      contract: State.activeContract(S),
      contracts: S.contracts,
      nearParties: (this.nearParties || []).map((p) => ({
        id: p.id, name: p.name, faction: p.faction, strength: p.strength,
        tier: p.tier, hostile: p.hostileToPlayer,
        dist: Math.hypot(p.x - S.pos.x, p.z - S.pos.z),
      })),
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
    this.scene?.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
