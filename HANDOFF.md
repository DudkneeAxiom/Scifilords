# Handoff

Written at commit `1f72e53`, **95/95 acceptance tests passing**, working tree
clean and pushed to <https://github.com/DudkneeAxiom/Scifilords>.

This is the note I would want if I were picking the project up cold. It is not a
feature list — `README.md` is that. It is the things that are easy to get wrong
here, and the reasons behind decisions that look arbitrary from the outside.

---

## Running and testing

```bash
npm run serve                 # static server on 8124; PLAY.cmd on Windows
npx playwright test           # the 95 acceptance tests, ~8.5 min
node tools/soak.mjs 320 30    # 320 campaign days, 30 deployments, unattended
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

And the meta-lesson: a metric that cannot fail is not evidence. Two collision
audits passed while the bug was live — the first compared footprint *area* and
never height, so a box the right width and four times too tall sailed through.

---

## Constraints that look like laziness and are not

**The ground is flat on purpose.** Real relief was tried and reverted. Every
obstacle is an axis-aligned box anchored to a *single* ground sample, so a
nine-metre rampart standing across a slope has daylight under one end and
rounds pass beneath the wall (the siege test catches this). Closing the gap by
sinking the boxes changes what an obstacle's *height* means — and height is
what classifies a box as shoot-over cover — so the cover list empties and the
cover test goes red too. Proper relief needs collision that follows the
terrain. That is a real piece of work, not a tweak. The reasoning is written
into `heightAt()` in `src/level.js`.

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
2. **Enemies are fully accurate the instant they acquire a target.** No
   ranging-in delay. This is the most likely remaining cause of combat reading
   as unfair rather than hard — the player dies before they can react, not
   because the numbers are wrong. A bounded change; measure it properly.
3. **The near ground at a deployment is sparse** compared to the mid-field, and
   the palette runs muddy at distance. `outskirts()` in `src/level.js` fills
   from 26m out; the immediate spawn surroundings are still bare.
4. **Flat sites** — see the constraint above.
5. No audio mixing, no key rebinding.

---

## The summary artifact

<https://claude.ai/code/artifact/9070868b-f320-47b9-818c-2e2cfa32745d>

**It is one revision out of date and needs republishing.** The local file
`kettle-reach.html` (in the session scratchpad; regenerate if lost) has the
corrections; the artifact service returned 502 three times running. The stale
copy lists "the player cannot yet be granted a fief" as a known gap — that is
wrong, fiefs exist and are now a repeating ladder. Republish with the same
`url` to keep the link.

---

## Recent history worth knowing

The last several sessions were driven by playtest feedback, and the pattern is
consistent enough to expect it: **most "the game feels wrong" reports traced to
a specific mechanical bug, and several of those bugs were introduced by the
previous round of work.** The invisible walls killing hit registration were
staircases added for verticality. The site that still felt flat after being
enlarged was a fog wall left at its old range. Check what changed recently
before assuming a feel problem is a tuning problem.
