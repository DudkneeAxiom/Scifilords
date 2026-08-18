// Campaign simulation and persistence.
//
// Everything that survives a mission lives in this object. The renderer reads
// it; the mission layer hands results back to it. Keeping the simulation free
// of Three.js means the whole campaign can be stepped and tested headlessly.

import {
  LOCATIONS, MISSION_TYPES, FACTIONS, REGION, REGIONS, WEAPONS, KIT, ROLES, GOODS, GOODS_LIST,
  HOLDING_UPGRADES, UPGRADE_LIST, HOLDING_YIELD, TROOP_PATHS, RANKS, PARTY_TIERS, PARTY_TIER_LIST, renownTier,
  ARMOUR, ARMOUR_LIST, ORIGINS, originForLocation, CREEDS, REGARD_TIERS, FAVOURS,
  FIRST_NAMES, LAST_NAMES, POLICIES, POLICY_LIST, COMPANIONS, OFFICERS, RAPPORT, ERRANDS,
} from './data.js';
import {
  startingCompany, makeSoldier, dayTick, STATUS, deployable, addXp, maxHpOf,
  effective, WOUNDS, resolveCasualty,
} from './roster.js';
import { companyMods } from './perks.js';
import { travelFactor, clampToRegion, ROADS as ROADS_DATA } from './region.js';
import * as Dip from './diplomacy.js';
import { rng, pick, irange, range, clamp, uid, uidFloor, setUidFloor } from './util.js';

const SAVE_KEY = 'kettle_reach_save_v10';
const SAVE_VERSION = 10;

export function newCampaign(seed = Math.floor(Math.random() * 1e9)) {
  const r = rng(seed);
  const start = LOCATIONS.find((l) => l.id === 'vetch');
  const S = {
    seed,
    version: SAVE_VERSION,
    day: 1,
    hour: 7,
    credits: 480,
    supplies: 12,      // ammunition/consumable state, spent per deployment
    medical: 3,        // field kits — each one stabilises a casualty
    roster: startingCompany(r),
    // Weapons and kit the company owns but nobody is carrying. Counts, not
    // instances — there is no reason to track individual rifles.
    armoury: { smg: 1, shotgun: 1 },
    kitPool: { plate: 1 },
    armourPool: { head_light: 2, body_webbing: 2, legs_fatigues: 2 },
    cargo: {},          // trade goods in the truck
    prices: {},         // per-location price table, re-derived daily
    priceDay: -1,
    holdings: {},       // locId -> { upgrades, takenDay, threat }
    // Who holds a settlement NOW, when that is no longer whoever built it.
    // LOCATIONS carries the founding owner and is static module data shared by
    // every campaign, so it must never be written to; this overrides it.
    mapOwner: {},       // locId -> factionId
    // Bodies a place has left to give. Everyone draws from the same well —
    // you, and every faction column that musters here.
    manpower: {},       // locId -> people available now
    // The people who lead the factions' columns. They outlive their parties:
    // beat one and they turn up again with a new command.
    lords: [],          // { id, name, faction, defeats, wins, captured, freeDay }
    // Standing decisions, available once you carry your own flag.
    policies: {},       // policyId -> true
    renown: 0,          // how seriously the continent takes Bracket
    allegiance: null,   // faction id if the player has taken a commission
    ownFaction: null,   // { id, name, colour, declaredDay } once declared
    diplomacy: {},      // pairKey -> { state, until }
    prisoners: [],      // captured troops awaiting recruitment or release
    // A company is a payroll. Wages come out every day whether or not there was
    // work, which is what turns "recruit everybody" from an obvious move into a
    // decision — see payday().
    // Standing with individual PLACES, not factions. A settlement remembers
    // who took its contracts, who bought its goods and who robbed its road,
    // and it treats you accordingly — see relationOf().
    relations: {},      // locId -> -100..100
    morale: 70,         // 0..100. Pay them, feed them, win, and it holds.
    rations: 14,        // days of food in the truck
    unpaidDays: 0,      // how long they have gone without, for the record
    lastPayroll: 0,
    // Loot from the last engagement, held aside so the player sees it as
    // spoils on the equipment screen rather than silently absorbed.
    spoils: { credits: 0, cargo: {}, armoury: {}, armourPool: {}, kitPool: {} },
    pos: { x: start.x, z: start.z + 26 },
    dest: null,
    travelPath: null,
    atLocation: 'vetch',
    parties: [],
    contracts: [],
    events: [],
    rep: { trust: 0, syndic: 0 },
    world: {
      // Consequences the player can actually observe on the map.
      rampartMastDown: false,
      grellanCleared: false,
      perranHeld: false,
      trustPatrolDensity: 1.0,
      syndicPatrolDensity: 1.0,
      raiderDensity: 1.0,
    },
    stats: { missions: 0, kills: 0, lost: 0, recruited: 0 },
    log: [],
    seen: {},          // one-time tutorial/discovery flags
    finale: false,     // vertical-slice completion reached
  };
  seedContracts(S, r);
  // Fill out the rest of the board from the wider Reach.
  for (let i = 0; i < 3; i++) generateContract(S, r);
  seedParties(S, r);
  seedPrices(S);
  pushLog(S, 'Bracket makes camp outside Vetch Crossing. Four rifles, one truck, no retainer.');
  return S;
}

// --------------------------------------------------------------------------
// Log
// --------------------------------------------------------------------------

export function pushLog(S, text, tone = 'info') {
  S.log.unshift({ day: S.day, hour: Math.floor(S.hour), text, tone });
  if (S.log.length > 60) S.log.length = 60;
}

// --------------------------------------------------------------------------
// Roster queries
// --------------------------------------------------------------------------

export const living = (S) => S.roster.filter((s) => s.status !== STATUS.DEAD);
export const fallen = (S) => S.roster.filter((s) => s.status === STATUS.DEAD);
// Stationed at a holding, and therefore not on the truck. The posting lives on
// the soldier rather than in a list on the holding so it cannot desync: a
// garrisoned soldier who dies or is dismissed takes their posting with them.
export const stationed = (s) => !!s.garrison;
export const ready = (S) => living(S).filter((s) => deployable(s) && !stationed(s));
export const commander = (S) => S.roster.find((s) => s.isCommander);
export const hasMedic = (S) => ready(S).some((s) => s.role === 'medic');
export const awaitingAnyPerk = (S) =>
  S.roster.some((s) => s.status !== STATUS.DEAD && s.pendingPerks && s.pendingPerks.length);

// --------------------------------------------------------------------------
// Contracts
// --------------------------------------------------------------------------

// Prose for a generated posting, keyed by template. `%SITE%` is substituted.
const CONTRACT_FLAVOUR = {
  recovery: [
    {
      title: 'Missing Work Detail',
      text: 'A survey detail went into %SITE% to strip cable and did not come out. '
        + 'Whoever is holding that ground is still there. Bring back whoever is still breathing.',
    },
    {
      title: 'Personnel Recovery',
      text: 'Our people were taken off the road and are being held at %SITE%. '
        + 'They are worth more to us alive than anything else you could bring back.',
    },
    {
      title: 'They Kept The Wounded',
      text: 'When the column broke at %SITE% the walking got out. The ones who could not '
        + 'are still there. That was six days ago and we are done waiting for them to walk home.',
    },
  ],
  sabotage: [
    {
      title: 'Blind The Rim',
      text: '%SITE% coordinates every patrol above the basin. Put charges on the base and '
        + 'be gone before the response column arrives.',
    },
    {
      title: 'Break The Supply',
      text: 'Everything that moves through this quarter is staged at %SITE%. '
        + 'Take out the primary asset. We do not need it captured, we need it gone.',
    },
  ],
  defense: [
    {
      title: 'Hold The Line',
      text: 'A column is moving on %SITE% to enforce a seizure order. Stand in front of it '
        + 'until they decide the paperwork is not worth the casualties.',
    },
    {
      title: 'They Are Coming Tonight',
      text: 'We have maybe a day before they hit %SITE%. We can pay, we cannot fight. '
        + 'Be standing there when it starts.',
    },
  ],
  skirmish: [
    {
      title: 'Clear The Road',
      text: 'Something has made the road past %SITE% impassable and our haulage is sitting idle. '
        + 'Go and make it passable again.',
    },
  ],
};

const CONTRACT_TEMPLATES = [
  {
    type: 'recovery', site: 'grellan', employer: 'syndic',
    title: 'Missing Work Detail',
    text:
      'A Syndic survey detail went into the Grellan Array eight days ago to strip ' +
      'cable and did not come out. Scrappers hold the pylon housings. Bring back ' +
      'whoever is still breathing.',
    pay: 620, days: 6,
  },
  {
    type: 'sabotage', site: 'rampart', employer: 'syndic',
    title: 'Blind the North Rim',
    text:
      'Rampart Twelve coordinates every Trust patrol above the basin. Put charges ' +
      'on the mast base and be gone before the response column arrives.',
    pay: 780, days: 8,
  },
  {
    type: 'defense', site: 'perran', employer: 'syndic',
    title: 'The Reclaimer Must Turn',
    text:
      'A Trust column is moving on the Perran reclaimer to enforce a seizure order. ' +
      'Four thousand people drink from that stack. Hold the plant until they break off.',
    pay: 850, days: 10,
  },
  {
    type: 'recovery', site: 'grellan', employer: 'trust',
    title: 'Recover Trust Personnel',
    text:
      'Two of our inventory staff were taken off the northern road and are being ' +
      'held at the Array. They are carrying charter seals. Recover the people; ' +
      'the seals are secondary.',
    pay: 660, days: 6,
  },
  {
    type: 'defense', site: 'vetch', employer: null,
    title: 'Crossing Under Threat',
    text:
      'Scrappers have been massing south of the Crossing. The market pays in ' +
      'advance if you stand in the road when they arrive.',
    pay: 540, days: 5,
  },
];

function seedContracts(S, r) {
  // Open with exactly two, from opposing employers, so the very first strategic
  // decision is a real one rather than a queue to work through.
  S.contracts = [];
  addContract(S, CONTRACT_TEMPLATES[0], r);
  addContract(S, CONTRACT_TEMPLATES[1], r);
}

/**
 * A standing offer to take a place for yourself. Not a contract from anybody —
 * the reward is the ground.
 */
export function seizureOffer(S, locId) {
  const l = locById(locId);
  if (!l || isHolding(S, locId)) return null;
  if (!l.missions) return null;
  return {
    id: `seize_${locId}`,
    type: 'seize',
    site: locId,
    employer: null,
    seizure: true,
    title: `Take ${l.name}`,
    text: `Nobody is paying for this. Break whoever is holding ${l.name}, stand in it `
      + 'until it is yours, and it produces for Bracket from then on.',
    pay: 0,
    expiresDay: S.day + 999,
    accepted: false,
  };
}

/**
 * Build a posting for a random site/template pair. Locations declare which
 * templates they can host, so the same place offers a rescue this week and a
 * demolition the next.
 */
export function generateContract(S, r) {
  const sites = LOCATIONS.filter((l) => l.missions && l.missions.length);
  if (!sites.length) return null;
  // Prefer somewhere the player has no posting for already.
  const open = sites.filter((l) => !S.contracts.some((c) => c.site === l.id));
  const loc = pick(r, open.length ? open : sites);
  const type = pick(r, loc.missions);
  const flavours = CONTRACT_FLAVOUR[type];
  if (!flavours) return null;
  const f = pick(r, flavours);
  if (S.contracts.some((c) => c.title === f.title && c.site === loc.id)) return null;

  // Whoever is hiring is whoever does not own the ground — as it stands today,
  // not as it stood when the place was founded. A settlement Trust took last
  // month should have Syndic paying to get it back.
  let employer = null;
  const holder = ownerOf(S, loc.id);
  if (holder === 'trust') employer = 'syndic';
  else if (holder === 'syndic') employer = 'trust';
  else employer = pick(r, ['trust', 'syndic', null]);
  // Sworn companies mostly get work from their own side.
  if (S.allegiance && r() < 0.6) employer = S.allegiance;

  const basePay = { recovery: 620, sabotage: 780, defense: 850, skirmish: 520 }[type] || 600;
  // Distance from the company is worth paying for.
  const away = Math.hypot(loc.x - S.pos.x, loc.z - S.pos.z) / 400;
  const c = {
    id: uid('con'),
    type,
    site: loc.id,
    employer,
    title: f.title,
    text: f.text.replace(/%SITE%/g, loc.name),
    pay: Math.round(basePay * range(r, 0.9, 1.2) * (1 + away * 0.35)),
    days: 8,
    expiresDay: S.day + irange(r, 5, 11),
    accepted: false,
  };
  S.contracts.push(c);
  return c;
}

function addContract(S, tpl, r) {
  if (S.contracts.some((c) => c.title === tpl.title)) return null;
  const c = {
    id: uid('con'),
    ...tpl,
    pay: Math.round(tpl.pay * range(r, 0.9, 1.15)),
    expiresDay: S.day + tpl.days,
    accepted: false,
  };
  S.contracts.push(c);
  return c;
}

export function acceptContract(S, id) {
  const c = S.contracts.find((x) => x.id === id);
  if (!c) return;
  // One active contract at a time keeps the vertical slice legible.
  S.contracts.forEach((x) => { x.accepted = false; });
  c.accepted = true;
  pushLog(S, `Contract accepted: ${c.title}. Site: ${locName(c.site)}.`, 'good');
  // Taking an escort puts the convoy ON THE ROAD: it exists, it moves, and
  // from this moment the road can have it.
  if (c.type === 'escort' && !c.convoyId) {
    const r2 = rng((S.seed + S.day * 313 + c.id.length * 29) | 0);
    const from = locById(c.site);
    const p = spawnParty(S, r2, 'caravan', c.site);
    p.x = from.x + range(r2, -14, 14);
    p.z = from.z + range(r2, -14, 14);
    p.convoyTo = c.escortTo;
    p.name = 'Escorted convoy';
    c.convoyId = p.id;
    pushLog(S, `The convoy rolls out of ${from.name} for ${locName(c.escortTo)}.`, 'info');
  }
}

export const activeContract = (S) => S.contracts.find((c) => c.accepted) || null;
export const locName = (id) => LOCATIONS.find((l) => l.id === id)?.name || id;
export const locById = (id) => LOCATIONS.find((l) => l.id === id);

// --------------------------------------------------------------------------
// Parties — the thing that makes the map feel inhabited rather than drawn
// --------------------------------------------------------------------------

/** Which region a point on the continent falls in. Drives what spawns there. */
export function regionAt(x, z) {
  let best = REGIONS.kettle, bd = Infinity;
  for (const reg of Object.values(REGIONS)) {
    const d = Math.hypot(reg.centre.x - x, reg.centre.z - z);
    if (d < bd) { bd = d; best = reg; }
  }
  return best;
}

/** The named place closest to a point, for reporting things that happen out there. */
export const nearestLocation = (x, z) => LOCATIONS.reduce((best, l) => {
  const d = Math.hypot(l.x - x, l.z - z);
  return !best || d < best.d ? { ...l, d } : best;
}, null);

export const locationsIn = (regionId) =>
  LOCATIONS.filter((l) => (l.region || 'kettle') === regionId);

/**
 * Pick a party type appropriate to a region. This is the difficulty gradient:
 * the basin the player starts in produces looters and caravans, the faction
 * heartlands produce battle groups and armoured columns. A player who wanders
 * into the Littoral on day two will meet something that will kill them, and
 * the strength number on the marker tells them so before they commit.
 */
function partyTypeFor(r, region, faction = null) {
  const maxTier = clamp(region.danger + (r() < 0.25 ? 1 : 0), 1, 5);
  // A floor as well as a ceiling. Without it a danger-4 region drew looters as
  // often as columns and the far country ended up *safer* than the basin.
  const minTier = clamp(region.danger - 1, 1, 5);
  let pool = PARTY_TIER_LIST.filter((k) => {
    const t = PARTY_TIERS[k];
    // Player-owned types are fitted out, never found. Without this the world
    // spawned Bracket caravans as roadside traffic.
    if (t.owned || t.lair) return false;
    if (t.tier > maxTier || t.tier < minTier) return false;
    if (faction && t.faction !== faction) return false;
    return true;
  });
  if (!pool.length) {
    pool = PARTY_TIER_LIST.filter((k) => !PARTY_TIERS[k].owned && !PARTY_TIERS[k].lair
      && PARTY_TIERS[k].tier <= maxTier);
  }
  // Weight toward the top of the band so a dangerous region feels dangerous.
  const weighted = [];
  for (const k of pool) {
    const t = PARTY_TIERS[k].tier;
    const w = 1 + Math.max(0, t - minTier) * 2;
    for (let i = 0; i < w; i++) weighted.push(k);
  }
  return weighted.length ? pick(r, weighted) : 'looters';
}

/**
 * Put a Titan on the map, if the world is ready for one.
 *
 * Deliberately not part of the ordinary spawn table: partyTypeFor() clamps at
 * tier 5 so the walker can never turn up as routine traffic. It arrives as an
 * event — rarely, only out in the dangerous country, only once the company is
 * big enough that hearing about it is a temptation rather than a death notice,
 * and only ever one at a time.
 */
export function maybeSpawnTitan(S, r) {
  if (S.parties.some((p) => p.kind === 'titan')) return false;
  if ((S.renown || 0) < 500) return false;
  if (r() > 0.055) return false;
  const far = Object.values(REGIONS).filter((reg) => reg.danger >= 3);
  if (!far.length) return false;
  const reg = pick(r, far);
  const homes = LOCATIONS.filter((l) => l.region === reg.id);
  if (!homes.length) return false;
  const p = spawnParty(S, r, 'titan', pick(r, homes).id);
  pushLog(S,
    `Something is walking in ${reg.name}. The word for it is Titan.`, 'bad');
  return p;
}

/**
 * Hideouts.
 *
 * The road danger in this game was weather: parties appeared, you fought them
 * or avoided them, and more appeared. A hideout gives that a source — one
 * dug-in camp per dangerous region, which keeps producing raiders until
 * somebody goes and clears it. That turns "the north road is bad" from a fact
 * into a problem with an address.
 */
export function maybeSpawnLair(S, r) {
  for (const reg of Object.values(REGIONS)) {
    if (reg.danger < 2) continue;
    if (S.parties.some((p) => p.kind === 'lair'
      && (locById(p.home)?.region || 'kettle') === reg.id)) continue;
    if (r() > 0.05) continue;
    const homes = locationsIn(reg.id);
    if (!homes.length) continue;
    const p = spawnParty(S, r, 'lair', pick(r, homes).id);
    p.name = 'Scrapper Hideout';
    pushLog(S, `Something has dug in near ${locName(p.home)}. The road there will get worse.`, 'bad');
  }
}

/** A hideout throws out a raiding party every few days until it is cleared. */
export function tickLairs(S, r) {
  for (const lair of S.parties.filter((p) => p.kind === 'lair')) {
    if (S.day < (lair.nextBrood || 0)) continue;
    lair.nextBrood = S.day + irange(r, 3, 6);
    const kind = r() < 0.6 ? 'looters' : 'scrappers';
    const spawned = spawnParty(S, r, kind, lair.home);
    spawned.x = lair.x + range(r, -60, 60);
    spawned.z = lair.z + range(r, -60, 60);
    spawned.fromLair = lair.id;
  }
}

function seedParties(S, r) {
  S.parties = [];
  // The starting basin gets small, beatable things plus traffic worth robbing.
  // Work a four-person company can actually take. The basin used to hold two
  // looter bands and nothing below them, so a new outfit had no fight on the
  // map it could win and nothing to do but wait for a contract.
  spawnParty(S, r, 'strays', 'vetch');
  spawnParty(S, r, 'strays', 'grellan');
  spawnParty(S, r, 'strays', 'sump');
  spawnParty(S, r, 'strays', 'culvert');
  spawnParty(S, r, 'looters', 'grellan');
  spawnParty(S, r, 'looters', 'sump');
  spawnParty(S, r, 'scrappers', 'culvert');
  spawnParty(S, r, 'caravan', 'perran');
  spawnParty(S, r, 'refugees', 'sump');
  spawnParty(S, r, 'patrol_trust', 'dolmet');
  spawnParty(S, r, 'patrol_syndic', 'perran');
  // Deliberately not at Vetch: the player starts there, and a party spawning
  // in their lap makes the first thing that happens in the game a popup.
  spawnParty(S, r, 'merc', 'dolmet');

  // The wider continent, populated to its own danger level.
  for (const reg of Object.values(REGIONS)) {
    if (reg.id === 'kettle') continue;
    const homes = locationsIn(reg.id);
    if (!homes.length) continue;
    const n = 3 + Math.round(reg.danger * 0.8);
    for (let i = 0; i < n; i++) {
      spawnParty(S, r, partyTypeFor(r, reg), pick(r, homes).id);
    }
  }
}

// --------------------------------------------------------------------------
// The people who lead the columns
//
// Every faction party was an anonymous token: "Trust Patrol", one of nine,
// interchangeable and forgotten the moment it was beaten. Nothing that happened
// to it meant anything later, so the map was populated rather than inhabited.
//
// A lord outlives their command. Break their column and they are captured or
// they get away, and either way they come back — with a record of what has
// passed between you. That is what turns a a chase into a grudge, and a
// prisoner into somebody worth ransoming rather than a line of loot.
// --------------------------------------------------------------------------

const LORD_TIERS = 3;                        // tier at which a party rates a name

export const lordById = (S, id) => (S.lords || []).find((l) => l.id === id);
export const lordOfParty = (S, p) => (p?.lordId ? lordById(S, p.lordId) : null);

/**
 * Temperament: how a lord fights their war. `odds` multiplies the winning
 * chance a lord's party demands before it commits — LOWER is bolder, the
 * same direction as the grudge modifier. `host` scales the army a lord
 * raises when they march on a town. The line is how an encounter describes
 * them, because a reputation the player cannot read is not a reputation.
 */
export const TEMPERS = {
  martial: {
    id: 'martial', odds: 0.7, host: 1.15,
    line: 'has a name for pressing fights others would walk away from',
  },
  cautious: {
    id: 'cautious', odds: 1.45, host: 0.85,
    line: 'picks fights only when the arithmetic is comfortable',
  },
  rapacious: {
    id: 'rapacious', odds: 0.9, host: 1.0,
    line: 'is fed by what the road loses',
  },
  honorable: {
    id: 'honorable', odds: 1.15, host: 1.0,
    line: 'fights clean, and remembers those who do the same',
  },
};

/**
 * A lord's temperament, with a deterministic fallback for lords minted
 * before temperaments existed: derived from the name, so an old campaign's
 * lords each get ONE stable disposition rather than a reroll per read.
 */
