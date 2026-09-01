// Unit tests for Objective player-choice targeting (2026-09-01). Doc 04 §6 locks auto-random
// selection only for secondary effects whose card text says "random" (16 of 20). The other 4
// (Airfield L2, Supply Depot L1, City L1, Artillery Position L1) don't say "random" and the doc
// is silent on selection method — these tests cover getObjectivePickEffectType and
// computeObjectivePickTargets, the two pure functions this feature adds to combat.js.
//
// The resumable-loop mechanics themselves (applyObjectiveEffects's pause/resume, the click
// handler, render highlight, Hero-phase deferral, online sync, bot handling) live in game.js,
// which executes `document.getElementById(...)` calls at module scope and so cannot be imported
// into this node:test environment (no DOM) — same constraint every other game.js function in
// this codebase has. Those are covered by live Playwright verification instead; see CHANGELOG.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getObjectivePickEffectType, computeObjectivePickTargets, getManeuverTargets } from '../js/combat.js';

function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
const unit = (owner, cardId = 'I1', extra = {}) => ({ cardId, owner, state: 'normal', armorHits: 0, rotation: 0, tempKeywords: [], grantedKeywords: [], permanentKeywords: [], ...extra });

// ── getObjectivePickEffectType ──────────────────────────────────────────────

test('getObjectivePickEffectType maps exactly the 4 non-random secondaries', () => {
  assert.equal(getObjectivePickEffectType('O2', 2), 'maneuver');
  assert.equal(getObjectivePickEffectType('O3', 1), 'removeSuppression');
  assert.equal(getObjectivePickEffectType('O4', 1), 'grantGuard');
  assert.equal(getObjectivePickEffectType('O5', 1), 'rotate');
});

test('getObjectivePickEffectType returns null for every "random" secondary (no change in behavior)', () => {
  assert.equal(getObjectivePickEffectType('O1', 1), null);
  assert.equal(getObjectivePickEffectType('O2', 1), null);
  assert.equal(getObjectivePickEffectType('O2', 3), null);
  assert.equal(getObjectivePickEffectType('O2', 4), null);
  assert.equal(getObjectivePickEffectType('O3', 2), null);
  assert.equal(getObjectivePickEffectType('O3', 3), null);
  assert.equal(getObjectivePickEffectType('O3', 4), null);
  assert.equal(getObjectivePickEffectType('O4', 2), null);
  assert.equal(getObjectivePickEffectType('O4', 3), null);
  assert.equal(getObjectivePickEffectType('O4', 4), null);
  assert.equal(getObjectivePickEffectType('O5', 2), null);
  assert.equal(getObjectivePickEffectType('O5', 3), null);
  assert.equal(getObjectivePickEffectType('O5', 4), null);
});

// ── computeObjectivePickTargets: maneuver (Airfield L2) ─────────────────────

test('maneuver step 1 (no sourceKey): only friendly Units with a legal destination are eligible', () => {
  const state = {
    mapId: 'kursk',
    board: boardWith({
      '1,1': unit('p1', 'I1'),            // has legal destinations (board mostly empty)
      '2,2': unit('p2', 'I1'),            // enemy — never eligible regardless of mobility
    }),
    objectives: { '0,1': { cardId: 'O2', level: 2, controller: 'p1' } },
  };
  const targets = computeObjectivePickTargets(state, '0,1', 'maneuver', null);
  assert.deepEqual(targets, ['1,1']);
});

test('maneuver step 2 (sourceKey set): destinations match getManeuverTargets exactly for that unit', () => {
  const state = {
    mapId: 'kursk',
    board: boardWith({ '1,1': unit('p1', 'I1') }),
    objectives: { '0,1': { cardId: 'O2', level: 2, controller: 'p1' } },
  };
  const targets = computeObjectivePickTargets(state, '0,1', 'maneuver', '1,1');
  assert.deepEqual(targets, getManeuverTargets(state, '1,1'));
  assert.ok(targets.length > 0);
});

test('maneuver: no eligible source when every friendly Unit is fully boxed in', () => {
  // Fill the whole board so no Unit has any empty destination tile.
  const entries = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) entries[`${r},${c}`] = unit(r === 0 && c === 0 ? 'p1' : 'p2', 'I1');
  const state = { mapId: 'kursk', board: boardWith(entries), objectives: { '0,1': { cardId: 'O2', level: 2, controller: 'p1' } } };
  assert.deepEqual(computeObjectivePickTargets(state, '0,1', 'maneuver', null), []);
});

