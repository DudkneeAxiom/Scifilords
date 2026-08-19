// Progression: what a soldier becomes, rather than just how big their numbers get.
//
// Every perk here changes behaviour somewhere in the combat or campaign code —
// none of them are flat stat bumps with a name attached. The player picks one
// from three on every promotion, so two swordsmen who started identical diverge
// into recognisably different soldiers over a campaign.
//
// `mods` are read by roster.effective() and by the mission layer. Anything that
// needs bespoke logic sets a flag and is handled at the site that cares.
//
// THE TREE IS STEEL NOW. It used to be a shooter's ladder — reloads, magazine
// capacity, burst length, suppressing fire — and it survived the combat
// overhaul untouched, which meant a company could still promote its way into
// a gunfight the game no longer has. Every one of those is retired here and
// replaced by something the melee runtime actually reads: swing speed and
// wind, the guard, reach, footing. A perk that modifies a system nobody runs
// is worse than no perk, because the player spends a promotion on it.

export const SOLDIER_PERKS = {
  // --- the swing ---------------------------------------------------------
  swordhand: {
    id: 'swordhand', name: 'Swordhand',
    desc: 'Recovers from a swing far faster. Roughly a quarter more steel in '
      + 'the same time.',
    mods: { swingSpeed: 0.28 },
  },
  close_quarters: {
    id: 'close_quarters', name: 'Close Quarters',
    desc: 'Deadly in the press. +35% damage once the lines have met.',
    mods: { closeDmg: 0.35 },
  },
  long_arm: {
    id: 'long_arm', name: 'Long Arm',
    desc: 'Strikes half a metre further than the weapon should reach. They '
      + 'get the first blow in.',
    mods: { reachBonus: 0.5 },
  },
  deadeye: {
    id: 'deadeye', name: 'Deadeye',
    desc: 'A bowman whose arrows hold their line. Scatter at the loose is '
      + 'nearly halved.',
    mods: { rangeAcc: 0.45 },
  },
  full_quiver: {
    id: 'full_quiver', name: 'Full Quiver',
    desc: 'Carries far more than they are issued. +40% arrows.',
    mods: { magMul: 1.4 },
  },

  // --- survivability ----------------------------------------------------
  shield_wall: {
    id: 'shield_wall', name: 'Shieldwall',
    desc: 'Their guard turns most of what it meets, and the plate lasts twice '
      + 'as long behind it.',
    mods: { guardStr: 0.6 },
  },
  planted: {
    id: 'planted', name: 'Planted',
    desc: 'Hard to interrupt and harder to move. Weight no longer cancels '
      + 'their swing.',
    mods: { staggerRes: 0.75 },
  },
  second_wind: {
    id: 'second_wind', name: 'Second Wind',
    desc: 'Swings cost them less and they get it back faster. They are still '
      + 'fighting when the line is blown.',
    mods: { wind: 0.6 },
  },
  hard_to_kill: {
    id: 'hard_to_kill', name: 'Hard To Kill',
    desc: '+25 condition, and bleeds out far more slowly when down.',
    mods: { hp: 25, bleedMul: 1.9 },
  },
  scarred: {
    id: 'scarred', name: 'Scarred',
    desc: 'Wounds no longer degrade their bladework. They have worked through '
      + 'worse.',
    mods: { ignoreWoundAcc: 1 },
  },
  fleet: {
    id: 'fleet', name: 'Fleet',
    desc: 'Moves 25% faster and repositions between orders without hesitating.',
    mods: { speed: 0.25 },
  },

  // --- support ----------------------------------------------------------
  combat_medic: {
    id: 'combat_medic', name: 'Combat Medic',
    desc: 'Stabilises casualties in half the time, and sometimes without a kit.',
    mods: { reviveSpeed: 2.0, freeKit: 0.4 },
  },
  spotter: {
    id: 'spotter', name: 'Spotter',
    desc: 'Sees further, and the rest of the line engages what they see.',
    mods: { sight: 18, shareTargets: 1 },
  },
  standard_bearer: {
    id: 'standard_bearer', name: 'Standard Bearer',
    desc: 'Everyone within sight of them holds a little longer. Nerve does '
      + 'not break where the banner still stands.',
    mods: { rally: 12 },
  },
  breach_specialist: {
    id: 'breach_specialist', name: 'Breach Specialist',
    desc: 'Works objective hardware at double speed.',
    mods: { interactSpeed: 2.0 },
  },
  lucky: {
    id: 'lucky', name: 'Lucky',
    desc: 'Survives things they should not. Nobody asks how.',
    mods: { luck: 0.25 },
  },
};

