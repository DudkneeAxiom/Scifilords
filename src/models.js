// Asset loading and the character rig.
//
// Characters are rigid segmented hierarchies exported from Blender, not skinned
// meshes. The runtime animates them by rotating named nodes (legL, armR, torso,
// head). That is exactly how the games this is aimed at did it, it costs almost
// nothing, and it never breaks the way a bad skin weight does.

import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from '../vendor/three/utils/BufferGeometryUtils.js';
import { clamp, lerp } from './util.js';

const loader = new GLTFLoader();
const cache = new Map();

export const MODELS = [
  'soldier_bracket', 'soldier_trust', 'soldier_syndic', 'soldier_commander', 'soldier_prisoner',
  'soldier_scour', 'soldier_littoral',
  'titan', 'titan_plate', 'titan_core',
  'rampart', 'gate',
  'wpn_rifle', 'wpn_smg', 'wpn_shotgun', 'wpn_dmr', 'wpn_lmg', 'wpn_relic',
  'bunker', 'hab_block', 'watchtower', 'comms_mast', 'radar_dish', 'container',
  'crate', 'barrier', 'sandbags', 'fuel_tank', 'generator', 'truck_wreck',
  'blast_door', 'pipe_run', 'landing_pad', 'checkpoint', 'catwalk', 'antenna_small',
  'dead_tree', 'rock_0', 'rock_1', 'rock_2', 'rock_3',
  'wm_settlement_trust', 'wm_settlement_syndic', 'wm_settlement_neutral',
  'wm_outpost', 'wm_array',
  'wm_party_trust', 'wm_party_syndic', 'wm_party_raider', 'wm_party_civil', 'wm_party_player',
  'item_kit_plate', 'item_kit_optic', 'item_kit_bandolier', 'item_kit_stabiliser',
  'item_kit_stim', 'item_kit_lightweight',
  'item_good_water', 'item_good_rations', 'item_good_filter_stacks',
  'item_good_machine_parts', 'item_good_fuel_cells', 'item_good_medical_stock',
  'item_good_optics', 'item_good_salvage',
  'item_armour_head_light', 'item_armour_head_combat', 'item_armour_head_heavy',
  'item_armour_body_webbing', 'item_armour_body_carrier', 'item_armour_body_heavy',
  'item_armour_legs_fatigues', 'item_armour_legs_reinforced', 'item_armour_legs_plated',
];

export async function preload(onProgress) {
  let done = 0;
  await Promise.all(MODELS.map((name) => new Promise((resolve) => {
    loader.load(`assets/models/${name}.glb`, (gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // Flat shading everywhere — this look lives and dies on hard facets.
          if (o.material) {
            o.material.flatShading = true;
            o.material.needsUpdate = true;
          }
        }
      });
      // Characters are the only thing that ever exists in quantity, so they
      // get collapsed from ~31 meshes to one per animated joint. At 60
      // combatants that is the difference between ~1900 draw calls and ~500.
      if (name.startsWith('soldier_')) mergeCharacter(root);
      cache.set(name, root);
      onProgress?.(++done, MODELS.length, name);
      resolve();
    }, undefined, (err) => {
      console.warn('model failed', name, err);
      onProgress?.(++done, MODELS.length, name);
      resolve();
    });
  })));
}

/** A fresh instance of a loaded model. Materials are shared; transforms are not. */
export function get(name) {
  const src = cache.get(name);
  if (!src) return new THREE.Group();
  return src.clone(true);
}

export const isLoaded = (name) => cache.has(name);

/**
 * The drawn extent of a model at scale 1, as a collision footprint.
 *
 * Level obstacles used to be hand-declared boxes while the scale they were
 * placed at was random, so the two had no relationship: a rock drawn 3.5 by 2.0
 * carried a box 10.3 across — fifteen times the area and three and a half times
 * the height. Shots stopped in open air and the ground was full of walls you
 * could not see. Measuring the mesh is the only way the two stay honest.
 *
 * Cached per model, not per instance: the box is a property of the asset, and
 * building a level places hundreds of props.
 */
const boxes = new Map();

export function footprint(name) {
  if (boxes.has(name)) return boxes.get(name);
  const src = cache.get(name);
  let fp = null;
  if (src) {
    const b = new THREE.Box3().setFromObject(src);
    if (!b.isEmpty() && isFinite(b.min.x)) {
      fp = {
        hw: Math.max(0.08, (b.max.x - b.min.x) / 2),
        hd: Math.max(0.08, (b.max.z - b.min.z) / 2),
        h: Math.max(0.1, b.max.y - b.min.y),
      };
    }
  }
  boxes.set(name, fp);
  return fp;
}

