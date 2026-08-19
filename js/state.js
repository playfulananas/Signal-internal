// Game state shape (canonical — see ARCHITECTURE.md):
// {
//   turn: number,               — starts at 1, increments on endTurn
//   initiative: "p1" | "p2",   — whose turn it is
//   phase: "play",              — reserved; always "play" for now
//   p2Joined: boolean,          — set by lobby when opponent joins
//
//   p1: PlayerState,
//   p2: PlayerState,
//
//   board: { [tileKey]: BoardUnit | null },   — tileKey = "row,col"
//   objectives: { [tileKey]: { cardId, level } },
//   log: string[],
//   pendingArtyHits: number,    — Artillery Position L2/L4 hits owed to `initiative` player, synced so the
//                                 controlling player's own client (not just whoever ended the prior turn)
//                                 enters targeting mode; 0 once resolved.
// }
//
// PlayerState: {
//   hq: number,                 — starts 30
//   fuel: number,               — capped at fuelCap (default 9)
//   fuelCap: number,            — per-player storage cap; a Hero can raise it
//   pendingFuelGain: number,    — delayed fuel (Industrial Surge), added at next startOfTurn
//   hand: number[],             — cardIds in hand
//   deck: number[],             — cardIds remaining (top = index 0)
//   missions: ActiveMission[],
//   pendingDiscounts: [{ appliesTo, column, amount, min }],  — unspent Fuel discounts
//   pendingUnitBuffs: [{ appliesTo, amount }],  — unspent stat buffs (Deathrattle: Convoy Escort)
//   fieldMarshalUses: number,   — Field Marshal (144) activation count this match, never reset
// }
//
// ActiveMission: { cardId, killsAtDeploy? } — no turn limit; stays active until its reward fires.
// killsAtDeploy is only set for Total Onslaught (81), to track kills since THIS copy was played.
//
// BoardUnit: {
//   cardId: number,
//   owner: "p1" | "p2",
//   state: "normal" | "suppressed" | "destroyed",
//   armorHits: number,          — hits absorbed by armor so far
//   tempKeywords: string[],     — keywords added THIS TURN only (objective buffs, Entrench); cleared by endTurn
//   grantedKeywords: string[],  — keywords from commands lasting UNTIL OWNER'S NEXT TURN; cleared by startOfTurn
//   tempSideBonus: number,      — +N to all sides this turn
//   grantedSideBonus: number,   — +N to all sides from Rally Cry; lasts sideBonusTurns owner turn-starts
//   sideBonusTurns: number,     — turn-starts remaining before grantedSideBonus clears (Rally Cry = 2)
//   debugSideBonus: number,     — +/-N to all sides from the debug panel; persists until the tester
//                                 changes it back to 0, NOT cleared by normal turn logic
//   justPlaced: boolean,        — true only on the turn deployed; cleared by endTurn
//   rotation: number,           — 0/90/180/270, clockwise, set by Change Formation (124) and
//                                 Field Engineer (91). Which of the card's own N/E/S/W values
//                                 lines up with a given physical board side — see rotatedDir.
//                                 Persists until explicitly rotated again; never auto-clears.
// }

import { CARD_BY_ID } from './cards.js?v=1787173232';

// ── State factory ────────────────────────────────────────────────────────────

export function createInitialState(p1DeckIds, p2DeckIds, mapId = 'kursk', p1HeroIds = [], p2HeroIds = []) {
  return {
    turn: 1,
    initiative: "p1",
    phase: "play",
    p2Joined: false,
    mapId,
    p1: createPlayerState(p1DeckIds, p1HeroIds),
    p2: createPlayerState(p2DeckIds, p2HeroIds),
    board: Object.fromEntries(
      Array.from({ length: 4 }, (_, r) =>
        Array.from({ length: 4 }, (_, c) => [`${r},${c}`, null])
      ).flat()
    ),
    objectives: {},
    log: [],
    pendingArtyHits: 0,
  };
}

