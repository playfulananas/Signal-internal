import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGameEvents,
  resolveCraftDrawback,
  resolveSingleAttack,
} from '../js/combat.js?v=20260904';

function unit(owner, cardId, extra = {}) {
  return {
    cardId,
    owner,
    state: 'normal',
    armorHits: 0,
    rotation: 0,
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

function stateWith(board, p2Hero = true) {
  return {
    turn: 3,
    initiative: 'p1',
    board,
    objectives: {},
    p1: { hq: 30, heroZones: [null, null, null, null], heroTriggeredThisTurn: {} },
    p2: { hq: 30, heroZones: p2Hero ? ['H06', null, null, null] : [null, null, null, null], heroTriggeredThisTurn: {} },
  };
}

function applyMutations(state, mutations) {
  const board = { ...state.board };
  for (const mutation of mutations) board[mutation.key] = mutation.newUnit;
  return { ...state, board };
}

test('Blast emits ordered suppression events and H06 reacts only to the first friendly one', () => {
  const state = stateWith(boardWith({
    '0,0': unit('p1', 'T27', { tempKeywords: ['Blast'] }),
    '0,1': unit('p2', 'I15'),
    '1,1': unit('p2', 'I15'),
  }));

  const attack = resolveSingleAttack(state, '0,0', '0,1');
  assert.deepEqual(attack.events.map(event => event.unitKey), ['0,1', '1,1']);

  const resolved = applyGameEvents(applyMutations(state, attack.boardMutations), attack.events);
  assert.equal(resolved.state.p2.heroTriggeredThisTurn.H06, true);
  assert.equal(resolved.state.board['0,1'].grantedSideBonus, 1, 'primary suppression resolves first');
  assert.equal(resolved.state.board['1,1'].grantedSideBonus ?? 0, 0, 'second suppression does not retrigger H06');
  assert.equal(resolved.log.length, 1);
});

test('Barrage secondary Hits emit the same suppression event as the primary Hit', () => {
  const state = stateWith(boardWith({
    '0,0': unit('p1', 'T27', { tempKeywords: ['Barrage'] }),
    '0,1': unit('p2', 'I15'),
    '0,2': unit('p2', 'I15'),
  }), false);

  const attack = resolveSingleAttack(state, '0,0', '0,1');
  assert.deepEqual(attack.events.map(event => event.unitKey), ['0,1', '0,2']);
});

test('Craft random suppression goes through the shared event hook', t => {
  const originalRandom = Math.random;
  t.after(() => { Math.random = originalRandom; });
  Math.random = () => 0;

  const state = {
    ...stateWith(boardWith({ '0,0': unit('p1', 'I1') }), false),
    p1: { hq: 30, heroZones: ['H06', null, null, null], heroTriggeredThisTurn: {} },
  };
  const resolved = resolveCraftDrawback(state, 'p1', '0,0', 'suppressRandomFriendly');

  assert.equal(resolved.state.board['0,0'].state, 'suppressed');
  assert.equal(resolved.state.board['0,0'].grantedSideBonus, 1);
  assert.equal(resolved.state.p1.heroTriggeredThisTurn.H06, true);
  assert.ok(resolved.log.some(line => line.includes('Counteroffensive General')));
});
