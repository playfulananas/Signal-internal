// Rule-accurate move scorer for the self-play test bot.
// Imports the SAME pure engine functions game.js uses (state.js / combat.js / maps.js) —
// no reimplementation of combat/placement rules, so the bot can't drift from real game behavior.
// Given a live state snapshot (read from window.__SIGNAL_DEBUG__ in the browser), this module
// picks the best legal action. It does not touch the DOM — callers (selfplay_test.mjs,
// bot_player.js) execute the chosen action via clicks.
import { CARD_BY_ID } from "./cards.js";
import { getAttackableTargets, resolveSingleAttack, canStrikeHQDirectly } from "./combat.js";
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

export function maxAttacksFor(unit) {
  return getKeywords(unit).includes("Double Attack") ? 2 : 1;
}

// Best attack available for a specific friendly unit already on the board. attackCount is
// how many of its attacks it's already used this turn (0 for a fresh/hypothetical unit) —
// needed so an Empty-Board HQ Strike (see combat.js) grants only the hits actually
// remaining, not a fresh Double Attack's full 2 every time this is called.
export function bestAttackForUnit(state, unitKey, attackCount = 0) {
  const targets = getAttackableTargets(state, unitKey);
  if (targets.length === 0) {
    if (!canStrikeHQDirectly(state, unitKey)) return null;
    const hits = maxAttacksFor(state.board[unitKey]) - attackCount;
    return { targetKey: null, isHQStrike: true, hits, hqDamage: hits, score: hits * W_HQ, succeeded: true };
  }
  let best = null;
  for (const t of targets) {
    const s = scoreAttack(state, unitKey, t.key);
    if (s.succeeded && (!best || s.score > best.score)) best = { targetKey: t.key, ...s };
  }
  return best;
}

// Best not-yet-exhausted friendly unit + target this turn (attackedMap: tileKey -> attacks used so far).
export function bestExistingAttack(state, active, attackedMap = new Map()) {
  let best = null;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    const attackCount = attackedMap.get(key) ?? 0;
    if (attackCount >= maxAttacksFor(unit)) continue;
    const atk = bestAttackForUnit(state, key, attackCount);
    if (atk && (!best || atk.score > best.score)) best = { unitKey: key, ...atk };
  }
  return best;
}

// Does any legal, not-yet-exhausted attack right now drop the opponent's HQ to <= 0?
export function findLethal(state, active, attackedMap = new Map()) {
  const opp = active === "p1" ? "p2" : "p1";
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    const attackCount = attackedMap.get(key) ?? 0;
    if (attackCount >= maxAttacksFor(unit)) continue;
    const targets = getAttackableTargets(state, key);
    if (targets.length === 0) {
      if (!canStrikeHQDirectly(state, key)) continue;
      const hits = maxAttacksFor(unit) - attackCount;
      if (hits >= state[opp].hq) return { attackerKey: key, targetKey: null, isHQStrike: true };
      continue;
    }
    for (const t of targets) {
      const s = scoreAttack(state, key, t.key);
      if (s.succeeded && s.hqDamage >= state[opp].hq) return { attackerKey: key, targetKey: t.key };
    }
  }
  return null;
}

// Sum of best-case HQ damage across ALL of the active player's not-yet-exhausted units this
// turn — not just a single swing. A human closing out a game recognizes when two or three
// separate attacks together finish the HQ even though no single one does on its own; the
// single-attack findLethal above misses that. Greedily takes the best available attack (same
// selection bestExistingAttack already uses), applies its board mutations to a working copy of
// state, and repeats — so a second hit against an already-suppressed target is scored correctly
// as a destroy, not re-scored as a fresh suppress. Returns an ordered list of attacks that
// together are lethal, or null if no such combination exists within a turn's worth of attackers.
export function findCombinedLethal(state, active, attackedMap = new Map()) {
  const opp = active === "p1" ? "p2" : "p1";
  let hqLeft = state[opp].hq;
  let workingState = state;
  const attackedRemaining = new Map(attackedMap);
  const plan = [];

  for (let i = 0; i < 8 && hqLeft > 0; i++) {
    const best = bestExistingAttack(workingState, active, attackedRemaining);
    if (!best || !best.succeeded) break;

    plan.push({ unitKey: best.unitKey, targetKey: best.targetKey, isHQStrike: best.isHQStrike });
    hqLeft -= best.hqDamage;
    attackedRemaining.set(best.unitKey, (attackedRemaining.get(best.unitKey) ?? 0) + 1);

    if (best.isHQStrike) continue; // no board mutation — nothing on the board to update
    const result = resolveSingleAttack(workingState, best.unitKey, best.targetKey);
    const newBoard = { ...workingState.board };
    for (const m of result.boardMutations) newBoard[m.key] = m.newUnit;
    workingState = { ...workingState, board: newBoard };
  }

  return hqLeft <= 0 && plan.length > 0 ? plan : null;
}