// Fisher-Yates — NOT `arr.sort(() => Math.random() - 0.5)`, which does not produce a uniform
// shuffle (a well-known JS anti-pattern: sort implementations don't call the comparator on
// every pair with equal frequency, and it's especially biased on small arrays — V8 uses
// insertion sort below ~10 elements, exactly the size of a starting deck's shuffle-relevant
// windows and the Objectives pool). Was the actual cause of "same objectives across 7 games in
// a row" (2026-08-19 playtest report) — see pickObjectives in game.js and applyMulligan.
export function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function createPlayerState(deckCardIds, heroIds = []) {
  const shuffled = shuffle(deckCardIds);
  const hand = shuffled.slice(0, 4);
  const deck = shuffled.slice(4);
  return {
    hq: 30,
    fuel: 0,
    fuelCap: 9,
    pendingFuelGain: 0,
    hand,
    deck,
    missions: [],
    pendingDiscounts: [],
    overrun: false,
    // ── Hero command layer ──
    // Heroes are never shuffled into the deck; the roster is a separate fixed list of 4.
    heroRoster: [...heroIds],
    // Index = board column (0-3). Value = hero cardId occupying that zone, or null.
    heroZones: [null, null, null, null],
    // Hero ids whose Activated Power has already fired THIS TURN. Each Hero may activate
    // once per turn; different Heroes may each activate in the SAME turn (locked 2026-08-17,
    // replaces the old single `heroActivated` once-per-turn-total flag — Coordinated Orders
    // is retired as a result, since "activate another Hero's power this turn" is now default).
    heroesActivatedThisTurn: [],
    // Snapshot of the above, taken at the START of this player's turn (before it's cleared
    // for the new turn) — i.e. "did I activate any Hero Power on my own previous turn."
    // Powers Veteran Signal Corps (119). Cleared/recomputed every startOfTurn.
    heroActivatedLastTurn: false,
    heroRepositioned: false,    // one move/swap per turn; a reinforcement consumes it
    // Per-player, because P1 and P2 cross each Objective threshold on different half-turns.
    // Starts at 0 (not 1) so the FIRST Hero deploys at round 2 (Objective Level 1) via
    // runHeroPhase, same as the 3 reinforcements after it — there is no separate
    // pre-game "Starting Hero" step anymore (removed 2026-08-11: hero timing now follows
    // the objective escalation schedule exactly, L1-L4 = all 4 roster Heroes).
    lastObjLevel: 0,
    lastUnitClass: null,        // for Combined Arms General (109)
    // { [heroId]: true } — gates "first X each turn" passives (94, 104, 109, 110) so each
    // fires at most once per owner turn. Cleared at startOfTurn alongside heroesActivatedThisTurn.
    heroTriggeredThisTurn: {},
    // Set by Priority Orders (121): Fuel discount applied to the very next Hero Power
    // activation this turn, then consumed. Independent of pendingDiscounts (that system is
    // keyed by card class/type, not applicable to a Hero Power's activeCost).
    pendingHeroDiscount: 0,
    // Set by Radio Interference (123) on an ENEMY Hero: extra Fuel cost added to that
    // column's Activated Hero Power during the controller's next turn. { [col]: amount }.
    // Cleared at startOfTurn alongside the other per-cycle Hero fields.
    heroTaxedColumns: {},
    // Field Marshal (144): number of times this player has activated it this match. The
    // Hero's own bonus is (this + 1) each activation — never reset, by design (escalating
    // Active power, not a per-turn passive). See cards.js's note on 144 for the interpretation.
    fieldMarshalUses: 0,
    // One-shot stat buffs queued for the next matching Unit played (Deathrattle: Convoy Escort
    // 138). Entries: { appliesTo: className, amount }. Consumed (removed) by
    // checkPendingUnitBuff in combat.js the moment a matching Unit is placed — unlike
    // pendingDiscounts, this is a stat bonus, not a Fuel discount, so it needs its own list.
    pendingUnitBuffs: [],
  };
}

// ── Turn transitions ─────────────────────────────────────────────────────────

