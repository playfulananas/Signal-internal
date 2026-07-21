import { CARD_BY_ID, CARDS } from './cards.js?v=1784633047';
import {
  createInitialState,
  startOfTurn,
  endTurn,
  drawCards,
  gainFuel,
  updateObjectiveLevels,
  checkObjectiveControl,
  getKeywords,
  applyHit,
  maxArmorHits,
  getSideValue,
  attackBeats,
  oppositeDir,
} from './state.js?v=1784633047';
import { getAttackableTargets, resolveSingleAttack, tileKey } from './combat.js?v=1784633047';
import { renderBoard, renderHand, renderHQ, appendLog } from './ui.js?v=1784633047';
import { MAPS, getTerrain, canPlaceOnTerrain } from './maps.js?v=1784633047';
import { pushState, subscribeState, setPlayerLeft, updateLobby, subscribeLobby } from './firebase.js?v=1784633047';
import { debugAddCard, debugSetFuel, debugAdjustFuel, debugSetHQ, debugAdjustHQ, debugSetObjective, debugSetUnitState, debugBuffUnit, debugDrawCards, debugSkipToTurn } from './debug.js?v=1784633047';

// ── Starter decks ─────────────────────────────────────────────────────────────
const DECKS = {
  // Bombard + Double Attack: 8 Bombard units, 8 DA units, draw engine, Total Onslaught — 48 AP
  aggro:   { ids: [5,5, 42,42, 40,40, 19,19, 22,22, 10,10, 59,59, 81,81, 4,4, 13,13, 61,61, 52,52, 8,8] },
  // Armor Fortress counter: Heavy Armor/Armor/Guard wall, commands to buff, Fortify mission — 50 AP
  control: { ids: [65,65, 6,6, 36,36, 11,11, 39,39, 63,63, 2,2, 75,75, 74,74, 49,49, 54,54, 16,16, 57,57] },
  // Counter-aggro: Guard wall neutralizes DA, Armor soaks Bombard, full draw engine, Overrun finisher — 40 AP
  counter: { ids: [2,2, 11,11, 36,36, 43,43, 6,6, 69,69, 5,5, 1,1, 34,34, 22,22, 19,19, 73,73, 51,51, 25,25, 81,81] },
  // Steel Column: Armor/Heavy Armor tank wall, Fuel ramp into King Tiger/Heavy Tank, Hold the Line stabilizes — 50 AP
  power:   { ids: [63,63, 66,66, 65,65, 39,39, 6,6, 9,9, 5,5, 55,55, 25,25, 23,23, 76,76, 18,18] },
};

// Bridge (29), Radar Station (30), Fortification (33) excluded — effects not automated yet.
const WORKING_OBJECTIVE_IDS = [26, 27, 28, 31, 32];

function pickObjectives(_mapId) {
  const leftRow = Math.random() < 0.5 ? 1 : 2;
  const rightRow = leftRow === 1 ? 2 : 1;
  const slots = [`${leftRow},0`, `${rightRow},3`];
  const shuffled = [...WORKING_OBJECTIVE_IDS].sort(() => Math.random() - 0.5);
  const objectives = {};
  slots.forEach((slot, i) => {
    objectives[slot] = { cardId: shuffled[i], level: 1 };
  });
  return objectives;
}

// ── Lobby flow ────────────────────────────────────────────────────────────────
let p1DeckIds = null;
let p2DeckIds = null;
let pickerStep = 1;

// Called by P2 once both their deck choice and P1's lobby data are available.
function tryPushP2Ready() {
  if (!p2DeckIds || !p1LobbyData) return;
  const toArr = v => Array.isArray(v) ? v : Object.values(v ?? {});
  pushState(gameId, {
    _phase: 'ready',
    p1Deck: toArr(p1LobbyData.p1Deck),
    mapId:  p1LobbyData.mapId,
    p2Deck: p2DeckIds,
  });
  document.getElementById('waiting-msg').textContent = 'Waiting for host to start the game...';
}

document.getElementById('deck-grid').addEventListener('click', e => {
  const option = e.target.closest('.deck-option');
  if (!option) return;
  const deck = DECKS[option.dataset.deck];
  if (!deck) return;

  if (isOnline && myRole === 'p2') {
    p2DeckIds = [...deck.ids];
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'flex';
    document.getElementById('waiting-msg').textContent = 'Connecting...';
    tryPushP2Ready(); // fires immediately if P1 lobby data already arrived; otherwise waits
    return;
  }

  if (isOnline && myRole === 'p1') {
    p1DeckIds = [...deck.ids];
    document.getElementById('deck-picker').style.display = 'none';
    document.getElementById('map-picker').style.display = '';
    return;
  }

  // Local play: P1 deck → P2 deck → map
  if (pickerStep === 1) {
    p1DeckIds = [...deck.ids];
    pickerStep = 2;
    document.getElementById('picker-label').textContent = 'PLAYER 2 — CHOOSE YOUR DECK';
  } else {
    p2DeckIds = [...deck.ids];
    pickerStep = 3;
    document.getElementById('deck-picker').style.display = 'none';
    document.getElementById('map-picker').style.display = '';
  }
});

document.getElementById('map-grid').addEventListener('click', e => {
  const option = e.target.closest('.deck-option');
  if (!option || !option.dataset.map) return;
  const mapId = option.dataset.map;

  if (isOnline && myRole === 'p1') {
    // Push lobby state to games/${gameId} and wait for P2's ready response
    pushState(gameId, { _phase: 'lobby', p1Deck: p1DeckIds, mapId });
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'flex';
    document.getElementById('waiting-msg').textContent = 'Waiting for Player 2 to choose their deck...';
    subscribeState(gameId, data => {
      if (state) return; // already started
      if (data._phase !== 'ready' || !data.p2Deck) return;
      const toArr = v => Array.isArray(v) ? v : Object.values(v ?? {});
      startGame(toArr(data.p1Deck), toArr(data.p2Deck), data.mapId);
    });
    return;
  }

  startGame(p1DeckIds, p2DeckIds, mapId);
});

// ── Online mode ───────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const isOnline = !!params.get('game');
const gameId   = params.get('game') ?? null;
const myRole   = params.get('role') ?? null; // 'p1' | 'p2' | null for local play
let myLastPushId = null;

// ── Game state ────────────────────────────────────────────────────────────────
let state = null;
let p1LobbyData = null; // P2 stores P1's lobby push until P2 has also picked their deck
let uiState = "idle";
let selectedHandCardId = null;
let pendingAttackerKey = null;
let attackedThisTurn = new Map(); // tileKey → attack count used this turn
let pendingCommandId = null;       // card ID of command awaiting a board target
let preCommandState = null;        // state snapshot before command-targeting started (for cancel)
let pendingRallyCryCount = 0;      // remaining Rally Cry target picks (0 = not active)
let lastChangedKeys = new Set();   // tiles changed by opponent's last move (cleared on own action)
let gameOver = false;

// ── Forward Observer state ─────────────────────────────────────────────────────
let foCards = [];        // 3 cardIds drawn by FO
let foPlayer = '';       // 'p1' or 'p2'
let foAssignments = {};  // cardId → 'keep' | 'top' | 'bottom'

