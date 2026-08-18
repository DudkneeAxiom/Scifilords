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
    onBattle: handleMapBattle,
    onEvent: handleMapEvent,
    onHud: (h) => {
      // Never leave the Reach paused with nothing on top of it.
      //
      // The world is paused by whatever opens a panel and resumed by that
      // panel's close handler, which means any path that loses its close
      // handler strands the campaign: the map stops, the clock stops, and
      // every click lands on a world that is no longer running. That is what a
      // promotion dismissed with Escape did after a seizure. Rather than chase
      // each such path, the invariant is asserted here every frame — if no
      // panel is up, the Reach runs.
      if (G.world?.paused && !UI.modalOpen() && !G.visiting) G.world.setPaused(false);
      UI.renderWorldHud(h);
    },
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
    State.offerFavour(S, loc.id, makeRng(S.seed + S.day * 977 + Math.abs(h)),
      State.lordAt(S, loc.id));
    // A delivery bound HERE hands itself in the moment you arrive.
    for (const d of State.arrivalFavours(S, loc.id)) {
      UI.toast('DELIVERED', `${d.who} paid ${d.pay}`, 'good');
    }
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
  // Mark the whole visit, not each panel.
  //
  // Every verb closes its screen and reopens the menu, and for one frame in
  // between nothing is up. The world-resume guard saw that gap and started the
  // Reach again — which let a road encounter replace the settlement menu
  // mid-visit, and made anything walking the menu fail whenever a frame took
  // longer than usual.
  G.visiting = true;
  // Through the gate: the company is indoors, so the token leaves the map for
  // the duration — a visit is being somewhere, not parking outside it.
  G.world?.setInside(true);
  const leave = () => {
    G.visiting = false;
    G.world?.setInside(false);
    G.world?.setPaused(false);
  };

  const openMenu = () => {
    UI.settlementMenu(S, loc, {
      canSeize: seizable,
      canWalk: !!loc.services.length && (loc.layout || 'settlement') === 'settlement',
      onClose: leave,
      onVerb: (verb) => {
        if (verb === 'walk') { G.visiting = false; UI.closeModal(); startVisit(loc); return; }
        if (verb === 'deploy') { G.visiting = false; UI.closeModal(); openDeploy(specFor(loc, c)); return; }
        if (verb === 'seize') { G.visiting = false; Audio.uiSelect(); startSeizure(loc); return; }
        if (verb === 'raid') { G.visiting = false; UI.closeModal(); startRaid(loc); return; }
        if (verb === 'pit') { G.visiting = false; startPit(loc); return; }
        if (verb === 'broker') {
          UI.brokerPanel(S, loc, { onClose: () => openMenu(), onDone: () => openMenu() });
          return;
        }
        if (verb === 'favour') {
          UI.favourPanel(S, loc, { onClose: () => openMenu(), onDone: () => openMenu() });
          return;
        }
        if (verb === 'debt') {
          UI.debtPanel(S, loc, { onClose: () => openMenu(), onDone: () => openMenu() });
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
        if (verb === 'wait') {
          // Six hours indoors while the Reach runs. Party tokens are synced
          // by the map's update loop, which is paused behind this panel — so
          // sync them here, and the roads visibly move while you wait.
          State.advanceTime(S, 6);
          G.world?.syncParties();
          openMenu();
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
// Walking a town
// --------------------------------------------------------------------------

/**
 * The settlement on foot — the site the company would otherwise fight over,
 * walked as a place. Launched from the settlement menu; areas hand back their
 * id and the matching panel opens over the paused walk; the south gate ends
 * it and puts the company back on the map.
 */
function startVisit(loc) {
  const S = G.campaign;
  const fav = State.favourAt(S, loc.id);
  const spec = {
    type: 'visit', site: loc.id, layout: loc.layout || 'settlement',
    siteName: loc.name, services: loc.services,
    hasFavour: !!fav, favourWho: fav?.who || null, locId: loc.id,
    companion: State.companionAt(S, loc.id),
    // A lord at court, when the day's rotation seats one in this town.
    lord: State.lordAt(S, loc.id),
  };
  // The commander walks alone. A squad in tow turns every lane into a
  // pathing exercise, and nobody brings four riflemen to buy rations.
  startMission(spec, [State.commander(S)]);
}

function handleTownArea(spec, area) {
  const S = G.campaign;
  const loc = State.locById(spec.locId);
  const m = G.mission;
  if (!m || m.over) return;
  m.paused = true;
  if (document.pointerLockElement) document.exitPointerLock();
  const back = () => { if (G.mission && !G.mission.over) G.mission.paused = false; };

  const openTrade = () => UI.inventoryPanel(S, { onClose: back, onLoadout: () => openLoadout() });
  const openBoardHere = () => UI.contractPanel(S, {
    onAccept: (id) => { State.acceptContract(S, id); openBoardHere(); },
    onClose: back,
  });
  // The services panel, without onRaid/onPit — the panel hides those buttons
  // when the callbacks are absent, and robbing a town mid-stroll is a
  // decision for the map, not for a doorway.
  const openServices = () => UI.settlementPanel(S, loc, {
    onRefresh: () => openServices(),
    onBoard: () => UI.contractPanel(S, {
      onAccept: (id) => { State.acceptContract(S, id); openServices(); },
      onClose: () => openServices(),
    }),
    onTrade: () => UI.inventoryPanel(S, {
      onClose: () => openServices(), onLoadout: () => openLoadout(),
    }),
    onClose: back,
  });
  const openFavour = () => UI.favourPanel(S, loc, { onClose: back, onDone: back });

  // A word first, business second: each person gets a line in their own
  // voice and options that lead into the appropriate screen — the panels
  // open OVER the chat, the way settlement verbs already work.
  const CHATS = {
    market: (() => {
      const owned = !!(S.workshops || {})[loc.id];
      return {
        who: 'The trader',
        // A trader with news shares it — the rumour reads the real price
        // tables, so hauling goods where it points finds the promised spread.
        line: 'Prices are what the road makes them. Everything on these stalls '
          + 'came through that gate one way or another — have a look.'
          + (State.priceRumour(S, loc.id)
            ? ' ' + State.priceRumour(S, loc.id).text : '')
          + (owned ? ` Your stall took ${State.workshopIncome(S, loc.id)} yesterday.` : ''),
        options: [
          { id: 'trade', label: 'SEE THE STALLS', major: true },
          ...(loc.services?.includes('market') && !owned
            ? [{ id: 'stall', label: `BUY THE STALL RIGHTS (${State.WORKSHOP_COST})` }] : []),
          ...(owned ? [{ id: 'sellstall', label: `SELL THE STALL (${State.WORKSHOP_SELL})` }] : []),
        ],
      };
    })(),
    board: {
      who: 'The posting clerk',
      line: 'Work goes up when it comes in, and it has been coming in. '
        + 'Read the board; ask me nothing the board can answer.',
      options: [{ id: 'board', label: 'READ THE BOARD', major: true }],
    },
    recruit: (() => {
      const band = State.mercBandAt(S, loc.id);
      return {
        who: 'The hiring agent',
        line: 'People come through looking to sign with anyone who feeds them. '
          + 'Some of them can even shoot. I keep the honest list.'
          + (band ? ` ${band.name} are drinking in the back — ${band.size} guns, `
            + `${band.fee} for three days, paid up front.` : ''),
        options: [
          { id: 'services', label: 'WHO IS LOOKING FOR WORK', major: true },
          ...(band ? [{ id: 'mercs', label: `HIRE ${band.name.toUpperCase()} (${band.fee})` }] : []),
        ],
      };
    })(),
    medical: {
      who: 'The medic',
      line: 'Kits, beds, and no questions. Bring your wounded in before the '
        + 'rot does the deciding for you.',
      options: [{ id: 'services', label: 'INTO THE INFIRMARY', major: true }],
    },
    favour: {
      who: spec.favourWho || 'A notable',
      line: 'You will want to hear this from me, not from the street.',
      options: [{ id: 'favour', label: 'HEAR THEM OUT', major: true }],
    },
    companion: spec.companion ? {
      who: spec.companion.name,
      line: spec.companion.line + ' The fee is ' + spec.companion.fee + ', once, and I stay hired.'
        // What they do for the COMPANY — the officer effect is the real pitch.
        + (DATA.OFFICERS[spec.companion.id]
          ? ` [${DATA.OFFICERS[spec.companion.id].title}: ${DATA.OFFICERS[spec.companion.id].gift}]` : ''),
      options: [{ id: 'hire', label: 'SIGN THEM ON (' + spec.companion.fee + ')', major: true }],
    } : null,
    lord: spec.lord ? (() => {
      // Re-read from state: regard may have moved since the walk began.
      const lord = State.lordById(S, spec.lord.id) || spec.lord;
      const reg = lord.regard || 0;
      const recv = reg >= 5 ? 'They receive you as a friend.'
        : reg <= -5 ? 'They receive you coldly, and do not pretend otherwise.'
          : 'They receive you with court manners and nothing warmer.';
      return {
        who: lord.name,
        line: `${DATA.FACTIONS[lord.faction]?.name || 'The court'} holds this town, `
          + `and today its court holds me. It is said I ${State.temperOf(lord).line}. ${recv}`,
        options: [
          { id: 'gift', label: 'SEND A GIFT (300)' },
          ...(S.ownFaction && lord.faction !== S.ownFaction.id
            ? [{ id: 'defect', label: 'ASK THEM TO TAKE YOUR COLOURS', major: true }] : []),
        ],
      };
    })() : null,
    gate: {
      who: 'The gate watch',
      line: 'The road is the road and the walls are ours. Say the word when '
        + 'you want the one traded for the other.',
      options: [{ id: 'leave', label: 'BACK TO THE ROAD', major: true }],
    },
  };
  const chat = CHATS[area];
  if (!chat) { back(); return; }
  UI.townChat(S, chat, {
    onClose: back,
    onPick: (id) => {
      if (id === 'trade') openTrade();
      else if (id === 'board') openBoardHere();
      else if (id === 'services') openServices();
      else if (id === 'favour') openFavour();
      else if (id === 'hire') {
        const res = State.hireCompanion(S, spec.companion.id);
        if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
        UI.closeModal();
        UI.toast('SIGNED ON', res.soldier.name + ' joins the company', 'good');
        spec.companion = null;
        back();
      }
      else if (id === 'gift') {
        const res = State.giftLord(S, spec.lord.id);
        if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
        Audio.uiSelect();
        UI.toast('GIFT SENT', 'It was noted at court', 'good');
      }
      else if (id === 'defect') {
        const res = State.courtDefection(S, spec.lord.id);
        if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
        UI.closeModal();
        UI.toast('SWORN', 'A lord has taken your colours', 'good');
        back();
      }
      else if (id === 'stall') {
        const res = State.buyWorkshop(S, spec.locId);
        if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
        Audio.uiSelect();
        UI.toast('STALL BOUGHT', 'It pays what the town can pay', 'good');
      }
      else if (id === 'sellstall') {
        const res = State.sellWorkshop(S, spec.locId);
        if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
        Audio.uiSelect();
        UI.toast('STALL SOLD', `${State.WORKSHOP_SELL} back on the ledger`, 'world');
      }
      else if (id === 'mercs') {
        const res = State.hireMercBand(S, spec.locId);
        if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
        Audio.uiSelect();
        UI.closeModal();
        UI.toast('HIRED', `${res.band.name} ride with Bracket for three days`, 'good');
        back();
      }
      else if (id === 'leave') {
        // closeModal fires the chat's onClose (which unpauses) and then the
        // walk ends — the order is harmless, and endMission handles the rest.
        UI.closeModal();
        G.mission?.endMission(true, 'left');
      }
    },
  });
}

// --------------------------------------------------------------------------
// Encounters on the road
// --------------------------------------------------------------------------

function handleEncounter(party, opts = {}) {
  // Never let a road encounter overwrite a panel the player is already using —
  // it would silently replace the deployment picker or a settlement screen.
  if (UI.modalOpen()) return;
  const S = G.campaign;
  G.world?.setPaused(true);
  UI.encounterPanel(S, party, {
    cornered: !!opts.cornered,
    onClose: () => G.world?.setPaused(false),
    // Buy your way past. The band takes the money and moves off the road.
    // Deserters pressed by better odds hand over what they carry and walk.
    onYield: (p) => {
      UI.closeModal();
      G.world?.setPaused(false);
      const r2 = makeRng((S.seed + S.day * 53 + 11) | 0);
      if (r2() < 0.75) {
        const take = 60 + Math.floor(r2() * 120);
        S.credits += take;
        S.cargo.salvage = (S.cargo.salvage || 0) + 1;
        S.parties = S.parties.filter((x) => x.id !== p.id);
        State.pushLog(S, 'A deserter band stood down and paid its way past Bracket.', 'good');
        UI.toast('STOOD DOWN', take + ' credits and their spare kit', 'good');
      } else {
        State.pushLog(S, 'The deserters chose to run instead of yield.', 'bad');
        UI.toast('THEY SCATTER', 'Not today, they decided', 'info');
        p.routed = 12;
        p.routFrom = { x: S.pos.x, z: S.pos.z };
      }
    },
    onToll: (p) => {
      const res = State.payToll(S, p);
      if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
      UI.closeModal();
      G.world?.setPaused(false);
      S.parties = S.parties.filter((x) => x.id !== p.id);
      UI.toast('PAID', `${res.cost} to be let past`, 'bad');
    },
    // Let a patrol look in the truck.
    onInspect: (p) => {
      const res = State.submitToInspection(S, p, makeRng(S.seed + S.day * 31 + 7));
      UI.closeModal();
      G.world?.setPaused(false);
      UI.toast(res.seized ? 'CONFISCATED' : 'WAVED THROUGH',
        res.seized ? `${res.seized.n} ${DATA.GOODS[res.seized.id]?.name || ''} taken`
          : 'They found nothing they wanted',
        res.seized ? 'bad' : 'good');
    },
    onRefuse: (p) => {
      State.refuseInspection(S, p);
      UI.closeModal();
      G.world?.setPaused(false);
      UI.toast('REFUSED', 'They will remember it', 'bad');
    },
    onAvoid: () => {
      UI.closeModal();
      // Breaking contact is attempted, not granted.
      //
      // This used to always work, so a fight was never forced: you could meet
      // anything at all, decline, and drive off. That made losing a battle
      // something the player had to opt into, and the capture rules for losing
      // one almost unreachable.
      if (party.hostileToPlayer && Math.random() > State.escapeChance(S, party)) {
        State.advanceTime(S, 0.4);
        UI.toast('RUN DOWN', `${party.name} is faster than you are`, 'bad');
        // Straight back into it, with the option to run now spent.
        setTimeout(() => handleEncounter(party, { cornered: true }), 260);
        return;
      }
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
        onClose: () => {
          const done = () => { G.world?.setPaused(false); State.save(S2); };
          if ((result.fieldSpoils || []).length || (result.captives || []).length) {
            UI.spoilsPanel(S2, result, { onClose: done });
          } else done();
        },
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
      // Once run down, backing out of the deploy picker is not a way out.
      // Withdrawal was made contested precisely so a fight could be forced,
      // and ENGAGE-then-cancel was a free exit around the whole rule —
      // cancelling returns to the cornered encounter, where the outs are the
      // ones the panel offers.
      }, opts.cornered ? () => handleEncounter(party, { cornered: true }) : null);
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
  // Answering a summons means the liege's column fights beside you — if it is
  // still alive. A column broken on the road leaves the assault yours alone,
  // which is exactly the risk of dawdling on the way to a war.
  const col = contract.summons
    ? G.campaign?.parties?.find((p) => p.id === contract.summons) : null;
  return {
    type: contract.type,
    site: loc.id,
    // A summoned army siege is fought on ground built for it — THE BASTION,
    // from either side of the wall — and a prison break happens where
    // prisons are: the bastion keep. Other contracts keep the location's
    // own ground.
    layout: (contract.summons && (contract.type === 'siege' || contract.defend))
      || contract.rescue
      ? 'bastion' : (loc.layout || 'array'),
    ...(contract.rescue ? { rescueName: contract.rescueName } : {}),
    siteName: loc.name,
    // A faction's own ground is defended by that faction; neutral sites by
    // whoever is squatting there.
    enemyFaction: loc.faction || (contract.employer === 'trust' ? 'syndic' : 'raider'),
    ...(col && !contract.defend ? {
      allies: col.strength,
      allyFaction: contract.employer,
      // The town does not fall to four people and a truck: a summoned siege
      // is defended at army scale too, streamed in through the field cap.
      enemyArmy: Math.round(col.strength * 0.85),
    } : {}),
    ...(contract.defend ? {
      // Holding the wall: the column is the ENEMY army, the town's garrison
      // fights beside you, and the attacker names the uniforms.
      defend: true,
      enemyArmy: col ? col.strength : 60,
      allies: Math.round((col ? col.strength : 60) * 0.8),
      allyFaction: contract.employer,
      enemyFaction: contract.enemyFaction
        || (contract.employer === 'trust' ? 'syndic' : 'trust'),
    } : {}),
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
  const begin = (wager) => {
    if (wager > 0) {
      // The stake leaves the ledger at the door. It comes back at three to
      // one only if the whole card gets cleared — see the pit branch in
      // applyMissionResult.
      S.credits -= wager;
      UI.toast('STAKED', `${wager} on the commander clearing the card`, 'warn');
    }
    startMission({
      type: 'pit',
      site: loc.id,
      // The pit is fought in the pit — a purpose-built arena with the town
      // on the rim — never in whatever layout the settlement happens to be.
      layout: 'arena',
      siteName: loc.name,
      enemyFaction: 'raider',
      wager,
    }, [State.commander(S)]);
  };
  // The book takes stakes on the commander, Mount & Blade tournament style —
  // and runs a named circuit of its own you can bet into.
  const stakes = [200, 500, 1000].filter((w) => (S.credits || 0) >= w);
  const bout = State.exhibitionBout(S);
  const champ = State.pitChampion(S);
  UI.modal({
    title: 'THE PIT',
    tag: loc.name.toUpperCase(),
    body: `<div class="prose">Nobody dies in the pit. They put you in with whoever
      is next, the crowd bets on it, and you walk out either way.</div>
      <div class="prose mt">The book will also take a stake on the commander clearing
      the whole card — every round, nobody left to put in with you. It pays
      <span class="hl">three to one</span>. Going down early keeps your money.</div>
      ${champ ? `<div class="prose dim mt">The name on the wall is
        <span class="hl">${UIesc(champ.name)}</span> — ${champ.wins} bouts standing.</div>` : ''}
      ${bout ? `<div class="prose mt">Tonight's bout:
        <span class="hl">${UIesc(bout.a.name)}</span> (${UIesc(bout.a.style)}) against
        <span class="hl">${UIesc(bout.b.name)}</span> (${UIesc(bout.b.style)}).
        The book has ${UIesc(bout.a.name)} at ${Math.round(bout.oddsA * 100)}.</div>` : ''}`,
    foot: '<button class="btn btn-major" data-x="none">JUST FIGHT</button>'
      + stakes.map((w) => `<button class="btn" data-wager="${w}">STAKE ${w}</button>`).join('')
      + (bout ? `<button class="btn" data-bet="a">BET ${bout.a.name.split(' ')[0].toUpperCase()} (150)</button>`
        + `<button class="btn" data-bet="b">BET ${bout.b.name.split(' ')[0].toUpperCase()} (150)</button>` : '')
      + '<button class="btn" data-x="dice">ROLL DICE (100)</button>'
      + '<button class="btn" data-x="close">WALK AWAY</button>',
    onClose: () => G.world?.setPaused(false),
  });
  document.querySelector('#modal [data-x="close"]').onclick = () => {
    Audio.uiBack(); UI.closeModal(); G.world?.setPaused(false);
  };
  document.querySelector('#modal [data-x="dice"]').onclick = () => {
    const res = State.rollDice(S, 100);
    if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
    if (res.won) { Audio.uiSelect(); UI.toast('THE BONES CAME UP', '100 doubled', 'good'); }
    else { Audio.uiDeny(); UI.toast('HOUSE TAKES IT', '100 gone', 'warn'); }
  };
  for (const el of document.querySelectorAll('#modal [data-bet]')) {
    el.onclick = () => {
      const res = State.betExhibition(S, el.dataset.bet === 'a', 150);
      if (!res.ok) { Audio.uiDeny(); UI.toast('', res.why, 'bad'); return; }
      if (res.won) { Audio.uiSelect(); UI.toast('YOUR FIGHTER TOOK IT', `${res.winner} — paid ${res.payout}`, 'good'); }
      else { Audio.uiDeny(); UI.toast('WRONG NAME', `${res.winner} took the bout`, 'warn'); }
    };
  }
  document.querySelector('#modal [data-x="none"]').onclick = () => {
    Audio.uiSelect(); UI.closeModal(); begin(0);
  };
  for (const el of document.querySelectorAll('#modal [data-wager]')) {
    el.onclick = () => { Audio.uiSelect(); UI.closeModal(); begin(Number(el.dataset.wager)); };
  }
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

function openDeploy(spec, onCancel) {
  const S = G.campaign;
  G.world?.setPaused(true);
  // closeModal() fires onClose on EVERY close, including the one on the way
  // into a launched mission — the flag is what tells a cancel from a deploy.
  let launched = false;
  UI.deployPanel(S, spec, {
    onClose: () => {
      if (!launched && onCancel) { onCancel(); return; }
      G.world?.setPaused(false);
    },
    onDeploy: (squad) => {
      launched = true;
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

  // A hired mercenary band fights every job in its window — streamed onto
  // the field as allies, like any force that is not on your payroll.
  const merc = State.mercActive(G.campaign);
  if (merc && spec.type !== 'visit' && spec.type !== 'pit') {
    spec.allies = (spec.allies || 0) + merc.size;
    spec.allyFaction = spec.allyFaction || 'syndic';
  }

  G.mission = new Mission({
    campaign: G.campaign,
    spec,
    squad,
    container: viewport,
    onHud: (h) => UI.renderMissionHud(h),
    onToast: (t, b, tone) => UI.toast(t, b, tone),
    onIntro: (info) => UI.missionIntro(info, 6.0),
    onWheel: (w) => UI.renderCommandWheel(w),
    onArea: (area) => handleTownArea(spec, area),
    onEnd: (result) => endMission(spec, result),
  });
  await G.mission.start();
  // Pointer lock is requested when the cinematic hands over, not before —
  // grabbing the mouse during the fly-in just steals the cursor.
}

function endMission(spec, result) {
  const S = G.campaign;
  // A walk is not a deployment: nothing happened that the campaign needs to
  // be told about, and an after-action report for a shopping trip would be
  // absurd. Straight back to the map.
  if (spec.type === 'visit') { toWorld(false); return; }
  const notes = State.applyMissionResult(S, result);
  State.save(S);

  UI.show('worldhud');
  UI.afterAction(S, result, notes, {
    onClose: () => {
      const wasFinale = S.finale && !S.finaleShown;
      const proceed = () => {
        toWorld(false);
        // Promotions earned on this deployment are spent before anything else.
        resolvePerks(() => {
          if (wasFinale) {
            S.finaleShown = true;
            setTimeout(() => UI.finalePanel(S, { onClose: () => {} }), 260);
          }
        });
      };
      // The page after the report: sort the enemy supply, decide the
      // prisoners. Only appears when the field actually yielded something.
      if ((result.fieldSpoils || []).length || (result.captives || []).length) {
        UI.spoilsPanel(S, result, { onClose: () => { State.save(S); proceed(); } });
      } else proceed();
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
    // Some panels have to be answered. Dismissing one leaves the campaign
    // paused behind it with the decision still outstanding.
    if (k === 'escape' && UI.modalBlocking()) { Audio.uiDeny(); return; }
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

// A battle arrived at on the map: name both sides, offer a stake in it.
// Joining launches a real deployment against the chosen enemy's strongest
// party, with the befriended side's fighters on the field as allies.
function handleMapBattle(btl) {
  if (UI.modalOpen()) return;
  const S = G.campaign;
  G.world?.setPaused(true);
  const partiesOf = (side) => btl[side]
    .map((id) => S.parties.find((p) => p.id === id))
    .filter((p) => p && p.battle === btl.id);
  const a = partiesOf('a'), b = partiesOf('b');
  if (!a.length || !b.length) { G.world?.setPaused(false); return; }
  UI.battlePanel(S, { a, b }, {
    onClose: () => G.world?.setPaused(false),
    onJoin: (side) => {
      UI.closeModal();
      const friends = side === 'a' ? a : b;
      const foes = side === 'a' ? b : a;
      const target = foes.slice().sort((x, y) => y.strength - x.strength)[0];
      const allies = friends.reduce((t, p) => t + p.strength, 0);
      // Whoever was marching to this fight still arrives — into the PLAYER'S
      // battle now, on whichever side they were coming for. The map's
      // reinforcement promise carries across the instance boundary.
      let lateAllies = 0, lateEnemies = 0;
      for (const p of S.parties) {
        if (p.reinforce !== btl.id) continue;
        p.reinforce = null;
        if (State.partiesHostile(S, p, target)) lateAllies += p.strength;
        else lateEnemies += p.strength;
      }
      // The joined fight is the player's now: the sim releases its half.
      for (const p of [...friends, ...foes]) p.battle = null;
      S.mapBattles = (S.mapBattles || []).filter((x) => x.id !== btl.id);
      // Army-sized engagements get ground authored for the tactical camera —
      // lanes, posts, and room to maneuver. A patrol scrap keeps the roadside.
      const big = allies + (target?.strength || 0) >= 24;
      openDeploy({
        type: 'skirmish', site: big ? 'field' : 'roadside',
        layout: big ? 'field' : 'roadside',
        party: target, allies, allyFaction: friends[0]?.faction || null,
        late: (lateAllies || lateEnemies)
          ? { allies: lateAllies, enemies: lateEnemies, at: 50 } : null,
      });
    },
  });
}

// A signal or a battlefield, arrived at. The die for a signal was cast the
// day it was born (ev.roll), so answering one is opening an envelope, not
// rolling in front of the judge — and not every envelope is honest.
function handleMapEvent(ev) {
  if (UI.modalOpen()) return;
  const S = G.campaign;
  G.world?.setPaused(true);
  const done = () => {
    S.mapEvents = (S.mapEvents || []).filter((e) => e.id !== ev.id);
    S.mapSites = (S.mapSites || []).filter((s) => s.id !== ev.id);
    G.world?.setPaused(false);
  };
  const leave = () => G.world?.setPaused(false);

  if (ev._t === 'site') {
    UI.modal({
      title: 'A BATTLEFIELD',
      tag: 'STILL SMOKING',
      body: `<div class="prose">Somebody fought here and somebody lost. What is
        left is not worth much, but it is worth stopping for.</div>`,
      foot: `<button class="btn btn-major" data-x="take">PICK IT OVER</button>
        <button class="btn" data-x="close">DRIVE ON</button>`,
      onClose: leave,
    });
    document.querySelector('#modal [data-x="take"]').onclick = () => {
      Audio.uiSelect();
      UI.closeModal();
      S.credits += ev.loot.credits;
      S.cargo.salvage = (S.cargo.salvage || 0) + ev.loot.salvage;
      UI.toast('SALVAGE', `${ev.loot.credits} credits, ${ev.loot.salvage} salvage`, 'good');
      done();
    };
    return;
  }

  if (ev.kind === 'distress') {
    UI.modal({
      title: 'DISTRESS TRANSMISSION',
      tag: 'SOURCE UNVERIFIED',
      body: `<div class="prose">A repeating voice loop, thin with power. Somebody
        needs help, or wants you to think so — the only way to know is to go in.</div>`,
      foot: `<button class="btn btn-major" data-x="go">INVESTIGATE</button>
        <button class="btn" data-x="close">NOT YOUR PROBLEM</button>`,
      onClose: leave,
    });
    document.querySelector('#modal [data-x="go"]').onclick = () => {
      Audio.uiSelect();
      UI.closeModal();
      const roll = ev.roll;
      if (roll < 0.30) {
        // Bait. The band is real and it is already stood up around you.
        const p = State.spawnDistressAmbush(S, ev.x, ev.z);
        done();
        UI.toast('AMBUSH', 'The signal was bait', 'bad');
        if (p) setTimeout(() => handleEncounter(p, { cornered: true }), 300);
      } else if (roll < 0.55) {
        S.credits += 120;
        S.cargo.salvage = (S.cargo.salvage || 0) + 2;
        done();
        UI.toast('WRECK FOUND', 'Nobody alive. 120 credits and salvage in the hold', 'info');
      } else if (roll < 0.8) {
        const f = roll < 0.675 ? 'trust' : 'syndic';
        S.rep[f] = (S.rep[f] || 0) + 2;
        S.credits += 80;
        done();
        UI.toast('PATROL RECOVERED', `Their people owe you. ${f.toUpperCase()} +2, 80 credits`, 'good');
      } else {
        done();
        S.morale = Math.min(100, (S.morale ?? 70) + 3);
        S.credits += 60;
        UI.toast('SURVIVOR', 'Walking wounded, grateful, and good for a reward', 'good');
      }
    };
    return;
  }

  if (ev.kind === 'checkpoint') {
    const f = ev.faction;
    const liked = (S.rep?.[f] || 0) >= 0;
    const toll = 40 + Math.floor(ev.roll * 80);
    UI.modal({
      title: `${f.toUpperCase()} CHECKPOINT`,
      tag: 'ROAD CLOSED',
      body: `<div class="prose">A barrier across the road and soldiers who are
        not going anywhere. The route still exists; using it is a conversation
        now.</div>
        <div class="prose dim mt">${liked
    ? 'They know the company. This should be a formality.'
    : 'Bracket\'s name does not open their barriers lately.'}</div>`,
      foot: `${liked ? '<button class="btn btn-major" data-x="pass">IDENTIFY AND PASS</button>' : ''}
        <button class="btn" data-x="pay" ${S.credits < toll ? 'disabled' : ''}>PAY THE TOLL (${toll})</button>
        <button class="btn" data-x="close">TURN BACK</button>`,
      onClose: leave,
    });
    const through = () => {
      // Through — and the checkpoint stays for the next traveller. An event
      // outlives one interaction; only expiry removes it.
      G.world?.eventSeen?.delete(ev.id);
      G.world?.setPaused(false);
    };
    const p1 = document.querySelector('#modal [data-x="pass"]');
    if (p1) p1.onclick = () => {
      Audio.uiSelect(); UI.closeModal();
      S.rep[f] = (S.rep[f] || 0) + 0.5;
      UI.toast('WAVED THROUGH', 'The ledger remembers cooperation', 'good');
      through();
    };
    document.querySelector('#modal [data-x="pay"]').onclick = () => {
      Audio.uiSelect(); UI.closeModal();
      S.credits -= toll;
      UI.toast('TOLL PAID', `${toll} credits to use their road`, 'bad');
      through();
    };
    return;
  }

  // oldsignal — the old regime does not explain itself.
  UI.modal({
    title: 'OLD REGIME TRANSPONDER',
    tag: 'PROTOCOL UNKNOWN',
    body: `<div class="prose">A carrier wave older than the Reach's records,
      cycling an authentication nobody alive can answer.</div>`,
    foot: `<button class="btn btn-major" data-x="go">APPROACH IT</button>
      <button class="btn" data-x="close">LEAVE IT CYCLING</button>`,
    onClose: leave,
  });
  document.querySelector('#modal [data-x="go"]').onclick = () => {
    Audio.uiSelect();
    UI.closeModal();
    if (ev.roll < 0.5) {
      S.credits += 300;
      State.pushLog(S, 'A pre-charter cache, still sealed. Bracket does not ask twice.', 'good');
      UI.toast('CACHE', '300 credits in old-regime scrip, still good', 'good');
    } else {
      S.cargo.optics = (S.cargo.optics || 0) + 2;
      State.pushLog(S, 'The transponder guarded a survey vault. The optics alone paid for the detour.', 'good');
      UI.toast('SURVEY VAULT', '2 optics recovered', 'good');
    }
    done();
  };
}
