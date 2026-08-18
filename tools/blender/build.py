"""
KETTLE REACH — low-poly asset builder.

Run headless:
  blender --background --python tools/blender/build.py

Art direction: "1998 imagined 2248", filtered through a grim silhouette-first
palette — near-black shadows, sickly ochre, rust, faded olive. Everything is
hard-edged, chunky, and built to read as a SHAPE first: helmets, packs, masts
and antennae exist so a unit is identifiable at 60m in fog with one light.

Characters are deliberately NOT skinned. They are rigid segmented hierarchies
(hips > torso > head/arms, hips > legs) so the runtime can animate them by
rotating named nodes. That is both period-correct for the PS1 look and far more
robust than shipping skinned armatures through glTF.

Blender is Z-up and the glTF exporter converts (x, y, z) -> (x, z, -y). Models
are therefore authored facing Blender -Y so they face +Z in Three.js.
"""

import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

# --------------------------------------------------------------------------
# Output location
# --------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "assets", "models")
os.makedirs(OUT, exist_ok=True)

# --------------------------------------------------------------------------
# Palette — grim, desaturated, few hues. Ochre and rust are the only warmth.
# --------------------------------------------------------------------------

PALETTE = {
    "black":      (0.050, 0.055, 0.050),
    "pitch":      (0.028, 0.030, 0.030),
    "steel_dk":   (0.105, 0.120, 0.132),
    "steel":      (0.200, 0.225, 0.245),
    "steel_lt":   (0.330, 0.355, 0.375),
    "olive_dk":   (0.105, 0.118, 0.075),
    "olive":      (0.190, 0.215, 0.120),
    "beige":      (0.360, 0.330, 0.235),
    "bone":       (0.560, 0.530, 0.450),
    "ochre":      (0.480, 0.330, 0.120),
    "ochre_lt":   (0.640, 0.460, 0.170),
    "ochre_dk":   (0.270, 0.185, 0.065),
    "rust":       (0.230, 0.110, 0.055),
    "rust_lt":    (0.360, 0.185, 0.095),
    "orange":     (0.480, 0.210, 0.055),
    "red_dk":     (0.190, 0.055, 0.045),
    "canvas":     (0.245, 0.225, 0.175),
    "concrete":   (0.235, 0.232, 0.212),
    "concrete_dk": (0.140, 0.140, 0.128),
    "glass":      (0.045, 0.070, 0.078),
    "skin":       (0.330, 0.240, 0.180),
    "skin_dk":    (0.220, 0.155, 0.115),
    "amber":      (0.700, 0.400, 0.080),
    "dirt":       (0.150, 0.130, 0.100),
    "dirt_lt":    (0.230, 0.200, 0.150),
    "moss":       (0.120, 0.150, 0.090),
    "white_dim":  (0.480, 0.470, 0.440),
}

_MATS = {}


def mat(name, emissive=0.0):
    """One material per palette entry, reused across every object."""
    key = (name, emissive)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(name=f"kr_{name}" + ("_e" if emissive else ""))
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    col = PALETTE[name]
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (col[0], col[1], col[2], 1.0)
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.85
        if emissive and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (col[0], col[1], col[2], 1.0)
            bsdf.inputs["Emission Strength"].default_value = emissive
    _MATS[key] = m
    return m


# --------------------------------------------------------------------------
# Scene / primitive helpers
# --------------------------------------------------------------------------

def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.objects):
        for b in list(block):
            if getattr(b, "users", 0) == 0:
                block.remove(b)


# Every location passed to these helpers is a WORLD location, which is how the
# models are actually designed ("the head pivot is 1.52m off the floor"). Blender
# object.location is parent-RELATIVE, so parenting naively displaces every pivot
# by its parent's offset — which silently wrecks the character rigs: the head
# pivot lands at 2.44m and rotating a leg swings it through the floor.
#
# The whole rig is translation-only, so the correct local transform is just
# (world - parent_world). Each object records the world position it was built at
# so its children can subtract it. This is deterministic and needs no depsgraph
# update, unlike matrix_parent_inverse.

def _wloc(obj):
    return obj.get("wloc", (0.0, 0.0, 0.0)) if obj else (0.0, 0.0, 0.0)


def _attach(obj, loc, parent):
    pw = _wloc(parent)
    obj["wloc"] = tuple(loc)
    obj.location = (loc[0] - pw[0], loc[1] - pw[1], loc[2] - pw[2])
    if parent:
        obj.parent = parent
    return obj


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    bpy.context.collection.objects.link(e)
    e.name = name
    return _attach(e, loc, parent)


def _finish(obj, name, m, parent, rot, loc):
    obj.name = name
    obj.data.materials.append(m)
    if rot:
        obj.rotation_euler = tuple(math.radians(r) for r in rot)
    _attach(obj, loc, parent)
    # Hard-edged everywhere. Smooth shading is the enemy of this look.
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def box(name, size=(1, 1, 1), loc=(0, 0, 0), color="steel", parent=None, rot=None, emissive=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.scale = size
    return _finish(o, name, mat(color, emissive), parent, rot, loc)


def cyl(name, r=0.5, h=1.0, loc=(0, 0, 0), color="steel", parent=None, rot=None, verts=8, emissive=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=(0, 0, 0), vertices=verts)
    o = bpy.context.active_object
    return _finish(o, name, mat(color, emissive), parent, rot, loc)


def cone(name, r1=0.5, r2=0.0, h=1.0, loc=(0, 0, 0), color="steel", parent=None, rot=None, verts=8):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=h, location=(0, 0, 0), vertices=verts)
    o = bpy.context.active_object
    return _finish(o, name, mat(color), parent, rot, loc)


def wedge(name, size=(1, 1, 1), loc=(0, 0, 0), color="steel", parent=None, rot=None):
    """A cube with the top face shrunk — the workhorse for chunky sloped forms."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.scale = size
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        if v.co.z > 0:
            v.co.x *= 0.45
            v.co.y *= 0.45
    bm.to_mesh(me)
    bm.free()
    return _finish(o, name, mat(color), parent, rot, loc)


def taper(name, size=(1, 1, 1), loc=(0, 0, 0), color="steel", parent=None, rot=None,
          top=(1.0, 1.0), bottom=(1.0, 1.0)):
    """Cube with independent top/bottom XY scaling. Gives real silhouettes."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.scale = size
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        s = top if v.co.z > 0 else bottom
        v.co.x *= s[0]
        v.co.y *= s[1]
    bm.to_mesh(me)
    bm.free()
    return _finish(o, name, mat(color), parent, rot, loc)


def export(name):
    bpy.ops.object.select_all(action="SELECT")
    path = os.path.join(OUT, name + ".glb")
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_yup=True,
    )
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_yup", None)
        bpy.ops.export_scene.gltf(**kw)
    print(f"  wrote {name}.glb")


# ==========================================================================
# CHARACTERS
# ==========================================================================
# Shared proportions. Chunky, short-limbed, big head-to-body ratio is wrong for
# this genre — these are soldiers, so keep heads small and shoulders wide. The
# readable features are the HELMET, the PACK and whatever sticks up off it.

