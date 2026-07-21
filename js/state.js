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
//   hq: number,                 — starts 25
//   fuel: number,               — max 6
//   pendingFuelGain: number,    — delayed fuel (Industrial Surge), added at next startOfTurn
//   hand: number[],             — cardIds in hand
//   deck: number[],             — cardIds remaining (top = index 0)
//   missions: ActiveMission[],
//   tempFuelDiscount: number,   — discount on next card of matching class
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
// }

import { CARD_BY_ID } from './cards.js?v=1784633047';

// ── State factory ────────────────────────────────────────────────────────────

export function createInitialState(p1DeckIds, p2DeckIds, mapId = 'kursk') {
  return {
    turn: 1,
    initiative: "p1",
    phase: "play",
    p2Joined: false,
    mapId,
    p1: createPlayerState(p1DeckIds),
    p2: createPlayerState(p2DeckIds),
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

function createPlayerState(deckCardIds) {
  const shuffled = [...deckCardIds].sort(() => Math.random() - 0.5);
  const hand = shuffled.slice(0, 4);
  const deck = shuffled.slice(4);
  return {
    hq: 25,
    fuel: 0,
    pendingFuelGain: 0,
    hand,
    deck,
    missions: [],
    tempFuelDiscount: 0,
    overrun: false,
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
  return { ...playerState, fuel: cap ? Math.min(6, newFuel) : newFuel };
}

// ── Board unit helpers ───────────────────────────────────────────────────────

// Returns card's base side value + tempSideBonus + grantedSideBonus + objSideBonus + debugSideBonus.
export function getSideValue(boardUnit, dir) {
  const card = CARD_BY_ID[boardUnit.cardId];
  if (!card || card.type !== "unit") return 0;
  // P2's card faces opposite direction — N is their front facing P1's side (actual South)
  const P2_FLIP = { n: 's', s: 'n', e: 'w', w: 'e' };
  const d = boardUnit.owner === 'p2' ? P2_FLIP[dir] : dir;
  return card[d] + (boardUnit.tempSideBonus || 0) + (boardUnit.grantedSideBonus || 0) + (boardUnit.objSideBonus || 0) + (boardUnit.debugSideBonus || 0);
}

// Returns card's base keyword(s) + tempKeywords + grantedKeywords.
// card.keyword may be a string or array.
export function getKeywords(boardUnit) {
  const card = CARD_BY_ID[boardUnit.cardId];
  const base = card?.keyword
    ? (Array.isArray(card.keyword) ? card.keyword : [card.keyword])
    : [];
  return [...base, ...(boardUnit.tempKeywords || []), ...(boardUnit.grantedKeywords || [])];
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
