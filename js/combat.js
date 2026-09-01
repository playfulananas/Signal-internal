import { CARD_BY_ID, registerGeneratedCard } from './cards.js?v=1788263767';
import { getSideValue, getKeywords, attackBeats, applyHit, oppositeDir, unsuppressOnBoard, drawCards, addDiscount, remainingAttacks, spendAttack, grantTempAttacks, resetPersistentAttacks, fuelCapOf, gainFuel } from './state.js?v=1788263767';
import { canPlaceOnTerrain, getTerrain } from './maps.js?v=1788263767';

// Orthogonal directions and their row/col offsets.
const DIRS = ["n", "e", "s", "w"];
const DIR_OFFSET = { n: [-1, 0], e: [0, 1], s: [1, 0], w: [0, -1] };

// ── Tile helpers ─────────────────────────────────────────────────────────────

export function tileKey(row, col) {
  return `${row},${col}`;
}

export function tileCoords(key) {
  return key.split(",").map(Number);
}

// Returns all orthogonally adjacent tiles within the 4x4 grid.
// Each entry: { key: "row,col", dir: direction FROM (row,col) TO that neighbor }
export function adjacentTiles(row, col) {
  return DIRS.flatMap(dir => {
    const [dr, dc] = DIR_OFFSET[dir];
    const r = row + dr;
    const c = col + dc;
    if (r >= 0 && r < 4 && c >= 0 && c < 4) {
      return [{ key: tileKey(r, c), dir }];
    }
    return [];
  });
}

// ── Column helpers ───────────────────────────────────────────────────────────
// Hero Zones are aligned 1:1 with board columns and 17 of the 24 Heroes only affect
// "this Hero's column", so column iteration is a first-class need. Note board keys are
// "row,col", so the column is the SECOND component.

// All 4 tile keys in a column, top (row 0) to bottom (row 3).
export function columnKeys(col) {
  return [0, 1, 2, 3].map(row => tileKey(row, col));
}

// Live units in a column. Destroyed units are excluded — they linger on the board
// greyed out for readability but are not valid targets or trigger sources.
// `owner` optionally filters to 'p1' | 'p2'.
export function unitsInColumn(state, col, owner = null) {
  return columnKeys(col).flatMap(key => {
    const unit = state.board[key];
    if (!unit || unit.state === 'destroyed') return [];
    if (owner && unit.owner !== owner) return [];
    return [{ key, unit }];
  });
}

// Live units anywhere on the board — board-scoped equivalent of unitsInColumn, for Heroes
// like Garrison Commander (99) whose targeting isn't restricted to their own column.
export function unitsOnBoard(state, owner = null) {
  return Object.entries(state.board).flatMap(([key, unit]) => {
    if (!unit || unit.state === 'destroyed') return [];
    if (owner && unit.owner !== owner) return [];
    return [{ key, unit }];
  });
}

// ── Empty-Board HQ Strike ────────────────────────────────────────────────────
// GDD Locked Decision (2026-08-13): if the opponent has zero LIVE units on the board and
// it isn't Turn 1 (the game's literal first half-turn — P2's own first turn, turn 2, IS
// eligible), a friendly unit that hasn't yet used all its attacks this turn strikes the HQ
// directly instead of an adjacent/Bombard enemy, since there's nothing to hit. Prevents a
// player from stalling out all combat pressure by simply refusing to place any units.

// True when attackerKey's owner has a live target-less opponent to strike directly.
export function canStrikeHQDirectly(state, attackerKey) {
  const attacker = state.board[attackerKey];
  if (!attacker || state.turn === 1) return false;
  const opp = attacker.owner === 'p1' ? 'p2' : 'p1';
  return unitsOnBoard(state, opp).length === 0;
}

// hits is caller-supplied rather than re-derived from the Double Attack keyword here, so a
// unit completing its second attack mid-combat (see game.js's TARGETING handler — a Double
// Attack unit whose first hit just emptied the board) can request exactly the 1 hit it has
// left instead of a formula recomputing "Double Attack -> 2" and double-granting.
// Returns the same shape as resolveSingleAttack so callers can apply either result through
// the same code path — boardMutations is always empty (no unit is hit), so the existing
// wasDestroyed/kill-tracking checks downstream correctly no-op for a direct HQ strike.
export function resolveEmptyBoardStrike(state, attackerKey, hits) {
  const attacker = state.board[attackerKey];
  const card = CARD_BY_ID[attacker.cardId];
  const opp = attacker.owner === 'p1' ? 'p2' : 'p1';
  return {
    boardMutations: [],
    hqDamageToP1: opp === 'p1' ? hits : 0,
    hqDamageToP2: opp === 'p2' ? hits : 0,
    logEntries: [`${card.name} strikes ${opp.toUpperCase()}'s HQ directly — ${hits} HQ damage (no enemy units on board)`],
  };
}