def character(faction):
    """
    faction: 'bracket' (player company), 'trust', 'syndic', 'commander',
    'prisoner', 'scour' (open-country irregulars), 'littoral' (port technicians)
    Builds a rigid segmented hierarchy the runtime animates by node name.
    """
    clear()

    if faction == "trust":
        cloth, armor, trim, helm = "olive_dk", "olive", "orange", "steel_dk"
    elif faction == "syndic":
        cloth, armor, trim, helm = "beige", "canvas", "rust", "beige"
    elif faction == "commander":
        cloth, armor, trim, helm = "steel_dk", "ochre_dk", "ochre", "steel_dk"
    elif faction == "prisoner":
        cloth, armor, trim, helm = "bone", "bone", "rust", "bone"
    elif faction == "scour":
        # Sun-bleached and improvised. Nothing they wear was issued to them.
        cloth, armor, trim, helm = "dirt_lt", "rust", "ochre_lt", "dirt"
    elif faction == "littoral":
        # Dock security in port livery: darker, cleaner, faintly official.
        cloth, armor, trim, helm = "steel_dk", "steel", "amber", "steel"
    else:  # bracket
        cloth, armor, trim, helm = "olive_dk", "canvas", "ochre", "steel_dk"

    root = empty("root", (0, 0, 0))
    hips = empty("hips", (0, 0, 0.92), root)

    # ---- legs: hip -> knee -> shin+boot ----
    # The knee is a real joint. Without it a walk cycle can only swing a rigid
    # stick from the hip, which is the single most obvious tell that a character
    # is not animated. A knee that tucks through the swing phase does more for
    # the read than any amount of extra geometry.
    for side, sx in (("L", 1), ("R", -1)):
        leg = empty(f"leg{side}", (0.14 * sx, 0, 0.92), hips)
        box(f"thigh{side}", (0.20, 0.22, 0.46), (0.14 * sx, 0, 0.70), cloth, leg)
        knee = empty(f"knee{side}", (0.14 * sx, 0, 0.48), leg)
        box(f"shin{side}", (0.17, 0.19, 0.44), (0.14 * sx, 0, 0.27), cloth, knee)
        # Boots are chunky — they anchor the silhouette to the ground.
        box(f"boot{side}", (0.21, 0.30, 0.14), (0.14 * sx, -0.03, 0.07), "black", knee)

    # ---- torso: tapered so shoulders read wide, waist narrow ----
    torso = empty("torso", (0, 0, 0.92), hips)
    taper("chest", (0.52, 0.30, 0.52), (0, 0, 1.18), cloth, torso,
          top=(1.05, 1.05), bottom=(0.78, 0.82))
    # Plate carrier / webbing — the faction's main colour block.
    box("carrier", (0.46, 0.34, 0.34), (0, 0, 1.22), armor, torso)
    box("belt", (0.44, 0.30, 0.09), (0, 0, 0.96), "black", torso)
    box("pouch_l", (0.11, 0.10, 0.13), (0.16, -0.19, 1.02), trim, torso)
    box("pouch_r", (0.11, 0.10, 0.13), (-0.16, -0.19, 1.02), armor, torso)

    if faction != "prisoner":
        # Backpack — the single biggest silhouette contributor from behind.
        box("pack", (0.40, 0.22, 0.42), (0, 0.24, 1.24), armor, torso)
        box("pack_strap", (0.42, 0.06, 0.10), (0, 0.24, 1.40), "black", torso)

    if faction == "trust":
        # Heavy pauldrons: Trust troops are armoured and slow-looking.
        box("pauldron_l", (0.18, 0.28, 0.16), (0.30, 0, 1.36), armor, torso)
        box("pauldron_r", (0.18, 0.28, 0.16), (-0.30, 0, 1.36), armor, torso)
        box("stencil", (0.14, 0.02, 0.14), (0.12, -0.21, 1.30), trim, torso)
        # Backpack radio + stub antenna.
        cyl("radio", 0.045, 0.5, (0.16, 0.34, 1.62), "steel_dk", torso)
    elif faction == "syndic":
        # Scavenged: mismatched plate, cloth wrap, and a tall whip antenna that
        # makes them unmistakable on a skyline.
        box("plate_scrap", (0.26, 0.05, 0.22), (0.04, -0.20, 1.26), "rust", torso)
        box("wrap", (0.50, 0.34, 0.10), (0, 0, 1.44), "canvas", torso)
        cyl("antenna", 0.018, 1.05, (-0.18, 0.30, 1.85), "steel_dk", torso)
    elif faction == "scour":
        # Bandoliers and a bedroll. Everything they own is on their back.
        box("bandolier_a", (0.44, 0.30, 0.07), (0, 0, 1.30), "ochre_lt", torso)
        box("bandolier_b", (0.30, 0.28, 0.07), (0.08, -0.02, 1.16), "rust", torso)
        cyl("bedroll", 0.11, 0.52, (0, 0.30, 1.44), "dirt_lt", torso, rot=(0, 90, 0))
        box("canteen", (0.10, 0.10, 0.15), (-0.20, 0.16, 1.00), "steel_dk", torso)
    elif faction == "littoral":
        # A high collar and a chest slate: they log everything they touch.
        taper("collar", (0.40, 0.32, 0.20), (0, 0.01, 1.50), "steel", torso,
              top=(1.15, 1.15), bottom=(0.85, 0.85))
        box("slate", (0.18, 0.04, 0.22), (0.02, -0.21, 1.24), "amber", torso)
        box("lamp", (0.08, 0.09, 0.08), (0.24, -0.16, 1.38), "glass", torso)
    elif faction == "commander":
        # Long coat — reads instantly as "the officer" from any angle.
        taper("coat", (0.50, 0.34, 0.62), (0, 0.02, 0.86), "steel_dk", torso,
              top=(1.0, 1.0), bottom=(1.22, 1.35))
        box("sash", (0.10, 0.36, 0.30), (0.19, 0, 1.24), trim, torso)

    # ---- arms: shoulder -> elbow -> forearm+glove ----
    # The elbow is what lets the character actually hold a weapon: both arms
    # fold in to a firing grip instead of pointing at it like two planks.
    for side, sx in (("L", 1), ("R", -1)):
        arm = empty(f"arm{side}", (0.32 * sx, 0, 1.38), torso)
        box(f"upperarm{side}", (0.16, 0.17, 0.38), (0.32 * sx, 0, 1.20), cloth, arm)
        elbow = empty(f"elbow{side}", (0.32 * sx, 0, 1.02), arm)
        box(f"forearm{side}", (0.14, 0.15, 0.34), (0.32 * sx, 0, 0.88), armor, elbow)
        box(f"glove{side}", (0.13, 0.14, 0.12), (0.32 * sx, 0, 0.68), "black", elbow)
    # Weapon attach point, at the right hand — below the elbow, so it follows
    # the forearm rather than the shoulder.
    empty("hand_r", (-0.32, -0.10, 0.70), bpy.data.objects["elbowR"])

    # ---- head ----
    head = empty("head", (0, 0, 1.52), torso)
    if faction == "prisoner":
        box("skull", (0.22, 0.24, 0.26), (0, 0, 1.65), "skin", head)
        box("hair", (0.23, 0.25, 0.08), (0, 0.01, 1.76), "skin_dk", head)
        box("blindfold", (0.24, 0.26, 0.07), (0, -0.01, 1.66), "rust", head)
    elif faction == "commander":
        box("skull", (0.22, 0.24, 0.26), (0, 0, 1.65), "skin", head)
        box("headset", (0.27, 0.10, 0.10), (0, 0.02, 1.68), "steel_dk", head)
        cyl("mic", 0.02, 0.16, (0.05, -0.12, 1.62), "steel_dk", head, rot=(80, 0, 0))
    elif faction == "trust":
        # Full visor: no face at all. Dehumanised, and unmistakable.
        taper("helmet", (0.28, 0.30, 0.28), (0, 0, 1.67), helm, head,
              top=(0.82, 0.82), bottom=(1.0, 1.0))
        box("visor", (0.24, 0.06, 0.12), (0, -0.15, 1.66), "glass", head)
        box("brow", (0.29, 0.08, 0.05), (0, -0.13, 1.75), armor, head)
        cyl("filter", 0.05, 0.10, (0.10, -0.14, 1.56), "steel_dk", head, rot=(90, 0, 0))
    elif faction == "syndic":
        # Cloth hood + goggles + rebreather.
        taper("hood", (0.30, 0.32, 0.30), (0, 0.01, 1.66), helm, head,
              top=(0.70, 0.70), bottom=(1.05, 1.05))
        box("goggles", (0.25, 0.07, 0.08), (0, -0.15, 1.68), "glass", head)
        box("scarf", (0.28, 0.26, 0.10), (0, -0.02, 1.55), "rust_lt", head)
    elif faction == "scour":
        # Bare head, sun mask, wind wrap. The only origin with a visible face.
        box("skull", (0.22, 0.24, 0.26), (0, 0, 1.65), "skin", head)
        box("sunmask", (0.24, 0.06, 0.09), (0, -0.14, 1.68), "dirt", head)
        box("headwrap", (0.26, 0.28, 0.09), (0, 0.01, 1.53), "ochre_lt", head)
        box("spike", (0.05, 0.05, 0.18), (0.10, 0.02, 1.83), "bone", head)
    elif faction == "littoral":
        # Half-helm with a fold-down loupe and ear defenders.
        taper("halfhelm", (0.27, 0.29, 0.17), (0, 0, 1.70), "steel", head,
              top=(0.90, 0.90), bottom=(1.02, 1.02))
        box("skull", (0.21, 0.23, 0.16), (0, 0, 1.60), "skin", head)
        cyl("loupe", 0.045, 0.07, (0.07, -0.14, 1.66), "glass", head, rot=(90, 0, 0))
        box("eardef", (0.31, 0.11, 0.10), (0, 0.01, 1.66), "steel_dk", head)
    else:  # bracket
        taper("helmet", (0.27, 0.30, 0.22), (0, 0, 1.66), helm, head,
              top=(0.88, 0.88), bottom=(1.0, 1.0))
        box("brim", (0.28, 0.10, 0.04), (0, -0.16, 1.60), helm, head)
        box("respirator", (0.19, 0.10, 0.13), (0, -0.14, 1.55), "steel_dk", head)
        box("armband", (0.17, 0.18, 0.05), (0.33, 0, 1.30), trim, head)

    export(f"soldier_{faction}")



# ==========================================================================
# THE TITAN
# ==========================================================================
# A pre-charter siege walker somebody got running again. It is built to the
# same rigid-segmented convention as the soldiers so the runtime can animate it
# with the same node rotations — just eight times the size and with a hunch.
#
# Three separate exports, because the fight is about taking it apart:
#   titan          the walker itself, with named plate mounts but no plates
#   titan_plate    one slab of armour, cloned onto each mount and shed on break
#   titan_core     the weak point underneath, exposed when a plate comes off
#
# Keeping the plates as separate objects is the whole design: the runtime can
# hide one, drop a physics-free copy on the ground, and reveal the core beneath
# without any of it being baked into a single mesh.

def titan():
    clear()

    hull, plate, trim, glow = "steel_dk", "steel", "orange", "amber"

    root = empty("root", (0, 0, 0))
    hips = empty("hips", (0, 0, 4.10), root)

    # ---- legs: digitigrade, so it reads as a machine that walks badly -----
    for side, sx in (("L", 1), ("R", -1)):
        leg = empty(f"leg{side}", (1.05 * sx, 0, 4.10), hips)
        box(f"thigh{side}", (0.86, 0.92, 1.85), (1.05 * sx, 0, 3.25), hull, leg)
        box(f"hipcase{side}", (0.98, 1.02, 0.55), (1.05 * sx, 0, 4.05), plate, leg)
        knee = empty(f"knee{side}", (1.05 * sx, 0, 2.35), leg)
        # The shin rakes backward, which is what makes the silhouette read as a
        # walker rather than a man in a big suit.
        box(f"shin{side}", (0.70, 0.78, 1.70), (1.05 * sx, 0.34, 1.55), hull, knee)
        box(f"piston{side}", (0.20, 0.20, 1.30), (1.05 * sx, -0.46, 1.70), trim, knee)
        box(f"foot{side}", (0.94, 1.90, 0.46), (1.05 * sx, -0.20, 0.24), plate, knee)
        box(f"toe{side}", (0.86, 0.60, 0.30), (1.05 * sx, -1.05, 0.18), hull, knee)

    # ---- torso: a slab hull, hunched forward over the hips ----------------
    torso = empty("torso", (0, 0, 4.10), hips)
    taper("hull", (2.90, 2.10, 2.60), (0, 0.10, 5.35), hull, torso,
          top=(0.82, 0.86), bottom=(1.06, 1.02))
    box("collar", (2.30, 1.60, 0.44), (0, 0.05, 6.62), plate, torso)
    box("spine", (0.70, 0.60, 1.80), (0, 1.05, 5.60), trim, torso)
    # Exhaust stacks — the one part that says this thing burns something.
    cyl("stack_l", 0.22, 1.70, (0.80, 1.30, 6.90), "pitch", torso)
    cyl("stack_r", 0.22, 1.70, (-0.80, 1.30, 6.90), "pitch", torso)

    # ---- plate mounts ------------------------------------------------------
    # Empties only. The runtime parents a titan_plate to each of these and a
    # titan_core just inside it, so shedding armour is a visibility swap rather
    # than a mesh rebuild. Names are load-bearing — mission.js looks them up.
    empty("mount_chest", (0, -1.15, 5.55), torso)
    empty("mount_shoulder_l", (1.70, 0.05, 6.25), torso)
    empty("mount_shoulder_r", (-1.70, 0.05, 6.25), torso)
    empty("mount_flank_l", (1.55, 0.70, 4.70), torso)
    empty("mount_flank_r", (-1.55, 0.70, 4.70), torso)
    empty("mount_back", (0, 1.35, 5.90), torso)

    # ---- arms: one gun, one ram -------------------------------------------
    armL = empty("armL", (1.85, 0, 6.15), torso)
    box("upperarmL", (0.72, 0.78, 1.30), (1.95, 0, 5.55), hull, armL)
    elbowL = empty("elbowL", (1.95, 0, 4.95), armL)
    box("forearmL", (0.66, 0.70, 1.25), (1.95, -0.10, 4.30), plate, elbowL)
    # Rotary cannon. The barrels are the read at distance.
    for i, off in enumerate((-0.22, 0, 0.22)):
        cyl(f"barrel{i}", 0.11, 2.10, (1.95 + off, -1.30, 3.85), "pitch", elbowL,
            rot=(90, 0, 0))
    box("gunbox", (0.78, 0.90, 0.70), (1.95, -0.30, 3.85), hull, elbowL)

    armR = empty("armR", (-1.85, 0, 6.15), torso)
    box("upperarmR", (0.72, 0.78, 1.30), (-1.95, 0, 5.55), hull, armR)
    elbowR = empty("elbowR", (-1.95, 0, 4.95), armR)
    box("forearmR", (0.72, 0.76, 1.30), (-1.95, -0.10, 4.30), plate, elbowR)
    box("ram", (0.95, 1.60, 0.95), (-1.95, -1.05, 3.70), hull, elbowR)
    box("ram_tip", (0.60, 0.50, 1.15), (-1.95, -1.85, 3.70), trim, elbowR)
    # Weapon attach point kept for convention; the Titan fires from its own arm.
    empty("hand_r", (-1.95, -1.60, 3.70), bpy.data.objects["elbowR"])

    # ---- head: a sensor block with a single lit slit -----------------------
    head = empty("head", (0, 0, 6.85), torso)
    taper("skull", (1.30, 1.35, 0.85), (0, -0.10, 7.10), hull, head,
          top=(0.72, 0.78), bottom=(1.0, 1.0))
    box("visor", (1.05, 0.20, 0.22), (0, -0.80, 7.12), glow, head, emissive=5.0)
    box("crest", (0.30, 0.90, 0.34), (0, 0.05, 7.60), trim, head)

    export("titan")


