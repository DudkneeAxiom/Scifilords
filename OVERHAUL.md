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

- The enemy commander postures are EXERCISED now (tools/postures.mjs,
  tools/holdtest.mjs) and behave. What is genuinely dead is the
  withdraw-and-quit rule: the stall nudge reaches the same host twelve
  seconds earlier and puts it back in contact, so the thirty-second
  count can never finish. Harmless today — the battle resolves by rout
  instead — but it is unreachable code.
- Wounded/dead/captured resolution is inherited from the gun era and
  was never re-tuned for melee lethality.
- Sieges: the approach is FIXED (see the playtest round below) — an
  attack order now advances without line of sight and the garrison holds
  its wall. What remains is shape: the assault arrives as a crowd, not a
  column, and the two breach vectors are not chosen between.

## Round: the progression tree, and the world screen

Two things this round, both of them "half the old system was still
running underneath".

### The perk tree is steel now

`src/perks.js` was the last untouched shooter system. It shipped through
the whole overhaul offering Quickdraw (reload speed), Pack Mule
(magazine capacity), Trigger Control (burst length), Suppressor and
Steady Nerves — five promotions a player could spend on a gunfight the
game no longer has. Retired, and replaced with perks the melee runtime
reads:

| perk | mod | where it bites |
| --- | --- | --- |
| Swordhand | `swingSpeed` | `strike()` shortens the swing, damage untouched |
| Long Arm | `reachBonus` | `resolveStrike()` reach — who lands first |
| Shieldwall | `guardStr` | the guard branch: what a parry turns, what the plate eats |
| Planted | `staggerRes` | the stagger comparison — weight no longer cancels them |
| Second Wind | `wind` | `updateStamina()` and the per-swing cost |
| Deadeye | `rangeAcc` | `looseArrow()` scatter at the loose |
| Full Quiver | `magMul` | arrows carried |
| Standard Bearer | `rally` | `baseNerve()` via `rallyBonus()` |
| Iron Will (cmd) | `squadNerve` | `baseNerve()` company-wide |

Role affinities were remapped to what the role IDs now MEAN — rifleman
is a swordsman, gunner a spearman, marksman an archer, breacher the
heavy — rather than what they are still called in the save format.

`reloadMul` / `burstBonus` / `burstRest` survive in `effective()` at
their neutral values because emplacements still fire; no perk feeds them.
A save carrying a retired perk still loads: `perkMod` skips ids it does
not recognise.

### The world screen is a layout, not a wallpaper

The map became a window in the top-left at 61% height with the company
board down the right and a campaign feed beneath. The location card,
territory key and contacts report moved OFF the map into a strip under
it — they used to cover the corner you most wanted to see. Folding the
board full-screens the map.

Two real bugs fell out of building it: `#map-labels` was full-screen
while labels project into CANVAS space, so every place name sat eight
pixels left and fifty-two up and region titles walked onto the status
bar; and the chase re-aim in `worldmap.setDestination` played its
acknowledging click on every one of sixty frames a second, which turned
running down a moving party into a buzzsaw.

### Still open

- The enemy commander's hold/snipe postures still want a directed playtest.
- Sieges use the field systems but their approach logic predates
  formations.

## Round: the playtest that found the scale was never raised

The complaint was "gameplay and scaling seems off". It was, in seven
connected places, and the root of most of them is the same: the combat
overhaul made the ENEMY an army and never made the player one.

`tools/playtest.mjs` puts the two halves side by side. `tools/bigfight.mjs`
plays battles at each scale and traces the gap, the orders, the nerve and
the reason the fight ended.

### What the numbers said

The deploy ladder ran 5 to 14, capped at 16. The map produces faction
battle groups of 32-60 and armoured columns of 60-110, on a field built
for 120 bodies. The campaign's own resolver gave a legendary company
**22%** against a column it was expected to fight. Meanwhile the whole
overhaul was about formations, and the player's formation was three
ranks of four.

| | before | after |
| --- | --- | --- |
| deploy at Unknown | 5 | 8 |
| deploy at Legendary | 14 (cap 16) | 60 (cap 68) |
| contract pay | flat 520-850 all campaign | scales with the same ladder |
| 60 v 100 odds | n/a — could not field 60 | 55% |
| 8 v 6 odds | 67% | 77% |
| 8 v 18 odds | 40% | 45% |

Pay is derived from the deploy rung on purpose: what you may field
decides what you must pay, and what you are paid decides what you may
field. One source keeps them from drifting.

### Four bugs that stopped battles being battles

Found by playing them rather than reading them:

1. **The advance was unreachable.** It lives under AI state `hunt`, which
   a body only enters once it has SEEN something. Sight is 55m; two
   armies deploy 78m apart. Both lines stood in a field looking at an
   empty horizon — 60 v 60, ninety seconds, no contact, no casualties.
   Now a host in a PITCHED battle starts hunting; a hideout or a sabotage
   run still has to notice you, or stealth is deleted.
2. **The line advanced backwards.** Frontage was measured back from the
   host's own centre, and the centre is wherever the host just walked —
   so every think-tick told each man to stand further behind where he
   already was. A host ordered to advance opened from 77m and ended
   116m away. Ranks now lay out from a guide set the formation's own
   depth ahead of the centre: a line can stand or advance, never recede.
3. **Nerve could not be spent.** Regen was +2.8/second against 2.6 for
   watching a friend die, so a soldier needed a death a second just to
   hold steady. A hundred-strong host was ground to nineteen with every
   survivor pinned at the ceiling and not one man routing. Regen is now
   0.7/second, a seen casualty costs 9, and being outnumbered two to one
   is worth looking over your shoulder for.
