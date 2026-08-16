// Interface rendering.
//
// All panels are plain DOM built from the campaign state. Nothing here holds
// its own copy of anything — if a value is on screen it was read from the
// state object this frame, so the UI can never drift out of sync with the
// simulation.

import * as State from './state.js';
import * as Models from './models.js';
import {
  ROLES, RANKS, COMMANDER_RANKS, WEAPONS, KIT, GOODS, GOODS_LIST, FACTIONS, LOCATIONS,
  MISSION_TYPES, HOLDING_UPGRADES, UPGRADE_LIST, PARTY_TIERS, ARMOUR, SLOTS,
} from './data.js';
import {
  portrait, label, rankOf, roleOf, weaponOf, effective, STATUS, woundInfo,
  deployable, choosePerk, awaitingPerk, ladder, armourRating, originOf,
  creedOf, regardTier,
} from './roster.js';
import { SOLDIER_PERKS, COMMANDER_PERKS, perkDef, companyMods } from './perks.js';
import * as Dip from './diplomacy.js';
import * as Audio from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --------------------------------------------------------------------------
// Toasts
// --------------------------------------------------------------------------

let toastTimer = [];

export function toast(title, body, tone = 'info') {
  const wrap = $('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = `${title ? `<div class="tt">${esc(title)}</div>` : ''}<div class="tb">${esc(body)}</div>`;
  wrap.appendChild(el);
  const life = tone === 'kill' ? 1200 : 3400;
  const t = setTimeout(() => el.remove(), life);
  toastTimer.push(t);
  while (wrap.children.length > 4) wrap.firstChild.remove();
}

export function clearToasts() {
  toastTimer.forEach(clearTimeout);
  toastTimer = [];
  const w = $('toasts');
  if (w) w.innerHTML = '';
}

// --------------------------------------------------------------------------
// Modal
// --------------------------------------------------------------------------

let modalOnClose = null;

// True while a panel is up that the player must answer rather than dismiss.
let modalBlocks = false;
export const modalBlocking = () => modalBlocks;

export function modal({ title, tag, body, foot, onClose, wide, blocking }) {
  const ov = $('overlay');
  const m = $('modal');
  m.innerHTML = `
    <div class="modal-head">
      <span class="modal-title">${esc(title)}</span>
      ${tag ? `<span class="modal-tag">${esc(tag)}</span>` : ''}
    </div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  if (wide) m.style.width = 'min(1100px, 95vw)';
  else m.style.width = '';
  ov.classList.remove('hidden');
  modalOnClose = onClose || null;
  // A blocking panel is one the player must answer — a promotion, a choice the
  // campaign cannot proceed without. Escape must not dismiss it, because the
  // caller has usually paused the world on the assumption that it will be
  // answered, and dismissing it leaves the game running with nothing running.
  modalBlocks = !!blocking;
  return m;
}

export function closeModal() {
  $('overlay').classList.add('hidden');
  $('modal').innerHTML = '';
  const cb = modalOnClose;
  modalOnClose = null;
  cb?.();
}

export const modalOpen = () => !$('overlay').classList.contains('hidden');

/**
 * The company screens, as tabs of one window rather than seven separate panels.
 *
 * They were separate modals, which meant that comparing a soldier's kit against
 * what was in the truck was: close, press a key, look, close, press a key. The
 * screens themselves are unchanged — this strip is injected into whichever one
 * is open, so moving between them is one click and never goes via the map.
 *
 * The tab list is deliberately in the order you use them: who you have, what
 * they carry, what you carry, then the wider business of the company. Each tab
 * is named for the screen it opens rather than for the idea behind it, so there
 * is never a moment of translating a tab into a title.
 */
export const COMPANY_TABS = [
  { id: 'roster', name: 'ROSTER', key: 'C' },
  { id: 'loadout', name: 'LOADOUT', key: 'L' },
  { id: 'character', name: 'EQUIPMENT', key: 'V' },
  { id: 'inventory', name: 'STORES', key: 'I' },
  { id: 'holdings', name: 'HOLDINGS', key: 'K' },
  { id: 'board', name: 'CONTRACTS', key: 'B' },
  { id: 'diplomacy', name: 'DIPLOMACY', key: 'P' },
];

export function companyTabs(active, onPick) {
  const head = document.querySelector('#modal .modal-head');
  if (!head || head.querySelector('.mtabs')) return;
  const strip = document.createElement('div');
  strip.className = 'mtabs';
  strip.innerHTML = COMPANY_TABS.map((t) => `<button class="mtab${t.id === active ? ' on' : ''}"
    data-tab="${t.id}" title="${t.key}">${t.name}</button>`).join('');
  head.appendChild(strip);
  for (const b of strip.querySelectorAll('.mtab')) {
    b.onclick = () => {
      if (b.dataset.tab === active) return;
      Audio.uiSelect();
      onPick(b.dataset.tab);
    };
  }
}

// --------------------------------------------------------------------------
// Screens
// --------------------------------------------------------------------------

export function show(which) {
  for (const id of ['loading', 'title', 'worldhud', 'hud']) {
    $(id).classList.toggle('hidden', id !== which);
  }
}

export function showHud(id, on) { $(id).classList.toggle('hidden', !on); }

export function bootProgress(pct, line) {
  $('boot-fill').style.width = `${Math.round(pct * 100)}%`;
  const log = $('boot-log');
  if (line) {
    const d = document.createElement('div');
    d.textContent = line;
    log.appendChild(d);
    while (log.children.length > 6) log.firstChild.remove();
  }
}

// --------------------------------------------------------------------------
// Mission HUD
// --------------------------------------------------------------------------

let radarCtx = null;

export function renderMissionHud(h) {
  // The Titan readout. A single health bar on a machine that shrugs off rifle
  // fire tells the player nothing except that they are losing — what they need
  // is which sections are still armoured and which are open. Rebuilt only when
  // a section changes state, because this sits on top of a firefight.
  // The focus-fire mark. The caret in the world says where; this says who, how
  // hurt they are, and how far — so the player can decide whether to keep the
  // squad on them or call it off.
  // In cover, and whether you are currently hiding behind it or leaning out of
  // it. The player has to be able to tell those apart at a glance, because one
  // of them is safe and the other is the moment they are being shot at.
  const cs = $('cover-state');
  if (cs) {
    cs.classList.toggle('hidden', !h.cover);
    if (h.cover) {
      cs.classList.toggle('out', h.cover === 'leaning');
      $('cover-word').textContent = h.cover === 'leaning' ? 'LEANING OUT' : 'IN COVER';
    }
  }

  const mk = $('mark-hud');
  if (mk) {
    if (!h.marked) mk.classList.add('hidden');
    else {
      mk.classList.remove('hidden');
      $('mk-name').textContent = h.marked.name;
      $('mk-fill').style.width = `${Math.round(h.marked.hp * 100)}%`;
      $('mk-dist').textContent = `${h.marked.dist}m`;
    }
  }

  const th = $('titan-hud');
  if (th) {
    if (!h.titan) th.classList.add('hidden');
    else {
      th.classList.remove('hidden');
      $('th-struct-fill').style.width = `${Math.round(h.titan.structure * 100)}%`;
      const sig = h.titan.plates.map((s) => (s.broken ? 'x' : Math.ceil(s.frac * 8))).join('');
      const host = $('th-plates');
      if (host.dataset.sig !== sig) {
        host.dataset.sig = sig;
        host.innerHTML = h.titan.plates.map((s) => {
          const label = esc(s.id.replace('_', ' '));
          if (s.broken) return `<span class="broken" title="${label} — OPEN"></span>`;
          return `<span title="${label}"><i style="transform:scaleX(${s.frac.toFixed(2)})"></i></span>`;
        }).join('');
      }
    }
  }

  // The crosshair belongs to the player, so it only exists once the player has
  // the camera. During the insertion sweep it is a promise the game is not yet
  // keeping — you cannot shoot where it is pointing, and it moves because the
  // camera is flying itself rather than because you aimed.
  const ret = $('reticle');
  ret.classList.toggle('hidden', !!h.inserting);
  ret.classList.toggle('ads', h.aiming);
  $('hurt').style.opacity = String(h.hurt * 0.85);

  // Where the fire is coming from. One wedge per recent hit, pointing at the
  // shooter and fading over a couple of seconds — so a player who is being shot
  // from behind can tell, and pick a wall accordingly.
  const hd = $('hurt-dirs');
  if (hd) {
    const marks = h.hurtFrom || [];
    if (marks.length !== hd.children.length) {
      hd.innerHTML = marks.map(() => '<i></i>').join('');
    }
    marks.forEach((mk, i) => {
      const el = hd.children[i];
      if (!el) return;
      el.style.transform = `rotate(${(mk.rel * 180) / Math.PI}deg)`;
      el.style.opacity = String(Math.max(0, 1 - mk.age) * 0.9);
    });
  }

  // Objective line — the tag changes so extraction reads as a different state.
  const tag = $('obj-tag');
  if (h.extract) { tag.textContent = 'EXTRACT'; tag.className = 'obj-tag extract'; }
  else if (h.wave?.active) { tag.textContent = 'HOLD'; tag.className = 'obj-tag hold'; }
  else { tag.textContent = 'OBJECTIVE'; tag.className = 'obj-tag'; }

  $('obj-text').textContent = h.extract ? 'Reach the extraction point' : h.objective;

  let sub = '';
  let urgent = false;
  if (h.timer !== null && h.timer !== undefined) {
    sub = `CHARGES LIVE — ${h.timer.toFixed(0)}s`;
    urgent = true;
  } else if (h.extract) {
    sub = h.extractBlocked ? h.extractBlocked.toUpperCase() : `${h.extractDist.toFixed(0)} M TO EXTRACTION`;
    urgent = !!h.extractBlocked;
  } else if (h.wave) {
    sub = h.wave.active
      ? `WAVE ${h.wave.n} OF ${h.wave.of} — ${h.enemiesVisible} CONTACTS`
      : `NEXT WAVE IN ${h.wave.next.toFixed(0)}s`;
    urgent = h.wave.active;
  } else if (h.seize) {
    sub = h.seize.contested ? 'POSITION CONTESTED — CLEAR THEM OUT'
      : `HOLDING — ${h.seize.pct}%`;
    urgent = h.seize.contested;
  } else if (h.objNeed > 1) {
    sub = `${h.objProgress} OF ${h.objNeed}`;
  }
  const subEl = $('obj-sub');
  subEl.textContent = sub;
  subEl.className = `obj-sub${urgent ? ' urgent' : ''}`;

  // Squad panel: who they are, what they are doing, and how pinned they are.
  const sq = $('hud-squad');
  const rows = h.squad.map((s) => {
    const cls = [
      s.dead ? 'dead' : s.down ? 'down' : s.isPlayer ? 'player' : '',
      s.selected ? 'selected' : '',
    ].join(' ');
    const pct = Math.round((s.hp / Math.max(1, s.maxHp)) * 100);
    const table = s.isCommander ? COMMANDER_RANKS : RANKS;
    const rk = s.rank >= 0 ? (table[s.rank]?.abbr || '--') : 'MIL';
    const act = s.dead ? 'KIA'
      : (s.down && !s.stabilised) ? `${Math.ceil(s.bleed * 55)}s`
        : s.action;
    const hot = ['SUPPRESS', 'FLANKING', 'ENGAGING'].includes(act);
    const bad = ['PINNED', 'DOWN', 'KIA', 'FALLBACK'].includes(act) || /^\d+s$/.test(act);
    return `<div class="sq ${cls}">
      ${s.slot ? `<span class="sq-slot">${s.slot}</span>` : '<span class="sq-slot">&middot;</span>'}
      <span class="sq-rank">${rk}</span>
      <span class="sq-name">${esc(s.isPlayer ? 'COMMANDER' : s.name)}</span>
      <span class="sq-bar"><i style="width:${pct}%"></i></span>
      <span class="sq-act ${hot ? 'hot' : ''} ${bad ? 'bad' : ''}">${esc(act)}</span>
      ${s.suppression > 0.05
        ? `<i class="sq-sup" style="width:${Math.round(s.suppression * 100)}%"></i>` : ''}
    </div>`;
  }).join('');
  if (sq.dataset.sig !== rows) { sq.innerHTML = rows; sq.dataset.sig = rows; }
  sq.classList.toggle('dense', h.squad.length > 8);

  // Who the next order will go to.
  const selEl = $('ord-sel');
  selEl.textContent = (h.selectionCount ? h.selectionLabel : 'SQUAD')
    + (h.formation ? ` · ${h.formation}` : '');
  selEl.classList.toggle('narrow', h.selectionCount > 0);

  // Player suppression: the screen closes in as rounds land nearby.
  // Strong enough to feel, weak enough to still fight through.
  $('suppress-vig').style.opacity = String(Math.min(0.55, (h.suppression || 0) * 0.62));

  // Weapon
  $('w-name').textContent = h.weapon;
  $('w-cur').textContent = h.ammo;
  $('w-mag').textContent = h.mag;
  $('w-cur').parentElement.classList.toggle('low', h.ammo <= h.mag * 0.25);
  $('w-state').textContent = h.reloading ? 'RELOADING' : (h.ammo === 0 ? 'EMPTY — R' : '');

  // Vitals
  const vp = Math.max(0, Math.round((h.hp / Math.max(1, h.maxHp)) * 100));
  const vf = $('v-fill');
  vf.style.width = `${vp}%`;
  vf.className = vp < 30 ? 'crit' : vp < 65 ? 'hurt' : '';

  // Order highlight
  for (const el of document.querySelectorAll('#hud-orders .ord')) {
    const o = el.dataset.o;
    const on = h.squadOrder === o || (o === 'move' && h.squadOrder === 'attack');
    el.classList.toggle('on', on);
  }

  // Aim reticle blooms when the player is suppressed.
  $('reticle').style.transform =
    `translate(-50%, -50%) scale(${(1 + (h.suppression || 0) * 1.6).toFixed(2)})`;

  // Interaction prompt
  const ip = $('hud-interact');
  if (h.interact) {
    ip.classList.remove('hidden');
    const noKits = h.interact.needsKit && h.interact.kits <= 0;
    $('int-label').textContent = noKits
      ? 'NO MEDICAL KITS REMAINING'
      : h.interact.label + (h.interact.needsKit ? ` (${h.interact.kits} kits)` : '');
    $('int-fill').style.width = `${Math.round(h.interact.progress * 100)}%`;
  } else {
    ip.classList.add('hidden');
  }

  drawRadar(h);
}

function drawRadar(h) {
  const c = $('radar');
  if (!c) return;
  if (!radarCtx) radarCtx = c.getContext('2d');
  const g = radarCtx;
  const S = c.width, R = S / 2;
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#0b0c08';
  g.fillRect(0, 0, S, S);

  // Rings and cross — a piece of equipment, not a minimap.
  g.strokeStyle = '#242519';
  g.lineWidth = 1;
  for (const r of [R * 0.34, R * 0.67, R - 2]) {
    g.beginPath(); g.arc(R, R, r, 0, 6.29); g.stroke();
  }
  g.beginPath(); g.moveTo(R, 2); g.lineTo(R, S - 2); g.moveTo(2, R); g.lineTo(S - 2, R); g.stroke();

  const scale = (R - 4) / 55;
  const ca = Math.cos(-h.compass), sa = Math.sin(-h.compass);
  for (const ct of h.contacts) {
    // Rotate into player-facing space so "up" is always where you are looking.
    const rx = ct.dx * ca - ct.dz * sa;
    const rz = ct.dx * sa + ct.dz * ca;
    const px = R + rx * scale, py = R + rz * scale;
    if (ct.isPlayer) continue;
    g.fillStyle = ct.side === 'enemy' ? (ct.down ? '#4a2018' : '#b04a30')
      : ct.side === 'civil' ? '#8a8163' : (ct.down ? '#7a5a20' : '#8a9a52');
    const sz = ct.down ? 2 : 3;
    g.fillRect(px - sz / 2, py - sz / 2, sz, sz);
  }
  // Player wedge
  g.fillStyle = '#c08d3f';
  g.beginPath();
  g.moveTo(R, R - 5); g.lineTo(R - 3.5, R + 3.5); g.lineTo(R + 3.5, R + 3.5);
  g.closePath(); g.fill();

  $('radar-lbl').textContent = `CONTACTS ${h.enemiesVisible}`;
}

// --------------------------------------------------------------------------
// Deployment cinematic
// --------------------------------------------------------------------------

/**
 * Runs alongside the mission's camera fly-in: cut from black, letterbox in,
 * briefing card, then retract as control is handed over. Purely presentational
 * — the mission layer owns the timing and the grace period.
 */
export function missionIntro(info, dur = 6.0) {
  const el = $('cine');
  if (!el) return;
  el.classList.remove('hidden', 'closing', 'lit');
  $('cc-site').textContent = info.site;
  $('cc-type').textContent = info.type.toUpperCase();
  $('cc-obj').textContent = info.objective;
  $('cc-squad').innerHTML = info.squad
    .map((s) => `<b>${esc(s.name)}</b> <span>${esc(s.role)}</span>`).join('<br>');

  // Next frame, so the transitions actually run.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('lit')));
  // Retract just before control returns so the handover feels continuous.
  setTimeout(() => el.classList.add('closing'), Math.max(0, dur * 1000 - 900));
  setTimeout(() => el.classList.add('hidden'), dur * 1000 + 400);
}

export function hideMissionIntro() {
  const el = $('cine');
  if (el) el.classList.add('hidden');
}

// --------------------------------------------------------------------------
// Command wheel
// --------------------------------------------------------------------------

/**
 * Draw the radial order menu. Called with a state object while the wheel is
 * held open and with null when it closes.
 *
 * The sectors are laid out with index 0 straight up and running clockwise, to
 * match the angle the mission computes from mouse travel — if these two ever
 * disagree the player picks one order and gets another, which is worse than
 * having no wheel at all.
 */
export function renderCommandWheel(w) {
  const host = $('wheel');
  if (!host) return;
  if (!w) { host.classList.add('hidden'); host.dataset.sig = ''; return; }
  host.classList.remove('hidden');

  const n = w.orders.length;
  const svg = $('wheel-svg');
  const sig = `${n}|${w.index}|${w.count}`;
  if (host.dataset.sig !== sig) {
    host.dataset.sig = sig;
    const R0 = 52, R1 = 148;
    const seg = (Math.PI * 2) / n;
    const parts = [];
    for (let i = 0; i < n; i++) {
      // Centre each sector on its index, so the boundary falls halfway between.
      const a0 = -Math.PI / 2 + (i - 0.5) * seg + 0.028;
      const a1 = -Math.PI / 2 + (i + 0.5) * seg - 0.028;
      const pt = (r, a) => `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
      const big = seg > Math.PI ? 1 : 0;
      const d = `M ${pt(R0, a0)} L ${pt(R1, a0)} A ${R1} ${R1} 0 ${big} 1 ${pt(R1, a1)}`
        + ` L ${pt(R0, a1)} A ${R0} ${R0} 0 ${big} 0 ${pt(R0, a0)} Z`;
      const am = (a0 + a1) / 2;
      const lx = (Math.cos(am) * 103).toFixed(1);
      const ly = (Math.sin(am) * 103).toFixed(1);
      const kx = (Math.cos(am) * 128).toFixed(1);
      const ky = (Math.sin(am) * 128).toFixed(1);
      const state = w.index === i ? 'on' : (w.index === -1 ? '' : 'off');
      parts.push(`<path class="sector ${state}" d="${d}"></path>`
        + `<text class="slabel" x="${lx}" y="${ly}">${esc(w.orders[i].name)}</text>`
        + `<text class="skey" x="${kx}" y="${ky}">${esc(w.orders[i].key)}</text>`);
    }
    svg.innerHTML = parts.join('');
  }

  const pick = w.index >= 0 ? w.orders[w.index] : null;
  $('wheel-who').textContent = `${w.who} · ${w.count} UNDER COMMAND`;
  $('wheel-pick').textContent = pick ? pick.name : 'NO ORDER';
  $('wheel-desc').textContent = pick ? pick.desc : 'Release to cancel.';
}

