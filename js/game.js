import { CARD_BY_ID, CARDS, ensureGeneratedCard } from './cards.js?v=20260902';
import {
  createInitialState,
  startOfTurn,
  endTurn,
  drawCards,
  addCardToHand,
  gainFuel,
  updateObjectiveLevels,
  objectiveLevel,
  checkObjectiveControl,
  getKeywords,
  applyHit,
  maxArmorHits,
  getSideValue,
  attackBeats,
  oppositeDir,
  unsuppressOnBoard,
  discountFor,
  consumeDiscounts,
  addDiscount,
  shuffle,
  remainingAttacks,
  spendAttack,
  grantTempAttacks,
  resetPersistentAttacks,
  hasEscalated,
  markEscalateUse,
  expireTempFuelGrant,
} from './state.js?v=20260902';
import { getAttackableTargets, resolveSingleAttack, tileKey, columnKeys, unitsInColumn, unitsOnBoard, checkHeroPassivesOnPlace, removeSuppression, applyGameEvents, unitSuppressedEvent, hasColumnFreedom, evaluateDirectHQ, recalculateDynamicStats, checkRally, resolveDestructionChain, applyPostDestructionEffects, getManeuverTargets, resolveManeuver, generateCraftCandidates, craftCandidateToCard, resolveCraftDrawback, nextCraftCost, advanceCraftCost, applyHandBuff, getObjectivePickEffectType, computeObjectivePickTargets, describeDynamicSideBonus } from './combat.js?v=20260902';
import { renderBoard, renderHand, renderHQ, appendLog, heroCardHtml, renderHeroZones, showFxPopup, drawFxConnector } from './ui.js?v=20260902';
import { MAPS, getTerrain, canPlaceOnTerrain } from './maps.js?v=20260902';
import { pushState, subscribeState, setPlayerLeft, updateLobby, subscribeLobby, updatePlayerState } from './firebase.js?v=20260902';
import { debugAddCard, debugSetFuel, debugAdjustFuel, debugSetHQ, debugAdjustHQ, debugSetObjective, debugSetObjectiveCard, debugSetUnitState, debugBuffUnit, debugDrawCards, debugSkipToTurn, debugRemoveCard } from './debug.js?v=20260902';
import { STARTER_DECKS, loadCustomDecks, validateDeck, validateHeroRoster } from './decks.js?v=20260902';
import { runBotTurn } from './bot_player.js?v=20260902';
import { bestHeroDeployment } from './bot_ai.js?v=20260902';
import { canCancelInteraction, getInteractionDecision } from './interaction.js?v=20260902';

// ── Deck selection ────────────────────────────────────────────────────────────
// Tiles are rendered from STARTER_DECKS + saved custom decks. Custom decks are
// re-validated here because card data may have changed since they were saved.
// Starters keep data-deck="aggro" etc. — the selfplay harness clicks by that.
let deckChoices = []; // parallel to data-choice indices on the tiles

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function renderDeckGrid() {
  const grid = document.getElementById('deck-grid');
  grid.innerHTML = '';
  deckChoices = [];

  for (const d of STARTER_DECKS) {
    deckChoices.push({ ids: d.ids, heroIds: d.heroIds ?? [] });
    grid.insertAdjacentHTML('beforeend',
      `<div class="deck-option" data-deck="${d.key}" data-choice="${deckChoices.length - 1}">
        <div class="deck-name">${escapeHtml(d.name)}</div>
        <div class="deck-flavor">${escapeHtml(d.flavor)}</div>
        <div class="deck-ap">${d.ids.length} cards</div>
      </div>`);
  }

  for (const d of loadCustomDecks()) {
    const v = validateDeck(d.ids);
    const hv = validateHeroRoster(d.heroIds ?? []);
    if (v.valid && hv.valid) {
      deckChoices.push({ ids: d.ids, heroIds: d.heroIds ?? [] });
      grid.insertAdjacentHTML('beforeend',
        `<div class="deck-option" data-choice="${deckChoices.length - 1}">
          <div class="deck-name">${escapeHtml(d.name)}</div>
          <div class="deck-flavor">Custom deck</div>
          <div class="deck-ap">${d.ids.length} cards</div>
        </div>`);
    } else {
      const errors = [...v.errors, ...hv.errors];
      grid.insertAdjacentHTML('beforeend',
        `<div class="deck-option deck-invalid" title="${escapeHtml(errors.join(' '))}">
          <div class="deck-name">${escapeHtml(d.name)}</div>
          <div class="deck-flavor">INVALID — ${escapeHtml(errors[0])} Fix it in the Deck Builder.</div>
          <div class="deck-ap">${d.ids.length} cards</div>
        </div>`);
    }
  }
}

renderDeckGrid();

// Bridge (29), Radar Station (30), Fortification (33) excluded — effects not automated yet.
// Updated 2026-08-31 (Run 1) to the new O1-O5 objective id scheme (Factory/Airfield/Supply
// Depot/City/Artillery Position) — see cards.js. All 5 are the new truth's full Objective
// list (Bridge/Radar Station/Fortification are cut entirely, not just excluded from this
// pool, and are archived in js/archive/legacy_cards.js).
const WORKING_OBJECTIVE_IDS = ['O1', 'O2', 'O3', 'O4', 'O5'];

// Objective tile positions are fixed per map (MAPS[mapId].objectiveSlots — see maps.js);
// the CARD assigned to each position is randomized from the auto-resolving pool at match
// start, unique per map (doc 04 §1/§19 — no identity may repeat on the same map), and — as
// of Run 2 — after mulligan, not at match start (see finishStartGame). A map may set
// `objectiveExclude: [id, ...]` to draw from a narrower pool; none of the current 4 locked
// maps (Stalingrad/Kursk/El Alamein/Ardennes) need this — it existed for the now-archived
// Midway (all-water, Factory/City excluded as dead weight). `% shuffled.length` guarded a
// slot count exceeding the (possibly narrowed) pool size, which only Midway's 4-slots-from-3
// case ever hit; with Midway gone every remaining map draws at most 4 of 5, so the wraparound
// is unreachable today but left in place as a harmless safety net, not dead-code cruft to chase.
function pickObjectives(mapId) {
  const map = MAPS[mapId];
  const slots = map?.objectiveSlots ?? [];
  const exclude = map?.objectiveExclude ?? [];
  const pool = exclude.length ? WORKING_OBJECTIVE_IDS.filter(id => !exclude.includes(id)) : WORKING_OBJECTIVE_IDS;
  const shuffled = shuffle(pool);
  const objectives = {};
  slots.forEach((slot, i) => {
    objectives[slot] = { cardId: shuffled[i % shuffled.length], level: 1 };
  });
  return objectives;
}

// ── Lobby flow ────────────────────────────────────────────────────────────────
let p1DeckIds = null;
let p2DeckIds = null;
let p1HeroIds = [];
let p2HeroIds = [];
let pickerStep = 1;

// Called by P2 once both their deck choice and P1's lobby data are available.
function tryPushP2Ready() {
  if (!p2DeckIds || !p1LobbyData) return;
  const toArr = v => Array.isArray(v) ? v : Object.values(v ?? {});
  pushState(gameId, {
    _phase: 'ready',
    p1Deck: toArr(p1LobbyData.p1Deck),
    p1Heroes: toArr(p1LobbyData.p1Heroes),
    mapId:  p1LobbyData.mapId,
    p2Deck: p2DeckIds,
    p2Heroes: p2HeroIds,
  }).catch(err => {
    console.error('tryPushP2Ready failed', err);
    document.getElementById('waiting-msg').textContent = 'Connection error — could not reach the host. Check your connection and reload.';
  });
  document.getElementById('waiting-msg').textContent = 'Waiting for host to start the game...';
  armWaitingTimeout('waiting-msg', 'Still waiting on the host — this is taking longer than usual. Check your connection, or ask them to reload.');
}

// Waiting/Connecting screens have no explicit failure path — a dropped or slow Firebase
// write previously just left the message on screen forever with nothing telling the player
// something's wrong. This doesn't retry (no safe way to know if the original write actually
// landed), it just surfaces that the wait has gone on longer than a normal connection should
// take, so a stuck player knows to check their connection or reload instead of waiting blind.
let waitingTimeoutTimer = null;
function armWaitingTimeout(msgElId, timeoutText, ms = 20000) {
  clearTimeout(waitingTimeoutTimer);
  waitingTimeoutTimer = setTimeout(() => {
    if (state) return; // already started, nothing to warn about
    const el = document.getElementById(msgElId);
    if (el) el.textContent = timeoutText;
  }, ms);
}
function disarmWaitingTimeout() {
  clearTimeout(waitingTimeoutTimer);
}

document.getElementById('deck-grid').addEventListener('click', e => {
  const option = e.target.closest('.deck-option');
  if (!option || option.dataset.choice === undefined) return;
  const choice = deckChoices[Number(option.dataset.choice)];
  if (!choice) return;
  const { ids, heroIds } = choice;

  if (isOnline && myRole === 'p2') {
    p2DeckIds = [...ids];
    p2HeroIds = [...heroIds];
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'flex';
    document.getElementById('waiting-msg').textContent = 'Connecting...';
    // Covers a bad/expired code too, not just a slow connection — if the host's lobby data
    // never arrives (p1LobbyData stays null), tryPushP2Ready keeps no-op'ing forever with
    // nothing else telling the player anything is wrong.
    armWaitingTimeout('waiting-msg', 'Still connecting — double-check the code with the host, or check your connection.');
    tryPushP2Ready(); // fires immediately if P1 lobby data already arrived; otherwise waits
    return;
  }

  if (isOnline && myRole === 'p1') {
    p1DeckIds = [...ids];
    p1HeroIds = [...heroIds];
    document.getElementById('deck-picker').style.display = 'none';
    // Map is always already chosen by this point now (doc 04 §1 map-before-deck order,
    // 2026-09-01 fix): urlMapId from the open-lobby browser, or onlineMapId from the
    // direct-code-join map-picker shown before this deck-picker — see the page-load block
    // and the map-grid handler below.
    beginHostWait(urlMapId ?? onlineMapId);
    return;
  }

  // Local play: map already chosen (see doc-04 setup-order note above) → P1 deck → P2 deck →
  // startGame. In AI mode, P2's deck is auto-assigned — no second picker step.
  if (pickerStep === 1) {
    p1DeckIds = [...ids];
    p1HeroIds = [...heroIds];
    if (isAiMode) {
      const botDeck = STARTER_DECKS[Math.floor(Math.random() * STARTER_DECKS.length)];
      p2DeckIds = [...botDeck.ids];
      p2HeroIds = [...(botDeck.heroIds ?? [])];
      document.getElementById('deck-picker').style.display = 'none';
      startGame(p1DeckIds, p2DeckIds, localMapId, p1HeroIds, p2HeroIds);
    } else {
      pickerStep = 2;
      document.getElementById('picker-label').textContent = 'PLAYER 2 — CHOOSE YOUR DECK';
    }
  } else {
    p2DeckIds = [...ids];
    p2HeroIds = [...heroIds];
    document.getElementById('deck-picker').style.display = 'none';
    startGame(p1DeckIds, p2DeckIds, localMapId, p1HeroIds, p2HeroIds);
  }
});

// Pushes P1's lobby state (deck + map) and waits for P2 to finish picking
// their deck. Used both by the map-picker (legacy code-share flow, where the
// host picks the map here) and directly from the deck-grid handler when the
// map was already fixed by the open-lobby browser (urlMapId is set).
function beginHostWait(mapId) {
  pushState(gameId, { _phase: 'lobby', p1Deck: p1DeckIds, p1Heroes: p1HeroIds, mapId }).catch(err => {
    console.error('beginHostWait failed', err);
    document.getElementById('waiting-msg').textContent = 'Connection error — could not create the lobby. Check your connection and reload.';
  });
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('waiting-screen').style.display = 'flex';
  document.getElementById('waiting-msg').textContent = 'Waiting for Player 2 to choose their deck...';
  armWaitingTimeout('waiting-msg', 'Still waiting on Player 2 — this is taking longer than usual. Make sure they have the right code and a working connection.');
  subscribeState(gameId, data => {
    if (state) return; // already started
    if (data._phase !== 'ready' || !data.p2Deck) return;
    const toArr = v => Array.isArray(v) ? v : Object.values(v ?? {});
    const p1Deck = toArr(data.p1Deck);
    const p2Deck = toArr(data.p2Deck);
    const p1Heroes = toArr(data.p1Heroes);
    const p2Heroes = toArr(data.p2Heroes);
    // games/{gameId} is world-writable, so both decks AND hero rosters are re-validated
    // here even though the deck-picker UI only ever offers valid ones — this is the one
    // place an untrusted client (or tampered Firebase data) could otherwise slip an
    // invalid deck or hero roster into a match.
    const p1Check = validateDeck(p1Deck);
    const p2Check = validateDeck(p2Deck);
    const p1HeroCheck = validateHeroRoster(p1Heroes);
    const p2HeroCheck = validateHeroRoster(p2Heroes);
    if (!p1Check.valid || !p2Check.valid || !p1HeroCheck.valid || !p2HeroCheck.valid) {
      const who = (!p1Check.valid || !p1HeroCheck.valid) ? 'Your own' : "Player 2's";
      const reason = !p1Check.valid ? p1Check.errors[0]
        : !p1HeroCheck.valid ? p1HeroCheck.errors[0]
        : !p2Check.valid ? p2Check.errors[0]
        : p2HeroCheck.errors[0];
      document.getElementById('waiting-msg').textContent = `${who} deck failed validation (${reason}) — refusing to start.`;
      return; // stay on the waiting screen rather than start a broken match
    }
    startGame(p1Deck, p2Deck, data.mapId, p1Heroes, p2Heroes);
  });
}

document.getElementById('map-grid').addEventListener('click', e => {
  const option = e.target.closest('.deck-option');
  if (!option || !option.dataset.map) return;

  // Online P1 direct-code-join: this only fires when urlMapId wasn't already set (see the
  // page-load block below) — i.e. exactly the case doc 04 §1 needs fixed. Just record the
  // choice and move on to P1's own deck picker; beginHostWait (which actually pushes the
  // lobby and only P1 needs to see) fires from there once a deck is also chosen. P2 never
  // gets this screen in any online flow — one player picks the map, not two.
  if (isOnline && myRole === 'p1') {
    onlineMapId = option.dataset.map;
    document.getElementById('map-picker').style.display = 'none';
    document.getElementById('deck-picker').style.display = '';
    return;
  }

  // Local/AI mode: map is chosen first (see the doc-04 setup-order note above), so this
  // just records it and moves on to the deck picker(s) — startGame happens from there once
  // decks are chosen, not from here.
  localMapId = option.dataset.map;
  document.getElementById('map-picker').style.display = 'none';
  document.getElementById('deck-picker').style.display = '';
});

// ── Online mode ───────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const isOnline = !!params.get('game');
const gameId   = params.get('game') ?? null;
const myRole   = params.get('role') ?? null; // 'p1' | 'p2' | null for local play
const isAiMode = params.get('ai') === '1';
const urlMapId = params.get('mapId') ?? null; // set when this game came from the open-lobby browser — the map was already chosen there, so skip the map-picker
let myLastPushId = null;

// Doc 04 §1 (locked setup order): Map is selected/revealed BEFORE deck+Hero roster
// confirmation, and only ONE player ever picks it — a second picker for the other player
// would be redundant, not just out of order. Local hotseat and AI mode start on the
// map-picker for this reason (Run 2 fix, 2026-08-31 — every mode used to start on the
// deck-picker instead). Online P1 direct-code-join fixed the same way 2026-09-01 (was
// deck-then-map, the one remaining wrong-order case — see CHANGELOG.md): starts on the
// map-picker too, choice stored in `onlineMapId`, then falls through to the deck-picker.
// P1-via-open-lobby-browser already satisfies the order on its own (map chosen on
// index.html before this page even loads, `urlMapId` arrives already set) and skips this
// map-picker entirely. P2 never sees a map-picker in either online flow — by design, not a
// gap: one player picks, the other is told what it is (see the P2-online block below).
let localMapId = null;
let onlineMapId = null;
if (!isOnline) {
  document.getElementById('deck-picker').style.display = 'none';
  document.getElementById('map-picker').style.display = '';
} else if (myRole === 'p1' && !urlMapId) {
  document.getElementById('deck-picker').style.display = 'none';
  document.getElementById('map-picker').style.display = '';
}

// Board grid itself stays fixed/unrotated for both players (see renderBoard's comment in
// ui.js) — this class only makes the HUD framing around it (Hero Zone strip position, unit
// colors) feel viewer-relative for an online P2, without touching combat math or board
// coordinates. Local hotseat (myRole === null) keeps literal P1/P2 framing since both
// players share one screen there.
if (isOnline && myRole === 'p2') document.body.classList.add('viewer-p2');

// ── Game state ────────────────────────────────────────────────────────────────
let state = null;
let p1LobbyData = null; // P2 stores P1's lobby push until P2 has also picked their deck
let uiState = "idle";
let selectedHandCardId = null;
let pendingAttackerKey = null;
let pendingCommandId = null;       // card ID of command awaiting a board target
let preCommandState = null;        // state snapshot before command-targeting started (for cancel)
let pendingRallyCryCount = 0;      // remaining Rally Cry target picks (0 = not active)
let lastChangedKeys = new Set();   // tiles changed by opponent's last move (cleared on own action)
let lastTransitionFlags = new Map(); // tileKey -> 'suppressed'|'destroyed'|'armor-absorbed'|'direct-hq' this commit, for a one-shot render animation
let lastObjectiveTransitionFlags = new Map(); // tileKey -> 'obj-captured'|'obj-leveled' this commit — same one-shot idea, kept separate from lastTransitionFlags since it describes the objective at that tile, not a unit
let lastHeroActivationKey = null; // "role-col" of the Hero Zone that just fired this commit, or null
let gameOver = false;

const BLOCKING_MODAL_IDS = [
  'fo-modal', 'radio-op-modal', 'field-reserves-modal',
  'rotate-direction-modal', 'craft-picker-modal', 'hero-deploy-modal',
];

function anyBlockingModalOpen() {
  return BLOCKING_MODAL_IDS.some(id => document.getElementById(id)?.style.display === 'flex');
}

function currentInteractionContext() {
  return {
    uiState,
    pendingObjectivePick: state?.pendingObjectivePick ?? null,
    pendingArtyHits: state?.pendingArtyHits ?? 0,
    hasBlockingModal: anyBlockingModalOpen(),
    pendingCommandId,
    selectedHeroZone,
    pendingHalftrackMove,
  };
}

// ── Forward Observer state ─────────────────────────────────────────────────────
let foCards = [];        // 3 cardIds drawn by FO
let foPlayer = '';       // 'p1' or 'p2'
let foAssignments = {};  // cardId → 'keep' | 'top' | 'bottom'

// ── Double Attack tracking ─────────────────────────────────────────────────────
let lastDATargetKey = null; // target of first Double Attack hit — always valid for 2nd hit
let pendingHeroId = null;      // hero whose activated power is awaiting a target
let pendingHeroColumn = null;  // that hero's column, for the targeting highlight
let pendingHeroTargets = null; // Set of legal tile keys, or null

// ── Artillery Position targeting ───────────────────────────────────────────────
let pendingArtyHitCount = 0; // hits remaining from Artillery Position L2/L4

// ── Mulligan ─────────────────────────────────────────────────────────────────

let mulliganSelected = new Set();

function applyMulligan(s, role, indices) {
  if (!indices.length) return s;
  const ps = { ...s[role] };
  const putBack = indices.map(i => ps.hand[i]);
  const keep = ps.hand.filter((_, i) => !indices.includes(i));
  const newDeck = shuffle([...putBack, ...ps.deck]);
  const drawn = newDeck.slice(0, putBack.length);
  return { ...s, [role]: { ...ps, hand: [...keep, ...drawn], deck: newDeck.slice(putBack.length) } };
}

function renderMulliganCards(hand) {
  const container = document.getElementById('mulligan-hand');
  container.innerHTML = '';
  hand.forEach((cardId, i) => {
    const card = CARD_BY_ID[cardId];
    if (!card) return;
    const div = document.createElement('div');
    div.className = `hand-card mulligan-card${mulliganSelected.has(i) ? ' mulligan-discard' : ''}`;
    const CLS_ABBR = { Infantry:'INF', Tank:'TNK', Artillery:'ART', Aircraft:'AIR' };
    if (card.type === 'unit') {
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${card.cost} ⛽</div>
        <div class="hc-type">${CLS_ABBR[card.cls] ?? card.cls}</div>
        <div class="hc-dirs">
          <div></div><div>${card.n}</div><div></div>
          <div>${card.w}</div><div style="color:#444">·</div><div>${card.e}</div>
          <div></div><div>${card.s}</div><div></div>
        </div>
        ${card.keyword ? `<div class="bc-keyword-row"><span class="bc-kw-tag">${card.keyword}</span></div>` : ''}`;
    } else if (card.type === 'command') {
      div.classList.add('hc-command');
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${card.cost} ⛽</div>
        <div class="hc-type hc-command-label">COMMAND</div>
        <div class="hc-effect">${card.effect || ''}</div>`;
    } else if (card.type === 'mission') {
      div.classList.add('hc-mission');
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${card.cost} ⛽</div>
        <div class="hc-type hc-mission-label">MISSION</div>
        <div class="hc-req">${card.req || ''}</div>
        <div class="hc-reward-strip">
          <div class="hc-reward-label">REWARD</div>
          <div class="hc-reward-text">${card.reward || card.effect || ''}</div>
        </div>`;
    } else {
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${card.cost} ⛽</div>
        <div class="hc-type">${card.type}</div>
        <div class="hc-effect">${card.effect || card.req || ''}</div>`;
    }
    div.addEventListener('click', () => {
      if (mulliganSelected.has(i)) mulliganSelected.delete(i);
      else mulliganSelected.add(i);
      renderMulliganCards(hand);
    });
    container.appendChild(div);
  });
}

function showMulligan(label, hand, onConfirm) {
  mulliganSelected = new Set();
  document.getElementById('mulligan-label').textContent = label;
  renderMulliganCards(hand);
  document.getElementById('mulligan-screen').style.display = 'flex';
  document.getElementById('btn-mulligan-confirm').onclick = () => {
    document.getElementById('mulligan-screen').style.display = 'none';
    onConfirm([...mulliganSelected]);
  };
  document.getElementById('btn-mulligan-keep').onclick = () => {
    document.getElementById('mulligan-screen').style.display = 'none';
    onConfirm([]);
  };
}

// ── Hero deploy modal ─────────────────────────────────────────────────────────
// Two-step pick: choose a Hero, then the column it commands. Follows the mulligan
// pattern (re-bindable .onclick + callback) so it can be chained P1 -> P2 sequentially.
// Deliberately NOT secret: the game has no hidden-information handling at all — both
// hands already sit in a world-writable node — and in hot-seat secrecy is meaningless.
function showHeroDeploy(title, subtitle, roster, occupiedZones, onConfirm) {
  const modal   = document.getElementById('hero-deploy-modal');
  const cardsEl = document.getElementById('hero-deploy-cards');
  const zonesEl = document.getElementById('hero-deploy-zones');
  let picked = null;

  document.getElementById('hero-deploy-title').textContent = title;
  document.getElementById('hero-deploy-sub').textContent = subtitle;

  function renderZones() {
    zonesEl.innerHTML = '';
    for (let col = 0; col < 4; col++) {
      const btn = document.createElement('button');
      btn.className = 'hero-zone-pick';
      btn.textContent = occupiedZones[col] != null ? 'TAKEN' : `COL ${col + 1}`;
      btn.disabled = occupiedZones[col] != null || picked === null;
      btn.onclick = () => {
        modal.style.display = 'none';
        onConfirm(picked, col);
      };
      zonesEl.appendChild(btn);
    }
  }

  cardsEl.innerHTML = roster.map(id => CARD_BY_ID[id]).filter(Boolean).map(heroCardHtml).join('');
  cardsEl.querySelectorAll('.hero-card').forEach(node => {
    node.onclick = () => {
      picked = node.dataset.heroId;
      cardsEl.querySelectorAll('.hero-card').forEach(c => c.classList.remove('selected'));
      node.classList.add('selected');
      renderZones();
    };
  });

  renderZones();
  modal.style.display = 'flex';
}

// Places a hero into a zone. Pure — returns the new player state.
function deployHero(playerState, heroId, col) {
  const zones = [...(playerState.heroZones ?? [null, null, null, null])];
  zones[col] = heroId;
  return {
    ...playerState,
    heroZones: zones,
    heroRoster: (playerState.heroRoster ?? []).filter(id => id !== heroId),
  };
}

// ── Hero Phase — reinforcement ────────────────────────────────────────────────
// Fires at the start of a player's turn when their Objective level has risen since they
// last played. Runs AFTER the turn state is committed, so it's a simple prompt rather than
// an await wedged into the middle of the end-turn pipeline.
// Levels rise at rounds 2, 4, 6 and 8 (L1-L4) — all 4 roster Heroes deploy through this
// same path, including the first. There is no separate pre-game "Starting Hero" step
// (removed 2026-08-11) — hero acquisition now follows the objective escalation schedule
// exactly, so both players get their first Hero at round 2, not before turn 1.
// Tracked per player because P1 and P2 cross each threshold on different half-turns.
function runHeroPhase(role) {
  if (!state || gameOver) return;
  const ps = state[role];
  const level = objectiveLevel(state.turn);
  if (level <= (ps.lastObjLevel ?? 0)) return;

  // In online play only the owning client deploys; the other side just receives the result.
  if (isOnline && myRole !== role) return;

  // Record the new level regardless of whether a Hero is actually available, so the
  // prompt can never re-fire for the same threshold.
  const noteLevel = st => ({ ...st, [role]: { ...st[role], lastObjLevel: level } });

  const roster = ps.heroRoster ?? [];
  const hasFreeZone = (ps.heroZones ?? []).some(z => z == null);
  if (!roster.length || !hasFreeZone) {
    // Fires synchronously, same click as whatever just called commitState immediately
    // before this (End Turn — Direct HQ source pulse, objective capture/level flash, both
    // set on the module-level last* vars right before runHeroPhase runs). Carrying them
    // forward here instead of defaulting to empty is deliberate: without this, a player
    // with no free Hero zone (all 4 filled) or no roster would have that flash wiped before
    // a single frame ever painted, purely because Hero Phase's own state note happened to
    // run in the same synchronous burst. Safe specifically because this branch never waits
    // on user input — see the finish() callback below, which does wait (via the deploy
    // modal) and deliberately does NOT do this, since by the time a human picks a Hero the
    // original flash is long stale and shouldn't replay.
    commitState(noteLevel(state), [], lastTransitionFlags, lastObjectiveTransitionFlags, lastHeroActivationKey);
    return;
  }

  const isFirstHero = (ps.heroZones ?? []).every(z => z == null);

  const finish = (heroId, col) => {
    let s = noteLevel(state);
    // A reinforcement consumes this turn's Hero Phase action — no reposition on top.
    // Doc 02 §6's arrival-lock recommendation (Power unusable until controller's next
    // turn) was explicitly a recommendation, not a locked rule — dropped 2026-08-12 so a
    // Hero's Power is available the same turn it's deployed.
    const deployed = deployHero(s[role], heroId, col);
    s = { ...s, [role]: { ...deployed, heroRepositioned: true } };
    const verb = isFirstHero ? 'deploys' : 'reinforces';
    commitState(s, [`${role.toUpperCase()} ${verb}: ${CARD_BY_ID[heroId]?.name} → column ${col + 1}`]);
  };

  if (isAiMode && role === 'p2') {
    const choice = bestHeroDeployment(state, role, roster, ps.heroZones ?? [null, null, null, null]);
    const heroId = choice?.heroId ?? roster[0];
    const col = choice?.col ?? (ps.heroZones ?? []).findIndex(z => z == null);
    finish(heroId, col);
    return;
  }

  // Delayed so the full-screen modal doesn't cover the End Turn visual sequence still playing.
  // 1800ms covers the longest piece of that sequence: Direct Hit's HQ flash fires 200ms in and
  // its "DIRECT HIT" text popup (fx-popup-rise, 1.6s) doesn't finish fading until 1800ms total —
  // see the End Turn handler. Re-reads roster/heroZones fresh off `state` at fire time rather
  // than using the values snapshotted above, in case anything legitimately changes in that
  // window (nothing normally can, since the board isn't meaningfully interactive between End
  // Turn and this modal, but re-deriving costs nothing and avoids relying on that assumption).
  setTimeout(() => {
    const freshPs = state[role];
    showHeroDeploy(`${role.toUpperCase()} — ${isFirstHero ? 'FIRST HERO' : 'REINFORCEMENT'}`,
      isFirstHero
        ? 'Round 2 — deploy your first Hero.'
        : 'Objective level rose — deploy another Hero.',
      freshPs.heroRoster ?? [], freshPs.heroZones, finish);
  }, 1800);
}