// ── Double Attack tracking ─────────────────────────────────────────────────────
let lastDATargetKey = null; // target of first Double Attack hit — always valid for 2nd hit

// ── Artillery Position targeting ───────────────────────────────────────────────
let pendingArtyHitCount = 0; // hits remaining from Artillery Position L2/L4

// ── Mulligan ─────────────────────────────────────────────────────────────────

let mulliganSelected = new Set();

function applyMulligan(s, role, indices) {
  if (!indices.length) return s;
  const ps = { ...s[role] };
  const putBack = indices.map(i => ps.hand[i]);
  const keep = ps.hand.filter((_, i) => !indices.includes(i));
  const newDeck = [...putBack, ...ps.deck].sort(() => Math.random() - 0.5);
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
    const CLS_ABBR = { Infantry:'INF', Tank:'TNK', Artillery:'ART', Aircraft:'AIR', Commander:'CMD', Naval:'NAV' };
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

// ── Start game ────────────────────────────────────────────────────────────────
function startGame(p1Ids, p2Ids, mapId) {
  let s = createInitialState(p1Ids, p2Ids, mapId);
  s = { ...s, objectives: pickObjectives(mapId) };

  if (isOnline && myRole === 'p1') {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'none';
    showMulligan('YOUR OPENING HAND', s.p1.hand, indices => {
      s = applyMulligan(s, 'p1', indices);
      s = { ...s, p1: drawCards(s.p1, 1) };
      finishStartGame(s, mapId);
    });
    return;
  }

  if (!isOnline) {
    document.getElementById('lobby').style.display = 'none';
    showMulligan('P1 — OPENING HAND', s.p1.hand, indices1 => {
      s = applyMulligan(s, 'p1', indices1);
      s = { ...s, p1: drawCards(s.p1, 1) };
      showMulligan('P2 — OPENING HAND', s.p2.hand, indices2 => {
        s = applyMulligan(s, 'p2', indices2);
        s = { ...s, p2: drawCards(s.p2, 1) };
        finishStartGame(s, mapId);
      });
    });
    return;
  }

  finishStartGame(s, mapId);
}

function finishStartGame(s, mapId) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('waiting-screen').style.display = 'none';
  document.getElementById('game-area').style.display = 'flex';

  state = startOfTurn(s);
  const mapName = MAPS[mapId].name;
  state = { ...state, log: [`Game started on ${mapName} — P1 goes first.`] };
  appendLog(state.log);
  redraw();

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

function redraw() {
  if (!state) return;
  // Debug/testing hook only — read-only snapshot for external tooling (e.g. selfplay bot).
  // No gameplay effect: nothing reads this back into game state.
  window.__SIGNAL_DEBUG__ = { state, uiState, selectedHandCardId, pendingAttackerKey, attackedThisTurn: [...attackedThisTurn.entries()] };
  renderHQ(state);

  if (uiState === "placing") {
    renderBoard(state, null, getValidTiles(), lastChangedKeys, myRole === 'p2' || (myRole === null && state.initiative === 'p2'));
  } else {
    renderBoard(state, null, null, lastChangedKeys, myRole === 'p2' || (myRole === null && state.initiative === 'p2'));
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

  if (uiState === 'arty-targeting') {
    const active = state.initiative;
    for (const [key, unit] of Object.entries(state.board)) {
      if (unit && unit.owner !== active && unit.state !== 'destroyed') {
        const el = document.querySelector(`[data-key="${key}"]`);
        if (el) el.classList.add('targetable');
      }
    }
  }

  const handRole = myRole ?? state.initiative;
  renderHand(state[handRole].hand, 'p1-hand', selectedHandCardId, { tankDiscount: state[handRole].tempFuelDiscount ?? 0 });
  renderMissionsPanel(state);

  const cancelBtn = document.getElementById('btn-cancel');
  if (cancelBtn) {
    const rallyCryAlreadyPicked = pendingCommandId === 51 && pendingRallyCryCount < 2;
    cancelBtn.textContent = rallyCryAlreadyPicked ? 'Done' : 'Cancel';
  }

  const endTurnBtn = document.getElementById('btn-end-turn');
  if (isOnline) {
    const isMyTurn = state.initiative === myRole;
    const round = Math.ceil(state.turn / 2);
    document.getElementById('turn-display').textContent = isMyTurn
      ? `Round ${round} — YOUR TURN`
      : `Round ${round} — WAITING FOR OPPONENT`;
    endTurnBtn.disabled = !isMyTurn;
    endTurnBtn.textContent = isMyTurn ? 'End Turn' : 'Waiting...';
  } else {
    endTurnBtn.disabled = false;
    endTurnBtn.textContent = `End ${state.initiative.toUpperCase()} Turn`;
  }

  populateDebugObjectiveDropdown();
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

function commitState(newState, logLines) {
  lastChangedKeys = new Set(); // player acted — clear opponent highlights
  state = { ...newState, log: [...(newState.log ?? []), ...(logLines ?? [])] };
  if (logLines?.length) appendLog(logLines);
  syncArtyTargetingUiState();
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
  const fixUnit = u => u ? { ...u, tempKeywords: toArray(u.tempKeywords), grantedKeywords: toArray(u.grantedKeywords) } : u;
  const fixBoard = b => {
    if (!b) return {};
    return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, fixUnit(v)]));
  };
  const fixPlayer = p => p ? {
    ...p,
    hand:     toArray(p.hand),
    deck:     toArray(p.deck),
    missions: toArray(p.missions),
  } : p;
  return {
    ...raw,
    log:   toArray(raw.log),
    p1:    fixPlayer(raw.p1),
    p2:    fixPlayer(raw.p2),
    board: fixBoard(raw.board),
  };
}

function receiveRemoteState(remoteState) {
  const normalized = normalizeFirebaseState(remoteState);
  const prevLogLen = state?.log?.length ?? 0;
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
  selectedHandCardId = null;
  pendingAttackerKey = null;
  pendingCommandId = null;
  preCommandState = null;
  attackedThisTurn = new Map();
  lastDATargetKey = null;
  redraw();
  checkWin();
}

function showEndScreen(winner) {
  gameOver = true;
  document.getElementById('end-winner').textContent = `${winner} WINS`;
  document.getElementById('end-screen').style.display = 'flex';
}

function checkWin() {
  if (state.p1.hq <= 0) { showEndScreen('P2'); return true; }
  if (state.p2.hq <= 0) { showEndScreen('P1'); return true; }
  return false;
}

// ── Hand interaction ──────────────────────────────────────────────────────────