// --------------------------------------------------------------------------
// Character rig
// --------------------------------------------------------------------------

const RIG_NODES = [
  'hips', 'torso', 'head', 'hand_r',
  'armL', 'armR', 'elbowL', 'elbowR',
  'legL', 'legR', 'kneeL', 'kneeR',
];

const TAU = Math.PI * 2;
const smooth = (a, b, dt, rate) => lerp(a, b, 1 - Math.exp(-dt * rate));

/**
 * Collapse a character's meshes into one per animated joint.
 *
 * The Blender rigs are built from dozens of small boxes, each with its own
 * material — lovely to author, ruinous to render sixty of. Every mesh under a
 * joint is baked into that joint's local space, its material colour is written
 * into vertex colours, and the lot is merged into a single flat-shaded mesh.
 * Geometry is shared across every instance of a variant, so this cost is paid
 * once at load rather than per soldier.
 */
function mergeCharacter(root) {
  const joints = [];
  root.traverse((o) => { if (RIG_NODES.includes(o.name)) joints.push(o); });
  if (!joints.length) return;
  root.updateMatrixWorld(true);

  for (const joint of joints) {
    // Meshes whose nearest rigged ancestor is this joint.
    const owned = [];
    joint.traverse((o) => {
      if (!o.isMesh) return;
      let p = o.parent;
      while (p && !RIG_NODES.includes(p.name)) p = p.parent;
      if (p === joint) owned.push(o);
    });
    if (owned.length < 2) continue;

    const inv = new THREE.Matrix4().copy(joint.matrixWorld).invert();
    const parts = [];
    for (const m of owned) {
      // Everything is flattened to non-indexed so the merge cannot trip over
      // mismatched index buffers. Dropping the index without converting
      // silently shreds the triangles.
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      // Into the joint's local space, so rotating the joint still works.
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      for (const attr of Object.keys(g.attributes)) {
        if (!['position', 'normal'].includes(attr)) g.deleteAttribute(attr);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      const col = new THREE.Color(0xffffff);
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (mat?.color) col.copy(mat.color);
      // Emissive parts (lamps, cells) are baked brighter so they still read.
      if (mat?.emissive && mat.emissiveIntensity > 0) {
        col.lerp(new THREE.Color(0xffffff), Math.min(0.6, mat.emissiveIntensity * 0.25));
      }
      const n = g.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    }

    let merged = null;
    try {
      merged = BufferGeometryUtils.mergeGeometries(parts, false);
    } catch { merged = null; }
    if (!merged) continue;

    for (const m of owned) { joint.remove(m); m.parent?.remove(m); }
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true,
    }));
    mesh.name = `${joint.name}_merged`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    joint.add(mesh);
  }
}

/**
 * One leg's contribution for a point in the gait cycle.
 *
 * `t` runs 0..1 over a full stride. The first half is stance — the foot is
 * planted, the leg travels from front to back and the knee stays close to
 * straight with a small absorb just after contact. The second half is swing —
 * the knee tucks hard so the boot clears the ground, then straightens to
 * reach for the next contact.
 *
 * Sign conventions for this rig, which are easy to get backwards:
 *   limbs hang down -Y from their pivot, and the model faces +Z.
 *   rotation.x > 0 swings a limb's tip BACKWARD (-Z).
 *   rotation.x < 0 swings it FORWARD (+Z).
 *   a knee therefore only ever flexes POSITIVE (heel toward the backside).
 *   an elbow only ever flexes NEGATIVE (hand forward and up).
 */
function gait(t) {
  let hip, knee;
  if (t < 0.5) {
    const u = t / 0.5;                        // stance
    hip = lerp(-1, 1, u);                     // reaches forward, drives back
    knee = 0.20 * Math.sin(u * Math.PI);      // absorb the landing
  } else {
    const u = (t - 0.5) / 0.5;                // swing
    hip = lerp(1, -1, u);
    knee = 1.05 * Math.sin(u * Math.PI);      // tuck to clear the ground
  }
  return { hip, knee };
}

/**
 * Build an animatable character. `variant` selects the Blender export;
 * `weaponModel` is attached to the right hand.
 */
