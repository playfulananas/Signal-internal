import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrePlayMulliganSnapshot, normalizeRemoteBoard, normalizeRemoteUnit, prepareVersionedState, shouldAcceptRemoteState, stateRevision } from '../js/sync.js?v=2026090401';

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

test('host mulligan sync rejects the preceding ready-lobby snapshot', () => {
  assert.equal(isPrePlayMulliganSnapshot({
    _phase: 'ready',
    p1Deck: ['I1'],
    p2Deck: ['I2'],
    mapId: 'stalingrad',
  }), false);
});

test('host mulligan sync accepts only a complete pre-play game snapshot', () => {
  const openingState = {
    turn: 1,
    readyForPlay: false,
    p1: { hand: ['I1'], mulliganDone: false },
    p2: { hand: ['I2'], mulliganDone: false },
  };
  assert.equal(isPrePlayMulliganSnapshot(openingState), true);
  assert.equal(isPrePlayMulliganSnapshot({ ...openingState, p2: undefined }), false, 'partial player data is unsafe to merge');
  assert.equal(isPrePlayMulliganSnapshot({ ...openingState, readyForPlay: true }), false, 'a started match is not a mulligan snapshot');
});

test('legacy permanent bonuses migrate away from the 99-turn sentinel', () => {
  const migrated = normalizeRemoteUnit({
    cardId: 'I1',
    grantedSideBonus: 3,
    sideBonusTurns: 99,
    permanentSideBonus: 2,
    tempKeywords: { 0: 'Armor' },
  });

  assert.equal(migrated.permanentSideBonus, 5);
  assert.equal(migrated.grantedSideBonus, 0);
  assert.equal(migrated.sideBonusTurns, 0);
  assert.deepEqual(migrated.tempKeywords, ['Armor']);
  assert.deepEqual(migrated.grantedKeywords, []);
  assert.deepEqual(migrated.permanentKeywords, []);
});

test('current timed bonuses remain timed during remote normalization', () => {
  const normalized = normalizeRemoteUnit({ grantedSideBonus: 2, sideBonusTurns: 1 });
  assert.equal(normalized.permanentSideBonus ?? 0, 0);
  assert.equal(normalized.grantedSideBonus, 2);
  assert.equal(normalized.sideBonusTurns, 1);
});

test('older board units receive deterministic compatibility identities', () => {
  const board = normalizeRemoteBoard({
    '0,1': { cardId: 'I1', owner: 'p1' },
    '2,3': { cardId: 'I1', owner: 'p2', instanceId: 'unit-8' },
    '3,3': null,
  });
  assert.equal(board['0,1'].instanceId, 'legacy-unit-0-1');
  assert.equal(board['2,3'].instanceId, 'unit-8', 'an existing identity must never be replaced');
  assert.equal(board['3,3'], null);
});