// ── Start game ────────────────────────────────────────────────────────────────
// Heroes are no longer picked before the match — the first one deploys at round 2
// (Objective Level 1) via runHeroPhase, same mechanism as every later reinforcement.
// See lastObjLevel: 0 in state.js and the timing note on runHeroPhase.
function startGame(p1Ids, p2Ids, mapId, p1Heroes = [], p2Heroes = []) {
  let s = createInitialState(p1Ids, p2Ids, mapId, p1Heroes, p2Heroes);

  if (isOnline && myRole === 'p1') {
    beginOnlineMulligan(s, mapId);
    return;
  }

  if (!isOnline) {
    document.getElementById('lobby').style.display = 'none';
    showMulligan('P1 — OPENING HAND', s.p1.hand, indices1 => {
      s = applyMulligan(s, 'p1', indices1);
      if (isAiMode) {
        finishStartGame(s, mapId);
      } else {
        showMulligan('P2 — OPENING HAND', s.p2.hand, indices2 => {
          s = applyMulligan(s, 'p2', indices2);
          finishStartGame(s, mapId);
        });
      }
    });
    return;
  }

  finishStartGame(s, mapId);
}

function finishStartGame(s, mapId) {
  disarmWaitingTimeout();
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('waiting-screen').style.display = 'none';
  document.getElementById('game-area').style.display = 'flex';

  // Doc 04 §1 (Objective Setup, locked): identities randomize into fixed slots AFTER
  // mulligan, not before. Every startGame() path converges here post-mulligan, so this is
  // the single correct place for it — moved out of startGame() (Run 2), which previously
  // computed objectives before either player's mulligan had even run.
  s = { ...s, objectives: pickObjectives(mapId) };
  // Doc 01 §2 (Turn State Machine, locked): "Every active-player turn resolves in this
  // order" — Refresh, Fuel, then Draw 1, with no stated exception for turn 1 (contrast
  // Direct HQ's explicit first-turn carve-out in §1.11/§19). Whoever has initiative draws
  // here for the same reason the End Turn handler draws for every later turn transition —
  // turn 1 just has no preceding End Turn to trigger it from. This is keyed off
  // `s.initiative` (randomized per doc 02 Q005), not hardcoded to 'p1' — the earlier
  // hardcoded version of this same draw was the actual bug, not the draw itself.
  s = { ...s, [s.initiative]: drawCards(s[s.initiative], 1) };
  state = startOfTurn(s);
  const mapName = MAPS[mapId].name;
  // readyForPlay flips here — see the field comment in state.js — so both online clients'
  // ongoing-sync listeners can tell "the host has now done the one-time post-mulligan setup"
  // apart from "still in the pre-objectives simultaneous-mulligan phase" (see
  // beginOnlineMulligan/showOnlineMulligan below), where `turn` alone can't distinguish the two.
  state = { ...state, readyForPlay: true, log: [`Game started on ${mapName} — ${state.initiative.toUpperCase()} goes first.`] };
  appendLog(state.log);
  redraw();

  // First player is now randomized (doc 02 Q005) — in AI mode the bot always sits in the p2
  // seat, so if p2 wins the coin flip its very first turn needs to be kicked off here.
  // Every other bot turn fires reactively from the End Turn handler once a turn transition
  // happens, but turn 1 has no preceding End Turn to react to.
  if (isAiMode && state.initiative === 'p2' && !gameOver) {
    runBotTurn();
  }

  if (isOnline) {
    pushStateIfOnline(state);
    subscribeState(gameId, remoteState => {
      if (remoteState._playerLeft && remoteState._playerLeft !== myRole) {
        showDisconnectScreen(remoteState._playerLeft);
        return;
      }
      if (remoteState._pushId === myLastPushId) return;
      receiveRemoteState(remoteState);
    });
  }
}

// ── Online simultaneous mulligan ────────────────────────────────────────────────
// Per direct request: mulligan should never be sequential online — the old flow had P1
// mulligan, push a FULLY started game (objectives, first draw, turn 1 already resolved), and
// only THEN show P2 a mulligan screen, leaving P2 stuck on a blank waiting screen the whole
// time for no rules reason (mulligan only ever touches the calling player's own hand/deck).
// Objectives/first-draw/turn setup still happen exactly ONCE, computed only by the host
// (createInitialState's own comment already established "only the host ever does anything
// Math.random()-based both sides must agree on" — this preserves that invariant), but now
// strictly AFTER both players' mulligans instead of after only P1's, per doc 04 §1's locked
// "objectives after mulligan" order — see finishStartGame above, unchanged in what it does,
// just called at a different, later point now.
//
// Each player's own mulligan confirmation writes ONLY their own p1/p2 sub-object via
// updatePlayerState (see firebase.js) rather than pushStateIfOnline's full-object set() — two
// concurrent mulligan confirmations landing at nearly the same moment must never let one
// silently clobber the other's hand, which a full-object replace could.
let hostMulliganPhaseDone = false; // p1/host only — guards finishStartGame from firing twice

function beginOnlineMulligan(s, mapId) {
  disarmWaitingTimeout();
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('waiting-screen').style.display = 'none';
  s = { ...s, p1: { ...s.p1, mulliganDone: false }, p2: { ...s.p2, mulliganDone: false } };
  state = s;
  pushStateIfOnline(state); // safe full push — P2 hasn't written anything at this node yet
  subscribeState(gameId, remoteState => {
    if (hostMulliganPhaseDone) return; // finishStartGame's own listener has taken over by now
    if (remoteState._playerLeft && remoteState._playerLeft !== myRole) {
      showDisconnectScreen(remoteState._playerLeft);
      return;
    }
    // No _pushId echo-guard here (unlike every other online listener): updatePlayerState
    // (P2's mulligan confirmation) writes only games/{gameId}/p2, never touching the top-level
    // _pushId field at all — it's left stale at whatever P1's own initial full push set it to,
    // which trivially always equals myLastPushId on THIS (the host's) client. Comparing against
    // it here would wrongly treat P2's genuine mulligan update as an echo of P1's own push and
    // silently ignore it forever. Safe to just always merge: reprocessing an actual echo of P1's
    // own mulligan slice is idempotent (same values back), and the mulliganDone-both-true check
    // below can only ever fire once thanks to hostMulliganPhaseDone.
    const normalized = normalizeFirebaseState(remoteState);
    state = { ...state, p1: normalized.p1, p2: normalized.p2 };
    if (state.p1.mulliganDone && state.p2.mulliganDone) {
      hostMulliganPhaseDone = true;
      finishStartGame(state, mapId);
    }
  });
  showOnlineMulligan(mapId);
}

// Shown to BOTH online roles — each mulligans their own hand independently, with no dependency
// on the other player's progress. `mapId` is only actually used by the p1/host branch, to call
// finishStartGame if this player turns out to be the one finishing last.
function showOnlineMulligan(mapId) {
  showMulligan('YOUR OPENING HAND', state[myRole].hand, indices => {
    const updated = applyMulligan(state, myRole, indices);
    const mySlice = { ...updated[myRole], mulliganDone: true };
    state = { ...updated, [myRole]: mySlice };
    updatePlayerState(gameId, myRole, mySlice).catch(err => {
      console.error('mulligan push failed', err);
      appendLog(['Connection error while confirming your mulligan — check your connection.']);
    });

    if (myRole === 'p1' && state.p2?.mulliganDone && !hostMulliganPhaseDone) {
      // I'm the host and P2 already finished before me — I'm the one who runs the shared
      // post-mulligan setup, so do it now rather than waiting on my own listener to notice a
      // change that, from my own local state, has already happened.
      hostMulliganPhaseDone = true;
      finishStartGame(state, mapId);
      return;
    }
    document.getElementById('waiting-screen').style.display = 'flex';
    document.getElementById('waiting-msg').textContent = myRole === 'p1'
      ? 'Waiting for the other player to finish their mulligan...'
      : 'Waiting for the host to start the match...';
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getValidTiles() {
  const card = CARD_BY_ID[selectedHandCardId];
  const valid = new Set();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const k = tileKey(r, c);
      if (state.board[k] || state.objectives[k]) continue;
      const terrain = getTerrain(state.mapId, r, c);
      if (canPlaceOnTerrain(card, terrain)) valid.add(k);
    }
  }
  return valid;
}

// Empty tiles ruled out specifically by terrain (not by being occupied) for the currently
// selected card — the complement of getValidTiles within the empty-tile set. Used only for
// the passive "why can't I drop here" board cue (renderBoard's terrain-blocked class); the
// actual placement rejection is still enforced independently in the PLACING click handler.
function getTerrainBlockedTiles() {
  const card = CARD_BY_ID[selectedHandCardId];
  const blocked = new Set();
  if (!card) return blocked;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const k = tileKey(r, c);
      if (state.board[k] || state.objectives[k]) continue;
      const terrain = getTerrain(state.mapId, r, c);
      if (!canPlaceOnTerrain(card, terrain)) blocked.add(k);
    }
  }
  return blocked;
}

function getAdjacentKeys(key) {
  const [r, c] = key.split(',').map(Number);
  return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]
    .filter(([row, col]) => row >= 0 && row < 4 && col >= 0 && col < 4)
    .map(([row, col]) => `${row},${col}`);
}

function applyMutations(board, mutations) {
  const newBoard = { ...board };
  for (const { key: k, newUnit } of mutations) {
    newBoard[k] = newUnit;
  }
  return newBoard;
}

// ── Board auto-fit ───────────────────────────────────────────────────────────
// #board-area-inner is rendered at its native design size (--tile-size: 120px, fixed)
// so tiles/fonts/icons stay in exact proportion, then scaled as one unit to fill
// whatever space is actually available — up on a big monitor, down on a small one —
// instead of resizing individual CSS properties (which desynced fonts from tile size,
// see the --tile-size comment in game.css). Called after every redraw() and on resize;
// cheap (a handful of getBoundingClientRect reads), so no throttling needed at this scale.
function fitBoardArea() {
  const outer = document.getElementById('board-area');
  const inner = document.getElementById('board-area-inner');
  const boardRow = document.querySelector('.board-row');
  if (!outer || !inner || !boardRow) return;

  inner.style.transform = 'none';
  inner.style.width = 'auto';
  inner.style.height = 'auto';
  const naturalW = inner.offsetWidth;
  const naturalH = inner.offsetHeight;
  if (!naturalW || !naturalH) return;

  const previewPanel = document.querySelector('.preview-panel');
  const statsPanel = document.querySelector('.stats-panel');
  const logPanel = document.querySelector('.log-panel');
  const rowGap = parseFloat(getComputedStyle(boardRow).gap) || 0;
  const sideWidths = (previewPanel?.offsetWidth ?? 0) + (statsPanel?.offsetWidth ?? 0) + (logPanel?.offsetWidth ?? 0) + rowGap * 3;
  // Not boardRow.clientWidth — .game-layout/.board-row are align-items:center, sized to
  // their own content rather than stretched to the viewport, so that would be circular
  // (board-row's width already depends on board-area's current width). document.
  // documentElement.clientWidth is the true budget: body/.game-layout carry no horizontal
  // padding, and clientWidth (unlike window.innerWidth) stays consistent under browser
  // zoom, where innerWidth/innerHeight can drift from the actual CSS-pixel layout box.
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const availableWidth = viewportWidth - sideWidths - 24; // small safety margin

  // Reserve exactly what the hand needs right now — measured from .hand-area, not
  // .bottom-row. .bottom-row has `flex: 1` in the column layout (see game.css), so it
  // stretches to fill whatever's left over from .board-row's CURRENT height; its own
  // scrollHeight then reports that stretched box size, not the hand's actual content
  // height, which starves the board on every call (each call inherits the previous call's
  // leftover space instead of the hand's true minimum). .hand-area is a plain flex item
  // inside .bottom-row with no flex-grow of its own, so it always sizes to its real content
  // regardless of how tall .bottom-row has been stretched — not circular. A FIXED reserve
  // (tried before .bottom-row.scrollHeight) broke on any hand that wraps past one row
  // (12+ cards after several turns of draw effects): the board claimed more height than was
  // actually free, and the hand scrolled off-screen instead of just needing its own scrollbar.
  const handArea = document.querySelector('.hand-area');
  const layout = document.querySelector('.game-layout');
  const layoutStyle = layout ? getComputedStyle(layout) : null;
  const layoutGap = layoutStyle ? (parseFloat(layoutStyle.gap) || 0) : 8;
  const layoutPadV = layoutStyle ? (parseFloat(layoutStyle.paddingTop) || 0) + (parseFloat(layoutStyle.paddingBottom) || 0) : 20;
  const reservedBottom = Math.max(handArea?.scrollHeight ?? 0, 170);
  const availableHeight = viewportHeight - reservedBottom - layoutGap - layoutPadV;

  // Clamp scale to a sane range — 0.5 keeps it legible on a tiny window, 2 keeps tiles
  // from becoming absurdly large on an ultrawide monitor with a narrow browser height.
  const scale = Math.max(0.5, Math.min(availableWidth / naturalW, availableHeight / naturalH, 2));

  inner.style.width = `${naturalW}px`;
  inner.style.height = `${naturalH}px`;
  inner.style.transform = `scale(${scale})`;
  outer.style.width = `${naturalW * scale}px`;
  outer.style.height = `${naturalH * scale}px`;

  // board-row itself must NOT be left at its default auto height (fits its tallest child):
  // .log-panel/.log are designed to scroll internally rather than grow, but that only
  // works if the row gives them a height ceiling from OUTSIDE — with auto, a long battle
  // log instead inflated the row itself (unbounded), pushing the hand off-screen below it.
  // Pinning the row's height to the board's own computed height makes board-area the usual
  // source of truth — EXCEPT at high zoom / a short window, where the scaled board can end
  // up shorter than .preview-panel/.stats-panel's own real minimum content height (their
  // text/padding don't scale down with the board — only #board-area-inner does). .board-row
  // has no overflow:hidden of its own, so if its forced height comes out smaller than a
  // sibling's unshrinkable content minimum, that sibling spills straight past the row's
  // bottom edge into .bottom-row below it (P1's stat block overlapping the hand). Flooring
  // the row height at previewPanel/statsPanel's own natural height (they have no min-height:0,
  // so this reliably reports their true minimum regardless of the row's current height)
  // prevents that — logPanel is deliberately excluded, it opts into shrinking via its own
  // min-height:0 + internal .log scroll.
  const rowFloor = Math.max(naturalH * scale, previewPanel?.scrollHeight ?? 0, statsPanel?.scrollHeight ?? 0);
  boardRow.style.height = `${rowFloor}px`;
}
window.addEventListener('resize', fitBoardArea);
// Browser zoom doesn't reliably fire a plain 'resize' event in every browser, but does
// fire on visualViewport — without this, zooming can leave the board fit stale until the
// next redraw()-triggering action.
window.visualViewport?.addEventListener('resize', fitBoardArea);

let turnToastTimer = null;
// Brief centered banner flash on turn start, Hearthstone-style — separate from the
// persistent #turn-display text, which stays on screen for the whole turn.
function showTurnToast(text) {
  const toast = document.getElementById('turn-toast');
  if (!toast) return;
  clearTimeout(turnToastTimer);
  toast.textContent = text;
  toast.classList.remove('show');
  void toast.offsetWidth; // restart the CSS animation if the toast fires again quickly
  toast.classList.add('show');
  turnToastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
}

// Direct HQ result flash — the HQ number itself pulses red (reusing FxFlash, same primitive
// the source unit's board-card pulse uses) and a "DIRECT HIT" popup stamps near it, batched
// by target: evaluateDirectHQ sweeps every qualifying unit in one pass, so more than one unit
// hitting the SAME HQ in the same sweep is a real case — one flash/popup per target HQ, not
// one replayed per source unit, per the plan's SOURCE→TARGET→RESULT batching rule.
function flashDirectHit(targetPlayer, amount) {
  const el = document.getElementById(`${targetPlayer}-hq`);
  if (!el) return;
  el.classList.remove('fx-flash-negative');
  void el.offsetWidth; // restart the CSS animation if it fires again quickly
  el.classList.add('fx-flash-negative');
  const rect = el.getBoundingClientRect();
  showFxPopup(rect.left + rect.width / 2, rect.top, amount > 1 ? `DIRECT HIT ×${amount}` : 'DIRECT HIT');
}

// Causality pulse, target stage — the delayed half of "source glow -> target flash" (source
// glow is applied synchronously via the normal transitionFlags path, see UI_FEEDBACK_UPGRADE_
// PLAN.md §14). Reuses the board-card gold flash directly (same DOM query pattern as
// flashDirectHit above) rather than a full commitState, since by the time this fires the board
// has already repainted once and we're only touching already-rendered nodes.
function flashCausalityTarget(tileKey) {
  const el = document.querySelector(`.tile[data-key="${tileKey}"] .board-card`);
  if (!el) return;
  el.classList.remove('fx-flash-positive');
  void el.offsetWidth;
  el.classList.add('fx-flash-positive');
}

function redraw() {
  if (!state) return;
  // Debug/testing hook only — read-only snapshot for external tooling (e.g. selfplay bot).
  // No gameplay effect: nothing reads this back into game state.
  window.__SIGNAL_DEBUG__ = { state, uiState, selectedHandCardId, pendingAttackerKey };
  renderHQ(state);

  // One-shot transition flags (destroy reticle, objective-captured flash, hero-activation glow)
  // are meant to play exactly once, on the render right after the commitState that set them —
  // but several code paths (placing a card chief among them) call redraw() directly instead of
  // going through commitState, and commitState is the only place that used to reset these. Left
  // alone, a stale flag would keep replaying its animation (and, for objective capture, its
  // popup text) on every unrelated future redraw until some later commitState happened to
  // overwrite it. Snapshotting locally and clearing the module-level vars right after this one
  // render consumes them makes them genuinely one-shot regardless of which path triggered this
  // redraw.
  const transitionFlagsForThisRender = lastTransitionFlags;
  const objectiveTransitionFlagsForThisRender = lastObjectiveTransitionFlags;
  const heroActivationKeyForThisRender = lastHeroActivationKey;
  lastTransitionFlags = new Map();
  lastObjectiveTransitionFlags = new Map();
  lastHeroActivationKey = null;

  if (uiState === "placing") {
    renderBoard(state, null, getValidTiles(), lastChangedKeys, transitionFlagsForThisRender, getTerrainBlockedTiles(), objectiveTransitionFlagsForThisRender);
  } else {
    renderBoard(state, null, null, lastChangedKeys, transitionFlagsForThisRender, null, objectiveTransitionFlagsForThisRender);
  }

  if (uiState === "targeting" && pendingAttackerKey) {
    const attackableTargets = getAttackableTargets(state, pendingAttackerKey);
    const attackableKeys = new Set(attackableTargets.map(t => t.key));

    const attackerTile = document.querySelector(`[data-key="${pendingAttackerKey}"]`);
    if (attackerTile) attackerTile.classList.add('selected-unit');

    for (const key of attackableKeys) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('targetable');
    }
  }

  if (uiState === "command-targeting" && pendingCommandId !== null) {
    const validKeys = getCommandTargets(pendingCommandId);
    const ENEMY_CMDS = new Set([16, 20, 79]);
    const cls = ENEMY_CMDS.has(pendingCommandId) ? 'targetable' : 'cmd-target';
    for (const key of validKeys) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add(cls);
    }
  }

  if (uiState === 'hero-targeting' && pendingHeroTargets) {
    for (const key of pendingHeroTargets) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('cmd-target');
    }
  }
  if (uiState === 'hero-maneuver-destination' && pendingHeroManeuverSource) {
    for (const key of getManeuverTargets(state, pendingHeroManeuverSource.key)) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('cmd-target');
    }
  }
  if (uiState === 'command-maneuver-source' && pendingCommandId) {
    const sources = getCommandManeuverSources(pendingCommandId, pendingCommandManeuverSource?.excludeKey ?? null);
    for (const key of sources ?? []) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('cmd-target');
    }
  }
  if (uiState === 'command-maneuver-destination' && pendingCommandManeuverSource?.key) {
    for (const key of getManeuverTargets(state, pendingCommandManeuverSource.key)) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('cmd-target');
    }
  }
  if (uiState === 'unit-maneuver-source' && pendingUnitManeuverPlacedKey) {
    for (const key of getUnitOnPlayManeuverSources(pendingUnitManeuverPlacedKey)) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('cmd-target');
    }
  }
  if (uiState === 'unit-maneuver-destination' && pendingUnitManeuverSource?.key) {
    for (const key of getManeuverTargets(state, pendingUnitManeuverSource.key)) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('cmd-target');
    }
  }
  if (uiState === 'command-coordstrike-first') {
    for (const key of getCoordStrikeFirstCandidates()) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('cmd-target');
    }
  }
  if (uiState === 'command-coordstrike-second' && pendingCoordStrikeFirst) {
    for (const key of getCoordStrikeSecondCandidates(pendingCoordStrikeFirst)) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.classList.add('cmd-target');
    }
  }

  if (uiState === 'arty-targeting') {
    const active = state.initiative;
    for (const [key, unit] of Object.entries(state.board)) {
      if (unit && unit.owner !== active && unit.state !== 'destroyed') {
        const el = document.querySelector(`[data-key="${key}"]`);
        if (el) el.classList.add('targetable');
      }
    }
  }

  // Objective player-choice targeting — highlight driven by the same computeObjectivePickTargets
  // call the click handler validates against (single source of truth, so a highlighted tile is
  // always a legal click). Maneuver's 2nd step also marks the already-chosen source Unit as
  // "locked in" via the existing selectedTileKey-style highlight class, so it's visually obvious
  // the player is now picking a destination, not another Unit.
  const modeBanner = document.getElementById('mode-banner');
  if (modeBanner) modeBanner.style.display = 'none';
  if (uiState === 'objective-picking' && state.pendingObjectivePick) {
    const pick = state.pendingObjectivePick;
    const obj = state.objectives[pick.objectiveKey];
    if (obj) {
      const effectType = getObjectivePickEffectType(obj.cardId, obj.level);
      for (const key of computeObjectivePickTargets(state, pick.objectiveKey, effectType, pick.sourceKey)) {
        const el = document.querySelector(`[data-key="${key}"]`);
        if (el) el.classList.add('cmd-target');
      }
      if (pick.sourceKey) {
        const srcEl = document.querySelector(`[data-key="${pick.sourceKey}"]`);
        if (srcEl) srcEl.classList.add('highlight');
      }
      if (modeBanner) {
        modeBanner.textContent = objectivePickBannerText(state, pick);
        modeBanner.style.display = 'block';
      }
    }
  }

  const handRole = myRole ?? state.initiative;
  renderHand(state[handRole].hand, 'p1-hand', selectedHandCardId, { playerState: state[handRole] });
  renderHeroZones(state, selectedHeroZone, heroActivationKeyForThisRender);

  const cancelBtn = document.getElementById('btn-cancel');
  if (cancelBtn) {
    const rallyCryAlreadyPicked = ((pendingCommandId === 'C03' || pendingCommandId === 'C10') && pendingRallyCryCount < 2)
    || (pendingCommandId === 'C32' && pendingRallyCryCount === 1);
    cancelBtn.textContent = rallyCryAlreadyPicked ? 'Done' : 'Cancel';
    cancelBtn.disabled = !canCancelInteraction(currentInteractionContext());
  }

  const endTurnBtn = document.getElementById('btn-end-turn');
  const interactionDecision = getInteractionDecision(currentInteractionContext());
  if (isOnline) {
    const isMyTurn = state.initiative === myRole;
    const round = Math.ceil(state.turn / 2);
    document.getElementById('turn-display').textContent = isMyTurn
      ? `Round ${round} — YOUR TURN`
      : `Round ${round} — WAITING FOR OPPONENT`;
    endTurnBtn.disabled = !isMyTurn || interactionDecision.pending;
    endTurnBtn.textContent = !isMyTurn ? 'Waiting...' : interactionDecision.pending ? 'Finish Choice' : 'End Turn';
  } else {
    endTurnBtn.disabled = interactionDecision.pending;
    endTurnBtn.textContent = interactionDecision.pending ? 'Finish Choice' : `End ${state.initiative.toUpperCase()} Turn`;
  }
  endTurnBtn.title = interactionDecision.reason ?? '';

  populateDebugObjectiveDropdown();
  fitBoardArea();
}

// Artillery Position L2/L4 hits are stored on state.pendingArtyHits (synced via Firebase) instead of
// only the local pendingArtyHitCount variable, so the client of the player who actually controls the
// objective enters targeting mode at the start of their turn — not just whoever ended the prior turn.
function syncArtyTargetingUiState() {
  const hits = state.pendingArtyHits ?? 0;
  const iAmActive = myRole === null || myRole === state.initiative;
  if (hits > 0 && iAmActive) {
    pendingArtyHitCount = hits;
    uiState = 'arty-targeting';
  }
}

// Objective player-choice targeting (2026-09-01) — same contract as syncArtyTargetingUiState:
// state.pendingObjectivePick (synced via Firebase, not a local-only variable) is what lets the
// controlling player's own client enter this mode, whether they're the one who just clicked End
// Turn or (online) the client that just received this state via subscribeState.
function syncObjectivePickUiState() {
  const pick = state.pendingObjectivePick;
  const iAmActive = myRole === null || myRole === state.initiative;
  if (pick && iAmActive) {
    uiState = 'objective-picking';
  }
}

function commitState(newState, logLines, transitionFlags, objectiveTransitionFlags, heroActivationKey) {
  lastChangedKeys = new Set(); // player acted — clear opponent highlights
  lastTransitionFlags = transitionFlags ?? new Map();
  lastObjectiveTransitionFlags = objectiveTransitionFlags ?? new Map();
  lastHeroActivationKey = heroActivationKey ?? null;
  state = { ...newState, log: [...(newState.log ?? []), ...(logLines ?? [])] };
  if (logLines?.length) appendLog(logLines);
  syncArtyTargetingUiState();
  syncObjectivePickUiState();
  redraw();
  pushStateIfOnline(state);
}

function pushStateIfOnline(s) {
  if (!isOnline) return;
  const pushId = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  myLastPushId = pushId;
  pushState(gameId, { ...s, _pushId: pushId });
}

