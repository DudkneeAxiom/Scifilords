// Boot, screen flow, and the seam between the two gameplay layers.
//
// The whole game is one loop: travel the Reach, take work, deploy, command a
// firefight, extract, absorb the consequences, travel again. This file owns
// the transitions between those states and nothing else.

import * as Models from './models.js';
import * as State from './state.js';
import * as UI from './ui.js';
import * as Audio from './audio.js';
import { WorldMap } from './worldmap.js';
import { Mission } from './mission.js';
import * as DATA from './data.js';
import { rng as makeRng } from './util.js';
import * as Dip from './diplomacy.js';
import * as Roster from './roster.js';
import { LOCATIONS, MISSION_TYPES } from './data.js';

const viewport = document.getElementById('viewport');

const G = {
  campaign: null,
  world: null,
  mission: null,
  screen: 'boot',
};

// Exposed for the automated tests — they need to drive the game without a
// human hand on the mouse, and reaching into module scope is worse.
window.KR = G;
// The QA probes need to inspect the simulation without playing through it.
G.dev = { State, Roster, DATA, Models, UI, makeRng, Dip, enterLocation };

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

const BOOT_LINES = [
  'DOVAN BASIN FIELD TERMINAL',
  'checking charter authority ....... NONE ON FILE',
  'mounting company record .......... BRACKET',
  'regional survey .................. KETTLE REACH',
  'signal traffic ................... DEGRADED',
  'ordnance trust relay ............. NO REPLY',
];

async function boot() {
  UI.show('loading');
  let i = 0;
  await Models.preload((done, total, name) => {
    UI.bootProgress(done / total, i < BOOT_LINES.length && done % 7 === 0
      ? BOOT_LINES[i++] : `loading ${name}`);
  });
  UI.bootProgress(1, 'ready');
  await new Promise((r) => setTimeout(r, 350));
  toTitle();
}

// --------------------------------------------------------------------------
// Title
// --------------------------------------------------------------------------

function toTitle() {
  teardown();
  G.screen = 'title';
  UI.show('title');
  document.getElementById('btn-continue').disabled = !State.hasSave();
}

document.querySelector('#title .title-menu').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  Audio.resume();
  Audio.uiSelect();
  const act = btn.dataset.act;
  if (act === 'new') startNew();
  else if (act === 'continue') startLoaded();
  else if (act === 'controls') UI.controlsPanel({ onClose: () => {} });
  else if (act === 'about') UI.aboutPanel({ onClose: () => {} });
});

function startNew() {
  State.clearSave();
  G.campaign = State.newCampaign();
  toWorld(true);
}

function startLoaded() {
  const S = State.load();
  if (!S) { startNew(); return; }
  G.campaign = S;
  toWorld(false);
}

// --------------------------------------------------------------------------
// Strategic layer
// --------------------------------------------------------------------------

function toWorld(isNew) {
  teardown();
  G.screen = 'world';
  UI.show('worldhud');
  UI.clearToasts();

  G.world = new WorldMap({
    campaign: G.campaign,
    container: viewport,
    onEncounter: handleEncounter,
    onHud: (h) => UI.renderWorldHud(h),
  });
  G.world.start();

  // The speed chips are part of the HUD rather than of the map, so they are
  // wired once here instead of being rebuilt every frame by the renderer.
  for (const b of document.getElementById('wh-spd').children) {
    b.onclick = () => G.world?.setSpeed(Number(b.dataset.spd));
  }

  if (isNew) {
    // The opening brief, delivered as one panel and then never again.
    UI.modal({
      title: 'BRACKET',
      tag: 'DAY 1',
      body: `<div class="prose">
        You have three people, a truck with a bad injector, and enough ammunition
        for one bad afternoon. You are camped outside Vetch Crossing because it is
        the only place in the Reach that will let an unaffiliated company park.
        </div>
        <div class="prose">
        Two postings are open on the board. One is Syndic work at the Grellan Array —
        a survey detail went in and did not come out. The other pays better and
        involves putting charges on a Trust mast.
        </div>
        <div class="prose dim mt">
        Click the ground to travel. Press <span class="hl">B</span> for the contract
        board, <span class="hl">C</span> for your roster, and <span class="hl">E</span>
        to enter a location you are standing on.
        </div>`,
      foot: `<button class="btn" data-x="controls">CONTROLS</button>
        <button class="btn btn-major" data-x="close">BEGIN</button>`,
      onClose: () => {},
    });
    for (const el of document.querySelectorAll('#modal [data-x]')) {
      el.onclick = () => {
        Audio.uiSelect();
        if (el.dataset.x === 'controls') UI.controlsPanel({ onClose: () => openBoard() });
        else {
          UI.closeModal();
          // The commander's opening commission is the first real decision the
          // player makes, before they have even looked at the board.
          resolvePerks(() => openBoard());
        }
      };
    }
  } else if (G.campaign.finale && !G.campaign.finaleShown) {
    G.campaign.finaleShown = true;
    UI.finalePanel(G.campaign, { onClose: () => {} });
  }
}