document.getElementById('p1-hand').addEventListener('click', e => {
  if (gameOver || !state) return;
  if (isOnline && state.initiative !== myRole) return;
  const cardEl = e.target.closest('.hand-card');
  if (!cardEl) return;
  const cardId = Number(cardEl.dataset.cardId);
  const card = CARD_BY_ID[cardId];
  if (!card) return;

  if (selectedHandCardId === cardId) {
    selectedHandCardId = null;
    uiState = "idle";
    redraw();
    return;
  }

  if (card.type === 'unit') {
    const active = state.initiative;
    // Same discount formula as the placement handler below — selecting the card must use the
    // same effective cost the hand display shows, or a discounted-but-affordable Tank gets
    // rejected here quoting the full undiscounted price.
    const discount = card.cls === 'Tank' ? Math.min(card.cost, state[active].tempFuelDiscount ?? 0) : 0;
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
    if (state[active].fuel < card.cost) {
      appendLog([`Not enough Fuel for ${card.name} (need ${card.cost}, have ${state[active].fuel})`]);
      redraw();
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
  } else {
    const active = state.initiative;
    if (state[active].fuel < card.cost) { appendLog([`Not enough Fuel`]); redraw(); return; }
    playMissionCard(cardId);
    checkWin();
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
    const newS = {
      ...state, board: newBoard, pendingArtyHits: pendingArtyHitCount,
      [defOwner]: { ...state[defOwner], hq: state[defOwner].hq - hqDamage },
    };
    const stateLabel = finalUnit === null ? 'Destroyed' : newUnit.state === 'suppressed' ? 'Suppressed' : 'armor absorbed';
    commitState(newS, [`Artillery Position: ${CARD_BY_ID[unit.cardId]?.name} → ${stateLabel}`]);
    checkWin();
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
      return;
    }
    // Apply Armored Spearhead discount for Tanks
    const discount = card.cls === 'Tank' ? Math.min(card.cost, state[active].tempFuelDiscount ?? 0) : 0;
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
      tempSideBonus: 0,
      justPlaced: true,
    };

    let newState = {
      ...state,
      board: { ...state.board, [clickedKey]: placedUnit },
      [active]: {
        ...state[active],
        fuel: state[active].fuel - effectiveCost,
        hand: handAfter,
        tempFuelDiscount: (state[active].tempFuelDiscount ?? 0) - discount,
      },
    };

    const logLines = [`Placed ${card.name} at ${clickedKey} (${terrain})${discount > 0 ? ` [Armored Spearhead: -${discount} Fuel]` : ''}`];
    state = { ...newState, log: [...(newState.log ?? []), ...logLines] };

    // Check placement-triggered missions (Deep Strike, Encirclement)
    const { state: afterPlaceMissions, log: placeMissionLog } = checkActiveMissions(state, active, {});
    if (placeMissionLog.length > 0) {
      state = { ...afterPlaceMissions, log: [...(afterPlaceMissions.log ?? []), ...placeMissionLog] };
      appendLog(placeMissionLog);
    }

    selectedHandCardId = null;

    const targets = getAttackableTargets(state, clickedKey);
    if (targets.length > 0) {
      uiState = "targeting";
      pendingAttackerKey = clickedKey;
    } else {
      uiState = "idle";
      pendingAttackerKey = null;
    }
    appendLog(logLines);
    redraw();
    checkWin();
    pushStateIfOnline(state);
    return;
  }

  // TARGETING
  if (uiState === "targeting") {
    if (!pendingAttackerKey) return;
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

    const result = resolveSingleAttack(state, pendingAttackerKey, clickedKey);
    const newBoard = applyMutations(state.board, result.boardMutations);

    // Overrun bonus: attacker's Overrun flag adds +1 HQ damage per hit that deals damage
    const attacker = state.initiative;
    let dmgP1 = result.hqDamageToP1;
    let dmgP2 = result.hqDamageToP2;
    const overrunLog = [];
    if (attacker === 'p1' && dmgP2 > 0 && state.p1.overrun) { dmgP2++; overrunLog.push('Overrun: +1 HQ damage'); }
    if (attacker === 'p2' && dmgP1 > 0 && state.p2.overrun) { dmgP1++; overrunLog.push('Overrun: +1 HQ damage'); }

    let newState = {
      ...state,
      board: newBoard,
      p1: { ...state.p1, hq: state.p1.hq - dmgP1 },
      p2: { ...state.p2, hq: state.p2.hq - dmgP2 },
    };

    const attackerKey = pendingAttackerKey;
    const attackerUnit = state.board[attackerKey];
    attackedThisTurn.set(attackerKey, (attackedThisTurn.get(attackerKey) ?? 0) + 1);
    const attackCount = attackedThisTurn.get(attackerKey);
    const isDoubleAttack = getKeywords(attackerUnit).includes('Double Attack');

    // Track first DA hit so second hit can always re-target it
    if (isDoubleAttack && attackCount === 1) lastDATargetKey = clickedKey;
    else if (!isDoubleAttack || attackCount >= 2) lastDATargetKey = null;

    const postAttackTargets = getAttackableTargets({ ...state, board: newBoard }, attackerKey, isDoubleAttack);

    // Kill tracking + mission check
    const wasDestroyed = result.boardMutations.some(m => m.newUnit === null);
    const missionCtx = {};
    if (wasDestroyed) {
      const attackerCls = CARD_BY_ID[attackerUnit.cardId]?.cls;
      missionCtx.aircraftKill = attackerCls === 'Aircraft';
      missionCtx.heavyArmorKill = getKeywords(attackerUnit).includes('Heavy Armor');
      newState = { ...newState, [attacker]: {
        ...newState[attacker],
        killsThisTurn: (newState[attacker].killsThisTurn ?? 0) + 1,
        totalKills: (newState[attacker].totalKills ?? 0) + 1,
      }};
    }
    const { state: afterMissions, log: missionLog } = checkActiveMissions(newState, attacker, missionCtx);
    newState = afterMissions;

    if (isDoubleAttack && attackCount < 2 && postAttackTargets.length > 0) {
      uiState = "targeting";
      pendingAttackerKey = attackerKey;
    } else {
      uiState = "idle";
      pendingAttackerKey = null;
    }

    commitState(newState, [...result.logEntries, ...overrunLog, ...missionLog]);
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

  // IDLE: select a friendly unit to attack
  if (uiState === "idle") {
    const unit = state.board[clickedKey];
    if (!unit) return;
    const active = state.initiative;
    if (unit.owner !== active) return;
    if (unit.state !== "normal") return;
    const maxAttacks = getKeywords(unit).includes('Double Attack') ? 2 : 1;
    if ((attackedThisTurn.get(clickedKey) ?? 0) >= maxAttacks) return;

    const targets = getAttackableTargets(state, clickedKey);
    if (targets.length === 0) {
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
function applyObjectiveEffects(s, player) {
  const log = [];
  const opp = player === 'p1' ? 'p2' : 'p1';
  let artyHits = 0;

  for (const [key, obj] of Object.entries(s.objectives)) {
    if (obj.controller !== player) continue;
    const card = CARD_BY_ID[obj.cardId];
    if (!card) continue;
    const lv = obj.level;
    if (lv === 0) continue;
    const nm = card.name;

    switch (obj.cardId) {
      case 26: { // Factory — fuel; L2 tank discount; L3+ buffs friendly Tanks; L4 HQ damage
        const fuel = lv >= 2 ? 2 : 1;
        s = { ...s, [player]: gainFuel(s[player], fuel, false) };
        log.push(`${nm} L${lv}: +${fuel} Fuel`);
        if (lv === 2) {
          s = { ...s, [player]: { ...s[player], tempFuelDiscount: (s[player].tempFuelDiscount ?? 0) + 1 } };
          log.push(`${nm} L2: next Tank costs 1 less Fuel`);
        }
        if (lv >= 3) {
          const bonus = lv === 4 ? 2 : 1;
          const newBoard = { ...s.board };
          let buffCount = 0;
          for (const [bk, u] of Object.entries(newBoard)) {
            if (!u || u.owner !== player || u.state === 'destroyed') continue;
            if (CARD_BY_ID[u.cardId]?.cls !== 'Tank') continue;
            newBoard[bk] = { ...u, objSideBonus: (u.objSideBonus || 0) + bonus };
            buffCount++;
          }
          if (buffCount > 0) {
            s = { ...s, board: newBoard };
            log.push(`${nm} L${lv}: ${buffCount} Tank(s) +${bonus} all sides (persists)`);
          }
        }
        if (lv === 4) {
          s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } };
          log.push(`${nm} L4: 2 HQ damage to ${opp.toUpperCase()}`);
        }
        break;
      }
      case 27: { // Airfield — L1 aircraft effect (not automated), L2+ HQ damage
        if (lv === 1) { log.push(`${nm} L1: Aircraft placement bonus (not automated)`); break; }
        const dmg = lv === 4 ? 4 : 1;
        s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - dmg } };
        log.push(`${nm} L${lv}: ${dmg} HQ damage to ${opp.toUpperCase()}`);
        if (lv >= 3) { s = { ...s, [player]: drawCards(s[player], 1) }; log.push(`${nm} L${lv}: Draw 1 card`); }
        break;
      }
      case 28: { // Supply Depot — fuel + card draw at L3+, HQ at L4
        const fuel = lv === 1 ? 1 : lv === 2 ? 2 : lv === 3 ? 2 : 3;
        s = { ...s, [player]: gainFuel(s[player], fuel, false) };
        log.push(`${nm} L${lv}: +${fuel} Fuel`);
        if (lv >= 3) { s = { ...s, [player]: drawCards(s[player], 1) }; log.push(`${nm} L${lv}: Draw 1 card`); }
        if (lv === 4) {
          s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } };
          log.push(`${nm} L4: 2 HQ damage to ${opp.toUpperCase()}`);
        }
        break;
      }
      case 29: log.push(`${nm} L${lv}: Return unit to hand (not automated)`); break;
      case 30: log.push(`${nm} L${lv}: Look at opponent's hand (not automated)`); break;
      case 31: { // City — adjacent friendly Infantry gain Guard and/or side bonus
        const adjKeys = getAdjacentKeys(key);
        const newBoard = { ...s.board };
        let count = 0;
        for (const ak of adjKeys) {
          const u = newBoard[ak];
          if (!u || u.owner !== player || u.state === 'destroyed') continue;
          if (CARD_BY_ID[u.cardId]?.cls !== 'Infantry') continue;
          let updated = { ...u };
          if (lv === 1 || lv >= 3) updated.tempKeywords = [...updated.tempKeywords, 'Guard'];
          if (lv >= 2) updated.tempSideBonus = updated.tempSideBonus + (lv === 4 ? 2 : 1);
          newBoard[ak] = updated;
          count++;
        }
        s = { ...s, board: newBoard };
        if (count > 0) log.push(`${nm} L${lv}: ${count} adjacent Infantry buffed`);
        if (lv === 4) { s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } }; log.push(`${nm} L4: 2 HQ damage`); }
        break;
      }
      case 32: { // Artillery Position — HQ damage every level; L2/L4 also deal 1 hit
        const dmg = lv === 1 ? 1 : lv === 2 ? 0 : lv === 3 ? 2 : 3;
        if (dmg > 0) {
          s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - dmg } };
          log.push(`${nm} L${lv}: ${dmg} HQ damage to ${opp.toUpperCase()}`);
        }
        if (lv === 2 || lv === 4) { artyHits++; log.push(`${nm} L${lv}: click an enemy unit to deal 1 hit`); }
        break;
      }
      case 33: { // Fortification — adjacent friendly units gain Armor this turn
        const adjKeys = getAdjacentKeys(key);
        const newBoard = { ...s.board };
        let count = 0;
        for (const ak of adjKeys) {
          const u = newBoard[ak];
          if (!u || u.owner !== player || u.state === 'destroyed') continue;
          let updated = { ...u, tempKeywords: [...u.tempKeywords, 'Armor'] };
          if (lv >= 3) updated.tempSideBonus = updated.tempSideBonus + (lv === 4 ? 2 : 1);
          newBoard[ak] = updated;
          count++;
        }
        s = { ...s, board: newBoard };
        if (count > 0) log.push(`${nm} L${lv}: ${count} adjacent units gain Armor`);
        if (lv === 4) { s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } }; log.push(`${nm} L4: 2 HQ damage`); }
        break;
      }
      default: log.push(`${nm} L${lv}: effect triggered (not automated)`);
    }
  }
  return { state: s, log, pendingArtyHits: artyHits };
}

