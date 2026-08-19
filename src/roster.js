// Persistent personnel.
//
// This is the load-bearing system of the whole game. A soldier is created once
// and then carries every consequence forward: the deployments they survived,
// the people they shot, the wound that is still healing, the rank they earned
// by being alive longer than anyone expected. Nothing here is regenerated
// between missions — a soldier object lives from recruitment to death.

import {
  RANKS, COMMANDER_RANKS, ROLES, TRAITS, WEAPONS, KIT, ARMOUR, SLOTS, ORIGINS,
  CREEDS, CREED_LIST, REGARD_TIERS,
  FIRST_NAMES, LAST_NAMES,
} from './data.js';
import { perkMod, hasPerk, offerPerks } from './perks.js';
import { clamp, pick, irange, uid, shuffle } from './util.js';

/** The rank table a given soldier climbs. The commander has their own. */
export const ladder = (s) => (s.isCommander ? COMMANDER_RANKS : RANKS);

export const STATUS = {
  HEALTHY: 'healthy',
  WOUNDED: 'wounded',
  INCAP: 'incap',
  DEAD: 'dead',
};

// Wounds are named so a roster line reads like a record, not a debuff list —
// and named for WHAT DID IT. A man who went down under a breaker maul did not
// take a graze; he has a shoulder that will not hold a shield for a fortnight.
// `kind` is the damage that caused it: cut (edged), pierce (spears, arrows),
// crush (mauls and falls), shot (the pre-charter relics, still out there).
// rollWound draws from the matching set, so the record and the battle agree.
export const WOUNDS = [
  // --- edged: swords, blades. Bleeding and tendon damage. -----------------
  { id: 'forearm', kind: 'cut', name: 'Forearm, laid open', days: 4, acc: -0.12 },
  { id: 'brow', kind: 'cut', name: 'Brow, split', days: 3, acc: -0.09, sight: -6 },
  { id: 'thigh_cut', kind: 'cut', name: 'Thigh, opened', days: 5, speed: -0.20 },
  { id: 'shoulder_cut', kind: 'cut', name: 'Shoulder, cut deep', days: 6, acc: -0.14, hp: -12 },
  // --- pierce: spears and arrows. Small holes, deep trouble. --------------
  { id: 'flank', kind: 'pierce', name: 'Flank, punctured', days: 6, hp: -20 },
  { id: 'shoulder', kind: 'pierce', name: 'Shoulder, through', days: 4, acc: -0.10 },
  { id: 'calf', kind: 'pierce', name: 'Calf, pinned', days: 5, speed: -0.22 },
  { id: 'gut', kind: 'pierce', name: 'Abdominal, serious', days: 9, hp: -30, acc: -0.06 },
  // --- crush: mauls, and the ground when a horse-sized blow lands. --------
  { id: 'ribs', kind: 'crush', name: 'Ribs, staved in', days: 7, hp: -24 },
  { id: 'collar', kind: 'crush', name: 'Collarbone, broken', days: 9, acc: -0.18 },
  { id: 'concussion', kind: 'crush', name: 'Concussion', days: 4, acc: -0.10, speed: -0.08 },
  { id: 'knee', kind: 'crush', name: 'Knee, wrecked', days: 10, speed: -0.30 },
  // --- shot: relics only, but the wound is still a wound. -----------------
  { id: 'thigh', kind: 'shot', name: 'Thigh, grazed', days: 3, speed: -0.18 },
  { id: 'hand', kind: 'shot', name: 'Hand, burned', days: 4, acc: -0.14 },
];

/** Which wound table a weapon writes into. */
export function woundKindOf(weaponId) {
  if (weaponId === 'heavy') return 'crush';
  if (weaponId === 'spear' || weaponId === 'bow') return 'pierce';
  if (weaponId === 'sword' || weaponId === 'blade') return 'cut';
  if (weaponId) return 'shot';
  return null;
}

/**
 * Create a persistent soldier. `how` records where they came from so the
 * roster can show "Rescued at Grellan Array" three hours later — the cheapest
 * possible way to make a unit feel like a person.
 */
