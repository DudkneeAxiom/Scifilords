// Third-person deployment runtime.
//
// This is where the campaign is decided. Everything else exists to give this
// layer stakes: the people in your squad are the same objects that were on the
// roster screen a minute ago, and whatever happens to them here is permanent.
//
// Design notes that drove the tuning:
//  - Slower than an arena shooter. Base move is 4.2 m/s, ADS drops you to 2.0.
//  - Bullets are hitscan but tracers are drawn, so misses are readable.
//  - Cover is real: shots are traced in 3D, so a low barrier stops a standing
//    shot at range and does nothing at three metres.
//  - Nobody dies instantly. Going down is a state with a timer, and that timer
//    is the source of most of the tension in the game.

import * as THREE from '../vendor/three/three.module.min.js';
import * as Models from './models.js';
import * as Level from './level.js';
import { NavGrid } from './nav.js';
import * as Audio from './audio.js';
import {
  WEAPONS, ROLES, FACTIONS, MISSION_TYPES, PARTY_TIERS, ORIGINS,
  ARMOUR, ARMOUR_LIST, KIT, DOCTRINES,
} from './data.js';
import {
  effective, weaponOf, roleOf, label, makeSoldier, STATUS, resolveCasualty,
} from './roster.js';
import { companyMods } from './perks.js';
import { hasOfficer } from './state.js';
import { clamp, lerp, rng, range, pick, irange, approachAngle, angleDelta } from './util.js';

const EYE = 1.55;
const CHEST = 1.15;
const BLEED_OUT = 55;      // seconds a downed soldier has before it is permanent

// How many hostiles stand on the field at once. Larger parties commit the rest
// in waves as the front rank falls, which is both how a big formation actually
// fights and what keeps the frame budget honest.
// Raised from 34 after character instancing: fifty combatants used to cost
// ~350 character draw calls and now cost the same ~30 pools regardless of
// count (tools/perf.mjs field scene: 874 → 79 calls). The cap is now paid
// in simulation.
//
// Raised again to 120 for the melee overhaul, on measurement rather than
// nerve — tools/scale.mjs sweeps the size and the curve has no cliff in it:
//
//    bodies    sim p50   draw p50   total   calls
//      100       3.0ms      1.9ms   4.9ms      18
//      160       7.3ms      2.9ms  10.2ms      18
//      240      11.3ms      2.7ms  14.0ms      18
//
// Linear at roughly 0.047ms of simulation per body, draw calls pinned flat
// by the instancing, and that is SOFTWARE rendering (swiftshader) — real
// hardware makes the draw column nearly free. A cap of 120 hostiles plus
// allies and the squad lands near that 160-body row: about 10ms of a
// 16.7ms frame on the slowest thing we can measure on, which leaves the
// headroom a weaker machine needs. Bigger numbers are AVAILABLE and are
// deliberately not taken: 240 measured fine here and would leave nothing
// spare anywhere else.
export const FIELD_CAP = 120;

// How many bodies each instance pool can hold. It has to exceed the WHOLE
// field — hostiles at the cap, plus allied waves, plus the squad — because
// an InstancedMesh silently stops drawing past its capacity, which reads as
// soldiers turning invisible rather than as a limit being reached.
const INSTANCE_CAP = 320;

// How far a focus-fire mark survives. Past this the squad could not engage it
// anyway, and a marker on someone nobody can shoot is worse than no marker.
const MARK_RANGE = 85;
// How far off a reinforcement must arrive, and how long it stands there before
// it is allowed to shoot. Both exist because of the same complaint: enemies
// popping into being next to the player and hitting them immediately.
const ARRIVE_MIN_DIST = 30;
const ARRIVE_GRACE = 1.3;

// Ranging in. A shooter holding a target for RANGE_IN seconds has its aim
// scatter fall from RANGE_IN_WIDE times the tuned figure to the tuned figure
// itself. The window is roughly the time it takes to cross a street: long
// enough that breaking contact and moving is a real answer to being shot at,
// short enough that standing in the open is still fatal. Losing sight of the
// target gives some of the window back, so bounding between cover works.
const RANGE_IN = 2.2;
const RANGE_IN_WIDE = 2.5;

/**
 * How much of a body a shot can actually find.
 *
 * Cover was never protection, only a spread penalty applied to the shooter —
 * because the target capsule was the same height whatever the target was doing.
 * You could be crouched behind a sandbag wall and still be a full-height
 * silhouette to the ray test, so the wall in front of you did nothing and the
 * only thing keeping you alive was a multiplier.
 *
 * Making the body genuinely shorter puts the geometry back in charge: a tucked
 * body sits under the top of low cover, so the ray hits the box instead of the
 * capsule, and it does so for the AI on exactly the same terms. That is the
 * difference between cover you stand near and cover you are behind.
 */
export function bodyCapsule(e) {
  // Feet, not terrain: somebody on a catwalk is a target up there, not a
  // silhouette buried in the deck they are standing on.
  const base = Level.heightAt(e.x, e.z) + (e.elev || 0);
  if (e.down) return { lo: base + 0.1, hi: base + 0.6 };
  // 0 = upright, 1 = fully tucked. Crouching counts for part of it.
  const tuck = clamp(e.tuck || 0, 0, 1);
  return { lo: base + 0.35 - tuck * 0.1, hi: base + 1.78 - tuck * 0.86 };
}

// How close you have to be to a piece of cover to get into it, and how far
// above the ground a thing has to stand to be worth hiding behind.
const COVER_REACH = 2.6;
const COVER_MIN_H = 0.7;

/**
 * How the squad stands when it is on you.
 *
 * A single fixed wedge meant the only spacing decision in the game was made
 * once by me, in code. These are the three shapes that actually matter in a
 * firefight and they trade against each other honestly:
 *
 *  wedge   the default. Compact, everyone can see forward, easy to move.
 *  line    abreast and level with you. Maximum guns facing front, and a wide
 *          frontage — good for holding ground, bad for moving through a street.
 *  spread  wide intervals and staggered depth. Costs you concentration of fire
 *          and gains you not losing three people to the same burst.
 *
 * Each returns a lateral bearing offset and a distance behind the commander.
 */
const FORMATIONS = {
  wedge: {
    id: 'wedge', name: 'WEDGE', desc: 'Compact behind you. Moves well.',
    slot: (i) => {
      const perRank = 3;
      const rank = Math.floor(i / perRank);
      const s = i % perRank;
      return { lateral: s === 0 ? 0 : (s === 1 ? -1.25 : 1.25), off: 5.4 + rank * 2.6 };
    },
  },
  line: {
    id: 'line', name: 'LINE', desc: 'Abreast of you. Every gun forward.',
    slot: (i) => {
      // Alternate out from the commander so the line grows evenly both ways.
      const step = Math.ceil((i + 1) / 2);
      const side = i % 2 === 0 ? -1 : 1;
      // Nearly perpendicular: they stand beside you, not behind.
      return { lateral: side * (Math.PI / 2) * 0.92, off: 2.6 + step * 2.4 };
    },
  },
  spread: {
    id: 'spread', name: 'SPREAD', desc: 'Wide intervals. One burst cannot take three.',
    slot: (i) => {
      const perRank = 2;
      const rank = Math.floor(i / perRank);
      const s = i % perRank;
      return { lateral: s === 0 ? -1.9 : 1.9, off: 7.5 + rank * 5.5 };
    },
  },
  // The melee era's default. Slots come from battleSlot() — grouped by arm,
  // rectangles in the commander's local frame — not from the angle scheme
  // the gun formations use, so `slot` here is a sentinel the follow branch
  // checks for.
  battle: {
    id: 'battle', name: 'BATTLE LINE',
    desc: 'Infantry forward, spears behind them, ranged at the back.',
    slot: null,
  },
};

export class Mission {
  constructor({ campaign, spec, squad, container, onEnd, onHud, onToast, onIntro, onWheel,
    onArea }) {
    this.onIntro = onIntro;
    this.onWheel = onWheel || (() => {});
    // Town visits only: fired when the player works an area doorway, so the
    // shell can open the right panel over the paused walk.
    this.onArea = onArea || null;
    this.S = campaign;
    this.spec = spec;               // { type, site, contract }
    this.squadSoldiers = squad;     // persistent soldier objects, commander first
    this.container = container;
    this.onEnd = onEnd;
    this.onHud = onHud || (() => {});
    this.onToast = onToast || (() => {});

    this.r = rng((campaign.seed + campaign.stats.missions * 7717 + spec.site.length) | 0);
    // Commander perks apply to the whole company; resolved once per deployment.
    this.company = companyMods(campaign.roster);
    // How the company is feeling, as a multiplier on how well it shoots.
    // 70 is the settled default, so an ordinary company fights at exactly the
    // strength it always did and only real misery or real devotion moves it.
    this.moraleEdge = clamp(0.82 + ((campaign.morale ?? 70) / 100) * 0.26, 0.82, 1.08);
    // Officers reach the field: resolved once per deployment, like perks.
    // Jorsa calls corrections (squad accuracy), Okkam anchors the base of
    // fire (squad suppression output). See OFFICERS in data.js.
    this.officerFx = {
      overwatch: hasOfficer(campaign, 'jorsa'),
      baseFire: hasOfficer(campaign, 'okkam'),
    };
    this.selection = new Set();   // squad indices under command; empty = all
    this.time = 0;
    this.over = false;
    this.paused = false;
    this.entities = [];
    this.effects = [];
    this.interactables = [];
    this.keys = new Set();
    this.mouse = { down: false, right: false };
    this.mouseVel = { x: 0, y: 0 };
    this.pStamina = 1;                     // the commander's wind, 0..1
    // Per-arm formation shapes for THE BATTLE LINE. Ranged default loose:
    // bunched bows are one volley's worth of casualties.
    this.groupShape = { inf: 'line', spear: 'line', ranged: 'loose' };
    this.arrows = [];                      // bodies in flight
    this.marker = null;
    this.result = null;
    this.stats = { kills: 0, shotsFired: 0, medkitsUsed: 0 };
    this.hudCache = {};
    this._boundHandlers = [];
  }

  // ======================================================================
  // Setup
  // ======================================================================

