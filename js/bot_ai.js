// Rule-accurate move scorer for the self-play test bot.
// Imports the SAME pure engine functions game.js uses (state.js / combat.js / maps.js) —
// no reimplementation of combat/placement rules, so the bot can't drift from real game behavior.
// Given a live state snapshot (read from window.__SIGNAL_DEBUG__ in the browser), this module
// picks the best legal action. It does not touch the DOM — callers (selfplay_test.mjs,
// bot_player.js) execute the chosen action via clicks.
import { CARD_BY_ID } from "./cards.js?v=1788363405";
import { getAttackableTargets, resolveSingleAttack } from "./combat.js?v=1788363405";
import { getKeywords, applyHit, hasEscalated } from "./state.js?v=1788363405";
import { canPlaceOnTerrain, getTerrain } from "./maps.js?v=1788363405";

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
// how many of its attacks it's already used this turn (0 for a fresh/hypothetical unit).
// A unit with no legal target simply has no attack to take right now — Direct HQ conversion
// (doc 01 §19) is automatic at end of turn regardless of what the bot does this turn, so it
// is not a bot decision/action and is not scored here (removed 2026-08-31, Run 1, along with
// the old reactive mid-turn Empty-Board HQ Strike this used to model).
export function bestAttackForUnit(state, unitKey, attackCount = 0) {
  const targets = getAttackableTargets(state, unitKey);
  if (targets.length === 0) return null;
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
// Direct HQ conversion is automatic at end of turn (doc 01 §19), not a bot action, so a
// unit with no legal target is not a "lethal attack" option here — see bestAttackForUnit.
export function findLethal(state, active, attackedMap = new Map()) {
  const opp = active === "p1" ? "p2" : "p1";
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    const attackCount = attackedMap.get(key) ?? 0;
    if (attackCount >= maxAttacksFor(unit)) continue;
    const targets = getAttackableTargets(state, key);
    if (targets.length === 0) continue;
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
// Run 1 (2026-08-31): game.js's applyObjectiveEffects still switches on the OLD numeric
// Objective ids (26-33) — verified by reading it directly — so for every currently-live
// Objective (O1-O5, the only ids state.objectives can ever hold post-migration) that switch is
// Run 2 (2026-08-31) wired the real 1/1/2/2 HQ backbone into applyObjectiveEffects — every
// controlled Objective now deals this damage regardless of identity, on top of its own named
// secondary effect (Fuel/draw/buffs/etc., not modeled here — OBJ_ECON_VALUE below stands in for
// that as a flat value, same as before Run 2). Previously this table was intentionally all-zero
// because the engine paid out nothing at all (dead pre-Run-1 numeric-id code); now that the
// engine delivers the backbone for real, scoring it as zero would just make the bot undervalue
// objective control across the board.
const OBJ_HQ_DMG = {
  O1: { 1: 1, 2: 1, 3: 2, 4: 2 }, // Factory
  O2: { 1: 1, 2: 1, 3: 2, 4: 2 }, // Airfield
  O3: { 1: 1, 2: 1, 3: 2, 4: 2 }, // Supply Depot
  O4: { 1: 1, 2: 1, 3: 2, 4: 2 }, // City
  O5: { 1: 1, 2: 1, 3: 2, 4: 2 }, // Artillery Position
};
const OBJ_ECON_VALUE = 4; // flat stand-in for each Objective's own named secondary effect (Fuel/draw/buffs/etc.), not individually modeled

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

// ── Command scoring ──────────────────────────────────────────────────────────
// Rough static value for commands whose effect isn't worth simulating precisely — numbers are
// roughly proportional to real card power, read off each command's actual current effect text in
// cards.js (never assumed from an old id or a same-named old card — several new-truth commands
// reuse an old name for a genuinely different effect, e.g. new C24 Suppressing Fire is a
// permanent +1 buff, not the old id-79 direct-damage command of the same name). Commands with
// real dynamic scoring below (see scoreCommand) aren't listed here. None of the old numeric
// direct-damage commands (old Artillery Barrage/Air Strike/Suppressing Fire) survive in the new
// 35-Command pool — their new-truth namesakes (C30/C33/C24) all grant keywords/attacks/buffs
// instead, so that whole scoring path (damageCommandValue/bestDamageCommandTarget) is gone, not
// remapped.
const COMMAND_UTILITY_VALUE = {
  C04: 2.5, // Forward Observer — card selection (look at top 3, keep 1, arrange the other 2)
  C05: 2,   // Recon — draw 2 cards
  C06: 2.5, // Coordinated Strike — 2 friendly Units each gain 1 additional attack vs. a shared target (now automated — see game.js's startCoordinatedStrike)
  C11: 1.5, // Tactical Withdrawal — card advantage (return a friendly Unit to hand), situational
  C13: 1.5, // Industrial Surge — delayed +2 Fuel
  C14: 1,   // Priority Orders — Hero Active discount
  C15: 1,   // Command Shuffle — Hero repositioning
  C16: 1,   // Change Formation — rotate a unit
  C17: 2.5, // Coordinated Order — refreshes used Hero Actives for another activation this turn
  C18: 1,   // Sacrifice Play — draw 2, but costs a friendly Unit
  C20: 0.8, // Total Mobilization — +1 all sides, but buffs the enemy's Units too
  C21: 2,   // Forced March — Maneuver + draw 1
  C23: 1,   // Emergency Supply — +3 Fuel this turn for 2 self-HQ damage
  C27: 2,   // Blitzkrieg Order — Maneuver a Tank + Armor (Escalate's 2nd Tank not modeled precisely)
  C28: 1.5, // Field Repairs — Armor/Heavy Armor upgrade on a Tank
  C35: 1.5, // Scramble — Maneuver an Aircraft + reset its attacks
};

// Shared by any "buff N friendly Units of a class, board-wide" command whose real value depends
// on how many qualifying Units are actually on the board right now (Suppressing Fire/Entrench/
// General Offensive/Air Strike/Air Superiority) rather than a single best-target delta —
// simulating exactly "which N units" for a multi-target buff isn't worth it precisely, so this
// counts qualifying Units and scales by a flat per-unit weight instead. `hasEscalated` doubles
// the estimate for Escalate-bearing commands since an Escalated play is this same effect at
// roughly double strength (bigger bonus, or twice the target count) — harmless no-op for
// commands that don't have an Escalate mode at all (the name was simply never marked used).
function boardWideClassBuffValue(state, active, cls, cardName, perUnitWeight = 1) {
  const count = Object.values(state.board).filter(u => u && u.owner === active && u.state !== "destroyed" && (!cls || CARD_BY_ID[u.cardId]?.cls === cls)).length;
  if (count === 0) return 0;
  const escalated = hasEscalated(state[active], cardName);
  return count * perUnitWeight * (escalated ? 2 : 1);
}

// Shared by buff-before-attack commands (Rally Cry C03/Hold Position C10/Improvised Position C02)
// and Tactical Commander's Hero Power (H03, same "+N all sides" mechanic, but restricted to its
// own column): finds the friendly unit — optionally restricted by class, column, and/or an
// arbitrary predicate (e.g. "doesn't already have Armor") — whose best available attack improves
// most from a +bonus all-sides buff. Returns { key, delta } (delta may be 0 if no eligible unit's
// attack actually improves) or null if no eligible unit exists at all.
function bestBuffTarget(state, active, bonus, attackedMap, { clsFilter = null, colFilter = null, filterFn = null } = {}) {
  let best = null;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    if (clsFilter && CARD_BY_ID[unit.cardId]?.cls !== clsFilter) continue;
    if (colFilter != null && Number(key.split(",")[1]) !== colFilter) continue;
    if (filterFn && !filterFn(unit)) continue;
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

// Shared by keyword-granting Powers/Commands that pick 1 friendly Unit (optionally class- and/or
// column-restricted) to hand a new keyword to for the rest of the turn (Fire Support Officer H12/
// Artillery Commander H18's Bombard/Blast grants, Target Coordinates C31/Artillery Barrage C30's
// Precision/Barrage grants): values it the same way bestBuffTarget values a stat buff — by how
// much it improves that Unit's best available attack right now (Bombard/Blast/Barrage/Precision
// can unlock or improve an attack that wasn't legal, or wasn't as good, before). Returns
// { key, delta } or null if no eligible Unit exists.
function bestKeywordGrantTarget(state, active, keyword, attackedMap, { clsFilter = null, colFilter = null } = {}) {
  let best = null;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "normal") continue;
    if (clsFilter && CARD_BY_ID[unit.cardId]?.cls !== clsFilter) continue;
    if (colFilter != null && Number(key.split(",")[1]) !== colFilter) continue;
    if (getKeywords(unit).includes(keyword)) continue; // already has it — no delta
    const attackCount = attackedMap.get(key) ?? 0;
    if (attackCount >= maxAttacksFor(unit)) continue;

    const before = bestAttackForUnit(state, key, attackCount);
    const grantedUnit = { ...unit, tempKeywords: [...(unit.tempKeywords || []), keyword] };
    const hypoState = { ...state, board: { ...state.board, [key]: grantedUnit } };
    const after = bestAttackForUnit(hypoState, key, attackCount);

    const delta = (after?.score ?? 0) - (before?.score ?? 0);
    if (!best || delta > best.delta) best = { key, delta };
  }
  return best;
}

// Rally Cry (C03, +1 all sides, up to 2 Units) / Hold Position (C10, +2 all sides, up to 2
// Units) / Improvised Position (C02, +2 all sides, 1 Unit without Armor) can turn a losing or
// low-value attack into a much better one, or unlock lethal. Score by the marginal improvement to
// the best available attack among units the buff could apply to. Approximates each "up to 2
// Units" command by its single best target only — a real lower bound, not the true 2-target
// value, but simulating every pair isn't worth it here.
function buffBeforeAttackValue(state, active, cardId, attackedMap) {
  const bonus = cardId === "C10" || cardId === "C02" ? 2 : 1; // C03 Rally Cry uses 1
  const filterFn = cardId === "C02" ? (u => !getKeywords(u).includes("Armor") && !getKeywords(u).includes("Heavy Armor")) : null;
  return bestBuffTarget(state, active, bonus, attackedMap, { filterFn })?.delta ?? 0;
}

// Second Wind (C08): remove Suppression from 1 friendly Unit AND give it +2 all sides until end
// of turn. Same restore-to-normal step as bestUnsuppressTarget, plus the extra buff applied
// before scoring its best attack — can't reuse bestBuffTarget for this since that helper only
// ever considers already-normal Units, and this command's whole point is a suppressed one.
function bestUnsuppressAndBuffTarget(state, active, bonus) {
  let best = null;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "suppressed") continue;
    const restored = { ...unit, state: "normal", tempSideBonus: (unit.tempSideBonus ?? 0) + bonus };
    const hypoState = { ...state, board: { ...state.board, [key]: restored } };
    const atk = bestAttackForUnit(hypoState, key, 0);
    const score = atk?.succeeded ? atk.score : 0;
    if (!best || score > best.score) best = { key, score };
  }
  return best;
}