// ── Direct HQ (doc 01 §19, doc 02 Q104-Q106) ────────────────────────────────
// Automatic FINAL end-of-turn pressure — NOT a normal Action-phase attack, and NOT a rewire
// of the old "Empty-Board HQ Strike" (which fired reactively mid-turn, only when the whole
// opponent board was empty). Direct HQ replaces that mechanic entirely: it runs exactly once,
// at end of turn, and evaluates EVERY unit independently regardless of whether the opponent's
// board is fully empty — a cornered unit with no reachable target converts even with other
// enemy units alive elsewhere on the board (something the old mechanic never covered).
//
// Per unit, in fixed board scan order:
//   - Suppressed/destroyed units are skipped unconditionally — they cannot attack at all,
//     checked BEFORE remaining-attacks/legal-target computation (doc 01 §9).
//   - remainingAttacks(unit) (state.js) already reflects the locked persistent-then-temporary
//     consumption model.
//   - getAttackableTargets already includes current temporary Bombard/Precision (via
//     getKeywords' tempKeywords/grantedKeywords) and a legal target blocks conversion even if
//     the attacker would lose the stat comparison (getAttackableTargets never checks
//     attackBeats — only resolveSingleAttack does).
//   - If no legal target: every remaining attack converts to 1 HQ damage, sequentially,
//     stopping immediately once the opponent's HQ would reach 0 (checked after each point of
//     damage, matching doc 01 §19 step 7's "check victory after each damage instance").
// Turn-1 lock: only whichever player moves first (chosen randomly, doc 02 Q005 — not always
// the "p1" role/label) can ever be active during state.turn === 1 (turn is a global counter
// that only advances via endTurn's initiative swap), so checking `state.turn === 1` correctly
// and exclusively targets the first-moving player's own first turn regardless of which p1/p2
// label they carry — the other player's first turn is necessarily state.turn === 2 and is
// never blocked here.
// Does not call resolveSingleAttack/applyHit and never touches boardMutations/kill-tracking,
// so it cannot trigger Rally (which requires an actual attack against an enemy Unit).
export function evaluateDirectHQ(state, activePlayer) {
  if (state.turn === 1) return { state, log: [], hqDamageToP1: 0, hqDamageToP2: 0 };

  const opponent = activePlayer === 'p1' ? 'p2' : 'p1';
  let s = state;
  const log = [];
  let hqDamageToP1 = 0, hqDamageToP2 = 0;

  for (const key of fixedScanOrder(Object.keys(s.board))) {
    const unit = s.board[key];
    if (!unit || unit.owner !== activePlayer || unit.state !== 'normal') continue;
    const remaining = remainingAttacks(unit);
    if (remaining <= 0) continue;
    if (getAttackableTargets(s, key).length > 0) continue; // legal target blocks conversion

    const card = CARD_BY_ID[unit.cardId];
    let u = unit;
    let currentOppHq = opponent === 'p1' ? s.p1.hq - hqDamageToP1 : s.p2.hq - hqDamageToP2;
    for (let i = 0; i < remaining && currentOppHq > 0; i++) {
      u = spendAttack(u);
      if (opponent === 'p1') hqDamageToP1 += 1; else hqDamageToP2 += 1;
      currentOppHq -= 1;
      log.push(`${card?.name ?? 'Unit'} strikes ${opponent.toUpperCase()}'s HQ directly — 1 HQ damage (no legal target)`);
    }
    s = { ...s, board: { ...s.board, [key]: u } };
  }

  return { state: s, log, hqDamageToP1, hqDamageToP2 };
}

// ── Hero column-freedom (Supreme Commander, H13) ────────────────────────────
// "Your other Heroes ignore their Column restrictions" — every other column-scoped Hero
// check consults this shared helper so there's one definition of what "column freedom" means.
export function hasColumnFreedom(playerState) {
  return (playerState.heroZones ?? []).includes('H13');
}

function inHeroScope(ps, heroId, col) {
  const zones = ps.heroZones ?? [null, null, null, null];
  if (!zones.includes(heroId)) return false;
  return hasColumnFreedom(ps) ? true : zones[col] === heroId;
}

// ── Hero passives — triggered on unit placement ─────────────────────────────
// H04 Objective Marshal and H08 Infantry Commander each grant a temporary bonus to the first
// qualifying Unit their controller plays each turn (gated on heroTriggeredThisTurn so each
// fires once per owner turn). grantedSideBonus/sideBonusTurns:1 clears at the owner's next
// startOfTurn — see the field comment in state.js. H21 Emergency Logistics Officer is
// board-wide and fires on the first Unit played each turn regardless of column/class,
// resolving AFTER that Unit's own On Play per doc 01 §22 (this function is already only
// ever called after the placed Unit's own On Play resolves, matching that ordering).
export function checkHeroPassivesOnPlace(s, active, col, key, card) {
  const ps = s[active];
  const triggered = ps.heroTriggeredThisTurn ?? {};
  const log = [];

  const fire = (heroId, amount, reason) => {
    const u = s.board[key];
    s = {
      ...s,
      board: { ...s.board, [key]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + amount, sideBonusTurns: 1 } },
      [active]: { ...s[active], heroTriggeredThisTurn: { ...s[active].heroTriggeredThisTurn, [heroId]: true } },
    };
    log.push(`${CARD_BY_ID[heroId].name}: ${card.name} +${amount} all sides (until your next turn) — ${reason}`);
  };

  if (inHeroScope(ps, 'H04', col) && !triggered['H04']) { // Objective Marshal — adjacent to an Objective
    const [row, colNum] = tileCoords(key);
    const onOrAdjacent = s.objectives[key] || adjacentTiles(row, colNum).some(({ key: k }) => s.objectives[k]);
    if (onOrAdjacent) fire('H04', 1, 'adjacent to Objective');
  }
  if (inHeroScope(ps, 'H08', col) && !triggered['H08'] && card.cls === 'Infantry') { // Infantry Commander
    fire('H08', 2, 'first Infantry this turn');
  }
  if ((ps.heroZones ?? []).includes('H21') && !triggered['H21']) { // Emergency Logistics Officer
    const fueled = gainFuel(s[active], 1); // normal capped gain (respects Logistics Chief via fuelCapOf), not "this turn" temp Fuel
    s = {
      ...s,
      [active]: { ...fueled, hq: fueled.hq - 1, heroTriggeredThisTurn: { ...fueled.heroTriggeredThisTurn, H21: true } },
    };
    log.push(`${CARD_BY_ID['H21'].name}: +1 Fuel, 1 damage to own HQ — first Unit played this turn`);
  }

  return { state: s, log };
}

