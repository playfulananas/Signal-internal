// Unit tests for the Empty-Board HQ Strike rule (GDD Locked Decision, 2026-08-13): if the
// opponent has zero live units on the board and it isn't Turn 1, a friendly unit that hasn't
// yet used all its attacks this turn strikes the HQ directly (1 HQ damage, 2 for Double
// Attack) instead of an adjacent/Bombard enemy. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { canStrikeHQDirectly, resolveEmptyBoardStrike } from '../js/combat.js';
import { CARD_BY_ID } from '../js/cards.js';

function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
const unit = (owner, cardId = 1, extra = {}) => ({ cardId, owner, state: 'normal', armorHits: 0, ...extra });

test('canStrikeHQDirectly is false on Turn 1 even with an empty opponent board', () => {
  const state = { turn: 1, board: boardWith({ '0,0': unit('p1') }) };
  assert.equal(canStrikeHQDirectly(state, '0,0'), false);
});

test('canStrikeHQDirectly is true on Turn 2 (P2\'s first turn) with an empty opponent board', () => {
  // P2 attacker, P1 (the opponent) has zero units on the board.
  const state = { turn: 2, board: boardWith({ '0,0': unit('p2') }) };
  assert.equal(canStrikeHQDirectly(state, '0,0'), true);
});

test('canStrikeHQDirectly is false when the opponent has a live unit anywhere on the board', () => {
  const state = { turn: 5, board: boardWith({ '0,0': unit('p1'), '3,3': unit('p2') }) };
  assert.equal(canStrikeHQDirectly(state, '0,0'), false);
});

test('canStrikeHQDirectly is true when the opponent\'s only unit is destroyed (not live)', () => {
  const state = { turn: 5, board: boardWith({ '0,0': unit('p1'), '3,3': unit('p2', 1, { state: 'destroyed' }) }) };
  assert.equal(canStrikeHQDirectly(state, '0,0'), true);
});

test('resolveEmptyBoardStrike with hits=1 damages only the opponent and names the unit', () => {
  const state = { turn: 3, board: boardWith({ '0,0': unit('p1', 1) }) }; // Rifle Squad
  const result = resolveEmptyBoardStrike(state, '0,0', 1);
  assert.deepEqual(result.boardMutations, []);
  assert.equal(result.hqDamageToP1, 0);
  assert.equal(result.hqDamageToP2, 1);
  assert.match(result.logEntries[0], /Rifle Squad/);
  assert.match(result.logEntries[0], /1 HQ damage/);
});

test('resolveEmptyBoardStrike with hits=2 (Double Attack, single call) deals 2 damage', () => {
  const state = { turn: 3, board: boardWith({ '0,0': unit('p2', 8) }) }; // Tank Hunter, Double Attack
  const result = resolveEmptyBoardStrike(state, '0,0', 2);
  assert.equal(result.hqDamageToP1, 2);
  assert.equal(result.hqDamageToP2, 0);
  assert.match(result.logEntries[0], /Tank Hunter/);
  assert.match(result.logEntries[0], /2 HQ damage/);
});

test('resolveEmptyBoardStrike never applies Overrun itself — that is a game.js-level concern', () => {
  // Overrun lives on PlayerState (p1.overrun), not on the board unit or in combat.js's pure
  // functions — resolveEmptyBoardStrike has no access to it and must not need to, since
  // applying it here would risk double-counting once game.js's own Overrun check also runs.
  const state = { turn: 3, board: boardWith({ '0,0': unit('p1', 1) }), p1: { overrun: true } };
  const result = resolveEmptyBoardStrike(state, '0,0', 1);
  assert.equal(result.hqDamageToP2, 1, 'exactly hits, no accidental +1');
});

test('boardMutations is always empty, so a caller\'s wasDestroyed check correctly treats an HQ strike as no kill', () => {
  const state = { turn: 3, board: boardWith({ '0,0': unit('p1', 1) }) };
  const result = resolveEmptyBoardStrike(state, '0,0', 1);
  const wasDestroyed = result.boardMutations.some(m => m.newUnit === null);
  assert.equal(wasDestroyed, false);
});