// Firebase converts JS arrays to objects with integer keys on retrieval.
// This restores them to real arrays for all fields that must be arrays.
function normalizeFirebaseState(raw) {
  const toArray = v => Array.isArray(v) ? v : Object.values(v ?? {});
  const fixUnit = u => u ? { ...u, tempKeywords: toArray(u.tempKeywords), grantedKeywords: toArray(u.grantedKeywords), permanentKeywords: toArray(u.permanentKeywords) } : u;
  const fixBoard = b => {
    if (!b) return {};
    return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, fixUnit(v)]));
  };
  // heroZones is POSITIONAL (index = board column) and usually sparse, e.g. [null,87,null,null].
  // Firebase strips nulls, so toArray() would collapse that to [87] and silently move the hero
  // to column 0. Rebuild by index instead.
  const fixZones = z => {
    const out = [null, null, null, null];
    if (!z) return out;
    for (const [k, v] of Object.entries(z)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < 4 && v != null) out[i] = v;
    }
    return out;
  };
  const fixPlayer = p => p ? {
    ...p,
    hand:     toArray(p.hand),
    deck:     toArray(p.deck),
    missions: toArray(p.missions),
    heroRoster: toArray(p.heroRoster),
    heroZones:  fixZones(p.heroZones),
    heroesActivatedThisTurn: toArray(p.heroesActivatedThisTurn),
    pendingDiscounts: toArray(p.pendingDiscounts),
    pendingUnitBuffs: toArray(p.pendingUnitBuffs),
    discardPile: toArray(p.discardPile),
  } : p;
  // Craft (H25) / Training Officer (H19) generate card definitions at runtime that only ever
  // existed in the crafting client's own in-memory CARD_BY_ID — without this, the receiving
  // client's CARD_BY_ID[thatId] is undefined the moment the card is visible to them (e.g. on
  // the board), and rendering it throws. `generatedCards` rides along in shared state for
  // exactly this reason; merge every entry into this client's own registry on every receive.
  // Idempotent (ensureGeneratedCard no-ops if already present) and order-independent.
  const generatedCards = raw.generatedCards ?? {};
  for (const [id, def] of Object.entries(generatedCards)) {
    ensureGeneratedCard(id, def);
  }
  return {
    ...raw,
    generatedCards,
    log:   toArray(raw.log),
    p1:    fixPlayer(raw.p1),
    p2:    fixPlayer(raw.p2),
    board: fixBoard(raw.board),
  };
}

function receiveRemoteState(remoteState) {
  const normalized = normalizeFirebaseState(remoteState);
  const prevLogLen = state?.log?.length ?? 0;
  const prevInitiative = state?.initiative;
  // Track tiles changed by the opponent so we can highlight them
  if (state?.board) {
    lastChangedKeys = new Set();
    const allKeys = new Set([...Object.keys(state.board), ...Object.keys(normalized.board ?? {})]);
    for (const key of allKeys) {
      if (JSON.stringify(state.board[key]) !== JSON.stringify((normalized.board ?? {})[key])) {
        lastChangedKeys.add(key);
      }
    }
  }
  state = normalized;
  const newEntries = (normalized.log ?? []).slice(prevLogLen);
  if (newEntries.length) appendLog(newEntries);
  uiState = 'idle';
  syncArtyTargetingUiState(); // overrides 'idle' above if this client owes an Artillery Position hit
  syncObjectivePickUiState(); // overrides 'idle' above if this client owes an Objective pick
  selectedHandCardId = null;
  pendingAttackerKey = null;
  pendingCommandId = null;
  preCommandState = null;
  lastDATargetKey = null;
  selectedHeroZone = null;
  pendingHeroId = null;
  pendingHeroColumn = null;
  pendingHeroTargets = null;
  pendingHalftrackMove = null;
  redraw();
  checkWin();
  // The opponent's End Turn handler can't prompt us, so an inbound state that hands us the
  // turn is where this client runs its own Hero Phase. runHeroPhase re-checks lastObjLevel,
  // so arriving at the same state twice can't double-deploy. Gated on the initiative actually
  // CHANGING (not just "currently my turn") — was previously re-firing the "YOUR TURN" toast
  // on every remote sync received while it was already your turn (e.g. the opponent poking the
  // debug panel mid-turn), reported 2026-08-19: "when other player adds or removes card, to me
  // it flashes your turn."
  if (isOnline && !gameOver && normalized.initiative === myRole && prevInitiative !== normalized.initiative) {
    showTurnToast('YOUR TURN');
    // Deferred if an Objective pick is still pending (doc 04: Objective step, including any
    // player-choice secondary, resolves before free Hero deployment) — resumeObjectiveResolution
    // runs Hero Phase itself once the last pending pick drains.
    if (!normalized.pendingObjectivePick) runHeroPhase(myRole);
  }
}

function showEndScreen(winner) {
  // gameOver flips synchronously so every `!gameOver` guard elsewhere (Hero Phase, turn
  // toasts, etc.) reacts immediately — only the visual reveal is delayed, so the killing
  // blow's own flash/popup/connector-line sequence gets to finish before the full-screen
  // overlay covers the board. 1800ms matches the Hero modal's delay (see runHeroPhase): the
  // longest piece of any single hit's sequence is the "DIRECT HIT" text popup's 1.6s fade,
  // starting 200ms after the hit lands.
  gameOver = true;
  setTimeout(() => {
    document.getElementById('end-winner').textContent = `${winner} WINS`;
    document.getElementById('end-screen').style.display = 'flex';
  }, 1800);
}

function checkWin() {
  if (state.p1.hq <= 0) { showEndScreen('P2'); return true; }
  if (state.p2.hq <= 0) { showEndScreen('P1'); return true; }
  return false;
}

// ── Hero powers ───────────────────────────────────────────────────────────────
// Column-scoped candidate list for a Hero's own column, OR the whole board if Supreme
// Commander (143) is deployed — see hasColumnFreedom in combat.js. Shared by every
// column-scoped active Hero below (91/92/100/142) so "column freedom" has one definition.
function scopedUnits(s, role, col, filterFn) {
  const list = hasColumnFreedom(s[role]) ? unitsOnBoard(s, role) : unitsInColumn(s, col, role);
  return filterFn ? list.filter(filterFn) : list;
}

// Enemy-owned equivalent of scopedUnits, for Heroes whose Power targets the OPPONENT
// (Strike Commander, H15) — same column-freedom rule, opposite ownership filter.
function scopedEnemyUnits(s, role, col, filterFn) {
  const opp = role === 'p1' ? 'p2' : 'p1';
  const list = hasColumnFreedom(s[role]) ? unitsOnBoard(s, opp) : unitsInColumn(s, col, opp);
  return filterFn ? list.filter(filterFn) : list;
}

// Tile keys a column-scoped active power can legally target. null = no target needed
// (an instant), [] = needs a target but none exists right now.
// Run 1 (2026-08-31): rewired to the new H01-H25 id scheme. Heroes not listed here are
// either passive (no Active Power — H02/H04/H06/H08/H13/H14/H20 fire from other hooks, see
// combat.js) or handled outside this switch entirely: H16 Maneuver Commander's 2-step
// source-then-destination flow lives in resolveHeroTargeting/pendingHeroManeuverSource
// (resolveHeroManeuverDestination calls resolveManeuver directly, never reaching
// applyHeroPower's switch below); H19 Training Officer's hand-buff runs through
// applyHandBuff (combat.js) via its own case in that switch. All 25 Heroes are fully wired —
// the switch's default "power not automated yet" case below is unreachable dead code.
function heroTargetKeys(s, role, col, hero) {
  switch (hero.id) {
    case 'H03': // Tactical Commander — any friendly unit in the column
      return scopedUnits(s, role, col).map(u => u.key);
    case 'H05': // Recovery Officer — only a suppressed friendly unit is worth targeting
      return scopedUnits(s, role, col, ({ unit }) => unit.state === 'suppressed').map(u => u.key);
    case 'H10': // Conventional Warfare Commander — friendly Vanilla (no-keyword) unit, board-wide
      return unitsOnBoard(s, role).filter(({ unit }) => !CARD_BY_ID[unit.cardId]?.keyword).map(u => u.key);
    case 'H11': // Field Coordinator — any friendly unit in the column (rotates it; legal even Suppressed)
      return scopedUnits(s, role, col).map(u => u.key);
    case 'H12': // Fire Support Officer — any friendly unit in the column (grants Bombard)
      return scopedUnits(s, role, col).map(u => u.key);
    case 'H15': // Strike Commander — an ENEMY unit in the column
      return scopedEnemyUnits(s, role, col).map(u => u.key);
    case 'H16': // Maneuver Commander — pick the friendly unit to move (2nd click picks the destination)
      return scopedUnits(s, role, col).map(u => u.key);
    case 'H18': // Artillery Commander — friendly Artillery in the column
      return scopedUnits(s, role, col, ({ unit }) => CARD_BY_ID[unit.cardId]?.cls === 'Artillery').map(u => u.key);
    default:
      return null;
  }
}

// Applies an activated Hero Power. `s` must already have the Fuel deducted.
// Run 1 (2026-08-31): rewired to the new H01-H25 id scheme against doc 03's actual ability
// text per Hero (not reused from old cases by id-position — several old/new Heroes share a
// name but not an effect, e.g. old board-wide Armored Commander vs. new column-scoped H07).
function applyHeroPower(s, role, col, hero, targetKey) {
  const log = [];
  const nameOf = key => CARD_BY_ID[s.board[key]?.cardId]?.name ?? 'unit';
  const opp = role === 'p1' ? 'p2' : 'p1';

  switch (hero.id) {
    case 'H01': // Quartermaster General — draw 1
      s = { ...s, [role]: drawCards(s[role], 1) };
      log.push(`${hero.name}: draw 1 card`);
      break;

    case 'H07': // Armored Commander — next Tank in THIS COLUMN costs 3 less
      s = { ...s, [role]: addDiscount(s[role], { appliesTo: 'Tank', column: col, amount: 3, min: 0 }) };
      log.push(`${hero.name}: next Tank played in column ${col + 1} costs 3 less Fuel`);
      break;

    case 'H09': // Command Specialist — next Command costs 2 less (board-wide)
      s = { ...s, [role]: addDiscount(s[role], { appliesTo: 'command', column: null, amount: 2, min: 0 }) };
      log.push(`${hero.name}: next Command costs 2 less Fuel`);
      break;

    case 'H17': // HQ Assault Commander — deal 1 damage to enemy HQ
      s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 1 } };
      log.push(`${hero.name}: 1 damage to ${opp.toUpperCase()}'s HQ`);
      break;

    case 'H22': { // Frontline Marshal — ALL units in this column, friendly AND enemy, +2 permanent
      const keys = hasColumnFreedom(s[role]) ? Object.keys(s.board) : columnKeys(col);
      const newBoard = { ...s.board };
      let count = 0;
      for (const k of keys) {
        const u = newBoard[k];
        if (!u || u.state === 'destroyed') continue;
        newBoard[k] = { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 2, sideBonusTurns: 99 };
        count++;
      }
      s = { ...s, board: newBoard };
      log.push(`${hero.name}: ${count} unit(s) in column ${col + 1} +2 all sides (permanent, friendly and enemy)`);
      break;
    }

    case 'H23': { // Army Group Commander — all friendly units +1 all sides permanently
      const newBoard = { ...s.board };
      let count = 0;
      for (const [k, u] of Object.entries(newBoard)) {
        if (!u || u.owner !== role || u.state === 'destroyed') continue;
        newBoard[k] = { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 };
        count++;
      }
      s = { ...s, board: newBoard };
      log.push(`${hero.name}: ${count} friendly unit(s) +1 all sides (permanent)`);
      break;
    }

    case 'H24': { // Long War Commander — repeat current Power times: random friendly unit in
      // column gets +1 to a random side, permanently. Each repetition independent (doc 01
      // §21/doc 02 Q117) — may all land on the same Unit.
      const power = s[role].longWarPower?.[hero.id] ?? 1;
      const pool = scopedUnits(s, role, col);
      let count = 0;
      if (pool.length) {
        const dirs = ['n', 'e', 's', 'w'];
        for (let i = 0; i < power; i++) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          const dir = dirs[Math.floor(Math.random() * 4)];
          const u = s.board[pick.key];
          s = { ...s, board: { ...s.board, [pick.key]: { ...u, [`perm_${dir}`]: (u[`perm_${dir}`] ?? 0) + 1 } } };
          count++;
        }
      }
      log.push(`${hero.name}: ${count} repetition(s) of +1 permanent to a random side on a random friendly Unit in column ${col + 1}`);
      break;
    }

    case 'H03': { // Tactical Commander — +1 all sides permanently
      const u = s.board[targetKey];
      log.push(`${hero.name}: ${nameOf(targetKey)} +1 all sides (permanent)`);
      s = { ...s, board: { ...s.board, [targetKey]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 } } };
      break;
    }

    case 'H05': { // Recovery Officer — remove Suppression
      log.push(`${hero.name}: ${nameOf(targetKey)} un-suppressed`);
      const result = removeSuppression(s, targetKey);
      s = result.state;
      log.push(...result.log);
      break;
    }

    case 'H10': { // Conventional Warfare Commander — +3 all sides until end of turn
      const u = s.board[targetKey];
      log.push(`${hero.name}: ${nameOf(targetKey)} +3 all sides (until end of turn)`);
      s = { ...s, board: { ...s.board, [targetKey]: { ...u, tempSideBonus: (u.tempSideBonus || 0) + 3 } } };
      break;
    }

    case 'H12': { // Fire Support Officer — grant Bombard until end of turn
      const u = s.board[targetKey];
      log.push(`${hero.name}: ${nameOf(targetKey)} gains Bombard (until end of turn)`);
      s = { ...s, board: { ...s.board, [targetKey]: { ...u, tempKeywords: [...(u.tempKeywords || []), 'Bombard'] } } };
      break;
    }

    case 'H18': { // Artillery Commander — grant Blast until end of turn
      const u = s.board[targetKey];
      log.push(`${hero.name}: ${nameOf(targetKey)} gains Blast (until end of turn)`);
      s = { ...s, board: { ...s.board, [targetKey]: { ...u, tempKeywords: [...(u.tempKeywords || []), 'Blast'] } } };
      break;
    }

    case 'H15': { // Strike Commander — Hit 1 enemy unit in this Hero's column (direct Hit
      // ladder, not attack comparison — doc 01's own note on this Hero).
      const before = s.board[targetKey];
      const beforeName = CARD_BY_ID[before?.cardId]?.name ?? 'unit';
      const { newUnit, hqDamage } = applyHit(before);
      const finalUnit = newUnit.state === 'destroyed' ? null : newUnit;
      s = { ...s, board: { ...s.board, [targetKey]: finalUnit }, [opp]: { ...s[opp], hq: s[opp].hq - hqDamage } };
      log.push(`${hero.name}: Hit ${beforeName} — ${finalUnit === null ? 'Destroyed' : newUnit.state}`);
      const triggered = applyGameEvents(s, [unitSuppressedEvent(targetKey, before, finalUnit)]);
      s = triggered.state;
      log.push(...triggered.log);
      if (finalUnit === null) {
        const pd = applyPostDestructionEffects(s, { unitKey: targetKey, dyingUnit: before, sourceUnitKey: null });
        s = pd.state;
        log.push(...pd.log);
      }
      s = recalculateDynamicStats(s);
      break;
    }

    case 'H19': { // Training Officer — all 1- and 2-cost Units currently in hand +1 all sides
      // permanently. See applyHandBuff (combat.js) for how this works without a hand-instance
      // rewrite: qualifying hand slots get replaced with a freshly-registered buffed clone.
      const { playerState, log: buffLog, generated } = applyHandBuff(s[role], 1, c => c.cost === 1 || c.cost === 2, role);
      // Same cross-client sync requirement as Craft's confirmCraftPick — each clone's full
      // definition has to travel in generatedCards, not just its bare id.
      const newGeneratedCards = { ...(s.generatedCards ?? {}) };
      for (const g of generated) newGeneratedCards[g.id] = g;
      s = { ...s, [role]: playerState, generatedCards: newGeneratedCards };
      log.push(`${hero.name}: ${buffLog.length} Unit(s) in hand +1 all sides (permanent)`);
      log.push(...buffLog);
      break;
    }

    // H16 Maneuver Commander is handled specially in resolveHeroTargeting (2-step
    // source-then-destination flow) — it never reaches this switch with a final targetKey.

    // H25 Chief Aircraft Engineer (Craft) is handled specially in tryActivateHero (opens the
    // 3-candidate picker modal instead of resolving instantly) — it never reaches this switch.

    default:
      log.push(`${hero.name}: power not automated yet`);
  }

  const activatedBefore = s[role].heroesActivatedThisTurn ?? [];
  return {
    state: {
      ...s,
      [role]: {
        ...s[role],
        heroesActivatedThisTurn: activatedBefore.includes(hero.id) ? activatedBefore : [...activatedBefore, hero.id],
      },
    },
    log,
  };
}

// Entry point from a Hero Zone click. Returns true if it consumed the click.
function tryActivateHero(role, col) {
  const ps = state[role];
  const heroId = ps.heroZones?.[col];
  const hero = heroId != null ? CARD_BY_ID[heroId] : null;
  if (!hero || hero.powerType !== 'active') return false;
  if (!hero.implemented) { appendLog([`${hero.name}: power not automated yet`]); return true; }
  // Each Hero may activate once per turn; different Heroes may each activate in the same
  // turn (locked 2026-08-17 — see state.js's heroesActivatedThisTurn).
  const activatedThisTurn = ps.heroesActivatedThisTurn ?? [];
  if (activatedThisTurn.includes(heroId)) { appendLog([`${hero.name}: power already used this turn`]); return true; }

  // Priority Orders (121) discounts, Radio Interference (123) taxes — both apply once,
  // to this one activation, then clear. min 0 per Priority Orders' own wording.
  const discount = ps.pendingHeroDiscount ?? 0;
  const tax = (ps.heroTaxedColumns ?? {})[col] ?? 0;
  // H25 Chief Aircraft Engineer's printed cost escalates down each activation (5->4->3->2->1,
  // floor 1 — see nextCraftCost/advanceCraftCost in combat.js) — base cost must come from
  // there, not the static printed activeCost, or Craft would always charge a flat 5.
  const baseCost = heroId === 'H25' ? nextCraftCost(ps) : (hero.activeCost ?? 0);
  const cost = Math.max(0, baseCost - discount + tax);
  if (ps.fuel < cost) {
    appendLog([`Not enough Fuel for ${hero.name} (need ${cost}, have ${ps.fuel})`]);
    return true;
  }
  const costModLog = [];
  if (discount > 0) costModLog.push(`Priority Orders: -${discount}F`);
  if (tax > 0) costModLog.push(`Radio Interference: +${tax}F`);
  const spendCostMods = playerState => {
    const { [col]: _taxed, ...restTaxed } = playerState.heroTaxedColumns ?? {};
    return {
      ...playerState,
      pendingHeroDiscount: 0,
      heroTaxedColumns: restTaxed,
    };
  };

  const targets = heroTargetKeys(state, role, col, hero);

  if (targets === null) { // instant — no target to pick
    if (hero.id === 'H25') { // Chief Aircraft Engineer — Craft: pay/lock now, resolve the
      // 3-candidate picker via modal (see showCraftPickerModal) rather than applyHeroPower.
      const activatedBefore = ps.heroesActivatedThisTurn ?? [];
      const paid = {
        ...state,
        [role]: {
          ...spendCostMods(ps),
          fuel: ps.fuel - cost,
          heroesActivatedThisTurn: activatedBefore.includes(hero.id) ? activatedBefore : [...activatedBefore, hero.id],
        },
      };
      commitState(paid, costModLog);
      showCraftPickerModal(role);
      return true;
    }
    const paid = { ...state, [role]: { ...spendCostMods(ps), fuel: ps.fuel - cost } };
    const { state: next, log } = applyHeroPower(paid, role, col, hero, null);
    commitState(next, [...costModLog, ...log], undefined, undefined, `${role}-${col}`);
    checkWin();
    return true;
  }

  if (!targets.length) {
    appendLog([`${hero.name}: no valid target in column ${col + 1}`]);
    return true;
  }

  // Enter targeting. Fuel is deducted now and the pre-state snapshotted, so Cancel restores
  // it (and the discount/tax, since they were consumed from this same pre-cancel state) —
  // the same contract commands use (see startCommandTargeting).
  preCommandState = state;
  state = { ...state, [role]: { ...spendCostMods(ps), fuel: ps.fuel - cost } };
  pendingHeroId = hero.id;
  pendingHeroColumn = col;
  pendingHeroTargets = new Set(targets);
  uiState = 'hero-targeting';
  appendLog([...costModLog, `${hero.name}: choose a target in column ${col + 1}`]);
  redraw();
  return true;
}

// Maneuver Commander (H16) needs a 2nd click (destination) after the 1st (source unit) —
// set while resolveHeroTargeting hands off to the destination-picking step below.
let pendingHeroManeuverSource = null;

function resolveHeroTargeting(clickedKey) {
  if (!pendingHeroTargets?.has(clickedKey)) return;
  const role = state.initiative;
  const hero = CARD_BY_ID[pendingHeroId];
  const col = pendingHeroColumn;
  pendingHeroId = null;
  pendingHeroColumn = null;
  pendingHeroTargets = null;
  preCommandState = null;
  if (hero.id === 'H11') { // Field Coordinator — rotate, direction chosen via modal
    uiState = 'idle';
    showRotateDirectionModal({ kind: 'hero', targetKey: clickedKey, cardName: hero.name, s: state, log: [], role, heroId: hero.id });
    return;
  }
  if (hero.id === 'H16') { // Maneuver Commander — this click picked the source unit; now pick a destination
    pendingHeroManeuverSource = { key: clickedKey, role, hero };
    uiState = 'hero-maneuver-destination';
    appendLog([`${hero.name}: choose a destination tile for ${CARD_BY_ID[state.board[clickedKey]?.cardId]?.name ?? 'the unit'}`]);
    redraw();
    return;
  }
  uiState = 'idle';
  const { state: next, log } = applyHeroPower(state, role, col, hero, clickedKey);
  commitState(next, log, undefined, undefined, `${role}-${col}`);
  checkWin();
}

// H16 Maneuver Commander's 2nd click: destination tile. Maneuvers the unit and resets its
// persistent attacks (doc 01's own note: this Hero's reset is explicit, not intrinsic to
// Maneuver itself — see resetPersistentAttacks in state.js).
function resolveHeroManeuverDestination(destKey) {
  if (!pendingHeroManeuverSource) return;
  const { key: sourceKey, role, hero } = pendingHeroManeuverSource;
  const legalTargets = getManeuverTargets(state, sourceKey);
  if (!legalTargets.includes(destKey)) return;
  pendingHeroManeuverSource = null;
  uiState = 'idle';
  const { state: afterManeuver, log } = resolveManeuver(state, sourceKey, destKey);
  const movedUnit = afterManeuver.board[destKey];
  const reset = { ...afterManeuver, board: { ...afterManeuver.board, [destKey]: resetPersistentAttacks(movedUnit) } };
  const activatedBefore = reset[role].heroesActivatedThisTurn ?? [];
  const next = {
    ...reset,
    [role]: { ...reset[role], heroesActivatedThisTurn: activatedBefore.includes(hero.id) ? activatedBefore : [...activatedBefore, hero.id] },
  };
  commitState(next, [...log, `${hero.name}: attacks reset`]);
  checkWin();
}

// Aircraft On-Play Maneuver (A55 Tactical Fighter, A56 Escort Fighter, A61 Strategic Bomber,
// A62 Fighter-Bomber, A63 Strike Aircraft, A65 Ground-Attack Aircraft — all share identical
// ability text: "On Play: Maneuver 1 other friendly Unit to another legal position."). Doc 01
// §26: a Unit's target-dependent On Play effect stays legal to play even with no legal target —
// the effect portion just no-ops — but is not itself optional once a legal (source, destination)
// pair exists (no "may" in the printed text), so there's no Cancel-with-refund here the way
// Hero/Command Maneuver flows have (the Unit is already placed; only the choice of which other
// friendly Unit to move, and where, remains). 2-step source-then-destination flow, same shape as
// the existing Hero H16 / Command C21/C27/C35 Maneuver flows, generalized for a fresh placement.
let pendingUnitManeuverPlacedKey = null; // which just-placed Aircraft triggered this
let pendingUnitManeuverSource = null;    // { key } once the first pick (unit to move) is made

// Candidates for the "1 other friendly Unit" pick: friendly, not the just-placed Unit itself,
// state === 'normal' (a Suppressed Unit can't be Maneuvered — matches getCommandManeuverSources'
// convention), AND pre-filtered to only those with at least 1 legal destination so the player
// can never pick a source that leads to a dead end with nowhere to place it.
function getUnitOnPlayManeuverSources(excludeKey) {
  const active = state.initiative;
  return new Set(
    Object.entries(state.board)
      .filter(([k, u]) => k !== excludeKey && u && u.owner === active && u.state === 'normal')
      .map(([k]) => k)
      .filter(k => getManeuverTargets(state, k).length > 0)
  );
}

function resolveUnitManeuverSource(sourceKey) {
  if (!getUnitOnPlayManeuverSources(pendingUnitManeuverPlacedKey).has(sourceKey)) return;
  pendingUnitManeuverSource = { key: sourceKey };
  uiState = 'unit-maneuver-destination';
  appendLog([`Choose a destination tile for ${CARD_BY_ID[state.board[sourceKey]?.cardId]?.name ?? 'the unit'}`]);
  redraw();
}

// Resumes the normal placement tail (the placed Aircraft's own immediate-attack check) once the
// Maneuver resolves — that check was deferred when this flow was entered instead of falling
// through to it directly (see the PLACING block below).
function resolveUnitManeuverDestination(destKey) {
  if (!pendingUnitManeuverSource?.key) return;
  const { key: sourceKey } = pendingUnitManeuverSource;
  const legalTargets = getManeuverTargets(state, sourceKey);
  if (!legalTargets.includes(destKey)) return;
  const placedKey = pendingUnitManeuverPlacedKey;
  pendingUnitManeuverSource = null;
  pendingUnitManeuverPlacedKey = null;

  let { state: s, log } = resolveManeuver(state, sourceKey, destKey);
  s = recalculateDynamicStats(s);
  const placedUnit = s.board[placedKey];
  const placedCard = CARD_BY_ID[placedUnit?.cardId];
  log = [...log, `${placedCard?.name ?? 'Aircraft'}: On Play Maneuver resolved`];

  // Objective Marshal / Infantry Commander / Emergency Logistics Officer fire AFTER the Unit's
  // own On Play (doc 01 §22) — for a Maneuver-On-Play Unit, THIS Maneuver is that On Play, so
  // the call is here rather than in the PLACING block (which skipped it for this exact case).
  if (placedUnit) {
    const owner = placedUnit.owner;
    const col = Number(placedKey.split(',')[1]);
    const hp = checkHeroPassivesOnPlace(s, owner, col, placedKey, placedCard);
    s = hp.state;
    log = [...log, ...hp.log];
  }

  const targets = getAttackableTargets(s, placedKey);
  if (targets.length > 0) {
    uiState = 'targeting';
    pendingAttackerKey = placedKey;
  } else {
    uiState = 'idle';
    pendingAttackerKey = null;
  }
  commitState(s, log);
  checkWin();
}

// Mobile Command Halftrack (114) on-play: column index awaiting an optional Hero move into
// its (confirmed-empty) zone, or null. Set at placement, cleared by a move, a click on the
// target zone itself (skip), or any of the usual transient-state resets.
let pendingHalftrackMove = null;

// ── Hero Zone interaction — reposition ────────────────────────────────────────
// One command-line action per turn: move a deployed Hero to an empty zone, OR swap two
// deployed Heroes. A reinforcement already consumed it. Click a Hero to pick it up, then
// click the destination zone; click the same Hero again to cancel.
let selectedHeroZone = null; // column index of the picked-up hero, or null