/**
 * Put the tab strip on whichever company screen just opened.
 *
 * The screens themselves know nothing about each other; this is the only place
 * that knows they are siblings. Switching tabs opens the next panel straight
 * over the current one without going via closeModal, so the world stays paused
 * for the whole visit and unpauses once, when you finally close.
 */
function tabbed(id) {
  UI.companyTabs(id, (next) => openCompanyScreen(next));
}

function openCompanyScreen(id) {
  if (id === 'roster') openRoster();
  else if (id === 'loadout') openLoadout();
  else if (id === 'inventory') openInventory();
  else if (id === 'holdings') openHoldings();
  else if (id === 'character') openCharacter();
  else if (id === 'diplomacy') openDiplomacy();
  else if (id === 'board') openBoard();
}

function openBoard() {
  if (!G.campaign) return;
  G.world?.setPaused(true);
  UI.contractPanel(G.campaign, {
    onAccept: (id) => {
      State.acceptContract(G.campaign, id);
      UI.closeModal();
      G.world?.setPaused(false);
      const c = State.activeContract(G.campaign);
      if (c) UI.toast('CONTRACT', `Travel to ${State.locName(c.site)}`, 'good');
    },
    onClose: () => G.world?.setPaused(false),
  });
  tabbed('board');
}

function openRoster() {
  G.world?.setPaused(true);
  UI.rosterPanel(G.campaign, {
    onClose: () => G.world?.setPaused(false),
    onLoadout: () => openLoadout(),
  });
  tabbed('roster');
}

function openLoadout() {
  G.world?.setPaused(true);
  UI.loadoutPanel(G.campaign, { onClose: () => G.world?.setPaused(false) });
  tabbed('loadout');
}

function openHoldings() {
  G.world?.setPaused(true);
  UI.holdingsPanel(G.campaign, { onClose: () => G.world?.setPaused(false) });
  tabbed('holdings');
}

function openDiplomacy() {
  G.world?.setPaused(true);
  UI.diplomacyPanel(G.campaign, { onClose: () => G.world?.setPaused(false) });
  tabbed('diplomacy');
}

function openCharacter() {
  G.world?.setPaused(true);
  UI.characterPanel(G.campaign, { onClose: () => G.world?.setPaused(false) });
  tabbed('character');
}

function openInventory() {
  G.world?.setPaused(true);
  UI.inventoryPanel(G.campaign, {
    onClose: () => G.world?.setPaused(false),
    onLoadout: () => openLoadout(),
  });
  tabbed('inventory');
}

/**
 * Anyone promoted is holding a training choice. Resolve them all before the
 * player carries on — an unspent promotion is the most interesting decision
 * available, so it should not be possible to miss it.
 */
function resolvePerks(after) {
  if (!State.awaitingAnyPerk(G.campaign)) { after?.(); return; }
  G.world?.setPaused(true);
  UI.resolvePendingPerks(G.campaign, () => {
    UI.closeModal();
    State.save(G.campaign);
    G.world?.setPaused(false);
    after?.();
  });
}

