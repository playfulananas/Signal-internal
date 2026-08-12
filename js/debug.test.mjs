import assert from 'node:assert/strict';
import { CARD_BY_ID } from './cards.js';
import {
  debugAddCard, debugSetFuel, debugAdjustFuel, debugSetHQ, debugAdjustHQ,
  debugSetObjective, debugSetUnitState, debugBuffUnit, debugDrawCards, debugSkipToTurn,
} from './debug.js';

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

// debugAddCard
{
  const s = baseState();
  const { state, log } = debugAddCard(s, 'p2', 66);
  assert.deepEqual(state.p2.hand, [66]);
  assert.equal(state.p1.hand.length, 2); // untouched
  assert.match(log[0], /King Tiger/);
  assert.match(log[0], /P2/);
}

// debugSetFuel — exact value, uncapped above 6
{
  const s = baseState();
  const { state } = debugSetFuel(s, 'p1', 9);
  assert.equal(state.p1.fuel, 9);
}

// debugSetFuel — floors at 0
{
  const s = baseState();
  const { state } = debugSetFuel(s, 'p1', -5);
  assert.equal(state.p1.fuel, 0);
}

// debugAdjustFuel — delta from current value
{
  const s = baseState();
  const { state } = debugAdjustFuel(s, 'p1', 5);
  assert.equal(state.p1.fuel, 8); // 3 + 5, uncapped
}

// debugSetHQ — floors at 0, no ceiling
{
  const s = baseState();
  const { state } = debugSetHQ(s, 'p2', 40);
  assert.equal(state.p2.hq, 40);
}

// debugAdjustHQ
{
  const s = baseState();
  const { state } = debugAdjustHQ(s, 'p1', -30);
  assert.equal(state.p1.hq, 0); // floored, not negative
}

// debugSetObjective — sets controller and level
{
  const s = baseState();
  const { state, log } = debugSetObjective(s, '1,0', 'p2', 4);
  assert.equal(state.objectives['1,0'].controller, 'p2');
  assert.equal(state.objectives['1,0'].level, 4);
  assert.match(log[0], /Factory/);
}

// debugSetObjective — 'neutral' maps to controller: null
{
  const s = baseState();
  const { state } = debugSetObjective(s, '1,0', 'neutral', 2);
  assert.equal(state.objectives['1,0'].controller, null);
}

// debugSetUnitState — suppress
{
  const s = baseState();
  const { state, log } = debugSetUnitState(s, '0,0', 'suppressed');
  assert.equal(state.board['0,0'].state, 'suppressed');
  assert.match(log[0], /Heavy Tank/);
}

// debugSetUnitState — destroy removes the unit from the board
{
  const s = baseState();
  const { state } = debugSetUnitState(s, '0,0', 'destroyed');
  assert.equal(state.board['0,0'], null);
}

// debugSetUnitState — reset clears armorHits back to 0
{
  const s = baseState();
  s.board['0,0'].armorHits = 2;
  const { state } = debugSetUnitState(s, '0,0', 'normal');
  assert.equal(state.board['0,0'].state, 'normal');
  assert.equal(state.board['0,0'].armorHits, 0);
}

// debugSetUnitState — clicking an empty tile is a no-op
{
  const s = baseState();
  const { state, log } = debugSetUnitState(s, '0,1', 'suppressed');
  assert.equal(state, s); // same reference, nothing changed
  assert.deepEqual(log, []);
}

// debugBuffUnit — sets an all-sides bonus, positive or negative
{
  const s = baseState();
  const { state, log } = debugBuffUnit(s, '0,0', 3);
  assert.equal(state.board['0,0'].debugSideBonus, 3);
  assert.match(log[0], /Heavy Tank/);
  assert.match(log[0], /\+3/);
}

// debugBuffUnit — negative value, and re-applying overwrites rather than stacking
{
  const s = baseState();
  s.board['0,0'].debugSideBonus = 5;
  const { state, log } = debugBuffUnit(s, '0,0', -2);
  assert.equal(state.board['0,0'].debugSideBonus, -2);
  assert.match(log[0], /-2/);
}

// debugBuffUnit — clicking an empty tile is a no-op
{
  const s = baseState();
  const { state, log } = debugBuffUnit(s, '0,1', 5);
  assert.equal(state, s);
  assert.deepEqual(log, []);
}

// debugDrawCards
{
  const s = baseState();
  const { state, log } = debugDrawCards(s, 'p1', 2);
  assert.deepEqual(state.p1.hand, [1, 2, 3, 4]);
  assert.deepEqual(state.p1.deck, [5]);
  assert.match(log[0], /P1 drew 2/);
}

// debugSkipToTurn — sets turn, recalculates objective level for that turn
// objectiveLevel(turn) in state.js computes round = Math.ceil(turn/2) and escalates to level 4
// once round >= 8 — so turn 15 (round 8), not turn 9 (round 5, level 2), is what reaches L4.
{
  const s = baseState();
  const { state, log } = debugSkipToTurn(s, 15);
  assert.equal(state.turn, 15);
  assert.equal(state.objectives['1,0'].level, 4);
  assert.match(log[0], /Round 8/); // Math.ceil(15/2) = 8
}

console.log('All debug.js tests passed.');