def titan_plate():
    """One slab of bolted-on armour. Cloned onto every mount point."""
    clear()
    root = empty("root", (0, 0, 0))
    # Authored around its own origin so the runtime can drop it straight onto a
    # mount empty without compensating for anything.
    taper("slab", (1.55, 0.42, 1.75), (0, 0, 0), "steel", root,
          top=(0.80, 1.0), bottom=(1.0, 1.0))
    box("rib_a", (1.62, 0.16, 0.26), (0, -0.24, 0.52), "steel_dk", root)
    box("rib_b", (1.62, 0.16, 0.26), (0, -0.24, -0.52), "steel_dk", root)
    box("boltrow", (1.30, 0.14, 0.14), (0, -0.28, 0), "orange", root)
    export("titan_plate")


def titan_core():
    """What is underneath. Lit, so an exposed one is unmistakable in fog."""
    clear()
    root = empty("root", (0, 0, 0))
    cyl("housing", 0.62, 0.46, (0, 0, 0), "pitch", root, rot=(90, 0, 0))
    cyl("core", 0.42, 0.30, (0, -0.14, 0), "amber", root, rot=(90, 0, 0), emissive=7.0)
    box("vane_a", (1.05, 0.16, 0.16), (0, 0.06, 0), "rust", root)
    box("vane_b", (0.16, 0.16, 1.05), (0, 0.06, 0), "rust", root)
    export("titan_core")

# ==========================================================================
# WEAPONS  (authored at origin, muzzle pointing -Y so it fires +Z in Three.js)
# ==========================================================================

def weapon(kind):
    clear()
    root = empty("root", (0, 0, 0))

    if kind == "rifle":  # service rifle — the baseline
        box("receiver", (0.07, 0.46, 0.11), (0, 0.02, 0), "steel_dk", root)
        box("barrel", (0.035, 0.40, 0.038), (0, -0.36, 0.01), "black", root)
        box("handguard", (0.06, 0.24, 0.07), (0, -0.22, 0.005), "olive_dk", root)
        box("stock", (0.06, 0.26, 0.10), (0, 0.34, -0.01), "olive_dk", root)
        box("mag", (0.05, 0.09, 0.22), (0, -0.02, -0.15), "steel_dk", root)
        box("grip", (0.05, 0.07, 0.15), (0, 0.14, -0.12), "black", root)
        box("sight", (0.03, 0.14, 0.05), (0, -0.06, 0.09), "steel_dk", root)
    elif kind == "smg":  # compact automatic
        box("receiver", (0.07, 0.30, 0.11), (0, 0, 0), "steel_dk", root)
        box("barrel", (0.03, 0.18, 0.03), (0, -0.22, 0.01), "black", root)
        box("stock_wire", (0.05, 0.16, 0.03), (0, 0.22, 0.02), "steel", root)
        box("mag", (0.045, 0.07, 0.24), (0, -0.02, -0.16), "steel_dk", root)
        box("grip", (0.05, 0.07, 0.13), (0, 0.08, -0.11), "black", root)
    elif kind == "shotgun":  # breaching
        box("receiver", (0.08, 0.34, 0.13), (0, 0.04, 0), "rust", root)
        cyl("barrel", 0.028, 0.42, (0, -0.28, 0.02), "black", root, rot=(90, 0, 0))
        cyl("tube", 0.024, 0.34, (0, -0.24, -0.05), "steel_dk", root, rot=(90, 0, 0))
        box("pump", (0.06, 0.12, 0.06), (0, -0.20, -0.05), "beige", root)
        box("stock", (0.06, 0.26, 0.13), (0, 0.32, -0.03), "beige", root)
        box("grip", (0.05, 0.07, 0.13), (0, 0.14, -0.12), "black", root)
    elif kind == "dmr":  # marksman rifle — long, obvious optic
        box("receiver", (0.07, 0.50, 0.11), (0, 0.04, 0), "steel_dk", root)
        box("barrel", (0.032, 0.62, 0.032), (0, -0.50, 0.01), "black", root)
        box("stock", (0.06, 0.30, 0.14), (0, 0.40, -0.02), "olive_dk", root)
        cyl("scope", 0.045, 0.34, (0, -0.06, 0.13), "black", root, rot=(90, 0, 0))
        box("bipod_l", (0.02, 0.03, 0.16), (0.06, -0.60, -0.09), "steel_dk", root, rot=(0, 20, 0))
        box("bipod_r", (0.02, 0.03, 0.16), (-0.06, -0.60, -0.09), "steel_dk", root, rot=(0, -20, 0))
        box("mag", (0.05, 0.08, 0.18), (0, 0.02, -0.13), "steel_dk", root)
        box("grip", (0.05, 0.07, 0.15), (0, 0.18, -0.12), "black", root)
    elif kind == "lmg":  # support weapon — bulky, drum, carry handle
        box("receiver", (0.10, 0.52, 0.15), (0, 0.04, 0), "olive_dk", root)
        box("barrel", (0.04, 0.50, 0.045), (0, -0.44, 0.01), "black", root)
        box("shroud", (0.07, 0.22, 0.08), (0, -0.28, 0.01), "steel_dk", root)
        cyl("drum", 0.13, 0.11, (0, 0.02, -0.19), "steel_dk", root, rot=(0, 90, 0))
        box("handle", (0.04, 0.18, 0.06), (0, 0.02, 0.13), "black", root)
        box("stock", (0.07, 0.24, 0.13), (0, 0.38, -0.02), "olive_dk", root)
        box("grip", (0.05, 0.07, 0.15), (0, 0.20, -0.13), "black", root)
        box("bipod_l", (0.02, 0.03, 0.20), (0.07, -0.50, -0.12), "steel_dk", root, rot=(0, 22, 0))
        box("bipod_r", (0.02, 0.03, 0.20), (-0.07, -0.50, -0.12), "steel_dk", root, rot=(0, -22, 0))
    elif kind == "relic":  # old-regime prototype — smooth, wrong, slightly ornate
        taper("shell", (0.10, 0.52, 0.16), (0, 0, 0), "bone", root,
              top=(0.75, 1.0), bottom=(0.9, 1.0))
        cyl("emitter", 0.05, 0.26, (0, -0.34, 0.01), "steel_lt", root, rot=(90, 0, 0), verts=6)
        cyl("coil_a", 0.075, 0.05, (0, -0.20, 0.01), "ochre", root, rot=(90, 0, 0), verts=6)
        cyl("coil_b", 0.075, 0.05, (0, -0.10, 0.01), "ochre", root, rot=(90, 0, 0), verts=6)
        box("cell", (0.07, 0.13, 0.13), (0, 0.10, -0.13), "amber", root, emissive=1.4)
        box("grip", (0.05, 0.08, 0.16), (0, 0.16, -0.12), "steel_dk", root)
        box("stock", (0.06, 0.20, 0.14), (0, 0.34, -0.02), "bone", root)

    export(f"wpn_{kind}")


# ==========================================================================
# STRUCTURES & PROPS
# ==========================================================================

def prop_bunker():
    clear()
    root = empty("root")
    taper("mass", (7.0, 6.0, 3.4), (0, 0, 1.7), "concrete_dk", root,
          top=(0.88, 0.88), bottom=(1.0, 1.0))
    box("lip", (7.6, 6.6, 0.34), (0, 0, 3.4), "concrete", root)
    box("door_frame", (2.2, 0.4, 2.3), (0, -3.0, 1.15), "concrete", root)
    box("door", (1.7, 0.22, 1.9), (0, -3.16, 1.0), "rust", root)
    box("door_bar", (1.8, 0.10, 0.16), (0, -3.28, 1.3), "steel_dk", root)
    for i, x in enumerate((-2.2, 2.2)):
        box(f"slit{i}", (1.5, 0.20, 0.30), (x, -3.02, 2.3), "black", root)
    box("stain", (7.02, 0.10, 1.2), (0, -2.95, 0.6), "rust", root)
    cyl("vent", 0.34, 0.9, (2.6, 1.9, 3.9), "steel_dk", root)
    box("lamp", (0.30, 0.22, 0.22), (0, -3.1, 2.6), "amber", root, emissive=2.5)
    export("bunker")