/** Entering a location: services if it has them, deployment if work is here. */
function enterLocation() {
  const S = G.campaign;
  const loc = State.locationAt(S, 38);
  if (!loc) return;
  const c = State.activeContract(S);
  const hasWork = c && c.site === loc.id;

  const owned = State.isHolding(S, loc.id);
  const seizable = !owned && !!loc.missions;

  // Somebody in town may want a word. Rolled on arrival rather than on the day
  // tick, so a favour is something you walk into rather than something that was
  // waiting in a list — and on its own stream, so asking does not perturb the
  // rolls every other system is making off the campaign seed.
  if (loc.services.length) {
    // Mixed off the whole id rather than its length: two towns with names of
    // the same length were rolling the identical request on the same day, which
    // reads as a bug the first time a player notices it.
    let h = 0;
    for (let i = 0; i < loc.id.length; i++) h = (h * 31 + loc.id.charCodeAt(i)) | 0;
    State.offerFavour(S, loc.id, makeRng(S.seed + S.day * 977 + Math.abs(h)));
  }

  if (!loc.services.length) {
    // Ruins and outposts are not places you visit — they are places you assault.
    if (hasWork) return openDeploy(specFor(loc, c));
    G.world?.setPaused(true);
    UI.modal({
      title: loc.name.toUpperCase(),
      tag: owned ? 'BRACKET HOLDING' : loc.kind.toUpperCase(),
      body: `<div class="prose">${UIesc(loc.detail)}</div>
        ${owned ? '<div class="prose mt">This ground is yours. Build it up from the holdings screen.</div>'
    : seizable ? `<div class="prose mt">Nobody is paying for this one. Break whoever holds
        ${UIesc(loc.name)} and stand in it long enough, and it produces for Bracket from
        then on.</div>`
      : '<div class="prose dim mt">There is no work here for Bracket right now.</div>'}`,
      foot: `${seizable ? '<button class="btn btn-warn" data-x="seize">SEIZE THIS PLACE</button>' : ''}
        <button class="btn" data-x="close">WITHDRAW</button>`,
      onClose: () => G.world?.setPaused(false),
    });
    document.querySelector('#modal [data-x="close"]').onclick = () => {
      Audio.uiBack(); UI.closeModal();
    };
    const sz = document.querySelector('#modal [data-x="seize"]');
    if (sz) sz.onclick = () => { Audio.uiSelect(); startSeizure(loc); };
    return;
  }

  G.world?.setPaused(true);

  // Arriving somewhere opens a menu of things to do, not a wall of services.
  // Every verb returns here when it closes.
  const openMenu = () => {
    UI.settlementMenu(S, loc, {
      canSeize: seizable,
      onClose: () => G.world?.setPaused(false),
      onVerb: (verb) => {
        if (verb === 'deploy') { UI.closeModal(); openDeploy(specFor(loc, c)); return; }
        if (verb === 'seize') { Audio.uiSelect(); startSeizure(loc); return; }
        if (verb === 'raid') { UI.closeModal(); startRaid(loc); return; }
        if (verb === 'pit') { startPit(loc); return; }
        if (verb === 'broker') {
          UI.brokerPanel(S, loc, { onClose: () => openMenu(), onDone: () => openMenu() });
          return;
        }
        if (verb === 'favour') {
          UI.favourPanel(S, loc, { onClose: () => openMenu(), onDone: () => openMenu() });
          return;
        }
        if (verb === 'holdings') {
          UI.holdingsPanel(S, { onClose: () => openMenu() });
          return;
        }
        if (verb === 'board') {
          UI.contractPanel(S, {
            onAccept: (id) => { State.acceptContract(S, id); openMenu(); },
            onClose: () => openMenu(),
          });
          return;
        }
        if (verb === 'market') {
          UI.inventoryPanel(S, { onClose: () => openMenu(), onLoadout: () => openLoadout() });
          return;
        }
        if (verb === 'rest') {
          State.advanceTime(S, 20);
          State.pushLog(S, 'The company stood down for a day.');
          openMenu();
          return;
        }
        // Recruiting and medical still live on the old services panel, which is
        // the right shape for a list of people and stock.
        openSettlement();
      },
    });
  };

  const openSettlement = () => {
    UI.settlementPanel(S, loc, {
      onRaid: (l) => { UI.closeModal(); startRaid(l); },
      onPit: (l) => startPit(l),
      onRefresh: () => openSettlement(),
      onBoard: () => {
        UI.contractPanel(S, {
          onAccept: (id) => { State.acceptContract(S, id); openSettlement(); },
          onClose: () => openSettlement(),
        });
      },
      onTrade: () => UI.inventoryPanel(S, {
        onClose: () => openSettlement(),
        onLoadout: () => openLoadout(),
      }),
      onClose: () => openMenu(),
    });
    // Settlements can be taken as well, if the company is willing.
    if (seizable) {
      const foot = document.querySelector('#modal .modal-foot');
      const b = document.createElement('button');
      b.className = 'btn btn-warn';
      b.textContent = 'SEIZE';
      b.onclick = () => { Audio.uiSelect(); startSeizure(loc); };
      foot.insertBefore(b, foot.querySelector('[data-x="close"]'));
    }
    // A settlement that is itself the contract site gets a deploy action.
    if (hasWork) {
      const foot = document.querySelector('#modal .modal-foot');
      const b = document.createElement('button');
      b.className = 'btn btn-major';
      b.textContent = 'DEPLOY';
      b.onclick = () => {
        Audio.uiSelect();
        openDeploy(specFor(loc, c));
      };
      foot.appendChild(b);
    }
  };
  openMenu();
}

