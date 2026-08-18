// Static world definition for KETTLE REACH.
//
// Setting: the Kettle Reach, a drained industrial basin on Dovan. Something
// large used to be administered from here — the roads are too wide, the power
// tie-ins are too heavy, and half the installations answer to a command
// structure nobody can still name. Two organisations are left arguing over
// the remains, and neither of them is wrong.

export const REGION = {
  name: 'DOVAN',
  world: 'DOVAN',
  // Continent scale. The Kettle Reach is now just the basin you start in.
  size: 6200,
};

/**
 * Regions of the continent. `danger` drives what spawns there, so the world has
 * a difficulty gradient you travel along rather than a flat sandbox: the basin
 * you start in is full of looters, the faction heartlands are full of columns.
 */
export const REGIONS = {
  kettle: {
    id: 'kettle', name: 'The Kettle Reach', danger: 1,
    owner: null,
    blurb: 'A drained industrial basin. Scavengers, small parties, old machinery.',
    centre: { x: 0, z: 0 }, radius: 900,
  },
  sarn: {
    id: 'sarn', name: 'The Sarn Uplands', danger: 3,
    owner: 'trust',
    blurb: 'Trust heartland. Metalled roads, relay masts and armoured patrols.',
    centre: { x: -380, z: -1950 }, radius: 1050,
  },
  weal: {
    id: 'weal', name: 'The Weal', danger: 3,
    owner: 'syndic',
    blurb: 'Syndic heartland. Dense work-towns that will not be told what to do.',
    centre: { x: 1980, z: 330 }, radius: 1050,
  },
  scour: {
    id: 'scour', name: 'The Scour', danger: 2,
    owner: null,
    blurb: 'Open lawless country. No authority reaches it and everyone is armed.',
    centre: { x: -1980, z: 390 }, radius: 1080,
  },
  littoral: {
    id: 'littoral', name: 'The Dovan Littoral', danger: 4,
    owner: 'trust',
    blurb: 'The old coast. Whatever administered this world was seated here.',
    centre: { x: 500, z: 2070 }, radius: 1050,
  },
};

export const FACTIONS = {
  trust: {
    id: 'trust',
    name: 'The Ordnance Trust',
    short: 'TRUST',
    // Chartered off-world to inventory and preserve what the collapse left.
    // They keep the reactors and water plants running. They also shoot people
    // who draw stores without a chit, and they will let a settlement go dark
    // rather than spend an irreplaceable part on it.
    doctrine: 'Hold the depots. Meter the technology. Disciplined, armoured, slow.',
    creed: 'Nothing is expended that cannot be replaced.',
    color: 0x5a6238,
    accent: 0xa85a1e,
    hostileTo: ['syndic'],
    model: 'soldier_trust',
  },
  syndic: {
    id: 'syndic',
    name: 'The Basin Syndics',
    short: 'SYNDIC',
    // Work-councils from the hab blocks who took the armouries when the
    // rationing started. They want the caches opened and used now, by people
    // who live here. They will also strip a working water plant for parts and
    // call it redistribution.
    doctrine: 'Move light. Strike the supply line. Scavenged, fast, dispersed.',
    creed: 'A sealed door feeds nobody.',
    color: 0x8a8163,
    accent: 0x6b3a1f,
    hostileTo: ['trust'],
    model: 'soldier_syndic',
  },
  raider: {
    id: 'raider',
    name: 'Reach Scrappers',
    short: 'SCRAP',
    doctrine: 'Take what moves slowly.',
    creed: '',
    color: 0x6b3a1f,
    accent: 0x8f5230,
    hostileTo: ['trust', 'syndic', 'player'],
    // Scrappers are Scour people. They used to borrow the Syndic silhouette,
    // which made every roadside ambush read as a faction raid.
    model: 'soldier_scour',
  },
  player: {
    id: 'player',
    name: 'Bracket',
    short: 'BRACKET',
    doctrine: 'Contract work. Paid in advance where possible.',
    creed: 'Everyone comes back.',
    color: 0x7a5624,
    accent: 0xb8863f,
    hostileTo: [],
    model: 'soldier_bracket',
  },
};

// --------------------------------------------------------------------------
// Locations. Positions are in map units, origin at centre.
// --------------------------------------------------------------------------