// Plain click on a Hero activates its power; Shift+click always picks it up to reposition.
// A Hero that can't activate (passive, spent, unaffordable) falls through to pick-up, so a
// plain click is never a dead end.
function handleHeroZoneClick(role, col, shiftKey = false) {
  if (gameOver || !state) return;
  // Radio Interference (123) — the one case that targets an ENEMY Hero Zone, so it must be
  // checked before the "only on your own turn/heroes" guard below turns away that click.
  if (uiState === 'command-hero-targeting') {
    if (isOnline && myRole !== state.initiative) return;
    if (role === state.initiative) return; // must pick the opponent's Hero, not your own
    resolveEnemyHeroTargeting(role, col);
    return;
  }
  // Mobile Command Halftrack (114) on-play: click one of your OTHER deployed Heroes to move
  // it into pendingHalftrackMove's (empty) column, or click that column itself to skip.
  if (pendingHalftrackMove != null) {
    if (role !== state.initiative || (isOnline && myRole !== role)) return;
    if (col === pendingHalftrackMove) { pendingHalftrackMove = null; appendLog(['Mobile Command Halftrack: skipped']); redraw(); return; }
    const ps = state[role];
    const zones = ps.heroZones ?? [null, null, null, null];
    if (zones[col] == null) return; // nothing to move from an empty zone
    const target = pendingHalftrackMove;
    const next = [...zones];
    const movedName = CARD_BY_ID[next[col]]?.name ?? 'Hero';
    next[target] = next[col];
    next[col] = null;
    pendingHalftrackMove = null;
    commitState(
      { ...state, [role]: { ...ps, heroZones: next } },
      [`Mobile Command Halftrack: ${movedName} moves to column ${target + 1}`],
    );
    return;
  }
  if (state.initiative !== role) return;                 // only on your own turn
  if (isOnline && myRole !== role) return;               // and only your own heroes
  // Command Shuffle (C15): reuses this exact pick-up/drop flow, but must not activate a
  // power on pick-up and must not spend (or require) the normal Hero Phase reposition.
  const shuffleActive = pendingCommandId === 'C15';
  // A picked-up Hero or Command Shuffle must be allowed to finish through this handler.
  // Every other pending action owns the input until it resolves or is cancelled.
  if (uiState !== 'idle' && !shuffleActive) return;
  if (anyBlockingModalOpen()) return;
  const continuingHeroMove = selectedHeroZone !== null || shuffleActive;
  if (getInteractionDecision(currentInteractionContext()).pending && !continuingHeroMove) return;
  const ps = state[role];
  const zones = ps.heroZones ?? [null, null, null, null];

  if (selectedHeroZone === null) {
    if (zones[col] == null) return;                      // nothing to pick up
    if (!shiftKey && !shuffleActive && tryActivateHero(role, col)) return; // power fired (or refused with a reason)
    if (ps.heroRepositioned && !shuffleActive) {
      appendLog(['Hero Phase already used this turn']);
      return;
    }
    selectedHeroZone = col;
    redraw();
    return;
  }

  if (selectedHeroZone === col) { selectedHeroZone = null; redraw(); return; } // cancel

  const from = selectedHeroZone;
  const next = [...zones];
  const moved = CARD_BY_ID[next[from]]?.name ?? 'Hero';
  const swappedWith = next[col] != null ? CARD_BY_ID[next[col]]?.name : null;
  [next[from], next[col]] = [next[col], next[from]];     // move or swap, same operation
  selectedHeroZone = null;

  const prefix = shuffleActive ? 'Command Shuffle: ' : '';
  const msg = swappedWith
    ? `${prefix}${moved} swaps with ${swappedWith} (columns ${from + 1} ↔ ${col + 1})`
    : `${prefix}${moved} repositions to column ${col + 1}`;

  let afterMove = { ...state, [role]: { ...ps, heroZones: next, heroRepositioned: shuffleActive ? ps.heroRepositioned : true } };
  const msgs = [msg];
  if (shuffleActive) { // C15 is a true Command play — H20 checks here, not on a normal Hero reposition
    const rs = applyRuthlessStrategistIfPresent(afterMove, role);
    afterMove = rs.state;
    msgs.push(...rs.log);
  }
  commitState(afterMove, msgs);
  if (shuffleActive) { pendingCommandId = null; preCommandState = null; checkWin(); }
}

for (const role of ['p1', 'p2']) {
  document.getElementById(`hero-zone-${role}`)?.addEventListener('click', e => {
    const slot = e.target.closest('.hero-zone-slot');
    if (!slot) return;
    const [, colStr] = (slot.dataset.heroZone ?? '').split('-');
    const col = Number(colStr);
    if (!Number.isInteger(col)) return;
    handleHeroZoneClick(role, col, e.shiftKey);
  });
}

// ── Hand interaction ──────────────────────────────────────────────────────────

document.getElementById('p1-hand').addEventListener('click', e => {
  if (gameOver || !state) return;
  if (isOnline && state.initiative !== myRole) return;
  const cardEl = e.target.closest('.hand-card');
  if (!cardEl) return;
  const cardId = cardEl.dataset.cardId;
  const card = CARD_BY_ID[cardId];
  if (!card) return;

  if (selectedHandCardId === cardId && uiState === 'placing') {
    selectedHandCardId = null;
    uiState = "idle";
    redraw();
    return;
  }

  // Do not let a second card replace an attack, paid target selection, Hero choice, or other
  // unresolved decision. The current action must finish (or use Cancel when allowed) first.
  if (getInteractionDecision(currentInteractionContext()).pending) return;

  if (card.type === 'unit') {
    const active = state.initiative;
    // Same discount formula as the placement handler below — selecting the card must use the
    // same effective cost the hand display shows, or a discounted-but-affordable Tank gets
    // rejected here quoting the full undiscounted price.
    // col=null — no tile chosen yet, so column-restricted discounts count optimistically,
    // matching what the hand display shows. Placement re-computes with the real column.
    const discount = discountFor(state[active], card, null);
    const effectiveCost = card.cost - discount;
    if (state[active].fuel < effectiveCost) {
      appendLog([`Not enough Fuel for ${card.name} (need ${effectiveCost}, have ${state[active].fuel})`]);
      redraw();
      return;
    }
    selectedHandCardId = cardId;
    uiState = "placing";
  } else if (card.type === 'command') {
    const active = state.initiative;
    // Same discount formula as the placement handler above (Command Specialist's Hero
    // Power applies here — it was previously ignored everywhere in the command path).
    const discount = discountFor(state[active], card, null);
    const effectiveCost = card.cost - discount;
    if (state[active].fuel < effectiveCost) {
      appendLog([`Not enough Fuel for ${card.name} (need ${effectiveCost}, have ${state[active].fuel})`]);
      redraw();
      return;
    }
    if (COMMAND_MANEUVER_SOURCE_FILTER[cardId]) { // C21/C27/C35 — 2-step Maneuver flow
      startCommandManeuver(cardId);
      return;
    }
    if (cardId === 'C06') { // Coordinated Strike — 2-unit multi-select
      startCoordinatedStrike(cardId);
      return;
    }
    if (cardId === 'C15' && !(state[active].heroZones ?? []).some(z => z != null)) {
      // Command Shuffle needs a deployed Hero to move/swap — block pre-cost like every other
      // targeted Command's zero-target case (playInstantCommand's own C15 case only discovers
      // this AFTER its unconditional top-of-function Fuel/hand deduction, which would otherwise
      // waste the card for a no-op instead of refusing the play, per doc 01 §26).
      appendLog([`${card.name}: no deployed Hero to move`]);
      return;
    }
    if (!playInstantCommand(cardId)) {
      const validTargets = getCommandTargets(cardId);
      if (validTargets === null) {
        appendLog([`${card.name}: not yet implemented`]);
      } else if (validTargets.size > 0) {
        startCommandTargeting(cardId);
      } else {
        appendLog([`${card.name}: no valid targets`]);
      }
    } else {
      checkWin();
    }
    return;
  }
  redraw();
});

// ── Board interaction ─────────────────────────────────────────────────────────

document.getElementById('board').addEventListener('click', e => {
  if (gameOver || !state) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const clickedKey = tile.dataset.key;

  // DEBUG UNIT SELECTION — takes priority over every other board-click mode, and
  // deliberately does not check the isOnline turn-gate below (the debug panel must be
  // able to select and edit either player's units regardless of whose turn it is).
  if (debugSelectingUnit) {
    const unit = state.board[clickedKey];
    if (!unit) return;
    debugSelectedUnitKey = clickedKey;
    debugSelectingUnit = false;
    const name = CARD_BY_ID[unit.cardId]?.name ?? '?';
    document.getElementById('debug-unit-hint').textContent = `Selected: ${name} at ${clickedKey}`;
    return;
  }

  if (isOnline && state.initiative !== myRole) return;

  // ARTILLERY POSITION TARGETING
  if (uiState === 'arty-targeting') {
    const unit = state.board[clickedKey];
    const active = state.initiative;
    if (!unit || unit.owner === active || unit.state === 'destroyed') return;
    const { newUnit, hqDamage } = applyHit(unit);
    const finalUnit = newUnit.state === 'destroyed' ? null : newUnit;
    const newBoard = { ...state.board, [clickedKey]: finalUnit };
    const defOwner = unit.owner;
    pendingArtyHitCount--;
    uiState = pendingArtyHitCount > 0 ? 'arty-targeting' : 'idle';
    let newS = {
      ...state, board: newBoard, pendingArtyHits: pendingArtyHitCount,
      [defOwner]: { ...state[defOwner], hq: state[defOwner].hq - hqDamage },
    };
    const stateLabel = finalUnit === null ? 'Destroyed' : newUnit.state === 'suppressed' ? 'Suppressed' : 'armor absorbed';
    const log = [`Artillery Position: ${CARD_BY_ID[unit.cardId]?.name} → ${stateLabel}`];
    const triggered = applyGameEvents(newS, [unitSuppressedEvent(clickedKey, unit, finalUnit)]);
    newS = triggered.state;
    log.push(...triggered.log);
    if (finalUnit === null) {
      // Last Stand / Breakthrough (shared destruction chain) — no source Unit for
      // Breakthrough attribution since this Hit came from the Objective, not a Unit attack.
      const pd = applyPostDestructionEffects(newS, { unitKey: clickedKey, dyingUnit: unit, sourceUnitKey: null });
      newS = pd.state;
      log.push(...pd.log);
    }
    newS = recalculateDynamicStats(newS);
    const artyTransitionFlags = new Map();
    if (finalUnit === null) {
      artyTransitionFlags.set(clickedKey, 'destroyed');
      const destroyedName = CARD_BY_ID[unit.cardId]?.name;
      if (destroyedName) {
        const rect = tile.getBoundingClientRect();
        showFxPopup(rect.left + rect.width / 2, rect.top, `${destroyedName} destroyed`);
      }
    }
    else if (newUnit.state === 'suppressed') artyTransitionFlags.set(clickedKey, 'suppressed');
    else if (newUnit.state === 'normal') {
      artyTransitionFlags.set(clickedKey, 'armor-absorbed');
      const rect = tile.getBoundingClientRect();
      showFxPopup(rect.left + rect.width / 2, rect.top, 'ARMOR ABSORBED');
    }
    commitState(newS, log, artyTransitionFlags);
    checkWin();
    return;
  }

  // OBJECTIVE PLAYER-CHOICE TARGETING (Airfield L2 / Supply Depot L1 / City L1 / Artillery
  // Position L1 — see applyObjectiveEffects / computeObjectivePickTargets, combat.js)
  if (uiState === 'objective-picking') {
    resolveObjectivePickClick(clickedKey);
    return;
  }

  // PLACING
  if (uiState === "placing") {
    if (state.board[clickedKey] || state.objectives[clickedKey]) return;

    const active = state.initiative;
    const card = CARD_BY_ID[selectedHandCardId];
    const [r, c] = clickedKey.split(',').map(Number);
    const terrain = getTerrain(state.mapId, r, c);

    if (!canPlaceOnTerrain(card, terrain)) {
      appendLog([`${card.name} cannot enter ${terrain} terrain`]);
      const rect = tile.getBoundingClientRect();
      showFxPopup(rect.left + rect.width / 2, rect.top, 'Blocked by terrain');
      return;
    }
    // Real column is known now, so column-restricted discounts are evaluated properly here.
    const discount = discountFor(state[active], card, c);
    const effectiveCost = card.cost - discount;

    if (state[active].fuel < effectiveCost) {
      appendLog([`Not enough Fuel for ${card.name} (need ${effectiveCost}, have ${state[active].fuel})`]);
      selectedHandCardId = null;
      uiState = "idle";
      redraw();
      return;
    }

    const handAfter = [...state[active].hand];
    const idx = handAfter.indexOf(selectedHandCardId);
    if (idx !== -1) handAfter.splice(idx, 1);

    const placedUnit = {
      cardId: selectedHandCardId,
      owner: active,
      state: 'normal',
      armorHits: 0,
      tempKeywords: [],
      grantedKeywords: [],
      permanentKeywords: [],
      tempSideBonus: 0,
      persistentSpent: 0,
      tempExtraAttacks: 0,
      tempExtraAttacksSpent: 0,
      justPlaced: true,
      rotation: 0,
    };

    let newState = {
      ...state,
      board: { ...state.board, [clickedKey]: placedUnit },
      [active]: consumeDiscounts(
        { ...state[active], fuel: state[active].fuel - effectiveCost, hand: handAfter },
        card, c, discount,
      ),
    };

    // Inspire/Muster (combat.js's own doc comment): "Callers must call recalculateDynamicStats
    // after every placement, movement, or destruction — the 3 events that can change
    // adjacency/board-Infantry-count." Placement was the one of the three that never actually
    // did this — every other event (Maneuver, combat destruction, Objective effects, Hero
    // powers) recalculates correctly. Confirmed live 2026-09-01: placing a second friendly
    // Infantry next to an existing Muster unit left the Muster unit showing its un-buffed base
    // stats until some unrelated later action (an attack, End Turn) happened to recalculate —
    // meaning an attack made in the meantime would have used the wrong (too-low) side value.
    const dynamicBefore = new Map(
      Object.entries(newState.board).filter(([, u]) => u).map(([k, u]) => [k, u.dynamicSideBonus || 0])
    );
    newState = recalculateDynamicStats(newState);
    // Inspire/Muster causality pulse (§14): unlike Rally/Breakthrough/Last Stand, there's no
    // single "source" tile to glow first — an aura's effect is a board-wide recalculation, not
    // a one-shot trigger — so this is a single-stage flash on whichever tiles' dynamicSideBonus
    // actually went up as a result of this placement (a new Inspire source reaching adjacent
    // units, a new Infantry raising every Muster unit's count, or the placed Unit itself
    // benefiting from an existing aura). Scheduled via setTimeout so it fires after whichever
    // redraw() this handler ends up calling below (there are several early-return branches for
    // On-Play UI round-trips), rather than depending on any one of them.
    const dynamicPulseTargets = Object.keys(newState.board).filter(k => {
      const u = newState.board[k];
      return u && (u.dynamicSideBonus || 0) > (dynamicBefore.get(k) ?? 0);
    });
    if (dynamicPulseTargets.length > 0) {
      setTimeout(() => dynamicPulseTargets.forEach(flashCausalityTarget), 50);
    }
    const logLines = [`Placed ${card.name} at ${clickedKey} (${terrain})${discount > 0 ? ` [Armored Spearhead: -${discount} Fuel]` : ''}`];
    state = { ...newState, log: [...(newState.log ?? []), ...logLines] };
    appendLog(logLines); // fire immediately so it displays before any On-Play/Hero-passive lines below

    // Unit's own "On Play" ability MUST resolve before Objective Marshal / Infantry Commander /
    // Emergency Logistics Officer passives (doc 01 §22, checklist Section 7 — corrected
    // 2026-08-31, these previously fired in the wrong order relative to the Unit's own On Play).
    // Run 1: the old per-old-numeric-id dispatcher (checkUnitOnPlayAbility, Veteran Signal Corps
    // 119 / Combat Engineers 112 — both archived, no new-truth equivalent) and the Deathrattle-
    // only checkPendingUnitBuff (Convoy Escort 138, also archived) are both removed. Two generic
    // hooks remain: a Craft-generated Aircraft's drawback (doc 01 §28), which resolves
    // synchronously right here; and the Aircraft "Maneuver 1 other friendly Unit" On Play
    // (A55/A56/A61/A62/A63/A65 — see getUnitOnPlayManeuverSources above), which needs a UI
    // round-trip, so for THAT case the Hero-passives call below is skipped here and instead
    // fires from resolveUnitManeuverDestination once the Maneuver actually resolves.
    if (card.generated && card.craftDrawback) {
      const { state: afterDrawback, log: drawbackLog } = resolveCraftDrawback(state, active, clickedKey, card.craftDrawback);
      state = { ...afterDrawback, log: [...(afterDrawback.log ?? []), ...drawbackLog] };
      appendLog(drawbackLog);
    }

    const staticKeywords = Array.isArray(card.keyword) ? card.keyword : (card.keyword ? [card.keyword] : []);
    if (staticKeywords.includes('Maneuver') && card.ability?.startsWith('On Play: Maneuver')) {
      if (getUnitOnPlayManeuverSources(clickedKey).size > 0) {
        pendingUnitManeuverPlacedKey = clickedKey;
        uiState = 'unit-maneuver-source';
        selectedHandCardId = null;
        appendLog([`${card.name}: choose a friendly Unit to Maneuver`]);
        redraw();
        pushStateIfOnline(state);
        return;
      }
    }

    // Objective Marshal / Infantry Commander / Emergency Logistics Officer — "first qualifying
    // Unit played this turn" passives. Fires here (after the Unit's own On Play resolved above,
    // or correctly no-op'd per doc 01 §26 if it had no legal target) for every placement except
    // a Maneuver-On-Play Unit that found a legal Maneuver target, which returned early above and
    // instead triggers this same call from resolveUnitManeuverDestination.
    const { state: afterHeroPassives, log: heroPassiveLog } = checkHeroPassivesOnPlace(state, active, c, clickedKey, card);
    if (heroPassiveLog.length > 0) {
      state = { ...afterHeroPassives, log: [...(afterHeroPassives.log ?? []), ...heroPassiveLog] };
      appendLog(heroPassiveLog);
    } else {
      state = afterHeroPassives;
    }

    // Mobile Command Halftrack (114) — on-play, offers to move a Hero into this (empty)
    // column. Needs UI state (which card.id checks can't set), so it stays here rather
    // than in checkUnitOnPlayAbility.
    if (card.id === 114) {
      const zones = state[active].heroZones ?? [null, null, null, null];
      const hasOtherHero = zones.some((z, i) => z != null && i !== c);
      if (zones[c] == null && hasOtherHero) {
        pendingHalftrackMove = c;
        appendLog(['Mobile Command Halftrack: click one of your other Heroes to move it here (optional)']);
      }
    }

    // Radio Operator (111) — on-play, if a friendly Hero is in this column, look at top 2.
    if (card.id === 111) {
      const zones = state[active].heroZones ?? [null, null, null, null];
      if (zones[c] != null) {
        const deck = state[active].deck;
        if (deck.length >= 2) {
          const drawn = deck.slice(0, 2);
          state = { ...state, [active]: { ...state[active], deck: deck.slice(2) } };
          showRadioOperatorModal(drawn, active);
        } else if (deck.length === 1) {
          appendLog(['Radio Operator: only 1 card left in deck — stays on top']);
        } else {
          appendLog(['Radio Operator: deck is empty']);
        }
      }
    }

    selectedHandCardId = null;

    // Direct HQ (doc 01 §19) is evaluated once at end of turn (see the End Turn handler),
    // never reactively on placement — removed 2026-08-31 (Run 1) along with the other 2
    // reactive Empty-Board HQ Strike call sites below. A newly-placed unit with no immediate
    // target simply stays idle; unused attacks convert to HQ damage only at end of turn.
    const targets = getAttackableTargets(state, clickedKey);
    if (targets.length > 0) {
      uiState = "targeting";
      pendingAttackerKey = clickedKey;
    } else {
      uiState = "idle";
      pendingAttackerKey = null;
    }
    redraw();
    checkWin();
    pushStateIfOnline(state);
    return;
  }

  // TARGETING
  if (uiState === "targeting") {
    if (!pendingAttackerKey) return;
    const pendingAttacker = state.board[pendingAttackerKey];
    if (!pendingAttacker || pendingAttacker.owner !== state.initiative || pendingAttacker.state !== 'normal' || remainingAttacks(pendingAttacker) <= 0) {
      uiState = 'idle';
      pendingAttackerKey = null;
      lastDATargetKey = null;
      redraw();
      return;
    }
    let targets = getAttackableTargets(state, pendingAttackerKey);
    // Double Attack: first hit target is always valid for the second hit (even if Guard forces other targets)
    if (lastDATargetKey && !targets.some(t => t.key === lastDATargetKey)) {
      const prev = state.board[lastDATargetKey];
      const active = state.initiative;
      if (prev && prev.owner !== active && prev.state !== 'destroyed') {
        targets = [...targets, { key: lastDATargetKey, dir: targets[0]?.dir ?? 'n' }];
      }
    }
    if (!targets.some(t => t.key === clickedKey)) return;

    // Rally triggers on the declared attack itself, success not required (doc 01 §15) — must
    // fire before resolveSingleAttack so it isn't skipped on a failed comparison.
    const rally = checkRally(state, pendingAttackerKey);
    let rallyState = rally.state;
    const rallyLog = rally.log;

    const result = resolveSingleAttack(rallyState, pendingAttackerKey, clickedKey);
    const newBoard = applyMutations(rallyState.board, result.boardMutations);

    // Overrun (C09): "enemy Units Suppressed after this resolves deal 1 HQ damage" (normally
    // 0) "enemy normal Units destroyed after this resolves deal 3 HQ damage instead of 2" —
    // two distinct per-hit bonuses, not a flat +1 on top of whatever total damage happened.
    // Must be computed per board mutation (not from the pre-summed hqDamageToP1/P2), since a
    // Blast/Barrage attack can Suppress and/or Destroy several units in one resolution and each
    // qualifying hit gets its own bonus. A mutation with newUnit === null just got destroyed
    // (2 -> 3, +1); one with newUnit.state === 'suppressed' where it wasn't suppressed before
    // just got suppressed (0 -> 1, +1); armor-absorb mutations (state unchanged) get nothing.
    const attacker = rallyState.initiative;
    let dmgP1 = result.hqDamageToP1;
    let dmgP2 = result.hqDamageToP2;
    const overrunLog = [];
    if (rallyState[attacker]?.overrun) {
      for (const { key, newUnit } of result.boardMutations) {
        const before = rallyState.board[key];
        if (!before) continue;
        const justDestroyed = newUnit === null;
        const justSuppressed = newUnit && newUnit.state === 'suppressed' && before.state !== 'suppressed';
        if (!justDestroyed && !justSuppressed) continue;
        if (before.owner === 'p1') dmgP1 += 1; else dmgP2 += 1;
        overrunLog.push(`Overrun: +1 HQ damage (${justDestroyed ? 'destroy' : 'suppress'})`);
      }
    }

    let newState = {
      ...rallyState,
      board: newBoard,
      p1: { ...rallyState.p1, hq: rallyState.p1.hq - dmgP1 },
      p2: { ...rallyState.p2, hq: rallyState.p2.hq - dmgP2 },
    };

    const attackerKey = pendingAttackerKey;
    const attackerUnit = rallyState.board[attackerKey];
    const isDoubleAttack = getKeywords(attackerUnit).includes('Double Attack');
    const isFirstDoubleAttack = isDoubleAttack && (attackerUnit.persistentSpent ?? 0) === 0;
    if (newState.board[attackerKey]) {
      newState = { ...newState, board: { ...newState.board, [attackerKey]: spendAttack(newState.board[attackerKey]) } };
    }
    const attacksLeft = newState.board[attackerKey] ? remainingAttacks(newState.board[attackerKey]) : 0;

    // Track first DA hit so second hit can always re-target it
    if (isFirstDoubleAttack) lastDATargetKey = clickedKey;
    else lastDATargetKey = null;

    const postAttackTargets = getAttackableTargets({ ...rallyState, board: newBoard }, attackerKey);

    // Kill tracking, then Last Stand / Breakthrough via the shared post-destruction hook
    // (doc 01 §9 destruction chain) — HQ damage for the kill was already correctly computed
    // by applyHit inside resolveSingleAttack above, so this only runs the remaining steps.
    // A Blast/Barrage attack can destroy more than one Unit in a single resolveSingleAttack
    // call (primary target + secondary splash) — every one of them gets its own Last
    // Stand/Breakthrough pass, not just whichever mutation happens to be first in the array
    // (fixed 2026-09-01: this used to .find() only the first dying key, silently skipping
    // Last Stand for any additional Unit destroyed by the same attack's splash).
    const dyingKeys = result.boardMutations.filter(m => m.newUnit === null).map(m => m.key);
    let postDestroyLog = [];
    // Rally's own causality targets (declared-attack trigger, always evaluated above) seed the
    // list; Last Stand/Breakthrough targets from each kill get appended below.
    const causalityTargets = [...rally.causalityTargets];
    if (dyingKeys.length > 0) {
      newState = { ...newState, [attacker]: {
        ...newState[attacker],
        killsThisTurn: (newState[attacker].killsThisTurn ?? 0) + dyingKeys.length,
        totalKills: (newState[attacker].totalKills ?? 0) + dyingKeys.length,
      }};
      for (const dyingKey of dyingKeys) {
        const pd = applyPostDestructionEffects(newState, { unitKey: dyingKey, dyingUnit: rallyState.board[dyingKey], sourceUnitKey: attackerKey });
        newState = pd.state;
        postDestroyLog = [...postDestroyLog, ...pd.log];
        causalityTargets.push(...pd.causalityTargets);
      }
    }
    newState = recalculateDynamicStats(newState);

    // Resolve ordered state-transition hooks (including every primary/Blast/Barrage
    // UNIT_SUPPRESSED event) through one funnel.
    const triggeredEvents = applyGameEvents(newState, result.events);
    newState = triggeredEvents.state;
    const eventLog = triggeredEvents.log;

    // Double Attack's 2nd hit: if a real target existed a moment ago (postAttackTargets,
    // computed above) but the 1st hit just removed it, the 2nd hit simply has nothing to do
    // right now — it stays available and converts via Direct HQ at end of turn if it's still
    // unused and still has no legal target then (doc 01 §19). No mid-turn conversion here
    // (removed 2026-08-31, Run 1) — see the End Turn handler for the actual Direct HQ sweep.
    if (attacksLeft > 0 && postAttackTargets.length > 0) {
      uiState = "targeting";
      pendingAttackerKey = attackerKey;
    } else {
      uiState = "idle";
      pendingAttackerKey = null;
    }

    // result.boardMutations always targets clickedKey — newUnit===null means destroyed,
    // newUnit.state==='suppressed' means this hit just suppressed it, and newUnit.state
    // still 'normal' (only possible on a hit that actually landed) means Armor/Heavy Armor
    // absorbed it — applyHit (state.js) always either absorbs or transitions state, no third
    // outcome, so 'normal' here is unambiguous.
    const transitionFlags = new Map();
    if (result.boardMutations.length > 0) {
      const { newUnit } = result.boardMutations[0];
      if (newUnit === null) {
        transitionFlags.set(clickedKey, 'destroyed');
        // Name popup on the now-empty tile — the destroyed unit's own card, read from
        // pre-mutation state (still the module-level `state`, not yet reassigned) since
        // it's already gone from result.boardMutations by this point.
        const destroyedName = CARD_BY_ID[state.board[clickedKey]?.cardId]?.name;
        if (destroyedName) {
          const rect = tile.getBoundingClientRect();
          showFxPopup(rect.left + rect.width / 2, rect.top, `${destroyedName} destroyed`);
        }
      }
      else if (newUnit.state === 'suppressed') transitionFlags.set(clickedKey, 'suppressed');
      else if (newUnit.state === 'normal') {
        transitionFlags.set(clickedKey, 'armor-absorbed');
        const rect = tile.getBoundingClientRect();
        showFxPopup(rect.left + rect.width / 2, rect.top, 'ARMOR ABSORBED');
      }
    }

    // Causality pulse (Rally/Breakthrough): attacker glows now via transitionFlags (same
    // render pass as everything else above); the affected target(s) flash ~150ms later via a
    // direct DOM toggle, once the board has actually repainted with their new stats. Skip the
    // attacker's own tile from the delayed list — Breakthrough's current effects all self-buff,
    // so source and target are the same tile and a second flash on it would just be redundant.
    if (causalityTargets.length > 0 && newState.board[attackerKey]?.state !== 'destroyed') {
      transitionFlags.set(attackerKey, 'causality-source');
    }
    const delayedCausalityTargets = causalityTargets.filter(k => k !== attackerKey);
    if (delayedCausalityTargets.length > 0) {
      setTimeout(() => {
        const sourceEl = document.querySelector(`.tile[data-key="${attackerKey}"] .board-card`);
        delayedCausalityTargets.forEach(k => {
          flashCausalityTarget(k);
          const targetEl = document.querySelector(`.tile[data-key="${k}"] .board-card`);
          if (sourceEl) drawFxConnector(sourceEl, targetEl);
        });
      }, 150);
    }

    commitState(newState, [...rallyLog, ...result.logEntries, ...overrunLog, ...postDestroyLog, ...eventLog], transitionFlags);
    checkWin();
    return;
  }

  // COMMAND TARGETING: resolve targeted command on clicked tile
  if (uiState === "command-targeting" && pendingCommandId !== null) {
    const validKeys = getCommandTargets(pendingCommandId);
    if (!validKeys.has(clickedKey)) return;
    applyCommandEffect(pendingCommandId, clickedKey);
    return;
  }

  // HERO TARGETING: resolve an activated Hero Power on the clicked tile
  if (uiState === 'hero-targeting' && pendingHeroId !== null) {
    resolveHeroTargeting(clickedKey);
    return;
  }

  // HERO MANEUVER DESTINATION (H16 Maneuver Commander's 2nd click)
  if (uiState === 'hero-maneuver-destination') {
    resolveHeroManeuverDestination(clickedKey);
    return;
  }

  // COMMAND MANEUVER (C21/C27/C35): 1st click picks the source unit, 2nd picks the destination
  if (uiState === 'command-maneuver-source') {
    resolveCommandManeuverSource(clickedKey);
    return;
  }
  if (uiState === 'command-maneuver-destination') {
    resolveCommandManeuverDestination(clickedKey);
    return;
  }

  // AIRCRAFT ON-PLAY MANEUVER (A55/A56/A61/A62/A63/A65): 1st click picks the source unit,
  // 2nd picks the destination — see getUnitOnPlayManeuverSources above.
  if (uiState === 'unit-maneuver-source') {
    resolveUnitManeuverSource(clickedKey);
    return;
  }
  if (uiState === 'unit-maneuver-destination') {
    resolveUnitManeuverDestination(clickedKey);
    return;
  }

  // COORDINATED STRIKE (C06): 1st click picks unit A, 2nd click picks unit B (shared target)
  if (uiState === 'command-coordstrike-first') {
    resolveCoordStrikeFirst(clickedKey);
    return;
  }
  if (uiState === 'command-coordstrike-second') {
    resolveCoordStrikeSecond(clickedKey);
    return;
  }

  // IDLE: select a friendly unit to attack
  if (uiState === "idle") {
    const unit = state.board[clickedKey];
    if (!unit) return;
    const active = state.initiative;
    if (unit.owner !== active) return;
    if (unit.state !== "normal") return;
    if (remainingAttacks(unit) <= 0) return;

    const targets = getAttackableTargets(state, clickedKey);
    if (targets.length === 0) {
      // No mid-turn Direct HQ conversion (removed 2026-08-31, Run 1) — a unit with no legal
      // target just has nothing to do right now; unused attacks convert at end of turn only
      // (see the End Turn handler's evaluateDirectHQ call).
      appendLog([`${CARD_BY_ID[unit.cardId]?.name ?? '?'} at ${clickedKey}: No valid targets`]);
      return;
    }

    pendingAttackerKey = clickedKey;
    uiState = "targeting";
    redraw();
    return;
  }
});

