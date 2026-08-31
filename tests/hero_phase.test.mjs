// Unit tests for Hero Phase turn logic. Run: node --test tests/
// Updated 2026-08-31 (Run 1, Set 1 surgical update) for the new 25-Hero pool:
//   H02 Logistics Chief (Fuel cap), H04 Objective Marshal (+1, adjacent to an Objective),
//   H08 Infantry Commander (+2, first Infantry in column), H13 Supreme Commander (column
//   freedom), H06 Counteroffensive General (board-wide, fires on Suppression being applied).
// Dropped from this file (no longer applicable):
//   - old 109 Combined Arms General — archived entirely, no new-truth equivalent.
//   - old 110 Conventional Warfare Commander's on-PLACEMENT passive test — the new H10 is a
//     board-scoped ACTIVE Hero power ("give 1 friendly Vanilla Unit +3 until end of turn"),
//     not a placement-triggered passive, so it no longer goes through checkHeroPassivesOnPlace
//     at all; it belongs in game.js's Hero-Active wiring instead (not yet covered by a test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHeroPassivesOnPlace, removeSuppression, checkCounteroffensiveGeneral } from '../js/combat.js';
import { fuelCapOf } from '../js/state.js';
import { CARD_BY_ID } from '../js/cards.js';

function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
function playerState(overrides = {}) {
  return {
    heroZones: [null, null, null, null],
    heroTriggeredThisTurn: {},
    ...overrides,
  };
}
const placedUnit = (owner = 'p1') => ({ cardId: 'I1', owner, state: 'normal', armorHits: 0, grantedSideBonus: 0 });

// ── fuelCapOf / Logistics Chief (H02) ────────────────────────────────────────

test('fuelCapOf is 6 with no Heroes deployed', () => {
  assert.equal(fuelCapOf({ fuelCap: 6, heroZones: [null, null, null, null] }), 6);
});

test('fuelCapOf is 11 with Logistics Chief deployed in any zone', () => {
  assert.equal(fuelCapOf({ fuelCap: 6, heroZones: [null, 'H02', null, null] }), 11);
  assert.equal(fuelCapOf({ fuelCap: 6, heroZones: ['H02', null, null, null] }), 11);
});

test('fuelCapOf falls back to 6 when heroZones is absent (pre-Hero saved state)', () => {
  assert.equal(fuelCapOf({ fuelCap: 6 }), 6);
});

// ── checkHeroPassivesOnPlace ─────────────────────────────────────────────────

test('Objective Marshal (H04) fires only when the placed Unit is adjacent to an Objective', () => {
  const card = { ...CARD_BY_ID['I1'], cls: 'Artillery' }; // neutralise Infantry Commander for this test
  const objectives = { '0,0': { cardId: 'O1', level: 1 } };

  const near = { p1: playerState({ heroZones: ['H04', null, null, null] }), board: boardWith({ '0,1': placedUnit() }), objectives };
  const { state: s1, log: log1 } = checkHeroPassivesOnPlace(near, 'p1', 0, '0,1', card);
  assert.equal(log1.length, 1, 'adjacent to the Objective at 0,0 should fire');
  assert.equal(s1.board['0,1'].grantedSideBonus, 1);
  assert.equal(s1.p1.heroTriggeredThisTurn['H04'], true);

  const far = { p1: playerState({ heroZones: ['H04', null, null, null] }), board: boardWith({ '3,3': placedUnit() }), objectives };
  const { log: log2 } = checkHeroPassivesOnPlace(far, 'p1', 0, '3,3', card);
  assert.equal(log2.length, 0, 'far from any Objective should not fire');
});

test('Objective Marshal only fires once per turn, gated by heroTriggeredThisTurn', () => {
  const card = { ...CARD_BY_ID['I1'], cls: 'Artillery' };
  const objectives = { '0,0': { cardId: 'O1', level: 1 } };
  const alreadyFired = { p1: playerState({ heroZones: ['H04', null, null, null], heroTriggeredThisTurn: { H04: true } }),
    board: boardWith({ '0,1': placedUnit() }), objectives };
  const { log } = checkHeroPassivesOnPlace(alreadyFired, 'p1', 0, '0,1', card);
  assert.equal(log.length, 0);
});

test('Supreme Commander (H13) makes Objective Marshal (H04) fire outside its own column', () => {
  // H04 sits in column 0; Unit placed in column 3 — without freedom this must NOT fire.
  const card = { ...CARD_BY_ID['I1'], cls: 'Artillery' };
  const objectives = { '0,3': { cardId: 'O1', level: 1 } };
  const noFreedom = { p1: playerState({ heroZones: ['H04', null, null, null] }), board: boardWith({ '0,3': placedUnit() }), objectives };
  const { log: log1 } = checkHeroPassivesOnPlace(noFreedom, 'p1', 3, '0,3', card);
  assert.equal(log1.length, 0, 'column 0 Hero must not affect column 3 without Supreme Commander');

  const withFreedom = { p1: playerState({ heroZones: ['H04', null, null, 'H13'] }), board: boardWith({ '0,3': placedUnit() }), objectives };
  const { log: log2 } = checkHeroPassivesOnPlace(withFreedom, 'p1', 3, '0,3', card);
  assert.equal(log2.length, 1, 'Supreme Commander deployed anywhere lifts the column restriction');
});