export const LOCATIONS = [
  {
    id: 'dolmet',
    name: 'Dolmet Station',
    kind: 'settlement',
    faction: 'trust',
    model: 'wm_settlement_trust',
    x: -550, z: -420,
    blurb: 'Rail depot and inventory house. Everything here is counted twice.',
    detail:
      'The Trust runs the Reach from Dolmet because the rail still works. Blast ' +
      'doors, stencilled crates, a clerk for every soldier. The lamps stay on ' +
      'all night and nobody thinks that is generous.',
    services: ['recruit', 'medical', 'market', 'contracts', 'trade'],
    // Which deployment templates this place can host, and the layout used.
    missions: ['defense', 'recovery'],
    layout: 'settlement',
    trade: { sell: ['machine_parts', 'fuel_cells'], buy: ['water', 'rations', 'salvage'] },
    contacts: [
      {
        name: 'Quartermaster Idren Solk',
        role: 'Trust logistics',
        trait: 'Reads your requisition twice before answering.',
        line: 'You are not on my establishment, so you are an expense. Expenses get audited.',
      },
      {
        name: 'Warrant Officer Beske',
        role: 'Garrison',
        trait: 'Missing two fingers, never mentions it.',
        line: 'Rampart Twelve has been quiet nine days. Quiet is not the same as safe.',
      },
    ],
  },
  {
    id: 'perran',
    name: 'Perran Flats',
    kind: 'settlement',
    faction: 'syndic',
    model: 'wm_settlement_syndic',
    x: 620, z: 160,
    blurb: 'Hab blocks around a water reclaimer that must not stop.',
    detail:
      'Four thousand people and one reclaimer. The Syndics govern by shift ' +
      'meeting and argue loudly enough to hear from the road. They will feed ' +
      'you before they trust you.',
    services: ['recruit', 'medical', 'market', 'contracts', 'trade'],
    missions: ['defense', 'sabotage'],
    layout: 'reclaimer',
    trade: { sell: ['water', 'filter_stacks'], buy: ['machine_parts', 'medical_stock', 'optics'] },
    contacts: [
      {
        name: 'Syndic Marath Oyle',
        role: 'Council speaker',
        trait: 'Talks to your soldiers before she talks to you.',
        line: 'We do not need heroes. We need the pumps turning on the fourteenth.',
      },
      {
        name: 'Hessa Kwill',
        role: 'Reclaimer chief',
        trait: 'Permanently coated in scale dust.',
        line: 'Trust says the plant is theirs on paper. Paper does not run a filter stack.',
      },
    ],
  },
  {
    id: 'vetch',
    name: 'Vetch Crossing',
    kind: 'settlement',
    faction: null,
    model: 'wm_settlement_neutral',
    x: 100, z: 650,
    blurb: 'A road junction that grew a market. No flag, by agreement.',
    detail:
      'Both sides buy here and both sides pretend they do not. The Crossing ' +
      'stays neutral because the moment it is not, it stops being useful to ' +
      'anyone. Hired guns drink on the north side.',
    services: ['recruit', 'market', 'contracts', 'trade'],
    missions: ['defense', 'skirmish'],
    layout: 'settlement',
    trade: { sell: ['salvage', 'optics'], buy: ['water', 'fuel_cells', 'machine_parts'] },
    contacts: [
      {
        name: 'Bellin Arcaute',
        role: 'Broker',
        trait: 'Prices go up when he likes you.',
        line: 'I sell to whoever walks in. That is not neutrality, it is arithmetic.',
      },
    ],
  },
  {
    id: 'rampart',
    name: 'Rampart 12',
    kind: 'outpost',
    faction: 'trust',
    model: 'wm_outpost',
    x: -160, z: -760,
    blurb: 'Trust relay outpost. Feeds patrol coordination across the north.',
    detail:
      'A hard little post on the northern rim with a mast that talks to ' +
      'everything the Trust owns. Take the mast down and the patrols go blind.',
    services: [],
    missions: ['sabotage', 'recovery', 'defense'],
    layout: 'outpost',
    contacts: [],
  },
  {
    id: 'grellan',
    name: 'Grellan Array',
    kind: 'ruin',
    faction: null,
    model: 'wm_array',
    x: 520, z: -600,
    blurb: 'Dead deep-signal array. Predates both factions. Occupied by scrappers.',
    detail:
      'The dish is far too large for anything in the Reach and points at ' +
      'nothing anyone will name. It has been dead since before the Trust ' +
      'chartered. Scrappers nest in the pylon housings.',
    services: [],
    missions: ['recovery', 'sabotage', 'defense'],
    layout: 'array',
    contacts: [],
  },
  {
    id: 'sump',
    name: 'The Sump',
    kind: 'wild',
    faction: null,
    model: null,
    x: -680, z: 500,
    blurb: 'Lawless drainage flats. Nobody patrols it. Things cross it.',
    detail:
      'The low ground where the basin drains. Poisoned, unlit, and the fastest ' +
      'route between the south road and the west if you do not mind who you meet.',
    services: [],
    missions: ['skirmish', 'recovery'],
    layout: 'roadside',
    contacts: [],
  },

  // ---- the wider Reach -------------------------------------------------
  {
    id: 'harrow',
    name: 'Harrow Deep',
    kind: 'settlement',
    faction: 'syndic',
    model: 'wm_settlement_syndic',
    x: -1010, z: 390,
    blurb: 'A shaft head with a town on top of it. The Syndics were born here.',
    detail:
      'Everything at Harrow points down. The Deep still produces alloy and ' +
      'machine stock, which is why the Trust keeps asking politely and the ' +
      'Syndics keep saying no. Every household has somebody underground.',
    services: ['recruit', 'medical', 'market', 'contracts', 'trade'],
    missions: ['defense', 'recovery'],
    layout: 'works',
    trade: { sell: ['salvage', 'machine_parts'], buy: ['water', 'rations', 'medical_stock'] },
    contacts: [
      {
        name: 'Pit Boss Ollan Trask',
        role: 'Shaft authority',
        trait: 'Counts heads before and after every shift, aloud.',
        line: 'Nothing comes out of my Deep that I have not weighed. That includes people.',
      },
    ],
  },
  {
    id: 'kestrel',
    name: 'Kestrel Waystation',
    kind: 'settlement',
    faction: null,
    model: 'wm_settlement_neutral',
    x: 1040, z: -80,
    blurb: 'A fuel stop that turned into a market. Buys anything, asks nothing.',
    detail:
      'The last serviceable pumping station on the eastern road. It survives ' +
      'by being useful to everyone and loyal to no one, and its prices reflect ' +
      'exactly how badly you need what it has.',
    services: ['recruit', 'market', 'contracts', 'trade'],
    missions: ['defense', 'skirmish'],
    layout: 'settlement',
    trade: { sell: ['fuel_cells', 'rations', 'medical_stock'], buy: ['salvage', 'optics', 'filter_stacks'] },
    contacts: [
      {
        name: 'Wren Dallowe',
        role: 'Station keeper',
        trait: 'Never quotes the same price twice.',
        line: 'I do not care whose stencil is on the crate. I care what is in it.',
      },
    ],
  },
  {
    id: 'lowmark',
    name: 'Lowmark Depot',
    kind: 'outpost',
    faction: 'trust',
    model: 'wm_outpost',
    x: 260, z: -1010,
    blurb: 'Forward Trust depot. Everything that moves north moves through it.',
    detail:
      'Stacked to the roof with sealed crates nobody in the Reach is cleared ' +
      'to open. The garrison is small because the Trust does not believe ' +
      'anybody would be stupid enough.',
    services: [],
    missions: ['sabotage', 'recovery', 'defense'],
    layout: 'depot',
    contacts: [],
  },
  {
    id: 'culvert',
    name: 'Culvert Nine',
    kind: 'ruin',
    faction: null,
    model: 'wm_array',
    x: -1040, z: -780,
    blurb: 'Drainage works from the old administration. Something still hums.',
    detail:
      'Nine was one of dozens that kept the basin dry. The pumps are dead, ' +
      'the housings are not, and whoever is squatting in them has been there ' +
      'long enough to build doors.',
    services: [],
    missions: ['recovery', 'sabotage', 'skirmish'],
    layout: 'array',
    contacts: [],
  },
  {
    id: 'pale',
    name: 'The Pale',
    kind: 'wild',
    faction: null,
    model: null,
    x: -230, z: 1040,
    blurb: 'Salt flats. Nothing grows, nothing hides, everything is visible.',
    detail:
      'Flat white ground for six kilometres in every direction. Crossing it is ' +
      'fast and completely exposed, which is why the people who use it travel ' +
      'at night and in numbers.',
    services: [],
    missions: ['skirmish', 'defense'],
    layout: 'roadside',
    contacts: [],
  },

  // ================= THE SARN UPLANDS — Trust heartland =================
  {
    id: 'sarnhold', name: 'Sarn Hold', kind: 'settlement', faction: 'trust',
    model: 'wm_settlement_trust', x: -360, z: -1760, region: 'sarn',
    blurb: 'The Trust seat on this continent. Everything is inventoried twice.',
    detail:
      'Sarn Hold is where the charter actually lives. Rail, armour, clerks and '
      + 'a garrison that has never been seriously tested. The lamps have not gone '
      + 'out here since before anyone can remember.',
    services: ['recruit', 'medical', 'market', 'contracts', 'trade'],
    missions: ['defense', 'sabotage', 'recovery'], layout: 'depot',
    trade: { sell: ['machine_parts', 'optics'], buy: ['water', 'rations', 'salvage'] },
    contacts: [{
      name: 'Prefect Anwen Vantree', role: 'Charter authority',
      trait: 'Has never once raised her voice.',
      line: 'You are a temporary arrangement. Do try to be a useful one.',
    }],
  },
  {
    id: 'vantree', name: 'Vantree Station', kind: 'outpost', faction: 'trust',
    model: 'wm_outpost', x: -930, z: -1470, region: 'sarn',
    blurb: 'Armour depot. Tracked vehicles come out of here.',
    detail: 'Where the Trust keeps what it does not talk about. Heavy doors, heavier vehicles.',
    services: [], missions: ['sabotage', 'seize', 'recovery'], layout: 'depot', contacts: [],
  },
  {
    id: 'meridian', name: 'Cold Meridian', kind: 'ruin', faction: null,
    model: 'wm_array', x: 270, z: -2340, region: 'sarn',
    blurb: 'A pre-charter listening station on the high ground. Still warm.',
    detail: 'Nobody built this to listen to anything on Dovan. The Trust posts a guard and asks nothing.',
    services: [], missions: ['recovery', 'sabotage', 'seize'], layout: 'settlement', contacts: [],
  },
  {
    id: 'pellcross', name: 'Pell Crossing', kind: 'settlement', faction: 'trust',
    model: 'wm_settlement_neutral', x: -780, z: -2280, region: 'sarn',
    blurb: 'Upland market under Trust licence. Grudgingly.',
    detail: 'A working town that took the charter because the alternative was worse, and says so nightly.',
    services: ['recruit', 'market', 'contracts', 'trade'],
    missions: ['defense', 'skirmish'], layout: 'settlement',
    trade: { sell: ['rations', 'fuel_cells'], buy: ['medical_stock', 'optics', 'salvage'] },
    contacts: [{
      name: 'Reeve Ottol Grange', role: 'Market reeve',
      trait: 'Keeps two sets of books and shows you the wrong one.',
      line: 'Licensed does not mean owned. Remember that and we will get along.',
    }],
  },

  // ===================== THE WEAL — Syndic heartland =====================
  {
    id: 'wealbastion', name: 'Weal Bastion', kind: 'settlement', faction: 'syndic',
    model: 'wm_settlement_syndic', x: 1860, z: 210, region: 'weal',
    blurb: 'The largest free town on Dovan. It governs itself, loudly.',
    detail:
      'Forty thousand people and no single authority. Every decision is argued in '
      + 'the open and every argument is armed. The Trust has never taken it and '
      + 'has stopped saying it intends to.',
    services: ['recruit', 'medical', 'market', 'contracts', 'trade'],
    missions: ['defense', 'recovery'], layout: 'reclaimer',
    trade: { sell: ['water', 'filter_stacks', 'rations'], buy: ['machine_parts', 'optics', 'fuel_cells'] },
    contacts: [{
      name: 'Speaker Girsu Ellick', role: 'Council speaker',
      trait: 'Remembers the name of everyone he has ever buried.',
      line: 'We do not want a ruler. We want the pumps on and the road open.',
    }],
  },
  {
    id: 'ondrel', name: 'Ondrel Works', kind: 'settlement', faction: 'syndic',
    model: 'wm_settlement_syndic', x: 2430, z: 720, region: 'weal',
    blurb: 'Heavy fabrication. The Weal builds its own everything here.',
    detail: 'Furnaces, presses and a permanent orange haze. Machine stock comes out; nothing comes in cheap.',
    services: ['recruit', 'market', 'contracts', 'trade'],
    missions: ['defense', 'sabotage'], layout: 'works',
    trade: { sell: ['machine_parts', 'salvage'], buy: ['fuel_cells', 'medical_stock', 'water'] },
    contacts: [{
      name: 'Foundry Chief Nurin Bask', role: 'Works chief',
      trait: 'Shouts everything, hears nothing.',
      line: 'You want parts, you wait in line like the rest of the continent.',
    }],
  },
  {
    id: 'fenmarrow', name: 'Fen Marrow', kind: 'ruin', faction: null,
    model: 'wm_array', x: 1530, z: 930, region: 'weal',
    blurb: 'A drowned works. Scrappers hold the dry levels.',
    detail: 'Half of it is under water and the half that is not is occupied.',
    services: [], missions: ['recovery', 'seize', 'skirmish'], layout: 'settlement', contacts: [],
  },
  {
    id: 'tallow', name: 'Tallow Row', kind: 'outpost', faction: 'syndic',
    model: 'wm_outpost', x: 2250, z: -270, region: 'weal',
    blurb: 'Syndic muster point covering the western approach.',
    detail: 'Where the Weal keeps the trucks it would use if the Trust ever really came.',
    services: [], missions: ['seize', 'defense', 'sabotage'], layout: 'settlement', contacts: [],
  },

  // ========================= THE SCOUR — lawless =========================
  {
    id: 'scourgate', name: 'Scour Gate', kind: 'settlement', faction: null,
    model: 'wm_settlement_neutral', x: -1770, z: 180, region: 'scour',
    blurb: 'The last place with a name before the open country.',
    detail:
      'Everyone passing west stops here, so everyone west of here knows what you '
      + 'are carrying. It is not lawless exactly — there are rules, they are just '
      + 'not written down and the penalty is always the same.',
    services: ['recruit', 'medical', 'market', 'contracts', 'trade'],
    missions: ['defense', 'skirmish'], layout: 'settlement',
    trade: { sell: ['salvage', 'fuel_cells'], buy: ['rations', 'water', 'medical_stock'] },
    contacts: [{
      name: 'Vesh Corwen', role: 'Whoever is in charge today',
      trait: 'Introduces herself differently every time.',
      line: 'No flags out here. Just people who pay and people who take.',
    }],
  },
  {
    id: 'draypits', name: 'Dray Pits', kind: 'settlement', faction: null,
    model: 'wm_settlement_syndic', x: -2430, z: 780, region: 'scour',
    blurb: 'Open-cast salvage. Everything here was something else first.',
    detail: 'Enormous terraced holes worked by anyone who turns up. Alloy is cheap and life is cheaper.',
    services: ['recruit', 'market', 'trade'],
    missions: ['defense', 'seize'], layout: 'depot',
    trade: { sell: ['salvage', 'machine_parts'], buy: ['water', 'rations', 'filter_stacks'] },
    contacts: [{
      name: 'Pit Warden Rusk', role: 'Warden',
      trait: 'Carries a ledger nobody has read.',
      line: 'Dig, buy or leave. Those are the three things you can do here.',
    }],
  },
  {
    id: 'gallows', name: 'The Gallows Road', kind: 'wild', faction: null,
    model: null, x: -1440, z: 1050, region: 'scour',
    blurb: 'A hundred kilometres of open road with nothing on either side.',
    detail: 'Named for what used to line it. Fast, exposed, and the favourite hunting ground of every band in the Scour.',
    services: [], missions: ['skirmish', 'defense'], layout: 'settlement', contacts: [],
  },
  {
    id: 'scourhold', name: 'Hollowmark', kind: 'ruin', faction: null,
    model: 'wm_array', x: -2340, z: -390, region: 'scour',
    blurb: 'A pre-charter relay the size of a town, stripped to the frame.',
    detail: 'Whatever ran Dovan spoke through here. Now it is a maze of empty housings and whoever lives in them.',
    services: [], missions: ['recovery', 'seize', 'sabotage'], layout: 'settlement', contacts: [],
  },

  // ==================== THE DOVAN LITTORAL — the coast ====================
  {
    id: 'anchorage', name: 'Littoral Anchorage', kind: 'settlement', faction: 'trust',
    model: 'wm_settlement_trust', x: 450, z: 1860, region: 'littoral',
    blurb: 'The only working port. Everything off-world lands here.',
    detail:
      'The Trust holds the Anchorage the way a hand holds a throat. Whatever still '
      + 'comes down from orbit comes down here, and whoever holds it decides what '
      + 'the rest of the continent is allowed to have.',
    services: ['recruit', 'medical', 'market', 'contracts', 'trade'],
    missions: ['defense', 'seize', 'sabotage'], layout: 'works',
    trade: { sell: ['optics', 'medical_stock', 'fuel_cells'], buy: ['salvage', 'machine_parts', 'rations'] },
    contacts: [{
      name: 'Harbourmaster Sallow', role: 'Port authority',
      trait: 'Has not left the tower in nine years.',
      line: 'Everything that matters on this world came through my gate. Including you.',
    }],
  },
  {
    id: 'brine', name: 'The Brine Stacks', kind: 'ruin', faction: null,
    model: 'wm_array', x: 1140, z: 2340, region: 'littoral',
    blurb: 'Kilometres of collapsed processing towers along the old shore.',
    detail: 'Nothing has worked here in a very long time, and something is still using the power.',
    services: [], missions: ['recovery', 'seize', 'sabotage'], layout: 'array', contacts: [],
  },
  {
    id: 'oldquay', name: 'Old Quay', kind: 'outpost', faction: 'trust',
    model: 'wm_outpost', x: -240, z: 2280, region: 'littoral',
    blurb: 'Coastal battery covering the southern approach to the port.',
    detail: 'Guns that point at an ocean nothing has crossed in living memory, kept in perfect order.',
    services: [], missions: ['seize', 'sabotage', 'defense'], layout: 'outpost', contacts: [],
  },

  // ---- filling the country: outposts and places worth a detour ---------
  // The provinces read as empty between their towns — long stretches with
  // nothing to steer toward and no reason to leave a road. These are the
  // in-between places: faction pickets that make territory feel HELD, and
  // unaligned ground with a reason to visit and a risk in visiting.
  {
    id: 'span', name: 'Broken Span', kind: 'wild', faction: null, model: null,
    x: -900, z: -700, region: 'kettle',
    blurb: 'A collapsed viaduct. The road under it is the landmark.',
    detail: 'Half a highway bridge, down since before anyone. The camp under the standing half changes hands by season.',
    services: [], missions: ['skirmish', 'recovery'], layout: 'roadside', contacts: [],
  },
  {
    id: 'reservoir', name: 'Dry Reservoir', kind: 'wild', faction: null, model: null,
    x: 1100, z: -1100, region: 'kettle',
    blurb: 'An empty bowl of cracked concrete. Deserters like it.',
    detail: 'The basin the Trust drained and never refilled. Out of sight of every road, which is the point of camping in it.',
    services: [], missions: ['skirmish', 'lair'], layout: 'depot', contacts: [],
  },
  {
    id: 'relay12', name: 'Relay 12', kind: 'outpost', faction: 'trust',
    model: 'wm_outpost', x: -700, z: -1350, region: 'sarn',
    blurb: 'Trust signals picket on the uplands road.',
    detail: 'Four masts and a generator shed. The uplands traffic moves because this place says it may.',
    services: [], missions: ['sabotage', 'seize', 'defense'], layout: 'outpost', contacts: [],
  },
  {
    id: 'tollgate', name: 'Weal Tollgate', kind: 'outpost', faction: 'syndic',
    model: 'wm_outpost', x: 1400, z: 500, region: 'weal',
    blurb: 'Syndic checkpoint where the east road enters the Weal.',
    detail: 'A counterweighted barrier and a ledger. The Syndic taxes the road because the road is theirs to tax.',
    services: [], missions: ['seize', 'sabotage', 'defense'], layout: 'fort', contacts: [],
  },
  {
    id: 'crawler', name: 'Wrecked Crawler', kind: 'wild', faction: null, model: null,
    x: -1500, z: 900, region: 'scour',
    blurb: 'A mining crawler the size of a street, dead where it stopped.',
    detail: 'Stripped a little more every year. Whole rooms inside have not been opened since the crews walked off.',
    services: [], missions: ['recovery', 'skirmish'], layout: 'works', contacts: [],
  },
  {
    id: 'gantry', name: 'Anchor Gantry', kind: 'outpost', faction: 'syndic',
    model: 'wm_outpost', x: 900, z: 1500, region: 'littoral',
    blurb: 'Syndic crane yard holding the road to the Anchorage.',
    detail: 'Loading gantries worked by council crews. The only heavy lift south of the pan, and priced accordingly.',
    services: [], missions: ['seize', 'defense'], layout: 'depot', contacts: [],
  },
];