// Commander perks apply to the whole company. These are the choices that make
// a campaign feel like it belongs to a particular officer.
export const COMMANDER_PERKS = {
  drillmaster: {
    id: 'drillmaster', name: 'Drillmaster',
    desc: 'Every soldier under your command handles their weapon better. '
      + '+8% company bladework.',
    mods: { squadAcc: 0.08 },
  },
  tactician: {
    id: 'tactician', name: 'Tactician',
    desc: 'Orders are acted on immediately, and your formations dress '
      + 'themselves without being told twice.',
    mods: { orderSpeed: 2.5, squadCohesion: 0.4 },
  },
  field_surgeon: {
    id: 'field_surgeon', name: 'Field Surgeon',
    desc: 'Casualties are far likelier to survive, and wounds heal in half the time.',
    mods: { casualtySurvival: 0.3, healRate: 2 },
  },
  quartermaster: {
    id: 'quartermaster', name: 'Quartermaster',
    desc: 'Deployments consume less, and you carry two extra medical kits.',
    mods: { supplyMul: 0.5, bonusKits: 2 },
  },
  negotiator: {
    id: 'negotiator', name: 'Negotiator',
    desc: 'Contracts pay 30% more and recruits sign for less.',
    mods: { payMul: 1.3, hireMul: 0.75 },
  },
  scrounger: {
    id: 'scrounger', name: 'Scrounger',
    desc: 'You find more in the wreckage. Salvage is worth far more.',
    mods: { lootMul: 2.2 },
  },
  hard_case: {
    id: 'hard_case', name: 'Hard Case',
    desc: 'You personally take a great deal more killing. +40 condition.',
    mods: { hp: 40 },
  },
  iron_will: {
    id: 'iron_will', name: 'Iron Will',
    desc: 'Your line does not break. Every soldier holds their nerve far '
      + 'longer once the casualties start.',
    mods: { squadNerve: 22 },
  },
  forward_observer: {
    id: 'forward_observer', name: 'Outriders',
    desc: 'You know the ground before you stand on it. Everyone in the '
      + 'company spots further.',
    mods: { squadSight: 14 },
  },
  press_gang: {
    id: 'press_gang', name: 'Press Gang',
    desc: 'Word spreads. Settlements offer an extra recruit, often a better one.',
    mods: { extraRecruit: 1 },
  },
};

/** Sum a modifier across a soldier's perks. */
export function perkMod(s, key) {
  let v = 0;
  for (const id of s.perks || []) {
    const p = SOLDIER_PERKS[id] || COMMANDER_PERKS[id];
    if (p && p.mods[key]) v += p.mods[key];
  }
  return v;
}

export const hasPerk = (s, id) => (s.perks || []).includes(id);

/**
 * Company-wide modifiers from the commander's perks. Computed once where it is
 * needed rather than walked per bullet.
 */
export function companyMods(roster) {
  const cmd = roster.find((s) => s.isCommander);
  const out = {
    squadAcc: 0, orderSpeed: 0, squadCohesion: 0, casualtySurvival: 0, healRate: 0,
    supplyMul: 1, bonusKits: 0, payMul: 1, hireMul: 1, lootMul: 1,
    squadNerve: 0, squadSight: 0, extraRecruit: 0,
  };
  if (!cmd) return out;
  for (const id of cmd.perks || []) {
    const p = COMMANDER_PERKS[id];
    if (!p) continue;
    for (const [k, v] of Object.entries(p.mods)) {
      if (k === 'supplyMul' || k === 'payMul' || k === 'hireMul' || k === 'lootMul') {
        out[k] *= v;
      } else if (k in out) {
        out[k] += v;
      }
    }
  }
  return out;
}

/**
 * Three perks to choose from on promotion. Weighted toward the soldier's role
 * so a medic tends to be offered medic things, but never locked to them —
 * an unexpected offer is what makes a soldier memorable.
 */
export function offerPerks(r, s) {
  const pool = Object.keys(s.isCommander ? COMMANDER_PERKS : SOLDIER_PERKS)
    .filter((id) => !(s.perks || []).includes(id));
  if (!pool.length) return [];

  // The role IDs are the old ones — they are baked into every save — but what
  // they MEAN changed with the overhaul: rifleman is a swordsman, gunner a
  // spearman, marksman an archer, breacher the heavy. The affinities follow
  // the meaning, not the name.
  const affinity = {
    medic: ['combat_medic', 'lucky', 'fleet'],
    marksman: ['deadeye', 'full_quiver', 'spotter'],            // archer
    breacher: ['close_quarters', 'hard_to_kill', 'planted'],    // heavy
    gunner: ['long_arm', 'planted', 'shield_wall'],             // spearman
    signals: ['breach_specialist', 'spotter', 'standard_bearer'],
    rifleman: ['swordhand', 'shield_wall', 'second_wind'],      // swordsman
  }[s.role] || [];

  const weighted = [];
  for (const id of pool) {
    weighted.push(id);
    if (affinity.includes(id)) weighted.push(id, id); // three times as likely
  }

  const picked = [];
  for (let i = 0; i < 3 && weighted.length; i++) {
    const idx = Math.floor(r() * weighted.length);
    const id = weighted[idx];
    picked.push(id);
    for (let j = weighted.length - 1; j >= 0; j--) {
      if (weighted[j] === id) weighted.splice(j, 1);
    }
  }
  return picked;
}

export const perkDef = (id) => SOLDIER_PERKS[id] || COMMANDER_PERKS[id] || null;
