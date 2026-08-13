import test from 'node:test';
import assert from 'node:assert/strict';
import {
  debugAddCard, debugSetFuel, debugAdjustFuel, debugSetHQ, debugAdjustHQ,
  debugSetObjective, debugSetUnitState, debugBuffUnit, debugDrawCards, debugSkipToTurn,
} from '../js/debug.js';

function baseState() {
  return {
    turn: 3,
    initiative: 'p1',
    board: {
      '0,0': { cardId: 9, owner: 'p1', state: 'normal', armorHits: 0, tempKeywords: [], grantedKeywords: [], tempSideBonus: 0, justPlaced: false },
      '0,1': null,
    },
    objectives: {
      '1,0': { cardId: 26, level: 1, controller: 'p1' },
    },
    p1: { hq: 25, fuel: 3, pendingFuelGain: 0, hand: [1, 2], deck: [3, 4, 5], missions: [], pendingDiscounts: [] },
    p2: { hq: 25, fuel: 3, pendingFuelGain: 0, hand: [], deck: [6, 7], missions: [], pendingDiscounts: [] },
    log: [],
  };
}

test('debugAddCard adds the card to the target player\'s hand and logs the card name + player', () => {
  const s = baseState();
  const { state, log } = debugAddCard(s, 'p2', 66);
  assert.deepEqual(state.p2.hand, [66]);
  assert.equal(state.p1.hand.length, 2); // untouched
  assert.match(log[0], /King Tiger/);
  assert.match(log[0], /P2/);
});

test('debugSetFuel sets an exact value, uncapped above 6', () => {
  const s = baseState();
  const { state } = debugSetFuel(s, 'p1', 9);
  assert.equal(state.p1.fuel, 9);
});

test('debugSetFuel floors at 0', () => {
  const s = baseState();
  const { state } = debugSetFuel(s, 'p1', -5);
  assert.equal(state.p1.fuel, 0);
});

test('debugAdjustFuel applies a delta from the current value', () => {
  const s = baseState();
  const { state } = debugAdjustFuel(s, 'p1', 5);
  assert.equal(state.p1.fuel, 8); // 3 + 5, uncapped
});

test('debugSetHQ floors at 0, no ceiling', () => {
  const s = baseState();
  const { state } = debugSetHQ(s, 'p2', 40);
  assert.equal(state.p2.hq, 40);
});

test('debugAdjustHQ floors at 0, not negative', () => {
  const s = baseState();
  const { state } = debugAdjustHQ(s, 'p1', -30);
  assert.equal(state.p1.hq, 0);
});

test('debugSetObjective sets controller and level', () => {
  const s = baseState();
  const { state, log } = debugSetObjective(s, '1,0', 'p2', 4);
  assert.equal(state.objectives['1,0'].controller, 'p2');
  assert.equal(state.objectives['1,0'].level, 4);
  assert.match(log[0], /Factory/);
});

test('debugSetObjective maps \'neutral\' to controller: null', () => {
  const s = baseState();
  const { state } = debugSetObjective(s, '1,0', 'neutral', 2);
  assert.equal(state.objectives['1,0'].controller, null);
});

test('debugSetUnitState suppresses a unit', () => {
  const s = baseState();
  const { state, log } = debugSetUnitState(s, '0,0', 'suppressed');
  assert.equal(state.board['0,0'].state, 'suppressed');
  assert.match(log[0], /Heavy Tank/);
});

test('debugSetUnitState destroying a unit removes it from the board', () => {
  const s = baseState();
  const { state } = debugSetUnitState(s, '0,0', 'destroyed');
  assert.equal(state.board['0,0'], null);
});

test('debugSetUnitState reset clears armorHits back to 0', () => {
  const s = baseState();
  s.board['0,0'].armorHits = 2;
  const { state } = debugSetUnitState(s, '0,0', 'normal');
  assert.equal(state.board['0,0'].state, 'normal');
  assert.equal(state.board['0,0'].armorHits, 0);
});

test('debugSetUnitState clicking an empty tile is a no-op', () => {
  const s = baseState();
  const { state, log } = debugSetUnitState(s, '0,1', 'suppressed');
  assert.equal(state, s); // same reference, nothing changed
  assert.deepEqual(log, []);
});

test('debugBuffUnit sets an all-sides bonus, positive or negative', () => {
  const s = baseState();
  const { state, log } = debugBuffUnit(s, '0,0', 3);
  assert.equal(state.board['0,0'].debugSideBonus, 3);
  assert.match(log[0], /Heavy Tank/);
  assert.match(log[0], /\+3/);
});

test('debugBuffUnit with a negative value overwrites rather than stacking', () => {
  const s = baseState();
  s.board['0,0'].debugSideBonus = 5;
  const { state, log } = debugBuffUnit(s, '0,0', -2);
  assert.equal(state.board['0,0'].debugSideBonus, -2);
  assert.match(log[0], /-2/);
});

test('debugBuffUnit clicking an empty tile is a no-op', () => {
  const s = baseState();
  const { state, log } = debugBuffUnit(s, '0,1', 5);
  assert.equal(state, s);
  assert.deepEqual(log, []);
});

test('debugDrawCards draws n cards from deck into hand', () => {
  const s = baseState();
  const { state, log } = debugDrawCards(s, 'p1', 2);
  assert.deepEqual(state.p1.hand, [1, 2, 3, 4]);
  assert.deepEqual(state.p1.deck, [5]);
  assert.match(log[0], /P1 drew 2/);
});

test('debugSkipToTurn sets turn and recalculates objective level for that turn', () => {
  // objectiveLevel(turn) in state.js computes round = Math.ceil(turn/2) and escalates to level 4
  // once round >= 8 — so turn 15 (round 8), not turn 9 (round 5, level 2), is what reaches L4.
  const s = baseState();
  const { state, log } = debugSkipToTurn(s, 15);
  assert.equal(state.turn, 15);
  assert.equal(state.objectives['1,0'].level, 4);
  assert.match(log[0], /Round 8/); // Math.ceil(15/2) = 8
});