// Active player gains 3 fuel, capped at 6, then pendingFuelGain (Industrial Surge) on top of that,
// uncapped — may push Fuel past 6 for this turn only. Resets pendingFuelGain to 0.
// Missions have no turn limit — they stay active until their reward condition fires
// (checkActiveMissions removes them at that point, not here).
// Clears grantedKeywords from all units owned by the active player.
export function startOfTurn(state) {
  const activePlayer = state.initiative;
  let ps = { ...state[activePlayer] };
  ps = gainFuel(ps, 3); // base per-turn gain, capped at 6 as normal
  ps = gainFuel(ps, ps.pendingFuelGain, false); // Industrial Surge — may exceed the storage cap this turn
  ps.pendingFuelGain = 0;
  // Hero Phase allowances refresh here rather than in endTurn: this runs for the active
  // player only and survives remote sync, matching the killsThisTurn convention.
  // Snapshot BEFORE clearing — "did I activate a Hero Power on my own last turn" (Veteran
  // Signal Corps, 119) needs the value from the turn that's ending, not the fresh one.
  ps.heroActivatedLastTurn = (ps.heroesActivatedThisTurn ?? []).length > 0;
  ps.heroesActivatedThisTurn = [];
  ps.heroRepositioned = false;
  ps.heroTriggeredThisTurn = {};
  ps.heroTaxedColumns = {};
  ps.pendingHeroDiscount = 0; // "this turn" only (Priority Orders) — expires unused

  // Clear per-turn grants and obj bonus for the active player's units before objective effects re-apply.
  // grantedSideBonus (Rally Cry) uses its own counter so it can outlast a single turn (see sideBonusTurns).
  const newBoard = Object.fromEntries(
    Object.entries(state.board).map(([k, u]) => {
      if (!u || u.owner !== activePlayer) return [k, u];
      const turnsLeft = (u.sideBonusTurns ?? 0) - 1;
      return [k, {
        ...u,
        grantedKeywords: [],
        objSideBonus: 0,
        grantedSideBonus: turnsLeft > 0 ? u.grantedSideBonus : 0,
        sideBonusTurns: turnsLeft > 0 ? turnsLeft : 0,
      }];
    })
  );

  return { ...state, [activePlayer]: ps, board: newBoard };
}

// Swaps initiative, increments turn counter.
// Clears justPlaced, tempKeywords, tempSideBonus on all board units.
export function endTurn(state) {
  const newBoard = Object.fromEntries(
    Object.entries(state.board).map(([k, v]) =>
      [k, v ? { ...v, justPlaced: false, tempKeywords: [], tempSideBonus: 0 } : null]
    )
  );
  return {
    ...state,
    board: newBoard,
    p1: { ...state.p1, overrun: false },
    p2: { ...state.p2, overrun: false },
    initiative: state.initiative === "p1" ? "p2" : "p1",
    turn: state.turn + 1,
  };
}

// Checks who controls each objective (majority of adjacent non-destroyed units).
// Called at the start of each player's turn before applying objective effects.
export function checkObjectiveControl(state) {
  const updated = {};
  for (const [key, obj] of Object.entries(state.objectives)) {
    const [r, c] = key.split(',').map(Number);
    const adjKeys = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]
      .filter(([row, col]) => row >= 0 && row < 4 && col >= 0 && col < 4)
      .map(([row, col]) => `${row},${col}`);
    let p1 = 0, p2 = 0;
    for (const k of adjKeys) {
      const u = state.board[k];
      if (!u || u.state === 'destroyed') continue;
      if (u.owner === 'p1') p1++; else p2++;
    }
    const controller = p1 > p2 ? 'p1' : p2 > p1 ? 'p2' : null;
    updated[key] = { ...obj, controller };
  }
  return { ...state, objectives: updated };
}

// Recalculates objective level for current turn and sets it on all placed objectives.
export function updateObjectiveLevels(state) {
  const level = objectiveLevel(state.turn);
  if (level === 0) return state;
  const objectives = Object.fromEntries(
    Object.entries(state.objectives).map(([k, obj]) => [k, { ...obj, level }])
  );
  return { ...state, objectives };
}

// ── Player state helpers ─────────────────────────────────────────────────────

// Draws up to n cards from deck into hand. Stops if deck empty.
export function drawCards(playerState, n) {
  const ps = { ...playerState };
  const drawn = ps.deck.slice(0, n);
  ps.hand = [...ps.hand, ...drawn];
  ps.deck = ps.deck.slice(n);
  return ps;
}

export function spendFuel(playerState, amount) {
  return { ...playerState, fuel: Math.max(0, playerState.fuel - amount) };
}