export function makeCharacter(variant, weaponModel = null, tint = null) {
  const group = new THREE.Group();
  const body = get(variant);
  group.add(body);

  const rig = {};
  body.traverse((o) => {
    if (RIG_NODES.includes(o.name)) rig[o.name] = o;
  });

  // Rest pose is captured once so animation is expressed as offsets from it,
  // not absolute angles — that keeps the authored proportions intact.
  const rest = {};
  for (const k of Object.keys(rig)) {
    rest[k] = rig[k].rotation.clone();
  }
  // The authored hip height, so the walk bob and the collapse offset are
  // applied relative to the rig rather than replacing it.
  const restHipY = rig.hips ? rig.hips.position.y : 0;
  const restHipZ = rig.hips ? rig.hips.position.z : 0;

  let weapon = null;
  if (weaponModel && rig.hand_r) {
    weapon = get(weaponModel);
    rig.hand_r.add(weapon);
  }

  // Note: the old per-instance material tint is gone. Character meshes are now
  // merged at load and share geometry across every instance, which is what
  // makes sixty-strong battles renderable; recolouring one would mean cloning
  // geometry per soldier. The variants are already distinct enough without it.

  const state = {
    phase: Math.random(),        // 0..1 through the gait cycle
    aim: 0,                      // 0 = weapon low, 1 = shouldered
    downed: 0,                   // 0..1 collapse
    recoil: 0,
    flinch: 0,
    breathe: Math.random() * TAU,
    lean: 0,
    fwd: 0,
    side: 0,
    // Per-character variation so a field of bodies is not a field of clones.
    roll: (Math.random() - 0.5) * 0.7,
    idleOffset: Math.random() * TAU,
  };

  const setX = (node, v) => { if (node) node.rotation.x = v; };

  function update(dt, {
    speed = 0, moveX = 0, moveZ = 0, aiming = false, down = false, dead = false,
    pitch = 0, reload = 0, sprint = false, turn = 0,
  } = {}) {
    const s = state;

    // ---- blend the discrete states -------------------------------------
    s.aim = smooth(s.aim, aiming && !down ? 1 : 0, dt, 12);
    s.downed = smooth(s.downed, down || dead ? 1 : 0, dt, dead ? 7 : 5);
    s.recoil = Math.max(0, s.recoil - dt * 8);
    s.flinch = Math.max(0, s.flinch - dt * 5);
    s.breathe += dt * 1.15;
    s.fwd = smooth(s.fwd, moveZ, dt, 9);
    s.side = smooth(s.side, moveX, dt, 9);
    s.lean = smooth(s.lean, clamp(turn * 0.4, -0.35, 0.35), dt, 6);

    const stride = clamp(speed / 4.4, 0, sprint ? 1.5 : 1.1);
    const moving = stride > 0.04;

    // Cadence rises with speed. Sprinting is a longer, faster stride, not just
    // the same walk played back quickly.
    const cadence = moving ? (0.85 + stride * (sprint ? 1.05 : 0.75)) : 0;
    s.phase = (s.phase + dt * cadence) % 1;

    // ---- legs ------------------------------------------------------------
    // The two legs are half a cycle apart. Backpedalling runs the same cycle
    // with the hip swing inverted, which reads correctly without a second
    // animation.
    const dirSign = s.fwd < -0.15 ? -1 : 1;
    const gL = gait(s.phase);
    const gR = gait((s.phase + 0.5) % 1);
    const hipAmp = 0.60 * stride * (sprint ? 1.15 : 1) * dirSign;
    const kneeAmp = stride * (sprint ? 1.1 : 1);
    // Standing still still needs a knee bend or the legs read as stilts.
    const idleKnee = 0.07 + Math.sin(s.breathe * 0.5 + s.idleOffset) * 0.012;

    setX(rig.legL, rest.legL.x + gL.hip * hipAmp);
    setX(rig.legR, rest.legR.x + gR.hip * hipAmp);
    setX(rig.kneeL, rest.kneeL.x + gL.knee * kneeAmp + idleKnee);
    setX(rig.kneeR, rest.kneeR.x + gR.knee * kneeAmp + idleKnee);

    // Strafing: the legs cross and spread rather than pumping fore-and-aft.
    if (rig.legL) rig.legL.rotation.z = rest.legL.z - s.side * 0.20 * Math.sin(s.phase * TAU);
    if (rig.legR) rig.legR.rotation.z = rest.legR.z - s.side * 0.20 * Math.sin(s.phase * TAU + Math.PI);

    // ---- torso, hips, head -----------------------------------------------
    // Two vertical bobs per stride, lowest as each foot takes the load.
    const bob = -0.045 * stride * Math.abs(Math.cos(s.phase * TAU));
    const breath = Math.sin(s.breathe + s.idleOffset) * 0.012 * (1 - stride);

    if (rig.torso) {
      rig.torso.rotation.x = rest.torso.x
        + s.aim * 0.16                       // hunch into the sights
        + stride * (sprint ? 0.30 : 0.11)    // lean into the run
        + breath
        + s.flinch * 0.22
        + s.recoil * 0.05;
      rig.torso.rotation.y = rest.torso.y
        + Math.sin(s.phase * TAU) * 0.10 * stride * (1 - s.aim * 0.7);
      rig.torso.rotation.z = rest.torso.z + s.lean * 0.5 + s.side * 0.08;
    }
    if (rig.head) {
      // The head counter-rotates against the torso twist and tracks the aim,
      // so the character always looks where the weapon points.
      rig.head.rotation.x = rest.head.x - pitch * 0.4 - s.aim * 0.10 + s.flinch * 0.3;
      rig.head.rotation.y = rest.head.y - Math.sin(s.phase * TAU) * 0.07 * stride;
      rig.head.rotation.z = rest.head.z - s.lean * 0.35;
    }

    // ---- arms ------------------------------------------------------------
    // Relaxed carry: weapon held low across the body, elbows loosely bent,
    // arms counter-swinging against the legs.
    const swing = Math.sin(s.phase * TAU) * stride * 0.55;
    const lowR = { x: -0.55 + swing * 0.35, z: 0.16, e: -0.75 };
    const lowL = { x: -0.30 - swing * 0.55, z: -0.10, e: -0.55 };
    // Shouldered: both elbows fold in to a firing grip. The left arm comes
    // ACROSS the body (negative Z) to support the handguard — positive would
    // push it outwards, which is the pose that reads as "holding a plank".
    const aimR = { x: -1.24 - pitch * 0.30, z: 0.30, e: -0.62 };
    const aimL = { x: -1.02 - pitch * 0.22, z: -0.66, e: -1.32 };

    // Reload: the support hand leaves the weapon, drops to the magazine well
    // and comes back, while the muzzle dips. A single bell curve drives it all.
    const rl = Math.sin(clamp(reload, 0, 1) * Math.PI);
    const rlDown = Math.sin(clamp(reload, 0, 1) * Math.PI) ** 0.7;

    const a = s.aim;
    if (rig.armR) {
      rig.armR.rotation.x = rest.armR.x + lerp(lowR.x, aimR.x, a) + s.recoil * 0.30 + rl * 0.10;
      rig.armR.rotation.z = rest.armR.z + lerp(lowR.z, aimR.z, a);
    }
    setX(rig.elbowR, rest.elbowR.x + lerp(lowR.e, aimR.e, a) + s.recoil * 0.22);
    if (rig.armL) {
      rig.armL.rotation.x = rest.armL.x + lerp(lowL.x, aimL.x, a) + rlDown * 0.85;
      rig.armL.rotation.z = rest.armL.z + lerp(lowL.z, aimL.z, a) + rl * 0.30;
    }
    setX(rig.elbowL, rest.elbowL.x + lerp(lowL.e, aimL.e, a) - rlDown * 0.55);

    // ---- weapon ----------------------------------------------------------
    // The weapon's pitch is driven directly rather than inherited from the arm
    // chain. Parented naively it swings wildly with the shoulder and ends up
    // pointing at the sky the moment the arm comes up.
    if (weapon) {
      const armDelta = (rig.armR ? rig.armR.rotation.x - rest.armR.x : 0)
        + (rig.elbowR ? rig.elbowR.rotation.x - rest.elbowR.x : 0);
      // Positive pitches the muzzle down. Low-ready points it at the ground
      // ahead; shouldered, it follows the aim.
      const wantPitch = lerp(0.62, pitch, a) + rlDown * 0.35 - s.recoil * 0.22;
      weapon.rotation.x = wantPitch - armDelta;
      weapon.rotation.z = lerp(0.20, 0.02, a);
      weapon.position.z = -s.recoil * 0.06;    // kick back into the shoulder
    }

    // ---- collapse --------------------------------------------------------
    // Not a rigid plank tipping over: the knees buckle, the hips drop, the
    // torso folds and the arms go slack, then the whole body settles onto the
    // ground with a per-character roll.
    // Blend each joint from whatever the live animation produced toward its
    // collapsed target, so a soldier folds up out of a run rather than snapping
    // into a death pose.
    const d = s.downed;
    if (d > 0.001) {
      const to = (node, key, target) => {
        if (node) node.rotation[key] = lerp(node.rotation[key], target, d);
      };
      to(rig.kneeL, 'x', rest.kneeL.x + 1.35);
      to(rig.kneeR, 'x', rest.kneeR.x + 1.08);
      to(rig.legL, 'x', rest.legL.x - 0.55);
      to(rig.legR, 'x', rest.legR.x - 0.35);
      to(rig.legL, 'z', rest.legL.z + 0.22);
      to(rig.legR, 'z', rest.legR.z - 0.18);
      to(rig.torso, 'x', rest.torso.x + 0.75);
      to(rig.torso, 'z', rest.torso.z + s.roll);
      to(rig.head, 'x', rest.head.x + 0.55);
      to(rig.head, 'z', rest.head.z + s.roll * 0.6);
      to(rig.armL, 'x', rest.armL.x + 0.30);
      to(rig.armL, 'z', rest.armL.z + 0.85);
      to(rig.armR, 'x', rest.armR.x + 0.18);
      to(rig.armR, 'z', rest.armR.z - 0.95);
      to(rig.elbowL, 'x', rest.elbowL.x - 0.35);
      to(rig.elbowR, 'x', rest.elbowR.x - 0.25);
    }

    // The collapse rotation is applied to the GROUP, but its Y position is the
    // terrain height the caller placed us at and must never be written here —
    // doing so pinned every character to y=0 and buried them in sloped ground.
    group.rotation.x = d * -1.40;
    group.rotation.z = d * s.roll * 0.8;
    if (rig.hips) {
      rig.hips.position.y = restHipY + bob + d * -0.42;
      rig.hips.position.z = restHipZ + d * 0.10;
    }
  }

  function kick() { state.recoil = 1; }
  function flinch() { state.flinch = 1; }

  function dispose() {
    group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  }

  return { group, rig, weapon, update, kick, flinch, state, dispose };
}

