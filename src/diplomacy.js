// Standing, allegiance and the politics of the continent.
//
// Three things live here. What the factions think of Bracket, what they think
// of each other, and what happens when the player stops being a contractor and
// becomes a party to the argument — either by swearing to one of them or by
// planting their own flag and inviting both to do something about it.
//
// No Three.js, no DOM: this is simulation the tests can drive headlessly.

import { FACTIONS } from './data.js';

/** Named bands over the raw standing number, and what each one unlocks. */
export const STANDING_TIERS = [
  { at: -1e9, id: 'hated', name: 'Hated', hostile: true, desc: 'Shot on sight.' },
  { at: -22, id: 'enemy', name: 'Enemy', hostile: true, desc: 'Their patrols will engage you.' },
  { at: -9, id: 'disliked', name: 'Disliked', hostile: false, desc: 'Watched, and charged more.' },
  { at: -2, id: 'neutral', name: 'Neutral', hostile: false, desc: 'Just another outfit.' },
  { at: 4, id: 'friendly', name: 'Friendly', hostile: false, desc: 'Better prices, better postings.' },
  { at: 14, id: 'trusted', name: 'Trusted', hostile: false, desc: 'They will offer you a commission.' },
  { at: 30, id: 'sworn', name: 'Sworn', hostile: false, desc: 'You are one of theirs.' },
];

export function standingTier(v) {
  let t = STANDING_TIERS[0];
  for (const s of STANDING_TIERS) if ((v || 0) >= s.at) t = s;
  return t;
}

export const standingOf = (S, factionId) => (S.rep?.[factionId] || 0);
export const standingName = (S, factionId) => standingTier(standingOf(S, factionId)).name;

/** The two organisations that actually hold territory. */
export const MAJOR_FACTIONS = ['trust', 'syndic'];

// --------------------------------------------------------------------------
// Requirements
// --------------------------------------------------------------------------

export const COMMISSION_STANDING = 14;   // "Trusted"
export const COMMISSION_RENOWN = 300;
export const DECLARE_RENOWN = 1200;
export const DECLARE_HOLDINGS = 3;

export function canTakeCommission(S, factionId) {
  if (S.allegiance) return { ok: false, why: `You are already sworn to ${factionName(S, S.allegiance)}.` };
  if (S.ownFaction) return { ok: false, why: 'You lead your own faction.' };
  const st = standingOf(S, factionId);
  if (st < COMMISSION_STANDING) {
    return { ok: false, why: `They do not trust you enough yet (${Math.round(st)}/${COMMISSION_STANDING}).` };
  }
  if ((S.renown || 0) < COMMISSION_RENOWN) {
    return { ok: false, why: `Your name is not big enough yet (${Math.round(S.renown || 0)}/${COMMISSION_RENOWN} renown).` };
  }
  return { ok: true };
}

/**
 * The road to your own banner, as a checklist rather than a locked door.
 *
 * The requirements existed and were enforced, but they were only ever surfaced
 * as a refusal at the moment you tried — so a player growing holdings had no
 * way to know whether they were getting closer to anything. This returns the
 * whole ladder with current values, so the ambition can be shown as progress.
 */
export function ambition(S) {
  const holds = Object.keys(S.holdings || {}).length;
  const renown = Math.round(S.renown || 0);
  return {
    declared: !!S.ownFaction,
    sworn: S.allegiance || null,
    steps: [
      {
        id: 'renown',
        name: 'A name people have heard',
        have: renown, need: DECLARE_RENOWN,
        how: 'Renown comes from contracts, from beating parties in the field, '
          + 'and every day from every place you hold — the more you have built '
          + 'there, the faster it comes.',
      },
      {
        id: 'ground',
        name: 'Ground of your own',
        have: holds, need: DECLARE_HOLDINGS,
        how: 'Take a location by seizing it. Stand on somewhere worth having '
          + 'with a company strong enough to hold it, and the option appears.',
      },
    ],
  };
}

export function canDeclare(S) {
  if (S.ownFaction) return { ok: false, why: 'You have already declared.' };
  const holds = Object.keys(S.holdings || {}).length;
  if ((S.renown || 0) < DECLARE_RENOWN) {
    return { ok: false, why: `Nobody would follow a name this small (${Math.round(S.renown || 0)}/${DECLARE_RENOWN} renown).` };
  }
  if (holds < DECLARE_HOLDINGS) {
    return { ok: false, why: `A faction needs ground. You hold ${holds} of ${DECLARE_HOLDINGS}.` };
  }
  return { ok: true };
}

// --------------------------------------------------------------------------
// Inter-faction relations
// --------------------------------------------------------------------------

const pairKey = (a, b) => [a, b].sort().join(':');

export function relationBetween(S, a, b) {
  if (a === b) return 'self';
  return S.diplomacy?.[pairKey(a, b)]?.state || 'truce';
}

export function setRelation(S, a, b, state, days = 30) {
  S.diplomacy = S.diplomacy || {};
  S.diplomacy[pairKey(a, b)] = { state, until: (S.day || 1) + days };
}

/** Everyone the given faction is currently at war with. */
export function enemiesOf(S, factionId) {
  const all = [...MAJOR_FACTIONS, ...(S.ownFaction ? [S.ownFaction.id] : [])];
  return all.filter((f) => f !== factionId && relationBetween(S, factionId, f) === 'war');
}

/**
 * Is this faction hostile to the player right now? Either because of what they
 * think of Bracket directly, or because Bracket is sworn to — or is — someone
 * they are at war with.
 */
