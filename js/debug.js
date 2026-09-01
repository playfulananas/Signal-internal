// Pure state-transformation functions for the debug panel (digital/js/game.js wires these to
// UI). No DOM access here — every function takes a GameState and returns { state, log }, same
// pattern as state.js, so this file can be tested with plain Node and no browser.

import { CARD_BY_ID } from './cards.js?v=1788267223';
import { drawCards, updateObjectiveLevels, checkObjectiveControl } from './state.js?v=1788267223';

export function debugAddCard(state, player, cardId) {
  const card = CARD_BY_ID[cardId];
  const newState = { ...state, [player]: { ...state[player], hand: [...state[player].hand, cardId] } };
  return { state: newState, log: [`[DEBUG] Added ${card.name} to ${player.toUpperCase()}'s hand`] };
}

// Removes one copy of cardId from player's hand — first-match by index, same convention the
// game's own card-play logic uses (indexOf + splice) since hand entries have no per-copy id.
export function debugRemoveCard(state, player, cardId) {
  const card = CARD_BY_ID[cardId];
  const hand = [...state[player].hand];
  const idx = hand.indexOf(cardId);
  if (idx === -1) return { state, log: [] };
  hand.splice(idx, 1);
  const newState = { ...state, [player]: { ...state[player], hand } };
  return { state: newState, log: [`[DEBUG] Removed ${card?.name ?? '?'} from ${player.toUpperCase()}'s hand`] };
}

export function debugSetFuel(state, player, value) {
  const v = Math.max(0, value);
  const newState = { ...state, [player]: { ...state[player], fuel: v } };
  return { state: newState, log: [`[DEBUG] Set ${player.toUpperCase()} Fuel to ${v}`] };
}

export function debugAdjustFuel(state, player, delta) {
  return debugSetFuel(state, player, state[player].fuel + delta);
}

export function debugSetHQ(state, player, value) {
  const v = Math.max(0, value);
  const newState = { ...state, [player]: { ...state[player], hq: v } };
  return { state: newState, log: [`[DEBUG] Set ${player.toUpperCase()} HQ to ${v}`] };
}

export function debugAdjustHQ(state, player, delta) {
  return debugSetHQ(state, player, state[player].hq + delta);
}

export function debugSetObjective(state, tileKey, controller, level) {
  const obj = state.objectives[tileKey];
  const resolvedController = controller === 'neutral' ? null : controller;
  const newObj = { ...obj, controller: resolvedController, level };
  const newState = { ...state, objectives: { ...state.objectives, [tileKey]: newObj } };
  const name = CARD_BY_ID[obj.cardId]?.name ?? '?';
  return { state: newState, log: [`[DEBUG] ${name} set to ${controller.toUpperCase()} L${level}`] };
}

// Swaps which objective card occupies a tile — distinct from debugSetObjective (which only
// adjusts controller/level on the card already there): a different card means resetting
// level/controller too, since a level-4/P1-controlled Bridge inherited from whatever was
// there before would be nonsense.
export function debugSetObjectiveCard(state, tileKey, cardId) {
  const obj = state.objectives[tileKey];
  if (!obj) return { state, log: [] };
  const card = CARD_BY_ID[cardId];
  const newObj = { ...obj, cardId, level: 1, controller: null };
  const newState = { ...state, objectives: { ...state.objectives, [tileKey]: newObj } };
  return { state: newState, log: [`[DEBUG] ${tileKey} objective set to ${card?.name ?? '?'} (reset to L1, Neutral)`] };
}

export function debugSetUnitState(state, tileKey, newUnitState) {
  const unit = state.board[tileKey];
  if (!unit) return { state, log: [] };
  const updated = newUnitState === 'destroyed'
    ? null
    : { ...unit, state: newUnitState, armorHits: newUnitState === 'normal' ? 0 : unit.armorHits };
  const newState = { ...state, board: { ...state.board, [tileKey]: updated } };
  const name = CARD_BY_ID[unit.cardId]?.name ?? '?';
  return { state: newState, log: [`[DEBUG] ${name} set to ${newUnitState}`] };
}

// Persistent all-sides stat override — distinct from tempSideBonus/objSideBonus/grantedSideBonus,
// which all get cleared or recalculated by normal turn logic. A debug buff should stay put until
// the tester changes it back, so it lives in its own field (debugSideBonus, read by getSideValue
// in state.js and by buildBoardCard in ui.js).
export function debugBuffUnit(state, tileKey, value) {
  const unit = state.board[tileKey];
  if (!unit) return { state, log: [] };
  const updated = { ...unit, debugSideBonus: value };
  const newState = { ...state, board: { ...state.board, [tileKey]: updated } };
  const name = CARD_BY_ID[unit.cardId]?.name ?? '?';
  const sign = value >= 0 ? '+' : '';
  return { state: newState, log: [`[DEBUG] ${name} all sides ${sign}${value}`] };
}

export function debugDrawCards(state, player, n) {
  const newPs = drawCards(state[player], n);
  const newState = { ...state, [player]: newPs };
  return { state: newState, log: [`[DEBUG] ${player.toUpperCase()} drew ${n} card(s)`] };
}

export function debugSkipToTurn(state, turn) {
  let newState = { ...state, turn };
  newState = updateObjectiveLevels(newState);
  newState = checkObjectiveControl(newState);
  const round = Math.ceil(turn / 2);
  return { state: newState, log: [`[DEBUG] Turn set to ${turn} (Round ${round})`] };
}