test('Infantry Commander (H08) fires only for Infantry Units in its column, +2 all sides', () => {
  const infantry = { ...CARD_BY_ID['I1'], cls: 'Infantry', keyword: null };
  const tank = { ...CARD_BY_ID['T23'], cls: 'Tank', keyword: null };

  const s = { p1: playerState({ heroZones: [null, 'H08', null, null] }), board: boardWith({ '0,1': placedUnit() }), objectives: {} };
  const { state: after, log: infLog } = checkHeroPassivesOnPlace(s, 'p1', 1, '0,1', infantry);
  assert.equal(infLog.length, 1);
  assert.equal(after.board['0,1'].grantedSideBonus, 2);

  const { log: tankLog } = checkHeroPassivesOnPlace(s, 'p1', 1, '0,1', tank);
  assert.equal(tankLog.length, 0, 'non-Infantry must not trigger Infantry Commander');
});

test('multiple column Heroes can stack their bonus onto the same Unit, via Supreme Commander freedom', () => {
  // One Hero per column is a hard rule, so two column-scoped Heroes can never literally share
  // a column — the only way both can qualify for the SAME placement is if Supreme Commander
  // (H13) gives at least one of them board-wide reach. H04 sits in column 0 (matches the
  // placement column directly); H08 sits in column 1 but fires anyway thanks to H13's freedom.
  const card = { ...CARD_BY_ID['I1'], cls: 'Infantry', keyword: null };
  const objectives = { '0,0': { cardId: 'O1', level: 1 } };
  const s = { p1: playerState({ heroZones: ['H04', 'H08', 'H13', null] }), board: boardWith({ '1,0': placedUnit() }), objectives };
  const { state: after, log } = checkHeroPassivesOnPlace(s, 'p1', 0, '1,0', card);
  assert.equal(log.length, 2);
  assert.equal(after.board['1,0'].grantedSideBonus, 3); // 1 (Objective Marshal) + 2 (Infantry Commander)
});

// ── removeSuppression ─────────────────────────────────────────────────────────
// Counteroffensive General (H06) fires from the Suppression-APPLYING side (see
// checkCounteroffensiveGeneral tests below), never from removeSuppression.
const suppressedUnit = (owner = 'p1') => ({ cardId: 'I1', owner, state: 'suppressed', armorHits: 0, tempSideBonus: 0, grantedSideBonus: 0 });

test('removeSuppression clears Suppression and reports changed:true, with no Hero side-effects', () => {
  const s = { p1: playerState({ heroZones: ['H06', null, null, null] }), board: boardWith({ '0,0': suppressedUnit() }) };
  const { state: after, log, changed } = removeSuppression(s, '0,0');
  assert.equal(changed, true);
  assert.equal(after.board['0,0'].state, 'normal');
  assert.deepEqual(log, [], 'removeSuppression itself never triggers Counteroffensive General');
  assert.equal(after.board['0,0'].tempSideBonus, 0, 'unchanged — H06 only fires from the Suppress-applying side');
});

test('removeSuppression is a no-op (changed:false) on an already-healthy unit', () => {
  const s = { p1: playerState(), board: boardWith({ '0,0': placedUnit() }) };
  const { state: after, log, changed } = removeSuppression(s, '0,0');
  assert.equal(changed, false);
  assert.deepEqual(log, []);
  assert.equal(after, s, 'must return the same state reference — nothing to update');
});

// ── checkCounteroffensiveGeneral (H06) ───────────────────────────────────────
// Board-wide, fires from the Suppression-APPLYING side. Grants +1 all sides UNTIL YOUR NEXT
// TURN (grantedSideBonus/sideBonusTurns:1) — a longer-lasting grant than the old prototype's
// "until end of turn" version.
test('Counteroffensive General grants +1 all sides (until your next turn) to a newly-suppressed unit', () => {
  const s = { p1: playerState({ heroZones: ['H06', null, null, null] }), board: boardWith({ '0,0': suppressedUnit() }) };
  const { state: after, log } = checkCounteroffensiveGeneral(s, '0,0');
  assert.equal(after.board['0,0'].grantedSideBonus, 1, 'uses grantedSideBonus (until your next turn)');
  assert.equal(after.board['0,0'].sideBonusTurns, 1);
  assert.equal(log.length, 1);
  assert.equal(after.p1.heroTriggeredThisTurn['H06'], true);
});

test('Counteroffensive General is board-wide — fires regardless of which column the Hero sits in', () => {
  const s = { p1: playerState({ heroZones: [null, 'H06', null, null] }), // column 1
    board: boardWith({ '0,0': suppressedUnit() }) }; // suppressed unit is column 0
  const { log } = checkCounteroffensiveGeneral(s, '0,0');
  assert.equal(log.length, 1, 'column does not gate this passive');
});

test('Counteroffensive General only fires once per turn', () => {
  const s = { p1: playerState({ heroZones: ['H06', null, null, null], heroTriggeredThisTurn: { H06: true } }),
    board: boardWith({ '0,0': suppressedUnit() }) };
  const { log } = checkCounteroffensiveGeneral(s, '0,0');
  assert.deepEqual(log, []);
});

test('Counteroffensive General does not fire when not deployed', () => {
  const s = { p1: playerState(), board: boardWith({ '0,0': suppressedUnit() }) };
  const { log } = checkCounteroffensiveGeneral(s, '0,0');
  assert.deepEqual(log, []);
});

test('Counteroffensive General checks the affected unit\'s own owner, not a fixed player', () => {
  const s = {
    p1: playerState({ heroZones: [null, null, null, null] }),
    p2: playerState({ heroZones: ['H06', null, null, null] }),
    board: boardWith({ '0,0': suppressedUnit('p1'), '1,0': suppressedUnit('p2') }),
  };
  const r1 = checkCounteroffensiveGeneral(s, '0,0'); // p1's unit — p2's Hero must not care
  assert.deepEqual(r1.log, []);
  const r2 = checkCounteroffensiveGeneral(r1.state, '1,0'); // p2's unit — fires for p2
  assert.equal(r2.log.length, 1);
  assert.equal(r2.state.board['1,0'].grantedSideBonus, 1);
});
