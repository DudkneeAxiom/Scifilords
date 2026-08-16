# KETTLE REACH

A retro low-poly science-fiction mercenary sandbox. You command **Bracket**: a
four-person free company with one truck, no retainer, and two factions willing
to hire you.

The game is one loop:

> travel the Reach → take work → deploy → command a firefight → complete the
> objective → extract → live with the consequences → travel again

Everything else exists to give that loop stakes. The soldiers in your squad are
the same objects that were on the roster screen a minute earlier. Their wounds,
promotions, kill counts and deployment history persist between missions, and the
ones who die stay dead.

---

## Running it

**Windows:** double-click `PLAY.cmd`. It starts the local server and opens the
browser.

**Anything else:**

```bash
npm run serve
```

Then open <http://localhost:8124>.

A local server is required — the game uses ES modules, so `file://` will not
work. Node 18+ is the only dependency for playing. There is no build step.

---

## Controls

### On deployment

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move (camera-relative) |
| Mouse | Look |
| Left mouse | Fire |
| Right mouse | Aim down sights |
| `Shift` | Sprint — not from a crouch, not in mid-air |
| `Ctrl` / `C` | Crouch. Hold with Ctrl, toggle with C. |
| `Space` | Jump |
| `Q` | Swap which shoulder the camera looks over |
| `R` | Reload |
| `E` (hold) | Interact — cut restraints, place charges, stabilise a casualty |
| `Esc` | Pause |

Crouching costs most of your speed and steadies your aim by a third; firing in
mid-air nearly doubles your spread. Swapping shoulders matters at a corner —
your own body hides whichever side you are leaning past.

Click the viewport once to capture the mouse.

### Squad command