export function temperOf(l) {
  if (l?.temper && TEMPERS[l.temper]) return TEMPERS[l.temper];
  const keys = Object.keys(TEMPERS);
  const h = (l?.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return TEMPERS[keys[h % keys.length]];
}

/** Somebody of this faction who is not currently in the field. */
function availableLord(S, r, faction) {
  const busy = new Set(S.parties.map((p) => p.lordId).filter(Boolean));
  const free = (S.lords || []).filter((l) => l.faction === faction
    && !busy.has(l.id) && !l.captured && S.day >= (l.freeDay || 0));
  if (free.length) return pick(r, free);
  // Nobody spare, so the faction commissions somebody new.
  const lord = {
    id: uid('lord'),
    name: `${pick(r, FIRST_NAMES)} ${pick(r, LAST_NAMES)}`,
    faction,
    // How they fight their war, fixed at commissioning.
    temper: pick(r, Object.keys(TEMPERS)),
    defeats: 0,          // times the player has broken their command
    wins: 0,             // times they have broken the player's
    captured: false,
    freeDay: 0,
  };
  S.lords = S.lords || [];
  S.lords.push(lord);
  return lord;
}

/**
 * What happens to a commander whose column is gone.
 *
 * Never simply deleted. A lord who dies every time their party is beaten makes
 * the faction a stream of strangers, which is the thing this is trying to fix.
 */
export function unhorseLord(S, r, party, { byPlayer }) {
  const lord = lordOfParty(S, party);
  if (!lord) return null;
  if (byPlayer) {
    lord.defeats++;
    // Beaten by your hand: personal, and remembered as such.
    lord.regard = clamp((lord.regard || 0) - 2, -10, 10);
  }
  // Taken, or away across country on foot. Being captured is the interesting
  // outcome and so it is the less likely one.
  if (byPlayer && r() < 0.35) {
    lord.captured = true;
    lord.heldByPlayer = true;
    lord.tookDay = S.day;
    // No automatic release date. A lord you are holding is leverage, and what
    // happens to them is the player's decision — see ransomLord/releaseLord.
    // They may still get out on their own; see tickHeldLords.
    lord.freeDay = 0;
    pushLog(S, `${lord.name} was taken alive. Their people will want them back.`, 'good');
  } else {
    lord.freeDay = S.day + irange(r, 6, 16);
    pushLog(S, `${lord.name} got away.`, byPlayer ? 'bad' : 'info');
  }
  return lord;
}

/**
 * What is left of a column after somebody breaks it.
 *
 * A destroyed party used to simply vanish from the list, so the war consumed
 * armies and produced nothing — the roads were exactly as dangerous the day
 * after a battle as the day before, and a faction offensive that got wrecked
 * left no trace on the country it was wrecked in. Survivors go to ground and
 * turn up as stragglers: weak, hostile to everybody, and somebody else's
 * problem now.
 *
 * Deliberately not certain and deliberately small. Every broken column
 * spawning a band would fill the map with debris faster than anyone could
 * clear it, and the trimming in maintainParties() would then quietly delete
 * the things the player was travelling toward.
 */
function scatterSurvivors(S, r, party) {
  if ((party.strength || 0) < 6) return null;      // too few to bother going to ground
  if (r() > 0.4) return null;
  const band = spawnParty(S, r, 'strays', party.home || 'grellan');
  band.x = party.x + range(r, -40, 40);
  band.z = party.z + range(r, -40, 40);
  band.strength = Math.max(2, Math.round(party.strength * range(r, 0.15, 0.3)));
  band.name = 'Stragglers';
  // They have no side any more. Whoever they were this morning, tonight they
  // are on the road with weapons and nothing to eat.
  band.faction = 'raider';
  band.baseHostile = true;
  band.hostileToPlayer = true;
  band.lordId = null;
  return band;
}

/** Lords the company is currently holding. */
export const heldLords = (S) => (S.lords || []).filter((l) => l.captured && l.heldByPlayer);

/**
 * What their people will pay to get them back.
 *
 * Scaled by what the lord is actually worth to them — somebody who has won on
 * the road repeatedly is a commander they want, and somebody the player has
 * broken three times is not. It is deliberately far more than a soldier's
 * ransom: this is the one thing on the map that pays for a hard fight.
 */
export function lordRansom(S, lord) {
  const standing = 1 + lord.wins * 0.35 - Math.min(0.5, lord.defeats * 0.12);
  return Math.round(900 * Math.max(0.5, standing));
}

/** Take their money. Their faction pays, and remembers being made to. */
export function ransomLord(S, id) {
  const lord = lordById(S, id);
  if (!lord || !lord.captured || !lord.heldByPlayer) return { ok: false, why: 'Not yours to sell' };
  const paid = lordRansom(S, lord);
  S.credits += paid;
  lord.captured = false;
  lord.heldByPlayer = false;
  // Back in the field shortly, and sore about it.
  lord.freeDay = S.day + 8;
  // Sold back like cargo. The faction pays; the person does not forget.
  lord.regard = clamp((lord.regard || 0) - 3, -10, 10);
  if (S.rep[lord.faction] != null) S.rep[lord.faction] -= 6;
  pushLog(S, `${lord.name} was ransomed back to `
    + `${FACTIONS[lord.faction]?.name || lord.faction} for ${paid} credits.`, 'good');
  return { ok: true, paid };
}

/** Let them go. Costs the money, buys the goodwill. */
export function releaseLord(S, id) {
  const lord = lordById(S, id);
  if (!lord || !lord.captured || !lord.heldByPlayer) return { ok: false, why: 'Not yours to release' };
  lord.captured = false;
  lord.heldByPlayer = false;
  lord.freeDay = S.day + 4;
  // Released without terms: a personal debt, distinct from the faction's
  // ledger, and the kind that changes what their column does on a road.
  lord.regard = clamp((lord.regard || 0) + 6, -10, 10);
  if (S.rep[lord.faction] != null) S.rep[lord.faction] += 8;
  S.morale = clamp((S.morale ?? 70) + 2, 0, 100);
  pushLog(S, `${lord.name} was released without terms. `
    + `${FACTIONS[lord.faction]?.name || lord.faction} will hear of it.`, 'good');
  return { ok: true };
}

/**
 * Captivity is not a locked box.
 *
 * A prisoner nobody has to make a decision about is just a number on a screen,
 * so holding one has to cost something — the longer they sit, the better their
 * chance of walking out, which is the pressure that turns "I have a hostage"
 * into "I should do something about my hostage".
 */
/**
 * Captives you have nobody to guard walk away.
 *
 * Prisoners accumulated with no pressure at all: taking them cost nothing to
 * keep, so the sensible play was to hoard a column of them until you happened
 * to pass a broker. Guarding people takes people, and a company carrying more
 * captives than it can watch loses them — which is what makes pressing,
 * ransoming or releasing a decision with a clock on it rather than an errand.
 *
 * Scaled against the roster rather than a flat number: four prisoners is
 * nothing to a company of twelve and impossible for a company of three.
 */
function tickPrisoners(S, r) {
  const held = S.prisoners?.length || 0;
  if (!held) return;
  const guards = Math.max(1, living(S).length);
  // Comfortably guarded up to a third of your strength; past that it slips.
  const strain = Math.max(0, held / guards - 0.34);
  if (strain <= 0) return;
  if (r() > Math.min(0.4, strain * 0.5)) return;
  // The last one taken is the one nobody has got round to searching properly.
  const [gone] = S.prisoners.splice(S.prisoners.length - 1, 1);
  pushLog(S, `${gone.name} slipped the guard in the night. Nobody saw which way.`, 'bad');
}

function tickHeldLords(S, r) {
  for (const l of heldLords(S)) {
    const held = S.day - (l.tookDay || S.day);
    if (held < 6) continue;
    if (r() < 0.035 + held * 0.004) {
      l.captured = false;
      l.heldByPlayer = false;
      l.freeDay = S.day + 3;
      pushLog(S, `${l.name} is gone. Somebody left a door unlocked.`, 'bad');
    }
  }
}

function spawnParty(S, r, kind, nearId) {
  const def = PARTY_TIERS[kind] || PARTY_TIERS.looters;
  const home = locById(nearId) || { x: 0, z: 0 };
  const strength = irange(r, def.strength[0], def.strength[1]);
  const p = {
    id: uid('pty'),
    kind,
    name: def.name,
    faction: def.faction,
    model: def.model,
    x: home.x + range(r, -90, 90),
    z: home.z + range(r, -90, 90),
    speed: def.speed,
    strength,
    tier: def.tier,
    quality: def.quality,
    armour: def.armour || 0,
    vehicles: def.vehicles || 0,
    // Raiders are always hostile; everyone else depends on politics, which is
    // re-evaluated as standing and wars change.
    baseHostile: !!def.hostile,
    hostileToPlayer: !!def.hostile,
    // Caravans are worth taking; everyone else is just in the way.
    cargo: def.cargo ? rollCargo(r, strength) : null,
    target: null,
    home: nearId,
    heading: r() * Math.PI * 2,
  };
  // Anything organised enough to be worth remembering gets somebody to lead it.
  // Raiders do not: a looter band is weather, and naming one would make every
  // scrap on the road feel like a duel with a rival.
  if (def.faction && def.faction !== 'raider' && (def.tier || 0) >= LORD_TIERS
    && !def.owned && !def.static) {
    const lord = availableLord(S, r, def.faction);
    p.lordId = lord.id;
    p.name = `${lord.name}'s ${def.name}`;
  }
  pickPartyTarget(S, r, p);
  S.parties.push(p);
  return p;
}

/** What a caravan is hauling, and therefore what looting it is worth. */
function rollCargo(r, strength) {
  const out = {};
  const n = 2 + Math.floor(strength / 6);
  for (let i = 0; i < n; i++) {
    const g = pick(r, GOODS_LIST);
    out[g] = (out[g] || 0) + irange(r, 2, 6);
  }
  return out;
}

function pickPartyTarget(S, r, p) {
  // Parties work their own region, so the map reads as inhabited territory
  // rather than everyone wandering the whole continent at random.
  const home = locById(p.home);
  const regionId = home?.region || 'kettle';
  let candidates = locationsIn(regionId);
  // Occasionally something travels between regions, which is what makes the
  // roads feel used and puts the odd column somewhere unexpected.
  if (r() < 0.12) candidates = LOCATIONS;
  candidates = candidates.filter((l) => l.id !== p.target);
  if (!candidates.length) candidates = LOCATIONS;
  const l = pick(r, candidates);
  p.target = l.id;
  p.tx = l.x + range(r, -70, 70);
  p.tz = l.z + range(r, -70, 70);
}

// --------------------------------------------------------------------------
// Time & travel
// --------------------------------------------------------------------------

// Continent scale: the map is three times the size it was, so the company
// covers ground three times faster in world units per hour.
export const TRAVEL_SPEED = 132;

/**
 * How fast the company actually moves, and why.
 *
 * A flat speed made the map a menu: nothing you did to your company changed
 * whether you could reach a contract in time, outrun a column, or catch a
 * caravan. Now it is the sum of the decisions you have already made — how many
 * people you are feeding, how loaded the truck is, whether they are fed at all,
 * and how many wounded you are carrying.
 *
 * Returns the multiplier plus the reasons, so the interface can explain itself
 * rather than just showing a number that mysteriously drops.
 */
export function partySpeed(S) {
  const people = living(S).length;
  const load = cargoUsed(S);
  const cap = CARGO_CAPACITY + depotCapacity(S);
  const wounded = living(S).filter((s) => !deployable(s)).length;
  const factors = [];

  // A small company moves at the pace of its truck; a big one at the pace of
  // the slowest person in it.
  let mul = 1;
  if (people > 6) {
    const f = -Math.min(0.34, (people - 6) * 0.028);
    mul += f;
    factors.push({ label: `${people} in the company`, effect: f });
  }
  // A loaded truck is a slow truck. This is what makes bulk trading a real
  // trade-off rather than free money.
  const loadFrac = cap > 0 ? load / cap : 0;
  if (loadFrac > 0.25) {
    const f = -Math.min(0.30, (loadFrac - 0.25) * 0.40);
    mul += f;
    factors.push({ label: `truck ${Math.min(100, Math.round(loadFrac * 100))}% loaded`, effect: f });
  }
  if (wounded > 0) {
    // Senna keeps the wounded fit to travel — half the drag, half the cap.
    const surgeon = hasOfficer(S, 'senna');
    const f = -Math.min(surgeon ? 0.11 : 0.22, wounded * (surgeon ? 0.025 : 0.05));
    mul += f;
    factors.push({
      label: `${wounded} carried wounded${surgeon ? ' — Senna keeps them moving' : ''}`,
      effect: f,
    });
  }
  if (hasOfficer(S, 'vex')) {
    mul += 0.08;
    factors.push({ label: 'Vex knows the passes', effect: 0.08 });
  }
  // Hungry people walk slowly, and cheerful ones push on.
  if ((S.rations || 0) <= 0) {
    mul -= 0.18;
    factors.push({ label: 'nobody has eaten', effect: -0.18 });
  }
  const morale = S.morale ?? 70;
  if (morale >= 85) { mul += 0.08; factors.push({ label: 'devoted company', effect: 0.08 }); }
  else if (morale < 25) { mul -= 0.12; factors.push({ label: 'morale is shot', effect: -0.12 }); }

  mul = clamp(mul, 0.42, 1.25);
  return { mul, speed: TRAVEL_SPEED * mul, factors, people, load, cap, wounded };
}

/**
 * Advance the world by `hours`. Called continuously while the player travels
 * and in chunks when they wait or use a service.
 */
export function advanceTime(S, hours) {
  const r = rng((S.seed + Math.floor(S.day * 24 + S.hour)) | 0);
  S.hour += hours;
  while (S.hour >= 24) {
    S.hour -= 24;
    S.day++;
    onNewDay(S, rng((S.seed + S.day * 7919) | 0));
  }
  moveParties(S, hours, r);
  tickPartyBattles(S, hours, r);
}

function onNewDay(S, r) {
  maybeSpawnTitan(S, r);
  payday(S, r);
  // World events: own stream, same reason as diplomacy below.
  tickMapEvents(S, rng((S.seed ^ 0xe7e7) + S.day * 131));
  // The continent gets on with its own argument whether or not you are in it.
  //
  // On streams of their own, NOT the shared day-tick `r`. Every draw taken from
  // that stream shifts every draw after it, so bolting new systems onto it
  // silently re-rolls payday, desertion and everything else downstream — which
  // is precisely the trap diplomacy was moved off it to avoid. It shows up as
  // an unrelated test failing intermittently rather than as anything obviously
  // to do with the new code.
  tickWar(S, rng((S.seed ^ 0x7717) + S.day * 3301));
  tickManpower(S, rng((S.seed ^ 0x2b19) + S.day * 4409));
  tickTorching(S, rng((S.seed ^ 0x70c4) + S.day * 947));
  tickFactionRecruiting(S, rng((S.seed ^ 0x51ad) + S.day * 5171));
  tickRaids(S, rng((S.seed ^ 0x6c33) + S.day * 6113));
  // Captivity ends. A lord held indefinitely is a lord removed from the game,
  // and the point of taking one is that they come back knowing who took them.
  //
  // Only for lords the PLAYER is not holding: those are a decision the player
  // owns, and releasing them on a timer behind their back would take the
  // hostage — and the choice — straight back off them again.
  for (const l of S.lords || []) {
    if (l.captured && !l.heldByPlayer && S.day >= (l.freeDay || 0)) {
      l.captured = false;
      pushLog(S, `${l.name} has been ransomed home.`, 'info');
    }
  }
  tickHeldLords(S, rng((S.seed ^ 0x3d71) + S.day * 7717));
  tickPrisoners(S, rng((S.seed ^ 0x1f5b) + S.day * 8221));
  // Held companions come home one way or another: broken out by the player,
  // or ransomed at a captor's price after twelve days — if the ledger can
  // stand it. A company too broke to pay leaves them sitting.
  for (const c of [...(S.captives || [])]) {
    if (S.day - c.sinceDay < 12) continue;
    if (S.credits < 600) continue;
    S.credits -= 600;
    S.roster.push(c.soldier);
    S.captives = S.captives.filter((x) => x !== c);
    S.contracts = S.contracts.filter((x) => x.rescue !== c.soldier.id);
    pushLog(S, `${c.soldier.name} was ransomed home for 600 credits. They walked in thinner.`, 'world');
  }
  // A summons outlives its column if the column was broken on the road rather
  // than arriving. The call still went out and you still did not answer it, but
  // the contract has to go or it sits on the board forever pointing at an army
  // that no longer exists.
  for (const c of S.contracts.filter((x) => x.summons)) {
    if (!S.parties.some((p) => p.id === c.summons)) {
      closeSummons(S, c.summons, { showedUp: false });
    }
  }
  // Where the company actually is. S.atLocation is written only by the world
  // map renderer, so headlessly it is stuck on wherever the campaign started
  // and every simulated day healed at that place's rate no matter where the
  // company had got to. Position first, the field as a fallback.
  const restingAt = locationAt(S, 38) || locById(S.atLocation);
  const atMedical = !!restingAt?.services?.includes('medical');
  const mods = companyMods(S.roster);
  for (const s of S.roster) {
    const rec = dayTick(s, {
      atMedical,
      healMul: 1 + mods.healRate + upgradeTotal(S, 'infirmary')
        // Senna's whole pitch: a hab quarter of four thousand through two sieges.
        + (hasOfficer(S, 'senna') ? 0.5 : 0),
    });
    if (rec) pushLog(S, `${s.name} is fit for deployment again.`, 'good');
  }
  // Expire and replenish contracts so the board is never empty or stale.
  const before = S.contracts.length;
  S.contracts = S.contracts.filter((c) => c.accepted || c.expiresDay > S.day);
  if (S.contracts.length < before) pushLog(S, 'A contract lapsed on the board.');
  // A bigger Reach wants a fuller board — the player should be choosing
  // between postings, not taking the only one available.
  while (S.contracts.length < 5) {
    const c = generateContract(S, r);
    if (!c) break;
    pushLog(S, `New posting at ${locName(c.site)}: ${c.title}.`);
  }
  maybeEscortContract(S, rng((S.seed ^ 0xe5c0) + S.day * 677));
  // Workshop stalls pay their day's take. Logged weekly, not daily — a
  // ledger line every morning is noise, not income.
  let stallTake = 0;
  for (const wid of Object.keys(S.workshops || {})) {
    stallTake += workshopIncome(S, wid);
  }
  if (stallTake > 0) {
    S.credits += stallTake;
    if (S.day % 7 === 0) {
      pushLog(S, `The stalls paid ${stallTake} today. The week has been like that.`, 'good');
    }
  }
  // A convoy that stopped existing on the road did not arrive. The failure
  // is the contract's, and the town that lost the load remembers whose
  // escort it was under.
  for (const c of [...S.contracts]) {
    if (c.type !== 'escort' || !c.convoyId) continue;
    if (S.parties.some((p) => p.id === c.convoyId)) continue;
    S.contracts = S.contracts.filter((x) => x.id !== c.id);
    if (c.accepted) {
      changeRelation(S, c.escortTo, -4);
      pushLog(S, `The convoy for ${locName(c.escortTo)} never arrived. The escort's name travels with the loss.`, 'bad');
    }
  }
  // Patrol densities drift back toward normal — sabotage buys time, not permanence.
  S.world.trustPatrolDensity = clamp(S.world.trustPatrolDensity + 0.06, 0, 1.2);
  S.world.syndicPatrolDensity = clamp(S.world.syndicPatrolDensity + 0.05, 0, 1.2);

  tickResentment(S, r);
  tickFavours(S, r);
  // The truck's own weather: bonds, feuds, and personal asks. Own streams —
  // see the note above about the shared day-tick rng.
  tickRapport(S, rng((S.seed ^ 0x4a9d) + S.day * 1249));
  maybeErrands(S, rng((S.seed ^ 0x1c57) + S.day * 2083));
  tickGrudge(S);
  maybeSpawnLair(S, r);
  tickLairs(S, r);
  tickCaravans(S, r);
  maintainParties(S, r);
  collectHoldings(S);
  tickHoldingThreat(S, r);
  // Its own stream, deliberately. Every system added to the day tick draws
  // from the shared generator, so politics would quietly re-roll every time
  // something new was bolted on — which is exactly how a stable test starts
  // failing for reasons nobody changed.
  Dip.tickDiplomacy(S, rng((S.seed ^ 0x5150) + S.day * 2803), (text, tone) => pushLog(S, text, tone));
  refreshHostility(S);
}

/**
 * Politics decides who shoots at you. A Trust patrol is just traffic until the
 * Trust is at war with whoever you are — then it is a threat on the road.
 */
export function refreshHostility(S) {
  for (const p of S.parties) {
    // Your own hauliers are never a target for you.
    if (p.owner === 'player') { p.hostileToPlayer = false; continue; }
    p.hostileToPlayer = p.baseHostile || Dip.isHostileToPlayer(S, p.faction);
  }
}

function maintainParties(S, r) {
  // Keep every region populated to roughly its danger level. The continent has
  // to stay busy without the party list growing without bound.
  for (const reg of Object.values(REGIONS)) {
    const homes = locationsIn(reg.id);
    if (!homes.length) continue;
    const want = reg.id === 'kettle'
      ? Math.round(6 * (S.world.raiderDensity + S.world.trustPatrolDensity) / 2)
      : 3 + Math.round(reg.danger * 0.8);
    // A column on its way somewhere is never culled. Trimming picks whatever is
    // furthest from the player, which is exactly where an offensive on the far
    // side of the continent is — so without this, columns quietly vanish
    // mid-march and the war simply stops arriving anywhere, with nothing in the
    // log to say why.
    const here = S.parties.filter((p) => !p.owner && p.kind !== 'lair' && !p.siegeTarget
      && (locById(p.home)?.region || 'kettle') === reg.id);
    if (here.length < want) {
      spawnParty(S, r, partyTypeFor(r, reg), pick(r, homes).id);
    } else if (here.length > want + 2) {
      // Trim the one furthest from the player so nothing vanishes on screen.
      // Never anyone mid-battle or marching to one: culling a combatant makes
      // the fight's other half win by garbage collection.
      const victim = here.slice().filter((p) => !p.battle && !p.reinforce)
        .sort((a, b) =>
          Math.hypot(b.x - S.pos.x, b.z - S.pos.z) - Math.hypot(a.x - S.pos.x, a.z - S.pos.z))[0];
      if (victim) S.parties = S.parties.filter((p) => p !== victim);
    }
  }
}

// --------------------------------------------------------------------------
// Parties fighting each other
//
// The map's bands used to be blind to everything except the player: a raider
// walked past a Trust patrol as if neither existed, which quietly said the
// whole world was scenery arranged around one company. Now hostile parties
// that meet FIGHT — slowly, in world time, so a battle is an event on the map
// with a before (reinforcements marching toward it), a during (the player can
// arrive, watch, or pick a side), and an after (a battlefield you can pick
// over). Nobody waits for the player.
// --------------------------------------------------------------------------

const BATTLE_RANGE = 42;        // close enough that a meeting becomes a fight
const REINFORCE_RANGE = 300;    // how far the sound of one carries
const BATTLE_BREAK = 0.4;       // a party routs below this share of its start

/** May this party be drawn into a field battle at all? */
function canFieldBattle(p) {
  const def = PARTY_TIERS[p.kind] || {};
  // Hideouts do not march, walkers are a problem for a different scale of
  // answer, the player's caravans have their own being-taken rule, and
  // empty-handed refugees have nothing to stand and fight with.
  return !def.static && !def.boss && !p.owner && (p.strength || 0) > 0;
}

function partyPower(p) {
  return Math.max(1, p.strength) * (p.quality || 0.7)
    * (1 + (p.armour || 0) * 0.25 + (p.vehicles || 0) * 0.15);
}

function sideOf(battle, p) {
  return battle.a.includes(p.id) ? 'a' : battle.b.includes(p.id) ? 'b' : null;
}

function joinBattle(S, battle, p, side) {
  battle[side].push(p.id);
  battle.starts[p.id] = p.strength;
  p.battle = battle.id;
  p.reinforce = null;
  p.chasing = false;
  p.target = null;
}

/** Every member party of one side, still alive and still in it. */
function sideParties(S, battle, side) {
  return battle[side].map((id) => S.parties.find((p) => p.id === id))
    .filter((p) => p && p.battle === battle.id);
}

function routParty(S, battle, p) {
  p.battle = null;
  p.routed = 20;                 // hours of running before anything else matters
  p.routFrom = { x: battle.x, z: battle.z };
  p.target = null;
}

function tickMapBattles(S, hours, r) {
  S.mapBattles = S.mapBattles || [];
  S.mapSites = S.mapSites || [];
  const destroyed = new Set();

  // New meetings. O(n^2) over a few dozen parties, once per world tick.
  for (let i = 0; i < S.parties.length; i++) {
    for (let j = i + 1; j < S.parties.length; j++) {
      const a = S.parties[i], b = S.parties[j];
      if (a.battle || b.battle || !canFieldBattle(a) || !canFieldBattle(b)) continue;
      if (!partiesHostile(S, a, b)) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) > BATTLE_RANGE) continue;
      const battle = {
        id: uid('btl'), x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
        a: [], b: [], starts: {}, hours: 0,
      };
      joinBattle(S, battle, a, 'a');
      joinBattle(S, battle, b, 'b');
      S.mapBattles.push(battle);
      // Only worth telling the player about if they could plausibly have
      // seen or heard it — a feed of distant skirmishes is noise, not news.
      if (Math.hypot(battle.x - S.pos.x, battle.z - S.pos.z) < 420) {
        pushLog(S, `${a.name} and ${b.name} are fighting near ${nearestLocName(S, battle.x, battle.z)}.`);
      }
    }
  }

  // Reinforcement: anyone hostile to one side of a live battle marches on it.
  for (const p of S.parties) {
    if (p.battle || p.reinforce || p.routed || p.owner) continue;
    if ((PARTY_TIERS[p.kind] || {}).static || (p.strength || 0) <= 0) continue;
    for (const battle of S.mapBattles) {
      if (Math.hypot(p.x - battle.x, p.z - battle.z) > REINFORCE_RANGE) continue;
      const aP = sideParties(S, battle, 'a')[0];
      const bP = sideParties(S, battle, 'b')[0];
      if (!aP || !bP) continue;
      if (partiesHostile(S, p, aP) !== partiesHostile(S, p, bP)) {
        p.reinforce = battle.id;
        break;
      }
    }
  }

  // The fights themselves: attrition in world time, deliberately slow enough
  // that arriving at one mid-way is a real possibility.
  for (const battle of S.mapBattles) {
    const aSide = sideParties(S, battle, 'a');
    const bSide = sideParties(S, battle, 'b');
    if (!aSide.length || !bSide.length) continue;   // settled by the filter below
    battle.hours += hours;
    const powA = aSide.reduce((t, p) => t + partyPower(p), 0);
    const powB = bSide.reduce((t, p) => t + partyPower(p), 0);
    // Each side's losses scale with the other's power. The divisor sets the
    // pace: a ten-a-side fight runs four to eight hours — long enough that
    // marching to the sound of it is a real option, for everyone.
    const hurt = (side, enemyPow) => {
      for (const p of side) {
        const loss = (enemyPow / 16) * hours * (0.6 + r() * 0.8)
          / Math.max(1, side.length);
        p.strength = Math.max(0, p.strength - loss);
        if (p.strength <= 1 || p.strength <= battle.starts[p.id] * BATTLE_BREAK) {
          if (p.strength <= 2) {
            // Broken outright. Their lord is unhorsed by somebody else's hand,
            // and what is left of them takes to the road on foot.
            unhorseLord(S, r, p, { byPlayer: false });
            scatterSurvivors(S, r, p);
            p.battle = null;
            destroyed.add(p.id);
          } else {
            routParty(S, battle, p);
            p.strength = Math.max(1, Math.round(p.strength));
          }
        }
      }
    };
    hurt(aSide, powB);
    hurt(bSide, powA);
  }
  if (destroyed.size) S.parties = S.parties.filter((p) => !destroyed.has(p.id));
  S.mapBattles = S.mapBattles.filter((btl) => {
    const aAlive = sideParties(S, btl, 'a');
    const bAlive = sideParties(S, btl, 'b');
    if (aAlive.length && bAlive.length) return true;
    // Over: whoever still stands holds the field, and the field remembers.
    finishBattle(S, btl, aAlive.length ? aAlive : bAlive, r);
    return false;
  });

  // Battlefields fade: salvage is picked over by other hands than yours.
  S.mapSites = S.mapSites.filter((site) => S.day < site.expiresDay);
}

function finishBattle(S, battle, winners, r) {
  for (const p of winners) {
    p.battle = null;
    p.strength = Math.max(1, Math.round(p.strength));
    const lord = lordOfParty(S, p);
    if (lord) lord.wins++;
  }
  const winName = winners[0]?.name || 'Nobody';
  pushLog(S, `${winName} holds the field near ${nearestLocName(S, battle.x, battle.z)}.`);
  // What a fight leaves behind: wreckage worth stopping for, for a few days.
  S.mapSites.push({
    id: uid('site'), kind: 'battlefield', x: battle.x, z: battle.z,
    day: S.day, expiresDay: S.day + 3 + Math.floor(r() * 3),
    loot: {
      credits: 40 + Math.floor(r() * 160),
      salvage: 1 + Math.floor(r() * 3),
    },
  });
}

function nearestLocName(S, x, z) {
  let best = null, bd = Infinity;
  for (const l of LOCATIONS) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < bd) { bd = d; best = l; }
  }
  return best ? best.name : 'the open Reach';
}

// How far off a band notices the company, and how fast it moves once it has.
//
// Patrol speeds are 21-23 against a company that travels at 55-165, so before
// this a raider could not have caught the player if it had wanted to — and
// nothing in here wanted to, because nothing ever looked at where the player
// was. The road was weather: bands drifted between locations and you collided
// with them or you did not.
//
// PURSUIT_SPEED sits deliberately inside the company's own range. A lean
// company outruns anything on the map; a full truck, carried wounded and an
// unfed roster does not. That makes speed something you spend rather than a
// number you have, and it is the reason to drop cargo and run.
const PURSUIT_SIGHT = 190;
const PURSUIT_SPEED = 86;
// Give up once they are this far behind — otherwise a band trails the player
// across the continent forever and the map turns into one long chase.
const PURSUIT_GIVE_UP = 300;
// How close to a location counts as being under its protection. Comfortably
// wider than the 38 at which entering a location is offered, so the company is
// safe from the moment the place is a realistic destination rather than only
// once it has arrived.
const PURSUIT_SANCTUARY = 55;

/**
 * Does this band want the company, want away from it, or neither?
 *
 * Judged on the same numbers the fight itself resolves on, so a band that
 * closes is one that genuinely fancies its chances. Looters are cowards by
 * design — the tier description says they run if it goes against them, and
 * until now nothing made that true on the map.
 */
/**
 * How bad a fight a band will pick, as the chance it needs to commit.
 *
 * Not one threshold for everybody. Scavengers at the bottom of the map are
 * desperate and will take a fight they are likely to lose, which is exactly
 * why they are the thing that harasses a new company — and they are beatable,
 * so that harassment is a fight worth having rather than a death sentence.
 * Organised bands want real odds before they commit.
 *
 * Tuned against the numbers rather than guessed: a starting company of four
 * rates 0.64 against a five-strong looter band, so anything demanding better
 * than a third of a chance leaves the early map as inert as it was.
 */