// Enemies that could attack unitKey next turn: orthogonally adjacent enemies, PLUS any enemy
// elsewhere in the same row/column that has Bombard — Bombard attacks any distance in a line
// (see combat.js's getBombardTargets/getAttackableTargets), so a Bombard threat two tiles away
// is just as real as an adjacent one and the old adjacency-only check missed it entirely.
function threatsToTile(state, unitKey) {
  const [r, c] = unitKey.split(",").map(Number);
  const unit = state.board[unitKey];
  const threats = [];
  const adj = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].map(([rr, cc]) => `${rr},${cc}`);
  for (const ak of adj) {
    const enemy = state.board[ak];
    if (enemy && enemy.owner !== unit.owner && enemy.state === "normal") threats.push(ak);
  }
  for (const [k, enemy] of Object.entries(state.board)) {
    if (!enemy || enemy.owner === unit.owner || enemy.state !== "normal" || k === unitKey) continue;
    if (threats.includes(k)) continue;
    const [er, ec] = k.split(",").map(Number);
    if ((er === r || ec === c) && getKeywords(enemy).includes("Bombard")) threats.push(k);
  }
  return threats;
}

// Worst-case damage a single enemy at attackerKey could inflict on targetKey next turn,
// accounting for Double Attack landing BOTH hits on the same unit (e.g. normal->suppressed on
// the first hit, then suppressed->destroyed on the second) rather than scoring only one hit and
// understating a unit that could be wiped out entirely in one enemy turn.
function worstCaseDamageFrom(state, attackerKey, targetKey) {
  const attacker = state.board[attackerKey];
  const hits = maxAttacksFor(attacker);
  let working = state;
  let totalScore = 0;
  for (let i = 0; i < hits; i++) {
    const defender = working.board[targetKey];
    if (!defender || defender.state === "destroyed") break;
    const result = resolveSingleAttack(working, attackerKey, targetKey);
    if (result.boardMutations.length === 0) break; // this hit would fail — no further hits matter
    const newUnit = result.boardMutations[0].newUnit;
    const hqDamage = defender.owner === "p1" ? result.hqDamageToP1 : result.hqDamageToP2;
    totalScore += hqDamage * W_HQ + severityStep(defender, newUnit) * W_MATERIAL;
    working = { ...working, board: { ...working.board, [targetKey]: newUnit } };
  }
  return totalScore;
}

// Rough danger score: worst-case damage any single threatening enemy could land on unitKey
// next turn (Bombard range + Double Attack burst included — see helpers above).
function exposureRisk(state, unitKey) {
  let worst = 0;
  for (const attackerKey of threatsToTile(state, unitKey)) {
    worst = Math.max(worst, worstCaseDamageFrom(state, attackerKey, unitKey));
  }
  return worst;
}

// Rough per-turn value of holding an objective, in the same points scale as W_HQ/W_MATERIAL.
// HQ-damage figures mirror the payouts in game.js's applyObjectiveEffects (cardId -> level ->
// direct HQ damage that objective deals its controller's opponent each turn held); everything
// else an objective grants (fuel, card draw, unit buffs) is approximated with a flat constant
// since it isn't denominated in HQ damage. Keep in sync if applyObjectiveEffects's numbers change.
const OBJ_HQ_DMG = {
  26: { 1: 0, 2: 0, 3: 0, 4: 2 }, // Factory
  27: { 1: 0, 2: 1, 3: 1, 4: 4 }, // Airfield
  28: { 1: 0, 2: 0, 3: 0, 4: 2 }, // Supply Depot
  31: { 1: 0, 2: 0, 3: 0, 4: 2 }, // City
  32: { 1: 1, 2: 0, 3: 2, 4: 3 }, // Artillery Position (L2/L4 also land a bonus hit, not counted here)
  33: { 1: 0, 2: 0, 3: 0, 4: 2 }, // Fortification
};
const OBJ_ECON_VALUE = 4; // flat value for fuel/draw/buff payouts that aren't direct HQ damage