const UIesc = (s) => String(s).replace(/[&<>"]/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// --------------------------------------------------------------------------
// Encounters on the road
// --------------------------------------------------------------------------

function handleEncounter(party) {
  // Never let a road encounter overwrite a panel the player is already using —
  // it would silently replace the deployment picker or a settlement screen.
  if (UI.modalOpen()) return;
  const S = G.campaign;
  G.world?.setPaused(true);
  UI.encounterPanel(S, party, {
    onClose: () => G.world?.setPaused(false),
    onAvoid: () => {
      UI.closeModal();
      G.world?.setPaused(false);
      // Back off a little so the same party does not immediately re-trigger.
      const dx = S.pos.x - party.x, dz = S.pos.z - party.z;
      const d = Math.hypot(dx, dz) || 1;
      S.pos.x += (dx / d) * 34;
      S.pos.z += (dz / d) * 34;
      State.advanceTime(S, 1.2);
    },
    onSend: () => {
      // Hand it to the sergeants. Same consequence pipeline as a played
      // deployment — see State.autoResolve.
      UI.closeModal();
      const S2 = G.campaign;
      const squad = State.ready(S2).slice(0, State.deployLimit(S2));
      if (!squad.length) { UI.toast('', 'Nobody is fit to send', 'bad'); return; }
      const spec = { type: 'skirmish', site: 'roadside', layout: 'roadside', party };
      const result = State.autoResolve(S2, spec, squad);
      const notes = State.applyMissionResult(S2, result);
      G.world?.setPaused(false);
      result.levelName = party.name || 'THE ROAD';
      UI.afterAction(S2, result, notes, {
        onClose: () => { G.world?.setPaused(false); State.save(S2); },
      });
    },
    onFight: () => {
      UI.closeModal();
      // A walker is not a skirmish. It gets its own template, and it gets open
      // ground to be fought on — a Titan in a hab quarter is a Titan you cannot
      // see until it is on top of you.
      const boss = party.kind === 'titan';
      const lair = party.kind === 'lair';
      openDeploy({
        type: boss ? 'titan' : lair ? 'lair' : 'skirmish',
        site: lair ? 'compound' : 'roadside',
        layout: lair ? 'compound' : 'roadside',
        // One way in. You cannot bring the company.
        squadCap: lair ? 4 : undefined,
        party,
      });
    },
    onTalk: () => {
      UI.closeModal();
      G.world?.setPaused(false);
      const lines = {
        trust: 'The clerk records your company name, your strength, and the fact that you are unaffiliated. He does not thank you.',
        syndic: 'They share water and a rumour: the Trust has been moving something heavy along the north rim at night.',
        null: 'They have nothing to trade but talk, and they trade it generously.',
      };
      const key = party.faction || 'null';
      State.pushLog(S, lines[key] || lines.null);
      UI.toast('ROADSIDE', lines[key] || lines.null, 'info');
      State.advanceTime(S, 1);
      // Talking to a faction is a small, real reputation move.
      if (party.faction) S.rep[party.faction] = (S.rep[party.faction] || 0) + 0.5;
    },
    onAid: () => {
      UI.closeModal();
      G.world?.setPaused(false);
      if (S.supplies < 2) {
        UI.toast('SUPPLY', 'Bracket has nothing to spare', 'bad');
        return;
      }
      S.supplies -= 2;
      S.rep.syndic = (S.rep.syndic || 0) + 1;
      State.pushLog(S, 'Gave stores to a column of displaced families on the road.', 'good');
      UI.toast('SUPPLIES GIVEN', 'Word of it will reach the Flats', 'good');
      State.advanceTime(S, 1.5);
    },
  });
}

// --------------------------------------------------------------------------
// Deployment
// --------------------------------------------------------------------------

/** Everything the mission layer needs to build a deployment at a location. */
function specFor(loc, contract) {
  return {
    type: contract.type,
    site: loc.id,
    layout: loc.layout || 'array',
    siteName: loc.name,
    // A faction's own ground is defended by that faction; neutral sites by
    // whoever is squatting there.
    enemyFaction: loc.faction || (contract.employer === 'trust' ? 'syndic' : 'raider'),
    contract,
  };
}

/** Assault a location to take it for the company. */
/**
 * Rob a settlement. Deliberately reachable from the same screen you buy rations
 * on — the interesting decision is between being a customer here and emptying
 * the place once, and burying it behind a menu would hide that.
 */
/**
 * The pit. Straight in — no deployment picker, because there is no deployment
 * to pick: it is the commander, alone, and putting a squad screen in front of
 * that would be a lie about what is happening.
 */
function startPit(loc) {
  const S = G.campaign;
  UI.closeModal();
  startMission({
    type: 'pit',
    site: loc.id,
    layout: loc.layout || 'settlement',
    siteName: loc.name,
    enemyFaction: 'raider',
  }, [State.commander(S)]);
}

function startRaid(loc) {
  const S = G.campaign;
  const rel = State.relationTier(S, loc.id).name;
  UI.modal({
    title: `RAID ${loc.name.toUpperCase()}`,
    tag: 'THIS CANNOT BE UNDONE',
    body: `<div class="prose">Go in, break open what they keep, and carry out what
      the truck will hold. Every store you crack brings more of them into the street.</div>
      <div class="prose mt">${UIesc(loc.name)} currently regards Bracket as
      <span class="hl">${UIesc(rel)}</span>. Afterwards they will not sell to you and
      will not put anyone forward${loc.faction
    ? `, and ${UIesc(FACTIONS[loc.faction].name)} will hear about it` : ''}.</div>
      <div class="prose dim mt">Your own people will not love you for it either.</div>`,
    foot: '<button class="btn btn-warn" data-x="go">GO IN</button>'
      + '<button class="btn" data-x="close">THINK BETTER OF IT</button>',
    onClose: () => G.world?.setPaused(false),
  });
  document.querySelector('#modal [data-x="close"]').onclick = () => {
    Audio.uiBack(); UI.closeModal(); G.world?.setPaused(false);
  };
  document.querySelector('#modal [data-x="go"]').onclick = () => {
    Audio.uiSelect();
    UI.closeModal();
    openDeploy({
      type: 'raid',
      site: loc.id,
      layout: loc.layout || 'settlement',
      siteName: loc.name,
      enemyFaction: loc.faction || 'raider',
    });
  };
}

function startSeizure(loc) {
  const S = G.campaign;
  const offer = State.seizureOffer(S, loc.id);
  if (!offer) { UI.toast('', 'This place cannot be taken', 'bad'); return; }
  S.contracts.forEach((x) => { x.accepted = false; });
  S.contracts.push(offer);
  offer.accepted = true;
  UI.closeModal();
  openDeploy(specFor(loc, offer));
}

function openDeploy(spec) {
  const S = G.campaign;
  G.world?.setPaused(true);
  UI.deployPanel(S, spec, {
    onClose: () => G.world?.setPaused(false),
    onDeploy: (squad) => {
      UI.closeModal();
      startMission(spec, squad);
    },
  });
}

async function startMission(spec, squad) {
  teardown();
  G.screen = 'mission';
  UI.show('hud');
  UI.clearToasts();

  G.mission = new Mission({
    campaign: G.campaign,
    spec,
    squad,
    container: viewport,
    onHud: (h) => UI.renderMissionHud(h),
    onToast: (t, b, tone) => UI.toast(t, b, tone),
    onIntro: (info) => UI.missionIntro(info, 6.0),
    onWheel: (w) => UI.renderCommandWheel(w),
    onEnd: (result) => endMission(spec, result),
  });
  await G.mission.start();
  // Pointer lock is requested when the cinematic hands over, not before —
  // grabbing the mouse during the fly-in just steals the cursor.
}

function endMission(spec, result) {
  const S = G.campaign;
  const notes = State.applyMissionResult(S, result);
  State.save(S);

  UI.show('worldhud');
  UI.afterAction(S, result, notes, {
    onClose: () => {
      const wasFinale = S.finale && !S.finaleShown;
      toWorld(false);
      // Promotions earned on this deployment are spent before anything else.
      resolvePerks(() => {
        if (wasFinale) {
          S.finaleShown = true;
          setTimeout(() => UI.finalePanel(S, { onClose: () => {} }), 260);
        }
      });
    },
  });
}

// --------------------------------------------------------------------------
// Global keys
// --------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  Audio.resume();

  if (UI.modalOpen()) {
    if (k === 'escape') { Audio.uiBack(); UI.closeModal(); }
    // On a company screen the same keys that open these panels move between
    // them, because they are tabs of one window rather than seven panels.
    else if (document.querySelector('#modal .mtabs')
      && !/^(input|textarea)$/i.test(e.target?.tagName || '')) {
      const t = UI.COMPANY_TABS.find((x) => x.key.toLowerCase() === k);
      if (t) { Audio.uiSelect(); openCompanyScreen(t.id); }
    }
    return;
  }

  if (G.screen === 'world') {
    if (k === 'c') { Audio.uiSelect(); openRoster(); }
    else if (k === 'l') { Audio.uiSelect(); openLoadout(); }
    else if (k === 'i') { Audio.uiSelect(); openInventory(); }
    else if (k === 'k') { Audio.uiSelect(); openHoldings(); }
    else if (k === 'v') { Audio.uiSelect(); openCharacter(); }
    else if (k === 'p') { Audio.uiSelect(); openDiplomacy(); }
    else if (k === 'b') { Audio.uiSelect(); openBoard(); }
    else if (k === 'e') { Audio.uiSelect(); enterLocation(); }
    else if (k === 'escape') { Audio.uiSelect(); openPause(false); }
  } else if (G.screen === 'mission') {
    if (k === 'escape' && G.mission && !G.mission.over) {
      // Mission owns its own pause flag; the menu just reflects it.
      setTimeout(() => { if (G.mission?.paused) openPause(true); }, 0);
    }
  }
});