def prop_hab_block():
    clear()
    root = empty("root")
    taper("body", (6.0, 5.0, 6.4), (0, 0, 3.2), "concrete_dk", root,
          top=(0.94, 0.94), bottom=(1.0, 1.0))
    box("roof", (6.4, 5.4, 0.36), (0, 0, 6.5), "concrete", root)
    for lvl in range(3):
        z = 1.4 + lvl * 1.9
        for i, x in enumerate((-1.9, 0, 1.9)):
            box(f"win{lvl}{i}", (1.0, 0.16, 0.72), (x, -2.54, z), "glass", root)
            box(f"sill{lvl}{i}", (1.16, 0.12, 0.10), (x, -2.58, z - 0.44), "concrete", root)
    box("stair", (1.2, 1.6, 0.6), (2.6, -3.2, 0.3), "steel_dk", root)
    cyl("tank", 0.7, 1.5, (-2.0, 1.6, 7.4), "rust", root)
    box("paint", (2.4, 0.10, 0.9), (-1.4, -2.60, 5.5), "ochre_dk", root)
    export("hab_block")


def prop_town_house():
    """One-storey dwelling, scaled to the person walking past it: a 2.05m
    door, windows at eye height, 3.1m walls. The hab_block reads as a tower
    because it crams three window rows into 6.4m of height; this is the
    building a town is actually made of."""
    clear()
    root = empty("root")
    taper("body", (5.6, 4.6, 3.1), (0, 0, 1.55), "concrete_dk", root,
          top=(0.96, 0.96), bottom=(1.0, 1.0))
    box("roof", (6.0, 5.0, 0.3), (0, 0, 3.25), "concrete", root)
    box("coping", (2.2, 0.5, 0.34), (-1.6, 2.0, 3.45), "rust", root)
    # The door, with a canvas over it: the one human-sized hole in the front.
    box("door", (1.05, 0.18, 2.05), (1.5, -2.28, 1.03), "pitch", root)
    box("lintel", (1.3, 0.2, 0.16), (1.5, -2.32, 2.14), "steel_dk", root)
    box("awning", (1.5, 0.9, 0.08), (1.5, -2.7, 2.4), "canvas", root, rot=(0.18, 0, 0))
    # Two shuttered windows at standing height.
    for i, x in enumerate((-1.7, -0.1)):
        box(f"win{i}", (1.0, 0.14, 0.85), (x, -2.32, 1.55), "glass", root)
        box(f"sill{i}", (1.16, 0.12, 0.1), (x, -2.36, 1.05), "concrete", root)
        box(f"shut{i}", (0.2, 0.1, 0.85), (x - 0.62, -2.36, 1.55), "olive_dk", root)
    box("side_win", (0.14, 1.0, 0.8), (2.75, 0.6, 1.6), "glass", root)
    cyl("stove", 0.16, 1.6, (-2.0, 1.4, 3.7), "steel_dk", root)
    box("paint", (1.6, 0.08, 0.7), (-1.2, -2.32, 2.55), "ochre_dk", root)
    export("town_house")


def prop_town_house_2():
    """Two storeys at a true 2.7m per floor — the tall neighbour on the main
    street, with a balcony slab over the door."""
    clear()
    root = empty("root")
    taper("body", (6.0, 5.0, 5.8), (0, 0, 2.9), "concrete_dk", root,
          top=(0.95, 0.95), bottom=(1.0, 1.0))
    box("band", (6.1, 5.1, 0.22), (0, 0, 3.0), "concrete", root)
    box("roof", (6.4, 5.4, 0.32), (0, 0, 5.95), "concrete", root)
    box("door", (1.05, 0.18, 2.05), (-1.6, -2.48, 1.03), "pitch", root)
    box("balcony", (1.7, 0.8, 0.14), (-1.6, -2.85, 3.1), "steel_dk", root)
    box("rail", (1.7, 0.06, 0.5), (-1.6, -3.2, 3.42), "steel_dk", root)
    for i, x in enumerate((0.4, 1.9)):
        box(f"winA{i}", (1.0, 0.14, 0.85), (x, -2.48, 1.6), "glass", root)
        box(f"sillA{i}", (1.16, 0.12, 0.1), (x, -2.52, 1.1), "concrete", root)
    for i, x in enumerate((-1.6, 0.4, 1.9)):
        box(f"winB{i}", (1.0, 0.14, 0.85), (x, -2.48, 4.35), "glass", root)
        box(f"sillB{i}", (1.16, 0.12, 0.1), (x, -2.52, 3.85), "concrete", root)
    cyl("tank", 0.6, 1.2, (1.8, 1.5, 6.5), "rust", root)
    box("paint", (2.0, 0.08, 0.8), (0.6, -2.52, 2.5), "ochre_dk", root)
    export("town_house_2")


def prop_town_hall():
    """The trading hall — the civic building on the square's east side.
    Double doors, tall windows, a parapet and a painted sign: one landmark,
    so the square has a front."""
    clear()
    root = empty("root")
    taper("body", (9.0, 7.0, 5.2), (0, 0, 2.6), "concrete_dk", root,
          top=(0.97, 0.97), bottom=(1.0, 1.0))
    box("parapet", (9.4, 7.4, 0.5), (0, 0, 5.35), "concrete", root)
    for i, x in enumerate((-4.3, 4.3)):
        box(f"pilaster{i}", (0.5, 0.5, 5.2), (x, -3.3, 2.6), "concrete", root)
    box("doorL", (1.1, 0.2, 2.3), (-0.58, -3.52, 1.15), "pitch", root)
    box("doorR", (1.1, 0.2, 2.3), (0.58, -3.52, 1.15), "pitch", root)
    box("lintel", (2.6, 0.24, 0.24), (0, -3.56, 2.42), "steel_dk", root)
    for i, x in enumerate((-3.0, -1.6, 1.6, 3.0)):
        box(f"win{i}", (0.9, 0.16, 1.6), (x, -3.52, 3.6), "glass", root)
    box("sign", (3.4, 0.12, 0.9), (0, -3.6, 4.6), "ochre", root)
    box("steps", (3.0, 1.0, 0.3), (0, -4.0, 0.15), "concrete", root)
    cyl("vent", 0.4, 1.0, (-3.0, 2.2, 5.9), "steel_dk", root)
    export("town_hall")


def prop_market_stall():
    """A stall a person sells things from: posts, a sloped canvas, a counter
    at counter height. The counter is the collision; the canvas is overhead."""
    clear()
    root = empty("root")
    for i, (x, y) in enumerate(((-1.2, -0.9), (1.2, -0.9), (-1.2, 0.9), (1.2, 0.9))):
        box(f"post{i}", (0.12, 0.12, 2.3), (x, y, 1.15), "steel_dk", root)
    box("canvas", (2.9, 2.3, 0.08), (0, 0, 2.35), "canvas", root, rot=(0.12, 0, 0))
    box("counter", (2.5, 0.8, 0.95), (0, -0.7, 0.48), "olive_dk", root)
    box("counter_top", (2.6, 0.9, 0.1), (0, -0.7, 1.0), "bone", root)
    box("goods", (0.8, 0.5, 0.4), (-0.6, -0.65, 1.25), "ochre", root)
    box("crate2", (0.6, 0.6, 0.6), (0.9, 0.5, 0.3), "dirt_lt", root)
    export("market_stall")


def prop_town_wall():
    """A town's wall, not a fortress's: 3.2m of coursed masonry with a coping
    stone. Encloses without dwarfing — the rampart stays the siege piece."""
    clear()
    root = empty("root")
    taper("body", (6.0, 1.0, 3.2), (0, 0, 1.6), "concrete_dk", root,
          top=(1.0, 0.82), bottom=(1.0, 1.0))
    box("coping", (6.2, 1.25, 0.28), (0, 0, 3.34), "concrete", root)
    box("course", (6.0, 1.06, 0.2), (0, 0, 1.1), "dirt", root)
    for i, x in enumerate((-2.4, 2.4)):
        box(f"foot{i}", (0.7, 1.5, 0.9), (x, 0, 0.45), "concrete_dk", root)
    export("town_wall")


def prop_gate_tower():
    """The gate pier. Referenced by two layouts and never authored —
    Models.get() returned an empty group, so the fort has been flanking its
    gate with invisible colliders since the wall went in."""
    clear()
    root = empty("root")
    taper("shaft", (2.6, 2.6, 6.4), (0, 0, 3.2), "concrete_dk", root,
          top=(0.88, 0.88), bottom=(1.0, 1.0))
    box("cap", (3.0, 3.0, 0.4), (0, 0, 6.6), "concrete", root)
    box("slit", (0.5, 2.7, 0.9), (0, 0, 5.2), "black", root)
    box("light", (0.3, 0.3, 0.24), (0, -1.35, 6.2), "amber", root, emissive=2.5)
    box("course", (2.7, 2.7, 0.24), (0, 0, 2.2), "dirt", root)
    export("gate_tower")


def prop_town_arch():
    """The beam over the gateway — scenery only, no collision box in the
    layout: the opening under it is the whole point."""
    clear()
    root = empty("root")
    box("beam", (10.6, 1.4, 1.0), (0, 0, 4.6), "concrete_dk", root)
    box("sign", (4.0, 0.14, 0.7), (0, -0.76, 4.6), "ochre_dk", root)
    box("lamp", (0.32, 0.32, 0.26), (0, -0.8, 3.95), "amber", root, emissive=2.2)
    export("town_arch")


def prop_watchtower():
    clear()
    root = empty("root")
    for i, (x, y) in enumerate(((-1.2, -1.2), (1.2, -1.2), (-1.2, 1.2), (1.2, 1.2))):
        box(f"leg{i}", (0.22, 0.22, 6.0), (x, y, 3.0), "steel_dk", root)
    for i, z in enumerate((2.0, 4.0)):
        box(f"braceA{i}", (3.0, 0.12, 0.12), (0, -1.2, z), "steel_dk", root)
        box(f"braceB{i}", (0.12, 3.0, 0.12), (1.2, 0, z), "steel_dk", root)
    box("deck", (3.4, 3.4, 0.26), (0, 0, 6.1), "steel", root)
    taper("cab", (3.0, 3.0, 1.9), (0, 0, 7.2), "olive_dk", root,
          top=(0.92, 0.92), bottom=(1.0, 1.0))
    box("cab_slit", (2.7, 3.06, 0.42), (0, 0, 7.6), "black", root)
    box("cab_roof", (3.6, 3.6, 0.22), (0, 0, 8.25), "steel_dk", root)
    cyl("mast", 0.06, 2.2, (1.3, 1.3, 9.4), "steel_dk", root)
    box("light", (0.34, 0.34, 0.26), (0, -1.5, 8.1), "amber", root, emissive=2.5)
    export("watchtower")


