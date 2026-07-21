import { CARD_BY_ID } from './cards.js?v=1784634216';
import { getSideValue, getKeywords, attackBeats, applyHit, oppositeDir } from './state.js?v=1784634216';

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