  async start() {
    this.buildScene();
    this.buildLevel();
    this.buildSquad();
    this.buildObjective();
    this.bindInput();
    Audio.ambience('mission');
    Audio.deployTone();

    // Insertion. The player used to materialise inside an already-alerted
    // garrison and be under fire before they had found the horizon. Now the
    // deployment opens on the site itself, sweeps back to the squad, and only
    // then hands over control — and nothing may shoot at them until it does.
    //
    // Walking into a town you were invited into is not an insertion: no
    // fly-in, no grace clock, control from the first frame.
    if (this.spec.type === 'visit') {
      this.intro = null;
    } else {
      this.intro = {
        active: true,
        t: 0,
        dur: 6.0,
        // Contact is additionally held off for a moment after control returns,
        // so the first thing that happens is never a bullet.
        graceUntil: 7.6,
      };
      this.onIntro?.({
        site: this.level.name,
        type: MISSION_TYPES[this.spec.type]?.name || 'Deployment',
        objective: this.objective.text,
        squad: [this.player, ...this.squad]
          .filter((e) => e.soldier)
          .map((e) => ({ name: e.soldier.name, role: ROLES[e.soldier.role].name })),
      });
    }

    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** True while the deployment cinematic is running or during its grace. */
  get inserting() {
    return !!this.intro && this.time < this.intro.graceUntil;
  }

  buildScene() {
    const w = this.container.clientWidth || 1280;
    const h = this.container.clientHeight || 800;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    // Render below native resolution and upscale. This is the single biggest
    // contributor to the period look, and it costs nothing — it buys frames.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * 0.75);
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // hard-edged, period-correct
    this.renderer.domElement.className = 'game-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, w / h, 0.12, 400);
    this.camYaw = 0;
    this.camPitch = 0.09;
    // The tactical camera: press T and the commander steps back from their
    // own eyes. Top-down, pannable, click-to-select, right-click-to-order —
    // and the commander's own body becomes one more unit on the board
    // (playerAuto walks them to ordered points). No aiming and no trigger
    // from up here: the view commands, it does not shoot.
    this.rts = false;
    this.rtsFocus = null;
    this.rtsZoom = 46;
    this.rtsYaw = 0;
    this.rtsCursor = { x: 0, y: 0 };
    this.rtsDrag = null;
    this.playerSelected = false;
    this.playerAuto = null;
    // Control groups: Ctrl+digit binds the current selection (commander
    // included) to that digit; in tactical mode the plain digit recalls it.
    // Stored by entity id, not squad index — the squad array grows as allied
    // waves stream in, so an index snapshot goes stale mid-battle.
    this.ctrlGroups = {};
    this.routeViz = null;

    this.onResize = () => {
      const cw = this.container.clientWidth, ch = this.container.clientHeight;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(cw, ch);
    };
    window.addEventListener('resize', this.onResize);
  }

  buildLevel() {
    // Locations map onto shared layouts but keep their own name, light and
    // garrison faction.
    // Bigger fights get more ground. Sized off the opposition rather than the
    // contract pay, because what makes a site feel cramped is the number of
    // people standing in it.
    // Armies count toward the ground they get: a summoned siege or a joined
    // host battle sizes its site by the biggest force on it, not just the
    // enemy party card.
    const weight = Math.max(
      this.spec.party?.strength || 0,
      this.spec.enemyArmy || 0,
      this.spec.allies || 0,
    ) || MISSION_TYPES[this.spec.type]?.foes || 8;
    const spread = clamp(0.8 + weight / 90, 0.8, 1.75);
    this.level = Level.build(this.spec.layout || this.spec.site,
      this.S.seed + this.S.stats.missions, {
        name: this.spec.siteName ? this.spec.siteName.toUpperCase() : null,
        enemyFaction: this.spec.enemyFaction || null,
        spread,
      });
    // Built once: everything in these sites is static.
    this.nav = new NavGrid(this.level.obstacles, this.level.bounds, 0.65);
    this.scene.add(this.level.group);
    const p = this.level.palette;

    this.scene.background = new THREE.Color(p.sky);
    // Heavy fog is the whole atmosphere budget. It hides the draw distance and
    // — because the fog is LIGHTER than the objects in it — turns everything at
    // distance into a flat silhouette, which is the entire look.
    //
    // Ranged off the site rather than fixed: the field went from a 132m circle
    // to 224m across, and a fog wall at 145m simply deleted everything that was
    // added — the far half of every map was solid haze, which is why an enlarged
    // site still read as one band of scenery in brown soup.
    const far = this.level.bounds * 2.5;
    // Aerial perspective: distance shifts HUE, not brightness. The fog keeps
    // exactly the lightness it was authored with — lighter than the objects in
    // it, which is what makes the silhouette look — but its tint is pulled to
    // the site's own sky, so far scenery cools away from the warm ground
    // instead of converging on it. Every fog was authored in the same
    // brown-grey family as its ground, which is why "muddy at distance" was
    // the standing complaint: ground, props and haze all met at one colour.
    const fogHSL = {}, skyHSL = {};
    new THREE.Color(p.fog).getHSL(fogHSL);
    new THREE.Color(p.sky).getHSL(skyHSL);
    const fogC = new THREE.Color().setHSL(
      skyHSL.h, (fogHSL.s + skyHSL.s) / 2, fogHSL.l);
    this.scene.fog = new THREE.Fog(fogC, this.level.bounds * 0.55, far);

    const amb = new THREE.HemisphereLight(p.amb, 0x0d0f0c, p.ambI);
    this.scene.add(amb);

    // One key light, low and raking, so every object throws a long hard shadow.
    // Three uses physical light units, so these numbers are much larger than
    // the pre-r155 values that look equivalent.
    const sun = new THREE.DirectionalLight(p.sun, p.sunI);
    sun.position.set(-46, 38, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    // The shadow volume has to cover the ground the player can actually see, or
    // half the site is lit but shadowless and reads as flat.
    const d = this.level.bounds * 1.1;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = this.level.bounds * 3.2;
    sun.shadow.bias = -0.002;
    this.scene.add(sun);
    this.sun = sun;

    // A cool fill from the opposite side keeps shadowed faces from going pure
    // black — a silhouette needs a rim to read against, not a void.
    const fill = new THREE.DirectionalLight(0x4a5a72, 0.9);
    fill.position.set(40, 22, -30);
    this.scene.add(fill);

    this.extractMarker = this.makeMarker(0xb8863f);
    this.extractMarker.visible = false;
    this.scene.add(this.extractMarker);

    // Bone rather than the blue that was fighting the ochre/rust palette.
    this.orderMarker = this.makeMarker(0x9c9683);
    this.orderMarker.visible = false;
    this.scene.add(this.orderMarker);

    // The focus-fire mark. Unlike an order marker this is not a place, it is a
    // person: it follows them, and it stays until they are dead or out of it.
    this.markMesh = this.makeTargetMark();
    this.markMesh.visible = false;
    this.scene.add(this.markMesh);
    this.marked = null;
  }

  /**
   * A caret over a marked target. Deliberately not a ring on the ground — the
   * whole point is to find them again in a crowd, and a crowd is exactly when
   * you cannot see the ground.
   */
  makeTargetMark() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd9452f, transparent: true, opacity: 0.95, depthTest: false,
    });
    const caret = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.52, 4), mat);
    caret.rotation.x = Math.PI;      // point down at them
    caret.position.y = 0.55;
    g.add(caret);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.66, 4),
      new THREE.MeshBasicMaterial({
        color: 0xd9452f, transparent: true, opacity: 0.7,
        side: THREE.DoubleSide, depthTest: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    // Drawn last so it is never hidden by the body it is marking.
    g.renderOrder = 900;
    return g;
  }

  /**
   * Mark a hostile and put every commanded soldier onto them.
   *
   * This fires the moment the wheel is OPENED over a body rather than waiting
   * for a release, because "that one, now" is the single most common thing a
   * player wants to say in a firefight and it should cost one button, not a
   * button and a menu choice. The wheel still opens behind it, so any other
   * order can override — but if you press and release over a target, you have
   * already said the thing you meant.
   */
  markTarget(e) {
    if (!e || e.dead || e.side !== 'enemy') return false;
    this.marked = e;
    const targets = this.commanded();
    for (const s of targets) {
      s.order = 'attack';
      s.forceTarget = e;
      s.orderPoint = null;
      s.suppressPoint = null;
      s.suppressOrder = false;
      s.flankPoint = null;
    }
    if (!this.selection.size) this.squadOrder = 'attack';
    Audio.order();
    this.onToast(this.selectionLabel(), `FOCUS FIRE — ${e.name || 'TARGET'}`, 'order');
    return true;
  }

  clearMark(reason) {
    if (!this.marked) return;
    const was = this.marked;
    this.marked = null;
    this.markMesh.visible = false;
    for (const s of this.squad) {
      if (s.forceTarget === was) s.forceTarget = null;
    }
    if (reason === 'range') this.onToast('', 'TARGET LOST', 'order');
  }

  /**
   * Keep the mark honest. It survives until the target is down or has broken
   * far enough away that the squad could not engage it anyway — anything else
   * and the marker becomes a lie the player is still acting on.
   */
  updateMark() {
    const e = this.marked;
    if (!e) { this.markMesh.visible = false; return; }
    if (e.dead || e.down) { this.clearMark('dead'); return; }
    const d = Math.hypot(e.x - this.player.x, e.z - this.player.z);
    if (d > MARK_RANGE) { this.clearMark('range'); return; }
    const y = Level.heightAt(e.x, e.z);
    this.markMesh.position.set(e.x, y + 1.95, e.z);
    this.markMesh.rotation.y += 0.03;
    this.markMesh.visible = true;
  }

  /**
   * A ring on the ground under everybody on your side.
   *
   * Both sides wear the kit of a faction and both are lit by the same dim
   * afternoon, so at fifty metres through dust a Bracket rifleman and a Trust
   * one are the same shape and very nearly the same colour — which makes
   * identifying friend from foe a matter of squinting rather than of playing.
   * The signal has to be something the enemy NEVER has, so it is read at a
   * glance and never has to be second-guessed.
   *
   * A ground ring rather than a floating marker: it sits under the soldier, so
   * it does not obscure the body, does not clutter the sky, and reads at the
   * shallow angle this camera actually looks along.
   */
  /**
   * Faction identity underfoot, Mount-and-Blade legible: your own people
   * ring Bracket amber, Trust cyan, Syndic red, raiders violet. The kits are
   * deliberately similar — the same surplus wars produced them — so the ring
   * is the ONLY signal, and it never lies about a side.
   *
   * All rings are ONE InstancedMesh. Fifty separate ring meshes were fifty
   * draw calls, and at army scale that was a meaningful slice of the frame's
   * whole call budget for what is, visually, one repeated disc.
   */
  /**
   * Standards.
   *
   * The rings underfoot say whose a man is, one man at a time. A banner
   * says where a FORMATION is, from across the field and from the tactical
   * eye — which is the thing a commander actually needs to see, and the
   * thing the directive asks for in place of relying on floating icons.
   *
   * One standard per arm of the player's line and one for the enemy host,
   * planted at the group's centre of mass and drifting to follow it, on an
   * antenna rod with a cloth in the faction's colour. They are markers, not
   * bodies: nobody carries them, nobody dies holding them, and they cost
   * four small meshes rather than a bearer AI.
   */
  syncBanners() {
    if (!this.banners) this.banners = new Map();
    const want = new Map();
    const add = (key, list, colour, min) => {
      const live = list.filter((e) => !e.dead && !e.down && !e.routing);
      if (live.length < min) return;
      let x = 0, z = 0;
      for (const e of live) { x += e.x; z += e.z; }
      want.set(key, { x: x / live.length, z: z / live.length, colour });
    };
    const mine = { inf: [], spear: [], ranged: [] };
    const all = [];
    for (const s of this.squad) {
      if (s.militia) continue;
      mine[this.battleGroup(s)].push(s);
      all.push(s);
    }
    if (this.player && !this.player.dead) all.push(this.player);
    // A declared power flies the colour it CHOSE at declaration — the
    // banner-customisation round finally reaching the battlefield.
    const own = this.S?.ownFaction?.colour ?? FACTIONS.player.accent;
    // THE COMPANY'S OWN BANNER, always — a Bracket company of four is still
    // a company with a name, and this is the flag the campaign lets you
    // choose a colour for. The arms only raise their own standards once
    // they are big enough to be formations rather than a handful of men,
    // or a four-man outfit ends up carrying four flags.
    add('company', all, own, 2);
    add('inf', mine.inf, own, 5);
    add('spear', mine.spear, own, 5);
    add('ranged', mine.ranged, own, 5);
    const foes = this.entities.filter((e) => e.side === 'enemy' && !e.isTitan);
    add('foe', foes, FACTIONS[this.level.enemyFaction]?.color ?? 0x9a3b3b);

    for (const [key, at] of want) {
      let b = this.banners.get(key);
      if (!b) {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 4.2, 0.07),
          new THREE.MeshLambertMaterial({ color: 0x35322b }));
        pole.position.y = 2.1;
        const cloth = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 1.15, 0.9),
          new THREE.MeshLambertMaterial({ color: at.colour }));
        cloth.position.set(0, 3.3, 0.5);
        const finial = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.16, 0.16),
          new THREE.MeshLambertMaterial({ color: at.colour }));
        finial.position.y = 4.25;
        g.add(pole, cloth, finial);
        g.castShadow = false;
        this.scene.add(g);
        b = { group: g, cloth, x: at.x, z: at.z };
        this.banners.set(key, b);
      }
      // Drift rather than snap: a standard moves with the line, and a marker
      // that teleports every time somebody dies reads as a bug.
      b.x += (at.x - b.x) * 0.04;
      b.z += (at.z - b.z) * 0.04;
      b.group.position.set(b.x, Level.heightAt(b.x, b.z), b.z);
      // The cloth hangs off the wind, not off the simulation.
      b.cloth.rotation.y = Math.sin(this.time * 1.3 + b.x) * 0.28;
      b.group.visible = true;
    }
    for (const [key, b] of this.banners) {
      if (!want.has(key)) b.group.visible = false;
    }
  }

  syncRings() {
    if (!this.ringMesh) {
      const geo = new THREE.RingGeometry(0.42, 0.58, 16);
      geo.rotateX(-Math.PI / 2);
      this.ringMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false,
      }), INSTANCE_CAP);
      this.ringMesh.renderOrder = 2;
      // Instances move every frame; a stale whole-mesh bounds culls them all.
      this.ringMesh.frustumCulled = false;
      this.scene.add(this.ringMesh);
      this.ringM4 = new THREE.Matrix4();
      this.ringCol = new THREE.Color();
    }
    let n = 0;
    for (const e of this.entities) {
      if (n >= INSTANCE_CAP) break;
      if (e.isPlayer || e.dead) continue;
      if (e.side !== 'player' && e.side !== 'enemy') continue;
      this.ringM4.makeTranslation(e.x, Level.heightAt(e.x, e.z) + (e.elev || 0) + 0.06, e.z);
      this.ringMesh.setMatrixAt(n, this.ringM4);
      this.ringCol.setHex(e.side === 'player' ? 0xc08d3f
        : e.faction === 'trust' ? 0x3fb8c4
          : e.faction === 'syndic' ? 0xd8434f : 0xa855c8);
      this.ringMesh.setColorAt(n, this.ringCol);
      n++;
    }
    this.ringMesh.count = n;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
  }

  makeMarker(color, scale = 1) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85 * scale, 1.12 * scale, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 2.2 * scale, 0.07),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32 }),
    );
    post.position.y = 1.1 * scale;
    g.add(post);
    return g;
  }

  // ----------------------------------------------------------------------

  /**
   * Resolve a spawn point to somewhere a soldier can actually stand and be
   * shot at.
   *
   * Ring-and-arc spawning drops bodies wherever the maths lands, which on a
   * site full of containers and rocks put up to half a wave *inside* solid
   * geometry. An embedded soldier is shielded — every shot stops on the
   * obstacle before it reaches them — so an "eliminate all" objective could
   * never be completed. Anything blocked is nudged to the nearest open cell.
   */
  safeSpawn(x, z) {
    const b = this.level.bounds - 3;
    let px = clamp(x, -b, b);
    let pz = clamp(z, -b, b);
    if (!this.nav) return { x: px, z: pz };
    if (!this.nav.isBlockedWorld(px, pz)) return { x: px, z: pz };
    const c = this.nav.cellOf(px, pz);
    const open = this.nav.nearestOpen(c.gx, c.gz, 14);
    if (open) {
      const w = this.nav.worldOf(open.gx, open.gz);
      px = clamp(w.x, -b, b);
      pz = clamp(w.z, -b, b);
    }
    return { x: px, z: pz };
  }

  /**
   * Where a reinforcement is allowed to appear.
   *
   * Waves used to be placed at a fixed radius from the middle of the map, which
   * has nothing to do with where the player is standing — so on a sixty-metre
   * site a wave at radius forty-eight could arrive on top of somebody who had
   * pushed to the edge, and open fire the same instant it existed. Three things
   * have to hold at once, because any one of them on its own still allows a
   * soldier to appear behind you and shoot:
   *
   *   - far enough away to be seen coming,
   *   - out of sight when it happens, so nothing is watched popping into being,
   *   - and unable to fire for a moment after arriving.
   *
   * This handles the first two. The third is `arriving`, set by reinforce().
   */
  /**
   * Get behind the nearest piece of cover.
   *
   * The face chosen is the one the player is already standing on, snapped to an
   * axis because every obstacle box is axis-aligned. Returns false when there is
   * nothing to get behind, so the caller can fall through to a vault.
   */
  takeCover() {
    const p = this.player;
    if (!p || p.down || !this.grounded) return false;
    let best = null;
    for (const o of this.level.covers) {
      if ((o.coverH ?? o.h) < COVER_MIN_H) continue;
      // Distance to the box, not to its centre — a long barricade is reachable
      // anywhere along its length.
      const dx = Math.max(Math.abs(p.x - o.x) - o.hw, 0);
      const dz = Math.max(Math.abs(p.z - o.z) - o.hd, 0);
      const d = Math.hypot(dx, dz);
      if (d > COVER_REACH) continue;
      if (!best || d < best.d) best = { o, d };
    }
    if (!best) return false;

    const o = best.o;
    // Which face are we on? Whichever axis we are furthest outside.
    const ox = (p.x - o.x) / (o.hw + 0.001);
    const oz = (p.z - o.z) / (o.hd + 0.001);
    const nx = Math.abs(ox) >= Math.abs(oz) ? Math.sign(ox || 1) : 0;
    const nz = nx === 0 ? Math.sign(oz || 1) : 0;
    this.cover = { o, nx, nz };
    // Snap against the face so the body reads as touching the wall.
    const gap = 0.52;
    if (nx) { p.x = o.x + nx * (o.hw + gap); p.z = clamp(p.z, o.z - o.hd, o.z + o.hd); }
    else { p.z = o.z + nz * (o.hd + gap); p.x = clamp(p.x, o.x - o.hw, o.x + o.hw); }
    this.coverLean = 0;
    Audio.uiSelect();
    this.onToast('IN COVER', 'Aim to lean out · Space to break', 'order');
    return true;
  }

  leaveCover() {
    if (!this.cover) return;
    this.cover = null;
    this.coverLean = 0;
    this.player.tuck = 0;
  }

  /**
   * Hold the player against the cover face, and decide how much of them is
   * showing.
   *
   * Tucked, the body drops below the top of the cover and the ray test puts the
   * wall in the way. Aiming leans out: the body comes up and sideways, and the
   * wall stops helping. That trade — you cannot shoot and be safe in the same
   * instant — is the whole mechanic.
   */
  updateCover(dt) {
    const p = this.player;
    if (!this.cover) { p.tuck = this.crouch * 0.55; return; }
    const { o, nx, nz } = this.cover;

    // Stepping away from the wall, or being knocked off it, breaks cover.
    const offX = p.x - o.x, offZ = p.z - o.z;
    const outward = nx ? offX * nx : offZ * nz;
    const along = nx ? Math.abs(offZ) - o.hd : Math.abs(offX) - o.hw;
    if (outward > (nx ? o.hw : o.hd) + 1.8 || along > 1.4 || p.down || !this.grounded) {
      this.leaveCover();
      return;
    }

    // Leaning is driven by aiming, and by which shoulder you are on.
    const want = this.aiming ? 1 : 0;
    this.coverLean += (want - this.coverLean) * Math.min(1, dt * 9);
    p.tuck = 1 - this.coverLean;

    // Leaning slides the body out past the edge of the cover, so the shot has
    // somewhere to go — and so does return fire.
    const side = this.shoulder >= 0 ? 1 : -1;
    const lean = this.coverLean * 0.62 * side;
    if (nx) p.z = clamp(p.z + lean * dt * 6, o.z - o.hd - 0.7, o.z + o.hd + 0.7);
    else p.x = clamp(p.x + lean * dt * 6, o.x - o.hw - 0.7, o.x + o.hw + 0.7);
  }

  spawnPointFor(x, z, minDist = ARRIVE_MIN_DIST) {
    const p = this.player;
    if (!p) return this.safeSpawn(x, z);
    // A PENNED site — the pit — is a floor with walls round it, and
    // everything below is wrong inside one: it searches the whole playable
    // field, and it PREFERS ground the player cannot see, which in a bowl
    // means the far side of the wall. That is how pit fighters ended up in
    // the stands instead of in the ring. Inside a pen the asked-for point
    // IS the point: clamp it to the floor and put them down on it.
    const pen = this.level.penned;
    if (pen) {
      const dx = x - pen.x, dz = z - pen.z;
      const d = Math.hypot(dx, dz) || 1;
      const r = Math.min(d, pen.r);
      return this.safeSpawn(pen.x + (dx / d) * r, pen.z + (dz / d) * r);
    }
    const b = this.level.bounds - 4;
    let best = null;
    // Walk outward around the requested bearing looking for somewhere that is
    // far enough and unobserved; keep the furthest candidate as a fallback so
    // this can never fail outright.
    for (let i = 0; i < 24; i++) {
      const a = Math.atan2(z - p.z, x - p.x) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.42;
      const d = Math.max(minDist, Math.hypot(x - p.x, z - p.z)) + (i > 11 ? 6 : 0);
      const cx = clamp(p.x + Math.cos(a) * d, -b, b);
      const cz = clamp(p.z + Math.sin(a) * d, -b, b);
      const safe = this.safeSpawn(cx, cz);
      const away = Math.hypot(safe.x - p.x, safe.z - p.z);
      if (away < minDist * 0.8) continue;
      const seen = Level.hasLOS(this.level.obstacles, safe.x, safe.z, p.x, p.z, 1.5);
      if (!seen) return safe;
      if (!best || away > best.away) best = { ...safe, away };
    }
    return best ? { x: best.x, z: best.z } : this.safeSpawn(x, z);
  }

  /**
   * Bring somebody in as a reinforcement rather than placing them.
   *
   * Everything that arrives mid-fight goes through here so the rules are in one
   * place instead of being re-derived at each call site — which is how the pit,
   * the raid and the siege all ended up with their own spawn radius and none of
   * them looked at the player.
   */
  reinforce(x, z, role, minDist = ARRIVE_MIN_DIST) {
    const at = this.spawnPointFor(x, z, minDist);
    const e = this.spawnEnemy(at.x, at.z, role);
    // A beat on arrival: long enough that nobody is killed by something that
    // did not exist a frame ago, short enough not to read as a free hit.
    e.arriving = ARRIVE_GRACE;
    return e;
  }

  spawnEntity(opts) {
    // Never trust a caller's coordinates: resolve them to open ground first.
    //
    // Except where the placement IS the level design. Held personnel stand in a
    // pen; nudging them to the nearest walkable cell pushed them through its
    // walls and left them milling about outside their own cage, several metres
    // from the objective marker. Authored objective positions opt out.
    if (!opts.keepExact) {
      const safe = this.safeSpawn(opts.x, opts.z);
      opts = { ...opts, x: safe.x, z: safe.z };
    }
    const e = {
      id: opts.id,
      side: opts.side,                 // 'player' | 'enemy' | 'civil'
      soldier: opts.soldier || null,
      faction: opts.faction,
      x: opts.x, z: opts.z, y: 0,
      yaw: opts.yaw || 0,
      hp: opts.hp, maxHp: opts.hp,
      weapon: opts.weapon ? WEAPONS[opts.weapon] : null,
      ammo: opts.weapon ? WEAPONS[opts.weapon].mag : 0,
      reserve: 999,
      reloading: 0,
      cooldown: 0,
      down: false,
      bleed: 0,
      stabilised: false,
      dead: false,
      acc: opts.acc ?? 0.6,
      speed: opts.speed ?? 4.2,
      sight: opts.sight ?? 55,
      aggression: opts.aggression ?? 0.5,
      coverPref: opts.coverPref ?? 0.4,
      // The melee era: the swing in flight, the guard, and the plate on
      // the off arm. shieldHp 0 means no shield; the guard still turns
      // some steel bare-handed, just not arrows.
      swing: null,
      guard: 0,
      guardBreak: 0,
      shieldHp: opts.shieldHp ?? 0,
      blockArc: opts.blockArc ?? 2.1,
      order: 'follow',
      orderPoint: null,
      target: null,
      state: opts.state || 'idle',
      alert: 0,
      patrol: opts.patrol || null,
      patrolIdx: 0,
      thinkAt: 0,
      moveTarget: null,
      coverPos: null,
      lastFire: -99,
      // Suppression is the tactical spine of the firefight: fire that lands
      // near you degrades your aim and pins you in cover whether or not it hits.
      suppression: 0,
      eff: opts.eff || null,
      name: opts.name || 'Unknown',
      isPlayer: !!opts.isPlayer,
      follower: !!opts.follower,
      rescued: false,
    };
    const wModel = e.weapon ? e.weapon.model : null;
    e.char = opts.model === 'titan'
      ? Models.makeTitan()
      : Models.makeCharacter(opts.model, wModel, opts.tint);
    e.char.group.position.set(e.x, Level.heightAt(e.x, e.z), e.z);
    e.char.group.rotation.y = e.yaw;
    this.scene.add(e.char.group);
    // Soldiers render through the instanced pools; the Titan is one body and
    // stays a plain mesh hierarchy.
    if (opts.model !== 'titan') this.batchCharacter(e);
    // The player's own body is hidden from the head up when aiming so the
    // camera never looks through a skull; simplest fix is to keep the model.
    this.entities.push(e);
    return e;
  }

  // ======================================================================
  // Character batching
  // ======================================================================
  //
  // Every soldier used to be six or seven draw calls — one merged mesh per
  // rig joint, plus a weapon — and at fifty combatants that was ~350 of the
  // frame's ~900. All character meshes are hidden at spawn and drawn instead
  // through per-geometry InstancedMesh pools: the joint hierarchy still
  // exists and still animates (three.js computes matrices whether or not a
  // node renders), and every frame the batcher copies each hidden mesh's
  // matrixWorld into its pool slot. Draw calls become one per DISTINCT PART
  // across the whole field, not per soldier — which is what makes raising
  // the field cap affordable.

  batchCharacter(e) {
    this.charPools = this.charPools || new Map();
    this.charOwners = this.charOwners || [];
    this.charOwners.push(e);
    e.char.group.traverse((o) => {
      if (!o.isMesh) return;
      o.visible = false;
      const key = o.geometry.uuid;
      let pool = this.charPools.get(key);
      if (!pool) {
        const im = new THREE.InstancedMesh(o.geometry, o.material, INSTANCE_CAP);
        im.castShadow = true;
        // Instances move every frame; a stale whole-mesh bound culls them
        // all at once — same rule as the faction rings.
        im.frustumCulled = false;
        im.count = 0;
        this.scene.add(im);
        pool = { im, slots: [] };
        this.charPools.set(key, pool);
      }
      pool.slots.push({ mesh: o, owner: e });
    });
  }

  updateCharBatch() {
    if (!this.charPools) return;
    // Fresh matrices for every batched body: syncVisuals just posed them,
    // and copying last frame's matrixWorld would trail the animation by one
    // frame. Character subtrees only — the level is static and enormous.
    for (const e of this.charOwners) {
      if (e.char?.group && e.char.group.visible !== false) {
        e.char.group.updateMatrixWorld(true);
      }
    }
    for (const pool of this.charPools.values()) {
      let n = 0;
      for (const s of pool.slots) {
        const g = s.owner.char?.group;
        if (!g || g.visible === false) continue;
        pool.im.setMatrixAt(n, s.mesh.matrixWorld);
        n++;
      }
      pool.im.count = n;
      pool.im.instanceMatrix.needsUpdate = true;
    }
  }

  buildSquad() {
    const sp = this.level.playerSpawn;
    // Face the job.
    //
    // Every layout declared `ry: 0` at its spawn while its objective sat at a
    // bearing of about 177°, so the company arrived looking back down the road
    // it had just come up. The player snapped round the instant control was
    // handed over, which left the squad — who copy the player's facing when
    // idle — turned the wrong way for the whole cinematic and reading as though
    // they were staring at their commander.
    //
    // Derived from the objective rather than corrected in seven layouts, so a
    // new site cannot get this wrong by forgetting to set an angle.
    const obj = this.level.objectivePoint;
    const face = obj ? Math.atan2(obj.x - sp.x, obj.z - sp.z) : sp.ry;
    // The camera sits behind the body it follows — updatePlayer derives the
    // body from it as camYaw + PI — so the camera takes the opposite angle to
    // the way the company is looking.
    this.camYaw = face - Math.PI;

    const cmd = this.squadSoldiers[0];
    const ef = effective(cmd, this.company);
    this.player = this.spawnEntity({
      id: cmd.id, side: 'player', soldier: cmd, faction: 'player',
      x: sp.x, z: sp.z, yaw: face, hp: cmd.hp, weapon: cmd.weapon,
      model: 'soldier_commander', acc: ef.accuracy, speed: ef.speed,
      sight: ef.sight, eff: ef,
      isPlayer: true, name: cmd.name, tint: FACTIONS.player.accent,
    });
    this.player.maxHp = ef.maxHp;
    this.player.hp = Math.min(cmd.hp, ef.maxHp);
    if (this.player.weapon) {
      this.player.ammo = Math.round(this.player.weapon.mag * (ef.magMul || 1));
    }
    if (cmd.kit === 'shield' || roleOf(cmd).shield) {
      this.player.shieldHp = KIT.shield.shieldHp;
      this.player.blockArc = KIT.shield.blockArc;
    }

    this.squad = [];
    for (let i = 1; i < this.squadSoldiers.length; i++) {
      const s = this.squadSoldiers[i];
      const e2 = effective(s, this.company);
      const a = (i - 1) * 1.6 - 1.6;
      const ent = this.spawnEntity({
        id: s.id, side: 'player', soldier: s, faction: 'player',
        x: sp.x + a, z: sp.z + 2.4, yaw: face, hp: s.hp, weapon: s.weapon,
        // A soldier looks like the people who TRAINED them: a pressed Trust
        // regular keeps Trust kit under your amber ring, which is exactly
        // how you tell your drilled troops from your scrappers at a glance.
        // No lineage, and they look like the people who raised them.
        model: s.lineage === 'trust' ? 'soldier_trust'
          : s.lineage === 'syndic' ? 'soldier_syndic'
            : (ORIGINS[s.origin]?.model || 'soldier_bracket'),
        // Morale reaches the field.
        //
        // It decided desertion and nothing else, so a company on the edge of
        // walking out fought exactly as well as one that had just been paid,
        // fed and told it had won — which makes every wage day and every
        // ration an accounting exercise rather than something you feel when it
        // matters. Unhappy soldiers shoot worse and go to ground sooner;
        // devoted ones hold their nerve. Bounded on both sides, because a
        // company that cannot fight at all is a campaign you have already lost
        // and cannot recover from.
        acc: Math.min(0.95, e2.accuracy * this.moraleEdge
          + (this.officerFx.overwatch ? 0.05 : 0)),
        speed: e2.speed,
        sight: e2.sight, aggression: roleOf(s).aggression, coverPref: e2.cover,
        eff: e2, name: s.name, tint: FACTIONS.player.accent,
      });
      ent.maxHp = e2.maxHp;
      ent.hp = Math.min(s.hp, e2.maxHp);
      if (ent.weapon) ent.ammo = Math.round(ent.weapon.mag * (e2.magMul || 1));
      // The plate comes with the job for the arms that carry one, and a
      // shield bought into the gear slot upgrades anybody else's guard.
      if (s.kit === 'shield' || roleOf(s).shield) {
        ent.shieldHp = KIT.shield.shieldHp;
        ent.blockArc = KIT.shield.blockArc;
      }
      this.squad.push(ent);
    }
    this.squadOrder = 'follow';
    // How they stand when formed up. See FORMATIONS. A company carrying
    // steel forms the battle line by default; a gunline keeps its wedge.
    this.formation = this.squad.some((s) => s.weapon?.melee || s.weapon?.bow)
      ? 'battle' : 'wedge';
    // Stance. Crouch is a held pose blended 0..1 rather than a boolean, so the
    // camera, the aim penalty and the character all move together instead of
    // snapping. Airborne is tracked as a height above the ground plus a
    // velocity, because the terrain under the player is not flat.
    this.crouch = 0;
    this.crouchHeld = false;
    this.airY = 0;
    this.vy = 0;
    this.grounded = true;
    // Which shoulder the camera looks over. Swapping matters because the body
    // occludes exactly the side you are leaning past — being stuck on the right
    // makes left-hand corners unfightable.
    this.shoulder = 1;
    // What the dead have left lying about, and what the player has picked up.
    this.fieldLoot = [];
    this.loot = { credits: 0, armoury: {}, armourPool: {}, kitPool: {} };
    // Which piece of cover the player is behind, and how far out they are
    // leaning from it. Null when standing in the open.
    this.cover = null;
    this.coverLean = 0;
  }

  /**
   * The Titan.
   *
   * A siege walker that a rifle cannot meaningfully hurt. Every hit lands on
   * armour and does almost nothing until a plate is beaten off; underneath each
   * plate is a core, and a core takes crits. That is the whole fight: pick a
   * plate, concentrate everything on it until it sheds, then put rounds through
   * the hole before it turns that side away from you.
   *
   * It is deliberately not a big soldier. It does not take cover, it cannot be
   * suppressed, and it does not care about your flanking order — the only
   * tactic that works on it is the one the design is about.
   */
  spawnTitan(x, z) {
    const e = this.spawnEntity({
      id: 'titan', side: 'enemy', faction: this.level.enemyFaction,
      x, z, yaw: Math.PI, hp: 9000, weapon: 'lmg',
      model: 'titan',
      acc: 0.55, speed: 1.9, sight: 90, aggression: 1, coverPref: 0,
      name: 'TITAN', keepExact: true,
    });
    e.isTitan = true;
    e.titan = true;
    // Armour plates are not health. They are locks.
    e.plates = e.char.plates || [];
    e.platesLeft = e.plates.length;
    e.stomp = 0;
    e.sweep = 0;
    e.turnRate = 0;
    // Nothing about the small-unit AI applies, so it runs its own update.
    e.state = 'titan';
    this.titan = e;
    return e;
  }

  spawnEnemy(x, z, role, patrol = null) {
    const f = this.level.enemyFaction;
    const rd = ROLES[role];
    const skill = this.difficultyScale();
    return this.spawnEntity({
      id: `e_${this.entities.length}`,
      side: 'enemy', faction: f,
      x, z, yaw: this.r() * 6.28,
      hp: Math.round(rd.hp * 0.85),
      weapon: rd.weapon,
      model: FACTIONS[f].model,
      acc: rd.accuracy * skill,
      speed: 3.6 + this.r() * 0.5,
      // Kept near the fog distance on purpose: engagements should start at a
      // range where the player can actually see who is shooting at them.
      sight: 34 + this.r() * 12,
      aggression: rd.aggression,
      coverPref: f === 'trust' ? 0.75 : 0.45,  // doctrine, expressed as behaviour
      // The plate comes with the job, and it comes at SPAWN — which is what
      // makes the mesh in the hand and the rules in the maths the same
      // decision. A Trust line carries more of them than anybody else.
      shieldHp: rd.shield
        ? Math.round(KIT.shield.shieldHp * (f === 'trust' ? 1.15 : 0.9))
        : 0,
      name: `${FACTIONS[f].short} ${rd.abbr}`,
      state: patrol ? 'patrol' : 'guard',
      patrol,
    });
  }

  /**
   * The other side's commander.
   *
   * Not cleverness — readable intent. It looks at what it has against what
   * it faces and picks one of four postures, holds it for a few seconds so
   * the player can SEE it, and lets the individual bodies carry it out.
   * That is the whole difference between an army and a mob sprinting at
   * the nearest target.
   */
  updateEnemyCommander(dt) {
    this.foeThinkAt = (this.foeThinkAt || 0) - dt;
    if (this.foeThinkAt > 0) return;
    this.foeThinkAt = 3;
    const mine = [], theirs = [];
    for (const e of this.entities) {
      if (e.dead || e.isTitan || e.follower || e.down || e.routing) continue;
      if (e.side === 'enemy') mine.push(e);
      else if (e.side === 'player') theirs.push(e);
    }
    if (!mine.length || !theirs.length) return;
    const bows = (list) => list.filter((e) => e.weapon?.bow || e.bowStowed).length;
    const odds = mine.length / theirs.length;
    const rangedEdge = (bows(mine) + 0.5) / (bows(theirs) + 0.5);
    // Their archers, standing where nothing of ours is near them.
    const exposed = theirs.filter((t) => (t.weapon?.bow || t.bowStowed)
      && !mine.some((o) => Math.hypot(o.x - t.x, o.z - t.z) < 14));

    let posture = 'advance';
    if (odds < 0.55) posture = 'withdraw';
    else if (rangedEdge > 1.6 && bows(mine) >= 2) posture = 'hold';
    else if (exposed.length && mine.length >= 4) posture = 'snipe';
    if (posture !== this.foePosture) {
      this.foePosture = posture;
      const line = { advance: 'THEY ADVANCE BEHIND SHIELDS',
        hold: 'THEY HOLD AND SHOOT', snipe: 'THEY MOVE ON YOUR ARCHERS',
        withdraw: 'THEY ARE GIVING GROUND' }[posture];
      this.onToast('', line, 'order');
    }
    // The posture as orders on bodies. Everything else — pairing, spacing,
    // swings — is the melee layer doing its job underneath.
    const fast = [...mine].sort((a, b) => (b.aggression || 0) - (a.aggression || 0));
    const detail = posture === 'snipe'
      ? fast.slice(0, Math.max(2, Math.floor(mine.length * 0.3))) : [];
    // Where the other side is, as one point. An army that has lost sight of
    // you does not stand in a field wondering — it marches at where you are.
    let cx = 0, cz = 0;
    for (const t of theirs) { cx += t.x; cz += t.z; }
    cx /= theirs.length; cz /= theirs.length;
    this.foeAdvanceOn = { x: cx, z: cz };
    // AND IT MARCHES IN A LINE. Each man is given his own place in a
    // frontage abreast of the advance, so a host crosses the field as
    // ranks rather than as a crowd that happens to share a heading —
    // infantry forward, spears behind them, bows at the back, the same
    // shape the player's own battle line uses.
    let mx = 0, mz = 0;
    for (const e of mine) { mx += e.x; mz += e.z; }
    mx /= mine.length; mz /= mine.length;
    const head = Math.atan2(cx - mx, cz - mz);           // the way they face
    const rx = Math.sin(head + Math.PI / 2), rz = Math.cos(head + Math.PI / 2);
    const bx = Math.sin(head), bz = Math.cos(head);
    const arms = { inf: [], spear: [], ranged: [] };
    for (const e of mine) arms[this.battleGroup(e)].push(e);
    const DEPTH = { inf: 0, spear: 7, ranged: 15 };
    for (const [arm, list] of Object.entries(arms)) {
      // WIDE, and few ranks deep. At a hundred metres a two-metre interval
      // closes into one smudge and a host stops reading as ranks at all —
      // which is the whole point of forming them. Three and a half metres
      // of frontage per man, and a rank count that grows as the square
      // root of the arm, so a big host gets WIDER before it gets deeper.
      const perRank = Math.max(8, Math.ceil(Math.sqrt(list.length) * 3.0));
      list.forEach((e, i) => {
        const rank = Math.floor(i / perRank);
        const across = ((i % perRank) - (Math.min(perRank, list.length) - 1) / 2) * 3.5;
        const back = DEPTH[arm] + rank * 3.4;
        // Abreast of the host's centre, and set BACK along the facing so
        // the line has depth behind its front rank rather than ahead of it.
        e.linePost = {
          x: mx + rx * across - bx * back,
          z: mz + rz * across - bz * back,
        };
      });
    }
    for (const e of mine) {
      e.holdGround = posture === 'hold' && (e.weapon?.bow || e.bowStowed);
      e.withdrawing = posture === 'withdraw' && !(e.weapon?.bow);
      // THE ADVANCE. Without this the line closed to the edge of its own
      // eyesight, arrived at a stale sighting, and milled about there —
      // two armies stalled 70m apart with nothing happening, which the
      // campaign-loop probe caught as a battle that produced no result.
      e.advanceOn = posture === 'advance' || posture === 'snipe'
        ? this.foeAdvanceOn : null;
      if (detail.includes(e) && exposed.length) {
        // Pick the exposed archer nearest this man, and go for them.
        let best = exposed[0], bd = Infinity;
        for (const t of exposed) {
          const d = Math.hypot(t.x - e.x, t.z - e.z);
          if (d < bd) { bd = d; best = t; }
        }
        e.forceTarget = best;
        e.state = 'engage';
      } else if (e.forceTarget && posture !== 'snipe') {
        e.forceTarget = null;
      }
    }
  }

  /**
   * Who a party actually fields. The tier says what kind of outfit it is;
   * the doctrine says whose colours it wears, and skews the draw so a
   * Trust column and a Syndic band of the same size do not fight alike.
   */
  doctrineRoles(base) {
    const f = this.level.enemyFaction;
    const w = DOCTRINES[f]?.weights;
    if (!w) return base;
    const out = [];
    for (const r of base) {
      out.push(r);
      // Weight above the baseline of one buys extra tickets in the draw.
      for (let i = 1; i < (w[r] || 1); i++) out.push(r);
    }
    // A doctrine's signature arm turns up even when the tier never listed it.
    for (const [role, weight] of Object.entries(w)) {
      if (weight >= 3 && !out.includes(role)) out.push(role);
    }
    return out;
  }

  difficultyScale() {
    // Trust troops are drilled; scrappers are not. Keeps factions distinct
    // in play, not just in colour.
    return this.level.enemyFaction === 'trust' ? 1.0 : 0.82;
  }

  // ======================================================================
  // Objectives
  // ======================================================================

  buildObjective() {
    const t = this.spec.type;
    this.extractArmed = false;
    this.prisoners = [];
    this.optional = null;

    if (t === 'recovery') this.buildRecovery();
    else if (t === 'sabotage') this.buildSabotage();
    else if (t === 'skirmish') this.buildSkirmish();
    else if (t === 'seize') this.buildSeize();
    else if (t === 'titan') this.buildTitan();
    else if (t === 'raid') this.buildRaid();
    else if (t === 'lair') this.buildLair();
    else if (t === 'pit') this.buildPit();
    else if (t === 'siege') this.buildSiege();
    else if (t === 'visit') this.buildVisit();
    else if (this.spec.defend) this.buildSiegeDefense();
    else this.buildDefense();

    this.buildStages();

    // Optional objective: a cache placed deliberately AWAY from the exfil
    // route, so taking it costs time exactly when time is expensive.
    if (t !== 'defense') {
      // Placed off to one side of the objective and away from the exfil route,
      // so taking it always costs time in the wrong direction.
      const o = this.level.objectivePoint;
      const ex = this.level.extraction;
      const away = Math.atan2(o.z - ex.z, o.x - ex.x) + (this.r() < 0.5 ? 1.15 : -1.15);
      const cx = clamp(o.x + Math.cos(away) * 26, -this.level.bounds + 6, this.level.bounds - 6);
      const cz = clamp(o.z + Math.sin(away) * 26, -this.level.bounds + 6, this.level.bounds - 6);
      this.optional = {
        kind: 'cache', x: cx, z: cz, taken: false, progress: 0, need: 3.0,
        label: 'Weapons cache',
      };
      const crate = Models.get('crate');
      crate.position.set(cx, Level.heightAt(cx, cz), cz);
      crate.scale.setScalar(1.3);
      this.scene.add(crate);
      this.optional.mesh = crate;
      this.interactables.push(this.optional);
    }
  }

  buildRecovery() {
    const pen = this.level.objectivePoint;
    this.objective = {
      text: 'Release the held personnel', progress: 0, need: 3, done: false,
      type: 'recovery',
    };
    // Three held personnel. The third is the one worth caring about — a trained
    // medic — and the game says so out loud when they are released.
    const specs = [
      { role: 'rifleman', medic: false },
      { role: 'rifleman', medic: false },
      { role: 'medic', medic: true },
    ];
    specs.forEach((sp, i) => {
      const x = pen.x + (i - 1) * 2.0, z = pen.z - 1.2;
      const ent = this.spawnEntity({
        id: `p_${i}`, side: 'civil', faction: null, keepExact: true,
        x, z, yaw: 0, hp: 60, weapon: null, model: 'soldier_prisoner',
        // On a prison break the one worth caring about has a NAME.
        speed: 3.4, name: sp.medic && this.spec.rescueName
          ? this.spec.rescueName : 'Held personnel',
        follower: true,
      });
      ent.released = false;
      ent.isMedic = sp.medic;
      ent.roleId = sp.role;
      this.prisoners.push(ent);
      this.interactables.push({
        kind: 'prisoner', entity: ent, x: ent.x, z: ent.z, progress: 0, need: 1.6,
        label: 'Cut restraints',
      });
    });

    this.spawnGarrison(['rifleman', 'rifleman', 'breacher', 'marksman']);
  }

  /**
   * Populate a site from its own garrison posts and patrol routes, so every
   * mission template can be run at every location. Falls back to a ring around
   * the objective when a layout does not declare posts.
   */
  spawnGarrison(roles, extra = 0) {
    const meta = this.level;
    const posts = meta.garrison && meta.garrison.length ? meta.garrison : null;
    if (posts) {
      posts.forEach(([x, z]) => this.spawnEnemy(x, z, pick(this.r, roles)));
    } else {
      const o = meta.objectivePoint;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.spawnEnemy(o.x + Math.cos(a) * 8, o.z + Math.sin(a) * 8, pick(this.r, roles));
      }
    }
    for (const route of meta.patrols || []) {
      this.spawnEnemy(route[0][0], route[0][1], pick(this.r, roles),
        route.map(([x, z]) => ({ x, z })));
    }
    for (let i = 0; i < extra; i++) {
      const o = meta.objectivePoint;
      const a = this.r() * Math.PI * 2;
      const d = 10 + this.r() * 14;
      this.spawnEnemy(o.x + Math.cos(a) * d, o.z + Math.sin(a) * d, pick(this.r, roles));
    }
  }

  /**
   * A town on foot. No enemies, no clock, no extraction: the site the company
   * would otherwise fight over, walked as a place, with the services standing
   * where the layout put them. Holding E at an area doorway hands its id to
   * onArea, and the shell opens the matching panel over the paused walk;
   * leaving is the south gate, the same way you came in.
   */
  buildVisit() {
    this.objective = {
      text: `Walking ${this.level.name}`,
      sub: 'Speak with people to deal. The gate watch will see you out.',
      progress: 0, need: 1, done: false, type: 'visit',
    };
    const services = this.spec.services || [];
    // Every area is a PERSON, not a doorway. A hold-E marker floating over
    // bare street read as an objective from a fight; a named trader standing
    // at their own stall reads as a town. The interactable anchors to the
    // entity — the same mechanism cut-restraints uses — so the prompt is
    // "speak with somebody", and the somebody is visibly there.
    const WHO = {
      market: { name: 'The trader', label: 'Speak with the trader' },
      board: { name: 'The posting clerk', label: 'Read the board with the clerk' },
      recruit: { name: 'The hiring agent', label: 'Speak with the hiring agent' },
      medical: { name: 'The medic', label: 'Call on the medic' },
      favour: { name: this.spec.favourWho || 'A notable', label: 'Hear them out' },
    };
    let n = 0;
    for (const a of this.level.areas || []) {
      // Only areas the town actually staffs — and the notable only when
      // somebody is actually asking for the company.
      if (a.service && !services.includes(a.service)) continue;
      if (a.id === 'favour' && !this.spec.hasFavour) continue;
      const who = WHO[a.id] || { name: 'Somebody', label: 'Speak with them' };
      const npc = this.spawnEntity({
        id: `npc_${n++}`, side: 'civil', faction: null, x: a.x, z: a.z,
        // Facing the street, where the customers come from.
        yaw: Math.atan2(-a.x, -a.z) + Math.PI, hp: 40, weapon: null,
        model: 'soldier_prisoner', speed: 3.0, name: who.name,
      });
      npc.released = true;
      this.interactables.push({
        kind: 'area', area: a.id, entity: npc, x: npc.x, z: npc.z,
        progress: 0, need: 0.8, label: who.label,
      });
    }
    // A companion, when the rotation puts one here: a named hire drinking
    // near the market, with a story and a price. Meeting them is the walk's
    // own reward — they exist nowhere else.
    if (this.spec.companion) {
      const cnpc = this.spawnEntity({
        id: 'npc_comp', side: 'civil', faction: null,
        x: -2.5, z: -1, yaw: 2.4, hp: 60, weapon: null,
        model: 'soldier_prisoner', speed: 3.0, name: this.spec.companion.name,
      });
      cnpc.released = true;
      this.interactables.push({
        kind: 'area', area: 'companion', entity: cnpc, x: cnpc.x, z: cnpc.z,
        progress: 0, need: 0.8, label: 'Someone worth talking to',
      });
    }
    // A lord at court: the holder faction's commander taking petitions near
    // the hall. Talking to power is a walk across town, like everything else.
    if (this.spec.lord) {
      const lnpc = this.spawnEntity({
        id: 'npc_lord', side: 'civil', faction: null,
        x: 3.2, z: -14, yaw: 0.4, hp: 80, weapon: null,
        model: this.spec.lord.faction === 'trust' ? 'soldier_trust' : 'soldier_syndic',
        speed: 3.0, name: this.spec.lord.name,
      });
      lnpc.released = true;
      this.interactables.push({
        kind: 'area', area: 'lord', entity: lnpc, x: lnpc.x, z: lnpc.z,
        progress: 0, need: 0.8, label: 'A lord at court',
      });
    }

    // The way out is people too: a gate watch at the checkpoint.
    const gate = this.level.gate || this.level.objectivePoint;
    const watch = this.spawnEntity({
      id: 'npc_gate', side: 'civil', faction: null, x: gate.x, z: gate.z,
      yaw: Math.PI, hp: 40, weapon: null,
      model: 'soldier_prisoner', speed: 3.0, name: 'The gate watch',
    });
    watch.released = true;
    this.interactables.push({
      kind: 'leave', entity: watch, x: watch.x, z: watch.z,
      progress: 0, need: 0.8, label: 'Speak with the gate watch',
    });
    // Townsfolk, so the streets read as lived-in rather than evacuated. The
    // worker model, unbound; they stand where the day put them.
    const spots = [[-5, 3], [6, 1], [-11, -4], [10, -7], [2, 12], [-3, -9]];
    spots.forEach(([x, z], i) => {
      const e = this.spawnEntity({
        id: `tf_${i}`, side: 'civil', faction: null, x, z,
        yaw: this.r() * Math.PI * 2, hp: 40, weapon: null,
        model: 'soldier_prisoner', speed: 3.0, name: 'Townsfolk',
      });
      e.released = true;
      e.townsfolk = true;
    });
  }

  buildSabotage() {
    const p = this.level.objectivePoint;
    this.objective = {
      text: 'Place charges on the mast base', progress: 0, need: 4.5, done: false,
      type: 'sabotage',
    };
    this.interactables.push({
      kind: 'charge', x: p.x, z: p.z + 2.2, progress: 0, need: 4.5,
      label: 'Place charges',
    });
    this.chargeTimer = 0;
    this.chargesPlaced = false;

    this.spawnGarrison(['rifleman', 'rifleman', 'gunner', 'marksman'], 1);
  }

  /**
   * Road ambush. No installation, no timer — just the party that was on the
   * map a second ago, standing in the open ground you chose to drive into.
   * Its strength comes from the strategic party, so picking a fight with a
   * six-strong scrapper band is a genuinely worse idea than a three-strong one.
   */
  /**
   * Road engagement against a party from the map. The enemy count is the
   * party's actual strength, so a looter band is four rifles and an armoured
   * column is genuinely a battle. Very large parties commit in waves rather
   * than standing on the field all at once — both because that is how a
   * hundred-strong formation fights, and because it keeps the frame budget.
   */
  buildSkirmish() {
    const party = this.spec.party || {};
    // A party can be far larger than the field: that is what the waves are
    // FOR. This ceiling used to sit at 120 — which, once FIELD_CAP was
    // raised to 120 too, meant no party could ever exceed the field and the
    // streaming path quietly stopped being reachable.
    const total = clamp(party.strength || 4, 2, 400);
    const roles = this.doctrineRoles(PARTY_TIERS[party.kind]?.roles
      || ['rifleman', 'rifleman', 'breacher', 'marksman']);
    this.skirmishTotal = total;
    this.skirmishRemaining = total;
    this.enemyQuality = party.quality || 0.75;

    this.objective = {
      text: `Break the hostile party — ${total} hostile${total === 1 ? '' : 's'}`,
      progress: 0, need: total, done: false, type: 'skirmish',
    };

    const first = Math.min(total, FIELD_CAP);
    this.deployEnemyWave(first, roles, true);
    this.skirmishCommitted = first;

    this.spawnAllies();
  }

  /**
   * Whoever you sided with is on the field beside you — a battle joined in
   * progress, or a liege's column answered at its own siege. Same contract as
   * plant militia: they fight, they can die, they are nobody's payroll.
   */
  spawnAllies() {
    if (!this.spec.allies) return;
    // The whole allied force. Only a front rank stands on the field at once —
    // the rest are BEHIND you, and updateAlliedWaves() feeds them in as the
    // rank thins. This is how a column of two hundred fights through a field
    // cap of a few dozen: the battle is the army, the field is its front.
    this.alliesTotal = Math.round(this.spec.allies);
    const n = Math.min(16, this.alliesTotal);
    for (let i = 0; i < n; i++) this.spawnAllyAt(i);
    this.alliesCommitted = n;
  }

  spawnAllyAt(i) {
    const sp = this.level.playerSpawn;
    const ent = this.spawnEntity({
      id: `ally_`, side: 'player', faction: this.spec.allyFaction || 'syndic',
      x: sp.x - 8 + (i % 4) * 5, z: sp.z + 4 + Math.floor(i / 4) * 4,
      yaw: 0, hp: 80, weapon: i % 3 ? 'sword' : 'spear',
      model: this.spec.allyFaction === 'trust' ? 'soldier_trust' : 'soldier_syndic',
      acc: 0.46, speed: 4.0, aggression: 0.55, coverPref: 0.6,
      name: 'Allied fighter',
    });
    ent.militia = true;
    this.squad.push(ent);
    return ent;
  }

  /** Feed the rest of the allied force in as the front rank is destroyed. */
  updateAlliedWaves() {
    if (!this.alliesTotal) return;
    const left = this.alliesTotal - (this.alliesCommitted || 0);
    if (left <= 0) return;
    const alive = this.squad.filter((s) => s.militia && !s.dead && !s.down).length;
    if (alive >= 9) return;
    const n = Math.min(8, left);
    for (let i = 0; i < n; i++) {
      const e = this.spawnAllyAt(i);
      e.arriving = ARRIVE_GRACE;
    }
    this.alliesCommitted += n;
    Audio.uiSelect();
    this.onToast('THE COLUMN COMMITS MORE',
      `${this.alliesTotal - this.alliesCommitted} still behind you`, 'good');
  }

  /** Put a batch of hostiles on the field, arced across the approach. */
  deployEnemyWave(n, roles, initial = false) {
    // The next rank comes up the field in a LINE, from the far edge, the way
    // a reserve is actually committed. The old arc dropped them on a random
    // bearing at a random distance, which reads as men appearing out of the
    // air behind you — and the directive is explicit that reinforcements
    // arrive from the appropriate side, never in the middle of a fight.
    const bound = this.level.bounds || Level.BOUNDS;
    const back = initial ? Math.min(46, bound - 14) : Math.min(bound - 10, 78);
    const perRank = 10;
    for (let i = 0; i < n; i++) {
      const rank = Math.floor(i / perRank);
      const across = ((i % perRank) - (Math.min(perRank, n) - 1) / 2) * 2.8;
      const e = this.spawnEnemy(
        across + range(this.r, -1, 1),
        -back - rank * 3.4 + range(this.r, -1, 1),
        pick(this.r, roles));
      // Facing the fight from the moment they arrive, not milling about.
      e.yaw = 0;
      if (initial) { e.state = 'guard'; e.alert = 0.2; }
      else {
        e.state = 'hunt'; e.alert = 1;
        e.lastSeen = { x: this.player.x, z: this.player.z };
      }
    }
  }

  /**
   * Feed the rest of a large party in as the front rank is destroyed.
   *
   * Lairs use this too. They did not: buildLair caps its opening wave at the
   * field limit and relies on this to commit the remainder, but the guard here
   * named only 'skirmish' — so any hideout stronger than the cap put 34 of its
   * 54 defenders on the field, never sent the other twenty, and could never
   * reach its own kill target. The mission was unwinnable and the player had no
   * way to know why. Found by the campaign soak, which is the only thing that
   * plays a big enough hideout to hit it.
   */
  updateSkirmishWaves() {
    const t = this.spec.type;
    if (t !== 'skirmish' && t !== 'lair' && t !== 'siege' && !this.spec.defend) return;
    if (!this.skirmishTotal) return;
    const alive = this.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
    const left = this.skirmishTotal - (this.skirmishCommitted || 0);
    if (left > 0 && alive < Math.max(4, FIELD_CAP * 0.45)) {
      const n = Math.min(left, Math.round(FIELD_CAP * 0.5));
      const roles = this.doctrineRoles(PARTY_TIERS[this.spec.party?.kind]?.roles
        || ['rifleman', 'breacher', 'marksman']);
      if (this.spec.defend) {
        // A besieging army's next rank comes up the lanes, not out of thin
        // air beside the defenders.
        for (let i = 0; i < n; i++) this.spawnAssaulter();
      } else if (t === 'siege') {
        // Defenders muster INSIDE the walls. The arc spawner is for open
        // ground — it would stand a garrison's reserve on the attacker's own
        // approach, outside the thing they are defending.
        for (let i = 0; i < n; i++) {
          const e = this.reinforce(range(this.r, -18, 18), range(this.r, -46, -24),
            pick(this.r, roles), 0);
          e.state = 'guard';
          e.alert = 0.6;
        }
      } else {
        this.deployEnemyWave(n, roles, false);
      }
      this.skirmishCommitted += n;
      Audio.uiAlert();
      this.onToast('THEY ARE COMMITTING MORE',
        `${this.skirmishTotal - this.skirmishCommitted + n} still on the field`, 'bad');
    }
  }

  /**
   * Seizure. Break the garrison, then stand on the ground long enough to own
   * it. The hold phase is the whole point: clearing the position is not the
   * same as keeping it, and the garrison sends a counter-attack while you wait.
   */
  /**
   * The Titan fight. One walker, a handful of escorts to stop the squad simply
   * standing still, and an objective that is only satisfied by taking the
   * machine apart.
   */
  buildTitan() {
    this.objective = {
      text: 'Break the walker — strip its armour, then hit the cores',
      progress: 0, need: 6, done: false, type: 'titan',
    };
    const o = this.level.objectivePoint;
    this.spawnTitan(o.x, o.z - 6);
    // A small screen of infantry. Not a threat next to the walker, but enough
    // that the squad cannot simply park and shoot.
    this.spawnGarrison(['rifleman', 'rifleman', 'marksman'], 0);
    this.level.extraction = { ...this.level.playerSpawn };
  }

  updateTitanObjective() {
    const e = this.titan;
    if (!e) return;
    // Progress is armour stripped, which is the thing the player is actually
    // doing — a health bar on a machine this size reads as no progress at all
    // for the first minute.
    this.objective.progress = e.plates.length - e.platesLeft;
    this.objective.need = e.plates.length;
    if (e.dead && !this.objective.done) {
      this.completeObjective();
    }
  }

  /**
   * A raid.
   *
   * The one thing the standing system was missing was a reason to spend it.
   * Everything else you can do at a settlement builds the relationship; this
   * burns it, deliberately and profitably. You break open three stores, carry
   * out what you can, and leave — and the place never forgets it.
   *
   * Mechanically it is the inverse of a recovery: instead of walking somebody
   * slowly OUT past a garrison that wakes up behind you, you are carrying
   * their goods.
   */
  /**
   * A hideout. Everyone who lives here is here, all at once, and there are
   * only a handful of you — so this is the one deployment where the field cap
   * is the point rather than a performance concession.
   */
  /**
   * The pit.
   *
   * Wages come out every day from day one, and the only answers to that were a
   * contract or a fight on the road — both of which can cost you a soldier you
   * cannot replace. The pit is the answer that costs nothing but time and
   * pride: you go in alone, nobody dies, and you are paid by the round.
   *
   * It is deliberately the only place in the game where losing is survivable
   * by construction rather than by luck. That is what makes it the thing a
   * broke company does on a bad week.
   */
  /**
   * A siege.
   *
   * Two phases, and the first one is the point. Until the gate is down the wall
   * is impassable and the defenders on it have a free shot at everyone crossing
   * the approach — so the opening is a problem of covering fire and timing
   * rather than aim. Once it is open the fight becomes an ordinary, very
   * dangerous, room-by-room clearance.
   *
   * The charge takes long enough that somebody has to be holding the wall's
   * attention while it is set. That is the whole design.
   */
  buildSiege() {
    this.objective = {
      text: 'Breach the gate', progress: 0, need: 2, done: false, type: 'siege',
    };
    this.breached = false;

    // The charge goes on the gate, which the layout puts on the wall line.
    const gate = this.level.obstacles.find((o) => (o.coverH ?? o.h) > 5.5 && Math.abs(o.x) < 6)
      || { x: 0, z: -14 };
    this.gateObstacle = gate;
    this.interactables.push({
      kind: 'breach', x: gate.x, z: gate.z + 2.6, progress: 0, need: 6.5,
      label: 'Set the charge',
    });

    // The second way in, where the layout offers one: a grated culvert
    // under the east curtain. Faster to set than the gate charge, but it
    // spills the company into a tight alley deep in the defence — a CHOICE
    // of breach, which is what makes an assault a plan instead of a script.
    if (this.level.culvert) {
      const cv = this.level.culvert;
      // The NEAREST tall obstacle to the authored point, not the first in
      // placement order — the narrowing containers sit within a few metres
      // of the grate and a loose match blew one of those up instead.
      let grate = null, gd = Infinity;
      for (const o of this.level.obstacles) {
        const d = Math.hypot(o.x - cv.x, o.z - cv.z);
        if (d < 3 && (o.coverH ?? o.h) > 2 && d < gd) { gd = d; grate = o; }
      }
      if (grate) {
        this.culvertObstacle = grate;
        this.interactables.push({
          kind: 'breach', culvert: true, x: cv.x, z: cv.z + 2.6,
          progress: 0, need: 4.5, label: 'Blow the culvert grate',
        });
      }
    }

    this.spawnGarrison(['rifleman', 'rifleman', 'marksman', 'gunner'], 2);
    // A defended TOWN is not a fort picket: when the spec names an army, the
    // wall posts are only its front rank and the rest muster inside as the
    // fight eats them — same streaming contract as a large skirmish.
    if (this.spec.enemyArmy) {
      const committed = this.entities.filter((e) => e.side === 'enemy').length;
      this.skirmishTotal = Math.max(Math.round(this.spec.enemyArmy), committed);
      this.skirmishCommitted = committed;
    }
    // Answering a summons means storming the wall WITH the column, not for
    // it — the liege's troops cross the approach beside you.
    this.spawnAllies();
    // You leave the way you came in, once it is yours.
    this.level.extraction = { ...this.level.playerSpawn };
  }

  /** Take the gate out of the world, and let everybody know. */
  blowGate() {
    if (this.breached) return;
    this.breached = true;
    const g = this.gateObstacle;
    if (g) {
      // The wall stops being a wall exactly where the gate was.
      this.level.obstacles = this.level.obstacles.filter((o) => o !== g);
      // And the navigation grid has to learn that, or the squad keeps routing
      // the long way round a hole they can walk through.
      this.nav = new NavGrid(this.level.obstacles, this.level.bounds, 0.65);
      const doors = this.level.group.children.filter((o) =>
        Math.abs(o.position.x - g.x) < 4.2 && Math.abs(o.position.z - g.z) < 3);
      for (const d of doors) d.visible = false;
    }
    this.objective.progress = 1;
    this.objective.text = 'Take the compound';
    Audio.explosion(this.relPos(this.player));
    this.shake = 1.3;
    this.onToast('GATE DOWN', 'Go, before they close the gap', 'good');
    // Everyone inside now knows precisely where you are coming from.
    for (const e of this.entities) {
      if (e.side === 'enemy' && !e.dead) {
        e.alert = 1;
        e.state = 'hunt';
        e.lastSeen = { x: g ? g.x : 0, z: g ? g.z : -14 };
        e.huntUntil = this.time + 20;
      }
    }
    this.spawnReinforcements(3);
  }

  /** The culvert goes instead of the gate: same phase change, tighter door. */
  blowCulvert(it) {
    if (this.breached) return;
    this.breached = true;
    const g = this.culvertObstacle;
    if (g) {
      this.level.obstacles = this.level.obstacles.filter((o) => o !== g);
      this.nav = new NavGrid(this.level.obstacles, this.level.bounds, 0.65);
      const doors = this.level.group.children.filter((o) =>
        Math.abs(o.position.x - g.x) < 4.2 && Math.abs(o.position.z - g.z) < 3);
      for (const d of doors) d.visible = false;
    }
    this.objective.progress = 1;
    this.objective.text = 'Take the compound';
    Audio.explosion(this.relPos(this.player));
    this.shake = 1.1;
    this.onToast('GRATE OUT', 'Through the culvert — single file, move', 'good');
    for (const e of this.entities) {
      if (e.side === 'enemy' && !e.dead) {
        e.alert = 1;
        e.state = 'hunt';
        e.lastSeen = { x: it.x, z: it.z };
        e.huntUntil = this.time + 20;
      }
    }
    this.spawnReinforcements(3);
  }

  updateSiege(dt) {
    if (!this.breached) return;
    // Phase two: the compound is yours when nobody is left holding it — the
    // whole army, not just the rank on the field. An army siege that ended
    // when the front rank fell would declare victory with 150 defenders still
    // mustering behind the habs.
    const uncommitted = Math.max(0, (this.skirmishTotal || 0) - (this.skirmishCommitted || 0));
    const left = this.entities.filter((e) => e.side === 'enemy' && !e.dead).length
      + uncommitted;
    this.objective.progress = left === 0 ? 2 : 1;
    if (left === 0 && !this.objective.done) {
      this.completeObjective();
      this.onToast('COMPOUND TAKEN', 'It is yours', 'good');
    } else if (left > 0) {
      this.guardAgainstStall(dt);
    }
  }

  buildPit() {
    this.pitRound = 0;
    this.pitBest = 0;
    this.objective = {
      text: 'Last as long as you can', progress: 0, need: 8, done: false, type: 'pit',
    };
    // No squad in the pit. Anyone who came is in the crowd.
    for (const s of this.squad) {
      s.dead = true;
      s.char.group.visible = false;
    }
    this.squad = [];
    this.level.extraction = { ...this.level.playerSpawn };
    this.nextPitWave(true);
  }

  /** Put the next fighter, or fighters, in with you. */
  nextPitWave(first = false) {
    this.pitRound = (this.pitRound || 0) + 1;
    this.objective.progress = this.pitRound - 1;
    // One opponent, then two, then three — and they get better as they come.
    const n = Math.min(3, 1 + Math.floor((this.pitRound - 1) / 3));
    const o = this.level.objectivePoint;
    const roles = ['rifleman', 'breacher', 'marksman', 'gunner'];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.r();
      // The pit is a ring, so there is nowhere out of sight to come from — but
      // the next fighter still walks in from the far side rather than appearing
      // at your shoulder.
      const e = this.reinforce(
        o.x + Math.cos(a) * 16, o.z + Math.sin(a) * 16, pick(this.r, roles), 17);
      // The crowd wants a fight, so the ones later on are genuinely better.
      e.acc = Math.min(0.93, e.acc * (1 + (this.pitRound - 1) * 0.13));
      e.hp = Math.round(e.hp * (1 + (this.pitRound - 1) * 0.10));
      e.maxHp = e.hp;
      e.pitFighter = true;
    }
    if (!first) {
      this.onToast(`ROUND ${this.pitRound}`, n > 1 ? `${n} of them` : 'One more', 'deploy');
    }
  }

  updatePit(dt) {
    if (this.objective.done) return;
    const left = this.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
    if (left === 0) {
      this.pitBest = this.pitRound;
      if (this.pitRound >= this.objective.need) {
        this.objective.progress = this.pitRound;
        this.completeObjective();
        this.onToast('THE PIT IS YOURS', 'Nobody left to put in with you', 'good');
        return;
      }
      // A breath between rounds, and the crowd gets louder.
      this.pitRest = (this.pitRest || 0) - dt;
      if (this.pitRest <= 0) {
        this.pitRest = 4;
        this.nextPitWave();
      }
    }
  }

  buildLair() {
    const party = this.spec.party || {};
    const total = party.strength || 18;
    this.objective = {
      text: `Clear the hideout — ${total} of them`,
      progress: 0, need: total, done: false, type: 'lair',
    };
    this.skirmishTotal = total;
    this.skirmishRemaining = total;
    this.enemyQuality = party.quality || 0.8;
    const roles = ['rifleman', 'breacher', 'marksman', 'gunner'];
    const first = Math.min(total, FIELD_CAP);
    this.deployEnemyWave(first, roles, true);
    this.skirmishCommitted = first;
    // You leave the way you came in; there is no other way out of a gully.
    this.level.extraction = { ...this.level.playerSpawn };
  }

  buildRaid() {
    this.objective = {
      text: 'Break open their stores and get clear', progress: 0, need: 3,
      done: false, type: 'raid',
    };
    const o = this.level.objectivePoint;
    this.raidTaken = 0;
    // Three stores, spread around the objective so the raid is a circuit
    // rather than one stop.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + this.r() * 0.7;
      const d = 12 + this.r() * 10;
      // Snapped to open ground: a store rolled into the middle of a hab block
      // is a raid that can never be completed, and the town is a lot denser
      // than it was.
      const safe = this.safeSpawn(
        clamp(o.x + Math.cos(a) * d, -this.level.bounds + 8, this.level.bounds - 8),
        clamp(o.z + Math.sin(a) * d, -this.level.bounds + 8, this.level.bounds - 8));
      const cx = safe.x, cz = safe.z;
      const it = {
        kind: 'loot', x: cx, z: cz, taken: false, progress: 0, need: 2.6,
        label: 'Break it open',
      };
      const crate = Models.get('crate');
      crate.position.set(cx, Level.heightAt(cx, cz), cz);
      crate.scale.setScalar(1.5);
      this.scene.add(crate);
      it.mesh = crate;
      this.interactables.push(it);
    }
    // Everybody who lives here turns out, and keeps turning out.
    this.spawnGarrison(['rifleman', 'rifleman', 'breacher', 'marksman'], 3);
    this.level.extraction = { ...this.level.playerSpawn };
  }

  updateRaid() {
    this.objective.progress = this.raidTaken || 0;
    if (!this.objective.done && (this.raidTaken || 0) >= this.objective.need) {
      this.completeObjective();
      this.onToast('STORES EMPTIED', 'Get back to the truck', 'good');
    }
  }

  buildSeize() {
    this.objective = {
      text: 'Take and hold the position', progress: 0, need: 100, done: false,
      type: 'seize',
    };
    // Holding is meant to be the tense part, not the boring part. Thirty
    // seconds of standing on an empty position after the last defender is
    // already dead is dead air, so the clock RUNS FASTER the less there is
    // left to contest it — see updateSeize.
    this.holdSeconds = 30;
    this.holdProgress = 0;
    this.counterSent = false;
    this.spawnGarrison(['rifleman', 'rifleman', 'breacher', 'gunner', 'marksman'], 2);
    // Extraction is the objective itself — you leave by having held it.
    this.level.extraction = { ...this.level.objectivePoint };
  }

  updateSeize(dt) {
    const p = this.player;
    const o = this.level.objectivePoint;
    const inZone = Math.hypot(p.x - o.x, p.z - o.z) < 12;
    const contested = this.entities.some((e) => e.side === 'enemy' && !e.dead
      && Math.hypot(e.x - o.x, e.z - o.z) < 20);

    if (inZone && !contested) {
      // Once the garrison is broken there is nothing to hold against, so the
      // position consolidates quickly. While hostiles are still alive somewhere
      // on the site it stays slow, because then the wait is the mission.
      const left = this.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
      const rate = left === 0 ? 6 : (left <= 2 ? 2.5 : 1);
      this.holdProgress = Math.min(this.holdSeconds, this.holdProgress + dt * rate);
    } else if (contested && inZone) {
      // Being contested does not lose ground already held, it just stops it.
      this.holdProgress = Math.max(0, this.holdProgress - dt * 0.2);
    } else {
      this.holdProgress = Math.max(0, this.holdProgress - dt * 0.5);
    }
    this.objective.progress = Math.round((this.holdProgress / this.holdSeconds) * 100);

    // One counter-attack partway through, so holding is not just waiting.
    // The counter-attack has to arrive while there is still hold left to run,
    // otherwise a fast consolidation finishes the mission before they show up.
    if (!this.counterSent && this.holdProgress > this.holdSeconds * 0.25) {
      this.counterSent = true;
      this.spawnReinforcements(4);
      Audio.uiAlert();
      this.onToast('COUNTER-ATTACK', 'They are coming back for it', 'bad');
    }

    if (this.holdProgress >= this.holdSeconds && !this.objective.done) {
      this.completeObjective();
      this.onToast('POSITION TAKEN', `${this.level.name} is yours`, 'good');
      this.endMission(true, 'seized');
    }
  }

  /**
   * The other side of the wall: HOLDING the bastion while a host assaults
   * it. The player and the garrison start INSIDE; the attacker's army
   * streams up the lanes through the field cap; the gate holds until their
   * sappers blow it, and then the streets are the battle. Won by breaking
   * the whole assault — every rank, not just the one on the field.
   */
  buildSiegeDefense() {
    const army = Math.max(20, Math.round(this.spec.enemyArmy || 60));
    this.objective = {
      text: 'Hold the bastion — break the assault',
      progress: 0, need: army, done: false, type: 'siegehold',
    };
    // The defenders' ground. The player entity already stands at the
    // attacker-side spawn the layout authored, so the whole command moves
    // inside the wall — and playerSpawn moves with them, because that is
    // where allied ranks arrive.
    const inSpawn = { x: 0, z: -34 };
    this.level.playerSpawn = { ...inSpawn, ry: 0 };
    this.level.extraction = { ...inSpawn };
    this.player.x = inSpawn.x;
    this.player.z = inSpawn.z;
    this.player.yaw = 0;                    // facing the gate
    this.squad.forEach((s, i) => {
      s.x = inSpawn.x - 7 + (i % 5) * 3.2;
      s.z = inSpawn.z - 5 - Math.floor(i / 5) * 3;
    });
    this.spawnAllies();

    // The sappers: the gate holds long enough to walk the wall and place
    // people, and not a breath longer than the roll says.
    this.breached = false;
    this.gateObstacle = this.level.obstacles.find(
      (o) => (o.coverH ?? o.h) > 5.5 && Math.abs(o.x) < 6) || null;
    this.gateBlowAt = 35 + this.r() * 25;

    // The first assault rank, coming up the lanes from the south edge.
    this.skirmishTotal = army;
    const first = Math.min(Math.round(FIELD_CAP * 0.7), army);
    for (let i = 0; i < first; i++) this.spawnAssaulter();
    this.skirmishCommitted = first;
  }

  /** One attacker, entering from the south lanes and heading for the wall. */
  spawnAssaulter() {
    const e = this.reinforce(range(this.r, -44, 44), range(this.r, 54, 72),
      pick(this.r, ['rifleman', 'rifleman', 'breacher', 'gunner']), 0);
    e.state = 'hunt';
    e.alert = 1;
    // Until the breach they press the wall; after it they pour at the keep.
    e.lastSeen = this.breached ? { x: 0, z: -30 } : { x: 0, z: -4 };
    return e;
  }

  updateSiegeHold(dt) {
    if (this.objective.done || this.over) return;
    // The sappers finish: the gate stops being a gate. The physical half
    // mirrors blowGate() — that method narrates the ATTACKER'S breach, and
    // this one is the sound you never wanted to hear from inside.
    if (!this.breached && this.time > this.gateBlowAt) {
      this.breached = true;
      const g = this.gateObstacle;
      if (g) {
        this.level.obstacles = this.level.obstacles.filter((o) => o !== g);
        this.nav = new NavGrid(this.level.obstacles, this.level.bounds, 0.65);
        const doors = this.level.group.children.filter((o) =>
          Math.abs(o.position.x - g.x) < 4.2 && Math.abs(o.position.z - g.z) < 3);
        for (const d of doors) d.visible = false;
      }
      Audio.explosion(this.relPos(this.player));
      this.shake = 1.3;
      this.onToast('THE GATE IS DOWN', 'They are coming through', 'bad');
      for (const e of this.entities) {
        if (e.side === 'enemy' && !e.dead) {
          e.lastSeen = { x: this.player.x, z: this.player.z };
          e.huntUntil = this.time + 30;
        }
      }
    }
    const alive = this.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
    this.objective.progress = this.entities.filter(
      (e) => e.side === 'enemy' && e.dead).length;
    this.updateSkirmishWaves();
    if (alive === 0 && this.skirmishCommitted >= this.skirmishTotal) {
      this.completeObjective();
      this.onToast('THE ASSAULT IS BROKEN', 'The bastion holds', 'good');
      this.endMission(true, 'held');
    } else if (alive > 0) {
      this.guardAgainstStall(dt);
    }
  }

  buildDefense() {
    this.objective = {
      text: 'Hold the reclaimer until the attack breaks', progress: 0, need: 3, done: false,
      type: 'defense',
    };
    this.wave = 0;
    // Long enough to walk the position, place the squad and pick firing points
    // before anything appears on the road.
    this.waveTimer = 20;
    this.waveActive = false;
    this.holdPoint = { ...this.level.objectivePoint, radius: 22 };

    // Two friendly locals, armed, who fight alongside the player. They are not
    // roster personnel — losing them costs nothing but is still felt.
    const hp = this.level.objectivePoint;
    // Defence Works at a holding you own put more locals on the line.
    const works = this.S.holdings?.[this.spec.site]?.upgrades?.works || 0;
    const militiaCount = 2 + works * 2;
    for (let i = 0; i < militiaCount; i++) {
      const x = hp.x - 6 + (i % 4) * 4, z = hp.z - 6 - Math.floor(i / 4) * 3;
      const ent = this.spawnEntity({
        id: `m_${i}`, side: 'player', faction: 'syndic',
        x, z, yaw: 0, hp: 70, weapon: 'smg', model: 'soldier_syndic',
        acc: 0.42, speed: 3.9, aggression: 0.4, coverPref: 0.6,
        name: 'Plant militia',
      });
      ent.militia = true;
      this.squad.push(ent);
    }
  }

  // ======================================================================
  // Command wheel
  // ======================================================================
  //
  // Six keys the player has to memorise is not a command system, it is a
  // quiz — and in a firefight nobody passes it. The wheel puts every order in
  // one place, under one thumb, with the world running slow enough to think.
  //
  // Two things make it usable rather than decorative. It captures the aim point
  // at the MOMENT IT OPENS, so the order lands where you were looking when you
  // decided to give it, not wherever the mouse drifted while choosing. And it
  // dilates time instead of pausing, so the fight stays live and choosing still
  // costs you something.

  get ORDERS() {
    return [
      { id: 'move', name: 'MOVE / ATTACK', key: '',
        desc: 'Aimed at a body: focus fire. Aimed at ground: move up and spread.' },
      { id: 'suppress', name: 'SUPPRESS', key: 'X',
        desc: 'Pour fire into that position. Pins whoever is behind it.' },
      { id: 'charge', name: 'CHARGE', key: 'R',
        desc: 'Run them down. No cover, no stopping, until nothing stands.' },
      { id: 'flank', name: 'FLANK', key: 'Z',
        desc: 'Swing wide and come at it from a different angle than you are.' },
      { id: 'fallback', name: 'FALL BACK', key: 'V',
        desc: 'Break contact and pull in behind you.' },
      { id: 'hold', name: 'HOLD', key: 'H',
        desc: 'Stop here and hold this ground.' },
      // TAKE COVER is gone. It was the last ordered verb that only made
      // sense with a gun in your hands — a line that goes to ground behind
      // a wall is a line that is not holding its frontage, and the whole
      // overhaul is about the frontage. Soldiers still USE cover to break
      // a bowman's sightline; they are simply no longer ordered to hide
      // behind it. (The G key now stands the arms' shapes back to line.)
      { id: 'wall', name: 'SHIELD WALL', key: 'G',
        desc: 'Close the ranks of whichever arm you have selected.' },
      { id: 'follow', name: 'FORM UP', key: 'F',
        desc: 'Back on me, in whatever shape you last called.' },
      { id: 'battle', name: 'BATTLE LINE', key: '',
        desc: 'Infantry forward, spears behind them, ranged at the back.' },
      { id: 'line', name: 'LINE', key: '',
        desc: 'Abreast of you. Every gun forward, wide frontage.' },
      { id: 'spread', name: 'SPREAD', key: '',
        desc: 'Wide intervals. One burst cannot take three of you.' },
      { id: 'wedge', name: 'WEDGE', key: '',
        desc: 'Compact behind you. The shape that moves best.' },
    ];
  }

  openWheel() {
    if (this.wheel?.open || this.over || this.paused || this.intro?.active) return;
    // Freeze the aim now. Choosing an order takes a second or two and the
    // reticle will wander in that time; the order must mean what the player
    // meant when they reached for it.
    const aim = this.aimPoint(140);
    this.wheel = {
      open: true,
      aim,
      dx: 0, dz: 0,
      index: -1,
    };
    // Pressing the wheel open while looking at somebody IS the order.
    if (aim.entity && aim.entity.side === 'enemy' && !aim.entity.dead) {
      this.markTarget(aim.entity);
      this.wheel.marked = true;
    } else {
      Audio.uiMove();
    }
    this.onWheel?.(this.wheelState());
  }

  /** Mouse motion while the wheel is up steers the selection, not the camera. */
  steerWheel(mx, my) {
    const w = this.wheel;
    if (!w?.open) return;
    w.dx = clamp(w.dx + mx * 0.55, -150, 150);
    w.dz = clamp(w.dz + my * 0.55, -150, 150);
    const len = Math.hypot(w.dx, w.dz);
    // A dead zone in the middle means "no order" — releasing without choosing
    // has to be free, or the wheel becomes a trap.
    if (len < 26) { if (w.index !== -1) { w.index = -1; this.onWheel?.(this.wheelState()); } return; }
    const n = this.ORDERS.length;
    // Straight up is index 0, going clockwise.
    const a = Math.atan2(w.dx, -w.dz);
    const idx = ((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n;
    if (idx !== w.index) { w.index = idx; Audio.uiMove(); }
    this.onWheel?.(this.wheelState());
  }

  closeWheel(issue = true) {
    const w = this.wheel;
    if (!w?.open) return;
    this.wheel = null;
    this.onWheel?.(null);
    // If opening the wheel already issued a focus-fire order, releasing without
    // picking anything is a confirmation, not a cancellation.
    if (!issue || w.index < 0) { if (!w.marked) Audio.uiDeny(); return; }
    this.issueOrder(this.ORDERS[w.index].id, w.aim);
  }

  wheelState() {
    const w = this.wheel;
    if (!w?.open) return null;
    return {
      orders: this.ORDERS,
      index: w.index,
      who: this.selectionLabel(),
      count: this.commanded().length,
    };
  }

  /**
   * Change the shape the squad holds. Formation is separate from the order:
   * you can be spread out and suppressing, or in line and falling back.
   */
  setFormation(id) {
    const f = FORMATIONS[id];
    if (!f) return;
    this.formation = id;
    // Formation only means anything if they are actually forming on you.
    for (const s of this.squad) {
      if (s.order !== 'follow') { s.order = 'follow'; s.orderPoint = null; }
    }
    this.squadOrder = 'follow';
    Audio.order();
    this.onToast('FORMATION', `${f.name} — ${f.desc}`, 'order');
  }

  /** One entry point for every order, whatever issued it. */
  issueOrder(id, aim = null) {
    if (FORMATIONS[id]) { this.setFormation(id); return; }
    if (id === 'move') this.issueContextOrder(aim);
    else if (id === 'suppress') this.orderSuppress(aim);
    else if (id === 'flank') this.orderFlank(aim);
    else if (id === 'fallback') this.orderFallBack();
    else if (id === 'wall') this.orderShieldWall();
    else this.setSquadOrder(id);
  }

  // ======================================================================
  // Input
  // ======================================================================

  bindInput() {
    const el = this.renderer.domElement;
    const add = (t, ev, fn, opts) => {
      t.addEventListener(ev, fn, opts);
      this._boundHandlers.push([t, ev, fn]);
    };

    add(window, 'keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'r' && !this.player?.weapon?.melee) this.tryReload(this.player);
      if (k === 'e') this.interactStart = true;
      // Q swaps shoulders behind a gun; with steel in hand it is the boot —
      // the can-opener that breaks a guard at contact range. In the
      // tactical view Q/E rotate the board instead.
      if (k === 'q' && !this.rts) {
        if (this.player?.weapon?.melee) this.kick(this.player);
        else this.swapShoulder();
      }
      // One context button, the way a cover shooter does it: it takes cover if
      // there is cover, leaves it if you are in it, and vaults otherwise. A
      // separate key for each would be three things to remember in a firefight.
      // In the tactical view Space belongs to the camera: snap to the
      // selection, follow while held — read per-frame like the rotation.
      if (k === ' ' && !this.rts) {
        if (this.cover) this.leaveCover();
        else if (!this.takeCover()) this.tryJump();
      }
      // B: jump the tactical eye to wherever the fighting last was.
      if (k === 'b' && this.rts) this.jumpToCombat();
      if (k === 'c') this.crouchHeld = !this.crouchHeld;
      if (k === 'control') this.crouchHeld = true;
      if (k === 't') this.toggleTactical();
      if (k === 'f') this.setSquadOrder('follow');
      if (k === 'h') this.setSquadOrder('hold');
      if (k === 'x') {
        // On a pure ranged selection X is fire discipline; anywhere else it
        // keeps its gun-era meaning while guns remain in the world.
        const sel = this.commanded();
        if (sel.length && sel.every((s) => this.battleGroup(s) === 'ranged'
          && (s.weapon?.bow || s.bowStowed))) this.toggleHoldFire(sel);
        else this.orderSuppress();
      }
      if (k === 'z') this.orderFlank();
      if (k === 'v') this.orderFallBack();
      if (k === 'g') this.orderShieldWall();
      // Individual selection — and control groups. Ctrl+digit binds the
      // current selection to the digit; in tactical mode the bare digit
      // recalls the group. In the shoulder view digits keep their original
      // meaning (toggle one squaddie), because that is muscle memory now.
      if (k >= '1' && k <= '5') {
        if (e.ctrlKey) { e.preventDefault(); this.assignGroup(Number(k)); }
        else if (this.rts && this.ctrlGroups[Number(k)]) this.recallGroup(Number(k));
        else this.toggleSelect(Number(k) - 1);
      }
      // The arms of the line, one key each: ALL / INFANTRY / SPEARS /
      // RANGED. Fast enough to use mid-swing, which is the entire point.
      if (k === '6') this.selectGroup('all');
      if (k === '7') this.selectGroup('inf');
      if (k === '8') this.selectGroup('spear');
      if (k === '9') this.selectGroup('ranged');
      // Cycle the selected arm's shape: line, wall, loose.
      if (k === 'n') this.cycleGroupShape();
      if (k === '`' || k === '0') this.selectAll();
      if (k === 'escape') this.togglePause();
      if (k === 'tab') { e.preventDefault(); this.showRoster = true; }
      if ([' ', 'w', 'a', 's', 'd'].includes(k)) e.preventDefault();
    });
    add(window, 'keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'e') this.interactStart = false;
      // Ctrl is hold-to-crouch; C toggles. Releasing Ctrl only stands you up if
      // you were not also toggled down.
      if (k === 'control') this.crouchHeld = false;
      if (k === 'tab') this.showRoster = false;
    });

    add(el, 'mousedown', (e) => {
      if (this.rts) {
        if (e.button === 0) this.rtsDrag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
        if (e.button === 2) this.rtsOrderAt(e.clientX, e.clientY);
        return;
      }
      if (document.pointerLockElement !== el) { el.requestPointerLock(); return; }
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 1) { e.preventDefault(); this.openWheel(); }
      if (e.button === 2) this.mouse.right = true;
    });
    add(window, 'mouseup', (e) => {
      if (this.rts) {
        if (e.button === 0 && this.rtsDrag) this.rtsFinishSelect();
        return;
      }
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 1) this.closeWheel(true);
      if (e.button === 2) this.mouse.right = false;
    });
    // Zoom belongs to the tactical view; the shoulder view has no use for the
    // wheel and Chrome would scroll the page.
    add(el, 'wheel', (e) => {
      e.preventDefault();
      const dir = Math.sign(e.deltaY);
      if (!this.rts) {
        // ONE CONTINUOUS EYE. Rolling out over the shoulder pulls you up
        // into command; rolling back in puts you down in the line. The
        // toggle key still works — this is the same move without having to
        // remember a letter, and it means the two cameras read as two ends
        // of one motion rather than two modes.
        if (dir > 0) {
          this.wheelOut = (this.wheelOut || 0) + 1;
          if (this.wheelOut >= 2) { this.wheelOut = 0; this.toggleTactical(); }
        } else {
          this.wheelOut = 0;
        }
        return;
      }
      this.wheelOut = 0;
      // Rolling in past the closest tactical height drops you back into the
      // body you are commanding.
      const cur = this.rtsZoomT ?? this.rtsZoom;
      if (dir < 0 && cur <= 24.5) { this.toggleTactical(); return; }
      // The wheel sets a TARGET; the camera glides to it per-frame.
      this.rtsZoomT = clamp(cur + dir * 7, 22, 78);
    });
    // The field map takes clicks in tactical mode: the eye goes where you
    // point. Bound here rather than in the UI layer because the click is an
    // input to the mission's camera, not a rendering concern.
    const radar = document.getElementById('radar');
    if (radar) {
      add(radar, 'mousedown', (e) => {
        if (!this.rts) return;
        e.preventDefault();
        e.stopPropagation();
        const r = radar.getBoundingClientRect();
        this.rtsMapClick(
          (e.clientX - r.left) / r.width * radar.width,
          (e.clientY - r.top) / r.height * radar.height,
        );
      });
    }
    // Chrome scrolls on middle-click without this, and a scrolling page under a
    // pointer-locked game is not something the player can undo.
    add(el, 'auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    add(el, 'contextmenu', (e) => e.preventDefault());
    add(document, 'mousemove', (e) => {
      if (this.rts) {
        this.rtsCursor = { x: e.clientX, y: e.clientY };
        // Edge-pan only engages once the mouse has really moved in this mode
        // — the cursor's stale (0,0) default reads as "parked in the corner"
        // and quietly drives the camera off the battle.
        this.rtsCursorLive = true;
        if (this.rtsDrag) { this.rtsDrag.x1 = e.clientX; this.rtsDrag.y1 = e.clientY; }
        this.rtsDrawBox();
        return;
      }
      if (document.pointerLockElement !== el) return;
      if (this.wheel?.open) { this.steerWheel(e.movementX, e.movementY); return; }
      // A decaying record of recent hand motion: the direction a swing is
      // thrown comes from how the hand was moving when it was thrown.
      this.mouseVel.x = this.mouseVel.x * 0.7 + e.movementX;
      this.mouseVel.y = this.mouseVel.y * 0.7 + e.movementY;
      const s = 0.0022 * (this.mouse.right ? 0.55 : 1);
      this.camYaw -= e.movementX * s;
      // A positive pitch raises the camera above the look target, i.e. looks
      // DOWN — so moving the mouse down has to increase it, not decrease it.
      this.camPitch = clamp(this.camPitch + e.movementY * s, -0.62, 0.72);
    });
    add(document, 'pointerlockchange', () => {
      if (document.pointerLockElement === el) { this.hadLock = true; return; }
      // Only auto-pause when a lock we actually held is lost. Pausing on any
      // "not locked" state meant a browser that never granted the lock froze
      // the deployment on the first frame with no explanation. The tactical
      // camera releases the lock ON PURPOSE — that is not a pause.
      if (this.hadLock && !this.over && !this.rts) this.paused = true;
    });
    this.canvasEl = el;
  }

  requestLock() {
    if (this.canvasEl && document.pointerLockElement !== this.canvasEl) {
      this.canvasEl.requestPointerLock?.();
    }
  }

  // ======================================================================
  // Tactical camera
  // ======================================================================

  toggleTactical() {
    if (this.over || this.intro?.active) return;
    // The pit has no squad to command, and the crowd does not take orders.
    if (this.spec.type === 'pit') return;
    this.rts = !this.rts;
    if (this.rts) {
      this.rtsFocus = { x: this.player.x, z: this.player.z };
      this.rtsYaw = this.camYaw;
      this.rtsCursorLive = false;
      this.rtsVel = { x: 0, z: 0 };
      // Come up from just above the shoulder rather than snapping to
      // wherever the eye was last time — the wheel is meant to feel like
      // one continuous rise out of the line, and the glide does the rest.
      this.rtsZoom = 26;
      this.rtsZoomT = 44;
      this.mouse.down = false;
      this.mouse.right = false;
      if (document.pointerLockElement) document.exitPointerLock();
      this.onToast('TACTICAL', 'Wheel in to rejoin the line · drag selects · right-click orders', 'order');
    } else {
      this.rtsDrag = null;
      this.rtsDrawBox();
      this.rtsSyncRoutes();   // rts is false now: this tears the lines down
      this.requestLock();
    }
  }

  /** Screen point → the terrain under it, walked along the pick ray. */
  screenToGround(mx, my) {
    const rect = this.canvasEl.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((mx - rect.left) / rect.width) * 2 - 1,
      -((my - rect.top) / rect.height) * 2 + 1,
    );
    // The camera may have been posed this frame without a render between —
    // project through fresh matrices or the pick is a frame stale.
    this.camera.updateMatrixWorld();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    if (d.y >= -0.02) return null;                 // looking at the sky
    let t = 0;
    for (let i = 0; i < 60; i++) {
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
      const h = Level.heightAt(px, pz);
      if (py <= h + 0.15) return { x: px, z: pz };
      t += Math.max(0.6, (py - h) * 0.7);
      if (t > 700) break;
    }
    return null;
  }

  /** World position → screen pixels, or null when behind the camera. */
  worldToScreen(x, z) {
    const rect = this.canvasEl.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, Level.heightAt(x, z) + 1.1, z).project(this.camera);
    if (v.z > 1) return null;
    return {
      x: rect.left + (v.x + 1) / 2 * rect.width,
      y: rect.top + (1 - v.y) / 2 * rect.height,
    };
  }

  /** Everyone the tactical view can command: the squad, and the commander. */
  rtsFinishSelect() {
    const d = this.rtsDrag;
    this.rtsDrag = null;
    this.rtsDrawBox();
    if (!d) return;
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    const isClick = (x1 - x0) < 8 && (y1 - y0) < 8;
    const commandable = this.squad.filter((s) => !s.dead && !s.down);

    if (isClick) {
      // Click: the nearest body under the cursor, commander included.
      let best = null, bd = 30;
      for (const s of [...commandable, this.player]) {
        const sp = this.worldToScreen(s.x, s.z);
        if (!sp) continue;
        const dist = Math.hypot(sp.x - d.x1, sp.y - d.y1);
        if (dist < bd) { bd = dist; best = s; }
      }
      this.selection.clear();
      this.playerSelected = false;
      if (best === this.player) this.playerSelected = true;
      else if (best) this.selection.add(this.squad.indexOf(best));
      this.onToast('', this.playerSelected ? 'SELECTED: COMMANDER'
        : best ? `SELECTED: ${this.selectionLabel()}` : 'WHOLE SQUAD', 'order');
      return;
    }
    // Box: everyone inside it, commander included.
    this.selection.clear();
    this.playerSelected = false;
    for (const s of commandable) {
      const sp = this.worldToScreen(s.x, s.z);
      if (sp && sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1) {
        this.selection.add(this.squad.indexOf(s));
      }
    }
    const pp = this.worldToScreen(this.player.x, this.player.z);
    if (pp && pp.x >= x0 && pp.x <= x1 && pp.y >= y0 && pp.y <= y1) this.playerSelected = true;
    this.onToast('', this.selection.size || this.playerSelected
      ? `SELECTED: ${this.playerSelected ? 'COMMANDER + ' : ''}${this.selection.size || 'NOBODY'}`
      : 'WHOLE SQUAD', 'order');
  }

  /** Right-click: context order at the ground point — move, or focus fire. */
  rtsOrderAt(mx, my) {
    const pt = this.screenToGround(mx, my);
    if (!pt) return;
    // An enemy near the click is a target, not a destination.
    let foe = null, fd = 3.2;
    for (const e of this.entities) {
      if (e.side !== 'enemy' || e.dead) continue;
      const dist = Math.hypot(e.x - pt.x, e.z - pt.z);
      if (dist < fd) { fd = dist; foe = e; }
    }
    this.issueContextOrder(foe ? { x: foe.x, z: foe.z, entity: foe } : { x: pt.x, z: pt.z });
    // The commander is a unit on this board like everybody else.
    if (this.playerSelected) {
      this.playerAuto = { x: pt.x, z: pt.z };
      this.showMarker(pt.x, pt.z, 4);
    }
  }

  /** Bind the current selection — commander included — to a digit. */
  assignGroup(n) {
    if (!this.selection.size && !this.playerSelected) { Audio.uiDeny(); return; }
    this.ctrlGroups[n] = {
      ids: [...this.selection].map((i) => this.squad[i]?.id).filter(Boolean),
      player: this.playerSelected,
    };
    Audio.uiSelect();
    this.onToast('', `GROUP ${n} SET — ${this.playerSelected ? 'COMMANDER + ' : ''}${this.selection.size}`, 'order');
  }

  /** Recall a bound group. The dead do not answer: they drop on recall. */
  recallGroup(n) {
    const g = this.ctrlGroups[n];
    if (!g) return;
    this.selection.clear();
    for (const id of g.ids) {
      const idx = this.squad.findIndex((s) => s.id === id && !s.dead);
      if (idx >= 0) this.selection.add(idx);
    }
    this.playerSelected = !!g.player && !this.player.dead;
    Audio.uiSelect();
    this.onToast('', `GROUP ${n} — ${this.playerSelected ? 'COMMANDER + ' : ''}${this.selection.size}`, 'order');
  }

  /**
   * Route lines: every commanded unit's remaining path, drawn on the ground,
   * with a short flag at the destination. Selected units when there is a
   * selection; everyone under orders when there is not. Rebuilt per frame —
   * the routes ARE per frame — and torn down the moment the mode closes.
   */
  rtsSyncRoutes() {
    // Rebuilt at 10Hz, not per frame: the routes barely move between frames
    // and the rebuild allocates a geometry every time it runs.
    if (this.rts && this.routeViz && this.time - (this.routeVizAt || 0) < 0.1) return;
    this.routeVizAt = this.time;
    if (this.routeViz) {
      this.scene.remove(this.routeViz);
      this.routeViz.geometry.dispose();
      this.routeViz = null;
    }
    if (!this.rts) return;
    const pts = [];
    const seg = (ax, az, bx, bz) => {
      pts.push(ax, Level.heightAt(ax, az) + 0.35, az,
        bx, Level.heightAt(bx, bz) + 0.35, bz);
    };
    const addRoute = (e, goal) => {
      if (!goal) return;
      let cx = e.x, cz = e.z;
      if (e.path && e.pathIdx < e.path.length) {
        for (let i = e.pathIdx; i < e.path.length; i++) {
          seg(cx, cz, e.path[i].x, e.path[i].z);
          cx = e.path[i].x; cz = e.path[i].z;
        }
      }
      seg(cx, cz, goal.x, goal.z);
      // The flag: a short vertical stroke at the destination.
      const gy = Level.heightAt(goal.x, goal.z);
      pts.push(goal.x, gy + 0.35, goal.z, goal.x, gy + 2.4, goal.z);
    };
    const chosen = this.selection.size
      ? this.squad.filter((s, i) => this.selection.has(i))
      : this.squad;
    for (const s of chosen) {
      if (!s.dead && !s.down && s.order === 'move' && s.orderPoint) {
        addRoute(s, s.orderPoint);
      }
    }
    if (this.playerAuto && (this.playerSelected || !this.selection.size)) {
      addRoute(this.player, this.playerAuto);
    }
    if (!pts.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.routeMat = this.routeMat
      || new THREE.LineBasicMaterial({ color: 0xc08d3f, transparent: true, opacity: 0.8 });
    this.routeViz = new THREE.LineSegments(geo, this.routeMat);
    this.scene.add(this.routeViz);
  }

  /** The drag-select rectangle, drawn straight onto the container. */
  rtsDrawBox() {
    let box = this.rtsBoxEl;
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;border:1px solid #c08d3f;'
        + 'background:rgba(192,141,63,0.12);pointer-events:none;z-index:40;display:none;';
      document.body.appendChild(box);
      this.rtsBoxEl = box;
    }
    const d = this.rtsDrag;
    if (!d) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.style.left = `${Math.min(d.x0, d.x1)}px`;
    box.style.top = `${Math.min(d.y0, d.y1)}px`;
    box.style.width = `${Math.abs(d.x1 - d.x0)}px`;
    box.style.height = `${Math.abs(d.y1 - d.y0)}px`;
  }

  /** Where Space snaps the eye: the selection's centre, or the commander. */
  rtsFollowTarget() {
    const chosen = this.squad.filter((s, i) => this.selection.has(i) && !s.dead);
    if (this.playerSelected || !chosen.length) {
      return { x: this.player.x, z: this.player.z };
    }
    return {
      x: chosen.reduce((a, s) => a + s.x, 0) / chosen.length,
      z: chosen.reduce((a, s) => a + s.z, 0) / chosen.length,
    };
  }

  /**
   * A click on the field map, in canvas pixels → the eye goes there.
   * The mapping mirrors drawFieldMap in ui.js exactly: (R - 4) px per
   * bounds, centred — change one and you must change the other.
   */
  rtsMapClick(cx, cy) {
    const c = document.getElementById('radar');
    if (!c || !this.rts) return;
    const R = c.width / 2;
    const scale = (R - 4) / this.level.bounds;
    const b = this.level.bounds;
    this.rtsFocus.x = clamp((cx - R) / scale, -b, b);
    this.rtsFocus.z = clamp((cy - R) / scale, -b, b);
    this.rtsVel = { x: 0, z: 0 };
    Audio.uiSelect();
  }

  /** B: the eye goes to the most recent exchange of fire, if it is fresh. */
  jumpToCombat() {
    const c = this.lastCombat;
    if (!c || this.time - c.t > 30) { Audio.uiDeny(); return; }
    this.rtsFocus.x = c.x;
    this.rtsFocus.z = c.z;
    this.rtsVel = { x: 0, z: 0 };
    Audio.uiSelect();
  }

  updateTacticalCamera(dt) {
    const f = this.rtsFocus;
    // Q/E rotate the board — held, smooth, around the focus.
    if (this.keys.has('q')) this.rtsYaw += dt * 1.9;
    if (this.keys.has('e')) this.rtsYaw -= dt * 1.9;

    // WASD pans in view space; the screen edge pans too. Input drives a
    // VELOCITY rather than the position, so the eye has weight: it eases in,
    // and it coasts to a stop instead of freezing the frame it is released.
    let px = 0, pz = 0;
    if (this.keys.has('w')) pz += 1;
    if (this.keys.has('s')) pz -= 1;
    if (this.keys.has('a')) px -= 1;
    if (this.keys.has('d')) px += 1;
    const rect = this.canvasEl?.getBoundingClientRect();
    if (rect && !this.rtsDrag && this.rtsCursorLive) {
      const m = 24;
      if (this.rtsCursor.x < rect.left + m) px -= 1;
      if (this.rtsCursor.x > rect.right - m) px += 1;
      if (this.rtsCursor.y < rect.top + m) pz += 1;
      if (this.rtsCursor.y > rect.bottom - m) pz -= 1;
    }
    const sin = Math.sin(this.rtsYaw), cos = Math.cos(this.rtsYaw);
    const maxSp = this.rtsZoom * 1.7;
    const want = {
      x: (px * cos + pz * sin) * maxSp,
      z: (-px * sin + pz * cos) * maxSp,
    };
    this.rtsVel = this.rtsVel || { x: 0, z: 0 };
    const k = 1 - Math.exp(-dt * ((px || pz) ? 9 : 4.5));
    this.rtsVel.x = lerp(this.rtsVel.x, want.x, k);
    this.rtsVel.z = lerp(this.rtsVel.z, want.z, k);
    f.x += this.rtsVel.x * dt;
    f.z += this.rtsVel.z * dt;

    // Space: snap to the selection, and keep following while held.
    if (this.keys.has(' ')) {
      const t = this.rtsFollowTarget();
      const fk = 1 - Math.exp(-dt * 10);
      f.x = lerp(f.x, t.x, fk);
      f.z = lerp(f.z, t.z, fk);
      this.rtsVel.x *= 0.5;
      this.rtsVel.z *= 0.5;
    }
    const b = this.level.bounds;
    f.x = clamp(f.x, -b, b);
    f.z = clamp(f.z, -b, b);

    // Zoom glides toward the wheel's target, and the TILT rides on it:
    // pulled in close the view is oblique enough to read faces and cover;
    // pulled out it steepens toward true top-down, where the battle is
    // shapes and lanes and that is the point of being out there.
    this.rtsZoomT = this.rtsZoomT ?? this.rtsZoom;
    this.rtsZoom = lerp(this.rtsZoom, this.rtsZoomT, 1 - Math.exp(-dt * 7));
    const flat = clamp((this.rtsZoom - 22) / (78 - 22), 0, 1);
    const back = 0.9 - flat * 0.55;
    const rise = 0.8 + flat * 0.5;

    if (Math.abs(this.camera.fov - 52) > 0.01) {
      this.camera.fov = 52;
      this.camera.updateProjectionMatrix();
    }
    const ground = Level.heightAt(f.x, f.z);
    this.camera.position.set(
      f.x - sin * this.rtsZoom * back,
      ground + this.rtsZoom * rise,
      f.z - cos * this.rtsZoom * back,
    );
    this.camera.lookAt(f.x, ground, f.z);
    this.hidePlayerModel = false;
    this.rtsSyncRoutes();
    // Shadows still follow the commander, wherever the eye went.
    const p = this.player;
    this.sun.position.set(p.x - 46, 38, p.z + 30);
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.target.updateMatrixWorld();
  }

  togglePause() {
    if (this.over) return;
    this.paused = !this.paused;
    if (this.paused && document.pointerLockElement) document.exitPointerLock();
    // Resuming into the tactical view must NOT grab the pointer — the whole
    // mode runs unlocked, and yanking the lock would snap it back to shoulder.
    else if (!this.rts) this.requestLock();
  }

  // ======================================================================
  // Squad command
  // ======================================================================

  /**
   * The soldiers an order applies to. With nothing selected an order is a
   * squad order; with 1-4 held down it addresses individuals, which is what
   * makes bounding and flanking possible at all.
   */
  commanded() {
    const live = this.squad.filter((s) => !s.dead && !s.down && !s.militia);
    if (!this.selection.size) return live;
    return live.filter((s) => this.selection.has(this.squad.indexOf(s)));
  }

  selectionLabel() {
    if (!this.selection.size) return 'SQUAD';
    const names = this.commanded().map((s) => s.name.split(' ')[0].toUpperCase());
    return names.join(', ') || 'SQUAD';
  }

  toggleSelect(idx) {
    if (idx < 0 || idx >= this.squad.length) return;
    const s = this.squad[idx];
    if (!s || s.dead || s.militia) return;
    if (this.selection.has(idx)) this.selection.delete(idx);
    else this.selection.add(idx);
    Audio.uiMove();
    this.onToast('', this.selection.size
      ? `SELECTED: ${this.selectionLabel()}` : 'WHOLE SQUAD', 'order');
  }

  selectAll() {
    this.selection.clear();
    Audio.uiMove();
    this.onToast('', 'WHOLE SQUAD', 'order');
  }

  /** Which arm of the line a body belongs to, read off what it carries. */
  battleGroup(e) {
    const w = e.weapon;
    if (!w) return 'inf';
    if (w.bow || (!w.melee && (w.range || 0) > 20)) return 'ranged';
    if (w.id === 'spear') return 'spear';
    return 'inf';
  }

  /** Select a whole arm at once: ALL, INFANTRY, SPEARS, RANGED. */
  selectGroup(g) {
    this.selection.clear();
    if (g !== 'all') {
      this.squad.forEach((s, i) => {
        if (s.dead || s.down || s.militia) return;
        if (this.battleGroup(s) === g) this.selection.add(i);
      });
    }
    Audio.uiMove();
    const label = g === 'all' ? 'WHOLE SQUAD'
      : g === 'inf' ? 'INFANTRY' : g === 'spear' ? 'SPEARS' : 'RANGED';
    this.onToast('', this.selection.size || g === 'all'
      ? label : `${label} — NOBODY CARRIES IT`, 'order');
  }

  /**
   * Close the ranks of whatever is selected. The direct verb, where
   * cycleGroupShape is the browse-through-them one — in a fight you want
   * "wall, now", not three presses of a cycle key.
   */
  orderShieldWall() {
    const sel = this.commanded();
    if (!sel.length) return;
    const groups = new Set(sel.map((s) => this.battleGroup(s)));
    for (const g of groups) this.groupShape[g] = 'wall';
    Audio.order();
    this.onToast(this.selectionLabel(), 'SHIELD WALL', 'order');
  }

  /** Cycle the selected arm's shape: line → wall → loose. */
  cycleGroupShape() {
    // Which arm is selected? All of one kind, or the shape call is ambiguous.
    const sel = this.commanded();
    if (!sel.length) return;
    const groups = new Set(sel.map((s) => this.battleGroup(s)));
    if (groups.size !== 1) {
      this.onToast('', 'PICK ONE ARM TO RESHAPE (7/8/9)', 'order');
      return;
    }
    const g = [...groups][0];
    const order = ['line', 'wall', 'loose'];
    const cur = this.groupShape[g] || 'line';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.groupShape[g] = next;
    Audio.order();
    const gl = g === 'inf' ? 'INFANTRY' : g === 'spear' ? 'SPEARS' : 'RANGED';
    this.onToast(gl, next.toUpperCase(), 'order');
  }

  /**
   * THE BATTLE LINE's slots: infantry forward, spears a rank behind them,
   * ranged well back — each arm in its own shape. Slots are local-frame
   * rectangles behind the commander's facing, stable per body, and a
   * soldier displaced from theirs steers home the moment they disengage.
   */
  battleSlot(e) {
    const groups = { inf: [], spear: [], ranged: [] };
    for (const s of this.squad) {
      if (s.dead || s.down) continue;
      groups[this.battleGroup(s)].push(s);
    }
    const g = this.battleGroup(e);
    const list = groups[g];
    const i = Math.max(0, list.indexOf(e));
    const shape = this.groupShape[g] || (g === 'ranged' ? 'loose' : 'line');
    const baseBack = g === 'inf' ? 3.2 : g === 'spear' ? 7 : 13;
    // A line stands wide enough to be a line from across the field; a wall
    // is deliberately the tight one, because closing the ranks is what it
    // IS; loose is wider still so a volley cannot take three men at once.
    const spacing = shape === 'wall' ? 1.3 : shape === 'loose' ? 3.4 : 2.4;
    const ranks = shape === 'line' ? 1 : 2;
    const perRank = Math.max(1, Math.ceil(list.length / ranks));
    const rank = Math.floor(i / perRank);
    const c = (i % perRank) - (Math.min(perRank, list.length) - 1) / 2;
    const side = c * spacing + (shape === 'loose' && rank % 2 ? spacing * 0.5 : 0);
    const back = baseBack + rank * (shape === 'wall' ? 1.4 : 3.0);
    return { side, back };
  }

  setSquadOrder(order) {
    const targets = this.commanded();
    if (!targets.length) { Audio.uiDeny(); return; }
    this.clearMark();
    if (!this.selection.size) this.squadOrder = order;
    for (const s of targets) {
      s.order = order;
      s.suppressPoint = null;
      s.suppressOrder = false;
      s.flankPoint = null;
      if (order === 'follow') s.orderPoint = null;
      if (order === 'hold') s.orderPoint = { x: s.x, z: s.z };
    }
    Audio.order();
    const text = { follow: 'FORM ON ME', hold: 'HOLD POSITION' }[order] || order.toUpperCase();
    this.onToast(this.selectionLabel(), text, 'order');
    this.orderMarker.visible = false;
  }

  /** Suppress a point: pour fire into it whether or not anyone is visible. */
  orderSuppress(pre = null) {
    const aim = pre || this.aimPoint(120);
    const targets = this.commanded();
    if (!targets.length) { Audio.uiDeny(); return; }
    const p = aim.entity ? { x: aim.entity.x, z: aim.entity.z } : { x: aim.x, z: aim.z };
    for (const s of targets) {
      s.order = 'suppress';
      s.suppressPoint = p;
      s.suppressOrder = true;
      s.orderPoint = null;
      s.flankPoint = null;
    }
    Audio.order();
    this.onToast(this.selectionLabel(), 'SUPPRESS THAT POSITION', 'order');
    this.showMarker(p.x, p.z, 6);
  }

  /**
   * Flank: swing wide around the target and come at it from the side. The
   * offset is taken perpendicular to the commander's line to the target, so
   * "flank" always means "from a different angle than I am shooting from".
   */
  orderFlank(pre = null) {
    const aim = pre || this.aimPoint(140);
    const targets = this.commanded();
    if (!targets.length) { Audio.uiDeny(); return; }
    const tx = aim.entity ? aim.entity.x : aim.x;
    const tz = aim.entity ? aim.entity.z : aim.z;
    const dx = tx - this.player.x, dz = tz - this.player.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = -dz / d, nz = dx / d;         // perpendicular to the approach
    targets.forEach((s, i) => {
      // Alternate sides when more than one soldier is sent.
      const side = this.selection.size ? (i % 2 === 0 ? 1 : -1) : (this.squad.indexOf(s) % 2 ? 1 : -1);
      const wide = 14 + i * 3;
      s.order = 'flank';
      s.flankPoint = {
        x: tx + nx * wide * side - (dx / d) * 8,
        z: tz + nz * wide * side - (dz / d) * 8,
      };
      s.flankTarget = aim.entity && aim.entity.side === 'enemy' ? aim.entity : null;
      s.orderPoint = null;
      s.suppressPoint = null;
      s.suppressOrder = false;
    });
    Audio.order();
    this.onToast(this.selectionLabel(), 'FLANK — GO WIDE', 'order');
    this.showMarker(targets[0].flankPoint.x, targets[0].flankPoint.z, 5);
  }

  /** Break contact and pull back behind the commander. */
  orderFallBack() {
    const targets = this.commanded();
    if (!targets.length) { Audio.uiDeny(); return; }
    const back = this.player.yaw + Math.PI;
    targets.forEach((s, i) => {
      s.order = 'fallback';
      s.orderPoint = {
        x: this.player.x + Math.sin(back) * (5 + i * 1.8) + (i % 2 ? 1.6 : -1.6),
        z: this.player.z + Math.cos(back) * (5 + i * 1.8),
      };
      s.suppressPoint = null;
      s.suppressOrder = false;
      s.flankPoint = null;
    });
    Audio.order();
    this.onToast(this.selectionLabel(), 'FALL BACK', 'order');
    this.showMarker(targets[0].orderPoint.x, targets[0].orderPoint.z, 4);
  }

  /**
   * Get the selected soldiers behind something and keep them there.
   *
   * The squad already took cover on its own initiative when it had a target to
   * be afraid of, which meant cover was something that happened TO them rather
   * than something the player could ask for. As an order it becomes a move in
   * the fight: pin one element in cover, take the other one round.
   *
   * Cover is chosen against the threat the player is looking at, so ordering it
   * while aimed down a street puts people behind the things that face the
   * street — not behind whatever happens to be nearest.
   */
  orderTakeCover(aim = null) {
    const targets = this.commanded();
    if (!targets.length) { Audio.uiDeny(); return; }
    const threat = aim
      || (this.marked && !this.marked.dead ? { x: this.marked.x, z: this.marked.z } : null)
      || this.nearestEnemyTo(this.player)
      || { x: this.player.x + Math.sin(this.player.yaw) * 30,
        z: this.player.z + Math.cos(this.player.yaw) * 30 };

    let found = 0;
    for (const s of targets) {
      s.order = 'cover';
      s.suppressPoint = null;
      s.suppressOrder = false;
      s.flankPoint = null;
      const c = Level.findCover(this.level.obstacles, this.level.covers,
        s.x, s.z, threat.x, threat.z, 18);
      // Nowhere to hide is a real answer. They hold where they are rather than
      // running somewhere arbitrary and calling it cover.
      s.coverPos = c ? { x: c.x, z: c.z } : null;
      s.coverAt = this.time;
      s.orderPoint = s.coverPos || { x: s.x, z: s.z };
      s.coverFacing = { x: threat.x, z: threat.z };
      if (c) found++;
    }
    Audio.order();
    this.onToast(this.selectionLabel(),
      found ? `TAKE COVER — ${found} of ${targets.length} found something` : 'NO COVER HERE',
      found ? 'order' : 'bad');
    if (targets[0].orderPoint) {
      this.showMarker(targets[0].orderPoint.x, targets[0].orderPoint.z, 4);
    }
  }

  /** Closest live enemy to a point, or null. */
  nearestEnemyTo(from) {
    let best = null, bd = Infinity;
    for (const e of this.entities) {
      if (e.side !== 'enemy' || e.dead) continue;
      const d = Math.hypot(e.x - from.x, e.z - from.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  /**
   * Jump. Deliberately short and heavy: this is a soldier stepping over a
   * sandbag line, not a platformer. You cannot jump from a crouch, and you
   * cannot jump while already in the air.
   */
  tryJump() {
    if (!this.grounded || this.over || this.paused || this.intro?.active) return;
    if (this.player?.down) return;
    if (this.crouch > 0.4) { this.crouchHeld = false; return; }  // stand up first
    // 7.3 puts the apex at ~1.2m (v²/2g), which clears a 0.94m crate with a
    // landing margin. 6.1 peaked at 0.85 — visibly ABOVE a crate and still
    // unable to mount it, which read as the jump being broken rather than
    // short. Stacked crates are climbed progressively: mount one, jump again.
    this.vy = 7.3;
    this.grounded = false;
    Audio.uiMove();
  }

  swapShoulder() {
    if (this.over || this.intro?.active) return;
    this.shoulder = -this.shoulder;
    Audio.uiMove();
  }

  /** Advance crouch blend and the vertical hop. */
  updateStance(dt) {
    const want = this.crouchHeld && this.grounded ? 1 : 0;
    // Standing up is quicker than going down, which is both true and better to
    // play: getting up to move should not feel like wading.
    const rate = want > this.crouch ? 9 : 12;
    this.crouch += (want - this.crouch) * Math.min(1, dt * rate);
    if (this.crouch < 0.001) this.crouch = 0;

    // Vertical position, now that there is somewhere to be other than the
    // ground. `airY` is height above the terrain directly below; the surface
    // under the player may be the terrain itself or the top of a catwalk.
    const p = this.player;
    if (!p) return;
    const terrain = Level.heightAt(p.x, p.z);
    const feet = terrain + this.airY;
    // Only surfaces you could step onto count while walking. In the air,
    // anything below you is a place to land.
    const surf = Level.surfaceAt(this.level.obstacles, p.x, p.z,
      this.grounded ? feet : feet + 0.4, this.grounded ? 0.62 : 0.4) - terrain;

    if (!this.grounded) {
      this.vy -= 22 * dt;
      this.airY += this.vy * dt;
      if (this.airY <= surf) { this.airY = surf; this.vy = 0; this.grounded = true; }
    } else if (surf > this.airY + 0.02) {
      // Stepping up onto a low ledge — a stair tread, the lip of a deck.
      this.airY = surf;
    } else if (surf < this.airY - 0.08) {
      // Walked off the edge. Falling, not floating.
      this.grounded = false;
      this.vy = 0;
    }
    // Carried on the entity, so everything that reasons about bodies — the ray
    // test, the muzzle, the character rig — reads elevation the same way for
    // the player as for anyone standing on the same catwalk.
    p.elev = this.airY;
  }

  showMarker(x, z, seconds) {
    this.orderMarker.position.set(x, Level.heightAt(x, z) + 0.05, z);
    this.orderMarker.visible = true;
    this.orderMarkerUntil = this.time + seconds;
  }

  /**
   * Q is contextual: aiming at a body issues focus fire, aiming at ground
   * issues a move. One key covers Move and Attack, which keeps the command
   * set to four keys and stops this turning into an RTS.
   */
  issueContextOrder(pre = null) {
    const aim = pre || this.aimPoint(120);
    const targets = this.commanded();
    if (!targets.length) { Audio.uiDeny(); return; }

    if (aim.entity && aim.entity.side === 'enemy') {
      for (const s of targets) {
        s.order = 'attack';
        s.forceTarget = aim.entity;
        s.orderPoint = null;
        s.suppressPoint = null;
        s.suppressOrder = false;
        s.flankPoint = null;
      }
      if (!this.selection.size) this.squadOrder = 'attack';
      Audio.order();
      this.onToast(this.selectionLabel(), 'FOCUS FIRE', 'order');
      this.showMarker(aim.entity.x, aim.entity.z, 3);
    } else {
      const p = { x: aim.x, z: aim.z };
      targets.forEach((s, i) => {
        s.order = 'move';
        s.forceTarget = null;
        s.suppressPoint = null;
        s.suppressOrder = false;
        s.flankPoint = null;
        // Spread out around the point instead of stacking on it.
        const a = (i / Math.max(1, targets.length)) * Math.PI * 2;
        s.orderPoint = { x: p.x + Math.cos(a) * 1.9, z: p.z + Math.sin(a) * 1.9 };
      });
      if (!this.selection.size) this.squadOrder = 'move';
      Audio.order();
      this.onToast(this.selectionLabel(), 'MOVE UP', 'order');
      this.showMarker(p.x, p.z, 5);
    }
  }

  // ======================================================================
  // Aiming & shooting
  // ======================================================================

  /** World point under the crosshair, plus whatever entity is there. */
  aimPoint(maxDist = 200) {
    const o = new THREE.Vector3();
    this.camera.getWorldPosition(o);
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    return this.rayHit(o, d, maxDist, this.player);
  }

  /**
   * 3D ray against obstacle boxes, entity capsules and the ground. Used for
   * both the player's shots and the AI's, so a miss looks the same either way.
   */
  rayHit(origin, dir, maxDist, ignore) {
    let best = { t: maxDist, entity: null, kind: 'sky' };

    for (const o of this.level.obstacles) {
      const t = rayBox(origin, dir,
        o.x - o.hw, o.y, o.z - o.hd,
        o.x + o.hw, o.y + o.h, o.z + o.hd);
      if (t !== null && t > 0.05 && t < best.t) best = { t, entity: null, kind: 'solid' };
    }

    for (const e of this.entities) {
      if (e === ignore || e.dead) continue;
      if (e.isTitan) {
        // The walker is not a capsule. Every plate and every exposed core is
        // its own target, and which one you hit is the entire fight — so it is
        // resolved here rather than being flattened into one body hit.
        for (const pl of e.plates) {
          const wp = this.platePos(pl);
          if (!wp) continue;
          const t = rayCapsule(origin, dir, wp.x, wp.y - 0.5, wp.z, wp.x, wp.y + 0.5, wp.z,
            pl.broken ? pl.radius * 0.52 : pl.radius);
          if (t !== null && t > 0.05 && t < best.t) {
            best = { t, entity: e, kind: pl.broken ? 'core' : 'plate', plate: pl };
          }
        }
        // The hull itself, so shots that miss every plate still hit something.
        const hb = Level.heightAt(e.x, e.z);
        const th = rayCapsule(origin, dir, e.x, hb + 1.2, e.z, e.x, hb + 7.0, e.z, 1.5);
        if (th !== null && th > 0.05 && th < best.t) {
          best = { t: th, entity: e, kind: 'hull' };
        }
        continue;
      }
      const { lo, hi } = bodyCapsule(e);
      const t = rayCapsule(origin, dir, e.x, lo, e.z, e.x, hi, e.z, 0.42);
      if (t !== null && t > 0.05 && t < best.t) best = { t, entity: e, kind: 'body' };
    }

    // Ground: iterate a few steps rather than solving the displaced surface.
    for (let t = 2; t < Math.min(maxDist, best.t); t += 1.6) {
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      if (py <= Level.heightAt(px, pz)) { best = { t, entity: null, kind: 'ground' }; break; }
    }

    return {
      t: best.t,
      entity: best.entity,
      kind: best.kind,
      plate: best.plate || null,
      x: origin.x + dir.x * best.t,
      y: origin.y + dir.y * best.t,
      z: origin.z + dir.z * best.t,
    };
  }

  tryReload(e) {
    if (!e.weapon || e.reloading > 0 || e.ammo >= e.weapon.mag) return;
    e.reloading = e.weapon.reload;
    Audio.reload('out', this.relPos(e));
    setTimeout(() => { if (!this.over) Audio.reload('in', this.relPos(e)); }, e.weapon.reload * 600);
  }

  relPos(e) {
    if (!this.player) return null;
    return { x: e.x - this.player.x, z: e.z - this.player.z };
  }

  // ------------------------------------------------------------------
  // The melee era: swings, guards, and the wind to throw them with.
  // A swing is a COMMITTED thing — it has a windup the other man can
  // read, an apex where the steel arrives, and a recovery you pay for.
  // Resolution happens at the apex in updateSwing, never on the click.
  // ------------------------------------------------------------------

  /** Begin a swing. Direction is animation flavour; the arc is the rule. */
  strike(e, dir = 'right') {
    const w = e.weapon;
    if (!w?.melee || e.cooldown > 0 || e.swing || e.arriving > 0) return;
    let dur = 60 / w.rpm;
    if (e.isPlayer) {
      // Tired swings drag. The bar also gates sprint — one wind, all of it.
      if (this.pStamina < 0.2) dur *= 1.5;
      this.pStamina = Math.max(0, this.pStamina - 0.18);
      this.stats.swings = (this.stats.swings || 0) + 1;
    }
    e.swing = { t: 0, dur, dir, hitDone: false };
    e.cooldown = dur + 0.12;               // recovery beyond the follow-through
    e.guard = 0;                           // you cannot hide behind a swing
    // Air first. The heft is the weapon's own swing time, so a maul sounds
    // like a maul without anybody having to say so.
    Audio.whoosh(clamp(dur / 0.55, 0.6, 2), this.relPos(e));
    // A closing man shouts, sometimes. Not every swing — that is a crowd,
    // not a battle line.
    if (!e.isPlayer && this.r() < 0.12) Audio.cry('charge', this.relPos(e));
    this.raiseAlarm(e, e.target || { x: e.x, z: e.z });
  }

  /** Advance a swing; the steel arrives at the apex. */
  updateSwing(dt, e) {
    const s = e.swing;
    if (!s) return;
    s.t += dt;
    if (!s.hitDone && s.t >= s.dur * 0.55) {
      s.hitDone = true;
      this.resolveStrike(e);
    }
    if (s.t >= s.dur) e.swing = null;
  }

  /**
   * The apex: an arc sweep in front of the swinger, nearest valid body
   * inside reach. Blocks, shields, spear rules and stagger all live here,
   * because here is where the steel actually meets somebody.
   */
  resolveStrike(e) {
    const w = e.weapon;
    const reach = (w.reach || 2) + 0.5;    // arm on top of the steel
    const halfArc = (w.arc ?? 1.6) / 2 + 0.15;
    let best = null, bd = Infinity;
    for (const t of this.entities) {
      if (t === e || t.dead || t.isTitan) continue;
      if (t.side === e.side) continue;
      if (t.inserting) continue;
      const dx = t.x - e.x, dz = t.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + 0.4) continue;
      if (Math.abs(angleDelta(Math.atan2(dx, dz), e.yaw)) > halfArc) continue;
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return;

    let dmg = w.damage;
    // A spear is a wall at its point and a walking stick inside it.
    if (w.insideMin && bd < w.insideMin) dmg *= w.insideMul;
    // Braced steel meets a charge: closing speed is the target's own doing.
    if (w.brace) {
      const vx = best.x - (best.lastX ?? best.x), vz = best.z - (best.lastZ ?? best.z);
      const closing = -(vx * (best.x - e.x) + vz * (best.z - e.z));
      if (closing > 0.03) dmg *= w.brace;
    }
    // Melee skill: the swinger's accuracy stat is their bladework.
    dmg *= 0.7 + (e.eff?.accuracy ?? e.acc ?? 0.6) * 0.6;

    // The guard: facing the blow, inside the protected frontage.
    const offFacing = Math.abs(angleDelta(
      Math.atan2(e.x - best.x, e.z - best.z), best.yaw));
    const guarded = (best.guard || 0) > 0 && !best.swing
      && !(best.guardBreak > 0)
      && offFacing < ((best.blockArc ?? 2.1) / 2);
    if (guarded) {
      if ((best.shieldHp || 0) > 0) {
        // The plate takes it. Half weight through the arm, mauls triple.
        best.shieldHp -= Math.max(4, dmg * (w.shieldMul ?? 1) * 0.5);
        if (best.shieldHp <= 0) {
          best.shieldHp = 0;
          if (best.isPlayer || e.isPlayer) this.onToast('SHIELD GONE', 'The plate is done', 'bad');
        }
        dmg = 0;
      } else {
        dmg *= 0.3;                        // bare steel turns most of it
      }
      if (best.isPlayer) this.pStamina = Math.max(0, this.pStamina - 0.15);
      Audio.clash((best.shieldHp || 0) > 0 ? 'shield' : 'parry',
        clamp((w.reach || 2) / 2.2, 0.7, 1.8), this.relPos(best));
    }
    // Stagger: weight interrupts. A maul cancels a sword mid-swing;
    // equals trade cancels; a blade staggers nothing.
    if (best.swing && (w.stagger ?? 1) >= (best.weapon?.stagger ?? 1)
      && (w.stagger ?? 1) > 0) {
      best.swing = null;
      best.cooldown = Math.max(best.cooldown, 0.35);
    }
    if (dmg > 0) {
      const hy = Level.heightAt(best.x, best.z) + 1.2 + (best.elev || 0);
      // Armour turns some of it into noise; a soft target does not.
      const armoured = (best.eff?.maxHp ?? best.maxHp ?? 100) > 110;
      Audio.clash(armoured ? 'armour' : 'flesh',
        clamp((w.reach || 2) / 2.2, 0.7, 1.8), this.relPos(best));
      if (!best.isPlayer && this.r() < 0.35) Audio.cry('hurt', this.relPos(best));
      this.applyDamage(best, dmg, e, { x: best.x, y: hy, z: best.z });
      // Connecting has weight the hand can feel.
      if (e.isPlayer) this.shake = Math.max(this.shake || 0, 0.22);
    } else {
      best.char.flinch();
    }
    e.char.kick();                          // follow-through weight
  }

  // ------------------------------------------------------------------
  // Arrows: real bodies in flight. Nothing hitscan leaves a bow — the
  // arc is solved at the loose to land on the mark under gravity, and
  // everything between loose and landing belongs to updateArrows.
  // ------------------------------------------------------------------

  looseArrow(e, tx, ty, tz) {
    const w = e.weapon;
    const y0 = Level.heightAt(e.x, e.z) + (e.elev || 0) + 1.5;
    const dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    // Height is an archer's whole argument for taking the ridge: shooting
    // downhill puts more of the draw into the flight, so the arrow gets
    // there flatter and lands harder. Capped, because a ridge is an
    // advantage and not a siege engine.
    const drop = clamp((y0 - ty) / 12, 0, 1);
    const s = (w.flight || 28) * (1 + drop * 0.25);
    const t = Math.max(0.15, d / s);
    const g = 14;
    // Skill is scatter at the loose, not a die roll at the landing.
    const jitter = e.isPlayer ? 0.2 : (1 - (e.acc ?? 0.6)) * 2.4;
    this.arrows.push({
      x: e.x, y: y0, z: e.z,
      vx: dx / t + range(this.r, -jitter, jitter),
      vy: (ty - y0) / t + g * t * 0.5,
      vz: dz / t + range(this.r, -jitter, jitter),
      shooter: e, side: e.side,
      dmg: w.damage, dmgFar: w.dmgFar ?? w.damage,
      t: 0, stuck: 0,
      mesh: this.arrowMesh(),
    });
  }

  arrowMesh() {
    if (!this.arrowGeo) {
      this.arrowGeo = new THREE.BoxGeometry(0.035, 0.035, 0.85);
      this.arrowMat = new THREE.MeshBasicMaterial({ color: 0x2a2620 });
    }
    const m = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    this.scene.add(m);
    return m;
  }

  updateArrows(dt) {
    const g = 14;
    let swept = false;
    for (const a of this.arrows) {
      if (a.stuck > 0) {
        a.stuck -= dt;
        if (a.stuck <= 0) { a.dead = true; swept = true; }
        continue;
      }
      a.t += dt;
      if (a.t > 6) { a.dead = true; swept = true; continue; }
      a.vy -= g * dt;
      const nx = a.x + a.vx * dt, ny = a.y + a.vy * dt, nz = a.z + a.vz * dt;
      // Bodies first.
      let hit = null;
      for (const e of this.entities) {
        if (e.dead || e === a.shooter || e.side === a.side || e.isTitan) continue;
        if (e.inserting) continue;
        if (Math.hypot(e.x - nx, e.z - nz) > 0.55) continue;
        const cap = bodyCapsule(e);
        if (ny < cap.lo || ny > cap.hi) continue;
        hit = e;
        break;
      }
      if (hit) {
        // Plate reads arrows from the front whether or not the guard is
        // up — which is exactly what lets shield infantry walk a volley.
        const from = Math.atan2(a.x - hit.x, a.z - hit.z);
        const arc = ((hit.blockArc ?? 2.1) / 2) + ((hit.guard || 0) > 0 ? 0.35 : 0);
        if ((hit.shieldHp || 0) > 0 && Math.abs(angleDelta(from, hit.yaw)) < arc) {
          hit.shieldHp = Math.max(0, hit.shieldHp - 8);
          hit.char.flinch();
          Audio.arrowHit('shield', this.relPos(hit));
        } else {
          const fall = clamp(a.t / 2.2, 0, 1);
          Audio.arrowHit('flesh', this.relPos(hit));
          this.applyDamage(hit, lerp(a.dmg, a.dmgFar, fall), a.shooter,
            { x: nx, y: ny, z: nz });
        }
        a.dead = true;
        swept = true;
        if (a.mesh) a.mesh.visible = false;
        continue;
      }
      // The ground and the furniture both stop an arrow. It sticks a while,
      // which is most of what makes a volleyed field look fought-over.
      const gy = Level.heightAt(nx, nz);
      let blocked = ny <= gy + 0.03;
      if (!blocked) {
        for (const o of this.level.obstacles) {
          if (Math.abs(nx - o.x) > o.hw || Math.abs(nz - o.z) > o.hd) continue;
          if (ny < (o.y ?? gy) + (o.h ?? 2)) { blocked = true; break; }
        }
      }
      if (blocked) {
        a.stuck = 4;
        a.x = nx; a.y = Math.max(ny, gy + 0.02); a.z = nz;
        if (a.mesh) a.mesh.position.set(a.x, a.y, a.z);
        continue;
      }
      a.x = nx; a.y = ny; a.z = nz;
      if (a.mesh) {
        a.mesh.position.set(a.x, a.y, a.z);
        a.mesh.rotation.y = Math.atan2(a.vx, a.vz);
        a.mesh.rotation.x = -Math.atan2(a.vy, Math.hypot(a.vx, a.vz));
      }
    }
    if (swept) {
      for (const a of this.arrows) if (a.dead && a.mesh) this.scene.remove(a.mesh);
      this.arrows = this.arrows.filter((a) => !a.dead);
    }
  }

  /**
   * An archer inside spitting distance is a target, not an archer: the bow
   * goes over the shoulder and the bracket blade comes out, and it goes
   * back the moment the ground opens up again.
   */
  updateSidearm(e) {
    let nearest = Infinity;
    for (const o of this.entities) {
      if (o.dead || o.side === e.side || o.isTitan) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d < nearest) nearest = d;
    }
    if (!e.bowStowed && nearest < 5) {
      e.stowedBow = e.weapon;
      e.bowStowed = true;
      e.weapon = WEAPONS.blade;
    } else if (e.bowStowed && nearest > 13) {
      e.weapon = e.stowedBow;
      e.bowStowed = false;
    }
  }

  /** Fire discipline for the ranged arm: hold until told otherwise. */
  toggleHoldFire(sel) {
    const on = !sel[0].holdFire;
    for (const s of sel) s.holdFire = on;
    Audio.order();
    this.onToast('RANGED', on ? 'HOLD FIRE' : 'FIRE AT WILL', 'order');
  }

  // ------------------------------------------------------------------
  // Morale, and the way a battle ends.
  //
  // Battles are decided by nerve long before they are decided by
  // arithmetic. Everybody carries a nerve pool; casualties nearby,
  // friends running and being badly outnumbered spend it, and a
  // commander standing where they can be seen pays it back. Empty is a
  // rout: they drop what they are doing and run for the edge of the
  // field — and once a side has stopped being an army, the fight is
  // called rather than chased across the basin.
  // ------------------------------------------------------------------

  /**
   * Starting nerve for a body: rank and temperament, so veterans hold.
   *
   * The player's own people start well above everybody else, and that is
   * not a thumb on the scale — a Bracket company is four to eight
   * professionals who CHOSE this, standing next to somebody they follow,
   * and being outnumbered is their normal working condition. Tuned after
   * the first pass broke the player's squad in about eleven seconds of any
   * ordinary contract, which turned every fight into a rout and made the
   * cover order untestable.
   */
  baseNerve(e) {
    const rank = e.soldier?.rank ?? 1;
    const professional = e.side === 'player' ? 30 : 0;
    return 55 + professional + rank * 12 + (e.aggression || 0.5) * 20;
  }

  updateMorale(dt) {
    this.moraleAt = (this.moraleAt || 0) - dt;
    if (this.moraleAt > 0) return;
    this.moraleAt = 0.5;                      // twice a second is plenty
    const p = this.player;
    const live = { player: [], enemy: [] };
    for (const e of this.entities) {
      if (e.dead || e.isTitan || e.follower) continue;
      if (e.side === 'player' || e.side === 'enemy') live[e.side].push(e);
    }
    for (const side of ['player', 'enemy']) {
      const mine = live[side];
      const theirs = live[side === 'player' ? 'enemy' : 'player'];
      const standing = mine.filter((e) => !e.down && !e.routing).length;
      const routing = mine.filter((e) => e.routing).length;
      const facing = theirs.filter((e) => !e.down && !e.routing).length;
      const odds = standing / Math.max(1, facing);
      for (const e of mine) {
        if (e.down || e.dead) continue;
        if (e.nerve === undefined) e.nerve = this.baseNerve(e);
        if (e.routing) continue;
        let drift = 1.4;                      // nerve creeps back on its own
        // Friends going down and friends running are the two things that
        // actually break a line. Everything else is a nudge — being
        // outnumbered is a fact of the job, not a reason to run on its own.
        drift -= (e.casualtySeen || 0) * 2.6;
        e.casualtySeen = 0;
        drift -= routing * 1.5;
        if (odds < 0.4) drift -= 1.2;
        else if (odds < 0.7) drift -= 0.5;
        else if (odds > 1.6) drift += 0.6;
        // Somebody in charge, standing where they can be seen.
        if (side === 'player' && p && !p.down
          && Math.hypot(p.x - e.x, p.z - e.z) < 20) drift += 3.2;
        if (e.hp < e.maxHp * 0.35) drift -= 1.2;
        e.nerve = clamp(e.nerve + drift, 0, 120);
        // Veterans hold past the point where recruits do not.
        const breakAt = 12 + (3 - Math.min(3, e.soldier?.rank ?? 1)) * 6;
        if (e.nerve <= breakAt && !e.isPlayer) this.breakEntity(e);
      }
    }
    this.checkRout();
  }

  /** One body's nerve goes: they run for the edge and stop fighting. */
  breakEntity(e) {
    if (e.routing || e.isPlayer || e.dead) return;
    e.routing = true;
    e.order = 'rout';
    e.target = null;
    e.forceTarget = null;
    e.swing = null;
    e.guard = 0;
    // Away from whoever is nearest, and keep going.
    let away = null, ad = Infinity;
    for (const o of this.entities) {
      if (o.dead || o.side === e.side || o.isTitan) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d < ad) { ad = d; away = o; }
    }
    const a = away ? Math.atan2(e.x - away.x, e.z - away.z) : this.r() * 6.28;
    e.routPoint = { x: e.x + Math.sin(a) * 220, z: e.z + Math.cos(a) * 220 };
    Audio.cry('rout', this.relPos(e));
    if (e.side === 'player') this.onToast('BREAKING', `${e.name} has had enough`, 'bad');
  }

  /** A routing body: no fighting, just distance. Off the field, it is gone. */
  updateRouting(dt, e) {
    const rp = e.routPoint;
    if (!rp) { e.routing = false; return; }
    this.moveToward(dt, e, rp.x, rp.z, e.speed * 1.25);
    this.faceMotion(e, dt);
    const edge = (this.level.bounds || Level.BOUNDS) - 6;
    if (Math.abs(e.x) > edge || Math.abs(e.z) > edge) {
      e.fled = true;
      e.dead = true;                          // off the board, not killed
      if (e.char?.group) e.char.group.visible = false;
    }
  }

  /**
   * Has a side stopped being an army? A fight ends when one side breaks,
   * not when the last man on it is hunted down.
   */
  checkRout() {
    if (this.over || this.routCalled) return;
    let standing = 0, total = 0;
    for (const e of this.entities) {
      if (e.dead || e.isTitan || e.follower || e.side !== 'enemy') continue;
      total++;
      if (!e.down && !e.routing) standing++;
    }
    const reserves = (this.skirmishTotal || 0) - (this.skirmishCommitted || 0);
    if (total >= 4 && reserves <= 0 && standing === 0) {
      this.routCalled = true;
      this.onToast('THE FIELD IS YOURS', 'What is left of them is running', 'good');
      for (const e of this.entities) {
        if (e.side === 'enemy' && !e.dead && !e.routing) this.breakEntity(e);
      }
    }
  }

  /** The commander's wind: swings and sprint spend it, standing still buys it back. */
  updateStamina(dt, sprinting) {
    if (sprinting) this.pStamina = Math.max(0, this.pStamina - dt * 0.1);
    else this.pStamina = Math.min(1, this.pStamina + dt * 0.25);
  }

  /** Read the swing direction off recent hand motion. */
  swingDirFromMouse() {
    const { x, y } = this.mouseVel;
    if (Math.abs(y) > Math.abs(x) * 1.4) return y < 0 ? 'overhead' : 'thrust';
    return x < 0 ? 'left' : 'right';
  }

  /**
   * The kick: not a killer, a can-opener. Breaks a guard at boot range so
   * the next swing lands on somebody, and shoves them half a step.
   */
  kick(e) {
    if (e.cooldown > 0.2 || e.swing) return;
    e.cooldown = Math.max(e.cooldown, 0.5);
    let best = null, bd = Infinity;
    for (const t of this.entities) {
      if (t === e || t.dead || t.side === e.side || t.isTitan) continue;
      const d = Math.hypot(t.x - e.x, t.z - e.z);
      if (d > 1.5) continue;
      if (Math.abs(angleDelta(Math.atan2(t.x - e.x, t.z - e.z), e.yaw)) > 0.9) continue;
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return;
    best.guardBreak = 0.9;                  // the guard means nothing for a beat
    best.guard = 0;
    const d = Math.max(0.001, bd);
    const px = (best.x - e.x) / d, pz = (best.z - e.z) / d;
    const nx = best.x + px * 0.7, nz = best.z + pz * 0.7;
    const rm = Level.resolveMove(this.level.obstacles, best.x, best.z, nx, nz,
      Level.heightAt(best.x, best.z) + (best.elev || 0));
    best.x = rm.x; best.z = rm.z;
    best.char.flinch();
    Audio.impact('body', this.relPos(best));
  }

  /** Fire one round from `e` toward a world point. */
  fire(e, tx, ty, tz, spreadScale = 1) {
    const w = e.weapon;
    if (!w || e.reloading > 0 || e.cooldown > 0) return;
    // Gated here rather than at each AI branch so nothing that arrives can
    // shoot on its first frame, whichever behaviour is driving it.
    if (e.arriving > 0) return;
    // A bow is not a gun with a slow trigger: the arrow is a real body in
    // flight, and everything after the loose belongs to updateArrows.
    if (w.bow) {
      e.cooldown = 60 / w.rpm + this.r() * 0.8;
      e.char.kick();
      this.looseArrow(e, tx, ty, tz);
      Audio.bowshot(this.relPos(e));
      this.raiseAlarm(e, e.target || { x: tx, z: tz });
      return;
    }
    if (e.ammo <= 0) {
      if (e.isPlayer) Audio.dryFire();
      this.tryReload(e);
      return;
    }
    e.ammo--;
    e.cooldown = 60 / w.rpm;
    e.char.kick();
    if (e.isPlayer) {
      this.stats.shotsFired++;
      // The gun has weight: a small pitch kick with jitter, recovered by the
      // camera spring, and a breath of shake. Enough to feel every round
      // leave; never enough to fight the player's aim for them.
      this.camPitch = clamp(this.camPitch - (0.009 + this.r() * 0.005), -0.62, 0.72);
      this.camYaw += (this.r() - 0.5) * 0.005;
      this.shake = Math.min(0.3, (this.shake || 0) + 0.05);
    }
    // Per-entity round count. The mission-wide stat above is the player's only,
    // because that is what the debrief reports; the probes need to know whether
    // an individual soldier is shooting. tools/aiaudit.mjs read e.shotsFired
    // from the day it was written and nothing ever wrote it, so its
    // "clear shot, not taking it" check compared 0 > 0 and every soldier with
    // line of sight scored as idle. It reported a pathology that was never there.
    e.shotsFired = (e.shotsFired || 0) + 1;

    const muzzle = new THREE.Vector3(e.x,
      Level.heightAt(e.x, e.z) + (e.elev || 0) + CHEST + 0.22, e.z);
    if (e.isPlayer) {
      // Fire from the camera so what the crosshair covers is what gets hit;
      // the tracer still starts at the muzzle so it reads correctly.
      this.camera.getWorldPosition(muzzle);
    }
    const base = new THREE.Vector3(tx - muzzle.x, ty - muzzle.y, tz - muzzle.z).normalize();

    const pellets = w.pellets || 1;
    // Being shot at spoils the player's aim too — suppression is not a penalty
    // that only applies to the AI.
    const spread = (this.aiming && e.isPlayer ? w.adsSpread : w.spread)
      * spreadScale / (e.isPlayer ? this.suppressionPenalty(e) : 1)
      // A braced, crouched shot is a genuinely steadier one; a shot taken in
      // mid-air is not a shot, it is a hope.
      * (e.isPlayer ? (1 - this.crouch * 0.34) * (this.grounded ? 1 : 1.9) : 1);
    for (let i = 0; i < pellets; i++) {
      const dir = base.clone();
      dir.x += (this.r() - 0.5) * spread * 2;
      dir.y += (this.r() - 0.5) * spread * 2;
      dir.z += (this.r() - 0.5) * spread * 2;
      dir.normalize();
      const hit = this.rayHit(muzzle, dir, w.range * 1.6, e);
      this.spawnTracer(e, hit);
      if (hit.entity) this.applyDamage(hit.entity, w.damage, e, hit);
      else if (hit.kind === 'solid' || hit.kind === 'ground') {
        this.spawnImpact(hit, hit.kind === 'solid' ? 'metal' : 'dirt');
      }
      // Every round suppresses whatever it passes close to, hit or miss. This
      // is what turns a firefight into something you can manoeuvre inside:
      // pin one element with fire, move on it with another.
      this.applySuppression(e, muzzle.x, muzzle.z, hit.x, hit.z);
    }
    this.spawnMuzzleFlash(e);
    Audio.shot(w.id, e.isPlayer ? null : this.relPos(e));
    // Everyone nearby on the shooter's side hears it and comes looking. The
    // place they head for is where the shot was aimed, not where the target is
    // now — sound tells you a direction, not a position.
    this.raiseAlarm(e, e.target || { x: tx, z: tz });

    if (e.isPlayer) {
      // Recoil is applied to the camera, then recovers. Enough to disturb aim,
      // never enough to lose the target.
      this.camPitch = clamp(this.camPitch + w.recoil * 0.0075 * (this.aiming ? 0.6 : 1), -0.72, 0.62);
      this.camYaw += (this.r() - 0.5) * w.recoil * 0.004;
      this.shake = Math.min(0.5, (this.shake || 0) + w.recoil * 0.05);
    }
    if (e.ammo === 0) this.tryReload(e);
  }

  /**
   * Add suppression to anyone the shot passed near. Distance is measured to
   * the shot's line, so a burst walked across a position pins everyone behind
   * it rather than only the person who was aimed at.
   */
  applySuppression(shooter, ax, az, bx, bz) {
    // Enemies only break — stop advancing, abandon their doctrine, dive for
    // cover — above 0.45 suppression, and ordinary aimed fire tops out right
    // around there. So the ORDER has to be the thing that carries them over the
    // line, otherwise it is a 10% damage tweak nobody can feel. Measured over
    // 16 paired trials with tools/tactics.mjs.
    const power = (shooter.eff?.suppressPower || 1) * (shooter.suppressOrder ? 2.1 : 1)
      // Okkam's base of fire: the squad's rounds pin harder. Squad only —
      // the player's own fire is the player's own skill.
      * (shooter.side === 'player' && !shooter.isPlayer && this.officerFx?.baseFire ? 1.35 : 1);
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 0.01) return;
    for (const o of this.entities) {
      if (o === shooter || o.dead || o.down || o.follower) continue;
      // You cannot make a walker flinch.
      if (o.isTitan) continue;
      if (o.side === shooter.side) continue;
      // Closest approach of the segment to this entity.
      let t = ((o.x - ax) * dx + (o.z - az) * dz) / len2;
      t = clamp(t, 0, 1);
      const cx = ax + dx * t, cz = az + dz * t;
      const d = Math.hypot(o.x - cx, o.z - cz);
      if (d > 3.2) continue;
      const resist = o.eff?.suppressResist || 0;
      const add = (1 - d / 3.2) * 0.16 * power * (1 - resist);
      o.suppression = clamp((o.suppression || 0) + add, 0, 1);
      if (o.isPlayer) this.shake = Math.min(0.5, (this.shake || 0) + add * 0.5);
    }
  }

  /** How badly this entity's aim is degraded right now. */
  suppressionPenalty(e) {
    return 1 - (e.suppression || 0) * 0.75;
  }

  /** World position of a plate's mount, or null if the rig is not ready. */
  platePos(pl) {
    if (!pl?.mount) return null;
    const v = pl._v || (pl._v = new THREE.Vector3());
    pl.mount.getWorldPosition(v);
    return v;
  }

  /**
   * Damage against the walker. Armour is not a damage multiplier, it is a gate:
   * hits on a plate barely scratch the machine but wear the plate itself down,
   * and only once the plate is gone does anything reach the core.
   */
  damageTitan(e, dmg, source, hit) {
    const pl = hit?.plate || null;

    if (pl && !pl.broken) {
      pl.hp -= dmg;
      this.spawnImpact(hit, 'metal');
      // Almost nothing gets through intact armour. It has to be almost nothing
      // rather than nothing, or a player with no idea what to do never learns
      // that they are hitting the wrong thing.
      e.hp -= dmg * 0.04;
      if (pl.hp <= 0) this.breakPlate(e, pl, source);
      return;
    }

    if (pl && pl.broken) {
      // The whole point. A core hit is worth roughly eight plate hits.
      const crit = dmg * 3.4;
      e.hp -= crit;
      this.spawnImpact(hit, 'flesh');
      this.shake = Math.min(0.7, (this.shake || 0) + 0.16);
      if (source?.isPlayer) this.onToast('', 'CRITICAL — CORE HIT', 'kill');
      if (e.hp <= 0) this.killTitan(e, source);
      return;
    }

    // The hull between the plates: thick, and not where the fight is won.
    e.hp -= dmg * 0.10;
    this.spawnImpact(hit, 'metal');
    if (e.hp <= 0) this.killTitan(e, source);
  }

  breakPlate(e, pl, source) {
    pl.broken = true;
    pl.hp = 0;
    pl.slab.visible = false;
    pl.core.visible = true;
    e.platesLeft = Math.max(0, e.platesLeft - 1);
    Audio.explosion(this.relPos(e));
    this.shake = Math.min(0.9, (this.shake || 0) + 0.45);
    if (source?.isPlayer || source?.side === 'player') {
      this.onToast('ARMOUR BREACHED', `${pl.id.replace('_', ' ').toUpperCase()} — put rounds through it`, 'good');
    }
    // A visible slab of armour falling off is the clearest possible feedback
    // that the player has found the right thing to do.
    const wp = this.platePos(pl);
    if (wp) {
      const slab = Models.get('titan_plate');
      slab.position.copy(wp);
      slab.rotation.set(this.r() * 0.5, this.r() * 6.28, this.r() * 0.5);
      this.scene.add(slab);
      this.effects.push({
        mesh: slab, life: 6, max: 6, kind: 'debris',
        vx: (this.r() - 0.5) * 5, vy: 3 + this.r() * 2, vz: (this.r() - 0.5) * 5,
        spin: (this.r() - 0.5) * 4,
      });
    }
  }

  killTitan(e, source) {
    if (e.dead) return;
    e.dead = true;
    e.down = true;
    e.hp = 0;
    this.stats.kills++;
    if (source?.isPlayer) this.stats.titanKills = (this.stats.titanKills || 0) + 1;
    for (let i = 0; i < 5; i++) {
      const wp = this.platePos(e.plates[i % e.plates.length]);
      if (wp) this.spawnImpact({ x: wp.x, y: wp.y, z: wp.z }, 'metal');
    }
    Audio.explosion(this.relPos(e));
    this.shake = 1.4;
    this.onToast('TITAN DOWN', 'It is not getting up', 'kill');
  }

  applyDamage(target, dmg, source, hit) {
    if (target.dead) return;
    // The walker resolves damage by where it was hit, not by how much health it
    // has left — see damageTitan.
    if (target.isTitan) { this.damageTitan(target, dmg, source, hit); return; }
    // Friendly fire is real but heavily reduced — full-strength friendly fire
    // in a squad game with AI this simple is just frustrating.
    if (target.side === source.side && !source.isPlayer) return;
    if (target.side === source.side && source.isPlayer) dmg *= 0.35;

    // The tactical camera's B key needs to know where the war currently is.
    this.lastCombat = { x: target.x, z: target.z, t: this.time };

    // Squads PIN, the player BREAKS. Friendly fire against an enemy who is
    // DUG IN trades at reduced damage — suppression at full strength — so an
    // exchange with an emplaced line is a firefight that HOLDS, and the shots
    // that dig them out are the ones the player aims. Enemies caught moving
    // in the open still take full damage: squads mow down a rush, they just
    // cannot win a siege. (A flat AI-on-AI cut was tried first and failed the
    // balance probe — it also cut the attrition on hostiles CLOSING across
    // open ground, so more of them arrived at knife range alive.)
    if (!source.isPlayer && source.side === 'player' && target.side === 'enemy') {
      const cp = target.coverPos;
      const dug = cp && Math.hypot(target.x - cp.x, target.z - cp.z) < 1.4;
      if (dug) dmg *= 0.6;
    }
    if (source.side === 'enemy' && target.side === 'player' && !target.isPlayer) dmg *= 0.7;

    // A headshot-ish band, rewarded but not a one-shot rule.
    const headY = Level.heightAt(target.x, target.z) + 1.62;
    if (hit && Math.abs(hit.y - headY) < 0.18) dmg *= 1.85;
    // Close Quarters perk.
    const cq = source.eff?.closeDmg || 0;
    if (cq && Math.hypot(target.x - source.x, target.z - source.z) < 12) dmg *= 1 + cq;

    target.hp -= dmg;
    target.char.flinch();
    this.spawnImpact(hit, 'flesh');
    // The answer to "did I hit": a tick on the reticle and a centred thock,
    // distinct from the 3D-panned impact at the body. Point-and-click feel
    // is mostly the QUESTION going unanswered.
    if (source.isPlayer && target.side === 'enemy') {
      this.hitAt = this.time;
      Audio.impact('flesh', null);
    }
    if (target.side === 'enemy') target.alert = 1;

    // Being shot at makes the AI react even if it was looking elsewhere.
    if (!target.target && source !== target) target.target = source;

    if (target.hp <= 0) this.downEntity(target, source);
    else if (target.isPlayer) {
      this.hurtFlash = 1;
      this.shake = Math.min(0.8, (this.shake || 0) + 0.25);
      // Which way it came from.
      //
      // A full-screen red flash says you are being shot and nothing else. Five
      // rifle rounds kill you, and a firefight is decided in a handful of
      // seconds — so a player who cannot tell which side the fire is coming
      // from cannot choose a wall to get behind, and being killed by something
      // you were never given the information to answer is the difference
      // between hard and unfair.
      this.hurtFrom = this.hurtFrom || [];
      this.hurtFrom.push({
        // World bearing from the player to whoever fired.
        a: Math.atan2(source.x - target.x, source.z - target.z),
        t: this.time,
        dmg,
      });
      if (this.hurtFrom.length > 6) this.hurtFrom.shift();
    }
  }

  /**
   * What a dead man leaves on the ground.
   *
   * Looting barely existed: spoils were a number computed after the fact from
   * the party you beat, so the field itself was worthless and there was never a
   * reason to cross it. A body that drops the rifle it was firing turns a
   * cleared position into somewhere worth walking, and turns a hard fight
   * against a well-equipped enemy into a way to equip yourself.
   *
   * Deliberately not everything: most men leave their weapon and little else,
   * so the field reads as scavenging rather than as a vending machine.
   */
  dropLoot(e) {
    const drops = [];
    if (e.weapon?.id && this.r() < 0.55) drops.push({ kind: 'armoury', id: e.weapon.id });
    if (this.r() < 0.16) {
      drops.push({ kind: 'armourPool', id: pick(this.r, ARMOUR_LIST) });
    }
    if (this.r() < 0.10) drops.push({ kind: 'kitPool', id: pick(this.r, Object.keys(KIT)) });
    if (this.r() < 0.5) {
      drops.push({ kind: 'credits', id: null, n: irange(this.r, 8, 26) });
    }
    if (!drops.length) return;

    const g = new THREE.Group();
    const box = Models.get('crate');
    box.scale.setScalar(0.5);
    g.add(box);
    g.position.set(e.x, Level.heightAt(e.x, e.z) + 0.1, e.z);
    this.scene.add(g);
    this.fieldLoot.push({ x: e.x, z: e.z, drops, mesh: g, taken: false });
  }

  /**
   * Pick up anything the player walks over.
   *
   * Automatic rather than a prompt: in the middle of a firefight, stopping to
   * press a key over each body is friction with no decision in it. The decision
   * is whether to cross the ground at all.
   */
  updateLoot(dt) {
    if (!this.player || this.player.down) return;
    for (const l of this.fieldLoot) {
      if (l.taken) continue;
      if (Math.hypot(l.x - this.player.x, l.z - this.player.z) > 2.4) continue;
      l.taken = true;
      if (l.mesh) { this.scene.remove(l.mesh); l.mesh = null; }
      const words = [];
      for (const d of l.drops) {
        if (d.kind === 'credits') {
          this.loot.credits += d.n;
          words.push(`${d.n} credits`);
        } else {
          this.loot[d.kind] = this.loot[d.kind] || {};
          this.loot[d.kind][d.id] = (this.loot[d.kind][d.id] || 0) + 1;
          words.push(WEAPONS[d.id]?.abbr || ARMOUR[d.id]?.abbr || KIT[d.id]?.abbr || d.id);
        }
      }
      this.stats.looted = (this.stats.looted || 0) + 1;
      Audio.uiSelect();
      this.onToast('TAKEN', words.join(' · '), 'good');
    }
  }

  downEntity(e, source) {
    if (e.down || e.dead) return;
    e.hp = 0;
    // Everybody close enough to see it lose their nerve a little. This is
    // the signal updateMorale reads — a line breaks because of what the
    // people in it watched happen, not because of a global counter.
    for (const o of this.entities) {
      if (o === e || o.dead || o.down || o.side !== e.side) continue;
      if (Math.hypot(o.x - e.x, o.z - e.z) < 14) {
        o.casualtySeen = (o.casualtySeen || 0) + 1;
      }
    }

    if (e.side === 'enemy') {
      // Enemies are simply killed. Persistence is a player-side concept.
      e.dead = true;
      e.down = true;
      if (source === this.player) this.stats.kills++;
      if (source?.soldier) source.killCount = (source.killCount || 0) + 1;
      if (source?.isPlayer) this.onToast('', 'HOSTILE DOWN', 'kill');
      Audio.impact('flesh', this.relPos(e));
      this.dropLoot(e);
      return;
    }

    // Player-side: incapacitated, with a timer. This is the tension engine.
    e.down = true;
    e.bleed = BLEED_OUT * (e.eff?.bleedMul || 1);
    e.bleedMax = e.bleed;
    e.order = 'hold';
    Audio.casualtyTone();
    if (e.isPlayer) {
      if (this.spec.type === 'pit') {
        // Nobody dies in the pit. You are dragged out and the crowd moves on.
        this.onToast('PUT DOWN', `You lasted ${this.pitRound} round(s)`, 'bad');
        this.endMission(false, 'pit');
        return;
      }
      this.onToast('COMMANDER DOWN', 'Bracket is breaking contact', 'bad');
      this.endMission(false, 'commander');
    } else {
      this.onToast('CASUALTY', `${e.name} is down — reach them`, 'bad');
    }
  }

  // ======================================================================
  // Effects
  // ======================================================================

  spawnTracer(e, hit) {
    const from = new THREE.Vector3(e.x, Level.heightAt(e.x, e.z) + CHEST + 0.25, e.z);
    if (e.char.weapon) e.char.weapon.getWorldPosition(from);
    const to = new THREE.Vector3(hit.x, hit.y, hit.z);
    const len = from.distanceTo(to);
    if (len < 0.4) return;
    const m = new THREE.Mesh(Models.GEO.tracer, Models.MAT.tracer.clone());
    m.scale.set(1, 1, Math.min(len, 14));
    m.position.copy(from).lerp(to, Math.min(1, 7 / len) * 0.5);
    m.lookAt(to);
    this.scene.add(m);
    this.effects.push({ mesh: m, life: 0.06, max: 0.06, kind: 'tracer', from, to, speed: 220, len });
  }

  spawnMuzzleFlash(e) {
    const m = new THREE.Mesh(Models.GEO.flash, Models.MAT.muzzle.clone());
    const p = new THREE.Vector3();
    if (e.char.weapon) e.char.weapon.getWorldPosition(p);
    else p.set(e.x, Level.heightAt(e.x, e.z) + CHEST, e.z);
    m.position.copy(p);
    m.rotation.set(Math.PI / 2, 0, this.r() * 6.28);
    m.scale.setScalar(0.8 + this.r() * 0.5);
    this.scene.add(m);
    this.effects.push({ mesh: m, life: 0.045, max: 0.045, kind: 'flash' });

    const l = new THREE.PointLight(0xffb45a, 3.2, 11);
    l.position.copy(p);
    this.scene.add(l);
    this.effects.push({ mesh: l, life: 0.05, max: 0.05, kind: 'light' });
  }

  spawnImpact(hit, kind) {
    if (!hit) return;
    const mat = kind === 'flesh' ? Models.MAT.blood : Models.MAT.spark;
    for (let i = 0; i < (kind === 'flesh' ? 4 : 5); i++) {
      const m = new THREE.Mesh(Models.GEO.bit, mat.clone());
      m.position.set(hit.x, hit.y, hit.z);
      this.scene.add(m);
      this.effects.push({
        mesh: m, life: 0.42, max: 0.42, kind: 'bit',
        vx: (this.r() - 0.5) * 5, vy: this.r() * 4 + 1, vz: (this.r() - 0.5) * 5,
      });
    }
    Audio.impact(kind, this.player ? { x: hit.x - this.player.x, z: hit.z - this.player.z } : null);
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const f = this.effects[i];
      f.life -= dt;
      if (f.kind === 'bit') {
        f.vy -= 15 * dt;
        f.mesh.position.x += f.vx * dt;
        f.mesh.position.y += f.vy * dt;
        f.mesh.position.z += f.vz * dt;
        f.mesh.material.opacity = Math.max(0, f.life / f.max);
      } else if (f.kind === 'tracer') {
        f.mesh.material.opacity = Math.max(0, f.life / f.max) * 0.9;
      } else if (f.kind === 'flash') {
        f.mesh.scale.multiplyScalar(1 + dt * 9);
        f.mesh.material.opacity = Math.max(0, f.life / f.max);
      } else if (f.kind === 'light') {
        f.mesh.intensity = Math.max(0, f.life / f.max) * 3.2;
      } else if (f.kind === 'debris') {
        // Shed armour tumbles, lands, and stays for the rest of the fight. It
        // is the scoreboard: a Titan surrounded by its own plating is a Titan
        // that is nearly finished.
        f.vy -= 16 * dt;
        f.mesh.position.x += f.vx * dt;
        f.mesh.position.y += f.vy * dt;
        f.mesh.position.z += f.vz * dt;
        f.mesh.rotation.z += f.spin * dt;
        const floor = Level.heightAt(f.mesh.position.x, f.mesh.position.z) + 0.25;
        if (f.mesh.position.y <= floor) {
          f.mesh.position.y = floor;
          f.vx = 0; f.vy = 0; f.vz = 0; f.spin = 0;
          f.mesh.rotation.x = Math.PI / 2;
        }
      }
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.material?.dispose?.();
        this.effects.splice(i, 1);
      }
    }
  }

  // ======================================================================
  // Player update
  // ======================================================================

  updatePlayer(dt) {
    const p = this.player;
    if (p.down || this.over) return;
    // No control during the insertion cinematic.
    if (this.intro?.active) { p.moveSpeed = 0; this.aiming = false; return; }

    // A standing move order from the tactical board. Manual input always
    // wins the argument — touching WASD in the shoulder view cancels it.
    const manual = ['w', 'a', 's', 'd'].some((k) => this.keys.has(k));
    if (manual && !this.rts) {
      this.playerAuto = null;
      p.path = null;
      p.pathGoal = null;
    }
    if (this.playerAuto) {
      const t = this.playerAuto;
      const dist = Math.hypot(t.x - p.x, t.z - p.z);
      if (dist < 1.2) {
        this.playerAuto = null;
        p.moveSpeed = 0;
        p.path = null;
        p.pathGoal = null;
      } else {
        // The squad's navigation, not a straight line: the commander routes
        // around buildings exactly the way a squaddie does — A* when the
        // line is blocked, corners hugged, local avoidance — instead of
        // rubbing along every wall between here and there.
        const eff2 = effective(p.soldier);
        this.moveToward(dt, p, t.x, t.z, eff2.speed);
        this.faceMotion(p, dt);
      }
    }
    // The tactical view commands; it does not aim, walk, or pull triggers
    // FOR the commander — but the commander is not a mannequin while you are
    // up there. They hold their own ground squaddie-fashion: face the
    // nearest thing shooting at them and return fire through the same AI
    // path the rest of the company uses. Standing inert made switching to
    // tactical mid-firefight a free kill on you.
    if (this.rts) {
      this.aiming = false;
      if (!this.playerAuto) p.moveSpeed = 0;
      // How far the commander will look for somebody to answer. A gun's
      // range is its own answer; STEEL's range is its reach, and using that
      // meant a swordsman commander searched two metres and quietly stood
      // there being killed in tactical view. Melee looks a body's length of
      // ground around itself and lets the movement layer close the rest.
      let foe = null;
      let fd = p.weapon?.melee ? 14 : (p.weapon?.range || 30) * 1.1;
      for (const e of this.entities) {
        if (e.side !== 'enemy' || e.dead || e.down) continue;
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        if (d < fd) { fd = d; foe = e; }
      }
      if (foe && !p.down) {
        if (!this.playerAuto) {
          p.yaw = approachAngle(p.yaw, Math.atan2(foe.x - p.x, foe.z - p.z), dt * 6);
        }
        this.aiShoot(dt, p, foe, fd);
      }
      if (p.reloading > 0) {
        p.reloading -= dt;
        if (p.reloading <= 0) { p.ammo = p.weapon.mag; p.reloading = 0; }
      }
      p.cooldown = Math.max(0, p.cooldown - dt);
      return;
    }

    this.updateStance(dt);
    this.aiming = this.mouse.right;
    this.updateCover(dt);
    // You cannot sprint from a crouch or in mid-air — and with steel in
    // hand, not on an empty tank either. One wind pays for swings and
    // sprints both, which is what makes a charge a decision.
    const sprint = this.keys.has('shift') && !this.aiming
      && this.crouch < 0.3 && this.grounded
      && !(p.weapon?.melee && this.pStamina <= 0.05);
    if (p.weapon?.melee) this.updateStamina(dt, sprint);

    let mx = 0, mz = 0;
    if (this.keys.has('w')) mz += 1;
    if (this.keys.has('s')) mz -= 1;
    if (this.keys.has('a')) mx -= 1;
    if (this.keys.has('d')) mx += 1;
    const mag = Math.hypot(mx, mz);

    const eff = effective(p.soldier);
    let speed = eff.speed;
    if (this.aiming) speed *= 0.48;
    else if (sprint) speed *= 1.5;
    // Crouching costs most of your speed — that is the trade for the steadier
    // aim and the smaller silhouette.
    speed *= 1 - this.crouch * 0.58;
    // Limited air control: enough to clear what you jumped at, not enough to
    // steer in flight.
    if (!this.grounded) speed *= 0.72;
    if (mag > 0) {
      mx /= mag; mz /= mag;
      // Movement is camera-relative, which is what every player expects.
      const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
      let wx = mx * cos - mz * sin;
      let wz = -mx * sin - mz * cos;
      if (this.cover) {
        // In cover you move along the wall, not through it. Pushing away from
        // the face is how you get out, and that is handled in updateCover — so
        // here the outward component is simply dropped and the along-the-face
        // component kept, which is what makes sliding down a barricade feel
        // like sliding rather than like fighting the controls.
        const { nx, nz } = this.cover;
        if (nx) wx = 0; else wz = 0;
        speed *= 0.72;
      }
      const nx = p.x + wx * speed * dt;
      const nz = p.z + wz * speed * dt;
      // Feet are passed in so anything you are standing on stops being a wall.
      const res = Level.resolveMove(this.level.obstacles, p.x, p.z, nx, nz,
        Level.heightAt(p.x, p.z) + this.airY);
      const b = this.level.bounds;
      p.x = clamp(res.x, -b, b);
      p.z = clamp(res.z, -b, b);
      p.moveSpeed = speed;
    } else if (!this.playerAuto) {
      p.moveSpeed = 0;
    }

    // Body turns to face where the camera looks. When not aiming, it lags,
    // which stops the character snapping around under the camera. A standing
    // tactical order owns the body until it arrives — it faces its path.
    if (!this.playerAuto) {
      const targetYaw = this.camYaw + Math.PI;
      p.yaw = this.aiming ? targetYaw : approachAngle(p.yaw, targetYaw, dt * 7);
    }

    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) {
        p.ammo = p.weapon.mag;
        p.reloading = 0;
      }
    }
    p.cooldown = Math.max(0, p.cooldown - dt);

    if (p.weapon?.melee) {
      // The melee era: LMB throws a swing whose direction is read off the
      // hand, RMB is the guard, and the guard means nothing mid-swing or
      // for a beat after taking a boot.
      this.updateSwing(dt, p);
      if (p.guardBreak > 0) p.guardBreak -= dt;
      p.guard = (this.mouse.right && !p.swing && !(p.guardBreak > 0)) ? 1 : 0;
      if (this.mouse.down && !this.paused) {
        if (!this.firedThisClick && p.cooldown <= 0) {
          // The body commits to the camera's facing the moment steel moves.
          p.yaw = this.camYaw + Math.PI;
          this.strike(p, this.swingDirFromMouse());
          this.firedThisClick = true;
        }
      } else {
        this.firedThisClick = false;
      }
      this.mouseVel.x *= 0.82; this.mouseVel.y *= 0.82;
    } else if (this.mouse.down && !this.paused) {
      const w = p.weapon;
      if (w.auto || !this.firedThisClick) {
        if (p.cooldown <= 0) {
          const aim = this.aimPoint(w.range * 1.6);
          this.fire(p, aim.x, aim.y, aim.z);
          this.firedThisClick = true;
        }
      }
    } else {
      this.firedThisClick = false;
    }

    this.updateInteraction(dt);
    this.updateLoot(dt);
  }

  updateInteraction(dt) {
    const p = this.player;
    let nearest = null, nd = 2.6;

    for (const it of this.interactables) {
      if (it.done || it.taken) continue;
      const ix = it.entity ? it.entity.x : it.x;
      const iz = it.entity ? it.entity.z : it.z;
      const d = Math.hypot(p.x - ix, p.z - iz);
      if (d < nd) { nd = d; nearest = it; }
    }
    // Downed friends are always interactable, and take priority — the player
    // should never be fighting the UI while someone is bleeding out.
    for (const e of this.entities) {
      // Held personnel can be stabilised too — losing one you came to rescue
      // because you could not reach them is a far better beat than losing one
      // to a rule that says civilians cannot be helped.
      if (e.side !== 'player' && e.side !== 'civil') continue;
      if (!e.down || e.dead || e.stabilised || e.isPlayer) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < 2.8) { nd = 0; nearest = { kind: 'revive', entity: e, need: 2.2, progress: e.reviveProg || 0 }; }
    }

    this.nearInteract = nearest;
    if (!nearest) { this.interactProgress = 0; return; }

    if (this.keys.has('e')) {
      const rate = nearest.kind === 'revive' ? this.bestSquadStat('reviveSpeed')
        : this.bestSquadStat('interactSpeed')
          * (this.squadHasRole('signals') ? 2 : 1);
      nearest.progress = (nearest.progress || 0) + dt * rate;
      if (nearest.kind === 'revive') nearest.entity.reviveProg = nearest.progress;
      this.interactProgress = clamp(nearest.progress / nearest.need, 0, 1);
      if (nearest.progress >= nearest.need) this.completeInteraction(nearest);
    } else {
      // Progress decays rather than resetting, so being interrupted by fire
      // is a setback, not a punishment.
      nearest.progress = Math.max(0, (nearest.progress || 0) - dt * 0.6);
      if (nearest.kind === 'revive') nearest.entity.reviveProg = nearest.progress;
      this.interactProgress = clamp(nearest.progress / nearest.need, 0, 1);
    }
  }

  squadHasRole(role) {
    return this.squad.some((s) => !s.dead && !s.down && s.soldier && s.soldier.role === role);
  }

  /** Best value of an `effective()` stat across everyone still on their feet. */
  bestSquadStat(key) {
    let best = 1;
    for (const e of [this.player, ...this.squad]) {
      if (e.dead || e.down || !e.eff) continue;
      best = Math.max(best, e.eff[key] || 1);
    }
    return best;
  }

  completeInteraction(it) {
    it.progress = 0;
    if (it.kind === 'revive') {
      const e = it.entity;
      // A Combat Medic in the squad sometimes patches someone up out of their
      // own pockets — which is what makes that perk worth a promotion.
      const medic = [this.player, ...this.squad].find(
        (m) => !m.dead && !m.down && m.eff && m.soldier
          && (m.soldier.perks || []).includes('combat_medic'));
      const free = medic && this.r() < 0.4;
      if (!free && this.S.medical <= 0) {
        this.onToast('NO KITS', 'Out of medical supplies', 'bad');
        return;
      }
      if (free) {
        this.onToast('FIELD IMPROVISED', `${medic.name} made do without a kit`, 'good');
      } else {
        this.S.medical--;
        this.stats.medkitsUsed++;
      }
      e.down = false;
      e.stabilised = true;
      e.hp = Math.round(e.maxHp * 0.3);
      e.bleed = 0;
      e.order = this.squadOrder;
      // A stabilised prisoner is on their feet and counts as recovered.
      if (e.side === 'civil') { e.released = true; this.updateRecovery(); }
      Audio.uiSelect();
      this.onToast('STABILISED', `${e.name} is back on their feet`, 'good');
      return;
    }
    if (it.kind === 'prisoner') {
      it.done = true;
      const e = it.entity;
      e.released = true;
      e.follower = true;
      e.name = e.isMedic ? 'Trained medic' : 'Freed worker';
      Audio.uiSelect();
      if (e.isMedic) {
        this.onToast('PERSONNEL RELEASED',
          'One of them is a trained field medic', 'good');
      } else {
        this.onToast('PERSONNEL RELEASED', 'One of them is on their feet', 'good');
      }
      // Progress is recomputed from who is actually alive rather than counted
      // up — see updateRecovery.
      this.updateRecovery();
      return;
    }
    if (it.kind === 'charge') {
      it.done = true;
      this.chargesPlaced = true;
      this.chargeTimer = 75;
      // Each charge brings its own explosion. `blown` latches after the first
      // blast, and a heavy sabotage now places a second charge — which would
      // otherwise be a dud with a countdown.
      this.blown = false;
      Audio.uiAlert();
      this.onToast('CHARGES SET', 'Seventy-five seconds. Get clear.', 'bad');
      this.completeObjective();
      // The whole garrison now knows exactly where you are.
      for (const e of this.entities) {
        if (e.side === 'enemy' && !e.dead) {
          this.sendHunting(e, this.player.x, this.player.z, 45);
          e.target = this.player;
        }
      }
      this.spawnReinforcements(4);
      return;
    }
    if (it.kind === 'breach') {
      it.done = true;
      if (it.culvert) this.blowCulvert(it);
      else this.blowGate();
      return;
    }
    if (it.kind === 'loot') {
      it.taken = true;
      it.done = true;
      this.scene.remove(it.mesh);
      this.raidTaken = (this.raidTaken || 0) + 1;
      Audio.uiSelect();
      this.onToast('STORE BROKEN OPEN',
        `${this.raidTaken} of ${this.objective.need}`, 'good');
      // Robbing people in their own street brings the street out.
      this.spawnReinforcements(3);
      for (const e of this.entities) {
        if (e.side === 'enemy' && !e.dead) this.sendHunting(e, this.player.x, this.player.z, 30);
      }
      this.updateRaid();
      return;
    }
    if (it.kind === 'cache') {
      it.taken = true;
      this.cacheTaken = true;
      this.scene.remove(it.mesh);
      Audio.uiSelect();
      this.onToast('CACHE RECOVERED', 'Salvage secured', 'good');
      return;
    }
    if (it.kind === 'area') {
      // Not `done` — a market is not used up by shopping at it. Progress
      // resets so walking off and coming back starts the hold-E fresh.
      it.progress = 0;
      Audio.uiSelect();
      this.onArea?.(it.area);
      return;
    }
    if (it.kind === 'leave') {
      // Through the gate watch's chat when the shell is listening — leaving
      // is a word with somebody, like everything else in town. The direct
      // end remains for a Mission driven without a shell (tests, probes).
      if (this.onArea) {
        it.progress = 0;
        Audio.uiSelect();
        this.onArea('gate');
        return;
      }
      it.done = true;
      this.endMission(true, 'left');
    }
  }

  /**
   * Big work is more than one thing.
   *
   * Every deployment used to be a single task followed by a walk to the
   * extraction, whatever it paid — so a sixty-strong assault had the same shape
   * as clearing a roadside camp, and the money was the only thing that scaled.
   * A heavy contract now runs in stages: finish the first and the next one
   * opens where you are standing, and extraction only arms when the last is
   * done.
   *
   * Stages are generated from what the site already has rather than authored
   * per mission, so any layout can carry them.
   */
  buildStages() {
    const weight = this.spec.party?.strength || 0;
    // Only work heavy enough to be worth a second trip across the ground.
    // Only the open-field contracts. A hideout, a siege, a seizure and a raid
    // each have a shape of their own — clearing a camp and then being told to
    // go and hold a crossing reads as two missions stapled together, and the
    // hideout's own completion logic owns its objective.
    const STAGED = ['skirmish', 'sabotage', 'recovery'];
    if (weight < 26 || !STAGED.includes(this.spec.type)) return;
    const o = this.level.objectivePoint;
    const b = this.level.bounds;
    const far = (ang, d) => ({
      x: clamp(o.x + Math.cos(ang) * d, -b + 12, b - 12),
      z: clamp(o.z + Math.sin(ang) * d, -b + 12, b - 12),
    });
    const a0 = this.r() * Math.PI * 2;

    // A charge goes on a structure, not on dirt: snap the chosen point to the
    // nearest solid obstacle, and stand the marker just off its face so the
    // interaction is reachable — colocating marker and charge also keeps
    // anything navigating by the marker (the soak does) inside interact range.
    const structurePoint = (p) => {
      let best = null, bd = 34;
      for (const ob of this.level.obstacles) {
        if ((ob.coverH ?? ob.h) < 0.9) continue;
        const d = Math.hypot(ob.x - p.x, ob.z - p.z);
        if (d < bd) { bd = d; best = ob; }
      }
      return best ? { x: best.x, z: best.z + (best.hd || 1) + 1.2 } : p;
    };

    // The stage suits the contract. A generic "clear the far end" after a
    // sabotage read as two missions stapled together; a second charge to
    // place, or another group of held people to cut loose, reads as the same
    // job being bigger than one trip — which is what a heavy contract is.
    const t = this.spec.type;
    const list = [];
    if (t === 'sabotage') {
      const p = structurePoint(far(a0, b * 0.45));
      list.push({
        kind: 'plant', x: p.x, z: p.z, radius: 18,
        text: 'Wire the secondary structure',
        sub: 'One mast is a repair ticket. Two is a message.',
      });
    } else if (t === 'recovery') {
      const p = far(a0, b * 0.45);
      list.push({
        kind: 'free', x: p.x, z: p.z, radius: 18,
        text: 'Another group is held at the far end',
        sub: 'Word from the first pen: they were split up',
      });
    } else {
      const p = far(a0, b * 0.45);
      list.push({
        kind: 'sweep', x: p.x, z: p.z, radius: 22,
        text: 'Clear the far end of the site',
        sub: 'Nothing of theirs left standing over there',
      });
    }
    if (weight >= 45) {
      // The heaviest work gets a third act: sabotage sweeps the wreckage it
      // just made; everything else holds ground while the truck comes up.
      const p = far(a0 + 2.2, b * 0.5);
      list.push(t === 'sabotage'
        ? {
          kind: 'sweep', x: p.x, z: p.z, radius: 22,
          text: 'Clear the far end of the site',
          sub: 'Nobody left to repair what you just broke',
        }
        : {
          kind: 'hold', x: p.x, z: p.z, radius: 14, need: 12, progress: 0,
          text: 'Hold the crossing while the truck comes up',
          sub: 'Twelve seconds on the ground, nobody else standing on it',
        });
    }
    this.stages = list;
    this.stageIndex = -1;
  }

  /** Move to the next stage, or arm extraction if that was the last. */
  advanceStage() {
    if (!this.stages || this.stageIndex >= this.stages.length - 1) return false;
    this.stageIndex++;
    const s = this.stages[this.stageIndex];

    // The staged work arrives when the stage opens, not at mission start —
    // a second held group is something you learn about from the first pen,
    // not something that was standing in view the whole time.
    if (s.kind === 'free' && !s.entity) {
      const ent = this.spawnEntity({
        id: `ps_${this.stageIndex}`, side: 'civil', faction: null,
        x: s.x, z: s.z, yaw: 0, hp: 60, weapon: null, model: 'soldier_prisoner',
        speed: 3.4, name: 'Held personnel', follower: true,
      });
      ent.released = false;
      s.entity = ent;
      // Into the recovery ledger: they must reach extraction like everyone
      // else, and losing them is reported by the same accounting.
      this.prisoners.push(ent);
      this.interactables.push({
        kind: 'prisoner', entity: ent, x: ent.x, z: ent.z, progress: 0, need: 1.6,
        label: 'Cut restraints',
      });
      // The marker follows wherever the spawn actually landed, and somebody
      // is watching them — a pen with no guard is a walk, not a stage.
      s.x = ent.x; s.z = ent.z;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        this.spawnEnemy(s.x + Math.cos(a) * 6, s.z + Math.sin(a) * 6,
          pick(this.r, ['rifleman', 'rifleman', 'breacher']));
      }
    }
    if (s.kind === 'plant' && !s.interactable) {
      s.interactable = {
        kind: 'charge', x: s.x, z: s.z, progress: 0, need: 4.5,
        label: 'Place the second charge',
      };
      this.interactables.push(s.interactable);
    }

    this.objective = {
      text: s.text, sub: s.sub, progress: 0,
      need: s.kind === 'hold' ? s.need : 1,
      done: false, type: 'stage', stage: s,
    };
    this.showMarker(s.x, s.z, 12);
    Audio.uiAlert();
    this.onToast('NEXT', s.text, 'deploy');
    return true;
  }

  updateStages(dt) {
    const s = this.stages?.[this.stageIndex];
    if (!s || this.objective.done) return;
    const p = this.player;
    if (!p) return;
    if (s.kind === 'plant') {
      // Completion comes from the charge interactable itself — its handler
      // calls completeObjective — so the stage only mirrors progress to the
      // HUD.
      this.objective.progress = s.interactable?.done ? 1
        : clamp((s.interactable?.progress || 0) / s.interactable.need, 0, 0.99);
      return;
    }
    if (s.kind === 'free') {
      const e = s.entity;
      this.objective.progress = e?.released ? 1 : 0;
      // Released moves the chain on; killed does too — the work at this pen
      // is over either way, the loss is already on the recovery ledger, and a
      // stage that can never complete would strand the whole deployment.
      if (e && (e.released || e.dead)) this.completeObjective();
      return;
    }
    const inside = Math.hypot(p.x - s.x, p.z - s.z) < s.radius;
    if (s.kind === 'sweep') {
      // Everything alive within reach of the marker.
      const left = this.entities.filter((e) => e.side === 'enemy' && !e.dead
        && Math.hypot(e.x - s.x, e.z - s.z) < s.radius + 10).length;
      this.objective.progress = left === 0 && inside ? 1 : 0;
      if (left === 0 && inside) this.completeObjective();
    } else {
      const clear = !this.entities.some((e) => e.side === 'enemy' && !e.dead
        && Math.hypot(e.x - s.x, e.z - s.z) < s.radius);
      if (inside && clear) this.objective.progress = Math.min(s.need, this.objective.progress + dt);
      else if (!inside) this.objective.progress = Math.max(0, this.objective.progress - dt * 0.5);
      if (this.objective.progress >= s.need) this.completeObjective();
    }
  }

  completeObjective() {
    if (this.objective.done) return;
    // A heavy contract has more than one piece of work in it. Only the last
    // stage arms the extraction.
    if (this.stages?.length && this.stageIndex < this.stages.length - 1) {
      this.objective.done = true;
      this.objective.progress = this.objective.need;
      this.advanceStage();
      return;
    }
    this.objective.done = true;
    // Bodies are cleared from the entity list a little after they fall, so a
    // finished skirmish could read "51/54" on the HUD while the toast said the
    // objective was complete. If it is done, it is done.
    if (this.objective.progress < this.objective.need) {
      this.objective.progress = this.objective.need;
    }
    this.extractArmed = true;
    const ex = this.level.extraction;
    this.extractMarker.position.set(ex.x, Level.heightAt(ex.x, ex.z) + 0.05, ex.z);
    this.extractMarker.visible = true;
    Audio.extractTone();
    if (this.spec.type !== 'defense') {
      this.onToast('OBJECTIVE COMPLETE', 'Move to extraction', 'good');
    }
  }

  /**
   * Put a unit on the hunt for a place, with a clock.
   *
   * Setting `state = 'hunt'` on its own does not survive a single frame. The
   * hunt branch walks toward `lastSeen`, and when there is none it checks
   * `huntUntil` — an absent one reads as 0, which is always in the past, so the
   * unit stands straight back down to 'guard' on the very next update.
   *
   * Three places raised the alarm without setting either field. It went
   * unnoticed because the garrison could see clear across a flat site, so
   * acquire() found the player and promoted them to 'engage' before the
   * stand-down could fire. Once the ground had relief and could interrupt a
   * sightline, the alarm stopped meaning anything: looting a store in a raid
   * turned the whole street out and every one of them forgot within a frame.
   */
  sendHunting(e, x, z, seconds = 25) {
    e.alert = 1;
    e.state = 'hunt';
    e.lastSeen = { x, z };
    e.huntUntil = Math.max(e.huntUntil || 0, this.time + seconds);
  }

  spawnReinforcements(n) {
    // They arrive from the map edge, on the side the player is NOT extracting
    // toward, so the pressure pushes you along the intended route.
    const ex = this.level.extraction;
    const a0 = Math.atan2(-ex.z, -ex.x);
    for (let i = 0; i < n; i++) {
      const a = a0 + range(this.r, -0.7, 0.7);
      const d = 52;
      this.reinforce(Math.cos(a) * d, Math.sin(a) * d,
        pick(this.r, ['rifleman', 'rifleman', 'breacher', 'gunner']));
    }
    const list = this.entities.filter((e) => e.side === 'enemy' && !e.dead);
    for (const e of list.slice(-n)) {
      this.sendHunting(e, this.player.x, this.player.z, 40);
      e.target = this.player;
    }
  }

  // ======================================================================
  // AI
  // ======================================================================

  /**
   * The Titan's behaviour. Kept entirely separate from updateAI because none of
   * the small-unit logic applies: it does not seek cover, it cannot be
   * suppressed, and it does not break contact. It walks at whoever is nearest,
   * fires its cannon in long bursts, and periodically turns its damaged side
   * away — which is what forces the squad to keep moving around it.
   */
  updateTitan(dt, e) {
    if (e.dead) return;
    const targets = this.entities.filter((x) => x.side === 'player' && !x.dead && !x.down);
    if (!targets.length) { e.target = null; return; }
    let best = null; let bd = Infinity;
    for (const x of targets) {
      const d = Math.hypot(x.x - e.x, x.z - e.z);
      if (d < bd) { bd = d; best = x; }
    }
    e.target = best;

    // Face the target, but bias the turn so the most damaged side ends up away
    // from them. A player who has opened the left flank has to work to keep
    // looking at it.
    const want = Math.atan2(best.x - e.x, best.z - e.z);
    const openLeft = e.plates.some((pl) => pl.broken && pl.id.endsWith('_l'));
    const openRight = e.plates.some((pl) => pl.broken && pl.id.endsWith('_r'));
    const shy = (openLeft ? -0.5 : 0) + (openRight ? 0.5 : 0);
    e.yaw = approachAngle(e.yaw, want + shy, dt * 0.9);

    // Close to a working range and hold there. It does not need to reach you.
    const ideal = 16;
    if (bd > ideal + 3) {
      const s = Math.sin(e.yaw), c = Math.cos(e.yaw);
      const nx = e.x + s * e.speed * dt;
      const nz = e.z + c * e.speed * dt;
      const res = Level.resolveMove(this.level.obstacles, e.x, e.z, nx, nz);
      const b = this.level.bounds - 4;
      e.x = clamp(res.x, -b, b);
      e.z = clamp(res.z, -b, b);
      e.moveSpeed = e.speed;
    } else {
      e.moveSpeed = 0;
    }

    // Cannon: long bursts with a heavy reset, so there are real windows to move
    // in. Losing plates makes it angrier, not more accurate.
    e.cooldown -= dt;
    const rage = 1 + (e.plates.length - e.platesLeft) * 0.12;
    const los = Level.hasLOS(this.level.obstacles, e.x, e.z, best.x, best.z, 4.3);
    if (bd < 46 && e.cooldown <= 0 && los) {
      e.burst = (e.burst || 0) - 1;
      if (e.burst <= 0) { e.burst = 9; e.cooldown = 2.4 / rage; }
      else e.cooldown = 0.09;
      const spread = 0.028 / rage;
      const from = new THREE.Vector3(e.x, Level.heightAt(e.x, e.z) + 4.3, e.z);
      const to = new THREE.Vector3(best.x + (this.r() - 0.5) * 2.2,
        Level.heightAt(best.x, best.z) + 1.0, best.z + (this.r() - 0.5) * 2.2);
      const dir = to.sub(from).normalize();
      dir.x += (this.r() - 0.5) * spread;
      dir.z += (this.r() - 0.5) * spread;
      dir.normalize();
      const hit = this.rayHit(from, dir, 90, e);
      this.spawnTracer(e, hit);
      Audio.shot('lmg', this.relPos(e));
      if (hit.entity && hit.entity.side === 'player') {
        this.applyDamage(hit.entity, 16, e, hit);
      } else this.spawnImpact(hit, hit.kind === 'solid' ? 'metal' : 'dirt');
      this.applySuppression(e, from.x, from.z, hit.x, hit.z);
    }

    // Stomp: anyone who stands underneath it gets hurt, which stops the squad
    // solving the fight by hugging its legs where the cannon cannot depress.
    e.stomp -= dt;
    if (e.stomp <= 0) {
      e.stomp = 3.2;
      for (const x of targets) {
        const d = Math.hypot(x.x - e.x, x.z - e.z);
        if (d < 6.5) {
          this.applyDamage(x, 26, e, { x: x.x, y: Level.heightAt(x.x, x.z) + 1, z: x.z });
          this.shake = Math.min(1, (this.shake || 0) + 0.5);
          Audio.explosion(this.relPos(e));
        }
      }
    }
  }

  updateAI(dt, e) {
    if (e.dead) return;

    if (e.down) {
      if (e.side === 'player' && !e.stabilised) {
        e.bleed -= dt;
        if (e.bleed <= 0) {
          e.dead = true;
          if (!e.isPlayer) this.onToast('CASUALTY', `${e.name} has bled out`, 'bad');
        }
      }
      return;
    }

    e.cooldown = Math.max(0, e.cooldown - dt);
    // Steel in flight resolves whoever is driving the body.
    this.updateSwing(dt, e);
    if (e.guardBreak > 0) e.guardBreak -= dt;
    // Nerve gone: no orders reach them, they are running. Ahead of every
    // other branch, because a routing soldier is not soldiering.
    if (e.routing) { this.updateRouting(dt, e); return; }
    // Archers pressed to contact draw the blade; room draws the bow back.
    if ((e.weapon?.bow || e.bowStowed) && !e.isPlayer) this.updateSidearm(e);
    // A reinforcement is on the field but not yet in the fight.
    if (e.arriving > 0) e.arriving = Math.max(0, e.arriving - dt);

    // Everyone else gets the same body as the player: standing in your cover
    // position with nothing to shoot at means getting your head down, and the
    // ray test rewards it. Firing brings you up again — which is exactly the
    // window a flanking soldier is being sent to exploit.
    if (!e.isPlayer) {
      // Getting your head down needs a reason, not just a wall.
      //
      // Keyed only on "am I standing on a cover position", a soldier stayed
      // crouched behind the last thing they hid behind long after being called
      // back into formation — because coverPos outlives the order that chose
      // it. Somebody with nothing to fear and no orders stands up.
      const reason = e.order === 'cover' || !!e.target || (e.suppression || 0) > 0.15;
      const atCover = reason && e.coverPos
        && Math.hypot(e.coverPos.x - e.x, e.coverPos.z - e.z) < 1.4;
      const shooting = e.cooldown > 0.02 || (e.burst || 0) > 0;
      const wantTuck = atCover && !shooting ? 1 : 0;
      const pin = clamp((e.suppression || 0) * 1.4, 0, 1);
      const target = Math.max(wantTuck, atCover ? pin : 0);
      e.tuck = (e.tuck || 0) + (target - (e.tuck || 0)) * Math.min(1, dt * 6);
    }
    // Slow decay: being shot at should keep its grip for a few seconds after
    // the rounds stop, otherwise the effect only exists during the burst itself
    // and giving the order is worth almost nothing. Measured with tools/tactics.mjs.
    e.suppression = Math.max(0, (e.suppression || 0) - dt * 0.20);
    if (e.reloading > 0) {
      e.reloading -= dt;
      if (e.reloading <= 0) {
        e.ammo = Math.round(e.weapon.mag * (e.eff?.magMul || 1));
        e.reloading = 0;
      }
    }

    if (e.follower) return this.updateFollower(dt, e);
    if (e.side === 'player') return this.updateFriendly(dt, e);
    return this.updateEnemy(dt, e);
  }

  /** Cheap target selection: nearest visible hostile, re-evaluated on a timer. */
  acquire(e) {
    // Nobody sees anybody while the company is still arriving.
    if (this.inserting) return null;
    const hostileSide = e.side === 'enemy' ? 'player' : 'enemy';
    // Steel pairs off. A gunline concentrating fire is doctrine; five
    // swords stacking onto one man while his four friends swing freely is
    // how a melee AI loses 5v5 every time. Each already-claimed opponent
    // reads as several metres further away, so the line spreads across
    // the line it is fighting — a dogpile only happens when numbers mean
    // there is nobody left unclaimed.
    const melee = !!e.weapon?.melee;
    let best = null, bs = Infinity;
    for (const o of this.entities) {
      if (o.dead || o.side !== hostileSide || o.follower) continue;
      if (o.down && !o.isPlayer) continue;      // don't keep hitting the downed
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d > e.sight) continue;
      if (!Level.hasLOS(this.level.obstacles, e.x, e.z, o.x, o.z,
        EYE + (e.elev || 0), EYE + (o.elev || 0))) continue;
      let score = d;
      if (melee) {
        let claims = 0;
        for (const c of this.entities) {
          if (c !== e && !c.dead && c.side === e.side && c.target === o) claims++;
        }
        score += claims * 6;
      }
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }

  /**
   * The rhythm of a fight: step in to swing, step off while the arm
   * rests. Engaged melee soldiers hold the reach edge on cooldown and
   * press inside it when ready, with a slight personal drift so two men
   * on one opponent take different shoulders instead of the same pixel.
   */
  meleeSpacing(e, t) {
    const reach = (e.weapon.reach || 2) + 0.3;
    const want = e.cooldown > 0.25 ? reach * 1.05 : reach * 0.55;
    const dx = e.x - t.x, dz = e.z - t.z;
    const d = Math.max(0.001, Math.hypot(dx, dz));
    // A stable per-body drift angle off the id, so the spread is calm.
    let h = 0;
    const id = String(e.id);
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const drift = ((Math.abs(h) % 7) - 3) * 0.16;
    const a = Math.atan2(dx, dz) + drift;
    return { x: t.x + Math.sin(a) * want, z: t.z + Math.cos(a) * want };
  }

  updateEnemy(dt, e) {
    if (this.time > e.thinkAt) {
      // Re-planning is the expensive part (target acquisition walks every
      // entity and traces line of sight). Distant units think far less often,
      // which is invisible in play and is what makes forty of them affordable.
      const far = Math.hypot(e.x - this.player.x, e.z - this.player.z) > 60;
      e.thinkAt = this.time + (far ? 1.1 : 0.25) + this.r() * 0.25;
      const t = this.acquire(e);
      if (t) {
        // A new target is a new engagement: reaction time applies again.
        if (e.target !== t) { e.seenFor = 0; e.reaction = undefined; e.burstLeft = 0; }
        e.target = t;
        e.alert = 1;
        e.state = 'engage';
        e.lastSeen = { x: t.x, z: t.z };
        e.lostFor = 0;
        // Waking one man wakes the ones near him. Sound carries.
        for (const o of this.entities) {
          if (o.side === 'enemy' && !o.dead && o !== e && o.alert < 0.5) {
            if (Math.hypot(o.x - e.x, o.z - e.z) < 26) { o.alert = 0.9; o.state = 'hunt'; o.lastSeen = { x: t.x, z: t.z }; }
          }
        }
      } else if (e.state === 'engage') {
        // Do NOT drop the engagement the instant line of sight breaks. Cover,
        // a passing squadmate or a step behind a container all interrupt LOS
        // for a fraction of a second, and a shooter that forgets its target
        // that easily never actually fires at anything.
        e.lostFor = (e.lostFor || 0) + 0.3;
        if (e.lostFor > 1.6) {
          e.state = 'hunt';
          e.huntUntil = this.time + 8;
          e.target = null;
        }
      }
    }

    if (e.state === 'patrol' && e.patrol) {
      const wp = e.patrol[e.patrolIdx % e.patrol.length];
      if (this.moveToward(dt, e, wp.x, wp.z, e.speed * 0.55) < 2.5) e.patrolIdx++;
      this.faceMotion(e, dt);
    } else if (e.state === 'guard') {
      e.moveSpeed = 0;
      // Slow scan so a static guard is not a statue.
      e.yaw += Math.sin(this.time * 0.5 + e.x) * dt * 0.35;
    } else if (e.state === 'hunt') {
      // Under an advance, the army's objective outranks a stale sighting:
      // it walks at where the other side actually IS. This is what closes
      // the last seventy metres, which is otherwise a range nobody can see
      // across and both lines stand in.
      if (e.advanceOn && !e.withdrawing) {
        const ad = Math.hypot(e.advanceOn.x - e.x, e.advanceOn.z - e.z);
        if (ad > 6) {
          // Dress on the line first, then walk it forward together: a man
          // out of his place closes on his POST, a man in it advances with
          // the rest. That is the difference between a line crossing the
          // field and a crowd arriving in ones and twos.
          const post = e.linePost;
          const off = post ? Math.hypot(post.x - e.x, post.z - e.z) : 0;
          const goal = post && off > 3.5 ? post : e.advanceOn;
          this.moveToward(dt, e, goal.x, goal.z,
            e.speed * (goal === post ? 0.95 : 0.72));
          this.faceMotion(e, dt);
          return;
        }
      }
      const ls = e.lastSeen;
      if (ls && this.moveToward(dt, e, ls.x, ls.z, e.speed * 0.8) < 3) {
        e.lastSeen = null;
      }
      if (!ls) {
        // Do not shrug and go back to sleep the moment you reach the spot.
        // While the hunt clock is running there is still shooting somewhere,
        // and a unit that stands down mid-firefight is why half a garrison
        // used to sit out the whole engagement.
        if (this.time < (e.huntUntil || 0)) {
          this.wanderNear(dt, e);
        } else {
          e.state = e.patrol ? 'patrol' : 'guard';
          e.alert = 0.3;
        }
      }
      this.faceMotion(e, dt);
    } else if (e.state === 'engage' && e.target) {
      const t = e.target;
      const d = Math.hypot(t.x - e.x, t.z - e.z);
      const w = e.weapon;
      e.yaw = approachAngle(e.yaw, Math.atan2(t.x - e.x, t.z - e.z), dt * 5.5);

      // Take cover if this unit's doctrine says so and it is exposed. Heavy
      // suppression overrides doctrine — everyone goes to ground.
      const pinned = (e.suppression || 0) > 0.45;
      if (!e.coverPos || this.time > (e.coverAt || 0) + 4 || pinned) {
        if (pinned || this.r() < e.coverPref) {
          const c = Level.findCover(this.level.obstacles, this.level.covers, e.x, e.z, t.x, t.z, 14);
          e.coverPos = c ? { x: c.x, z: c.z } : null;
          e.coverAt = this.time;
        }
      }

      if (w.melee) {
        // The commander's posture reaches the body here: told to give
        // ground, they give it rather than trading at the point.
        if (e.withdrawing && d < 26) {
          this.moveToward(dt, e, e.x - (t.x - e.x), e.z - (t.z - e.z), e.speed * 0.85);
          this.faceMotion(e, dt);
          return;
        }
        // Steel has no standoff band: close hard, then fight at the reach
        // edge with the in-out rhythm the spacing helper carries.
        const reach = (w.reach || 2) + 0.3;
        if (d > reach * 2.2) {
          this.moveToward(dt, e, t.x, t.z, e.speed * (0.7 + e.aggression * 0.4));
        } else {
          const sp = this.meleeSpacing(e, t);
          if (Math.hypot(sp.x - e.x, sp.z - e.z) > 0.5) {
            this.moveToward(dt, e, sp.x, sp.z, e.speed * 0.8);
          } else {
            e.moveSpeed = 0;
          }
        }
        this.aiShoot(dt, e, t, d);
        return;
      }
      // Bows told to hold the ground they have: stand and shoot, make the
      // other side cross the open part.
      if (e.holdGround && w.bow) {
        e.moveSpeed = 0;
        this.aiShoot(dt, e, t, d);
        return;
      }
      const idealMin = w.range * 0.35, idealMax = w.range * 0.8;
      if (e.coverPos && Math.hypot(e.coverPos.x - e.x, e.coverPos.z - e.z) > 1.2) {
        this.moveToward(dt, e, e.coverPos.x, e.coverPos.z, e.speed);
      } else if (pinned) {
        // Pinned units do not advance. This is what buys the player the room
        // to flank, and it is the whole reason suppressing fire is an order.
        e.moveSpeed = 0;
      } else if (d > idealMax) {
        this.moveToward(dt, e, t.x, t.z, e.speed * (0.55 + e.aggression * 0.5));
      } else if (d < idealMin && e.aggression < 0.7) {
        this.moveToward(dt, e, e.x - (t.x - e.x), e.z - (t.z - e.z), e.speed * 0.6);
      } else {
        e.moveSpeed = 0;
      }

      this.aiShoot(dt, e, t, d);
    }
  }

  updateFriendly(dt, e) {
    // Tactician makes the squad react to orders almost immediately.
    const reflex = 0.28 / (1 + (this.company.orderSpeed || 0));
    if (this.time > e.thinkAt) {
      e.thinkAt = this.time + reflex + this.r() * 0.2;
      if (e.forceTarget && !e.forceTarget.dead) e.target = e.forceTarget;
      else { e.target = this.acquire(e); e.forceTarget = null; }
      // A Spotter hands its contact to everyone else who has nothing.
      if (e.target && e.eff?.shareTargets) {
        for (const o of this.squad) {
          if (o !== e && !o.dead && !o.down && !o.target) o.target = e.target;
        }
      }
    }
    const t = e.target;
    const p = this.player;

    // --- suppressing fire: hold position and pour rounds into a point -------
    if (e.order === 'suppress' && e.suppressPoint) {
      e.moveSpeed = 0;
      const sp = e.suppressPoint;
      e.yaw = approachAngle(e.yaw, Math.atan2(sp.x - e.x, sp.z - e.z), dt * 6);
      this.suppressFire(dt, e, sp);
      return;
    }

    // --- charging: run them down -------------------------------------------
    // The Mount-and-Blade order: everyone picks the nearest living enemy and
    // CLOSES, firing on the move, no cover, no stopping, until nothing is
    // left standing — then hunts the next. The trade is the whole point:
    // charging troops give up their cover discipline, so calling it against
    // an unbroken line is how you lose a company, and calling it against a
    // routing one is how you finish a fight.
    if (e.order === 'charge') {
      let prey = null, pd = Infinity;
      const claimed = (q) => {
        let n = 0;
        for (const c of this.entities) {
          if (c !== e && !c.dead && c.side === e.side && (c.forceTarget === q || c.target === q)) n++;
        }
        return n;
      };
      for (const q of this.entities) {
        if (q.side !== 'enemy' || q.dead) continue;
        const d = Math.hypot(q.x - e.x, q.z - e.z);
        // Chargers pair off the same way acquire does — the line takes the
        // line, not five men onto the nearest body.
        const score = e.weapon?.melee ? d + claimed(q) * 6 : d;
        if (score < pd) { pd = score; prey = q; }
      }
      if (prey) {
        e.forceTarget = prey;
        const d = Math.hypot(prey.x - e.x, prey.z - e.z);
        if (e.weapon?.melee) {
          const reach = (e.weapon.reach || 2) + 0.3;
          if (d > reach * 2.2) {
            this.moveToward(dt, e, prey.x, prey.z, e.speed * 1.3);
            this.faceMotion(e, dt);
          } else {
            const sp = this.meleeSpacing(e, prey);
            if (Math.hypot(sp.x - e.x, sp.z - e.z) > 0.5) {
              this.moveToward(dt, e, sp.x, sp.z, e.speed * 0.85);
            } else {
              e.moveSpeed = 0;
            }
            e.yaw = approachAngle(e.yaw, Math.atan2(prey.x - e.x, prey.z - e.z), dt * 8);
          }
          this.aiShoot(dt, e, prey, d);
          return;
        }
        if (d > 6) {
          this.moveToward(dt, e, prey.x, prey.z, e.speed * 1.3);
          this.faceMotion(e, dt);
        } else {
          e.moveSpeed = 0;
          e.yaw = approachAngle(e.yaw, Math.atan2(prey.x - e.x, prey.z - e.z), dt * 8);
        }
        if (d < 40) this.aiShoot(dt, e, prey, d);
        return;
      }
      // Nothing left to run down: form back up.
      e.order = 'follow';
    }

    // --- flanking: run wide, then revert to attacking ----------------------
    if (e.order === 'flank' && e.flankPoint) {
      const fd = Math.hypot(e.flankPoint.x - e.x, e.flankPoint.z - e.z);
      if (fd < 2.2) {
        e.order = 'attack';
        e.forceTarget = e.flankTarget && !e.flankTarget.dead ? e.flankTarget : null;
        e.flankPoint = null;
      } else {
        // Move hard and do not stop to trade shots on the way round.
        this.moveToward(dt, e, e.flankPoint.x, e.flankPoint.z, e.speed * 1.35);
        this.faceMotion(e, dt);
        if (t && Math.hypot(t.x - e.x, t.z - e.z) < 14) {
          this.aiShoot(dt, e, t, Math.hypot(t.x - e.x, t.z - e.z));
        }
        return;
      }
    }

    // Position: driven by the standing order, with engagement layered on top.
    let dest = null;
    if (e.order === 'cover') {
      // Stay put. Unlike every other standing order, this one is not allowed to
      // be overridden by the urge to close on a target — the whole point of
      // ordering it is that these people stop advancing.
      dest = e.orderPoint;
      const at = dest && Math.hypot(dest.x - e.x, dest.z - e.z) < 1.3;
      if (at) {
        e.moveSpeed = 0;
        // Face the threat the order was given against, so they are looking the
        // right way when something comes round the corner.
        const f = e.coverFacing || t;
        if (f) e.yaw = approachAngle(e.yaw, Math.atan2(f.x - e.x, f.z - e.z), dt * 4);
        if (t) this.aiShoot(dt, e, t, Math.hypot(t.x - e.x, t.z - e.z));
        return;
      }
    } else if (e.order === 'hold' && e.orderPoint) dest = e.orderPoint;
    else if (e.order === 'move' && e.orderPoint) dest = e.orderPoint;
    else if (e.order === 'fallback' && e.orderPoint) {
      const fd = Math.hypot(e.orderPoint.x - e.x, e.orderPoint.z - e.z);
      if (fd < 1.6) { e.order = 'follow'; e.orderPoint = null; }
      else dest = e.orderPoint;
    } else if (e.order === 'attack' && t) {
      const d = Math.hypot(t.x - e.x, t.z - e.z);
      dest = d > e.weapon.range * 0.75
        ? { x: t.x, z: t.z }
        : null;
    } else {
      // Follow: stand in whatever shape the commander has called for. The
      // camera sits directly behind them, so every formation pushes people out
      // to the sides rather than into a conga line down the middle of the view.
      const f = FORMATIONS[this.formation] || FORMATIONS.wedge;
      if (!f.slot) {
        // THE BATTLE LINE: rectangles in the commander's local frame.
        const { side, back } = this.battleSlot(e);
        const bx = Math.sin(p.yaw + Math.PI), bz = Math.cos(p.yaw + Math.PI);
        const rx = Math.sin(p.yaw + Math.PI / 2), rz = Math.cos(p.yaw + Math.PI / 2);
        dest = { x: p.x + bx * back + rx * side, z: p.z + bz * back + rz * side };
      } else {
        const i = this.squad.indexOf(e);
        const { lateral, off } = f.slot(i);
        const bearing = p.yaw + Math.PI + lateral;
        dest = { x: p.x + Math.sin(bearing) * off, z: p.z + Math.cos(bearing) * off };
      }
    }

    // Under fire, prefer nearby cover over the ordered position. Cover Hound
    // searches further; being suppressed makes anyone look for it.
    const pinned = (e.suppression || 0) > 0.4;
    if (t && (e.coverPref > 0.3 || pinned)) {
      if (!e.coverPos || this.time > (e.coverAt || 0) + 5 || pinned) {
        const reach = e.eff?.coverRange || 9;
        const c = Level.findCover(
          this.level.obstacles, this.level.covers, e.x, e.z, t.x, t.z, reach);
        e.coverPos = c ? { x: c.x, z: c.z } : null;
        e.coverAt = this.time;
      }
      // An explicit move order still overrides cover — except when pinned,
      // where walking into fire would just be suicide.
      if (e.coverPos && (e.order !== 'move' || pinned)) dest = e.coverPos;
    }

    if (dest) {
      const dd = Math.hypot(dest.x - e.x, dest.z - e.z);
      // Deadband stops the squad shuffling on the spot forever.
      if (dd > (e.order === 'follow' ? 2.2 : 1.1)) {
        this.moveToward(dt, e, dest.x, dest.z, e.speed * (dd > 9 ? 1.25 : 1));
      } else e.moveSpeed = 0;
    } else e.moveSpeed = 0;

    if (t) {
      e.yaw = approachAngle(e.yaw, Math.atan2(t.x - e.x, t.z - e.z), dt * 5);
      this.aiShoot(dt, e, t, Math.hypot(t.x - e.x, t.z - e.z));
    } else if (e.moveSpeed > 0.1) {
      this.faceMotion(e, dt);
    } else {
      e.yaw = approachAngle(e.yaw, p.yaw, dt * 2);
    }
  }

  /** Released prisoners: stay near the player, and try not to die. */
  updateFollower(dt, e) {
    if (!e.released) { e.moveSpeed = 0; return; }
    const p = this.player;
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d > 4.5) this.moveToward(dt, e, p.x, p.z, e.speed);
    else e.moveSpeed = 0;
    this.faceMotion(e, dt);
  }

  /**
   * AI fire discipline.
   *
   * This is the single most important tuning surface in the game. Left to fire
   * continuously, three riflemen delete the player in under two seconds and the
   * whole design collapses. Three rules fix it, and they are the same three
   * rules that make a firefight legible:
   *
   *  1. REACTION — a shooter must hold the target for a beat before opening up,
   *     so the player always gets a moment to react to being spotted.
   *  2. BURSTS — everyone fires 2-5 rounds then pauses. The pauses are the
   *     windows the player moves and flanks in.
   *  3. ERROR — aim scatter grows with range, so distance is real cover and
   *     closing the gap is a genuine decision.
   */
  /**
   * Deliberate suppressing fire at a map point rather than at a body.
   *
   * The soldier keeps shooting whether or not anything is visible, spreading
   * rounds around the point. It is expensive in ammunition and it rarely kills
   * anybody — its value is that everyone near the impact stops advancing and
   * stops shooting straight, which is what lets the player move.
   */
  suppressFire(dt, e, sp) {
    const w = e.weapon;
    if (!w) return;
    if (e.reloading > 0) return;
    if (e.ammo <= 0) { this.tryReload(e); return; }
    if (e.cooldown > 0) return;

    // Longer bursts than aimed fire, with shorter pauses — the point is volume.
    if (e.burstRest > 0) { e.burstRest -= dt; return; }
    if (!e.burstLeft || e.burstLeft <= 0) e.burstLeft = irange(this.r, 4, 8);

    const d = Math.hypot(sp.x - e.x, sp.z - e.z);
    if (d > w.range * 1.1) return;
    // Walk the fire around the point rather than drilling one spot.
    const spread = 1.6 + d * 0.03;
    this.fire(e,
      sp.x + (this.r() - 0.5) * spread * 2,
      Level.heightAt(sp.x, sp.z) + CHEST + (this.r() - 0.5) * 0.7,
      sp.z + (this.r() - 0.5) * spread * 2,
      1);
    e.burstLeft--;
    if (e.burstLeft <= 0) e.burstRest = range(this.r, 0.5, 1.1);
  }

  /**
   * How much harder a shot is because the target is behind something low.
   *
   * Line of sight is traced at chest height, so sandbags, crates and barriers —
   * everything the level calls 'cover' — never blocked a single round. Getting
   * behind cover did nothing at all, which is the whole reason a firefight
   * played as a shooting gallery rather than a tactical problem. Low cover now
   * does what low cover does: it does not stop the bullet, it makes you very
   * hard to hit.
   */
  coverPenalty(shooter, target) {
    const dx = target.x - shooter.x, dz = target.z - shooter.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len, nz = dz / len;
    for (const o of this.level.covers) {
      // Only cover the target is actually tucked against counts.
      const dd = Math.hypot(o.x - target.x, o.z - target.z);
      if (dd > 2.2) continue;
      // And only if it sits between the two of them rather than behind.
      const along = (o.x - shooter.x) * nx + (o.z - shooter.z) * nz;
      if (along < 0 || along > len) continue;
      const off = Math.abs((o.x - shooter.x) * nz - (o.z - shooter.z) * nx);
      if (off > o.hw + o.hd + 0.6) continue;
      return target.down ? 3.4 : 2.4;
    }
    return 1;
  }

  aiShoot(dt, e, t, d) {
    const w = e.weapon;
    if (!w || e.reloading > 0) return;
    if (this.inserting) return;
    // Discipline outranks appetite: a ranged soldier told to hold, holds —
    // unless the commander marked that exact body for them.
    if (e.holdFire && !e.forceTarget && !e.isPlayer) return;
    // Steel does not shoot. The movement layer has already closed the
    // distance (the standoff band reads w.range, and a reach-valued range
    // walks the AI into contact); all that is decided here is whether the
    // target is in front of the point and the arm is rested.
    if (w.melee) {
      if (d > (w.reach || 2) + 0.7) return;
      if (Math.abs(angleDelta(e.yaw, Math.atan2(t.x - e.x, t.z - e.z))) > 0.5) return;
      // A soldier under a swing raises what guard they have.
      e.guard = t.swing && !e.swing ? 1 : 0;
      if (e.cooldown <= 0 && !e.swing) this.strike(e);
      return;
    }
    // Losing the shot decays readiness rather than erasing it, so a target
    // bobbing in and out of cover still eventually draws fire.
    // Losing the shot also un-ranges it, at half the rate it was gained: a
    // target that ducks behind a wall and comes out somewhere else has to be
    // walked onto again. Bounding from cover to cover is the counter-play.
    if (d > w.range) {
      e.seenFor = Math.max(0, (e.seenFor || 0) - dt);
      e.aimFor = Math.max(0, (e.aimFor || 0) - dt * 0.5);
      return;
    }
    if (!Level.hasLOS(this.level.obstacles, e.x, e.z, t.x, t.z,
      CHEST + 0.2 + (e.elev || 0), CHEST + 0.2 + (t.elev || 0))) {
      e.seenFor = Math.max(0, (e.seenFor || 0) - dt * 0.5);
      e.aimFor = Math.max(0, (e.aimFor || 0) - dt * 0.5);
      return;
    }
    // Facing gate: no shooting through the back of the head.
    if (Math.abs(angleDelta(e.yaw, Math.atan2(t.x - e.x, t.z - e.z))) > 0.32) return;

    // 1. Reaction time before the first shot of an engagement.
    e.seenFor = (e.seenFor || 0) + dt;
    if (e.reaction === undefined) e.reaction = range(this.r, 0.35, 0.85);
    if (e.seenFor < e.reaction) return;

    // 1b. Ranging in. Reaction time governs when the first round leaves the
    // barrel; this governs where it lands. Without it a soldier's very first
    // shot is as good as their hundredth, so crossing open ground killed you
    // before you could read where the fire was coming from — the complaint was
    // that combat felt unfair rather than hard, and this is the mechanism.
    // Fall of shot walks onto the target over RANGE_IN seconds of holding it.
    //
    // Applied to both sides deliberately. It is one code path, and an accuracy
    // rule that quietly favours whoever the player is not is the thing that
    // reads as cheating.
    if (e.aimTarget !== t.id) { e.aimTarget = t.id; e.aimFor = 0; }
    e.aimFor = (e.aimFor || 0) + dt;
    // Settles 1 -> 0 across the window; the spread multiplier rides on it.
    const settle = 1 - clamp(e.aimFor / RANGE_IN, 0, 1);

    // 2. Burst discipline.
    if (e.burstRest > 0) { e.burstRest -= dt; return; }
    if (!e.burstLeft || e.burstLeft <= 0) {
      const bonus = e.eff?.burstBonus || 0;
      e.burstLeft = w.auto ? irange(this.r, 2, 5) + bonus : irange(this.r, 1, 2) + (bonus ? 1 : 0);
    }
    if (e.cooldown > 0) return;
    if (e.ammo <= 0) { this.tryReload(e); return; }

    // 3. Aim scatter, in metres at the target, growing steeply with range.
    // Tuned by measurement (tools/balance.mjs, now seeded and deterministic —
    // trust no number from before that). The whole term is the range slope:
    // the old flat 0.9 gave point-blank fire nearly a metre of scatter for
    // free, which is why twelve metres measured the same twelve seconds of
    // life the design wanted at twenty — the curve read flat because its
    // bottom was propped up. Reaction time, ranging-in and burst rests still
    // gate how FAST that accuracy lands, so a knife-range ambush opens with a
    // pause, not an instant kill; it just no longer misses once it starts.
    //
    // Deadeye flattens the range term; being suppressed inflates the whole
    // thing, which is why pinning a position before crossing it works.
    const rangeK = 0.20 * (1 - (e.eff?.rangeAcc || 0));
    const spread = (1 - e.acc) * (d * rangeK)
      * (1 + settle * (RANGE_IN_WIDE - 1))
      * this.coverPenalty(e, t) / this.suppressionPenalty(e);
    // Aim at the middle of whatever is actually showing, not at a fixed chest
    // height. Firing at 1.15m regardless of posture would make a tucked body
    // unhittable anywhere on the map — cover would stop being cover and start
    // being a crouch button that switches off incoming fire.
    const cap = bodyCapsule(t);
    const ty = (cap.lo + cap.hi) / 2;
    this.fire(e,
      t.x + (this.r() - 0.5) * spread * 2,
      ty + (this.r() - 0.5) * spread,
      t.z + (this.r() - 0.5) * spread * 2,
      1);

    e.burstLeft--;
    if (e.burstLeft <= 0) {
      // Aggressive units press harder; cautious ones give the player more room.
      // Suppressed shooters take much longer to put their head back up.
      e.burstRest = range(this.r, 1.0, 2.6) * (1.35 - e.aggression * 0.5)
        * (e.eff?.burstRest || 1) * (1 + (e.suppression || 0) * 1.4);
    }
  }

  /** Cast about near the last known position rather than standing still. */
  wanderNear(dt, e) {
    if (!e.castTo || Math.hypot(e.castTo.x - e.x, e.castTo.z - e.z) < 3) {
      const a = this.r() * Math.PI * 2;
      const r = 6 + this.r() * 10;
      e.castTo = { x: e.x + Math.cos(a) * r, z: e.z + Math.sin(a) * r };
    }
    this.moveToward(dt, e, e.castTo.x, e.castTo.z, e.speed * 0.6);
  }

  /**
   * Gunfire draws people.
   *
   * Alert used to propagate only when a unit ACQUIRED a target, and only 26m.
   * Measured over a minute of contact, that left three to five of twelve
   * hostiles engaged and the rest standing around — the fight arrived, stalled,
   * and never built. A firefight should pull the neighbourhood into itself.
   *
   * Anyone who has not seen anything yet turns toward where the shooting is and
   * goes looking. They do not magically know where you are: they get the
   * shooter's target position, which is a place, not a person.
   */
  raiseAlarm(shooter, at) {
    if (!at) return;
    for (const o of this.entities) {
      if (o === shooter || o.dead || o.down) continue;
      if (o.side !== shooter.side) continue;
      if (o.state === 'engage') continue;
      const d = Math.hypot(o.x - shooter.x, o.z - shooter.z);
      if (d > 45) continue;
      // Closer men react harder, and nobody un-alerts because of this.
      const heat = 1 - (d / 45) * 0.5;
      if ((o.alert || 0) >= heat) continue;
      o.alert = heat;
      const spread = 5 + this.r() * 9;
      const a2 = this.r() * Math.PI * 2;
      o.lastSeen = { x: at.x + Math.cos(a2) * spread, z: at.z + Math.sin(a2) * spread };
      o.state = 'hunt';
      // Keep looking for a while rather than shrugging on arrival.
      o.huntUntil = this.time + 10;
    }
  }

  /**
   * Move toward a goal, routing around geometry when a straight line will not
   * do. A path is computed only when the goal changes materially or the current
   * one goes stale, then followed corner by corner; local avoidance still runs
   * on top for the things a static grid cannot know about, namely other people.
   */
  moveToward(dt, e, tx, tz, speed) {
    const far = Math.hypot(tx - e.x, tz - e.z);
    if (far < 0.05) { e.moveSpeed = 0; return far; }

    // Stair routing. The nav grid is two-dimensional: it can path UNDER a
    // wall walk and declare victory at ground level. When the destination
    // stands well above the mover's feet, the route is the nearest flight
    // of matching height — foot first, then the head, and the treads carry
    // the climb through the elevation stepper below.
    const goalRise = Level.highestSurface(this.level.obstacles, tx, tz)
      - Level.heightAt(tx, tz);
    if (goalRise > 1.2 && (e.elev || 0) < goalRise - 1.2
      && this.level.stairs && this.level.stairs.length) {
      let st = null, sd = Infinity;
      for (const s of this.level.stairs) {
        if (Math.abs(s.top - goalRise) > 2.5) continue;
        const d0 = Math.hypot(s.fx - e.x, s.fz - e.z);
        if (d0 < sd) { sd = d0; st = s; }
      }
      if (st) {
        // Already lifted means already climbing: aim at the head, or the
        // "go to the foot" rule marches them back down the flight they are
        // halfway up and they saw between the two forever.
        const climbing = (e.elev || 0) > 0.4
          || Math.hypot(st.fx - e.x, st.fz - e.z) < 1.4;
        tx = climbing ? st.tx : st.fx;
        tz = climbing ? st.tz : st.fz;
      }
    }

    const needsRepath = !e.path
      || !e.pathGoal
      || Math.hypot(e.pathGoal.x - tx, e.pathGoal.z - tz) > 2.5
      || this.time > (e.pathAt || 0) + 2.5;

    if (needsRepath) {
      e.pathAt = this.time;
      e.pathGoal = { x: tx, z: tz };
      // Straight lines are free; only pay for A* when something is in the way.
      if (this.nav.lineClear(e.x, e.z, tx, tz)) {
        e.path = null;
        e.pathIdx = 0;
      } else {
        const p = this.nav.findPath(e.x, e.z, tx, tz);
        e.path = p && p.length ? p : null;
        e.pathIdx = 0;
      }
    }

    // Aim at the next corner rather than at the goal.
    let aimX = tx, aimZ = tz;
    if (e.path && e.pathIdx < e.path.length) {
      const wp = e.path[e.pathIdx];
      if (Math.hypot(wp.x - e.x, wp.z - e.z) < 1.3) {
        e.pathIdx++;
        if (e.pathIdx >= e.path.length) { e.path = null; e.pathIdx = 0; }
      }
      if (e.path && e.path[e.pathIdx]) {
        aimX = e.path[e.pathIdx].x;
        aimZ = e.path[e.pathIdx].z;
      }
    }

    const dx = aimX - e.x, dz = aimZ - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { e.moveSpeed = 0; return far; }
    let ux = dx / d, uz = dz / d;

    // Local avoidance. The wall-slide probe only runs when there is no path to
    // follow — with a route in hand it fights the corners the path deliberately
    // hugs, and the pair oscillate.
    const probeX = e.x + ux * 1.6, probeZ = e.z + uz * 1.6;
    for (const o of (e.path ? [] : this.level.obstacles)) {
      if ((o.coverH ?? o.h) < 0.6) continue;
      // Walkable tops are ROUTES: a stair's upper treads read as obstacles
      // to this probe and deflected climbers sideways off the flight at its
      // own foot. Whether a given tread is legal THIS step is resolveMove's
      // call, not the steering's.
      if (o.walk) continue;
      if (Math.abs(probeX - o.x) < o.hw + 0.7 && Math.abs(probeZ - o.z) < o.hd + 0.7) {
        // Slide around rather than into.
        const nx = -uz, nz = ux;
        const side = ((e.x - o.x) * nx + (e.z - o.z) * nz) >= 0 ? 1 : -1;
        ux = ux * 0.35 + nx * side * 0.9;
        uz = uz * 0.35 + nz * side * 0.9;
        const m = Math.hypot(ux, uz) || 1;
        ux /= m; uz /= m;
        break;
      }
    }
    for (const o of this.entities) {
      if (o === e || o.dead || o.down) continue;
      const sx = e.x - o.x, sz = e.z - o.z;
      const sd = Math.hypot(sx, sz);
      if (sd < 1.55 && sd > 0.01) {
        ux += (sx / sd) * 0.95;
        uz += (sz / sd) * 0.95;
        const m = Math.hypot(ux, uz) || 1;
        ux /= m; uz /= m;
      }
    }

    // The hill charges for itself. Sample the grade a stride ahead and tax
    // the climb by what the mover is carrying: a maul and a suit of plate
    // arrive at the top of a ridge blown, a bowman barely notices it, and
    // "hold the high ground" becomes a sentence with teeth. Downhill gives
    // a little back, because gravity is on everyone's side equally.
    let slopeMul = 1;
    {
      const ahead = 1.6;
      const rise = Level.heightAt(e.x + ux * ahead, e.z + uz * ahead)
        - Level.heightAt(e.x, e.z);
      const grade = rise / ahead;
      if (grade > 0.04) {
        // Heft: the maul is the worst of it, a bow the least.
        const heft = e.weapon?.id === 'heavy' ? 1.5
          : e.weapon?.melee ? 1.0 : 0.6;
        slopeMul = clamp(1 - grade * 0.85 * heft, 0.45, 1);
      } else if (grade < -0.04) {
        slopeMul = clamp(1 - grade * 0.25, 1, 1.15);
      }
    }
    const step = Math.min(speed * slopeMul * dt, d);
    // Feet matter: a soldier ON a stair tread may cross the next tread, and
    // one on a catwalk walks its decking instead of being stopped by it.
    // Without this every walkable top was a wall and nobody climbed anything.
    const res = Level.resolveMove(this.level.obstacles, e.x, e.z,
      e.x + ux * step, e.z + uz * step,
      Level.heightAt(e.x, e.z) + (e.elev || 0));
    const b = this.level.bounds;
    e.x = clamp(res.x, -b, b);
    e.z = clamp(res.z, -b, b);
    e.moveSpeed = speed;
    // Vertical follow, the AI's whole stance system: step up onto whatever
    // walkable top is within a step of the feet, sink back down when the
    // ground falls away. No jump — troops take the stairs.
    const terr = Level.heightAt(e.x, e.z);
    const surf = Level.surfaceAt(this.level.obstacles, e.x, e.z,
      terr + (e.elev || 0), 0.62) - terr;
    if (surf > (e.elev || 0) - 0.08) e.elev = surf;
    else e.elev = Math.max(surf, (e.elev || 0) - dt * 9);
    // Callers treat this as "how far am I from the goal" — not from the next
    // corner, which would make them think they had arrived mid-route.
    return far;
  }

  faceMotion(e, dt) {
    if (e.moveSpeed > 0.1 && (e.lastX !== undefined)) {
      const dx = e.x - e.lastX, dz = e.z - e.lastZ;
      if (Math.hypot(dx, dz) > 0.001) {
        e.yaw = approachAngle(e.yaw, Math.atan2(dx, dz), dt * 6);
      }
    }
  }

  // ======================================================================
  // Mission flow
  // ======================================================================

  updateMissionLogic(dt) {
    const t = this.spec.type;
    const p = this.player;

    if (t === 'sabotage' && this.chargesPlaced && !this.blown) {
      this.chargeTimer -= dt;
      if (this.chargeTimer <= 0) {
        this.blown = true;
        Audio.explosion({ x: -p.x, z: -p.z });
        this.shake = 1.2;
        this.onToast('MAST DOWN', 'Rampart 12 is off the air', 'good');
      }
    }

    if (t === 'recovery') this.updateRecovery();
    if (t === 'seize') this.updateSeize(dt);
    if (t === 'titan') this.updateTitanObjective();
    if (t === 'raid') this.updateRaid();

    if (t === 'defense') {
      if (this.spec.defend) this.updateSiegeHold(dt);
      else this.updateDefense(dt);
    }

    if (this.stages?.length && this.stageIndex >= 0) this.updateStages(dt);
    if (t === 'pit') this.updatePit(dt);
    if (t === 'siege') {
      this.updateSiege(dt);
      this.updateSkirmishWaves();
    }
    // Any mission fought with an army at your back feeds its ranks in.
    this.updateAlliedWaves();

    if (t === 'lair' && !this.objective.done && this.objective.type !== 'stage') {
      const onField = this.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
      this.objective.progress = this.entities.filter((e) => e.side === 'enemy' && e.dead).length;
      this.updateSkirmishWaves();
      if (onField === 0 && this.skirmishCommitted >= this.skirmishTotal) this.completeObjective();
      else this.guardAgainstStall(dt);
    }

    // Reinforcements promised on the map arrive in the player's battle: the
    // parties that were marching toward the fight when it was joined walk in
    // late, on whichever side they were coming for.
    if (this.spec.late && !this.lateDone && this.time > this.spec.late.at) {
      this.lateDone = true;
      const L = this.spec.late;
      if (L.enemies) {
        this.spawnReinforcements(Math.min(6, Math.round(L.enemies)));
        this.onToast('CONTACTS', 'More of them arriving', 'bad');
      }
      if (L.allies) {
        const sp = this.level.playerSpawn;
        const n = Math.min(6, Math.round(L.allies));
        for (let i = 0; i < n; i++) {
          const ent = this.spawnEntity({
            id: `late_ally_${i}`, side: 'player',
            faction: this.spec.allyFaction || 'syndic',
            x: sp.x - 10 + (i % 3) * 6, z: sp.z + 6 + Math.floor(i / 3) * 5,
            yaw: 0, hp: 80, weapon: i % 2 ? 'sword' : 'spear',
            model: this.spec.allyFaction === 'trust' ? 'soldier_trust' : 'soldier_syndic',
            acc: 0.46, speed: 4.0, aggression: 0.55, coverPref: 0.6,
            name: 'Allied fighter',
          });
          ent.militia = true;
          this.squad.push(ent);
        }
        this.onToast('REINFORCEMENTS', 'Friends arriving behind you', 'good');
      }
    }

    if (t === 'skirmish' && !this.objective.done && this.objective.type !== 'stage') {
      const onField = this.entities.filter((e) => e.side === 'enemy' && !e.dead).length;
      const killed = this.entities.filter((e) => e.side === 'enemy' && e.dead).length;
      this.objective.progress = killed;
      this.updateSkirmishWaves();
      // Only over once the whole party is accounted for, not just this wave.
      if (onField === 0 && this.skirmishCommitted >= this.skirmishTotal) this.completeObjective();
      else this.guardAgainstStall(dt);
    }

    // Extraction: reach the marker. For a recovery, the people you came for
    // have to be standing there too, which is the whole point of the mission.
    if (this.extractArmed && !this.over) {
      const ex = this.level.extraction;
      const d = Math.hypot(p.x - ex.x, p.z - ex.z);
      if (t === 'defense') {
        // Nothing to walk to — holding IS the objective.
      } else if (d < 4.5) {
        const stragglers = this.prisoners.filter(
          (q) => q.released && !q.dead && Math.hypot(q.x - ex.x, q.z - ex.z) > 8);
        if (stragglers.length) {
          this.extractBlocked = 'Freed personnel are not at the extraction point';
        } else {
          this.extractBlocked = null;
          // Walking out having lost everyone you came for is an extraction,
          // not a success.
          this.endMission(!this.objective.failed, 'extracted');
        }
      } else {
        this.extractBlocked = null;
      }
    }

    // Total squad loss.
    const alive = this.entities.filter(
      (e) => e.side === 'player' && !e.dead && !e.down && !e.militia);
    if (!alive.length && !this.over) this.endMission(false, 'wiped');
  }

  /**
   * Recovery progress, recomputed from who is actually still alive.
   *
   * The objective used to need a fixed three releases. A held prisoner caught
   * by a stray round could therefore never be freed, the count could never
   * reach three, extraction never armed, and the deployment was unwinnable with
   * no indication why. The target is now whoever is still breathing, and if
   * they all die the objective fails honestly and lets the player leave.
   */
  updateRecovery() {
    if (!this.prisoners || !this.prisoners.length) return;
    const alive = this.prisoners.filter((p) => !p.dead);
    const freed = alive.filter((p) => p.released);

    // Announce losses once each, so the player understands why the count moved.
    for (const p of this.prisoners) {
      if (p.dead && !p.deathReported) {
        p.deathReported = true;
        this.lostPrisoners = (this.lostPrisoners || 0) + 1;
        this.onToast('PERSONNEL LOST',
          p.released ? 'One of the freed did not make it' : 'One of the held was killed', 'bad');
      }
    }

    if (!alive.length) {
      // Nobody left to recover. Arm extraction so the player is not stranded,
      // but the contract is not satisfied.
      if (!this.objective.failed) {
        this.objective.failed = true;
        this.objective.text = 'No surviving personnel — withdraw';
        this.onToast('OBJECTIVE LOST', 'There is nobody left to bring out', 'bad');
        this.extractArmed = true;
        const ex = this.level.extraction;
        this.extractMarker.position.set(ex.x, Level.heightAt(ex.x, ex.z) + 0.05, ex.z);
        this.extractMarker.visible = true;
        Audio.extractTone();
      }
      return;
    }

    // Only while the recovery IS the current objective. A stage borrows
    // this.objective once the primary completes, and this method runs every
    // frame — "everyone is freed" stayed true, so it re-completed the stage
    // objective the frame it opened and the whole chain fell through in two
    // frames, arming extraction from the pen. Heavy recoveries never actually
    // ran their stages until this guard. (The death toasts and the
    // nobody-left-to-recover path above stay live throughout — a loss is a
    // loss whichever objective is on the HUD.)
    if (this.objective.type !== 'recovery') return;
    this.objective.need = alive.length;
    this.objective.progress = freed.length;
    if (!this.objective.done && freed.length >= alive.length) this.completeObjective();
  }

  updateDefense(dt) {
    this.waveTimer -= dt;
    const enemiesLeft = this.entities.filter((e) => e.side === 'enemy' && !e.dead).length;

    if (!this.waveActive && this.waveTimer <= 0) {
      this.wave++;
      if (this.wave > 3) {
        this.objective.progress = 3;
        this.completeObjective();
        this.endMission(true, 'held');
        return;
      }
      this.waveActive = true;
      const n = 3 + this.wave;
      const side = this.wave % 2 === 0 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const a = (side > 0 ? -0.4 : 2.6) + range(this.r, -0.8, 0.8);
        const d = 48;
        const e = this.reinforce(Math.cos(a) * d, Math.sin(a) * d,
          pick(this.r, ['rifleman', 'rifleman', 'breacher', 'gunner', 'marksman']));
        e.state = 'hunt';
        e.lastSeen = { x: 0, z: 0 };
        e.alert = 1;
      }
      Audio.uiAlert();
      this.onToast(`WAVE ${this.wave} OF 3`, 'Trust element inbound', 'bad');
    }

    if (this.waveActive && enemiesLeft === 0) {
      this.waveActive = false;
      this.waveTimer = 16;
      this.objective.progress = this.wave;
      if (this.wave < 3) this.onToast('WAVE REPELLED', 'They will come again', 'good');
    }
  }

  /**
   * Last line of defence for elimination objectives.
   *
   * If nothing has died for a long time and no hostile is anywhere near the
   * player, something has gone wrong — a straggler wedged somewhere, or an AI
   * that never acquired. Rather than leave the player stuck in a mission they
   * cannot finish, push the remainder toward them; if it is still stuck after
   * that, arm extraction so they can at least walk out.
   */
  guardAgainstStall(dt) {
    const foes = this.entities.filter((e) => e.side === 'enemy' && !e.dead);
    if (!foes.length) return;
    const nearest = Math.min(...foes.map((e) =>
      Math.hypot(e.x - this.player.x, e.z - this.player.z)));
    const progressing = this.objective.progress !== this._lastKillCount;
    this._lastKillCount = this.objective.progress;
    if (progressing || nearest < 45) { this.stallFor = 0; return; }

    this.stallFor = (this.stallFor || 0) + dt;
    if (this.stallFor > 12 && !this.stallNudged) {
      this.stallNudged = true;
      // Everyone left comes to find the player.
      for (const e of foes) {
        e.state = 'hunt';
        e.alert = 1;
        e.lastSeen = { x: this.player.x, z: this.player.z };
        e.path = null; e.pathGoal = null;
        const safe = this.safeSpawn(e.x, e.z);
        e.x = safe.x; e.z = safe.z;
      }
      this.onToast('THEY ARE CLOSING', 'The rest of them are coming to you', 'bad');
    }
    if (this.stallFor > 40 && !this.extractArmed) {
      // Still nothing. Do not strand the player in an unwinnable deployment.
      this.objective.text = 'Unable to close — withdraw';
      this.completeObjective();
      this.onToast('BREAK OFF', 'They cannot be brought to battle. Extract.', 'bad');
    }
  }

  endMission(success, reason) {
    if (this.over) return;
    this.over = true;
    if (document.pointerLockElement) document.exitPointerLock();
    Audio.stopAmbience();
    if (success) Audio.extractTone(); else Audio.casualtyTone();

    // Resolve every roster soldier who deployed. This is the moment the
    // campaign learns what happened, and it is deliberately unforgiving about
    // people who were left on the ground.
    const soldierResults = [];
    const r = this.r;
    let recruits = [];

    for (const ent of [this.player, ...this.squad]) {
      if (!ent.soldier) continue;
      const s = ent.soldier;
      const rec = { id: s.id, kills: ent.killCount || 0 };
      if (ent.fled) {
        // Broke and ran. They are not a casualty — they are a man who was
        // somewhere else when it mattered, and they come back knowing it.
        // Recording them dead (they leave the field with `dead` set, which
        // is how the sim takes them off the board) would quietly execute
        // everyone whose nerve failed.
        s.status = STATUS.HEALTHY;
        s.hp = Math.max(1, Math.round(ent.maxHp * 0.5));
        s.regard = clamp((s.regard || 0) - 8, -100, 100);
        rec.status = STATUS.HEALTHY;
        rec.hp = s.hp;
        rec.fled = true;
      } else if (ent.dead) {
        // Already bled out in the field. The HUD counted that timer down to
        // zero and announced it, so there is no second chance here — giving
        // one made the bleed-out timer meaningless.
        s.status = STATUS.DEAD;
        s.hp = 0;
        rec.status = STATUS.DEAD;
        rec.hp = 0;
      } else if (ent.down) {
        // Down at mission end and never stabilised: left behind.
        const st = resolveCasualty(r, s, {
          stabilised: success && this.extractArmed ? true : false,
          hasMedic: this.squadHasRole('medic'),
          survivalBonus: this.company.casualtySurvival,
        });
        rec.status = st;
        rec.wound = s.wound;
        rec.hp = s.hp;
      } else if (ent.stabilised || ent.hp < ent.maxHp * 0.4) {
        const st = resolveCasualty(r, s, { stabilised: true, hasMedic: this.squadHasRole('medic') });
        rec.status = st;
        rec.wound = s.wound;
        rec.hp = s.hp;
      } else {
        rec.status = STATUS.HEALTHY;
        rec.hp = Math.max(1, Math.round(ent.hp));
      }
      soldierResults.push(rec);
    }

    // Rescued personnel who actually reached the extraction join the company.
    if (this.spec.type === 'recovery' && success) {
      const ex = this.level.extraction;
      for (const q of this.prisoners) {
        if (!q.released || q.dead) continue;
        if (Math.hypot(q.x - ex.x, q.z - ex.z) > 12) continue;
        const s = makeSoldier(r, {
          role: q.isMedic ? 'medic' : 'rifleman',
          rank: q.isMedic ? 1 : 0,
          how: `Rescued at ${this.spec.siteName || this.level.name}`,
          day: this.S.day,
          avoid: [...this.S.roster.map((x) => x.name), ...recruits.map((x) => x.name)],
        });
        recruits.push(s);
      }
    }

    // Everything picked up off the field, on top of whatever the objective
    // itself paid out.
    const loot = {
      credits: this.loot.credits,
      weapons: [],
      armoury: this.loot.armoury,
      armourPool: this.loot.armourPool,
      kitPool: this.loot.kitPool,
    };
    if (this.cacheTaken) {
      loot.credits = irange(r, 180, 320);
      // The prototype is the one memorable pull in the slice, and it only
      // exists behind an optional objective.
      loot.weapons.push(this.spec.type === 'sabotage' ? 'relic' : 'dmr');
    }

    this.result = {
      success,
      reason,
      type: this.spec.type,
      site: this.spec.site,
      // How many stores were actually broken open, so the campaign can pay out
      // on what was carried rather than on the objective being ticked.
      raidTaken: this.raidTaken || 0,
      kills: this.entities.filter((e) => e.side === 'enemy' && e.dead).length,
      soldierResults,
      recruits,
      loot,
      lostPrisoners: this.lostPrisoners || 0,
      retake: this.spec.contract?.retake || null,
      suppliesUsed: 2 + Math.floor(this.stats.shotsFired / 90),
      medicalUsed: this.stats.medkitsUsed,
      stats: this.stats,
      levelName: this.level.name,
      partyId: this.spec.party?.id || null,
      // Who beat you, for the campaign to work out whose cell you are in.
      enemyFaction: this.level?.enemyFaction || this.spec.enemyFaction || null,
      // How many rounds were actually survived, which is what the pit pays on.
      pitRounds: this.pitBest || 0,
      // The stake the commander put on themselves at the door. Already
      // deducted; the campaign pays it out only if the whole card was cleared.
      wager: this.spec.wager || 0,
    };

    setTimeout(() => this.onEnd(this.result), 1400);
  }

  // ======================================================================
  // Camera & render
  // ======================================================================

  /**
   * Deployment sweep. Opens looking down at the objective from high and wide —
   * so the first thing the player sees is the place they have to take — then
   * falls back and settles into the over-the-shoulder gameplay pose.
   */
  introCamera(gameplayPos, gameplayLook) {
    const it = this.intro;
    const k = clamp(it.t / it.dur, 0, 1);
    // Ease out hard so the motion decelerates into the handover rather than
    // stopping dead.
    const e = 1 - Math.pow(1 - k, 3);

    const obj = this.level.objectivePoint;
    const oy = Level.heightAt(obj.x, obj.z);
    // A slow orbit while descending gives the shot some life.
    const ang = -0.5 + k * 0.55;
    const high = new THREE.Vector3(
      obj.x + Math.sin(ang) * 46,
      oy + 40 - k * 8,
      obj.z + Math.cos(ang) * 46,
    );
    const lookHigh = new THREE.Vector3(obj.x, oy + 2, obj.z);

    this.camera.position.copy(high).lerp(gameplayPos, e);
    const look = lookHigh.clone().lerp(gameplayLook, e);
    this.camera.lookAt(look);
  }

  /**
   * Advance the deployment cinematic and hand control back when it is done.
   * Deliberately separate from introCamera(): the handover is a rule of the
   * game, not a property of where the camera happens to be.
   */
  tickIntro(dt) {
    const it = this.intro;
    if (!it?.active) return;
    it.t += dt;
    if (it.t < it.dur) return;
    it.active = false;
    this.requestLock();
    this.onToast(`CONTACT IMMINENT — ${this.level.name}`, this.objective.text, 'deploy');
  }

  updateCamera(dt) {
    if (this.rts && !this.intro?.active) { this.updateTacticalCamera(dt); return; }
    const p = this.player;
    const aim = this.aiming;
    // Over-the-shoulder, tighter and closer when aiming.
    // The shoulder offset has to be wide enough that the character sits beside
    // the reticle rather than under it — otherwise the player is aiming through
    // their own back and cannot see what they are shooting at.
    const want = aim
      ? { side: 0.95, up: 1.70, back: 2.60, fov: 44 }
      : { side: 1.05, up: 2.02, back: 4.60, fov: 60 };
    // Crouching drops the eye line; a jump carries the camera with the body.
    want.up += -this.crouch * 0.62 + this.airY;
    // A swing reads on the camera: the eye pulls back and widens through
    // the arc, so your own steel is visible leaving and landing instead of
    // happening under the lens.
    const sw = this.player?.swing;
    if (sw && this.player.weapon?.melee) {
      const bell = Math.sin(Math.min(1, sw.t / sw.dur) * Math.PI);
      want.back += bell * 0.85;
      want.fov += bell * 5;
      want.up += bell * 0.12;
    }
    // The shoulder offset is signed, so swapping mirrors the whole rig — the
    // camera, the aim origin beside the head, and the body's occlusion.
    want.side *= this.shoulder;
    this.camLerp = this.camLerp || { ...want };
    const k = 1 - Math.exp(-dt * 11);
    for (const key of ['side', 'up', 'back', 'fov']) {
      this.camLerp[key] = lerp(this.camLerp[key], want[key], k);
    }
    if (Math.abs(this.camera.fov - this.camLerp.fov) > 0.01) {
      this.camera.fov = this.camLerp.fov;
      this.camera.updateProjectionMatrix();
    }

    // The aim origin sits beside the head, not on the spine, so the shoulder
    // offset does not skew where shots land relative to the reticle.
    const base = new THREE.Vector3(p.x, Level.heightAt(p.x, p.z) + this.camLerp.up, p.z);
    const shoulder = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw))
      .multiplyScalar(this.camLerp.side * 0.45);
    base.add(shoulder);
    const dir = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    );
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const want3 = base.clone()
      .add(dir.clone().multiplyScalar(this.camLerp.back))
      .add(right.multiplyScalar(this.camLerp.side));

    // Pull the camera in if geometry is between it and the player, so the view
    // never ends up inside a container.
    const toCam = want3.clone().sub(base);
    const len = toCam.length();
    const hit = this.rayHit(base, toCam.clone().normalize(), len, p);
    let finalPos = want3;
    let camDist = len;
    const dirToCam = toCam.clone().normalize();
    // Pull in for terrain as well as props. Only testing 'solid' let the camera
    // sink through rising ground, which put the view inside the hillside.
    if ((hit.kind === 'solid' || hit.kind === 'ground') && hit.t < len) {
      // Never pull closer than this: at half a metre the commander's back fills
      // the screen and the player cannot see what they are aiming at.
      camDist = Math.max(1.45, hit.t - 0.28);
      finalPos = base.clone().add(dirToCam.clone().multiplyScalar(camDist));
    }

    // Belt and braces: if the resulting point is still inside a prop, walk it
    // back toward the player until it is not. A single ray misses the case
    // where the camera starts the frame already embedded in geometry.
    for (let i = 0; i < 6; i++) {
      const inside = this.level.obstacles.some((o) =>
        Math.abs(finalPos.x - o.x) < o.hw + 0.2
        && Math.abs(finalPos.z - o.z) < o.hd + 0.2
        && finalPos.y > o.y - 0.2 && finalPos.y < o.y + o.h + 0.2);
      if (!inside || camDist <= 0.75) break;
      camDist = Math.max(0.75, camDist - 0.55);
      finalPos = base.clone().add(dirToCam.clone().multiplyScalar(camDist));
    }

    // And never let the eye drop below the ground it is standing over.
    const floor = Level.heightAt(finalPos.x, finalPos.z) + 0.4;
    if (finalPos.y < floor) finalPos.y = floor;
    // Even at the floor distance the body can crowd the frame, so drop it out
    // of the render when the camera is right on top of it.
    this.hidePlayerModel = camDist < 1.95;

    // Screen shake decays fast; it punctuates, it does not linger.
    this.shake = Math.max(0, (this.shake || 0) - dt * 2.6);
    if (this.shake > 0) {
      finalPos.x += (Math.random() - 0.5) * this.shake * 0.16;
      finalPos.y += (Math.random() - 0.5) * this.shake * 0.16;
      finalPos.z += (Math.random() - 0.5) * this.shake * 0.16;
    }

    // Bias the look target down so the commander sits in the lower third of
    // the frame instead of being cropped by the bottom edge.
    const look = base.clone().sub(dir.clone().multiplyScalar(9));
    look.y -= aim ? 0.35 : 0.85;

    if (this.intro?.active) {
      this.introCamera(finalPos, look);
    } else {
      this.camera.position.copy(finalPos);
      this.camera.lookAt(look);
    }

    // Keep the sun's shadow box following the player or shadows pop out.
    this.sun.position.set(p.x - 46, 38, p.z + 30);
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.target.updateMatrixWorld();
  }

  syncVisuals(dt) {
    this.syncRings();
    this.syncBanners();
    for (const e of this.entities) {
      const y = Level.heightAt(e.x, e.z);
      e.y = y;
      // The player's stance is carried on the group: crouch sinks the whole
      // body, a jump lifts it. Everything else about the pose is animation.
      // Elevation applies to everyone — an AI holding a catwalk stands on it,
      // not inside it. Crouch and the jump arc are the player's alone.
      const stance = (e.elev || 0)
        + (e.isPlayer ? -this.crouch * 0.42 : 0);
      e.char.group.position.set(e.x, y + stance, e.z);
      e.char.group.rotation.y = e.yaw;

      const aiming = !!(e.target && !e.down && !e.dead) || (e.isPlayer && this.aiming);

      // Animation level of detail. A soldier eighty metres away in fog does
      // not need a sixty-hertz gait, and at forty combatants that work adds
      // up. Anchored to WHERE THE EYE IS: the player's body in the shoulder
      // view, the tactical focus when commanding — measuring from the body
      // while the camera was across the map put full-rate animation exactly
      // where nobody was looking.
      const anchorX = this.rts && this.rtsFocus ? this.rtsFocus.x : this.player.x;
      const anchorZ = this.rts && this.rtsFocus ? this.rtsFocus.z : this.player.z;
      const dxc = e.x - anchorX, dzc = e.z - anchorZ;
      const distSq = dxc * dxc + dzc * dzc;
      if (distSq > 55 * 55 && !e.isPlayer) {
        e.animSkip = (e.animSkip || 0) + 1;
        if (e.animSkip % 3 !== 0) continue;
      } else if (distSq > 30 * 30 && !e.isPlayer) {
        e.animSkip = (e.animSkip || 0) + 1;
        if (e.animSkip % 2 !== 0) continue;
      }
      // Distant characters stop casting shadows — a hard shadow map at that
      // range contributes nothing and costs a full extra pass per mesh.
      const wantShadow = distSq < 45 * 45;
      if (e.castsShadow !== wantShadow) {
        e.castsShadow = wantShadow;
        e.char.group.traverse((o) => { if (o.isMesh) o.castShadow = wantShadow; });
      }

      // Actual displacement this frame, rotated into the character's own frame,
      // so the animation knows whether it is walking, backpedalling or
      // side-stepping. Derived from real movement rather than from input, so it
      // works identically for the player and every AI.
      let mx = 0, mz = 0, measured = 0;
      if (dt > 0 && e.lastX !== undefined) {
        const vx = (e.x - e.lastX) / dt;
        const vz = (e.z - e.lastZ) / dt;
        measured = Math.hypot(vx, vz);
        if (measured > 0.05) {
          const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
          mz = (vx * sy + vz * cy) / measured;   // along facing
          mx = (vx * cy - vz * sy) / measured;   // to the right
        }
      }
      // Trust the measured speed: an entity ordered to move but jammed against
      // a container should not keep playing a walk cycle on the spot.
      const speed = Math.min(e.moveSpeed || 0, measured || (e.moveSpeed || 0));

      const w = e.weapon;
      const reload = (w && e.reloading > 0) ? 1 - (e.reloading / w.reload) : 0;

      // Stand on the slope rather than in it.
      //
      // Everyone is placed at a single heightAt() sample and drawn bolt
      // upright, which was exactly right while the ground was flat and became
      // the most obvious artefact of giving it relief: on a 17 degree slope the
      // downhill boot hangs in the air and the uphill one disappears into the
      // dirt. Sampling across a stance width and leaning the body to match puts
      // both feet back on the ground.
      //
      // Not applied to anyone standing on something. A catwalk is level however
      // the terrain under it runs, and tilting a soldier to match the hillside
      // beneath a walkway would lean them off it.
      let slopePitch = 0, slopeRoll = 0;
      if (!e.elev) {
        const S = 0.55;                       // about half a stance
        const gx = (Level.heightAt(e.x + S, e.z) - Level.heightAt(e.x - S, e.z)) / (2 * S);
        const gz = (Level.heightAt(e.x, e.z + S) - Level.heightAt(e.x, e.z - S)) / (2 * S);
        const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
        // Into the character's own frame: how the ground runs ahead of them,
        // and how it runs across them.
        const ahead = gx * sy + gz * cy;
        const across = gx * cy - gz * sy;
        // Rising ahead leans them back; rising to the right lifts that side.
        slopePitch = -Math.atan(ahead);
        slopeRoll = Math.atan(across);
      }

      e.char.update(dt, {
        speed,
        moveX: mx,
        moveZ: mz,
        aiming,
        down: e.down && !e.dead,
        dead: e.dead,
        pitch: e.isPlayer ? this.camPitch : 0,
        reload,
        sprint: e.isPlayer ? (this.keys.has('shift') && !this.aiming && speed > 4) : false,
        turn: e.turnRate || 0,
        slopePitch,
        slopeRoll,
        // The melee era: swing phase 0..1, its thrown direction, and the
        // guard blend. The rig turns these into arms; nothing else does.
        // Bows take the same branch: they need a pose of their own too, and
        // the rifle pose stands a recurve sideways in the fist.
        melee: !!(e.weapon?.melee || e.weapon?.bow),
        swing: e.swing ? Math.min(1, e.swing.t / e.swing.dur) : 0,
        swingDir: e.swing?.dir || 'right',
        guard: e.guard || 0,
        // How THIS weapon sits in the hand — a spear is not a sword held
        // longer, and one shared pose put the shaft through the ribs.
        hold: e.weapon?.hold || null,
        guardPose: e.weapon?.guard || null,
      });
      // Anything standing on top of the camera is removed from the render.
      // A squadmate holding formation directly behind the commander sits almost
      // exactly where the third-person camera lives, and fills the screen.
      if (e.isPlayer) {
        e.char.group.visible = !this.hidePlayerModel;
      } else {
        const cp = this.camera.position;
        e.char.group.visible = Math.hypot(cp.x - e.x, cp.z - e.z) > 1.35;
      }
    }
    if (this.orderMarker.visible && this.time > (this.orderMarkerUntil || 0)) {
      this.orderMarker.visible = false;
    }
    if (this.extractMarker.visible) {
      this.extractMarker.rotation.y += dt * 0.8;
      this.extractMarker.children[0].material.opacity = 0.5 + Math.sin(this.time * 3) * 0.25;
    }
  }

  /** One short verb describing what a soldier is doing, for the squad panel. */
  actionOf(e) {
    if (e.dead) return 'KIA';
    if (e.down) return e.stabilised ? 'STABLE' : 'DOWN';
    if (e.reloading > 0) return 'RELOAD';
    if (e.order === 'charge') return 'CHARGING';
    if (e.order === 'suppress') return 'SUPPRESS';
    if (e.order === 'flank') return 'FLANKING';
    if (e.order === 'fallback') return 'FALLBACK';
    if ((e.suppression || 0) > 0.45) return 'PINNED';
    if (e.target && e.cooldown < 0.4) return 'ENGAGING';
    if (e.coverPos && (e.moveSpeed || 0) < 0.2 && e.target) return 'IN COVER';
    if ((e.moveSpeed || 0) > 0.2) return 'MOVING';
    if (e.order === 'hold') return 'HOLDING';
    return 'READY';
  }

  buildHud() {
    const p = this.player;
    const squadInfo = [this.player, ...this.squad].filter((e) => e.soldier || e.militia).map((e) => ({
      name: e.soldier ? e.soldier.name : e.name,
      rank: e.soldier ? e.soldier.rank : -1,
      role: e.soldier ? e.soldier.role : 'militia',
      isCommander: !!e.soldier?.isCommander,
      hp: Math.max(0, e.hp), maxHp: e.maxHp,
      down: e.down, dead: e.dead, stabilised: e.stabilised,
      bleed: e.down && !e.stabilised ? Math.max(0, e.bleed / (e.bleedMax || BLEED_OUT)) : 0,
      isPlayer: e.isPlayer,
      militia: !!e.militia,
      action: this.actionOf(e),
      suppression: e.suppression || 0,
      // Slot number the player presses to select this soldier.
      slot: e.isPlayer || e.militia ? 0 : this.squad.indexOf(e) + 1,
      selected: !e.isPlayer && !e.militia && this.selection.has(this.squad.indexOf(e)),
    }));
    return {
      hp: Math.max(0, p.hp), maxHp: p.maxHp,
      ammo: p.ammo, mag: p.weapon.mag, reloading: p.reloading > 0,
      weapon: p.weapon.abbr, weaponName: p.weapon.name,
      // The melee era's readout: wind instead of rounds, plate instead of
      // a magazine. The shell decides how to draw it.
      melee: !!p.weapon.melee,
      stamina: this.pStamina,
      shieldHp: p.shieldHp || 0,
      guarding: (p.guard || 0) > 0,
      aiming: this.aiming,
      // The insertion cinematic is a camera move, not gameplay. The crosshair
      // sat over it the whole way in, which reads as though the player has
      // control while the camera is flying itself somewhere.
      inserting: this.inserting,
      // Being in cover has to be legible at a glance, or the player never
      // trusts it enough to use it under fire.
      cover: this.cover ? (this.coverLean > 0.5 ? 'leaning' : 'tucked') : null,
      objective: this.objective.text,
      objProgress: this.objective.progress,
      objNeed: this.objective.need,
      objDone: this.objective.done,

      // Who the squad has been told to kill. Held until they are down or out of
      // range, because the mark is the answer to "which one, in all this".
      marked: this.marked && !this.marked.dead ? {
        name: this.marked.name || 'TARGET',
        hp: Math.max(0, this.marked.hp) / (this.marked.maxHp || 1),
        dist: Math.round(Math.hypot(this.marked.x - this.player.x, this.marked.z - this.player.z)),
      } : null,

      // The Titan needs its own readout. A single health bar on a machine that
      // shrugs off rifle fire tells the player nothing except that they are
      // losing; what they need is which sections are still armoured.
      titan: this.titan && !this.titan.dead ? {
        structure: Math.max(0, this.titan.hp) / (this.titan.maxHp || 1),
        plates: this.titan.plates.map((pl) => ({
          id: pl.id,
          frac: pl.broken ? 0 : Math.max(0, pl.hp) / pl.maxHp,
          broken: pl.broken,
        })),
      } : null,

      // The army ticker: total strength either side of a big battle, front
      // rank plus everything still mustering. Only when the fight is army-
      // sized — a six-man skirmish does not need a war scoreboard.
      armies: ((this.alliesTotal || 0) >= 20 || (this.skirmishTotal || 0) >= 20) ? {
        ours: this.squad.filter((s) => !s.dead && !s.down).length
          + Math.max(0, (this.alliesTotal || 0) - (this.alliesCommitted || 0)),
        theirs: this.entities.filter((e) => e.side === 'enemy' && !e.dead).length
          + Math.max(0, (this.skirmishTotal || 0) - (this.skirmishCommitted || 0)),
      } : null,

      tactical: this.rts,
      // The field map: in tactical mode the radar stops being a personal
      // sensor and becomes the warband's map of the whole ground — fixed
      // north, every living body, the objective, and where the eye is.
      // Mount & Blade with guns, not an RTS strategy screen: it shows the
      // battle, it does not run an economy.
      map: this.rts ? {
        bounds: this.level.bounds,
        focus: { x: this.rtsFocus.x, z: this.rtsFocus.z },
        zoom: this.rtsZoom,
        objective: this.level.objectivePoint
          ? { x: this.level.objectivePoint.x, z: this.level.objectivePoint.z } : null,
        blips: this.entities.filter((e) => !e.dead).map((e) => ({
          x: e.x, z: e.z, side: e.side, down: !!e.down, isPlayer: !!e.isPlayer,
        })),
      } : null,
      extract: this.extractArmed,
      extractBlocked: this.extractBlocked,
      extractDist: this.extractArmed
        ? Math.hypot(p.x - this.level.extraction.x, p.z - this.level.extraction.z) : 0,
      squad: squadInfo,
      squadOrder: this.squadOrder,
      formation: (FORMATIONS[this.formation] || FORMATIONS.wedge).name,
      selectionCount: this.selection.size,
      selectionLabel: this.selectionLabel(),
      // The screen closing in was rounds cracking past your head. Steel does
      // not suppress — being pressed is what the wind bar is for — so the
      // vignette reports the commander's WIND instead, and only once it is
      // genuinely low enough to be in trouble.
      suppression: p.weapon?.melee
        ? Math.max(0, (0.32 - this.pStamina) * 1.6)
        : (p.suppression || 0),
      interact: this.nearInteract ? {
        label: this.nearInteract.kind === 'revive'
          ? `Stabilise ${this.nearInteract.entity.name}`
          : this.nearInteract.label,
        progress: this.interactProgress || 0,
        needsKit: this.nearInteract.kind === 'revive',
        kits: this.S.medical,
      } : null,
      timer: this.spec.type === 'sabotage' && this.chargesPlaced && !this.blown
        ? Math.max(0, this.chargeTimer) : null,
      // A siege hold has no scripted waves — its "timer" is the army ticker
      // and the sappers at the gate, so it must not borrow this readout.
      wave: this.spec.type === 'defense' && !this.spec.defend
        ? { n: this.wave, of: 3, next: Math.max(0, this.waveTimer), active: this.waveActive } : null,
      seize: this.spec.type === 'seize' ? {
        pct: Math.round(((this.holdProgress || 0) / (this.holdSeconds || 1)) * 100),
        contested: this.entities.some((e) => e.side === 'enemy' && !e.dead
          && Math.hypot(e.x - this.level.objectivePoint.x,
            e.z - this.level.objectivePoint.z) < 20),
      } : null,
      enemiesVisible: this.entities.filter((e) => e.side === 'enemy' && !e.dead
        && Math.hypot(e.x - p.x, e.z - p.z) < 60).length,
      compass: this.camYaw,
      hurt: this.hurtFlash || 0,
      hit: this.hitAt != null && this.time - this.hitAt < 0.16,
      // Recent hits, as bearings relative to where the player is looking:
      // 0 is straight ahead, positive is to the right. Converted here rather
      // than in the renderer because the camera angle lives on this side.
      hurtFrom: (this.hurtFrom || [])
        .filter((h) => this.time - h.t < 2.2)
        .map((h) => ({
          rel: h.a - (this.camYaw + Math.PI),
          age: (this.time - h.t) / 2.2,
          dmg: h.dmg,
        })),
      paused: this.paused,
      over: this.over,
      levelName: this.level.name,
      // Radar contacts, in player-local space.
      contacts: this.entities.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.z - p.z) < 55)
        .map((e) => ({
          dx: e.x - p.x, dz: e.z - p.z,
          side: e.side, down: e.down, isPlayer: e.isPlayer,
        })),
      cache: this.optional ? { taken: !!this.optional.taken } : null,
    };
  }

  /**
   * One tick of simulation, with no rendering and no clock of its own.
   *
   * Split out of loop() so the mission can be driven headlessly — tools/soak.mjs
   * runs thousands of these to prove a deployment always reaches a terminal
   * state. Anything that must happen whether or not a frame is drawn belongs
   * here; anything to do with pixels stays in loop().
   */
  step(dt) {
    if (this.paused || this.over) return;
    // The wheel slows the world rather than stopping it. Stopping would make
    // orders free; slowing means deciding still costs you ground.
    if (this.wheel?.open) dt *= 0.28;
    this.time += dt;
    this.tickIntro(dt);
    // Snapshot every position BEFORE anything moves. Capturing the player's
    // after updatePlayer made their measured velocity permanently zero, so
    // the commander never played a walk cycle.
    for (const e of this.entities) {
      e.lastX = e.x; e.lastZ = e.z; e.lastYaw = e.yaw;
    }
    this.updatePlayer(dt);
    for (const e of this.entities) {
      if (e.isTitan) this.updateTitan(dt, e);
      else if (!e.isPlayer || e.down) this.updateAI(dt, e);
      // Turn rate drives the lean, so a character banks into a hard turn.
      e.turnRate = dt > 0 ? angleDelta(e.lastYaw, e.yaw) / dt : 0;
    }
    this.updateArrows(dt);
    this.updateEnemyCommander(dt);
    this.updateMorale(dt);
    this.updateMark();
    this.updateMissionLogic(dt);
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 1.6);
  }

  loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 0.05); // never let a stall teleport anyone through a wall

    this.step(dt);
    this.updateEffects(dt);
    this.syncVisuals(this.paused ? 0 : dt);
    this.updateCharBatch();
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.onHud(this.buildHud());
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const a of this.arrows || []) if (a.mesh) this.scene.remove(a.mesh);
    this.arrows = [];
    // The standards are per-mission meshes with their own geometry.
    for (const b of (this.banners || new Map()).values()) {
      this.scene.remove(b.group);
      b.group.traverse?.((o) => {
        if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
      });
    }
    this.banners = new Map();
    this.arrowGeo?.dispose?.();
    this.arrowMat?.dispose?.();
    this.arrowGeo = this.arrowMat = null;
    window.removeEventListener('resize', this.onResize);
    for (const [t, ev, fn] of this._boundHandlers) t.removeEventListener(ev, fn);
    this._boundHandlers = [];
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.rtsBoxEl?.parentNode) this.rtsBoxEl.parentNode.removeChild(this.rtsBoxEl);
    // The pools' instance buffers are per-mission; their geometry and
    // material are the shared cache and stay alive.
    if (this.charPools) for (const p of this.charPools.values()) p.im.dispose();
    Audio.stopAmbience();
    // Frees what this mission built and leaves the model cache alone. Walking
    // the scene disposing everything took the shared assets with it, and the
    // next screen to draw a rock or a party token got an empty buffer.
    Models.disposeScene(this.scene);
    Models.releaseRenderer(this.renderer);
    if (this.renderer?.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

// --------------------------------------------------------------------------
// Ray primitives
// --------------------------------------------------------------------------

function rayBox(o, d, minx, miny, minz, maxx, maxy, maxz) {
  let tmin = 0, tmax = Infinity;
  const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
  const lo = [minx, miny, minz], hi = [maxx, maxy, maxz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(da[i]) < 1e-9) {
      if (oa[i] < lo[i] || oa[i] > hi[i]) return null;
    } else {
      let t1 = (lo[i] - oa[i]) / da[i], t2 = (hi[i] - oa[i]) / da[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Ray versus vertical capsule, approximated as a cylinder with flat caps. */
function rayCapsule(o, d, ax, ay, az, bx, by, bz, radius) {
  // Solve in XZ for the infinite cylinder, then clamp to the segment's Y span.
  const ox = o.x - ax, oz = o.z - az;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0) continue;
    const y = o.y + d.y * t;
    if (y >= ay && y <= by) return t;
  }
  return null;
}