// --------------------------------------------------------------------------
// Party tiers.
//
// Every group moving on the map has a real troop count, shown on its marker.
// The ladder is the progression curve: a four-strong looter band is something
// a starting company can beat, an eighty-strong armoured column is something
// they should run from for a long time. `tier` gates where they spawn.
// --------------------------------------------------------------------------

export const PARTY_TIERS = {
  strays: {
    id: 'strays', name: 'Stray Scavengers', tier: 1, faction: 'raider',
    model: 'wm_party_raider', strength: [2, 5], speed: 23, hostile: true,
    quality: 0.5, roles: ['rifleman', 'rifleman'],
    desc: 'Two or three desperate people with whatever they could pick up. '
      + 'The only thing in the basin a new company can take on and expect to win.',
  },
  looters: {
    id: 'looters', name: 'Looters', tier: 1, faction: 'raider',
    model: 'wm_party_raider', strength: [3, 8], speed: 21, hostile: true,
    quality: 0.62, roles: ['rifleman', 'rifleman', 'breacher'],
    desc: 'Half-starved and badly armed. They will run if it goes against them.',
  },
  lair: {
    id: 'lair', name: 'Scrapper Hideout', tier: 3, faction: 'raider',
    model: 'wm_party_raider', strength: [14, 22], speed: 0, hostile: true,
    quality: 0.8, roles: ['rifleman', 'breacher', 'marksman', 'gunner'],
    // It does not travel. It sits in the hills and produces the parties that
    // make a stretch of road dangerous — which is the point of it: the map
    // gains a CAUSE you can go and remove rather than an endless symptom.
    static: true,
    lair: true,
    desc: 'A dug-in camp. Whatever is robbing this road is coming from here.',
  },
  own_caravan: {
    id: 'own_caravan', name: 'Bracket Caravan', tier: 2, faction: 'player',
    model: 'wm_party_civil', strength: [5, 9], speed: 14, hostile: false,
    quality: 0.6, roles: ['rifleman', 'rifleman'],
    // Yours. It runs a circuit, sends money back, and can be taken off you.
    owned: true,
    desc: 'Your own hauliers, working a circuit between markets.',
  },
  titan: {
    id: 'titan', name: 'Titan Walker', tier: 6, faction: 'raider',
    model: 'wm_party_raider', strength: [1, 1], speed: 8, hostile: true,
    quality: 1, roles: ['gunner'],
    // Deliberately a party of one. The number on the marker says 1 and it is
    // still the most dangerous thing on the map, which is exactly the read.
    boss: true,
    desc: 'Somebody got a siege walker running again. It has not stopped.',
  },
  scrappers: {
    id: 'scrappers', name: 'Scrapper Band', tier: 2, faction: 'raider',
    model: 'wm_party_raider', strength: [8, 18], speed: 19, hostile: true,
    quality: 0.78, roles: ['rifleman', 'breacher', 'marksman'],
    desc: 'Organised salvage crews who took to taking things instead.',
  },
  refugees: {
    id: 'refugees', name: 'Displaced Families', tier: 1, faction: null,
    model: 'wm_party_civil', strength: [0, 0], speed: 9, hostile: false,
    quality: 0.3, roles: ['rifleman'],
    desc: 'Carrying everything they have left.',
  },
  caravan: {
    id: 'caravan', name: 'Trade Caravan', tier: 2, faction: null,
    model: 'wm_party_civil', strength: [6, 14], speed: 12, hostile: false,
    quality: 0.7, roles: ['rifleman', 'rifleman', 'gunner'],
    // Caravans carry goods. Taking one is profitable and makes enemies.
    cargo: true,
    desc: 'Hauling stock between markets under a hired escort.',
  },
  deserters: {
    id: 'deserters', name: 'Deserter Band', tier: 2, faction: 'raider',
    model: 'wm_party_raider', strength: [4, 9], speed: 24, hostile: true,
    quality: 0.72, roles: ['rifleman', 'rifleman', 'marksman'],
    // Trained people with no flag left. Faster than looters, shyer than
    // anyone: the boldness table gives them the lowest stomach for a fight
    // in the game, so they run from patrols and prey only on the soft.
    desc: 'Uniforms with the patches cut off. They want your truck, not a war.',
  },
  merc: {
    id: 'merc', name: 'Free Company', tier: 3, faction: null,
    model: 'wm_party_player', strength: [12, 26], speed: 17, hostile: false,
    quality: 0.9, roles: ['rifleman', 'breacher', 'marksman', 'gunner'],
    desc: 'Another outfit working the same country you are.',
  },
  patrol_trust: {
    id: 'patrol_trust', name: 'Trust Patrol', tier: 3, faction: 'trust',
    model: 'wm_party_trust', strength: [14, 30], speed: 15, hostile: false,
    quality: 0.95, roles: ['rifleman', 'rifleman', 'gunner', 'marksman'],
    desc: 'Drilled, armoured, and entirely certain of their authority.',
  },
  patrol_syndic: {
    id: 'patrol_syndic', name: 'Syndic Column', tier: 3, faction: 'syndic',
    model: 'wm_party_syndic', strength: [14, 30], speed: 18, hostile: false,
    quality: 0.85, roles: ['rifleman', 'breacher', 'marksman'],
    desc: 'Fast, light and willing to fight above their weight.',
  },
  warband_trust: {
    id: 'warband_trust', name: 'Trust Battle Group', tier: 4, faction: 'trust',
    model: 'wm_party_trust', strength: [32, 60], speed: 13, hostile: false,
    quality: 1.05, roles: ['rifleman', 'gunner', 'marksman', 'breacher'],
    armour: 1,
    desc: 'A formation, not a patrol. Supported and expecting a fight.',
  },
  warband_syndic: {
    id: 'warband_syndic', name: 'Syndic Muster', tier: 4, faction: 'syndic',
    model: 'wm_party_syndic', strength: [32, 60], speed: 16, hostile: false,
    quality: 0.95, roles: ['rifleman', 'breacher', 'marksman', 'gunner'],
    armour: 1,
    desc: 'Everyone the work-councils could put on a truck at short notice.',
  },
  column_trust: {
    id: 'column_trust', name: 'Trust Armoured Column', tier: 5, faction: 'trust',
    model: 'wm_party_trust', strength: [60, 110], speed: 11, hostile: false,
    quality: 1.15, roles: ['rifleman', 'gunner', 'marksman'],
    armour: 2, vehicles: 2,
    desc: 'Tracked armour and a hundred rifles. Do not engage this with a squad.',
  },
  column_syndic: {
    id: 'column_syndic', name: 'Syndic Grand Muster', tier: 5, faction: 'syndic',
    model: 'wm_party_syndic', strength: [55, 100], speed: 13, hostile: false,
    quality: 1.05, roles: ['rifleman', 'breacher', 'gunner', 'marksman'],
    armour: 1, vehicles: 1,
    desc: 'Every rifle in the Weal, moving as one body.',
  },
};