// --------------------------------------------------------------------------
// Item icons
//
// The inventory shows what things actually are by rendering the same models
// the world uses, once, to small sprites. Drawing them beats maintaining a
// parallel set of hand-drawn icons that would drift from the assets.
// --------------------------------------------------------------------------

const iconCache = new Map();
let iconRenderer = null;

function iconRig(size) {
  if (iconRenderer) return iconRenderer;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  // Three-quarter view with a strong key, so a chunky low-poly object reads
  // as a solid rather than a flat blob.
  scene.add(new THREE.HemisphereLight(0x8f97a6, 0x1a1a16, 2.2));
  const key = new THREE.DirectionalLight(0xf0dcae, 3.4);
  key.position.set(2.5, 3.5, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6a7c94, 1.6);
  rim.position.set(-2.5, 1.0, -2.0);
  scene.add(rim);
  iconRenderer = { renderer, scene, camera, size };
  return iconRenderer;
}

/**
 * Render a model to a data URL, framed automatically from its bounds.
 * Results are cached — each icon is drawn at most once per session.
 */
export function icon(modelName, size = 72) {
  const key = `${modelName}@${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  if (!cache.has(modelName)) return null;

  const rig = iconRig(size);
  rig.renderer.setSize(size, size);

  const obj = get(modelName);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  rig.scene.add(obj);

  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() * 0.5 || 1;
  obj.position.sub(c);                       // centre it on the origin

  const dist = radius / Math.tan((rig.camera.fov * Math.PI) / 360) * 1.25;
  rig.camera.position.set(dist * 0.62, dist * 0.55, dist * 0.78);
  rig.camera.lookAt(0, 0, 0);
  rig.camera.updateProjectionMatrix();

  rig.renderer.render(rig.scene, rig.camera);
  const url = rig.renderer.domElement.toDataURL();
  rig.scene.remove(obj);
  iconCache.set(key, url);
  return url;
}

/**
 * A live, draggable 3D view of a soldier for the equipment screen. Renders the
 * same rig the field uses, with whatever armour is equipped stacked onto it, so
 * changing a slot is visible immediately rather than described in a stat line.
 */
/**
 * Assemble the Titan: the walker, plus a slab of armour and the weak point
 * beneath it at every mount point the model declares.
 *
 * The plates are separate objects rather than part of the hull because the
 * whole fight is about removing them. Breaking one hides the slab, reveals the
 * core, and hands back a world-space position the mission can use as a hit
 * region — no mesh surgery, no per-frame rebuild.
 */
export function makeTitan() {
  const char = makeCharacter('titan', null);
  const plates = [];
  char.group.traverse((o) => {
    if (!o.name.startsWith('mount_')) return;
    const id = o.name.slice('mount_'.length);
    const slab = get('titan_plate');
    // Flanks and shoulders sit on the side of the hull, so their armour has to
    // face outward rather than forward.
    if (id.startsWith('flank') || id.startsWith('shoulder')) {
      slab.rotation.y = Math.PI / 2;
    } else if (id === 'back') {
      slab.rotation.y = Math.PI;
    }
    const core = get('titan_core');
    core.visible = false;
    o.add(slab);
    o.add(core);
    plates.push({
      id,
      mount: o,
      slab,
      core,
      hp: id === 'chest' ? 340 : 260,
      maxHp: id === 'chest' ? 340 : 260,
      broken: false,
      // How far out from the mount the hittable region sits, and how big it is.
      radius: id === 'chest' ? 1.5 : 1.2,
    });
  });
  return { ...char, plates };
}

export function makePreview(width = 320, height = 460) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.domElement.className = 'char-canvas';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 60);
  camera.position.set(0, 1.05, 4.4);
  camera.lookAt(0, 0.98, 0);

  scene.add(new THREE.HemisphereLight(0x8a94a6, 0x1a1a16, 2.0));
  const key = new THREE.DirectionalLight(0xf2dcb0, 3.0);
  key.position.set(2.4, 3.2, 2.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6a7c94, 1.8);
  rim.position.set(-2.6, 1.6, -2.2);
  scene.add(rim);

  const pivot = new THREE.Group();
  scene.add(pivot);

  let current = null;
  let yaw = 0.35;

  function setSoldier(variant, weaponModel, armourModels = []) {
    if (current) { pivot.remove(current.group); current.dispose?.(); }
    current = makeCharacter(variant, weaponModel);
    // Armour is shown as pieces floating in place on the body — the rigs are
    // rigid segments, so this reads correctly without re-authoring a model per
    // permutation.
    for (const { model, node, scale, offset } of armourModels) {
      if (!model || !isLoaded(model)) continue;
      const piece = get(model);
      piece.scale.setScalar(scale || 1);
      if (offset) piece.position.set(offset[0], offset[1], offset[2]);
      const parent = current.rig[node] || current.group;
      parent.add(piece);
    }
    current.group.position.y = -0.02;
    pivot.add(current.group);
    render();
  }

  function render() {
    pivot.rotation.y = yaw;
    if (current) {
      current.update(0.016, { speed: 0, aiming: true, pitch: 0 });
    }
    renderer.render(scene, camera);
  }

  // Drag to turn the model, the way every equipment screen works.
  let dragging = false, lastX = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointerup', (e) => { dragging = false; el.releasePointerCapture?.(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
    render();
  });

  let raf = 0;
  const spin = () => { render(); raf = requestAnimationFrame(spin); };
  raf = requestAnimationFrame(spin);

  return {
    dom: el,
    setSoldier,
    render,
    dispose() {
      cancelAnimationFrame(raf);
      renderer.dispose();
      el.remove();
    },
  };
}

export const weaponIcon = (weaponId, size) => icon(`wpn_${weaponId}`, size);
export const armourIcon = (armourId, size) => icon(`item_armour_${armourId}`, size);
export const kitIcon = (kitId, size) => icon(`item_kit_${kitId}`, size);
export const goodIcon = (goodId, size) => icon(`item_good_${goodId}`, size);

// --------------------------------------------------------------------------
// Shared materials / effects
// --------------------------------------------------------------------------

export const MAT = {
  muzzle: new THREE.MeshBasicMaterial({ color: 0xffc25e, transparent: true, opacity: 0.95 }),
  tracer: new THREE.MeshBasicMaterial({ color: 0xffa83c, transparent: true, opacity: 0.9 }),
  spark: new THREE.MeshBasicMaterial({ color: 0xd88a3a, transparent: true, opacity: 0.9 }),
  blood: new THREE.MeshBasicMaterial({ color: 0x5a1a14, transparent: true, opacity: 0.85 }),
  smoke: new THREE.MeshBasicMaterial({ color: 0x2a2a26, transparent: true, opacity: 0.5 }),
};

export const GEO = {
  quad: new THREE.PlaneGeometry(1, 1),
  bit: new THREE.BoxGeometry(0.08, 0.08, 0.08),
  tracer: new THREE.BoxGeometry(0.05, 0.05, 1),
  flash: new THREE.ConeGeometry(0.16, 0.42, 5),
};