export function makeSoldier(r, {
  role, rank = 0, how = 'Enlisted', day = 1, name = null, avoid = null,
  origin = 'free',
} = {}) {
  const roleDef = ROLES[role] || ROLES.rifleman;
  // Re-roll against names already on the roster. Two soldiers called Tavin is
  // confusing precisely because the player is meant to track them individually.
  const taken = avoid ? new Set(avoid.map((n) => String(n).split(' ')[0])) : null;
  let first = pick(r, FIRST_NAMES);
  for (let i = 0; taken && taken.has(first) && i < 12; i++) first = pick(r, FIRST_NAMES);
  const traitPool = shuffle(r, TRAITS);
  const traits = traitPool.slice(0, r() < 0.45 ? 2 : 1).map((t) => t.id);
  const s = {
    id: uid('sol'),
    name: name || `${first} ${pick(r, LAST_NAMES)}`,
    role: roleDef.id,
    rank,
    xp: RANKS[rank].xp,
    status: STATUS.HEALTHY,
    wound: null,
    weapon: roleDef.weapon,
    deployments: 0,
    kills: 0,
    traits,
    perks: [],
    pendingPerks: null,   // set on promotion; the player chooses one
    kit: null,
    // Where they were raised. Decides appearance and a stat profile, for life.
    origin: ORIGINS[origin] ? origin : 'free',
    equip: { head: null, body: null, legs: null },
    joinedDay: day,
    joinedHow: how,
    // Drives the generated portrait so a face is stable for a soldier's life.
    portraitSeed: Math.floor(r() * 0xffffff),
    hp: 0,
    maxHp: 0,
  };
  // What they think the job is, derived from the seed that already decided
  // their face rather than from a fresh draw. Taking another number off the
  // generator here would shift every roll made after it and quietly change
  // every seeded campaign in the game.
  s.creed = CREED_LIST[s.portraitSeed % CREED_LIST.length];
  s.regard = 0;
  s.maxHp = maxHpOf(s);
  s.hp = s.maxHp;
  return s;
}

function traitSum(s, key) {
  let v = 0;
  for (const id of s.traits) {
    const t = TRAITS.find((x) => x.id === id);
    if (t && t[key]) v += t[key];
  }
  return v;
}

/**
 * Modifier from everything the soldier is wearing or carrying: the gear slot
 * plus the three armour slots.
 */
/** Modifier from where this soldier was raised. */
function originMod(s, key) {
  const o = ORIGINS[s.origin];
  return o && o.mods[key] ? o.mods[key] : 0;
}

/**
 * Lineage: whose army trained this soldier before they were yours.
 *
 * Mount & Blade's troop trees, in this game's terms. A pressed Trust
 * prisoner was DRILLED — they shoot straighter and use cover like they were
 * taught to; a Syndic muster walks fast and presses hard; raider stock is
 * ragged at range and vicious up close. Recruits carry the doctrine of the
 * faction that holds their town; scrappers and free towns train nobody in
 * particular. The roster badge is LINEAGES[id].name.
 */
export const LINEAGES = {
  trust: {
    id: 'trust', name: 'TRUST-DRILLED',
    mods: { acc: 0.05, cover: 0.18 },
  },
  syndic: {
    id: 'syndic', name: 'SYNDIC MUSTER',
    mods: { speed: 0.06, aggression: 0.12, cover: -0.05 },
  },
  raider: {
    id: 'raider', name: 'RAIDER STOCK',
    mods: { acc: -0.02, speed: 0.04, closeDmg: 0.15, cover: -0.1 },
  },
};

function lineageMod(s, key) {
  const l = s.lineage && LINEAGES[s.lineage];
  return l && l.mods[key] ? l.mods[key] : 0;
}

export const originOf = (s) => ORIGINS[s.origin] || ORIGINS.free;
// Soldiers saved before creeds existed have neither field. They read as
// professionals who feel nothing in particular, which is a fair description of
// somebody who has never been asked.
export const creedOf = (s) => CREEDS[s.creed] || CREEDS.paid;
export const regardTier = (s) => [...REGARD_TIERS].reverse()
  .find((t) => (s.regard || 0) >= t.at) || REGARD_TIERS[0];

