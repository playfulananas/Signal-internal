import { CARD_BY_ID, CARDS } from './cards.js?v=1786538986';
import {
  createInitialState,
  startOfTurn,
  endTurn,
  drawCards,
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
} from './state.js?v=1786538986';
import { getAttackableTargets, resolveSingleAttack, tileKey, unitsInColumn, checkHeroPassivesOnPlace, removeSuppression, checkUnitOnPlayAbility } from './combat.js?v=1786538986';
import { renderBoard, renderHand, renderHQ, appendLog, heroCardHtml, renderHeroZones } from './ui.js?v=1786538986';
import { MAPS, getTerrain, canPlaceOnTerrain } from './maps.js?v=1786538986';
import { pushState, subscribeState, setPlayerLeft, updateLobby, subscribeLobby } from './firebase.js?v=1786538986';
import { debugAddCard, debugSetFuel, debugAdjustFuel, debugSetHQ, debugAdjustHQ, debugSetObjective, debugSetUnitState, debugBuffUnit, debugDrawCards, debugSkipToTurn } from './debug.js?v=1786538986';
import { STARTER_DECKS, loadCustomDecks, validateDeck } from './decks.js?v=1786538986';
import { runBotTurn } from './bot_player.js?v=1786538986';

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
    if (v.valid) {
      // Custom decks have no Hero roster yet — the deck-builder picker is a later stage.
      deckChoices.push({ ids: d.ids, heroIds: d.heroIds ?? [] });
      grid.insertAdjacentHTML('beforeend',
        `<div class="deck-option" data-choice="${deckChoices.length - 1}">
          <div class="deck-name">${escapeHtml(d.name)}</div>
          <div class="deck-flavor">Custom deck</div>
          <div class="deck-ap">${d.ids.length} cards</div>
        </div>`);
    } else {
      grid.insertAdjacentHTML('beforeend',
        `<div class="deck-option deck-invalid" title="${escapeHtml(v.errors.join(' '))}">
          <div class="deck-name">${escapeHtml(d.name)}</div>
          <div class="deck-flavor">INVALID — ${escapeHtml(v.errors[0])} Fix it in the Deck Builder.</div>
          <div class="deck-ap">${d.ids.length} cards</div>
        </div>`);
    }
  }
}

renderDeckGrid();
document.getElementById('btn-open-builder').addEventListener('click', () => {
  window.location.href = 'deckbuilder.html';
});

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
  });
  document.getElementById('waiting-msg').textContent = 'Waiting for host to start the game...';
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
    tryPushP2Ready(); // fires immediately if P1 lobby data already arrived; otherwise waits
    return;
  }

  if (isOnline && myRole === 'p1') {
    p1DeckIds = [...ids];
    p1HeroIds = [...heroIds];
    document.getElementById('deck-picker').style.display = 'none';
    if (urlMapId) { beginHostWait(urlMapId); return; }
    document.getElementById('map-picker').style.display = '';
    return;
  }

  // Local play: P1 deck → P2 deck → map. In AI mode, P2's deck is auto-assigned — no second picker step.
  if (pickerStep === 1) {
    p1DeckIds = [...ids];
    p1HeroIds = [...heroIds];
    if (isAiMode) {
      const botDeck = STARTER_DECKS[Math.floor(Math.random() * STARTER_DECKS.length)];
      p2DeckIds = [...botDeck.ids];
      p2HeroIds = [...(botDeck.heroIds ?? [])];
      pickerStep = 3;
      document.getElementById('deck-picker').style.display = 'none';
      document.getElementById('map-picker').style.display = '';
    } else {
      pickerStep = 2;
      document.getElementById('picker-label').textContent = 'PLAYER 2 — CHOOSE YOUR DECK';
    }
  } else {
    p2DeckIds = [...ids];
    p2HeroIds = [...heroIds];
    pickerStep = 3;
    document.getElementById('deck-picker').style.display = 'none';
    document.getElementById('map-picker').style.display = '';
  }
});

