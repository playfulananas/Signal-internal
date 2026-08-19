import { CARD_BY_ID } from './cards.js?v=1787179497';
import { getSideValue, getKeywords, attackBeats, applyHit, oppositeDir, unsuppressOnBoard, drawCards, addDiscount } from './state.js?v=1787179497';

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

// ── Hero passives — triggered on unit placement ─────────────────────────────
// Objective Marshal (94), Infantry Commander (104), Combined Arms General (109), and
// Conventional Warfare Commander (110) each grant "+1 all sides until your next turn" to
// the first qualifying Unit their controller plays each turn. Each gates on
// heroTriggeredThisTurn so it fires once per owner turn no matter how many cards are
// played. grantedSideBonus/sideBonusTurns:1 clears at the owner's next startOfTurn — see
// the field comment in state.js.
// Pure: takes/returns state, does no DOM or CARD_BY_ID lookups beyond names for the log.
// hasColumnFreedom / inHeroScope: Supreme Commander (143) — "your other Heroes' column-scoped
// powers affect your whole board instead of just their own column." Shared by every
// column-scoped Hero check (here and heroTargetKeys/applyHeroPower's 91/92/100/142/145 cases in
// game.js) so there's one definition of what "column freedom" means, not one per Hero.
export function hasColumnFreedom(playerState) {
  return (playerState.heroZones ?? []).includes(143);
}

export function checkHeroPassivesOnPlace(s, active, col, key, card) {
  const ps = s[active];
  const zones = ps.heroZones ?? [null, null, null, null];
  const triggered = ps.heroTriggeredThisTurn ?? {};
  const freedom = hasColumnFreedom(ps);
  const inScope = heroId => freedom ? zones.includes(heroId) : zones[col] === heroId;
  const log = [];

  const fire = (heroId, heroName, reason) => {
    const u = s.board[key];
    s = {
      ...s,
      board: { ...s.board, [key]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 1 } },
      [active]: { ...s[active], heroTriggeredThisTurn: { ...s[active].heroTriggeredThisTurn, [heroId]: true } },
    };
    log.push(`${heroName}: ${card.name} +1 all sides (until your next turn) — ${reason}`);
  };

  if (inScope(94) && !triggered[94]) { // Objective Marshal — on/adjacent to an Objective
    const [row, colNum] = tileCoords(key);
    const onOrAdjacent = s.objectives[key] || adjacentTiles(row, colNum).some(({ key: k }) => s.objectives[k]);
    if (onOrAdjacent) fire(94, CARD_BY_ID[94].name, 'on/adjacent to Objective');
  }
  if (inScope(104) && !triggered[104] && card.cls === 'Infantry') { // Infantry Commander
    fire(104, CARD_BY_ID[104].name, 'first Infantry this turn');
  }
  if (inScope(110) && !triggered[110] && !card.keyword) { // Conventional Warfare Commander
    fire(110, CARD_BY_ID[110].name, 'first vanilla Unit this turn');
  }
  if (zones.includes(109) && !triggered[109] && ps.lastUnitClass != null && ps.lastUnitClass !== card.cls) {
    fire(109, CARD_BY_ID[109].name, 'mixed-class army'); // Combined Arms General — board-wide
  }

  s = { ...s, [active]: { ...s[active], lastUnitClass: card.cls } };
  return { state: s, log };
}

