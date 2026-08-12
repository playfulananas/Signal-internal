// Unit tests for Hero Phase turn logic added 2026-08-11: the reinforcement arrival lock,
// the Logistics Chief Fuel cap, the four "first Unit played this turn" passives
// (Objective Marshal 94, Infantry Commander 104, Combined Arms General 109,
// Conventional Warfare Commander 110), and Counteroffensive General (101, wired via
// removeSuppression — the shared suppression-removal funnel). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHeroPassivesOnPlace, removeSuppression } from '../js/combat.js';
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
    lastUnitClass: null,
    ...overrides,
  };
}
const placedUnit = (owner = 'p1') => ({ cardId: 1, owner, state: 'normal', armorHits: 0, grantedSideBonus: 0 });

// ── fuelCapOf / Logistics Chief (89) ────────────────────────────────────────

test('fuelCapOf is 6 with no Heroes deployed', () => {
  assert.equal(fuelCapOf({ fuelCap: 6, heroZones: [null, null, null, null] }), 6);
});

test('fuelCapOf is 8 with Logistics Chief deployed in any zone', () => {
  assert.equal(fuelCapOf({ fuelCap: 6, heroZones: [null, 89, null, null] }), 8);
  assert.equal(fuelCapOf({ fuelCap: 6, heroZones: [89, null, null, null] }), 8);
});

test('fuelCapOf falls back to 6 when heroZones is absent (pre-Hero saved state)', () => {
  assert.equal(fuelCapOf({ fuelCap: 6 }), 6);
});

// ── checkHeroPassivesOnPlace ─────────────────────────────────────────────────

test('Objective Marshal (94) fires only when the placed Unit is on/adjacent to an Objective', () => {
  const rifleSquad = CARD_BY_ID[1]; // Infantry, no keyword — also matches Infantry Commander/CWC,
  const card = { ...rifleSquad, cls: 'Artillery' }; // neutralise unrelated passives for this test
  const objectives = { '0,0': { cardId: 40, level: 1 } };

  const near = { p1: playerState({ heroZones: [94, null, null, null] }), board: boardWith({ '0,1': placedUnit() }), objectives };
  const { state: s1, log: log1 } = checkHeroPassivesOnPlace(near, 'p1', 0, '0,1', card);
  assert.equal(log1.length, 1, 'adjacent to the Objective at 0,0 should fire');
  assert.equal(s1.board['0,1'].grantedSideBonus, 1);
  assert.equal(s1.p1.heroTriggeredThisTurn[94], true);

  const far = { p1: playerState({ heroZones: [94, null, null, null] }), board: boardWith({ '3,3': placedUnit() }), objectives };
  const { log: log2 } = checkHeroPassivesOnPlace(far, 'p1', 0, '3,3', card);
  assert.equal(log2.length, 0, 'far from any Objective should not fire');
});

test('Objective Marshal only fires once per turn, gated by heroTriggeredThisTurn', () => {
  const card = { ...CARD_BY_ID[1], cls: 'Artillery' };
  const objectives = { '0,0': { cardId: 40, level: 1 } };
  const alreadyFired = { p1: playerState({ heroZones: [94, null, null, null], heroTriggeredThisTurn: { 94: true } }),
    board: boardWith({ '0,1': placedUnit() }), objectives };
  const { log } = checkHeroPassivesOnPlace(alreadyFired, 'p1', 0, '0,1', card);
  assert.equal(log.length, 0);
});

test('Infantry Commander (104) fires only for Infantry Units in its column', () => {
  const infantry = { ...CARD_BY_ID[1], cls: 'Infantry', keyword: null };
  const tank = { ...CARD_BY_ID[38], cls: 'Tank', keyword: null };

  const s = { p1: playerState({ heroZones: [null, 104, null, null] }), board: boardWith({ '0,1': placedUnit() }), objectives: {} };
  const { log: infLog } = checkHeroPassivesOnPlace(s, 'p1', 1, '0,1', infantry);
  assert.equal(infLog.length, 1);

  const { log: tankLog } = checkHeroPassivesOnPlace(s, 'p1', 1, '0,1', tank);
  assert.equal(tankLog.length, 0, 'non-Infantry must not trigger Infantry Commander');
});

test('Conventional Warfare Commander (110) fires only for vanilla (no-keyword) Units', () => {
  const vanilla = { ...CARD_BY_ID[38], keyword: null };
  const keyworded = { ...CARD_BY_ID[38], keyword: 'Armor' };

  const s = { p1: playerState({ heroZones: [null, null, 110, null] }), board: boardWith({ '0,2': placedUnit() }), objectives: {} };
  const { log: vanillaLog } = checkHeroPassivesOnPlace(s, 'p1', 2, '0,2', vanilla);
  assert.equal(vanillaLog.length, 1);

  const { log: keywordLog } = checkHeroPassivesOnPlace(s, 'p1', 2, '0,2', keyworded);
  assert.equal(keywordLog.length, 0, 'a Unit carrying a keyword is not vanilla');
});