// ── Objective effects ─────────────────────────────────────────────────────────
// Called at the start of each player's turn after control is checked.
// Returns { state, log, pendingArtyHits }.
// Shared by City (31) and Fortification (33): keys of friendly, non-destroyed units adjacent
// to an objective, optionally restricted to one unit class (City → Infantry only).
function friendlyAdjacentUnitKeys(board, key, player, clsFilter = null) {
  return getAdjacentKeys(key).filter(ak => {
    const u = board[ak];
    if (!u || u.owner !== player || u.state === 'destroyed') return false;
    if (clsFilter && CARD_BY_ID[u.cardId]?.cls !== clsFilter) return false;
    return true;
  });
}

// Picks up to n distinct random entries from list (fewer if list is shorter). Mirrors the
// established "random pick, no-op if empty" convention (combat.js's runLastStandEffect /
// resolveCraftDrawback) extended to a small-N pick via the already-imported Fisher-Yates
// shuffle rather than a second, subtly-different sampling method.
function pickRandomN(list, n) {
  return shuffle(list).slice(0, n);
}

// Run 2 (2026-08-31): rewired from the old numeric-id switch (26-33) to the new O1-O5
// scheme. That old switch was 100% dead code since Run 1 changed obj.cardId to strings —
// no `case 26` etc. could ever match `'O1'` etc., so every controlled Objective silently
// fell through to the "not automated" default and did nothing at all. Effect text below is
// cards.js's own O1-O5 l1-l4 fields (verified against doc 04, SIGNAL Objectives & Maps
// Truth, during Run 1 — that data was already correct, only this execution code was missing).
//
// Doc 04's locked HQ backbone: every controlled Objective, regardless of identity, deals
// 1/1/2/2 HQ damage by level, resolved BEFORE its own named secondary effect (doc 09's
// backbone-then-secondary order) — on top of, not instead of, the per-card effect below.
//
// Consistent phrasing for every Objective player-choice prompt (2026-09-01) — not a UI
// framework, just a one-line formatter so this pattern is easy for a future Command/Hero/
// effect prompt to reuse instead of hand-writing ad hoc strings each time.
function objectivePickPrompt(objName, instruction) {
  return `${objName.toUpperCase()}: ${instruction}`;
}

// Single source of truth for each pick effect's step-1 instruction wording, shared between the
// log line pushed when the pick opens (applyObjectiveEffects, below) and the persistent
// #mode-banner shown while uiState === 'objective-picking' (redraw()) — the log alone wasn't
// prominent enough (buried in a scrolling panel) for a player to notice what they're supposed
// to click.
const OBJECTIVE_PICK_INSTRUCTIONS = {
  maneuver: 'choose a friendly Unit to Maneuver',
  removeSuppression: 'choose a Suppressed friendly Unit to un-suppress',
  grantGuard: 'choose a friendly Unit to receive Guard',
  rotate: 'choose a friendly Unit to Rotate',
};

// Banner text for the current objective pick, covering Maneuver's 2-step case (source, then
// destination) the same way resolveObjectivePickClick's own log line does.
function objectivePickBannerText(s, pick) {
  const obj = s.objectives[pick.objectiveKey];
  if (!obj) return '';
  const nm = CARD_BY_ID[obj.cardId]?.name ?? 'Objective';
  const effectType = getObjectivePickEffectType(obj.cardId, obj.level);
  if (effectType === 'maneuver' && pick.sourceKey) {
    const unitName = CARD_BY_ID[s.board[pick.sourceKey]?.cardId]?.name ?? 'Unit';
    return objectivePickPrompt(nm, `choose a destination for ${unitName}`);
  }
  return objectivePickPrompt(nm, OBJECTIVE_PICK_INSTRUCTIONS[effectType] ?? 'choose a target');
}

// Resumable (2026-09-01): 4 of the 20 secondary effects (Airfield L2, Supply Depot L1, City L1,
// Artillery Position L1) don't say "random" in their card text, unlike the other 16 — doc 04 §6
// only locks auto-random selection for effects that DO say "random". Doc 04 is silent on
// selection method for these 4; Filip's call given that silence: the controlling player picks
// the target instead of auto-picking. `resumeAfterKey`, when given, is the objectiveKey of the
// Objective whose pick was just resolved by a board click — resolution continues from the next
// Objective in `orderedKeys` after it. This is safe because `orderedKeys` is a pure function of
// `s.objectives` (which coordinates are controlled by `player`), and nothing can mutate
// `s.objectives` while uiState is 'objective-picking' (only a board click validated against
// computeObjectivePickTargets is possible, and the online turn-gate at the board click listener
// means only the controlling player's own client can ever produce that click) — so recomputing
// `orderedKeys` fresh here always reproduces the exact same list/order it had when the pause
// happened, and `orderedKeys.indexOf(resumeAfterKey)` reliably finds where to continue.
function applyObjectiveEffects(s, player, resumeAfterKey = null) {
  const log = [];
  const opp = player === 'p1' ? 'p2' : 'p1';
  const artyHits = 0; // Run 2: no O1-O5 card triggers a click-to-hit targeting mode any
                       // more (the old dead Artillery Position had one; the new-truth O5
                       // does not) — kept in the return shape so callers need no change.

  // Doc 04 §5 (locked): several controlled Objectives resolve in fixed board scan order —
  // column 1 top-to-bottom, then column 2, etc. — one FULLY resolved (backbone, win check,
  // secondary) before the next begins. Doc 04 §19's QA assertions require this order to be
  // deterministic, not JS's insertion-order object iteration.
  const orderedKeys = Object.keys(s.objectives)
    .filter(k => s.objectives[k].controller === player)
    .sort((a, b) => {
      const [ar, ac] = a.split(',').map(Number);
      const [br, bc] = b.split(',').map(Number);
      return ac !== bc ? ac - bc : ar - br;
    });

  const startIndex = resumeAfterKey ? orderedKeys.indexOf(resumeAfterKey) + 1 : 0;

  for (let i = startIndex; i < orderedKeys.length; i++) {
    const key = orderedKeys[i];
    const obj = s.objectives[key];
    const card = CARD_BY_ID[obj.cardId];
    if (!card) continue;
    const lv = obj.level;
    if (lv === 0) continue;
    const nm = card.name;

    const backbone = lv >= 3 ? 2 : 1;
    s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - backbone } };
    log.push(`${nm} L${lv}: ${backbone} HQ damage to ${opp.toUpperCase()}`);

    // Doc 04 §5/§19 (locked): "lethal backbone stops later secondary/Objective resolution"
    // — check victory immediately after backbone, before this Objective's OWN secondary,
    // and before any subsequent Objective in scan order.
    if (s[opp].hq <= 0) {
      log.push(`${opp.toUpperCase()}'s HQ is destroyed — further Objective resolution stops`);
      return { state: recalculateDynamicStats(s), log, pendingArtyHits: artyHits, pendingPick: null };
    }

    switch (obj.cardId) {
      case 'O1': { // Factory — Fuel every level; L2/L4 discount next Unit, L3 next Tank
        s = { ...s, [player]: gainFuel(s[player], 1, false) };
        log.push(`${nm} L${lv}: +1 Fuel`);
        if (lv === 2) {
          s = { ...s, [player]: addDiscount(s[player], { appliesTo: 'unit', column: null, amount: 1, min: 0 }) };
          log.push(`${nm} L2: next Unit played this turn costs 1 less Fuel`);
        } else if (lv === 3) {
          s = { ...s, [player]: addDiscount(s[player], { appliesTo: 'Tank', column: null, amount: 2, min: 0 }) };
          log.push(`${nm} L3: next Tank played this turn costs 2 less Fuel`);
        } else if (lv === 4) {
          s = { ...s, [player]: addDiscount(s[player], { appliesTo: 'unit', column: null, amount: 2, min: 0 }) };
          log.push(`${nm} L4: next Unit played this turn costs 2 less Fuel`);
        }
        break;
      }
      case 'O2': { // Airfield — Aircraft-tempo effects
        if (lv === 1) {
          const list = unitsOnBoard(s, player).filter(({ unit: u }) => CARD_BY_ID[u.cardId]?.cls === 'Aircraft');
          if (list.length) {
            const [pick] = pickRandomN(list, 1);
            s = { ...s, board: { ...s.board, [pick.key]: { ...pick.unit, tempSideBonus: (pick.unit.tempSideBonus || 0) + 1 } } };
            log.push(`${nm} L1: ${CARD_BY_ID[pick.unit.cardId].name} +1 all sides this turn`);
          }
        } else if (lv === 2) {
          // Airfield L2's card text doesn't say "random" (unlike L1/L4 above) — per-effect
          // targets: player chooses both which friendly Unit and its destination.
          const targets = computeObjectivePickTargets(s, key, 'maneuver', null);
          if (targets.length) {
            log.push(objectivePickPrompt(nm, OBJECTIVE_PICK_INSTRUCTIONS.maneuver));
            return { state: recalculateDynamicStats(s), log, pendingArtyHits: artyHits, pendingPick: { objectiveKey: key, sourceKey: null } };
          }
          log.push(`${nm} L2: no Unit has a legal Maneuver destination.`);
        } else if (lv === 3) {
          s = { ...s, [player]: drawCards(s[player], 1) };
          log.push(`${nm} L3: Draw 1 card`);
        } else if (lv === 4) {
          const list = unitsOnBoard(s, player).filter(({ unit: u }) => CARD_BY_ID[u.cardId]?.cls === 'Aircraft');
          const picks = pickRandomN(list, 2);
          let board = s.board;
          for (const p of picks) board = { ...board, [p.key]: grantTempAttacks(board[p.key], 1) };
          s = { ...s, board };
          if (picks.length) log.push(`${nm} L4: ${picks.map(p => CARD_BY_ID[p.unit.cardId].name).join(', ')} gain 1 additional attack this turn`);
        }
        break;
      }
      case 'O3': { // Supply Depot — Suppression removal, Fuel, draw
        if (lv === 1) {
          // Card text doesn't say "random" — player chooses which adjacent Suppressed Unit.
          const targets = computeObjectivePickTargets(s, key, 'removeSuppression', null);
          if (targets.length) {
            log.push(objectivePickPrompt(nm, OBJECTIVE_PICK_INSTRUCTIONS.removeSuppression));
            return { state: recalculateDynamicStats(s), log, pendingArtyHits: artyHits, pendingPick: { objectiveKey: key, sourceKey: null } };
          }
          log.push(`${nm} L1: no adjacent Suppressed Unit.`);
        } else if (lv === 2) {
          s = { ...s, [player]: gainFuel(s[player], 1, false) };
          log.push(`${nm} L2: +1 Fuel`);
        } else if (lv === 3) {
          s = { ...s, [player]: drawCards(s[player], 1) };
          log.push(`${nm} L3: Draw 1 card`);
        } else if (lv === 4) {
          s = { ...s, [player]: gainFuel(s[player], 2, false) };
          log.push(`${nm} L4: +2 Fuel`);
        }
        break;
      }
      case 'O4': { // City — Guard / side-bonus grants, escalating scope and duration
        if (lv === 1) {
          // Card text doesn't say "random" — player chooses which friendly Unit. A Unit with
          // active Guard from ANY source (printed/permanent/temp-granted — see getKeywords) is
          // ineligible; no point re-granting a keyword already active. This project is
          // separately moving toward distinguishing keyword provenance/duration — until that
          // lands, "has Guard right now" is the eligibility bar.
          const targets = computeObjectivePickTargets(s, key, 'grantGuard', null);
          if (targets.length) {
            log.push(objectivePickPrompt(nm, OBJECTIVE_PICK_INSTRUCTIONS.grantGuard));
            return { state: recalculateDynamicStats(s), log, pendingArtyHits: artyHits, pendingPick: { objectiveKey: key, sourceKey: null } };
          }
          log.push(`${nm} L1: no eligible friendly Unit.`);
        } else if (lv === 2 || lv === 4) {
          const bonus = lv === 4 ? 2 : 1;
          const picks = pickRandomN(friendlyAdjacentUnitKeys(s.board, key, player), 2);
          let board = s.board;
          for (const ak of picks) {
            const u = board[ak];
            board = { ...board, [ak]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + bonus, sideBonusTurns: 1 } };
          }
          s = { ...s, board };
          if (picks.length) log.push(`${nm} L${lv}: ${picks.length} adjacent Unit(s) +${bonus} all sides until your next turn`);
        } else if (lv === 3) {
          const picks = pickRandomN(friendlyAdjacentUnitKeys(s.board, key, player, 'Infantry'), 2);
          let board = s.board;
          for (const ak of picks) {
            const u = board[ak];
            board = { ...board, [ak]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 } };
          }
          s = { ...s, board };
          if (picks.length) log.push(`${nm} L3: ${picks.length} adjacent Infantry +1 all sides (permanent)`);
        }
        break;
      }
      case 'O5': { // Artillery Position — rotate, then Bombard/Precision/extra-attack grants
        if (lv === 1) {
          // Card text ("Rotate 1 friendly Unit left or right") doesn't say "random" — player
          // chooses the Unit; direction is chosen via the same rotate-direction modal Change
          // Formation (C16) and Field Coordinator's Hero Power already use.
          const targets = computeObjectivePickTargets(s, key, 'rotate', null);
          if (targets.length) {
            log.push(objectivePickPrompt(nm, OBJECTIVE_PICK_INSTRUCTIONS.rotate));
            return { state: recalculateDynamicStats(s), log, pendingArtyHits: artyHits, pendingPick: { objectiveKey: key, sourceKey: null } };
          }
          log.push(`${nm} L1: no eligible friendly Unit.`);
        } else if (lv === 2) {
          const list = friendlyAdjacentUnitKeys(s.board, key, player).filter(ak => !getKeywords(s.board[ak]).includes('Bombard'));
          if (list.length) {
            const [pick] = pickRandomN(list, 1);
            const u = s.board[pick];
            s = { ...s, board: { ...s.board, [pick]: { ...u, tempKeywords: [...u.tempKeywords, 'Bombard'] } } };
            log.push(`${nm} L2: ${CARD_BY_ID[u.cardId].name} gains Bombard this turn`);
          }
        } else if (lv === 3) {
          const list = unitsOnBoard(s, player).filter(({ unit: u }) => CARD_BY_ID[u.cardId]?.cls === 'Artillery' && !getKeywords(u).includes('Precision'));
          if (list.length) {
            const [pick] = pickRandomN(list, 1);
            s = { ...s, board: { ...s.board, [pick.key]: { ...pick.unit, tempKeywords: [...pick.unit.tempKeywords, 'Precision'] } } };
            log.push(`${nm} L3: ${CARD_BY_ID[pick.unit.cardId].name} gains Precision this turn`);
          }
        } else if (lv === 4) {
          const list = unitsOnBoard(s, player).filter(({ unit: u }) => CARD_BY_ID[u.cardId]?.cls === 'Artillery');
          if (list.length) {
            const [pick] = pickRandomN(list, 1);
            s = { ...s, board: { ...s.board, [pick.key]: grantTempAttacks(pick.unit, 1) } };
            log.push(`${nm} L4: ${CARD_BY_ID[pick.unit.cardId].name} gains 1 additional attack this turn`);
          }
        }
        break;
      }
      default: log.push(`${nm} L${lv}: effect triggered (not automated)`);
    }
  }
  return { state: recalculateDynamicStats(s), log, pendingArtyHits: artyHits, pendingPick: null };
}

// Called once an Objective pick's board click has been applied (resolveObjectivePickClick).
// Continues applyObjectiveEffects's paused loop from the resolved Objective; if that yields
// ANOTHER pending pick (a later controlled Objective also needs one), commits and stays in
// 'objective-picking' — chaining automatically through as many controlled Objectives as need a
// pick, in the same fixed scan order as today. Once the whole chain drains, runs the Hero Phase
// deferred from the original End Turn handler (or from receiveRemoteState, online). Does NOT
// call runBotTurn() — if a bot's own click triggered this (via bot_player.js's
// handleObjectivePicking), that bot's own playBotTurnSteps loop is still running and continues
// into its next iteration once uiState returns to 'idle'; starting a second bot-turn loop here
// would overlap it.
function resumeObjectiveResolution(s, player, resumeAfterKey, logSoFar) {
  const { state: afterEffects, log: effectLog, pendingArtyHits, pendingPick } = applyObjectiveEffects(s, player, resumeAfterKey);
  const newState = { ...afterEffects, pendingArtyHits, pendingObjectivePick: pendingPick };
  // Reset preemptively, same convention as arty-targeting's own click handler
  // (pendingArtyHitCount>0 ? 'arty-targeting' : 'idle') — syncObjectivePickUiState (called
  // inside commitState) only ever SETS 'objective-picking' when a pick exists, it never clears
  // it, so without this reset the uiState would stay stuck on 'objective-picking' after the
  // last pick in a chain resolves.
  uiState = 'idle';
  commitState(newState, [...logSoFar, ...effectLog]);
  checkWin();
  if (!pendingPick && !gameOver) runHeroPhase(newState.initiative);
}

// Resolves a board click made while uiState === 'objective-picking'. Recomputes the legal-target
// set fresh via computeObjectivePickTargets (the same function driving the render highlight, so
// a tile that's highlighted is always a tile this accepts — review requirement, single source
// of truth) rather than trusting the click blindly.
function resolveObjectivePickClick(clickedKey) {
  const pick = state.pendingObjectivePick;
  if (!pick) return;
  const obj = state.objectives[pick.objectiveKey];
  if (!obj) return;
  const card = CARD_BY_ID[obj.cardId];
  const nm = card?.name ?? 'Objective';
  const effectType = getObjectivePickEffectType(obj.cardId, obj.level);
  const legalKeys = computeObjectivePickTargets(state, pick.objectiveKey, effectType, pick.sourceKey);
  if (!legalKeys.includes(clickedKey)) return;

  if (effectType === 'maneuver' && !pick.sourceKey) {
    // Step 1 of 2: source Unit chosen — ask for a destination next, same uiState, highlight
    // recomputes to destinations only (computeObjectivePickTargets branches on sourceKey).
    const unitName = CARD_BY_ID[state.board[clickedKey]?.cardId]?.name ?? 'Unit';
    const newState = { ...state, pendingObjectivePick: { ...pick, sourceKey: clickedKey } };
    commitState(newState, [objectivePickPrompt(nm, `choose a destination for ${unitName}`)]);
    return;
  }

  if (effectType === 'maneuver') { // sourceKey already set — this click is the destination
    const { state: afterMove, log: moveLog } = resolveManeuver(state, pick.sourceKey, clickedKey);
    resumeObjectiveResolution({ ...afterMove, pendingObjectivePick: null }, obj.controller, pick.objectiveKey, moveLog);
    return;
  }

  if (effectType === 'removeSuppression') {
    const unitName = CARD_BY_ID[state.board[clickedKey]?.cardId]?.name ?? 'Unit';
    const { state: afterRemove } = removeSuppression(state, clickedKey);
    resumeObjectiveResolution({ ...afterRemove, pendingObjectivePick: null }, obj.controller, pick.objectiveKey, [`${nm} L1: ${unitName} un-suppressed`]);
    return;
  }

  if (effectType === 'grantGuard') {
    const u = state.board[clickedKey];
    const unitName = CARD_BY_ID[u.cardId]?.name ?? 'Unit';
    const newBoard = { ...state.board, [clickedKey]: { ...u, grantedKeywords: [...u.grantedKeywords, 'Guard'] } };
    resumeObjectiveResolution({ ...state, board: newBoard, pendingObjectivePick: null }, obj.controller, pick.objectiveKey, [`${nm} L1: ${unitName} gains Guard until your next turn`]);
    return;
  }

  if (effectType === 'rotate') {
    // Reuses the existing rotate-direction modal (Change Formation C16 / Field Coordinator's
    // Hero Power) — the Unit is already chosen by this click, the modal only supplies direction.
    showRotateDirectionModal({
      kind: 'objective',
      targetKey: clickedKey,
      cardName: nm,
      s: { ...state, pendingObjectivePick: null },
      log: [],
      role: obj.controller,
      objectiveKey: pick.objectiveKey,
    });
  }
}

// ── Hero passive — Ruthless Strategist (H20) ────────────────────────────────
// "Whenever you play a Command, after it fully resolves: draw 1 card, then deal 1 damage to
// your HQ" (doc 01 §22 — external trigger AFTER the Command's own printed effect). Called at
// every true command-completion point (not intermediate steps like a Rally Cry chain's first
// pick, or Forward Observer's own deck-look before its modal choice is confirmed) — see each
// call site below (playInstantCommand's shared end, applyCommandEffect's shared end, the
// Objective Push / Command Shuffle / rotate-modal / command-maneuver early-return paths, and
// the Forward Observer modal's own confirm handler).
function applyRuthlessStrategistIfPresent(s, active) {
  if (!(s[active].heroZones ?? []).includes('H20')) return { state: s, log: [] };
  const afterDraw = drawCards(s[active], 1);
  const afterDamage = { ...afterDraw, hq: afterDraw.hq - 1 };
  return { state: { ...s, [active]: afterDamage }, log: [`${CARD_BY_ID['H20'].name}: draw 1 card, 1 damage to own HQ`] };
}