export const PARTY_TIER_LIST = Object.keys(PARTY_TIERS);

// --------------------------------------------------------------------------
// Renown.
//
// The number that says how seriously the world takes Bracket. It gates how
// many people you can put in the field at once, which is the single most
// important progression lever in the game.
// --------------------------------------------------------------------------

export const RENOWN_TIERS = [
  { at: 0, name: 'Unknown', deploy: 5 },
  { at: 120, name: 'Spoken Of', deploy: 6 },
  { at: 300, name: 'Known', deploy: 7 },
  { at: 550, name: 'Notable', deploy: 8 },
  { at: 900, name: 'Respected', deploy: 9 },
  { at: 1400, name: 'Renowned', deploy: 10 },
  { at: 2100, name: 'Feared', deploy: 12 },
  { at: 3200, name: 'Legendary', deploy: 14 },
];

export function renownTier(renown) {
  let t = RENOWN_TIERS[0];
  for (const r of RENOWN_TIERS) if (renown >= r.at) t = r;
  return t;
}

// --------------------------------------------------------------------------
// Trade goods.
//
// Eight commodities, each produced somewhere and wanted somewhere else. The
// spread between a producer and a consumer is the whole game: haul water from
// Perran to the mining Deep, haul alloy back. Prices drift daily so a route
// that paid last week is not guaranteed to pay today.
// --------------------------------------------------------------------------

