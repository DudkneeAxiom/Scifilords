# Handoff

Current as of the world-map development pass (the commit carrying this
file), **100/100 acceptance tests passing**. The strategic layer is now a
living campaign space: an irregular carved rim with the world continuing
beyond it, interior ridge walls whose passes are the roads, durational
NPC-vs-NPC battles with reinforcement and join-able arrivals, events with
lifetimes (distress signals, old-regime transponders, lootable
battlefields), predation that makes parties MEET, contact intel with
fuzzy estimates and intents, and six new locations including three
faction pickets. tools/mapsoak.mjs plays all of it through the real UI
and steers at whatever blinks; the pulse probe pattern (2-hour cadence,
never 24-hour snapshots — they hide battles whole) is how the world's
rhythm is read. Pushed history lives at
<https://github.com/DudkneeAxiom/Scifilords>; push only when asked.

The last long session was almost entirely strategic-layer work, aimed at making
the Reach behave the way the games this is modelled on do. What went in, roughly
in order: relief on the mission ground with collision that follows it; a
ranging-in delay so enemies are not perfectly accurate the instant they see you;
pursuit, so bands chase the company and a settlement is a haven; garrisons; a
world clock that runs whether or not the player moves; a war that moves the map
with marching columns you can intercept; named lords who lead those columns and
outlive them; contested manpower between the player, faction musters and
raiders; terrain and roads that decide travel speed; click-to-chase and a camera
that leaves the company; a realm screen; kingdom policies; vassals holding
fiefs; morale reaching the field; and prisoners who escape if you cannot guard
them. Each has a probe in `tools/` named after it.

This is the note I would want if I were picking the project up cold. It is not a
feature list — `README.md` is that. It is the things that are easy to get wrong
here, and the reasons behind decisions that look arbitrary from the outside.

---

## Running and testing

```bash
npm run serve                 # static server on 8124; PLAY.cmd on Windows
node tools/snaptest.mjs       # the 100 acceptance tests against a COPY of the tree
npx playwright test           # the same, against the live tree
node tools/soak.mjs 500 40    # 500 campaign days, 40 deployments, unattended
node tools/mapsoak.mjs 240    # 240 days played through WorldMap.update()
node tools/shots.mjs          # photograph 20 screens into qa-shots/
```

**Use `snaptest` unless you have a reason not to.** The suite serves `src/` off
disk, so editing anything during a run invalidates it — which meant either
downing tools for ten minutes at a time or quietly throwing a run away, and both
happened. `tools/snaptest.mjs` copies the tree (3.8MB; `node_modules` is
junctioned) into a temp directory and runs there on its own port, so the live
tree stays editable. It takes arguments through to Playwright:
`node tools/snaptest.mjs -g "cover"`.

While you are in there: `webServer.command` in the Playwright config used to be
the literal `node tools/serve.mjs`. Node is a portable install here and is not
on PATH, so that could never spawn — every run for months only worked because a
dev server was already listening on 8124 and `reuseExistingServer` skipped it.
It uses `process.execPath` now, but it is the kind of thing to check if a clean
checkout will not start.

### Working on this repo

**Commit straight to `main`.** There is one developer, the history is linear,
and there is no `gh` CLI on this machine to open a pull request with — a feature
branch here does not get reviewed, it just gets stranded until somebody merges
it by hand. One commit per round of work, with the reasoning in the message.
Push when asked; the credential is stored, so it does not prompt.

**Set a git identity before the first commit.** There was no global one, so a
fresh clone fails with "Author identity unknown" even though every commit in the
history is the same person. It is now set globally to
`DudkneeAxiom <cptwhiterain@gmail.com>`; if you meet that error again, that is
what it wants.

### Environment quirks on this machine

- **Node is portable and not on PATH**: `%LOCALAPPDATA%\Programs\nodejs\node.exe`.
- **The shell's working directory resets to `C:\Users\xxwjs\Steamward`** between
  commands. Steamward is a *different, unrelated project* and must not be
  touched. Always `cd /c/Users/xxwjs/SciFiLords` in the same command, or use
  absolute paths. This has silently run tests against the wrong repo before.
- No `gh`, no Python. Blender 5.2 is at
  `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` and is only
  needed to change the art.

---

## The one thing that will bite you

**Do not edit source while a test run is in flight.** The suite serves files
from disk, so a mid-run edit invalidates the whole run. Several runs were
thrown away this way before the habit stuck.

---

## Writing tests here

Two rules, both learned the hard way, both currently costing a comment in
several tests:

1. **A mission's ground *and* its people both come from the campaign seed.**
   `newCampaign()` picks that seed at random. A test that constructs a
   `Mission` and pins neither is rolling dice on the layout it fights over
   *and* on how fast anybody walks across it. Pinning one is not pinning the
   scenario — build the campaign with `State.newCampaign(12345)` and assign it
   to `window.KR.campaign`. Four tests were written with this flaw in one
   sitting; each failed roughly one full run in five.

2. **Wait on state, never on the clock.** `waitForTimeout` passes alone and
   fails in a full run. Use `waitForFunction` / `waitForSelector` against the
   thing you actually mean.

## Writing probes here

`tools/*.mjs` measure behaviour rather than assert it. Three traps, all of
which produced confidently wrong readings:

- **The player's rounds leave the camera, not the body** — so the crosshair is
  truthful. A probe that calls `fire()` with hand-computed coordinates is
  measuring a gun the game does not have. Drive `m.mouse.down` and let
  `updatePlayer` pick the aim point.
- **`updateCamera` runs in `loop()`, not `step()`.** Headless stepping never
  moves the camera, so anything camera-derived is stale. Call
  `m.updateCamera(dt)` alongside `m.step(dt)`.
- **Summary statistics hide shape.** A broker price that climbed in a perfectly
  straight line had a healthy standard deviation. Print the sequence.

- **Navigate by the marker the game is actually showing.** `tools/soak.mjs`
  walked to `level.objectivePoint` and held E. A heavy open-field contract opens
  a second and third task elsewhere on the site, and `advanceStage()` moves the
  HUD marker while deliberately leaving `objectivePoint` alone — so the soak
  stood in an empty field waiting for an objective that had moved, and reported
  five deployments as `STALLED`. The tell was that the same mission types passed
  at strength 18 and stalled at 42 and 66, which is exactly where stages open.
  Not a softlock; a probe reading a pointer the game had stopped using.
- **A campaign left running drifts underneath you.** `advanceTime()` is a whole
  world: unfed companies desert, `maintainParties()` culls whatever is furthest
  from the player and spawns replacements, wandering bands open encounters that
  pause the map. Any probe that advances days and then measures something has to
  hold the rest still — feed and pay the company, pin the party list, keep the
  player somewhere sensible — or it measures the drift. This has produced at
  least three wrong diagnoses: a well-guarded company "losing" prisoners because
  desertion had shrunk the roster, stragglers "vanishing" because the player was
  parked 900k units away so culling was arbitrary, and mustering "not working"
  because two of three musterers had been culled.
- **Probe a field that something actually writes.** `tools/aiaudit.mjs` judged
  "had a clear shot and did not take it" by watching `e.shotsFired`, and
  nothing in `src/` had ever written that field — only the mission-wide
  `stats.shotsFired`, and only for the player. The check compared `0 > 0` every
  frame, so every soldier with line of sight scored as idle and the probe
  reported a pathology that did not exist. `fire()` now maintains it.
- **Exclude what the design does on purpose.** The same metric counted
  `burstRest` — the deliberate 1.0-2.6s pause between bursts — as a refusal to
  shoot. Fixing only that dropped the reported figure from 60-95% to 0-27%.

And the meta-lesson: a metric that cannot fail is not evidence. Two collision
audits passed while the bug was live — the first compared footprint *area* and
never height, so a box the right width and four times too tall sailed through.
Its mirror image is a metric that cannot *pass*, which is what the shot counter
above was; both look like data and neither is.

