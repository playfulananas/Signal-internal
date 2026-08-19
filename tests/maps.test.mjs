// Data-integrity tests for maps.js, plus canPlaceOnTerrain's terrain rules. Added 2026-08-19
// alongside wiring MAPS[mapId].objectiveSlots into game.js's pickObjectives() for real (it
// previously ignored the map entirely and always placed exactly 2 objectives at a random
// symmetric position — see the dated comment on pickObjectives in game.js). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, getTerrain, canPlaceOnTerrain } from '../js/maps.js';
import { CARD_BY_ID } from '../js/cards.js';

test('every map has a full 4x4 grid', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    assert.equal(map.grid.length, 4, `${id}: grid must have 4 rows`);
    for (const row of map.grid) assert.equal(row.length, 4, `${id}: every row must have 4 columns`);
  }
});

test('every map has 1-4 objectiveSlots, and slot counts are not all the same', () => {
  const counts = new Set();
  for (const [id, map] of Object.entries(MAPS)) {
    const n = map.objectiveSlots.length;
    assert.ok(n >= 1 && n <= 4, `${id}: objectiveSlots length ${n} out of 1-4 range`);
    counts.add(n);
  }
  // "different for every map" (2026-08-19 request) — not literally all-distinct (impossible
  // with 6 maps and only 4 possible values), but genuinely varied, not one fixed number.
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

test('objectiveExclude, where present, only lists real objective card ids', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    for (const cardId of map.objectiveExclude ?? []) {
      const card = CARD_BY_ID[cardId];
      assert.ok(card && card.type === 'objective', `${id}: objectiveExclude entry ${cardId} is not a valid objective card`);
    }
  }
});

test('Midway excludes Factory (Tank-themed) and City (Infantry-themed) — dead weight on an all-water map', () => {
  assert.deepEqual(MAPS.midway.objectiveExclude, [26, 31]);
});

test('Midway is all water — no land tiles anywhere', () => {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      assert.equal(getTerrain('midway', r, c), 'water', `midway ${r},${c} must be water`);
    }
  }
});

test('canPlaceOnTerrain: only Naval, Aircraft, or Airborne-keyword units may enter water', () => {
  assert.equal(canPlaceOnTerrain({ cls: 'Naval', keyword: null }, 'water'), true);
  assert.equal(canPlaceOnTerrain({ cls: 'Aircraft', keyword: null }, 'water'), true);
  assert.equal(canPlaceOnTerrain({ cls: 'Infantry', keyword: 'Airborne' }, 'water'), true);
  assert.equal(canPlaceOnTerrain({ cls: 'Infantry', keyword: null }, 'water'), false);
  assert.equal(canPlaceOnTerrain({ cls: 'Tank', keyword: null }, 'water'), false);
  assert.equal(canPlaceOnTerrain({ cls: 'Artillery', keyword: null }, 'water'), false);
});

test('canPlaceOnTerrain: forest blocks Tank unless Airborne', () => {
  assert.equal(canPlaceOnTerrain({ cls: 'Tank', keyword: null }, 'forest'), false);
  assert.equal(canPlaceOnTerrain({ cls: 'Tank', keyword: 'Airborne' }, 'forest'), true);
  assert.equal(canPlaceOnTerrain({ cls: 'Infantry', keyword: null }, 'forest'), true);
});

test('canPlaceOnTerrain: plains, desert, and city are unrestricted EXCEPT Naval', () => {
  for (const terrain of ['plains', 'desert', 'city']) {
    for (const cls of ['Infantry', 'Tank', 'Artillery', 'Aircraft']) {
      assert.equal(canPlaceOnTerrain({ cls, keyword: null }, terrain), true, `${cls} should be allowed on ${terrain}`);
    }
    assert.equal(canPlaceOnTerrain({ cls: 'Naval', keyword: null }, terrain), false, `Naval should NOT be allowed on ${terrain}`);
  }
});

test('canPlaceOnTerrain: Naval is water-only — locked 2026-08-19', () => {
  assert.equal(canPlaceOnTerrain({ cls: 'Naval', keyword: null }, 'water'), true);
  for (const terrain of ['plains', 'desert', 'city', 'forest']) {
    assert.equal(canPlaceOnTerrain({ cls: 'Naval', keyword: null }, terrain), false, `Naval should NOT be allowed on ${terrain}`);
  }
  // Airborne still bypasses everything, even for a (hypothetical) Naval unit with the keyword.
  assert.equal(canPlaceOnTerrain({ cls: 'Naval', keyword: 'Airborne' }, 'plains'), true);
});
