// Tests for drawCards' fatigue and hand-cap overflow, and the shared addCardToHand funnel
// (state.js). Doc 02 (Resolved Q&A Decision Ledger) Q022-Q025 (hand cap/overflow) and
// Q029-Q030 (fatigue) — both entirely unimplemented before this pass: an empty-deck draw used
// to just silently stop with zero consequence, and nothing anywhere enforced the 10-card max
// hand size or routed overflow to a Discard Pile (which didn't exist as a tracked zone at all).
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCards, addCardToHand } from '../js/state.js';

function ps(overrides = {}) {
  return { hq: 30, hand: [], deck: [], discardPile: [], fatigueCount: 0, ...overrides };
}

test('drawCards: normal draw moves cards from deck to hand, no fatigue', () => {
  const p = drawCards(ps({ deck: ['I1', 'I2', 'I3'] }), 2);
  assert.deepEqual(p.hand, ['I1', 'I2']);
  assert.deepEqual(p.deck, ['I3']);
  assert.equal(p.fatigueCount, 0);
  assert.equal(p.hq, 30);
});

test('drawCards: empty deck deals 1 fatigue damage on the first failed draw', () => {
  const p = drawCards(ps({ deck: [] }), 1);
  assert.equal(p.fatigueCount, 1);
  assert.equal(p.hq, 29);
  assert.deepEqual(p.hand, []);
});

test('drawCards: fatigue escalates — 2nd failed draw this match deals 2, not 1 again', () => {
  let p = drawCards(ps({ deck: [] }), 1); // 1st failed draw: -1
  p = drawCards(p, 1); // 2nd failed draw: -2
  assert.equal(p.fatigueCount, 2);
  assert.equal(p.hq, 30 - 1 - 2);
});

test('drawCards: fatigue continues escalating within a single multi-card draw past empty deck', () => {
  // doc 02 Q030: multi-draws resolve one at a time; if the deck empties mid-draw, each
  // remaining attempt independently advances fatigue rather than bundling into one packet.
  const p = drawCards(ps({ deck: ['I1'] }), 3); // draws I1 normally, then 2 failed draws (-1, -2)
  assert.deepEqual(p.hand, ['I1']);
  assert.equal(p.fatigueCount, 2);
  assert.equal(p.hq, 30 - 1 - 2);
});

test('drawCards: never resets across calls (persists for the whole match)', () => {
  let p = drawCards(ps({ deck: [] }), 1);
  p = drawCards({ ...p, deck: ['I5'] }, 1); // a real draw in between does not reset the counter
  p = drawCards(p, 1); // deck empty again — this must be the 2nd fatigue instance, not the 1st
  assert.equal(p.fatigueCount, 2);
});

test('addCardToHand: adds normally when hand has room', () => {
  const p = addCardToHand(ps({ hand: ['I1'] }), 'I2');
  assert.deepEqual(p.hand, ['I1', 'I2']);
  assert.deepEqual(p.discardPile, []);
});

test('addCardToHand: a full 10-card hand sends the incoming card to Discard Pile instead (doc 02 Q022-Q023)', () => {
  const fullHand = Array.from({ length: 10 }, (_, i) => `C${i}`);
  const p = addCardToHand(ps({ hand: fullHand }), 'I99');
  assert.equal(p.hand.length, 10, 'hand must not grow past 10');
  assert.deepEqual(p.hand, fullHand, 'hand contents unchanged');
  assert.deepEqual(p.discardPile, ['I99']);
});

test('drawCards: respects the hand cap via addCardToHand, still consumes the deck card either way', () => {
  const fullHand = Array.from({ length: 10 }, (_, i) => `C${i}`);
  const p = drawCards(ps({ hand: fullHand, deck: ['I99', 'I100'] }), 2);
  assert.equal(p.hand.length, 10);
  assert.deepEqual(p.discardPile, ['I99', 'I100']);
  assert.deepEqual(p.deck, [], 'both cards were drawn off the deck even though neither entered hand');
});