document.querySelector('#worldhud .wh-bottom').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn || btn.disabled) return;
  Audio.uiSelect();
  const a = btn.dataset.act;
  if (a === 'roster') openRoster();
  else if (a === 'loadout') openLoadout();
  else if (a === 'inventory') openInventory();
  else if (a === 'holdings') openHoldings();
  else if (a === 'character') openCharacter();
  else if (a === 'diplomacy') openDiplomacy();
  else if (a === 'board') openBoard();
  else if (a === 'enter') enterLocation();
  else if (a === 'menu') openPause(false);
});

function openPause(inMission) {
  if (!inMission) G.world?.setPaused(true);
  UI.pausePanel(G.campaign, {
    onClose: () => {
      if (inMission) { G.mission.paused = false; G.mission.requestLock(); }
      else G.world?.setPaused(false);
    },
    onSave: () => {
      const ok = State.save(G.campaign);
      UI.toast('SAVED', ok ? 'Company record written' : 'Save failed', ok ? 'good' : 'bad');
    },
    onControls: () => UI.controlsPanel({
      onClose: () => openPause(inMission),
    }),
    onAbort: () => {
      UI.closeModal();
      G.mission.endMission(false, 'aborted');
    },
    onTitle: () => {
      UI.closeModal();
      State.save(G.campaign);
      toTitle();
    },
  }, inMission);
}

// --------------------------------------------------------------------------

function teardown() {
  G.world?.dispose();
  G.mission?.dispose();
  G.world = null;
  G.mission = null;
  viewport.innerHTML = '';
  UI.closeModal();
}

// Autosave whenever the player returns to the map, and on the way out.
window.addEventListener('beforeunload', () => {
  if (G.campaign && G.screen === 'world') State.save(G.campaign);
});

boot();