export const GOODS = {
  water: {
    id: 'water', name: 'Reclaimed Water', abbr: 'H2O', base: 40, bulk: 2,
    desc: 'Filtered basin water in sealed drums. Everyone needs it; only Perran makes it.',
  },
  rations: {
    id: 'rations', name: 'Ration Blocks', abbr: 'RTN', base: 55, bulk: 1,
    desc: 'Compressed protein, stamped with a charter date nobody checks.',
  },
  filter_stacks: {
    id: 'filter_stacks', name: 'Filter Stacks', abbr: 'FLT', base: 130, bulk: 2,
    desc: 'Reclaimer cores. Wear out constantly and cannot be improvised.',
  },
  machine_parts: {
    id: 'machine_parts', name: 'Machine Stock', abbr: 'MCH', base: 165, bulk: 3,
    desc: 'Bearings, seals and drive linkage. The Trust meters these carefully.',
  },
  fuel_cells: {
    id: 'fuel_cells', name: 'Fuel Cells', abbr: 'FUE', base: 210, bulk: 2,
    desc: 'Charge cells for vehicles and generators. Heavy, valuable, inert.',
  },
  medical_stock: {
    id: 'medical_stock', name: 'Medical Stock', abbr: 'MED', base: 240, bulk: 1,
    desc: 'Sealed trauma supplies. Worth more the further you are from a clinic.',
  },
  optics: {
    id: 'optics', name: 'Optical Assemblies', abbr: 'OPT', base: 320, bulk: 1,
    desc: 'Pre-charter lenses and sensor heads. Nobody in the Reach can make them.',
  },
  salvage: {
    id: 'salvage', name: 'Salvage Alloy', abbr: 'ALY', base: 90, bulk: 4,
    desc: 'Cut and bundled structural metal. Bulky, always sellable, never lucrative.',
  },
};

export const GOODS_LIST = Object.keys(GOODS);

// --------------------------------------------------------------------------
// Troop roles
// --------------------------------------------------------------------------

export const ROLES = {
  rifleman: {
    id: 'rifleman', name: 'Rifleman', abbr: 'RFL',
    desc: 'Reliable line infantry. Nothing special, always needed.',
    weapon: 'rifle', hp: 100, accuracy: 0.62, aggression: 0.5, cost: 240,
  },
  breacher: {
    id: 'breacher', name: 'Breacher', abbr: 'BRC',
    desc: 'Close assault. Pushes rooms and doorways, dies in open ground.',
    weapon: 'shotgun', hp: 120, accuracy: 0.55, aggression: 0.85, cost: 320,
  },
  marksman: {
    id: 'marksman', name: 'Marksman', abbr: 'MRK',
    desc: 'Long-range precision. Wants distance and a wall to stand behind.',
    weapon: 'dmr', hp: 85, accuracy: 0.82, aggression: 0.25, cost: 360,
  },
  gunner: {
    id: 'gunner', name: 'Support Gunner', abbr: 'GUN',
    desc: 'Suppressive fire. Slow to move, hard to advance against.',
    weapon: 'lmg', hp: 115, accuracy: 0.48, aggression: 0.6, cost: 380,
  },
  medic: {
    id: 'medic', name: 'Field Medic', abbr: 'MED',
    desc: 'Stabilises the incapacitated in the field. Keeps veterans alive.',
    weapon: 'smg', hp: 90, accuracy: 0.5, aggression: 0.2, cost: 420,
  },
  signals: {
    id: 'signals', name: 'Signals Tech', abbr: 'SIG',
    desc: 'Works objective hardware fast. Halves demolition and console time.',
    weapon: 'smg', hp: 90, accuracy: 0.52, aggression: 0.3, cost: 400,
  },
};

export const ROLE_LIST = Object.keys(ROLES);

/**
 * What a soldier can become, and what it costs you to make them that.
 *
 * Rank is earned in the field and cannot be bought; ROLE is bought and cannot
 * be earned. That split is the point: experience decides how good somebody is
 * at their job, and you decide what the job is. A rifleman who has survived
 * enough contacts is a decision — marksman, breacher or gunner — and the three
 * branches want different things from the rest of the company.
 *
 * Every branch also raises their wage, so a company of specialists is a company
 * that costs real money to keep standing still.
 */
export const TROOP_PATHS = {
  rifleman: [
    { to: 'breacher', rank: 1, cost: 260,
      why: 'Give them a shotgun and the job of going through the door first.' },
    { to: 'marksman', rank: 1, cost: 320,
      why: 'Hand them a DMR and let them hold the long angle.' },
    { to: 'gunner', rank: 1, cost: 340,
      why: 'Put the machine gun on them and let them own a lane.' },
  ],
  breacher: [
    { to: 'gunner', rank: 2, cost: 380,
      why: 'They have survived enough rooms to be trusted with the heavy weapon.' },
    { to: 'medic', rank: 2, cost: 420,
      why: 'They have carried enough people out to know how it is done.' },
  ],
  marksman: [
    { to: 'signals', rank: 2, cost: 400,
      why: 'Patient, careful, and already used to working alone.' },
  ],
  gunner: [
    { to: 'breacher', rank: 2, cost: 300,
      why: 'Back to the front of the stack, with something shorter.' },
  ],
  medic: [],
  signals: [],
};

/**
 * Where a soldier was raised, and what that means.
 *
 * Recruits carry their origin for life: it decides what they look like in the
 * field, what they are good at, and what they were trained to carry. A Trust
 * regular and a Weal militiaman are not the same soldier with a different hat.
 */