4. **Winning did not count as winning.** The objective counted BODIES,
   and a broken army runs rather than dying. Rout twenty of thirty and
   the count stopped at ten: objective never completed, extraction never
   armed, and the player stood on the extraction point having won the
   field with no way to leave it. Breaking them now completes it.

Two more from the same sweep: a beaten force concedes rather than
requiring annihilation (a remnant that backs off, or one or two men left
of thirty), and a withdrawal that loses contact for half a minute
actually leaves.

### The commander is no longer the battle

Going down ended the mission outright — fair when the squad was four
people, absurd when sixty of your soldiers are standing and the enemy
line is breaking. The battle now continues without you and can still be
won; you are carried out. The commander also no longer bleeds out on a
timer mid-battle, which that change would otherwise have made possible.

## Round: combat quality — numbers, the read, and the guard

Four complaints: the squad of four keeps plaguing encounters, the player
cannot tell at what distance they will be hit, cannot tell which way to
block, and the animations do not fit.

### The squad of four

Last round raised the deploy ceiling into army numbers and it did not
reach the player at all, because the gate had simply moved. The roster
was FOUR — `startingCompany` returned a commander and three — and a
town would put two people forward at a time. Renown said twelve and the
company said four, and four is what turned up.

| | before | after |
| --- | --- | --- |
| starting company | 4 | 10 |
| recruits offered per town | 2 (+bonuses) | 6 (+bonuses, doubled) |
| manpower per settlement | 14 | 40 |
| a green swordsman costs | ~650 (kit at 80% of retail) | ~150 (kit at 20%) |
| opening deploy rung | 8 | 12 |
| company at day 30, measured | 4 | 15-19 |

The kit premium was the quiet one: recruits arrive wearing what their
town issues and `hireCost` billed four fifths of its retail price, so a
green swordsman in a Trust town cost 650 against a contract worth 600.
The signing fee had become a kit purchase. Troops are now cheap to take
on and expensive to keep, which puts the recurring decision on the
payroll where it belongs — `tools/growth.mjs` plays the recruiting loop
and reports where a company settles.

### The two things a melee never told you

**Which way to block** was unanswerable, because there was nothing to
answer: `guard` was a BOOLEAN. Hold the button, face the man, and every
blow from the front was turned identically. No amount of telegraphing
would have helped a mechanic with no direction in it.

The guard is now steered by the same hand motion that aims a swing, so
parrying is the mirror of attacking. The right line turns the blow; the
wrong line is not a block at all and costs full price. A shield is the
only thing that forgives a misread, which is most of what a shield is
for. Soldiers read it too, on their bladework — a veteran picks the
right parry, a recruit guesses — or directional blocking would have
made the AI untouchable.

**How close is close enough to be hit** is now the guard rose: four
blades around the crosshair. Yours lights amber, theirs flares red and
tightens as the steel falls, and green when they are the same blade.
The reach number is the attacker's OWN weapon reach, so a spearman
reads as dangerous from further out than a swordsman — which is the
entire point of carrying a spear.

### The guard is on the body, not just the HUD

A guard that only exists in the interface is a mechanic the player has
to be told about rather than one they can read off the man in front of
them. All four lines are distinct poses on the rig — high across the
brow, low across the body, turned to either shoulder — verified by
`tools/guardpose.mjs` rather than by eye.

### Not addressed

The map and control complaints. Both are too vague to act on without
guessing, and guessing at a battlefield layout is expensive.

## Round: battlefields with an opinion

"Too open, featureless, samey" had a precise cause. Only four of sixteen
sites had a landform, and `roadside` — the layout every road engagement
uses, and therefore most battles in the game — was one of the twelve
flat ones. The three shaped sites were rare enough that nobody ever saw
the difference.

Terrain now on every open fighting site, each written as a tactical
question rather than as decoration: the road gets an embankment with
dead ground behind it, the array a rimmed basin, the quarry a worked pit
with a bench either side, the reclaimer spoil heaps with no commanding
ground anywhere. Measured relief went from noise to 11–17m.

### Where terrain does NOT go

The works, the fort and the bastion were given landforms in the same
pass and all three broke — the fort's curtain stopped blocking, the
works' stairs stopped climbing. Their props are AUTHORED: walls, decks
and stair flights placed at known heights on flat ground. Raising the
ground under a building does not make the building interesting, it makes
it half buried. They also were never the complaint: a fort already has
the most opinionated terrain in the game standing on it, which is the
fort.

### Two stale constants, found the hard way

- The Bastion's curtain was pinned at ±198m to span a spread cap of
  1.75. Raising that cap to 2.3 made the wall flankable on foot again at
  exactly the scale where walls matter. Derived from `b.bound` now.
- `partySpeed` charged a crowding penalty from six people because a
  company WAS six. Every company in the game was permanently slowed for
  existing. It starts at twenty now.

### And one test that was right to fail

The arrows test places a target twenty metres from an archer and asserts
they loose once fire discipline is lifted. On a flat plate that was a
guaranteed clear shot; with terrain and scattered wrecks it is not. The
first two attempts to fix it guessed — level ground, then a hand-rolled
terrain sample — and both were wrong, because what was actually in the
way was a PROP. It now sweeps bearings using `Level.hasLOS`, the game's
own sight test, rather than an approximation of it.

## Round: the duel — lock-on, the wind, and how the steel is held

"Combat should feel more fluid; players and AI can just spam; the
animations and how they hold the weapons are way off; it should feel
like For Honor with a lock-on."

### The lock

A melee is a conversation with ONE man and the game had no way to say
which. The camera looked wherever the mouse last went, the body followed
the camera, and keeping a chosen opponent framed while circling him was
a manual tracking exercise the player lost the moment two more joined
in. That is most of what made the melee unreadable — not that the
information was missing, but that the thing it was about kept sliding
off the screen.