// ── Hero passive — Counteroffensive General (H06) ───────────────────────────
// "The first friendly Unit that becomes Suppressed each turn gets +1 all sides until END OF
// YOUR NEXT TURN" — grantedSideBonus/sideBonusTurns:1 (clears at owner's next startOfTurn),
// NOT tempSideBonus (which would clear this same end of turn) — this is a longer-lasting
// grant than the old prototype's "until end of turn" version. Board-wide (no column gate).
// Owner is read from the hit unit itself so each player's own H06 (if deployed) is independent.
export function checkCounteroffensiveGeneral(s, key) {
  const unit = s.board[key];
  if (!unit) return { state: s, log: [] };
  const owner = unit.owner;
  const ps = s[owner];
  const zones = ps.heroZones ?? [null, null, null, null];
  if (!zones.includes('H06') || (ps.heroTriggeredThisTurn ?? {})['H06']) return { state: s, log: [] };

  const card = CARD_BY_ID[unit.cardId];
  const state = {
    ...s,
    board: { ...s.board, [key]: { ...unit, grantedSideBonus: (unit.grantedSideBonus || 0) + 1, sideBonusTurns: 1 } },
    [owner]: { ...ps, heroTriggeredThisTurn: { ...ps.heroTriggeredThisTurn, H06: true } },
  };
  return { state, log: [`${CARD_BY_ID['H06'].name}: ${card?.name ?? 'unit'} +1 all sides (until your next turn) — first Suppression this turn`] };
}

// Single funnel for "remove Suppression from this tile" so every command/Hero power that
// heals Suppression shares one hook point. Mirrors unsuppressOnBoard's own comment in state.js.
export function removeSuppression(s, key) {
  const { board, changed } = unsuppressOnBoard(s.board, key);
  if (!changed) return { state: s, log: [], changed: false };
  return { state: { ...s, board }, log: [], changed: true };
}

// ── Dynamic stat recalculation — Inspire / Muster ───────────────────────────
// Doc 01 §16: dynamic stat effects recalculate immediately whenever relevant battlefield
// state changes (Unit enters/leaves, movement, destruction). Rather than change getSideValue's
// signature everywhere it's called (many call sites need only a boardUnit+dir, not full board
// context), dynamic bonuses are precomputed into a `dynamicSideBonus` field on each BoardUnit
// whenever the board changes, and getSideValue sums it in exactly like tempSideBonus etc.
// (see state.js). Callers must call recalculateDynamicStats(state) after every placement,
// movement, or destruction — the 3 events that can change adjacency/board-Infantry-count.
//
// Inspire: the SOURCE unit (Motivator/Sergeant/Company Leader/Commanding Infantry) grants +1
// all sides to each ADJACENT friendly Unit while it remains on the battlefield. Multiple
// adjacent Inspire sources stack additively. A Suppressed Inspire source still projects its
// aura (doc 01 §9 — continuous/passive functions remain active while Suppressed).
// Muster: a Muster-keyword Unit gets +1 all sides for each OTHER friendly Infantry it
// controls, board-wide (not adjacency-based).
export function computeDynamicSideBonus(state, key) {
  const unit = state.board[key];
  if (!unit || unit.state === 'destroyed') return 0;
  const card = CARD_BY_ID[unit.cardId];
  if (!card) return 0;
  let bonus = 0;

  // Inspire received from adjacent friendly sources.
  const [row, col] = tileCoords(key);
  for (const { key: adjKey } of adjacentTiles(row, col)) {
    const adj = state.board[adjKey];
    if (!adj || adj.state === 'destroyed' || adj.owner !== unit.owner) continue;
    if (getKeywords(adj).includes('Inspire')) bonus += 1;
  }

  // Muster: +1 for each OTHER friendly Infantry, if this Unit itself has Muster.
  if (getKeywords(unit).includes('Muster')) {
    const otherFriendlyInfantry = unitsOnBoard(state, unit.owner).filter(
      ({ key: k, unit: u }) => k !== key && CARD_BY_ID[u.cardId]?.cls === 'Infantry'
    ).length;
    bonus += otherFriendlyInfantry;
  }

  return bonus;
}

export function recalculateDynamicStats(state) {
  const board = { ...state.board };
  for (const key of Object.keys(board)) {
    const unit = board[key];
    if (!unit || unit.state === 'destroyed') continue;
    board[key] = { ...unit, dynamicSideBonus: computeDynamicSideBonus(state, key) };
  }
  return { ...state, board };
}

// ── Rally ────────────────────────────────────────────────────────────────────
// Rally triggers whenever a Unit carrying the Rally keyword DECLARES/EXECUTES an attack
// against an enemy Unit — success not required (doc 01 §15). Direct HQ is NOT an attack
// against an enemy Unit and must never call this. Per-card effect dispatch by id, mirroring
// the destruction-chain / Hero-power switch pattern elsewhere in this codebase.
export function checkRally(s, attackerKey) {
  const unit = s.board[attackerKey];
  if (!unit) return { state: s, log: [] };
  if (!getKeywords(unit).includes('Rally')) return { state: s, log: [] };
  const card = CARD_BY_ID[unit.cardId];
  const owner = unit.owner;
  const log = [];
  const tag = `${card.name} (Rally):`;

  switch (card.id) {
    case 'I12': // Assault Trooper — draw 1
      s = { ...s, [owner]: drawCards(s[owner], 1) };
      log.push(`${tag} draw 1 card`);
      break;
    case 'I13': { // Combat Engager — random other friendly Infantry +1 all sides permanently
      const others = unitsOnBoard(s, owner).filter(({ key, unit: u }) => key !== attackerKey && CARD_BY_ID[u.cardId]?.cls === 'Infantry');
      if (others.length) {
        const pick = others[Math.floor(Math.random() * others.length)];
        const u = s.board[pick.key];
        s = { ...s, board: { ...s.board, [pick.key]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 } } };
        log.push(`${tag} ${CARD_BY_ID[u.cardId].name} +1 all sides (permanent)`);
      }
      break;
    }
    case 'I21': { // Commanding Infantry — all OTHER friendly Infantry +1 all sides permanently
      const others = unitsOnBoard(s, owner).filter(({ key, unit: u }) => key !== attackerKey && CARD_BY_ID[u.cardId]?.cls === 'Infantry');
      for (const { key: k } of others) {
        const u = s.board[k];
        s = { ...s, board: { ...s.board, [k]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 } } };
      }
      if (others.length) log.push(`${tag} all other friendly Infantry +1 all sides (permanent)`);
      break;
    }
    case 'I14': { // Veteran Raider — all adjacent friendly Units +1 all sides permanently
      const [row, col] = tileCoords(attackerKey);
      let any = false;
      for (const { key: adjKey } of adjacentTiles(row, col)) {
        const u = s.board[adjKey];
        if (!u || u.state === 'destroyed' || u.owner !== owner) continue;
        s = { ...s, board: { ...s.board, [adjKey]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 } } };
        any = true;
      }
      if (any) log.push(`${tag} adjacent friendly Units +1 all sides (permanent)`);
      break;
    }
    default:
      break;
  }
  return { state: s, log };
}