function objectiveValue(cardId, level) {
  const hqDmg = OBJ_HQ_DMG[cardId]?.[level] ?? 0;
  return hqDmg * W_HQ + OBJ_ECON_VALUE;
}

// Same "majority of live adjacent units" rule as state.js's checkObjectiveControl, but scoped
// to a single objective tile so it can be evaluated against a hypothetical board.
function adjacentControlCounts(board, objKey) {
  const [r, c] = objKey.split(",").map(Number);
  const adj = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([rr, cc]) => rr >= 0 && rr < 4 && cc >= 0 && cc < 4)
    .map(([rr, cc]) => `${rr},${cc}`);
  let p1 = 0, p2 = 0;
  for (const k of adj) {
    const u = board[k];
    if (!u || u.state === "destroyed") continue;
    if (u.owner === "p1") p1++; else p2++;
  }
  return { p1, p2 };
}

// Value of placing a unit at tileKey purely from objective adjacency: rewards flipping a
// contested/enemy-held objective more than reinforcing one already under our control (a human
// player fights for objectives — the base attack/exposure scoring below has no notion of them).
function objectiveAdjacencyScore(state, tileKey, active) {
  const [r, c] = tileKey.split(",").map(Number);
  const adjObjKeys = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .map(([rr, cc]) => `${rr},${cc}`)
    .filter(k => state.objectives[k]);
  if (adjObjKeys.length === 0) return 0;

  const opp = active === "p1" ? "p2" : "p1";
  let total = 0;
  for (const objKey of adjObjKeys) {
    const obj = state.objectives[objKey];
    const value = objectiveValue(obj.cardId, obj.level ?? 1);
    const before = adjacentControlCounts(state.board, objKey);
    const beforeController = before.p1 > before.p2 ? "p1" : before.p2 > before.p1 ? "p2" : null;
    const activeAfter = (before[active] ?? 0) + 1;
    const oppCount = before[opp] ?? 0;
    const afterController = activeAfter > oppCount ? active : oppCount > activeAfter ? opp : null;

    if (afterController === active && beforeController !== active) {
      total += value; // flips control to us (from the opponent or from contested/no control)
    } else if (afterController === active && beforeController === active) {
      total += value * 0.25; // already ours — diminishing returns for reinforcing
    } else if (beforeController !== active) {
      total += value * 0.15; // doesn't flip it, but chips at the opponent's lead / keeps it contested
    }
  }
  return total;
}

// Best (cardId, tileKey) placement among affordable unit cards in hand and empty legal tiles.
// Scores by: immediate follow-up attack value (if the new unit can swing right away) minus
// how exposed it'd be to an enemy counter-attack next turn, plus objective-adjacency value.
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
      const objScore = objectiveAdjacencyScore(state, key, active);
      const score = attackScore - risk + objScore;

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

// ── Command scoring ──────────────────────────────────────────────────────────
// Rough static value for commands whose effect isn't worth simulating precisely — replaces the
// old flat 0.1 placeholder every command used to get, with numbers roughly proportional to real
// card power, so a strong utility play can beat a marginal attack/placement but a weak one still
// won't crowd one out. Commands with real dynamic scoring below aren't listed here.
const COMMAND_UTILITY_VALUE = {
  19: 2,   // Tactical Withdrawal — card advantage + resets a unit
  21: 0.1, // Coordinated Strike — not automated in-client (no multi-select targeting UI yet)
  22: 3,   // Recon — 3 cards
  49: 2,   // Smoke Screen — 1 turn of Guard on a chosen unit
  50: 1.5, // Improvised Position — 1 turn of Armor on a vanilla unit
  52: 2.5, // Forward Observer — card selection
  53: 0.1, // Pincer Maneuver — not automated in-client (no multi-select targeting UI yet)
  74: 2,   // Dig In — Guard + Armor near an objective we control
  75: 2,   // Hold Position — Armor for up to 2 units near an objective we control
  76: 1.5, // Industrial Surge — delayed fuel
  78: 3,   // Combined Arms Doctrine — board-wide unsuppress + HQ heal
  121: 1,  // Priority Orders — Hero Power discount
  122: 1,  // Command Shuffle — Hero repositioning
  123: 1,  // Radio Interference — opponent Hero Power tax
  124: 1,  // Change Formation — rotate a unit
  125: 2,  // Field Reserves — selective draw
  126: 2,  // Coordinated Orders — extra Hero Power
};