// Overrun (C09): Suppress/Destroy landed after this resolves deal extra HQ damage — valuable in
// proportion to how many successful attacks are already lined up this turn, so it should be
// played before attacking.
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

// Armored Offensive (C29) / Command Specialist's Hero Power (H09, same "next X costs less"
// shape) / Armored Commander's Hero Power (H07, same shape, column-scoped): only worth playing
// ahead of time if the relevant card type is actually in hand to benefit from the discount.
function handHasClass(state, active, cls) {
  return state[active].hand.some(id => CARD_BY_ID[id]?.cls === cls);
}
function handHasType(state, active, type) {
  return state[active].hand.some(id => CARD_BY_ID[id]?.type === type);
}

// Shared by Field Medic (C01) and Recovery Officer's Hero Power (H05, same "remove Suppression"
// mechanic, but restricted to its own column): finds the suppressed friendly unit — optionally
// restricted by column — whose restored attack is most valuable. Returns { key, score } or null
// if no suppressed friendly unit exists (in that column, if filtered).
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

// Field Medic (C01): removing Suppression restores a unit to "normal" and gives it an attack
// again this turn — value it by that unit's best available attack once restored.
function unsuppressValue(state, active) {
  return bestUnsuppressTarget(state, active)?.score ?? 0;
}