test('Combined Arms General (109) is board-wide, not column-gated, and needs a class change', () => {
  const artillery = { ...CARD_BY_ID[1], cls: 'Artillery', keyword: null };
  // Hero sits in column 3; the Unit is placed in column 0 — must still fire (scope: "board").
  const s = { p1: playerState({ heroZones: [null, null, null, 109], lastUnitClass: 'Infantry' }),
    board: boardWith({ '0,0': placedUnit() }), objectives: {} };
  const { state: after, log } = checkHeroPassivesOnPlace(s, 'p1', 0, '0,0', artillery);
  assert.equal(log.length, 1);
  assert.equal(after.p1.lastUnitClass, 'Artillery', 'lastUnitClass must update for the next comparison');

  const sameClass = { p1: playerState({ heroZones: [null, null, null, 109], lastUnitClass: 'Artillery' }),
    board: boardWith({ '0,0': placedUnit() }), objectives: {} };
  const { log: log2 } = checkHeroPassivesOnPlace(sameClass, 'p1', 0, '0,0', artillery);
  assert.equal(log2.length, 0, 'same class as the previous Unit must not fire');
});

test('lastUnitClass updates even when no passive fires, so the next placement compares correctly', () => {
  const card = { ...CARD_BY_ID[1], cls: 'Naval', keyword: 'Bombard' }; // trips no passive here
  const s = { p1: playerState(), board: boardWith({ '0,0': placedUnit() }), objectives: {} };
  const { state: after } = checkHeroPassivesOnPlace(s, 'p1', 0, '0,0', card);
  assert.equal(after.p1.lastUnitClass, 'Naval');
});

test('multiple column Heroes can stack their bonus onto the same Unit', () => {
  // Objective Marshal and Combined Arms General occupy different columns but both qualify
  // for a Unit placed on an Objective in Marshal's column, since CAG is board-wide.
  const card = { ...CARD_BY_ID[1], cls: 'Infantry', keyword: null };
  const objectives = { '0,0': { cardId: 40, level: 1 } };
  const s = { p1: playerState({ heroZones: [94, null, null, 109], lastUnitClass: 'Tank' }),
    board: boardWith({ '0,0': placedUnit() }), objectives };
  const { state: after, log } = checkHeroPassivesOnPlace(s, 'p1', 0, '0,0', card);
  assert.equal(log.length, 2);
  assert.equal(after.board['0,0'].grantedSideBonus, 2);
});

// ── removeSuppression / Counteroffensive General (101) ──────────────────────
const suppressedUnit = (owner = 'p1') => ({ cardId: 1, owner, state: 'suppressed', armorHits: 0, tempSideBonus: 0 });

test('removeSuppression clears Suppression and reports changed:true with no Hero deployed', () => {
  const s = { p1: playerState(), board: boardWith({ '0,0': suppressedUnit() }) };
  const { state: after, log, changed } = removeSuppression(s, '0,0');
  assert.equal(changed, true);
  assert.equal(after.board['0,0'].state, 'normal');
  assert.deepEqual(log, []);
});

test('removeSuppression is a no-op (changed:false) on an already-healthy unit', () => {
  const s = { p1: playerState(), board: boardWith({ '0,0': placedUnit() }) };
  const { state: after, log, changed } = removeSuppression(s, '0,0');
  assert.equal(changed, false);
  assert.deepEqual(log, []);
  assert.equal(after, s, 'must return the same state reference — nothing to update');
});

test('Counteroffensive General grants +1 all sides (tempSideBonus) when its column heals', () => {
  const s = { p1: playerState({ heroZones: [101, null, null, null] }), board: boardWith({ '0,0': suppressedUnit() }) };
  const { state: after, log, changed } = removeSuppression(s, '0,0');
  assert.equal(changed, true);
  assert.equal(after.board['0,0'].state, 'normal');
  assert.equal(after.board['0,0'].tempSideBonus, 1, 'uses tempSideBonus (end of turn), not grantedSideBonus');
  assert.equal(log.length, 1);
  assert.equal(after.p1.heroTriggeredThisTurn[101], true);
});

test('Counteroffensive General only fires once per turn', () => {
  const s = { p1: playerState({ heroZones: [101, null, null, null], heroTriggeredThisTurn: { 101: true } }),
    board: boardWith({ '0,0': suppressedUnit() }) };
  const { log } = removeSuppression(s, '0,0');
  assert.deepEqual(log, []);
});

test('Counteroffensive General does not fire if deployed in a different column', () => {
  const s = { p1: playerState({ heroZones: [null, 101, null, null] }), // column 1, healed unit is column 0
    board: boardWith({ '0,0': suppressedUnit() }) };
  const { log } = removeSuppression(s, '0,0');
  assert.deepEqual(log, []);
});

test('Counteroffensive General checks the healed unit\'s own owner, not a fixed player', () => {
  // Reproduces the Combined Arms Doctrine case: it heals both players' units in one pass.
  // p2 has Counteroffensive General; a p1 unit healed in the same column must NOT trigger it.
  const s = {
    p1: playerState({ heroZones: [null, null, null, null] }),
    p2: playerState({ heroZones: [101, null, null, null] }),
    board: boardWith({ '0,0': suppressedUnit('p1'), '1,0': suppressedUnit('p2') }),
  };
  const r1 = removeSuppression(s, '0,0'); // p1's unit — p2's Hero must not care
  assert.deepEqual(r1.log, []);
  const r2 = removeSuppression(r1.state, '1,0'); // p2's unit, same column as p2's Hero — fires
  assert.equal(r2.log.length, 1);
  assert.equal(r2.state.board['1,0'].tempSideBonus, 1);
});