**Renderers are not free, and dispose() does not release them.** Every
deployment builds a `WebGLRenderer` and every return to the Reach builds
another. `renderer.dispose()` frees what three.js allocated but leaves the
WebGL context to the browser, which keeps about sixteen and then starts killing
the oldest live one. That is a black map with the DOM party labels still drawn
over it and the campaign running normally underneath — and it takes several
engagements to show up, which is what makes it look like a rendering glitch
rather than a leak. Use `Models.releaseRenderer()`, which calls
`forceContextLoss()`. `tools/roundtrip.mjs` fails on the browser's
"Too many active WebGL contexts" warning, which appears *before* anything goes
black.

---

## Constraints that look like laziness and are not

**The ground is no longer flat, and the thing that kept it flat is worth
understanding before you touch obstacles.** An obstacle used to be an
axis-aligned box anchored to a *single* ground sample, so a rampart across a
slope had daylight under its downhill end and rounds went beneath the wall.
Sinking the boxes to close that gap changed what an obstacle's *height* meant,
and height was what classified a box as shoot-over cover, so the cover list
emptied instead.

`seatObstacle()` in `src/level.js` breaks the deadlock by separating the two
meanings that one `h` was carrying:

- **`h`** is the physical box, bottom to top. It now reaches down to the
  *lowest* ground under its own footprint, which seals the gap. Collision and
  both ray systems use it.
- **`coverH`** is what the thing stands proud of the *highest* ground under it
  — the worst case for whoever is sheltering behind it. Every gameplay
  judgement reads this: shoot-over cover, nav blocking, wall avoidance.

On flat ground the two are identical, so the change is invisible where there is
no slope. **If you add a test or probe that asks how tall something is, ask for
`coverH`.** `tools/cover.mjs` selected on `h` and started failing the moment
the ground tilted, because a sealed box on a slope is legitimately taller than
the object looks.

Relief is ~10.7m peak to trough at 17° maximum slope, tuned against occlusion
rather than looks: 0% of sightlines are broken by ground at 20m, 24% at 40m and
44% at 70m. Close fights are never decided by terrain; long approaches are.

**Both ray systems have to agree.** `rayHit()` in `src/mission.js` is a true 3D
test and has always walked the terrain; `Level.raycast()` is 2D with a height
heuristic and did neither an underside test nor a terrain test. While the pan
was flat that cost nothing. With relief it means the AI holds a target through
a ridge and empties a magazine into the near slope. Any divergence between what
the AI believes it can see and where its bullets actually go reads to the
player as the game cheating.

### Three things flat ground was hiding

All three were live before this round and all three were invisible at y=0. If
you change the terrain again, these are the shapes to look for.

1. **An eye height is not a world height.** `raycast()` compared its `height`
   argument against `o.y + o.h`, an absolute y, and every caller passed 1.45 or
   1.5 meaning *height above the ground*. Identical while the ground sat at
   zero. With relief, a barricade on ground at -3m has its top at -1.5m, which
   is "below eye level", so the engine decided every shot passed over it —
   cover on low ground stopped blocking anything, `findCover()` returned null,
   and the squad walked to a wall and stood beside it in the open. `hasLOS()`
   now builds an absolute sightline from both endpoints and `raycast()`
   interpolates it at the crossing point.
2. **The cover list ignores `scale`.** `prop()` classifies on the *authored*
   height, so a rock authored at 1.5m and placed at scale 2.4 stands 3.6m and
   still counts as shoot-over cover. This looks like an obvious bug and is
   load-bearing: `findCover()` only accepts a position that breaks a standing
   sightline, so those scaled-up entries are the only things tall enough to
   shield anyone. "Fixing" it drops the list from 89 covers to 61 and breaks
   the squad-cover test. Fix it deliberately, with the cover probe open, not as
   a side effect of something else.
3. **An alarm without a clock is not an alarm.** Setting `state = 'hunt'` does
   not survive one frame: the hunt branch walks toward `lastSeen`, and with
   none it checks `huntUntil`, which reads 0 and stands the unit straight back
   down. Three call sites raised the alarm without either field. It never
   showed because a garrison could see clear across a flat site, so `acquire()`
   promoted them to 'engage' first. The moment ground could interrupt a
   sightline, robbing a store in a raid turned the whole street out and every
   one of them forgot within a frame. Use `sendHunting()`.

**A garrison is a posting on the soldier, not a list on the holding.**
`s.garrison` holds a location id and `ready()` excludes anyone carrying one, so
a garrisoned soldier cannot also be on the truck and cannot desync — dying or
being dismissed takes the posting with them. `loseHolding()` clears the postings
of everyone stationed there, or you would keep people pointed at ground you no
longer own. `garrisonStrength()` is deliberately the same shape as the company's
own power in `estimateFight()`, so a garrison and a raiding party can be
compared without a second balance model that would drift away from the first.

**Draw calls are the render budget, not triangles.** A dressed site was
spending over a thousand of them on scenery, because every prop was placed as a
clone and a clone of a kit model is several meshes with several materials.
`Models.mergeProps()` bakes all instances of a model into one geometry with the
transform applied — 1244 draw calls down to ~500 at forty combatants, with the
triangle count slightly UP. Anything needing to move, hide or be picked
individually must not go through it; it has no identity afterwards. Note that
`tools/sites.mjs` used to count `group.children` as its measure of dressing,
which reported "2" for a fully dressed site the moment this landed — it counts
geometry now.

**The world clock runs on time, not on distance.** `advanceTime()` used to be
fed `moved / TRAVEL_SPEED`, so the Reach ran at full speed while the company
travelled and at about three per cent of it while it stood still. Standing still
was a way of stopping the world — nothing closed on you, nothing arrived, and a
band you had provoked froze the moment you let go of the key. It also meant a
laden company made the whole world slower, since time was distance over a
constant. `HOURS_PER_SECOND` now drives the clock and speed decides how much
ground an hour buys; `dt` arrives pre-multiplied by `timeScale`, so halt and
fast-forward come free. This deliberately reverses an older rule that standing
still should never burn a contract deadline: it now does, and halt is a keypress.

**A settlement is a haven, in both directions.** Bands break off pursuit near a
location (`PURSUIT_SANCTUARY`), *and* hostile encounters do not fire while the
company is inside one. Both are needed and the second is easy to miss:
`pickPartyTarget()` sends patrols TO locations, so without it a raider wandering
into town picks a fight with you on the steps of it — which was survivable when
the world barely moved while you stood still, and is constant now that it does.

**Faction columns belong to people, and the people outlive the columns.**
Anything of tier 3 or better that is not a raider gets a lord from `S.lords`.
Beat one and `unhorseLord()` either takes them prisoner or lets them get away;
either way they come back, carrying a record of what has passed between you,
which is what the encounter panel shows. Three things are easy to break here
and `tools/lords.mjs` checks all of them: the roll must be REUSED rather than
minted fresh as parties churn (or it grows without bound over a long war),
nobody may lead two columns at once, and captivity has to end — a lord held
indefinitely is a lord quietly removed from the game. Raiders are deliberately
anonymous: a looter band is weather, and naming one would make every scrap on
the road feel like a duel with a rival.

**The rim is a band with an angular profile, not a circle — and the fence is
the geography.** The old rim was a radial power curve: concentric (so the
region read as a round board with a raised edge from any height), rising
forever (no "over the crest", the world visibly ended), and it BURIED half
the outer provinces — a dozen settlements sit at 0.56..0.84 of the region
radius. `rimAndBeyond()` in region.js varies the rim's start, height and
thickness by bearing, CARVES it (roads cut passes, every outer settlement
sits in a cleared basin — both computed, so moving a town or a road moves
its pass), and falls away into outer steppe that runs to the mesh edge.
`clampToRegion()` follows the same angular profile and replaces the old
rectangular clamp, whose corners reached 1.37R — inside the mountains. The
world-map camera FLATTENS as it zooms out (horizon and terrain layers enter
the frame) and the zoom cap is 1.9, deliberately short of framing the whole
region: a world you can see all of at once is a board game. Backdrop
silhouettes (buildBackdrop — the twin dishes north, the cooling stack
southeast, the antenna field west, the hulk east) are landmarks and compass
both; none are reachable, none have collision. If you retune the rim,
re-run tools/terrainpace.mjs — the interior octaves are untouched, which is
why NORM survived this round.