| Key | Action |
| --- | --- |
| **Middle mouse (hold)** | **The command wheel.** Every order in one place, with the world at 28% speed while it is up. |
| `1` – `4` | Select that soldier. Orders then go to them alone. |
| `` ` `` or `0` | Clear selection — orders go to the whole squad |
| `X` | **Suppress** that position — pins whoever is there |
| `Z` | **Flank** — swing wide and come at it from a different angle |
| `V` | **Fall back** to the commander |
| `F` | Form up on the commander |
| `H` | Hold current position |

The wheel captures the aim point **at the moment it opens**, so aim first and
then choose — the order lands where you were looking when you reached for it,
not wherever the reticle drifted while you decided. Releasing in the dead centre
cancels for free. The letter keys remain as shortcuts once you know them.

The point of individual selection is bounding: **pin a position with one
soldier, flank it with another.** Suppressed soldiers stop advancing and shoot
badly, so fire that never hits anybody still wins ground.

### In the Reach

| Key | Action |
| --- | --- |
| Click | Travel to a point |
| `W` `A` `S` `D` | Steer directly |
| `Space` | Halt |
| `E` | Enter the location you are standing on |
| `C` | Company roster |
| `L` | Loadout — weapons, kit, retraining |
| `V` | Equipment — character, armour, spoils |
| `P` | Diplomacy — standing, commissions, your banner |
| `I` | Stores — cargo, trade, armoury |
| `K` | Holdings — ground you own and its upgrades |
| `B` | Contract board |
| `Esc` | Menu / save |

---

## The setting

Something large was administered from this basin once. The roads are too wide
for the traffic on them and half the installations still answer to a command
structure nobody can name.

- **The Ordnance Trust** — chartered off-world to inventory and preserve what the
  collapse left. They genuinely keep the reactors and water plants running. They
  also meter everything and will let a settlement go dark rather than spend an
  irreplaceable part.
- **The Basin Syndics** — work-councils from the hab blocks who took the
  armouries when the rationing started. They want the caches opened now, by the
  people who live here. They will also strip a working water plant for parts and
  call it redistribution.

Neither is the villain. Both will hire you, and working for one costs you
standing with the other.

---

## What is implemented

**Strategic layer — a continent**
- **Dovan is 6200 units across**, rendered as real 3D terrain with an authored
  trunk-road network. Five regions: the Kettle Reach you start in, the Trust
  heartland of the Sarn Uplands, the Syndic Weal, the lawless Scour, and the
  Dovan Littoral where the old administration was seated.
- **Political borders you can read at a glance — borders, not paint.** Only the
  frontier is drawn, as a surveyed line in each power's colour laid on the
  ground, so the terrain you are actually navigating stays visible underneath.
  Ownership is resolved per sample from the nearest settled location, with
  settlements outweighing depots and authority running out entirely 900 units
  from anywhere anyone lives, so the Trust's writ genuinely fades into the Scour
  instead of stopping at a line somebody drew.
- **The terrain carries the map.** Contour banding every 15m turns the basin
  into something that reads as a surveyed sheet rather than a brown expanse,
  with a colour ramp from silt in the drained pan up to bare stone on the rim.
- **Province names appear as you zoom out** and location labels drop away, so
  the strategic view is a political map and the tactical view is a road map.
  Territory recomputes whenever a holding changes hands: take a settlement and
  you watch your colour spread over it.
- **Twenty-five locations** — settlements, faction seats, depots, dead
  installations and open country.
- **A danger gradient you travel along.** Each region has a danger rating that
  gates what spawns there, with both a floor and a ceiling: the basin produces
  looters and caravans, the heartlands produce battle groups and armoured
  columns. Wandering into the Littoral on day two will get you killed, and the
  map tells you so before you commit.

**Advancement you decide and pay for**
- Rank is earned in the field and cannot be bought. **Role is bought and cannot
  be earned.** That split is the point: experience decides how good somebody is
  at their job, and you decide what the job is.
- A rifleman who has made Trooper is a decision — **Breacher, Marksman or
  Gunner** — and each branch wants something different from the rest of the
  company. Breachers can go on to Gunner or Medic; Marksmen to Signals. Medic
  and Signals are the end of the road.
- Every promotion raises that soldier's wage, so a company of specialists costs
  real money to keep standing still. The screen shows the new wage before you
  commit.
- It is the same person afterwards — name, history, experience and perks all
  come with them. This replaced a flat "retrain into any role for 260 credits",
  which made rank and role both meaningless.

**Pace is something you did, not something that happened**
- The company's speed on the map is the sum of decisions already made: how many
  people you are feeding, how loaded the truck is, how many wounded you are
  carrying, whether anyone has eaten, and morale. Measured: four fed people
  travelling light move at **100%**; fourteen with a loaded truck and no food
  move at **42%**, the floor.
- The top bar shows the percentage and the tooltip lists every reason, because a
  number that drops without saying why is just a mystery.
- This is what makes bulk trading a trade-off rather than free money, and what
  decides whether you can outrun a column or catch a caravan.

**A company is a payroll**
- Wages leave every day whether or not there was work, scaled by rank — a
  sergeant who has survived thirty deployments does not work for recruit money.
  The commander is not on the payroll; you do not pay yourself.
- Everyone eats. Rations are bought at market prices, so food and trade are the
  same economy and hoarding ration blocks to sell is a real option.
- **Morale** responds to being paid, being fed, company size and recent
  victories, and it is shown as a word rather than a number: Mutinous, Sullen,
  Steady, Willing, Devoted.
- Go unpaid and unfed long enough and somebody walks — from the bottom of the
  roster, never the commander, and never silently. Desertion needs a **live**
  grievance rather than a lagging number: settle the arrears and buy food and
  nobody else leaves while morale climbs back. Back pay is worth more than a
  day of ordinary wages, because catching up should feel like catching up.
- The opening purse covers about **thirteen days of idleness** and the starting
  rations about seven. Party size is now a decision rather than an accumulation.

**Prisoners you can do something with**
- Taking prisoners used to store them and promise, in the log, that they "can be
  pressed into the company" — and there was no way to do anything with them at
  all. Now there are three, each with a cost:
  - **Press** them into service. Cheap bodies, but nobody likes serving next to
    somebody who was shooting at them last week: it costs morale, so a company
    built out of prisoners is a company that deserts.
  - **Ransom** them back to their own people. Pays well, costs standing with
    that faction, and is the only reason to take prisoners for money.
  - **Release** them. Free, and the only thing that buys standing back.

**A command wheel, not a quiz**
- Six keys the player had to memorise was not a command system. Hold **middle
  mouse** and every order is on one wheel, with the world running at **28%
  speed** while it is up — slow enough to think, live enough that deciding
  still costs you ground.
- It captures the aim point **at the moment it opens**, so the order lands where
  you were looking when you reached for it rather than wherever the reticle
  drifted while you chose.
- **Press it while looking at a hostile and the squad is already shooting them.**
  "That one, now" is the most common thing a player wants to say in a firefight
  and it should cost one button, not a button and a menu choice. The target is
  marked with a caret that follows them and a readout naming them, their health
  and their range — and the mark lasts until they are down or out of range,
  because a marker on a corpse or on somebody nobody can reach is worse than no
  marker at all. Any other order releases it.
- Releasing in the dead centre cancels for free. The letter keys still work once
  you know them.

**Stance**
- **Crouch** (hold Ctrl, or toggle with C) costs most of your speed and steadies
  your aim by a third. **Jump** (Space) clears a sandbag line, not a building —
  and firing in mid-air nearly doubles your spread.
- **Swap shoulders** with Q. This matters at a corner: your own body hides
  whichever side you are leaning past, and being welded to the right shoulder
  makes left-hand corners unfightable.

**Faction-unique recruits**
- Where a soldier was raised is a permanent property of that soldier. It decides
  what they look like in the field, what they are good at, what they were issued,
  and what they cost.
- **Trust Regulars** — accurate, armoured and slow (+7% accuracy, +16 HP, −7%
  speed), issued a plate carrier and a combat helmet, and 25% more expensive.
  Drilled riflemen, gunners, marksmen and signallers.
- **Syndic Levy** — fast and hard to pin (+16% speed, better cover use), lightly
  equipped, 15% cheaper. Breachers and medics, people used to fighting somebody
  better equipped.
- **Scour Hands** — tough, lucky, inaccurate, 30% cheaper. Open-country fighters
  with no training and no kit.
- **Anchorage Hands** — port technicians and dock security: accurate, longer
  sighting range, 15% more expensive. Signals, marksmen and medics.
- **Free Companies** — no bonuses, no penalties, every role available.
- Each origin fields **a different character model**, so a Trust column and a
  Syndic levy read differently across a battlefield at a glance. Your founding
  three are deliberately mixed — a free hand, a Trust deserter and a Scour
  hand — so you meet the system before you ever hire anybody.
- Recruit pools are drawn from the local origin, so **the map tells you where to
  shop**: cross into the Uplands for regulars, into the Scour for cheap bodies.

**The Titan**
- A pre-charter siege walker that somebody got running again. It appears rarely
  and only out in the dangerous country, as a party of **one** — the most
  dangerous marker on the map has the smallest number on it.
- **Rifles do not work on it, and that is the lesson.** Every hit lands on
  armour and bleeds through at 4%. Concentrated fire beats a section off, the
  slab falls to the ground and stays there, and the core underneath takes
  **crits worth roughly 85 armour hits**. Six sections, six holes to make.
- It turns its damaged side away from you, so a squad that opens the left flank
  has to keep working to see it. It cannot be suppressed and it does not take
  cover — the only tactic that works is the one the fight is about.
- Standing under it to dodge the cannon does not work either: it stomps.
- The HUD shows armour section by section rather than one health bar, because a
  health bar on a machine this size reads as no progress at all.

**Parties have numbers**
- Every group on the map carries a real troop count, **shown on its marker and
  coloured by how it compares to what you can field** — green you outnumber,
  amber costly, red suicide.
- Eleven party types from **Looters (3–8)** through Scrapper Bands, Caravans,
  Free Companies and Patrols to **Armoured Columns (60–110, with tracked
  armour)**. The encounter panel shows their strength against yours and says
  plainly what it thinks of your chances.
- Caravans haul cargo, which is why robbing one is worth doing.

**Larger battles**
- **Deployment size is set by renown**, not a constant: 5 at Unknown, rising
  through eight tiers to 14 at Legendary, plus a bonus for every two sergeants.
- **Enemy numbers come from the party you actually attacked.** A sixty-strong
  column commits about thirty-five at a time and feeds the rest in as the front
  rank falls — both how a large formation fights and what keeps the frame budget.
- Measured with `tools/battle.mjs`: **46 combatants on the field, 701 draw
  calls, 22.9ms median frame time on the software rasteriser** — i.e. 60fps
  with no GPU at all. The enabler is merging each character from ~31 meshes to
  one per animated joint at load, plus distance-based AI and animation budgets.

**Diplomacy**
- **Standing** with each faction runs on a seven-band scale from Hated to
  Sworn, and it does real work: hostile factions' patrols engage you on the
  road, friendly ones post better contracts.
- **Tribute** buys favour at a price that climbs the more of it you already
  have. Contracts, and hitting their enemies, move it for free.
- **Factions fight each other on their own schedule.** War burns out into
  truce, truce cools into peace, peace collapses again. The continent is never
  politically frozen, and their quarrels reach you.

**Taking a commission**
- At **Trusted standing and 300 renown** a faction will swear you in. Their
  postings pay 35% more, their enemies immediately become yours — visibly, as
  parties on the road flip hostile — and your holdings sit under their
  protection, which measurably slows the pressure on them.
- Serve them through four contracts and they **grant you a fief** outright.
- **Breaking the oath** costs renown and makes a permanent enemy of your former
  liege. It is always available and always expensive.

**Declaring your own faction**
- At **1200 renown and three holdings** you can stop working for other people.
  Name your banner and it flies over every holding you own.
- Both established powers declare against you at once. Your holdings come under
  **permanent pressure — 1.7× the retake rate** — and you defend them yourself.
- You become a third power in the relations table, and can **sue for peace**
  with either rival for an indemnity that scales with how badly they hate you.

**Renown and spoils**
- Renown grows from contracts and, far faster, from beating parties — scaled by
  how badly you were outnumbered, so clearing looters stops paying once you are
  a real company.
- Beaten parties yield **credits, their cargo, weapons and armour stripped from
  the field, and prisoners**.
- **Every location hosts several mission templates.** Postings are generated
  from what a place can support, so the Array offers a rescue this week and a
  demolition the next. Five layouts back them, and a location renames and
  re-lights the one it uses.
- Parties that move on their own between plausible destinations — Trust patrols,
  Syndic columns, scrapper bands, refugees, another free company. Approaching one
  triggers an encounter you can talk through, avoid, aid, or fight.
- Time passes only while you travel. Contracts expire, wounds heal, patrol
  densities drift back toward normal.

**Persistent personnel — the core system**
- Every soldier has a name, generated portrait, role, rank, experience,
  deployment count, kills, traits, wound state, and a record of where they joined
  from ("Rescued at Grellan Array, day 1").
- Four ranks (Recruit → Trooper → Veteran → Sergeant) with real stat effects.
- Six roles: Rifleman, Breacher, Marksman, Support Gunner, Field Medic, Signals
  Tech. A Signals Tech halves objective interaction time; a Medic improves
  casualty outcomes.
- Wounds are named, have durations, and impose penalties until they heal.
  Recovery is faster in a settlement with medical services.

**Progression — what a soldier becomes, not just how big their numbers get**
- **Every promotion is a choice.** The player picks one perk from three offered,
  weighted toward the soldier's role but never locked to it. Two riflemen who
  started identical diverge into recognisably different soldiers.
- **Fifteen soldier perks**, each one changing behaviour rather than adding a
  flat bonus: *Deadeye* flattens how fast aim scatter grows with range,
  *Cover Hound* searches further for cover and uses it unprompted, *Steady
  Nerves* makes suppressing fire barely register, *Combat Medic* sometimes
  stabilises a casualty without spending a kit, *Spotter* hands its contact to
  the rest of the squad, *Suppressor* pins much harder.
- **The commander has their own rank ladder** — Ensign → Lieutenant → Captain →
  Major → Colonel → Commandant — and their own **ten perks, which apply to the
  entire company**: *Drillmaster* (squad accuracy), *Tactician* (orders acted on
  almost instantly, harder suppression), *Field Surgeon* (casualties far likelier
  to survive, wounds heal twice as fast), *Quartermaster*, *Negotiator*,
  *Scrounger*, *Iron Will*, *Forward Observer*, *Press Gang*, *Hard Case*.
- The player's **first decision in the game** is the commander's opening
  commission — before they look at the contract board.

**Equipment screen**
- A three-column character screen: **spoils from the last engagement on the
  left, the soldier rendered live in 3D in the centre, the company's stores on
  the right.** Drag the model to turn it; click a slot to strip it.
- **Five slots** — weapon, head, body, legs and gear — with nine armour pieces
  across three weight classes. Every piece trades protection against speed, and
  the model visibly changes as you equip it.
- Spoils are **held aside until you claim them** rather than silently absorbed,
  so you see what you took off the field.

**Squad customization**
- A real **armoury**. Weapons are owned objects: equip one and whatever the
  soldier was carrying goes back into the pool. Nothing is created or destroyed.
- **Kit slot** per soldier — Composite Plate, Ranging Optic, Bandolier,
  Stabiliser Rig, Trauma Stim, Stripped Webbing. Each is a trade, not an upgrade:
  the plate costs speed, the webbing costs condition.
- **Buy weapons and kit at settlements.** Faction markets stock their own
  doctrine's weapons; the neutral crossing sells whatever it can get, which is
  what makes the trip there worth it.
- **Retraining** — move a soldier to a different role for credits and a day,
  keeping their rank, perks and history.
- A loadout screen showing each soldier's live effective statistics, so the
  effect of a swap is visible before committing to it.

**Casualties**
- Nobody dies instantly. Reaching zero condition puts a soldier **down**, with a
  55-second bleed-out timer shown on the squad panel.
- Standing over them and holding `E` spends a medical kit and puts them back on
  their feet at reduced health.
- Let the timer run out, or leave them on the ground at extraction, and they can
  die permanently. Dead is dead — they appear under KILLED IN ACTION on the
  roster and never come back.

**Deployments** — four contract templates plus one emergent type, any of which
can appear at any location that supports it:
- **Recovery** (Grellan Array) — find and release held personnel, then walk them
  out. Survivors who reach extraction permanently join the company; one of them
  is a trained field medic.
- **Sabotage** (Rampart 12) — place charges on the mast base, then get clear
  inside 75 seconds while the garrison converges and reinforcements land.
- **Defence** (Perran Flats) — hold the reclaimer through three waves.
- **Seizure** — break the garrison, then hold the ground for thirty seconds
  while they counter-attack. Clearing a position is not the same as taking it.
- **Road engagement** — what a travel encounter becomes if you choose to fight.
  Enemy strength comes from the actual party on the map.

**Getting into the fight**
- A deployment opens on a **cinematic insertion**: letterbox, a briefing card
  naming the site, objective and squad, and a camera that sweeps the objective
  from high and wide before falling back into the over-the-shoulder pose.
- **Nothing can see or shoot you until control is handed over**, plus a short
  grace after. Previously the player materialised inside an alerted garrison and
  was taking fire before they had found the horizon.
- Garrisons start unaware. Contact is something that develops, not the opening
  frame. Road ambushes now start at 30–46m rather than 18–30m.

**Territory**
- **Seize any location that can be taken** and it becomes a holding: it produces
  credits and goods every day, and appears as yours on the map.
- **Five upgrade lines per holding**, each to level 3, paid for in *both* credits
  and trade goods hauled in your truck — Barracks (more and better recruits
  there), Infirmary (company-wide faster healing, daily medical kits), Workshop
  (cheaper weapons and kit, fabricates machine stock), Depot (more cargo
  capacity, better sale prices at your own holdings), Defence Works (more militia
  when defending it, fewer counter-attacks).
- **Holding ground is not free.** Pressure builds daily on everything you own.
  When it peaks a retake contract appears; ignore it and the holding is lost.
  Defence Works slow the clock but do not stop it.
- Taking a faction's ground costs you standing with that faction.

**Trade**
- Eight commodities with **per-settlement prices that drift daily**. Every
  settlement produces a couple of things cheaply and wants a couple badly; the
  profit is in learning the routes. Perran makes water, Harrow Deep needs it.
- **Cargo is capped** by the truck, so hauling bulk means giving up the ability
  to haul anything else. Depot upgrades raise the ceiling.
- Prices are derived deterministically per location per day, so a market cannot
  be rerolled by leaving and coming back.

**Inventory**
- A single **stores** screen for everything the company owns: cargo with live
  local prices, the market, the armoury and spare kit, and who is carrying what.
- **Every item is shown as a rendered 3D icon** — drawn once at boot from the
  same models the world uses, rather than a parallel set of hand-drawn art that
  would drift from the assets.

**Consequences that show on the map**
- Sabotage Rampart 12 → Trust patrol coordination collapses and their parties
  thin out across the north rim.
- Clear Grellan Array → scrapper activity across the east drops.
- Hold Perran → reputation with the Syndics, and the Flats open their roster.
- Reputation with one faction costs you standing with the other.

**Combat**
- Third-person over-the-shoulder, hitscan with visible tracers so misses read.
- Six weapons, meaningfully different in range, rate, damage and handling. No
  randomised stat loot.
- Cover is genuine: shots are traced in 3D, so a low barrier stops a standing
  shot at range and does nothing at three metres.
- Enemy AI patrols, alerts its neighbours by sound, takes cover according to
  faction doctrine (Trust troops are drilled and cover-seeking; scrappers are
  not), advances, and fires in bursts with a reaction delay.
- Friendly AI follows in a loose wedge, takes cover, obeys orders, and can be
  incapacitated.
- **Pathfinding.** A 1.5m occupancy grid with A* and a string-pulling pass, so
  ordering a flank across a container yard routes soldiers *around* the
  buildings instead of grinding them along a wall. Straight lines skip the
  search entirely; only blocked routes pay for it.

**Suppression — the tactical spine**
- **Every round suppresses whatever it passes near, hit or miss.** Distance is
  measured to the shot's *line*, so a burst walked across a position pins
  everyone behind it, not only whoever was aimed at.
- Suppressed soldiers **stop advancing**, break for cover regardless of doctrine,
  take much longer between bursts, and shoot appreciably worse.
- It applies to the player identically: the screen closes in, the reticle blooms
  and your own aim widens when rounds are landing close.
- This is what makes the orders worth giving. Measured with `tools/tactics.mjs`
  over an identical 16-second contact: ordering the squad to suppress raised
  peak enemy suppression from **0.05 to 0.40**, cut incoming damage by **35%**,
  and held the attackers further out — in an earlier run the difference was the
  commander surviving rather than going down.
- **Individual selection** (`1`–`4`) is what turns four orders into tactics:
  pin with one soldier, flank with another.
- The squad panel reports what each soldier is actually doing — MOVING, IN
  COVER, ENGAGING, SUPPRESS, FLANKING, PINNED, RELOAD, DOWN — with a suppression
  bar under each row.

**Presentation**
- **72 low-poly models** authored programmatically in Blender (`tools/blender/build.py`),
  including **seven rigid-segmented character rigs plus a siege walker** animated by node rotation —
  the period-correct approach, and far more robust than shipping skinned
  armatures. Trust regulars are armoured, visored and faceless; Syndic levies
  wear a cloth hood and a whip antenna; Scour hands go bare-faced under a sun
  mask with a bedroll across the back; Anchorage hands wear a high collar, ear
  defenders and a work loupe. You can tell who is shooting at you across a
  field, in silhouette, in fog.
- **Animation.** Twelve-joint rigs with real knees and elbows. A proper gait
  cycle with a stance and a swing phase: the knee tucks to clear the ground
  through the swing and straightens to reach for contact, the hips bob twice per
  stride, the torso counter-rotates and leans into the run. Both elbows fold
  into a two-handed firing grip when shouldered, with the support arm crossing
  the body. Backpedalling reverses the cycle, strafing crosses and spreads the
  legs, sprinting lengthens the stride and drops the shoulders. Reloads pull the
  support hand off the weapon and dip the muzzle; hits produce a flinch; recoil
  kicks the weapon back into the shoulder. Going down buckles the knees, folds
  the torso and settles the body onto the ground with a per-character roll, so a
  field of casualties is not a field of identical planks.
- The weapon's pitch is driven directly rather than inherited from the arm
  chain — parented naively it swings with the shoulder and ends up pointing at
  the sky the moment the arm comes up.
- All audio is synthesised at runtime with WebAudio. Nothing is sampled and
  nothing is licensed: gunfire per weapon voice, impacts, reloads, radio squelch
  for orders, and a drifting industrial ambience that never resolves into music.
- Sub-native render resolution with hard shadows and heavy fog, so silhouettes
  read against haze.
- Save/load to localStorage. A corrupt save is discarded rather than allowed to
  wedge the game.

---

## Project layout

```
index.html          shell + HUD markup
style.css           stamped-metal interface
src/
  perks.js          soldier and commander perks, company-wide modifiers
  diplomacy.js      standing, inter-faction relations, commissions, your banner
  nav.js            occupancy grid + A* pathfinding for the deployment layer
  main.js           boot, screen flow, layer transitions
  state.js          campaign simulation, consequences, save/load
  roster.js         persistent soldiers, ranks, wounds, portraits
  data.js           factions, locations, weapons, roles, mission templates
  worldmap.js       strategic layer (Three.js)
  mission.js        third-person deployment runtime
  level.js          site construction, collision, line-of-sight, cover
  models.js         asset loading and the character rig
  ui.js             panels and HUD rendering
  audio.js          runtime-synthesised audio
  util.js           seeded RNG and small helpers