// ── Instant commands ──────────────────────────────────────────────────────────
// Run 1 (2026-08-31): rewired to the new C01-C35 id scheme against doc 03's actual effect
// text — several old and new Commands share a name but NOT an effect (verified per-card, not
// assumed by id/name — e.g. old id 78 "Combined Arms Doctrine" healed HQ per unit cleared;
// new C07 of the same name does not). Returns true if handled (instant), false if it needs
// targeting UI (deferred to getCommandTargets/startCommandTargeting).
function playInstantCommand(cardId) {
  const active = state.initiative;
  const card = CARD_BY_ID[cardId];
  const discount = discountFor(state[active], card, null);
  const effectiveCost = card.cost - discount;

  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);

  let s = {
    ...state,
    // doc 02 Q027: resolved Commands go to owner Discard Pile (bookkeeping only — no current
    // card reads this zone, doc 02 Q028). Safe to add here even though this Command hasn't
    // finished resolving yet: nothing below this point can cancel/refund an instant Command.
    [active]: consumeDiscounts(
      { ...state[active], fuel: state[active].fuel - effectiveCost, hand: handAfter, discardPile: [...(state[active].discardPile ?? []), cardId] },
      card, null, discount,
    ),
  };
  const log = [];

  switch (cardId) {
    case 'C05': { // Recon — draw 2
      s = { ...s, [active]: drawCards(s[active], 2) };
      log.push(`${card.name}: Draw 2 cards`);
      break;
    }
    case 'C07': { // Combined Arms Doctrine — remove Suppression from all friendly Units, draw 1
      let cleared = 0;
      const ccgLog = [];
      for (const k of Object.keys(s.board)) {
        const u = s.board[k];
        if (!u || u.owner !== active) continue;
        const result = removeSuppression(s, k);
        if (!result.changed) continue;
        s = result.state;
        cleared++;
        ccgLog.push(...result.log);
      }
      s = { ...s, [active]: drawCards(s[active], 1) };
      log.push(`${card.name}: ${cleared} friendly unit(s) un-suppressed, draw 1`);
      log.push(...ccgLog);
      break;
    }
    case 'C09': { // Overrun — rest of THIS turn, enemy Suppress-after-this = 1 HQ, enemy
      // Destroy-after-this = 3 instead of 2. Setting the flag now (not retroactively touching
      // anything that already happened) already satisfies "not retroactive" — see applyHit
      // call sites that check `overrun`.
      s = { ...s, [active]: { ...s[active], overrun: true } };
      log.push(`${card.name}: for the rest of this turn, enemy Suppress deals 1 HQ and enemy Destroy deals 3 HQ`);
      break;
    }
    case 'C13': { // Industrial Surge — +2 Fuel at start of next turn
      s = { ...s, [active]: { ...s[active], pendingFuelGain: s[active].pendingFuelGain + 2 } };
      log.push(`${card.name}: +2 Fuel at start of next turn`);
      break;
    }
    case 'C14': { // Priority Orders — next Hero Active this turn costs 2F less, min 0
      s = { ...s, [active]: { ...s[active], pendingHeroDiscount: s[active].pendingHeroDiscount + 2 } };
      log.push(`${card.name}: next Hero Active this turn costs 2F less`);
      break;
    }
    case 'C15': { // Command Shuffle — move/swap a Hero, doesn't spend the normal reposition
      if (!(s[active].heroZones ?? []).some(z => z != null)) {
        log.push(`${card.name}: no deployed Hero to move`);
        break;
      }
      preCommandState = state; // pre-deduction snapshot, so Cancel refunds this card too
      pendingCommandId = 'C15';
      log.push(`${card.name}: choose a Hero to move or swap`);
      commitState(s, log);
      return true;
    }
    case 'C17': { // Coordinated Order — reset Hero ability state: used Actives become
      // available again, limited "first X per turn" Passive triggers may fire again this
      // turn. Does NOT rewind persistent state (Long War Power, Craft cost progression).
      s = { ...s, [active]: { ...s[active], heroesActivatedThisTurn: [], heroTriggeredThisTurn: {} } };
      log.push(`${card.name}: Hero ability state reset — used Actives and limited Passives available again`);
      break;
    }
    case 'C20': { // Total Mobilization — ALL Units, friendly and enemy, +1 all sides permanently
      const newBoard = { ...s.board };
      let count = 0;
      for (const [k, u] of Object.entries(newBoard)) {
        if (!u || u.state === 'destroyed') continue;
        newBoard[k] = { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 };
        count++;
      }
      s = { ...s, board: newBoard };
      log.push(`${card.name}: ${count} Unit(s) (friendly and enemy) +1 all sides (permanent)`);
      break;
    }
    case 'C23': { // Emergency Supply — gain 3 Fuel FOR THIS TURN, deal 2 own HQ. Tracked via
      // PlayerState.tempFuelGrant (cleared in the End Turn handler, after Direct HQ) so any
      // unused portion of THIS grant expires at cleanup rather than persisting — doc 01 §3.
      const grantedFuel = gainFuel(s[active], 3, false);
      s = { ...s, [active]: { ...grantedFuel, hq: grantedFuel.hq - 2, tempFuelGrant: (grantedFuel.tempFuelGrant ?? 0) + 3 } };
      log.push(`${card.name}: +3 Fuel this turn, 2 damage to own HQ`);
      break;
    }
    case 'C25': { // Entrench (Infantry) — all friendly Infantry +2 all sides until end of turn
      const newBoard = { ...s.board };
      let count = 0;
      for (const [k, u] of Object.entries(newBoard)) {
        if (!u || u.owner !== active || u.state === 'destroyed') continue;
        if (CARD_BY_ID[u.cardId]?.cls !== 'Infantry') continue;
        newBoard[k] = { ...u, tempSideBonus: (u.tempSideBonus || 0) + 2 };
        count++;
      }
      s = { ...s, board: newBoard };
      log.push(`${card.name}: ${count} Infantry +2 all sides (until end of turn)`);
      break;
    }
    case 'C26': { // General Offensive (Infantry) — all friendly Infantry +1 permanent; Escalate: +2
      const escalated = hasEscalated(s[active], card.name);
      const amount = escalated ? 2 : 1;
      const newBoard = { ...s.board };
      let count = 0;
      for (const [k, u] of Object.entries(newBoard)) {
        if (!u || u.owner !== active || u.state === 'destroyed') continue;
        if (CARD_BY_ID[u.cardId]?.cls !== 'Infantry') continue;
        newBoard[k] = { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + amount, sideBonusTurns: 99 };
        count++;
      }
      s = { ...s, board: newBoard, [active]: markEscalateUse(s[active], card.name) };
      log.push(`${card.name}: ${count} Infantry +${amount} all sides (permanent)${escalated ? ' [Escalate]' : ''}`);
      break;
    }
    case 'C29': { // Armored Offensive (Tank) — next Tank played this turn costs 2 less
      s = { ...s, [active]: addDiscount(s[active], { appliesTo: 'Tank', column: null, amount: 2, min: 0 }) };
      log.push(`${card.name}: next Tank played this turn costs 2 less Fuel`);
      break;
    }
    case 'C33': { // Air Strike (Aircraft) — all friendly Aircraft gain 1 additional attack until EOT
      const newBoard = { ...s.board };
      let count = 0;
      for (const [k, u] of Object.entries(newBoard)) {
        if (!u || u.owner !== active || u.state === 'destroyed') continue;
        if (CARD_BY_ID[u.cardId]?.cls !== 'Aircraft') continue;
        newBoard[k] = grantTempAttacks(u, 1);
        count++;
      }
      s = { ...s, board: newBoard };
      log.push(`${card.name}: ${count} friendly Aircraft gain 1 additional attack (until end of turn)`);
      break;
    }
    case 'C34': { // Air Superiority (Aircraft) — friendly Aircraft +1 all sides + Precision until EOT; Escalate +2
      const escalated = hasEscalated(s[active], card.name);
      const amount = escalated ? 2 : 1;
      const newBoard = { ...s.board };
      let count = 0;
      for (const [k, u] of Object.entries(newBoard)) {
        if (!u || u.owner !== active || u.state === 'destroyed') continue;
        if (CARD_BY_ID[u.cardId]?.cls !== 'Aircraft') continue;
        newBoard[k] = { ...u, tempSideBonus: (u.tempSideBonus || 0) + amount, tempKeywords: [...(u.tempKeywords || []), 'Precision'] };
        count++;
      }
      s = { ...s, board: newBoard, [active]: markEscalateUse(s[active], card.name) };
      log.push(`${card.name}: ${count} friendly Aircraft +${amount} all sides + Precision (until end of turn)${escalated ? ' [Escalate]' : ''}`);
      break;
    }
    case 'C04': { // Forward Observer — top 3: 1 to hand, 1 top, 1 bottom. Requires 2+ deck
      // cards; with exactly 2, look at both, 1 to hand, other stays on top.
      const deckLen = s[active].deck.length;
      if (deckLen < 2) {
        // Bail WITHOUT committing `s` — the fuel/hand deduction computed above only exists in
        // this local variable, so the real `state` is untouched and the card is effectively
        // never played (doc 01 §27: cannot be played with fewer than 2 deck cards).
        appendLog([`${card.name}: requires at least 2 cards in deck — not played`]);
        redraw();
        return true;
      }
      const drawn = s[active].deck.slice(0, Math.min(3, deckLen));
      s = { ...s, [active]: { ...s[active], deck: s[active].deck.slice(drawn.length) } };
      commitState(s, log);
      showFOModal(drawn, active);
      return true;
    }
    default:
      return false; // targeted or not yet implemented
  }

  const rs = applyRuthlessStrategistIfPresent(s, active);
  commitState(rs.state, [...log, ...rs.log]);
  checkWin();
  return true;
}

// ── Targeted commands ─────────────────────────────────────────────────────────
// Run 1 (2026-08-31): rewired to the new C01-C35 id scheme. C06 Coordinated Strike needs a
// real multi-select UI (choose 2 friendly Units sharing a legal enemy target) that doesn't
// exist in this prototype — same pre-existing gap as before Run 1, still not automated.
// C21/C27/C35 (Maneuver-based) are handled by a separate 2-step flow, not this function —
// see startCommandManeuver/getCommandTargets's caller. C22 targets an OBJECTIVE tile, not a
// unit — returns objective keys instead of unit keys for that one case.

// Returns Set of valid board tile keys for a given targeted command.
// Returns empty Set if no valid targets exist, null if command is unknown/not targeted.
function getCommandTargets(commandId) {
  const active = state.initiative;
  const entries = Object.entries(state.board);
  const friendlies = entries.filter(([, u]) => u && u.owner === active && u.state !== 'destroyed');

  switch (commandId) {
    case 'C01': // Field Medic — friendly suppressed
      return new Set(friendlies.filter(([, u]) => u.state === 'suppressed').map(([k]) => k));

    case 'C02': // Improvised Position — friendly unit WITHOUT Armor/Heavy Armor
      return new Set(friendlies.filter(([, u]) => {
        const kws = getKeywords(u);
        return !kws.includes('Armor') && !kws.includes('Heavy Armor');
      }).map(([k]) => k));

    case 'C03': // Rally Cry — any friendly (up to 2, chained)
    case 'C10': // Hold Position — any friendly (up to 2, chained)
    case 'C11': // Tactical Withdrawal — any friendly unit
      return new Set(friendlies.map(([k]) => k));

    case 'C08': // Second Wind — friendly suppressed
      return new Set(friendlies.filter(([, u]) => u.state === 'suppressed').map(([k]) => k));

    case 'C12': // Dig In — any friendly unit
      return new Set(friendlies.map(([k]) => k));

    case 'C16': // Change Formation — any unsuppressed friendly unit
      return new Set(friendlies.filter(([, u]) => u.state === 'normal').map(([k]) => k));

    case 'C18': // Sacrifice Play — any friendly unit
    case 'C19': // Scorched Earth Raid — any friendly unit
      return new Set(friendlies.map(([k]) => k));

    case 'C24': // Suppressing Fire (Infantry) — friendly Infantry
      return new Set(friendlies.filter(([, u]) => CARD_BY_ID[u.cardId]?.cls === 'Infantry').map(([k]) => k));

    case 'C28': // Field Repairs (Tank) — friendly Tank without Heavy Armor
      return new Set(friendlies.filter(([, u]) => CARD_BY_ID[u.cardId]?.cls === 'Tank' && !getKeywords(u).includes('Heavy Armor')).map(([k]) => k));

    case 'C30': // Artillery Barrage (Artillery) — friendly Artillery
    case 'C31': // Target Coordinates (Artillery) — friendly Artillery
    case 'C32': // Fire for Effect (Artillery) — friendly Artillery
      return new Set(friendlies.filter(([, u]) => CARD_BY_ID[u.cardId]?.cls === 'Artillery').map(([k]) => k));

    case 'C22': // Objective Push — an OBJECTIVE tile, not a unit
      return new Set(Object.keys(state.objectives ?? {}));

    default: return null; // unknown / not a targeted command (incl. C06, C21/C27/C35)
  }
}

// Commands that Maneuver a unit as part of their effect need a 2-step source-then-destination
// flow, same shape as Hero H16 — see pendingHeroManeuverSource/resolveHeroManeuverDestination
// above, generalized here for Commands. `filterFn` restricts which friendly units are legal
// sources (e.g. C27 requires a Tank).
const COMMAND_MANEUVER_SOURCE_FILTER = {
  C21: () => true,                                              // Forced March — any friendly unit
  C27: (u) => CARD_BY_ID[u.cardId]?.cls === 'Tank',              // Blitzkrieg Order — friendly Tank
  C35: (u) => CARD_BY_ID[u.cardId]?.cls === 'Aircraft',          // Scramble — friendly Aircraft
};

function getCommandManeuverSources(commandId, excludeKey = null) {
  const active = state.initiative;
  const filterFn = COMMAND_MANEUVER_SOURCE_FILTER[commandId];
  if (!filterFn) return null;
  return new Set(
    Object.entries(state.board)
      .filter(([k, u]) => k !== excludeKey && u && u.owner === active && u.state === 'normal' && filterFn(u))
      .map(([k]) => k)
  );
}

let pendingCommandManeuverSource = null; // { key, commandId }
let pendingCommandManeuverRemaining = 0; // C27 Blitzkrieg Order under Escalate: up to 2 Tanks total

// ── Coordinated Strike (C06) — 2-unit multi-select ──────────────────────────
// "Choose 2 friendly Units that both currently have the same enemy Unit as a legal attack
// target. Each gains 1 additional legal attack this turn." Stats don't need to beat the
// shared target — getAttackableTargets already only checks legality, never attackBeats.
let pendingCoordStrikeFirst = null; // board key of the first pick, or null before the 1st click

function getCoordStrikeFirstCandidates() {
  const active = state.initiative;
  return new Set(
    Object.entries(state.board)
      .filter(([k, u]) => u && u.owner === active && u.state === 'normal' && getAttackableTargets(state, k).length > 0)
      .map(([k]) => k)
  );
}

function getCoordStrikeSecondCandidates(firstKey) {
  const active = state.initiative;
  const firstTargets = new Set(getAttackableTargets(state, firstKey).map(t => t.key));
  return new Set(
    Object.entries(state.board)
      .filter(([k, u]) => k !== firstKey && u && u.owner === active && u.state === 'normal' &&
        getAttackableTargets(state, k).some(t => firstTargets.has(t.key)))
      .map(([k]) => k)
  );
}

function startCoordinatedStrike(cardId) {
  const active = state.initiative;
  const card = CARD_BY_ID[cardId];
  if (getCoordStrikeFirstCandidates().size === 0) {
    appendLog([`${card.name}: no friendly Unit currently has a legal attack target`]);
    return;
  }
  const discount = discountFor(state[active], card, null);
  const effectiveCost = card.cost - discount;
  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);
  preCommandState = state;
  // doc 02 Q027: goes to Discard Pile — safe even mid-targeting since Cancel fully restores
  // preCommandState, wiping this along with the hand-removal/Fuel-spend if the player bails.
  state = { ...state, [active]: consumeDiscounts({ ...state[active], fuel: state[active].fuel - effectiveCost, hand: handAfter, discardPile: [...(state[active].discardPile ?? []), cardId] }, card, null, discount) };
  pendingCommandId = cardId;
  pendingCoordStrikeFirst = null;
  uiState = 'command-coordstrike-first';
  appendLog([`${card.name}: choose the first friendly Unit`]);
  redraw();
}

function resolveCoordStrikeFirst(key) {
  if (!getCoordStrikeFirstCandidates().has(key)) return;
  pendingCoordStrikeFirst = key;
  uiState = 'command-coordstrike-second';
  appendLog([`${CARD_BY_ID[pendingCommandId].name}: choose a second friendly Unit sharing a legal target with the first`]);
  redraw();
}

function resolveCoordStrikeSecond(key) {
  const firstKey = pendingCoordStrikeFirst;
  if (!getCoordStrikeSecondCandidates(firstKey).has(key)) return;
  const card = CARD_BY_ID[pendingCommandId];
  const active = state.initiative;
  pendingCoordStrikeFirst = null;
  pendingCommandId = null;
  preCommandState = null;
  uiState = 'idle';

  let s = { ...state };
  const firstUnit = s.board[firstKey];
  const secondUnit = s.board[key];
  s = { ...s, board: { ...s.board, [firstKey]: grantTempAttacks(firstUnit, 1), [key]: grantTempAttacks(secondUnit, 1) } };
  const log = [`${card.name}: ${CARD_BY_ID[firstUnit.cardId]?.name ?? 'unit'} and ${CARD_BY_ID[secondUnit.cardId]?.name ?? 'unit'} each gain 1 additional attack this turn`];
  const rs = applyRuthlessStrategistIfPresent(s, active);
  commitState(rs.state, [...log, ...rs.log]);
  checkWin();
}

function startCommandManeuver(cardId) {
  const active = state.initiative;
  const card = CARD_BY_ID[cardId];
  const sources = getCommandManeuverSources(cardId);
  if (!sources || sources.size === 0) {
    appendLog([`${card.name}: no valid unit to Maneuver`]);
    return;
  }
  const discount = discountFor(state[active], card, null);
  const effectiveCost = card.cost - discount;
  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);
  preCommandState = state;
  state = {
    ...state,
    // doc 02 Q027 (Discard Pile) — safe pre-completion, see the note on startCoordinatedStrike.
    [active]: consumeDiscounts({ ...state[active], fuel: state[active].fuel - effectiveCost, hand: handAfter, discardPile: [...(state[active].discardPile ?? []), cardId] }, card, null, discount),
  };
  pendingCommandId = cardId;
  pendingCommandManeuverSource = { key: null, commandId: cardId };
  // C27 Blitzkrieg Order: Escalate widens "1 Tank" to "up to 2 Tanks" — mark Escalate used on
  // this first pick (doc 01 §29: tracked by name, not by how many targets end up chosen).
  if (cardId === 'C27') {
    const escalated = hasEscalated(state[active], card.name);
    pendingCommandManeuverRemaining = escalated ? 2 : 1;
    if (!escalated) state = { ...state, [active]: markEscalateUse(state[active], card.name) };
  } else {
    pendingCommandManeuverRemaining = 1;
  }
  uiState = 'command-maneuver-source';
  appendLog([`${card.name}: choose a unit to Maneuver`]);
  redraw();
}

function resolveCommandManeuverSource(sourceKey) {
  const excludeKey = pendingCommandManeuverSource?.excludeKey ?? null;
  const sources = getCommandManeuverSources(pendingCommandId, excludeKey);
  if (!sources?.has(sourceKey)) return;
  pendingCommandManeuverSource = { key: sourceKey, commandId: pendingCommandId, excludeKey };
  uiState = 'command-maneuver-destination';
  appendLog([`${CARD_BY_ID[pendingCommandId].name}: choose a destination tile`]);
  redraw();
}

function resolveCommandManeuverDestination(destKey) {
  if (!pendingCommandManeuverSource?.key) return;
  const { key: sourceKey, commandId } = pendingCommandManeuverSource;
  const legalTargets = getManeuverTargets(state, sourceKey);
  if (!legalTargets.includes(destKey)) return;
  const card = CARD_BY_ID[commandId];
  const active = state.initiative;

  let { state: s, log } = resolveManeuver(state, sourceKey, destKey);
  const movedUnit = s.board[destKey];

  if (commandId === 'C21') { // Forced March — Maneuver, then draw 1
    s = { ...s, [active]: drawCards(s[active], 1) };
    log = [...log, `${card.name}: draw 1 card`];
  } else if (commandId === 'C27') { // Blitzkrieg Order — Maneuver + grant Armor (permanent — no
    // "until" wording on this card, so it must use permanentKeywords, not grantedKeywords
    // which clears every startOfTurn — see the BoardUnit shape comment in state.js)
    const kws = getKeywords(movedUnit);
    if (!kws.includes('Armor') && !kws.includes('Heavy Armor')) {
      s = { ...s, board: { ...s.board, [destKey]: { ...movedUnit, permanentKeywords: [...(movedUnit.permanentKeywords || []), 'Armor'] } } };
    }
    log = [...log, `${card.name}: gains Armor (permanent)`];
  } else if (commandId === 'C35') { // Scramble — Maneuver + reset persistent attacks
    s = { ...s, board: { ...s.board, [destKey]: resetPersistentAttacks(s.board[destKey]) } };
    log = [...log, `${card.name}: attacks reset`];
  }
  s = recalculateDynamicStats(s);

  pendingCommandManeuverRemaining--;
  if (commandId === 'C27' && pendingCommandManeuverRemaining > 0) {
    // Escalated Blitzkrieg Order: stay in the flow for a second, different Tank.
    pendingCommandManeuverSource = { key: null, commandId, excludeKey: destKey };
    uiState = 'command-maneuver-source';
    commitState(s, log);
    appendLog([`${card.name}: Escalate — choose a second Tank to Maneuver (or press Done)`]);
    redraw();
    return;
  }

  pendingCommandManeuverSource = null;
  pendingCommandId = null;
  preCommandState = null;
  uiState = 'idle';
  const rs = applyRuthlessStrategistIfPresent(s, active);
  commitState(rs.state, [...log, ...rs.log]);
  checkWin();
}

// Deduct fuel, remove card from hand, enter command-targeting mode.
// State is updated locally only — no Firebase push until target is chosen (so cancel can restore).
function startCommandTargeting(cardId) {
  const active = state.initiative;
  const card = CARD_BY_ID[cardId];
  const discount = discountFor(state[active], card, null);
  const effectiveCost = card.cost - discount;
  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);
  preCommandState = state;
  state = {
    ...state,
    // doc 02 Q027 (Discard Pile) — safe pre-completion, see the note on startCoordinatedStrike.
    [active]: consumeDiscounts(
      { ...state[active], fuel: state[active].fuel - effectiveCost, hand: handAfter, discardPile: [...(state[active].discardPile ?? []), cardId] },
      card, null, discount,
    ),
  };
  pendingCommandId = cardId;
  pendingRallyCryCount = (cardId === 'C03' || cardId === 'C10') ? 2 : 0;
  uiState = 'command-targeting';
  appendLog([`${card.name}: choose a target`]);
  redraw();
}

// Radio Interference (123) — the one command that targets an ENEMY Hero Zone rather than a
// board tile, so it needs its own mode instead of getCommandTargets/command-targeting
// (both tile-only). Same cancel-restore contract as startCommandTargeting.
function startEnemyHeroTargeting(cardId) {
  const active = state.initiative;
  const opp = active === 'p1' ? 'p2' : 'p1';
  const card = CARD_BY_ID[cardId];
  if (!(state[opp].heroZones ?? []).some(z => z != null)) {
    appendLog([`${card.name}: opponent has no deployed Hero`]);
    return;
  }
  const discount = discountFor(state[active], card, null);
  const effectiveCost = card.cost - discount;
  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);
  preCommandState = state;
  state = {
    ...state,
    // doc 02 Q027 (Discard Pile) — safe pre-completion, see the note on startCoordinatedStrike.
    [active]: consumeDiscounts(
      { ...state[active], fuel: state[active].fuel - effectiveCost, hand: handAfter, discardPile: [...(state[active].discardPile ?? []), cardId] },
      card, null, discount,
    ),
  };
  pendingCommandId = cardId;
  uiState = 'command-hero-targeting';
  appendLog([`${card.name}: choose an enemy Hero`]);
  redraw();
}

function resolveEnemyHeroTargeting(role, col) {
  const heroId = state[role].heroZones?.[col];
  if (heroId == null) return;
  const heroName = CARD_BY_ID[heroId]?.name ?? 'Hero';
  const ps = state[role];
  const s = {
    ...state,
    [role]: { ...ps, heroTaxedColumns: { ...(ps.heroTaxedColumns ?? {}), [col]: (ps.heroTaxedColumns?.[col] ?? 0) + 1 } },
  };
  pendingCommandId = null;
  preCommandState = null;
  uiState = 'idle';
  commitState(s, [`Radio Interference: ${heroName}'s Power costs +1F during ${role.toUpperCase()}'s next turn`]);
}

// Shared by Air Strike (20) and Suppressing Fire (79): 1 hit on targetKey per friendly unit
// of the given class currently on board. Returns the updated state, log lines, and whether
// the target became Suppressed (so the caller can check Counteroffensive General).
function applyClassCountHits(s, active, targetKey, unit, cls, cardName) {
  const log = [];
  const count = unitsOnBoard(s, active).filter(({ unit: u }) => CARD_BY_ID[u.cardId]?.cls === cls).length;
  if (count === 0) {
    log.push(`${cardName}: no friendly ${cls} on board`);
    return { state: s, log, becameSuppressed: false };
  }
  const unitName = CARD_BY_ID[unit?.cardId]?.name ?? '?';
  let tgt = unit; let dmg = 0; let becameSuppressed = false;
  for (let i = 0; i < count && tgt; i++) {
    const { newUnit, hqDamage } = applyHit(tgt);
    dmg += hqDamage;
    if (newUnit.state === 'suppressed') becameSuppressed = true;
    tgt = newUnit?.state === 'destroyed' ? null : newUnit;
  }
  s = { ...s, board: { ...s.board, [targetKey]: tgt },
        [unit.owner]: { ...s[unit.owner], hq: s[unit.owner].hq - dmg } };
  log.push(`${cardName}: ${count} hit(s) on ${unitName} — ${dmg} HQ damage`);
  if (tgt === null) {
    const pd = applyPostDestructionEffects(s, { unitKey: targetKey, dyingUnit: unit, sourceUnitKey: null });
    s = pd.state;
    log.push(...pd.log);
  }
  s = recalculateDynamicStats(s);
  return { state: s, log, becameSuppressed };
}

