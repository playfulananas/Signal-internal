// Unit tests for shuffle() (state.js), added 2026-08-19 replacing the previous
// `arr.sort(() => Math.random() - 0.5)` pattern used for the starting deck shuffle
// (createPlayerState), the mulligan reshuffle (applyMulligan in game.js), and the
// Objectives pool (pickObjectives in game.js) — that pattern is a well-known JS anti-pattern
// that does not produce a uniform shuffle, and was the actual cause of a playtest report of
// "same objectives across 7 games in a row." Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffle } from '../js/state.js';

test('shuffle returns a permutation — same elements, same length', () => {
  const input = [1, 2, 3, 4, 5];
  const out = shuffle(input);
  assert.equal(out.length, input.length);
  assert.deepEqual([...out].sort(), [...input].sort());
});

test('shuffle does not mutate the input array', () => {
  const input = [1, 2, 3, 4, 5];
  const snapshot = [...input];
  shuffle(input);
  assert.deepEqual(input, snapshot);
});

test('shuffle produces varied orderings across many calls (not stuck on one permutation)', () => {
  const input = [1, 2, 3, 4, 5];
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(shuffle(input).join(','));
  // 5! = 120 possible permutations — 200 draws should hit well more than a handful if the
  // shuffle is actually uniform. This is the direct regression test for the biased-shuffle bug:
  // the old sort-based version could produce as few as 1-2 distinct orderings on a 5-element
  // array across many calls.
  assert.ok(seen.size > 20, `expected many distinct orderings, got only ${seen.size}`);
});

test('shuffle: every position is reachable by every element (no fixed-point bias)', () => {
  // The old sort-based shuffle is notorious for leaving early elements disproportionately
  // likely to stay near their original index. Check element 0 (value 'a') actually reaches
  // every position across enough trials.
  const input = ['a', 'b', 'c', 'd', 'e'];
  const positionsSeenForA = new Set();
  for (let i = 0; i < 300; i++) positionsSeenForA.add(shuffle(input).indexOf('a'));
  assert.equal(positionsSeenForA.size, 5, `'a' should reach all 5 positions, only reached ${positionsSeenForA.size}`);
});

test('shuffle handles empty and single-element arrays', () => {
  assert.deepEqual(shuffle([]), []);
  assert.deepEqual(shuffle([1]), [1]);
});