function kitMod(s, key) {
  let v = 0;
  const k = s.kit ? KIT[s.kit] : null;
  if (k && k.mods[key]) v += k.mods[key];
  const eq = s.equip || {};
  for (const slot of ['head', 'body', 'legs']) {
    const a = eq[slot] ? ARMOUR[eq[slot]] : null;
    if (a && a.mods[key]) v += a.mods[key];
  }
  return v;
}

/** Total armour value, for display. */
export function armourRating(s) {
  const eq = s.equip || {};
  let n = 0;
  for (const slot of ['head', 'body', 'legs']) {
    const a = eq[slot] ? ARMOUR[eq[slot]] : null;
    if (a?.mods.hp) n += a.mods.hp;
  }
  return n;
}

export function maxHpOf(s) {
  const rank = ladder(s)[s.rank] || ladder(s)[0];
  const base = ROLES[s.role].hp + rank.hpBonus
    + traitSum(s, 'hp') + perkMod(s, 'hp') + kitMod(s, 'hp') + originMod(s, 'hp');
  const w = s.wound ? (WOUNDS.find((x) => x.id === s.wound.id)?.hp || 0) : 0;
  return Math.max(30, Math.round(base + w));
}

/**
 * Combat-effective stats after rank, traits, perks, kit and any unhealed wound.
 * `company` is the aggregated commander-perk bonus; passing it is optional so
 * the roster UI can show a soldier's own numbers in isolation.
 */
export function effective(s, company = null) {
  const role = ROLES[s.role];
  const rank = ladder(s)[s.rank] || ladder(s)[0];
  const w = s.wound ? WOUNDS.find((x) => x.id === s.wound.id) : null;
  // Scarred soldiers no longer shoot worse for being hurt.
  const woundAcc = hasPerk(s, 'scarred') ? 0 : (w?.acc || 0);
  const speedMul = 1 + traitSum(s, 'speed') + perkMod(s, 'speed')
    + kitMod(s, 'speed') + originMod(s, 'speed') + lineageMod(s, 'speed') + (w?.speed || 0);
  return {
    accuracy: clamp(
      role.accuracy + rank.accBonus + traitSum(s, 'acc') + perkMod(s, 'acc')
      + kitMod(s, 'acc') + originMod(s, 'acc') + lineageMod(s, 'acc')
      + woundAcc + (company?.squadAcc || 0), 0.12, 0.97),
    aggression: clamp(role.aggression + lineageMod(s, 'aggression'), 0.1, 1),
    speed: clamp(4.2 * speedMul, 1.6, 7.5),
    sight: 55 + traitSum(s, 'sight') + perkMod(s, 'sight')
      + kitMod(s, 'sight') + originMod(s, 'sight') + (company?.squadSight || 0),
    cover: 0.35 + traitSum(s, 'cover') + perkMod(s, 'cover') + originMod(s, 'cover')
      + lineageMod(s, 'cover'),
    coverRange: 9 + perkMod(s, 'coverRange'),
    luck: traitSum(s, 'luck') + perkMod(s, 'luck') + originMod(s, 'luck'),
    // 0 = fully affected by suppressing fire, 1 = immune.
    suppressResist: clamp(perkMod(s, 'suppressResist') + kitMod(s, 'suppressResist')
      + (company?.squadSuppressResist || 0), 0, 0.92),
    suppressPower: 1 + perkMod(s, 'suppressPower') + (company?.squadSuppress || 0),
    rangeAcc: perkMod(s, 'rangeAcc'),
    closeDmg: perkMod(s, 'closeDmg') + lineageMod(s, 'closeDmg'),
    reloadMul: 1 * (hasPerk(s, 'quickdraw') ? 0.65 : 1),
    magMul: 1 + (perkMod(s, 'magMul') ? perkMod(s, 'magMul') - 1 : 0)
      + (kitMod(s, 'magMul') ? kitMod(s, 'magMul') - 1 : 0),
    burstBonus: perkMod(s, 'burstBonus'),
    burstRest: perkMod(s, 'burstRest') ? 0.6 : 1,
    bleedMul: 1 + (perkMod(s, 'bleedMul') ? perkMod(s, 'bleedMul') - 1 : 0)
      + (kitMod(s, 'bleedMul') ? kitMod(s, 'bleedMul') - 1 : 0),
    interactSpeed: 1 + (perkMod(s, 'interactSpeed') ? perkMod(s, 'interactSpeed') - 1 : 0),
    reviveSpeed: 1 + (perkMod(s, 'reviveSpeed') ? perkMod(s, 'reviveSpeed') - 1 : 0),
    shareTargets: !!perkMod(s, 'shareTargets'),
    maxHp: maxHpOf(s),
  };
}