const BOLDNESS = { strays: 0.16, looters: 0.20, scrappers: 0.28, deserters: 0.12 };
const BOLDNESS_DEFAULT = 0.42;

export function partyIntent(S, p, squad) {
  if (!p.hostileToPlayer) return 'patrol';
  // Nobody presses an attack up to a settlement's gate. A location has people
  // in it and usually a garrison, and a band that would take on four mercenaries
  // on an empty road will not do it in front of a town.
  //
  // This is also what stops a settlement becoming a trap. Without it a band that
  // chased the company into town waits outside, and closing the settlement panel
  // drops the player straight into an encounter — every time, on the doorstep,
  // with the map still paused behind the new panel.
  // Deliberately derived from position, not from S.atLocation. That field is
  // maintained by the world map renderer and nothing else, so it is only true
  // while the map is on screen: it starts life as 'vetch' and stays that way
  // for the whole of any headless run, which turns this line into "no band ever
  // chases anybody". A rule the simulation depends on cannot be owned by the
  // view.
  if (locationAt(S, PURSUIT_SANCTUARY)) return 'patrol';
  // Regard is personal and it is mechanical: a lord released without terms
  // does not hunt the company that let them walk, and one ransomed back like
  // cargo presses harder than the odds alone would say.
  const lord = lordOfParty(S, p);
  if (lord && (lord.regard || 0) >= 5) return 'patrol';
  const d = Math.hypot(p.x - S.pos.x, p.z - S.pos.z);
  if (d > (p.chasing ? PURSUIT_GIVE_UP : PURSUIT_SIGHT)) return 'patrol';
  if (!squad.length) return 'chase';
  const { odds } = estimateFight(S, squad, p);
  // estimateFight reports the COMPANY's chance, so theirs is what is left.
  const theirs = 1 - odds;
  let bold = BOLDNESS[p.kind] ?? BOLDNESS_DEFAULT;
  if (lord && (lord.regard || 0) <= -5) bold *= 0.7;   // grudges take worse odds
  // Temperament is the standing version of the same dial: a martial lord
  // accepts odds a cautious one walks away from.
  if (lord) bold *= temperOf(lord).odds;
  if (theirs > bold) return 'chase';
  // Well under what they would accept: not merely uninterested, but actively
  // getting out of the way. This is the tier description made true — looters
  // are written as running if it goes against them.
  if (theirs < bold * 0.45) return 'flee';
  return 'patrol';
}

// How far a garrison's reputation carries. Wider than pursuit sight: the point
// of holding ground is that trouble stops coming near it, which you should be
// able to see on the map as raiders giving the place a wide berth.
const HOLDING_WATCH = 165;

/**
 * The nearest holding of yours this band wants no part of.
 *
 * Compared band-strength against garrison, so deterrence is relative: four
 * soldiers behind wire clear the looters out of a valley and do not trouble a
 * Titan. This is the visible half of a garrison — the half you can watch
 * happening from the map rather than read in a number on a panel.
 */
function holdingDeterrent(watched, p) {
  if (!watched.length) return null;
  const theirs = Math.max(1, p.strength || 4) * (p.quality || 0.7) * 1.15;
  let best = null, bd = HOLDING_WATCH;
  for (const w of watched) {
    if (w.strength <= theirs * 0.85) continue;
    const d = Math.hypot(w.loc.x - p.x, w.loc.z - p.z);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

function moveParties(S, hours, r) {
  // Resolved once, not once per band: every hostile party asks the same
  // question about the same company, and this runs on every world tick.
  const squad = ready(S).slice(0, deployLimit(S));
  // Likewise the garrisons. garrisonStrength() walks the roster and rebuilds
  // the company's perk mods, so asking it per band per tick would make the
  // world clock scale with parties times holdings.
  const watched = holdingList(S)
    .map(({ id, loc }) => ({ loc, strength: garrisonStrength(S, id) }))
    .filter((w) => w.strength > 0);

  for (const p of S.parties) {
    // A hideout is a place, not a patrol.
    if (PARTY_TIERS[p.kind]?.static) continue;

    // Standing and fighting: a battle holds its combatants where they met.
    if (p.battle) continue;

    // Routed: nothing matters except away. Faster than a patrol amble, for
    // long enough that the winner keeps the field.
    if (p.routed > 0) {
      const ax = p.x - (p.routFrom?.x ?? p.x), az = p.z - (p.routFrom?.z ?? p.z);
      const ad = Math.hypot(ax, az) || 1;
      const step = Math.max(p.speed, 30) * 1.4 * hours * travelFactor(p.x, p.z);
      const to = clampToRegion(p.x + (ax / ad) * step, p.z + (az / ad) * step);
      p.x = to.x; p.z = to.z;
      p.heading = Math.atan2(ax, az);
      p.routed -= hours;
      if (p.routed <= 0) { p.routed = 0; p.target = null; }
      continue;
    }

    // Marching to the sound: a reinforcing party closes on its battle and
    // joins whichever side it is not hostile to.
    if (p.reinforce) {
      const battle = (S.mapBattles || []).find((x) => x.id === p.reinforce);
      if (!battle) { p.reinforce = null; } else {
        const dx = battle.x - p.x, dz = battle.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < 26) {
          const aP = battle.a.map((id) => S.parties.find((q) => q.id === id))
            .find((q) => q && q.battle === battle.id);
          if (aP) joinBattle(S, battle, p, partiesHostile(S, p, aP) ? 'b' : 'a');
          else p.reinforce = null;
        } else {
          const step = Math.min(d, Math.max(p.speed, 26) * 1.2 * hours * travelFactor(p.x, p.z));
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          p.heading = Math.atan2(dx, dz);
        }
        continue;
      }
    }

    // An army on the march has somewhere to be.
    //
    // Deliberately ahead of both the pursuit and the deterrence branches: a
    // column that wanders off to chase the player, or shies away from a
    // garrison, is not an offensive, and the war would never arrive anywhere.
    if (p.siegeTarget) {
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 14) {
        resolveSiege(S, p);
        pickPartyTarget(S, r, p);             // back to ordinary soldiering
      } else {
        const step = Math.min(d, p.speed * hours);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        p.heading = Math.atan2(dx, dz);
      }
      continue;
    }

    // An escorted convoy: one road, one destination, pay on delivery. It is
    // a party like any other — raiders predate it, battles catch it — which
    // is the entire product being sold when someone hires an escort.
    if (p.convoyTo) {
      const dest = locById(p.convoyTo);
      const dx = dest.x - p.x, dz = dest.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 26) {
        deliverConvoy(S, p);
      } else {
        const step = Math.min(d, p.speed * hours * travelFactor(p.x, p.z));
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        p.heading = Math.atan2(dx, dz);
      }
      continue;
    }

    // Somebody else's ground, held by people who can hold it. A band that would
    // otherwise be hunting the company gives the place a wide berth instead,
    // which is what a garrison is FOR: not winning the fight, but the fight not
    // being offered.
    const scaredOff = p.hostileToPlayer ? holdingDeterrent(watched, p) : null;
    if (scaredOff) {
      const ax = p.x - scaredOff.loc.x, az = p.z - scaredOff.loc.z;
      const ad = Math.hypot(ax, az) || 1;
      const step = Math.min(HOLDING_WATCH - ad + 8, p.speed * 1.6 * hours);
      if (step > 0) {
        p.x += (ax / ad) * step;
        p.z += (az / ad) * step;
        p.heading = Math.atan2(ax, az);
        p.chasing = false;
        p.target = null;
        continue;
      }
    }

    const intent = partyIntent(S, p, squad);
    p.chasing = intent === 'chase';
    if (intent !== 'patrol') {
      const sx = S.pos.x - p.x, sz = S.pos.z - p.z;
      const sd = Math.hypot(sx, sz) || 1;
      // Toward the company, or directly away from it.
      const sign = intent === 'chase' ? 1 : -1;
      const speed = intent === 'chase' ? PURSUIT_SPEED : Math.max(p.speed, PURSUIT_SPEED * 0.8);
      const step = Math.min(intent === 'chase' ? sd : Infinity,
        speed * hours * travelFactor(p.x, p.z));
      // Fleeing is the one intent that walks a straight line AWAY from
      // something, so it is the one that can march a band up into the rim —
      // the same fence that holds the company holds them.
      const fled = clampToRegion(
        p.x + (sx / sd) * step * sign, p.z + (sz / sd) * step * sign);
      p.x = fled.x;
      p.z = fled.z;
      p.heading = Math.atan2(sx * sign, sz * sign);
      // Their patrol route is stale once they break off; pick a fresh one when
      // they next settle rather than snapping back to where they were headed.
      p.target = null;
      continue;
    }

    // A manhunt overrides everything below: the hunter closes on its named
    // quarry across any distance until the hunt expires, the quarry dies, or
    // they meet — at which point the battle system takes it from here.
    if (p.hunting) {
      const quarry = S.parties.find((q) => q.id === p.hunting);
      if (!quarry || quarry.battle || S.day > (p.huntingUntil || 0)) {
        p.hunting = null;
      } else {
        const dx = quarry.x - p.x, dz = quarry.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = Math.min(d, Math.max(p.speed, 26) * 1.25 * hours * travelFactor(p.x, p.z));
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        p.heading = Math.atan2(dx, dz);
        continue;
      }
    }

    // Predation is what makes parties MEET. A raider stalks the nearest
    // weaker non-raider within sight; a faction band runs down raiders it
    // outmatches. Without this, thirty parties on a six-kilometre map simply
    // never pass within meeting range of each other — forty days of world
    // ran without one battle before it existed.
    if (canFieldBattle(p)) {
      let quarry = null, qd = 300;
      for (const q of S.parties) {
        if (q.battle || !canFieldBattle(q) || !partiesHostile(S, p, q)) continue;
        if (partyPower(p) < partyPower(q) * 0.85) continue;   // prey on the weaker
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < qd) { qd = d; quarry = q; }
      }
      if (quarry) {
        const dx = quarry.x - p.x, dz = quarry.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = Math.min(d, Math.max(p.speed, 24) * 1.15 * hours * travelFactor(p.x, p.z));
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        p.heading = Math.atan2(dx, dz);
        p.stalking = quarry.id;
        continue;
      }
      p.stalking = null;
    }

    if (!p.target) { pickPartyTarget(S, r, p); continue; }
    const dx = p.tx - p.x, dz = p.tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 6) { pickPartyTarget(S, r, p); continue; }
    // Everyone is subject to the same ground. If only the company paid for
    // slope, a chase across a range would be decided by which side the rule
    // applied to rather than by anything the player did.
    const step = Math.min(d, p.speed * hours * travelFactor(p.x, p.z));
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    p.heading = Math.atan2(dx, dz);
  }
}

/**
 * Can the company break contact with this band?
 *
 * Withdrawing used to be free and certain: the panel always offered it, it
 * always worked, and so a fight was never actually forced on the player. You
 * could meet anything, decline, and drive away — which meant losing a battle
 * was something you had to opt into, and the capture rules that exist for
 * losing one could essentially never fire.
 *
 * Now it is contested by the same numbers as a pursuit on the open map: your
 * pace against theirs, over the ground you are standing on. A lean company
 * outruns looters; a full truck being chased by a fast column does not.
 */
export function escapeChance(S, party) {
  const mine = partySpeed(S).speed * travelFactor(S.pos.x, S.pos.z);
  // What they can do when they actually want you, not their patrol amble.
  const theirs = Math.max(party.speed || 20, PURSUIT_SPEED)
    * travelFactor(party.x ?? S.pos.x, party.z ?? S.pos.z);
  // Never certain in either direction. Getting away should always be possible
  // and never something you can count on without the speed to back it.
  return clamp(0.15 + (mine / (mine + theirs)) * 1.1 - 0.25, 0.1, 0.92);
}

/** Parties close enough to interact with right now. */
export function nearbyParties(S, radius = 34) {
  return S.parties.filter((p) => Math.hypot(p.x - S.pos.x, p.z - S.pos.z) < radius);
}

export function locationAt(S, radius = 34) {
  return LOCATIONS.find((l) => Math.hypot(l.x - S.pos.x, l.z - S.pos.z) < radius) || null;
}

// --------------------------------------------------------------------------
// Mission results → strategic consequences
// --------------------------------------------------------------------------

/**
 * Fold a completed deployment back into the campaign. This is the hinge the
 * whole design turns on: if the mission does not visibly change the map, the
 * strategic layer is decoration.
 */
/**
 * Send the squad in without you.
 *
 * Wages come out every day, which means the company needs to fight often — and
 * a five-minute deployment for six looters is a tax on the player's evening,
 * not a decision. So you can hand the fight to your sergeants.
 *
 * It is deliberately WORSE than doing it yourself. Nobody is on the ground
 * making the call, so the company fights at three-quarters of its real strength
 * and takes casualties it would not have taken with you there. That is the
 * whole trade: your time against your soldiers' lives.
 *
 * Crucially this produces the same shape of result object that a played mission
 * does and hands it to applyMissionResult, so XP, wounds, permadeath, spoils,
 * renown and prisoners all come out of one code path. An autoresolve that had
 * its own consequence logic would drift away from the real one within a week.
 */
export function estimateFight(S, squad, party) {
  const mods = companyMods(S.roster);
  let power = 0;
  for (const s of squad) {
    const e = effective(s, mods);
    // Accuracy and staying power, weighted the way they actually matter.
    power += (e.accuracy * 1.35 + e.maxHp / 130) * (1 + s.rank * 0.22);
  }
  // Nobody is in command on the ground.
  power *= 0.75;
  const enemy = Math.max(1, (party?.strength || 4)) * (party?.quality || 0.75) * 1.15;
  const odds = clamp(power / (power + enemy), 0.03, 0.97);
  return { power: +power.toFixed(1), enemy: +enemy.toFixed(1), odds };
}

export function autoResolve(S, spec, squad) {
  const party = spec.party || null;
  const r = rng((S.seed + S.day * 613 + S.stats.missions * 29 + squad.length) | 0);
  const { odds } = estimateFight(S, squad, party);
  const success = r() < odds;

  // How badly it went for the people who went. Losing multiplies the risk to
  // everybody; winning still costs somebody something more often than not.
  // Tuned against tools/autoresolve.mjs. Winning should usually cost bruises
  // and occasionally cost somebody; losing is where people actually die.
  const danger = success ? (1 - odds) * 0.40 : 0.28 + (1 - odds) * 0.38;
  const strength = party?.strength || 4;

  const soldierResults = [];
  let kills = 0;
  for (const s of squad) {
    const e = effective(s, companyMods(S.roster));
    // Kills are shared out by how good they are, not evenly.
    const share = success ? strength / Math.max(1, squad.length) : strength * 0.35 / Math.max(1, squad.length);
    const k = Math.max(0, Math.round(share * (0.55 + e.accuracy) * (0.6 + r() * 0.8)));
    kills += k;

    const roll = r() * (1 - clamp(e.cover, 0, 0.6));
    let status = STATUS.READY;
    let hp = s.maxHp;
    let wound = null;
    if (roll < danger * 0.12) {
      // Nobody was there to drag them out — with the commander present this
      // would have been a stabilise, not a burial.
      status = STATUS.DEAD;
      hp = 0;
    } else if (roll < danger) {
      status = STATUS.WOUNDED;
      hp = Math.max(1, Math.round(s.maxHp * (0.25 + r() * 0.35)));
      wound = pick(r, WOUNDS);
    } else {
      hp = Math.max(1, Math.round(s.maxHp * (0.55 + r() * 0.45)));
    }
    soldierResults.push({ id: s.id, kills: k, status, hp, wound });
  }

  return {
    success,
    auto: true,
    site: spec.site,
    type: spec.type,
    party,
    partyId: party?.id || null,
    kills,
    soldierResults,
    suppliesUsed: Math.max(1, Math.round(squad.length * 0.6)),
    outcome: success ? 'auto-win' : 'auto-loss',
  };
}

export function applyMissionResult(S, res) {
  const r = rng((S.seed + S.day * 31 + S.stats.missions * 17) | 0);
  // The pit does not maim anybody. Whatever happened in there, everyone walks
  // out of it — that promise is the entire reason the pit is worth having, so
  // it is enforced here rather than trusted to the mission layer.
  if (res.type === 'pit') {
    for (const rec of res.soldierResults || []) {
      rec.status = STATUS.HEALTHY;
      rec.wound = null;
      const s = S.roster.find((x) => x.id === rec.id);
      if (s) rec.hp = Math.max(1, Math.round(s.maxHp * 0.5));
    }
  }
  S.stats.missions++;
  S.stats.kills += res.kills || 0;
  const notes = [];

  // --- personnel ---
  for (const rec of res.soldierResults || []) {
    const s = S.roster.find((x) => x.id === rec.id);
    if (!s) continue;
    s.deployments++;
    s.kills += rec.kills || 0;
    if (rec.status === STATUS.DEAD) {
      s.status = STATUS.DEAD;
      s.hp = 0;
      S.stats.lost++;
      notes.push({ tone: 'bad', text: `${s.name} was killed at ${locName(res.site)}.` });
      pushLog(S, `${s.name} did not come back from ${locName(res.site)}.`, 'bad');
    } else {
      s.status = rec.status;
      s.wound = rec.wound || s.wound;
      s.hp = Math.max(1, rec.hp ?? s.hp);
      if (rec.status === STATUS.WOUNDED) {
        notes.push({ tone: 'warn', text: `${s.name} is wounded: ${s.wound?.name || 'in recovery'}.` });
      }
      const xp = (rec.kills || 0) * 25 + (res.success ? 90 : 35) + 20;
      const promo = addXp(s, xp, r);
      if (promo) {
        notes.push({
          tone: 'good',
          text: `${s.name} is promoted to ${promo.name}${s.pendingPerks ? ' — a training choice is waiting' : ''}.`,
        });
        pushLog(S, `${s.name} promoted to ${promo.name}.`, 'good');
      }
    }
  }

  if (res.lostPrisoners) {
    notes.push({
      tone: 'bad',
      text: `${res.lostPrisoners} of the people you were sent for did not survive the recovery.`,
    });
  }

  // --- recruits found in the field ---
  for (const rec of res.recruits || []) {
    S.roster.push(rec);
    S.stats.recruited++;
    notes.push({ tone: 'good', text: `${rec.name} (${rec.joinedHow}) has joined Bracket.` });
    pushLog(S, `${rec.name} signed on with Bracket at ${locName(res.site)}.`, 'good');
  }

  // --- payment & materiel ---
  const mods = companyMods(S.roster);
  const c = activeContract(S);
  // Remembered before the payment block consumes the contract: an answered
  // siege summons has territorial consequences handled further down.
  const summons = (res.success && c && c.site === res.site && c.summons)
    ? { column: c.summons, employer: c.employer } : null;
  if (res.success && c && c.site === res.site) {
    // A liege pays its own people better than it pays hired help.
    const liegeBonus = (S.allegiance && c.employer === S.allegiance) ? 1.35 : 1;
    const paid = Math.round(c.pay * mods.payMul * liegeBonus);
    S.credits += paid;
    // A rescue pays in a person, not a number — no zero-credit note.
    if (paid > 0) notes.push({ tone: 'good', text: `Contract paid: ${paid} credits.` });
    // The prison break: the one they kept walks out with you.
    if (c.rescue) {
      const cap = (S.captives || []).find((x) => x.soldier.id === c.rescue);
      if (cap) {
        S.roster.push(cap.soldier);
        S.captives = S.captives.filter((x) => x !== cap);
        S.morale = clamp((S.morale ?? 70) + 6, 0, 100);
        notes.push({ tone: 'good', text: `${cap.soldier.name} walks out with the company. Nobody gets left.` });
        pushLog(S, `${cap.soldier.name} was broken out of ${locName(res.site)}.`, 'good');
      }
    }
    if (c.employer) {
      S.rep[c.employer] = (S.rep[c.employer] || 0) + 2;
      const other = c.employer === 'trust' ? 'syndic' : 'trust';
      S.rep[other] = (S.rep[other] || 0) - 1;
    }
    S.contracts = S.contracts.filter((x) => x.id !== c.id);
    // The place you did the work for remembers it.
    changeRelation(S, c.site, 6);
  }
  if (res.loot?.credits) {
    const salvage = Math.round(res.loot.credits * mods.lootMul);
    S.credits += salvage;
    notes.push({ tone: 'good', text: `Recovered ${salvage} credits of salvage.` });
  }
  for (const w of res.loot?.weapons || []) {
    S.armoury[w] = (S.armoury[w] || 0) + 1;
    notes.push({
      tone: 'good',
      text: `Recovered a weapon: ${WEAPONS[w]?.name || w}. It is in the armoury.`,
    });
  }
  // Everything stripped off the field by hand. Kept separate from the objective
  // payout above, because what you carried off a position you fought across is
  // a different kind of reward from what the contract paid — and the player
  // should be able to see which was which.
  const carried = [];
  for (const [pool, label] of [['armoury', 'weapon'], ['armourPool', 'armour'], ['kitPool', 'kit']]) {
    for (const [id, n] of Object.entries(res.loot?.[pool] || {})) {
      if (!n) continue;
      addSpoils(S, pool, id, n);
      carried.push(`${n > 1 ? `${n}x ` : ''}${WEAPONS[id]?.name || ARMOUR[id]?.name || KIT[id]?.name || id}`);
      S.stats.looted = (S.stats.looted || 0) + n;
    }
  }
  if (carried.length) {
    notes.push({
      tone: 'good',
      text: `Stripped off the field: ${carried.join(', ')}. Waiting on the equipment screen.`,
    });
  }
  S.supplies = Math.max(0, S.supplies - Math.round((res.suppliesUsed || 2) * mods.supplyMul));
  S.medical = Math.max(0, S.medical - (res.medicalUsed || 0));

  // --- territory ---
  // An answered summons, won: the town falls to the liege with Bracket first
  // through the breach. Without this, a successful assault left the map
  // unchanged until the column happened to arrive and "take" a town the
  // player had already taken — and the column then marched into its own
  // conquest as if nothing had happened. The column garrisons what it took.
  if (res.success && summons && (res.type === 'siege' || res.type === 'defense')) {
    if (res.type === 'siege') {
      if (!isHolding(S, res.site) && ownerOf(S, res.site) !== summons.employer) {
        S.mapOwner[res.site] = summons.employer;
        notes.push({
          tone: 'world',
          text: `${locName(res.site)} has fallen to ${FACTIONS[summons.employer]?.name
            || summons.employer} — Bracket was first through the breach.`,
        });
        pushLog(S, `${locName(res.site)} taken. Bracket answered the call.`, 'good');
      }
    } else {
      // The assault broke on the walls: the town stands, the column does not.
      notes.push({
        tone: 'world',
        text: `${locName(res.site)} held. The column that marched on it is finished.`,
      });
      pushLog(S, `${locName(res.site)} held against the assault. Bracket was inside the walls.`, 'good');
    }
    S.parties = S.parties.filter((p) => p.id !== summons.column);
    S.rep[summons.employer] = (S.rep[summons.employer] || 0) + 3;
    notes.push({ tone: 'good', text: 'The liege noted who was on the field. Standing rises.' });
  }

  if (res.type === 'seize') {
    if (res.success && seizeLocation(S, res.site)) {
      notes.push({
        tone: 'world',
        text: `${locName(res.site)} belongs to Bracket. It will produce for you every day, `
          + 'and it can be built up with credits and the goods in your truck.',
      });
    } else if (!res.success) {
      notes.push({ tone: 'bad', text: `${locName(res.site)} held. The garrison is still there.` });
    }
  }
  if (res.retake) {
    if (res.success) {
      const h = S.holdings[res.retake];
      if (h) h.threat = 0;
      notes.push({ tone: 'good', text: `${locName(res.retake)} held. The attack has broken off.` });
      S.contracts = S.contracts.filter((c) => c.retake !== res.retake);
    } else {
      loseHolding(S, res.retake);
      S.contracts = S.contracts.filter((c) => c.retake !== res.retake);
      notes.push({ tone: 'bad', text: `${locName(res.retake)} has been taken from you.` });
    }
  }

  // The pit pays by the round whether you walked out or were carried, so it
  // sits OUTSIDE the success gate. Nested inside it, every run that did not
  // clear the whole card paid nothing — which is exactly the case the pit
  // exists to cover.
  // --- the pit: paid by the round, win or lose ---
  if (res.type === 'pit') {
    const rounds = res.pitRounds || 0;
    // Rising per round, because round six is a different proposition from
    // round one and the purse should say so.
    const purse = Math.round(rounds * 90 * (1 + rounds * 0.11));
    S.credits += purse;
    const up = addRenown(S, Math.round(rounds * 4));
    if (up) notes.push({ tone: 'good', text: `Bracket is ${up.name}.` });
    notes.push({
      tone: rounds > 0 ? 'good' : 'warn',
      text: rounds > 0
        ? `${rounds} round(s) in the pit. Purse: ${purse} credits.`
        : 'Put down in the first round. The crowd got its money back.',
    });
    // The stake on the commander, taken at the door and settled here. Three
    // to one, and ONLY for clearing the whole card — the by-the-round purse
    // above is the consolation; the wager is the tournament bet.
    if (res.wager > 0) {
      if (res.success) {
        const won = res.wager * 3;
        S.credits += won;
        notes.push({ tone: 'good', text: `The book paid the stake: ${won} credits, three to one.` });
        pushLog(S, `The commander cleared the card with money riding on it. ${won} credits.`, 'good');
      } else {
        notes.push({ tone: 'bad', text: `The stake is the book's now: ${res.wager} credits gone.` });
      }
    }
    // A commander who fights in front of the town is a commander people talk
    // about, and the company likes working for somebody like that.
    if (rounds >= 3) {
      changeRelation(S, res.site, Math.min(10, rounds));
      S.morale = clamp((S.morale ?? 70) + 3, 0, 100);
    }
    S.stats.pitRounds = Math.max(S.stats.pitRounds || 0, rounds);
  }

  // --- world consequences, and they must be legible ---
  if (res.success) {
    if (res.type === 'lair' && res.partyId) {
      const lair = S.parties.find((p) => p.id === res.partyId);
      const spoils = spoilsFor(S, lair, (res.soldierResults || []).length);
      clearLair(S, res.partyId);
      S.spoils.credits += spoils.credits;
      const up = addRenown(S, Math.round(spoils.renown * 1.4));
      if (up) notes.push({ tone: 'good', text: `Bracket is ${up.name}.` });
      notes.push({
        tone: 'good',
        text: 'The hideout is gone. The road it was feeding will quieten down.',
      });
    }

    if (res.type === 'skirmish' && res.partyId) {
      const party = S.parties.find((p) => p.id === res.partyId);
      companyReacts(S, 'win');
      // Winning is the cheapest morale there is.
      S.morale = clamp((S.morale ?? 70) + 6, 0, 100);
      const spoils = spoilsFor(S, party || res.party, (res.soldierResults || []).length);
      // If these were the people who took the company, everything they were
      // carrying comes back before the party is swept off the map.
      const won = settleGrudge(S, res.partyId);
      if (won) {
        notes.push({
          tone: 'good',
          text: `${won.who} is finished. ${won.credits} credits`
            + `${won.arms ? ` and ${won.arms} weapons` : ''} back where they belong.`,
        });
      }
      // Whoever was leading it is taken or gets clear, and either way they
      // remember it was you. This is what makes beating the same column twice
      // different from beating two columns once.
      const beaten = unhorseLord(S, rng((S.seed + S.day * 149 + S.stats.missions) | 0),
        party, { byPlayer: true });
      if (beaten) {
        notes.push({
          tone: beaten.captured ? 'good' : 'world',
          text: beaten.captured
            ? `${beaten.name} is your prisoner. Their people will want them back.`
            : `${beaten.name} broke off and got away. That is ${beaten.defeats} now.`,
        });
      }
      // The band you just fought is gone from the map. Immediate, visible.
      S.parties = S.parties.filter((p) => p.id !== res.partyId);
      addSpoils(S, 'credits', null, spoils.credits);
      notes.push({
        tone: 'world',
        text: `The road is clear. ${spoils.credits} credits taken off the bodies.`,
      });

      // Anything they were hauling is now yours, up to what the truck will hold.
      if (spoils.cargo) {
        const took = [];
        for (const [g, n] of Object.entries(spoils.cargo)) {
          addSpoils(S, 'cargo', g, n);
          took.push(`${n} ${GOODS[g]?.name || g}`);
        }
        if (took.length) notes.push({ tone: 'good', text: `Cargo taken: ${took.join(', ')}.` });
      }
      // Stripped off the bodies: weapons and armour, scaled to how many fell.
      const sr = rng((S.seed + S.day * 977 + S.stats.missions * 13) | 0);
      // Brik opens the lockers the rest of the company walks past.
      const strip = Math.max(1, Math.round((party?.strength || 4) * 0.16))
        + (hasOfficer(S, 'brik') ? 1 : 0);
      res.fieldSpoils = res.fieldSpoils || [];
      for (let i = 0; i < strip; i++) {
        if (sr() < 0.45) {
          const w = pick(sr, ['rifle', 'smg', 'shotgun', 'dmr']);
          addSpoils(S, 'armoury', w);
          res.fieldSpoils.push({ kind: 'weapon', id: w });
        } else {
          const a = pick(sr, ARMOUR_LIST);
          addSpoils(S, 'armourPool', a);
          res.fieldSpoils.push({ kind: 'armour', id: a });
        }
      }
      notes.push({
        tone: 'good',
        text: `Weapons and armour stripped from the field — waiting on the equipment screen.`,
      });

      // Survivors who threw down their weapons.
      if (spoils.prisoners > 0) {
        const pr = rng((S.seed + S.day * 61 + S.stats.missions) | 0);
        res.captives = res.captives || [];
        for (let i = 0; i < spoils.prisoners; i++) {
          const captiveOf = party?.faction || null;
          const cap = Object.assign(makeSoldier(pr, {
            role: pick(pr, ['rifleman', 'rifleman', 'breacher', 'marksman']),
            how: `Taken prisoner on the road, day ${S.day}`,
            day: S.day,
            avoid: S.roster.map((x) => x.name),
          }), { captiveFaction: captiveOf });
          S.prisoners.push(cap);
          res.captives.push(cap.id);
        }
        notes.push({
          tone: 'good',
          text: `${spoils.prisoners} prisoner(s) taken. They can be pressed into the company from the roster.`,
        });
      }

      const up = addRenown(S, spoils.renown);
      notes.push({ tone: 'world', text: `Renown +${spoils.renown}.` });
      if (up) {
        notes.push({
          tone: 'world',
          text: `Bracket is ${up.name} — you can now deploy ${deployLimit(S)} into the field.`,
        });
      }
      pushLog(S, 'Broke a hostile party on the road.', 'good');
    }
    // --- a raid: goods now, and a place that will remember it ---
    if (res.type === 'raid') {
      const took = res.raidTaken || 0;
      const r2 = rng((S.seed + S.day * 811 + took) | 0);
      let credits = 0;
      // Tally by good rather than per store, so a raid that pulled the same
      // thing twice reads as one line instead of two.
      const haul = {};
      for (let i = 0; i < took; i++) {
        credits += irange(r2, 260, 520);
        const g = pick(r2, GOODS_LIST);
        const n = irange(r2, 2, 5);
        addSpoils(S, 'cargo', g, n);
        haul[g] = (haul[g] || 0) + n;
      }
      const goods = Object.entries(haul).map(([g, n]) => `${n} ${GOODS[g].name}`);
      S.spoils.credits += credits;
      notes.push({
        tone: 'good',
        text: `Carried out of ${locName(res.site)}: ${credits} credits`
          + `${goods.length ? `, ${goods.join(', ')}` : ''}.`,
      });

      // This is the whole cost of it. A raided settlement will not sell to you
      // and will not put anyone forward, for a long time.
      changeRelation(S, res.site, -45);
      // Whoever holds it now is who takes offence, not whoever founded it.
      const holder = ownerOf(S, res.site);
      if (holder) {
        S.rep[holder] = (S.rep[holder] || 0) - 8;
        notes.push({ tone: 'bad', text: `${FACTIONS[holder].name} will hear about this.` });
      }
      // Soldiers know what they just did.
      S.morale = clamp((S.morale ?? 70) - 3, 0, 100);
      companyReacts(S, 'raid');
      pushLog(S, `Bracket raided ${locName(res.site)}.`, 'bad');
    }

    if (res.type === 'sabotage' && res.site === 'rampart') {
      S.world.rampartMastDown = true;
      S.world.trustPatrolDensity = 0.25;
      S.parties = S.parties.filter((p) => p.faction !== 'trust' || Math.random() > 0.6);
      notes.push({
        tone: 'world',
        text: 'Rampart 12 is off the air. Trust patrol coverage across the north rim has collapsed.',
      });
      pushLog(S, 'The northern rim has gone quiet. Trust patrols are not being coordinated.', 'good');
    }
    if (res.type === 'recovery' && res.site === 'grellan') {
      S.world.grellanCleared = true;
      S.world.raiderDensity = 0.4;
      notes.push({
        tone: 'world',
        text: 'The Array nest is broken. Scrapper activity across the east has thinned.',
      });
      pushLog(S, 'Scrappers have abandoned the Grellan pylons.', 'good');
    }
    if (res.type === 'defense' && res.site === 'perran') {
      S.world.perranHeld = true;
      S.rep.syndic += 3;
      notes.push({
        tone: 'world',
        text: 'The Perran reclaimer is still turning. The Flats will open their roster to you.',
      });
      pushLog(S, 'Perran Flats held. The council is speaking well of Bracket.', 'good');
    }
  } else {
    notes.push({ tone: 'bad', text: 'The contract was not completed. Word travels.' });
    if (c) S.rep[c.employer] = (S.rep[c.employer] || 0) - 2;

    // Being wiped or losing the commander is not the same as pulling out. An
    // orderly withdrawal costs you the contract; being broken on the field
    // costs you everything you were carrying and a fortnight.
    if ((res.reason === 'wiped' || res.reason === 'commander') && res.type !== 'pit') {
      const captor = res.enemyFaction || locById(res.site)?.faction || 'raider';
      const taken = captureCompany(S, captor,
        rng((S.seed + S.day * 977 + (S.stats.missions || 0) * 17) | 0));
      notes.push({
        tone: 'bad',
        text: `The company was taken. ${taken.days} days gone, ${taken.credits} credits`
          + `${taken.arms.length ? ' and the weapons off the truck' : ''} with them.`
          + (taken.where ? ` You were put out on the road near ${taken.where}.` : ''),
      });
      if (taken.freed) {
        notes.push({ tone: 'bad', text: `The prisoners you were carrying walked out with them.` });
      }
      res.captured = taken;
    }
  }

  // Service to a liege is remembered, and rewarded with ground.
  //
  // This used to fire exactly once in a career and hand over whichever
  // settlement happened to sit first in the location table — so serving a
  // faction was a single event rather than a ladder, and the ground you were
  // given had no relationship to where you had been fighting. A liege that can
  // only ever reward you once is not somebody you have a career with.
  if (res.success && S.allegiance && c && c.employer === S.allegiance) {
    S.service = (S.service || 0) + 1;
    const granted = (S.fiefs || []).length;
    // Each grant costs more service than the last: the first is a reward, the
    // fourth is a marcher lordship and has to be earned.
    const needed = fiefServiceFor(granted);
    if (S.service >= needed) {
      // A liege can only grant ground it actually still holds.
      const candidates = LOCATIONS.filter((l) => ownerOf(S, l.id) === S.allegiance
        && !isHolding(S, l.id) && l.missions);
      // The ground nearest where the company actually operates, because a fief
      // on the far side of the continent is a chore rather than a reward.
      candidates.sort((a, b) =>
        Math.hypot(a.x - S.pos.x, a.z - S.pos.z) - Math.hypot(b.x - S.pos.x, b.z - S.pos.z));
      const grant = candidates[0] || null;
      if (grant) {
        S.fiefs = S.fiefs || [];
        S.fiefs.push(grant.id);
        S.service = 0;
        S.holdings[grant.id] = {
          upgrades: {}, takenDay: S.day, threat: 0, formerFaction: null, granted: true,
        };
        notes.push({
          tone: 'world',
          text: `${FACTIONS[S.allegiance].name} has granted Bracket ${grant.name} for its service`
            + `${granted ? ` — the ${['second', 'third', 'fourth', 'fifth'][granted] || 'next'} holding they have put in your charge.` : '.'}`,
        });
        pushLog(S, `${grant.name} granted to Bracket by charter.`, 'good');
      }
    }
  }

  // Contract work builds a name too, just more slowly than beating a column.
  if (res.success && res.type !== 'skirmish') {
    const gain = { recovery: 30, sabotage: 40, defense: 45, seize: 80 }[res.type] || 25;
    const up = addRenown(S, gain);
    notes.push({ tone: 'world', text: `Renown +${gain}.` });
    if (up) {
      notes.push({
        tone: 'world',
        text: `Bracket is ${up.name} — you can now deploy ${deployLimit(S)} into the field.`,
      });
    }
  }

  // Deployment takes most of a day.
  advanceTime(S, 6);

  // Vertical-slice end state: enough has happened that the larger game is visible.
  if (!S.finale && S.stats.missions >= 3 && S.stats.recruited >= 1) {
    S.finale = true;
    notes.push({
      tone: 'world',
      text:
        'Bracket is now a name people in the Reach use. Both parties have started ' +
        'asking what you would charge for something larger.',
    });
  }
  return notes;
}