// Pending stat buffs queued by Deathrattle: Convoy Escort (138) — "your next Naval Unit played
// gets +1 all sides." Mirrors discountFor/consumeDiscounts' one-shot-list shape but for a stat
// bonus rather than a Fuel discount (see pendingUnitBuffs in state.js). Call at the same
// placement site as checkHeroPassivesOnPlace/checkUnitOnPlayAbility.
// Sums ALL queued buffs matching this Unit's class and applies them together to the one
// Unit being placed, then clears all of them — not just the first match. This is what makes
// a doubled Deathrattle (Graves Registration Officer, 147, on Convoy Escort 138) stack onto
// a single next Naval Unit (+2) rather than spreading across the next two (+1 each) — per
// Filip 2026-08-19. Mirrors discountFor's own "sum every matching entry" behavior, just for
// a stat bonus instead of a Fuel discount. The QUEUED buff never expires on its own (still
// valid however many turns pass) but is fully consumed by the FIRST matching Unit played,
// never split further. The bonus, once APPLIED to that Unit, is PERMANENT — sideBonusTurns:99
// (same "effectively never expires in a real match" convention as Field Marshal 144), not
// "until your next turn" — corrected 2026-08-20, per Filip: was wrongly given a 1-turn limit
// like Veteran Battery (134), which is meant to be temporary; Convoy Escort's isn't.
export function checkPendingUnitBuff(s, active, key, card) {
  const ps = s[active];
  const pending = ps.pendingUnitBuffs ?? [];
  const matching = pending.filter(b => b.appliesTo === card.cls);
  if (!matching.length) return { state: s, log: [] };
  const total = matching.reduce((sum, b) => sum + b.amount, 0);
  const remaining = pending.filter(b => b.appliesTo !== card.cls);
  const u = s.board[key];
  const newState = {
    ...s,
    board: { ...s.board, [key]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + total, sideBonusTurns: 99 } },
    [active]: { ...ps, pendingUnitBuffs: remaining },
  };
  return { state: newState, log: [`${card.name} +${total} all sides (permanent) — queued bonus`] };
}

// ── Hero passive — Counteroffensive General (101) ───────────────────────────
// "The first friendly Unit that gets Suppressed each turn gets +1 all sides until END OF
// TURN" — tempSideBonus (cleared by endTurn for everyone), not grantedSideBonus like the
// "until your next turn" passives above. Board-wide (no column gate) — call this after any
// hit that transitions a unit's state to 'suppressed' (see applyHitAndCheckHero below).
// Owner is read from the hit unit itself, not passed in, so each player's own
// Counteroffensive General (if deployed) is checked independently.
export function checkCounteroffensiveGeneral(s, key) {
  const unit = s.board[key];
  if (!unit) return { state: s, log: [] };
  const owner = unit.owner;
  const ps = s[owner];
  const zones = ps.heroZones ?? [null, null, null, null];
  if (!zones.includes(101) || (ps.heroTriggeredThisTurn ?? {})[101]) return { state: s, log: [] };

  const card = CARD_BY_ID[unit.cardId];
  const state = {
    ...s,
    board: { ...s.board, [key]: { ...unit, tempSideBonus: (unit.tempSideBonus || 0) + 1 } },
    [owner]: { ...ps, heroTriggeredThisTurn: { ...ps.heroTriggeredThisTurn, 101: true } },
  };
  return { state, log: [`${CARD_BY_ID[101].name}: ${card?.name ?? 'unit'} +1 all sides (end of turn) — first Suppression this turn`] };
}

// Single funnel for "remove Suppression from this tile" so every command/Hero power that
// heals Suppression (Recovery Officer, Field Medic, Tactical Withdrawal... — see call sites
// in game.js) shares one hook point instead of four inline call sites. Mirrors
// unsuppressOnBoard's own comment in state.js. No longer checks Counteroffensive General —
// that passive now triggers on Suppression being applied, not removed (see
// checkCounteroffensiveGeneral call sites in game.js/combat.js instead).
export function removeSuppression(s, key) {
  const { board, changed } = unsuppressOnBoard(s.board, key);
  if (!changed) return { state: s, log: [], changed: false };
  return { state: { ...s, board }, log: [], changed: true };
}

