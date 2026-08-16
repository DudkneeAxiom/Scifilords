// Progression: what a soldier becomes, rather than just how big their numbers get.
//
// Every perk here changes behaviour somewhere in the combat or campaign code —
// none of them are flat stat bumps with a name attached. The player picks one
// from three on every promotion, so two riflemen who started identical diverge
// into recognisably different soldiers over a campaign.
//
// `mods` are read by roster.effective() and by the mission layer. Anything that
// needs bespoke logic sets a flag and is handled at the site that cares.

export const SOLDIER_PERKS = {
  // --- shooting ---------------------------------------------------------
  deadeye: {
    id: 'deadeye', name: 'Deadeye',
    desc: 'Accuracy holds up at distance. Aim scatter grows far more slowly.',
    mods: { rangeAcc: 0.45 },
  },
  close_quarters: {
    id: 'close_quarters', name: 'Close Quarters',
    desc: '+35% damage inside twelve metres.',
    mods: { closeDmg: 0.35 },
  },
  quickdraw: {
    id: 'quickdraw', name: 'Quickdraw',
    desc: 'Reloads 35% faster.',
    mods: { reloadMul: 0.65 },
  },
  trigger_control: {
    id: 'trigger_control', name: 'Trigger Control',
    desc: 'Longer, steadier bursts and a shorter pause between them.',
    mods: { burstBonus: 2, burstRest: 0.6 },
  },
  pack_mule: {
    id: 'pack_mule', name: 'Pack Mule',
    desc: 'Carries a bigger load. +40% magazine capacity.',
    mods: { magMul: 1.4 },
  },

  // --- survivability ----------------------------------------------------
  cover_hound: {
    id: 'cover_hound', name: 'Cover Hound',
    desc: 'Finds and uses cover without being told, and from further away.',
    mods: { cover: 0.45, coverRange: 8 },
  },
  steady_nerves: {
    id: 'steady_nerves', name: 'Steady Nerves',
    desc: 'Suppressing fire barely touches them.',
    mods: { suppressResist: 0.7 },
  },
  hard_to_kill: {
    id: 'hard_to_kill', name: 'Hard To Kill',
    desc: '+25 condition, and bleeds out far more slowly when down.',
    mods: { hp: 25, bleedMul: 1.9 },
  },
  scarred: {
    id: 'scarred', name: 'Scarred',
    desc: 'Wounds no longer degrade their aim. They have worked through worse.',
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
    desc: 'Sees further, and the rest of the squad engages what they see.',
    mods: { sight: 18, shareTargets: 1 },
  },
  suppressor: {
    id: 'suppressor', name: 'Suppressor',
    desc: 'Their suppressing fire pins far harder.',
    mods: { suppressPower: 0.9 },
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
    desc: 'Every soldier under your command shoots better. +8% squad accuracy.',
    mods: { squadAcc: 0.08 },
  },
  tactician: {
    id: 'tactician', name: 'Tactician',
    desc: 'Orders are acted on immediately, and your squad suppresses harder.',
    mods: { orderSpeed: 2.5, squadSuppress: 0.5 },
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
    desc: 'Nobody in your company panics under fire.',
    mods: { squadSuppressResist: 0.55 },
  },
  forward_observer: {
    id: 'forward_observer', name: 'Forward Observer',
    desc: 'Your squad shares what it sees. Everyone spots further.',
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
    squadAcc: 0, orderSpeed: 0, squadSuppress: 0, casualtySurvival: 0, healRate: 0,
    supplyMul: 1, bonusKits: 0, payMul: 1, hireMul: 1, lootMul: 1,
    squadSuppressResist: 0, squadSight: 0, extraRecruit: 0,
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

  const affinity = {
    medic: ['combat_medic', 'lucky', 'fleet'],
    marksman: ['deadeye', 'spotter', 'steady_nerves'],
    breacher: ['close_quarters', 'hard_to_kill', 'fleet'],
    gunner: ['suppressor', 'pack_mule', 'trigger_control'],
    signals: ['breach_specialist', 'spotter', 'quickdraw'],
    rifleman: ['trigger_control', 'cover_hound', 'quickdraw'],
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