// --------------------------------------------------------------------------
// Settlement services
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Manpower
//
// A settlement used to produce a fresh list of recruits every day, out of
// nowhere, for the player alone. Nobody else drew on it and nothing you did
// used it up, so hiring was a shop with infinite stock and the factions raised
// their armies from thin air.
//
// One well, and everyone drinks from it. You hire and the town has that many
// fewer people; a Trust column musters here and the town has fewer still. In
// peace it refills faster than anyone drains it, so ordinary recruiting is
// unaffected — war is what makes bodies scarce, and a region that has been
// fought over is a region with nobody left to sell you.
// --------------------------------------------------------------------------

const MANPOWER_CAP = { settlement: 14, outpost: 8, ruin: 5, wild: 4 };
// How often a band can hit the same place, and how long that place is too busy
// burying people to put anybody forward. Between them these decide whether a
// hideout left alone is an inconvenience or a slow disaster: raids that only
// take bodies are undone by the next few days of regrowth, so the pause is what
// actually makes an unchecked lair ruin the country around it.
const RAID_EVERY = 5;
const RAID_SHOCK = 3;

export function manpowerCap(loc) {
  if (!loc || loc.kind === 'open') return 0;
  return MANPOWER_CAP[loc.kind] ?? 6;
}

/** People available at a place right now. Older saves start full. */
export function manpowerAt(S, locId) {
  if (!S.manpower) S.manpower = {};
  if (S.manpower[locId] == null) S.manpower[locId] = manpowerCap(locById(locId));
  return S.manpower[locId];
}

/** Take up to `n`, and report how many were actually there. */
export function drawManpower(S, locId, n) {
  const have = manpowerAt(S, locId);
  const took = Math.max(0, Math.min(have, n));
  S.manpower[locId] = have - took;
  return took;
}

function tickManpower(S, r) {
  for (const l of LOCATIONS) {
    const cap = manpowerCap(l);
    if (!cap) continue;
    const have = manpowerAt(S, l.id);
    if (have >= cap) continue;
    // A place that was raided in the last few days is not recruiting anybody.
    if (S.day - (S.raided?.[l.id] ?? -99) < RAID_SHOCK) continue;
    // A barracks is somewhere to put people you have raised, so your own ground
    // refills faster. Everywhere else recovers at its own pace.
    const barracks = S.holdings?.[l.id]?.upgrades?.barracks || 0;
    // Conscription takes people off your own ground faster than they can be
    // replaced: the garrisons fill and the hiring board empties, which is the
    // whole trade. Only on ground you hold — you cannot conscript somebody
    // else's town.
    const conscript = hasPolicy(S, 'conscription') && isHolding(S, l.id) ? -0.6 : 0;
    // A settlement recovers at the pace of the hamlets that feed it. Torched
    // feeders are the strategic point of the village tier: burn the fields
    // and the garrison stops refilling, without a shot at the wall.
    const feed = feederScale(S, l);
    S.manpower[l.id] = Math.max(0, Math.min(cap,
      have + (1 + barracks * 0.5) * feed + conscript));
  }
}

/** The hamlets within reach of a settlement, and how many still stand. */
export function feedersOf(locId) {
  const l = locById(locId);
  if (!l || l.kind !== 'settlement') return [];
  return LOCATIONS.filter((v) => v.kind === 'hamlet'
    && Math.hypot(v.x - l.x, v.z - l.z) < 260);
}

export function feederScale(S, l) {
  if (l.kind !== 'settlement') return 1;
  const feeders = feedersOf(l.id);
  if (!feeders.length) return 1;
  const razed = feeders.filter((v) => S.day - (S.razed?.[v.id] ?? -99) < 15).length;
  return Math.max(0.25, 1 - razed * 0.4);
}

/**
 * Raiders torch what they can reach: a hamlet with a raider band near it
 * can burn, and the settlement it feeds recovers slower for a fortnight.
 * The log says so, because a fact the player cannot read is not a fact.
 */
function tickTorching(S, r) {
  for (const v of LOCATIONS) {
    if (v.kind !== 'hamlet') continue;
    if (S.day - (S.razed?.[v.id] ?? -99) < 15) continue;
    const raider = S.parties.some((p) => p.faction === 'raider'
      && Math.hypot(p.x - v.x, p.z - v.z) < 200);
    if (!raider || r() > 0.12) continue;
    S.razed = S.razed || {};
    S.razed[v.id] = S.day;
    pushLog(S, `${v.name} is burning. The towns it feeds will feel it for weeks.`, 'bad');
  }
}

/**
 * Factions raise troops from the ground they hold.
 *
 * This is the other half of making manpower mean anything: if only the player
 * spent it, scarcity would just be a tax on the player. A column sitting on its
 * own settlement takes people from it, and takes far more of them once there is
 * a war on — which is what turns "the Trust are mustering at Dolmet" from a log
 * line into a reason to get there first.
 */
function tickFactionRecruiting(S, r) {
  const atWar = {};
  for (const f of Dip.MAJOR_FACTIONS) {
    atWar[f] = Dip.enemiesOf(S, f).length > 0;
  }
  for (const p of S.parties) {
    const f = p.faction;
    if (!f || f === 'raider' || p.owner === 'player') continue;
    if (!Dip.MAJOR_FACTIONS.includes(f)) continue;
    const def = PARTY_TIERS[p.kind];
    if (!def) continue;
    const ceiling = def.strength[1];
    if (p.strength >= ceiling) continue;      // already up to establishment
    // Whichever of their own settlements they are standing on.
    const home = LOCATIONS.find((l) => l.kind !== 'open'
      && ownerOf(S, l.id) === f && !isHolding(S, l.id)
      && Math.hypot(l.x - p.x, l.z - p.z) < 60);
    if (!home) continue;
    const want = Math.min(ceiling - p.strength, atWar[f] ? 3 : 1);
    const got = drawManpower(S, home.id, want);
    if (got > 0) p.strength += got;
  }
}

export function recruitPool(S, locId) {
  // Deterministic per location per day, so the player cannot reroll by leaving
  // and coming back — a small thing that makes the world feel like it exists.
  const l = locById(locId);
  const r = rng((S.seed + S.day * 977 + locId.charCodeAt(0) * 31 + locId.length) | 0);
  const mods = companyMods(S.roster);
  const barracks = S.holdings?.[locId]?.upgrades?.barracks || 0;
  // How many they will put forward, and how good. A place that trusts you
  // offers more people and better ones; a place that resents you offers
  // nobody at all.
  const rel = relationOf(S, locId);
  if (rel <= -60) return [];
  const relBonus = rel >= 70 ? 2 : rel >= 35 ? 1 : rel <= -25 ? -1 : 0;
  const holderOfHere = ownerOf(S, locId);
  // Capped by who is actually left. A place that has just been mustered out by
  // its own side has nobody to put forward, however well it thinks of you.
  const n = Math.min(
    Math.floor(manpowerAt(S, locId)),
    Math.max(0, 2 + (holderOfHere && S.rep[holderOfHere] > 2 ? 1 : 0)
      + mods.extraRecruit + barracks + relBonus),
  );
  const pool = [];
  // Who a place raises, and what they were trained to do.
  const originId = originForLocation(l);
  const origin = ORIGINS[originId];
  const roles = origin.roles;
  for (let i = 0; i < n; i++) {
    const s = makeSoldier(r, {
      role: pick(r, roles),
      rank: r() < 0.22 + barracks * 0.08 + Math.max(0, rel) * 0.004 ? 1 : 0,
      how: `Hired at ${l.name}`,
      day: S.day,
      origin: originId,
      avoid: [...S.roster.map((x) => x.name), ...pool.map((x) => x.name)],
    });
    // They arrive wearing what their people issue — and trained the way the
    // town's holder trains: a recruit raised under Trust writ is
    // Trust-drilled, under Syndic writ a Syndic muster. Free towns and
    // scrapper country train nobody in particular.
    if (origin.kit.armour) s.equip.body = origin.kit.armour;
    if (origin.kit.head) s.equip.head = origin.kit.head;
    if (holderOfHere === 'trust' || holderOfHere === 'syndic') s.lineage = holderOfHere;
    s.maxHp = maxHpOf(s);
    s.hp = s.maxHp;
    pool.push(s);
  }
  return pool;
}

/**
 * Buy days of food. Priced off ration blocks so the trade economy and the
 * payroll are the same economy — hoarding rations to sell is a real option, and
 * a bad harvest year is a real problem.
 */
export function buyRations(S, locId, days = 7) {
  const l = locById(locId);
  if (!l?.services?.includes('market')) return false;
  const cost = Math.round(priceAt(S, locId, 'rations') * 0.42 * days);
  if (S.credits < cost) return false;
  S.credits -= cost;
  S.rations = (S.rations || 0) + days;
  S.morale = clamp((S.morale ?? 70) + 2, 0, 100);
  pushLog(S, `${days} days of rations bought at ${l.name} for ${cost}.`, 'good');
  return true;
}

export function rationCost(S, locId, days = 7) {
  return Math.round(priceAt(S, locId, 'rations') * 0.42 * days);
}

/**
 * Prisoners.
 *
 * They were being captured, stored, and — despite a log line promising they
 * "can be pressed into the company" — could never be anything at all. Three
 * things you can now do with a prisoner, each with a real cost:
 *
 *  press    they join, cheap, but resentful: it costs morale and they start
 *           unhappy. A company built from prisoners is a company that deserts.
 *  ransom   sell them back to their own people. Pays well, costs standing with
 *           that faction, and is the only reason to take prisoners for money.
 *  release  free, and the one thing that BUYS standing back.
 */
export function pressPrisoner(S, id) {
  const i = S.prisoners.findIndex((p) => p.id === id);
  if (i < 0) return false;
  const [p] = S.prisoners.splice(i, 1);
  p.how = `Pressed into service, day ${S.day}`;
  p.pressed = true;
  // They keep their training. A pressed Trust regular is still Trust-drilled
  // — that doctrine is most of why pressing them is worth the morale hit.
  if (p.captiveFaction && !p.lineage) p.lineage = p.captiveFaction;
  S.roster.push(p);
  S.stats.recruited++;
  // Nobody likes serving next to somebody who was shooting at them last week.
  S.morale = clamp((S.morale ?? 70) - 5, 0, 100);
  companyReacts(S, 'press');
  pushLog(S, `${p.name} was pressed into the company. The others noticed.`, 'world');
  return true;
}

export function ransomValue(S, p) {
  return Math.round(120 * (1 + (p.rank || 0) * 0.6));
}

export function ransomPrisoner(S, id) {
  const i = S.prisoners.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const [p] = S.prisoners.splice(i, 1);
  const paid = ransomValue(S, p);
  S.credits += paid;
  const f = p.captiveFaction;
  if (f && S.rep[f] != null) S.rep[f] -= 2;
  companyReacts(S, 'ransom');
  pushLog(S, `${p.name} was ransomed back for ${paid} credits.`, 'good');
  return true;
}

/**
 * What a broker in a given town will pay for a prisoner today.
 *
 * A prisoner had exactly one price and it was the same everywhere, which made
 * the whole roster of captives a button rather than a decision. A broker is a
 * market: the rate moves by town and drifts every few days, so carrying two
 * officers to the right place is worth doing, and dumping them at the first
 * market you pass is a choice you are making rather than the only option.
 *
 * Derived rather than stored, so it survives a save without a version bump and
 * cannot drift out of step with the day.
 */
export const BROKER_FLOOR = 1.35;
export const BROKER_CEIL = 2.45;

export function brokerRate(S, locId) {
  if (!locId) return 1;
  const key = `${locId}:${Math.floor(S.day / 3)}:${S.seed}`;
  // FNV-1a with a murmur3 finalizer. The obvious `h * 31 + c` hash does not
  // avalanche: the day block is one digit of the key, so stepping it by one
  // moved the result by a near-constant amount and the price climbed in a
  // straight line — 1.51, 1.68, 1.85, 2.01 — which is a ramp a player can read
  // off, not a market.
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  const t = (h >>> 0) / 4294967296;
  return BROKER_FLOOR + t * (BROKER_CEIL - BROKER_FLOOR);
}

export const brokerPrice = (S, locId, p) =>
  Math.round(ransomValue(S, p) * brokerRate(S, locId));

/** Whether this place has anyone who deals in people. */
export const hasBroker = (locId) => {
  const l = LOCATIONS.find((x) => x.id === locId);
  return !!l && (l.services || []).includes('market');
};

/**
 * Sell a prisoner on rather than ransoming them home.
 *
 * Pays roughly twice what their own people would, and costs three times as much
 * standing with them — and unlike a ransom, half the company has an opinion
 * about it. That is the trade: the money is real and so is what it makes you.
 */
export function sellPrisoner(S, locId, id) {
  const i = S.prisoners.findIndex((x) => x.id === id);
  if (i < 0 || !hasBroker(locId)) return null;
  const [p] = S.prisoners.splice(i, 1);
  const paid = brokerPrice(S, locId, p);
  S.credits += paid;
  const f = p.captiveFaction;
  if (f && S.rep[f] != null) S.rep[f] -= 6;
  // The town does not mind; brokers are business. Their own people do.
  companyReacts(S, 'sell');
  S.stats.sold = (S.stats.sold || 0) + 1;
  pushLog(S, `${p.name} was sold on for ${paid} credits.`, 'bad');
  return { paid, name: p.name };
}

export function releasePrisoner(S, id) {
  const i = S.prisoners.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const [p] = S.prisoners.splice(i, 1);
  const f = p.captiveFaction;
  if (f && S.rep[f] != null) S.rep[f] += 3;
  S.morale = clamp((S.morale ?? 70) + 1, 0, 100);
  companyReacts(S, 'release');
  pushLog(S, `${p.name} was let go. Word gets around.`, 'good');
  return true;
}

/**
 * The upgrades available to one soldier right now, each with why it is or is
 * not possible. Returning the blocked ones too is deliberate — a player needs
 * to see what this person could become before deciding whether to keep them
 * alive for it.
 */
export function upgradesFor(S, s) {
  if (!s || s.isCommander) return [];
  const paths = TROOP_PATHS[s.role] || [];
  const mods = companyMods(S.roster);
  return paths.map((p) => {
    // Workshops make kit cheaper, and re-roling somebody is mostly kit.
    const cost = Math.round(p.cost * (1 - Math.min(0.36, upgradeTotal(S, 'workshop') * 0.12))
      * (mods.hireMul || 1));
    const rankOk = s.rank >= p.rank;
    const canPay = S.credits >= cost;
    return {
      ...p, cost, rankOk, canPay,
      ok: rankOk && canPay && deployable(s),
      why: !rankOk ? `Needs ${RANKS[p.rank].name} rank — they are ${RANKS[s.rank].name}.`
        : !deployable(s) ? 'They are in no state for it.'
          : !canPay ? `Costs ${cost}; you have ${S.credits}.`
            : p.why,
      wageNow: wageOf(s),
      wageAfter: wageOf({ ...s, role: p.to }),
    };
  });
}

/**
 * Promote a soldier into a new role. Their history, rank and perks come with
 * them — this is the same person with a different job, not a replacement.
 */
export function upgradeTroop(S, id, toRole) {
  const s = S.roster.find((x) => x.id === id);
  if (!s) return false;
  const opt = upgradesFor(S, s).find((o) => o.to === toRole);
  if (!opt || !opt.ok) return false;
  S.credits -= opt.cost;
  const was = ROLES[s.role].name;
  s.role = toRole;
  s.weapon = ROLES[toRole].weapon;
  s.maxHp = maxHpOf(s);
  s.hp = Math.min(s.hp, s.maxHp);
  s.retrainedDay = S.day;
  // Being retrained is a promotion in everything but name; people like it.
  S.morale = clamp((S.morale ?? 70) + 2, 0, 100);
  pushLog(S, `${s.name} retrained from ${was} to ${ROLES[toRole].name}.`, 'good');
  return true;
}

/**
 * Standing with one settlement.
 *
 * Faction reputation is about politics; this is about the people who live in a
 * particular place. It is what makes a settlement somewhere you have a history
 * with rather than a vending machine: the town whose contracts you have been
 * taking for a month should offer you their better people and a fair price, and
 * the town whose road you have been robbing should not.
 */
export const RELATION_TIERS = [
  { at: -100, name: 'Hated', note: 'They will not deal with you at all.' },
  { at: -60, name: 'Resented', note: 'No one here will take your money for a recruit.' },
  { at: -25, name: 'Wary', note: 'Nobody here is especially pleased to see you.' },
  { at: 0, name: 'Known', note: 'A company that passes through. No history either way.' },
  { at: 35, name: 'Trusted', note: 'They put their better people forward.' },
  { at: 70, name: 'Ours', note: 'This is somewhere you can call on.' },
];