def prop_comms_mast():
    clear()
    root = empty("root")
    box("pad", (3.2, 3.2, 0.30), (0, 0, 0.15), "concrete_dk", root)
    for i, (x, y) in enumerate(((-0.55, -0.55), (0.55, -0.55), (0, 0.62))):
        taper(f"leg{i}", (0.16, 0.16, 13.0), (x * 1.6, y * 1.6, 6.6), "steel_dk", root,
              top=(0.3, 0.3), bottom=(1.0, 1.0))
    for lvl in range(6):
        z = 1.6 + lvl * 2.0
        s = 1.0 - lvl * 0.13
        box(f"ring{lvl}", (1.9 * s, 1.9 * s, 0.10), (0, 0, z), "steel_dk", root)
    cyl("spire", 0.05, 4.0, (0, 0, 14.5), "steel_dk", root)
    for i, z in enumerate((9.0, 11.0)):
        box(f"dish{i}", (1.5, 0.22, 1.5), (0.7, -0.5, z), "bone", root, rot=(0, 0, 20))
    box("beacon", (0.24, 0.24, 0.24), (0, 0, 16.4), "red_dk", root, emissive=3.0)
    box("shed", (1.8, 1.5, 1.4), (2.3, 1.4, 0.7), "olive_dk", root)
    export("comms_mast")


def prop_radar_dish():
    clear()
    root = empty("root")
    box("base", (2.6, 2.6, 0.8), (0, 0, 0.4), "concrete_dk", root)
    cyl("column", 0.42, 3.2, (0, 0, 2.3), "steel_dk", root)
    box("yoke", (1.8, 0.3, 0.9), (0, 0, 4.1), "steel", root)
    cone("dish", 2.6, 0.5, 1.1, (0, -0.5, 4.9), "bone", root, rot=(-115, 0, 0), verts=12)
    cyl("feed", 0.09, 1.5, (0, -1.3, 5.3), "steel_dk", root, rot=(65, 0, 0))
    box("motor", (0.7, 0.7, 0.5), (0, 0.6, 4.0), "rust", root)
    export("radar_dish")


def prop_container():
    clear()
    root = empty("root")
    box("body", (5.6, 2.4, 2.4), (0, 0, 1.2), "rust", root)
    for i in range(7):
        box(f"rib{i}", (0.14, 2.46, 2.3), (-2.4 + i * 0.8, 0, 1.2), "rust_lt", root)
    box("door_l", (0.10, 1.1, 2.2), (2.81, -0.6, 1.2), "ochre_dk", root)
    box("door_r", (0.10, 1.1, 2.2), (2.81, 0.6, 1.2), "ochre_dk", root)
    box("placard", (0.90, 0.06, 0.55), (-1.2, -1.23, 1.7), "bone", root)
    box("roof", (5.7, 2.5, 0.10), (0, 0, 2.42), "rust_lt", root)
    export("container")


def prop_crate():
    clear()
    root = empty("root")
    box("body", (1.1, 1.1, 0.85), (0, 0, 0.42), "olive_dk", root)
    box("bandA", (1.14, 0.10, 0.88), (0, -0.35, 0.42), "steel_dk", root)
    box("bandB", (1.14, 0.10, 0.88), (0, 0.35, 0.42), "steel_dk", root)
    box("lid", (1.16, 1.16, 0.10), (0, 0, 0.87), "olive", root)
    box("mark", (0.42, 0.06, 0.20), (0, -0.57, 0.55), "ochre", root)
    export("crate")


def prop_barrier():
    clear()
    root = empty("root")
    taper("body", (2.6, 0.9, 1.05), (0, 0, 0.52), "concrete", root,
          top=(0.55, 0.42), bottom=(1.0, 1.0))
    box("stripe", (0.42, 0.62, 0.30), (-0.8, 0, 0.85), "orange", root)
    box("stripe2", (0.42, 0.62, 0.30), (0.8, 0, 0.85), "orange", root)
    box("scuff", (2.62, 0.30, 0.22), (0, -0.30, 0.20), "rust", root)
    export("barrier")


def prop_sandbags():
    clear()
    root = empty("root")
    for row in range(3):
        n = 5 - row
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.62
            box(f"bag{row}{i}", (0.60, 0.44, 0.26),
                (x + (0.1 if row % 2 else -0.1), 0, 0.14 + row * 0.25),
                "canvas" if (i + row) % 2 else "dirt_lt", root, rot=(0, 0, (i * 7) % 13 - 6))
    export("sandbags")


def prop_fuel_tank():
    clear()
    root = empty("root")
    cyl("drum", 1.8, 4.6, (0, 0, 2.6), "olive_dk", root, rot=(90, 0, 0), verts=12)
    for i, x in enumerate((-1.6, 1.6)):
        box(f"saddle{i}", (0.5, 3.4, 1.2), (x, 0, 0.6), "steel_dk", root)
    box("band", (0.16, 3.5, 3.7), (0, 0, 2.6), "rust", root)
    cyl("pipe", 0.16, 2.4, (0, -2.4, 1.4), "steel_dk", root, rot=(0, 90, 0))
    box("hazard", (1.2, 0.08, 0.8), (0.6, -2.35, 3.0), "ochre", root)
    export("fuel_tank")


def prop_generator():
    clear()
    root = empty("root")
    box("skid", (3.2, 2.0, 0.28), (0, 0, 0.14), "steel_dk", root)
    box("body", (2.8, 1.7, 1.5), (0, 0, 1.05), "olive_dk", root)
    box("vent", (0.16, 1.4, 1.0), (1.42, 0, 1.05), "black", root)
    for i in range(4):
        box(f"fin{i}", (2.4, 0.10, 0.10), (0, -0.86, 0.6 + i * 0.28), "steel_dk", root)
    cyl("stack", 0.20, 1.5, (-1.0, 0.6, 2.4), "rust", root)
    box("panel", (0.8, 0.10, 0.6), (0.4, -0.88, 1.2), "steel", root)
    box("lamp", (0.14, 0.08, 0.14), (0.7, -0.94, 1.35), "amber", root, emissive=2.5)
    export("generator")


def prop_truck_wreck():
    clear()
    root = empty("root")
    box("chassis", (2.3, 5.6, 0.5), (0, 0, 0.75), "rust", root)
    taper("cab", (2.2, 1.9, 1.6), (0, -1.8, 1.8), "olive_dk", root,
          top=(0.80, 0.86), bottom=(1.0, 1.0))
    box("windshield", (1.8, 0.12, 0.7), (0, -2.7, 2.1), "black", root)
    box("bed", (2.2, 3.0, 0.9), (0, 1.2, 1.45), "rust", root)
    box("hoop", (2.24, 0.10, 1.0), (0, 0.2, 2.2), "steel_dk", root)
    box("hoop2", (2.24, 0.10, 1.0), (0, 2.2, 2.2), "steel_dk", root)
    for i, (x, y) in enumerate(((-1.15, -1.9), (1.15, -1.9), (-1.15, 1.7))):
        cyl(f"wheel{i}", 0.62, 0.42, (x, y, 0.62), "black", root, rot=(0, 90, 0), verts=10)
    box("axle_bare", (2.4, 0.24, 0.24), (0, 1.7, 0.55), "steel_dk", root)  # missing wheel
    box("burn", (2.0, 1.6, 0.10), (0, -1.8, 2.62), "pitch", root)
    export("truck_wreck")


def prop_blast_door():
    clear()
    root = empty("root")
    box("frame_l", (0.6, 0.9, 4.4), (-2.3, 0, 2.2), "concrete_dk", root)
    box("frame_r", (0.6, 0.9, 4.4), (2.3, 0, 2.2), "concrete_dk", root)
    box("lintel", (5.2, 0.9, 0.8), (0, 0, 4.2), "concrete_dk", root)
    box("slab", (4.0, 0.45, 3.9), (0, 0, 1.95), "steel_dk", root)
    for i in range(4):
        box(f"rib{i}", (3.9, 0.12, 0.20), (0, -0.28, 0.6 + i * 0.9), "steel", root)
    box("wheel_hub", (0.7, 0.20, 0.7), (0, -0.34, 2.0), "rust", root)
    box("chevron", (1.6, 0.06, 0.35), (0, -0.36, 3.4), "ochre_dk", root)
    export("blast_door")


def prop_rampart():
    """
    A length of curtain wall. Tall enough that nobody walks over it, with a
    firing step on the inside — the whole point of a siege is that the ground
    is only crossable where somebody decided it would be.
    """
    clear()
    root = empty("root")
    # The wall proper. Battered, so it reads as built rather than extruded.
    taper("curtain", (9.0, 1.5, 5.2), (0, 0, 2.6), "concrete", root,
          top=(0.86, 0.80), bottom=(1.0, 1.0))
    box("cap", (9.3, 1.7, 0.34), (0, 0, 5.3), "concrete_dk", root)
    # Firing step and its supports, on the defended side.
    box("step", (8.6, 1.1, 0.5), (0, 1.05, 3.1), "steel_dk", root)
    for i in range(3):
        box(f"brace{i}", (0.4, 0.5, 3.0), (-3.0 + i * 3.0, 1.35, 1.5), "steel_dk", root)
    # Merlons: the silhouette that says "wall" at two hundred metres.
    for i in range(5):
        box(f"merlon{i}", (1.3, 1.6, 0.9), (-3.6 + i * 1.8, 0, 5.9), "concrete", root)
    box("stain", (7.0, 0.06, 1.4), (0, -0.79, 1.6), "rust", root)
    export("rampart")


def prop_gate():
    """
    The way in, and the thing a siege is about. Deliberately the weakest-looking
    part of the wall so a player reads it as the objective without being told.
    """
    clear()
    root = empty("root")
    box("tower_l", (2.4, 2.4, 7.0), (-5.0, 0, 3.5), "concrete", root)
    box("tower_r", (2.4, 2.4, 7.0), (5.0, 0, 3.5), "concrete", root)
    box("cap_l", (2.7, 2.7, 0.4), (-5.0, 0, 7.2), "concrete_dk", root)
    box("cap_r", (2.7, 2.7, 0.4), (5.0, 0, 7.2), "concrete_dk", root)
    box("lintel", (8.0, 1.9, 1.1), (0, 0, 6.0), "concrete_dk", root)
    # The doors themselves: heavy plate, braced, and visibly repaired.
    box("door_l", (3.4, 0.55, 5.2), (-1.75, 0, 2.6), "steel_dk", root)
    box("door_r", (3.4, 0.55, 5.2), (1.75, 0, 2.6), "steel_dk", root)
    for i in range(4):
        box(f"band{i}", (7.0, 0.16, 0.30), (0, -0.36, 0.7 + i * 1.3), "steel", root)
    box("bar", (7.2, 0.30, 0.45), (0, -0.45, 3.0), "rust", root)
    box("chevron", (2.0, 0.08, 0.40), (0, -0.50, 4.6), "orange", root)
    export("gate")