// Combined Arms Doctrine (C07): board-wide unsuppress + draw 1. Sums every suppressed friendly
// unit's restored-attack value (not just the single best one, since ALL of them get unsuppressed)
// plus a flat card-advantage bonus for the draw.
function combinedArmsValue(state, active) {
  let total = 1; // flat value for the draw
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== active || unit.state !== "suppressed") continue;
    const restored = { ...unit, state: "normal" };
    const hypoState = { ...state, board: { ...state.board, [key]: restored } };
    const atk = bestAttackForUnit(hypoState, key, 0);
    if (atk?.succeeded) total += atk.score;
  }
  return total;
}

// Scorched Earth Raid (C19): destroy 1 friendly Unit, deal 2 HQ damage instead of that Unit's
// normal destruction result, bypassing Guard. Denominated directly in the same HQ/Material scale
// as combat: 2 guaranteed HQ points minus the rough cost of losing a full Unit (its own
// destruction is worth 2 material steps, same weight an enemy kill would score).
function scorchedEarthRaidValue(state, active) {
  const hasFriendlyUnit = Object.values(state.board).some(u => u && u.owner === active && u.state !== "destroyed");
  if (!hasFriendlyUnit) return 0;
  return 2 * W_HQ - 2 * W_MATERIAL;
}