export const relationOf = (S, locId) => S.relations?.[locId] ?? 0;

export const relationTier = (S, locId) => [...RELATION_TIERS].reverse()
  .find((t) => relationOf(S, locId) >= t.at) || RELATION_TIERS[0];

export function changeRelation(S, locId, delta, why = null) {
  if (!locId || !delta) return;
  if (!S.relations) S.relations = {};
  const before = relationOf(S, locId);
  const after = clamp(before + delta, -100, 100);
  S.relations[locId] = after;
  // Only announce a crossing, not every point — otherwise the company log
  // becomes a stream of numbers nobody reads.
  const t0 = [...RELATION_TIERS].reverse().find((t) => before >= t.at);
  const t1 = [...RELATION_TIERS].reverse().find((t) => after >= t.at);
  if (t0 !== t1) {
    pushLog(S, `${locName(locId)} now regards Bracket as ${t1.name}.`,
      after > before ? 'good' : 'bad');
  } else if (why) {
    pushLog(S, why, delta > 0 ? 'good' : 'bad');
  }
}

/**
 * How standing bends a price, in the direction that actually makes sense.
 *
 * A place that likes you sells to you cheaper AND pays you better. Folding one
 * multiplier into priceAt() would have done the first and the exact opposite of
 * the second — being well liked would have cost you money on every sale.
 */
const REL_PRICE_SWING = 0.18;
export const buyPriceAt = (S, locId, goodId) => Math.max(1, Math.round(
  priceAt(S, locId, goodId) * (1 - clamp(relationOf(S, locId) / 100, -1, 1) * REL_PRICE_SWING)));
export const sellPriceAt = (S, locId, goodId) => Math.max(1, Math.round(
  priceAt(S, locId, goodId) * (1 + clamp(relationOf(S, locId) / 100, -1, 1) * REL_PRICE_SWING)));

/**
 * Caravans of your own.
 *
 * Holdings pay a fixed yield whether or not the roads around them are safe,
 * which makes them a number that goes up rather than a place you have to look
 * after. A caravan is the opposite: it is money that has to physically survive
 * the map. It earns more the better your standing is at the places it trades
 * with, and it can be taken off you by anything hostile it walks into.
 *
 * That is the whole point of it — it gives you a reason to care about the road
 * between two towns rather than only about the towns.
 */
export const CARAVAN_COST = 2600;

export function canBuyCaravan(S, locId) {
  if (!isHolding(S, locId)) {
    return { ok: false, why: 'You can only fit out a caravan somewhere you hold.' };
  }
  const depot = S.holdings[locId].upgrades?.depot || 0;
  if (!depot) return { ok: false, why: 'Needs a Depot here to load one.' };
  const owned = (S.parties || []).filter((p) => p.kind === 'own_caravan'
    && p.homeHolding === locId).length;
  if (owned >= depot) {
    return { ok: false, why: `A level ${depot} depot runs ${depot}; raise it for more.` };
  }
  if (S.credits < CARAVAN_COST) {
    return { ok: false, why: `Costs ${CARAVAN_COST}; you have ${S.credits}.` };
  }
  return { ok: true };
}

export function buyCaravan(S, locId) {
  if (!canBuyCaravan(S, locId).ok) return false;
  S.credits -= CARAVAN_COST;
  const r = rng((S.seed + S.day * 71 + (S.parties?.length || 0)) | 0);
  const p = spawnParty(S, r, 'own_caravan', locId);
  p.name = `Bracket Caravan`;
  p.owner = 'player';
  p.baseHostile = false;
  p.hostileToPlayer = false;
  p.homeHolding = locId;
  p.nextPayDay = S.day + 4;
  pushLog(S, `A caravan was fitted out at ${locName(locId)}.`, 'good');
  return p;
}

/**
 * Run every caravan for a day: pay out on arrival, and roll for whether the
 * road ate one. Losses are always announced with a place, because a number
 * quietly going down is a bug as far as the player is concerned.
 */
export function tickCaravans(S, r) {
  const mine = (S.parties || []).filter((p) => p.kind === 'own_caravan');
  for (const c of mine) {
    // Anything hostile close by is a real risk to an escorted truck.
    const threat = S.parties.filter((p) => p.hostileToPlayer && !p.owner
      && Math.hypot(p.x - c.x, p.z - c.z) < 260).length;
    if (threat && r() < Math.min(0.055, 0.018 * threat)) {
      S.parties = S.parties.filter((p) => p.id !== c.id);
      S.stats.caravansLost = (S.stats.caravansLost || 0) + 1;
      const near = nearestLocation(c.x, c.z);
      pushLog(S, `The caravan was taken on the road near ${near ? near.name : 'open country'}.`, 'bad');
      S.morale = clamp((S.morale ?? 70) - 4, 0, 100);
      continue;
    }

    if (S.day < (c.nextPayDay || 0)) continue;
    // A completed leg. What it earns depends on how welcome it is where it
    // trades, which is what ties caravans to the standing system.
    const where = locById(c.target) || locById(c.homeHolding);
    const rel = where ? relationOf(S, where.id) : 0;
    const depot = S.holdings?.[c.homeHolding]?.upgrades?.depot || 0;
    const profit = Math.round(range(r, 190, 340)
      * (1 + depot * 0.18)
      * (1 + clamp(rel / 100, -1, 1) * 0.35));
    S.credits += profit;
    c.nextPayDay = S.day + irange(r, 4, 7);
    if (where) changeRelation(S, where.id, 0.8);
    pushLog(S, `Caravan takings from ${where ? where.name : 'the road'}: ${profit} credits.`, 'good');
  }
}

/**
 * Tell the company what you just did, and let them have an opinion about it.
 *
 * Every soldier reacts through their own creed, so one decision earns credit
 * with some of your people and costs it with others. Announcing is deliberately
 * sparing — only when somebody crosses a tier line — because a line of log per
 * soldier per event would bury everything else the log is for.
 */
export function companyReacts(S, event) {
  const tierOf = (v) => [...REGARD_TIERS].reverse().find((t) => v >= t.at) || REGARD_TIERS[0];
  const moved = [];
  for (const s of living(S)) {
    if (s.isCommander) continue;
    const creed = CREEDS[s.creed] || CREEDS.paid;
    const delta = creed.react[event] || 0;
    if (!delta) continue;
    const before = s.regard || 0;
    s.regard = clamp(before + delta, -100, 100);
    const t0 = tierOf(before), t1 = tierOf(s.regard);
    if (t0 !== t1) {
      moved.push({ name: s.name, tier: t1.name, up: s.regard > before, line: creed.line });
      pushLog(S, `${s.name} is ${t1.name.toLowerCase()} on the company. ${creed.line}`,
        s.regard > before ? 'good' : 'bad');
    }
  }
  return moved;
}

export function breakOathReaction(S) { return companyReacts(S, 'oathbreak'); }

/**
 * Somebody who has had enough leaves — but only after warning you, and only
 * once they have been unhappy for a while. A soldier who vanishes because a
 * number crossed a line reads as a bug; one who told you first reads as a
 * consequence you could have done something about.
 */
export function tickResentment(S, r) {
  for (const s of living(S)) {
    if (s.isCommander) continue;
    if ((s.regard || 0) > -45) { s.quitWarned = false; continue; }
    if (!s.quitWarned) {
      s.quitWarned = true;
      pushLog(S, `${s.name} has said they are thinking about leaving.`, 'bad');
      continue;
    }
    if (r() < 0.12) {
      S.roster = S.roster.filter((x) => x.id !== s.id);
      S.stats.quit = (S.stats.quit || 0) + 1;
      pushLog(S, `${s.name} took their kit and went. They had warned you.`, 'bad');
    }
  }
}

// --------------------------------------------------------------------------
// Favours
// --------------------------------------------------------------------------

export const favourAt = (S, locId) => (S.favours || {})[locId] || null;

const favourText = (f, key) => (f[key] || '')
  .replace(/%WHO%/g, f.who)
  .replace(/%QTY%/g, f.qty || '')
  .replace(/%GOOD%/g, f.good ? GOODS[f.good].name.toLowerCase() : '')
  .replace(/%TO%/g, f.to ? locName(f.to) : '')
  .replace(/%DEBTOR%/g, f.debtor || '')
  .replace(/%AMT%/g, f.amount || '');

/**
 * Ask one of the named people in a settlement for something.
 *
 * Only one favour is ever open per settlement, and only from somebody who
 * actually lives there — a favour from a stranger is just a contract with worse
 * pay. There is a cooldown after each one so a town does not become a queue.
 */
export function offerFavour(S, locId, r, lord = null) {
  if (!S.favours) S.favours = {};
  if (S.favours[locId]) return S.favours[locId];
  if ((S.favourCooldown?.[locId] || 0) > S.day) return null;
  const loc = LOCATIONS.find((l) => l.id === locId);
  if (!loc || !loc.contacts?.length || !loc.services?.length) return null;

  const who = pick(r, loc.contacts);
  const tpl = pick(r, FAVOURS);
  const f = {
    id: uid('fav'),
    site: locId,
    kind: tpl.kind,
    who: who.name,
    role: who.role,
    tplId: tpl.id,
    ask: tpl.ask, done: tpl.done, fail: tpl.fail,
    accepted: false,
    expiresDay: S.day + irange(r, 9, 16),
  };
  if (tpl.kind === 'goods') {
    f.good = pick(r, GOODS_LIST);
    f.qty = irange(r, 3, 7);
    // Worth rather more than the goods, because you are also carrying them.
    f.pay = Math.round(GOODS[f.good].base * f.qty * range(r, 1.15, 1.5));
  } else if (tpl.kind === 'deliver' || tpl.kind === 'debt') {
    // Both need a second town: somewhere to carry to, or somewhere the
    // debtor is keeping their head down.
    const there = LOCATIONS.filter((l) => l.id !== locId
      && l.kind === 'settlement' && l.services?.length && l.contacts?.length);
    if (!there.length) return null;
    const dest = pick(r, there);
    f.to = dest.id;
    if (tpl.kind === 'deliver') {
      f.qty = irange(r, 2, 5);
      // Paid by the mile, roughly — a run across the Reach is worth more
      // than a run up the road.
      const dist = Math.hypot(dest.x - loc.x, dest.z - loc.z);
      f.pay = Math.round(500 + dist * range(r, 1.1, 1.6));
    } else {
      f.debtor = pick(r, dest.contacts).name;
      f.amount = Math.round(range(r, 600, 1100));
      // Your cut, and it is a cut — the debt is not yours to keep.
      f.pay = Math.round(f.amount * range(r, 0.4, 0.55));
    }
  } else if (tpl.kind === 'train') {
    f.qty = irange(r, 2, 3);
    f.need = f.qty;
    f.pay = Math.round(range(r, 500, 850));
  } else {
    f.pay = Math.round(range(r, 700, 1200));
  }
  // A lord holding court here sometimes puts the ask forward themselves.
  // Same work, better pay, and the person remembering is somebody whose
  // memory moves armies.
  if (lord && r() < 0.4) {
    f.who = lord.name;
    f.role = 'holding court';
    f.lordId = lord.id;
    f.pay = Math.round(f.pay * 1.5);
  }
  S.favours[locId] = f;
  return f;
}

export function acceptFavour(S, locId) {
  const f = favourAt(S, locId);
  if (!f || f.accepted) return null;
  f.accepted = true;
  f.acceptedDay = S.day;
  // Clearing a camp is measured from the moment you agreed to do it, so an old
  // kill cannot be handed in as a new favour.
  if (f.kind === 'lair') f.mark = S.stats.lairsCleared || 0;
  pushLog(S, `${f.who} asked Bracket for something.`, 'world');
  return f;
}

/** Whether the favour can be handed in, and what is still outstanding. */
export function favourProgress(S, f) {
  if (!f || !f.accepted) return { ready: false, note: '' };
  if (f.kind === 'goods') {
    const have = (S.cargo || {})[f.good] || 0;
    return {
      ready: have >= f.qty,
      note: `${have} of ${f.qty} ${GOODS[f.good].name.toLowerCase()} in the truck`,
    };
  }
  if (f.kind === 'deliver') {
    // Pays out at the far end, not back here — so at the origin this only
    // ever reads as "on the road".
    return { ready: false, note: `${f.qty} crates bound for ${locName(f.to)}` };
  }
  if (f.kind === 'debt') {
    return {
      ready: !!f.collected,
      note: f.collected ? 'The debt is in hand' : `${f.debtor} is at ${locName(f.to)}`,
    };
  }
  if (f.kind === 'train') {
    const done = f.trained || 0;
    return {
      ready: done >= f.need,
      note: done >= f.need ? 'The locals will hold' : `${done} of ${f.need} drill sessions run`,
    };
  }
  const cleared = (S.stats.lairsCleared || 0) - (f.mark || 0);
  return {
    ready: cleared > 0,
    note: cleared > 0 ? 'The camp is cleared' : 'No camp cleared since you agreed',
  };
}

/**
 * The travelling half of the new favours, checked on every arrival.
 *
 * A delivery hands itself in the moment you reach the destination — pay on
 * the spot, standing at the origin, a nod at this end. Nobody drives back
 * across the Reach to be told well done.
 */
export function arrivalFavours(S, locId) {
  const out = [];
  for (const [origin, f] of Object.entries(S.favours || {})) {
    if (!f.accepted || f.kind !== 'deliver' || f.to !== locId) continue;
    S.credits += f.pay;
    S.renown = (S.renown || 0) + 12;
    changeRelation(S, origin, 14, `a delivery for ${f.who}`);
    changeRelation(S, locId, 4, 'crates that arrived sealed');
    if (f.lordId) {
      const lord = lordById(S, f.lordId);
      if (lord) lord.regard = clamp((lord.regard || 0) + 2, -10, 10);
    }
    S.stats.favours = (S.stats.favours || 0) + 1;
    pushLog(S, favourText(f, 'done'), 'good');
    delete S.favours[origin];
    if (!S.favourCooldown) S.favourCooldown = {};
    S.favourCooldown[origin] = S.day + 6;
    out.push({ pay: f.pay, who: f.who, from: origin });
  }
  return out;
}

/** The accepted debt favour whose debtor lives at this town, if any. */
export function debtorApproach(S, locId) {
  for (const f of Object.values(S.favours || {})) {
    if (f.accepted && f.kind === 'debt' && f.to === locId && !f.collected) return f;
  }
  return null;
}

/**
 * Ask the debtor for the money. Whether they pay depends on how big your
 * name is and how this town feels about you — a company the town likes is
 * a company the debtor cannot pretend not to have heard of. Deterministic
 * per favour per day, so asking twice in one sitting is not a slot machine.
 */
export function collectDebt(S, locId) {
  const f = debtorApproach(S, locId);
  if (!f) return null;
  let h = 0;
  for (let i = 0; i < f.id.length; i++) h = (h * 31 + f.id.charCodeAt(i)) | 0;
  const roll = rng((S.seed ^ Math.abs(h)) + S.day * 271)();
  const chance = clamp(0.35 + (S.renown || 0) / 1500 + relationOf(S, locId) / 120, 0.2, 0.9);
  if (roll < chance) {
    f.collected = true;
    pushLog(S, `${f.debtor} paid up. The whole ${f.amount}, in used notes.`, 'good');
    return { paid: true, f };
  }
  pushLog(S, `${f.debtor} says the money is coming. It is not coming.`);
  return { paid: false, f };
}

/** Collect it anyway. The town watches you do it, and remembers. */
export function pressDebt(S, locId) {
  const f = debtorApproach(S, locId);
  if (!f) return null;
  f.collected = true;
  changeRelation(S, locId, -8, `strong-arming ${f.debtor}`);
  pushLog(S, `${f.debtor} paid with your hand on their collar. ${locName(locId)} saw it.`, 'bad');
  return { paid: true, pressed: true, f };
}

/** One drill session in the yard: once a day, at the favour's own town. */
export function runDrill(S, locId) {
  const f = favourAt(S, locId);
  if (!f || !f.accepted || f.kind !== 'train') return null;
  if (f.lastDrill === S.day) return { ran: false, why: 'You have already drilled them today.' };
  f.lastDrill = S.day;
  f.trained = (f.trained || 0) + 1;
  pushLog(S, `A morning in the yard at ${locName(locId)}. ${f.trained} of ${f.need} sessions run.`);
  return { ran: true, trained: f.trained, need: f.need };
}

/**
 * Hand it in. The pay is the smaller half of this: what a favour buys is
 * standing with the people who live here, and they are the ones who decide who
 * they will put forward and what they will charge.
 */
export function completeFavour(S, locId) {
  const f = favourAt(S, locId);
  if (!f || !favourProgress(S, f).ready) return null;
  if (f.kind === 'goods') S.cargo[f.good] -= f.qty;
  if (f.kind === 'train') {
    // The yard work sticks: a town that can hold a line can also man one.
    S.manpower = S.manpower || {};
    S.manpower[locId] = (S.manpower[locId] || 0) + 3;
  }
  if (f.lordId) {
    const lord = lordById(S, f.lordId);
    if (lord) lord.regard = clamp((lord.regard || 0) + 2, -10, 10);
  }
  S.credits += f.pay;
  S.renown = (S.renown || 0) + 12;
  changeRelation(S, locId, 14, `a favour for ${f.who}`);
  S.stats.favours = (S.stats.favours || 0) + 1;
  pushLog(S, favourText(f, 'done'), 'good');
  delete S.favours[locId];
  if (!S.favourCooldown) S.favourCooldown = {};
  S.favourCooldown[locId] = S.day + 6;
  return { pay: f.pay, who: f.who };
}

export function declineFavour(S, locId) {
  const f = favourAt(S, locId);
  if (!f) return;
  // Saying no costs nothing. It is not turning up after saying yes that costs.
  delete S.favours[locId];
  if (!S.favourCooldown) S.favourCooldown = {};
  S.favourCooldown[locId] = S.day + irange(rng(S.day + 1), 4, 9);
}

export function tickFavours(S, r) {
  if (!S.favours) return;
  for (const [locId, f] of Object.entries(S.favours)) {
    if (S.day <= f.expiresDay) continue;
    if (f.accepted) {
      changeRelation(S, locId, -10, `let ${f.who} down`);
      pushLog(S, favourText(f, 'fail'), 'bad');
    }
    delete S.favours[locId];
    if (!S.favourCooldown) S.favourCooldown = {};
    S.favourCooldown[locId] = S.day + irange(r, 5, 10);
  }
}

/** The words a notable uses to ask. */
export const favourAsk = (f) => favourText(f, 'ask');

// --------------------------------------------------------------------------
// Being taken
// --------------------------------------------------------------------------

/**
 * What happens when the company is broken in the field.
 *
 * Losing used to cost a line of log and two points of standing with whoever
 * hired you, which meant the honest response to a bad fight was to reload —
 * and a game you reload is a game with no difficulty curve, only a patience
 * curve. Losing has to be survivable and expensive at the same time.
 *
 * So the company is taken. Weeks go by, most of the money and half the cargo
 * goes, and you are put out on the road somewhere belonging to whoever beat
 * you. Nobody dies who was not already dead: the roster is the thing the player
 * is attached to, and killing it on a loss would send them straight back to the
 * reload they were being spared.
 */
export function captureCompany(S, captor, r) {
  const days = irange(r, 4, 11);

  // Everything portable. What they leave you is the truck and the people in it.
  const tookCredits = Math.round(S.credits * range(r, 0.4, 0.65));
  S.credits -= tookCredits;
  const tookCargo = {};
  for (const [g, n] of Object.entries(S.cargo || {})) {
    const take = Math.ceil(n * range(r, 0.45, 0.8));
    if (take <= 0) continue;
    S.cargo[g] -= take;
    if (S.cargo[g] <= 0) delete S.cargo[g];
    tookCargo[g] = take;
  }
  const tookArms = [];
  const arms = Object.entries(S.armoury || {}).filter(([, n]) => n > 0);
  for (let i = 0; i < 2 && arms.length; i++) {
    const [id] = arms[irange(r, 0, arms.length - 1)];
    if (!S.armoury[id]) continue;
    S.armoury[id] -= 1;
    if (S.armoury[id] <= 0) delete S.armoury[id];
    tookArms.push(id);
  }
  // Prisoners you were carrying walk out with their own side.
  const freed = (S.prisoners || []).length;
  S.prisoners = [];

  // A named companion is worth keeping: whoever took the company holds one
  // back when they can, in a town of theirs, and a rescue posting appears —
  // the prison break is the player's to attempt, or a fat ransom lands on
  // its own after twelve days. Raiders hold nobody: no towns, no cells.
  let kept = null;
  const cells = LOCATIONS.filter((l) => ownerOf(S, l.id) === captor
    && l.kind === 'settlement');
  const comps = S.roster.filter((s) => s.companion && s.status !== STATUS.DEAD);
  if (comps.length && cells.length && r() < 0.75) {
    kept = pick(r, comps);
    S.roster = S.roster.filter((s) => s.id !== kept.id);
    const at = pick(r, cells);
    S.captives = S.captives || [];
    S.captives.push({ soldier: kept, at: at.id, sinceDay: S.day });
    S.contracts.push({
      id: uid('con'),
      type: 'recovery',
      rescue: kept.id,
      rescueName: kept.name,
      site: at.id,
      employer: null,
      title: `Break ${kept.name} out of ${at.name}`,
      text: `${captor === 'trust' ? 'The Trust' : 'The Syndic'} kept ${kept.name} `
        + `when the rest of you were put out on the road. They are held at `
        + `${at.name}. Nobody pays for this work; the pay is the person.`,
      pay: 0,
      expiresDay: S.day + 30,
      accepted: false,
    });
    pushLog(S, `${kept.name} was kept behind. Word is they are held at ${at.name}.`, 'bad');
  }

  // The time is the real cost, and it is also the mercy: wounds close while you
  // are sitting in a room. Wages and rations are deliberately NOT run for these
  // days — a company in a cell is not buying food or drawing pay, and running
  // the payroll through captivity would produce a cascade of "nobody was paid"
  // for something the player could not have prevented.
  S.day += days;
  for (const s of living(S)) {
    if (s.wound) {
      s.wound.days -= days;
      if (s.wound.days <= 0) {
        s.wound = null;
        s.status = STATUS.HEALTHY;
        s.maxHp = maxHpOf(s);
      }
    }
    s.hp = s.maxHp;
  }

  // Put out on the road somewhere that belongs to whoever took you.
  const theirs = LOCATIONS.filter((l) => l.faction === captor && l.kind !== 'open');
  const drop = theirs.length ? pick(r, theirs) : locById('vetch');
  if (drop) {
    S.pos.x = drop.x + range(r, -90, 90);
    S.pos.z = drop.z + range(r, -90, 90);
    S.dest = null;
  }

  S.renown = Math.max(0, (S.renown || 0) - 60);
  S.morale = clamp((S.morale ?? 70) - 14, 0, 100);
  if (captor && S.rep[captor] != null) S.rep[captor] -= 3;
  S.stats.captured = (S.stats.captured || 0) + 1;
  companyReacts(S, 'captured');
  pushLog(S, `Bracket was broken and held for ${days} days.`, 'bad');

  const took = { credits: tookCredits, cargo: tookCargo, arms: tookArms };
  // Only one grudge at a time: two named commanders each holding a share of
  // your things is bookkeeping, not a story.
  if (!S.grudge) openGrudge(S, r, captor, took);

  return {
    days, captor, ...took, freed, where: drop ? drop.name : null,
    grudge: S.grudge ? S.grudge.who : null,
  };
}

/**
 * Whoever broke the company keeps what they took — and keeps carrying it.
 *
 * Capture on its own is a tax: you lose a fortnight and most of your money to
 * nobody in particular, and the only thing to do about it is earn it again.
 * Giving the loot to a named commander who stays on the map turns the worst
 * afternoon in the game into the start of something — there is a person out
 * there with your rifles, and you can go and find them.
 *
 * They are deliberately beatable. A grudge party is one tier above a patrol,
 * not a battle group: this is meant to be a hunt you can actually finish, some
 * weeks later, with the company you rebuilt.
 */
export function openGrudge(S, r, captor, took) {
  const tier = captor === 'syndic' ? 'patrol_syndic'
    : captor === 'trust' ? 'patrol_trust' : 'scrappers';
  const near = LOCATIONS.filter((l) => l.faction === captor && l.kind !== 'open');
  const p = spawnParty(S, r, tier, (near.length ? pick(r, near) : locById('vetch')).id);
  const who = `${pick(r, FIRST_NAMES)} ${pick(r, LAST_NAMES)}`;
  p.name = `${who}'s command`;
  p.commander = who;
  // Marked so the map can call it out and the campaign can recognise it later.
  p.grudge = true;
  p.hostileToPlayer = true;
  p.baseHostile = true;
  // What they are carrying is exactly what they took, so recovering it is a
  // real recovery rather than a consolation payout.
  p.holds = { credits: took.credits, cargo: { ...took.cargo }, arms: [...took.arms] };

  S.grudge = {
    partyId: p.id, who, captor, since: S.day,
    credits: took.credits, cargo: { ...took.cargo }, arms: [...took.arms],
  };
  pushLog(S, `${who} has your money and your weapons, and is not hiding.`, 'bad');
  return S.grudge;
}

/** Did we just beat the people who took us? */
export function settleGrudge(S, partyId) {
  const g = S.grudge;
  if (!g || g.partyId !== partyId) return null;
  S.credits += g.credits;
  for (const [good, n] of Object.entries(g.cargo || {})) {
    S.cargo[good] = (S.cargo[good] || 0) + n;
  }
  for (const id of g.arms || []) S.armoury[id] = (S.armoury[id] || 0) + 1;
  const back = addRenown(S, 90);
  S.morale = clamp((S.morale ?? 70) + 10, 0, 100);
  S.stats.grudges = (S.stats.grudges || 0) + 1;
  companyReacts(S, 'win');
  pushLog(S, `${g.who} is finished. Bracket has its own back.`, 'good');
  S.grudge = null;
  return { who: g.who, credits: g.credits, arms: (g.arms || []).length, renown: back };
}

/**
 * They do not carry it forever. Left long enough the money is spent and the
 * rifles are issued to somebody, and the trail is cold — which is the pressure
 * that makes a grudge something you act on rather than a chore on a list.
 */
export const GRUDGE_DAYS = 40;