**The ground lives in `src/region.js`, and both layers read it.** `regionHeight`
used to be defined in `worldmap.js`, which imports `state.js` — so the
simulation could not see the terrain its parties were walking across without an
import cycle, and movement ignored the landscape entirely. `region.js` is pure
geometry with no Three.js and no DOM, so it can be driven headlessly.

`travelFactor(x, z)` is what crossing the ground costs: slope slows you, roads
speed you up, everyone is subject to it. **It is normalised so ordinary ground
comes out at 1.** Without the `NORM` constant it averaged 0.65, which is not a
terrain rule at all — it is a thirty-five per cent tax on every journey in the
game, silently re-pricing every contract deadline and wage day that was balanced
without it. If you retune the terrain octaves, re-measure the mean with
`tools/terrainpace.mjs` and move `NORM` with it, or the whole campaign quietly
changes pace.

**`S.atLocation` belongs to the renderer. Never simulate off it.** `worldmap.js`
is the only thing that writes it, so it is correct while the map is on screen
and stuck on wherever the campaign started in every headless run. It has now
caused three separate bugs: pursuit that never triggered, wound healing that
used the starting settlement's facilities for the whole campaign, and hiring
that drew manpower from the wrong town. Derive from position with
`locationAt(S, 38)`; fall back to the field only for callers that place the
company by setting it rather than by moving it.

**Everyone draws on the same manpower.** A settlement has a pool that refills
daily toward a cap by kind. You spend it hiring, faction columns spend it
mustering (three times as fast at war), and raider bands camped nearby take
people off it and stop it recruiting for `RAID_SHOCK` days. Two properties are
load-bearing and easy to break: peacetime recruiting must be untouched — a quiet
region refills faster than anyone drains it, so war is the only thing that makes
bodies scarce — and a garrison must stop raids outright, because that is the
first thing in the game that makes defending a town worth doing. An unchecked
hideout takes a full settlement from 14 down to 3 in a month.

**Creeds are derived from `portraitSeed`, not rolled.** Taking another number
off the seeded generator in `makeSoldier` would shift every roll after it and
change every seeded campaign in the game.

**Diplomacy has its own RNG stream.** Day-tick additions used to perturb it.

---

## Where the work stopped

Open, in rough priority order:

0. ~~**The soak does not go through the map loop.**~~ Done: `tools/mapsoak.mjs`
   plays a few hundred days through `WorldMap.update()` — real encounter panels
   answered by clicking their buttons, real settlement visits through the
   E-key path, click-to-chase against live quarry, withdrawal preferred
   whenever it is offered. The trick that makes it fast: `setSpeed(0)` halts
   the map's own clock (a legitimate game state the resume guard leaves alone,
   unlike `paused`) and the soak calls `update(0.2)` by hand — the exact tick
   the real loop produces under fast-forward — so nothing double-ticks and the
   rAF loop keeps rendering and running the camera underneath. It found three
   holes on its first runs, all in the panel wiring rather than the map
   itself: `afterAction` threw mid-template on every SEND THEM IN (autoresolve
   results carry no `stats`/`recruits`, and the player lost the entire report);
   Escape dismissed a hostile encounter (no roll, no toll, no fight); and
   ENGAGE-then-cancel exited a cornered encounter for free. All three are
   fixed, the soak now rattles both closed doors on purpose every run, and the
   acceptance test "a cornered encounter cannot be escaped, cancelled, or
   clicked away" pins the whole chain. One reading to keep an eye on rather
   than a bug: hostile pursuit was live ~17-19% of ticks in short runs — the
   map is lively, not a permanent chase, but the soak fails above 60% and that
   threshold is a guess.

1. ~~**Combat lethality is untuned and deliberately so.**~~ Done — but the fix
   was mostly to the measurement, and the story matters if you ever touch
   either again. `tools/balance.mjs` was random twice over: it booted one
   random campaign per run (the seed decides the roster's rolled stats and
   every trial layout), and the mission's own rAF loop ran a wall-clock number
   of live frames before each measurement began. Three 60-trial runs with no
   code change between them gave close-range medians of 7.4s, 11.7s and 15.2s
   — every prior number from this probe, including the table under item 2, is
   a draw from that lottery, not a measurement. The probe now cycles twelve
   fixed seeds, freezes the mission before measuring, and raises the garrison
   at the player (the sendHunting shape) so it measures the shooter rather
   than the awareness roll; two consecutive runs now agree bit for bit.

   Measured that way, the curve was flat: 12m gave the ~12s of life the code
   comment promised at rifle range, because the aim-scatter model's flat 0.9
   term propped up the bottom of the curve. The flat term is gone and the
   range slope is 0.20 (`aiShoot`, src/mission.js): at 360 trials, 12m is
   80% down with a 4.3s median, 22m is 28% down at 13.1s, 34m is 39% at
   12.3s. Close range kills before you can argue with it; the documented
   twelve seconds now lives at rifle range, which is where "long enough to
   read the fight and break contact" was always meant to apply. One honest
   caveat: 34m measures slightly deadlier than 22m — that is terrain, not the
   model; 34m off an objective is open perimeter while 22m sits inside the
   obstacle field.
2. ~~**Enemies are fully accurate the instant they acquire a target.**~~ Done.
   `aiShoot()` widens the first rounds of an engagement by `RANGE_IN_WIDE` and
   converges over `RANGE_IN` seconds of holding the same target; losing sight
   decays it at half rate, so bounding between cover is the counter-play. It
   applies to both sides, because a shared code path is simpler and an accuracy
   rule that favours whoever the player is not is precisely what reads as
   cheating.

   **`RANGE_IN_WIDE` is now measured rather than argued.** It was set to 2.5 on
   principle because twelve-trial medians came out *non-monotonic* across
   values — 2.0 gave 7.4s, 2.5 gave 3.3s, 3.0 gave 22.55s — which is noise, not
   a curve. (A table of sixty-trial medians used to sit here as proof the
   probe finally passed. It was recorded before the probe was seeded and
   deterministic, so it was one draw from the seed lottery — see item 1 for
   what replaced it. The ranging-in mechanism itself is real and stays.)
3. ~~**Mission stages are a scaffold, not a design system.**~~ Done: the stage
   suits the contract. A heavy sabotage's first stage is a second charge
   (`plant` — snapped to the nearest solid obstacle so the wire goes on a
   structure, and each charge now gets its own explosion; `blown` used to
   latch after the first); a heavy recovery's is another held person at the
   far end (`free` — spawned with guards when the stage opens, pushed into
   `this.prisoners` so the extraction rule and the loss accounting cover them
   like everyone else). Skirmish keeps sweep/hold.

   The bug found on the way in matters more than the feature: heavy
   recoveries had never actually run their stages. `updateRecovery()` runs
   every frame and re-completed the objective whenever "everyone is freed"
   held — which, once a stage borrowed `this.objective`, was every frame, so
   the whole chain fell through in two frames and armed extraction from the
   pen. It now touches the objective only while `objective.type` is
   'recovery' (death toasts and the nobody-left path stay live throughout).
   If you add a stage kind whose completion an always-running per-type
   updater might re-trigger, this is the shape to check for. The acceptance
   test "the stage suits the contract" holds the regression.
4. ~~**The palette runs muddy at distance.**~~ Done, by the world map's own
   playbook. The mud had two causes. The mission floor height-lerped two
   shades of ONE hue, so the whole ground was a single colour at two
   brightnesses — every palette now names an `acc` (the site's second
   material: sage on the Array, rust on the Reclaimer, worn green verges in
   the Town) and `buildGround()` lays it in as soft patches tens of metres
   wide, with steep ground going bare rock. And every fog was authored in the
   same brown-grey family as its ground, so ground, props and haze met at one
   colour at range — the fog now keeps its authored LIGHTNESS (lighter than
   the objects in it, which is the silhouette look) but takes its HUE from
   the site's sky, so distance cools away from the warm ground instead of
   converging on it. If you retune either, shoot all eight sites, not one:
   the accents are authored per palette and a change that flatters the
   Reclaimer can mud the Town.

   Found while shooting: `tools/shots.mjs`'s site-from-above frame had been
   silently photographing the chase camera — the mission loop re-renders
   every frame, overwriting any staged camera before the screenshot. If you
   stage a camera for a screenshot, `cancelAnimationFrame(m.raf)` first.