// Pushes P1's lobby state (deck + map) and waits for P2 to finish picking
// their deck. Used both by the map-picker (legacy code-share flow, where the
// host picks the map here) and directly from the deck-grid handler when the
// map was already fixed by the open-lobby browser (urlMapId is set).
function beginHostWait(mapId) {
  pushState(gameId, { _phase: 'lobby', p1Deck: p1DeckIds, p1Heroes: p1HeroIds, mapId });
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('waiting-screen').style.display = 'flex';
  document.getElementById('waiting-msg').textContent = 'Waiting for Player 2 to choose their deck...';
  subscribeState(gameId, data => {
    if (state) return; // already started
    if (data._phase !== 'ready' || !data.p2Deck) return;
    const toArr = v => Array.isArray(v) ? v : Object.values(v ?? {});
    const p1Deck = toArr(data.p1Deck);
    const p2Deck = toArr(data.p2Deck);
    // games/{gameId} is world-writable, so both decks are re-validated here even
    // though the deck-picker UI only ever offers valid decks — this is the one
    // place an untrusted client (or tampered Firebase data) could otherwise slip
    // an invalid deck into a match.
    const p1Check = validateDeck(p1Deck);
    const p2Check = validateDeck(p2Deck);
    if (!p1Check.valid || !p2Check.valid) {
      const who = !p1Check.valid ? 'Your own' : "Player 2's";
      const reason = !p1Check.valid ? p1Check.errors[0] : p2Check.errors[0];
      document.getElementById('waiting-msg').textContent = `${who} deck failed validation (${reason}) — refusing to start.`;
      return; // stay on the waiting screen rather than start a broken match
    }
    startGame(p1Deck, p2Deck, data.mapId, toArr(data.p1Heroes), toArr(data.p2Heroes));
  });
}

document.getElementById('map-grid').addEventListener('click', e => {
  const option = e.target.closest('.deck-option');
  if (!option || !option.dataset.map) return;

  if (isOnline && myRole === 'p1') { beginHostWait(option.dataset.map); return; }

  startGame(p1DeckIds, p2DeckIds, option.dataset.map, p1HeroIds, p2HeroIds);
});

// ── Online mode ───────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const isOnline = !!params.get('game');
const gameId   = params.get('game') ?? null;
const myRole   = params.get('role') ?? null; // 'p1' | 'p2' | null for local play
const isAiMode = params.get('ai') === '1';
const urlMapId = params.get('mapId') ?? null; // set when this game came from the open-lobby browser — the map was already chosen there, so skip the map-picker
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
      picked = Number(node.dataset.heroId);
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
  if (!roster.length || !hasFreeZone) { commitState(noteLevel(state), []); return; }

  const isFirstHero = (ps.heroZones ?? []).every(z => z == null);

  const finish = (heroId, col) => {
    let s = noteLevel(state);
    // A reinforcement consumes this turn's Hero Phase action — no reposition on top.
    // Doc 02 §6: a Hero reinforced this turn can't use its Activated Power until this
    // player's next turn — heroArrivalLock is cleared in startOfTurn.
    const deployed = deployHero(s[role], heroId, col);
    s = { ...s, [role]: {
      ...deployed,
      heroRepositioned: true,
      heroArrivalLock: [...(deployed.heroArrivalLock ?? []), col],
    } };
    const verb = isFirstHero ? 'deploys' : 'reinforces';
    commitState(s, [`${role.toUpperCase()} ${verb}: ${CARD_BY_ID[heroId]?.name} → column ${col + 1}`]);
  };

  if (isAiMode && role === 'p2') {
    finish(roster[0], (ps.heroZones ?? []).findIndex(z => z == null));
    return;
  }

  showHeroDeploy(`${role.toUpperCase()} — ${isFirstHero ? 'FIRST HERO' : 'REINFORCEMENT'}`,
    isFirstHero
      ? 'Round 2 — deploy your first Hero.'
      : 'Objective level rose — deploy another Hero.',
    roster, ps.heroZones, finish);
}