// ── Shared destruction chain (doc 01 §9) ────────────────────────────────────
// Single funnel for EVERY destruction source (normal combat kills, self-destroy Commands,
// Overrun-modified events) so Last Stand / Breakthrough / HQ-damage-replacement can never
// diverge between call sites. Chain: mark destroyed -> remove from board -> recalc dynamic
// state -> apply normal-or-replacement HQ damage -> recalc -> resolve destroyed Unit's Last
// Stand -> recalc -> resolve Breakthrough (if sourceUnitKey is still alive) -> recalc.
//
// options:
//   sourceUnitKey        — the attacking/causing Unit's board key, if any (for Breakthrough).
//   cause                — free-text tag for the log ('combat' | 'command' | 'overrun' | ...).
//   hqResultReplacement  — { targetHq: 'p1'|'p2', amount } to REPLACE the normal
//                           destruction-HQ result (e.g. Scorched Earth Raid); when present,
//                           the unit's owner's own-destruction HQ damage is skipped entirely
//                           and this amount is dealt to targetHq instead — applies even if
//                           the unit has Guard.
// Returns { state, log, hqDamageToP1, hqDamageToP2 }.
export function resolveDestructionChain(s, { unitKey, sourceUnitKey = null, cause = 'combat', hqResultReplacement = null }) {
  const dyingUnit = s.board[unitKey];
  if (!dyingUnit || dyingUnit.state === 'destroyed') return { state: s, log: [], hqDamageToP1: 0, hqDamageToP2: 0 };
  const card = CARD_BY_ID[dyingUnit.cardId];
  const owner = dyingUnit.owner;
  const log = [];
  let hqDamageToP1 = 0, hqDamageToP2 = 0;

  // 1-2. Mark destroyed, remove from board. Destroyed Units go to their owner's Discard Pile
  // (doc 02 Q026) — bookkeeping only, no current card reads this zone (doc 02 Q028).
  s = { ...s, board: { ...s.board, [unitKey]: { ...dyingUnit, state: 'destroyed' } } };
  s = { ...s, [owner]: { ...s[owner], discardPile: [...(s[owner].discardPile ?? []), dyingUnit.cardId] } };
  s = recalculateDynamicStats(s);

  // 3. Normal-or-replacement HQ damage. Normal: destroying a Unit deals 2 to its OWNER's HQ
  // (whether destroyed by an enemy or by its own controller) unless Guard reduces it to 0,
  // or an explicit replacement overrides both.
  const isGuard = getKeywords(dyingUnit).includes('Guard');
  if (hqResultReplacement) {
    const { targetHq, amount } = hqResultReplacement;
    if (targetHq === 'p1') hqDamageToP1 += amount; else hqDamageToP2 += amount;
    log.push(`${card?.name ?? 'Unit'} destroyed — HQ result replaced (${amount} to ${targetHq.toUpperCase()})`);
  } else if (!isGuard) {
    if (owner === 'p1') hqDamageToP1 += 2; else hqDamageToP2 += 2;
    log.push(`${card?.name ?? 'Unit'} destroyed — 2 HQ damage to ${owner.toUpperCase()}`);
  } else {
    log.push(`${card?.name ?? 'Unit'} (Guard) destroyed — 0 HQ damage`);
  }
  s = recalculateDynamicStats(s);

  // 4. Last Stand.
  if (getKeywords(dyingUnit).includes('Last Stand')) {
    const doubled = (s[owner]?.heroZones ?? []).includes('H14'); // Graves Registration Officer
    const usedTargets = new Set();
    for (let i = 0; i < (doubled ? 2 : 1); i++) {
      const r = runLastStandEffect(s, unitKey, dyingUnit, card, owner, usedTargets);
      s = r.state;
      log.push(...r.log);
      if (r.targetKey) usedTargets.add(r.targetKey);
    }
    s = recalculateDynamicStats(s);
  }

  // 5. Breakthrough (from the source Unit, if it's still alive and has Breakthrough).
  if (sourceUnitKey) {
    const sourceUnit = s.board[sourceUnitKey];
    if (sourceUnit && sourceUnit.state !== 'destroyed' && getKeywords(sourceUnit).includes('Breakthrough')) {
      const sourceCard = CARD_BY_ID[sourceUnit.cardId];
      const r = runBreakthroughEffect(s, sourceUnitKey, sourceUnit, sourceCard);
      s = r.state;
      log.push(...r.log);
      s = recalculateDynamicStats(s);
    }
  }

  return { state: s, log, hqDamageToP1, hqDamageToP2 };
}

// Lighter-weight sibling of resolveDestructionChain, for callers where the destroy mutation
// AND normal HQ damage have already been applied by something else (normal combat's own
// applyHit/resolveSingleAttack, which computes the correct 2-HQ-on-destroy result itself and
// would double-count if resolveDestructionChain's own HQ step also ran). Runs ONLY steps 4-5
// (Last Stand, then Breakthrough) plus dynamic-state recalculation — never touches HQ.
// `dyingUnit` is a snapshot of the unit taken immediately BEFORE it was removed/marked
// destroyed (for cardId/owner/keywords); `unitKey`'s tile should already reflect the destroy.
export function applyPostDestructionEffects(s, { unitKey, dyingUnit, sourceUnitKey = null }) {
  if (!dyingUnit) return { state: s, log: [] };
  const card = CARD_BY_ID[dyingUnit.cardId];
  const owner = dyingUnit.owner;
  const log = [];

  if (getKeywords(dyingUnit).includes('Last Stand')) {
    const doubled = (s[owner]?.heroZones ?? []).includes('H14'); // Graves Registration Officer
    const usedTargets = new Set();
    for (let i = 0; i < (doubled ? 2 : 1); i++) {
      const r = runLastStandEffect(s, unitKey, dyingUnit, card, owner, usedTargets);
      s = r.state;
      log.push(...r.log);
      if (r.targetKey) usedTargets.add(r.targetKey);
    }
    s = recalculateDynamicStats(s);
  }

  if (sourceUnitKey) {
    const sourceUnit = s.board[sourceUnitKey];
    if (sourceUnit && sourceUnit.state !== 'destroyed' && getKeywords(sourceUnit).includes('Breakthrough')) {
      const sourceCard = CARD_BY_ID[sourceUnit.cardId];
      const r = runBreakthroughEffect(s, sourceUnitKey, sourceUnit, sourceCard);
      s = r.state;
      log.push(...r.log);
      s = recalculateDynamicStats(s);
    }
  }

  return { state: s, log };
}