// --------------------------------------------------------------------------
// World HUD
// --------------------------------------------------------------------------

export function renderWorldHud(h) {
  $('wh-day').textContent = h.day;
  $('wh-time').textContent = `${String(Math.floor(h.hour)).padStart(2, '0')}:${String(Math.floor((h.hour % 1) * 60)).padStart(2, '0')}`;
  // Which of halt / travel / fast is lit. A modal counts as halted, because to
  // the player it is: the clock is not moving while they are reading.
  for (const b of $('wh-spd').children) {
    b.classList.toggle('on', Number(b.dataset.spd) === (h.speed ?? 1));
  }
  $('wh-cred').textContent = h.credits;
  $('wh-sup').textContent = h.supplies;
  $('wh-med').textContent = h.medical;
  $('wh-ready').textContent = h.ready;
  const wEl = $('wh-wound');
  wEl.textContent = h.wounded;
  wEl.className = h.wounded ? 'val warn' : 'val';
  $('wh-renown').textContent = Math.round(h.renown || 0);

  // Payroll, food and morale. Coloured rather than merely printed, because the
  // moment any of them goes wrong the player needs to see it without reading.
  const pay = $('wh-payroll');
  pay.textContent = h.payroll ?? 0;
  pay.className = h.unpaidDays > 0 ? 'val bad' : 'val';
  const rat = $('wh-rations');
  rat.textContent = `${h.rations ?? 0}d`;
  rat.className = (h.rations ?? 0) <= 0 ? 'val bad' : ((h.rations ?? 0) <= 3 ? 'val warn' : 'val');
  const mor = $('wh-morale');
  mor.textContent = h.moraleTier || '—';
  mor.className = h.morale < 25 ? 'val bad' : (h.morale < 45 ? 'val warn' : 'val');
  mor.title = `Morale ${h.morale}/100`;
  // Pace, with the reasons in the tooltip — a number that drops without saying
  // why is just a mystery.
  const pace = $('wh-pace');
  if (pace && h.pace) {
    pace.textContent = `${Math.round(h.pace.mul * 100)}%`;
    pace.className = h.pace.mul < 0.75 ? 'val warn' : (h.pace.mul > 1 ? 'val good' : 'val');
    pace.title = h.pace.factors.length
      ? h.pace.factors.map((f) => `${f.effect > 0 ? '+' : ''}${Math.round(f.effect * 100)}% ${f.label}`).join('\n')
      : 'Travelling light.';
  }
  const banner = $('wh-banner');
  banner.textContent = h.ownFaction ? h.ownFaction.name
    : (h.allegiance ? FACTIONS[h.allegiance].short : 'Independent');
  banner.style.color = h.ownFaction
    ? `#${(h.ownFaction.colour ?? 0xc08d3f).toString(16).padStart(6, '0')}`
    : '';
  $('wh-rep-t').textContent = fmtRep(h.rep.trust);
  $('wh-rep-s').textContent = fmtRep(h.rep.syndic);

  // Active contract
  const cEl = $('wh-contract');
  if (h.contract) {
    cEl.classList.remove('hidden');
    cEl.innerHTML = `<div class="panel-title">ACTIVE CONTRACT</div>
      <div class="panel-body"><em>${esc(h.contract.title)}</em><br>
      Site: ${esc(State.locName(h.contract.site))}<br>
      Pay: ${h.contract.pay} &middot; Expires day ${h.contract.expiresDay}</div>`;
  } else cEl.classList.add('hidden');

  // Somebody out there is carrying your things. Shown with a countdown, because
  // the deadline is the whole reason it is a hunt rather than an errand.
  const gEl = $('wh-grudge');
  if (h.grudge) {
    gEl.classList.remove('hidden');
    const left = h.grudge.daysLeft;
    gEl.innerHTML = `<div class="panel-title bad">TAKEN FROM BRACKET</div>
      <div class="panel-body"><em>${esc(h.grudge.who)}</em> has
      ${h.grudge.credits} credits${h.grudge.arms
    ? ` and ${h.grudge.arms} weapon${h.grudge.arms === 1 ? '' : 's'}` : ''}<br>
      <span class="${left <= 10 ? 'bad' : 'dim'}">${left <= 0 ? 'The trail is cold'
    : `${left} days before it is spent`}</span></div>`;
  } else gEl.classList.add('hidden');

  // Location panel + enter button
  const lEl = $('wh-loc');
  const btn = $('wh-enter');
  if (h.location) {
    lEl.classList.remove('hidden');
    const f = h.location.faction ? FACTIONS[h.location.faction] : null;
    lEl.innerHTML = `<div class="panel-title">${esc(h.location.name)}</div>
      <div class="panel-body">
        <span class="tag ${h.location.faction || 'none'}">${f ? esc(f.short) : 'UNALIGNED'}</span>
        <div style="margin-top:7px">${esc(h.location.blurb)}</div>
      </div>`;
    btn.disabled = false;
    btn.innerHTML = `ENTER ${h.location.name.toUpperCase()} <kbd>E</kbd>`;
  } else {
    lEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = 'ENTER <kbd>E</kbd>';
  }

  // Territory legend. Rebuilt only when the holdings change, because it is
  // otherwise identical every frame.
  const leg = $('wh-legend');
  if (leg) {
    const swatch = (hex, name, note) => `<div class="leg-row">
      <span class="leg-sw" style="background:#${hex.toString(16).padStart(6, '0')}"></span>
      <span class="leg-name">${esc(name)}</span>
      <span class="leg-note">${esc(note)}</span></div>`;
    const yours = h.ownFaction?.name || 'Bracket';
    const html = '<div class="panel-title">TERRITORY</div>'
      + swatch(0x3fb8c4, FACTIONS.trust.short, `${h.tiles?.trust ?? 0} holdings`)
      + swatch(0xd8434f, FACTIONS.syndic.short, `${h.tiles?.syndic ?? 0} holdings`)
      + swatch(h.ownFaction?.colour ?? 0xc08d3f, yours.toUpperCase(),
        `${h.tiles?.player ?? 0} holdings`)
      + '<div class="leg-row"><span class="leg-sw none"></span>'
      + '<span class="leg-name">UNCLAIMED</span>'
      + '<span class="leg-note">no writ runs here</span></div>';
    if (leg.dataset.sig !== html) { leg.innerHTML = html; leg.dataset.sig = html; }
  }

  // Log
  const lg = $('wh-log');
  const html = `<div class="panel-title">COMPANY LOG</div>` + (h.log.slice(0, 9).map((l) =>
    `<div class="log-line ${l.tone}"><span class="t">D${l.day}</span>${esc(l.text)}</div>`).join('') || '<div class="empty">NO ENTRIES</div>');
  if (lg.dataset.sig !== html) { lg.innerHTML = html; lg.dataset.sig = html; }
}

const fmtRep = (v) => (v > 0 ? `+${v}` : String(v || 0));

// --------------------------------------------------------------------------
// Company / roster panel
// --------------------------------------------------------------------------