// ── Start game ────────────────────────────────────────────────────────────────
// Heroes are no longer picked before the match — the first one deploys at round 2
// (Objective Level 1) via runHeroPhase, same mechanism as every later reinforcement.
// See lastObjLevel: 0 in state.js and the timing note on runHeroPhase.
function startGame(p1Ids, p2Ids, mapId, p1Heroes = [], p2Heroes = []) {
  let s = createInitialState(p1Ids, p2Ids, mapId, p1Heroes, p2Heroes);
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
      if (isAiMode) {
        s = { ...s, p2: drawCards(s.p2, 1) }; // bot keeps its opening hand
        finishStartGame(s, mapId);
      } else {
        showMulligan('P2 — OPENING HAND', s.p2.hand, indices2 => {
          s = applyMulligan(s, 'p2', indices2);
          s = { ...s, p2: drawCards(s.p2, 1) };
          finishStartGame(s, mapId);
        });
      }
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
  // (board-row's width already depends on board-area's current width). window.innerWidth
  // is the true budget: body/.game-layout carry no horizontal padding.
  const availableWidth = window.innerWidth - sideWidths - 24; // small safety margin

  // Reserve exactly what the hand needs right now. bottomRow.scrollHeight looked circular
  // on a first attempt (game-layout/bottom-row stretch to their widest child, which used to
  // be board-row's OWN width — i.e. what this function was computing), but availableWidth
  // above is derived from window.innerWidth, not from board-row's current rendered width,
  // so that circularity doesn't actually exist: the hand's wrap width — and therefore its
  // wrapped height — never depends on the board's scale. A FIXED reserve (tried first) broke
  // on any hand that wraps past one row (12+ cards after several turns of draw effects):
  // the board claimed more height than was actually free, and the hand scrolled off-screen
  // instead of just needing its own scrollbar.
  const bottomRow = document.querySelector('.bottom-row');
  const layout = document.querySelector('.game-layout');
  const layoutStyle = layout ? getComputedStyle(layout) : null;
  const layoutGap = layoutStyle ? (parseFloat(layoutStyle.gap) || 0) : 8;
  const layoutPadV = layoutStyle ? (parseFloat(layoutStyle.paddingTop) || 0) + (parseFloat(layoutStyle.paddingBottom) || 0) : 20;
  const reservedBottom = Math.max(bottomRow?.scrollHeight ?? 0, 170);
  const availableHeight = window.innerHeight - reservedBottom - layoutGap - layoutPadV;

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
  // Pinning the row's height to the board's own computed height makes board-area the single
  // source of truth and lets the other columns' own overflow rules do their job.
  boardRow.style.height = `${naturalH * scale}px`;
}
window.addEventListener('resize', fitBoardArea);

