# Handoff

Written at commit `217c178`, **96/96 acceptance tests passing**, working tree
clean and pushed to <https://github.com/DudkneeAxiom/Scifilords>.

This is the note I would want if I were picking the project up cold. It is not a
feature list — `README.md` is that. It is the things that are easy to get wrong
here, and the reasons behind decisions that look arbitrary from the outside.

---

## Running and testing

```bash
npm run serve                 # static server on 8124; PLAY.cmd on Windows
npx playwright test           # the 96 acceptance tests, ~8.5 min (12+ under load)
node tools/soak.mjs 500 40    # 500 campaign days, 40 deployments, unattended
node tools/shots.mjs          # photograph 20 screens into qa-shots/
```

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

**Creeds are derived from `portraitSeed`, not rolled.** Taking another number
off the seeded generator in `makeSoldier` would shift every roll after it and
change every seeded campaign in the game.

**Diplomacy has its own RNG stream.** Day-tick additions used to perturb it.

---

## Where the work stopped

Open, in rough priority order:

1. **Combat lethality is untuned and deliberately so.** Time-to-die in the open
   measured 2.2s, 5.6s and 8.2s across *identical* runs against a documented
   ~12s target. Too noisy to retune from single samples. If you touch it,
   measure across many runs first.
2. ~~**Enemies are fully accurate the instant they acquire a target.**~~ Done.
   `aiShoot()` widens the first rounds of an engagement by `RANGE_IN_WIDE` and
   converges over `RANGE_IN` seconds of holding the same target; losing sight
   decays it at half rate, so bounding between cover is the counter-play. It
   applies to both sides, because a shared code path is simpler and an accuracy
   rule that favours whoever the player is not is precisely what reads as
   cheating.

   **The constant is not properly tuned, and item 1 is why.** Time-to-die
   medians came out *non-monotonic* across values — 2.0 gave 7.4s, 2.5 gave
   3.3s, 3.0 gave 22.55s at 12 trials each. That is noise, not a curve, and
   anything fitted to it is fitted to nothing. `RANGE_IN_WIDE` is set to 2.5 on
   the argument that first shots should land in a cone a couple of times too
   wide, not because 2.5 measured better than 2.0. What *is* robust across every
   value tested: the sub-second deaths are gone. The fastest death at 12m went
   from 0.5s to 4.4s at ×3.0, and standing in the open is still fatal.
   Settle it with a run of 60+ trials per range before trusting any median.
3. **Mission stages are a scaffold, not a design system.** `buildStages()` in
   `src/mission.js` generates two generic kinds (sweep, hold) from the site
   geometry for open-field contracts above 26 strength. The natural next step is
   stages that suit the contract — a sabotage wanting a second charge placed, a
   recovery with another group held elsewhere.
4. **The palette runs muddy at distance.** `nearGround()` now dresses the
   spawn surroundings that `outskirts()` starts 26m outside of, so the bare
   insertion point is dealt with; the colour problem is not.
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
7. **Pursuit is new and lightly tuned.** `partyIntent()` in `src/state.js`
   gives hostile bands per-tier boldness and a pursuit speed of 86, which sits
   inside the company's own 55-165 range so a lean company outruns them and a
   laden one does not. The thresholds were set against measured odds — a
   four-person company rates 0.64 against five looters — but only
   `tools/pursuit.mjs` has exercised them, not a long campaign. Watch for the
   map becoming a permanent chase.

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