5. ~~**Flat sites**~~ — done, see the constraint above.
6. ~~**Characters do not follow the slope they stand on.**~~ Done.
   `syncVisuals()` samples the gradient across a stance width, projects it into
   the character's own frame and passes `slopePitch`/`slopeRoll` down; the
   character group carries them on `rotation.x/z`. Guarded on `e.elev`, so
   somebody on a catwalk stays level however the ground beneath it runs.

   The part worth knowing: the group's rotation order is now **`YXZ`**, not the
   default `XYZ`. Yaw has to be applied before pitch and roll or the lean lands
   on world axes instead of the body's own — a soldier facing east on ground
   that falls away north tips sideways rather than leaning back, which is right
   in magnitude and attached to the wrong axis, and looks perfectly fine
   head-on. `tools/stance.mjs` measures each foot's distance from the ground
   under it at four facings for exactly that reason. On the steepest ground on
   a site it takes the feet from 0.08m out of level to 0.001m.
7. **Pursuit is tuned, and now watched.** `partyIntent()` in `src/state.js`
   gives hostile bands per-tier boldness and a pursuit speed of 86, which sits
   inside the company's own 55-165 range so a lean company outruns them and a
   laden one does not. The thresholds were set against measured odds — a
   four-person company rates 0.64 against five looters — and a 240-day
   campaign through the map loop has now exercised them: hostile pursuit was
   live 26% of ticks, 313 withdrawals split 182 escapes to 131 run-downs, and
   the map never became a permanent chase. `tools/mapsoak.mjs` fails outright
   if pursuit runs above 60% of ticks, so the watch is standing rather than a
   note in this file.

   Two things it must keep doing, both learned by breaking them:

   - **Settlements are havens.** Bands do not press an attack within
     `PURSUIT_SANCTUARY` of a location. Without it a band that followed the
     company into town waits at the gate, and closing the settlement panel drops
     the player into an encounter on the doorstep with the map still paused
     behind it — which is a failing acceptance test and a miserable thing to
     play.
   - **The rule reads position, never `S.atLocation`.** That field is owned by
     the world map renderer and by nothing else. It is initialised to `'vetch'`
     and only updated while the map is on screen, so any simulation that trusts
     it is correct in play and wrong in every headless run — here it silently
     meant "no band ever chases anybody". If the strategic layer needs to know
     where the company is, derive it with `locationAt()`.

   And a probe lesson worth keeping: distance to the company does not measure
   pursuit. Patrol routes lead to locations, so a band strolling into town
   closes on a player standing there while hunting nothing. Assert on
   `p.chasing`, which is the intent itself.
8. No audio mixing, no key rebinding.
9. **The town walk is a v1.** Settlements can be visited on foot (the `visit`
   mission type: settlement menu → "Walk the streets" — the real site, no
   garrison, townsfolk standing about, the south checkpoint to leave). Every
   area is a PERSON: a named NPC stands at the market, the board, the hiring
   row, the infirmary and the notable's door, the interactable anchors to the
   entity (the cut-restraints mechanism), and the prompt is "speak with the
   trader", not a marker floating over dirt. The gate is a person too. While
   visiting — menu or walk — the company token leaves the world map
   (`setInside`), and the menu's WAIT verb passes six hours a click with the
   clock in the panel tag, so being in town is being somewhere.

   The settlement is now a real town with its own asset kit, authored in
   tools/blender/build.py to the scale of the person walking past: town_house
   (one storey, a 2.05m door, windows at eye height), town_house_2 (two true
   2.7m storeys with a balcony), town_hall (the civic front on the square),
   market_stall (counter-height collision, canvas overhead), town_wall (3.2m
   coursed masonry — the rampart stays the siege piece), gate_tower (which
   two layouts referenced and nobody had ever authored: Models.get returned
   an empty group, so the fort had been flanking its gate with INVISIBLE
   colliders), and town_arch (scenery only, no box — the opening is the
   point). The wall is a FULL 84x64 circuit with a gate_tower at each of the
   four corners and one south arch; inside, the buildings sit in staggered
   QUARTERS with air between them — west housing, east trade yard, the
   station north, stalls around an off-centre well with the hall at the
   square's head — rather than parallel rows, which read as a barracks
   however good the models were. The ground inside is a graded pad
   (`FLATTENS` in level.js build() — set before the layout runs, because
   props seat against heightAt() as they are placed), and the whole interior
   plus the road out to the spawn is `b.protect()`ed so the random dressing
   passes land outside the walls.

   Rules its geometry taught. The arch is an OPEN gap — a door would need
   the siege's breach mechanic in every raid, defense and visit; do not
   "finish" it by adding one. The road through the arch is `b.protect()`ed
   ground: the random dressing passes only avoid EXISTING obstacles, so an
   empty road stays open by luck until it is reserved — the arch was open or
   blocked depending on the campaign seed until that call existed. Raid
   stores safeSpawn-snap for the same density reason. And if you add kit
   models, they must be named in THREE places or they fail quietly:
   tools/blender/build.py (the mesh), src/models.js MODELS (the preload),
   and BOX in src/level.js (the collision the audit test checks against the
   mesh).

   Limits worth knowing before extending it. Only `settlement`-layout towns
   offer the walk — a layout opts in by declaring `areas` and a `gate` in its
   builder meta, and `build()`'s return is a WHITELIST, so a new meta field
   must also be added there or it silently never arrives (that is how
   garrisons were lost once). NPCs and townsfolk are static: they stand where
   placed, and nothing happens if you shoot one — the town does not react,
   which is the first thing to fix if the walk grows teeth. And a walk
   deliberately books no deployment: `endMission` in main.js returns straight
   to the map for `visit` specs, skipping applyMissionResult — anything added
   to the walk that SHOULD reach the campaign has to go through its own door,
   not that one.

**The combat feel pass** (this session). The complaint was "point and click,
   and my troops line-of-sight wipe the enemy." What shipped, and the traps
   each piece carries:

   - *Squads pin, the player breaks.* In `applyDamage`, friendly-AI fire
     against an enemy who is DUG IN — within 1.4 of their `coverPos` —
     trades at 0.6 damage (suppression untouched); enemies caught moving in
     the open take full damage. The conditional is the load-bearing part:
     a flat AI-on-AI cut (0.55, then 0.7) failed `tools/balance.mjs` BOTH
     times at ~45% far-range downs, because it also cut the attrition on
     hostiles closing across open ground, so more of them arrived at knife
     range alive — and the failure barely moved between 0.55 and 0.7, which
     was the tell that magnitude was not the lever. Enemy fire into the
     player's squad still trades flat at 0.7. Probe after the change:
     12m median 4s at 77% down, 34m at 40% down — exactly ON the ≤40%
     criterion, so any further lethality tweak should re-run the probe
     first, not after.
   - *Gun weight*: player recoil in `fire()` (camPitch kick + yaw jitter +
     shake) and a hit-confirm (`hitAt` drives a 0.16s amber reticle flash +
     a centred flesh impact tick). Cosmetic-only — neither touches the
     damage model.
   - *CHARGE on the command wheel* ('R'): every squaddie hunts the nearest
     living enemy via `forceTarget`, runs at 1.3× firing on the move, no
     cover discipline, reverts to `follow` when nothing is left. The wheel
     test maps index→id generically, so a new order needs no test surgery.
   - *The page after the fight*: `applyMissionResult` now itemises the strip
     onto the result (`res.fieldSpoils`, `res.captives` — ids of prisoners
     it already pushed), and `UI.spoilsPanel` (chained after `afterAction`
     in BOTH main.js call sites — played missions and SEND THEM IN) shows
     the haul and offers per-captive PRESS/RELEASE using the verbs that
     already existed. The spoils branch is gated on `res.partyId`, not
     `res.party` — a fixture with only `party` silently skips it, which is
     exactly how the first version of its acceptance test failed.

