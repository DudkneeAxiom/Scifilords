# THE COMBAT OVERHAUL — working reference

Guns out, Bannerlord in. The design contract lives in HANDOFF.md ("THE
COMBAT OVERHAUL" section); this file is the code map that drives the
rewrite. Line numbers surveyed at commit b71f96c — they will drift as the
rewrite lands, but the names won't.

## The shooting pipeline (what dies)

One muzzle: `fire()` mission.js:2889-2969 — gates (cooldown/reload/
arriving), ammo decrement, `e.char.kick()`, player recoil pre-kick,
spread formula, per-pellet `rayHit` hitscan, `spawnTracer`,
`applyDamage`, `applySuppression`, muzzle flash, `Audio.shot`,
`raiseAlarm`, post-shot recoil. Player trigger at :3498-3509; AI
trigger `aiShoot` :4435-4522 (reaction → ranging-in → burst →
spread → burstRest). Reload :2876-2881 + ticks :3489/:4074.
Suppression :2976-3010 (+decay :4073). Cover-shooter: `coverPref`,
`Level.findCover` re-picks :4176-4182/:4318-4330, `coverPenalty`
:4417-4433, player cover-snap :582-656.

## REMAIN (engine — build on it)

- Movement: `moveToward` :4573-4697 (A*, corners, avoidance,
  separation-at-1.55m, elevation stepper), `faceMotion`, `updateStance`
  (crouch/gravity/landing), `tryJump`, nav.js, level.js surfaces.
- Bodies: `spawnEntity` :698-765, `buildSquad` :828-922, `spawnEnemy`
  :959-981, `bodyCapsule` :76-84 (becomes the melee reach volume).
- Rendering: `batchCharacter`/`updateCharBatch` :781-826, `syncVisuals`
  LOD :5216-5337, `syncRings`.
- Waves: FIELD_CAP :42, `deployEnemyWave` :1305, `updateSkirmishWaves`
  :1331-1363, allied waves :1287-1302, `reinforce`/`spawnPointFor`.
- Command plumbing: `ORDERS` :1890-1915, wheel :1917-1977, `issueOrder`
  :1997, selection/control groups :2518-2564/:2284-2306, full RTS layer
  :2160-2498.
- `rayHit` :2821-2874 stays — it is load-bearing for camera collision
  (:5157) and RTS picking, NOT just bullets.
- `applyDamage` :3099-3170 shell (lastCombat stamp, flinch, hurtFrom,
  retaliation), `downEntity`/bleed :3236-3270, loot.
- HUD envelope `buildHud` :5356-5493 + ui.js consumers; camera rig
  :5111-5214; audio module + `relPos`.

## CHANGE (keep the seam, replace the interior)

- `acquire` :4088-4103 — add engagement pairing (who fights whom).
- `updateEnemy` engage :4167-4200 — standoff band `w.range*0.35..0.8`
  becomes close-and-strike (reach-valued range makes this nearly free).
- `updateFriendly` :4203-4348 — order skeleton stays; charge behaviour
  :4236-4257 becomes the default engaged state.
- `aiShoot` :4435-4522 — delete ballistics, KEEP the pacing shape:
  reaction/windup/recovery map onto swing timing.
- `FORMATIONS` :106-135 + slot math :4305-4314 — line becomes primary,
  spacing tightens (current line gap 2.4m is too wide for a wall).
- `fire()` — signature/gating right, interior replaced by `strike()`
  (arc sweep at apex over `bodyCapsule`s within reach).
- `tuck` :4054-4069 → guard/brace posture. `actionOf` :5340 verb table.
- WEAPONS schema: melee fields added (done — see data.js melee block).
- models.js pose :522-562 — authored for a shouldered rifle; needs
  carry/swing poses per class (polearm, bow draw, shield arm).

## DISAPPEAR

Hitscan interior of fire() :2929-2953; recoil (:2905-2911, :2961-2967);
ADS (:3429, :2932, :3444, FOV pose :5119-5121); ammo/reload everywhere
(:2876-2881, :718-719, :3489, :4074, HUD ui.js:362-366); suppression
system entire (:2976-3010, :2567-2582, :4383-4405, vignette/bloom);
cover-shooter behaviour (:730, :4176, :4318, :4417, :2649, :582-656);
ranging-in/burst discipline (:59-60, :4459-4476, :4499-4502); tracers/
muzzle flash :3276-3305; crosshair hit-tick; `Audio.shot/dryFire/reload`
call sites; `char.kick()` recoil anim; weapon-range movement decisions.

Gotcha: `charge` advertises key R (:1896) but R is bound to reload
(:2022) — the key frees up when reload dies.

## Data plumbing (from the data survey)

- WEAPONS consumed fields: rpm (cooldown 60/rpm), pellets, spread/
  adsSpread, range (AI standoff + ray length), damage, id (audio), mag/
  reload/auto, model, price, abbr/name. Dead: scope, pierce;
  `effective().reloadMul` computed but never consumed (quickdraw perk
  is currently a no-op — dies with reload anyway).
- ROLES: six ids are load-bearing across saves, TROOP_PATHS, hireCost
  map (state.js:3459 HARDCODED), wageOf map (state.js:4110 HARDCODED),
  garrison arrays (14 sites), perk affinities, ORIGINS[*].roles.
  THE REMAP KEEPS THE IDS and changes meaning:
  rifleman→Swordsman(sword) · breacher→Heavy(heavy) ·
  marksman→Archer(bow) · gunner→Spearman(spear) ·
  medic→Field Medic(blade) · signals→Signalist(blade).
  Flip happens WITH the melee AI, not before.
- effective() stat keys that stay meaningful: accuracy (=melee skill),
  aggression, speed, sight, luck, closeDmg (promotes into core),
  interactSpeed, bleedMul, maxHp. Die with their systems: suppressPower/
  Resist, rangeAcc, burstBonus/Rest, magMul, reloadMul, cover/coverRange
  (repurpose cover→guard discipline later).
- Weapon mesh attach: `makeCharacter` models.js:419-423 → rig.hand_r;
  shield needs hand_l/forearm attach (new). Preview ui.js:1309-1313
  ignores lineage (known divergence).
- New-weapon checklist (18 steps) validated: data entry → MODELS
  manifest → build.py branch → role weapon → hireCost/wageOf maps →
  audio voice → fire/AI branches → HUD → tests.

## The roster remap (phase 7, landed)

The six role ids are UNCHANGED — that is the whole save-compatibility
story, and it also spares the two hardcoded cost maps
(state.js hireCost/wageOf), TROOP_PATHS, every garrison array in
mission.js, ORIGINS[*].roles and the perk affinity table. What changed
is what the ids MEAN:

| id | was | is | arms |
|----|-----|-----|------|
| rifleman | Rifleman | **Swordsman** | sword + shield |
| gunner | Support Gunner | **Spearman** | spear + shield |
| marksman | Marksman | **Archer** | bow (blade sidearm) |
| breacher | Breacher | **Heavy Infantry** | breaker maul |
| medic | Field Medic | Field Medic | blade |
| signals | Signals Tech | Signalist | blade |

TROOP_PATHS rewired so the line (rifleman) branches into spear, bow and
maul; the rank ladder (recruit→trooper→veteran→sergeant) is untouched
and still carries the experience half of the directive's tree.

`ROLES[*].shield` puts the plate on at SPAWN for both sides — which is
also the fix for the visual-QA finding that a mid-mission weapon swap
left the old mesh in the hand: the mesh follows `role.weapon` through
spawnEnemy/buildSquad, so the thing drawn and the thing in the maths
are now one decision made once.

`DOCTRINES` (data.js) skews who actually turns up per faction, applied
by `doctrineRoles()` in mission.js at both role-draw sites: trust
weights spears/swords (and gets +15% shield HP), syndic weights swords
and bows, raider mostly swords. A signature arm (weight ≥3) turns up
even when the party tier never listed it, so a Trust column always has
spears in it.

Markets sell steel now (`weaponStock` in ui.js); guns remain in WEAPONS
as pre-charter relics with no shelf space. Starting armoury, the
commander's own weapon, allied militia and field spoils all re-armed.

## Battlefields (phase 9, landed)

`LANDFORMS` in level.js is module state beside `FLAT`, applied inside
`heightAt` via `shapeAt()` — ridges (rounded whalebacks, cosine falloff
along and across) and bowls (shallow depressions). Set per-build from
the site id, cleared every build, and measured BEFORE the flatten pad
so a graded town still sits on whatever the landform made.

Sites: `pass` (THE NARROWS — two 10.5m shoulders with a ~12m gap; the
battle is who holds the gap), `highway` (THE LONG HAUL — embankment
down one side of a wreck-strewn roadway, two stair points up to the
shooting positions), `relay` (THE RELAY FIELD — three low hummocks and
a central hollow, nothing commanding), plus a spine added to `field`
(THE APPROACHES) so its defender has ground worth holding.

Terrain now poses the directive's questions mechanically:
- **Uphill costs**, scaled by heft — `moveToward` samples the grade
  1.6m ahead and taxes the step (maul ×1.5, other melee ×1.0, bow ×0.6,
  floor 0.45; downhill gives back up to 15%).
- **Height helps a bow** — `looseArrow` adds up to +25% flight speed for
  shooting downhill, so the arrow gets there flatter and lands harder.
- **Chokepoints favour spears** — emergent: the gap is narrower than a
  line's frontage, and spear reach dominates a frontage that narrow.

`handleEncounter` in main.js picks the field from `State.regionAt` —
sarn→pass/relay, weal→highway/field, scour→pass/highway,
littoral→highway/relay, kettle→relay/field — keyed by party id so the
same band on the same ground fights the same field twice. Parties under
8 strong still fight at the roadside: five men do not need a hundred
metres of frontage.

## Asset state

wpn_sword / wpn_spear / wpn_heavy / wpn_bow / wpn_blade / wpn_shield
exported (build.py weapon() branches, -Y forward like the guns).
WEAPONS entries live in data.js with compat fields (rpm/range/mag keep
old readers working; melee/bow flags + reach/arc/stagger/shieldMul/
brace/inside/flight/volley are the new schema). Shield is a KIT entry
(id 'shield', shieldHp 120, blockArc 2.1) riding the existing gear
slot. Nothing points at any of it yet — the flip comes with the
runtime.


## Where it landed

All ten phases are in, and the acceptance suite is green across the
whole thing: **149/149**, plus a 200-day map soak with zero stuck panels
and zero console errors.

The shape of the game now:

- Steel, not bullets. Swings resolve as an arc sweep at the apex; there
  is no hitscan left in a melee. Guards, shields with their own HP,
  spear brace and inside-reach, stagger by weapon weight, a stamina bar
  that pays for both swings and sprints.
- Arrows are bodies in flight with solved ballistic arcs, deliberate
  volleys, fire discipline, and a sidearm when pressed.
- Three arms (INFANTRY / SPEARS / RANGED) selected with one key each,
  formations that hold real spacing and reform, shield wall / line /
  loose, and an enemy host that dresses its own ranks and marches
  abreast rather than swarming.
- Morale as nerve spent by casualties a soldier personally SAW, paid
  back by a commander in sight; rout as leaving the field alive rather
  than dying; victory called when a side stops being an army.
- Battlefields with opinions — ridges worth taking, chokepoints worth
  holding, slopes that tax the man carrying the maul — chosen by where
  on the campaign map you met.
- FIELD_CAP 120 on measured evidence (tools/scale.mjs), no cliff to
  240, draw calls flat.
- The campaign end to end: the roster is the army, the army is what
  fights, and what happens to it comes back.

### Still open, honestly

- The enemy commander has four postures; two of them (hold, snipe) are
  lightly exercised in play. Worth a directed playtest.
- Wounded/dead/captured resolution is inherited from the gun era and
  was never re-tuned for melee lethality.
- Sieges use the field systems but their own approach logic predates
  formations; they work, they are not yet FORMED.