// ── Instant commands ──────────────────────────────────────────────────────────
// Returns true if handled (instant), false if it needs targeting UI (deferred).
function playInstantCommand(cardId) {
  const active = state.initiative;
  const card = CARD_BY_ID[cardId];

  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);

  let s = {
    ...state,
    [active]: { ...state[active], fuel: state[active].fuel - card.cost, hand: handAfter },
  };
  const log = [];

  switch (cardId) {
    case 22: { // Recon — draw 3
      s = { ...s, [active]: drawCards(s[active], 3) };
      log.push(`${card.name}: Draw 3 cards`);
      break;
    }
    case 76: { // Industrial Surge — +2 Fuel at start of next turn
      s = { ...s, [active]: { ...s[active], pendingFuelGain: s[active].pendingFuelGain + 2 } };
      log.push(`${card.name}: +2 Fuel at start of next turn`);
      break;
    }
    case 80: { // Entrench — all friendly Infantry +2 all sides this turn
      const newBoard = { ...s.board };
      let count = 0;
      for (const [k, u] of Object.entries(newBoard)) {
        if (!u || u.owner !== active || u.state === 'destroyed') continue;
        if (CARD_BY_ID[u.cardId]?.cls !== 'Infantry') continue;
        newBoard[k] = { ...u, tempSideBonus: u.tempSideBonus + 2 };
        count++;
      }
      s = { ...s, board: newBoard };
      log.push(`${card.name}: ${count} Infantry +2 all sides this turn`);
      break;
    }
    case 78: { // Combined Arms Doctrine — remove all Suppression; +2 HQ per unit cleared
      const newBoard = { ...s.board };
      let cleared = 0;
      for (const [k, u] of Object.entries(newBoard)) {
        if (!u || u.state !== 'suppressed') continue;
        newBoard[k] = { ...u, state: 'normal' };
        cleared++;
      }
      const hpGain = cleared * 2;
      s = { ...s, board: newBoard, [active]: { ...s[active], hq: s[active].hq + hpGain } };
      log.push(`${card.name}: ${cleared} unit(s) un-suppressed, +${hpGain} HQ HP`);
      break;
    }
    case 73: { // Overrun — each Suppress/Destroy this turn deals +1 HQ damage
      s = { ...s, [active]: { ...s[active], overrun: true } };
      log.push(`${card.name}: Suppress/Destroy deals +1 HQ damage this turn`);
      break;
    }
    case 75: { // Hold Position — all friendly units adjacent to controlled obj gain Armor
      const newBoard = { ...s.board };
      let count = 0;
      for (const [bk, u] of Object.entries(newBoard)) {
        if (!u || u.owner !== active || u.state === 'destroyed') continue;
        const adjHasObj = getAdjacentKeys(bk).some(k => s.objectives[k]?.controller === active);
        if (!adjHasObj) continue;
        newBoard[bk] = { ...u, grantedKeywords: [...(u.grantedKeywords || []), 'Armor'] };
        count++;
      }
      s = { ...s, board: newBoard };
      log.push(`${card.name}: ${count} unit(s) near controlled objectives gain Armor (until your next turn)`);
      break;
    }
    case 52: { // Forward Observer — draw 3, keep 1, top 1, bottom 1
      const drawn = s[active].deck.slice(0, 3);
      if (drawn.length === 0) {
        log.push(`${card.name}: deck is empty`);
        commitState(s, log);
        return true;
      }
      if (drawn.length < 3) {
        // Fewer than 3 cards left — just draw them all into hand
        s = { ...s, [active]: drawCards(s[active], drawn.length) };
        log.push(`${card.name}: drew ${drawn.length} card(s) (deck nearly empty)`);
        commitState(s, log);
        return true;
      }
      // Full case: draw 3, show modal
      s = { ...s, [active]: { ...s[active], deck: s[active].deck.slice(3) } };
      commitState(s, log);
      showFOModal(drawn, active);
      return true;
    }
    default:
      return false; // targeted or not yet implemented
  }

  commitState(s, log);
  return true;
}