// ── computeObjectivePickTargets: removeSuppression (Supply Depot L1) ────────

test('removeSuppression: only Suppressed friendly Units orthogonally adjacent to the Objective are eligible', () => {
  const state = {
    mapId: 'kursk',
    board: boardWith({
      '1,1': unit('p1', 'I1', { state: 'suppressed' }),   // adjacent, suppressed — eligible
      '3,3': unit('p1', 'I1', { state: 'suppressed' }),   // not adjacent to 1,2 — excluded
      '0,2': unit('p1', 'I1'),                             // adjacent but not suppressed — excluded
      '2,2': unit('p2', 'I1', { state: 'suppressed' }),   // adjacent but enemy — excluded
    }),
    objectives: { '1,2': { cardId: 'O3', level: 1, controller: 'p1' } },
  };
  const targets = computeObjectivePickTargets(state, '1,2', 'removeSuppression', null);
  assert.deepEqual(targets, ['1,1']);
});

test('removeSuppression: no eligible target when no adjacent friendly Unit is Suppressed', () => {
  const state = {
    mapId: 'kursk',
    board: boardWith({ '1,1': unit('p1', 'I1') }),
    objectives: { '1,2': { cardId: 'O3', level: 1, controller: 'p1' } },
  };
  assert.deepEqual(computeObjectivePickTargets(state, '1,2', 'removeSuppression', null), []);
});

// ── computeObjectivePickTargets: grantGuard (City L1) ───────────────────────

test('grantGuard: board-wide (not adjacency-restricted), excludes any Unit with active Guard from any source', () => {
  const state = {
    mapId: 'kursk',
    board: boardWith({
      '3,3': unit('p1', 'I1'),                                        // far from City, still eligible (board-wide)
      '1,1': unit('p1', 'I6'),                                        // I6 Shield Bearers — printed Guard — excluded
      '1,3': unit('p1', 'I1', { grantedKeywords: ['Guard'] }),        // granted Guard — excluded (any source)
      '2,2': unit('p2', 'I1'),                                        // enemy — excluded
    }),
    objectives: { '0,0': { cardId: 'O4', level: 1, controller: 'p1' } },
  };
  const targets = computeObjectivePickTargets(state, '0,0', 'grantGuard', null).sort();
  assert.deepEqual(targets, ['3,3']);
});

test('grantGuard: no eligible target when every friendly Unit already has Guard', () => {
  const state = {
    mapId: 'kursk',
    board: boardWith({ '1,1': unit('p1', 'I6') }), // I6 Shield Bearers — printed Guard
    objectives: { '0,0': { cardId: 'O4', level: 1, controller: 'p1' } },
  };
  assert.deepEqual(computeObjectivePickTargets(state, '0,0', 'grantGuard', null), []);
});

// ── computeObjectivePickTargets: rotate (Artillery Position L1) ─────────────

test('rotate: every friendly Unit on the board is eligible, enemy Units are not', () => {
  const state = {
    mapId: 'kursk',
    board: boardWith({ '3,3': unit('p1', 'I1'), '0,0': unit('p1', 'I2'), '2,2': unit('p2', 'I1') }),
    objectives: { '1,1': { cardId: 'O5', level: 1, controller: 'p1' } },
  };
  const targets = computeObjectivePickTargets(state, '1,1', 'rotate', null).sort();
  assert.deepEqual(targets, ['0,0', '3,3']);
});

test('rotate: no eligible target when the controlling player has no Units on board', () => {
  const state = { mapId: 'kursk', board: boardWith({ '2,2': unit('p2', 'I1') }), objectives: { '1,1': { cardId: 'O5', level: 1, controller: 'p1' } } };
  assert.deepEqual(computeObjectivePickTargets(state, '1,1', 'rotate', null), []);
});

// ── Defensive ────────────────────────────────────────────────────────────────

test('computeObjectivePickTargets returns [] for an unknown objectiveKey or effectType', () => {
  const state = { mapId: 'kursk', board: boardWith({}), objectives: {} };
  assert.deepEqual(computeObjectivePickTargets(state, '0,0', 'grantGuard', null), []);
  const state2 = { mapId: 'kursk', board: boardWith({}), objectives: { '0,0': { cardId: 'O4', level: 1, controller: 'p1' } } };
  assert.deepEqual(computeObjectivePickTargets(state2, '0,0', 'somethingElse', null), []);
});