// Direct-damage commands: Artillery Barrage (16, guaranteed armor-strip + suppress on 1 enemy),
// Air Strike (20, 1 hit per friendly Aircraft), Suppressing Fire (79, 1 hit per friendly
// Infantry). Approximates value from the same "how close to dead" signal bestDamageCommandTarget
// ranks targets by, scaled by how many hits the command actually lands.
function damageCommandValue(state, active, cardId) {
  const hasTarget = Object.values(state.board).some(u => u && u.owner !== active && u.state !== "destroyed");
  if (!hasTarget) return 0;
  if (cardId === 16) return W_MATERIAL; // guarantees a suppress-equivalent step regardless of armor
  const cls = cardId === 20 ? "Aircraft" : cardId === 79 ? "Infantry" : null;
  if (!cls) return 0;
  const hits = Object.values(state.board).filter(u => u && u.owner === active && u.state === "normal" && CARD_BY_ID[u.cardId]?.cls === cls).length;
  return Math.min(hits, 2) * W_MATERIAL; // beyond 2 hits the target is already destroyed either way
}

// Shared by buff-before-attack commands (Rally Cry/Entrench) and Tactical Commander's Hero
// Power (92, same "+1 all sides this turn" mechanic, but restricted to its own column): finds
// the friendly unit — optionally restricted by class and/or column — whose best available attack
// improves most from a +bonus all-sides buff. Returns { key, delta } (delta may be 0 if no
// eligible unit's attack actually improves) or null if no eligible unit exists at all.
function bestBuffTarget(state, active, bonus, attackedMap, { clsFilter = null, colFilter = null } = {}) {
  let best = null;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    if (clsFilter && CARD_BY_ID[unit.cardId]?.cls !== clsFilter) continue;
    if (colFilter != null && Number(key.split(",")[1]) !== colFilter) continue;
    const attackCount = attackedMap.get(key) ?? 0;
    if (attackCount >= maxAttacksFor(unit)) continue;

    const before = bestAttackForUnit(state, key, attackCount);
    const buffedUnit = { ...unit, tempSideBonus: (unit.tempSideBonus ?? 0) + bonus };
    const hypoState = { ...state, board: { ...state.board, [key]: buffedUnit } };
    const after = bestAttackForUnit(hypoState, key, attackCount);

    const delta = (after?.score ?? 0) - (before?.score ?? 0);
    if (!best || delta > best.delta) best = { key, delta };
  }
  return best;
}

// Rally Cry (51, +1 all sides, any unit) / Entrench (80, +2 all sides, Infantry only) can turn a
// losing or low-value attack into a much better one, or unlock lethal. Score by the marginal
// improvement to the best available attack among units the buff could apply to — a plain attack
// score without the buff would otherwise look better on its own and get played first, leaving
// the buff's value on the table for a turn that can't recover it.
function buffBeforeAttackValue(state, active, cardId, attackedMap) {
  const bonus = cardId === 80 ? 2 : cardId === 51 ? 1 : 0;
  if (bonus === 0) return 0;
  const clsFilter = cardId === 80 ? "Infantry" : null;
  return bestBuffTarget(state, active, bonus, attackedMap, { clsFilter })?.delta ?? 0;
}

// Overrun (73): +1 HQ damage per Suppress/Destroy this turn — valuable in proportion to how many
// successful attacks are already lined up this turn, so it should be played before attacking.
function overrunValue(state, active, attackedMap) {
  let count = 0;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    const attackCount = attackedMap.get(key) ?? 0;
    if (attackCount >= maxAttacksFor(unit)) continue;
    const atk = bestAttackForUnit(state, key, attackCount);
    if (atk?.succeeded && !atk.isHQStrike) count++; // an HQ strike doesn't Suppress/Destroy anything
  }
  return count * W_HQ;
}