export function isHostileToPlayer(S, factionId) {
  if (!factionId) return false;
  if (S.ownFaction && factionId === S.ownFaction.id) return false;
  if (S.allegiance === factionId) return false;
  if (standingTier(standingOf(S, factionId)).hostile) return true;
  const playerSide = S.ownFaction?.id || S.allegiance;
  if (playerSide && relationBetween(S, factionId, playerSide) === 'war') return true;
  return false;
}

export function factionName(S, id) {
  if (S.ownFaction && id === S.ownFaction.id) return S.ownFaction.name;
  return FACTIONS[id]?.name || id;
}

export function factionColour(S, id) {
  if (S.ownFaction && id === S.ownFaction.id) return S.ownFaction.colour;
  return FACTIONS[id]?.color ?? 0x7a7468;
}

/** Every faction the diplomacy screen should list, player's included. */
export function allFactions(S) {
  const out = MAJOR_FACTIONS.map((id) => ({
    id, name: FACTIONS[id].name, colour: FACTIONS[id].color, npc: true,
  }));
  if (S.ownFaction) {
    out.push({ id: S.ownFaction.id, name: S.ownFaction.name, colour: S.ownFaction.colour, npc: false });
  }
  return out;
}

// --------------------------------------------------------------------------
// Daily tick
// --------------------------------------------------------------------------

/**
 * Relations drift. Wars burn out into truces, truces cool into peace, and
 * peace occasionally collapses again — so the map is never static and the
 * player's standing with one side keeps mattering to the other.
 */
export function tickDiplomacy(S, r, log) {
  S.diplomacy = S.diplomacy || {};
  const factions = allFactions(S).map((f) => f.id);

  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i], b = factions[j];
      const key = pairKey(a, b);
      const cur = S.diplomacy[key] || { state: 'truce', until: S.day + 20 };
      S.diplomacy[key] = cur;
      if (S.day < cur.until) continue;

      const wasWar = cur.state === 'war';
      if (wasWar) {
        cur.state = 'truce';
        cur.until = S.day + 20 + Math.floor(r() * 30);
        log?.(`${factionName(S, a)} and ${factionName(S, b)} have agreed a truce.`, 'world');
      } else if (r() < 0.35) {
        cur.state = 'war';
        cur.until = S.day + 25 + Math.floor(r() * 40);
        log?.(`${factionName(S, a)} and ${factionName(S, b)} are at war.`, 'bad');
      } else {
        cur.state = 'peace';
        cur.until = S.day + 25 + Math.floor(r() * 30);
      }
    }
  }

  // Being sworn to somebody means their quarrels are yours: standing with
  // whoever they are fighting bleeds away whether you like it or not.
  const side = S.ownFaction?.id || S.allegiance;
  if (side) {
    for (const f of enemiesOf(S, side)) {
      if (!MAJOR_FACTIONS.includes(f)) continue;
      S.rep[f] = (S.rep[f] || 0) - 0.6;
    }
  }
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

export function tributeCost(S, factionId) {
  // Buying favour gets steadily more expensive the more of it you have.
  const st = Math.max(0, standingOf(S, factionId));
  return Math.round(300 + st * 45);
}

export function payTribute(S, factionId) {
  const cost = tributeCost(S, factionId);
  if (S.credits < cost) return false;
  S.credits -= cost;
  S.rep[factionId] = (S.rep[factionId] || 0) + 3;
  return true;
}

export function takeCommission(S, factionId) {
  const check = canTakeCommission(S, factionId);
  if (!check.ok) return check;
  S.allegiance = factionId;
  S.allegianceDay = S.day;
  S.rep[factionId] = Math.max(S.rep[factionId] || 0, 30);
  // Their enemies are now yours.
  for (const f of MAJOR_FACTIONS) {
    if (f === factionId) continue;
    setRelation(S, factionId, f, 'war', 40);
    S.rep[f] = Math.min(S.rep[f] || 0, -12);
  }
  return { ok: true };
}

export function breakAllegiance(S) {
  const was = S.allegiance;
  if (!was) return { ok: false, why: 'You are not sworn to anyone.' };
  S.allegiance = null;
  // Oath-breaking is expensive and everyone hears about it.
  S.rep[was] = Math.min(S.rep[was] || 0, -25);
  S.renown = Math.max(0, (S.renown || 0) - 150);
  return { ok: true, was };
}

export function declareFaction(S, name, colour) {
  const check = canDeclare(S);
  if (!check.ok) return check;
  if (S.allegiance) breakAllegiance(S);
  S.ownFaction = {
    id: 'bracket',
    name: (name || 'The Bracket Compact').slice(0, 34),
    colour: colour ?? 0xc08d3f,
    declaredDay: S.day,
  };
  // Both established powers take this exactly as badly as you would expect.
  for (const f of MAJOR_FACTIONS) {
    S.rep[f] = Math.min(S.rep[f] || 0, -18);
    setRelation(S, 'bracket', f, 'war', 45);
  }
  return { ok: true };
}

/** Sue for peace with a faction you are at war with, for money. */
export function suePeaceCost(S, factionId) {
  return Math.round(900 + Math.abs(Math.min(0, standingOf(S, factionId))) * 60);
}

export function suePeace(S, factionId) {
  const side = S.ownFaction?.id || S.allegiance;
  if (!side) return { ok: false, why: 'You are not a party to any war.' };
  if (relationBetween(S, side, factionId) !== 'war') {
    return { ok: false, why: 'You are not at war with them.' };
  }
  const cost = suePeaceCost(S, factionId);
  if (S.credits < cost) return { ok: false, why: 'You cannot cover the indemnity.' };
  S.credits -= cost;
  setRelation(S, side, factionId, 'truce', 30);
  S.rep[factionId] = Math.max(S.rep[factionId] || 0, -6);
  return { ok: true, cost };
}
