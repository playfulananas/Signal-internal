// Unit tests for open-lobby list helpers. Run: node --test tests/lobbies.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStale, sortByNewest, formatWaiting } from '../js/lobbies.js';

test('filterStale keeps lobbies newer than 10 minutes', () => {
  const now = 1_000_000_000;
  const lobbies = [
    { id: 'a', createdAt: now - 5 * 60000 },  // 5 min old — kept
    { id: 'b', createdAt: now - 11 * 60000 }, // 11 min old — dropped
    { id: 'c', createdAt: now - 60000 },      // 1 min old — kept
  ];
  const result = filterStale(lobbies, now);
  assert.deepEqual(result.map(l => l.id), ['a', 'c']);
});

test('filterStale drops entries with no createdAt (still resolving serverTimestamp)', () => {
  const result = filterStale([{ id: 'x', createdAt: null }], 1_000_000_000);
  assert.deepEqual(result, []);
});

test('sortByNewest orders newest first without mutating the input', () => {
  const lobbies = [
    { id: 'old', createdAt: 100 },
    { id: 'new', createdAt: 300 },
    { id: 'mid', createdAt: 200 },
  ];
  const sorted = sortByNewest(lobbies);
  assert.deepEqual(sorted.map(l => l.id), ['new', 'mid', 'old']);
  assert.deepEqual(lobbies.map(l => l.id), ['old', 'new', 'mid']); // original untouched
});

test('formatWaiting reports "just now" for anything under a minute', () => {
  const now = 1_000_000_000;
  assert.equal(formatWaiting(now - 30000, now), 'just now');
});

test('formatWaiting reports whole minutes for older lobbies', () => {
  const now = 1_000_000_000;
  assert.equal(formatWaiting(now - 4 * 60000, now), 'waiting 4m');
});

test('formatWaiting falls back to "just now" while createdAt is still unresolved', () => {
  assert.equal(formatWaiting(null, 1_000_000_000), 'just now');
});
