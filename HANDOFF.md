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