`V` locks the man you are most plainly looking at (nearest to the centre
of view, weighted by distance, never behind you, never through a wall).
Locked:

- the camera holds him and orbits as he moves, steered toward the
  bearing rather than snapped to it, so circling is smooth;
- the body faces him, so you can back off or sidestep without ever
  turning your shield away;
- **movement becomes footwork**: W closes, S backs off, A/D circle. A
  sidestep stays a sidestep however the camera is sitting, which is the
  difference between footwork and steering;
- a readout names him, his condition and the range.

Acquire range is shorter than break range on purpose, so a man you have
chosen does not slip the lock when he takes a step back. Steel only — a
lock while carrying a bow is an aim assist, which is a different game.

Verified in a live duel with `tools/lockon.mjs`: through a 290-degree
circle the camera and body both hold him with zero steady-state error,
a sidestep sweeps 2.7 radians round him while the range moves 0.45m, and
the lock lets go of a dead man.

### The wind

Soldiers had NO stamina at all. The melee AI swung the instant its
cooldown cleared, for ever. A body that cannot run out of breath cannot
be baited or worn down and never gives the opening that makes a duel a
conversation, which is the whole of "they just spam".

Everyone has a wind now. Missing costs more than landing — the recovery
used to be identical whether the blow found somebody or went through
empty air, so there was never a reason not to throw one. And a swing
shuts the bellows for three quarters of a second, without which the
arithmetic quietly permitted infinite mashing: a blow cost 0.18 and
standing still paid back 0.25 a second, so anybody swinging about once a
second was net POSITIVE on breath.

Measured over a 30s duel that cannot end (`tools/spamcheck.mjs`): the AI
went from unlimited to 0.47 blows a second with eight seconds of
openings in it, and a player mashing the button now bottoms out at zero.

### The guard poses were my own regression

The direction offsets added last round were ADDED to an already-raised
guard: the base lifts the shoulder to -1.10 and the high line put
another -0.55 on top, which is -1.65 — ninety-five degrees, an arm
straight up with the sword flung back behind the head. Every screenshot
of somebody blocking looked like a dislocated shoulder.

Each line is an absolute pose blended toward now, and the weapon pitch
for each was tuned against rendered sweeps rather than guessed.
`tools/holdview.mjs` photographs every weapon in every state and
`tools/pitchsweep.mjs` renders one pose across a range of values,
because a claim about a pose has to be looked at.

## Round: the eye, and the shooter's commands

Two things at once: the control scheme is a third-person shooter's and
keeps producing collisions, and the camera claimed a continuity it did
not have.

### The commands were the old game's

`V` did two things. Lock-on was bound to it last round and `V` was
already FALL BACK, so one press locked a man AND told the company to
break contact. There is no free key left in the hand's reach that is not
already a verb, so the wheel button learned to tell a tap from a hold:
tap locks, hold gives orders. Nothing else had to move.

SUPPRESS is retired. "Pour fire into that position, pin whoever is
behind it" needs automatic weapons, an ammunition economy and an enemy
who takes cover from volume rather than from arrows. The X binding said
so itself — *"it keeps its gun-era meaning while guns remain in the
world"*. X is fire discipline now and nothing else; with no bows in hand
it refuses rather than falling through to the gun verb.

`tools/controls.mjs` checks the PROPERTIES rather than the specifics: no
order named in gun language, no two orders sharing a key, tap-locks and
hold-orders. That is the check that would have caught the V collision on
the day it was made.

### The transition was a cut wearing a move's clothes

The wheel comment has claimed since the tactical view was built that
rolling out "pulls you up into command" and that the two cameras "read
as two ends of one motion rather than two modes". Toggling flipped a
boolean. The glide afterwards was the tactical rig easing its own
height — a cut, dressed. Coming back down had no glide at all.

Both rigs compute a transform now and the eye interpolates between them:
position, orientation and field of view, on a smoothstep. Measured with
`tools/camerafeel.mjs`, which judges a cut the only way a still cannot —
by the largest single-frame step as a fraction of the whole move. It
peaks at 2.66m of a 40m rise, under 7%, on a continuous path. The first
attempt was smooth but covered four metres a frame, which reads as a
smear rather than a rise; it is slower now.

Locked, the eye frames the PAIR: pulling back and rising as the range
opens, widening a little, and swinging the shoulder to whichever side
keeps him clear of your own back. 6.04 to 7.16 of pullback as a duel
spreads from two metres to eight.

### And a bug of my own making

At 60 v 100 the battle reported `committed=60/100` — forty men never
entered the fight. Making both sides share one body budget shrank the
enemy's share, which pushed the reinforcement gate above what was ever
alive; and `checkRout` will not call a field with reserves unspent, so
that battle could not be won. Reserves feed whenever there is ROOM now,
not only when the line has nearly collapsed.

## Round: weight, and the seed trap fixed at the source

### The steel has weight now, and a direction

Impact was one scalar, `shake`, which jittered the whole view identically
whatever caused it — a grenade, a bullet, a maul. Noise is not weight.

An impulse spring in the eye's own axes: a swing WINDS UP (the eye drifts
back along the arc before the blow goes the other way), LANDING carries
it along the arc and drives it in, CATCHING one on the guard shoves it
back through the shoulder, and a swing that finds NOTHING carries you
past it. Locked on, everything is worth 35% more — the camera is holding
still on one man rather than being swung about by the mouse, so the same
impulse reads as force instead of noise.

The first pass was honest about direction and moved the camera about a
centimetre and a half: measurable, unfeelable. `tools/weight.mjs` reports
peak displacement AND which way it went, so the gain was tuned against
evidence.

### And the bodies answer it

The rig had `flinch` — one number that ducks the head whatever happened —
and `recoil`, which is a rifle's kick. Neither says which WAY.