export const ORIGINS = {
  trust: {
    id: 'trust', name: 'Trust Regular', short: 'TRUST',
    model: 'soldier_trust',
    blurb: 'Drilled on a range, issued everything, slow to improvise.',
    // Accurate and armoured, but heavy and expensive.
    mods: { acc: 0.07, hp: 16, speed: -0.07 },
    roles: ['rifleman', 'rifleman', 'gunner', 'marksman', 'signals'],
    kit: { armour: 'body_carrier', head: 'head_combat' },
    costMul: 1.25,
  },
  syndic: {
    id: 'syndic', name: 'Syndic Levy', short: 'SYNDIC',
    model: 'soldier_syndic',
    blurb: 'Fast, stubborn, and used to fighting somebody better equipped.',
    mods: { acc: -0.01, hp: 4, speed: 0.16, cover: 0.1 },
    roles: ['rifleman', 'breacher', 'breacher', 'marksman', 'medic'],
    kit: { armour: 'body_webbing', head: 'head_light' },
    costMul: 0.85,
  },
  scour: {
    id: 'scour', name: 'Scour Hand', short: 'SCOUR',
    model: 'soldier_scour',
    blurb: 'Came up in open country. Hard, unpredictable, cheap.',
    mods: { acc: -0.04, hp: 12, speed: 0.08, luck: 0.08 },
    roles: ['rifleman', 'breacher', 'gunner', 'rifleman'],
    kit: { armour: 'body_webbing', head: null },
    costMul: 0.7,
  },
  littoral: {
    id: 'littoral', name: 'Anchorage Hand', short: 'PORT',
    model: 'soldier_littoral',
    blurb: 'Port technicians and dock security. Educated, and it shows.',
    mods: { acc: 0.05, hp: 6, sight: 10 },
    roles: ['signals', 'marksman', 'medic', 'rifleman'],
    kit: { armour: 'body_carrier', head: 'head_light' },
    costMul: 1.15,
  },
  free: {
    id: 'free', name: 'Free Company', short: 'FREE',
    model: 'soldier_bracket',
    blurb: 'Hired guns with no politics and no particular loyalty.',
    mods: {},
    roles: ['rifleman', 'breacher', 'marksman', 'gunner', 'medic', 'signals'],
    kit: { armour: null, head: null },
    costMul: 1.0,
  },
};

/** Which origin a given location raises troops from. */
export function originForLocation(loc) {
  if (!loc) return 'free';
  if (loc.faction === 'trust') return loc.region === 'littoral' ? 'littoral' : 'trust';
  if (loc.faction === 'syndic') return 'syndic';
  if (loc.region === 'scour') return 'scour';
  return 'free';
}

// --------------------------------------------------------------------------
// Weapons. Six, all distinct in role. No randomised stat loot anywhere.
// --------------------------------------------------------------------------

export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'Kessing Service Rifle', abbr: 'SVC-R', model: 'wpn_rifle',
    damage: 22, rpm: 420, mag: 30, reload: 2.1, spread: 0.016, adsSpread: 0.005,
    range: 90, recoil: 0.9, auto: true, price: 300,
    note: 'Trust standard issue for sixty years. Boring and completely dependable.',
  },
  smg: {
    id: 'smg', name: 'Tolvan Compact', abbr: 'CMP-9', model: 'wpn_smg',
    damage: 15, rpm: 720, mag: 35, reload: 1.7, spread: 0.030, adsSpread: 0.013,
    range: 45, recoil: 0.7, auto: true, price: 260,
    note: 'Cheap, loud, and forgiving indoors. Falls apart past forty metres.',
  },
  shotgun: {
    id: 'shotgun', name: 'Harrow Breaching Gun', abbr: 'BRG-4', model: 'wpn_shotgun',
    damage: 17, pellets: 7, rpm: 75, mag: 6, reload: 3.0, spread: 0.075, adsSpread: 0.055,
    range: 26, recoil: 2.4, auto: false, price: 280,
    note: 'Opens doors and the people behind them. Useless across a yard.',
  },
  dmr: {
    id: 'dmr', name: 'Vardo Long Rifle', abbr: 'LNG-7', model: 'wpn_dmr',
    damage: 55, rpm: 90, mag: 10, reload: 2.6, spread: 0.012, adsSpread: 0.0012,
    range: 160, recoil: 2.0, auto: false, price: 520, scope: 2.2,
    note: 'Syndic marksmen build these from salvaged barrels. Each one is slightly different.',
  },
  lmg: {
    id: 'lmg', name: 'Belhaus Support Gun', abbr: 'SUP-3', model: 'wpn_lmg',
    damage: 20, rpm: 600, mag: 75, reload: 4.6, spread: 0.038, adsSpread: 0.020,
    range: 100, recoil: 1.3, auto: true, price: 560,
    note: 'Seventy-five rounds and a four-second reload. Choose your moment.',
  },
  relic: {
    id: 'relic', name: 'Pattern-0 Emitter', abbr: 'PT-0', model: 'wpn_relic',
    damage: 46, rpm: 200, mag: 18, reload: 2.9, spread: 0.010, adsSpread: 0.003,
    range: 120, recoil: 1.1, auto: true, price: 0, pierce: true,
    note: 'Pre-charter. No maker mark, no serial, and the cell has never needed filling.',
  },
};

// --------------------------------------------------------------------------
// Rank progression. Deliberately shallow — persistence is the point, not a tree.
// --------------------------------------------------------------------------

// Promotion grants a perk choice at every step, so the ladder is about what a
// soldier becomes rather than a slow drip of stats.
export const RANKS = [
  { id: 'recruit', name: 'Recruit', abbr: 'RCT', xp: 0, hpBonus: 0, accBonus: 0 },
  { id: 'trooper', name: 'Trooper', abbr: 'TRP', xp: 120, hpBonus: 8, accBonus: 0.04 },
  { id: 'veteran', name: 'Veteran', abbr: 'VET', xp: 340, hpBonus: 18, accBonus: 0.09 },
  { id: 'sergeant', name: 'Sergeant', abbr: 'SGT', xp: 700, hpBonus: 30, accBonus: 0.14 },
];

// The commander keeps climbing after the enlisted ladder runs out. These ranks
// are theirs alone and each one is another company-wide perk.
export const COMMANDER_RANKS = [
  { id: 'ensign', name: 'Ensign', abbr: 'ENS', xp: 0, hpBonus: 0, accBonus: 0 },
  { id: 'lieutenant', name: 'Lieutenant', abbr: 'LT', xp: 260, hpBonus: 12, accBonus: 0.05 },
  { id: 'captain', name: 'Captain', abbr: 'CPT', xp: 620, hpBonus: 26, accBonus: 0.10 },
  { id: 'major', name: 'Major', abbr: 'MAJ', xp: 1150, hpBonus: 42, accBonus: 0.15 },
  { id: 'colonel', name: 'Colonel', abbr: 'COL', xp: 1900, hpBonus: 60, accBonus: 0.20 },
  { id: 'commandant', name: 'Commandant', abbr: 'CMD', xp: 2900, hpBonus: 80, accBonus: 0.25 },
];

// --------------------------------------------------------------------------
// Kit — one slot per soldier. Small, legible, and each one changes a decision.
// --------------------------------------------------------------------------

/**
 * Equipment slots. A soldier carries a weapon, wears three pieces of armour and
 * one piece of gear — enough to make loadout a real decision without turning
 * the screen into a spreadsheet.
 */
export const SLOTS = [
  { id: 'weapon', name: 'Weapon' },
  { id: 'head', name: 'Head' },
  { id: 'body', name: 'Body' },
  { id: 'legs', name: 'Legs' },
  { id: 'gear', name: 'Gear' },
];

// Armour. Every piece trades protection against speed, which is the decision:
// a heavy trooper survives a firefight they cannot disengage from.
export const ARMOUR = {
  head_light: {
    id: 'head_light', slot: 'head', name: 'Field Cap', abbr: 'CAP', price: 60,
    desc: 'Cloth. Keeps the sun off and nothing else out.',
    mods: { hp: 4 },
  },
  head_combat: {
    id: 'head_combat', slot: 'head', name: 'Combat Helmet', abbr: 'HLM', price: 240,
    desc: 'Standard shell with a rail and a visor.',
    mods: { hp: 18, speed: -0.03 },
  },
  head_heavy: {
    id: 'head_heavy', slot: 'head', name: 'Sealed Helm', abbr: 'SLD', price: 520,
    desc: 'Full face plate and a filter. Heavy, and you cannot hear a thing.',
    mods: { hp: 34, speed: -0.09, sight: -6 },
  },
  body_webbing: {
    id: 'body_webbing', slot: 'body', name: 'Assault Webbing', abbr: 'WEB', price: 120,
    desc: 'Pouches and straps. Carries ammunition, stops nothing.',
    mods: { hp: 6, magMul: 1.25 },
  },
  body_carrier: {
    id: 'body_carrier', slot: 'body', name: 'Plate Carrier', abbr: 'CAR', price: 380,
    desc: 'Front and back plates with shoulder protection.',
    mods: { hp: 30, speed: -0.07 },
  },
  body_heavy: {
    id: 'body_heavy', slot: 'body', name: 'Breacher Cuirass', abbr: 'CUI', price: 760,
    desc: 'Full torso shell and pauldrons. You will not be running anywhere.',
    mods: { hp: 58, speed: -0.18 },
  },
  legs_fatigues: {
    id: 'legs_fatigues', slot: 'legs', name: 'Service Fatigues', abbr: 'FAT', price: 45,
    desc: 'Trousers. Comfortable, at least.',
    mods: { speed: 0.03 },
  },
  legs_reinforced: {
    id: 'legs_reinforced', slot: 'legs', name: 'Reinforced Legs', abbr: 'RNF', price: 210,
    desc: 'Padding over the thigh and knee.',
    mods: { hp: 14, speed: -0.02 },
  },
  legs_plated: {
    id: 'legs_plated', slot: 'legs', name: 'Plated Greaves', abbr: 'GRV', price: 460,
    desc: 'Articulated plate from hip to knee. Slow but very hard to drop.',
    mods: { hp: 28, speed: -0.11 },
  },
};