export const rankOf = (s) => ladder(s)[s.rank] || ladder(s)[0];
export const roleOf = (s) => ROLES[s.role];
export const weaponOf = (s) => WEAPONS[s.weapon] || WEAPONS.rifle;

/** Short roster label, e.g. "SGT Halle Morrow". */
export const label = (s) => `${rankOf(s).abbr} ${s.name}`;

/**
 * Award experience and promote if the threshold is crossed. Returns the new
 * rank object when a promotion happened, else null — the caller turns that
 * into an after-action line, because a promotion the player does not SEE has
 * no value.
 */
export function addXp(s, amount, r = null) {
  if (s.status === STATUS.DEAD) return null;
  s.xp += amount;
  const table = ladder(s);
  let promoted = null;
  let gained = 0;
  while (s.rank < table.length - 1 && s.xp >= table[s.rank + 1].xp) {
    s.rank++;
    promoted = table[s.rank];
    gained++;
  }
  if (promoted) {
    s.maxHp = maxHpOf(s);
    s.hp = Math.min(s.maxHp, s.hp + promoted.hpBonus);
    // Every promotion earns a perk choice. Queued rather than applied, because
    // the player picks it — that choice is the point of the whole system.
    if (r) {
      s.pendingPerks = s.pendingPerks || [];
      for (let i = 0; i < gained; i++) {
        const offer = offerPerks(r, s);
        if (offer.length) s.pendingPerks.push(offer);
      }
      if (!s.pendingPerks.length) s.pendingPerks = null;
    }
  }
  return promoted;
}

/** Apply a chosen perk and clear that promotion's offer. */
export function choosePerk(s, id) {
  if (!s.pendingPerks || !s.pendingPerks.length) return false;
  const offer = s.pendingPerks[0];
  if (!offer.includes(id)) return false;
  s.perks = s.perks || [];
  s.perks.push(id);
  s.pendingPerks.shift();
  if (!s.pendingPerks.length) s.pendingPerks = null;
  s.maxHp = maxHpOf(s);
  s.hp = Math.min(s.maxHp, s.hp + 10);
  return true;
}

export const awaitingPerk = (roster) =>
  roster.filter((s) => s.status !== STATUS.DEAD && s.pendingPerks && s.pendingPerks.length);

/**
 * Resolve what happens to a soldier who went down in the field.
 * `stabilised` means someone reached them before extraction (a medic, or the
 * player standing over them). Unstabilised casualties can die outright —
 * permanently, and that is the point.
 */
/**
 * What happened to somebody who went down.
 *
 * Melee changed the arithmetic in two directions at once, and both belong
 * here. A man dropped at arm's length is dropped among his own: the line is
 * RIGHT THERE, and dragging him back over a few metres is a thing that
 * actually happens, so a steel casualty left on the field survives more
 * often than one abandoned across open ground under fire. But a maul is not
 * a rifle — crushing trauma kills people who would have walked away from a
 * cut, and no amount of luck argues with a staved-in chest.
 *
 * Armour finally earns its weight here too. It is the difference between a
 * blade turning on a plate and a blade finding a body, and it is worth most
 * against edges and least against the things designed to defeat it.
 */