// ── Targeted commands ─────────────────────────────────────────────────────────

// Returns Set of valid board tile keys for a given targeted command.
// Returns empty Set if no valid targets exist, null if command is unknown/not targeted.
function getCommandTargets(commandId) {
  const active = state.initiative;
  const entries = Object.entries(state.board);
  const friendlies = entries.filter(([, u]) => u && u.owner === active && u.state !== 'destroyed');
  const enemies    = entries.filter(([, u]) => u && u.owner !== active && u.state !== 'destroyed');

  switch (commandId) {
    case 16: return new Set(enemies.map(([k]) => k));   // Artillery Barrage — any enemy
    case 20: return new Set(enemies.map(([k]) => k));   // Air Strike — any enemy
    case 79: return new Set(enemies.map(([k]) => k));   // Suppressing Fire — any enemy

    case 17: // Blitzkrieg Order — friendly Tanks
      return new Set(friendlies.filter(([, u]) => CARD_BY_ID[u.cardId]?.cls === 'Tank' && u.state === 'normal').map(([k]) => k));

    case 18: // Field Medic — friendly suppressed
    case 54: // Last Stand — friendly suppressed
      return new Set(friendlies.filter(([, u]) => u.state === 'suppressed').map(([k]) => k));

    case 19: // Tactical Withdrawal — any friendly unit
    case 49: // Smoke Screen — any friendly → gains Guard
    case 51: // Rally Cry — any friendly (up to 2, chained)
      return new Set(friendlies.map(([k]) => k));

    case 50: // Improvised Position — friendly unit with no base keyword
      return new Set(friendlies.filter(([, u]) => !CARD_BY_ID[u.cardId]?.keyword).map(([k]) => k));

    case 74: // Dig In — friendly unit adjacent to a controlled objective
      return new Set(friendlies.filter(([k]) =>
        getAdjacentKeys(k).some(ak => state.objectives[ak]?.controller === active)
      ).map(([k]) => k));

    default: return null; // unknown / not a targeted command
  }
}

// Deduct fuel, remove card from hand, enter command-targeting mode.
// State is updated locally only — no Firebase push until target is chosen (so cancel can restore).
function startCommandTargeting(cardId) {
  const active = state.initiative;
  const card = CARD_BY_ID[cardId];
  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);
  preCommandState = state;
  state = { ...state, [active]: { ...state[active], fuel: state[active].fuel - card.cost, hand: handAfter } };
  pendingCommandId = cardId;
  pendingRallyCryCount = cardId === 51 ? 2 : 0;
  uiState = 'command-targeting';
  appendLog([`${card.name}: choose a target`]);
  redraw();
}

