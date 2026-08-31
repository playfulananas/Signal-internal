// Unit tests for Direct HQ (evaluateDirectHQ, combat.js) — Set 1 truth doc 01 §19.
// This mechanic had ZERO test coverage before this file, despite being flagged "MUST TEST
// EARLY" / P0 in Denis's 08_SIGNAL_Local_Playtest_Card_QA_Checklist. Section numbers below
// reference that checklist's Section 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDirectHQ } from '../js/combat.js';

function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
const unit = (owner, cardId = 'I1', extra = {}) => ({ cardId, owner, state: 'normal', armorHits: 0, rotation: 0, persistentSpent: 0, tempExtraAttacks: 0, tempExtraAttacksSpent: 0, tempKeywords: [], grantedKeywords: [], ...extra });
const baseState = (board, extra = {}) => ({ turn: 2, mapId: 'kursk', board, objectives: {}, p1: { hq: 30 }, p2: { hq: 30 }, ...extra });

test('normal Unit, 1 remaining attack, no legal target -> 1 HQ damage', () => {
  const state = baseState(boardWith({ '0,0': unit('p1') }));
  const { hqDamageToP2, log } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 1);
  assert.equal(log.length, 1);
});

test('Double Attack Unit, 2 remaining attacks, no target -> 2 sequential HQ damage', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T36') })); // T36 Flak Halftrack, Double Attack
  const { hqDamageToP2, log } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 2);
  assert.equal(log.length, 2);
});

test('one attack already spent, one remaining -> only the remaining attack converts', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T36', { persistentSpent: 1 }) })); // Double Attack, 1 of 2 spent
  const { hqDamageToP2 } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 1);
});

test('legal adjacent enemy target exists, even one the attacker would lose to -> NO Direct HQ', () => {
  // I1 Rifle Squad (5/4/3/2) attacking into T27 King Tiger (9/9/9/9) — attacker loses every
  // comparison, but getAttackableTargets only checks legality, not attackBeats, so this still
  // counts as a legal target and must block conversion.
  const state = baseState(boardWith({ '0,0': unit('p1', 'I1'), '0,1': unit('p2', 'T27') }));
  const { hqDamageToP2, log } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 0);
  assert.equal(log.length, 0);
});

test('Bombard Unit with an enemy at range 2/3 -> NO Direct HQ (legal ranged target exists)', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'AR43'), '3,0': unit('p2', 'I1') })); // AR43 Field Howitzer, Bombard
  const { hqDamageToP2 } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 0);
});

test('Bombard Unit with no legal ranged/adjacent enemy -> remaining attacks convert', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'AR43') }));
  const { hqDamageToP2 } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 1);
});

test('a reachable Guard enemy is a legal target and blocks Direct HQ, even while Suppressed', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I1'), '0,1': unit('p2', 'I6', { state: 'suppressed' }) })); // I6 Shield Bearers, Guard
  const { hqDamageToP2 } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 0, 'Suppressed Guard still counts as a legal target per locked decisions');
});

test('Suppressed friendly Unit never Direct HQs, even fully isolated with no targets', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I1', { state: 'suppressed' }) }));
  const { hqDamageToP2, log } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 0);
  assert.equal(log.length, 0);
});

test('temporary additional attack (persistent pool exhausted) still converts through Direct HQ', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I1', { persistentSpent: 1, tempExtraAttacks: 1, tempExtraAttacksSpent: 0 }) }));
  const { hqDamageToP2 } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 1, 'temp attacks must still be read by remainingAttacks() at Direct HQ time');
});

test('temporary Bombard grant (tempKeywords) is honored by Direct HQ target-legality check', () => {
  // I1 has no innate Bombard; grant it via tempKeywords the same way Fire Support Officer (H12)
  // does. An enemy 2 tiles away in the same row is now a legal ranged target -> blocks Direct HQ.
  const state = baseState(boardWith({ '0,0': unit('p1', 'I1', { tempKeywords: ['Bombard'] }), '0,2': unit('p2', 'I2') }));
  const { hqDamageToP2 } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 0, 'a temp-granted Bombard target must still block conversion');
});

test('Player 1 first turn (state.turn === 1) produces 0 Direct HQ regardless of setup', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T36') }), { turn: 1 });
  const { hqDamageToP2, log } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 0);
  assert.equal(log.length, 0);
});

test('Player 2 first turn (state.turn === 2) uses normal Direct HQ, not blocked', () => {
  const state = baseState(boardWith({ '0,0': unit('p2', 'I1') }), { turn: 2 });
  const { hqDamageToP1 } = evaluateDirectHQ(state, 'p2');
  assert.equal(hqDamageToP1, 1);
});

test('multiple qualifying Units resolve in fixed left-to-right column, top-to-bottom order', () => {
  const state = baseState(boardWith({ '2,1': unit('p1', 'I1'), '0,0': unit('p1', 'I2'), '1,0': unit('p1', 'I3') }));
  const { log } = evaluateDirectHQ(state, 'p1');
  // Column 0 first (I2 at row0, then I3 at row1), then column 1 (I1 at row2).
  assert.equal(log.length, 3);
  assert.ok(log[0].startsWith('Militia'));           // I2, col 0 row 0
  assert.ok(log[1].startsWith('Regular Infantry'));  // I3, col 0 row 1
  assert.ok(log[2].startsWith('Rifle Squad'));        // I1, col 1 row 2
});

test('lethal Direct HQ stops accumulating damage exactly at the lethal instant', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T36') }), { p2: { hq: 1 } }); // Double Attack, 2 remaining, but opp HQ = 1
  const { hqDamageToP2, log } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 1, 'only the lethal point of damage should land, not both Double Attack hits');
  assert.equal(log.length, 1);
});

test('evaluateDirectHQ never calls into attack-resolution machinery (structural: no Rally trigger possible)', () => {
  // Rally only fires from checkRally/resolveSingleAttack in the real attack path (game.js) —
  // evaluateDirectHQ's own board mutations are limited to spendAttack bookkeeping, so a Rally
  // Infantry with no target converts via Direct HQ without any Rally side effect to assert on.
  const state = baseState(boardWith({ '0,0': unit('p1', 'I12') })); // I12 Assault Trooper, Rally: draw 1 card
  const { state: after, hqDamageToP2 } = evaluateDirectHQ(state, 'p1');
  assert.equal(hqDamageToP2, 1);
  assert.equal(after.p1.hand, undefined, 'no player-state hand mutation of any kind occurred');
});