**Companions are officers** (this session). The Mount & Blade party-role
   layer: each hired companion changes how the COMPANY runs, not just how a
   fireteam shoots. `OFFICERS` in data.js is the catalogue; `hasOfficer(S,
   id)` in state.js is the single gate every effect reads (compId match with
   a name fallback for pre-compId saves). Vex adds a named +0.08 factor in
   `partySpeed`; Senna halves the carried-wounded drag AND adds +0.5 healMul
   in the onNewDay `dayTick` call; Brik adds one piece to the field strip;
   Perrin widens `intelRange()` 80→220, which is what the CONTACTS card's
   exact-count gate now reads; Jorsa (+0.05 squad acc) and Okkam (×1.35
   squad suppression power) resolve once per deployment into
   `mission.officerFx`, like perks. Traps: a wounded soldier above 55% HP
   still `deployable()`s, so the wounded-drag factor only counts genuinely
   carried people — the first version of the acceptance test wounded someone
   at full HP and measured nothing. And mission.js now imports from
   state.js (no cycle — state never imports mission), which is new; if a
   future refactor makes state.js import mission.js, break the officer
   lookup out instead.

**Sieges you answer in person** (this session). A summons contract was
   playable but hollow: the player deployed ALONE (no column on the field),
   and a won assault did not move the border — only the column's own arrival
   flipped `S.mapOwner`, so the player could take a town days before the map
   admitted it, after which the column marched into its own conquest.
   Now `specFor` attaches the LIVE column as `allies`/`allyFaction` (a column
   broken on the road leaves the assault yours alone — dawdling has a cost),
   `buildSiege` calls the extracted `spawnAllies()` (same militia contract as
   skirmish joins), and `applyMissionResult` captures `{column, employer}`
   from the summons contract BEFORE the payment block consumes it, then on a
   won siege flips ownership, retires the column party into the garrison,
   and adds +3 rep on top of the ordinary +2 contract completion. The trap:
   `activeContract(S)` is just "the accepted contract", so the summons data
   must be read before `S.contracts` is filtered, and `closeSummons` fires
   harmlessly afterwards (contract already gone → early return).

**Stakes in the Pit** (this session). Tournament betting, M&B style. The
   door modal in `startPit` (main.js) offers 200/500/1000 stakes filtered by
   the ledger; the stake is deducted AT THE DOOR, carried on the result as
   `spec.wager` → `res.wager`, and settled in the pit branch of
   `applyMissionResult`: three-to-one, and only for `res.success` — which
   for a pit means the whole card cleared, because `extractArmed` stays
   false until `completeObjective()`, so walking out early cannot cash the
   bet. Going down keeps nothing and deducts nothing further (the money
   already left). The by-the-round purse is untouched — it is the
   consolation; the wager is the tournament bet.

**Army-scale battles** (this session). The player asked for "1000 v 1000".
   What shipped is the Mount & Blade answer: armies of hundreds whose FIELD
   presence is a front rank streamed through the cap, under a scoreboard
   that counts the whole host. The pieces: `tryCapture` scales siege
   columns ×3.2–4.6 into hosts (100–270); `specFor` gives a summoned siege
   `allies: col.strength` and `enemyArmy: 0.85×` that; `buildSiege` seeds
   `skirmishTotal` from `enemyArmy` (front rank = the wall garrison);
   `updateSkirmishWaves` now serves sieges too but musters defender waves
   INSIDE the walls via `reinforce()` (the arc spawner would put a
   garrison's reserve on the attacker's approach); `spawnAllies` commits 12
   and `updateAlliedWaves` feeds ranks of 6 whenever living militia < 7;
   `updateSiege` counts uncommitted reserves in its "anybody left" check or
   an army siege would declare victory when the first rank fell. The HUD
   `armies` ticker (obj-sub line) appears only when either host ≥ 20.
   Do NOT raise the 34 FIELD_CAP for this — ~50 combatants on field is the
   perf envelope; scale lives in the totals, not the cap.

**The tactical camera** (this session). T toggles a top-down command view:
   WASD/edge pan (edge-pan gated on `rtsCursorLive` — the stale (0,0)
   cursor default read as "parked in the corner" and drove the camera off
   the battle in headless runs), wheel zoom 22–78, drag box or click to
   select — the COMMANDER is selectable and commandable like any squaddie —
   right-click issues the same `issueContextOrder` the wheel uses (enemy
   near the click → focus fire, else move), and `playerAuto` walks the
   commander's body to ordered points; touching WASD in shoulder view
   cancels it. Traps: the mode runs UNLOCKED, so both the pointerlockchange
   auto-pause and `togglePause`'s resume re-lock are gated on `!this.rts`;
   `worldToScreen`/`screenToGround` must `camera.updateMatrixWorld()` first
   (a posed-but-unrendered camera projects a frame stale — the acceptance
   test caught it); the pit refuses the mode (no squad, and the crowd does
   not take orders); the reticle hides via `hud.tactical`. The commander's
   auto-walk goes through `moveToward()` — the squad's NavGrid A*, corner
   waypoints, local avoidance — not a straight line; `p.path`/`p.pathGoal`
   are cleared on arrival AND on manual-WASD cancel, or the next order
   reuses a stale route. `lastX` is snapshotted for every entity before
   updatePlayer, so `faceMotion` works for the player too.

**RTS-first: the standing direction.** The player has said combat is
   moving to the tactical view as its PRIMARY mode — third person remains
   as the way you personally join the fight, but "RTS missions and map
   layout plus camera movements and controls are going to be massive."
   FRAMING GUARD, in the player's words: "this isnt an rts structed game
   or combat. Its RTS controls similar to mount and blade but with guns."
   No base building, no economy screens, no production queues, no
   strategy-game fog rules — the tactical layer is a way of COMMANDING a
   warband battle that still runs on bodies, morale, orders and the
   commander's own rifle. Reject features that drift toward StarCraft;
   accept features that drift toward Total War-style battle control or
   M&B's order screen.
   Phase 1 (shipped): route lines — `rtsSyncRoutes()` rebuilds one
   LineSegments per frame from each commanded unit's remaining
   path + goal + a vertical flag stroke, selected units only when a
   selection exists, torn down on mode exit — and control groups —
   Ctrl+digit binds selection BY ENTITY ID (`ctrlGroups`, ids not squad
   indices: the squad array grows as allied waves stream in), bare digit
   recalls in tactical mode only, dead members drop on recall, shoulder
   view keeps digits as individual toggles.
   Phase 2 (shipped): the camera has weight — Q/E rotate (held, per-frame;
   Q's shoulder-swap is gated `!rts`), wheel sets `rtsZoomT` and the zoom
   GLIDES, tilt rides on zoom (oblique close, top-down far), WASD/edge pan
   drives a velocity with ease-in and coast, Space snaps-to/follows the
   selection (gated `!rts` for cover/vault), B jumps to `lastCombat`
   (stamped in applyDamage). Phase 3 (shipped): THE APPROACHES (`field`
   layout) — clear reserved road, container-train lane walls with authored
   crossover gaps, garrison posts at three depths, industrial west lane,
   hab row east, compound north; army-sized map battles (≥24 combatants)
   route to it, and site `spread` now counts `allies`/`enemyArmy` so hosts
   get ground. Its `enemyFaction` fallback is REQUIRED in a site return —
   spawnEnemy derives soldier models from it and dies without one.
   Phase 4 (shipped): the field map — in tactical mode the radar becomes a
   north-up map of the whole ground, and CLICKING it jumps `rtsFocus`; the
   click mapping in `rtsMapClick` mirrors `drawFieldMap`'s (R-4)/bounds
   scale exactly, change one change both.
   Phase 5 (shipped): the perf pass, measured by `tools/perf.mjs` (now
   takes a scene arg: `perf.mjs 400 field` runs THE APPROACHES at 50v60
   from the tactical camera with routes rebuilding). Numbers on this
   machine, field scene: draw calls 946→874, sim step mean 1.34→0.85ms,
   worst spike 70→16ms. What changed: all faction rings are ONE
   InstancedMesh (fifty rings were fifty calls; `frustumCulled=false`
   because a stale whole-mesh bounds culls every instance); the
   animation/shadow LOD anchors to the tactical focus instead of the
   player's body (full-rate animation used to land wherever nobody was
   looking); route lines rebuild at 10Hz not 60 (the rebuild allocates a
   geometry — per-frame churn was the GC spikes). THE BUDGET: ~874 calls
   at 50 combatants is dominated by per-character joint meshes (~6 per
   body plus a weapon); raising the 34 FIELD_CAP further needs character
   instancing or joint-count reduction, a round of its own.