def prop_pipe_run():
    clear()
    root = empty("root")
    for i, z in enumerate((1.2, 1.75)):
        cyl(f"pipe{i}", 0.20 + i * 0.04, 9.0, (0, 0, z), "steel_dk" if i else "rust",
            root, rot=(0, 90, 0), verts=8)
    for i, x in enumerate((-3.4, 0, 3.4)):
        box(f"stand{i}", (0.30, 0.55, 1.1), (x, 0, 0.55), "steel_dk", root)
        box(f"clamp{i}", (0.16, 0.62, 0.62), (x, 0, 1.5), "rust_lt", root)
    box("valve", (0.5, 0.5, 0.5), (1.6, 0, 2.2), "ochre_dk", root)
    export("pipe_run")


def prop_landing_pad():
    clear()
    root = empty("root")
    cyl("pad", 6.5, 0.35, (0, 0, 0.18), "concrete_dk", root, verts=12)
    cyl("ring", 4.6, 0.40, (0, 0, 0.22), "ochre_dk", root, verts=12)
    cyl("inner", 3.9, 0.46, (0, 0, 0.24), "concrete_dk", root, verts=12)
    for i in range(6):
        a = i * math.pi / 3
        box(f"light{i}", (0.30, 0.30, 0.26), (math.cos(a) * 6.0, math.sin(a) * 6.0, 0.40),
            "amber", root, emissive=2.2)
    box("markA", (0.7, 3.0, 0.10), (0, 0, 0.40), "ochre", root)
    box("markB", (3.0, 0.7, 0.10), (0, 0, 0.40), "ochre", root)
    export("landing_pad")


def prop_checkpoint():
    """The booth alone. The boom bar is its own no-collision model now: with
    both in one mesh, the 'auto' collision box spanned the whole arm — an
    invisible wall ten metres wide that stopped bullets under a strip of
    painted tin. A boom bar is scenery; a booth is cover."""
    clear()
    root = empty("root")
    box("hut", (2.4, 2.4, 2.6), (0, 0, 1.3), "olive_dk", root)
    box("hut_roof", (2.8, 2.8, 0.22), (0, 0, 2.7), "steel_dk", root)
    box("window", (2.1, 0.12, 0.9), (0, -1.22, 1.75), "glass", root)
    box("sign", (1.0, 0.08, 0.7), (-1.7, -1.25, 2.0), "ochre_dk", root)
    export("checkpoint")


def prop_checkpoint_boom():
    clear()
    root = empty("root")
    cyl("post", 0.14, 1.8, (0, 0, 0.9), "steel_dk", root)
    box("boom", (6.0, 0.18, 0.18), (3.0, 0, 1.6), "bone", root)
    for i in range(5):
        box(f"band{i}", (0.6, 0.20, 0.20), (0.6 + i * 1.2, 0, 1.6),
            "orange" if i % 2 == 0 else "bone", root)
    export("checkpoint_boom")


def prop_catwalk():
    clear()
    root = empty("root")
    box("deck", (8.0, 1.8, 0.14), (0, 0, 2.6), "steel_dk", root)
    for i in range(9):
        box(f"grate{i}", (0.10, 1.7, 0.16), (-3.6 + i * 0.9, 0, 2.62), "steel", root)
    for side, y in (("a", -0.85), ("b", 0.85)):
        box(f"rail_{side}", (8.0, 0.06, 0.06), (0, y, 3.6), "steel_dk", root)
        box(f"rail2_{side}", (8.0, 0.06, 0.06), (0, y, 3.1), "steel_dk", root)
        for i in range(5):
            box(f"post_{side}{i}", (0.08, 0.08, 1.0), (-3.4 + i * 1.7, y, 3.1), "steel_dk", root)
    for i, x in enumerate((-3.6, 3.6)):
        box(f"leg{i}", (0.24, 0.24, 2.6), (x, -0.7, 1.3), "steel_dk", root)
        box(f"leg2{i}", (0.24, 0.24, 2.6), (x, 0.7, 1.3), "steel_dk", root)
    export("catwalk")


def prop_antenna_small():
    clear()
    root = empty("root")
    box("base", (0.9, 0.9, 0.35), (0, 0, 0.17), "concrete_dk", root)
    cyl("pole", 0.09, 5.0, (0, 0, 2.6), "steel_dk", root)
    for i, z in enumerate((3.0, 3.8, 4.5)):
        box(f"arm{i}", (2.0 - i * 0.4, 0.07, 0.07), (0, 0, z), "steel_dk", root)
    box("box", (0.5, 0.4, 0.7), (0.55, 0, 0.8), "olive_dk", root)
    box("led", (0.10, 0.08, 0.10), (0.55, -0.22, 1.0), "red_dk", root, emissive=3.0)
    export("antenna_small")


def prop_rock(idx, seed):
    """Angular terrain rock — no smooth shading, no rounded forms."""
    clear()
    root = empty("root")
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, 0))
    o = bpy.context.active_object
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for i, v in enumerate(bm.verts):
        n = math.sin((i + seed) * 12.9898) * 43758.5453
        f = 0.62 + (n - math.floor(n)) * 0.72
        v.co *= f
        v.co.z = max(v.co.z, -0.15)  # flat-ish base so it sits on ground
    bm.to_mesh(me)
    bm.free()
    o.scale = (1.0 + idx * 0.15, 0.85 + idx * 0.1, 0.7 + idx * 0.12)
    _finish(o, "rock", mat("concrete_dk" if idx % 2 else "dirt"), root, None, (0, 0, 0))
    export(f"rock_{idx}")


def prop_dead_tree():
    """The basin is poisoned — what's left standing is bare and black."""
    clear()
    root = empty("root")
    taper("trunk", (0.34, 0.34, 4.2), (0, 0, 2.1), "pitch", root,
          top=(0.35, 0.35), bottom=(1.0, 1.0))
    for i, (dx, dy, dz, rx, ry) in enumerate((
        (0.6, 0.2, 3.4, 0, 55), (-0.7, -0.3, 3.9, 0, -50),
        (0.2, -0.6, 4.5, 50, 10), (-0.3, 0.5, 2.9, -45, 0),
    )):
        taper(f"branch{i}", (0.14, 0.14, 1.7), (dx, dy, dz), "pitch", root,
              rot=(rx, ry, 0), top=(0.25, 0.25), bottom=(1.0, 1.0))
    export("dead_tree")


# ==========================================================================
# WORLD-MAP LANDMARKS — larger, bolder silhouettes read at map scale
# ==========================================================================

def wm_settlement(kind):
    clear()
    root = empty("root")
    if kind == "trust":
        # Dolmet Station: rail depot, walls, a single hard tower.
        box("wall_n", (9.0, 0.8, 2.2), (0, -4.2, 1.1), "concrete_dk", root)
        box("wall_s", (9.0, 0.8, 2.2), (0, 4.2, 1.1), "concrete_dk", root)
        box("wall_w", (0.8, 8.4, 2.2), (-4.2, 0, 1.1), "concrete_dk", root)
        box("wall_e", (0.8, 8.4, 2.2), (4.2, 0, 1.1), "concrete_dk", root)
        taper("keep", (4.4, 4.0, 5.6), (0, 0.6, 2.8), "concrete", root,
              top=(0.86, 0.86), bottom=(1.0, 1.0))
        box("keep_top", (5.0, 4.6, 0.4), (0, 0.6, 5.8), "concrete_dk", root)
        taper("tower", (1.8, 1.8, 9.0), (-3.0, -2.6, 4.5), "concrete_dk", root,
              top=(0.7, 0.7), bottom=(1.0, 1.0))
        box("tower_cab", (2.6, 2.6, 1.4), (-3.0, -2.6, 9.6), "olive_dk", root)
        box("beacon", (0.4, 0.4, 0.4), (-3.0, -2.6, 10.6), "amber", root, emissive=3.0)
        box("shed", (3.4, 2.2, 1.8), (2.6, -2.4, 0.9), "rust", root)
        box("stripe", (9.02, 0.2, 0.4), (0, -4.2, 2.0), "orange", root)
    elif kind == "syndic":
        # Perran Flats: sprawling hab shanty around a water reclaimer.
        cyl("reclaimer", 2.6, 4.4, (0, 0, 2.2), "steel_dk", root, verts=10)
        cyl("rec_cap", 2.9, 0.4, (0, 0, 4.5), "rust", root, verts=10)
        for i, (x, y, h, c) in enumerate((
            (-3.6, -2.2, 3.2, "beige"), (3.4, -2.8, 2.4, "canvas"),
            (-3.9, 2.6, 2.8, "beige"), (3.8, 2.4, 3.6, "dirt_lt"),
            (0.4, -4.2, 2.2, "canvas"), (-0.6, 4.3, 2.6, "beige"),
        )):
            taper(f"hab{i}", (2.4, 2.2, h), (x, y, h / 2), c, root,
                  top=(0.9, 0.9), bottom=(1.0, 1.0))
            box(f"roof{i}", (2.7, 2.5, 0.18), (x, y, h + 0.1), "rust", root)
        cyl("mast", 0.10, 6.0, (2.0, 1.4, 3.0), "steel_dk", root)
        box("banner", (0.10, 1.4, 1.0), (2.0, 1.4, 5.4), "rust_lt", root)
    else:  # neutral / lawless — Vetch Crossing
        box("road_a", (14.0, 1.8, 0.10), (0, 0, 0.05), "dirt", root)
        box("road_b", (1.8, 14.0, 0.10), (0, 0, 0.05), "dirt", root)
        for i, (x, y, h) in enumerate(((-3.2, -2.6, 2.6), (3.0, -2.8, 2.0), (-3.0, 2.8, 2.2))):
            box(f"shack{i}", (2.6, 2.2, h), (x, y, h / 2), "dirt_lt", root)
            box(f"shroof{i}", (2.9, 2.5, 0.16), (x, y, h + 0.08), "rust", root)
        box("depot", (4.0, 3.0, 2.6), (3.2, 2.8, 1.3), "rust", root)
        cyl("tank", 1.2, 2.6, (-5.0, 0.6, 1.3), "olive_dk", root, verts=8)
        cyl("pole", 0.10, 5.0, (1.2, -0.4, 2.5), "steel_dk", root)
        box("lamp", (0.5, 0.3, 0.3), (1.2, -0.4, 4.8), "amber", root, emissive=2.6)
        for i, x in enumerate((-6.0, 6.0)):
            box(f"wreck{i}", (1.6, 3.0, 1.0), (x, -3.6, 0.5), "rust", root, rot=(0, 0, i * 24))
    export(f"wm_settlement_{kind}")