export function tickGrudge(S) {
  const g = S.grudge;
  if (!g) return;
  const stillThere = S.parties.some((p) => p.id === g.partyId);
  if (!stillThere) { S.grudge = null; return; }
  if (S.day - g.since < GRUDGE_DAYS) return;
  const p = S.parties.find((x) => x.id === g.partyId);
  if (p) { p.grudge = false; p.holds = null; p.name = p.name.replace(/'s command$/, "'s people"); }
  pushLog(S, `${g.who} has spent what was taken from Bracket. It is gone.`, 'bad');
  S.grudge = null;
}

// --------------------------------------------------------------------------
// Meeting people on the road
// --------------------------------------------------------------------------

/**
 * What a band on the road will take to let you past.
 *
 * Scaled to what they can see: a fat, slow company with a full truck is worth
 * more to stop than four people and a bad injector. Paying is the coward's
 * option and it is meant to be genuinely tempting — the alternative is a fight
 * you might lose people in, and people do not come back.
 */
export function tollOf(S, party) {
  const cargo = Object.values(S.cargo || {}).reduce((a, b) => a + b, 0);
  const base = 60 + (party.strength || 6) * 22;
  return Math.round(base * (1 + cargo * 0.02) * (1 + (S.renown || 0) / 2200));
}

export function payToll(S, party) {
  const cost = tollOf(S, party);
  if (S.credits < cost) return { ok: false, why: 'You cannot cover it.' };
  S.credits -= cost;
  // Buying your way past is not free of consequence: the company notices, and
  // so does everyone the band tells.
  S.morale = clamp((S.morale ?? 70) - 4, 0, 100);
  S.stats.tolls = (S.stats.tolls || 0) + 1;
  companyReacts(S, 'toll');
  pushLog(S, `Bracket paid ${cost} to be let past.`, 'bad');
  return { ok: true, cost };
}

/**
 * A patrol stops you and wants to look in the truck.
 *
 * Submitting costs time and sometimes cargo and buys standing with their
 * faction; refusing keeps whatever you are carrying and costs the standing.
 * The interesting case is carrying something you would rather they did not see.
 */
export function submitToInspection(S, party, r) {
  const f = party.faction;
  advanceTime(S, 2.5);
  let seized = null;
  const goods = Object.entries(S.cargo || {}).filter(([, n]) => n > 0);
  if (goods.length && r() < 0.3) {
    const [id, n] = pick(r, goods);
    const take = Math.max(1, Math.round(n * 0.4));
    S.cargo[id] -= take;
    if (S.cargo[id] <= 0) delete S.cargo[id];
    seized = { id, n: take };
  }
  if (f && S.rep[f] != null) S.rep[f] += 2;
  pushLog(S, seized
    ? `${FACTIONS[f]?.short || 'A patrol'} took ${seized.n} ${GOODS[seized.id]?.name || seized.id}.`
    : `${FACTIONS[f]?.short || 'A patrol'} waved Bracket through.`, seized ? 'bad' : 'world');
  return { seized };
}

export function refuseInspection(S, party) {
  const f = party.faction;
  if (f && S.rep[f] != null) S.rep[f] -= 7;
  S.morale = clamp((S.morale ?? 70) + 2, 0, 100);
  pushLog(S, `Bracket refused a ${FACTIONS[f]?.short || 'patrol'} inspection.`, 'bad');
  refreshHostility(S);
  return { ok: true };
}

/**
 * How many contracts a liege wants before they part with the next holding.
 *
 * Rising, because a first grant is a reward for turning up and a fourth is a
 * marcher lordship. Kept as a function rather than a table so the ladder has
 * no end — there is always another one, it just costs more.
 */
export const fiefServiceFor = (granted) => 4 + granted * 3;

/** Where the company stands with its liege, in words a player can act on. */
export function serviceStanding(S) {
  if (!S.allegiance) return null;
  const granted = (S.fiefs || []).length;
  const need = fiefServiceFor(granted);
  const done = S.service || 0;
  return {
    faction: S.allegiance,
    granted,
    done,
    need,
    left: Math.max(0, need - done),
  };
}

export function hireCost(S, s) {
  const base = { rifleman: 240, breacher: 320, marksman: 360, gunner: 380, medic: 420, signals: 400 };
  const mods = companyMods(S.roster);
  // Better-trained people cost more, and Scour hands are cheap for a reason.
  const originMul = ORIGINS[s.origin]?.costMul ?? 1;
  // They come wearing kit, and kit is worth money. Without this a Trust
  // regular is a 25% price rise for a 60%-odd health advantage.
  let kitValue = 0;
  for (const id of Object.values(s.equip || {})) {
    const a = ARMOUR[id];
    if (a) kitValue += Math.round(a.price * 0.8);
  }
  return Math.round((base[s.role] || 250) * (1 + s.rank * 0.45) * mods.hireMul * originMul)
    + kitValue;
}

/**
 * Take somebody on.
 *
 * Returns a truthy result on success and a reason on failure, because there are
 * now two quite different ways to fail and the interface was reporting both as
 * "not enough credits" — which is a lie the moment a town has been mustered out
 * by its own side, and exactly the sort of thing that makes a working mechanic
 * look like a broken button.
 */
export function hire(S, s) {
  const cost = hireCost(S, s);
  if (S.credits < cost) return { ok: false, why: 'Not enough credits' };
  // Where the company actually is, derived from position rather than read from
  // S.atLocation — that field is maintained by the world map renderer and is
  // stale in every headless run, which is survivable for a log line and not for
  // a number that has to go down.
  // Position first, S.atLocation only as a fallback. That field is written by
  // the world map renderer, so it is authoritative in play and stale headless;
  // deriving from position is right whenever the company is actually standing
  // somewhere, and the fallback covers callers that place the company by
  // setting the field rather than by moving it.
  const here = locationAt(S, 38) || locById(S.atLocation);
  if (here && manpowerAt(S, here.id) < 1) {
    return { ok: false, why: 'There is nobody left here to take your money' };
  }
  S.credits -= cost;
  if (here) drawManpower(S, here.id, 1);
  S.roster.push(s);
  S.stats.recruited++;
  pushLog(S, `${s.name} hired at ${here ? here.name : locName(S.atLocation)}.`, 'good');
  return { ok: true };
}

// --------------------------------------------------------------------------
// Armoury and loadout
// --------------------------------------------------------------------------

const bump = (map, id, n) => {
  map[id] = (map[id] || 0) + n;
  if (map[id] <= 0) delete map[id];
};

export const armouryList = (S) =>
  Object.entries(S.armoury || {}).filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, n, def: WEAPONS[id] })).filter((x) => x.def);

export const kitList = (S) =>
  Object.entries(S.kitPool || {}).filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, n, def: KIT[id] })).filter((x) => x.def);

export const armourList = (S, slot = null) =>
  Object.entries(S.armourPool || {}).filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, n, def: ARMOUR[id] }))
    .filter((x) => x.def && (!slot || x.def.slot === slot));

/** Move an armour piece onto a soldier; whatever they wore returns to stores. */
export function equipArmour(S, soldier, slot, armourId) {
  if (armourId && (!ARMOUR[armourId] || ARMOUR[armourId].slot !== slot)) return false;
  if (armourId && !(S.armourPool[armourId] > 0)) return false;
  soldier.equip = soldier.equip || { head: null, body: null, legs: null };
  const worn = soldier.equip[slot];
  if (worn) bump(S.armourPool, worn, 1);
  if (armourId) bump(S.armourPool, armourId, -1);
  soldier.equip[slot] = armourId || null;
  soldier.maxHp = maxHpOf(soldier);
  soldier.hp = Math.min(soldier.hp, soldier.maxHp);
  return true;
}

export function buyArmour(S, armourId) {
  const a = ARMOUR[armourId];
  if (!a) return false;
  const price = Math.round(a.price * (1 - Math.min(0.36, upgradeTotal(S, 'workshop') * 0.12)));
  if (S.credits < price) return false;
  S.credits -= price;
  bump(S.armourPool, armourId, 1);
  pushLog(S, `Bought ${a.name}.`);
  return true;
}

/**
 * Move a weapon from the armoury onto a soldier; whatever they were carrying
 * goes back into the armoury. Nothing is ever created or destroyed, so the
 * armoury screen is a real inventory rather than a shop front.
 */
export function equipWeapon(S, soldier, weaponId) {
  if (!WEAPONS[weaponId]) return false;
  if (soldier.weapon === weaponId) return false;
  if (!(S.armoury[weaponId] > 0)) return false;
  bump(S.armoury, weaponId, -1);
  if (soldier.weapon) bump(S.armoury, soldier.weapon, 1);
  soldier.weapon = weaponId;
  return true;
}

export function equipKit(S, soldier, kitId) {
  if (kitId && !KIT[kitId]) return false;
  if (kitId && !(S.kitPool[kitId] > 0)) return false;
  if (soldier.kit) bump(S.kitPool, soldier.kit, 1);
  if (kitId) bump(S.kitPool, kitId, -1);
  soldier.kit = kitId || null;
  soldier.maxHp = maxHpOf(soldier);
  soldier.hp = Math.min(soldier.hp, soldier.maxHp);
  return true;
}

export function buyWeapon(S, weaponId) {
  const w = WEAPONS[weaponId];
  if (!w || !w.price) return false;
  const price = Math.round(w.price * (1 - Math.min(0.36, upgradeTotal(S, 'workshop') * 0.12)));
  if (S.credits < price) return false;
  S.credits -= price;
  bump(S.armoury, weaponId, 1);
  pushLog(S, `Bought a ${w.name}.`);
  return true;
}

export function buyKit(S, kitId) {
  const k = KIT[kitId];
  if (!k) return false;
  const price = Math.round(k.price * (1 - Math.min(0.36, upgradeTotal(S, 'workshop') * 0.12)));
  if (S.credits < price) return false;
  S.credits -= price;
  bump(S.kitPool, kitId, 1);
  pushLog(S, `Bought ${k.name}.`);
  return true;
}

// --------------------------------------------------------------------------
// Trade
//
// Mount & Blade's shape: every settlement produces a couple of things cheaply
// and wants a couple of things badly, prices drift daily, and the profit is in
// knowing the routes. Cargo is capped by the company transport, so hauling
// bulk means giving up the ability to haul anything else.
// --------------------------------------------------------------------------

export const CARGO_CAPACITY = 60;

export function cargoUsed(S) {
  let n = 0;
  for (const [id, qty] of Object.entries(S.cargo || {})) {
    n += (GOODS[id]?.bulk || 1) * qty;
  }
  return n;
}

/** Total capacity including any Depot upgrades the company has built. */
export const cargoCap = (S) => CARGO_CAPACITY + depotCapacity(S);
export const cargoFree = (S) => cargoCap(S) - cargoUsed(S);

function seedPrices(S) {
  S.priceDay = -1;
  S.prices = {};
  refreshPrices(S);
}

/**
 * Prices are deterministic per location per day: a producer sells its own
 * output cheap and pays over the odds for what it cannot make. Re-derived
 * rather than stored, so the player cannot reroll a market by leaving.
 */
export function refreshPrices(S) {
  if (S.priceDay === S.day) return;
  S.priceDay = S.day;
  S.prices = {};
  for (const l of LOCATIONS) {
    if (!l.trade) continue;
    const r = rng((S.seed + S.day * 5651 + l.id.length * 313 + l.id.charCodeAt(0) * 17) | 0);
    const row = {};
    for (const id of GOODS_LIST) {
      const g = GOODS[id];
      let mul = 1;
      if (l.trade.sell?.includes(id)) mul = range(r, 0.55, 0.75);   // produced here
      else if (l.trade.buy?.includes(id)) mul = range(r, 1.30, 1.65); // wanted here
      else mul = range(r, 0.88, 1.14);
      row[id] = Math.max(5, Math.round(g.base * mul));
    }
    S.prices[l.id] = row;
  }
}

/**
 * The cheapest places on the map to buy a given good right now.
 *
 * Upgrades are paid in goods, and a player looking at "needs 6 MCH" has no way
 * to know whether that means shopping, looting, or waiting — so the holdings
 * screen asks this and prints the answer.
 */
export function sourcesFor(S, goodId, limit = 2) {
  refreshPrices(S);
  const out = [];
  for (const l of LOCATIONS) {
    if (!l.services?.includes('market')) continue;
    out.push({ id: l.id, name: l.name, price: priceAt(S, l.id, goodId) });
  }
  out.sort((a, b) => a.price - b.price);
  return out.slice(0, limit);
}

/**
 * What the trader has heard about prices elsewhere — the Mount & Blade
 * trading loop's missing half. Reads the REAL per-town tables, finds the
 * best spread worth the breath from here, and says so in a sentence.
 * Deterministic per day like the tables themselves, so asking twice gets
 * the same rumour, and acting on it finds the price the rumour promised.
 * Returns null when nothing clears 1.35x — a trader with no news says none.
 */
export function priceRumour(S, hereId) {
  const markets = LOCATIONS.filter(
    (l) => l.id !== hereId && l.services?.includes('market'));
  let best = null;
  for (const g of GOODS_LIST) {
    const pHere = priceAt(S, hereId, g);
    if (!pHere) continue;
    for (const m of markets) {
      const ratio = priceAt(S, m.id, g) / pHere;
      if (!best || ratio > best.ratio) best = { good: g, at: m, ratio };
    }
  }
  if (!best || best.ratio < 1.35) return null;
  const strength = best.ratio >= 1.9 ? 'double what it goes for here'
    : best.ratio >= 1.6 ? 'half again what it goes for here'
      : 'well over the price on these stalls';
  return {
    good: best.good,
    at: best.at.id,
    ratio: best.ratio,
    text: `Word is ${GOODS[best.good].name.toLowerCase()} is fetching ${strength} `
      + `at ${best.at.name}. You did not hear it from me.`,
  };
}

/**
 * The trade ledger: prices the company has PERSONALLY seen, town by town,
 * written down when a market's stalls are opened. The rumour system points
 * at spreads it has heard of; the ledger is what you know first-hand, and
 * it goes stale honestly — the entry keeps the day it was written.
 */
export function recordPrices(S, locId) {
  const l = locById(locId);
  if (!l?.services?.includes('market')) return;
  S.ledger = S.ledger || {};
  const prices = {};
  for (const g of GOODS_LIST) prices[g] = priceAt(S, locId, g);
  S.ledger[locId] = { day: S.day, prices };
}

/** Best SELLING price seen for a good, excluding the town you stand in. */
export function ledgerBest(S, goodId, excludeLoc = null) {
  let best = null;
  for (const [locId, entry] of Object.entries(S.ledger || {})) {
    if (locId === excludeLoc) continue;
    const p = entry.prices[goodId];
    if (p && (!best || p > best.price)) {
      best = { at: locId, price: p, day: entry.day };
    }
  }
  return best;
}

export function priceAt(S, locId, goodId) {
  refreshPrices(S);
  return S.prices?.[locId]?.[goodId] ?? GOODS[goodId]?.base ?? 0;
}

/** Does this settlement produce (green) or want (ochre) this good? */
export function priceTrend(locId, goodId) {
  const l = locById(locId);
  if (!l?.trade) return 'flat';
  if (l.trade.sell?.includes(goodId)) return 'cheap';
  if (l.trade.buy?.includes(goodId)) return 'dear';
  return 'flat';
}

export function buyGood(S, locId, goodId, qty = 1) {
  const g = GOODS[goodId];
  if (!g) return false;
  const unit = buyPriceAt(S, locId, goodId);
  const cost = unit * qty;
  if (S.credits < cost) return false;
  if (cargoUsed(S) + g.bulk * qty > cargoCap(S)) return false;
  S.credits -= cost;
  S.cargo[goodId] = (S.cargo[goodId] || 0) + qty;
  return true;
}

export function sellGood(S, locId, goodId, qty = 1) {
  if (!GOODS[goodId]) return false;
  const have = S.cargo[goodId] || 0;
  if (have < qty) return false;
  // Your own depots move stock better than a stranger's yard.
  const depot = isHolding(S, locId) ? (S.holdings[locId].upgrades?.depot || 0) : 0;
  const unit = Math.round(sellPriceAt(S, locId, goodId) * (1 + depot * 0.08));
  S.credits += unit * qty;
  // Trading somewhere regularly makes you part of the furniture.
  changeRelation(S, locId, 0.4);
  S.cargo[goodId] = have - qty;
  if (S.cargo[goodId] <= 0) delete S.cargo[goodId];
  return true;
}

/** Add something to the spoils bag rather than straight into stores. */
export function addSpoils(S, bucket, id, n = 1) {
  S.spoils = S.spoils || { credits: 0, cargo: {}, armoury: {}, armourPool: {}, kitPool: {} };
  if (bucket === 'credits') { S.spoils.credits += n; return; }
  S.spoils[bucket] = S.spoils[bucket] || {};
  S.spoils[bucket][id] = (S.spoils[bucket][id] || 0) + n;
}

export const hasSpoils = (S) => {
  const sp = S.spoils;
  if (!sp) return false;
  return !!sp.credits || ['cargo', 'armoury', 'armourPool', 'kitPool']
    .some((b) => Object.keys(sp[b] || {}).length);
};

/** Move everything in the spoils bag into the company's actual stores. */
export function claimSpoils(S) {
  const sp = S.spoils;
  if (!sp) return;
  S.credits += sp.credits || 0;
  for (const [id, n] of Object.entries(sp.armoury || {})) S.armoury[id] = (S.armoury[id] || 0) + n;
  for (const [id, n] of Object.entries(sp.armourPool || {})) S.armourPool[id] = (S.armourPool[id] || 0) + n;
  for (const [id, n] of Object.entries(sp.kitPool || {})) S.kitPool[id] = (S.kitPool[id] || 0) + n;
  for (const [id, n] of Object.entries(sp.cargo || {})) {
    const room = Math.floor(cargoFree(S) / (GOODS[id]?.bulk || 1));
    const take = Math.min(n, room);
    if (take > 0) S.cargo[id] = (S.cargo[id] || 0) + take;
  }
  S.spoils = { credits: 0, cargo: {}, armoury: {}, armourPool: {}, kitPool: {} };
}

// --------------------------------------------------------------------------
// Renown — how many people you can put in the field
// --------------------------------------------------------------------------

/** Maximum deployment size. This is the main progression lever in the game. */
export function deployLimit(S) {
  const tier = renownTier(S.renown || 0);
  // Sergeants let you run bigger formations than your name alone would.
  const sergeants = living(S).filter((s) => !s.isCommander && s.rank >= 3).length;
  return Math.min(16, tier.deploy + Math.floor(sergeants / 2));
}

export const renownName = (S) => renownTier(S.renown || 0).name;

export function addRenown(S, n, why) {
  if (!n) return null;
  const before = renownTier(S.renown || 0);
  S.renown = Math.max(0, (S.renown || 0) + n);
  const after = renownTier(S.renown);
  if (after.name !== before.name) {
    pushLog(S, `Bracket is now ${after.name.toLowerCase()} across Dovan.`, 'good');
    return after;
  }
  if (why) pushLog(S, why);
  return null;
}

/**
 * What beating a party is worth. Renown scales with how badly outnumbered you
 * were, so clearing looters stops paying once you are a real company and
 * breaking a column is the making of you.
 */
/**
 * Clearing a hideout: the camp goes, and every settlement near enough to have
 * been suffering for it notices. This is the cheapest standing in the game and
 * it should be, because it is the one thing you can do that makes somebody
 * else's road safer.
 */
export function clearLair(S, partyId) {
  const lair = S.parties.find((p) => p.id === partyId && p.kind === 'lair');
  if (!lair) return false;
  S.parties = S.parties.filter((p) => p.id !== partyId);
  // Anything it had already put on the road stays there — clearing the camp
  // stops the bleeding, it does not undo it.
  const near = LOCATIONS.filter((l) => l.kind !== 'open'
    && Math.hypot(l.x - lair.x, l.z - lair.z) < 620);
  for (const l of near) changeRelation(S, l.id, 12);
  S.stats.lairsCleared = (S.stats.lairsCleared || 0) + 1;
  companyReacts(S, 'lair');
  pushLog(S, `The hideout near ${locName(lair.home)} has been cleared out.`, 'good');
  if (near.length) {
    pushLog(S, `${near.length} settlement(s) will remember who did it.`, 'good');
  }
  return true;
}

export function spoilsFor(S, party, squadSize) {
  // A Titan is one unit on the marker and the hardest thing in the Reach, so
  // the ordinary strength-based formula would pay it out like a lone looter.
  // Killing one is a story the company tells for the rest of the campaign.
  if (party?.kind === 'titan') {
    return {
      renown: 420,
      credits: 6500,
      cargo: { machine_parts: 14, salvage: 22, optics: 5, fuel_cells: 8 },
      prisoners: 0,
      titan: true,
    };
  }
  const strength = party?.strength || 4;
  const odds = clamp(strength / Math.max(1, squadSize), 0.3, 4);
  return {
    renown: Math.round(strength * 1.4 * odds),
    credits: Math.round(strength * 12 * (party?.tier || 1) * 0.6),
    cargo: party?.cargo || null,
    prisoners: Math.max(0, Math.round(strength * 0.18)),
  };
}

// --------------------------------------------------------------------------
// Holdings — taking and improving ground
// --------------------------------------------------------------------------

/**
 * Who holds this place today.
 *
 * `LOCATIONS[].faction` is the founding owner and never changes — it is static
 * module data shared by every campaign in the process, so writing to it would
 * leak one playthrough's war into the next and break seeded determinism. The
 * current holder lives on the campaign.
 */
export const ownerOf = (S, locId) =>
  S?.mapOwner?.[locId] || locById(locId)?.faction || null;

export const isHolding = (S, locId) => !!S.holdings?.[locId];
export const holdingList = (S) =>
  Object.keys(S.holdings || {}).map((id) => ({ id, loc: locById(id), h: S.holdings[id] }))
    .filter((x) => x.loc);

/** Total level of an upgrade across every holding. */
export function upgradeTotal(S, key) {
  let n = 0;
  for (const id of Object.keys(S.holdings || {})) n += S.holdings[id].upgrades?.[key] || 0;
  return n;
}

export function seizeLocation(S, locId) {
  const l = locById(locId);
  if (!l || isHolding(S, locId)) return false;
  // Taken FROM whoever was holding it, which after a war may not be whoever
  // founded it — and it is that faction who wants it back, so formerFaction
  // drives the retake column.
  const from = ownerOf(S, locId);
  S.holdings[locId] = {
    upgrades: {}, takenDay: S.day, threat: 0, formerFaction: from || null,
  };
  // Taking ground from a faction is not a neutral act.
  if (from) S.rep[from] = (S.rep[from] || 0) - 6;
  // Taking a place by force is not how you make friends inside it.
  changeRelation(S, locId, -30);
  pushLog(S, `${l.name} is under Bracket control.`, 'good');
  return true;
}

export function loseHolding(S, locId) {
  const l = locById(locId);
  if (!isHolding(S, locId)) return false;
  // Anyone stationed there is not standing on the ground any more. They come
  // back to the company rather than vanishing with the holding — losing a place
  // should cost you the place, not quietly delete four of your people.
  for (const s of garrisonOf(S, locId)) s.garrison = null;
  delete S.holdings[locId];
  pushLog(S, `${l?.name || locId} has been lost.`, 'bad');
  return true;
}

// --------------------------------------------------------------------------
// Garrisons
//
// Somewhere to put people, and the reason to hold ground rather than collect
// it. A holding used to defend itself with one upgrade that slowed a number
// down; the only real defence was to be standing in it on the day, and if you
// were somewhere else it fell whatever you had built. Leaving soldiers behind
// makes a domain something you invest in and something raiders read from a
// distance.
// --------------------------------------------------------------------------

export const garrisonOf = (S, locId) =>
  living(S).filter((s) => s.garrison === locId);

/**
 * How hard this place is to take.
 *
 * The soldiers standing in it, plus what has been built around them. Deliberately
 * the same shape as the company's own power in estimateFight() — accuracy and
 * staying power, weighted by rank — so a garrison and a raiding party can be
 * compared without a second balance model that would drift away from the first.
 *
 * Defence Works multiplies rather than adds: wire and firing positions are worth
 * a great deal to somebody and nothing at all to an empty building.
 */
export function garrisonStrength(S, locId) {
  const h = S.holdings?.[locId];
  if (!h) return 0;
  const mods = companyMods(S.roster);
  let power = 0;
  for (const s of garrisonOf(S, locId)) {
    if (!deployable(s)) continue;              // the infirmary is not the wall
    const e = effective(s, mods);
    power += (e.accuracy * 1.35 + e.maxHp / 130) * (1 + s.rank * 0.22);
  }
  const works = h.upgrades?.works || 0;
  // Militia turn out for a defended place. They are not much on their own and
  // are worth having behind a revetment, which is why they scale with works.
  const militia = works * 0.55;
  // Conscripts stand on the wall alongside the garrison. They are not soldiers
  // and it shows, but a defended place with conscription is meaningfully harder
  // to take — which is what the policy is bought for.
  const levies = hasPolicy(S, 'conscription') ? 1.6 : 0;
  // A vassal holding the place defends it with their own household, which is
  // the entire point of granting one a fief: ground you hold otherwise has to
  // be garrisoned out of the same finite roster you deploy with.
  return (power + militia + levies + vassalStrength(S, locId)) * (1 + works * 0.22);
}

/**
 * What turns up when a holding's pressure boils over.
 *
 * Scaled to the region and to how far the campaign has come, so a place in the
 * Kettle is worried by looters and one in the Littoral is worried by something
 * organised, and so a domain held for a hundred days is not still being probed
 * by the same four men. Expressed on the same scale as garrisonStrength().
 */
function assaultStrength(S, loc) {
  const danger = REGIONS[loc.region]?.danger ?? 1;
  // A flag of your own attracts a serious answer; a liege sends people to help.
  const politics = S.ownFaction ? 1.45 : (S.allegiance ? 0.8 : 1);
  return (4.5 + danger * 2.2 + S.day * 0.018) * politics;
}

/**
 * The chance a holding's garrison turns an assault away on its own.
 *
 * Exposed so the holdings screen can answer the only question the player
 * actually has — "is four enough?" — with the same number the simulation will
 * roll against, rather than a description they have to guess from.
 */
export function assaultOdds(S, locId) {
  const loc = locById(locId);
  if (!loc || !isHolding(S, locId)) return 0;
  const defence = garrisonStrength(S, locId);
  if (defence <= 0) return 0;
  return clamp(defence / (defence + assaultStrength(S, loc)), 0, 0.95);
}

/** Re-exported so the interface can grey out anyone in the infirmary. */
export const deployableSoldier = (s) => deployable(s);

/** Hurt somebody who was defending a holding, without killing them. */
function woundGarrison(S, s, r) {
  // Stabilised: they held the ground, or were carried off it by their own
  // people. Losing a place costs you the place and the money in it, which is
  // the same bargain the rest of the game makes about defeat — it takes your
  // things, not the people you have spent thirty days getting attached to.
  resolveCasualty(r, s, { stabilised: true, hasMedic: hasMedic(S) });
}

/** Post a soldier to a holding. */
export function stationSoldier(S, locId, soldierId) {
  if (!isHolding(S, locId)) return { ok: false, why: 'That is not yours to garrison' };
  const s = S.roster.find((x) => x.id === soldierId);
  if (!s || s.status === STATUS.DEAD) return { ok: false, why: 'Nobody by that name' };
  if (s.isCommander) return { ok: false, why: 'You do not garrison yourself' };
  if (s.garrison === locId) return { ok: false, why: 'Already posted there' };
  // The company still has to be able to fight. A domain defended by everybody
  // is a company that cannot take a contract, and the wages still come out.
  if (ready(S).length <= 1 && deployable(s)) {
    return { ok: false, why: 'Somebody has to be able to take the field' };
  }
  s.garrison = locId;
  pushLog(S, `${s.name} is posted to ${locName(locId)}.`);
  return { ok: true };
}