// ── Unit on-play abilities ───────────────────────────────────────────────────
// Auto-resolving "On Play" triggers for the new v0.4 launch-filler units. Anything needing
// a player choice (Mobile Command Halftrack's optional Hero move, Radio Operator's top-2
// look) is handled separately in game.js via a modal, not here.
export function checkUnitOnPlayAbility(s, active, col, key, card) {
  const ps = s[active];
  const log = [];

  if (card.id === 119) { // Veteran Signal Corps — draw 1 if a Hero Power was activated last turn
    if (ps.heroActivatedLastTurn) {
      s = { ...s, [active]: drawCards(ps, 1) };
      log.push(`${card.name}: activated a Hero Power last turn — draw 1 card`);
    }
  }

  if (card.id === 112) { // Combat Engineers — if a friendly Hero is in this column, heal another unit here
    const zones = ps.heroZones ?? [null, null, null, null];
    if (zones[col] != null) {
      const candidate = unitsInColumn(s, col, active).find(({ key: k, unit }) => k !== key && unit.state === 'suppressed');
      if (candidate) {
        const result = removeSuppression(s, candidate.key);
        s = result.state;
        const healedName = CARD_BY_ID[s.board[candidate.key]?.cardId]?.name ?? 'unit';
        log.push(`${card.name}: ${healedName} un-suppressed`, ...result.log);
      }
    }
  }

  return { state: s, log };
}

// ── Deathrattle ──────────────────────────────────────────────────────────────
// Fires whenever a Unit carrying the Deathrattle keyword transitions to state:"destroyed" —
// by combat (resolveSingleAttack, Artillery Position, Air Strike/Suppressing Fire) or by a
// self-destroy Command (Sacrifice Play 140, Scorched Earth Rally 141). NOT triggered by
// Suppression alone, and not by leaving the board un-destroyed (Tactical Withdrawal).
// Callers must call this AFTER the destroy mutation is already committed to `s` — `key`'s
// tile should be empty (or about to be overwritten by a summon effect) when this runs, and
// `dyingUnit` is a snapshot of the unit taken BEFORE the mutation (for cardId/owner).
// Graves Registration Officer (147) doubles the effect — runs runDeathrattleEffect twice.
// `usedTargets` accumulates the board key each single-unit-target application picked (133/
// 134/135), so the SECOND application of a doubled resolution excludes it — per Filip
// 2026-08-19: a doubled effect must not land on the same card twice.
export function checkDeathrattle(s, key, dyingUnit) {
  if (!dyingUnit) return { state: s, log: [] };
  const card = CARD_BY_ID[dyingUnit.cardId];
  if (!card || !getKeywords(dyingUnit).includes('Deathrattle')) return { state: s, log: [] };
  const owner = dyingUnit.owner;
  const doubled = (s[owner]?.heroZones ?? []).includes(147);
  const log = [];
  const usedTargets = new Set();
  for (let i = 0; i < (doubled ? 2 : 1); i++) {
    const result = runDeathrattleEffect(s, key, dyingUnit, card, owner, usedTargets);
    s = result.state;
    log.push(...result.log);
    if (result.targetKey) usedTargets.add(result.targetKey);
  }
  return { state: s, log };
}

// Picks the first LIVE friendly unit adjacent to `key` (deterministic — the brainstorm text
// for this effect (135) didn't say "random", unlike 132/133/134/137 which explicitly do),
// excluding any key already used earlier in the same (possibly doubled) resolution.
function firstAdjacentFriendly(s, key, owner, excludeKeys = new Set()) {
  const [row, col] = tileCoords(key);
  return adjacentTiles(row, col)
    .map(({ key: k }) => k)
    .find(k => {
      if (excludeKeys.has(k)) return false;
      const u = s.board[k];
      return u && u.owner === owner && u.state !== 'destroyed';
    }) ?? null;
}