// Apply the effect of a targeted command to the clicked tile.
function applyCommandEffect(commandId, targetKey) {
  const active = state.initiative;
  const opp = active === 'p1' ? 'p2' : 'p1';
  const card = CARD_BY_ID[commandId];
  let s = { ...state };
  const log = [];
  const unit = s.board[targetKey];
  const unitName = CARD_BY_ID[unit?.cardId]?.name ?? '?';

  switch (commandId) {
    case 16: { // Artillery Barrage — deplete armor + suppress enemy
      const depleted = { ...unit, armorHits: maxArmorHits(unit) };
      const suppressed = unit.state === 'normal' ? { ...depleted, state: 'suppressed' } : depleted;
      const hqDmg = unit.state === 'normal' ? 1 : 0;
      s = { ...s, board: { ...s.board, [targetKey]: suppressed },
            [unit.owner]: { ...s[unit.owner], hq: s[unit.owner].hq - hqDmg } };
      log.push(`${card.name}: ${unitName} Armor stripped + Suppressed (${hqDmg} HQ damage)`);
      break;
    }
    case 17: { // Blitzkrieg Order — Tank attacks immediately (enter attack targeting)
      const tankTargets = getAttackableTargets(s, targetKey);
      if (tankTargets.length === 0) {
        log.push(`${card.name}: ${unitName} has no adjacent targets`);
        pendingCommandId = null;
        preCommandState = null;
        uiState = 'idle';
        commitState(s, log);
        return;
      }
      pendingCommandId = null;
      preCommandState = null;
      uiState = 'targeting';
      pendingAttackerKey = targetKey;
      log.push(`${card.name}: ${unitName} may attack immediately`);
      commitState(s, log);
      return; // stay in targeting — don't fall through to idle
    }
    case 18: { // Field Medic — un-suppress
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, state: 'normal' } } };
      log.push(`${card.name}: ${unitName} un-suppressed`);
      break;
    }
    case 19: { // Tactical Withdrawal — return to hand, draw 1
      const handAfter = [...s[active].hand, unit.cardId];
      s = { ...s, board: { ...s.board, [targetKey]: null },
            [active]: drawCards({ ...s[active], hand: handAfter }, 1) };
      log.push(`${card.name}: ${unitName} returned to hand. Draw 1`);
      break;
    }
    case 20: { // Air Strike — 1 hit per friendly Aircraft
      const count = Object.values(s.board).filter(u => u && u.owner === active && u.state !== 'destroyed' && CARD_BY_ID[u.cardId]?.cls === 'Aircraft').length;
      if (count === 0) { log.push(`${card.name}: no friendly Aircraft on board`); break; }
      let tgt = unit; let dmg = 0;
      for (let i = 0; i < count && tgt; i++) {
        const { newUnit, hqDamage } = applyHit(tgt);
        dmg += hqDamage;
        tgt = newUnit?.state === 'destroyed' ? null : newUnit;
      }
      s = { ...s, board: { ...s.board, [targetKey]: tgt },
            [unit.owner]: { ...s[unit.owner], hq: s[unit.owner].hq - dmg } };
      log.push(`${card.name}: ${count} hit(s) on ${unitName} — ${dmg} HQ damage`);
      break;
    }
    case 49: { // Smoke Screen — give Guard until owner's next turn
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedKeywords: [...(unit.grantedKeywords || []), 'Guard'] } } };
      log.push(`${card.name}: ${unitName} gains Guard (until your next turn)`);
      break;
    }
    case 51: { // Rally Cry — +1 all sides for 2 turns (choose up to 2, may stop after 1)
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedSideBonus: (unit.grantedSideBonus || 0) + 1, sideBonusTurns: 2 } } };
      log.push(`${card.name}: ${unitName} +1 all sides (2 turns)`);
      pendingRallyCryCount--;
      if (pendingRallyCryCount > 0) {
        commitState(s, log);
        appendLog([`Rally Cry: choose a second unit (or press Done)`]);
        redraw();
        return; // stay in command-targeting for second pick
      }
      break;
    }
    case 50: { // Improvised Position — give Armor until owner's next turn
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedKeywords: [...(unit.grantedKeywords || []), 'Armor'] } } };
      log.push(`${card.name}: ${unitName} gains Armor (until your next turn)`);
      break;
    }
    case 54: { // Last Stand — un-suppress + give Guard until owner's next turn
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, state: 'normal', grantedKeywords: [...(unit.grantedKeywords || []), 'Guard'] } } };
      log.push(`${card.name}: ${unitName} un-suppressed + gains Guard (until your next turn)`);
      break;
    }
    case 74: { // Dig In — Guard + Armor until owner's next turn
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedKeywords: [...(unit.grantedKeywords || []), 'Guard', 'Armor'] } } };
      log.push(`${card.name}: ${unitName} gains Guard + Armor (until your next turn)`);
      break;
    }
    case 79: { // Suppressing Fire — 1 hit per friendly Infantry
      const count = Object.values(s.board).filter(u => u && u.owner === active && u.state !== 'destroyed' && CARD_BY_ID[u.cardId]?.cls === 'Infantry').length;
      if (count === 0) { log.push(`${card.name}: no friendly Infantry on board`); break; }
      let tgt = unit; let dmg = 0;
      for (let i = 0; i < count && tgt; i++) {
        const { newUnit, hqDamage } = applyHit(tgt);
        dmg += hqDamage;
        tgt = newUnit?.state === 'destroyed' ? null : newUnit;
      }
      s = { ...s, board: { ...s.board, [targetKey]: tgt },
            [unit.owner]: { ...s[unit.owner], hq: s[unit.owner].hq - dmg } };
      log.push(`${card.name}: ${count} hit(s) on ${unitName} — ${dmg} HQ damage`);
      break;
    }
    default: break;
  }

  pendingCommandId = null;
  preCommandState = null;
  uiState = 'idle';
  commitState(s, log);
  checkWin();
}

// ── Missions ──────────────────────────────────────────────────────────────────

function playMissionCard(cardId) {
  const active = state.initiative;
  const card = CARD_BY_ID[cardId];
  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);
  let s = { ...state, [active]: { ...state[active], fuel: state[active].fuel - card.cost, hand: handAfter } };
  const log = [];

  const newMission = {
    cardId,
    ...(cardId === 81 ? { killsAtDeploy: s[active].totalKills ?? 0 } : {}),
  };
  s = { ...s, [active]: { ...s[active], missions: [...s[active].missions, newMission] } };
  log.push(`${card.name}: mission active`);
  const { state: afterCheck, log: checkLog } = checkActiveMissions(s, active, {});
  s = afterCheck;
  log.push(...checkLog);

  commitState(s, log);
}

// Check all active missions for a player. ctx flags: { endOfTurn, aircraftKill, heavyArmorKill }.
function checkActiveMissions(s, player, ctx) {
  const missions = s[player]?.missions;
  if (!missions?.length) return { state: s, log: [] };
  const log = [];
  const remaining = [];

  for (const m of missions) {
    const { met, targetKey } = evalMissionCondition(s, player, m, ctx);
    if (met) {
      const r = applyMissionReward(s, player, m.cardId, targetKey);
      s = r.state;
      log.push(...r.log);
    } else {
      remaining.push(m);
    }
  }
  s = { ...s, [player]: { ...s[player], missions: remaining } };
  return { state: s, log };
}

// mission — the specific ActiveMission instance being checked (not just its cardId), so
// per-copy progress (e.g. Total Onslaught's killsAtDeploy) isn't confused with a second copy's.
function evalMissionCondition(s, player, mission, ctx) {
  const cardId = mission.cardId;
  const opp = player === 'p1' ? 'p2' : 'p1';
  const objs = Object.values(s.objectives ?? {});
  const boardVals = Object.entries(s.board);
  const friendlies = boardVals.filter(([, u]) => u && u.owner === player && u.state !== 'destroyed');
  const enemies    = boardVals.filter(([, u]) => u && u.owner === opp   && u.state !== 'destroyed');

  switch (cardId) {
    case 23: { // Hold the Line: control ALL objectives at end of turn
      if (!ctx.endOfTurn || objs.length === 0) return { met: false };
      return { met: objs.every(o => o.controller === player) };
    }
    case 24: { // Deep Strike: 1 friendly adjacent to 2+ enemies
      for (const [fk] of friendlies) {
        const adjEnemies = getAdjacentKeys(fk).filter(k => s.board[k]?.owner === opp && s.board[k]?.state !== 'destroyed').length;
        if (adjEnemies >= 2) return { met: true };
      }
      return { met: false };
    }
    case 25: // Blitz Assault: 2+ kills this turn
      return { met: (s[player].killsThisTurn ?? 0) >= 2 };
    case 55: { // Armored Spearhead: 2+ friendly Tanks on board simultaneously
      const tankCount = friendlies.filter(([, u]) => CARD_BY_ID[u.cardId]?.cls === 'Tank').length;
      return { met: tankCount >= 2 };
    }
    case 56: // Total Air Superiority: kill with Aircraft
      return { met: !!ctx.aircraftKill };
    case 57: { // Fortify the Line: control 2+ objectives at end of turn
      if (!ctx.endOfTurn) return { met: false };
      return { met: objs.filter(o => o.controller === player).length >= 2 };
    }
    case 58: { // Encirclement: an enemy has 2+ friendly units adjacent
      for (const [ek] of enemies) {
        const adjFriendly = getAdjacentKeys(ek).filter(k => s.board[k]?.owner === player && s.board[k]?.state !== 'destroyed').length;
        if (adjFriendly >= 2) return { met: true, targetKey: ek };
      }
      return { met: false };
    }
    case 81: // Total Onslaught: 3+ kills since this copy was deployed
      return { met: (s[player].totalKills ?? 0) - (mission.killsAtDeploy ?? 0) >= 3 };
    case 84: // Overwhelming Force: kill with Heavy Armor
      return { met: !!ctx.heavyArmorKill };
    default: return { met: false };
  }
}