// Blitzkrieg Order (17): lets one friendly Tank attack "as if just deployed." Only real value
// when that Tank has ALREADY used its attack(s) this turn — otherwise the normal attack-scoring
// path already finds the same attack for free, no command needed.
function blitzkriegOrderValue(state, active, attackedMap) {
  let best = 0;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    if (CARD_BY_ID[unit.cardId]?.cls !== "Tank") continue;
    const attackCount = attackedMap.get(key) ?? 0;
    if (attackCount < maxAttacksFor(unit)) continue; // already has a free attack — command adds nothing
    const atk = bestAttackForUnit(state, key, 0);
    if (atk?.succeeded && atk.score > best) best = atk.score;
  }
  return best;
}

// Shared by Field Medic/Last Stand and Recovery Officer's Hero Power (100, same "remove
// Suppression" mechanic, but restricted to its own column): finds the suppressed friendly unit
// — optionally restricted by column — whose restored attack is most valuable. Returns
// { key, score } or null if no suppressed friendly unit exists (in that column, if filtered).
function bestUnsuppressTarget(state, active, { colFilter = null } = {}) {
  let best = null;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "suppressed") continue;
    if (colFilter != null && Number(key.split(",")[1]) !== colFilter) continue;
    const restored = { ...unit, state: "normal" };
    const hypoState = { ...state, board: { ...state.board, [key]: restored } };
    const atk = bestAttackForUnit(hypoState, key, 0);
    const score = atk?.succeeded ? atk.score : 0;
    if (!best || score > best.score) best = { key, score };
  }
  return best;
}

// Field Medic (18) / Last Stand (54): removing Suppression restores a unit to "normal" and gives
// it an attack again this turn — value it by that unit's best available attack once restored.
function unsuppressValue(state, active) {
  return bestUnsuppressTarget(state, active)?.score ?? 0;
}

// Best available score for playing cardId right now. Dynamically-scored commands fall back to
// a 0.1 floor (matching the old universal placeholder) when their situational value is zero —
// e.g. Field Medic with nothing suppressed — so they're still played opportunistically rather
// than never, same as before.
export function scoreCommand(state, active, cardId, attackedMap = new Map()) {
  if (cardId === 16 || cardId === 20 || cardId === 79) return damageCommandValue(state, active, cardId);
  if (cardId === 51 || cardId === 80) return Math.max(buffBeforeAttackValue(state, active, cardId, attackedMap), 0.1);
  if (cardId === 73) return Math.max(overrunValue(state, active, attackedMap), 0.1);
  if (cardId === 17) return Math.max(blitzkriegOrderValue(state, active, attackedMap), 0.1);
  if (cardId === 18 || cardId === 54) return Math.max(unsuppressValue(state, active), 0.1);
  return COMMAND_UTILITY_VALUE[cardId] ?? 0.1;
}

// ── Hero Power activation ────────────────────────────────────────────────────
// Only implemented, powerType:"active" Heroes have a real Power to activate — mirrors
// heroTargetKeys()/applyHeroPower() in game.js, the authoritative rules being approximated here.
// Static value for Powers not worth simulating precisely (87's draw and the two discount
// enablers get a lighter dynamic nudge below); 92/99/100 are fully dynamic.
const HERO_POWER_UTILITY_VALUE = {
  87: 2, // Quartermaster General — draw 1 card, instant, no target
};

// Garrison Commander (99): friendly units adjacent to (not on) an Objective, board-wide — same
// candidate rule as heroTargetKeys() case 99 in game.js.
function friendlyUnitsAdjacentToObjective(state, active) {
  const keys = [];
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state === "destroyed") continue;
    const [r, c] = key.split(",").map(Number);
    const adj = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].map(([rr, cc]) => `${rr},${cc}`);
    if (adj.some(k => state.objectives[k])) keys.push(key);
  }
  return keys;
}