export function resolveCasualty(r, s, {
  stabilised, hasMedic, survivalBonus = 0, cause = null,
}) {
  // How well dressed they were when it happened, 0..1-ish.
  const plate = Math.min(0.85, armourRating(s) / 90);
  const CRUSH = cause === 'crush';
  const CUT = cause === 'cut';
  // Armour turns edges; a maul is the answer TO armour and barely notices.
  const shrug = plate * (CUT ? 0.55 : CRUSH ? 0.12 : 0.34);

  if (stabilised) {
    s.status = STATUS.WOUNDED;
    s.wound = rollWound(r, (hasMedic ? 0.6 : 1.0) * (CRUSH ? 1.35 : 1) * (1 - shrug * 0.4), cause);
    s.maxHp = maxHpOf(s);
    s.hp = Math.max(8, Math.round(s.maxHp * 0.3));
    return STATUS.WOUNDED;
  }
  // Left behind. Luck, a medic, and the fact that a melee casualty falls
  // among friends rather than a hundred metres from them.
  const closeQuarters = cause && cause !== 'shot' ? 0.14 : 0;
  const survival = 0.30 + effective(s).luck + (hasMedic ? 0.12 : 0)
    + survivalBonus + closeQuarters + shrug * 0.25 - (CRUSH ? 0.16 : 0);
  if (r() < survival) {
    s.status = STATUS.WOUNDED;
    s.wound = rollWound(r, 1.4 * (CRUSH ? 1.3 : 1), cause);
    s.maxHp = maxHpOf(s);
    s.hp = Math.max(5, Math.round(s.maxHp * 0.18));
    return STATUS.WOUNDED;
  }
  s.status = STATUS.DEAD;
  s.hp = 0;
  return STATUS.DEAD;
}

function rollWound(r, severityScale, cause = null) {
  // Draw from what actually hit them; fall back to the whole table for
  // anything that never said (old saves, scripted losses, the Titan).
  const pool = cause ? WOUNDS.filter((w) => w.kind === cause) : WOUNDS;
  const w = pick(r, pool.length ? pool : WOUNDS);
  return {
    id: w.id, name: w.name,
    days: Math.max(1, Math.round(w.days * severityScale)),
  };
}

export function woundInfo(s) {
  if (!s.wound) return null;
  const def = WOUNDS.find((x) => x.id === s.wound.id);
  return { ...def, days: s.wound.days };
}

/** Called once per campaign day. Heals wounds down and restores condition. */
export function dayTick(s, { atMedical, healMul = 1 }) {
  if (s.status === STATUS.DEAD) return null;
  let recovered = null;
  const rate = (atMedical ? 2 : 1) * healMul;
  if (s.wound) {
    s.wound.days -= rate;
    if (s.wound.days <= 0) {
      s.wound = null;
      s.status = STATUS.HEALTHY;
      s.maxHp = maxHpOf(s);
      s.hp = s.maxHp;
      recovered = true;
    }
  }
  s.maxHp = maxHpOf(s);
  if (!s.wound && s.status === STATUS.WOUNDED) s.status = STATUS.HEALTHY;
  s.hp = Math.min(s.maxHp, s.hp + (atMedical ? 22 : 9));
  if (s.status !== STATUS.DEAD && !s.wound && s.hp >= s.maxHp) s.status = STATUS.HEALTHY;
  return recovered;
}

/** Can this soldier be taken on a deployment? */
export function deployable(s) {
  return s.status === STATUS.HEALTHY || (s.status === STATUS.WOUNDED && s.hp > s.maxHp * 0.55);
}

/**
 * Deterministic low-resolution portrait, drawn to a canvas from the soldier's
 * stored seed. Chunky, 5-value palette, deliberately about 24px of real detail
 * — an ID photo taken by a machine that does not care.
 */