export const ARMOUR_LIST = Object.keys(ARMOUR);
export const armourInSlot = (slot) => ARMOUR_LIST.filter((id) => ARMOUR[id].slot === slot);

export const KIT = {
  plate: {
    id: 'plate', name: 'Composite Plate', abbr: 'PLT', price: 220,
    desc: '+30 condition. Heavy — costs a little speed.',
    mods: { hp: 30, speed: -0.08 },
  },
  optic: {
    id: 'optic', name: 'Ranging Optic', abbr: 'OPT', price: 260,
    desc: 'Tighter aim at distance and a wider field of view.',
    mods: { acc: 0.07, sight: 10 },
  },
  bandolier: {
    id: 'bandolier', name: 'Bandolier', abbr: 'BND', price: 180,
    desc: 'Half again as much ammunition in the magazine.',
    mods: { magMul: 1.5 },
  },
  stabiliser: {
    id: 'stabiliser', name: 'Stabiliser Rig', abbr: 'STB', price: 240,
    desc: 'Shrugs off suppressing fire and steadies the first shot.',
    mods: { suppressResist: 0.5, acc: 0.03 },
  },
  stim: {
    id: 'stim', name: 'Trauma Stim', abbr: 'STM', price: 300,
    desc: 'Bleeds out far more slowly, and gets up with more left.',
    mods: { bleedMul: 2.4, hp: 8 },
  },
  lightweight: {
    id: 'lightweight', name: 'Stripped Webbing', abbr: 'LGT', price: 190,
    desc: 'Carries less, moves much faster.',
    mods: { speed: 0.30, hp: -10 },
  },
};

// --------------------------------------------------------------------------
// Names. Assembled rather than listed so the roster never repeats obviously.
// --------------------------------------------------------------------------

export const FIRST_NAMES = [
  'Idren', 'Marath', 'Hessa', 'Bellin', 'Corvo', 'Yulen', 'Tamsin', 'Orwe',
  'Selk', 'Dovic', 'Anwen', 'Reilo', 'Mattis', 'Kessa', 'Vanth', 'Ivo',
  'Brael', 'Nurin', 'Halle', 'Prosk', 'Wenna', 'Aldo', 'Sarn', 'Ottol',
  'Fenn', 'Girsu', 'Lemmy', 'Odris', 'Pell', 'Rusk', 'Tavin', 'Ubel',
  'Vesh', 'Wray', 'Yarek', 'Zeb', 'Cael', 'Doran', 'Erris', 'Follo',
];

export const LAST_NAMES = [
  'Solk', 'Oyle', 'Kwill', 'Arcaute', 'Bessom', 'Trethen', 'Vosse', 'Marlow',
  'Dunkirk', 'Halloway', 'Renfrew', 'Osgood', 'Petrak', 'Caudle', 'Vantree',
  'Bexley', 'Morrow', 'Stane', 'Ferrick', 'Nazlo', 'Greave', 'Ockham',
  'Sallow', 'Trask', 'Weyland', 'Yeardley', 'Ashfen', 'Brill', 'Corwen',
  'Dray', 'Ellick', 'Fessup', 'Gorse', 'Hulme', 'Immer', 'Jossel',
];

// Traits are flavour plus one small mechanical nudge. Kept few and legible.
export const TRAITS = [
  { id: 'steady', name: 'Steady', desc: 'Does not panic under fire.', acc: 0.05 },
  { id: 'quick', name: 'Quick', desc: 'Moves before the order finishes.', speed: 0.15 },
  { id: 'tough', name: 'Tough', desc: 'Has been shot before and disliked it.', hp: 15 },
  { id: 'sharp', name: 'Sharp-Eyed', desc: 'Sees movement first.', acc: 0.08, sight: 12 },
  { id: 'loud', name: 'Loud', desc: 'Draws fire. Sometimes usefully.', hp: 8, acc: -0.03 },
  { id: 'careful', name: 'Careful', desc: 'Uses cover without being told.', cover: 0.3 },
  { id: 'stubborn', name: 'Stubborn', desc: 'Holds a position past sense.', hp: 10, speed: -0.05 },
  { id: 'lucky', name: 'Lucky', desc: 'No explanation offered.', luck: 0.12 },
];

// --------------------------------------------------------------------------
/**
 * What a soldier thinks the job is.
 *
 * The roster is the load-bearing system in this game: people persist, and the
 * player learns their names. Until now they had no opinion about anything done
 * with them, which meant that raiding a town, pressing prisoners into service
 * and breaking an oath were all decisions made in front of people who did not
 * care.
 *
 * A creed is not a stat and never touches combat. It decides how one soldier
 * reacts to what you choose to do, and the reactions disagree with each other
 * on purpose — there is no way to run a company that pleases everybody, and the
 * roster is where you find out which kind of outfit you have been building.
 */
export const CREEDS = {
  straight: {
    id: 'straight', name: 'Straight',
    line: 'Signed on to fight soldiers, not to rob people.',
    react: { raid: -9, press: -5, ransom: -3, sell: -14, release: 4, oathbreak: -6, unpaid: -2, win: 1, lair: 5, captured: -2, toll: -3 },
  },
  hard: {
    id: 'hard', name: 'Hard',
    line: 'Takes what is in front of them and does not lose sleep over it.',
    react: { raid: 5, press: 3, ransom: 3, sell: 4, release: -4, oathbreak: 0, unpaid: -4, win: 2, lair: 1, captured: -7, toll: -9 },
  },
  loyal: {
    id: 'loyal', name: 'Loyal',
    line: 'Keeps their word, and expects the company to keep its own.',
    react: { raid: -3, press: -2, ransom: -1, sell: -8, release: 2, oathbreak: -12, unpaid: -3, win: 2, lair: 3, captured: 1, toll: -2 },
  },
  paid: {
    id: 'paid', name: 'Professional',
    line: 'Here for the wage. Everything else is somebody else\'s argument.',
    react: { raid: 1, press: 0, ransom: 4, sell: 5, release: -1, oathbreak: 0, unpaid: -9, win: 1, lair: 0, captured: -5, toll: 2 },
  },
};

export const CREED_LIST = Object.keys(CREEDS);

// How a soldier feels about the company, as a word rather than a number.
export const REGARD_TIERS = [
  { at: -100, name: 'Finished', note: 'Looking for a reason to walk.' },
  { at: -45, name: 'Bitter', note: 'Has started talking about leaving.' },
  { at: -18, name: 'Sour', note: 'Does the job and says little.' },
  { at: -6, name: 'Neutral', note: 'No strong feelings either way.' },
  { at: 14, name: 'Committed', note: 'Believes in what the company is doing.' },
  { at: 38, name: 'Devoted', note: 'Would follow you anywhere, and says so.' },
];

/**
 * Favours, asked for by name.
 *
 * Every settlement already had named contacts with a line of dialogue each, and
 * they were pure decoration: a quartermaster who says the company is an expense,
 * and then never does anything about it. A favour is that person asking you for
 * something specific, in their own voice.
 *
 * These are deliberately NOT contracts. A contract is a posting, paid on
 * completion, and the board does not care who takes it. A favour is one person
 * remembering that you did or did not turn up — it pays less, and what it
 * actually buys is standing in that town, which is what decides who they will
 * put forward and what they will charge you.
 *
 * Both kinds resolve against machinery that already exists — cargo in the truck
 * and camps on the map — so a favour never needs its own mission type.
 */
