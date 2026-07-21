// Unit tests for deck validation. Run: node --test tests/
// Only pure functions are tested — localStorage helpers are browser-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_RULES, STARTER_DECKS, getDeckPool,
  computeDeckAP, countCopies, validateDeck, mergeRemoteDecks,
} from '../js/decks.js';

test('computeDeckAP sums ap of card ids', () => {
  // id 1 Rifle Squad = 1 AP, id 66 King Tiger = 4 AP
  assert.equal(computeDeckAP([1, 1, 66]), 6);
});

test('countCopies counts duplicates', () => {
  assert.deepEqual(countCopies([5, 5, 42]), { 5: 2, 42: 1 });
});

test('getDeckPool excludes objectives', () => {
  const pool = getDeckPool();
  assert.ok(pool.length > 0);
  assert.ok(pool.every(c => c.type !== 'objective'));
});

test('all four starter decks are valid', () => {
  // Hammer Strike (aggro) was trimmed from 2x to 1x Storm Squad on 2026-07-21 —
  // card AP retuning since this deck was assembled had pushed it to 52 AP.
  assert.equal(STARTER_DECKS.length, 4);
  for (const d of STARTER_DECKS) {
    const v = validateDeck(d.ids);
    assert.deepEqual(v.errors, [], `${d.name}: ${v.errors.join(' | ')}`);
    assert.ok(v.valid);
  }
});

test('third copy of a Common is rejected', () => {
  // 3x Rifle Squad (Common) padded with legal pairs to clear the min-cards floor
  const ids = [1, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('Rifle Squad')));
});

test('second copy of a Rare is rejected', () => {
  // 2x Field Commander (id 14, Rare) padded with legal pairs
  const ids = [14, 14, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('Field Commander')));
});

test('deck over 50 AP is rejected', () => {
  // 2 copies each of 8 high-AP cards = 66 AP, 16 cards, copy limits fine
  const ids = [45, 45, 41, 41, 9, 9, 66, 66, 64, 64, 48, 48, 79, 79, 7, 7];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('AP')));
  assert.equal(v.ap, 66);
});

test('deck below minimum card count is rejected', () => {
  const v = validateDeck([1, 1, 2, 2]);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('minimum')));
});

test('objective card in deck is rejected', () => {
  const ids = [26, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.toLowerCase().includes('objective')));
});

test('unknown card id is rejected', () => {
  const ids = [999, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('999')));
});

test('mergeRemoteDecks adds remote decks not present locally, without overwriting name clashes', () => {
  const local = [{ name: 'Mine', ids: [1, 1] }];
  const remote = [{ name: 'Mine', ids: [2, 2] }, { name: 'FromOtherSession', ids: [5, 5] }];
  const merged = mergeRemoteDecks(local, remote);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.find(d => d.name === 'Mine').ids, [1, 1]); // local wins on a name clash
  assert.ok(merged.find(d => d.name === 'FromOtherSession'));
});