function runLastStandEffect(s, key, dyingUnit, card, owner, excludeKeys) {
  const log = [];
  const tag = `${card.name} (Last Stand):`;
  switch (card.id) {
    case 'I18': // Last Stand Soldier — draw 1
      s = { ...s, [owner]: drawCards(s[owner], 1) };
      log.push(`${tag} draw 1 card`);
      return { state: s, log };
    case 'I19': { // Final Defender — random friendly Infantry +1 all sides permanently
      const list = unitsOnBoard(s, owner).filter(({ key: k, unit: u }) => !excludeKeys.has(k) && CARD_BY_ID[u.cardId]?.cls === 'Infantry');
      if (!list.length) { log.push(`${tag} no friendly Infantry to target`); return { state: s, log }; }
      const pick = list[Math.floor(Math.random() * list.length)];
      const u = s.board[pick.key];
      s = { ...s, board: { ...s.board, [pick.key]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 99 } } };
      log.push(`${tag} ${CARD_BY_ID[u.cardId].name} +1 all sides (permanent)`);
      return { state: s, log, targetKey: pick.key };
    }
    case 'I22': { // Field Commander — adjacent friendly Infantry +1 all sides until end of turn
      const [row, col] = tileCoords(key);
      let any = false;
      for (const { key: adjKey } of adjacentTiles(row, col)) {
        const u = s.board[adjKey];
        if (!u || u.state === 'destroyed' || u.owner !== owner || CARD_BY_ID[u.cardId]?.cls !== 'Infantry') continue;
        s = { ...s, board: { ...s.board, [adjKey]: { ...u, tempSideBonus: (u.tempSideBonus || 0) + 1 } } };
        any = true;
      }
      if (any) log.push(`${tag} adjacent friendly Infantry +1 all sides (until end of turn)`);
      return { state: s, log };
    }
    default:
      return { state: s, log: [`${tag} not automated yet`] };
  }
}

function runBreakthroughEffect(s, key, unit, card) {
  const log = [];
  const tag = `${card.name} (Breakthrough):`;
  switch (card.id) {
    case 'T32': case 'T38': // Tank Hunter / Armored Spearhead — this Unit +1 all sides permanently
      s = { ...s, board: { ...s.board, [key]: { ...unit, grantedSideBonus: (unit.grantedSideBonus || 0) + 1, sideBonusTurns: 99 } } };
      log.push(`${tag} +1 all sides (permanent)`);
      return { state: s, log };
    case 'T33': { // Tank Destroyer — your next Tank costs 1 Fuel (set-cost; see discountFor's
      // `setCost` handling in state.js — other reductions can still stack on top, down to 0).
      s = { ...s, [unit.owner]: addDiscount(s[unit.owner], { appliesTo: 'Tank', column: null, setCost: 1 }) };
      log.push(`${tag} next Tank costs 1 Fuel`);
      return { state: s, log };
    }
    case 'T34': { // Breakthrough Tank — gains Armor (permanent — no "until" wording on this
      // card, so it must use permanentKeywords, not grantedKeywords which clears every
      // startOfTurn — see the BoardUnit shape comment in state.js)
      const kws = getKeywords(unit);
      if (!kws.includes('Armor') && !kws.includes('Heavy Armor')) {
        s = { ...s, board: { ...s.board, [key]: { ...unit, permanentKeywords: [...(unit.permanentKeywords || []), 'Armor'] } } };
        log.push(`${tag} gains Armor (permanent)`);
      }
      return { state: s, log };
    }
    case 'T35': { // Ace Tank — gains Double Attack (permanent — same permanentKeywords fix as T34)
      const kws = getKeywords(unit);
      if (!kws.includes('Double Attack')) {
        s = { ...s, board: { ...s.board, [key]: { ...unit, permanentKeywords: [...(unit.permanentKeywords || []), 'Double Attack'] } } };
        log.push(`${tag} gains Double Attack (permanent)`);
      }
      return { state: s, log };
    }
    default:
      return { state: s, log: [] };
  }
}

// ── Bombard targeting ────────────────────────────────────────────────────────

// Returns all tiles in the same row and column as the Bombard unit.
// Bombard can attack any enemy in its row OR column (line attack, any distance).
function getBombardTargets(row, col) {
  const targets = [];
  for (let r = 0; r < 4; r++) {
    if (r !== row) targets.push({ key: tileKey(r, col), dir: r < row ? 'n' : 's' });
  }
  for (let c = 0; c < 4; c++) {
    if (c !== col) targets.push({ key: tileKey(row, c), dir: c < col ? 'w' : 'e' });
  }
  return targets;
}

