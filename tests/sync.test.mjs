import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareVersionedState, shouldAcceptRemoteState, stateRevision } from '../js/sync.js?v=20260902';

test('stateRevision treats missing or invalid revisions as the initial revision', () => {
  assert.equal(stateRevision(null), 0);
  assert.equal(stateRevision({}), 0);
  assert.equal(stateRevision({ _revision: -1 }), 0);
  assert.equal(stateRevision({ _revision: 1.5 }), 0);
  assert.equal(stateRevision({ _revision: 7 }), 7);
});

test('prepareVersionedState increments without mutating the current snapshot', () => {
  const current = { turn: 4, _revision: 9 };
  const prepared = prepareVersionedState(current, 'writer-1');

  assert.equal(prepared.expectedRevision, 9);
  assert.deepEqual(prepared.state, { turn: 4, _revision: 10, _pushId: 'writer-1' });
  assert.deepEqual(current, { turn: 4, _revision: 9 });
});

test('remote state cannot roll an optimistic local snapshot backward', () => {
  assert.equal(shouldAcceptRemoteState({ _revision: 5 }, { _revision: 4 }), false);
  assert.equal(shouldAcceptRemoteState({ _revision: 5 }, { _revision: 5 }), true);
  assert.equal(shouldAcceptRemoteState({ _revision: 5 }, { _revision: 6 }), true);
  assert.equal(shouldAcceptRemoteState({ _revision: 5 }, { _revision: 4 }, { force: true }), true);
});