export const FAVOURS = [
  {
    id: 'haul', kind: 'goods',
    ask: '%WHO% wants %QTY% crates of %GOOD% brought here, and no questions asked about where they came from.',
    done: 'Delivered. %WHO% counted it twice and said nothing, which is as close as they come to thanks.',
    fail: '%WHO% waited. You did not come.',
  },
  {
    id: 'shortage', kind: 'goods',
    ask: '%WHO% is %QTY% crates of %GOOD% short, and the shortfall is due this month.',
    done: '%WHO% signed it in under someone else\'s name and told you not to ask.',
    fail: 'The shortfall went in the books with your name beside it.',
  },
  {
    id: 'nest', kind: 'lair',
    ask: 'Something has made camp within a day of here, and %WHO% would like it gone.',
    done: 'The camp is cold. %WHO% heard about it before you got back.',
    fail: 'The camp is still there. So is everyone who has to drive past it.',
  },
  {
    id: 'road', kind: 'lair',
    ask: '%WHO% has lost two hauliers on the road and wants whoever is doing it broken up.',
    done: 'The road is quiet again. %WHO% will remember which company made it so.',
    fail: 'The road is still bad, and %WHO% stopped expecting anything.',
  },
];

// Holdings.
//
// Taking ground is the long game: a seized location becomes yours, produces
// something every day, and can be built up by spending both credits and the
// trade goods you have been hauling. Every upgrade does something you can feel
// on the roster or in the field — none of them are score.
// --------------------------------------------------------------------------

export const HOLDING_UPGRADES = {
  barracks: {
    id: 'barracks', name: 'Barracks', max: 3,
    desc: 'Quarters and a drill yard. More recruits available here, and better ones.',
    effect: (lv) => `+${lv} recruits offered, +${lv * 8}% chance they are already trained`,
    cost: (lv) => ({ credits: 600 + lv * 450, machine_parts: 4 + lv * 3, salvage: 6 + lv * 4 }),
  },
  infirmary: {
    id: 'infirmary', name: 'Infirmary', max: 3,
    desc: 'Beds, stock and somebody who knows what they are doing.',
    effect: (lv) => `wounds heal ${lv} day(s) faster company-wide, +${lv} medical kits each day`,
    cost: (lv) => ({ credits: 500 + lv * 400, medical_stock: 5 + lv * 4, machine_parts: 2 + lv * 2 }),
  },
  workshop: {
    id: 'workshop', name: 'Workshop', max: 3,
    desc: 'Benches, a lathe and a power feed. Fabricates parts and repairs weapons.',
    effect: (lv) => `weapons and kit ${lv * 12}% cheaper, produces ${lv * 2} machine stock daily`,
    cost: (lv) => ({ credits: 700 + lv * 500, machine_parts: 6 + lv * 4, fuel_cells: 3 + lv * 2 }),
  },
  depot: {
    id: 'depot', name: 'Depot', max: 3,
    desc: 'Hardstanding, cranes and somewhere to put things down.',
    effect: (lv) => `+${lv * 20} cargo capacity, +${lv * 8}% sale prices at your holdings`,
    cost: (lv) => ({ credits: 450 + lv * 350, salvage: 10 + lv * 6, machine_parts: 3 + lv * 2 }),
  },
  works: {
    id: 'works', name: 'Defence Works', max: 3,
    desc: 'Revetments, wire and firing positions covering the approaches.',
    effect: (lv) => `+${lv * 2} militia when defending, counter-attacks ${lv * 25}% less likely`,
    cost: (lv) => ({ credits: 550 + lv * 400, salvage: 8 + lv * 5, fuel_cells: 2 + lv * 2 }),
  },
};

export const UPGRADE_LIST = Object.keys(HOLDING_UPGRADES);

// What a holding yields each day before upgrades, by the kind of place it is.
export const HOLDING_YIELD = {
  outpost: { credits: 45, goods: { salvage: 1 } },
  ruin: { credits: 30, goods: { salvage: 2 } },
  settlement: { credits: 90, goods: { rations: 1 } },
  wild: { credits: 20, goods: {} },
};

// --------------------------------------------------------------------------
// Mission templates
// --------------------------------------------------------------------------

export const MISSION_TYPES = {
  recovery: {
    id: 'recovery',
    name: 'Recovery',
    verb: 'RECOVER',
    brief: 'Locate held personnel, release them, and walk them out.',
    objectiveText: 'Release held personnel',
  },
  sabotage: {
    id: 'sabotage',
    name: 'Sabotage',
    verb: 'DISABLE',
    brief: 'Reach the installation asset, place charges, leave before the response lands.',
    objectiveText: 'Place charges on the asset',
  },
  defense: {
    id: 'defense',
    name: 'Defence',
    verb: 'HOLD',
    brief: 'Hold the position until the attacking force breaks off.',
    objectiveText: 'Hold until the attack breaks',
  },
  seize: {
    id: 'seize',
    name: 'Seizure',
    verb: 'TAKE',
    brief: 'Break the garrison and hold the ground until it is yours.',
    objectiveText: 'Take and hold the position',
  },
  siege: {
    id: 'siege',
    name: 'Siege',
    verb: 'BREACH',
    brief: 'A wall, one gate, and everyone inside knowing exactly where you '
      + 'have to come through. Blow the gate, then take what is behind it.',
    objectiveText: 'Breach the gate and take the compound',
  },
  pit: {
    id: 'pit',
    name: 'The Pit',
    verb: 'FIGHT',
    brief: 'Nobody dies in the pit. They put you in with whoever is next, the '
      + 'crowd bets on it, and you walk out either way — richer, or not.',
    objectiveText: 'Last as long as you can',
  },
  lair: {
    id: 'lair',
    name: 'Hideout',
    verb: 'CLEAR',
    brief: 'A dug-in camp at the end of a gully. There is one way in, they '
      + 'know the ground, and only a handful of you will fit through it.',
    objectiveText: 'Clear the hideout',
  },
  raid: {
    id: 'raid',
    name: 'Raid',
    verb: 'RAID',
    brief: 'Go in, break open what they are keeping, carry out what you can, '
      + 'and be gone before the whole place is awake.',
    objectiveText: 'Break open their stores and get clear',
  },
  titan: {
    id: 'titan',
    name: 'Titan',
    verb: 'BREAK',
    brief: 'A pre-charter siege walker, running again. Rifles will not do it. '
      + 'Beat the armour off a section, then put everything through the hole.',
    objectiveText: 'Break the walker',
  },
  // Not a contract type — this is what a road encounter becomes when the
  // player decides to fight rather than withdraw.
  skirmish: {
    id: 'skirmish',
    name: 'Road Engagement',
    verb: 'BREAK',
    brief: 'Break the party blocking the road, then get back on it.',
    objectiveText: 'Break the hostile party',
  },
};

/**
 * What a flag of your own actually lets you decide.
 *
 * Declaring a faction used to change one multiplier — everybody wanted your
 * ground harder — and nothing else. You were a company with a banner rather
 * than a power with a policy. These are the standing decisions a power makes,
 * and each one is a genuine trade rather than an upgrade: every gain is paid
 * for somewhere the player will feel it.
 *
 * Deliberately few. Three real choices a player can hold in their head beat a
 * dozen sliders nobody reads, and each of these pulls on a system that already
 * exists — income, manpower, and who is willing to shoot at you.
 */
export const POLICIES = {
  levy: {
    id: 'levy', name: 'War Levy',
    desc: 'Take a harder cut from every place you hold.',
    effect: '+35% income from holdings, and they resent you for it',
  },
  conscription: {
    id: 'conscription', name: 'Conscription',
    desc: 'Your holdings put people forward whether they want to or not.',
    effect: 'Garrisons refill faster; the towns have fewer left to sell you',
  },
  tolls: {
    id: 'tolls', name: 'Road Tolls',
    desc: 'Charge for the roads your writ runs along.',
    effect: 'Credits per holding each day; both powers like you less',
  },
};

export const POLICY_LIST = Object.keys(POLICIES);