// ── getAttackableTargets ──────────────────────────────────────────────────────
// Rewritten 2026-08-31 (Run 1, Set 1 truth-lock) per doc 01 §10 / doc 02 Q92-Q100 — Guard is
// now ATTACKER-SPECIFIC LEGAL-TARGET PRIORITY, not adjacency-based protection:
//   1. Compute the attacker's raw candidate pool (adjacent enemies normally; same row/column
//      for Bombard) — filtered only to enemy-owned, NOT DESTROYED. Suppressed enemies remain
//      eligible candidates (doc 01 §9: Suppressed Units remain legal targets).
//   2. If the attacker has Precision, return the raw pool unfiltered — Precision ignores
//      Guard priority entirely and applies uniformly, including to Bombard attackers (the old
//      "Bombard always bypasses Guard" behavior is REMOVED — doc 02 Q100 is explicit that
//      Bombard obeys Guard like any other attacker unless it also has Precision).
//   3. Otherwise: if the pool contains any Guard candidate — SUPPRESSED OR NOT (doc 01 §9:
//      Suppressed Units keep their passive/continuous functions, including Guard) — restrict
//      to Guard candidates only. Guards do not protect other Guards in any special sense: a
//      Guard-vs-Guard attacker still just sees "the pool is all Guard," which is already the
//      correct legal-target set with no extra logic needed.
// Double Attack's second hit now recomputes this fresh (no more `skipGuard` bypass) — doc 02
// Q92-96 describes Guard as computed per-attack from the attacker's CURRENT legal-target set,
// with no keyword- or hit-number-based exception.
export function getAttackableTargets(state, attackerKey) {
  const [row, col] = tileCoords(attackerKey);
  const attacker = state.board[attackerKey];
  if (!attacker) return [];

  const card = CARD_BY_ID[attacker.cardId];
  if (!card || card.type !== "unit") return [];

  const kws = getKeywords(attacker);
  const owner = attacker.owner;

  const rawCandidates = kws.includes("Bombard")
    ? getBombardTargets(row, col)
    : adjacentTiles(row, col);

  const candidates = rawCandidates.filter(({ key }) => {
    const tile = state.board[key];
    return tile && tile.owner !== owner && tile.state !== "destroyed";
  });

  if (candidates.length === 0) return [];
  if (kws.includes("Precision")) return candidates;

  const guardCandidates = candidates.filter(({ key }) => getKeywords(state.board[key]).includes("Guard"));
  return guardCandidates.length > 0 ? guardCandidates : candidates;
}

// ── Craft (H25 Chief Aircraft Engineer, doc 01 §28) ─────────────────────────
// Stats pool has 3 slots: one fixed 6/6/6/6, two independent random-27 rolls (so a random
// line is twice as likely as the fixed one per candidate, matching the literal 3-item pool).
// Keyword: one of Bombard/Double Attack/Armor. Drawback: one of the 3 below. Each candidate
// picks independently across all three pools.
function randomStatsTotaling27() {
  // Stick-breaking: 3 random cut points in [0,27] split the range into 4 non-negative parts
  // summing to exactly 27 — satisfies doc 01's "min 0 each side, no max" constraint; the
  // exact distribution algorithm is implementation-defined per doc 05 §20.
  const cuts = [0, 27, Math.floor(Math.random() * 28), Math.floor(Math.random() * 28), Math.floor(Math.random() * 28)].sort((a, b) => a - b);
  return { n: cuts[1] - cuts[0], e: cuts[2] - cuts[1], s: cuts[3] - cuts[2], w: cuts[4] - cuts[3] };
}

const CRAFT_KEYWORD_POOL = ['Bombard', 'Double Attack', 'Armor'];
const CRAFT_DRAWBACK_POOL = ['rotateAll', 'ownHqDamage', 'suppressRandomFriendly'];

export function generateCraftCandidates() {
  const candidates = [];
  for (let i = 0; i < 3; i++) {
    const statsRoll = Math.floor(Math.random() * 3); // 0 = fixed 6/6/6/6, 1-2 = random27
    const stats = statsRoll === 0 ? { n: 6, e: 6, s: 6, w: 6 } : randomStatsTotaling27();
    const keyword = CRAFT_KEYWORD_POOL[Math.floor(Math.random() * CRAFT_KEYWORD_POOL.length)];
    const drawback = CRAFT_DRAWBACK_POOL[Math.floor(Math.random() * CRAFT_DRAWBACK_POOL.length)];
    candidates.push({ stats, keyword, drawback });
  }
  return candidates;
}

const DRAWBACK_LABEL = {
  rotateAll: 'Rotate every friendly Unit (including itself) randomly left/right',
  ownHqDamage: 'Deal 3 damage to own HQ',
  suppressRandomFriendly: 'Suppress 1 random friendly Unit',
};

// Registers the chosen candidate as a real card (js/cards.js's CARD_BY_ID) and returns it.
// Does not add it to hand — caller does that (mirrors normal draw/discard handling so
// hand-overflow rules apply identically to a Craft pick). `role` namespaces the generated id
// so two clients crafting independently online never collide — see cards.js.
export function craftCandidateToCard(candidate, role) {
  return registerGeneratedCard({
    // No `copies` field: copy-limit accounting never applies to a generated id (it can't appear
    // in a deck list at build time, only get created at runtime), so there's nothing to cap —
    // and unlike every static card, this object now also has to survive a Firebase `set()` (see
    // generatedCards in game.js), which rejects the whole write outright if any value is
    // Infinity/NaN. `copies: Infinity` was that exact landmine; 2026-09-01, caught live.
    name: 'Crafted Aircraft', cls: 'Aircraft', rarity: 'Common', type: 'unit',
    cost: 1, keyword: candidate.keyword,
    n: candidate.stats.n, e: candidate.stats.e, s: candidate.stats.s, w: candidate.stats.w,
    ability: `On Play: ${DRAWBACK_LABEL[candidate.drawback]}.`,
    craftDrawback: candidate.drawback,
  }, role);
}