export function gainFuel(playerState, amount, cap = true) {
  const newFuel = playerState.fuel + amount;
  // Cap is per-player so a Hero can raise it (Logistics Chief: 11 instead of 9).
  // Callers passing cap=false (objective/mission Fuel grants) still bypass it entirely.
  return { ...playerState, fuel: cap ? Math.min(fuelCapOf(playerState), newFuel) : newFuel };
}

// Base cap is 9, but Logistics Chief (89) raises it to 11 while deployed in any Hero Zone.
export function fuelCapOf(playerState) {
  const base = playerState.fuelCap ?? 9;
  const hasLogisticsChief = (playerState.heroZones ?? []).includes(89);
  return hasLogisticsChief ? Math.max(base, 11) : base;
}

// ── Fuel discounts ───────────────────────────────────────────────────────────
// Replaces the old scalar `tempFuelDiscount`, which was hardcoded to Tanks, had no column
// or floor, and never expired. Entry shape:
//   { appliesTo, column, amount, min }
//     appliesTo — a unit class ('Tank'), or 'command', or null for any card
//     column    — restrict to one board column (Hero powers), or null for anywhere
//     amount    — Fuel reduction offered
//     min       — floor for the resulting cost (0 = may reach free; Hero powers use 1)
// Discounts persist until spent, matching the previous behaviour.

function discountMatches(d, card, col) {
  if (d.appliesTo === 'command') { if (card.type !== 'command') return false; }
  else if (d.appliesTo && card.cls !== d.appliesTo) return false;
  // col === null means "don't filter by column" — used by the hand display and the
  // affordability pre-check, which run before a tile has been chosen, so they show the
  // best case. Placement passes the real column and gets the true figure.
  if (col !== null && d.column != null && d.column !== col) return false;
  return true;
}

// Total Fuel reduction available to this card, capped so the cost never falls below the
// most restrictive `min` among the matching entries.
export function discountFor(playerState, card, col = null) {
  const matches = (playerState.pendingDiscounts ?? []).filter(d => discountMatches(d, card, col));
  if (!matches.length) return 0;
  const total = matches.reduce((sum, d) => sum + d.amount, 0);
  const floor = matches.reduce((m, d) => Math.max(m, d.min ?? 0), 0);
  return Math.max(0, Math.min(total, (card.cost ?? 0) - floor));
}

// Spends `used` Fuel worth of discount, draining matching entries in order and dropping
// any that reach zero.
export function consumeDiscounts(playerState, card, col, used) {
  if (used <= 0) return playerState;
  let left = used;
  const out = [];
  for (const d of playerState.pendingDiscounts ?? []) {
    if (left > 0 && discountMatches(d, card, col)) {
      const take = Math.min(left, d.amount);
      left -= take;
      if (d.amount - take > 0) out.push({ ...d, amount: d.amount - take });
      continue;
    }
    out.push(d);
  }
  return { ...playerState, pendingDiscounts: out };
}

export function addDiscount(playerState, entry) {
  return { ...playerState, pendingDiscounts: [...(playerState.pendingDiscounts ?? []), entry] };
}

// ── Board unit helpers ───────────────────────────────────────────────────────

// Clears Suppression from one unit. Single funnel for every "un-suppress" effect
// (Field Medic, Last Stand, Combined Arms Doctrine, Fortify the Line) so Hero passives
// that trigger on Suppression being removed have one hook point instead of four inline
// call sites. `changed` is false when the unit was not actually suppressed, which is what
// callers gate their trigger on — un-suppressing a healthy unit must not fire anything.
export function unsuppressOnBoard(board, key) {
  const unit = board[key];
  if (!unit || unit.state !== 'suppressed') return { board, changed: false };
  return { board: { ...board, [key]: { ...unit, state: 'normal' } }, changed: true };
}

// ── Rotation (Change Formation 124, Field Engineer 91) ──────────────────────
// Answers "after rotating the unit `rotation`° clockwise, which of the card's own N/E/S/W
// attributes is now showing at physical side `dir`?" A 90° clockwise turn moves the card's
// N attribute to the physical E side, so the physical N side ends up showing what was
// previously the card's W attribute: rotatedDir('n', 90) === 'w' (look up the card's own
// attribute `steps` positions counter-clockwise from the physical side being queried).
const DIR_ORDER = ['n', 'e', 's', 'w'];
export function rotatedDir(dir, rotationDegrees) {
  const steps = Math.round((rotationDegrees || 0) / 90) % 4;
  if (!steps) return dir;
  const i = DIR_ORDER.indexOf(dir);
  return DIR_ORDER[(i - steps + 4) % 4];
}