`jarred(dir, force)` drives the arm back along the line a blow came down
and turns the torso away from it; `carried(dir, force)` carries the
shoulder on round the way the weapon went. A jar is sharp and short, a
follow-through unwinds slowly, because recovering a swung weapon takes
longer than absorbing one. Both fire from the same four moments as the
camera weight, so the eye and the body cannot disagree — and both are on
EVERYONE, which is what makes a line of sixty read as men hitting each
other rather than models passing through one another.

Measured: blade landing 0.65 of follow-through, maul 0.95, a block 1.15
of jar, a miss 1.30 — the largest in the game, because nothing stopped
it.

### The seed trap, fixed at the source this time

The duel test flaked. It was written AFTER the trap was diagnosed and
written up, and still went in unpinned — pass in isolation, fail in the
suite, the same signature as the two before it.

Three tests had been pinned one at a time as they bit; fifty-two build
missions off the campaign seed. Pinning them individually was losing, so
`newCampaign()` now pins by default. That covers every test at once
including the ones nobody has written yet, and a test that genuinely
wants a varying world can still set its own seed deliberately and
visibly. Documenting a trap is not the same as removing it.

## Round: playtest every mission type, not just the skirmish

Ten mission types, and almost every probe in the tree builds a skirmish.
So this round played one of each — build it, march the line, walk the
commander at whatever the mission wants doing, and ask whether it
RESOLVES (`tools/everytype.mjs`).

### A siege nobody could start

Two bugs, and they compounded into a mission that could not begin.

`acquire()` will not hand back a target without line of sight, which is
correct — but the branch that executes an attack order reads
`order === 'attack' && t`, so with no target it fell through to the
formation branch and everyone re-formed on the commander. The order
looked accepted and did nothing. A garrison stands behind a wall, so in a
siege it did nothing every time: ten men idle at v=0, fifty metres off
the gate, for two solid minutes. Telling a line to attack does not mean
"attack whoever you happen to see" — they now march on the nearest enemy
they know about, wall or no wall, and pick up a real target as one
clears.

The other half was on the defending side. `pitchedBattle()` is true for a
siege from EITHER end, and it was the only test gating the promotion out
of `guard` into `hunt` — so the garrison left its posts to go hunting,
ran into its own curtain wall and stayed there, three and a half metres a
second of nothing, the gap to the assault frozen at fifty. Defenders man
the wall; only the side that marched gets promoted.

With both fixed a fort plays end to end: the assault closes 55m → 6m,
the gate goes down, and the field is decided — `carried(win)` at 89s.

### Three findings that were the probe, not the game

Worth writing down because each looked like a serious bug for a while.

- "The mission ends as `wiped` with eight men alive" — the probe counted
  `!dead`; the game counts `!dead && !down && !militia`. A company
  entirely on the floor is legitimately finished.
- "The commander's death loses a battle the army is winning" — same
  miscount. Standing was genuinely zero.
- "A cache can be looted for ever" — the probe filtered on `done`; the
  game filters on `done || taken`, and cache sets `taken`.

The habit that caught all three: measure the way the code being tested
measures, and check a suspicious result against `git stash` before
believing it. The advance change above was A/B'd that way — at HEAD the
same lair ends 0v18 having killed nobody, so the fix is neutral-to-better
rather than the regression the raw numbers first suggested.

### The exchange rate, finally measured

Ten against eighteen is a wipe in sixty seconds, which reads alarming
until you run even numbers: nine a side ends 4v0 to the player
(`tools/fair.mjs`). The melee is sound and player troops are not weaker —
being outnumbered 1.8:1 in a melee is simply decisive. Worth noting the
per-swing numbers are lopsided the other way (theirs dmg48/reach2.6 vs
mine dmg26/reach2.2) and my side still wins, so the gap is carried
somewhere else in the stat block.

### Casualty resolution, with numbers on it

The open item below said this was never re-tuned for melee. It has now
been measured rather than asserted (`tools/attrition.mjs`, pure
functions, no renderer):

| outcome        | cut | crush | shot |
|----------------|-----|-------|------|
| won, extracted | 0%  | 0%    | 0%   |
| lost, medic    | 41% | 58%   | 56%  |
| lost, no medic | 53% | 70%   | 68%  |

That is a cliff, not a curve: a battle you win costs nothing permanent
and returns everyone inside a week, a battle you lose buries half your
downed. It follows directly from `stabilised: success && extractArmed`,
so it is a deliberate line rather than a defect — but it means victory
has no attritional cost, which is the opposite of the campaign this is
modelled on. Left alone deliberately: moving it changes recruiting, pay
and the deploy ceiling together, and that is a design decision, not a
bug fix.

The 240-day map soak was clean through all of this: 0 console errors,
every panel closed, every invariant held.

## Round: the postures, the town, and four probes that lied

A playtest round that produced one real fix, one reverted change, and a
lot of evidence that the probes had rotted faster than the game.

### A weapons crate in the middle of a friendly town

The optional cache is placed for every mission type except `defense` —
which quietly included `visit`, the walk through a settlement to trade
and hire. So every town had a weapons crate lying in the street of a
place that is not fighting you, worth 180-320 credits and a weapon to
whoever bent down. Towns can be entered and left at will, so that was
not a one-off pull, it was an income. The cache is a thing you spend
time on during a deployment; there is no time being risked while
shopping. Now excluded, with a test that checks a skirmish still has
one, so the crate was taken out of towns rather than out of the game.

### The commander's four postures, finally exercised

The open item said hold and snipe were lightly exercised. They are now
(`tools/postures.mjs`, `tools/holdtest.mjs`), and they work: `advance`
closes 50m to 26m, `hold` walks to the edge of its own sight and STOPS —
v=0.0 held for forty seconds — and looses 133 arrows, `withdraw` gives
ground, `snipe` details men onto exposed archers.