export function rosterPanel(S, cbs) {
  const { onClose } = cbs;
  const live = State.living(S);
  const dead = State.fallen(S);
  const body = `
    <div class="section-title">ACTIVE PERSONNEL — ${live.length}</div>
    <div class="roster-grid">${live.map((s) => solRow(s)).join('')}</div>
    ${dead.length ? `<div class="section-title">KILLED IN ACTION — ${dead.length}</div>
      <div class="roster-grid">${dead.map((s) => solRow(s)).join('')}</div>` : ''}
    ${(S.prisoners || []).length ? `<div class="section-title">PRISONERS — ${S.prisoners.length}</div>
      <div class="prose dim" style="margin-bottom:6px">
        Press them into the company and they serve resentfully — it costs morale,
        and a company built out of prisoners is a company that deserts. Ransom
        them back to their own people and they pay, and resent paying. Sell them
        to a broker in a market town and they pay far better, and it is worse in
        every other way. Let them go for nothing and the goodwill comes back.
      </div>
      <div class="pris-list">${S.prisoners.map((p) => `<div class="pris">
        <img src="${portrait(p, 40)}" class="pris-face">
        <div class="pris-who">
          <div class="pris-name">${esc(p.name)}</div>
          <div class="pris-meta">${RANKS[p.rank].abbr} ${ROLES[p.role].name.toUpperCase()}
            ${p.captiveFaction ? `&middot; ${esc(FACTIONS[p.captiveFaction].short)}` : ''}</div>
        </div>
        <button class="btn" data-press="${p.id}">PRESS</button>
        <button class="btn" data-ransom="${p.id}">RANSOM ${State.ransomValue(S, p)}</button>
        <button class="btn" data-release="${p.id}">RELEASE</button>
      </div>`).join('')}</div>` : ''}

    <div class="section-title">COMPANY</div>
    <div class="stat-row">
      <div class="s"><span class="n">${S.stats.missions}</span><span class="l">DEPLOYMENTS</span></div>
      <div class="s"><span class="n">${S.stats.kills}</span><span class="l">CONFIRMED</span></div>
      <div class="s"><span class="n">${S.stats.recruited}</span><span class="l">RECRUITED</span></div>
      <div class="s"><span class="n">${S.stats.lost}</span><span class="l">LOST</span></div>
      <div class="s"><span class="n">${S.credits}</span><span class="l">CREDITS</span></div>
      <div class="s"><span class="n">${State.payrollOf(S)}</span><span class="l">WAGES/DAY</span></div>
      <div class="s"><span class="n">${S.rations || 0}</span><span class="l">DAYS FOOD</span></div>
      <div class="s"><span class="n">${State.moraleTier(S).name}</span><span class="l">MORALE</span>
    </div>
      ${S.stats.caravansLost ? `<div class="s"><span class="n">${S.stats.caravansLost}</span><span class="l">CARAVANS LOST</span></div>` : ''}
    </div>
    <div class="prose dim">${esc(State.moraleTier(S).note)}
      ${S.unpaidDays > 0 ? `<span style="color:var(--bad)">Unpaid for ${S.unpaidDays} day(s).</span>` : ''}</div>
    <div class="section-title">ARMOURY</div>
    <div class="prose">${State.armouryList(S).map((a) => `<span class="hl">${esc(a.def.name)}</span> ×${a.n}`).join(' &middot; ') || '<span class="dim">Nothing spare.</span>'}</div>
    <div class="prose" style="margin-top:6px">${State.kitList(S).map((k) => `<span class="hl">${esc(k.def.name)}</span> ×${k.n}`).join(' &middot; ') || '<span class="dim">No spare kit.</span>'}</div>`;

  modal({
    title: 'BRACKET — COMPANY ROSTER',
    tag: `DAY ${S.day}`,
    body,
    foot: `<span class="spacer">Soldiers persist. Wounds heal with time; the dead do not return.</span>
      <button class="btn" data-x="loadout">LOADOUT</button>
      <button class="btn" data-x="close">CLOSE</button>`,
    onClose,
    wide: true,
  });
  // What to do with the people you took off the road.
  const again = () => rosterPanel(S, cbs);
  for (const el of document.querySelectorAll('#modal [data-press]')) {
    el.onclick = () => {
      if (State.pressPrisoner(S, el.dataset.press)) { Audio.uiSelect(); again(); }
      else Audio.uiDeny();
    };
  }
  for (const el of document.querySelectorAll('#modal [data-ransom]')) {
    el.onclick = () => {
      if (State.ransomPrisoner(S, el.dataset.ransom)) { Audio.uiSelect(); again(); }
      else Audio.uiDeny();
    };
  }
  for (const el of document.querySelectorAll('#modal [data-release]')) {
    el.onclick = () => {
      if (State.releasePrisoner(S, el.dataset.release)) { Audio.uiMove(); again(); }
      else Audio.uiDeny();
    };
  }
  wire({ close: onCloseWrap(onClose), loadout: cbs?.onLoadout || (() => {}) });
}

// --------------------------------------------------------------------------
// Perk selection — the moment a soldier becomes a particular soldier
// --------------------------------------------------------------------------

export function perkPanel(S, soldier, { onDone }) {
  const offer = soldier.pendingPerks?.[0] || [];
  const rk = rankOf(soldier);
  const isCmd = !!soldier.isCommander;

  const body = `
    <div class="two-col" style="grid-template-columns: 200px 1fr">
      <div style="text-align:center">
        <img src="${portrait(soldier, 96)}" style="width:96px;height:96px;image-rendering:pixelated;border:1px solid #2c2d23">
        <div style="margin-top:8px;font-size:14px;color:var(--bone)">${esc(soldier.name)}</div>
        <div class="dim" style="font-size:10px;letter-spacing:0.16em;margin-top:3px">
          ${rk.name.toUpperCase()} &middot; ${ROLES[soldier.role].name.toUpperCase()}
        </div>
        ${soldier.perks?.length ? `<div style="margin-top:12px;text-align:left">
          <div class="section-title">ALREADY TRAINED</div>
          ${soldier.perks.map((p) => `<div style="font-size:11px;color:var(--text);padding:2px 0">
            &middot; ${esc(perkDef(p)?.name || p)}</div>`).join('')}
        </div>` : ''}
      </div>
      <div>
        <div class="prose">${isCmd
    ? (soldier.rank === 0
      ? 'Bracket is yours. How you intend to run it decides what the company becomes — this applies to everyone under your command.'
      : 'You have been promoted. Choose how you intend to run this company — it applies to everyone under you.')
    : `${esc(soldier.name)} has earned a promotion. Choose what they train into. This is permanent.`}</div>
        <div class="section-title">SELECT ONE</div>
        ${offer.map((id) => {
    const p = perkDef(id);
    return `<div class="card perk-card" data-perk="${id}">
            <div class="card-top"><span class="card-title">${esc(p.name)}</span></div>
            <div class="card-text">${esc(p.desc)}</div>
          </div>`;
  }).join('')}
      </div>
    </div>`;

  modal({
    title: isCmd ? 'COMMISSION' : 'PROMOTION',
    tag: rk.name.toUpperCase(),
    body,
    foot: '<span class="spacer">Training choices cannot be changed later.</span>',
    onClose: null,
    wide: true,
    // There is no way out of this panel but to choose, and the caller has
    // paused the world waiting for an answer — so Escape must not dismiss it.
    // It did, which left the campaign paused for ever with the promotion still
    // outstanding: the game looked frozen, and every click after that went to a
    // world that was no longer running.
    blocking: true,
  });

  for (const el of document.querySelectorAll('#modal [data-perk]')) {
    el.onclick = () => {
      if (choosePerk(soldier, el.dataset.perk)) {
        Audio.uiSelect();
        onDone();
      } else Audio.uiDeny();
    };
  }
}

/** Walk every soldier with an outstanding promotion, one panel at a time. */
export function resolvePendingPerks(S, done) {
  const next = awaitingPerk(S.roster)[0];
  if (!next) { done(); return; }
  perkPanel(S, next, { onDone: () => resolvePendingPerks(S, done) });
}

// --------------------------------------------------------------------------
// Diplomacy — where the company stands, and whose side it is on
// --------------------------------------------------------------------------

const REL_LABEL = { war: 'AT WAR', truce: 'TRUCE', peace: 'AT PEACE', self: '—' };

/**
 * The road to your own banner, drawn as a ladder you can watch yourself climb.
 *
 * Before this, the requirements only ever appeared as a refusal at the moment
 * you tried to declare — so a player spending twenty days growing a holding had
 * no way to tell whether any of it was working. Each step shows what it wants,
 * what you have, and what actually moves the number.
 */
const ambitionLadder = (S) => {
  const a = Dip.ambition(S);
  if (a.declared) return '';
  return `<div class="ladder">
    ${a.steps.map((s) => {
      const done = s.have >= s.need;
      const pct = Math.min(100, Math.round((s.have / s.need) * 100));
      return `<div class="lad-step ${done ? 'done' : ''}">
        <div class="lad-top">
          <span class="lad-mark">${done ? '&#10003;' : ''}</span>
          <span class="lad-name">${esc(s.name)}</span>
          <span class="lad-num">${s.have} / ${s.need}</span>
        </div>
        <div class="lad-bar"><i style="width:${pct}%"></i></div>
        <div class="lad-how">${esc(s.how)}</div>
      </div>`;
    }).join('')}
  </div>`;
};

export function diplomacyPanel(S, cbs) {
  const factions = Dip.allFactions(S);
  const side = S.ownFaction?.id || S.allegiance;

  const standingRows = Dip.MAJOR_FACTIONS.map((id) => {
    const f = FACTIONS[id];
    const v = Dip.standingOf(S, id);
    const tier = Dip.standingTier(v);
    const pct = Math.round(((clampN(v, -40, 40) + 40) / 80) * 100);
    const commission = Dip.canTakeCommission(S, id);
    const atWar = side && Dip.relationBetween(S, side, id) === 'war';
    return `<div class="dip-card">
      <div class="dip-head">
        <span class="dip-name" style="color:#${f.color.toString(16).padStart(6, '0')}">${esc(f.name)}</span>
        <span class="dip-tier ${tier.id}">${tier.name.toUpperCase()}</span>
        ${S.allegiance === id ? '<span class="dip-flag">YOUR LIEGE</span>' : ''}
        ${atWar ? '<span class="dip-flag war">AT WAR WITH YOU</span>' : ''}
      </div>
      <div class="dip-bar"><i style="width:${pct}%" class="${tier.id}"></i><b style="left:50%"></b></div>
      <div class="dip-desc">${esc(tier.desc)} <span class="dim">Standing ${Math.round(v)}.</span></div>
      <div class="dip-doctrine">${esc(f.doctrine)}</div>
      <div class="dip-actions">
        <button class="btn" data-tribute="${id}" ${S.credits >= Dip.tributeCost(S, id) ? '' : 'disabled'}>
          TRIBUTE — ${Dip.tributeCost(S, id)} CR</button>
        ${atWar ? `<button class="btn" data-peace="${id}" ${S.credits >= Dip.suePeaceCost(S, id) ? '' : 'disabled'}>
          SUE FOR PEACE — ${Dip.suePeaceCost(S, id)} CR</button>` : ''}
        ${!S.allegiance && !S.ownFaction ? `<button class="btn ${commission.ok ? 'btn-warn' : ''}"
          data-join="${id}" ${commission.ok ? '' : 'disabled'} title="${esc(commission.why || '')}">
          TAKE COMMISSION</button>` : ''}
      </div>
      ${!commission.ok && !S.allegiance && !S.ownFaction
    ? `<div class="dip-why">${esc(commission.why)}</div>` : ''}
    </div>`;
  }).join('');

  // Who is fighting whom, including the player once they are a power.
  const pairs = [];
  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i], b = factions[j];
      const rel = Dip.relationBetween(S, a.id, b.id);
      pairs.push(`<div class="rel-row">
        <span class="rel-a">${esc(a.name)}</span>
        <span class="rel-state ${rel}">${REL_LABEL[rel] || rel.toUpperCase()}</span>
        <span class="rel-b">${esc(b.name)}</span>
      </div>`);
    }
  }

  const declare = Dip.canDeclare(S);
  const holds = Object.keys(S.holdings || {}).length;

  const body = `
    <div class="dip-status">
      <div><span class="lbl">RENOWN</span><span class="val">${Math.round(S.renown || 0)}</span>
        <span class="dim">${esc(State.renownName(S))}</span></div>
      <div><span class="lbl">HOLDINGS</span><span class="val">${holds}</span></div>
      <div><span class="lbl">ALLEGIANCE</span><span class="val">${
  S.ownFaction ? esc(S.ownFaction.name) : (S.allegiance ? esc(FACTIONS[S.allegiance].name) : 'Independent')
}</span></div>
    </div>

    <div class="section-title">STANDING</div>
    <div class="dip-grid">${standingRows}</div>

    <div class="section-title">THE CONTINENT</div>
    <div class="rel-list">${pairs.join('')}</div>

    <div class="section-title">YOUR BANNER</div>
    ${S.ownFaction ? `<div class="prose">
        Bracket flies its own colours as <span class="hl">${esc(S.ownFaction.name)}</span>,
        declared on day ${S.ownFaction.declaredDay}. Both established powers regard you
        as a rival, and your holdings are under permanent pressure because of it.
      </div>`
    : `<div class="prose">
        A company with enough ground and enough name behind it can stop working for
        other people and start being a power in its own right. Both the Trust and the
        Syndics will take that very badly.
      </div>
      ${ambitionLadder(S)}
      <div class="prose ${declare.ok ? '' : 'dim'}">
        ${declare.ok ? 'You have the renown and the ground. You can declare.' : esc(declare.why)}
      </div>
      ${declare.ok ? `<div class="declare-box">
        <input id="fac-name" class="fac-input" maxlength="34" placeholder="Name your faction"
          value="The Bracket Compact">
        <button class="btn btn-major btn-warn" data-x="declare">DECLARE INDEPENDENCE</button>
      </div>` : ''}`}

    ${S.allegiance ? `<div class="section-title">SERVICE</div>
      <div class="prose">You are sworn to <span class="hl">${esc(FACTIONS[S.allegiance].name)}</span>
      since day ${S.allegianceDay}. Their wars are yours.</div>
      <button class="btn btn-warn" data-x="break">BREAK YOUR OATH</button>
      <div class="dip-why">Oath-breaking costs renown and makes a permanent enemy.</div>` : ''}`;

  modal({
    title: 'DIPLOMACY',
    tag: `DAY ${S.day}`,
    body,
    foot: `<span class="spacer">Standing rises with contracts and tribute, and falls when you take their ground.</span>
      <button class="btn" data-x="close">CLOSE</button>`,
    onClose: cbs.onClose,
    wide: true,
  });

  const again = () => diplomacyPanel(S, cbs);
  for (const el of document.querySelectorAll('#modal [data-tribute]')) {
    el.onclick = () => {
      if (Dip.payTribute(S, el.dataset.tribute)) {
        State.pushLog(S, `Paid tribute to ${FACTIONS[el.dataset.tribute].name}.`);
        Audio.uiSelect(); again();
      } else Audio.uiDeny();
    };
  }
  for (const el of document.querySelectorAll('#modal [data-peace]')) {
    el.onclick = () => {
      const res = Dip.suePeace(S, el.dataset.peace);
      if (res.ok) {
        State.pushLog(S, `Bought a truce with ${FACTIONS[el.dataset.peace].name} for ${res.cost}.`, 'good');
        State.refreshHostility(S);
        Audio.uiSelect(); again();
      } else { Audio.uiDeny(); toastModal(res.why || 'Refused'); }
    };
  }
  for (const el of document.querySelectorAll('#modal [data-join]')) {
    el.onclick = () => {
      const id = el.dataset.join;
      const res = Dip.takeCommission(S, id);
      if (res.ok) {
        State.pushLog(S, `Bracket has taken a commission with ${FACTIONS[id].name}.`, 'world');
        State.refreshHostility(S);
        Audio.uiSelect();
        oathPanel(S, FACTIONS[id].name, () => again());
      } else { Audio.uiDeny(); toastModal(res.why); }
    };
  }
  wire({
    close: onCloseWrap(cbs.onClose),
    break: () => {
      const res = Dip.breakAllegiance(S);
      if (res.ok) {
        State.pushLog(S, `Bracket has broken its oath to ${FACTIONS[res.was].name}.`, 'bad');
        State.breakOathReaction(S);
        State.refreshHostility(S);
      }
      again();
    },
    declare: () => {
      const nameEl = $('fac-name');
      const res = Dip.declareFaction(S, nameEl?.value || 'The Bracket Compact');
      if (res.ok) {
        State.pushLog(S, `${S.ownFaction.name} has been declared.`, 'world');
        State.refreshHostility(S);
        Audio.deployTone();
        declarePanel(S, () => again());
      } else { Audio.uiDeny(); toastModal(res.why); }
    },
  });
}

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function oathPanel(S, name, done) {
  modal({
    title: 'COMMISSION',
    tag: `DAY ${S.day}`,
    body: `<div class="prose">
      Bracket is sworn to <span class="hl">${esc(name)}</span>.
      </div>
      <div class="prose">
      Their postings are yours to take, their enemies are yours to fight, and their
      enemies now know it. Your holdings sit under their protection, which is worth
      something — and their quarrels will find you whether you seek them or not.
      </div>`,
    foot: '<button class="btn btn-major" data-x="close">UNDERSTOOD</button>',
    onClose: null,
  });
  wire({ close: () => done() });
}