// Apply the effect of a targeted command to the clicked tile.
function applyCommandEffect(commandId, targetKey) {
  const active = state.initiative;
  const opp = active === 'p1' ? 'p2' : 'p1';
  const card = CARD_BY_ID[commandId];
  let s = { ...state };
  const log = [];

  // C22 Objective Push targets an OBJECTIVE tile, not a unit — handle it before the generic
  // unit/unitName setup below, which doesn't apply here.
  if (commandId === 'C22') {
    const targets = friendlyAdjacentUnitKeys(s.board, targetKey, active);
    const newBoard = { ...s.board };
    for (const k of targets) {
      const u = newBoard[k];
      newBoard[k] = { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 };
    }
    s = { ...s, board: newBoard };
    log.push(`${card.name}: ${targets.length} friendly Unit(s) adjacent to the Objective +1 all sides (permanent)`);
    pendingCommandId = null;
    preCommandState = null;
    uiState = 'idle';
    const rs = applyRuthlessStrategistIfPresent(s, active);
    commitState(rs.state, [...log, ...rs.log]);
    checkWin();
    return;
  }

  const unit = s.board[targetKey];
  const unitName = CARD_BY_ID[unit?.cardId]?.name ?? '?';

  // Run 1 (2026-08-31): rewired to the new C01-C35 id scheme against doc 03's actual effect
  // text — verified per-card, not assumed by id/name resemblance to an old case.
  switch (commandId) {
    case 'C01': { // Field Medic — remove Suppression
      const result = removeSuppression(s, targetKey);
      s = result.state;
      log.push(`${card.name}: ${unitName} un-suppressed`);
      log.push(...result.log);
      break;
    }
    case 'C02': { // Improvised Position — +2 all sides until your next turn (no-Armor unit only)
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedSideBonus: (unit.grantedSideBonus || 0) + 2, sideBonusTurns: 1 } } };
      log.push(`${card.name}: ${unitName} +2 all sides (until your next turn)`);
      break;
    }
    case 'C03': { // Rally Cry — +1 all sides until end of turn (choose up to 2, may stop after 1)
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, tempSideBonus: (unit.tempSideBonus || 0) + 1 } } };
      log.push(`${card.name}: ${unitName} +1 all sides (until end of turn)`);
      pendingRallyCryCount--;
      if (pendingRallyCryCount > 0) {
        commitState(s, log);
        appendLog([`${card.name}: choose a second unit (or press Done)`]);
        redraw();
        return; // stay in command-targeting for second pick
      }
      break;
    }
    case 'C08': { // Second Wind — remove Suppression + 2 all sides until end of turn
      const result = removeSuppression(s, targetKey);
      s = result.state;
      const su = s.board[targetKey];
      s = { ...s, board: { ...s.board, [targetKey]: { ...su, tempSideBonus: (su.tempSideBonus || 0) + 2 } } };
      log.push(`${card.name}: ${unitName} un-suppressed + 2 all sides (until end of turn)`);
      log.push(...result.log);
      break;
    }
    case 'C10': { // Hold Position — +2 all sides until your next turn (choose up to 2)
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedSideBonus: (unit.grantedSideBonus || 0) + 2, sideBonusTurns: 1 } } };
      log.push(`${card.name}: ${unitName} +2 all sides (until your next turn)`);
      pendingRallyCryCount--;
      if (pendingRallyCryCount > 0) {
        commitState(s, log);
        appendLog([`${card.name}: choose a second unit (or press Done)`]);
        redraw();
        return;
      }
      break;
    }
    case 'C11': { // Tactical Withdrawal — return to hand (resets to printed/default state; no draw)
      // doc 02 Q025: if hand is already full, the returned card goes to Discard Pile instead.
      s = { ...s, board: { ...s.board, [targetKey]: null }, [active]: addCardToHand(s[active], unit.cardId) };
      log.push(`${card.name}: ${unitName} returned to hand`);
      break;
    }
    case 'C12': { // Dig In — Guard until your next turn (no Armor — new text is Guard-only)
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedKeywords: [...(unit.grantedKeywords || []), 'Guard'] } } };
      log.push(`${card.name}: ${unitName} gains Guard (until your next turn)`);
      break;
    }
    case 'C16': { // Change Formation — rotate 90°, direction chosen via modal
      pendingCommandId = null;
      preCommandState = null;
      uiState = 'idle';
      showRotateDirectionModal({ kind: 'command', targetKey, cardName: card.name, s, log, role: active });
      return;
    }
    case 'C18': { // Sacrifice Play — destroy 1 friendly Unit, draw 2. No "even through Guard"
      // wording on this card (unlike C19), so it must follow the NORMAL destruction-HQ rule —
      // 2 damage to the owner's own HQ, or 0 if the sacrificed Unit has Guard. Route through
      // the full resolveDestructionChain (not the HQ-free applyPostDestructionEffects sibling)
      // so that Guard check isn't hand-rolled a second time and risk diverging from combat's.
      const dc = resolveDestructionChain(s, { unitKey: targetKey, sourceUnitKey: null, cause: 'command' });
      s = { ...dc.state, p1: { ...dc.state.p1, hq: dc.state.p1.hq - dc.hqDamageToP1 }, p2: { ...dc.state.p2, hq: dc.state.p2.hq - dc.hqDamageToP2 } };
      s = { ...s, [active]: drawCards(s[active], 2) };
      log.push(`${card.name}: draw 2 cards`);
      log.push(...dc.log);
      break;
    }
    case 'C19': { // Scorched Earth Raid — destroy 1 friendly Unit, 2 HQ to ENEMY instead of
      // the normal friendly-destruction result — applies even if the Unit has Guard.
      const dc = resolveDestructionChain(s, { unitKey: targetKey, sourceUnitKey: null, cause: 'command', hqResultReplacement: { targetHq: opp, amount: 2 } });
      s = { ...dc.state, p1: { ...dc.state.p1, hq: dc.state.p1.hq - dc.hqDamageToP1 }, p2: { ...dc.state.p2, hq: dc.state.p2.hq - dc.hqDamageToP2 } };
      log.push(`${card.name}:`);
      log.push(...dc.log);
      break;
    }
    case 'C24': { // Suppressing Fire (Infantry) — +1 all sides permanently (simple stat buff —
      // NOT the old multi-hit "1 hit per friendly Infantry" mechanic despite the shared name)
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedSideBonus: (unit.grantedSideBonus || 0) + 1, sideBonusTurns: 99 } } };
      log.push(`${card.name}: ${unitName} +1 all sides (permanent)`);
      break;
    }
    case 'C28': { // Field Repairs (Tank) — Armor, or Heavy Armor if it already has Armor
      // (permanent — no "until" wording, so permanentKeywords not grantedKeywords)
      const kws = getKeywords(unit);
      const newKw = kws.includes('Armor') ? 'Heavy Armor' : 'Armor';
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, permanentKeywords: [...(unit.permanentKeywords || []), newKw] } } };
      log.push(`${card.name}: ${unitName} gains ${newKw} (permanent)`);
      break;
    }
    case 'C30': { // Artillery Barrage (Artillery) — grant Barrage until end of turn (NOT the
      // old single-target Suppress/Armor-strip effect despite the shared name)
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, tempKeywords: [...(unit.tempKeywords || []), 'Barrage'] } } };
      log.push(`${card.name}: ${unitName} gains Barrage (until end of turn)`);
      break;
    }
    case 'C31': { // Target Coordinates (Artillery) — grant Precision until end of turn
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, tempKeywords: [...(unit.tempKeywords || []), 'Precision'] } } };
      log.push(`${card.name}: ${unitName} gains Precision (until end of turn)`);
      break;
    }
    case 'C32': { // Fire for Effect (Artillery) — grant Blast + Barrage until end of turn;
      // Escalate: affect up to 2 friendly Artillery instead (chained 2nd pick, same pattern
      // as Rally Cry/Hold Position — see pendingRallyCryCount).
      const escalated = hasEscalated(s[active], card.name);
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, tempKeywords: [...(unit.tempKeywords || []), 'Blast', 'Barrage'] } } };
      log.push(`${card.name}: ${unitName} gains Blast and Barrage (until end of turn)`);
      if (escalated && pendingRallyCryCount === 0) {
        // First pick under Escalate — mark Escalate used now (doc 01 §29: tracked by name,
        // not by target count), then offer a second pick.
        s = { ...s, [active]: markEscalateUse(s[active], card.name) };
        pendingRallyCryCount = 1;
        pendingCommandId = 'C32';
        preCommandState = null; // already past the point where Cancel should refund the card
        commitState(s, log);
        appendLog([`${card.name}: Escalate — choose a second friendly Artillery (or press Done)`]);
        uiState = 'command-targeting';
        redraw();
        return;
      }
      if (!escalated) s = { ...s, [active]: markEscalateUse(s[active], card.name) };
      pendingRallyCryCount = 0;
      break;
    }
    default: break;
  }

  // Cases 16/20/79 (Artillery Barrage/Air Strike/Suppressing Fire) and 140/141 (Sacrifice
  // Play/Scorched Earth Rally) can transition targetKey's unit — the other cases leave it
  // alone, so a before/after diff against `unit` (captured at function entry) covers all 5
  // for free without touching each case.
  const cmdTransitionFlags = new Map();
  const afterUnit = s.board[targetKey];
  if (unit && !afterUnit) {
    cmdTransitionFlags.set(targetKey, 'destroyed');
    const destroyedName = CARD_BY_ID[unit.cardId]?.name;
    const tileEl = document.querySelector(`[data-key="${targetKey}"]`);
    if (destroyedName && tileEl) {
      const rect = tileEl.getBoundingClientRect();
      showFxPopup(rect.left + rect.width / 2, rect.top, `${destroyedName} destroyed`);
    }
  }
  else if (unit && afterUnit && unit.state !== 'suppressed' && afterUnit.state === 'suppressed') {
    cmdTransitionFlags.set(targetKey, 'suppressed');
  } else if (unit && afterUnit && (afterUnit.armorHits || 0) > (unit.armorHits || 0)) {
    cmdTransitionFlags.set(targetKey, 'armor-absorbed');
    const tileEl = document.querySelector(`[data-key="${targetKey}"]`);
    if (tileEl) {
      const rect = tileEl.getBoundingClientRect();
      showFxPopup(rect.left + rect.width / 2, rect.top, 'ARMOR ABSORBED');
    }
  }

  pendingCommandId = null;
  preCommandState = null;
  uiState = 'idle';
  const rs = applyRuthlessStrategistIfPresent(s, active);
  commitState(rs.state, [...log, ...rs.log], cmdTransitionFlags);
  checkWin();
}

// ── End Turn ──────────────────────────────────────────────────────────────────

document.getElementById('btn-end-turn').addEventListener('click', () => {
  if (gameOver || !state) return;
  if (isOnline && state.initiative !== myRole) return;
  if (getInteractionDecision(currentInteractionContext()).pending) return;

  const currentPlayer = state.initiative;

  // Reset killsThisTurn for the player who just ended
  let s = { ...state, [currentPlayer]: { ...state[currentPlayer], killsThisTurn: 0 } };

  // Long War Commander (H24) passive: +1 Power at the end of ITS CONTROLLER'S turn (doc 01
  // §21/doc 02 Q117). Never resets — persists across the whole match, including through
  // Coordinated Order-style Hero-ability resets.
  if ((s[currentPlayer].heroZones ?? []).includes('H24')) {
    const prevPower = s[currentPlayer].longWarPower?.['H24'] ?? 1;
    s = { ...s, [currentPlayer]: { ...s[currentPlayer], longWarPower: { ...s[currentPlayer].longWarPower, H24: prevPower + 1 } } };
  }

  // Direct HQ (doc 01 §19) — the sole end-of-turn HQ-pressure mechanic (replaces the old
  // reactive Empty-Board HQ Strike entirely, removed 2026-08-31, Run 1). Runs here, BEFORE
  // endTurn(), while state.turn still equals the ending player's own turn number and their
  // units' persistentSpent/tempExtraAttacks haven't been cleared yet.
  const directHQ = evaluateDirectHQ(s, currentPlayer);
  s = {
    ...directHQ.state,
    p1: { ...directHQ.state.p1, hq: directHQ.state.p1.hq - directHQ.hqDamageToP1 },
    p2: { ...directHQ.state.p2, hq: directHQ.state.p2.hq - directHQ.hqDamageToP2 },
  };
  const directHQLog = directHQ.log;

  // Expire any unused Emergency Supply (C23) temporary Fuel grant — doc 01 §3, after Direct HQ.
  s = { ...s, [currentPlayer]: expireTempFuelGrant(s[currentPlayer]) };

  let newState = endTurn(s);                             // swap initiative, increment turn
  const newActive = newState.initiative;
  if (newState.turn > 1) {                               // skip only turn 1 (P1) — they already got their
                                                          // 5th card pre-game in startGame; P2 gets no such
                                                          // bonus draw, so their first turn (turn 2) must draw here.
    newState = { ...newState, [newActive]: drawCards(newState[newActive], 1) };
  }
  newState = startOfTurn(newState);                      // gain fuel for new active player
  const objectivesBeforeThisTurn = newState.objectives;
  newState = updateObjectiveLevels(newState);            // escalate objective levels
  newState = checkObjectiveControl(newState);            // check majority-adjacent control

  // Capture/level-up feedback — previously silent (both recalculate here every turn with no
  // transition of any kind). Diffed against the snapshot just above rather than threaded
  // through updateObjectiveLevels/checkObjectiveControl themselves, so neither pure function
  // needs to change shape for a UI-only concern.
  const objectiveTransitionFlags = new Map();
  for (const [objKey, objAfter] of Object.entries(newState.objectives)) {
    const objBefore = objectivesBeforeThisTurn[objKey];
    if (!objBefore) continue;
    if (objBefore.controller !== objAfter.controller && objAfter.controller) {
      objectiveTransitionFlags.set(objKey, 'obj-captured');
    } else if (objBefore.level !== objAfter.level) {
      objectiveTransitionFlags.set(objKey, 'obj-leveled');
    }
  }

  // Supply Runner ability: at start of turn, if on a controlled objective → +1 Fuel
  const supplyLog = [];
  for (const { key: bk, unit: u } of unitsOnBoard(newState, newActive)) {
    if (CARD_BY_ID[u.cardId]?.id !== 5) continue;
    if (getAdjacentKeys(bk).some(k => newState.objectives[k]?.controller === newActive)) {
      newState = { ...newState, [newActive]: gainFuel(newState[newActive], 1, false) };
      supplyLog.push(`Supply Runner: controlled objective → +1 Fuel`);
    }
  }

  // Quartermaster ability: at start of turn, if you control every objective on the map → draw 1.
  // Wording was "both objectives" until 2026-08-19 — accurate back when every map had exactly
  // 2 slots; now objectiveSlots varies 1-4 per map (see maps.js), so this checks ALL objectives
  // currently placed, whatever the count, same as it always has (objs.every(...) was never
  // hardcoded to 2 — only the card text and this log line's wording were).
  for (const { unit: u } of unitsOnBoard(newState, newActive)) {
    if (CARD_BY_ID[u.cardId]?.id !== 69) continue;
    const objs = Object.values(newState.objectives);
    const controlsAll = objs.length > 0 && objs.every(o => o.controller === newActive);
    if (controlsAll) {
      newState = { ...newState, [newActive]: drawCards(newState[newActive], 1) };
      supplyLog.push(`Quartermaster: controls every objective on the map → draw 1`);
    }
  }

  const { state: afterEffects, log: effectLog, pendingArtyHits, pendingPick } = applyObjectiveEffects(newState, newActive, null);
  // Synced onto state (not just a local variable) so the controlling player's own client — not just
  // whoever clicked End Turn — knows to enter arty-targeting mode. See syncArtyTargetingUiState().
  newState = { ...afterEffects, pendingArtyHits, pendingObjectivePick: pendingPick };

  lastDATargetKey = null;
  uiState = 'idle';
  selectedHandCardId = null;
  pendingAttackerKey = null;
  pendingCommandId = null;
  selectedHeroZone = null;
  pendingHeroId = null;
  pendingHeroColumn = null;
  pendingHeroTargets = null;

  const newRound = Math.ceil(newState.turn / 2);
  const turnLog = [...directHQLog, `--- Round ${newRound} — ${newState.initiative.toUpperCase()} ---`, ...supplyLog, ...effectLog];
  // Direct HQ source-unit pulse — set on the exact keys evaluateDirectHQ reports converted
  // this sweep, so it plays on the very next render alongside everything else this commit
  // already redraws (same transitionFlags mechanism as Suppressed/Destroyed).
  const directHQFlags = new Map();
  directHQ.sources.forEach(({ key }) => directHQFlags.set(key, 'direct-hq'));
  commitState(newState, turnLog, directHQFlags, objectiveTransitionFlags);
  checkWin();
  // HQ-side result flash/popup — deliberately a beat after the source pulse above (which
  // plays immediately on this same commit) rather than simultaneous, so SOURCE → RESULT
  // reads as a brief sequence instead of everything flashing at once. Not the full
  // SequenceQueue from the plan (explicitly deferred) — just enough timing to feel like two
  // steps, layered over the existing synchronous resolution.
  if (directHQ.hqDamageToP1 > 0) setTimeout(() => flashDirectHit('p1', directHQ.hqDamageToP1), 200);
  if (directHQ.hqDamageToP2 > 0) setTimeout(() => flashDirectHit('p2', directHQ.hqDamageToP2), 200);
  // One connector line per converting unit, timed to the same 200ms mark as the HQ flash above
  // — draws "this unit's unused attack" straight to "this HQ damage", the one causality
  // pairing on the board that's genuinely hard to follow from timing alone (source and result
  // sit on opposite ends of the screen).
  directHQ.sources.forEach(({ key, targetPlayer }) => {
    setTimeout(() => {
      const fromEl = document.querySelector(`.tile[data-key="${key}"] .board-card`);
      const toEl = document.getElementById(`${targetPlayer}-hq`);
      if (fromEl && toEl) drawFxConnector(fromEl, toEl);
    }, 200);
  });

  // Local hotseat only — both players share this screen, so flash whose turn it now is.
  // Online is handled separately in receiveRemoteState (fires on the receiving client only).
  if (!isOnline && !gameOver) showTurnToast(`${newState.initiative.toUpperCase()}'S TURN`);

  // Hero Phase for the player whose turn just began — deferred if an Objective pick is pending
  // (doc 04: Objective step, including any player-choice secondary, resolves before free Hero
  // deployment). resumeObjectiveResolution runs this itself once the last pending pick drains.
  if (!pendingPick && !gameOver) runHeroPhase(newState.initiative);

  // Unconditional even with a pending pick: the bot's own turn loop resolves its pending
  // Objective pick via handleObjectivePicking (bot_player.js) as its first action, exactly like
  // the existing handleArtyTargeting/handleRotateDirection handlers — it doesn't wait for
  // runHeroPhase to have already run.
  if (isAiMode && !gameOver && newState.initiative === 'p2') {
    runBotTurn();
  }
});

// ── Cancel ────────────────────────────────────────────────────────────────────

document.getElementById('btn-cancel').addEventListener('click', () => {
  if (!canCancelInteraction(currentInteractionContext())) return;
  // Rally Cry / Hold Position: once the first unit is picked and committed, "Cancel" during
  // the second pick means "stop here" (keep the first pick) — not a full revert of the cast.
  const rallyCryAlreadyPicked = ((pendingCommandId === 'C03' || pendingCommandId === 'C10') && pendingRallyCryCount < 2)
    || (pendingCommandId === 'C32' && pendingRallyCryCount === 1);
  if (preCommandState && !rallyCryAlreadyPicked) {
    state = preCommandState;
    preCommandState = null;
  }
  pendingCommandManeuverSource = null;
  pendingHeroManeuverSource = null;
  pendingCoordStrikeFirst = null;
  pendingUnitManeuverSource = null;
  pendingUnitManeuverPlacedKey = null;
  uiState = "idle";
  // Hero targeting must be cancellable: bot_player's flushPendingUiState blindly clicks
  // Cancel whenever uiState !== 'idle', so leaving these set would loop the bot.
  selectedHeroZone = null;
  pendingHeroId = null;
  pendingHeroColumn = null;
  pendingHeroTargets = null;
  pendingHalftrackMove = null;
  selectedHandCardId = null;
  pendingAttackerKey = null;
  pendingCommandId = null;
  pendingRallyCryCount = 0;
  preCommandState = null;
  if (state) redraw();
});

// ── Exit ──────────────────────────────────────────────────────────────────────

document.getElementById('btn-exit').addEventListener('click', async () => {
  if (!confirm('Exit to main menu? Current game will be lost.')) return;
  if (isOnline && gameId && myRole) await setPlayerLeft(gameId, myRole);
  window.location.href = 'index.html';
});

function showDisconnectScreen(who) {
  gameOver = true;
  document.getElementById('end-winner').textContent = `${who.toUpperCase()} LEFT THE GAME`;
  document.getElementById('end-subtitle').textContent = 'OPPONENT DISCONNECTED';
  document.getElementById('end-screen').style.display = 'flex';
}

// ── Card preview panel ────────────────────────────────────────────────────────

function getDir(fromKey, toKey) {
  const [r1, c1] = fromKey.split(',').map(Number);
  const [r2, c2] = toKey.split(',').map(Number);
  if (r2 < r1) return 'n';
  if (r2 > r1) return 's';
  if (c2 < c1) return 'w';
  return 'e';
}

function showCardPreview(cardId) {
  const card = CARD_BY_ID[cardId];
  if (!card) return;
  document.getElementById('cp-name').textContent = card.name;
  document.getElementById('cp-badge').className = 'cp-badge';
  // Static template only (hand/Hero/objective-fallback) — never has a live-effects
  // breakdown, so clear any left over from a previous showBoardUnitPreview hover.
  document.getElementById('cp-effects').innerHTML = '';
  if (card.type === 'unit') {
    document.getElementById('cp-badge').textContent = `${card.cost} Fuel · ${card.cls || card.type}`;
    document.getElementById('cp-dirs').innerHTML =
      `<div class="cp-dir-row"><span class="cp-dl">N</span><span class="cp-dv">${card.n}</span></div>` +
      `<div class="cp-dir-row"><span class="cp-dl">E</span><span class="cp-dv">${card.e}</span></div>` +
      `<div class="cp-dir-row"><span class="cp-dl">S</span><span class="cp-dv">${card.s}</span></div>` +
      `<div class="cp-dir-row"><span class="cp-dl">W</span><span class="cp-dv">${card.w}</span></div>`;
    const kws = card.keyword ? (Array.isArray(card.keyword) ? card.keyword : [card.keyword]) : [];
    document.getElementById('cp-keyword').innerHTML = kws.map(k => `<span class="cp-kw-tag">${k}</span>`).join('');
    document.getElementById('cp-effect').textContent = card.ability || '';
  } else if (card.type === 'hero') {
    const scope = (card.scope ?? 'board').toUpperCase();
    document.getElementById('cp-badge').textContent = card.powerType === 'active'
      ? `Active ${card.activeCost}F · ${scope}`
      : `Passive · ${scope}`;
    document.getElementById('cp-dirs').innerHTML = '';
    document.getElementById('cp-keyword').innerHTML = '';
    document.getElementById('cp-effect').textContent = card.ability || '';
  } else {
    document.getElementById('cp-badge').textContent = `${card.cost} Fuel · ${card.cls || card.type}`;
    document.getElementById('cp-dirs').innerHTML = '';
    document.getElementById('cp-keyword').innerHTML = '';
    document.getElementById('cp-effect').textContent = card.effect || card.req || '';
  }
  document.getElementById('card-preview').style.display = 'flex';
  document.getElementById('preview-hint').style.display = 'none';
}

// Live board-unit preview — unlike showCardPreview above (which reads the static CARD_BY_ID
// template for hand/Hero/objective hover), this reads the actual BoardUnit and answers "why
// does this unit currently look/behave this way": live N/E/S/W (same getSideValue combat
// resolution itself uses, so it can never disagree with what an attack would actually do),
// Suppressed state, armor remaining, rotation, and a source breakdown for every stat bonus
// this build can attribute to a real cause (Debug Panel, Inspire/Muster — see
// describeDynamicSideBonus in combat.js). Bonuses from Commands/Hero Powers/Objectives are
// still real and included in the live N/E/S/W numbers and in the total below — they're just
// not individually attributed yet (bucketed as "other effects"), since that needs
// source-tracking threaded through the ~30 scattered grant call sites in combat.js/game.js,
// which is deferred, separate follow-up work, not part of this pass.
function showBoardUnitPreview(unitKey) {
  const unit = state?.board[unitKey];
  if (!unit) return;
  const card = CARD_BY_ID[unit.cardId];
  if (!card) return;

  document.getElementById('cp-name').textContent = card.name;
  const armorMax = maxArmorHits(unit);
  const badge = document.getElementById('cp-badge');
  badge.className = 'cp-badge';
  badge.textContent = `${card.cost} Fuel · ${card.cls || card.type}` +
    (armorMax > 0 ? ` · ${armorMax - unit.armorHits}/${armorMax} protection` : '');

  document.getElementById('cp-dirs').innerHTML =
    `<div class="cp-dir-row"><span class="cp-dl">N</span><span class="cp-dv">${getSideValue(unit, 'n')}</span></div>` +
    `<div class="cp-dir-row"><span class="cp-dl">E</span><span class="cp-dv">${getSideValue(unit, 'e')}</span></div>` +
    `<div class="cp-dir-row"><span class="cp-dl">S</span><span class="cp-dv">${getSideValue(unit, 's')}</span></div>` +
    `<div class="cp-dir-row"><span class="cp-dl">W</span><span class="cp-dv">${getSideValue(unit, 'w')}</span></div>`;

  const kwList = getKeywords(unit);
  document.getElementById('cp-keyword').innerHTML = kwList.map(k => `<span class="cp-kw-tag">${k}</span>`).join('');

  const rows = [];
  if (unit.state === 'suppressed') rows.push(['negative', '▼', 'Suppressed — cannot attack']);
  const dyn = describeDynamicSideBonus(state, unitKey);
  dyn.sources.forEach(s => rows.push(['positive', '▲', `+${s.amount} all sides — ${s.label}`]));
  if (unit.debugSideBonus) {
    const sign = unit.debugSideBonus > 0 ? '+' : '';
    rows.push([unit.debugSideBonus > 0 ? 'positive' : 'negative', unit.debugSideBonus > 0 ? '▲' : '▼', `${sign}${unit.debugSideBonus} all sides — Debug Panel`]);
  }
  // Everything else that currently feeds getSideValue's total but isn't individually
  // attributed yet — kept as one honest catch-all so the listed amounts never silently
  // undercount the real total shown in cp-dirs above.
  const otherTotal = (unit.tempSideBonus || 0) + (unit.grantedSideBonus || 0) + (unit.objSideBonus || 0);
  if (otherTotal !== 0) {
    const sign = otherTotal > 0 ? '+' : '';
    rows.push([otherTotal > 0 ? 'positive' : 'negative', otherTotal > 0 ? '▲' : '▼', `${sign}${otherTotal} all sides — other effects (Command/Hero Power/Objective)`]);
  }
  if (armorMax > 0) {
    rows.push(['protect', '⬤', `${kwList.includes('Heavy Armor') ? 'Heavy Armor' : 'Armor'} — ${armorMax - unit.armorHits} of ${armorMax} remaining`]);
  }
  if (unit.rotation) rows.push(['positive', '⟳', `Rotated ${unit.rotation}°`]);

  const effectsEl = document.getElementById('cp-effects');
  effectsEl.innerHTML = rows.length
    ? `<div class="cp-effects-title">CURRENT EFFECTS</div>` +
      rows.map(([cls, icon, text]) => `<div class="cp-effect-row ${cls}"><span class="cp-eff-icon">${icon}</span>${text}</div>`).join('')
    : '';

  document.getElementById('cp-effect').textContent = card.ability || '';
  document.getElementById('card-preview').style.display = 'flex';
  document.getElementById('preview-hint').style.display = 'none';
}

function showAttackPreview(attackerKey, targetKey) {
  const attUnit = state.board[attackerKey];
  const defUnit = state.board[targetKey];
  if (!attUnit || !defUnit) return;
  const dir = getDir(attackerKey, targetKey);
  const oppDir = oppositeDir(dir);
  const attVal = getSideValue(attUnit, dir);
  const defVal = getSideValue(defUnit, oppDir);
  const hits = attackBeats(attUnit, dir, defUnit);
  const attCard = CARD_BY_ID[attUnit.cardId];
  const defCard = CARD_BY_ID[defUnit.cardId];
  let outcome;
  if (!hits) {
    outcome = 'Attack blocked — no effect';
  } else {
    const armor = maxArmorHits(defUnit);
    if (defUnit.armorHits < armor) outcome = 'Armor absorbs — no HQ damage';
    else if (defUnit.state === 'normal') outcome = 'Suppressed — 1 HQ damage to defender';
    else outcome = 'Destroyed — 2 HQ damage to defender';
  }
  const badge = document.getElementById('cp-badge');
  document.getElementById('cp-name').textContent = `${attCard?.name ?? '?'} → ${defCard?.name ?? '?'}`;
  badge.textContent = hits ? 'HIT' : 'BLOCKED';
  badge.className = `cp-badge ${hits ? 'hit' : 'block'}`;
  document.getElementById('cp-dirs').innerHTML =
    `<div class="cp-dir-row"><span class="cp-dl">${dir.toUpperCase()}</span><span class="cp-dv">${attVal}</span></div>` +
    `<div class="cp-dir-row"><span class="cp-dl">${oppDir.toUpperCase()}</span><span class="cp-dv">${defVal}</span></div>`;
  document.getElementById('cp-keyword').textContent = '';
  document.getElementById('cp-effects').innerHTML = '';
  document.getElementById('cp-effect').textContent = outcome;
  document.getElementById('card-preview').style.display = 'flex';
  document.getElementById('preview-hint').style.display = 'none';
}

function hideCardPreview() {
  document.getElementById('card-preview').style.display = 'none';
  document.getElementById('preview-hint').style.display = 'block';
}

// Objective tiles never populated the CARD DETAIL side panel — only the small hover
// tooltip (see ui.js's tile.dataset.tipHtml). Reuses the same .obj-tt-level markup/classes
// as that tooltip so the level breakdown reads identically in both places.
function showObjectivePreview(tileKey) {
  const obj = state?.objectives[tileKey];
  if (!obj) return;
  const objCard = CARD_BY_ID[obj.cardId];
  if (!objCard) return;
  document.getElementById('cp-name').textContent = objCard.name;
  document.getElementById('cp-badge').className = 'cp-badge';
  document.getElementById('cp-badge').textContent = obj.controller
    ? `OBJECTIVE · ${obj.controller.toUpperCase()} CONTROLS`
    : 'OBJECTIVE · NEUTRAL';
  document.getElementById('cp-dirs').innerHTML = '';
  document.getElementById('cp-keyword').innerHTML = '';
  document.getElementById('cp-effects').innerHTML = '';
  const levels = [objCard.l1, objCard.l2, objCard.l3, objCard.l4];
  document.getElementById('cp-effect').innerHTML = levels.map((eff, i) => {
    const isCurrent = (i + 1) === obj.level;
    return `<div class="obj-tt-level${isCurrent ? ' current' : ''}"><span class="obj-tt-lnum">L${i + 1}</span> ${eff ?? '—'}</div>`;
  }).join('');
  document.getElementById('card-preview').style.display = 'flex';
  document.getElementById('preview-hint').style.display = 'none';
}

// Missions retired for v0.4 (2026-07-30, see cards.js header) — the dead
// playMissionCard/checkActiveMissions/evalMissionCondition/applyMissionReward functions and
// their call sites were removed from this file in the 2026-08 code-optimization pass.

// Hand hover → card preview
document.getElementById('p1-hand').addEventListener('mouseover', e => {
  const cardEl = e.target.closest('.hand-card');
  if (cardEl) showCardPreview(cardEl.dataset.cardId);
});
document.getElementById('p1-hand').addEventListener('mouseleave', hideCardPreview);

// Board hover → attack prediction in targeting mode, card preview otherwise
document.getElementById('board').addEventListener('mouseover', e => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  if (uiState === 'targeting' && pendingAttackerKey) {
    if (tile.classList.contains('targetable')) showAttackPreview(pendingAttackerKey, tile.dataset.key);
    return;
  }
  const unit = state?.board[tile.dataset.key];
  if (unit && unit.state !== 'destroyed') showBoardUnitPreview(tile.dataset.key);
  else if (state?.objectives[tile.dataset.key]) showObjectivePreview(tile.dataset.key);
});
document.getElementById('board').addEventListener('mouseleave', hideCardPreview);

// Hero Zone hover → card preview, same as hand cards and board units.
for (const role of ['p1', 'p2']) {
  const strip = document.getElementById(`hero-zone-${role}`);
  strip?.addEventListener('mouseover', e => {
    const placed = e.target.closest('.hero-placed');
    if (placed) showCardPreview(placed.dataset.heroId);
  });
  strip?.addEventListener('mouseleave', hideCardPreview);
}