// Returns card's base side value (after rotation) + tempSideBonus + grantedSideBonus +
// objSideBonus + debugSideBonus.
// No owner-based flip: a card's printed N/E/S/W always maps to physical N/E/S/W on the
// fixed board grid, for both players — matching how it's shown in hand and on the tile.
// (2026-07-02 added an owner-based P2_FLIP here, paired with a per-viewer board rotation
// in renderBoard; the board rotation was reverted 2026-07-30 but this half was missed,
// leaving P2's board stats silently mismatched from what was shown in hand. Removed 2026-08-14.)
export function getSideValue(boardUnit, dir) {
  const card = CARD_BY_ID[boardUnit.cardId];
  if (!card || card.type !== "unit") return 0;
  const d = rotatedDir(dir, boardUnit.rotation);
  return card[d] + (boardUnit.tempSideBonus || 0) + (boardUnit.grantedSideBonus || 0) + (boardUnit.objSideBonus || 0) + (boardUnit.debugSideBonus || 0);
}

// Returns card's base keyword(s) + tempKeywords + grantedKeywords.
// card.keyword may be a string or array.
export function getKeywords(boardUnit) {
  const card = CARD_BY_ID[boardUnit.cardId];
  const base = card?.keyword
    ? (Array.isArray(card.keyword) ? card.keyword : [card.keyword])
    : [];
  return [...new Set([...base, ...(boardUnit.tempKeywords || []), ...(boardUnit.grantedKeywords || [])])];
}

// Heavy Armor → 2, Armor → 1, else → 0.
export function maxArmorHits(boardUnit) {
  const kws = getKeywords(boardUnit);
  if (kws.includes("Heavy Armor")) return 2;
  if (kws.includes("Armor")) return 1;
  return 0;
}

// maxArmorHits + 2 (armor absorbs N hits, then Suppressed, then Destroyed).
export function hitsToDestroy(boardUnit) {
  return maxArmorHits(boardUnit) + 2;
}

// Applies one hit following the sequence:
//   armorHits < maxArmorHits → absorb (hqDamage = 0, state unchanged)
//   state === "normal"       → "suppressed" (hqDamage = 1)
//   state === "suppressed"   → "destroyed"  (hqDamage = 2)
// hqDamage is dealt to the unit owner's HQ (the one being attacked).
export function applyHit(boardUnit) {
  const unit = { ...boardUnit };
  const armor = maxArmorHits(unit);

  if (unit.armorHits < armor) {
    unit.armorHits += 1;
    return { newUnit: unit, hqDamage: 0 };
  }

  if (unit.state === "normal") {
    unit.state = "suppressed";
    return { newUnit: unit, hqDamage: 1 };
  }

  if (unit.state === "suppressed") {
    unit.state = "destroyed";
    return { newUnit: unit, hqDamage: 2 };
  }

  // Already destroyed — safe fallback.
  return { newUnit: unit, hqDamage: 0 };
}

// Compares attacker's side value vs defender's opposite side. Tie = attacker wins.
// attDir is the direction the attacker is swinging FROM
// (e.g. attacker is N of defender → attDir = "s").
export function attackBeats(attacker, attDir, defender) {
  const attValue = getSideValue(attacker, attDir);
  const defValue = getSideValue(defender, oppositeDir(attDir));
  return attValue >= defValue;
}

export function oppositeDir(dir) {
  return { n: "s", s: "n", e: "w", w: "e" }[dir];
}

// ── Objective helpers ────────────────────────────────────────────────────────

// state.turn is a half-turn counter (increments each time any player ends their turn).
// Convert to full rounds: round 1 = half-turns 1-2, round 2 = half-turns 3-4, etc.
// Round 1 → 0 (no bonus), rounds 2-3 → L1, 4-5 → L2, 6-7 → L3, 8+ → L4.
export function objectiveLevel(turn) {
  const round = Math.ceil(turn / 2);
  if (round < 2) return 0;
  if (round <= 3) return 1;
  if (round <= 5) return 2;
  if (round <= 7) return 3;
  return 4;
}