// Picks a RANDOM live friendly unit of the given class (132/133/134/137 all say "random").
// General rule (per Filip 2026-08-19): if `avoidKeyword` is given, skip any unit that already
// carries it (no point granting a keyword a unit already has) — do nothing if none qualify.
// `excludeKeys` additionally skips units already targeted earlier in the same doubled
// resolution (Graves Registration Officer, 147), so a double-trigger can't hit one card twice.
function randomFriendlyOfClass(s, owner, cls, { avoidKeyword = null, excludeKeys = new Set() } = {}) {
  const list = unitsOnBoard(s, owner).filter(({ key, unit }) => {
    if (CARD_BY_ID[unit.cardId]?.cls !== cls) return false;
    if (excludeKeys.has(key)) return false;
    if (avoidKeyword && getKeywords(unit).includes(avoidKeyword)) return false;
    return true;
  });
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// Removes one random matching card from `owner`'s deck and places it as a fresh Unit on `key`
// (132/137: "summon ... from the deck onto this tile"). The summoned unit does NOT get a
// placement attack or trigger on-play/Hero-passive checks — it enters via a Deathrattle, not
// by being played from hand, so justPlaced stays false.
function summonRandomFromDeck(s, owner, key, predicate) {
  const deck = s[owner].deck;
  const candidates = deck.map((id, i) => ({ id, i })).filter(({ id }) => predicate(CARD_BY_ID[id]));
  if (!candidates.length) return { state: s, log: [] };
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const newDeck = [...deck.slice(0, pick.i), ...deck.slice(pick.i + 1)];
  const newUnit = {
    cardId: pick.id, owner, state: 'normal', armorHits: 0,
    tempKeywords: [], grantedKeywords: [], tempSideBonus: 0, justPlaced: false, rotation: 0,
  };
  const newState = { ...s, board: { ...s.board, [key]: newUnit }, [owner]: { ...s[owner], deck: newDeck } };
  return { state: newState, log: [`Summoned ${CARD_BY_ID[pick.id].name} from deck`] };
}

// Per-card Deathrattle effect dispatch — mirrors applyHeroPower's switch-by-id pattern in
// game.js. Returns { state, log, targetKey } — targetKey (133/134/135 only) is the board key
// a single-unit-target effect picked, fed back into checkDeathrattle's excludeKeys for a
// doubled resolution's second application.
function runDeathrattleEffect(s, key, dyingUnit, card, owner, excludeKeys = new Set()) {
  const log = [];
  const tag = `${card.name} (Deathrattle):`;

  switch (card.id) {
    case 131: { // Forward Gun Crew — draw 1
      s = { ...s, [owner]: drawCards(s[owner], 1) };
      log.push(`${tag} draw 1 card`);
      break;
    }
    case 132: { // Salvage Battery — summon a random 1-cost friendly Artillery from deck
      const r = summonRandomFromDeck(s, owner, key, c => c?.type === 'unit' && c.cls === 'Artillery' && c.cost === 1);
      s = r.state;
      log.push(r.log.length ? `${tag} ${r.log[0]}` : `${tag} no 1-cost Artillery in deck`);
      break;
    }
    case 133: { // Ranging Section — give a random friendly Artillery (that doesn't already
      // have it) Bombard until your next turn. Was "until end of turn" via tempKeywords;
      // switched to grantedKeywords (2026-08-19, per Filip) — grantedKeywords already clears
      // at the OWNER'S next startOfTurn (see state.js), giving exactly "until your next turn."
      const pick = randomFriendlyOfClass(s, owner, 'Artillery', { avoidKeyword: 'Bombard', excludeKeys });
      if (!pick) { log.push(`${tag} no friendly Artillery to target`); break; }
      const u = s.board[pick.key];
      s = { ...s, board: { ...s.board, [pick.key]: { ...u, grantedKeywords: [...(u.grantedKeywords || []), 'Bombard'] } } };
      log.push(`${tag} ${CARD_BY_ID[u.cardId].name} gains Bombard (until your next turn)`);
      return { state: s, log, targetKey: pick.key };
    }
    case 134: { // Veteran Battery — give a random friendly Artillery +1 all sides
      const pick = randomFriendlyOfClass(s, owner, 'Artillery', { excludeKeys });
      if (!pick) { log.push(`${tag} no friendly Artillery to target`); break; }
      const u = s.board[pick.key];
      s = { ...s, board: { ...s.board, [pick.key]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 1 } } };
      log.push(`${tag} ${CARD_BY_ID[u.cardId].name} +1 all sides (until your next turn)`);
      return { state: s, log, targetKey: pick.key };
    }
    case 135: { // Rearguard Squad — adjacent friendly unit +1 all sides
      const adjKey = firstAdjacentFriendly(s, key, owner, excludeKeys);
      if (!adjKey) { log.push(`${tag} no adjacent friendly Unit`); break; }
      const u = s.board[adjKey];
      s = { ...s, board: { ...s.board, [adjKey]: { ...u, grantedSideBonus: (u.grantedSideBonus || 0) + 1, sideBonusTurns: 1 } } };
      log.push(`${tag} ${CARD_BY_ID[u.cardId].name} +1 all sides (until your next turn)`);
      return { state: s, log, targetKey: adjKey };
    }
    case 136: { // Salvage Crew — next Tank costs 1 less Fuel
      s = { ...s, [owner]: addDiscount(s[owner], { appliesTo: 'Tank', column: null, amount: 1, min: 0 }) };
      log.push(`${tag} next Tank costs 1 less Fuel`);
      break;
    }
    case 137: { // Squadron Reserve — summon a random 2-cost friendly Aircraft from deck
      const r = summonRandomFromDeck(s, owner, key, c => c?.type === 'unit' && c.cls === 'Aircraft' && c.cost === 2);
      s = r.state;
      log.push(r.log.length ? `${tag} ${r.log[0]}` : `${tag} no 2-cost Aircraft in deck`);
      break;
    }
    case 138: { // Convoy Escort — next Naval Unit played gets +1 all sides, permanently
      s = { ...s, [owner]: { ...s[owner], pendingUnitBuffs: [...(s[owner].pendingUnitBuffs || []), { appliesTo: 'Naval', amount: 1 }] } };
      log.push(`${tag} next Naval Unit played gets +1 all sides (permanent)`);
      break;
    }
    default:
      log.push(`${tag} not automated yet`);
  }

  return { state: s, log };
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

// Returns { key, dir }[] of tiles the attacker at attackerKey can legally target.
// Filters out: friendly tiles, empty tiles, destroyed units.
// Guard enforcement: if any adjacent enemy has Guard keyword AND is not Suppressed,
//   only those Guard units are returned — attacker must hit them first.
//   skipGuard bypasses this (used for Double Attack's second hit).
//
// Bombard units target any enemy in the same row or column and bypass Guard enforcement.
export function getAttackableTargets(state, attackerKey, skipGuard = false) {
  const [row, col] = tileCoords(attackerKey);
  const attacker = state.board[attackerKey];
  if (!attacker) return [];

  const card = CARD_BY_ID[attacker.cardId];
  if (!card || card.type !== "unit") return [];

  const kws = getKeywords(attacker);
  const owner = attacker.owner;

  // Bombard: all enemies in same row or column, bypasses Guard enforcement.
  if (kws.includes("Bombard")) {
    return getBombardTargets(row, col).filter(({ key }) => {
      const tile = state.board[key];
      return tile && tile.owner !== owner && tile.state !== "destroyed";
    });
  }

  // Default / Double Attack: all adjacent enemies that are alive.
  const candidates = adjacentTiles(row, col).filter(({ key }) => {
    const tile = state.board[key];
    return tile && tile.owner !== owner && tile.state !== "destroyed";
  });

  if (candidates.length === 0) return [];

  if (skipGuard) return candidates;

  // Guard enforcement: if any alive adjacent enemy has Guard, restrict to Guard-only.
  const guardUnits = candidates.filter(({ key }) => {
    const tile = state.board[key];
    const tileKws = getKeywords(tile);
    return tileKws.includes("Guard") && tile.state !== "suppressed";
  });

  return guardUnits.length > 0 ? guardUnits : candidates;
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

  return {
    boardMutations,
    hqDamageToP1,
    hqDamageToP2,
    logEntries: [
      `${attackerName} → ${defenderName}: ${stateLabel} (${attackerSide} vs ${defenderSide})`
    ],
  };
}
