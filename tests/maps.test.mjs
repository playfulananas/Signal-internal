// Data-integrity tests for maps.js, plus canPlaceOnTerrain's terrain rules.
// Rewritten 2026-08-31 (Run 2) against doc 04 (SIGNAL Objectives & Maps Truth v1.0): exactly
// 4 locked maps (Normandy/Midway archived, not tested as live maps here), no water terrain,
// no Naval class, and exact per-map Objective slot geometry (doc 04 §13-16). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, ARCHIVED_MAPS, getTerrain, canPlaceOnTerrain } from '../js/maps.js';
import { CARD_BY_ID } from '../js/cards.js';

test('doc 04 §"CURRENT SNAPSHOT": exactly 4 live maps', () => {
  assert.deepEqual(Object.keys(MAPS).sort(), ['ardennes', 'el_alamein', 'kursk', 'stalingrad']);
});

test('every map has a full 4x4 grid', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    assert.equal(map.grid.length, 4, `${id}: grid must have 4 rows`);
    for (const row of map.grid) assert.equal(row.length, 4, `${id}: every row must have 4 columns`);
  }
});

test('doc 04 §12: no Set 1 water terrain on any live map', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    for (const row of map.grid) {
      for (const cell of row) assert.notEqual(cell, 'water', `${id}: water terrain is cut in Set 1`);
    }
  }
});

test('every map has 1-4 objectiveSlots, and slot counts are not all the same', () => {
  const counts = new Set();
  for (const [id, map] of Object.entries(MAPS)) {
    const n = map.objectiveSlots.length;
    assert.ok(n >= 1 && n <= 4, `${id}: objectiveSlots length ${n} out of 1-4 range`);
    counts.add(n);
  }
  assert.ok(counts.size > 1, 'objective slot counts must vary across maps, not be fixed');
});

test('every objectiveSlot is a valid, in-bounds, non-duplicated tile key', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    const seen = new Set();
    for (const key of map.objectiveSlots) {
      const [r, c] = key.split(',').map(Number);
      assert.ok(Number.isInteger(r) && r >= 0 && r < 4, `${id}: ${key} row out of bounds`);
      assert.ok(Number.isInteger(c) && c >= 0 && c < 4, `${id}: ${key} col out of bounds`);
      assert.ok(!seen.has(key), `${id}: duplicate objective slot ${key}`);
      seen.add(key);
    }
  }
});

// Doc 04 §2/13-16: corner = 2 adjacent battlefield coordinates, edge non-corner = 3,
// interior = 4 — same geometry the QA assertions (§19) call out per map.
function adjacentCount(key) {
  const [r, c] = key.split(',').map(Number);
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => rr >= 0 && rr < 4 && cc >= 0 && cc < 4).length;
}

test('doc 04 §13: Stalingrad — 1 slot, interior (B2), 4 adjacent contest positions, 15 occupiable tiles', () => {
  const map = MAPS.stalingrad;
  assert.deepEqual(map.objectiveSlots, ['1,1']);
  assert.equal(adjacentCount('1,1'), 4);
  assert.equal(16 - map.objectiveSlots.length, 15);
});

test('doc 04 §14: Kursk — 2 slots (A2, D3), both edge, 3 adjacent contest positions each, 14 occupiable tiles', () => {
  const map = MAPS.kursk;
  assert.deepEqual(map.objectiveSlots, ['1,0', '2,3']);
  for (const slot of map.objectiveSlots) assert.equal(adjacentCount(slot), 3, `${slot} must be an edge position`);
  assert.equal(16 - map.objectiveSlots.length, 14);
});

test('doc 04 §15: El Alamein — 3 slots (A4 corner/2, B2 interior/4, C1 edge/3), 13 occupiable tiles', () => {
  const map = MAPS.el_alamein;
  assert.deepEqual(map.objectiveSlots, ['3,0', '1,1', '0,2']);
  assert.equal(adjacentCount('3,0'), 2, 'A4 must be a corner');
  assert.equal(adjacentCount('1,1'), 4, 'B2 must be interior');
  assert.equal(adjacentCount('0,2'), 3, 'C1 must be an edge');
  assert.equal(16 - map.objectiveSlots.length, 13);
});

test('doc 04 §16: Ardennes — 4 slots (A2, B4, C1, D3), all edge, 3 adjacent contest positions each, 12 occupiable tiles', () => {
  const map = MAPS.ardennes;
  assert.deepEqual(map.objectiveSlots, ['1,0', '3,1', '0,2', '2,3']);
  for (const slot of map.objectiveSlots) assert.equal(adjacentCount(slot), 3, `${slot} must be an edge position`);
  assert.equal(16 - map.objectiveSlots.length, 12);
});

test('objectiveExclude, where present on a live map, only lists real objective card ids', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    for (const cardId of map.objectiveExclude ?? []) {
      const card = CARD_BY_ID[cardId];
      assert.ok(card && card.type === 'objective', `${id}: objectiveExclude entry ${cardId} is not a valid objective card`);
    }
  }
});

test('Run 2: Normandy and Midway are archived, not deleted, and not part of live MAPS', () => {
  assert.ok(ARCHIVED_MAPS.normandy?.archived);
  assert.ok(ARCHIVED_MAPS.midway?.archived);
  assert.equal(MAPS.normandy, undefined);
  assert.equal(MAPS.midway, undefined);
});

test('canPlaceOnTerrain: forest blocks Tank unless Airborne', () => {
  assert.equal(canPlaceOnTerrain({ cls: 'Tank', keyword: null }, 'forest'), false);
  assert.equal(canPlaceOnTerrain({ cls: 'Tank', keyword: 'Airborne' }, 'forest'), true);
  assert.equal(canPlaceOnTerrain({ cls: 'Infantry', keyword: null }, 'forest'), true);
});

test('canPlaceOnTerrain: plains, desert, and city are fully unrestricted (doc 04 §12)', () => {
  for (const terrain of ['plains', 'desert', 'city']) {
    for (const cls of ['Infantry', 'Tank', 'Artillery', 'Aircraft']) {
      assert.equal(canPlaceOnTerrain({ cls, keyword: null }, terrain), true, `${cls} should be allowed on ${terrain}`);
    }
  }
});

test('canPlaceOnTerrain: Airborne bypasses forest', () => {
  assert.equal(canPlaceOnTerrain({ cls: 'Tank', keyword: 'Airborne' }, 'forest'), true);
});