def wm_outpost():
    clear()
    root = empty("root")
    box("pad", (8.0, 8.0, 0.4), (0, 0, 0.2), "concrete_dk", root)
    for i, (x, y) in enumerate(((-3.4, -3.4), (3.4, -3.4), (-3.4, 3.4), (3.4, 3.4))):
        taper(f"post{i}", (1.0, 1.0, 4.0), (x, y, 2.0), "concrete_dk", root,
              top=(0.75, 0.75), bottom=(1.0, 1.0))
    box("wall_n", (7.0, 0.6, 1.6), (0, -3.4, 0.8), "concrete_dk", root)
    box("wall_s", (7.0, 0.6, 1.6), (0, 3.4, 0.8), "concrete_dk", root)
    taper("core", (4.0, 3.6, 3.4), (0, 0, 1.7), "olive_dk", root,
          top=(0.85, 0.85), bottom=(1.0, 1.0))
    box("core_top", (4.4, 4.0, 0.3), (0, 0, 3.5), "steel_dk", root)
    cyl("mast", 0.12, 7.0, (1.4, 1.2, 6.9), "steel_dk", root)
    box("dish", (1.6, 0.2, 1.6), (1.4, 1.2, 9.4), "bone", root, rot=(0, 0, 24))
    box("stripe", (4.02, 0.16, 0.36), (0, -1.82, 2.8), "orange", root)
    export("wm_outpost")


def wm_array():
    """Grellan Array — the dead installation. Leaning, broken, unlit."""
    clear()
    root = empty("root")
    cyl("base", 5.0, 0.5, (0, 0, 0.25), "concrete_dk", root, verts=10)
    cyl("column", 0.7, 5.0, (0, 0, 2.8), "steel_dk", root, rot=(6, 0, 0))
    cone("dish", 4.6, 0.8, 1.8, (0, -0.9, 6.0), "bone", root, rot=(-108, 0, 0), verts=12)
    cyl("feed", 0.14, 2.6, (0, -2.6, 6.8), "steel_dk", root, rot=(62, 0, 0))
    box("gash", (1.4, 0.3, 2.4), (1.6, -1.6, 6.2), "pitch", root, rot=(0, 0, 30))
    for i, (x, y, r) in enumerate(((-5.4, 1.2, 12), (5.0, -1.6, -9))):
        taper(f"pylon{i}", (0.5, 0.5, 6.0), (x, y, 3.0), "steel_dk", root,
              rot=(r, 0, 0), top=(0.5, 0.5), bottom=(1.0, 1.0))
    box("shed", (3.0, 2.4, 2.0), (4.4, 3.2, 1.0), "rust", root)
    box("shed_hole", (1.2, 0.2, 1.2), (4.4, 2.0, 1.0), "pitch", root)
    export("wm_array")


def wm_party(kind):
    """Tiny map tokens — a vehicle plus a silhouette cue, readable at 5px."""
    clear()
    root = empty("root")
    body = {"trust": "olive_dk", "syndic": "beige", "raider": "rust",
            "civil": "canvas", "player": "ochre_dk"}[kind]
    box("hull", (1.5, 3.0, 0.9), (0, 0, 0.75), body, root)
    taper("cab", (1.4, 1.2, 0.9), (0, -0.8, 1.6), body, root,
          top=(0.8, 0.85), bottom=(1.0, 1.0))
    box("glass", (1.2, 0.10, 0.45), (0, -1.36, 1.7), "glass", root)
    for i, (x, y) in enumerate(((-0.78, -0.9), (0.78, -0.9), (-0.78, 0.9), (0.78, 0.9))):
        cyl(f"wheel{i}", 0.42, 0.30, (x, y, 0.42), "black", root, rot=(0, 90, 0), verts=8)
    if kind == "trust":
        box("turret", (0.7, 0.7, 0.4), (0, 0.7, 2.2), "olive", root)
        cyl("gun", 0.07, 1.4, (0, 0.1, 2.3), "steel_dk", root, rot=(90, 0, 0))
    elif kind == "syndic":
        cyl("antenna", 0.04, 2.4, (0.5, 0.9, 2.6), "steel_dk", root)
        box("load", (1.3, 1.4, 0.5), (0, 0.7, 1.5), "canvas", root)
    elif kind == "raider":
        box("plate", (1.7, 0.2, 0.8), (0, -1.5, 1.3), "steel_dk", root, rot=(0, 0, 0))
        box("spike", (0.12, 0.9, 0.12), (0, -1.9, 1.5), "rust_lt", root)
    elif kind == "civil":
        box("load", (1.4, 1.8, 0.9), (0, 0.6, 1.65), "dirt_lt", root)
        box("tarp", (1.5, 1.9, 0.12), (0, 0.6, 2.14), "canvas", root)
    else:  # player
        box("load", (1.3, 1.5, 0.6), (0, 0.7, 1.5), "olive_dk", root)
        box("flag", (0.08, 0.7, 0.5), (0.6, 1.2, 2.4), "ochre", root)
        cyl("pole", 0.04, 1.6, (0.6, 1.5, 2.0), "steel_dk", root)
    export(f"wm_party_{kind}")


# ==========================================================================
# Driver
# ==========================================================================

# ==========================================================================
# INVENTORY ITEMS — kit and trade goods, authored to be read as icons
# ==========================================================================
# These are rendered to small sprites at boot rather than appearing in the
# world, so they are built facing the camera and sized to fill a square frame.

def item_kit(kind):
    clear()
    root = empty("root")
    if kind == "plate":
        taper("plate", (0.62, 0.16, 0.78), (0, 0, 0), "olive_dk", root,
              top=(0.82, 1.0), bottom=(0.9, 1.0))
        box("strap_a", (0.70, 0.10, 0.12), (0, -0.02, 0.22), "black", root)
        box("strap_b", (0.70, 0.10, 0.12), (0, -0.02, -0.16), "black", root)
        box("stencil", (0.18, 0.04, 0.18), (0.14, -0.10, 0.06), "orange", root)
    elif kind == "optic":
        cyl("tube", 0.16, 0.72, (0, 0, 0), "steel_dk", root, rot=(90, 0, 0), verts=10)
        cyl("bell", 0.21, 0.16, (0, -0.36, 0), "steel", root, rot=(90, 0, 0), verts=10)
        cyl("glass", 0.17, 0.04, (0, -0.43, 0), "glass", root, rot=(90, 0, 0), verts=10)
        box("mount", (0.16, 0.30, 0.20), (0, 0.05, -0.24), "black", root)
        box("turret", (0.14, 0.14, 0.14), (0.18, 0.02, 0.10), "steel_lt", root)
    elif kind == "bandolier":
        box("belt", (0.86, 0.14, 0.20), (0, 0, 0), "canvas", root, rot=(0, 0, 18))
        for i in range(6):
            box(f"pouch{i}", (0.11, 0.16, 0.24),
                (-0.34 + i * 0.14, -0.02, -0.10 + i * 0.045), "olive_dk", root, rot=(0, 0, 18))
        box("buckle", (0.12, 0.10, 0.14), (0.40, -0.04, 0.13), "steel_lt", root)
    elif kind == "stabiliser":
        box("frame", (0.52, 0.20, 0.62), (0, 0, 0), "steel_dk", root)
        box("arm_l", (0.16, 0.16, 0.46), (-0.30, 0, 0.06), "steel", root, rot=(0, 22, 0))
        box("arm_r", (0.16, 0.16, 0.46), (0.30, 0, 0.06), "steel", root, rot=(0, -22, 0))
        cyl("gyro", 0.17, 0.18, (0, -0.14, 0.02), "ochre_dk", root, verts=10, rot=(90, 0, 0))
        box("pad", (0.44, 0.12, 0.16), (0, 0.06, -0.30), "black", root)
    elif kind == "stim":
        cyl("body", 0.13, 0.62, (0, 0, 0), "bone", root, verts=10)
        cyl("cap", 0.15, 0.12, (0, 0, 0.34), "red_dk", root, verts=10)
        cyl("needle", 0.03, 0.24, (0, 0, -0.42), "steel_lt", root, verts=6)
        box("label", (0.20, 0.03, 0.22), (0, -0.13, 0.02), "amber", root, emissive=0.8)
    elif kind == "lightweight":
        box("harness", (0.66, 0.12, 0.16), (0, 0, 0.22), "canvas", root)
        box("strap_l", (0.12, 0.10, 0.52), (-0.24, 0, -0.10), "canvas", root, rot=(0, 10, 0))
        box("strap_r", (0.12, 0.10, 0.52), (0.24, 0, -0.10), "canvas", root, rot=(0, -10, 0))
        box("clip", (0.14, 0.12, 0.12), (0, -0.04, -0.34), "steel_lt", root)
        box("pouch", (0.20, 0.14, 0.18), (0.20, -0.04, 0.20), "olive_dk", root)
    export(f"item_kit_{kind}")


