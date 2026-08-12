// Unit tests for deck validation. Run: node --test tests/
// Only pure functions are tested — localStorage helpers are browser-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_RULES, STARTER_DECKS, getDeckPool,
  countCopies, validateDeck, validateHeroRoster, mergeRemoteDecks,
} from '../js/decks.js';

test('countCopies counts duplicates', () => {
  assert.deepEqual(countCopies([5, 5, 42]), { 5: 2, 42: 1 });
});

test('getDeckPool excludes objectives, heroes, and retired (Missions) cards', () => {
  const pool = getDeckPool();
  assert.ok(pool.length > 0);
  assert.ok(pool.every(c => c.type !== 'objective'));
  assert.ok(pool.every(c => c.type !== 'hero'));
  assert.ok(pool.every(c => !c.retired));
});

test('all four starter decks are exactly 30 cards and valid, with legal 4-Hero rosters', () => {
  // Rebuilt 2026-07-30 for the v0.4 fixed-deck model — Missions stripped (Batch 1),
  // padded back to exactly 30 on-theme (Batch 5). See decks.js STARTER_DECKS comments.
  assert.equal(STARTER_DECKS.length, 4);
  for (const d of STARTER_DECKS) {
    assert.equal(d.ids.length, DECK_RULES.deckSize, `${d.name}: wrong deck size`);
    const v = validateDeck(d.ids);
    assert.deepEqual(v.errors, [], `${d.name}: ${v.errors.join(' | ')}`);
    assert.ok(v.valid);

    const hv = validateHeroRoster(d.heroIds);
    assert.deepEqual(hv.errors, [], `${d.name} hero roster: ${hv.errors.join(' | ')}`);
    assert.ok(hv.valid);
  }
});

test('third copy of a Common is rejected', () => {
  const ids = [1, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('Rifle Squad')));
});

test('second copy of a Rare is rejected', () => {
  // 2x Field Commander (id 14, Rare)
  const ids = [14, 14, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('Field Commander')));
});

test('deck with fewer than 30 cards is rejected', () => {
  const v = validateDeck([1, 1, 2, 2]);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('exactly')));
});

test('deck with more than 30 cards is rejected', () => {
  // Hammer Strike (30, valid) + 2 extra copies of a card not already in it
  const ids = [...STARTER_DECKS.find(d => d.key === 'aggro').ids, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('exactly')));
});

test('objective card in deck is rejected', () => {
  const ids = [26, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.toLowerCase().includes('objective')));
});

test('hero card in the 30-card deck is rejected', () => {
  // id 87 = Quartermaster General (Hero) — Heroes belong to the separate roster, not the deck
  const ids = [87, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.toLowerCase().includes('hero')));
});

test('retired (Mission) card in deck is rejected', () => {
  // id 23 = Hold the Line, retired 2026-07-30 (Batch 1)
  const ids = [23, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.toLowerCase().includes('retired')));
});

test('unknown card id is rejected', () => {
  const ids = [999, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('999')));
});

test('a valid 4-Hero roster passes', () => {
  const hv = validateHeroRoster([95, 96, 97, 105]);
  assert.deepEqual(hv.errors, []);
  assert.ok(hv.valid);
});

test('hero roster with wrong count is rejected', () => {
  const hv = validateHeroRoster([95, 96, 97]);
  assert.ok(!hv.valid);
  assert.ok(hv.errors.some(e => e.includes('exactly')));
});

test('hero roster with a duplicate Hero is rejected', () => {
  const hv = validateHeroRoster([87, 87, 88, 89]);
  assert.ok(!hv.valid);
  assert.ok(hv.errors.some(e => e.toLowerCase().includes('duplicate')));
});

test('hero roster with a non-Hero card is rejected', () => {
  // id 1 = Rifle Squad (Unit, not a Hero)
  const hv = validateHeroRoster([1, 88, 89, 90]);
  assert.ok(!hv.valid);
  assert.ok(hv.errors.some(e => e.toLowerCase().includes('hero')));
});

test('mergeRemoteDecks adds remote decks not present locally, without overwriting name clashes', () => {
  const local = [{ name: 'Mine', ids: [1, 1] }];
  const remote = [{ name: 'Mine', ids: [2, 2] }, { name: 'FromOtherSession', ids: [5, 5] }];
  const merged = mergeRemoteDecks(local, remote);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.find(d => d.name === 'Mine').ids, [1, 1]); // local wins on a name clash
  assert.ok(merged.find(d => d.name === 'FromOtherSession'));
});