export function portrait(s, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const seed = s.portraitSeed;
  const rnd = (i) => {
    const v = Math.sin(seed * 0.0001 + i * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  };
  const P = size / 16;
  g.fillStyle = '#14150f';
  g.fillRect(0, 0, size, size);

  const skins = ['#7a5a40', '#54402e', '#9a7550', '#3f2f22', '#8a6a4a', '#63483400'.slice(0, 7)];
  const skin = skins[Math.floor(rnd(1) * skins.length)];
  const cloth = ['#2f3324', '#3a3628', '#43392b', '#2a2f33'][Math.floor(rnd(2) * 4)];

  // shoulders
  g.fillStyle = cloth;
  g.fillRect(2 * P, 12 * P, 12 * P, 4 * P);
  // neck
  g.fillStyle = skin;
  g.fillRect(6.5 * P, 10.5 * P, 3 * P, 2.5 * P);
  // head
  g.fillRect(4.5 * P, 3.5 * P, 7 * P, 8 * P);
  // jaw shadow
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(4.5 * P, 9.5 * P, 7 * P, 2 * P);

  // headgear varies by role so a roster row is scannable at a glance
  const gearColor = { medic: '#6b3a1f', marksman: '#2a2f33', gunner: '#3a4028' }[s.role] || '#2f3324';
  g.fillStyle = gearColor;
  if (rnd(3) > 0.42) {
    g.fillRect(4 * P, 2.5 * P, 8 * P, 3 * P); // helmet
    g.fillRect(3.5 * P, 5 * P, 9 * P, 1 * P); // brim
  } else {
    g.fillRect(4.5 * P, 3 * P, 7 * P, 2 * P); // cap / wrap
  }
  // eyes — two dark pixels do more character work than anything else here
  g.fillStyle = '#0c0d0a';
  g.fillRect(6 * P, 7 * P, 1.2 * P, 1.2 * P);
  g.fillRect(9 * P, 7 * P, 1.2 * P, 1.2 * P);
  if (rnd(4) > 0.6) { // scar
    g.fillStyle = 'rgba(120,50,40,0.7)';
    g.fillRect(9.6 * P, 5.6 * P, 0.7 * P, 3.4 * P);
  }
  if (rnd(5) > 0.55) { // respirator strap
    g.fillStyle = '#1b1d18';
    g.fillRect(4.5 * P, 8.8 * P, 7 * P, 1.4 * P);
  }
  // rank pips on the shoulder — the commander's ladder runs longer, so clamp
  const pips = Math.min(s.rank, 5);
  const pip = ['#5a5546', '#7d7256', '#9c8a52', '#c2a24e', '#d8b95e', '#e8d08a'][pips];
  g.fillStyle = pip;
  for (let i = 0; i <= pips; i++) g.fillRect((2.4 + i * 1.05) * P, 13 * P, 0.8 * P, 0.8 * P);

  if (s.status === STATUS.DEAD) {
    g.fillStyle = 'rgba(10,10,10,0.62)';
    g.fillRect(0, 0, size, size);
  }
  // scanline overlay ties every portrait to the same bad monitor
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y < size; y += 2) g.fillRect(0, y, size, 1);
  return c.toDataURL();
}

/** The starting company: the commander plus three who signed on with them. */
export function startingCompany(r) {
  const cmd = makeSoldier(r, {
    role: 'rifleman', rank: 0, how: 'Signed the charter', day: 1,
  });
  cmd.isCommander = true;
  // The commander draws the same steel as the line they stand in.
  cmd.weapon = 'sword';
  // The commander keeps a real name. Calling them "You" produced after-action
  // lines like "You is wounded", and a named officer reads better on a roster
  // that is meant to feel like a personnel record.
  cmd.xp = 0;
  // One commander perk to pick before the first deployment: the player decides
  // what kind of officer they are before they decide anything else.
  const opening = offerPerks(r, cmd);
  cmd.pendingPerks = opening.length ? [opening] : null;
  cmd.maxHp = maxHpOf(cmd) + 20;
  cmd.hp = cmd.maxHp;

  const roster = [cmd];
  // A scratch outfit: whoever signed on. Three different backgrounds, so the
  // player meets the origin system before they ever hire anybody.
  const startRoles = ['rifleman', 'rifleman', 'breacher'];
  const hows = ['Signed the charter', 'Deserted the Trust', 'Paid off a debt'];
  const origins = ['free', 'trust', 'scour'];
  for (let i = 0; i < startRoles.length; i++) {
    roster.push(makeSoldier(r, {
      role: startRoles[i], rank: i === 0 ? 1 : 0, how: hows[i], day: 1,
      origin: origins[i],
      avoid: roster.map((x) => x.name),
    }));
  }
  return roster;
}