// Resolves a crafted Aircraft's On Play drawback — fires immediately after it enters the
// battlefield (doc 01 §28's "drawback timing"). The crafted Aircraft is itself a friendly
// Unit by this point, so "each/a random friendly Unit" can select it unless noted otherwise.
export function resolveCraftDrawback(s, ownerRole, unitKey, drawback) {
  const log = [];
  if (drawback === 'rotateAll') {
    let board = { ...s.board };
    for (const key of fixedScanOrder(Object.keys(board))) {
      const u = board[key];
      if (!u || u.owner !== ownerRole || u.state === 'destroyed') continue;
      const dir = Math.random() < 0.5 ? 90 : -90;
      board[key] = { ...u, rotation: (((u.rotation ?? 0) + dir) % 360 + 360) % 360 };
    }
    s = { ...s, board };
    log.push('Craft drawback: every friendly Unit independently rotates 90° left or right');
  } else if (drawback === 'ownHqDamage') {
    s = { ...s, [ownerRole]: { ...s[ownerRole], hq: s[ownerRole].hq - 3 } };
    log.push('Craft drawback: 3 damage to own HQ');
  } else if (drawback === 'suppressRandomFriendly') {
    const list = unitsOnBoard(s, ownerRole).filter(({ unit }) => unit.state === 'normal');
    if (list.length) {
      const pick = list[Math.floor(Math.random() * list.length)];
      s = { ...s, board: { ...s.board, [pick.key]: { ...pick.unit, state: 'suppressed' } } };
      log.push(`Craft drawback: ${CARD_BY_ID[pick.unit.cardId]?.name ?? 'a friendly Unit'} suppressed`);
    }
  }
  return { state: recalculateDynamicStats(s), log };
}

// H25's activation-cost progression: 5 -> 4 -> 3 -> 2 -> 1 -> 1... (min 1), never resets
// except via a full match restart. Stored on PlayerState as `nextCraftCost` (starts at 5).
export function nextCraftCost(playerState) {
  return playerState.nextCraftCost ?? 5;
}
export function advanceCraftCost(playerState) {
  return { ...playerState, nextCraftCost: Math.max(1, nextCraftCost(playerState) - 1) };
}

// ── Hand-instance stat buff (Training Officer, H19) ─────────────────────────
// "Give all 1- and 2-cost Units currently in hand +1 all sides permanently." Hand is a bare
// array of card ids (no per-instance state), so a card already in hand can't be buffed in
// place without giving every hand card an instance identity — a real architecture change this
// plan avoids making just for one Hero. Instead, reuse the same registration mechanism Craft
// already uses: replace each qualifying hand slot's id with a freshly-registered clone of that
// card with +1 all sides, permanently. Two copies of the same printed card in hand become two
// independent clones — correct, since each is buffed as its own instance.
// `role` namespaces each buffed clone's generated id (see cards.js) and lets the caller thread
// the resulting definitions into shared state's `generatedCards` so they sync to the other
// client online — `generated` returns every newly-created clone for exactly that purpose.
export function applyHandBuff(playerState, amount, filterFn, role) {
  const log = [];
  const generated = [];
  const newHand = playerState.hand.map(cardId => {
    const card = CARD_BY_ID[cardId];
    if (!card || card.type !== 'unit' || !filterFn(card)) return cardId;
    const buffed = registerGeneratedCard({
      ...card, n: card.n + amount, e: card.e + amount, s: card.s + amount, w: card.w + amount,
    }, role);
    generated.push(buffed);
    log.push(`${card.name} +${amount} all sides (permanent)`);
    return buffed.id;
  });
  return { playerState: { ...playerState, hand: newHand }, log, generated };
}

// ── Maneuver (doc 01 §6) ─────────────────────────────────────────────────────
// Move the chosen Unit to any other legal, EMPTY battlefield tile — no distance/adjacency/
// row/column limit. Terrain restrictions still apply (Tank can't Maneuver into Forest, etc.
// — reuses the same canPlaceOnTerrain check as deployment). Preserves orientation and
// attack-used state (persistentSpent/tempExtraAttacks carry over unchanged). Does not
// retrigger On Play. Does not reset attacks — H16/C35-style effects that DO reset attacks
// call resetPersistentAttacks (state.js) explicitly afterward; that reset is not intrinsic
// to Maneuver itself.
export function getManeuverTargets(state, unitKey) {
  const unit = state.board[unitKey];
  if (!unit) return [];
  const card = CARD_BY_ID[unit.cardId];
  if (!card) return [];
  const targets = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const key = tileKey(r, c);
      if (key === unitKey) continue;
      if (state.board[key] !== null && state.board[key] !== undefined) continue; // occupied
      if (state.objectives?.[key]) continue; // Objective tiles are never occupiable
      const terrain = getTerrain(state.mapId, r, c);
      if (!canPlaceOnTerrain(card, terrain)) continue;
      targets.push(key);
    }
  }
  return targets;
}

// Moves the unit, preserving orientation/attack-state/keywords/buffs — everything except
// board position. Caller is responsible for validating destKey via getManeuverTargets first.
export function resolveManeuver(state, unitKey, destKey) {
  const unit = state.board[unitKey];
  if (!unit) return { state, log: [] };
  const card = CARD_BY_ID[unit.cardId];
  const newBoard = { ...state.board, [unitKey]: null, [destKey]: unit };
  const newState = recalculateDynamicStats({ ...state, board: newBoard });
  return { state: newState, log: [`${card?.name ?? 'Unit'} maneuvered to ${destKey}`] };
}

// ── Blast / Barrage secondary targeting ─────────────────────────────────────
// Both trigger only after a successful primary Hit (doc 01 §13-14). Neither is blocked by
// intervening Units (matches Bombard's own no-blocker convention). Guard does NOT redirect
// or prevent either — they hit whatever enemy Units occupy the computed secondary tiles,
// full stop. Multiple secondary targets resolve in fixed board scan order (leftmost column
// top->bottom, then next columns), each fully resolved before the next.
const PERPENDICULAR = { n: ['e', 'w'], s: ['e', 'w'], e: ['n', 's'], w: ['n', 's'] };

function blastSecondaryKeys(targetKey, dir) {
  const [r, c] = tileCoords(targetKey);
  return PERPENDICULAR[dir]
    .map(side => { const [dr, dc] = DIR_OFFSET[side]; return [r + dr, c + dc]; })
    .filter(([r, c]) => r >= 0 && r < 4 && c >= 0 && c < 4)
    .map(([r, c]) => tileKey(r, c));
}