// ── Floating tooltip — [data-tip]/[data-tip-html] elements (ability icons on hand/board
// cards, Hero powers, Objective tiles) — delegated at the document level so it works for
// every card/tile everywhere without each one's own overflow:hidden (or, for the board,
// fitBoardArea's transform: scale()) clipping or shrinking it (see .floating-tip comment
// in game.css). data-tip is plain text; data-tip-html allows richer markup (Objective
// tiles' name/controller/level breakdown).
{
  const tip = document.getElementById('floating-tip');
  document.addEventListener('mouseover', e => {
    const pip = e.target.closest('[data-tip], [data-tip-html]');
    if (!pip) return;
    if (pip.dataset.tipHtml) tip.innerHTML = pip.dataset.tipHtml;
    else tip.textContent = pip.dataset.tip;
    tip.style.display = 'block';
    const r = pip.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    // Prefer opening above the pip; flip below if that would go off the top of the screen.
    let top = r.top - tipRect.height - 6;
    if (top < 4) top = r.bottom + 6;
    // Anchor right-aligned to the pip, clamped so it never runs off either screen edge.
    let left = r.right - tipRect.width;
    left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-tip], [data-tip-html]')) tip.style.display = 'none';
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

// These 6 "pick one of N" modals (Forward Observer, Radio Operator, Field Reserves, rotate
// direction, Craft, Hero deploy) all commit their Fuel/cost/activation-lock BEFORE opening —
// by design, none of them refund on cancel (see e.g. confirmCraftPick's own doc comment) — and
// none has an external close path, only their own confirm handler. Found 2026-09-02: Escape
// still fired the generic Cancel button underneath them (via the button's plain .click(), which
// bypasses whatever is visually on top), silently resetting uiState while leaving the modal
// itself open and blocking every other click on the page — the player loses whatever they
// already paid with no way forward except completing the very modal they thought they'd
// cancelled. "E" (end turn) has the same bypass risk (a raw .click() call ignores that the
// button is visually obscured), so it's guarded here too.
document.addEventListener('keydown', e => {
  if (gameOver || !state) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (anyBlockingModalOpen()) return;
  if (e.key === 'Escape') document.getElementById('btn-cancel').click();
  if (e.key === 'e' || e.key === 'E') document.getElementById('btn-end-turn').click();
});

// ── P2 online init ────────────────────────────────────────────────────────────
// P2 sees the deck picker and subscribes to games/${gameId} for two things:
//   1. P1's lobby push (_phase:'lobby') → store it, push ready state once deck chosen
//   2. Full game state (no _phase) → game has started, receive it
if (isOnline && myRole === 'p2') {
  document.getElementById('picker-label').textContent = 'YOUR DECK — CHOOSE A DECK';
  subscribeState(gameId, data => {
    if (data._playerLeft && data._playerLeft !== myRole && state) {
      showDisconnectScreen(data._playerLeft);
      return;
    }
    if (data._phase === 'lobby' && !p1LobbyData) {
      p1LobbyData = data;
      // P2 never picks the map (one player picks, not two — see the doc 04 §1 note above),
      // but was previously given zero visibility into it before committing to a deck, even
      // though terrain can matter for deck choice (e.g. a Tank-heavy deck vs. a Forest map).
      // Read-only, not a picker.
      const mapName = MAPS[data.mapId]?.name ?? data.mapId;
      document.getElementById('picker-label').textContent = `YOUR DECK — ${mapName}`;
      tryPushP2Ready(); // fires if P2 already picked; otherwise waits
    } else if (data.turn !== undefined && !data._phase) {
      if (!state) {
        // First game state arrival — P1's initial (unmulliganed) push. Show P2's own mulligan
        // screen immediately, with no dependency on P1's mulligan progress — see
        // beginOnlineMulligan/showOnlineMulligan above for the full simultaneous-mulligan
        // design (objectives/first-draw/turn-1 setup still happen exactly once, computed only
        // by the host, but now strictly after BOTH mulligans instead of after only P1's).
        document.getElementById('waiting-screen').style.display = 'none';
        state = normalizeFirebaseState(data);
        showOnlineMulligan(data.mapId);
        return;
      }
      if (!data.readyForPlay) {
        // Still in the pre-objectives mulligan phase: merge only the player sub-states (this
        // is how P1's own mulliganDone flag becomes visible to P2) — not routed through
        // receiveRemoteState, which assumes real gameplay has already started. P2 never
        // computes objectives itself; it just waits here for the host's eventual full
        // post-mulligan push, which will arrive in the branch below once readyForPlay is true.
        // Checks the INCOMING data's flag, not the locally-cached state's — state.readyForPlay
        // is still stale-false on the exact update where it first flips true, which would
        // otherwise wrongly re-enter this branch and skip revealing the board entirely.
        const normalized = normalizeFirebaseState(data);
        state = { ...state, p1: normalized.p1, p2: normalized.p2 };
        return;
      }
      // Ongoing updates, real gameplay already underway. receiveRemoteState never touches
      // #game-area's visibility itself (every OTHER call site already revealed it before ever
      // reaching that function) — P2 might be seeing readyForPlay:true for the very first time
      // right here (if P2 finished mulligan before P1 did, there was no earlier moment for P2
      // to reveal it at), so do that explicitly, once, before handing off.
      if (document.getElementById('game-area').style.display !== 'flex') {
        document.getElementById('waiting-screen').style.display = 'none';
        document.getElementById('game-area').style.display = 'flex';
      }
      if (data._pushId !== myLastPushId) {
        receiveRemoteState(data);
      }
    }
  });
}

// ── Shared deck-look card preview (Forward Observer, Radio Operator, Field Reserves) ──
// Read-only card face — same markup renderHand uses for a unit/command/mission hand card,
// but built directly (these modals show cards that are NOT in hand yet, mid-choice).
function buildPreviewCardDiv(card) {
  const cardDiv = document.createElement('div');
  cardDiv.className = 'hand-card mulligan-card';
  if (card.type === 'unit') {
    cardDiv.innerHTML = `<div class="hc-header">${card.name}</div><div class="hc-cost">${card.cost} ⛽</div><div class="hc-type">${card.cls}</div><div class="hc-dirs"><div></div><div>${card.n}</div><div></div><div>${card.w}</div><div style="color:#444">·</div><div>${card.e}</div><div></div><div>${card.s}</div><div></div></div>${card.keyword ? `<div class="bc-keyword-row"><span class="bc-kw-tag">${card.keyword}</span></div>` : ''}`;
  } else if (card.type === 'command') {
    cardDiv.classList.add('hc-command');
    cardDiv.innerHTML = `<div class="hc-header">${card.name}</div><div class="hc-cost">${card.cost} ⛽</div><div class="hc-type hc-command-label">COMMAND</div><div class="hc-effect">${card.effect || ''}</div>`;
  } else if (card.type === 'mission') {
    cardDiv.classList.add('hc-mission');
    cardDiv.innerHTML = `<div class="hc-header">${card.name}</div><div class="hc-cost">${card.cost} ⛽</div><div class="hc-type hc-mission-label">MISSION</div><div class="hc-req">${card.req || ''}</div><div class="hc-reward-strip"><div class="hc-reward-label">REWARD</div><div class="hc-reward-text">${card.reward || card.effect || ''}</div></div>`;
  } else {
    cardDiv.innerHTML = `<div class="hc-header">${card?.name ?? '?'}</div>`;
  }
  return cardDiv;
}

// ── Forward Observer modal ────────────────────────────────────────────────────

// Shared by the 3 "look at N cards from your deck" modals (Forward Observer, Radio
// Operator, Field Reserves) — each builds one .fo-slot per drawn card the same way and only
// differs in what buttons a slot gets and how picking one resolves. `buildExtras(slot, card,
// cardId, i)` appends whatever's specific to that modal onto the freshly-built slot.
function renderDeckPeekSlots(containerId, drawn, buildExtras) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  drawn.forEach((cardId, i) => {
    const card = CARD_BY_ID[cardId];
    const slot = document.createElement('div');
    slot.className = 'fo-slot';
    slot.appendChild(buildPreviewCardDiv(card));
    buildExtras(slot, card, cardId, i);
    container.appendChild(slot);
  });
}

function showFOModal(drawn, player) {
  foCards = drawn;
  foPlayer = player;
  foAssignments = {};

  renderDeckPeekSlots('fo-cards', drawn, (slot, card, cardId, i) => {
    const btnGroup = document.createElement('div');
    btnGroup.className = 'fo-btn-group';
    [['keep','KEEP'],['top','TOP'],['bottom','BOT']].forEach(([pos, label]) => {
      const btn = document.createElement('button');
      btn.id = `fo-btn-${i}-${pos}`;
      btn.className = `fo-pos-btn fo-${pos}`;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const wasHere = foAssignments[cardId] === pos;
        foCards.forEach(id => { if (foAssignments[id] === pos) delete foAssignments[id]; });
        if (!wasHere) foAssignments[cardId] = pos;
        updateFOButtons();
      });
      btnGroup.appendChild(btn);
    });
    slot.appendChild(btnGroup);
  });

  document.getElementById('fo-modal').style.display = 'flex';
  updateFOButtons();
}

function updateFOButtons() {
  foCards.forEach((cardId, i) => {
    const assigned = foAssignments[cardId];
    ['keep','top','bottom'].forEach(pos => {
      const btn = document.getElementById(`fo-btn-${i}-${pos}`);
      if (btn) btn.classList.toggle('fo-active', assigned === pos);
    });
  });
  document.getElementById('fo-confirm').disabled = !foCards.every(id => foAssignments[id]);
}

function confirmFO() {
  document.getElementById('fo-modal').style.display = 'none';
  const keepId   = foCards.find(id => foAssignments[id] === 'keep');
  const topId    = foCards.find(id => foAssignments[id] === 'top');
  const bottomId = foCards.find(id => foAssignments[id] === 'bottom'); // undefined when only 2 were drawn (doc 01 §27 — no bottom instruction target)
  const ps = state[foPlayer];
  const newDeck = [topId, ...ps.deck, ...(bottomId !== undefined ? [bottomId] : [])];
  // doc 02 Q022-Q025: a full hand sends the kept card to Discard Pile instead.
  let s = { ...state, [foPlayer]: { ...addCardToHand(ps, keepId), deck: newDeck } };
  const keepName   = CARD_BY_ID[keepId]?.name   ?? '?';
  const topName    = CARD_BY_ID[topId]?.name    ?? '?';
  const log = [`Forward Observer: kept ${keepName} · ${topName} → top` + (bottomId !== undefined ? ` · ${CARD_BY_ID[bottomId]?.name ?? '?'} → bottom` : '')];
  const rs = applyRuthlessStrategistIfPresent(s, foPlayer);
  commitState(rs.state, [...log, ...rs.log]);
  checkWin();
  foCards = [];
  foAssignments = {};
}

document.getElementById('fo-confirm').addEventListener('click', confirmFO);

// ── Radio Operator modal (111) ────────────────────────────────────────────────
// Only 2 cards and a binary choice, so it resolves on a single click — no separate
// Confirm button, unlike Forward Observer's 3-way keep/top/bottom assignment.
let radioOpPlayer = null;

function showRadioOperatorModal(drawn, player) {
  radioOpPlayer = player;
  renderDeckPeekSlots('radio-op-cards', drawn, (slot, card, cardId) => {
    const btn = document.createElement('button');
    btn.className = 'fo-pos-btn fo-top';
    btn.textContent = 'PUT ON TOP';
    btn.addEventListener('click', () => confirmRadioOperator(cardId, drawn.find(id => id !== cardId)));
    slot.appendChild(btn);
  });
  document.getElementById('radio-op-modal').style.display = 'flex';
}

function confirmRadioOperator(topId, bottomId) {
  document.getElementById('radio-op-modal').style.display = 'none';
  const ps = state[radioOpPlayer];
  const s = { ...state, [radioOpPlayer]: { ...ps, deck: [topId, ...ps.deck, bottomId] } };
  const topName = CARD_BY_ID[topId]?.name ?? '?';
  const bottomName = CARD_BY_ID[bottomId]?.name ?? '?';
  commitState(s, [`Radio Operator: ${topName} → top · ${bottomName} → bottom`]);
  radioOpPlayer = null;
}

// ── Field Reserves modal (125) ────────────────────────────────────────────────
// Look at top 4; may take ONE Unit into hand; the rest go to the bottom, original order
// preserved. Cards were already pulled off the deck (see case 125 in playInstantCommand).
let fieldReservesCards = [];
let fieldReservesPlayer = null;

function showFieldReservesModal(drawn, player) {
  fieldReservesCards = drawn;
  fieldReservesPlayer = player;
  renderDeckPeekSlots('field-reserves-cards', drawn, (slot, card, cardId) => {
    if (card.type === 'unit') {
      const btn = document.createElement('button');
      btn.className = 'fo-pos-btn fo-top';
      btn.textContent = 'TAKE';
      btn.addEventListener('click', () => confirmFieldReserves(cardId));
      slot.appendChild(btn);
    }
  });
  document.getElementById('field-reserves-modal').style.display = 'flex';
}

function confirmFieldReserves(takenId) {
  document.getElementById('field-reserves-modal').style.display = 'none';
  const ps = state[fieldReservesPlayer];
  const rest = fieldReservesCards.filter(id => id !== takenId);
  const hand = takenId != null ? [...ps.hand, takenId] : ps.hand;
  const s = { ...state, [fieldReservesPlayer]: { ...ps, hand, deck: [...ps.deck, ...rest] } };
  const msg = takenId != null
    ? `Field Reserves: took ${CARD_BY_ID[takenId]?.name} — ${rest.length} card(s) to bottom`
    : `Field Reserves: took nothing — 4 card(s) to bottom`;
  commitState(s, [msg]);
  fieldReservesCards = [];
  fieldReservesPlayer = null;
}

document.getElementById('field-reserves-skip').addEventListener('click', () => confirmFieldReserves(null));

// ── Craft picker modal (Chief Aircraft Engineer, H25) ───────────────────────────
// Doc 01 §28: activating Craft rolls 3 candidate Aircraft (stats/keyword/drawback) and the
// player picks 1 of 3 to add to hand. Fuel and the once-per-turn activation lock are already
// committed by tryActivateHero before this modal opens (see the H25 special case there) — this
// only resolves which candidate joins the hand and advances the escalating next-Craft cost.
let craftPickerRole = null;

function showCraftPickerModal(role) {
  craftPickerRole = role;
  const candidates = generateCraftCandidates().map(c => craftCandidateToCard(c, role));
  const container = document.getElementById('craft-picker-cards');
  container.innerHTML = '';
  candidates.forEach(card => {
    const slot = document.createElement('div');
    slot.className = 'fo-slot';
    slot.appendChild(buildPreviewCardDiv(card));
    const btn = document.createElement('button');
    btn.className = 'fo-pos-btn fo-top';
    btn.textContent = 'CRAFT THIS';
    btn.addEventListener('click', () => confirmCraftPick(card.id));
    slot.appendChild(btn);
    container.appendChild(slot);
  });
  document.getElementById('craft-picker-modal').style.display = 'flex';
}

function confirmCraftPick(chosenId) {
  document.getElementById('craft-picker-modal').style.display = 'none';
  const role = craftPickerRole;
  craftPickerRole = null;
  const ps = state[role];
  const chosen = CARD_BY_ID[chosenId];
  // doc 02 Q024: a full hand sends the generated card to Discard Pile instead.
  // The chosen candidate's full definition also has to ride along in shared state itself
  // (generatedCards) — CARD_BY_ID is per-client, in-memory only, so without this the OTHER
  // client's CARD_BY_ID[chosenId] lookup comes back undefined the moment this card is
  // visible to them (e.g. placed on the board), crashing that client's render.
  const s = {
    ...state,
    [role]: addCardToHand(advanceCraftCost(ps), chosenId),
    generatedCards: { ...(state.generatedCards ?? {}), [chosenId]: chosen },
  };
  const log = [`Chief Aircraft Engineer: Crafted ${chosen.name} (${chosen.n}/${chosen.e}/${chosen.s}/${chosen.w}, ${chosen.keyword}) — next activation costs ${nextCraftCost(s[role])}`];
  commitState(s, log);
}

// ── Rotate direction modal (Change Formation 124 / Field Engineer 91) ──────────
// Both effects rotate a unit 90° but let the player choose the direction (2026-08-17,
// previously a fixed clockwise-only turn). `s`/`log` are the pre-rotation state/log built
// up by the caller (Fuel already deducted); `kind` distinguishes a Command cast (nothing
// further to record) from a Hero Power activation (needs heroesActivatedThisTurn updated).
let pendingRotation = null;

function showRotateDirectionModal(ctx) {
  pendingRotation = ctx;
  document.getElementById('rotate-direction-modal').style.display = 'flex';
}

function confirmRotateDirection(direction) { // direction: 1 = clockwise, -1 = counter-clockwise
  document.getElementById('rotate-direction-modal').style.display = 'none';
  if (!pendingRotation) return;
  const { kind, targetKey, cardName, s, log, role, heroId, objectiveKey } = pendingRotation;
  pendingRotation = null;

  const unit = s.board[targetKey];
  const newRotation = (((unit.rotation || 0) + direction * 90) % 360 + 360) % 360;
  let next = { ...s, board: { ...s.board, [targetKey]: { ...unit, rotation: newRotation } } };
  const unitName = CARD_BY_ID[unit.cardId]?.name ?? 'unit';
  const dirLabel = direction === 1 ? 'clockwise' : 'counter-clockwise';
  const newLog = [...log, `${cardName}: ${unitName} rotated to ${newRotation}° (${dirLabel})`];

  if (kind === 'hero') {
    const activatedBefore = next[role].heroesActivatedThisTurn ?? [];
    next = {
      ...next,
      [role]: {
        ...next[role],
        heroesActivatedThisTurn: activatedBefore.includes(heroId) ? activatedBefore : [...activatedBefore, heroId],
      },
    };
  }

  // Artillery Position L1 (Objective player-choice pick, 2026-09-01) — the Unit was already
  // chosen via a board click (resolveObjectivePickClick); this modal only ever supplies the
  // direction. Continues the paused Objective-resolution chain instead of committing directly.
  if (kind === 'objective') {
    resumeObjectiveResolution(next, role, objectiveKey, newLog);
    return;
  }

  let finalLog = newLog;
  if (kind === 'command') { // C16 Change Formation — a true Command play, so H20 checks here; Hero H11's own rotate never triggers H20 (it's a Hero Active, not a Command)
    const rs = applyRuthlessStrategistIfPresent(next, role);
    next = rs.state;
    finalLog = [...newLog, ...rs.log];
  }
  commitState(next, finalLog);
  checkWin();
}

document.getElementById('rotate-cw-btn').addEventListener('click', () => confirmRotateDirection(1));
document.getElementById('rotate-ccw-btn').addEventListener('click', () => confirmRotateDirection(-1));

// ── Theme toggle ──────────────────────────────────────────────────────────────
// The attribute itself is already set by the inline blocking script at the top of <body>
// (before this deferred module script runs) — this just wires up the button.
(function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.textContent = document.body.dataset.theme === 'light' ? '☀ DARK' : '☾ LIGHT';
  btn.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    document.body.dataset.theme = next;
    localStorage.setItem('signal-theme', next);
    btn.textContent = next === 'light' ? '☀ DARK' : '☾ LIGHT';
  });
})();

// ── Debug Panel ──────────────────────────────────────────────────────────────
let debugTargetPlayer = 'p1';
let debugSelectingUnit = false;
let debugSelectedUnitKey = null;

document.getElementById('debug-toggle').addEventListener('click', () => {
  const panel = document.getElementById('debug-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('debug-close').addEventListener('click', () => {
  document.getElementById('debug-panel').style.display = 'none';
});

document.getElementById('debug-player-p1').addEventListener('click', () => setDebugPlayer('p1'));
document.getElementById('debug-player-p2').addEventListener('click', () => setDebugPlayer('p2'));

function setDebugPlayer(player) {
  debugTargetPlayer = player;
  document.getElementById('debug-player-p1').classList.toggle('active', player === 'p1');
  document.getElementById('debug-player-p2').classList.toggle('active', player === 'p2');
  // Stale results from before the switch would target the wrong player's hand otherwise.
  document.getElementById('debug-card-remove-search').value = '';
  document.getElementById('debug-card-remove-results').innerHTML = '';
}

document.getElementById('debug-card-search').addEventListener('input', e => {
  const query = e.target.value.trim().toLowerCase();
  const results = document.getElementById('debug-card-results');
  results.innerHTML = '';
  if (!query) return;
  const matches = CARDS.filter(c => c.name.toLowerCase().includes(query)).slice(0, 8);
  for (const card of matches) {
    const el = document.createElement('div');
    el.className = 'debug-card-result';
    el.textContent = `${card.name} (${card.id}) — ${card.cls || card.type}`;
    el.addEventListener('click', () => {
      if (!state) return;
      const { state: newState, log } = debugAddCard(state, debugTargetPlayer, card.id);
      commitState(newState, log);
      document.getElementById('debug-card-search').value = '';
      results.innerHTML = '';
    });
    results.appendChild(el);
  }
});

// Sourced from the target player's actual current hand (not the full CARDS list) so nothing
// clickable here can ever be a no-op — the point of the tool is picking something removable.
document.getElementById('debug-card-remove-search').addEventListener('input', e => {
  if (!state) return;
  const query = e.target.value.trim().toLowerCase();
  const results = document.getElementById('debug-card-remove-results');
  results.innerHTML = '';
  if (!query) return;
  const hand = state[debugTargetPlayer].hand;
  const counts = {};
  for (const id of hand) counts[id] = (counts[id] ?? 0) + 1;
  const matches = [...new Set(hand)]
    .map(id => CARD_BY_ID[id])
    .filter(c => c && c.name.toLowerCase().includes(query))
    .slice(0, 8);
  for (const card of matches) {
    const el = document.createElement('div');
    el.className = 'debug-card-result';
    el.textContent = `${card.name} (${card.id}) ×${counts[card.id]}`;
    el.addEventListener('click', () => {
      const { state: newState, log } = debugRemoveCard(state, debugTargetPlayer, card.id);
      commitState(newState, log);
      document.getElementById('debug-card-remove-search').value = '';
      results.innerHTML = '';
    });
    results.appendChild(el);
  }
});

document.getElementById('debug-fuel-set').addEventListener('click', () => {
  if (!state) return;
  const value = Number(document.getElementById('debug-fuel-value').value);
  const { state: newState, log } = debugSetFuel(state, debugTargetPlayer, value);
  commitState(newState, log);
});

document.querySelectorAll('[data-fuel-delta]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!state) return;
    const delta = Number(btn.dataset.fuelDelta);
    const { state: newState, log } = debugAdjustFuel(state, debugTargetPlayer, delta);
    commitState(newState, log);
  });
});

document.getElementById('debug-hq-set').addEventListener('click', () => {
  if (!state) return;
  const value = Number(document.getElementById('debug-hq-value').value);
  const { state: newState, log } = debugSetHQ(state, debugTargetPlayer, value);
  commitState(newState, log);
  checkWin();
});

document.querySelectorAll('[data-hq-delta]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!state) return;
    const delta = Number(btn.dataset.hqDelta);
    const { state: newState, log } = debugAdjustHQ(state, debugTargetPlayer, delta);
    commitState(newState, log);
    checkWin();
  });
});

function populateDebugObjectiveDropdown() {
  if (!state) return;
  const select = document.getElementById('debug-obj-select');
  const prevValue = select.value;
  select.innerHTML = '';
  for (const [key, obj] of Object.entries(state.objectives)) {
    const name = CARD_BY_ID[obj.cardId]?.name ?? '?';
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${name} (${key})`;
    select.appendChild(opt);
  }
  if ([...select.options].some(o => o.value === prevValue)) select.value = prevValue;
}

document.getElementById('debug-obj-apply').addEventListener('click', () => {
  if (!state) return;
  const tileKey = document.getElementById('debug-obj-select').value;
  if (!tileKey) return;
  const controller = document.getElementById('debug-obj-controller').value;
  const level = Number(document.getElementById('debug-obj-level').value);
  const { state: newState, log } = debugSetObjective(state, tileKey, controller, level);
  commitState(newState, log);
});

// Objective cards are static (unlike the tile dropdown above, which tracks live objective
// placement) — populate once rather than refreshing every redraw(). Offers all 8 objective
// cards, not just the 5-ID live random pool (WORKING_OBJECTIVE_IDS) — this tool exists
// specifically so Bridge/Radar Station/Fortification can be manually tested despite being
// excluded from normal match setup.
(function populateDebugObjectiveCardOptions() {
  const select = document.getElementById('debug-obj-card-select');
  for (const c of CARDS.filter(c => c.type === 'objective')) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.id} — ${c.name}`;
    select.appendChild(opt);
  }
})();

document.getElementById('debug-obj-card-apply').addEventListener('click', () => {
  if (!state) return;
  const tileKey = document.getElementById('debug-obj-select').value;
  if (!tileKey) return;
  const cardId = document.getElementById('debug-obj-card-select').value;
  const { state: newState, log } = debugSetObjectiveCard(state, tileKey, cardId);
  commitState(newState, log);
});

document.getElementById('debug-unit-select-btn').addEventListener('click', () => {
  debugSelectingUnit = true;
  debugSelectedUnitKey = null;
  document.getElementById('debug-unit-hint').textContent = 'Click a unit on the board now…';
});

function applyDebugUnitState(newUnitState) {
  if (!state || !debugSelectedUnitKey) {
    appendLog(['[DEBUG] No unit selected — click "Select Unit" first.']);
    return;
  }
  const dyingUnit = state.board[debugSelectedUnitKey];
  const { state: newState, log } = debugSetUnitState(state, debugSelectedUnitKey, newUnitState);
  let finalState = newState;
  let finalLog = log;
  if (newUnitState === 'destroyed' && dyingUnit) {
    const pd = applyPostDestructionEffects(finalState, { unitKey: debugSelectedUnitKey, dyingUnit, sourceUnitKey: null });
    finalState = recalculateDynamicStats(pd.state);
    finalLog = [...log, ...pd.log];
  }
  const debugTransitionFlags = newUnitState !== 'normal'
    ? new Map([[debugSelectedUnitKey, newUnitState]]) // 'suppressed' or 'destroyed'; Reset shouldn't animate
    : new Map();
  commitState(finalState, finalLog, debugTransitionFlags);
  if (newUnitState === 'destroyed') {
    debugSelectedUnitKey = null;
    document.getElementById('debug-unit-hint').textContent = 'Click "Select Unit", then click a unit on the board.';
  }
  checkWin();
}

document.getElementById('debug-unit-suppress').addEventListener('click', () => applyDebugUnitState('suppressed'));
document.getElementById('debug-unit-destroy').addEventListener('click', () => applyDebugUnitState('destroyed'));
document.getElementById('debug-unit-reset').addEventListener('click', () => applyDebugUnitState('normal'));

document.getElementById('debug-unit-buff-apply').addEventListener('click', () => {
  if (!state || !debugSelectedUnitKey) {
    appendLog(['[DEBUG] No unit selected — click "Select Unit" first.']);
    return;
  }
  const value = Number(document.getElementById('debug-unit-buff-value').value) || 0;
  const { state: newState, log } = debugBuffUnit(state, debugSelectedUnitKey, value);
  commitState(newState, log);
});

document.getElementById('debug-draw-go').addEventListener('click', () => {
  if (!state) return;
  const n = Number(document.getElementById('debug-draw-count').value);
  if (n <= 0) return;
  const { state: newState, log } = debugDrawCards(state, debugTargetPlayer, n);
  commitState(newState, log);
  checkWin(); // fatigue (doc 02 Q029-Q030) can now make even a debug draw lethal
});

document.getElementById('debug-turn-go').addEventListener('click', () => {
  if (!state) return;
  const turn = Number(document.getElementById('debug-turn-value').value);
  if (turn < 1) return;
  const { state: newState, log } = debugSkipToTurn(state, turn);
  commitState(newState, log);
});