Getting there took four false alarms, all of them the probe:

- "A holding host walks 129 metres backwards." The gap between two
  armies moves when EITHER army moves, and our melee line was routing
  under archery. Measure the host against fixed ground, not the enemy.
- "It still walks 132 metres with our line pinned." `updateStall()`
  nudges a host with no contact into hunting THE PLAYER, and the probe
  had parked the player at (900,900) to take them out of the sum. The
  host was walking to the corner because that is where the player was.
- "Sixteen archers loose nothing." The bow was built by hand as
  `{...weapon, bow: true, range: 40}`, which has no rpm and no magazine.
  aiShoot cannot fire a weapon that never comes off cooldown. Use the
  real `WEAPONS.bow` and it fires 133 arrows.
- "Arrows are never created." The list is `arrows`, not `projectiles`.

### One change made and reverted

The withdraw-and-quit rule (a beaten force out of contact for thirty
seconds leaves, and the field is called) cannot fire in practice,
because the stall nudge reaches for the same force at twelve seconds and
puts it back in contact. That looked like two safety nets fighting, so
the nudge was made to leave a withdrawing host alone — and then the
measurement said the battle already resolved correctly BOTH ways
(objective complete, extraction armed; the remnant leaves either way).
No demonstrated bug, and the patch had put its early return ahead of the
forty-second break-off as well, which would have removed the backstop it
was meant to preserve. Reverted. Written down because the interaction is
real even though the outcome is not broken: the quit rule is
effectively unreachable, and if it is ever wanted, the nudge is why.

### Probes that had gone stale

`tools/roundtrip.mjs` — the WebGL context-exhaustion check — had been
broken for some time and nobody noticed, because a probe that fails
looks like a probe that is failing rather than a probe that is wrong. It
waited on a perk card that stopped existing when the tree was rebuilt
for steel, then deployed to 'grellan' at hard-coded coordinates that
went stale when the world map was rebuilt (it is at 520,-600 now, not
200,-218). Both now read from the game's own data. It reports clean: 8
round trips, no contexts leaked, draw calls flat, 0 console errors.

`tools/townwalk.mjs` is new and walks a settlement end to end — twelve
people, no hostiles, every one of the six reachable and each opening the
panel it promises.

### Noted, not changed

The cache's memorable reward is a `dmr` — the Vardo Long Rifle. Guns
were taken out of combat in the overhaul, and the one optional pull in
the game still hands you one. Content decision rather than a defect, so
it is flagged here rather than quietly rewritten.

### A flake with a real cause: drift across an await

The tactical-camera test failed about one run in eight, on the assertion
that a commander ordered to a point behind a solid block gets within four
metres. On a bad run they stopped eighteen short.

The campaign seed is pinned and the mission RNG derives from it, so the
level is identical every run — which ruled out the usual suspect early
and left the question of what else was varying. It was time.
`Mission.start()` awaits its assets, and the render loop keeps stepping
the mission across those awaits with real frame times, so the commander
had drifted a different distance before the test ran. That section picks
its wall by proximity to wherever the commander is standing, so a
different drift chose a different wall, and some of them cannot be walked
around inside the twenty-five seconds allowed.

The pathing itself is fine: every candidate wall on that level is
reachable from the spawn, all four of them, measured in
`tools/walkaround.mjs`. So the test now starts that section from
`level.playerSpawn` — pinning the scenario without weakening the claim.
36 consecutive runs green afterwards, against a 1-in-8 failure rate
before.

The general lesson, alongside the seed one: a pinned seed does not make a
test deterministic if the clock is still an input. Anything measured
after an `await` in a mission that is being stepped by a render loop has
a variable amount of simulation behind it.

### Also measured this round, and sound

- The books, forward, for the first time (`tools/ledger.mjs`, pure
  functions, no browser). Contract pay tracks renown — 1990 at twelve
  strong to 8892 at sixty-eight — and holds a near-constant 10 to 14
  days of wages at every company size. Ninety-day runs keep their
  rosters and climb. Two apparent faults on the first pass were the
  probe: payScale keys off RENOWN, not roster size, and the company that
  deserted to nothing had simply never been fed.
- Gun-era content. Six guns remain in the weapon table, but every role
  now carries steel or a bow (`rifleman` has a sword, `gunner` a spear),
  no shop stocks a gun by design, and the weapon card already reads
  melee as reach-and-swing rather than rounds per minute. The only gun
  reachable in the game is the find-only cache relic.

## Round: looking at it

Every probe in this tree reads numbers out of the simulation. None of them
had ever looked at the screen, and a game can pass every assertion while
rendering its status bar off the edge of the window. So this round took
screenshots and read them.

Four faults, none of which any test could have caught.

### The status strip ran off the screen

Six blocks of fixed-size text in a nowrap row come to about 1484px, and
nothing in the row shrinks. At 1280 wide the last 228px simply left the
window, taking BANNER, TRUST and SYNDIC with it — the player's standing
with both factions, invisible at one of the commonest screen sizes there
is, and it looked like a rendering fault because the row ends mid-word.
It only fitted at 1920. Everything now scales with the viewport rather
than dropping fields (`tools/layout.mjs` measures it at three sizes).

### Place names on top of each other

Hiding all names above zoom 1.5 dealt with the province view and left the
close view alone — but the middle of the Reach is dense, and there were
thirty overlapping pairs at 1280, some by eighty pixels. Stacked text
does not read as two places, it reads as a smear.

Names are now placed by priority and one that would land on another is
dropped for that frame: the contract you are on, then settlements, then
whatever is nearest. Party strength markers claim their space FIRST and
names give way to them — a strength band is live tactical information and
moves every frame, a place name is static reference that comes back when
the camera nudges. Thirty pairs down to two, and the two remaining are
marker-on-marker, where you want both.