tools/
  blender/build.py  authors every .glb
  serve.mjs         static server
  qa.mjs            screenshot pass over the main loop
  qa2.mjs           screenshot pass over settlements + other mission types
  qa3.mjs           screenshot pass over progression + tactical commands
  qa4.mjs           screenshot pass over trade, stores and holdings
  qa5.mjs           screenshot pass over the equipment screen
  qa6.mjs           screenshot pass over diplomacy and declaring a faction
  nav.mjs           proves a soldier routes around a building
  battle.mjs        measures large-battle scale, draw calls and frame time
  balance.mjs       measures time-to-death under fire
  tactics.mjs       proves the suppress order changes the outcome
  anim.mjs          pose sheet — every animation state + a walk-cycle strip
  animcheck.mjs     asserts the rig actually moves in live play
  origins.mjs       every origin side by side + per-rig joint travel
  focus.mjs         middle-mouse focus fire and how long a mark lasts
  payroll.mjs       wages, rations, morale, desertion and prisoners
  company.mjs       advancement paths and what the company does to your pace
  softlock.mjs      proves no hostile can spawn unreachable
  wheel.mjs         every wheel sector issues the order it shows
  titan.mjs         the boss: armour gates, cores crit, and it can be killed
  sites.mjs         each layout renders and fields its authored garrison
  soak.mjs          a long unattended campaign plus every mission type
  territory.mjs     who the map says owns what, against who actually does
  upgrades.mjs      can a player tell how to pay for a holding upgrade?