function applyMissionReward(s, player, cardId, targetKey) {
  const opp = player === 'p1' ? 'p2' : 'p1';
  const log = [];
  const nm = CARD_BY_ID[cardId]?.name ?? '?';

  switch (cardId) {
    case 23: // Hold the Line: +5 HQ (capped at 25)
      s = { ...s, [player]: { ...s[player], hq: Math.min(s[player].hq + 5, 25) } };
      log.push(`${nm}: COMPLETE — +5 HQ HP`);
      break;
    case 24: // Deep Strike: 2 HQ damage
      s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } };
      log.push(`${nm}: COMPLETE — 2 HQ damage to ${opp.toUpperCase()}`);
      break;
    case 55: // Armored Spearhead: next Tank costs 2 less Fuel
      s = { ...s, [player]: { ...s[player], tempFuelDiscount: (s[player].tempFuelDiscount ?? 0) + 2 } };
      log.push(`${nm}: COMPLETE — next Tank costs 2 less Fuel`);
      break;
    case 25: { // Blitz Assault: draw 2 + 1 Fuel
      s = { ...s, [player]: drawCards(gainFuel(s[player], 1, false), 2) };
      log.push(`${nm}: COMPLETE — Draw 2, +1 Fuel`);
      break;
    }
    case 56: // Total Air Superiority: 2 HQ damage
      s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } };
      log.push(`${nm}: COMPLETE — 2 HQ damage to ${opp.toUpperCase()}`);
      break;
    case 57: { // Fortify the Line: un-suppress 1 unit + Armor (auto: first found)
      const newBoard = { ...s.board };
      const entry = Object.entries(newBoard).find(([, u]) => u && u.owner === player && u.state === 'suppressed');
      if (entry) {
        const [sk, su] = entry;
        newBoard[sk] = { ...su, state: 'normal', grantedKeywords: [...(su.grantedKeywords || []), 'Armor'] };
        s = { ...s, board: newBoard };
        log.push(`${nm}: COMPLETE — ${CARD_BY_ID[su.cardId]?.name} un-suppressed + Armor`);
      } else {
        log.push(`${nm}: COMPLETE — (no suppressed unit to heal)`);
      }
      break;
    }
    case 58: { // Encirclement: 1 hit to surrounded enemy
      const target = s.board[targetKey];
      if (target) {
        const { newUnit, hqDamage } = applyHit(target);
        const final = newUnit?.state === 'destroyed' ? null : newUnit;
        s = { ...s, board: { ...s.board, [targetKey]: final }, [opp]: { ...s[opp], hq: s[opp].hq - hqDamage } };
        log.push(`${nm}: COMPLETE — 1 hit on ${CARD_BY_ID[target.cardId]?.name} (${hqDamage} HQ dmg)`);
      } else {
        log.push(`${nm}: COMPLETE`);
      }
      break;
    }
    case 81: // Total Onslaught: 2 HQ damage
      s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } };
      log.push(`${nm}: COMPLETE — 2 HQ damage to ${opp.toUpperCase()}`);
      break;
    case 84: // Overwhelming Force: 2 HQ damage
      s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } };
      log.push(`${nm}: COMPLETE — 2 HQ damage to ${opp.toUpperCase()}`);
      break;
    default: break;
  }
  return { state: s, log };
}

// ── End Turn ──────────────────────────────────────────────────────────────────

document.getElementById('btn-end-turn').addEventListener('click', () => {
  if (gameOver || !state) return;
  if (isOnline && state.initiative !== myRole) return;

  const currentPlayer = state.initiative;

  // Check end-of-turn missions before swapping (board/objective state is intact)
  const { state: afterEndMissions, log: endMissionLog } = checkActiveMissions(state, currentPlayer, { endOfTurn: true });
  let s = afterEndMissions;

  // Reset killsThisTurn for the player who just ended
  s = { ...s, [currentPlayer]: { ...s[currentPlayer], killsThisTurn: 0 } };

  let newState = endTurn(s);                             // swap initiative, increment turn
  const newActive = newState.initiative;
  if (newState.turn > 2) {                               // skip P2's first turn — they start with 5 already
    newState = { ...newState, [newActive]: drawCards(newState[newActive], 1) };
  }
  newState = startOfTurn(newState);                      // gain fuel for new active player
  newState = updateObjectiveLevels(newState);            // escalate objective levels
  newState = checkObjectiveControl(newState);            // check majority-adjacent control

  // Supply Runner ability: at start of turn, if on a controlled objective → +1 Fuel
  const supplyLog = [];
  for (const [bk, u] of Object.entries(newState.board)) {
    if (!u || u.owner !== newActive || u.state === 'destroyed') continue;
    if (CARD_BY_ID[u.cardId]?.id !== 5) continue;
    if (getAdjacentKeys(bk).some(k => newState.objectives[k]?.controller === newActive)) {
      newState = { ...newState, [newActive]: gainFuel(newState[newActive], 1, false) };
      supplyLog.push(`Supply Runner: controlled objective → +1 Fuel`);
    }
  }

  // Quartermaster ability: at start of turn, if you control both objectives on the map → draw 1
  for (const [bk, u] of Object.entries(newState.board)) {
    if (!u || u.owner !== newActive || u.state === 'destroyed') continue;
    if (CARD_BY_ID[u.cardId]?.id !== 69) continue;
    const objs = Object.values(newState.objectives);
    const controlsBoth = objs.length > 0 && objs.every(o => o.controller === newActive);
    if (controlsBoth) {
      newState = { ...newState, [newActive]: drawCards(newState[newActive], 1) };
      supplyLog.push(`Quartermaster: controls both objectives → draw 1`);
    }
  }

  const { state: afterEffects, log: effectLog, pendingArtyHits } = applyObjectiveEffects(newState, newActive);
  // Synced onto state (not just a local variable) so the controlling player's own client — not just
  // whoever clicked End Turn — knows to enter arty-targeting mode. See syncArtyTargetingUiState().
  newState = { ...afterEffects, pendingArtyHits };

  attackedThisTurn = new Map();
  lastDATargetKey = null;
  uiState = 'idle';
  selectedHandCardId = null;
  pendingAttackerKey = null;
  pendingCommandId = null;

  const newRound = Math.ceil(newState.turn / 2);
  const turnLog = [...endMissionLog, `--- Round ${newRound} — ${newState.initiative.toUpperCase()} ---`, ...supplyLog, ...effectLog];
  commitState(newState, turnLog);
  checkWin();
});