### Pressing DEPLOY sent you in alone

The deployment panel pre-ticked the commander and nobody else. So the
default action, on a panel headed "SELECT DEPLOYMENT — 1 OF 68", with ten
fit soldiers on the books, was to march one person onto a field with a war
band on it. Watched through the real deploy path: down, and "breaking
contact", seconds after the intro cleared, having done nothing wrong
except take the default. The company now deploys; deselecting is one
click per name, where selecting was up to sixty-eight.

That one was also hiding the guard rose and the lock indicator, which
correctly do not draw for a commander who is already down.

### ROUNDS FIRED, in a game with no rounds

Every victory screen reported "0 ROUNDS FIRED" — a gun-era stat that can
now only ever be zero — while saying nothing about the fighting. Blows
struck was already being counted and never shown. The report now reads
BLOWS STRUCK, and keeps an ARROWS LOOSED line for when somebody actually
carried a bow.

### Three things that looked broken and were not

The pattern of this round, and worth recording as plainly as the fixes.

- "The battle renders into a small box in the corner." That was the
  harness building a Mission by hand and skipping main.js's `teardown()`,
  which is what strips the world screen's framed layout off the viewport.
  Through the real deploy path the canvas is full-bleed at 1440x900.
- "The tactical view shows no soldiers." The screenshot caught the camera
  mid-blend at 1.6s. Photographed at the same instant as the measurement,
  it is a correct top-down command view with the squad and its selection
  rings in frame.
- "The town panel traps you — the exit button is off screen at 720p." The
  scroll container is `.modal`, which carries `max-height: 88vh; overflow:
  auto`; asking `.modal-body` whether it scrolled reported a trap that is
  really a scrollbar. Scrolling to the end brings the footer into view.

Also checked and sound, first time visually: the title and background
questionnaire, all six side-rail panels, the three footer verbs by click
and by shortcut, the settlement panel's eleven verbs, every town service,
the loadout screen (all steel and bow, no guns on any shelf), the
after-action report on a win and on a loss, and save/CONTINUE across a
real browser reload — day, credits, renown, roster and names all restored
identically.

### A money printer behind the counter

The trade prices were one base price pushed apart by RELATION alone: buy
was base minus the swing, sell was base plus it. At neutral standing the
two met exactly, and above neutral the sell price crossed OVER the buy
price in the same market. So a well-regarded company could buy a crate
and sell it straight back across the same counter for more than it paid —
no travel, no time, no risk. Measured at relation 100: ten crates of
rations bought for 710, sold back for 1010. Three hundred credits a go,
repeatable for ever.

The relation reward is deliberate and stays. What was missing is a
trader's margin sitting between the two prices, wider than the swing can
reach, so buy is always dearer than sell. Liked, you now pay 1.02 of base
instead of 1.18 and receive 0.98 instead of 0.82 — relation narrows the
counter's cut rather than inverting it, and the round trip costs
something at every standing (-300 hostile, -40 beloved). Money is still
made the way it should be: hauling to a town whose own priceAt() is
higher. The ninety-day ledger is unchanged, because contracts were always
the income and trade the sideline.

Also verified working, through the campaign's own functions: rations
(quoted 253, charged 253, seven days delivered), hiring off a town's
recruit pool (330 paid, roster 10 to 11), and goods arriving in the hold
in the quantity charged for.

### Locking on made the fight smaller

The complaint was that none of the melee work — the lock camera, the
guard poses, the weight going through a blow — was visible in play. It
was not a rendering fault. The lock rig pulled the eye back as the range
opened, which is right, on top of a flat push-out that applied at EVERY
range, which is not. Locking on at reach moved the camera a metre further
away and half a metre higher than free look, and both men shrank for it:
measured at 2.1m and 1280x800, the commander went from 215 pixels tall to
176 the moment the lock engaged. Everything the melee pass built was
being shown at three quarters size exactly when the player most needed to
read it.

The base is negative now. Inside about three and a half metres — where a
fight actually happens — the lock leans IN and drops slightly to put the
stance on screen; past that the old opening-out takes over and holds both
men in frame as the range stretches towards the break. Commander back to
213px, which is larger than free look rather than a fifth smaller.

For the record, the rest of the melee work does behave, measured through
a real deployment with an opponent pinned at reach (`tools/swingfilm.mjs`,
`tools/lockframe.mjs`):

- The lock takes hold, names its man, and the lock HUD goes from `none`
  to `flex`: "LOCKED — SCRAP SWD", with a ring under him and his range on
  the health bar.
- A swing runs 0.05 to 0.53 and is over in about 200ms, and wind drops
  from 100 to 76 on the HUD as it goes.
- The weight spring is real and reaches the eye: `camPush` peaks at
  0.52 with a velocity spike of 13.9 at the moment of the strike, then
  settles to zero inside 350ms.

The stills are in the scratchpad; the swing is legible frame by frame
once the camera is in the right place.

## Round: too many commands, and the one that was missing

The report: "many commands and very confusing on what the player should
do." Counting them made the case — about thirty-three bindings, with
letters meaning different things in different places (F is form-up in a
battle and fast-forward on the map; H is hold and centre-view; V is fall
back and equipment; E is interact and enter; Q is boot and step-screens).

But the sharpest finding was an absence.

### There was no key for attack

Keys existed for form up, hold, flank, fall back, shield wall, volley and
shape-cycle. There was none for ATTACK — the order a player wants most of
the time and the first one they go looking for. The behaviour was already
written (`issueContextOrder`: look at a man and the company goes for him,
look at ground and they take it) and reachable only by holding the middle
mouse and picking it off a wheel.

