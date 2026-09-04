import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  grantTempAttacks,
  remainingAttacks,
  resetPersistentAttacks,
  spendAttack,
} from '../js/state.js?v=2026090402';
import { resolveManeuver } from '../js/combat.js?v=2026090402';
import { bestExistingAttack, findCombinedLethal } from '../js/bot_ai.js?v=2026090402';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function unit(owner, cardId, extra = {}) {
  return {
    cardId,
    owner,
    state: 'normal',
    armorHits: 0,
    rotation: 0,
    persistentSpent: 0,
    tempExtraAttacks: 0,
    tempExtraAttacksSpent: 0,
    tempKeywords: [],
    grantedKeywords: [],
    permanentKeywords: [],
    ...extra,
  };
}

function boardWith(entries) {
  const board = {};
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) board[`${row},${col}`] = null;
  }
  return Object.assign(board, entries);
}

function stateWith(board, extra = {}) {
  return {
    turn: 3,
    initiative: 'p1',
    mapId: 'kursk',
    p1: { hq: 30, hand: [], deck: [] },
    p2: { hq: 30, hand: [], deck: [] },
    objectives: {},
    board,
    ...extra,
  };
}

test('one unit-owned counter handles normal, Double Attack, and temporary attacks', () => {
  let normal = unit('p1', 'I1');
  assert.equal(remainingAttacks(normal), 1);
  normal = spendAttack(normal);
  assert.equal(remainingAttacks(normal), 0);

  let double = unit('p1', 'T36');
  assert.equal(remainingAttacks(double), 2);
  double = spendAttack(double);
  assert.equal(remainingAttacks(double), 1);
  double = spendAttack(double);
  assert.equal(remainingAttacks(double), 0);

  double = grantTempAttacks(double, 1);
  assert.equal(remainingAttacks(double), 1, 'temporary attack remains usable after persistent attacks are spent');
  double = spendAttack(double);
  assert.equal(double.tempExtraAttacksSpent, 1);
  assert.equal(remainingAttacks(double), 0);
});

test('Maneuver follows the unit attack state; an explicit reset restores only persistent attacks', () => {
  const exhausted = unit('p1', 'I1', {
    persistentSpent: 1,
    tempExtraAttacks: 1,
    tempExtraAttacksSpent: 1,
  });
  const before = stateWith(boardWith({ '0,0': exhausted, '3,2': unit('p2', 'I15') }));
  const moved = resolveManeuver(before, '0,0', '3,3').state;

  assert.equal(remainingAttacks(moved.board['3,3']), 0, 'moving does not create a new attack');
  assert.equal(bestExistingAttack(moved, 'p1'), null, 'bot and UI engine see the moved unit as exhausted');

  const reset = {
    ...moved,
    board: { ...moved.board, '3,3': resetPersistentAttacks(moved.board['3,3']) },
  };
  assert.equal(remainingAttacks(reset.board['3,3']), 1, 'reset restores the normal persistent attack');
  assert.equal(reset.board['3,3'].tempExtraAttacksSpent, 1, 'reset does not recreate a spent temporary attack');
  assert.equal(bestExistingAttack(reset, 'p1')?.unitKey, '3,3');
});

test('bot planning consumes the same unit counters when simulating Double Attack', () => {
  const state = stateWith(
    boardWith({
      '0,0': unit('p1', 'T36'),
      '0,1': unit('p2', 'I15'),
    }),
    { p2: { hq: 2, hand: [], deck: [] } },
  );

  const plan = findCombinedLethal(state, 'p1');
  assert.equal(plan?.length, 2, 'the two persistent attacks are simulated exactly once each');
  assert.deepEqual(plan?.map(step => step.unitKey), ['0,0', '0,0']);
});

test('runtime no longer maintains a second tile-keyed attack counter', () => {
  for (const relativePath of ['js/game.js', 'js/bot_ai.js', 'js/bot_player.js']) {
    const source = readFileSync(`${ROOT}/${relativePath}`, 'utf8');
    assert.doesNotMatch(source, /attackedThisTurn|attackedMap/, `${relativePath} reintroduced duplicate attack tracking`);
  }
});