function declarePanel(S, done) {
  modal({
    title: 'INDEPENDENCE',
    tag: `DAY ${S.day}`,
    body: `<div class="prose" style="font-size:15px;color:var(--bone)">
      ${esc(S.ownFaction.name)} flies its own colours.
      </div>
      <div class="prose">
      You are no longer a company that other people hire. You are a power on Dovan,
      with ground of your own and two established rivals who would very much prefer
      you were not.
      </div>
      <div class="prose">
      Both the Ordnance Trust and the Basin Syndics have declared against you. Every
      holding you own is now under permanent pressure, and you will have to defend
      them yourself.
      </div>`,
    foot: '<button class="btn btn-major" data-x="close">SO BE IT</button>',
    onClose: null,
  });
  wire({ close: () => done() });
}

// --------------------------------------------------------------------------
// Character & equipment
//
// Three columns: spoils on the left, the soldier in the middle rendered live in
// 3D, everything the company owns on the right. Clicking an item on either side
// equips it; clicking a filled slot takes it off.
// --------------------------------------------------------------------------

let charPreview = null;

/**
 * Where each armour piece hangs on the rig for the preview.
 *
 * Offsets are LOCAL to the joint, which already sits at the right height —
 * treating them as world coordinates stacks the joint height twice and floats
 * the helmet a metre above the soldier's scalp.
 */
const ARMOUR_ATTACH = {
  head: { node: 'head', scale: 0.52, offset: [0, 0.15, 0] },     // joint at 1.52, scalp ~1.67
  body: { node: 'torso', scale: 0.72, offset: [0, 0.30, 0] },    // joint at 0.92, chest ~1.22
  legs: { node: 'hips', scale: 0.78, offset: [0, -0.36, 0] },    // joint at 0.92, thigh ~0.56
};

function refreshPreview(S, soldier) {
  if (!charPreview) return;
  const armour = [];
  for (const slot of ['head', 'body', 'legs']) {
    const id = soldier.equip?.[slot];
    if (!id) continue;
    const a = ARMOUR_ATTACH[slot];
    armour.push({ model: `item_armour_${id}`, node: a.node, scale: a.scale, offset: a.offset });
  }
  charPreview.setSoldier(
    soldier.isCommander
      ? 'soldier_commander'
      : originOf(soldier).model,
    WEAPONS[soldier.weapon]?.model || 'wpn_rifle',
    armour,
  );
}

const slotTile = (slot, id, def, iconSrc) => `
  <div class="eq-slot ${id ? 'filled' : ''}" data-slot="${slot}">
    <span class="eq-label">${slot.toUpperCase()}</span>
    ${iconSrc ? `<img src="${iconSrc}" alt="">` : '<span class="eq-empty">—</span>'}
    <span class="eq-name">${def ? esc(def.name) : 'empty'}</span>
  </div>`;

export function characterPanel(S, cbs, soldierId = null) {
  const live = State.living(S);
  const sel = live.find((s) => s.id === soldierId) || State.commander(S) || live[0];
  if (!sel) return;
  const eff = effective(sel, companyMods(S.roster));
  sel.equip = sel.equip || { head: null, body: null, legs: null };

  // ---- left column: spoils waiting to be claimed ----
  const spoils = S.spoils || { credits: 0, cargo: {}, armoury: {}, armourPool: {}, kitPool: {} };
  const spoilRows = [];
  if (spoils.credits) {
    spoilRows.push(`<div class="inv-row"><span class="ir-name">${spoils.credits} credits</span></div>`);
  }
  for (const [id, n] of Object.entries(spoils.armoury || {})) {
    spoilRows.push(`<div class="inv-row" data-claim="weapon:${id}">
      <img src="${Models.weaponIcon(id, 56) || ''}" alt="">
      <span class="ir-name">${esc(WEAPONS[id]?.name || id)}</span><span class="ir-n">×${n}</span></div>`);
  }
  for (const [id, n] of Object.entries(spoils.armourPool || {})) {
    spoilRows.push(`<div class="inv-row" data-claim="armour:${id}">
      <img src="${Models.armourIcon(id, 56) || ''}" alt="">
      <span class="ir-name">${esc(ARMOUR[id]?.name || id)}</span><span class="ir-n">×${n}</span></div>`);
  }
  for (const [id, n] of Object.entries(spoils.cargo || {})) {
    spoilRows.push(`<div class="inv-row" data-claim="good:${id}">
      <img src="${Models.goodIcon(id, 56) || ''}" alt="">
      <span class="ir-name">${esc(GOODS[id]?.name || id)}</span><span class="ir-n">×${n}</span></div>`);
  }

  // ---- right column: the company's stores, filtered to what fits a slot ----
  const stores = [];
  for (const a of State.armouryList(S)) {
    stores.push(`<div class="inv-row" data-equip="weapon:${a.id}">
      <img src="${Models.weaponIcon(a.id, 56) || ''}" alt="">
      <span class="ir-name">${esc(a.def.name)}<em>${a.def.damage} dmg · ${a.def.range}m</em></span>
      <span class="ir-n">×${a.n}</span></div>`);
  }
  for (const a of State.armourList(S)) {
    stores.push(`<div class="inv-row" data-equip="armour:${a.id}">
      <img src="${Models.armourIcon(a.id, 56) || ''}" alt="">
      <span class="ir-name">${esc(a.def.name)}<em>${esc(a.def.desc)}</em></span>
      <span class="ir-n">×${a.n}</span></div>`);
  }
  for (const k of State.kitList(S)) {
    stores.push(`<div class="inv-row" data-equip="gear:${k.id}">
      <img src="${Models.kitIcon(k.id, 56) || ''}" alt="">
      <span class="ir-name">${esc(k.def.name)}<em>${esc(k.def.desc)}</em></span>
      <span class="ir-n">×${k.n}</span></div>`);
  }

  const roster = live.map((s) => `<button class="cp-pick ${s.id === sel.id ? 'on' : ''}" data-sel="${s.id}">
      <img src="${portrait(s, 32)}" alt="">
      <span>${rankOf(s).abbr} ${esc(s.name.split(' ')[0])}</span>
    </button>`).join('');

  const body = `
    <div class="cp-roster">${roster}</div>
    <div class="cp-grid">
      <div class="cp-col">
        <div class="section-title">SPOILS</div>
        <div class="inv-list">${spoilRows.length ? spoilRows.join('')
    : '<div class="empty">NOTHING WAITING</div>'}</div>
        ${spoilRows.length ? '<button class="btn" data-x="claimall" style="width:100%;margin-top:8px">TAKE EVERYTHING</button>' : ''}
      </div>

      <div class="cp-col cp-centre">
        <div class="cp-name">${rankOf(sel).abbr} ${esc(sel.name)}</div>
        <div class="cp-role">${ROLES[sel.role].name.toUpperCase()}${sel.isCommander ? ' · COMMANDER' : ''}</div>
        <div class="cp-view" id="cp-view"></div>
        <div class="cp-slots">
          ${slotTile('weapon', sel.weapon, WEAPONS[sel.weapon],
    sel.weapon ? Models.weaponIcon(sel.weapon, 56) : null)}
          ${slotTile('head', sel.equip.head, ARMOUR[sel.equip.head],
    sel.equip.head ? Models.armourIcon(sel.equip.head, 56) : null)}
          ${slotTile('body', sel.equip.body, ARMOUR[sel.equip.body],
    sel.equip.body ? Models.armourIcon(sel.equip.body, 56) : null)}
          ${slotTile('legs', sel.equip.legs, ARMOUR[sel.equip.legs],
    sel.equip.legs ? Models.armourIcon(sel.equip.legs, 56) : null)}
          ${slotTile('gear', sel.kit, KIT[sel.kit], sel.kit ? Models.kitIcon(sel.kit, 56) : null)}
        </div>
        <div class="cp-stats">
          <div><span class="n">${Math.round(eff.accuracy * 100)}</span><span class="l">ACCURACY</span></div>
          <div><span class="n">${eff.maxHp}</span><span class="l">CONDITION</span></div>
          <div><span class="n">${armourRating(sel)}</span><span class="l">ARMOUR</span></div>
          <div><span class="n">${eff.speed.toFixed(1)}</span><span class="l">SPEED</span></div>
        </div>
      </div>

      <div class="cp-col">
        <div class="section-title">COMPANY STORES</div>
        <div class="inv-list">${stores.length ? stores.join('')
    : '<div class="empty">NOTHING SPARE</div>'}</div>
      </div>
    </div>`;

  modal({
    title: 'EQUIPMENT',
    tag: `CREDITS ${S.credits}`,
    body,
    foot: `<span class="spacer">Click a slot to remove. Drag the model to turn it.</span>
      <button class="btn" data-x="close">DONE</button>`,
    onClose: () => { charPreview?.dispose(); charPreview = null; cbs.onClose?.(); },
    wide: true,
  });

  // Live 3D view.
  const host = $('cp-view');
  if (host) {
    charPreview?.dispose();
    charPreview = Models.makePreview(300, 400);
    host.appendChild(charPreview.dom);
    refreshPreview(S, sel);
  }

  const again = (id) => characterPanel(S, cbs, id);

  for (const el of document.querySelectorAll('#modal [data-sel]')) {
    el.onclick = () => { Audio.uiMove(); again(el.dataset.sel); };
  }
  // Unequip by clicking a filled slot.
  for (const el of document.querySelectorAll('#modal .eq-slot.filled')) {
    el.onclick = () => {
      const slot = el.dataset.slot;
      if (slot === 'weapon') { Audio.uiDeny(); return; }  // always carries something
      if (slot === 'gear') State.equipKit(S, sel, null);
      else State.equipArmour(S, sel, slot, null);
      Audio.uiBack();
      again(sel.id);
    };
  }
  // Equip from stores.
  for (const el of document.querySelectorAll('#modal [data-equip]')) {
    el.onclick = () => {
      const [kind, id] = el.dataset.equip.split(':');
      let ok = false;
      if (kind === 'weapon') ok = State.equipWeapon(S, sel, id);
      else if (kind === 'gear') ok = State.equipKit(S, sel, id);
      else ok = State.equipArmour(S, sel, ARMOUR[id]?.slot, id);
      if (ok) { Audio.uiSelect(); again(sel.id); } else Audio.uiDeny();
    };
  }
  // Claim spoils.
  for (const el of document.querySelectorAll('#modal [data-claim]')) {
    el.onclick = () => { State.claimSpoils(S); Audio.uiSelect(); again(sel.id); };
  }
  wire({
    close: () => closeModal(),
    claimall: () => { State.claimSpoils(S); Audio.uiSelect(); again(sel.id); },
  });
}

// --------------------------------------------------------------------------
// Holdings — ground the company owns, and what it is built into
// --------------------------------------------------------------------------

const costLine = (cost) => Object.entries(cost || {}).map(([k, n]) =>
  (k === 'credits' ? `${n} cr` : `${n} ${GOODS[k]?.abbr || k}`)).join(' · ');

/**
 * A cost line that answers the two questions a player actually has: do I have
 * this, and if not, where do I get it?
 *
 * The bare "6 MCH" told them neither. Goods for upgrades come off caravans and
 * out of markets, and nothing in the interface said so — which made holdings
 * feel like a system that wanted something from you without telling you what.
 */
const costDetail = (S, cost) => Object.entries(cost || {}).map(([k, n]) => {
  if (k === 'credits') {
    const have = S.credits;
    return `<div class="cost-row ${have >= n ? '' : 'short'}">
      <span class="cost-need">${n}</span>
      <span class="cost-good">CREDITS</span>
      <span class="cost-have">you have ${have}</span>
      <span class="cost-src"></span>
    </div>`;
  }
  const g = GOODS[k];
  const have = S.cargo?.[k] || 0;
  const src = have >= n ? '' : State.sourcesFor(S, k, 2)
    .map((s) => `${esc(s.name)} ${s.price}cr`).join(' · ');
  return `<div class="cost-row ${have >= n ? '' : 'short'}">
    <span class="cost-need">${n}</span>
    <span class="cost-good">${esc(g?.name || k)}</span>
    <span class="cost-have">in the truck: ${have}</span>
    <span class="cost-src">${src ? `buy at ${src}` : ''}</span>
  </div>`;
}).join('');