It is on R now. R was reload — a binding that cannot fire in a game with
no guns, sitting on the most obvious free key on the hand.

### Ctrl meant two things at once

Ctrl held was crouch, and Ctrl+1..9 binds a control group. So every time
the player bound a group they also dropped to one knee, and had to press
C to stand up. Crouch keeps C; Ctrl is the group modifier and nothing
else.

### The strip teaches itself now

Seven orders in identical type, no shortcuts shown, and the one you
actually want not on the strip at all. It now carries its own keys and
says which order is the one you reach for: SEND THEM IN (R) lit and
boxed, FORM UP (F) and HOLD (H) beside it, then a divider and the four
refinements at lower weight, then the arm-select keys. A player never has
to open a controls screen to find the verb.

### And the controls screen leads with the few that matter

It opened straight into thirty-odd bindings in three columns at one
weight, so "what do I actually do?" was buried among boot, vault, crouch
and shape-cycle. Four lines now sit at the top — swing and guard, lock
on, send them in, form up or hold — with a note that between R, F and H
you can fight a whole battle. The full reference is unchanged underneath
for anyone who wants it.

Verified in a real deployment (`tools/controls2.mjs`): R takes all nine
of the squad, Ctrl+1 binds without crouching, all eight strip entries
show their key, and the controls screen leads with the essentials and no
longer mentions reloading.

### Work that was offered and could never be posted

The board picks a mission type from the site's own list and then looks up
the wording for it. No wording, no posting — generateContract() returns
null and the caller sees nothing, which reads exactly like "no job
today". Twelve locations advertised SEIZE work in their data and one a
LAIR: sixteen per cent of every site/type offer on the map, none of it
able to reach the board, while buildSeize() and buildLair() sat fully
written in the mission layer. An implemented mission type was unreachable
from the campaign.

Both have wording now, and a 400-posting board carries 64 seize jobs and
11 lairs where it carried none. The invariant is a test rather than a
memory, because data and content drifting apart is silent by nature.

### Two loose ends from the control rework, found by walking it

- The wheel advertised R for CHARGE and nothing was bound to it — there
  was no 'r' handler except reload. Meanwhile MOVE / ATTACK, the order a
  player reaches for constantly, had no key at all. One key now, and the
  wheel, the strip and the controls screen finally agree: SEND THEM IN on
  R. CHARGE stays on the wheel, which suits it — it is the all-out
  version and worth a deliberate choice rather than a reflex.
- The weapon panel still read "EMPTY — R", naming a key that now orders
  the company, for a reload that happens automatically in the firing path
  anyway. It says EMPTY.

## Round: the field is yours, so take what you want off it

Two things, both from the same report: you should not have to walk back
across a field you have just cleared, and what came off it should be
yours to sort rather than banked behind your back.

### The walk after the last man falls

Every completed objective armed an extraction and asked the player to
cross ground they had already taken, with nothing on it, to collect what
was already theirs. That walk earns its place while somebody is still
shooting — getting out with the thing you came for is half of a sabotage
run, and a recovery still refuses to close while freed personnel are
strung out behind you. It is pure tax when the last man is down.

So the walk is kept for a field that is still contested and a field that
is not simply ends: no hostiles standing, no reserves left to commit, no
stragglers outstanding, a beat of about a second and a half so the last
blow reads, and then the report.

### And the take is offered, not taken

The spoils screen has always read `result.fieldSpoils` — and nothing has
ever written it. So the one place the player was meant to look over what
the enemy carried and decide about it only opened when there were
prisoners, and kit was simply added to the truck without a word.

The report carries the take now, one entry per piece rather than pools
with counts, because the decision is made a piece at a time. Everything
is kept unless you say otherwise; clicking a piece leaves it where it
fell. `applyMissionResult` deliberately does NOT bank spoils on a report
that carries the field list, so the screen is a decision rather than a
description — reports without it (autoresolved encounters, older saves)
keep the old behaviour exactly.

Two things this turned up while building it, both caught by measuring
rather than reading:

- The take was banked TWICE. The button's handler and the modal's own
  onClose both lead to the same exit — deliberately, so the escape key
  cannot drop the whole field's kit on the floor — and both fire on a
  button press. One medkit off the field arrived as two.
- `addSpoils()` stages into `S.spoils`, a holding bag that `claimSpoils()`
  empties into the real stores later. Reading `S.armoury` straight after
  the decision reports every kept piece as lost, which is a probe error
  that looks exactly like a bug.

## Round: diplomacy and the stalls

Both systems' rules check out under their own tests
(`tools/dipshop.mjs`), which is worth recording because gates are where
this kind of code goes wrong — one that never opens is a feature nobody
can reach, one that never closes is an exploit.

- A stall refuses every wrong purchase: broke, a town with no market, one
  you already hold, selling one you do not own. It costs 2400 and sells
  back for 1600, so the round trip loses money — no arbitrage there
  either. Income is 0 where a town has frozen you out (relation ≤ -25),
  72/day normally, 86 at 40 or better: about a thirty-three day payback.
- A commission needs standing 14 AND renown 300, and correctly refuses
  when given either alone. Declaring for yourself needs renown 1200 AND
  three holdings, and names which one you are short of. War and truce
  between the majors set and clear, and enemiesOf() agrees.

### The stall nobody could see

The holdings screen was byte-identical with and without one — 441
characters both times, still reading BRACKET HOLDS NO GROUND. A player
spends 2400 credits and the only evidence is the money leaving; the sole
reminder the stall exists is walking back to that particular town and
talking to its trader. Hold three across the Reach and there was nowhere
to see what they came to.

They are listed now, with the town, what each pays today, how long it
has been held, and the total across all of them. They sit with the truck
rather than with the ground, because a stall is an interest in somebody
else's town — you do not hold Dolmet because you rent a counter in it —
and the roll call below is about ground. A town that has frozen you out
reads as such instead of showing a confident zero.