**THE BASTION** (this session). The army siege map, in THE APPROACHES'
   grammar: a laned approach half (reserved road, container-train lane
   walls with crossover gaps, four staging posts out of the wall's best
   arcs), a FULL-SPAN curtain whose segments reach ±198 — spread caps at
   1.75 so the largest possible bounds is ±196, and the fort's curtain was
   quietly flankable again the moment army sieges started sizing sites by
   the host; both curtains now out-reach the cap — one gate with towers
   and a wall walk (stairs inside only), and an inside authored as streets
   around an inner keep so the post-breach clearance reads from the
   tactical camera. Summoned sieges route here via specFor (`siege` +
   `summons` → layout 'bastion'); other contracts keep the location's own
   ground. The acceptance test runs it AT ARMY SCALE (allies 160,
   enemyArmy 150) deliberately — a small-spec test was how the fort's
   regression stayed invisible.

**Holding THE BASTION** (this session). The defense side of the summons:
   when a host marches on a town of the player's ALLEGIANCE, `tryCapture`
   posts a defense summons (`type:'defense', defend:true, summons,
   enemyFaction`). `specFor` routes it to the bastion with `defend:true`,
   `enemyArmy = col.strength`, `allies = 0.8×` (the town garrison).
   Mission side: `buildSiegeDefense` moves the command INSIDE (and moves
   `level.playerSpawn` with them — allied ranks arrive there), initialises
   `this.breached = false` (forgetting this cost one test run), finds the
   gate obstacle, rolls `gateBlowAt` 35–60s; `spawnAssaulter` enters from
   the south lanes hunting the wall, `updateSkirmishWaves` gained a
   `spec.defend` branch that feeds ranks from the south; `updateSiegeHold`
   blows the gate at the roll (physical half mirrors `blowGate()` without
   its attacker-framed narration), and the mission ends `held` only when
   EVERY rank is broken. The classic defense wave readout is gated
   `!spec.defend` or it shows "NEXT WAVE IN NaNs". On success the town
   stays the liege's, the column dies, +3 rep — same summons block in
   `applyMissionResult`, now typed on siege vs defense.

**Character instancing, and the cap raise it bought** (this session).
   Every soldier was ~6 merged joint meshes plus a weapon — per-soldier
   draw calls. Now `batchCharacter(e)` (spawnEntity, non-titan) hides every
   mesh in the char subtree and registers it in per-geometry-uuid
   InstancedMesh pools (`charPools`, capacity 160, `frustumCulled=false`);
   `updateCharBatch()` runs in the loop AFTER syncVisuals, calls
   `updateMatrixWorld(true)` per visible char subtree (matrices must be
   fresh or the render trails the animation by a frame) and copies each
   hidden mesh's matrixWorld into its pool slot. Joints still animate —
   three.js computes matrices for invisible nodes. Pool geometry/material
   are the SHARED cache (`userData.shared` protects them from
   disposeScene); the pools' own instance buffers are disposed in
   Mission.dispose. Measured: field scene 874 → 79 calls at 50 combatants;
   164 at 68. That bought FIELD_CAP 34→48 and allied front rank 12→16
   (waves 8, refill under 9). Traps: `hidePlayerModel` works because the
   batcher skips owners whose `char.group.visible === false`; the Titan is
   excluded (one body, own path); per-character shadow LOD no longer
   applies to bodies (pools cast as a whole).

**Battlefield polish, from playtest** (this session). Two reports, two
   fixes. "The walls for sieges aren't walkable for height": the rampart's
   collision box was the MERLON top (6.2), so a defender on the 4.1 walk
   had their eye at 5.65 — inside the wall as far as LOS was concerned,
   blind to their own siege. The box now stops at the CAP (5.3, in
   BOX.rampart with the why) and WALK rose to 4.9 in both fort and
   bastion: a standing eye clears the parapet, attackers below still
   stare at concrete, and stairsTo() just grows the flights. "The line of
   crates looks really bad": the container-train lane walls are replaced
   by `hesco_line` — a new authored kit piece (three earth-filled gabion
   baskets, jittered heights, steel posts, spilled fill; the three-place
   registration rule applied: build.py, MODELS, BOX) — in both THE
   APPROACHES and THE BASTION. Containers remain only as west-lane
   industrial dressing.