function barrageSecondaryKeys(targetKey, dir) {
  const [r, c] = tileCoords(targetKey);
  const [dr, dc] = DIR_OFFSET[dir];
  const keys = [];
  let nr = r + dr, nc = c + dc;
  while (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
    keys.push(tileKey(nr, nc));
    nr += dr; nc += dc;
  }
  return keys;
}

function fixedScanOrder(keys) {
  return [...keys].sort((a, b) => {
    const [ar, ac] = tileCoords(a), [br, bc] = tileCoords(b);
    return ac !== bc ? ac - bc : ar - br;
  });
}

// Resolves Hits against every enemy Unit found at `keys` (owner-filtered, not-destroyed),
// in fixed board scan order, folding each into boardMutations/hqDamage/log. Does not apply
// Guard (secondary AoE ignores Guard priority per doc 01 §13-14) and does not chain further
// Blast/Barrage off a secondary Hit.
function resolveSecondaryHits(state, keys, attackerOwner) {
  const boardMutations = [];
  let hqDamageToP1 = 0, hqDamageToP2 = 0;
  const logEntries = [];
  for (const key of fixedScanOrder(keys)) {
    const tile = state.board[key];
    if (!tile || tile.owner === attackerOwner || tile.state === 'destroyed') continue;
    const { newUnit, hqDamage } = applyHit(tile);
    const finalUnit = newUnit.state === 'destroyed' ? null : newUnit;
    boardMutations.push({ key, newUnit: finalUnit });
    if (tile.owner === 'p1') hqDamageToP1 += hqDamage; else hqDamageToP2 += hqDamage;
    const name = CARD_BY_ID[tile.cardId]?.name ?? '?';
    const label = finalUnit === null ? 'Destroyed' : newUnit.state === 'suppressed' ? 'Suppressed' : 'armor absorbed';
    logEntries.push(`  (secondary) -> ${name}: ${label}`);
  }
  return { boardMutations, hqDamageToP1, hqDamageToP2, logEntries };
}

// ── resolveSingleAttack ───────────────────────────────────────────────────────

// Resolves one unit attacking one specific target tile.
// Finds direction from attackerKey to targetKey.
// If attack fails (attacker side value < defender opposite side; tie = attacker wins):
//   returns empty mutations, 0 damage, and a log entry.
// If attack succeeds:
//   calls applyHit on the defender.
//   if result state === "destroyed", sets newUnit = null in boardMutations (removes from board).
//
// Returns:
//   boardMutations: [{ key, newUnit }] — newUnit may be null (destroyed).
//   hqDamageToP1:  HQ damage dealt TO P1's HQ this attack.
//   hqDamageToP2:  HQ damage dealt TO P2's HQ this attack.
//   logEntries:    human-readable strings for the game log.
export function resolveSingleAttack(state, attackerKey, targetKey) {
  const attacker = state.board[attackerKey];
  const defender = state.board[targetKey];

  const empty = { boardMutations: [], hqDamageToP1: 0, hqDamageToP2: 0, logEntries: [] };

  if (!attacker || !defender) return empty;

  const attackerCard = CARD_BY_ID[attacker.cardId];
  const defenderCard = CARD_BY_ID[defender.cardId];
  if (!attackerCard || attackerCard.type !== "unit") return empty;

  // Determine direction from attacker to target.
  const [ar, ac] = tileCoords(attackerKey);
  const [dr, dc] = tileCoords(targetKey);
  const rowDiff = dr - ar;
  const colDiff = dc - ac;

  let dir = null;
  if (colDiff === 0 && rowDiff < 0) dir = "n";
  else if (colDiff === 0 && rowDiff > 0) dir = "s";
  else if (rowDiff === 0 && colDiff > 0) dir = "e";
  else if (rowDiff === 0 && colDiff < 0) dir = "w";

  if (!dir) return empty;

  const attackerSide = getSideValue(attacker, dir);
  const defenderSide = getSideValue(defender, oppositeDir(dir));

  const attackerName = attackerCard.name;
  const defenderName = defenderCard?.name ?? "?";

  if (!attackBeats(attacker, dir, defender)) {
    return {
      boardMutations: [],
      hqDamageToP1: 0,
      hqDamageToP2: 0,
      logEntries: [
        `${attackerName} attacked ${defenderName} — failed (${attackerSide} vs ${defenderSide})`
      ],
    };
  }

  const { newUnit: hitUnit, hqDamage } = applyHit(defender);

  // If destroyed, set newUnit to null so the caller removes the tile.
  const finalUnit = hitUnit.state === "destroyed" ? null : hitUnit;

  const boardMutations = [{ key: targetKey, newUnit: finalUnit }];

  let hqDamageToP1 = 0;
  let hqDamageToP2 = 0;
  if (defender.owner === "p1") {
    hqDamageToP1 = hqDamage;
  } else {
    hqDamageToP2 = hqDamage;
  }

  const stateLabel =
    finalUnit === null        ? "Destroyed" :
    hitUnit.state === "suppressed" ? "Suppressed" :
    "armor absorbed";

  const logEntries = [
    `${attackerName} → ${defenderName}: ${stateLabel} (${attackerSide} vs ${defenderSide})`
  ];

  // Blast / Barrage: only after a successful primary Hit (this point is unreachable otherwise
  // — attackBeats already returned false above). Primary target has already resolved above.
  const attackerKws = getKeywords(attacker);
  const secondaryKeys = [
    ...(attackerKws.includes('Blast') ? blastSecondaryKeys(targetKey, dir) : []),
    ...(attackerKws.includes('Barrage') ? barrageSecondaryKeys(targetKey, dir) : []),
  ];
  if (secondaryKeys.length) {
    const secondary = resolveSecondaryHits(state, secondaryKeys, attacker.owner);
    boardMutations.push(...secondary.boardMutations);
    hqDamageToP1 += secondary.hqDamageToP1;
    hqDamageToP2 += secondary.hqDamageToP2;
    logEntries.push(...secondary.logEntries);
  }

  return { boardMutations, hqDamageToP1, hqDamageToP2, logEntries };
}