// Best target for a targeted Hero Power (92 Tactical Commander, 99 Garrison Commander, 100
// Recovery Officer). Returns { key } (or { key, delta }/{ key, score } from the shared helpers)
// or null if no legal target exists. 87/103/107 are instant/boardwide-effect Powers with no
// target to pick, so they return null here (handled by flat/dynamic scoring in scoreHeroPower
// instead) — callers should only invoke this for 92/99/100.
export function bestHeroPowerTarget(state, active, heroId, col, attackedMap = new Map()) {
  if (heroId === 92) return bestBuffTarget(state, active, 1, attackedMap, { colFilter: col });
  if (heroId === 100) return bestUnsuppressTarget(state, active, { colFilter: col });
  if (heroId === 99) {
    const candidates = friendlyUnitsAdjacentToObjective(state, active);
    if (candidates.length === 0) return null;
    const withoutGuard = candidates.find(k => !getKeywords(state.board[k]).includes("Guard"));
    return { key: withoutGuard ?? candidates[0] };
  }
  return null;
}

// Best available score for activating heroId's Power (deployed in column col) right now.
// Dynamically-scored Powers fall back to a 0.1 floor when their situational value is zero (e.g.
// Recovery Officer with nothing suppressed in its column) — still played opportunistically, same
// spirit as scoreCommand's floor.
export function scoreHeroPower(state, active, heroId, col, attackedMap = new Map()) {
  if (heroId === 92) return Math.max(bestBuffTarget(state, active, 1, attackedMap, { colFilter: col })?.delta ?? 0, 0.1);
  if (heroId === 100) return Math.max(bestUnsuppressTarget(state, active, { colFilter: col })?.score ?? 0, 0.1);
  if (heroId === 99) return friendlyUnitsAdjacentToObjective(state, active).length > 0 ? 1.5 : 0.1;
  if (heroId === 103) return state[active].hand.some(id => CARD_BY_ID[id]?.cls === "Tank") ? 1.5 : 0.5;
  if (heroId === 107) return state[active].hand.some(id => CARD_BY_ID[id]?.type === "command") ? 1.5 : 0.5;
  return HERO_POWER_UTILITY_VALUE[heroId] ?? 0.1; // 87 (instant draw) and any future implemented Hero
}

// ── Hero deployment ──────────────────────────────────────────────────────────
// Hero Zone index === board column index (0-3), same convention game.js's deployHero uses.
// Column-scoped Heroes (scope:"column") buff/interact only with units in their own column;
// board-scoped Heroes affect the whole board regardless of column.
function columnFriendlyCount(board, active, col) {
  let count = 0;
  for (let row = 0; row < 4; row++) {
    const u = board[`${row},${col}`];
    if (u && u.owner === active && u.state !== "destroyed") count++;
  }
  return count;
}

function columnHasObjective(state, col) {
  return Object.keys(state.objectives).some(k => Number(k.split(",")[1]) === col);
}

// Score deploying hero into board column `col`. Prefers implemented abilities (an
// implemented:false Hero's ability is a no-op today, same as an unautomated command), rewards
// column-scoped Heroes going into columns with existing friendly board presence (their bonus
// compounds) or bordering an objective (several column Heroes, e.g. Objective Marshal, key off
// objective adjacency — see objectiveAdjacencyScore above), and gives board-scoped Heroes a flat
// baseline since column choice doesn't affect them.
function scoreHeroInColumn(state, active, hero, col) {
  if (hero.implemented === false) return 0.1; // ability is a no-op today — still legal, just weak
  let score = hero.powerType === "active" ? 2 : 1; // immediately-usable Powers score a bit higher
  if (hero.scope === "column") {
    score += columnFriendlyCount(state.board, active, col) * 1.5;
    if (columnHasObjective(state, col)) score += 2;
  }
  return score;
}

// Best (heroId, col) to deploy from a roster into the available empty Hero Zones. Replaces
// always-picking roster[0] into the first empty zone with a scored choice.
export function bestHeroDeployment(state, active, roster, heroZones) {
  const emptyCols = heroZones.map((z, i) => (z == null ? i : null)).filter(i => i !== null);
  if (!roster.length || emptyCols.length === 0) return null;

  let best = null;
  for (const heroId of roster) {
    const hero = CARD_BY_ID[heroId];
    if (!hero) continue;
    for (const col of emptyCols) {
      const score = scoreHeroInColumn(state, active, hero, col);
      if (!best || score > best.score) best = { heroId, col, score };
    }
  }
  return best;
}