**Verticality** (this session, from playtest: "troops can't navigate up,
   the jump can't top stacked boxes"). Five mechanisms, found by tracing:
   jump vy 6.1→7.3 (apex v²/2g ≈ 1.2m clears a 0.94 crate); crates are
   `walk`-flagged in prop() (ONLY crates — a walkable hesco would make
   lane walls footpaths); NavGrid stops blocking `walk` obstacles (treads
   and decks are routes, vertical legality is resolveMove's job);
   moveToward passes feet into resolveMove AND runs a per-entity
   elevation stepper (step up 0.62, drop at 9m/s); hasLOS gained a second
   eye height and acquire/aiShoot pass `elev` on both ends, so the wall
   trades fire with the approach in both directions. Stair ROUTING:
   `steps()` records each flight (foot/head/top) into `level.stairs`
   (whitelisted in build()'s return!), and moveToward detours to the
   nearest matching flight when the goal stands >1.2 above the mover —
   with "already lifted = already climbing" targeting the HEAD, or the
   foot rule marches climbers back down. THE TRAPS this cost: the local
   avoidance probe must skip `walk` obstacles or it deflects climbers off
   the flight at its own foot; the bastion's walk/stairs must be on the
   DEFENDED face (the fort's sit on its approach side — copying it put
   the garrison's stairs outside their own wall); and test staging that
   holds W after a mount walks straight across and off the far side.

**Troop lineage** (this session). Mount & Blade's troop trees, this
   game's way: `s.lineage` (trust/syndic/raider) is whose army TRAINED a
   soldier. Pressed prisoners keep `captiveFaction` as lineage (that
   doctrine is most of why pressing is worth the morale hit); recruits at
   a faction-held town carry the holder's writ (`recruitPool`, keyed on
   `ownerOf`, majors only — free towns train nobody). Doctrine lands in
   `effective()` via `lineageMod` + the LINEAGES table in roster.js:
   Trust-drilled +.05 acc/+.18 cover, Syndic muster +6% speed/+.12
   aggression/−.05 cover, raider stock −.02 acc/+4% speed/+.15 closeDmg.
   On the field a lineaged soldier wears their trainer's kit (mission
   spawn model override — your amber ring is the side signal, the uniform
   is the training signal), and the roster card shows the lineage badge.

**Price rumours** (this session). The trading loop's missing half:
   `priceRumour(S, hereId)` scans the REAL per-town price tables for the
   best spread from here across market towns, speaks it when it clears
   1.35× ("Word is machine parts is fetching double… at Kestrel Yards"),
   returns null when nothing does — a trader with no news says none. It
   is deterministic per day because the tables are, so asking twice gets
   the same sentence and hauling goods where it points FINDS the promised
   price — the acceptance test checks the named pair's real ratio equals
   the spoken one to five decimals. Wired into the market trader's chat
   line in the town walk (main.js CHATS.market).

**Lord temperaments** (this session). How a lord fights their war, fixed
   at commissioning: `TEMPERS` in state.js — martial (odds ×0.7, host
   ×1.15), cautious (×1.45, ×0.85), rapacious (×0.9), honorable (×1.15).
   `odds` multiplies the winning chance a lord's party DEMANDS before
   committing — LOWER is bolder, the same direction as the grudge
   modifier, and getting that backwards makes cowards of the brave.
   Applied in `partyIntent` (now exported for tests), in `tryCapture`
   (the host a lord raises), and on the encounter panel (temperament line
   first — it is the standing fact, history after). `temperOf(l)` has a
   deterministic name-hash fallback so lords minted before temperaments
   keep ONE stable disposition. The acceptance test SEARCHES for an even
   fight before comparing intents — at a hardcoded strength the band's
   odds sat above both thresholds and both lords chased.

**The audit sweep** (this session). Ten systems from the M&B coverage
   audit (claude.ai artifact "Kettle Reach Systems Audit"), implemented in
   one run:
   1. LORD COURTS — `lordAt` seats an un-fielded holder-faction lord per
      town per day (companion-style rotation); the town walk gets an
      `npc_lord`; `giftLord` (+1 regard, once/day, 300cr) and
      `courtDefection` (ownFaction + regard ≥7 → vassal) in the chat.
   2. PRISON BREAKS — `captureCompany` keeps a companion (75%, captor
      needs towns) into `S.captives` + an unpaid rescue contract
      (`c.rescue`); the recovery plays on the bastion with the medic-slot
      prisoner NAMED; success returns them (summons-style pre-capture of
      the contract fields); 12 days → 600cr auto-ransom if affordable.
   3. THE CULVERT — second breach on the bastion (blast_door at (54,-10),
      rampart i==6 skipped, containers narrow it); `blowCulvert` mirrors
      blowGate's physical half; the grate-finder takes the NEAREST tall
      obstacle within 3 — a loose match blew up a narrowing container.
   4. ESCORTS — `maybeEscortContract` (one at a time, markets ≥250 apart);
      ACCEPTING spawns the convoy (`p.convoyTo`); moveParties marches it,
      `deliverConvoy` pays on arrival; a vanished convoy fails the
      contract in the day sweep with a relation hit.
   5. TAVERN — `mercBandAt`/`hireMercBand` (3 days, allies on every
      deployment via the startMission funnel, visit/pit excluded);
      `rollDice` at the pit door (46%, deterministic per attempt).
   6. CIRCUIT — `exhibitionBout` (odds from `S.pitFame`), `betExhibition`
      (one a night, underdogs 2.4×, winner's fame moves the next line),
      `pitChampion` named on the pit door.
   7. LEDGER — `recordPrices` on stall open (inventoryPanel), `ledgerBest`
      surfaces "seen N at TOWN, day D" on carried goods when >1.15×.
   8. WORKSHOPS — `buyWorkshop` 2400/sell 1600, income = town health
      (manpower × war × relations), paid in the day tick, logged weekly.
   9. WAR AS POLICY — `Dip.declareWarOn` (ownFaction only) beside the
      existing suePeace, both on the diplomacy panel.
   10. HAMLETS — five `kind:'hamlet'` feeders; `feedersOf`/`feederScale`
      slow a settlement's manpower recovery ×0.4/razed (floor 0.25);
      `tickTorching` lets raider bands raze them for a fortnight.

---

## The partials sweep (most recent work)

After the ten missing systems, the audit's PARTIAL column. Five of its
eleven were already closed by the audit sweep (siege breach → culvert,
settlement tiers → hamlets, diplomacy → declare war, lord defection →
courts, tavern life → mercs + dice). The remaining six, one commit each:

1. QUEST VARIETY (`e5ab91a`) — three new favour kinds on the existing
   machinery: `deliver` (accepted here, paid at the far end on arrival via
   `arrivalFavours` in the location-open hook), `debt` (the debtor's town
   grows a doorstep verb; `collectDebt` is deterministic per favour per
   day off renown+standing, `pressDebt` always lands and costs -8 there),
   `train` (`runDrill` once/day via a button on the favour panel; +3
   manpower on completion). Lords at court front favours 40% of the time
   at 1.5x pay and +2 regard. Trap: a deliver favour NEVER reads ready at
   its origin — it completes at the destination.
2. COMPANION WEB (`1aad50f`) — `RAPPORT` bond/clash pairs drift regard ±1
   daily (30%) through the same regard the resentment machinery watches;
   `ERRANDS` fire once-ever at regard ≥20 (word → settles on arrival,
   goods → settles anywhere once aboard, +25 regard). Roster card shows
   the web. Both tick on own rng streams.
3. FOOD VARIETY (`44ed7f0`) — `food: true` goods (dried_catch, vat_greens,
   still_spirits) in the trade map; each distinct kind aboard adds morale
   (cap +3), one unit eaten every other day, `S.plainDays` > 10 bleeds
   -1.5. All inside the payday fed-and-paid block.
4. ARMY COORDINATION (`75c637a`) — `marshalOf` picks a sticky writ-holder
   per faction (wins-defeats, martial +2); columns go to the marshal and
   carry their name. Launching calls ≤2 field warbands (`p.joinArmy`)
   that fold in on contact (<22 units). `col.army.cohesion` 100 decays
   7-13/day via `tickArmies`; dry = merged strength leaves, offensive
   dies. Factions with ≥4 settlements run two columns.
5. LAIR VARIETY (`922a586`) — `quarry` (THE CUT: stepped bench, stair
   flights, funnelled ramp) and `wreckyard` (THE BONEYARD: wreck-row
   lanes) join `compound`; picked per lair by hash of the party id in
   main.js so a den keeps its shape. Trap in tests: entities use `!e.dead`
   — there is no `.alive`.
6. CHARACTER CREATION — `BACKGROUNDS` (origin/trade/turn, first option of
   each group is neutral), `State.applyBackground` applies declarative
   `fx` bags; the commander's origin swap rides `originMod` so stats need
   no new plumbing. `UI.backgroundPanel` opens from `startNew`; **the
   test helper `newCampaign()` now closes TWO modals** (questionnaire,
   then intro) — any new test that hand-rolls the title flow must do the
   same.

---

## Feasts and the banner (after the partials sweep)

Two more from the audit's MISSING column:

- FEASTS — `tickFeasts` (own rng stream in onNewDay): a faction at peace
  rolls 5%/day to call a 3-day feast at one of its settlements
  (`S.feasts[faction] = {site, until, joined}`); war ends it the morning
  it starts. **During a feast, `lordAt` returns null everywhere except
  the feast site** — the lords are all in one hall, which is also what
  makes the site worth marching on. `feastLords` (first 3 of the court
  pool), `joinFeast` (gated: allegiance or rep ≥ 4; once per feast;
  +1 regard each lord present, +2 rep, +5 morale, +8 renown). Settlement
  verb `feast` → `UI.feastPanel`.
- BANNER — `Dip.BANNER_COLOURS` (six swatches), `Dip.restyleFaction`
  (rename/recolour a declared banner, free). The diplomacy panel's
  declare box grew a swatch row (DOM-state selection — `.sel` class read
  back on commit, no re-render, so the typed name survives), and a
  declared banner gets the same box with RESTYLE. `declareFaction`
  already took a colour; now something passes it.

---

## Disguise and infiltration (after feasts/banner)

The M&B disguise run. `hostileTown` (state.js): a settlement whose
holder `Dip.isHostileToPlayer` — standing-hostile OR at war with your
side — and that you do not hold, no longer opens its menu. enterLocation
shows `UI.gatePanel` instead: TURN AROUND, TAKE THE PLACE APART (raid —
without this the gate made raiding hostile towns unreachable), or GO IN
QUIET → `startDisguise`.

Under the coat: `settlementMenu` filters verbs to market/wait/walk (the
QUIET_VERBS list) and shows a LOW PROFILE tag with the current risk.
Every verb used rolls `disguiseAct` — deterministic per site+day+act
count, chance `disguiseRisk` = 4% + renown/3000 capped 35%. Made →
`UI.madePanel` (blocking): FIGHT CLEAR deploys a settlement-layout
skirmish against the owner's watch (12-strong warband party), HANDS OUT
runs `captureCompany(owner)`. Leaving the menu ends the disguise
(`endDisguise` in the `leave` closure), and getting made costs -6 town
relation.

Trap: the disguise state is `S.disguise = {site, day, acts}` — scoped to
one town; `disguisedAt(S, otherTown)` is false.

---

## THE COMBAT OVERHAUL (directive of day 2026-08-18 — supersedes gun combat)

The user has retired the shooter. Kettle Reach becomes: build an army on
the map, then personally lead it from inside formation battles — swords,
spears, bows and shields forged from salvage. Ancient-future warfare in
the same low-poly retro world. Full directive in the conversation; the
memory file `scifilords-combat-overhaul` has the priority order. Rules
that bind every phase: player is ONE grounded soldier (not a floating
RTS camera, not a superhero); formations must actually hold spacing (no
cosmetic formations, no blob); campaign army = battlefield army;
casualties/experience persist; NOT generic medieval fantasy.

### Design contract (build against this)

WEAPON CLASSES (`MELEE`/`BOWS` tables in data.js, replacing gun stats):
- sword: reach 2.2, swing 0.55s, dmg 26, versatile, pairs with shield.
- spear: reach 3.6, thrust 0.7s, dmg 24, +brace vs chargers (2x dmg to
  a target moving toward the wielder above walk speed), -40% dmg when
  target inside 1.2m ("inside the reach").
- heavy (breaker maul / cut-down girder axe): reach 2.6, swing 1.1s,
  dmg 48, shield-shred (x3 vs shield HP), wielder cannot block during
  windup.
- bow: projectile with gravity arc, flight ~28 m/s, dmg 30 falling to
  16 at range, volley cadence ~4s aimed; useless in melee (switch to
  short blade dmg 14).
- shield: held item, not a weapon: block arc 120°, shield HP 120
  (arrows 8/hit, melee weapon dmg/2, heavy x3); breaks visibly.

PLAYER MELEE: LMB swing (hold to feint is OUT — keep simple), direction
from mouse movement at swing start (overhead/left/right/thrust — 4-way,
falls back to auto if unreadable), RMB block (directional match not
required v1 — timed block: active 0.6s, 0.3s recovery), F kick (breaks
a block, 1.2m), sprint drains a short stamina bar that also gates
consecutive swings (3 before slow).

RESOLUTION: melee hit = arc sweep test at swing apex (90° arc, weapon
reach, nearest valid target); no hitscan. Damage through armour uses
the existing armour slots (they're environmental-suit plates already —
they stay). Stagger: hit while swinging cancels the swing (higher
weight wins ties).

FORMATION MODEL: three standing groups — INFANTRY (sword+shield),
SPEARS, RANGED — each with a formation shape (line 1-rank, wall
2-rank tight, loose 2.5m scatter) generating SLOTS; soldiers steer to
their slot via existing nav, fight from it, and RE-SEEK it when
displaced >3m and not engaged. Commands (keys 1/2/3/4 select ALL/INF/
SPEAR/RANGED, then): F follow, MMB-click move-there (existing ground
marker), H hold, C charge, V advance (walk forward facing), B fall
back, plus per-group toggles: fire-at-will/hold-fire (ranged), wall/
line/loose. Reuse the entire existing order pipeline + RTS layer;
the RTS cam stays as the optional command view.

BATTLE ARC: approach (enemy AI walks its line into position, no
contact) → volleys → engagement → break (morale) → rout (losers flee
to map edge; victory declared when cohesion < threshold, no hunting).
MORALE per soldier: base by rank, -casualties nearby, -routing allies,
+commander within 20m, collapse = rout state. Veterans resist.

ENEMY COMMANDER: one brain per side reading composition: ranged
superiority → hold ridge and force approach; melee-heavy → advance
under shields; player archers exposed → detach fast group at them;
losing badly → withdraw/rout.

REINFORCEMENTS: existing wave streaming stays but arrives from the
army's map edge in formation, never center-spawned.

KEEP: nav/A* + verticality, instancing (batchCharacter), entity/roster
persistence, applyMissionResult, capture, RTS camera, THE APPROACHES-
scale fields (regrade for ridges/chokes), palettes, HUD shell.
DISAPPEAR: hitscan, recoil/ADS, ammo/reload, suppression-as-shooting,
cover-seeking-to-shoot, gun audio, crosshair; guns keep existing only
as rare relic props, not combat.

### Phase status

1. INSPECT — done (OVERHAUL.md carries the full code map).
2. PLAYER MELEE — done (`5636eab`): strike/updateSwing/resolveStrike,
   guard/shield/kick/spear rules/stagger/stamina, procedural swing
   anim, WIND/PLATE HUD.
3. ASSETS — done (`d4e7b51`): six wpn_* meshes + melee schema + shield
   KIT entry.
4. 5V5 — done (`345348a`): claim-scored pairing in acquire(), the
   meleeSpacing in-out rhythm, swing camera bell.
5. FORMATIONS/COMMANDS — done: battleGroup (inf/spear/ranged off the
   carried weapon), FORMATIONS.battle (slot:null sentinel → battleSlot
   local-frame rectangles: inf 3.2 back, spears 6.4, ranged 11.5),
   groupShape line/wall/loose per arm ('n' cycles, refuses mixed
   selections), keys 6/7/8/9 = ALL/INF/SPEAR/RANGED, melee squads
   default to 'battle'.
6. ARCHERY — done (`3f8fc15`): looseArrow/updateArrows ballistic arcs,
   arrows as real meshes that stick, plate eats frontal arrows, volley
   cadence, holdFire discipline (X on a pure ranged selection), and the
   bow→blade swap inside 5m.
7. ROSTER REMAP — done: the six role ids keep their names in code and
   change meaning (rifleman=Swordsman, gunner=Spearman, marksman=Archer,
   breacher=Heavy); DOCTRINES skew who turns up per faction; shields
   arrive at spawn so mesh and maths are one decision. See OVERHAUL.md
   for the table.
8-10. per task list #62-#64.

**Sim-test traps, hard-earned:** (a) `step()` gates on `this.paused`
AND `this.over` — a staged test that KILLS all enemies completes the
objective, sets `over`, and every later step no-ops with no error;
EXILE enemies to (400,400) with sight 5 instead. (b) To drive the sim
by hand: `m.paused = false; const realStep = m.step.bind(m); m.step =
() => {};` — starve the rAF loop, drive the bound original. (c) The
movement deadband rests soldiers up to 2.2m from any destination —
convergence bounds must be ≥2.5m, and convergence must be measured
from a scattered start NEAR the commander, not across seed-varying
furniture.

---

## The summary artifact

<https://claude.ai/code/artifact/9070868b-f320-47b9-818c-2e2cfa32745d>

Up to date as of `740360b`. The source is `kettle-reach.html` in the session
scratchpad — regenerate it if lost, and republish with the same `url` to keep
the link rather than creating a second artifact.

---

## Recent history worth knowing

The last several sessions were driven by playtest feedback, and the pattern is
consistent enough to expect it: **most "the game feels wrong" reports traced to
a specific mechanical bug, and several of those bugs were introduced by the
previous round of work.** The invisible walls killing hit registration were
staircases added for verticality. The site that still felt flat after being
enlarged was a fog wall left at its old range. A road encounter stealing the
settlement menu was the never-stay-paused guard firing in the one-frame gap
between one panel closing and the next opening. Check what changed recently
before assuming a feel problem is a tuning problem.

**And measure the thing, not a proxy for it.** "Stray Scavengers" shipped
broken for several sessions because a duplicate object key made
`PARTY_TIERS.strays` undefined, and the check that passed it counted *hostile
parties near the start* rather than their strength. The count was true and
meaningless. A screenshot caught it, because a party whose kind resolved to
nothing had no description line under its name.