/** Bring a soldier back onto the truck. */
export function recallSoldier(S, soldierId) {
  const s = S.roster.find((x) => x.id === soldierId);
  if (!s || !s.garrison) return { ok: false, why: 'Nobody by that name is posted' };
  const from = s.garrison;
  s.garrison = null;
  pushLog(S, `${s.name} rejoins the company from ${locName(from)}.`);
  return { ok: true };
}

export function upgradeCost(S, locId, key) {
  const def = HOLDING_UPGRADES[key];
  if (!def) return null;
  const lv = S.holdings?.[locId]?.upgrades?.[key] || 0;
  if (lv >= def.max) return null;
  return def.cost(lv);
}

export function canAfford(S, cost) {
  if (!cost) return false;
  if (S.credits < (cost.credits || 0)) return false;
  for (const [g, n] of Object.entries(cost)) {
    if (g === 'credits') continue;
    if ((S.cargo[g] || 0) < n) return false;
  }
  return true;
}

/** Spend credits and goods from the truck to raise an upgrade one level. */
export function buildUpgrade(S, locId, key) {
  const cost = upgradeCost(S, locId, key);
  if (!cost || !canAfford(S, cost)) return false;
  S.credits -= cost.credits || 0;
  for (const [g, n] of Object.entries(cost)) {
    if (g === 'credits') continue;
    S.cargo[g] = (S.cargo[g] || 0) - n;
    if (S.cargo[g] <= 0) delete S.cargo[g];
  }
  const h = S.holdings[locId];
  h.upgrades[key] = (h.upgrades[key] || 0) + 1;
  pushLog(S,
    `${HOLDING_UPGRADES[key].name} at ${locName(locId)} raised to level ${h.upgrades[key]}.`, 'good');
  return true;
}

/** Extra cargo space from every Depot the company owns. */
export const depotCapacity = (S) => upgradeTotal(S, 'depot') * 20;

/** Daily production from holdings, paid into credits and the truck. */
/**
 * What a soldier costs to keep, per day.
 *
 * Scaled by rank, because a sergeant who has survived thirty deployments does
 * not work for recruit money — which is the quiet pressure that stops a company
 * from being purely additive. A veteran roster is expensive to sit still with.
 */
export function wageOf(s) {
  if (s.isCommander) return 0;               // you do not pay yourself
  const base = { rifleman: 9, breacher: 12, marksman: 13, gunner: 14, medic: 15, signals: 14 };
  return Math.round((base[s.role] || 10) * (1 + s.rank * 0.55));
}

export function payrollOf(S) {
  return living(S).reduce((a, s) => a + wageOf(s), 0);
}

/** Food eaten per day. Everyone eats, including the wounded and the commander. */
export function upkeepOf(S) {
  return { wages: payrollOf(S), food: Math.max(1, Math.ceil(living(S).length * 0.5)) };
}

export const MORALE_TIERS = [
  { at: 0, name: 'Mutinous', note: 'People are walking. Fix this now.' },
  { at: 25, name: 'Sullen', note: 'They do as they are told and nothing more.' },
  { at: 45, name: 'Steady', note: 'No complaints worth hearing.' },
  { at: 65, name: 'Willing', note: 'They believe the company is going somewhere.' },
  { at: 85, name: 'Devoted', note: 'They would follow you into the Scour on foot.' },
];

export const moraleTier = (S) => [...MORALE_TIERS].reverse()
  .find((t) => (S.morale ?? 70) >= t.at) || MORALE_TIERS[0];

/**
 * The daily reckoning: wages out, food eaten, morale adjusted, and — if it has
 * been bad for long enough — somebody leaves in the night.
 *
 * Desertion is deliberately slow and always announced. A soldier vanishing with
 * no warning would be a bug as far as the player is concerned; a soldier
 * vanishing after three days of being unpaid and hungry is a consequence.
 */
export function payday(S, r) {
  const { wages, food } = upkeepOf(S);
  S.lastPayroll = wages;

  let drift = 0;

  if (S.credits >= wages) {
    S.credits -= wages;
    // Catching up on arrears is worth more than a day of ordinary pay. Without
    // this, fixing your finances still left the company deserting for a week
    // while a lagging number climbed — people leave because you cannot pay
    // them, not because of arithmetic.
    if (S.unpaidDays > 0) {
      drift += 9;
      pushLog(S, `Back pay settled after ${S.unpaidDays} day(s).`, 'good');
    }
    S.unpaidDays = 0;
    drift += 1.5;
  } else {
    // Pay what there is. Partial pay is still noticed, and still resented.
    const paid = Math.max(0, S.credits);
    S.credits = 0;
    S.unpaidDays = (S.unpaidDays || 0) + 1;
    drift -= 6 + S.unpaidDays * 2;
    companyReacts(S, 'unpaid');
    pushLog(S, paid > 0
      ? `Payroll short by ${wages - paid} credits. They noticed.`
      : `Nobody was paid today. Wages owed: ${wages}.`, 'bad');
  }

  if ((S.rations || 0) >= food) {
    S.rations -= food;
    drift += 1;
    if (S.rations <= 3) {
      pushLog(S, `Rations down to ${S.rations} days. Buy food.`, 'bad');
    }
  } else {
    S.rations = 0;
    drift -= 7;
    pushLog(S, 'The company went hungry.', 'bad');
  }

  // Fed is not the same as looked after.
  //
  // Food was a switch: rations or no rations, minus seven either way. So a
  // company living on ration packs with no medical stock and nothing to drink
  // was in exactly the same spirits as one that was properly provisioned, and
  // the only supply decision worth making was "do not hit zero". Carrying more
  // than the bare minimum is worth something, which gives the stores screen a
  // reason to exist beyond selling.
  //
  // Small on purpose. This is a nudge on top of pay and food, not a substitute
  // for them — a company that has not been paid does not cheer up because
  // somebody found the water.
  if ((S.rations || 0) > 0) {
    const kept = [(S.medical || 0) > 0, (S.cargo?.water || 0) > 0,
      (S.cargo?.medical_stock || 0) > 0].filter(Boolean).length;
    if (kept) {
      drift += Math.min(2.5, kept * 1.1);
      if (kept >= 2 && (S.morale ?? 70) < 55 && r() < 0.12) {
        pushLog(S, 'Hot food, clean water and a medic. The mood picks up.', 'good');
      }
    }
  }

  // A big company on nothing in particular grumbles; a small tight one does not.
  const n = living(S).length;
  if (n > 8) drift -= (n - 8) * 0.4;

  S.morale = clamp((S.morale ?? 70) + drift, 0, 100);

  // Desertion. Only from the bottom of the roster, never the commander, and
  // never silently.
  // Desertion needs a live grievance, not just a low number: somebody walks
  // because they are hungry or unpaid RIGHT NOW. A company that has been paid
  // and fed keeps its people while morale recovers.
  const aggrieved = (S.unpaidDays || 0) > 0 || (S.rations || 0) <= 0;
  if (aggrieved && S.morale < 20 && n > 1 && r() < (20 - S.morale) / 90) {
    const pool = living(S).filter((s) => !s.isCommander)
      .sort((a, b) => a.rank - b.rank || a.xp - b.xp);
    const gone = pool[0];
    if (gone) {
      S.roster = S.roster.filter((s) => s.id !== gone.id);
      S.stats.deserted = (S.stats.deserted || 0) + 1;
      pushLog(S, `${gone.name} was gone before first light. No note.`, 'bad');
    }
  }
}

// --------------------------------------------------------------------------
// The war moves the map
//
// A war used to be a diplomatic state and nothing else: it decided who shot at
// you on the road and left the continent exactly as it found it. Trust and
// Syndic could be at war for two hundred days and not one settlement would
// change hands, so the argument you were being paid to fight in had no visible
// stake and no progress. This makes the front line real — and it makes taking a
// commission mean something, because the side you swore to can now be losing.
// --------------------------------------------------------------------------

/** Settlements a faction holds right now, founding owner plus anything taken. */
export function settlementsOf(S, factionId) {
  return LOCATIONS.filter((l) => l.kind !== 'open'
    && !isHolding(S, l.id)                  // yours is yours; it has its own siege
    && ownerOf(S, l.id) === factionId);
}

/**
 * One day of a war between two factions.
 *
 * The target is the defender's settlement CLOSEST to the attacker's own ground,
 * so the border moves as a line rather than teleporting across the continent —
 * a faction that takes the far side of the map on a lucky roll reads as noise,
 * while one that pushes settlement by settlement reads as a war going badly.
 */
function tryCapture(S, r, attacker, defender) {
  const mine = settlementsOf(S, attacker);
  const theirs = settlementsOf(S, defender);
  // Somebody has to be left to lose it. A faction reduced to one place keeps it
  // — being wiped off the map entirely takes the player's contracts with it.
  if (!mine.length || theirs.length <= 1) return null;
  // One offensive at a time per faction. Without this a long war stacks columns
  // until the map is nothing but armies.
  if (S.parties.some((p) => p.siegeTarget && p.faction === attacker)) return null;

  let best = null, bd = Infinity, from = null;
  for (const t of theirs) {
    for (const m of mine) {
      const d = Math.hypot(t.x - m.x, t.z - m.z);
      if (d < bd) { bd = d; best = t; from = m; }
    }
  }
  if (!best) return null;

  // March on it, rather than flipping a flag.
  //
  // A capture used to be a dice roll and a line in the log: the player read
  // that a town had fallen and had no way to have been part of it. Sending a
  // column that takes days to arrive makes the war a thing on the map you can
  // ride out and meet — kill it and the town holds. It is also what lets the
  // war go badly for the attacker without the player: tickPartyBattles() means
  // a defending patrol can break the column on the road.
  const col = spawnParty(S, r, attacker === 'trust' ? 'warband_trust' : 'warband_syndic', from.id);
  // A siege HOST, not a patrol. Taking a town takes an army, and an army is
  // what the player joins when they answer the summons — hundreds, fed onto
  // the field in ranks through the mission's wave streaming. On the map it
  // fights the same durational battles as everything else, just for longer.
  col.strength = Math.round(col.strength * range(r, 3.2, 4.6));
  // The lord leading it raises the army their temperament deserves: a
  // martial lord marches heavy, a cautious one holds people back.
  const colLord = lordOfParty(S, col);
  if (colLord) col.strength = Math.round(col.strength * temperOf(colLord).host);
  col.x = from.x + range(r, -20, 20);
  col.z = from.z + range(r, -20, 20);
  col.siegeTarget = best.id;
  col.tx = best.x;
  col.tz = best.z;
  col.name = `${FACTIONS[attacker]?.short || attacker} column`;
  pushLog(S, `${FACTIONS[attacker]?.name || attacker} is moving on ${best.name}.`,
    S.allegiance === defender ? 'bad' : 'info');

  // Your own side calls you to it.
  //
  // Swearing to a faction used to mean taking its contracts off a board like
  // anybody else's. A liege that never asks anything of you at a time of its
  // choosing is an employer, not a liege — so when the side you are sworn to
  // marches, you are expected on the field, and not turning up is noticed.
  if (attacker === S.allegiance) {
    S.contracts.push({
      id: uid('con'),
      type: 'siege',
      site: best.id,
      employer: attacker,
      summons: col.id,
      title: `Join the assault on ${best.name}`,
      text: `${FACTIONS[attacker].name} is moving on ${best.name} and expects `
        + 'Bracket on the field. Be there before the column arrives.',
      pay: 500 + Math.round(bd * 0.4),
      expiresDay: S.day + 4,
      accepted: false,
    });
    pushLog(S, `${FACTIONS[attacker].name} has summoned Bracket to ${best.name}.`, 'world');
  }
  // The other side of the same call: when the host is marching on YOUR
  // liege's town, you are expected inside the walls before it arrives.
  if (defender === S.allegiance) {
    S.contracts.push({
      id: uid('con'),
      type: 'defense',
      defend: true,
      site: best.id,
      employer: defender,
      summons: col.id,
      enemyFaction: attacker,
      title: `Hold ${best.name} against ${FACTIONS[attacker]?.short || attacker}`,
      text: `${FACTIONS[attacker].name} is marching on ${best.name}. `
        + `${FACTIONS[defender].name} expects Bracket inside the walls `
        + 'before the column arrives.',
      pay: 550 + Math.round(bd * 0.4),
      expiresDay: S.day + 4,
      accepted: false,
    });
    pushLog(S, `${best.name} calls for its defenders. The column is on the road.`, 'bad');
  }
  return { loc: best, attacker, defender, column: col };
}

/**
 * Settle a summons the player never answered.
 *
 * Called when the column arrives or dies, because either way the moment has
 * passed. The cost is standing rather than money: a liege does not fine you for
 * not turning up, it remembers.
 */
function closeSummons(S, columnId, { showedUp }) {
  const i = S.contracts.findIndex((c) => c.summons === columnId);
  if (i < 0) return;                          // taken and completed already
  const [c] = S.contracts.splice(i, 1);
  if (showedUp || !c.employer) return;
  S.rep[c.employer] = (S.rep[c.employer] || 0) - 5;
  pushLog(S, `${FACTIONS[c.employer]?.name || c.employer} noted that Bracket `
    + 'was not on the field.', 'bad');
}

/** The convoy made it: the road paid, or would have if you had taken it. */
function deliverConvoy(S, p) {
  S.parties = S.parties.filter((x) => x.id !== p.id);
  const c = S.contracts.find((x) => x.escortTo && x.convoyId === p.id);
  if (!c) return;
  S.contracts = S.contracts.filter((x) => x.id !== c.id);
  if (!c.accepted) return;                     // it rolled without you
  S.credits += c.pay;
  changeRelation(S, c.escortTo, 4);
  pushLog(S, `The convoy reached ${locName(c.escortTo)}. Escort paid: ${c.pay} credits.`, 'good');
}

/**
 * A convoy hiring escorts, posted between two market towns. One at a time on
 * the board; the pay is honest about the distance, and it lands only when
 * the load does — the whole contract is the road between here and there.
 */
function maybeEscortContract(S, r) {
  if (S.contracts.some((c) => c.type === 'escort')) return;
  if (r() > 0.35) return;
  const markets = LOCATIONS.filter((l) => l.services?.includes('market'));
  if (markets.length < 2) return;
  const from = pick(r, markets);
  const to = pick(r, markets.filter((m) => m.id !== from.id));
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  if (dist < 250) return;
  S.contracts.push({
    id: uid('con'),
    type: 'escort',
    site: from.id,
    escortTo: to.id,
    employer: null,
    title: `Escort the convoy to ${to.name}`,
    text: `Hauliers out of ${from.name} are taking a load to ${to.name} and `
      + 'will pay for company on the road. The pay lands when the load does.',
    pay: 380 + Math.round(dist * 0.6),
    expiresDay: S.day + 5,
    accepted: false,
  });
  pushLog(S, `A convoy at ${from.name} is hiring escorts for the ${to.name} road.`);
}

/** A column that has reached what it was sent for. */
function resolveSiege(S, p) {
  const loc = locById(p.siegeTarget);
  p.siegeTarget = null;
  closeSummons(S, p.id, { showedUp: false });
  if (!loc) return;
  // The player's own ground is never taken this way — a holding has its own
  // pressure and its own retake contract, and quietly losing one to a passing
  // column would make that whole system a lie.
  if (isHolding(S, loc.id)) return;
  const defender = ownerOf(S, loc.id);
  if (defender === p.faction) return;         // somebody got here first
  S.mapOwner[loc.id] = p.faction;
  pushLog(S, `${FACTIONS[p.faction]?.name || p.faction} has taken ${loc.name}`
    + `${defender ? ` from ${FACTIONS[defender]?.name || defender}` : ''}.`,
    S.allegiance === defender ? 'bad' : 'info');
}

/**
 * Bands that hate each other, meeting on the road.
 *
 * Every party in this game used to be interested in exactly one thing — the
 * player. Raiders and patrols could stand on the same crossroads for a hundred
 * days without acknowledging one another, which made the Reach a stage set that
 * only came alive when you walked onto it. Now a Trust column that runs into
 * Syndic hauliers during a war has an opinion about it, and so does every
 * raider band that meets anybody.
 *
 * Resolved rather than played: these happen off-screen, often, and turning one
 * into a deployment the player did not choose would be an ambush by the
 * simulation. What the player gets is the aftermath, and a road whose danger is
 * not aimed solely at them.
 */
function partiesHostile(S, a, b) {
  if (a.owner === 'player' || b.owner === 'player') {
    // Your own hauliers are somebody else's target, which is the entire risk
    // of running caravans and is already modelled in tickCaravans().
    return false;
  }
  const fa = a.faction, fb = b.faction;
  // Raiders are everybody's problem and have no diplomacy — INCLUDING the
  // unaligned trade caravans, which were invisible to them while this bailed
  // on null factions. A convoy attack is the oldest event this game models
  // itself on, and it emerges from this one line plus the battle system:
  // raiders catch a trader, a patrol marches to the sound, the road keeps
  // the wreckage.
  if ((fa === 'raider') !== (fb === 'raider')) return true;
  if (!fa || !fb || fa === fb) return false;
  return Dip.relationBetween(S, fa, fb) === 'war';
}

// Superseded: party-vs-party fighting is durational now — see tickMapBattles
// above, which advanceTime drives through this name.
function tickPartyBattles(S, hours, r) {
  tickMapBattles(S, hours, r);
}

/**
 * Raiders bleed the places they camp next to.
 *
 * A hideout produced bands that existed only to inconvenience the player, so
 * clearing one was a contract rather than a rescue — the road got quieter and
 * nothing else changed. Now a band sitting on a settlement takes people off it,
 * which shows up as an empty hiring board and gives "something has dug in near
 * Vetch" a consequence you can feel from two regions away.
 *
 * A garrison stops it. That is the point of a garrison, and it is the first
 * thing in the game that makes defending somebody else's town worth doing.
 */
function tickRaids(S, r) {
  for (const p of S.parties) {
    if (p.faction !== 'raider' || PARTY_TIERS[p.kind]?.static) continue;
    const loc = LOCATIONS.find((l) => l.kind !== 'open'
      && Math.hypot(l.x - p.x, l.z - p.z) < 45);
    if (!loc) continue;
    // Anywhere with people standing in it is not worth the trouble.
    if (isHolding(S, loc.id) && garrisonStrength(S, loc.id) > 0) continue;
    S.raided = S.raided || {};
    // Stores WHEN, not a cooldown stamp: the same number decides both how often
    // a place can be hit and how long it stops recovering afterwards.
    if (S.day - (S.raided[loc.id] ?? -99) < RAID_EVERY) continue;
    const took = drawManpower(S, loc.id, irange(r, 3, 6));
    if (!took) continue;
    S.raided[loc.id] = S.day;
    if (Math.hypot(loc.x - S.pos.x, loc.z - S.pos.z) < 420) {
      pushLog(S, `${p.name} took people off ${loc.name}.`, 'bad');
    }
  }
}

function tickWar(S, r) {
  const majors = Dip.MAJOR_FACTIONS;
  for (let i = 0; i < majors.length; i++) {
    for (let j = i + 1; j < majors.length; j++) {
      const a = majors[i], b = majors[j];
      if (Dip.relationBetween(S, a, b) !== 'war') continue;
      // Slow on purpose. A settlement every couple of weeks is a war you notice
      // across a campaign; one a day is a map that has stopped meaning anything.
      if (r() > 0.07) continue;
      // Momentum goes to whoever holds more ground, so wars resolve instead of
      // oscillating between the same two towns forever.
      const na = settlementsOf(S, a).length, nb = settlementsOf(S, b).length;
      const aPush = r() < (na + 1) / (na + nb + 2);
      tryCapture(S, r, aPush ? a : b, aPush ? b : a);
    }
  }
}

/**
 * The whole domain at a glance, without collecting anything.
 *
 * The holdings screen listed each place in full and totalled nothing, so the
 * question a landholder actually has — what does this domain earn, where is it
 * weak, is anywhere about to be attacked — could only be answered by reading
 * every entry and doing the arithmetic yourself. This is the same maths
 * collectHoldings() runs on the day tick, factored out so it can be shown
 * rather than only applied.
 */
/**
 * Take a beaten commander into your service.
 *
 * The obvious thing to do with a prisoner is sell them back. This is the other
 * thing, and it is the one that builds something: a lord who swears to you
 * stops being an enemy who returns every few weeks and becomes somebody who
 * holds your ground while you are two provinces away.
 *
 * They are far likelier to listen if you have beaten them repeatedly and if you
 * are somebody worth serving — a company nobody has heard of asking a
 * professional soldier to change sides is a joke, and it is refused as one.
 */
export function lordServiceOdds(S, lord) {
  if (!S.ownFaction) return 0;
  const beaten = Math.min(0.45, (lord.defeats || 0) * 0.15);
  const standing = Math.min(0.3, (S.renown || 0) / 4000);
  // Somebody with a record of winning thinks rather more of their present
  // employer than somebody you have broken three times.
  const pride = Math.min(0.3, (lord.wins || 0) * 0.06);
  return clamp(0.1 + beaten + standing - pride, 0.05, 0.8);
}

export function offerService(S, id) {
  const lord = lordById(S, id);
  if (!lord || !lord.captured || !lord.heldByPlayer) return { ok: false, why: 'Not yours to ask' };
  if (!S.ownFaction) return { ok: false, why: 'Nobody swears to a company for hire' };
  const r = rng((S.seed + S.day * 131 + (lord.id.length * 17)) | 0);
  const took = r() < lordServiceOdds(S, lord);
  lord.captured = false;
  lord.heldByPlayer = false;
  if (!took) {
    // Asked and refused. They go home knowing you asked, which is its own cost.
    lord.freeDay = S.day + 10;
    if (S.rep[lord.faction] != null) S.rep[lord.faction] -= 2;
    pushLog(S, `${lord.name} refused to take your colours, and went home saying so.`, 'bad');
    return { ok: true, took: false };
  }
  const from = lord.faction;
  lord.faction = S.ownFaction.id;
  lord.vassal = true;
  lord.fief = null;
  lord.freeDay = S.day + 2;
  if (S.rep[from] != null) S.rep[from] -= 8;
  S.renown = (S.renown || 0) + 25;
  pushLog(S, `${lord.name} has sworn to ${S.ownFaction.name}.`, 'good');
  return { ok: true, took: true };
}

export const vassals = (S) => (S.lords || []).filter((l) => l.vassal);

// --------------------------------------------------------------------------
// Tavern mercenaries and the dice
// --------------------------------------------------------------------------

const MERC_BANDS = [
  { id: 'redline', name: 'The Redline Crew', size: 7 },
  { id: 'kestrels', name: 'Kestrel Irregulars', size: 6 },
  { id: 'ashwalkers', name: 'The Ashwalkers', size: 9 },
  { id: 'tollmen', name: 'The Tollmen', size: 8 },
];

/**
 * The fighting band drinking in this town today, if the rotation seats one:
 * a mercenary company for hire by the JOB, not the roster. Deterministic
 * per town per day, like companions and courts.
 */
export function mercBandAt(S, locId) {
  const l = locById(locId);
  if (!l?.services?.includes('recruit')) return null;
  if (S.mercBand && S.day <= S.mercBand.untilDay) return null;  // one at a time
  const h = (S.day * 17 + locId.length * 5 + locId.charCodeAt(0)) % (MERC_BANDS.length * 2);
  if (h >= MERC_BANDS.length) return null;         // some days the room is empty
  const band = MERC_BANDS[h];
  return { ...band, fee: band.size * 120 };
}

/**
 * Hire the band for three days: every deployment in that window fields them
 * as allies, streamed in like any allied force. Paid up front — mercenaries
 * have heard every version of "after the job".
 */
export function hireMercBand(S, locId) {
  const band = mercBandAt(S, locId);
  if (!band) return { ok: false, why: 'The room is empty' };
  if (S.credits < band.fee) return { ok: false, why: 'Mercenaries are paid up front' };
  S.credits -= band.fee;
  S.mercBand = { id: band.id, name: band.name, size: band.size, untilDay: S.day + 3 };
  pushLog(S, `${band.name} signed on for three days. ${band.size} guns, paid up front.`, 'good');
  return { ok: true, band: S.mercBand };
}

export const mercActive = (S) => (S.mercBand && S.day <= S.mercBand.untilDay)
  ? S.mercBand : null;

// --------------------------------------------------------------------------
// Workshops: a stall bought, not ground taken
// --------------------------------------------------------------------------

export const WORKSHOP_COST = 2400;
export const WORKSHOP_SELL = 1600;

/**
 * Buy a stall in a market town: passive income that lives on the town's
 * health, not yours. One per town; the town has to at least tolerate you.
 */
export function buyWorkshop(S, locId) {
  const l = locById(locId);
  if (!l?.services?.includes('market')) return { ok: false, why: 'No market to trade from' };
  S.workshops = S.workshops || {};
  if (S.workshops[locId]) return { ok: false, why: 'You already hold the stall here' };
  if (relationOf(S, locId) < -20) return { ok: false, why: 'Nobody sells a stall to an enemy' };
  if (S.credits < WORKSHOP_COST) return { ok: false, why: `A stall costs ${WORKSHOP_COST}` };
  S.credits -= WORKSHOP_COST;
  S.workshops[locId] = { sinceDay: S.day };
  pushLog(S, `Bracket bought the stall rights at ${l.name}.`, 'good');
  return { ok: true };
}

export function sellWorkshop(S, locId) {
  if (!S.workshops?.[locId]) return { ok: false, why: 'Nothing to sell here' };
  delete S.workshops[locId];
  S.credits += WORKSHOP_SELL;
  pushLog(S, `The stall at ${locName(locId)} was sold on for ${WORKSHOP_SELL}.`, 'world');
  return { ok: true };
}

/** What one stall pays today: the town's health, in miniature. */
export function workshopIncome(S, locId) {
  const rel = relationOf(S, locId);
  if (rel <= -25) return 0;                     // the town freezes you out
  let pay = 60;
  // A mustered-out town has no customers.
  pay *= clamp(manpowerAt(S, locId) / 20, 0.4, 1.2);
  // A holder at war spends on the war.
  const holder = ownerOf(S, locId);
  if (holder && Dip.enemiesOf(S, holder).length) pay *= 0.6;
  if (rel >= 40) pay *= 1.2;
  return Math.round(pay);
}

// The pit's named circuit: fighters with records, bouts you can bet on, and
// a champion whose name travels. Fame is the standings table.
const PIT_FIGHTERS = [
  { id: 'saw', name: 'Marla Saw', style: 'counter-puncher' },
  { id: 'brick', name: 'Brick Odom', style: 'walks through it' },
  { id: 'wren', name: 'Little Wren', style: 'never where you aim' },
  { id: 'kolya', name: 'Kolya the Debt', style: 'patient, then not' },
  { id: 'harrow', name: 'The Harrow Kid', style: 'all opening round' },
  { id: 'venn', name: 'Old Venn', style: 'has seen your trick' },
];