def item_good(kind):
    clear()
    root = empty("root")
    if kind == "water":
        cyl("drum", 0.34, 0.78, (0, 0, 0), "steel_dk", root, verts=12)
        cyl("rim_t", 0.36, 0.08, (0, 0, 0.36), "steel", root, verts=12)
        cyl("rim_b", 0.36, 0.08, (0, 0, -0.36), "steel", root, verts=12)
        box("band", (0.72, 0.72, 0.10), (0, 0, 0.04), "ochre_dk", root)
        box("cap", (0.14, 0.14, 0.10), (0.14, 0, 0.42), "orange", root)
    elif kind == "rations":
        for i in range(3):
            box(f"block{i}", (0.56, 0.40, 0.18), (0, 0, -0.24 + i * 0.20),
                "beige" if i % 2 else "canvas", root, rot=(0, 0, i * 6))
        box("tape", (0.60, 0.06, 0.58), (0, 0, 0), "rust", root)
    elif kind == "filter_stacks":
        cyl("core", 0.26, 0.70, (0, 0, 0), "bone", root, verts=10)
        for i in range(5):
            cyl(f"fin{i}", 0.34, 0.05, (0, 0, -0.28 + i * 0.14), "steel_lt", root, verts=10)
        cyl("cap", 0.20, 0.12, (0, 0, 0.40), "olive_dk", root, verts=10)
    elif kind == "machine_parts":
        cyl("gear", 0.34, 0.14, (0, 0, 0.10), "steel", root, verts=12)
        for i in range(8):
            a = i * math.pi / 4
            box(f"tooth{i}", (0.12, 0.10, 0.14),
                (math.cos(a) * 0.36, math.sin(a) * 0.36, 0.10), "steel", root,
                rot=(0, 0, math.degrees(a)))
        cyl("hub", 0.12, 0.20, (0, 0, 0.10), "steel_dk", root, verts=10)
        box("rod", (0.62, 0.10, 0.10), (0, 0, -0.22), "steel_lt", root, rot=(0, 0, 20))
        box("bracket", (0.24, 0.20, 0.12), (-0.20, 0, -0.30), "rust", root)
    elif kind == "fuel_cells":
        box("body", (0.44, 0.36, 0.66), (0, 0, 0), "olive_dk", root)
        box("top", (0.48, 0.40, 0.10), (0, 0, 0.36), "steel_dk", root)
        box("window", (0.16, 0.04, 0.40), (0, -0.19, 0), "amber", root, emissive=1.6)
        box("post_a", (0.08, 0.08, 0.12), (-0.13, 0, 0.44), "steel_lt", root)
        box("post_b", (0.08, 0.08, 0.12), (0.13, 0, 0.44), "rust_lt", root)
    elif kind == "medical_stock":
        box("case", (0.66, 0.34, 0.50), (0, 0, 0), "bone", root)
        box("lid", (0.68, 0.36, 0.08), (0, 0, 0.26), "white_dim", root)
        box("cross_v", (0.10, 0.04, 0.28), (0, -0.18, 0.02), "red_dk", root)
        box("cross_h", (0.28, 0.04, 0.10), (0, -0.18, 0.02), "red_dk", root)
        box("handle", (0.22, 0.06, 0.08), (0, 0, 0.34), "steel_dk", root)
    elif kind == "optics":
        taper("housing", (0.46, 0.46, 0.44), (0, 0, 0), "steel_dk", root,
              top=(0.7, 0.7), bottom=(1.0, 1.0))
        cyl("lens_ring", 0.26, 0.10, (0, 0, 0.26), "steel_lt", root, verts=12)
        cyl("lens", 0.22, 0.06, (0, 0, 0.32), "glass", root, verts=12)
        box("mount", (0.52, 0.18, 0.10), (0, 0, -0.26), "black", root)
        box("cable", (0.08, 0.08, 0.26), (0.20, 0.16, -0.20), "rust", root, rot=(30, 0, 0))
    elif kind == "salvage":
        for i, (x, y, z, r) in enumerate((
            (0, 0, -0.20, 8), (0.10, 0.04, -0.04, -14), (-0.08, -0.03, 0.12, 22),
            (0.04, 0.02, 0.26, -6),
        )):
            box(f"plate{i}", (0.72, 0.30, 0.10), (x, y, z),
                "rust" if i % 2 else "steel_dk", root, rot=(0, 0, r))
        box("strap", (0.16, 0.40, 0.62), (0, 0, 0.02), "canvas", root)
    export(f"item_good_{kind}")


def item_armour(kind):
    """Armour pieces, authored to read as icons in the equipment screen."""
    clear()
    root = empty("root")
    if kind == "head_light":
        taper("cap", (0.52, 0.56, 0.34), (0, 0, 0), "canvas", root,
              top=(0.72, 0.72), bottom=(1.0, 1.0))
        box("brim", (0.56, 0.20, 0.07), (0, -0.26, -0.12), "canvas", root)
        box("band", (0.54, 0.58, 0.08), (0, 0, -0.14), "rust", root)
    elif kind == "head_combat":
        taper("shell", (0.58, 0.62, 0.42), (0, 0, 0), "olive_dk", root,
              top=(0.78, 0.78), bottom=(1.0, 1.0))
        box("rail", (0.60, 0.08, 0.06), (0, 0, 0.16), "steel_dk", root)
        box("visor", (0.46, 0.10, 0.16), (0, -0.30, 0.02), "glass", root)
        box("strap", (0.52, 0.54, 0.06), (0, 0, -0.20), "black", root)
    elif kind == "head_heavy":
        taper("shell", (0.64, 0.66, 0.50), (0, 0, 0), "steel_dk", root,
              top=(0.80, 0.80), bottom=(1.0, 1.0))
        box("plate", (0.52, 0.12, 0.30), (0, -0.30, 0.0), "steel", root)
        box("slit", (0.36, 0.06, 0.06), (0, -0.36, 0.06), "black", root)
        cyl("filter", 0.10, 0.16, (0.18, -0.30, -0.14), "steel_dk", root, rot=(90, 0, 0))
        box("crest", (0.08, 0.50, 0.10), (0, 0, 0.28), "orange", root)
    elif kind == "body_webbing":
        box("vest", (0.62, 0.20, 0.68), (0, 0, 0), "canvas", root)
        box("strap_l", (0.12, 0.12, 0.70), (-0.22, -0.08, 0), "olive_dk", root)
        box("strap_r", (0.12, 0.12, 0.70), (0.22, -0.08, 0), "olive_dk", root)
        for i in range(3):
            box(f"pouch{i}", (0.16, 0.14, 0.16), (-0.20 + i * 0.20, -0.16, -0.22), "olive_dk", root)
    elif kind == "body_carrier":
        box("plate", (0.66, 0.24, 0.74), (0, 0, 0), "olive_dk", root)
        box("front", (0.50, 0.10, 0.54), (0, -0.16, 0.02), "olive", root)
        box("shoulder_l", (0.20, 0.24, 0.16), (-0.40, 0, 0.30), "olive_dk", root)
        box("shoulder_r", (0.20, 0.24, 0.16), (0.40, 0, 0.30), "olive_dk", root)
        box("stencil", (0.16, 0.04, 0.16), (0.12, -0.22, 0.10), "orange", root)
    elif kind == "body_heavy":
        taper("cuirass", (0.74, 0.34, 0.80), (0, 0, 0), "steel_dk", root,
              top=(0.92, 0.92), bottom=(0.84, 0.9))
        box("ribs", (0.60, 0.10, 0.10), (0, -0.20, 0.16), "steel", root)
        box("ribs2", (0.60, 0.10, 0.10), (0, -0.20, -0.02), "steel", root)
        box("pauldron_l", (0.26, 0.30, 0.20), (-0.46, 0, 0.32), "steel_dk", root)
        box("pauldron_r", (0.26, 0.30, 0.20), (0.46, 0, 0.32), "steel_dk", root)
        box("gorget", (0.34, 0.24, 0.10), (0, 0, 0.44), "steel", root)
    elif kind == "legs_fatigues":
        box("thigh_l", (0.24, 0.24, 0.72), (-0.17, 0, 0), "olive_dk", root)
        box("thigh_r", (0.24, 0.24, 0.72), (0.17, 0, 0), "olive_dk", root)
        box("belt", (0.60, 0.26, 0.10), (0, 0, 0.38), "black", root)
    elif kind == "legs_reinforced":
        box("thigh_l", (0.26, 0.26, 0.72), (-0.18, 0, 0), "canvas", root)
        box("thigh_r", (0.26, 0.26, 0.72), (0.18, 0, 0), "canvas", root)
        box("pad_l", (0.22, 0.10, 0.24), (-0.18, -0.16, -0.10), "olive_dk", root)
        box("pad_r", (0.22, 0.10, 0.24), (0.18, -0.16, -0.10), "olive_dk", root)
        box("belt", (0.62, 0.28, 0.10), (0, 0, 0.38), "black", root)
    elif kind == "legs_plated":
        box("thigh_l", (0.28, 0.28, 0.72), (-0.19, 0, 0), "steel_dk", root)
        box("thigh_r", (0.28, 0.28, 0.72), (0.19, 0, 0), "steel_dk", root)
        box("plate_l", (0.26, 0.10, 0.34), (-0.19, -0.18, 0.04), "steel", root)
        box("plate_r", (0.26, 0.10, 0.34), (0.19, -0.18, 0.04), "steel", root)
        box("knee_l", (0.18, 0.16, 0.14), (-0.19, -0.12, -0.30), "steel", root)
        box("knee_r", (0.18, 0.16, 0.14), (0.19, -0.12, -0.30), "steel", root)
        box("belt", (0.64, 0.30, 0.12), (0, 0, 0.38), "rust", root)
    export(f"item_armour_{kind}")


def main():
    print("=== KETTLE REACH asset build ===")
    for a in ("head_light", "head_combat", "head_heavy",
              "body_webbing", "body_carrier", "body_heavy",
              "legs_fatigues", "legs_reinforced", "legs_plated"):
        item_armour(a)
    for k in ("plate", "optic", "bandolier", "stabiliser", "stim", "lightweight"):
        item_kit(k)
    for g in ("water", "rations", "filter_stacks", "machine_parts",
              "fuel_cells", "medical_stock", "optics", "salvage"):
        item_good(g)
    for f in ("bracket", "trust", "syndic", "commander", "prisoner",
              "scour", "littoral"):
        character(f)
    for w in ("rifle", "smg", "shotgun", "dmr", "lmg", "relic"):
        weapon(w)
    titan()
    titan_plate()
    titan_core()

    prop_bunker()
    prop_hab_block()
    prop_town_house()
    prop_town_house_2()
    prop_town_hall()
    prop_market_stall()
    prop_town_wall()
    prop_gate_tower()
    prop_town_arch()
    prop_watchtower()
    prop_comms_mast()
    prop_radar_dish()
    prop_container()
    prop_crate()
    prop_barrier()
    prop_sandbags()
    prop_fuel_tank()
    prop_generator()
    prop_truck_wreck()
    prop_blast_door()
    prop_rampart()
    prop_gate()
    prop_pipe_run()
    prop_landing_pad()
    prop_checkpoint()
    prop_checkpoint_boom()
    prop_catwalk()
    prop_antenna_small()
    prop_dead_tree()
    for i in range(4):
        prop_rock(i, i * 7 + 3)

    for k in ("trust", "syndic", "neutral"):
        wm_settlement(k)
    wm_outpost()
    wm_array()
    for k in ("trust", "syndic", "raider", "civil", "player"):
        wm_party(k)

    print("=== done ===")


main()