function redraw() {
  if (!state) return;
  // Debug/testing hook only — read-only snapshot for external tooling (e.g. selfplay bot).
  // No gameplay effect: nothing reads this back into game state.
  window.__SIGNAL_DEBUG__ = { state, uiState, selectedHandCardId, pendingAttackerKey, attackedThisTurn: [...attackedThisTurn.entries()] };
  renderHQ(state);

  if (uiState === "placing") {
    renderBoard(state, null, getValidTiles(), lastChangedKeys);
  } else {
    renderBoard(state, null, null, lastChangedKeys);
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
  renderHand(state[handRole].hand, 'p1-hand', selectedHandCardId, { playerState: state[handRole] });
  renderHeroZones(state, selectedHeroZone);

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
    heroArrivalLock: toArray(p.heroArrivalLock),
    heroesActivatedEver: toArray(p.heroesActivatedEver),
    pendingDiscounts: toArray(p.pendingDiscounts),
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
  selectedHeroZone = null;
  pendingHeroId = null;
  pendingHeroColumn = null;
  pendingHeroTargets = null;
  pendingHalftrackMove = null;
  redraw();
  checkWin();
  // The opponent's End Turn handler can't prompt us, so an inbound state that hands us the
  // turn is where this client runs its own Hero Phase. runHeroPhase re-checks lastObjLevel,
  // so arriving at the same state twice can't double-deploy.
  if (isOnline && !gameOver && normalized.initiative === myRole) runHeroPhase(myRole);
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

// ── Hero powers ───────────────────────────────────────────────────────────────
// Tile keys a column-scoped active power can legally target. null = no target needed
// (an instant), [] = needs a target but none exists right now.
function heroTargetKeys(s, role, col, hero) {
  switch (hero.id) {
    case 92: // Tactical Commander — any friendly unit in the column
      return unitsInColumn(s, col, role).map(u => u.key);
    case 99: // Garrison Commander — friendly unit on or adjacent to an Objective
      return unitsInColumn(s, col, role)
        .filter(({ key }) => s.objectives[key] || getAdjacentKeys(key).some(k => s.objectives[k]))
        .map(u => u.key);
    case 100: // Recovery Officer — only a suppressed friendly unit is worth targeting
      return unitsInColumn(s, col, role).filter(({ unit }) => unit.state === 'suppressed').map(u => u.key);
    default:
      return null;
  }
}

// Applies an activated Hero Power. `s` must already have the Fuel deducted.
function applyHeroPower(s, role, col, hero, targetKey) {
  const log = [];
  const nameOf = key => CARD_BY_ID[s.board[key]?.cardId]?.name ?? 'unit';

  switch (hero.id) {
    case 87: // Quartermaster General — draw 1
      s = { ...s, [role]: drawCards(s[role], 1) };
      log.push(`${hero.name}: draw 1 card`);
      break;

    case 103: // Armored Commander — next Tank in THIS column costs 2 less, min 1
      s = { ...s, [role]: addDiscount(s[role], { appliesTo: 'Tank', column: col, amount: 2, min: 1 }) };
      log.push(`${hero.name}: next Tank in column ${col + 1} costs 2 less Fuel (min 1)`);
      break;

    case 107: // Command Specialist — next Command costs 2 less, min 1 (board-wide)
      s = { ...s, [role]: addDiscount(s[role], { appliesTo: 'command', column: null, amount: 2, min: 1 }) };
      log.push(`${hero.name}: next Command costs 2 less Fuel (min 1)`);
      break;

    case 92: { // Tactical Commander — +1 all sides this turn
      const u = s.board[targetKey];
      log.push(`${hero.name}: ${nameOf(targetKey)} +1 all sides this turn`);
      s = { ...s, board: { ...s.board, [targetKey]: { ...u, tempSideBonus: (u.tempSideBonus || 0) + 1 } } };
      break;
    }

    case 99: { // Garrison Commander — Guard until your next turn
      const u = s.board[targetKey];
      log.push(`${hero.name}: ${nameOf(targetKey)} gains Guard (until your next turn)`);
      s = { ...s, board: { ...s.board, [targetKey]: { ...u, grantedKeywords: [...(u.grantedKeywords || []), 'Guard'] } } };
      break;
    }

    case 100: { // Recovery Officer — remove Suppression
      log.push(`${hero.name}: ${nameOf(targetKey)} un-suppressed`);
      const result = removeSuppression(s, targetKey);
      s = result.state;
      log.push(...result.log);
      break;
    }

    default:
      log.push(`${hero.name}: power not automated yet`);
  }

  const everBefore = s[role].heroesActivatedEver ?? [];
  return {
    state: {
      ...s,
      [role]: {
        ...s[role],
        heroActivated: true,
        heroActivatedId: hero.id,
        heroesActivatedEver: everBefore.includes(hero.id) ? everBefore : [...everBefore, hero.id],
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
  // Coordinated Orders (126) lets ONE extra activation through the normal once-per-turn
  // lock, but only for a different Hero than whichever already activated this turn.
  const usingExtra = ps.heroActivated && ps.extraHeroActivation && heroId !== ps.heroActivatedId;
  if (ps.heroActivated && !usingExtra) { appendLog(['Hero Power already used this turn']); return true; }
  if ((ps.heroArrivalLock ?? []).includes(col)) {
    appendLog([`${hero.name}: just reinforced — no Hero Power until your next turn`]);
    return true;
  }

  // Priority Orders (121) discounts, Radio Interference (123) taxes — both apply once,
  // to this one activation, then clear. min 0 per Priority Orders' own wording.
  const discount = ps.pendingHeroDiscount ?? 0;
  const tax = (ps.heroTaxedColumns ?? {})[col] ?? 0;
  const cost = Math.max(0, (hero.activeCost ?? 0) - discount + tax);
  if (ps.fuel < cost) {
    appendLog([`Not enough Fuel for ${hero.name} (need ${cost}, have ${ps.fuel})`]);
    return true;
  }
  const costModLog = [];
  if (discount > 0) costModLog.push(`Priority Orders: -${discount}F`);
  if (tax > 0) costModLog.push(`Radio Interference: +${tax}F`);
  if (usingExtra) costModLog.push(`Coordinated Orders: extra Hero Power activation`);
  const spendCostMods = playerState => {
    const { [col]: _taxed, ...restTaxed } = playerState.heroTaxedColumns ?? {};
    return {
      ...playerState,
      pendingHeroDiscount: 0,
      heroTaxedColumns: restTaxed,
      extraHeroActivation: usingExtra ? false : playerState.extraHeroActivation,
    };
  };

  const targets = heroTargetKeys(state, role, col, hero);

  if (targets === null) { // instant — no target to pick
    const paid = { ...state, [role]: { ...spendCostMods(ps), fuel: ps.fuel - cost } };
    const { state: next, log } = applyHeroPower(paid, role, col, hero, null);
    commitState(next, [...costModLog, ...log]);
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

function resolveHeroTargeting(clickedKey) {
  if (!pendingHeroTargets?.has(clickedKey)) return;
  const role = state.initiative;
  const hero = CARD_BY_ID[pendingHeroId];
  const { state: next, log } = applyHeroPower(state, role, pendingHeroColumn, hero, clickedKey);
  pendingHeroId = null;
  pendingHeroColumn = null;
  pendingHeroTargets = null;
  preCommandState = null;
  uiState = 'idle';
  commitState(next, log);
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
  if (uiState === 'hero-targeting') return;              // finish the current power first
  // Command Shuffle (122): reuses this exact pick-up/drop flow, but must not activate a
  // power on pick-up and must not spend (or require) the normal Hero Phase reposition.
  const shuffleActive = pendingCommandId === 122;
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

  commitState(
    { ...state, [role]: { ...ps, heroZones: next, heroRepositioned: shuffleActive ? ps.heroRepositioned : true } },
    [msg],
  );
  if (shuffleActive) { pendingCommandId = null; preCommandState = null; }
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
    if (state[active].fuel < card.cost) {
      appendLog([`Not enough Fuel for ${card.name} (need ${card.cost}, have ${state[active].fuel})`]);
      redraw();
      return;
    }
    if (cardId === 123) { // Radio Interference — targets an enemy Hero Zone, not a board tile
      startEnemyHeroTargeting(cardId);
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
      tempSideBonus: 0,
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

    const logLines = [`Placed ${card.name} at ${clickedKey} (${terrain})${discount > 0 ? ` [Armored Spearhead: -${discount} Fuel]` : ''}`];
    state = { ...newState, log: [...(newState.log ?? []), ...logLines] };
    appendLog(logLines); // fire immediately so it displays before any mission/Hero-passive lines below

    // Check placement-triggered missions (Deep Strike, Encirclement)
    const { state: afterPlaceMissions, log: placeMissionLog } = checkActiveMissions(state, active, {});
    if (placeMissionLog.length > 0) {
      state = { ...afterPlaceMissions, log: [...(afterPlaceMissions.log ?? []), ...placeMissionLog] };
      appendLog(placeMissionLog);
    }

    // Objective Marshal / Infantry Commander / Combined Arms General / Conventional Warfare
    // Commander — "first qualifying Unit played this turn" passives.
    const { state: afterHeroPassives, log: heroPassiveLog } = checkHeroPassivesOnPlace(state, active, c, clickedKey, card);
    if (heroPassiveLog.length > 0) {
      state = { ...afterHeroPassives, log: [...(afterHeroPassives.log ?? []), ...heroPassiveLog] };
      appendLog(heroPassiveLog);
    } else {
      state = afterHeroPassives;
    }

    // Veteran Signal Corps / Combat Engineers — the unit's own "On Play" ability.
    const { state: afterOnPlay, log: onPlayLog } = checkUnitOnPlayAbility(state, active, c, clickedKey, card);
    if (onPlayLog.length > 0) {
      state = { ...afterOnPlay, log: [...(afterOnPlay.log ?? []), ...onPlayLog] };
      appendLog(onPlayLog);
    } else {
      state = afterOnPlay;
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
    const bonusLog = [];
    if (wasDestroyed) {
      const attackerCls = CARD_BY_ID[attackerUnit.cardId]?.cls;
      missionCtx.aircraftKill = attackerCls === 'Aircraft';
      missionCtx.heavyArmorKill = getKeywords(attackerUnit).includes('Heavy Armor');
      newState = { ...newState, [attacker]: {
        ...newState[attacker],
        killsThisTurn: (newState[attacker].killsThisTurn ?? 0) + 1,
        totalKills: (newState[attacker].totalKills ?? 0) + 1,
      }};
      // Strategic Bomber (120) — draw 1 the first time THIS unit destroys an enemy.
      // Attacker survives on newBoard[attackerKey] unless it also died (defender-only kill
      // check here, so it's still there) — hasScoredKill lives on the board unit instance,
      // not the card, so a second copy on the board tracks its own kill independently.
      if (attackerUnit.cardId === 120 && !attackerUnit.hasScoredKill && newBoard[attackerKey]) {
        newState = {
          ...newState,
          board: { ...newState.board, [attackerKey]: { ...newState.board[attackerKey], hasScoredKill: true } },
          [attacker]: drawCards(newState[attacker], 1),
        };
        bonusLog.push(`${CARD_BY_ID[120].name}: first kill for this unit — draw 1 card`);
      }
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

    commitState(newState, [...result.logEntries, ...overrunLog, ...missionLog, ...bonusLog]);
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
          s = { ...s, [player]: addDiscount(s[player], { appliesTo: 'Tank', column: null, amount: 1, min: 0 }) };
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
    case 121: { // Priority Orders — next Hero Power this turn costs 2F less, min 0
      s = { ...s, [active]: { ...s[active], pendingHeroDiscount: s[active].pendingHeroDiscount + 2 } };
      log.push(`${card.name}: next Hero Power this turn costs 2F less`);
      break;
    }
    case 126: { // Coordinated Orders — one extra Hero Power activation this turn, different Hero
      s = { ...s, [active]: { ...s[active], extraHeroActivation: true } };
      log.push(`${card.name}: may activate one more Hero Power this turn (different Hero)`);
      break;
    }
    case 122: { // Command Shuffle — move/swap a Hero without spending the normal reposition.
      // Fuel/hand already deducted into `s` above; hand off to handleHeroZoneClick's
      // existing pick-up/drop flow via pendingCommandId === 122 (see that function).
      if (!(s[active].heroZones ?? []).some(z => z != null)) {
        log.push(`${card.name}: no deployed Hero to move`);
        break;
      }
      preCommandState = state; // pre-deduction snapshot, so Cancel refunds this card too
      pendingCommandId = 122;
      log.push(`${card.name}: choose a Hero to move or swap`);
      commitState(s, log);
      return true;
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
      let cleared = 0;
      const ccgLog = [];
      // Heals both players' units, so removeSuppression checks Counteroffensive General
      // per unit against its own owner — see the comment on that function in combat.js.
      for (const k of Object.keys(s.board)) {
        const result = removeSuppression(s, k);
        if (!result.changed) continue;
        s = result.state;
        cleared++;
        ccgLog.push(...result.log);
      }
      const hpGain = cleared * 2;
      s = { ...s, [active]: { ...s[active], hq: s[active].hq + hpGain } };
      log.push(`${card.name}: ${cleared} unit(s) un-suppressed, +${hpGain} HQ HP`);
      log.push(...ccgLog);
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
    case 125: { // Field Reserves — look at top 4, may take a Unit, rest to bottom
      const drawn = s[active].deck.slice(0, 4);
      if (drawn.length === 0) {
        log.push(`${card.name}: deck is empty`);
        commitState(s, log);
        return true;
      }
      s = { ...s, [active]: { ...s[active], deck: s[active].deck.slice(drawn.length) } };
      commitState(s, log);
      showFieldReservesModal(drawn, active);
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

    case 124: // Change Formation — any unsuppressed friendly unit
      return new Set(friendlies.filter(([, u]) => u.state === 'normal').map(([k]) => k));

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
  const handAfter = [...state[active].hand];
  const idx = handAfter.indexOf(cardId);
  if (idx !== -1) handAfter.splice(idx, 1);
  preCommandState = state;
  state = { ...state, [active]: { ...state[active], fuel: state[active].fuel - card.cost, hand: handAfter } };
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
      const result = removeSuppression(s, targetKey);
      s = result.state;
      log.push(`${card.name}: ${unitName} un-suppressed`);
      log.push(...result.log);
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
      const result = removeSuppression(s, targetKey);
      s = result.state;
      const su = s.board[targetKey];
      s = { ...s, board: { ...s.board, [targetKey]: { ...su, grantedKeywords: [...(su.grantedKeywords || []), 'Guard'] } } };
      log.push(`${card.name}: ${unitName} un-suppressed + gains Guard (until your next turn)`);
      log.push(...result.log);
      break;
    }
    case 74: { // Dig In — Guard + Armor until owner's next turn
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, grantedKeywords: [...(unit.grantedKeywords || []), 'Guard', 'Armor'] } } };
      log.push(`${card.name}: ${unitName} gains Guard + Armor (until your next turn)`);
      break;
    }
    case 124: { // Change Formation — rotate 90° clockwise, persists until rotated again
      const newRotation = ((unit.rotation || 0) + 90) % 360;
      s = { ...s, board: { ...s.board, [targetKey]: { ...unit, rotation: newRotation } } };
      log.push(`${card.name}: ${unitName} rotated to ${newRotation}°`);
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
      s = { ...s, [player]: addDiscount(s[player], { appliesTo: 'Tank', column: null, amount: 2, min: 0 }) };
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
      const entry = Object.entries(s.board).find(([, u]) => u && u.owner === player && u.state === 'suppressed');
      if (entry) {
        const [sk, su] = entry;
        const cleared = unsuppressOnBoard(s.board, sk).board;
        const cu = cleared[sk];
        s = { ...s, board: { ...cleared, [sk]: { ...cu, grantedKeywords: [...(cu.grantedKeywords || []), 'Armor'] } } };
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
  selectedHeroZone = null;
  pendingHeroId = null;
  pendingHeroColumn = null;
  pendingHeroTargets = null;

  const newRound = Math.ceil(newState.turn / 2);
  const turnLog = [...endMissionLog, `--- Round ${newRound} — ${newState.initiative.toUpperCase()} ---`, ...supplyLog, ...effectLog];
  commitState(newState, turnLog);
  checkWin();

  // Hero Phase for the player whose turn just began.
  if (!gameOver) runHeroPhase(newState.initiative);

  if (isAiMode && !gameOver && newState.initiative === 'p2') {
    runBotTurn();
  }
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

// Missions side panel removed 2026-07-30 (Missions retired for v0.4 — see cards.js header).
// playMissionCard/checkActiveMissions/evalMissionCondition/applyMissionReward are left in
// place below, unreachable now that no deck/hand can contain a mission card.

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

// Hero Zone hover → card preview, same as hand cards and board units.
for (const role of ['p1', 'p2']) {
  const strip = document.getElementById(`hero-zone-${role}`);
  strip?.addEventListener('mouseover', e => {
    const placed = e.target.closest('.hero-placed');
    if (placed) showCardPreview(Number(placed.dataset.heroId));
  });
  strip?.addEventListener('mouseleave', hideCardPreview);
}

// ── Floating tooltip — [data-tip] pips (ability icons on hand/board cards, Hero powers) ──
// Delegated at the document level so it works for every card everywhere without each
// card's own overflow:hidden clipping it (see .floating-tip comment in game.css).
{
  const tip = document.getElementById('floating-tip');
  document.addEventListener('mouseover', e => {
    const pip = e.target.closest('[data-tip]');
    if (!pip) return;
    tip.textContent = pip.dataset.tip;
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
    if (e.target.closest('[data-tip]')) tip.style.display = 'none';
  });
}

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
          // No pre-game Hero pick anymore — P2's first Hero arrives at round 2 via
          // runHeroPhase, same as P1 and local hotseat (removed 2026-08-11). This used to
          // deploy a Hero here immediately after mulligan; that stale copy of the old flow
          // was the actual cause of "P2 gets a Hero immediately" in online play — the
          // pre-game step was removed from startGame() but this separate P2-online path
          // still had its own independent copy of it.
          document.getElementById('game-area').style.display = 'flex';
          appendLog(state.log ?? []);
          redraw();
          pushStateIfOnline(state);
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

    const cardDiv = buildPreviewCardDiv(card);

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

// ── Radio Operator modal (111) ────────────────────────────────────────────────
// Only 2 cards and a binary choice, so it resolves on a single click — no separate
// Confirm button, unlike Forward Observer's 3-way keep/top/bottom assignment.
let radioOpPlayer = null;

function showRadioOperatorModal(drawn, player) {
  radioOpPlayer = player;
  const container = document.getElementById('radio-op-cards');
  container.innerHTML = '';

  drawn.forEach(cardId => {
    const card = CARD_BY_ID[cardId];
    const slot = document.createElement('div');
    slot.className = 'fo-slot';
    slot.appendChild(buildPreviewCardDiv(card));

    const btn = document.createElement('button');
    btn.className = 'fo-pos-btn fo-top';
    btn.textContent = 'PUT ON TOP';
    btn.addEventListener('click', () => confirmRadioOperator(cardId, drawn.find(id => id !== cardId)));
    slot.appendChild(btn);

    container.appendChild(slot);
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
  const container = document.getElementById('field-reserves-cards');
  container.innerHTML = '';

  drawn.forEach(cardId => {
    const card = CARD_BY_ID[cardId];
    const slot = document.createElement('div');
    slot.className = 'fo-slot';
    slot.appendChild(buildPreviewCardDiv(card));

    if (card.type === 'unit') {
      const btn = document.createElement('button');
      btn.className = 'fo-pos-btn fo-top';
      btn.textContent = 'TAKE';
      btn.addEventListener('click', () => confirmFieldReserves(cardId));
      slot.appendChild(btn);
    }

    container.appendChild(slot);
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