## Round: the grip, the colours, and a blow you can see coming

Three reports, one theme — the game knew things it was not showing.

### Everyone on the equipment screen held a rifle

`makePreview` called the rig with `aiming: true` and no melee flag, so it
used the shouldered firing pose whatever was in the hand: every swordsman
in the company stood holding his sword like a carbine. The rig has had
proper melee poses all along — each weapon carries its own `hold` and
`guard` — and the preview simply never passed them.

It does now, and it moves: the loop settles on guard, cuts, and recovers,
so the screen shows what the kit DOES rather than a mannequin. The model
fallback was `wpn_rifle` too, so a soldier carrying nothing was drawn
with a carbine; it is a blade now.

### Four factions, one grey crowd

The per-instance tint was removed when characters were merged and
instanced — recolouring shared geometry would mean cloning it per soldier,
and that is what makes a sixty-strong field affordable. So faction lived
entirely on the ring under each man's feet.

An InstancedMesh carries a colour per instance without touching geometry,
which is exactly the tool for this; the faction rings have used it all
along. Bodies are tinted now, and the preview — one body, where a cloned
material costs nothing — is tinted too.

The tints are NOT FACTIONS[*].color. That is the map's palette: olive,
khaki, brown and ochre, chosen to sit on a dust-coloured continent
without shouting, and painted onto bodies those four become one warm
smudge. A field asks a different question — whose man is that, and is he
coming for me — so it gets four hues far enough apart to answer it in
peripheral vision: your own in gold, Trust in cold blue, Syndic in red,
and anybody else in violet.

### A blow you could not have answered

The rose was fed the right things all along — which line the blow is
coming down, and how far through its wind-up it is. The problem was the
clock. A swing resolved 55% of the way through, which put the entire tell
inside 254ms for a blade and 303ms for a sword; human visual reaction is
about 250ms just to NOTICE, before the hand moves. Against three
opponents the windows overlap and nothing can be answered. The melee read
as unfair because it was.

The apex is later now (`SWING_APEX`), and total swing time is unchanged —
the wind-up is longer and the recovery shorter, so the pace of a fight
and the damage it does are untouched. Measured, first-showable frame to
impact:

| weapon | before | after |
|--------|--------|-------|
| blade  | 267ms  | 317ms |
| sword  | 317ms  | 383ms |
| spear  | 400ms  | 483ms |
| heavy  | 600ms  | 750ms |

And the rose says it properly. It was a five-pixel sliver whose only tell
was a change in alpha — asked to carry a life-or-death timing through
something the eye does not catch while the camera is moving. The bars are
thicker, and an incoming blow now GROWS along its own line towards the
crosshair, reaching full length exactly at impact: motion is what the eye
catches without being looked at, and length is a clock you can read
without counting. A guard that meets it stops dead and goes green.

### A footnote worth keeping: the export that walked off

Four tests went red for this round and three were the usual thing — a
test pinned to the old constant, advancing a swing by 0.6 of its duration
because the apex used to be at 0.55.

The fourth was mine, and it is a trap worth writing down. Inserting a
block before an anchor of `const FIELD_CAP` matched INSIDE the real line,
`export const FIELD_CAP`, so the new block landed between the keyword and
its declaration:

    export /** ...comment... */ const FIELD_TINT = { ... };
    const FIELD_CAP = 120;

FIELD_TINT became the exported one and FIELD_CAP quietly stopped being
exported. It PARSES — `export /*comment*/ const X` is perfectly legal —
so the boot check passed clean, and the only thing that noticed was a
test importing the constant, which then built a party of NaN strength and
put four men on a field sized for a hundred and sixty-five.

An anchor has to be unique against the whole line, not a substring of it.

## Round: one palette, everywhere a side has to be recognised

The battlefield got faction colour last round; the map tokens and the
roster faces had the same problem and were left out of it. Sweeping them
turned up the real issue, which was that there was no single answer to
"what colour is Trust".

There were three palettes. `FACTIONS[*].color` — olive, khaki, brown,
ochre — is the MAP'S FURNITURE, chosen so labels and holdings sit on a
dust-coloured continent without shouting, and it is right for that job.
`TERRITORY_TINTS` in worldmap.js held a saturated cyan/red/violet for the
border lines. And last round's `FIELD_TINT` was a third set, invented for
bodies, close to the second but not the same — so a Trust column was one
blue on a field and a different cyan on the map.

There is one now: `FACTION_SIGNAL` in data.js, used by the borders, the
party tokens, the bodies and the portraits. A side looks like itself
wherever it appears.

### The token, not the ring under it

A party's allegiance lived entirely on a ring at 0.4 opacity, so
thirty-odd bands read as one column of identical shapes and telling a
Trust patrol from a raider pack meant squinting at a halo. The tokens are
tinted now — there are tens of them, each its own clone, so a cloned
material costs nothing like it would on a field of sixty instanced bodies.

And a caravan is not a bandit pack. Everything without a faction fell
through to the raider violet, so trade caravans and free companies flew
the colour of "nobody's writ, everybody's problem" — on a map you read at
a glance that is worse than no colour, because it says RUN about somebody
selling grain. Violet is for parties that will actually come at you;
everyone else wears undyed cloth.

### The faces

Portrait cloth was four near-identical darks picked at random, so twelve
faces in a roster carried no information beyond "person". A soldier's
ORIGIN is already written on the row beside them — FREE, TRUST, SYNDIC,
SCOUR, PORT — so it is in the cloth now, muted well down from the signal
colour because this is a shoulder at sixteen pixels and not a banner.
Five origins, five distinct cloths, checked by sampling the pixels the
portrait actually draws (`tools/identity.mjs`).