export function holdingsPanel(S, cbs) {
  const held = State.holdingList(S);

  // What is actually in the truck, up front. Every cost below is measured
  // against this, and a player should not have to open another screen to find
  // out whether they can afford anything.
  const carried = GOODS_LIST.filter((id) => (S.cargo?.[id] || 0) > 0);
  const stores = `<div class="hold-stores">
    <span class="lbl">IN THE TRUCK</span>
    <span class="hs-cr">${S.credits} cr</span>
    ${carried.length
      ? carried.map((id) => `<span class="hs-g"><b>${S.cargo[id]}</b> ${esc(GOODS[id].name)}</span>`).join('')
      : '<span class="dim">no goods — take a caravan, or buy at a market</span>'}
  </div>`;

  const body = stores + (held.length ? held.map(({ id, loc, h }) => {
    const threat = Math.min(1, h.threat || 0);
    const rows = UPGRADE_LIST.map((key) => {
      const def = HOLDING_UPGRADES[key];
      const lv = h.upgrades[key] || 0;
      const cost = State.upgradeCost(S, id, key);
      const afford = State.canAfford(S, cost);
      const pips = Array.from({ length: def.max }, (_, i) =>
        `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<div class="up-row">
        <div class="up-main">
          <div class="up-name">${esc(def.name)} <span class="up-pips">${pips}</span></div>
          <div class="up-desc">${esc(def.desc)}</div>
          <div class="up-eff">${lv ? esc(def.effect(lv)) : '<span class="dim">not built</span>'}</div>
        </div>
        ${cost ? `<div class="up-buy">
          <div class="up-cost">${costDetail(S, cost)}</div>
          <button class="btn" data-up="${key}" data-loc="${id}" ${afford ? '' : 'disabled'}>
            ${lv ? 'RAISE' : 'BUILD'}</button>
        </div>` : '<div class="up-buy"><span class="dim">MAX</span></div>'}
      </div>`;
    }).join('');

    return `<div class="holding">
      <div class="hold-head">
        <span class="hold-name">${esc(loc.name)}</span>
        <span class="tag ${loc.faction || 'none'}">${loc.kind.toUpperCase()}</span>
        <span class="hold-since">HELD SINCE DAY ${h.takenDay}</span>
      </div>
      <div class="hold-threat">
        <span class="lbl">PRESSURE</span>
        <span class="threat-bar"><i style="width:${Math.round(threat * 100)}%"></i></span>
        <span class="dim">${threat >= 1 ? 'ATTACK IMMINENT' : threat > 0.6 ? 'building' : 'quiet'}</span>
      </div>
      ${(() => {
    // Caravans belong on the holdings screen because they are what a holding is
    // FOR: a place that pays a fixed yield is a number, a place that sends
    // trucks out is a business you have to protect.
    const can = State.canBuyCaravan(S, id);
    const mine = (S.parties || []).filter((p) => p.kind === 'own_caravan'
      && p.homeHolding === id);
    return `<div class="caravan-box">
      <div class="cv-top">
        <span class="lbl">CARAVANS FROM HERE</span>
        <span class="cv-count">${mine.length}</span>
        <button class="btn" data-caravan="${id}" ${can.ok ? '' : 'disabled'}>
          FIT OUT — ${State.CARAVAN_COST}</button>
      </div>
      <div class="cv-note">${can.ok
    ? 'It will work a circuit and send takings back. Anything hostile it meets on the road can take it.'
    : esc(can.why)}</div>
    </div>`;
  })()}
      <div class="up-list">${rows}</div>
    </div>`;
  }).join('') : `<div class="empty">BRACKET HOLDS NO GROUND</div>
    <div class="prose" style="text-align:center;margin-top:10px">
      Take a location by seizing it — the option appears when you stand on somewhere
      worth having and the company is strong enough to hold it.
    </div>`);

  modal({
    title: 'HOLDINGS',
    tag: `${held.length} UNDER CONTROL`,
    body,
    foot: `<span class="spacer">Goods come off captured caravans, or out of any
      market. What is in the truck right now is listed under each cost.</span>
      <button class="btn" data-x="close">CLOSE</button>`,
    onClose: cbs.onClose,
    wide: true,
  });

  for (const el of document.querySelectorAll('#modal [data-caravan]')) {
    el.onclick = () => {
      if (State.buyCaravan(S, el.dataset.caravan)) { Audio.uiSelect(); holdingsPanel(S, cbs); }
      else { Audio.uiDeny(); toastModal('Cannot fit one out here'); }
    };
  }
  for (const el of document.querySelectorAll('#modal [data-up]')) {
    el.onclick = () => {
      if (State.buildUpgrade(S, el.dataset.loc, el.dataset.up)) {
        Audio.uiSelect();
        holdingsPanel(S, cbs);
      } else { Audio.uiDeny(); toastModal('Not enough credits or goods'); }
    };
  }
  wire({ close: onCloseWrap(cbs.onClose) });
}

// --------------------------------------------------------------------------
// Inventory — everything the company owns, in one place
// --------------------------------------------------------------------------

const itemTile = (src, label, sub, extra = '') => `
  <div class="inv-tile">
    ${src ? `<img src="${src}" alt="">` : '<span class="inv-noimg"></span>'}
    <div class="inv-meta">
      <div class="inv-name">${esc(label)}</div>
      <div class="inv-sub">${sub}</div>
    </div>
    ${extra}
  </div>`;

export function inventoryPanel(S, cbs) {
  const loc = State.locById(S.atLocation);
  const canTrade = !!(loc && loc.services?.includes('trade'));
  const used = State.cargoUsed(S);
  const cap = State.CARGO_CAPACITY;

  const cargoRows = Object.entries(S.cargo || {}).filter(([, n]) => n > 0);
  const carried = cargoRows.length ? cargoRows.map(([id, n]) => {
    const g = GOODS[id];
    const here = canTrade ? State.sellPriceAt(S, loc.id, id) : null;
    const trend = canTrade ? State.priceTrend(loc.id, id) : 'flat';
    return itemTile(
      Models.goodIcon(id, 72), g.name,
      `${n} units &middot; ${g.bulk * n} bulk`
      + (here ? ` &middot; <span class="pr ${trend}">${here} here</span>` : ''),
      canTrade ? `<div class="inv-actions">
        <button class="btn" data-sell="${id}" data-qty="1">SELL 1</button>
        <button class="btn" data-sell="${id}" data-qty="${n}">ALL</button>
      </div>` : '');
  }).join('') : '<div class="empty">THE TRUCK IS EMPTY</div>';

  const market = canTrade ? GOODS_LIST.map((id) => {
    const g = GOODS[id];
    const price = State.buyPriceAt(S, loc.id, id);
    const trend = State.priceTrend(loc.id, id);
    const afford = S.credits >= price && State.cargoFree(S) >= g.bulk;
    return itemTile(
      Models.goodIcon(id, 72), g.name,
      `<span class="pr ${trend}">${price} cr</span> &middot; ${g.bulk} bulk`
      + `<div class="inv-desc">${esc(g.desc)}</div>`,
      `<div class="inv-actions">
        <button class="btn" data-buy-good="${id}" data-qty="1" ${afford ? '' : 'disabled'}>BUY 1</button>
        <button class="btn" data-buy-good="${id}" data-qty="5" ${S.credits >= price * 5 && State.cargoFree(S) >= g.bulk * 5 ? '' : 'disabled'}>BUY 5</button>
      </div>`);
  }).join('') : '';

  const arms = State.armouryList(S).map((a) => itemTile(
    Models.weaponIcon(a.id, 72), a.def.name,
    `${a.def.damage} dmg &middot; ${a.def.rpm} rpm &middot; ${a.def.range}m`
    + `<div class="inv-desc">${esc(a.def.note)}</div>`,
    `<span class="inv-qty">×${a.n}</span>`)).join('')
    || '<div class="empty">ARMOURY EMPTY</div>';

  const kits = State.kitList(S).map((k) => itemTile(
    Models.kitIcon(k.id, 72), k.def.name,
    `<div class="inv-desc">${esc(k.def.desc)}</div>`,
    `<span class="inv-qty">×${k.n}</span>`)).join('')
    || '<div class="empty">NO SPARE KIT</div>';

  const issued = State.living(S).filter((s) => s.kit || s.weapon).map((s) => `
    <div class="inv-issued">
      <img src="${portrait(s, 32)}" alt="">
      <span class="ii-name">${rankOf(s).abbr} ${esc(s.name)}</span>
      <span class="ii-kit">${esc(weaponOf(s).name)}${s.kit ? ` &middot; ${esc(KIT[s.kit].name)}` : ''}</span>
    </div>`).join('');

  const body = `
    <div class="inv-bars">
      <div class="inv-bar">
        <span class="lbl">CARGO</span>
        <span class="inv-gauge"><i style="width:${Math.round((used / cap) * 100)}%"></i></span>
        <span class="val">${used} / ${cap}</span>
      </div>
      <div class="inv-bar"><span class="lbl">CREDITS</span><span class="val">${S.credits}</span></div>
      <div class="inv-bar"><span class="lbl">SUPPLY</span><span class="val">${S.supplies}</span>
        <span class="lbl">KITS</span><span class="val">${S.medical}</span></div>
    </div>

    <div class="section-title">IN THE TRUCK</div>
    <div class="inv-grid">${carried}</div>

    ${canTrade ? `<div class="section-title">${esc(loc.name.toUpperCase())} MARKET —
      <span class="pr cheap">GREEN IS CHEAP HERE</span>,
      <span class="pr dear">AMBER IS WANTED HERE</span></div>
      <div class="inv-grid">${market}</div>` : `<div class="section-title">MARKET</div>
      <div class="empty">NO MARKET HERE — TRADE AT A SETTLEMENT</div>`}

    <div class="section-title">ARMOURY</div>
    <div class="inv-grid">${arms}</div>

    <div class="section-title">SPARE KIT</div>
    <div class="inv-grid">${kits}</div>

    ${issued ? `<div class="section-title">ISSUED</div><div class="inv-issued-list">${issued}</div>` : ''}`;

  modal({
    title: 'COMPANY STORES',
    tag: canTrade ? `TRADING AT ${loc.name.toUpperCase()}` : 'ON THE ROAD',
    body,
    foot: `<span class="spacer">Buy where a good is produced, sell where it is wanted.</span>
      <button class="btn" data-x="loadout">LOADOUT</button>
      <button class="btn" data-x="close">CLOSE</button>`,
    onClose: cbs.onClose,
    wide: true,
  });

  const refresh = () => inventoryPanel(S, cbs);
  for (const el of document.querySelectorAll('#modal [data-buy-good]')) {
    el.onclick = () => {
      const qty = Number(el.dataset.qty) || 1;
      if (State.buyGood(S, loc.id, el.dataset.buyGood, qty)) { Audio.uiSelect(); refresh(); }
      else { Audio.uiDeny(); toastModal('No credits or no room'); }
    };
  }
  for (const el of document.querySelectorAll('#modal [data-sell]')) {
    el.onclick = () => {
      const qty = Number(el.dataset.qty) || 1;
      if (State.sellGood(S, loc.id, el.dataset.sell, qty)) { Audio.uiSelect(); refresh(); }
      else Audio.uiDeny();
    };
  }
  wire({ close: onCloseWrap(cbs.onClose), loadout: cbs.onLoadout || (() => {}) });
}

// --------------------------------------------------------------------------
// Loadout — armoury, kit and retraining
// --------------------------------------------------------------------------

export function loadoutPanel(S, cbs, selectedId = null) {
  const live = State.living(S);
  const sel = live.find((s) => s.id === selectedId) || live[0];
  if (!sel) return;
  const arms = State.armouryList(S);
  const kits = State.kitList(S);
  const eff = effective(sel, companyMods(S.roster));

  const roster = live.map((s) => `<div class="pick ${s.id === sel.id ? 'on' : ''}" data-sel="${s.id}">
      <img src="${portrait(s, 32)}" style="width:24px;height:24px;image-rendering:pixelated;border:1px solid #2c2d23">
      <span style="flex:1">
        <span style="color:var(--bone)">${rankOf(s).abbr} ${esc(s.name)}</span>
        <span class="dim"> · ${originOf(s).short} ${ROLES[s.role].name}</span>
      </span>
      <span class="dim">${esc(weaponOf(s).abbr)}${s.kit ? ` · ${KIT[s.kit].abbr}` : ''}</span>
    </div>`).join('');

  const body = `
    <div class="two-col" style="grid-template-columns: 300px 1fr; gap:22px">
      <div>
        <div class="section-title">COMPANY</div>
        ${roster}
      </div>
      <div>
        <div class="section-title">${esc(sel.name)} — ${ROLES[sel.role].name.toUpperCase()}</div>
        <div class="stat-row" style="padding:4px 0 12px">
          <div class="s"><span class="n">${Math.round(eff.accuracy * 100)}</span><span class="l">ACCURACY</span></div>
          <div class="s"><span class="n">${eff.maxHp}</span><span class="l">CONDITION</span></div>
          <div class="s"><span class="n">${eff.speed.toFixed(1)}</span><span class="l">SPEED</span></div>
          <div class="s"><span class="n">${Math.round(eff.sight)}</span><span class="l">SIGHT</span></div>
        </div>

        <div class="section-title">WEAPON — CARRYING ${esc(weaponOf(sel).name)}</div>
        ${arms.length ? arms.map((a) => `<div class="pick" data-arm="${a.id}">
            <span class="box"></span>
            <span style="flex:1"><span style="color:var(--bone)">${esc(a.def.name)}</span>
              <span class="dim"> · ${a.def.damage} dmg · ${a.def.rpm} rpm · ${a.def.range}m</span></span>
            <span class="dim">×${a.n}</span>
          </div>`).join('')
    : '<div class="empty">ARMOURY EMPTY — BUY WEAPONS AT A MARKET</div>'}

        <div class="section-title">KIT — ${sel.kit ? esc(KIT[sel.kit].name) : 'NONE'}</div>
        ${sel.kit ? `<div class="pick" data-kit=""><span class="box"></span>
            <span style="flex:1;color:var(--bad)">Remove ${esc(KIT[sel.kit].name)}</span></div>` : ''}
        ${kits.length ? kits.map((k) => `<div class="pick" data-kit="${k.id}">
            <span class="box"></span>
            <span style="flex:1"><span style="color:var(--bone)">${esc(k.def.name)}</span>
              <span class="dim"> · ${esc(k.def.desc)}</span></span>
            <span class="dim">×${k.n}</span>
          </div>`).join('')
    : '<div class="empty">NO SPARE KIT</div>'}

        ${sel.perks?.length ? `<div class="section-title">TRAINING</div>
          ${sel.perks.map((p) => {
    const d = perkDef(p);
    return `<div style="font-size:12px;padding:3px 0">
              <span style="color:var(--ochre)">${esc(d.name)}</span>
              <span class="dim"> — ${esc(d.desc)}</span></div>`;
  }).join('')}` : ''}

        ${(() => {
    // What this soldier can become. Rank is earned in the field and cannot be
    // bought; the ROLE is bought and cannot be earned — so this is where the
    // player decides what a veteran is FOR. The old screen let anybody become
    // anything for a flat fee, which made rank and role both meaningless.
    const ups = State.upgradesFor(S, sel);
    if (sel.isCommander) {
      return '<div class="section-title">ADVANCEMENT</div>'
        + '<div class="prose dim">The commander does not retrain. They take perks.</div>';
    }
    if (!ups.length) {
      return '<div class="section-title">ADVANCEMENT</div>'
        + `<div class="prose dim">${esc(ROLES[sel.role].name)} is the end of that road.
           ${esc(sel.name)} is as specialised as this company can make them.</div>`;
    }
    return '<div class="section-title">ADVANCEMENT</div>'
      + '<div class="up-paths">' + ups.map((u) => `<div class="up-path ${u.ok ? '' : 'locked'}">
        <div class="upp-head">
          <span class="upp-to">${esc(ROLES[u.to].name)}</span>
          <span class="upp-cost">${u.cost} cr</span>
        </div>
        <div class="upp-why">${esc(u.why)}</div>
        <div class="upp-wage">wages ${u.wageNow} &rarr; ${u.wageAfter} a day</div>
        <button class="btn" data-up-troop="${u.to}" ${u.ok ? '' : 'disabled'}>
          ${u.ok ? 'PROMOTE' : 'LOCKED'}</button>
      </div>`).join('') + '</div>';
  })()}
      </div>
    </div>`;

  modal({
    title: 'LOADOUT',
    tag: `CREDITS ${S.credits}`,
    body,
    foot: `<span class="spacer">Weapons swapped here return to the armoury — nothing is lost.</span>
      <button class="btn" data-x="close">DONE</button>`,
    onClose: cbs.onClose,
    wide: true,
  });

  const refresh = (id) => loadoutPanel(S, cbs, id);
  for (const el of document.querySelectorAll('#modal [data-sel]')) {
    el.onclick = () => { Audio.uiMove(); refresh(el.dataset.sel); };
  }
  for (const el of document.querySelectorAll('#modal [data-arm]')) {
    el.onclick = () => {
      if (State.equipWeapon(S, sel, el.dataset.arm)) { Audio.uiSelect(); refresh(sel.id); }
      else Audio.uiDeny();
    };
  }
  for (const el of document.querySelectorAll('#modal [data-kit]')) {
    el.onclick = () => {
      if (State.equipKit(S, sel, el.dataset.kit || null)) { Audio.uiSelect(); refresh(sel.id); }
      else Audio.uiDeny();
    };
  }
  for (const el of document.querySelectorAll('#modal [data-up-troop]')) {
    el.onclick = () => {
      if (State.upgradeTroop(S, sel.id, el.dataset.upTroop)) {
        Audio.uiSelect(); refresh(sel.id);
      } else { Audio.uiDeny(); toastModal('Cannot promote them yet'); }
    };
  }
  wire({ close: onCloseWrap(cbs.onClose) });
}

function solRow(s) {
  const r = roleOf(s), rk = rankOf(s);
  const w = woundInfo(s);
  const cls = [
    s.status === STATUS.DEAD ? 'dead' : '',
    s.status === STATUS.WOUNDED ? 'wounded' : '',
    s.isCommander ? 'cmd' : '',
  ].join(' ');
  const pct = Math.round((s.hp / Math.max(1, s.maxHp)) * 100);
  const statusText = s.status === STATUS.DEAD ? 'KILLED'
    : s.status === STATUS.WOUNDED ? 'WOUNDED' : 'FIT';
  const traits = s.traits.map((t) => t.toUpperCase()).join(' · ');
  const perks = (s.perks || []).map((p) => perkDef(p)?.name).filter(Boolean);
  return `<div class="sol ${cls}">
    <img src="${portrait(s, 64)}" alt="">
    <div class="sol-main">
      <div class="sol-name"><span class="rk">${rk.abbr}</span>${esc(s.name)}${s.isCommander ? ' <span class="dim">— you</span>' : ''}
        ${s.pendingPerks?.length ? '<span class="pending">PROMOTION PENDING</span>' : ''}</div>
      <div class="sol-meta">${r.name.toUpperCase()} · ${esc(weaponOf(s).abbr)}${s.kit ? ` · ${esc(KIT[s.kit].abbr)}` : ''}${traits ? ` · ${traits}` : ''}</div>
      ${perks.length ? `<div class="sol-perks">${perks.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}
      <div class="sol-hist">${esc(s.joinedHow)}, day ${s.joinedDay}${w ? ` — ${esc(w.name)}, ${w.days}d` : ''}</div>
      ${s.status !== STATUS.DEAD && !s.isCommander ? (() => {
    // What they think the job is, and what they currently think of you. The
    // creed never moves; the regard is the part you are responsible for, so it
    // is the part that gets the colour.
    const cr = creedOf(s), rt = regardTier(s);
    const cls = (s.regard || 0) <= -45 ? 'bad' : ((s.regard || 0) < -6 ? 'warn' : ((s.regard || 0) > 14 ? 'good' : ''));
    return `<div class="sol-creed" title="${esc(cr.line)}&#10;${esc(rt.note)}">
      <span class="cr-name">${esc(cr.name.toUpperCase())}</span>
      <span class="cr-reg ${cls}">${esc(rt.name)}</span>
      ${s.quitWarned ? '<span class="cr-quit">TALKING OF LEAVING</span>' : ''}
    </div>`;
  })() : ''}
      ${s.status !== STATUS.DEAD ? `<div class="hpbar ${s.status === STATUS.WOUNDED ? 'w' : ''}"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    <div class="sol-stats">
      <div class="sol-stat"><span class="n">${s.deployments}</span><span class="l">DEPLOY</span></div>
      <div class="sol-stat"><span class="n">${s.kills}</span><span class="l">KILLS</span></div>
      <div class="sol-stat"><span class="n">${s.xp}</span><span class="l">XP</span></div>
    </div>
    <div class="sol-status ${s.status}">${statusText}</div>
  </div>`;
}

// --------------------------------------------------------------------------
// Contract board
// --------------------------------------------------------------------------

export function contractPanel(S, { onAccept, onClose }) {
  const list = S.contracts;
  const body = list.length ? list.map((c) => {
    const emp = c.employer ? FACTIONS[c.employer] : null;
    return `<div class="card ${c.accepted ? 'on' : ''}" data-c="${c.id}">
      <div class="card-top">
        <span class="card-title">${esc(c.title)}</span>
        <span class="tag ${c.employer || 'none'}">${emp ? esc(emp.short) : 'PRIVATE'}</span>
        <span class="card-pay">${c.pay}</span>
      </div>
      <div class="card-meta">${MISSION_TYPES[c.type].name.toUpperCase()} · ${esc(State.locName(c.site))} · EXPIRES DAY ${c.expiresDay}</div>
      <div class="card-text">${esc(c.text)}</div>
    </div>`;
  }).join('') : '<div class="empty">NO POSTINGS AVAILABLE</div>';

  modal({
    title: 'CONTRACT BOARD',
    tag: `DAY ${S.day}`,
    body,
    foot: `<span class="spacer">Accepting a posting replaces any active contract.</span>
      <button class="btn" data-x="close">CLOSE</button>`,
    onClose,
  });
  for (const el of document.querySelectorAll('#modal .card')) {
    el.onclick = () => { Audio.uiSelect(); onAccept(el.dataset.c); };
  }
  wire({ close: onCloseWrap(onClose) });
}

// --------------------------------------------------------------------------
// Settlement
// --------------------------------------------------------------------------

/**
 * The settlement menu.
 *
 * Arriving somewhere used to open one large panel with every service on it at
 * once — recruits, provisions, medical, the pit — which reads as a shop
 * inventory rather than as a place. This is the other way round: you arrive,
 * you are told where you are and what the standing is, and you choose one thing
 * to do. Each verb opens its own screen and returns here.
 *
 * The wording is deliberately in the second person and in the present tense,
 * because the point of a menu like this is that it reads as being somewhere.
 */
/**
 * One named person asking the company for something.
 *
 * Kept as its own small panel rather than folded into the settlement menu,
 * because the whole point is that it is a conversation with somebody — their
 * name, their job, the thing they want, in their words. A line of it on a
 * button would read as another errand.
 *
 * Saying no is free and stays on the table as a button rather than being hidden
 * behind closing the panel; it is not turning up after saying yes that costs.
 */
export function favourPanel(S, loc, cbs) {
  const f = State.favourAt(S, loc.id);
  if (!f) { cbs.onClose?.(); return; }
  const prog = State.favourProgress(S, f);
  const rel = State.relationOf(S, loc.id);

  const body = `
    <div class="fav-who">
      <span class="fw-name">${esc(f.who)}</span>
      <span class="fw-role">${esc(f.role)}</span>
    </div>
    <div class="prose fav-ask">${esc(State.favourAsk(f))}</div>
    <div class="fav-terms">
      <div><span class="lbl">PAYS</span><span class="val">${f.pay}</span></div>
      <div><span class="lbl">STANDING HERE</span><span class="val good">+14</span></div>
      <div><span class="lbl">BY DAY</span><span class="val">${f.expiresDay}</span></div>
    </div>
    ${f.accepted ? `<div class="prose ${prog.ready ? 'hl' : 'dim'} mt">${esc(prog.note)}</div>`
    : `<div class="prose dim mt">Turning them down costs nothing. Agreeing and then not
       coming back costs ten points of standing in ${esc(loc.name)}.</div>`}`;

  modal({
    title: 'A WORD WITH YOU',
    tag: `${esc(loc.name.toUpperCase())} · ${rel > 0 ? '+' : ''}${Math.round(rel)}`,
    body,
    foot: `${f.accepted
      ? (prog.ready ? '<button class="btn btn-major" data-x="hand">HAND IT OVER</button>' : '')
      : `<button class="btn btn-major" data-x="take">AGREE</button>
         <button class="btn" data-x="decline">NOT THIS TIME</button>`}
      <button class="btn" data-x="close">BACK</button>`,
    onClose: cbs.onClose,
  });
  wire({
    close: onCloseWrap(cbs.onClose),
    take: () => { State.acceptFavour(S, loc.id); Audio.uiSelect(); cbs.onDone(); },
    decline: () => { State.declineFavour(S, loc.id); Audio.uiBack(); cbs.onDone(); },
    hand: () => {
      const res = State.completeFavour(S, loc.id);
      Audio.deployTone();
      if (res) toast('FAVOUR DONE', `${res.who} paid ${res.pay}`, 'good');
      cbs.onDone();
    },
  });
}

/**
 * Somebody who buys people.
 *
 * The rate is shown against what the prisoner's own faction would pay, because
 * the number on its own means nothing — the decision is only legible as a
 * comparison. The cost is spelled out in the same breath: their people mind a
 * great deal, and so do some of yours.
 */
export function brokerPanel(S, loc, cbs) {
  const rate = State.brokerRate(S, loc.id);
  const pris = S.prisoners || [];
  const hot = rate > (State.BROKER_FLOOR + State.BROKER_CEIL) / 2;

  const rows = pris.map((p) => {
    const home = State.ransomValue(S, p);
    const here = State.brokerPrice(S, loc.id, p);
    return `<div class="brk">
      <img src="${portrait(p, 40)}" class="pris-face">
      <div class="pris-who">
        <div class="pris-name">${esc(p.name)}</div>
        <div class="pris-meta">${RANKS[p.rank].abbr} ${ROLES[p.role].name.toUpperCase()}
          ${p.captiveFaction ? `&middot; ${esc(FACTIONS[p.captiveFaction].short)}` : ''}</div>
      </div>
      <div class="brk-cmp">
        <span class="lbl">THEIR PEOPLE</span><span class="val">${home}</span>
      </div>
      <button class="btn btn-warn" data-sell="${p.id}">SELL ${here}</button>
    </div>`;
  }).join('');

  modal({
    title: 'THE BROKER',
    tag: `${esc(loc.name.toUpperCase())} · ${rate.toFixed(2)}x`,
    body: `<div class="prose">${hot
      ? 'Buying hard this week, and not asking who anyone is.'
      : 'Paying thinly. He can afford to wait; so, in fairness, can you.'}</div>
      <div class="prose dim">Their own people will mind — six points of standing with
      whoever they belong to, against two for a straight ransom. So will some of
      the company.</div>
      ${rows || '<div class="prose dim mt">You are not carrying anyone.</div>'}`,
    foot: '<button class="btn" data-x="close">LEAVE HIM TO IT</button>',
    onClose: cbs.onClose,
  });
  for (const el of document.querySelectorAll('#modal [data-sell]')) {
    el.onclick = () => {
      const res = State.sellPrisoner(S, loc.id, el.dataset.sell);
      if (res) { Audio.uiSelect(); toast('SOLD', `${res.name} — ${res.paid}`, 'bad'); }
      cbs.onDone();
    };
  }
  wire({ close: onCloseWrap(cbs.onClose) });
}

export function settlementMenu(S, loc, cbs) {
  const f = loc.faction ? FACTIONS[loc.faction] : null;
  const tier = State.relationTier(S, loc.id);
  const rel = State.relationOf(S, loc.id);
  const held = State.isHolding(S, loc.id);
  const contract = State.activeContract(S);
  const hasWork = contract && contract.site === loc.id;

  const has = (svc) => loc.services.includes(svc);
  const verbs = [];
  const verb = (id, label, note, cls = '') => verbs.push({ id, label, note, cls });

  if (hasWork) {
    verb('deploy', 'Take the company in',
      `${esc(contract.title)} — ${contract.pay} on completion`, 'major');
  }
  // Somebody here wants something. Named people ask before the board does,
  // because a person waiting on you is more urgent than a posting.
  const fav = State.favourAt(S, loc.id);
  if (fav) {
    const prog = State.favourProgress(S, fav);
    if (!fav.accepted) verb('favour', `Hear out ${esc(fav.who)}`, esc(fav.role));
    else if (prog.ready) verb('favour', `Report to ${esc(fav.who)}`, 'They are waiting', 'major');
    else verb('favour', `Call on ${esc(fav.who)}`, esc(prog.note));
  }
  if (has('market')) verb('market', 'Walk down to the market', 'Buy, sell, and fit the truck out');
  if (has('recruit')) verb('recruit', 'Ask who is looking for work', 'Hire from what the town offers');
  if (has('market')) verb('pit', 'Take a turn in the pit',
    S.stats.pitRounds ? `Your best is ${S.stats.pitRounds} rounds` : 'Paid by the round');
  if (has('medical')) verb('medical', 'Call at the infirmary', 'Restock kits, see to the wounded');
  // Only offered when you are actually carrying people. A broker with nothing
  // to buy is a menu entry that exists to tell you the feature is there.
  if (State.hasBroker(loc.id) && (S.prisoners || []).length) {
    const rate = State.brokerRate(S, loc.id);
    verb('broker', 'Find the broker',
      `${(S.prisoners || []).length} in the truck — paying ${rate.toFixed(2)}x today`, 'warn');
  }
  if (has('contracts')) verb('board', 'Read the posting board', 'See what work is going');
  verb('rest', 'Stand the company down', 'A day here. Wounds close, wages still leave.');
  if (held) verb('holdings', 'Look over what you hold', 'Build it up, or fit out a caravan');
  if (!held) verb('raid', 'Take the place apart', 'They will not forget it', 'warn');
  if (cbs.canSeize) verb('seize', 'Take it for Bracket', 'Break whoever holds it and stand in it', 'warn');

  const body = `
    <div class="sm-head">
      <div class="sm-where">
        <span class="sm-name">${esc(loc.name)}</span>
        <span class="tag ${loc.faction || 'none'}">${f ? esc(f.short) : 'UNALIGNED'}</span>
        ${held ? '<span class="tag player">BRACKET</span>' : ''}
      </div>
      <div class="sm-standing">
        <span class="lbl">THEY REGARD YOU AS</span>
        <span class="sm-tier">${esc(tier.name)}</span>
        <span class="dim">${rel > 0 ? '+' : ''}${Math.round(rel)}</span>
      </div>
    </div>
    <div class="prose sm-blurb">${esc(loc.detail || loc.blurb)}</div>
    <div class="sm-verbs">
      ${verbs.map((v) => `<button class="sm-verb ${v.cls}" data-verb="${v.id}">
        <span class="sv-label">${v.label}</span>
        <span class="sv-note">${v.note}</span>
      </button>`).join('')}
    </div>`;

  modal({
    title: loc.name.toUpperCase(),
    tag: `DAY ${S.day}`,
    body,
    foot: `<span class="spacer">CREDITS ${S.credits} · RATIONS ${S.rations || 0}d
      · WAGES ${State.payrollOf(S)}/day</span>
      <button class="btn" data-x="close">BACK TO THE ROAD</button>`,
    onClose: cbs.onClose,
  });

  for (const el of document.querySelectorAll('#modal [data-verb]')) {
    el.onclick = () => { Audio.uiSelect(); cbs.onVerb(el.dataset.verb, loc); };
  }
  wire({ close: onCloseWrap(cbs.onClose) });
}

export function settlementPanel(S, loc, cbs) {
  const pool = State.recruitPool(S, loc.id);
  const f = loc.faction ? FACTIONS[loc.faction] : null;
  const canRecruit = loc.services.includes('recruit');
  // You can rob anywhere you do not hold. It is always available and always
  // expensive — the point is that it is a standing decision, not a gated one.
  const canRaid = !State.isHolding(S, loc.id) && !!cbs.onRaid;
  // Anywhere with a market has enough of a crowd to run a pit.
  const canPit = loc.services.includes('market') && !!cbs.onPit;
  const canMed = loc.services.includes('medical');
  const canMarket = loc.services.includes('market');

  const body = `
    <div class="two-col">
      <div>
        ${(() => {
    // What this particular place thinks of you. Faction reputation is politics;
    // this is the people who actually live here, and it decides who they will
    // put forward and what they will charge.
    const tier = State.relationTier(S, loc.id);
    const rel = State.relationOf(S, loc.id);
    const pct = Math.round(((rel + 100) / 200) * 100);
    return `<div class="rel-box">
      <div class="rel-top">
        <span class="lbl">STANDING HERE</span>
        <span class="rel-name">${esc(tier.name)}</span>
        <span class="rel-num">${rel > 0 ? '+' : ''}${Math.round(rel)}</span>
      </div>
      <div class="rel-bar"><i style="width:${pct}%"></i><b style="left:50%"></b></div>
      <div class="rel-note">${esc(tier.note)}</div>
    </div>`;
  })()}
        <div class="prose"><span class="hl">${esc(loc.detail)}</span></div>
        ${loc.contacts.map((c) => `<div class="contact mt">
          <div class="cn">${esc(c.name)}</div>
          <div class="cr">${esc(c.role)} — ${esc(c.trait)}</div>
          <div class="cl">&ldquo;${esc(c.line)}&rdquo;</div>
        </div>`).join('')}
      </div>
      <div>
        ${canRecruit ? `<div class="section-title">AVAILABLE FOR HIRE</div>
          ${pool.map((s, i) => `<div class="card" data-hire="${i}">
            <div class="card-top">
              <span class="card-title">${RANKS[s.rank].abbr} ${esc(s.name)}</span>
              <span class="card-pay">${State.hireCost(S, s)}</span>
            </div>
            <div class="card-meta">${originOf(s).short} ${ROLES[s.role].name.toUpperCase()} · ${s.traits.map((t) => t.toUpperCase()).join(' · ')}</div>
            <div class="card-text">${esc(ROLES[s.role].desc)}</div>
            <div class="card-text dim">${esc(originOf(s).blurb)}</div>
            <div class="card-text creed">&ldquo;${esc(creedOf(s).line)}&rdquo;</div>
          </div>`).join('')}` : ''}
        ${canPit ? `<div class="section-title">THE PIT</div>
          <div class="card" data-x="pit">
            <div class="card-top">
              <span class="card-title">Take a turn in the pit</span>
              <span class="card-pay">PAID BY THE ROUND</span>
            </div>
            <div class="card-meta">NOBODY DIES IN THE PIT</div>
            <div class="card-text dim">You go in alone against whoever is next. The purse
              rises every round you last, and you walk out either way.
              ${S.stats.pitRounds ? `Best so far: ${S.stats.pitRounds} rounds.` : ''}</div>
          </div>` : ''}
        ${canMarket ? `<div class="section-title">PROVISIONS</div>
          <div class="card" data-buy="rations">
            <div class="card-top">
              <span class="card-title">Rations — 7 days</span>
              <span class="card-pay">${State.rationCost(S, loc.id, 7)}</span>
            </div>
            <div class="card-meta">THE COMPANY EATS WHETHER OR NOT IT WORKS</div>
            <div class="card-text dim">${S.rations || 0} days left in the truck.
              Wages are ${State.payrollOf(S)} a day for ${State.living(S).length} people.</div>
          </div>` : ''}
        ${canMed ? `<div class="section-title">MEDICAL</div>
          <div class="card" data-buy="med">
            <div class="card-top"><span class="card-title">Field medical kits ×2</span><span class="card-pay">160</span></div>
            <div class="card-meta">STABILISES CASUALTIES IN THE FIELD</div>
          </div>` : ''}
        ${canMarket ? `<div class="section-title">SUPPLY</div>
          <div class="card" data-buy="sup">
            <div class="card-top"><span class="card-title">Ammunition and stores ×6</span><span class="card-pay">140</span></div>
            <div class="card-meta">CONSUMED BY DEPLOYMENTS</div>
          </div>
          <div class="card" data-buy="rest">
            <div class="card-top"><span class="card-title">Stand down for a day</span><span class="card-pay">40</span></div>
            <div class="card-meta">WOUNDS RECOVER FASTER IN A SETTLEMENT</div>
          </div>

          <div class="section-title">WEAPONS</div>
          ${weaponStock(loc).map((w) => `<div class="card" data-weapon="${w.id}">
            <div class="card-top"><span class="card-title">${esc(w.name)}</span>
              <span class="card-pay">${w.price}</span></div>
            <div class="card-meta">${w.damage} DMG · ${w.rpm} RPM · ${w.range}M · ${w.mag} RDS</div>
            <div class="card-text">${esc(w.note)}</div>
          </div>`).join('')}

          <div class="section-title">KIT</div>
          ${Object.values(KIT).map((k) => `<div class="card" data-kititem="${k.id}">
            <div class="card-top"><span class="card-title">${esc(k.name)}</span>
              <span class="card-pay">${k.price}</span></div>
            <div class="card-meta">${esc(k.desc)}</div>
          </div>`).join('')}` : ''}
      </div>
    </div>`;

  modal({
    title: loc.name.toUpperCase(),
    tag: f ? f.name.toUpperCase() : 'UNALIGNED',
    body,
    foot: `<span class="spacer">CREDITS ${S.credits} · KITS ${S.medical} · SUPPLY ${S.supplies}</span>
      ${canRaid ? '<button class="btn btn-warn" data-x="raid">RAID THIS PLACE</button>' : ''}
      ${loc.services.includes('trade') ? '<button class="btn" data-x="trade">TRADE</button>' : ''}
      <button class="btn" data-x="board">CONTRACTS</button>
      <button class="btn" data-x="close">LEAVE</button>`,
    onClose: cbs.onClose,
    wide: true,
  });

  for (const el of document.querySelectorAll('#modal [data-hire]')) {
    el.onclick = () => {
      const s = pool[Number(el.dataset.hire)];
      if (State.hire(S, s)) { Audio.uiSelect(); cbs.onRefresh(); }
      else { Audio.uiDeny(); toastModal('Not enough credits'); }
    };
  }
  for (const el of document.querySelectorAll('#modal [data-weapon]')) {
    el.onclick = () => {
      if (State.buyWeapon(S, el.dataset.weapon)) { Audio.uiSelect(); cbs.onRefresh(); }
      else { Audio.uiDeny(); toastModal('Not enough credits'); }
    };
  }
  for (const el of document.querySelectorAll('#modal [data-kititem]')) {
    el.onclick = () => {
      if (State.buyKit(S, el.dataset.kititem)) { Audio.uiSelect(); cbs.onRefresh(); }
      else { Audio.uiDeny(); toastModal('Not enough credits'); }
    };
  }
  for (const el of document.querySelectorAll('#modal [data-buy]')) {
    el.onclick = () => {
      const kind = el.dataset.buy;
      // Rations are priced off the local market rather than a flat rate — food
      // costs what food costs where you are standing.
      if (kind === 'rations') {
        if (!State.buyRations(S, loc.id, 7)) {
          Audio.uiDeny(); toastModal('Not enough credits'); return;
        }
        Audio.uiSelect();
        cbs.onRefresh();
        return;
      }
      const cost = kind === 'med' ? 160 : kind === 'sup' ? 140 : 40;
      if (S.credits < cost) { Audio.uiDeny(); toastModal('Not enough credits'); return; }
      S.credits -= cost;
      if (kind === 'med') S.medical += 2;
      else if (kind === 'sup') S.supplies += 6;
      else { State.advanceTime(S, 20); State.pushLog(S, 'The company stood down for a day.'); }
      Audio.uiSelect();
      cbs.onRefresh();
    };
  }
  wire({
    close: onCloseWrap(cbs.onClose),
    board: cbs.onBoard,
    trade: cbs.onTrade || (() => {}),
    raid: () => cbs.onRaid?.(loc),
    pit: () => cbs.onPit?.(loc),
  });
}

/**
 * What a given settlement will sell you. Faction markets stock their own
 * doctrine's weapons; the neutral crossing sells whatever it can get, which is
 * why it is worth the trip.
 */
function weaponStock(loc) {
  const ids = loc.faction === 'trust' ? ['rifle', 'lmg', 'shotgun']
    : loc.faction === 'syndic' ? ['smg', 'dmr', 'shotgun']
      : ['rifle', 'smg', 'shotgun', 'dmr', 'lmg'];
  return ids.map((id) => WEAPONS[id]).filter((w) => w && w.price > 0);
}

function toastModal(msg) {
  const f = document.querySelector('#modal .modal-foot .spacer');
  if (!f) return;
  const old = f.textContent;
  f.textContent = msg.toUpperCase();
  f.style.color = 'var(--bad)';
  setTimeout(() => { f.textContent = old; f.style.color = ''; }, 1400);
}

// --------------------------------------------------------------------------
// Encounter with a moving party
// --------------------------------------------------------------------------

export function encounterPanel(S, party, cbs) {
  const f = party.faction ? FACTIONS[party.faction] : null;
  const hostile = party.hostileToPlayer;
  const flavour = {
    patrol_trust: 'An Ordnance Trust patrol has stopped in the road ahead. The lead vehicle keeps its gun trained on you while a clerk checks a list.',
    convoy_trust: 'A Trust convoy grinds past under escort. Crates, stencilled and counted.',
    patrol_syndic: 'A Syndic column, riding light. They wave, but nobody puts a weapon down.',
    raiders: 'Scrappers. They have already spread out across the road, and they are not here to talk.',
    refugees: 'A line of families on foot, moving away from something. They have very little and are carrying all of it.',
    merc: 'Another free company, camped off the road. They recognise the work.',
  }[party.kind] || 'A party on the road.';

  // What the sergeants think their odds are without you. Shown as a band
  // rather than a percentage, because a precise number would be a lie about
  // how much anybody can really know before it starts.
  const squadPreview = State.ready(S).slice(0, State.deployLimit(S));
  const est = squadPreview.length ? State.estimateFight(S, squadPreview, party) : null;
  const oddsWord = !est ? ''
    : est.odds > 0.8 ? 'They expect to walk it.'
      : est.odds > 0.6 ? 'They think they can take it.'
        : est.odds > 0.4 ? 'They are not sure.'
          : est.odds > 0.2 ? 'They do not like it.'
            : 'They think this will kill them.';
  const sendBtn = squadPreview.length
    ? `<button class="btn" data-x="send" title="${esc(oddsWord)}">SEND THEM IN</button>`
    : '';

  const options = [];
  if (hostile) {
    options.push(`<button class="btn btn-warn" data-x="fight">ENGAGE</button>`);
    if (sendBtn) options.push(sendBtn);
    // Buying your way past. Always offered, always galling, and often the
    // right call when the alternative is burying somebody.
    const toll = State.tollOf(S, party);
    options.push(`<button class="btn" data-x="toll" ${S.credits < toll ? 'disabled' : ''}
      title="They will let you past for ${toll}">PAY THEM OFF (${toll})</button>`);
    options.push(`<button class="btn" data-x="avoid">WITHDRAW</button>`);
  } else if (party.faction && (party.kind || '').startsWith('patrol')) {
    // A patrol that wants to look in the truck.
    options.push(`<button class="btn" data-x="inspect">STAND AND BE SEARCHED</button>`);
    options.push(`<button class="btn btn-warn" data-x="refuse">REFUSE THEM</button>`);
    options.push(`<button class="btn" data-x="avoid">MOVE ON</button>`);
  } else if (party.kind === 'refugees') {
    options.push(`<button class="btn" data-x="aid">GIVE THEM SUPPLIES (2)</button>`);
    options.push(`<button class="btn" data-x="avoid">MOVE ON</button>`);
  } else if (party.kind === 'merc') {
    options.push(`<button class="btn" data-x="drink">TRADE NEWS</button>`);
    options.push(`<button class="btn" data-x="avoid">MOVE ON</button>`);
  } else {
    options.push(`<button class="btn" data-x="talk">SPEAK WITH THEM</button>`);
    // Robbing a caravan is always available and always has consequences.
    if (party.strength > 0) {
      options.push(`<button class="btn btn-warn" data-x="fight">ATTACK THEM</button>`);
      if (sendBtn) options.push(sendBtn);
    }
    options.push(`<button class="btn" data-x="avoid">MOVE ON</button>`);
  }

  // The strength comparison is the decision. Attacking something four times
  // your size should look like the mistake it is before you commit to it.
  const limit = State.deployLimit(S);
  const ratio = (party.strength || 0) / Math.max(1, limit);
  const band = ratio > 3 ? 'lethal' : ratio > 1.6 ? 'hard' : ratio > 0.8 ? 'even' : 'weak';
  const verdict = {
    weak: 'You outnumber them.',
    even: 'An even fight.',
    hard: 'They outnumber you. This will be expensive.',
    lethal: 'They outnumber you badly. Engaging this is likely suicide.',
  }[band];

  modal({
    title: party.name.toUpperCase(),
    tag: f ? f.short : 'UNALIGNED',
    body: `<div class="prose">${esc(flavour)}</div>
      ${PARTY_TIERS[party.kind]?.desc
    ? `<div class="prose dim">${esc(PARTY_TIERS[party.kind].desc)}</div>` : ''}
      ${est ? `<div class="prose dim mt" style="font-size:11px">
        Sending them in without you resolves it immediately, but the company
        fights at three-quarters strength with nobody on the ground making the
        call — expect casualties you would not have taken. ${esc(oddsWord)}
      </div>` : ''}
      <div class="strength-row mt">
        <span class="lbl">THEIR STRENGTH</span>
        <span class="str-big ${band}">${party.strength || 0}</span>
        <span class="lbl">YOU CAN FIELD</span>
        <span class="str-big">${Math.min(limit, State.ready(S).length)}</span>
      </div>
      <div class="prose ${band === 'lethal' || band === 'hard' ? 'outnumbered' : 'dim'}">
        ${esc(verdict)}${party.vehicles ? ' They have armour.' : ''}
      </div>
      ${party.cargo ? '<div class="prose dim">They are hauling cargo.</div>' : ''}`,
    foot: options.join(''),
    onClose: cbs.onClose,
  });
  wire({
    fight: () => cbs.onFight(party),
    send: () => cbs.onSend?.(party),
    avoid: () => cbs.onAvoid(party),
    aid: () => cbs.onAid(party),
    talk: () => cbs.onTalk(party),
    drink: () => cbs.onTalk(party),
    toll: () => cbs.onToll?.(party),
    inspect: () => cbs.onInspect?.(party),
    refuse: () => cbs.onRefuse?.(party),
  });
}

// --------------------------------------------------------------------------
// Deployment picker
// --------------------------------------------------------------------------

export function deployPanel(S, spec, cbs) {
  const pool = State.living(S);
  const chosen = new Set([State.commander(S).id]);
  const type = MISSION_TYPES[spec.type];
  // How many you may take is set by renown, not by a constant — unless the
  // deployment itself imposes a smaller one. A hideout has one way in and it
  // is not wide enough for a company; that restriction is the whole reason a
  // hideout is dangerous long after you have outgrown the parties it produces.
  const limit = Math.min(State.deployLimit(S), spec.squadCap || 99);
  const enemy = spec.party?.strength || null;

  const render = () => {
    const rows = pool.map((s) => {
      const ok = deployable(s) || s.isCommander;
      const on = chosen.has(s.id);
      const w = woundInfo(s);
      return `<div class="pick ${on ? 'on' : ''} ${ok ? '' : 'off'}" data-p="${s.id}">
        <span class="box"></span>
        <img src="${portrait(s, 32)}" style="width:26px;height:26px;image-rendering:pixelated;border:1px solid #2c2d23">
        <span style="flex:1">
          <span style="color:var(--bone)">${RANKS[s.rank].abbr} ${esc(s.name)}</span>
          <span class="dim"> · ${originOf(s).short} ${ROLES[s.role].name}</span>
          ${w ? `<span style="color:var(--warn)"> · ${esc(w.name)}</span>` : ''}
          ${!ok ? '<span style="color:var(--bad)"> · UNFIT</span>' : ''}
        </span>
        <span class="dim">${s.deployments}d ${s.kills}k</span>
      </div>`;
    }).join('');

    const body = `
      <div class="prose"><span class="hl">${esc(type.brief)}</span></div>
      <div class="prose dim mt">Site: ${esc(State.locName(spec.site))} · ${esc(type.name)}</div>
      <div class="section-title">SELECT DEPLOYMENT — ${chosen.size} OF ${limit}
        <span class="dim" style="letter-spacing:0.1em"> · ${esc(State.renownName(S))}</span></div>
      ${spec.squadCap && spec.squadCap < State.deployLimit(S)
    ? `<div class="prose" style="color:var(--warn);margin-bottom:8px">Only ${spec.squadCap}
       can get in. Choose them carefully.</div>` : ''}
      ${enemy ? `<div class="prose ${enemy > chosen.size * 2.2 ? 'outnumbered' : ''}" style="margin-bottom:8px">
        Estimated hostile strength: <span class="hl">${enemy}</span>.
        ${enemy > chosen.size * 2.2 ? 'You will be badly outnumbered.' : ''}</div>` : ''}
      ${rows}
      <div class="prose dim mt">
        Medical kits available: ${S.medical}. A kit stabilises one casualty in the field.
        Personnel left down at extraction may not come back.
      </div>`;

    modal({
      title: 'DEPLOYMENT',
      tag: spec.site.toUpperCase(),
      body,
      foot: `<span class="spacer">SUPPLY ${S.supplies} · KITS ${S.medical}</span>
        <button class="btn" data-x="cancel">CANCEL</button>
        <button class="btn btn-major" data-x="go">DEPLOY</button>`,
      onClose: cbs.onClose,
    });

    for (const el of document.querySelectorAll('#modal [data-p]')) {
      el.onclick = () => {
        const id = el.dataset.p;
        const s = pool.find((x) => x.id === id);
        if (s.isCommander) { Audio.uiDeny(); return; }
        if (!deployable(s)) { Audio.uiDeny(); return; }
        if (chosen.has(id)) chosen.delete(id);
        else if (chosen.size < limit) chosen.add(id);
        else { Audio.uiDeny(); return; }
        Audio.uiMove();
        render();
      };
    }
    wire({
      cancel: onCloseWrap(cbs.onClose),
      go: () => {
        const squad = pool.filter((s) => chosen.has(s.id));
        squad.sort((a, b) => (b.isCommander ? 1 : 0) - (a.isCommander ? 1 : 0));
        cbs.onDeploy(squad);
      },
    });
  };
  render();
}

// --------------------------------------------------------------------------
// After-action report
// --------------------------------------------------------------------------

export function afterAction(S, result, notes, { onClose }) {
  const ok = result.success;
  const took = result.captured || null;
  const body = `
    <div class="aar-head">
      <div class="aar-verdict ${ok ? 'ok' : 'fail'}">${ok ? 'OBJECTIVE MET'
    : (took ? 'THE COMPANY WAS TAKEN' : 'WITHDRAWN')}</div>
      <div class="aar-site">${esc(result.levelName)} — DAY ${S.day}</div>
    </div>
    ${took ? `<div class="taken">
      <div class="prose">They stripped the truck and held the company ${took.days} days.
        Nobody who walked in is buried here — you came out lighter, later, and
        ${took.where ? `on the road outside ${esc(took.where)}` : 'a long way from where you started'}.</div>
      <div class="taken-cost">
        <div><span class="lbl">DAYS GONE</span><span class="val bad">${took.days}</span></div>
        <div><span class="lbl">CREDITS TAKEN</span><span class="val bad">${took.credits}</span></div>
        <div><span class="lbl">CARGO LOST</span><span class="val bad">${Object.values(took.cargo || {}).reduce((a, b) => a + b, 0)}</span></div>
        <div><span class="lbl">WEAPONS LOST</span><span class="val bad">${(took.arms || []).length}</span></div>
      </div>
    </div>` : ''}
    <div class="stat-row" style="justify-content:center">
      <div class="s"><span class="n">${result.kills}</span><span class="l">HOSTILES DOWN</span></div>
      <div class="s"><span class="n">${result.stats.shotsFired}</span><span class="l">ROUNDS FIRED</span></div>
      <div class="s"><span class="n">${result.stats.medkitsUsed}</span><span class="l">KITS USED</span></div>
      <div class="s"><span class="n">${result.recruits.length}</span><span class="l">RECRUITED</span></div>
    </div>
    <div class="section-title">CONSEQUENCES</div>
    ${notes.length ? notes.map((n) => `<div class="note ${n.tone}">${esc(n.text)}</div>`).join('')
      : '<div class="empty">NOTHING CHANGED</div>'}`;

  modal({
    title: 'AFTER ACTION',
    tag: result.success ? 'CONTRACT SATISFIED' : (took ? 'HELD AND RELEASED' : 'CONTRACT UNMET'),
    body,
    foot: `<span class="spacer">CREDITS ${S.credits}</span>
      <button class="btn btn-major" data-x="close">RETURN TO THE REACH</button>`,
    onClose,
  });
  wire({ close: onCloseWrap(onClose) });
}

// --------------------------------------------------------------------------
// Menus
// --------------------------------------------------------------------------

export function pausePanel(S, cbs, inMission) {
  modal({
    title: inMission ? 'DEPLOYMENT PAUSED' : 'FIELD TERMINAL',
    tag: `DAY ${S.day}`,
    body: `<div class="prose">${inMission
      ? 'The deployment is held. Abandoning it now counts as a withdrawal, and anyone on the ground stays there.'
      : 'Bracket is holding position.'}</div>`,
    foot: `
      <span class="spacer"></span>
      ${!inMission ? '<button class="btn" data-x="save">SAVE</button>' : ''}
      <button class="btn" data-x="controls">CONTROLS</button>
      ${inMission ? '<button class="btn btn-warn" data-x="abort">ABANDON DEPLOYMENT</button>' : '<button class="btn btn-warn" data-x="title">ABANDON COMPANY</button>'}
      <button class="btn btn-major" data-x="close">RESUME</button>`,
    onClose: cbs.onClose,
  });
  wire({
    close: onCloseWrap(cbs.onClose),
    save: cbs.onSave,
    controls: cbs.onControls,
    abort: cbs.onAbort,
    title: cbs.onTitle,
  });
}

export function controlsPanel({ onClose }) {
  modal({
    title: 'CONTROLS',
    body: `<div class="two-col">
      <div>
        <div class="section-title">ON DEPLOYMENT</div>
        ${kv('W A S D', 'Move')}
        ${kv('MOUSE', 'Look')}
        ${kv('LEFT MOUSE', 'Fire')}
        ${kv('RIGHT MOUSE', 'Aim down sights')}
        ${kv('SHIFT', 'Sprint — not from a crouch, not in the air')}
        ${kv('CTRL / C', 'Crouch. Hold with Ctrl, toggle with C.')}
        ${kv('SPACE', 'Take cover if there is any in reach; leave it if you are in it; otherwise vault')}
        ${kv('Q', 'Swap camera shoulder')}
        ${kv('R', 'Reload')}
        ${kv('E (hold)', 'Interact / stabilise a casualty')}
        ${kv('ESC', 'Pause')}
        <div class="prose dim" style="margin-top:10px;font-size:11px">
          Cover is geometry, not a bonus. Tucked behind a wall your body drops
          below it and the round hits the wall; aiming leans you out, which is
          the only way to shoot back and the only time you can be hit. Cover is
          worth nothing from the flank, so a defended position is answered by
          going round it.
        </div>
        <div class="prose dim" style="margin-top:8px;font-size:11px">
          Walk over a body to strip it. Wedges around the reticle point at
          whoever has just shot you.
        </div>
      </div>
      <div>
        <div class="section-title">SQUAD COMMAND</div>
        ${kv('MIDDLE MOUSE', 'Hold for the order wheel. The world slows while it is up.')}
        ${kv('1 – 4', 'Select that soldier. Orders then go to them alone.')}
        ${kv('` or 0', 'Clear selection — orders go to the whole squad')}
        ${kv('X', 'Suppress that position — pins whoever is there')}
        ${kv('Z', 'Flank — swing wide and come at it from the side')}
        ${kv('V', 'Fall back to the commander')}
        ${kv('G', 'Take cover — behind the nearest hard thing, facing the threat')}
        ${kv('F', 'Form up on the commander')}
        ${kv('H', 'Hold current position')}
        <div class="prose dim" style="margin-top:10px;font-size:11px">
          Every order is on the wheel; the letter keys are the shortcut once you
          know them. The order lands where you were looking when the wheel
          opened, so aim first, then choose. Suppressed soldiers stop advancing
          and shoot badly — pin a position with one soldier, flank it with
          another.
        </div>
        <div class="section-title">IN THE REACH</div>
        ${kv('SPACE', 'Halt — stops the clock as well as the truck')}
        ${kv('F', 'Fast forward, and back again')}
        ${kv('CLICK', 'Travel to a point')}
        ${kv('W A S D', 'Steer directly')}
        ${kv('SPACE', 'Halt')}
        ${kv('E', 'Enter a location')}
        ${kv('C / L / B', 'Roster / loadout / contract board')}
      </div>
    </div>`,
    foot: '<button class="btn" data-x="close">CLOSE</button>',
    onClose,
  });
  wire({ close: onCloseWrap(onClose) });
}

const kv = (k, v) => `<div style="display:flex;gap:12px;padding:4px 0;font-size:12px">
  <span style="width:112px;color:var(--ochre);letter-spacing:0.1em">${esc(k)}</span>
  <span>${esc(v)}</span></div>`;

export function aboutPanel({ onClose }) {
  modal({
    title: 'THE KETTLE REACH',
    body: `<div class="prose">
      Something large was administered from this basin once. The roads are too wide
      for the traffic on them, the power tie-ins are rated for loads nobody draws,
      and half the installations still answer to a command structure no living
      person can name.
      </div>
      <div class="prose">
      The <span class="hl">Ordnance Trust</span> was chartered off-world to inventory
      what was left and keep it working. They do keep it working. They also meter it,
      and they will let a settlement go dark rather than spend a part they cannot replace.
      </div>
      <div class="prose">
      The <span class="hl">Basin Syndics</span> are work-councils from the hab blocks
      who took the armouries when the rationing started. They want the caches opened
      now, by the people who live here. They will also strip a working water plant for
      parts and call it redistribution.
      </div>
      <div class="prose">
      You command <span class="hl">Bracket</span>: four people, one truck, and no
      retainer. Both sides are hiring.
      </div>
      <div class="prose dim mt">
      A vertical slice. Soldiers you recruit are permanent, their wounds and promotions
      carry between deployments, and the ones who die stay dead.
      </div>`,
    foot: '<button class="btn" data-x="close">CLOSE</button>',
    onClose,
  });
  wire({ close: onCloseWrap(onClose) });
}

export function finalePanel(S, { onClose }) {
  modal({
    title: 'THE SLICE ENDS HERE',
    tag: `DAY ${S.day}`,
    body: `<div class="prose">
      Bracket started this with four people and enough ammunition for one bad afternoon.
      </div>
      <div class="stat-row" style="justify-content:center">
        <div class="s"><span class="n">${State.living(S).length}</span><span class="l">STANDING</span></div>
        <div class="s"><span class="n">${S.stats.missions}</span><span class="l">DEPLOYMENTS</span></div>
        <div class="s"><span class="n">${S.stats.recruited}</span><span class="l">RECRUITED</span></div>
        <div class="s"><span class="n">${S.stats.lost}</span><span class="l">LOST</span></div>
      </div>
      <div class="prose">
      Both parties know the name now, and both have started asking what you would
      charge for something larger than a contract. That is where this build stops —
      the vertical slice is complete.
      </div>
      <div class="prose dim">
      The Reach stays open. Take more work, keep the roster alive, and see how far
      the company gets.
      </div>`,
    foot: '<button class="btn btn-major" data-x="close">CARRY ON</button>',
    onClose,
  });
  wire({ close: onCloseWrap(onClose) });
}

// --------------------------------------------------------------------------

function wire(map) {
  for (const el of document.querySelectorAll('#modal [data-x]')) {
    const fn = map[el.dataset.x];
    if (fn) el.onclick = () => { Audio.uiSelect(); fn(); };
  }
}

const onCloseWrap = (fn) => () => { closeModal(); };