// ── Cancel ────────────────────────────────────────────────────────────────────

document.getElementById('btn-cancel').addEventListener('click', () => {
  // Rally Cry: once the first unit is picked and committed, "Cancel" during the second
  // pick means "stop here" (keep the first pick) — not a full revert of the cast.
  const rallyCryAlreadyPicked = pendingCommandId === 51 && pendingRallyCryCount < 2;
  if (preCommandState && !rallyCryAlreadyPicked) {
    state = preCommandState;
    preCommandState = null;
  }
  uiState = "idle";
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
  document.getElementById('cp-badge').textContent = `${card.cost} Fuel · ${card.cls || card.type}`;
  document.getElementById('cp-badge').className = 'cp-badge';
  if (card.type === 'unit') {
    document.getElementById('cp-dirs').innerHTML =
      `<div class="cp-dir-row"><span class="cp-dl">N</span><span class="cp-dv">${card.n}</span></div>` +
      `<div class="cp-dir-row"><span class="cp-dl">E</span><span class="cp-dv">${card.e}</span></div>` +
      `<div class="cp-dir-row"><span class="cp-dl">S</span><span class="cp-dv">${card.s}</span></div>` +
      `<div class="cp-dir-row"><span class="cp-dl">W</span><span class="cp-dv">${card.w}</span></div>`;
    const kws = card.keyword ? (Array.isArray(card.keyword) ? card.keyword : [card.keyword]) : [];
    document.getElementById('cp-keyword').innerHTML = kws.map(k => `<span class="cp-kw-tag">${k}</span>`).join('');
    document.getElementById('cp-effect').textContent = card.ability || '';
  } else {
    document.getElementById('cp-dirs').innerHTML = '';
    document.getElementById('cp-keyword').innerHTML = '';
    document.getElementById('cp-effect').textContent = card.effect || card.req || '';
  }
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
  document.getElementById('cp-effect').textContent = outcome;
  document.getElementById('card-preview').style.display = 'flex';
  document.getElementById('preview-hint').style.display = 'none';
}

function hideCardPreview() {
  document.getElementById('card-preview').style.display = 'none';
  document.getElementById('preview-hint').style.display = 'block';
}

// ── Missions side panel ───────────────────────────────────────────────────────

function getMissionCounter(s, role, mission) {
  switch (mission.cardId) {
    case 25: return `Kills this turn: ${s[role].killsThisTurn ?? 0} / 2`;
    case 81: {
      const killsSince = (s[role].totalKills ?? 0) - (mission.killsAtDeploy ?? 0);
      return `Kills since deploy: ${killsSince} / 3`;
    }
    case 56: return 'Kill with Aircraft to complete';
    case 84: return 'Kill with Heavy Armor to complete';
    default: return null;
  }
}

function renderMissionsForPlayer(s, role) {
  return (s[role]?.missions ?? []).map(m => {
    const card = CARD_BY_ID[m.cardId];
    if (!card) return '';
    const counter = getMissionCounter(s, role, m);
    return `<div class="mission-detail ${role}">
      <div class="md-player-badge ${role}">${role.toUpperCase()}</div>
      <div class="md-name">${card.name}</div>
      ${counter ? `<div class="md-counter">${counter}</div>` : ''}
      <div class="md-label">CONDITION</div>
      <div class="md-req">${card.req || '—'}</div>
      <div class="md-label">REWARD</div>
      <div class="md-reward">${card.reward || card.effect || '—'}</div>
    </div>`;
  }).join('');
}

// Shows BOTH players' active missions at once (missions aren't hidden information in this
// design — unlike hand cards), each tagged with a player-colored badge + left border so they
// stay visually distinguishable in one shared list.
function renderMissionsPanel(s) {
  const panel = document.getElementById('missions-side');
  if (!panel) return;
  const html = renderMissionsForPlayer(s, 'p1') + renderMissionsForPlayer(s, 'p2');
  panel.innerHTML = html || '<div class="missions-empty">No active<br>missions</div>';
}

// Hand hover → card preview
document.getElementById('p1-hand').addEventListener('mouseover', e => {
  const cardEl = e.target.closest('.hand-card');
  if (cardEl) showCardPreview(Number(cardEl.dataset.cardId));
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
  if (unit && unit.state !== 'destroyed') showCardPreview(unit.cardId);
});
document.getElementById('board').addEventListener('mouseleave', hideCardPreview);

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (gameOver || !state) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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
      tryPushP2Ready(); // fires if P2 already picked; otherwise waits
    } else if (data.turn !== undefined && !data._phase) {
      if (!state) {
        // First game state arrival — show P2 mulligan before entering game
        const normalized = normalizeFirebaseState(data);
        document.getElementById('waiting-screen').style.display = 'none';
        showMulligan('YOUR OPENING HAND', normalized.p2.hand, indices => {
          state = applyMulligan(normalized, 'p2', indices);
          state = { ...state, p2: drawCards(state.p2, 1) };
          document.getElementById('game-area').style.display = 'flex';
          appendLog(state.log ?? []);
          redraw();
          if (indices.length > 0) pushStateIfOnline(state); // sync mulliganed hand to Firebase
        });
        return;
      }
      // Ongoing updates
      if (data._pushId !== myLastPushId) {
        receiveRemoteState(data);
      }
    }
  });
}

// ── Forward Observer modal ────────────────────────────────────────────────────

function showFOModal(drawn, player) {
  foCards = drawn;
  foPlayer = player;
  foAssignments = {};

  const container = document.getElementById('fo-cards');
  container.innerHTML = '';

  drawn.forEach((cardId, i) => {
    const card = CARD_BY_ID[cardId];
    const slot = document.createElement('div');
    slot.className = 'fo-slot';

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

    slot.appendChild(cardDiv);
    slot.appendChild(btnGroup);
    container.appendChild(slot);
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
  const bottomId = foCards.find(id => foAssignments[id] === 'bottom');
  const ps = state[foPlayer];
  const s = { ...state, [foPlayer]: { ...ps, hand: [...ps.hand, keepId], deck: [topId, ...ps.deck, bottomId] } };
  const keepName   = CARD_BY_ID[keepId]?.name   ?? '?';
  const topName    = CARD_BY_ID[topId]?.name    ?? '?';
  const bottomName = CARD_BY_ID[bottomId]?.name ?? '?';
  commitState(s, [`Forward Observer: kept ${keepName} · ${topName} → top · ${bottomName} → bottom`]);
  foCards = [];
  foAssignments = {};
}

document.getElementById('fo-confirm').addEventListener('click', confirmFO);

// ── Theme toggle ──────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('signal-theme');
  if (saved === 'light') document.body.dataset.theme = 'light';
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
  const { state: newState, log } = debugSetUnitState(state, debugSelectedUnitKey, newUnitState);
  commitState(newState, log);
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
});

document.getElementById('debug-turn-go').addEventListener('click', () => {
  if (!state) return;
  const turn = Number(document.getElementById('debug-turn-value').value);
  if (turn < 1) return;
  const { state: newState, log } = debugSkipToTurn(state, turn);
  commitState(newState, log);
});
