// Unit tests for deck validation. Run: node --test tests/
// Only pure functions are tested — localStorage helpers are browser-only.
// Updated 2026-08-31 (Run 1, Set 1 surgical update) for the new card id scheme (I1-I22 etc.)
// and the 8 SIGNAL Set 1 Recommended Decks (see decks.js STARTER_DECKS).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_RULES, STARTER_DECKS, getDeckPool, getHeroPool,
  countCopies, validateDeck, validateHeroRoster, mergeRemoteDecks,
} from '../js/decks.js';

test('countCopies counts duplicates', () => {
  assert.deepEqual(countCopies(['I1', 'I1', 'AR52']), { I1: 2, AR52: 1 });
});

test('getDeckPool excludes objectives, heroes, and retired cards', () => {
  const pool = getDeckPool();
  assert.ok(pool.length > 0);
  assert.ok(pool.every(c => c.type !== 'objective'));
  assert.ok(pool.every(c => c.type !== 'hero'));
  assert.ok(pool.every(c => !c.retired));
});

test('all eight recommended decks are exactly 30 cards and valid, with legal 4-Hero rosters', () => {
  // Replaced 2026-08-31 with the 8 exact decks from SIGNAL_Set1_RecommendedDecksList — see
  // decks.js STARTER_DECKS header comment. Command Engine is intentionally 14 Units/16
  // Commands rather than the usual 20/10 split; deckSize (30) still applies to all 8.
  assert.equal(STARTER_DECKS.length, 8);
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
  const ids = ['I1', 'I1', 'I1', 'I2', 'I2', 'I3', 'I3', 'I4', 'I4', 'I5', 'I5', 'T23', 'T23', 'T24', 'T24'];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('Rifle Squad')));
});

test('second copy of a Rare is rejected', () => {
  // 2x Brigade Veterans (I17, Rare — 1-copy limit)
  const ids = ['I17', 'I17', 'I1', 'I1', 'I2', 'I2', 'I3', 'I3', 'I4', 'I4', 'I5', 'I5', 'T23', 'T23', 'T24'];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('Brigade Veterans')));
});

test('deck with fewer than 30 cards is rejected', () => {
  const v = validateDeck(['I1', 'I1', 'I2', 'I2']);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('exactly')));
});

test('deck with more than 30 cards is rejected', () => {
  // Infantry Formation (30, valid) + 2 extra copies of a card not already in it
  const ids = [...STARTER_DECKS.find(d => d.key === 'infantry-formation').ids, 'T23', 'T23'];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('exactly')));
});

test('objective card in deck is rejected', () => {
  const ids = ['O1', 'I1', 'I1', 'I2', 'I2', 'I3', 'I3', 'I4', 'I4', 'I5', 'I5', 'T23', 'T23', 'T24', 'T24'];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.toLowerCase().includes('objective')));
});

test('hero card in the 30-card deck is rejected', () => {
  // H01 = Quartermaster General (Hero) — Heroes belong to the separate roster, not the deck
  const ids = ['H01', 'I1', 'I1', 'I2', 'I2', 'I3', 'I3', 'I4', 'I4', 'I5', 'I5', 'T23', 'T23', 'T24', 'T24'];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.toLowerCase().includes('hero')));
});

// "retired (Mission) card in deck is rejected" and "hero roster with a non-implemented Hero is
// rejected" are no longer exercisable with real data: Run 1's archive mechanism physically
// relocates cut content out of CARDS/CARD_BY_ID entirely (see js/archive/legacy_cards.js)
// rather than leaving it in place flagged `retired`/`implemented:false`, and every one of the
// new truth's 125 active cards (including all 25 Heroes) is current and implemented. The
// `retired`/`implemented` checks themselves remain in decks.js's validateDeck/validateHeroRoster
// for a future case where an active card needs flagging in place — they're just untested by a
// live fixture right now, which "unknown card id is rejected" below effectively covers instead
// (an archived id is, from CARD_BY_ID's perspective, simply unknown).

test('unknown card id is rejected', () => {
  const ids = ['I999', 'I1', 'I1', 'I2', 'I2', 'I3', 'I3', 'I4', 'I4', 'I5', 'I5', 'T23', 'T23', 'T24', 'T24'];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('I999')));
});

test('a valid 4-Hero roster passes', () => {
  const hv = validateHeroRoster(['H01', 'H02', 'H03', 'H04']);
  assert.deepEqual(hv.errors, []);
  assert.ok(hv.valid);
});

test('getHeroPool returns all 25 implemented, non-retired Heroes', () => {
  // Run 1 (2026-08-31): every Hero in the new truth's 25-Hero pool is implemented — unlike the
  // pre-migration pool, there is no partial/parked Tier-1 subset anymore.
  const pool = getHeroPool();
  assert.equal(pool.length, 25);
  assert.ok(pool.every(c => c.type === 'hero'));
  assert.ok(pool.every(c => c.implemented === true));
  assert.ok(pool.every(c => !c.retired));
});

test('hero roster with wrong count is rejected', () => {
  const hv = validateHeroRoster(['H05', 'H06', 'H07']);
  assert.ok(!hv.valid);
  assert.ok(hv.errors.some(e => e.includes('exactly')));
});

test('hero roster with a duplicate Hero is rejected', () => {
  const hv = validateHeroRoster(['H01', 'H01', 'H02', 'H03']);
  assert.ok(!hv.valid);
  assert.ok(hv.errors.some(e => e.toLowerCase().includes('duplicate')));
});

test('hero roster with a non-Hero card is rejected', () => {
  // I1 = Rifle Squad (Unit, not a Hero)
  const hv = validateHeroRoster(['I1', 'H01', 'H02', 'H03']);
  assert.ok(!hv.valid);
  assert.ok(hv.errors.some(e => e.toLowerCase().includes('hero')));
});

test('mergeRemoteDecks adds remote decks not present locally, without overwriting name clashes', () => {
  const local = [{ name: 'Mine', ids: ['I1', 'I1'] }];
  const remote = [{ name: 'Mine', ids: ['I2', 'I2'] }, { name: 'FromOtherSession', ids: ['I3', 'I3'] }];
  const merged = mergeRemoteDecks(local, remote);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.find(d => d.name === 'Mine').ids, ['I1', 'I1']); // local wins on a name clash
  assert.ok(merged.find(d => d.name === 'FromOtherSession'));
});
