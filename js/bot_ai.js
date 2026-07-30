// Rule-accurate move scorer for the self-play test bot.
// Imports the SAME pure engine functions game.js uses (state.js / combat.js / maps.js) —
// no reimplementation of combat/placement rules, so the bot can't drift from real game behavior.
// Given a live state snapshot (read from window.__SIGNAL_DEBUG__ in the browser), this module
// picks the best legal action. It does not touch the DOM — callers (selfplay_test.mjs,
// bot_player.js) execute the chosen action via clicks.
import { CARD_BY_ID } from "./cards.js";
import { getAttackableTargets, resolveSingleAttack } from "./combat.js";
import { getKeywords, maxArmorHits } from "./state.js";
import { canPlaceOnTerrain, getTerrain } from "./maps.js";

const W_HQ = 10;      // weight per point of HQ damage dealt/avoided
const W_MATERIAL = 3; // weight per "state step" (normal→suppressed→destroyed) inflicted/risked

function severityStep(before, after) {
  const rank = { normal: 0, suppressed: 1, destroyed: 2 };
  return rank[after?.state ?? "destroyed"] - rank[before?.state ?? "normal"];
}

// Score a single attack: attackerKey (existing board unit) → targetKey.
function scoreAttack(state, attackerKey, targetKey) {
  const defenderBefore = state.board[targetKey];
  const result = resolveSingleAttack(state, attackerKey, targetKey);
  if (result.boardMutations.length === 0) return { score: -1, hqDamage: 0, succeeded: false }; // failed attack — never worth it over a pass
  const defenderAfter = result.boardMutations[0].newUnit;
  const hqDamage = defenderBefore.owner === "p1" ? result.hqDamageToP1 : result.hqDamageToP2;
  const matSwing = severityStep(defenderBefore, defenderAfter);
  return { score: hqDamage * W_HQ + matSwing * W_MATERIAL, hqDamage, succeeded: true };
}

// Best attack available for a specific friendly unit already on the board.
export function bestAttackForUnit(state, unitKey) {
  const targets = getAttackableTargets(state, unitKey);
  let best = null;
  for (const t of targets) {
    const s = scoreAttack(state, unitKey, t.key);
    if (s.succeeded && (!best || s.score > best.score)) best = { targetKey: t.key, ...s };
  }
  return best;
}

export function maxAttacksFor(unit) {
  return getKeywords(unit).includes("Double Attack") ? 2 : 1;
}

// Best not-yet-exhausted friendly unit + target this turn (attackedMap: tileKey -> attacks used so far).
export function bestExistingAttack(state, active, attackedMap = new Map()) {
  let best = null;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    if ((attackedMap.get(key) ?? 0) >= maxAttacksFor(unit)) continue;
    const atk = bestAttackForUnit(state, key);
    if (atk && (!best || atk.score > best.score)) best = { unitKey: key, ...atk };
  }
  return best;
}

// Does any legal, not-yet-exhausted attack right now drop the opponent's HQ to <= 0?
export function findLethal(state, active, attackedMap = new Map()) {
  const opp = active === "p1" ? "p2" : "p1";
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    if ((attackedMap.get(key) ?? 0) >= maxAttacksFor(unit)) continue;
    const targets = getAttackableTargets(state, key);
    for (const t of targets) {
      const s = scoreAttack(state, key, t.key);
      if (s.succeeded && s.hqDamage >= state[opp].hq) return { attackerKey: key, targetKey: t.key };
    }
  }
  return null;
}

// Rough danger score: strongest single hit an adjacent enemy could land on unitKey next turn.
function exposureRisk(state, unitKey) {
  const [r, c] = unitKey.split(",").map(Number);
  const adj = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].map(([rr, cc]) => `${rr},${cc}`);
  const unit = state.board[unitKey];
  let worst = 0;
  for (const ak of adj) {
    const enemy = state.board[ak];
    if (!enemy || enemy.owner === unit.owner || enemy.state !== "normal") continue;
    const s = scoreAttack(state, ak, unitKey);
    if (s.succeeded) worst = Math.max(worst, s.hqDamage * W_HQ + 1 * W_MATERIAL);
  }
  return worst;
}

// Best (cardId, tileKey) placement among affordable unit cards in hand and empty legal tiles.
// Scores by: immediate follow-up attack value (if the new unit can swing right away) minus
// how exposed it'd be to an enemy counter-attack next turn.
export function bestPlacement(state, active, handUnitCardIds, emptyTileKeys) {
  let best = null;
  for (const cardId of handUnitCardIds) {
    const card = CARD_BY_ID[cardId];
    if (!card) continue;
    for (const key of emptyTileKeys) {
      const [r, c] = key.split(",").map(Number);
      const terrain = getTerrain(state.mapId, r, c);
      if (!canPlaceOnTerrain(card, terrain)) continue;

      const hypoUnit = { cardId, owner: active, state: "normal", armorHits: 0, tempKeywords: [], grantedKeywords: [], tempSideBonus: 0, justPlaced: true };
      const hypoState = { ...state, board: { ...state.board, [key]: hypoUnit } };

      const atk = bestAttackForUnit(hypoState, key);
      const attackScore = atk ? atk.score : 0;
      const risk = exposureRisk(hypoState, key);
      const score = attackScore - risk;

      if (!best || score > best.score) best = { cardId, tileKey: key, score, followUpAttack: atk };
    }
  }
  return best;
}

// For direct-damage commands (Artillery Barrage 16, Air Strike 20, Suppressing Fire 79):
// prefer the enemy unit closest to being destroyed (best chance of securing a kill).
export function bestDamageCommandTarget(state, active, candidateKeys) {
  let best = null;
  for (const key of candidateKeys) {
    const unit = state.board[key];
    if (!unit) continue;
    const armor = maxArmorHits(unit);
    const remaining = (armor - unit.armorHits) + (unit.state === "normal" ? 2 : unit.state === "suppressed" ? 1 : 0);
    // Lower "remaining hits to destroy" = better target. Guard units are riskier to leave up.
    const guardBonus = getKeywords(unit).includes("Guard") ? 1 : 0;
    const score = -remaining + guardBonus;
    if (!best || score > best.score) best = { targetKey: key, score };
  }
  return best;
}