// Objective Push (C22) / (previously) Garrison Commander's Hero Power: friendly Units orthogonally
// adjacent to an Objective. Approximates the multi-target buff by counting how many friendly
// Units are currently adjacent to ANY Objective (a real per-Objective choice exists in the UI,
// but this is a fair proxy for "is there a good Objective to push right now").
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

// Best available score for playing cardId right now. Dynamically-scored commands fall back to
// a 0.1 floor (matching the old universal placeholder) when their situational value is zero —
// e.g. Field Medic with nothing suppressed — so they're still played opportunistically rather
// than never, same as before.
export function scoreCommand(state, active, cardId, attackedMap = new Map()) {
  const card = CARD_BY_ID[cardId];
  if (cardId === "C01") return Math.max(unsuppressValue(state, active), 0.1);
  if (cardId === "C02" || cardId === "C03" || cardId === "C10") return Math.max(buffBeforeAttackValue(state, active, cardId, attackedMap), 0.1);
  if (cardId === "C07") return combinedArmsValue(state, active);
  if (cardId === "C08") return Math.max(bestUnsuppressAndBuffTarget(state, active, 2)?.score ?? 0, 0.1);
  if (cardId === "C09") return Math.max(overrunValue(state, active, attackedMap), 0.1);
  if (cardId === "C12") return Math.max(bestKeywordGrantTarget(state, active, "Guard", attackedMap)?.delta ?? 0, 0.1);
  if (cardId === "C19") return Math.max(scorchedEarthRaidValue(state, active), 0.1);
  if (cardId === "C22") return Math.max(friendlyUnitsAdjacentToObjective(state, active).length * 0.5, 0.1);
  if (cardId === "C24") return Math.max(boardWideClassBuffValue(state, active, "Infantry", card?.name, 0.3), 0.1); // single-target permanent +1, approximated as a small per-Infantry-on-board nudge
  if (cardId === "C25") return Math.max(boardWideClassBuffValue(state, active, "Infantry", card?.name, 0.5), 0.1);
  if (cardId === "C26") return Math.max(boardWideClassBuffValue(state, active, "Infantry", card?.name, 0.6), 0.1);
  if (cardId === "C29") return handHasClass(state, active, "Tank") ? 1.5 : 0.5;
  if (cardId === "C30") return Math.max(bestKeywordGrantTarget(state, active, "Barrage", attackedMap, { clsFilter: "Artillery" })?.delta ?? 0, 0.1);
  if (cardId === "C31") return Math.max(bestKeywordGrantTarget(state, active, "Precision", attackedMap, { clsFilter: "Artillery" })?.delta ?? 0, 0.1);
  if (cardId === "C32") return Math.max(bestKeywordGrantTarget(state, active, "Blast", attackedMap, { clsFilter: "Artillery" })?.delta ?? 0, 0.1) + 0.5; // + flat nudge for the accompanying Barrage grant
  if (cardId === "C33") return Math.max(boardWideClassBuffValue(state, active, "Aircraft", card?.name, W_MATERIAL * 0.5), 0.1);
  if (cardId === "C34") return Math.max(boardWideClassBuffValue(state, active, "Aircraft", card?.name, 0.6), 0.1);
  return COMMAND_UTILITY_VALUE[cardId] ?? 0.1;
}

// ── Hero Power activation ────────────────────────────────────────────────────
// Only implemented, powerType:"active" Heroes have a real Power to activate — mirrors
// heroTargetKeys()/applyHeroPower() in game.js, the authoritative rules being approximated here.
// Static value for Powers not worth simulating precisely; H03/H05/H07/H09/H10/H12/H15/H18/H22/
// H23 are dynamic below.
const HERO_POWER_UTILITY_VALUE = {
  H01: 2,    // Quartermaster General — draw 1 card, instant, no target
  H11: 0.5,  // Field Coordinator — rotate a Unit in column; direction doesn't affect scoring
  H16: 1,    // Maneuver Commander — Maneuver + reset attacks in column; repositioning utility
  H17: W_HQ, // HQ Assault Commander — 1 guaranteed enemy-HQ damage, same currency as combat
  H24: 1.5,  // Long War Commander — escalating permanent buff; Power-level scaling not modeled precisely
  H25: 2,    // Chief Aircraft Engineer — Craft, card/board advantage via the 3-candidate picker
};

