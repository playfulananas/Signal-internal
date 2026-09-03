import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardUnit, createInitialState } from '../js/state.js?v=20260903';
import { resolveManeuver } from '../js/combat.js?v=20260903';

function emptyState() {
  return createInitialState([], [], 'kursk');
}

test('two copies of the same card become distinct physical units', () => {
  const first = createBoardUnit(emptyState(), 'I1', 'p1');
  const second = createBoardUnit(first.state, 'I1', 'p1');

  assert.equal(first.unit.cardId, second.unit.cardId);
  assert.notEqual(first.unit.instanceId, second.unit.instanceId);
  assert.equal(first.unit.instanceId, 'unit-1');
  assert.equal(second.unit.instanceId, 'unit-2');
  assert.equal(second.state.nextUnitInstance, 3);
});

test('Maneuver moves a unit without changing its identity', () => {
  const created = createBoardUnit(emptyState(), 'I1', 'p1');
  const state = {
    ...created.state,
    board: { ...created.state.board, '0,0': created.unit },
  };
  const moved = resolveManeuver(state, '0,0', '0,1').state;

  assert.equal(moved.board['0,0'], null);
  assert.equal(moved.board['0,1'].instanceId, created.unit.instanceId);
});