/** Today's exhibition bout: two named fighters, odds from their records. */
export function exhibitionBout(S) {
  const h = (S.day * 13) % PIT_FIGHTERS.length;
  const k = (S.day * 7 + 3) % PIT_FIGHTERS.length;
  if (h === k) return null;                       // dark night at the pit
  const fame = S.pitFame || {};
  const a = PIT_FIGHTERS[h], b = PIT_FIGHTERS[k];
  const fa = fame[a.id] || 0, fb = fame[b.id] || 0;
  // The favourite is the record, and the book prices accordingly.
  const oddsA = clamp(0.5 + (fa - fb) * 0.08, 0.25, 0.75);
  return { a, b, oddsA };
}

/**
 * Put money on a name. Resolves on the spot — the bout runs tonight whether
 * you stay to watch or not — and the WINNER'S fame is real: it moves the
 * standings the next bout is priced from. Underdogs pay better, as they
 * must.
 */
export function betExhibition(S, onA, stake = 150) {
  const bout = exhibitionBout(S);
  if (!bout) return { ok: false, why: 'No bout on the card tonight' };
  if (S.betDay === S.day) return { ok: false, why: 'One bet a night keeps the book friendly' };
  if (S.credits < stake) return { ok: false, why: 'The book plays for money' };
  S.credits -= stake;
  S.betDay = S.day;
  const r = rng((S.seed ^ 0xb0d7) + S.day * 211);
  const aWins = r() < bout.oddsA;
  const winner = aWins ? bout.a : bout.b;
  S.pitFame = S.pitFame || {};
  S.pitFame[winner.id] = (S.pitFame[winner.id] || 0) + 1;
  const picked = onA === aWins;
  if (picked) {
    const oddsPicked = onA ? bout.oddsA : 1 - bout.oddsA;
    const payout = Math.round(stake * (oddsPicked < 0.5 ? 2.4 : 1.7));
    S.credits += stake + payout;
    pushLog(S, `${winner.name} took the bout. The book paid ${payout} on your ${stake}.`, 'good');
    return { ok: true, won: true, winner: winner.name, payout };
  }
  pushLog(S, `${winner.name} took the bout, and the book took your ${stake}.`, 'bad');
  return { ok: true, won: false, winner: winner.name };
}

/** The current champion, by the standings, if anybody has a record yet. */
export function pitChampion(S) {
  const fame = S.pitFame || {};
  let best = null;
  for (const f of PIT_FIGHTERS) {
    const w = fame[f.id] || 0;
    if (w > 0 && (!best || w > best.wins)) best = { ...f, wins: w };
  }
  return best;
}

/**
 * The dice by the pit door. The house edge is honest and visible: even
 * money on a 46% roll, deterministic per attempt so a reload rolls the
 * same bones.
 */
export function rollDice(S, stake = 100) {
  if (S.credits < stake) return { ok: false, why: 'The table plays for money' };
  S.credits -= stake;
  S.diceCount = (S.diceCount || 0) + 1;
  const r = rng((S.seed ^ 0xd1ce) + S.day * 97 + S.diceCount * 31);
  const won = r() < 0.46;
  if (won) S.credits += stake * 2;
  pushLog(S, won ? `The bones came up. ${stake} doubled at the pit door.`
    : `The bones went the house's way. ${stake} gone.`, won ? 'good' : 'bad');
  return { ok: true, won };
}

/**
 * The lord at court in this town today, if the rotation seats one here:
 * a commander of the holder faction who is not in the field, not captured,
 * and not already yours. Deterministic per town per day, companion-style —
 * courts are a fact about the day, not a slot machine.
 */
export function lordAt(S, locId) {
  const owner = ownerOf(S, locId);
  if (owner !== 'trust' && owner !== 'syndic') return null;
  const busy = new Set(S.parties.map((p) => p.lordId).filter(Boolean));
  const home = (S.lords || []).filter((l) => l.faction === owner
    && !l.captured && !busy.has(l.id) && !l.vassal);
  if (!home.length) return null;
  const h = (S.day * 31 + locId.length * 7 + locId.charCodeAt(0)) % home.length;
  return home[h];
}

/**
 * A gift, given at court. Regard is the currency of every lord system —
 * pursuit, ransom lines, defection — and this is the one lever the player
 * can pull on it deliberately. Once a day per lord: a second gift in an
 * afternoon is not generosity, and lords know the difference.
 */
export function giftLord(S, lordId, cost = 300) {
  const lord = lordById(S, lordId);
  if (!lord) return { ok: false, why: 'Gone from court' };
  if (lord.giftDay === S.day) {
    return { ok: false, why: 'One gift a day is generosity; two is a bribe' };
  }
  if (S.credits < cost) {
    return { ok: false, why: 'The ledger cannot cover a gift worth giving' };
  }
  S.credits -= cost;
  lord.giftDay = S.day;
  lord.regard = clamp((lord.regard || 0) + 1, -10, 10);
  pushLog(S, `${lord.name} accepted a gift, and was seen to.`, 'good');
  return { ok: true, regard: lord.regard };
}

/**
 * Asking a lord at court to take your colours. The peaceful sibling of
 * offerService(): no capture required, but the bar is high — regard 7 is a
 * friendship built over many gifts and released prisoners, and the asking
 * itself is safe only because courts are private.
 */
export function courtDefection(S, lordId) {
  const lord = lordById(S, lordId);
  if (!lord) return { ok: false, why: 'Gone from court' };
  if (!S.ownFaction) return { ok: false, why: 'Nobody defects to a company for hire' };
  if (lord.faction === S.ownFaction.id) return { ok: false, why: 'They already wear your colours' };
  if ((lord.regard || 0) < 7) {
    return { ok: false, why: 'They are not fond enough of Bracket to fall with it' };
  }
  const from = lord.faction;
  lord.faction = S.ownFaction.id;
  lord.vassal = true;
  lord.fief = null;
  if (S.rep[from] != null) S.rep[from] -= 8;
  S.renown = (S.renown || 0) + 25;
  pushLog(S, `${lord.name} has left ${FACTIONS[from]?.name || from} and sworn to ${S.ownFaction.name}.`, 'good');
  return { ok: true };
}

/**
 * Put a vassal on one of your holdings.
 *
 * This is what a vassal is FOR. Ground you hold has to be garrisoned out of
 * your own roster, which is the same finite handful of people you deploy with —
 * so every place you take makes the company weaker in the field. A lord holding
 * it for you breaks that trade: they defend it with their own people, and you
 * get your soldiers back.
 */
export function grantFief(S, lordId, locId) {
  const lord = lordById(S, lordId);
  if (!lord?.vassal) return { ok: false, why: 'Not one of yours' };
  if (!isHolding(S, locId)) return { ok: false, why: 'You do not hold that' };
  const taken = vassals(S).find((l) => l.fief === locId && l.id !== lordId);
  if (taken) return { ok: false, why: `${taken.name} already holds it` };
  lord.fief = locId;
  pushLog(S, `${lord.name} holds ${locName(locId)} for ${S.ownFaction?.name || 'Bracket'}.`, 'good');
  return { ok: true };
}

/** What a vassal adds to the defence of the place they hold. */
export function vassalStrength(S, locId) {
  const l = vassals(S).find((v) => v.fief === locId);
  if (!l) return 0;
  // Their own household, and better for a commander who has won things.
  return 3.5 + Math.min(4, (l.wins || 0) * 0.8);
}

export const hasPolicy = (S, id) => !!S.policies?.[id];

/**
 * Enact or repeal a standing decision.
 *
 * Only with a flag of your own: these are the acts of a power, and a company
 * for hire levying taxes on other people's towns would simply be robbing them,
 * which the game already has a verb for.
 */
export function setPolicy(S, id, on) {
  if (!POLICIES[id]) return { ok: false, why: 'No such policy' };
  if (!S.ownFaction) return { ok: false, why: 'You would need a flag of your own first' };
  S.policies = S.policies || {};
  if (on) S.policies[id] = true; else delete S.policies[id];
  pushLog(S, on ? `${POLICIES[id].name} is in force across Bracket ground.`
    : `${POLICIES[id].name} has been lifted.`, on ? 'world' : 'good');
  // Charging strangers to use the roads is noticed by the powers whose traffic
  // it is, once, when you start doing it.
  if (on && id === 'tolls') {
    for (const f of Dip.MAJOR_FACTIONS) {
      if (S.rep[f] != null) S.rep[f] -= 4;
    }
  }
  return { ok: true };
}

export function realmSummary(S) {
  const rows = holdingList(S).map(({ id, loc, h }) => {
    const base = HOLDING_YIELD[loc.kind] || HOLDING_YIELD.outpost;
    const credits = Math.round(base.credits * (1 + (h.upgrades.depot || 0) * 0.15));
    const goods = { ...base.goods };
    const work = h.upgrades.workshop || 0;
    if (work) goods.machine_parts = (goods.machine_parts || 0) + work * 2;
    const built = UPGRADE_LIST.reduce((a, k) => a + (h.upgrades[k] || 0), 0);
    const garrison = garrisonOf(S, id);
    return {
      id,
      name: loc.name,
      kind: loc.kind,
      credits,
      goods,
      built,
      threat: Math.min(1, h.threat || 0),
      garrison: garrison.length,
      strength: garrisonStrength(S, id),
      odds: assaultOdds(S, id),
      // What the place can still put forward, which is the thing that decides
      // whether it can reinforce itself.
      manpower: Math.floor(manpowerAt(S, id)),
      manpowerCap: manpowerCap(loc),
    };
  });
  return {
    rows,
    holdings: rows.length,
    credits: rows.reduce((a, r) => a + r.credits, 0),
    garrison: rows.reduce((a, r) => a + r.garrison, 0),
    built: rows.reduce((a, r) => a + r.built, 0),
    // The two numbers that decide whether you should be somewhere else today.
    atRisk: rows.filter((r) => r.threat >= 0.6).length,
    undefended: rows.filter((r) => r.strength <= 0).length,
  };
}

function collectHoldings(S) {
  const notes = [];
  for (const { id, loc, h } of holdingList(S)) {
    const base = HOLDING_YIELD[loc.kind] || HOLDING_YIELD.outpost;
    let credits = base.credits;
    const goods = { ...base.goods };
    // Workshops fabricate; depots make the place worth more.
    const work = h.upgrades.workshop || 0;
    if (work) goods.machine_parts = (goods.machine_parts || 0) + work * 2;
    credits = Math.round(credits * (1 + (h.upgrades.depot || 0) * 0.15)
      * (hasPolicy(S, 'levy') ? 1.35 : 1));
    // A toll gate on every road your writ runs along.
    if (hasPolicy(S, 'tolls')) credits += 18;

    S.credits += credits;
    // Both of these are paid for by the people being taxed, every day, not once
    // when the decision is made. A policy whose cost lands only at the moment
    // you enact it is a one-off fee rather than a standing choice.
    if (hasPolicy(S, 'levy')) changeRelation(S, id, -0.5);
    if (hasPolicy(S, 'tolls')) changeRelation(S, id, -0.2);
    for (const [g, n] of Object.entries(goods)) {
      if (cargoUsed(S) + (GOODS[g]?.bulk || 1) * n > CARGO_CAPACITY + depotCapacity(S)) continue;
      S.cargo[g] = (S.cargo[g] || 0) + n;
    }
    // Infirmaries top the medical stores up.
    const inf = h.upgrades.infirmary || 0;
    if (inf) S.medical = Math.min(12, S.medical + inf);

    // Holding ground makes your name, and building it up makes it faster.
    // Without this, growing a settlement paid credits and nothing else — so the
    // one thing that is supposed to lead to founding a faction did not visibly
    // lead anywhere. A developed holding is a statement about who runs here.
    const built = UPGRADE_LIST.reduce((a, k) => a + (h.upgrades[k] || 0), 0);
    const fame = (loc.kind === 'settlement' ? 1.4 : 0.8) * (1 + built * 0.35);
    S.renown = (S.renown || 0) + fame;

    notes.push(`${loc.name} produced ${credits} credits`);
  }
  if (notes.length) pushLog(S, `Holdings: ${notes.join('; ')}.`);
}

/**
 * Whoever used to own a holding wants it back. Threat climbs daily, faster if
 * the place is undefended, and when it boils over a retake contract appears —
 * ignore it and the holding is lost.
 */
function tickHoldingThreat(S, r) {
  for (const { id, loc, h } of holdingList(S)) {
    const works = h.upgrades.works || 0;
    // A flag of your own invites everyone to take it down; a liege's protection
    // takes some of the weight off.
    const politics = S.ownFaction ? 1.7 : (S.allegiance ? 0.75 : 1);
    // Soldiers standing in the place are the main thing that stops trouble
    // starting. Deterrence saturates — the first few make an enormous
    // difference to whether a band of looters fancies it, and the twentieth
    // changes nothing, because past a point nobody weak was coming anyway.
    const g = garrisonStrength(S, id);
    const deterrence = 1 / (1 + g * 0.22);
    const rate = 0.10 * (1 - works * 0.25) * politics * deterrence;
    h.threat = clamp((h.threat || 0) + rate, 0, 1.4);

    if (h.threat >= 1 && !S.contracts.some((c) => c.retake === id)) {
      const enemy = h.formerFaction || 'raider';
      S.contracts.push({
        id: uid('con'),
        type: 'defense',
        site: id,
        employer: null,
        retake: id,
        title: `Hold ${loc.name}`,
        text: `${FACTIONS[enemy]?.name || 'A hostile column'} is moving to retake `
          + `${loc.name}. Be standing in it when they arrive, or it is theirs.`,
        pay: 400,
        expiresDay: S.day + 4,
        accepted: false,
      });
      pushLog(S, `${loc.name} is about to be attacked.`, 'bad');
    }
    // Left too long and somebody comes for it. What happens then is the whole
    // point of a garrison: an empty holding simply falls, as it always did,
    // while a defended one fights for itself and can hold without you.
    if (h.threat >= 1.4) {
      const column = assaultStrength(S, loc);
      const defence = garrisonStrength(S, id);
      const odds = clamp(defence / (defence + column), 0, 0.95);
      if (defence > 0 && r() < odds) {
        // Held — at a price. A defence that costs nothing would make a garrison
        // strictly better than being there yourself, and the retake contract
        // pointless.
        h.threat = 0.55;
        const hurt = garrisonOf(S, id).filter(deployable);
        const casualties = Math.max(1, Math.round(hurt.length * range(r, 0.2, 0.5)));
        for (const s of hurt.slice(0, casualties)) woundGarrison(S, s, r);
        pushLog(S, `${loc.name} held. ${casualties} of the garrison hurt doing it.`, 'good');
        S.contracts = S.contracts.filter((c) => c.retake !== id);
      } else {
        // Overrun. The garrison is hurt and comes off the ground with the rest
        // of what you had there; loseHolding() hands them back to the company.
        for (const s of garrisonOf(S, id).filter(deployable)) {
          if (r() < 0.6) woundGarrison(S, s, r);
        }
        loseHolding(S, id);
        S.contracts = S.contracts.filter((c) => c.retake !== id);
      }
    }
  }
}

// --------------------------------------------------------------------------
// Save / load — must never be able to prevent the game from starting
// --------------------------------------------------------------------------

export function save(S) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...S, _uid: uidFloor() }));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const S = JSON.parse(raw);
    // Structural sanity check. A corrupt or older save is discarded rather than
    // allowed to half-load and wedge the player on a broken campaign.
    if (!S || S.version !== SAVE_VERSION || !Array.isArray(S.roster) || !S.roster.length) return null;
    if (!S.pos || typeof S.pos.x !== 'number') return null;
    if (!Array.isArray(S.parties)) S.parties = [];
    if (!Array.isArray(S.contracts)) S.contracts = [];
    // A save written before the front line could move has no record of one.
    if (!S.mapOwner || typeof S.mapOwner !== 'object') S.mapOwner = {};
    // Likewise one written before settlements could run out of people. Absent
    // means full, which manpowerAt() fills in on demand.
    if (!S.manpower || typeof S.manpower !== 'object') S.manpower = {};
    if (!S.world) return null;
    setUidFloor((S._uid || 1000) + 1);
    delete S._uid;
    // Who shoots at whom is derived, not stored.
    refreshHostility(S);
    return S;
  } catch (e) {
    console.warn('load failed, discarding save', e);
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

// --------------------------------------------------------------------------
// World events with lifetimes
//
// Signals appear, mean something for a few days, and stop mattering — whether
// or not anyone came. A distress call is not always what it says it is; an
// old-regime transponder is never quite anything you expected. The rule that
// makes them events rather than quest markers: they expire, and the world
// does not explain the ones you missed.
// --------------------------------------------------------------------------

export function tickMapEvents(S, r) {
  S.mapEvents = S.mapEvents || [];
  S.mapEvents = S.mapEvents.filter((e) => S.day < e.expiresDay);
  if (S.mapEvents.length >= 2) return;

  if (r() < 0.45) {
    // A distress signal near a road: somebody's bad day, or bait.
    const seg = ROADS_FOR_EVENTS[Math.floor(r() * ROADS_FOR_EVENTS.length)];
    const t = 0.25 + r() * 0.5;
    const x = seg.ax + (seg.bx - seg.ax) * t + (r() - 0.5) * 160;
    const z = seg.az + (seg.bz - seg.az) * t + (r() - 0.5) * 160;
    S.mapEvents.push({
      id: uid('evt'), kind: 'distress', x, z,
      day: S.day, expiresDay: S.day + 2 + Math.floor(r() * 2),
      // The die is cast when the signal is BORN, not when it is answered —
      // saving and reloading in front of one changes nothing.
      roll: r(),
    });
  } else if (r() < 0.3
    && S.parties.some((p) => (p.kind === 'deserters' || p.kind === 'scrappers') && !p.battle)) {
    // A manhunt: a faction patrol takes up the hunt for a named band and
    // walks it down across the map. The chase is real movement, the kill is
    // the ordinary battle system, and the player can beat them to the folk
    // being hunted — or watch it end on the CONTACTS card.
    const quarry = S.parties.find((p) =>
      (p.kind === 'deserters' || p.kind === 'scrappers') && !p.battle);
    const hunter = S.parties.find((p) =>
      (p.kind === 'patrol_trust' || p.kind === 'patrol_syndic') && !p.battle && !p.hunting);
    if (quarry && hunter) {
      hunter.hunting = quarry.id;
      hunter.huntingUntil = S.day + 4;
      if (Math.hypot(hunter.x - S.pos.x, hunter.z - S.pos.z) < 900) {
        pushLog(S, hunter.name + ' has taken up the hunt for ' + quarry.name + '.');
      }
    }
  } else if (r() < 0.22) {
    // A checkpoint: a faction closes a stretch of road for a few days. The
    // route is still there; passing it becomes a conversation.
    const seg = ROADS_FOR_EVENTS[Math.floor(r() * ROADS_FOR_EVENTS.length)];
    const t = 0.35 + r() * 0.3;
    S.mapEvents.push({
      id: uid('evt'), kind: 'checkpoint',
      x: seg.ax + (seg.bx - seg.ax) * t, z: seg.az + (seg.bz - seg.az) * t,
      faction: r() < 0.5 ? 'trust' : 'syndic',
      day: S.day, expiresDay: S.day + 2 + Math.floor(r() * 3), roll: r(),
    });
  } else if (r() < 0.18) {
    // Old-regime hardware waking somewhere off the roads. Rare on purpose.
    const wilds = LOCATIONS.filter((l) => l.kind === 'wild');
    const at = wilds[Math.floor(r() * wilds.length)];
    if (at && !S.mapEvents.some((e) => e.kind === 'oldsignal')) {
      S.mapEvents.push({
        id: uid('evt'), kind: 'oldsignal',
        x: at.x + (r() - 0.5) * 120, z: at.z + (r() - 0.5) * 120,
        day: S.day, expiresDay: S.day + 4 + Math.floor(r() * 3),
        roll: r(),
      });
    }
  }
}

// Road segments resolved once for event placement, same shape as region.js.
const ROADS_FOR_EVENTS = [];
for (const [a, b] of ROADS_DATA) {
  const la = locById(a), lb = locById(b);
  if (la && lb) ROADS_FOR_EVENTS.push({ ax: la.x, az: la.z, bx: lb.x, bz: lb.z });
}

/** A band stood up around a false distress signal. Returns the party. */
export function spawnDistressAmbush(S, x, z) {
  const r = rng((S.seed + Math.round(x * 7 + z * 13)) | 0);
  const p = spawnParty(S, r, 'scrappers', 'vetch');
  p.x = x + 20; p.z = z;
  p.hostileToPlayer = true;
  return p;
}

// --------------------------------------------------------------------------
// Companions: named hires met in town walks
// --------------------------------------------------------------------------

/** Which companion, if any, is drinking in this town today. */
export function companionAt(S, locId) {
  const hired = S.companionsHired || [];
  const pool = COMPANIONS.filter((c) => !hired.includes(c.id));
  if (!pool.length) return null;
  // Deterministic rotation: one companion somewhere most days, moving town
  // to town on a cycle the player can actually follow rumors about.
  const towns = LOCATIONS.filter((l) => l.services?.includes('market'));
  const slot = Math.floor(S.day / 2) % towns.length;
  if (towns[slot]?.id !== locId) return null;
  return pool[Math.floor(S.day / 2) % pool.length];
}

/** They shake on it: fee out of the ledger, a named soldier onto the roster. */
export function hireCompanion(S, compId) {
  const c = COMPANIONS.find((x) => x.id === compId);
  if (!c || (S.companionsHired || []).includes(c.id)) return { ok: false, why: 'Gone' };
  if (S.credits < c.fee) return { ok: false, why: 'The fee is beyond the ledger' };
  S.credits -= c.fee;
  S.companionsHired = [...(S.companionsHired || []), c.id];
  const r = rng((S.seed + c.id.length * 977) | 0);
  const s = makeSoldier(r, {
    role: c.role, rank: 1, how: `Signed on at a market table, day ${S.day}`,
    day: S.day, name: c.name, origin: c.origin,
    avoid: S.roster.map((x) => x.name),
  });
  s.companion = true;
  s.compId = c.id;
  S.roster.push(s);
  pushLog(S, `${c.name} signed on with Bracket.`, 'good');
  if (OFFICERS[c.id]) pushLog(S, OFFICERS[c.id].gift, 'world');
  return { ok: true, soldier: s };
}

/**
 * Is this companion alive and on the roster? The single gate every officer
 * effect reads. Matches by compId, with a name fallback for companions hired
 * before compId was stamped on them — six authored names, no collisions.
 */
export function hasOfficer(S, compId) {
  return (S.roster || []).some((s) => s.companion && s.status !== STATUS.DEAD
    && (s.compId ? s.compId === compId
      : COMPANIONS.find((c) => c.name === s.name)?.id === compId));
}

/**
 * How close a party has to be before the contact report gives an exact count
 * and a true name. Perrin listened to the whole Reach for the uplands relay,
 * and mostly still does.
 */
export function intelRange(S) {
  return hasOfficer(S, 'perrin') ? 220 : 80;
}

/** The living roster soldier behind a companion id, if they are with you. */
export function companionSoldier(S, compId) {
  return (S.roster || []).find((s) => s.companion && s.status !== STATUS.DEAD
    && (s.compId ? s.compId === compId
      : COMPANIONS.find((c) => c.name === s.name)?.id === compId)) || null;
}

/** Rapport pairs where BOTH halves are currently riding in the truck. */
export function activeRapport(S) {
  return RAPPORT.filter((p) => hasOfficer(S, p.a) && hasOfficer(S, p.b));
}

/**
 * The truck is a small room. Bond pairs keep each other steady; clash pairs
 * grind. The numbers go through the same regard the resentment machinery
 * already watches, so a feud left to fester ends the way feuds end — with
 * somebody's kit by the door.
 */
export function tickRapport(S, r) {
  for (const p of activeRapport(S)) {
    const sa = companionSoldier(S, p.a), sb = companionSoldier(S, p.b);
    if (!sa || !sb) continue;
    if (p.kind === 'bond') {
      if (r() < 0.3) {
        sa.regard = clamp((sa.regard || 0) + 1, -100, 100);
        sb.regard = clamp((sb.regard || 0) + 1, -100, 100);
      }
      if (r() < 0.06) pushLog(S, p.line, 'world');
    } else {
      if (r() < 0.3) {
        sa.regard = clamp((sa.regard || 0) - 1, -100, 100);
        sb.regard = clamp((sb.regard || 0) - 1, -100, 100);
      }
      if (r() < 0.09) pushLog(S, p.line, 'bad');
    }
  }
}

// --------------------------------------------------------------------------
// Companion errands: the unfinished business they bring to you
// --------------------------------------------------------------------------

const errandText = (e, key) => (ERRANDS[e.compId]?.[key] || '')
  .replace(/%TOWN%/g, e.to ? locName(e.to) : '');

/**
 * Once a companion trusts the company, they ask it for one thing. Word
 * errands need an arrival; goods errands need the crates in the truck when
 * you next stand somewhere civilised. One each, ever — it is personal, and
 * personal things do not respawn.
 */
export function maybeErrands(S, r) {
  S.errands = S.errands || {};
  S.errandsDone = S.errandsDone || {};
  for (const c of COMPANIONS) {
    if (S.errands[c.id] || S.errandsDone[c.id] || !ERRANDS[c.id]) continue;
    const s = companionSoldier(S, c.id);
    if (!s || (s.regard || 0) < 20) continue;
    const tpl = ERRANDS[c.id];
    const e = { compId: c.id, kind: tpl.kind };
    if (tpl.kind === 'word') {
      const towns = LOCATIONS.filter((l) => l.kind === 'settlement' && l.services?.length);
      if (!towns.length) continue;
      e.to = pick(r, towns).id;
    } else {
      e.good = tpl.good;
      e.qty = tpl.qty;
    }
    S.errands[c.id] = e;
    pushLog(S, errandText(e, 'ask'), 'world');
  }
}

/**
 * Errands settle on arrival, same hook as deliveries: a word errand at its
 * town, a goods errand anywhere with a roof once the crates are aboard.
 */
export function completeErrandsAt(S, locId) {
  const out = [];
  for (const [compId, e] of Object.entries(S.errands || {})) {
    if (e.kind === 'word' && e.to !== locId) continue;
    if (e.kind === 'goods') {
      if (((S.cargo || {})[e.good] || 0) < e.qty) continue;
      S.cargo[e.good] -= e.qty;
    }
    const s = companionSoldier(S, compId);
    if (s) s.regard = clamp((s.regard || 0) + 25, -100, 100);
    S.renown = (S.renown || 0) + 10;
    S.errandsDone[compId] = true;
    delete S.errands[compId];
    pushLog(S, errandText(e, 'done'), 'good');
    out.push({ compId, name: s?.name || compId });
  }
  return out;
}