tests/              Playwright acceptance tests
```

## Development

```bash
npm run serve                 # play at localhost:8124
npx playwright test           # acceptance tests
node tools/qa.mjs             # screenshots of the main loop -> qa/
node tools/qa2.mjs            # screenshots of the other screens -> qa2/
node tools/balance.mjs        # combat tuning measurement
node tools/tactics.mjs        # does commanding the squad actually help?
node tools/qa3.mjs            # progression + command screens -> qa3/
node tools/qa4.mjs            # trade, stores and holdings -> qa4/
node tools/nav.mjs            # pathfinding proof
node tools/battle.mjs         # large-battle scale and performance
node tools/anim.mjs           # animation pose sheet -> qa-anim/
node tools/animcheck.mjs      # joint travel report for the live rig
node tools/qa5.mjs            # equipment screen -> qa5/
node tools/qa6.mjs            # diplomacy -> qa6/
node tools/qa7.mjs            # faction recruit pools -> qa7/
node tools/origins.mjs        # origin comparison sheet -> qa-origins/
node tools/softlock.mjs       # spawn reachability proof
node tools/wheel.mjs          # command wheel correctness
node tools/focus.mjs          # focus fire + target marking -> qa-focus/
node tools/payroll.mjs        # the upkeep economy -> qa-payroll/
node tools/company.mjs        # advancement + party pace -> qa-company/
node tools/titan.mjs          # boss mechanics -> qa-titan/
node tools/sites.mjs          # every site layout -> qa-sites/
node tools/soak.mjs 60 20     # long unattended playthrough
node tools/territory.mjs      # political map audit
node tools/upgrades.mjs       # holding upgrade legibility -> qa-upgrades/
```

Rebuilding art requires Blender (tested on 5.2):

```bash
blender --background --python tools/blender/build.py
```

The `.glb` files are committed, so Blender is only needed to change the art.

---

## Testing results

**Acceptance suite: 47/47 passing** (`npx playwright test`, 5.8 min)

Covered: boot with no page errors; new campaign composition; strategic travel
advancing time; independent party movement; a recovery deployment launching,
completing and extracting; mission results persisting to the campaign and
changing world state; soldiers accumulating deployments and XP; stabilising a
downed soldier and the kit being consumed; an unstabilised casualty dying
permanently and staying dead on the roster; settlement recruitment charging
credits; save/load round-tripping; a corrupt save being discarded; sabotage
collapsing Trust patrol coverage; the character rig animating while moving and
settling when still; squad orders reaching the squad; recruit pools differing by
region; origins carrying distinct stats, models and prices; a soldier keeping
their origin through hiring and deployment.

**Screenshot QA:** every screen in the loop was rendered and inspected — title,
controls, about, intro, contract board, world map, roster, travel, deployment
picker, mission start, movement, ADS, each squad order, firing, reloading, the
objective area, released prisoners, extraction, after-action, and the map after
consequences. Both additional mission types and both settlement types were
inspected in a second pass. Console errors: 0.

**A long unattended playthrough.** `tools/soak.mjs` runs 60 campaign days and
then 20 deployments covering every mission type, every site layout and every
scale from 6 to 66 hostiles with squads of 2 to 7. Every deployment reached a
terminal state; 0 hostiles outside the bounds, 0 embedded in geometry, 0
unreachable; 0 console errors. Campaign invariants — credits never negative, HP
never above maximum, prices finite and positive, every soldier holding a valid
rank and origin — held on all 60 days.

This is only possible because the mission simulation was split out of the render
loop into `Mission.step(dt)`. Before that, the deployment cinematic's clock lived
inside `introCamera()`, which meant *whether the player could move* was a
property of the camera code. It is now `tickIntro()`, in the simulation, where it
belongs.

**Combat balance is measured rather than guessed — and the measurement is
honest about what it cannot resolve.** These fights are full of dice, and a
single burst landing is worth about 30 HP. Consecutive runs of an identical
scenario produced "dead in 7s", "44 HP left after 14s" and "78 HP left after
14s". Every number below is therefore a distribution over repeated trials, not
one firefight.

`tools/balance.mjs` leaves a stationary player in the open in front of a
garrison, at three ranges, six trials each:

| Range | Incapacitated | Time to down | Survivors ended on |
| --- | --- | --- | --- |
| 12m | 6/6 | median **3.5s** (0.8–6.2s) | — |
| 22m | 0/6 | — | 19 HP after 45s |
| 34m | 0/6 | — | 108 HP after 45s |

Range is the whole game. Closing to twelve metres in the open kills you before
you can react; at twenty-two you survive a full minute but finish it one burst
from the ground; at thirty-four you have time to read the fight and break
contact.

**Does commanding the squad actually help?** `tools/tactics.mjs` runs paired
16-second engagements from an identical opening state. The answer is yes, but
not in the way the previous version of this README claimed — it quoted a 35%
reduction in damage taken, which came from a *single* pair of trials. Run
properly, damage taken is noise-dominated: at a dozen trials the standard error
on the mean is around 13 points, so any difference under roughly 40% is
unmeasurable and should not be quoted.

What is stable across every run is the enemy's behaviour. Ordering suppression
raises peak enemy suppression from **0.26 to 0.56** and holds the attackers
**1.5–2.2m further out**. That threshold matters: enemies only break — stop
advancing, abandon their doctrine, dive for cover — above 0.45, and ordinary
aimed fire tops out right around 0.43. So the order is tuned to be the thing
that carries them over the line (suppression power ×2.1 when ordered), rather
than a marginal damage tweak nobody can feel.

### Defects found and fixed during QA

Screenshot QA caught things the tests never would have:

- Modal overlay sat *below* the title screen, making panels opened from the main
  menu unclickable.
- Scene was drastically underlit — Three.js r155+ uses physical light units and
  the intensities were roughly a third of what they needed to be.
- The player spawned **facing away from the objective** at three of four sites.
- Vertical mouse look was inverted.
- Rig pivots were all displaced in Blender: empties were parented without
  compensating for the parent's offset, putting the head pivot at 2.44m instead
  of 1.52m and swinging limbs through the floor when animated.
- The character update wrote `group.position.y` absolutely, clobbering the
  terrain height and burying every character in sloped ground.
- Enemy AI fired continuous full-auto with far too little aim error, killing the
  player in under 5 seconds; then, after a first correction, target memory was so
  brittle that enemies barely fired at all. Fixed with reaction delay, burst
  discipline and range-scaled scatter.
- A road encounter could fire while another panel was open and silently replace
  it; encounters now trigger on *approach* rather than proximity, which also
  fixed a party spawning on the player's start and interrupting them before they
  had touched anything.
- A soldier who had already bled out still got a 30% survival roll at
  extraction, which made the bleed-out timer the HUD counts down meaningless.
- The camera collided into the commander's back at 0.5m; world-map dead trees
  were scaled to 60m tall; terrain vertex-colour noise had a 200-unit period that
  rendered as huge dark blotches; the after-action report said "You is wounded".
- The strategic map had no location labels at all, so a contract saying "travel
  to Grellan Array" gave the player no way to identify it among the shapes on
  the ground.
- **Up to half of every enemy wave spawned inside solid geometry.**
  `tools/softlock.mjs` reproduced it immediately — "initial wave: 30 on field,
  15 embedded" — and an embedded soldier cannot be shot, which softlocks any
  eliminate-all objective outright. Spawns are now clamped inside the bounds and
  pushed to the nearest open navigation cell before an entity exists at all,
  with a stall guard that nudges stragglers at 12 seconds and arms extraction at
  40. Re-measured: 0 embedded, 0 outside, at every wave size from 5 to 70.
- A mission silently paused itself forever if pointer lock was never granted —
  the pause was hung off `pointerlockchange`, which fires on the *failure* to
  acquire the lock as well as on losing it. It now only pauses if the lock was
  actually held at some point.
- **The political overlay was invisible for one of the two factions.** Faction
  colours are chosen to look right on a uniform, which makes them olive and
  khaki — laid flat over olive-and-rust terrain, Syndic ground was
  indistinguishable from unclaimed ground. Verified with `tools/territory.mjs`,
  which samples ownership on an 8100-point grid: the data was correct all along
  (30.6% Trust, 24.1% Syndic, 45.3% unclaimed), only the paint was wrong. The
  map now uses its own palette — teal and crimson, hues the terrain never
  produces — and a legend in the corner says what they mean.
- Faction-issued recruits arrived wearing a helmet and plate carrier that were
  not priced in, so a Trust regular cost 25% more than a free hand for roughly
  60% more health. Hire cost now includes the value of whatever they walk in
  wearing, which makes the premium honest and self-balancing.
- Scrapper bands used the Syndic character model, so every roadside ambush read
  as a faction raid. They have their own rig now.

---

## Known limitations

This is a vertical slice. It is deliberately small and deep rather than large.

- **Diplomacy is two NPC factions plus you.** There are no minor clans, no
  named lords with their own agendas, no marriage or succession, and no way to
  negotiate an alliance rather than merely a truce.
- **Allied parties do not fight alongside you.** A liege's patrols stop being
  hostile and their enemies start, but no friendly party reinforces your
  battles on the map.
- **No sieges as a distinct mode.** Seizing a fortified holding uses the same
  take-and-hold template as anywhere else; there are no walls to breach.
- **Vehicles are flavour, not units.** Armoured columns are described as having
  tanks and hit harder for it, but no vehicle is drivable or destructible in
  the deployment layer.
- **Battles cap at ~34 hostiles on the field at once.** Larger parties are real
  — a sixty-strong column is sixty soldiers — but they arrive in waves rather
  than standing in one line.
- **Origins change stats, kit, price and appearance — not tactics.** A Trust
  regular and a Scour hand fight the same way; they are simply better or worse
  at it, and cost accordingly. There are no origin-specific abilities.
- **Seven site layouts**, hand-laid rather than procedural. Places where people
  live now fight like it: **The Town** is a street grid of hab blocks around a
  market square, where flanking means going around a block and the square is the
  only long sightline on the map; **The Works** is a company town built around
  the plant that owns it, compartmented by tanks and pipe runs. Two places
  sharing a layout still differ in name, lighting and garrison.
- **Pathfinding is a coarse 1.5m grid**, rebuilt once per deployment. It is
  ample for these open industrial sites but has no dynamic obstacles, no
  cross-level links and no crowd avoidance beyond simple separation.
- **No interiors.** Every deployment is exterior.
- **Rigid-segmented characters, not skinned.** Limbs are hard-jointed at the
  hip, knee, shoulder and elbow — there are no wrists, ankles, spine segments or
  finger joints, so feet do not roll through a step and hands do not grip. This
  is an aesthetic choice as much as a scope one, but it also means no ragdolls
  and no blend trees; poses are composed procedurally rather than authored.
- **Friendly fire is reduced to 35%** from the player and disabled between AI.
  Full-strength friendly fire with AI this simple is frustrating rather than
  tense.
- **The commander cannot die permanently.** Going down ends the deployment as a
  withdrawal and leaves them wounded. Every other soldier can die for good.
- **Audio is synthesised**, so it is dry and mechanical by design. There is no
  score, only ambience.

## Self-review

Scored honestly, 1–10:

| | |
| --- | --- |
| Gameplay loop | 8 — complete and closed; travel → deploy → extract → consequences all land |
| Shooting | 8 — stance now matters: crouch steadies, jumping ruins your aim, shoulder swap opens a corner |
| Squad AI | 7 — follows, covers, obeys six orders reliably, and routes around buildings |
| Troop persistence | 9 — the strongest system; history, wounds, promotion and permadeath all visible |
| Campaign pressure | 8 — wages, food, morale, desertion and pace make a company a decision rather than an accumulation |
| Strategic layer | 8 — real terrain, moving parties, contracts, legible consequences |
| Visual identity | 8 — cohesive and clearly retro military sci-fi, not a placeholder prototype |
| Atmosphere | 8 — fog, one hard key light, dry synthesised audio, restrained writing |
| UI | 8 — stamped and readable; the command wheel replaced a six-key memory test |
| Faction identity | 8 — five origins with their own rigs, stats, kit and prices; readable state borders |
| Encounter variety | 7 — seven layouts including two inhabited ones, plus a boss whose fight is a mechanic rather than a health bar; still no siege walls or vehicles |
| Polish | 8 — no dead buttons or fake features; animation now carries its weight |
| Stability | 9 — 59/59 tests green, soak deployments all resolve, zero console errors |
| Honesty of the numbers | 7 — every claim here is now a distribution, but combat variance is wide enough that some differences remain unresolvable at this sample size |

The most valuable find of the latest pass was not any of the new features. Every
site layout in this game hand-places its defenders and their patrol routes, and
`build()` never returned either of them — so `spawnGarrison()` had always fallen
through to its ring-of-six fallback and **no patrol had ever existed**. Every
location fought identically no matter what had been authored for it, which is
exactly the "most fights take place at the same similar scene" complaint that
sent me looking. Two lines of returned metadata turned seven hand-laid sites
from decoration into level design.

The most uncomfortable finding of the pass before it was not a crash. It was that a
measured claim in this README — that ordering suppression cut incoming damage by
35% — came from a single pair of trials and did not survive repetition. The
mechanic does work, but on enemy *behaviour*, not on a damage figure, and the
figure was quoted with a confidence the evidence never supported. Both probes
that produce numbers now run repeated trials and report spread; `tactics.mjs`
prints its own standard error and tells you when a difference is too small to
believe. That is the fix that mattered most, because a measurement you trust
wrongly is worse than no measurement.

Character animation was the weakest area at 6 and is now roughly an 8: knees and
elbows, a stance/swing gait, a real two-handed firing grip, directional movement
and a proper collapse. What is still missing is per-limb secondary motion —
no wrists or ankles, so feet do not roll through a step — and there is no
inverse kinematics, so a boot planted on a slope does not conform to it. Those
are the next things to attack.