// Strike Commander (H15): direct Hit on an enemy Unit in this Hero's column, bypassing attack
// comparison entirely (see applyHit in state.js — the same Suppress/Destroy ladder combat uses).
function bestHeroHitTarget(state, active, col) {
  const opp = active === "p1" ? "p2" : "p1";
  let best = null;
  for (const [key, unit] of Object.entries(state.board)) {
    if (!unit || unit.owner !== opp || unit.state === "destroyed") continue;
    if (Number(key.split(",")[1]) !== col) continue;
    const { newUnit, hqDamage } = applyHit(unit);
    const score = severityStep(unit, newUnit) * W_MATERIAL + hqDamage * W_HQ;
    if (!best || score > best.score) best = { key, score };
  }
  return best;
}

// Frontline Marshal (H22): +2 all sides to a whole column, friendly AND enemy — net value
// depends on who has more presence in that column right now; a simple friendly-minus-enemy
// unit-count differential is a fair proxy for "does this help us more than it helps them."
function columnNetPresence(state, active, col) {
  let friendly = 0, enemy = 0;
  for (let row = 0; row < 4; row++) {
    const u = state.board[`${row},${col}`];
    if (!u || u.state === "destroyed") continue;
    if (u.owner === active) friendly++; else enemy++;
  }
  return friendly - enemy;
}

// Best target for a targeted Hero Power (H03 Tactical Commander, H05 Recovery Officer, H10
// Conventional Warfare Commander, H12 Fire Support Officer, H15 Strike Commander, H18 Artillery
// Commander). Returns { key } (or { key, delta }/{ key, score } from the shared helpers) or null
// if no legal target exists. Instant/board-wide-effect Powers have no target to pick, so they
// return null here (handled by flat/dynamic scoring in scoreHeroPower instead) — callers should
// only invoke this for the targeted Powers listed above.
export function bestHeroPowerTarget(state, active, heroId, col, attackedMap = new Map()) {
  if (heroId === "H03") return bestBuffTarget(state, active, 1, attackedMap, { colFilter: col });
  if (heroId === "H05") return bestUnsuppressTarget(state, active, { colFilter: col });
  if (heroId === "H10") return bestBuffTarget(state, active, 3, attackedMap, { filterFn: u => !CARD_BY_ID[u.cardId]?.keyword });
  if (heroId === "H12") return bestKeywordGrantTarget(state, active, "Bombard", attackedMap, { colFilter: col });
  if (heroId === "H15") return bestHeroHitTarget(state, active, col);
  if (heroId === "H18") return bestKeywordGrantTarget(state, active, "Blast", attackedMap, { clsFilter: "Artillery", colFilter: col });
  return null;
}

// Best available score for activating heroId's Power (deployed in column col) right now.
// Dynamically-scored Powers fall back to a 0.1 floor when their situational value is zero (e.g.
// Recovery Officer with nothing suppressed in its column) — still played opportunistically, same
// spirit as scoreCommand's floor.
export function scoreHeroPower(state, active, heroId, col, attackedMap = new Map()) {
  if (heroId === "H03") return Math.max(bestBuffTarget(state, active, 1, attackedMap, { colFilter: col })?.delta ?? 0, 0.1);
  if (heroId === "H05") return Math.max(bestUnsuppressTarget(state, active, { colFilter: col })?.score ?? 0, 0.1);
  if (heroId === "H07") return handHasClass(state, active, "Tank") ? 1.5 : 0.5;
  if (heroId === "H09") return handHasType(state, active, "command") ? 1.5 : 0.5;
  if (heroId === "H10") return Math.max(bestBuffTarget(state, active, 3, attackedMap, { filterFn: u => !CARD_BY_ID[u.cardId]?.keyword })?.delta ?? 0, 0.1);
  if (heroId === "H12") return Math.max(bestKeywordGrantTarget(state, active, "Bombard", attackedMap, { colFilter: col })?.delta ?? 0, 0.1);
  if (heroId === "H15") return Math.max(bestHeroHitTarget(state, active, col)?.score ?? 0, 0.1);
  if (heroId === "H18") return Math.max(bestKeywordGrantTarget(state, active, "Blast", attackedMap, { clsFilter: "Artillery", colFilter: col })?.delta ?? 0, 0.1);
  if (heroId === "H19") return Math.max(state[active].hand.filter(id => { const c = CARD_BY_ID[id]; return c?.type === "unit" && (c.cost === 1 || c.cost === 2); }).length, 0.1);
  if (heroId === "H22") return Math.max(columnNetPresence(state, active, col) * 1.5, 0.1);
  if (heroId === "H23") return Math.max(Object.values(state.board).filter(u => u && u.owner === active && u.state !== "destroyed").length * 0.4, 0.1);
  return HERO_POWER_UTILITY_VALUE[heroId] ?? 0.1;
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
