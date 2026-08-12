// Unit tests for the pure logic behind the v0.4 launch-filler cards wired 2026-08-11:
// the rotation primitive (Change Formation 124, also usable by Field Engineer 91) and the
// two auto-resolving on-play triggers (Veteran Signal Corps 119, Combat Engineers 112).
// Everything else in that batch (Priority Orders, Radio Interference, Command Shuffle,
// Coordinated Orders, Mobile Command Halftrack, Radio Operator, Field Reserves) lives in
// game.js's imperative UI state machine, not a pure function — covered by live smoke
// testing instead, not unit tests. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { rotatedDir, getSideValue } from '../js/state.js';
import { checkUnitOnPlayAbility } from '../js/combat.js';
import { CARD_BY_ID } from '../js/cards.js';

// ── rotatedDir ────────────────────────────────────────────────────────────────

test('rotatedDir is a no-op at 0/undefined/null rotation', () => {
  for (const dir of ['n', 'e', 's', 'w']) {
    assert.equal(rotatedDir(dir, 0), dir);
    assert.equal(rotatedDir(dir, undefined), dir);
    assert.equal(rotatedDir(dir, null), dir);
  }
});

test('rotatedDir looks up counter-clockwise: physical N after a 90° turn shows the card\'s W value', () => {
  // A 90° clockwise turn moves the card's own N attribute to the physical E side, so
  // physical N now shows whatever was previously on the card's W side.
  assert.equal(rotatedDir('n', 90), 'w');
  assert.equal(rotatedDir('e', 90), 'n');
  assert.equal(rotatedDir('s', 90), 'e');
  assert.equal(rotatedDir('w', 90), 's');
});

test('rotatedDir(dir, 180) is the opposite side', () => {
  assert.equal(rotatedDir('n', 180), 's');
  assert.equal(rotatedDir('e', 180), 'w');
});

test('rotatedDir at 360 wraps back to a no-op, matching a full turn', () => {
  assert.equal(rotatedDir('n', 360), 'n');
});

// ── getSideValue with rotation ───────────────────────────────────────────────
const rotUnit = (owner, rotation) => ({ cardId: 1, owner, rotation, tempSideBonus: 0, grantedSideBonus: 0 });

test('getSideValue reads the card\'s N value at the physical N side when unrotated', () => {
  const card = CARD_BY_ID[1]; // Rifle Squad, p1 (no P2_FLIP to account for)
  const unit = rotUnit('p1', 0);
  assert.equal(getSideValue(unit, 'n'), card.n);
});

test('getSideValue: after a 90° rotation, the physical N side shows the card\'s W value', () => {
  // rotatedDir('n', 90) === 'e' would be wrong here — we want the value NOW AT n, which
  // requires looking up 90° back (counter-clockwise) from n, i.e. card.w.
  const card = CARD_BY_ID[1];
  const unit = rotUnit('p1', 90);
  assert.equal(getSideValue(unit, 'n'), card.w);
  assert.equal(getSideValue(unit, 'e'), card.n);
  assert.equal(getSideValue(unit, 's'), card.e);
  assert.equal(getSideValue(unit, 'w'), card.s);
});

test('getSideValue composes rotation with the existing P2_FLIP (owner-based)', () => {
  const card = CARD_BY_ID[1];
  const unitP2 = rotUnit('p2', 90);
  // P2 unrotated: physical n reads card.s (P2_FLIP). Rotated 90° on top of that: physical n
  // first un-rotates to 'w' (rotatedDir back-lookup), then P2_FLIP maps w -> e.
  assert.equal(getSideValue(unitP2, 'n'), card.e);
});

test('getSideValue still adds temp/granted bonuses on top of the rotated value', () => {
  const card = CARD_BY_ID[1];
  const unit = { ...rotUnit('p1', 90), tempSideBonus: 2 };
  assert.equal(getSideValue(unit, 'n'), card.w + 2);
});

// ── checkUnitOnPlayAbility ────────────────────────────────────────────────────
function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
function playerState(overrides = {}) {
  return { heroZones: [null, null, null, null], heroesActivatedEver: [], hand: [], deck: [], ...overrides };
}

test('Veteran Signal Corps (119) draws 1 only with 2+ distinct Heroes activated this match', () => {
  const card = CARD_BY_ID[119];
  const zero = { p1: playerState({ deck: [5, 6] }), board: boardWith({}) };
  assert.deepEqual(checkUnitOnPlayAbility(zero, 'p1', 0, '0,0', card).log, []);

  const one = { p1: playerState({ heroesActivatedEver: [87], deck: [5, 6] }), board: boardWith({}) };
  assert.deepEqual(checkUnitOnPlayAbility(one, 'p1', 0, '0,0', card).log, []);

  const two = { p1: playerState({ heroesActivatedEver: [87, 92], deck: [5, 6] }), board: boardWith({}) };
  const { state: after, log } = checkUnitOnPlayAbility(two, 'p1', 0, '0,0', card);
  assert.equal(log.length, 1);
  assert.equal(after.p1.hand.includes(5), true, 'drew the top card of the deck');
});

test('Combat Engineers (112) heals another suppressed unit in its column only if a friendly Hero is there', () => {
  const card = CARD_BY_ID[112];
  const suppressed = { cardId: 1, owner: 'p1', state: 'suppressed', armorHits: 0 };
  const board = boardWith({ '0,0': suppressed }); // '1,0' is where Combat Engineers itself was just placed

  const noHero = { p1: playerState(), board };
  assert.deepEqual(checkUnitOnPlayAbility(noHero, 'p1', 0, '1,0', card).log, []);

  const withHero = { p1: playerState({ heroZones: [87, null, null, null] }), board };
  const { state: after, log } = checkUnitOnPlayAbility(withHero, 'p1', 0, '1,0', card);
  assert.equal(log.length, 1);
  assert.equal(after.board['0,0'].state, 'normal');
});

test('Combat Engineers does not target itself, only another unit in the column', () => {
  const card = CARD_BY_ID[112];
  const self = { cardId: 112, owner: 'p1', state: 'suppressed', armorHits: 0 };
  const board = boardWith({ '1,0': self }); // no OTHER suppressed unit in column 0
  const s = { p1: playerState({ heroZones: [87, null, null, null] }), board };
  const { log } = checkUnitOnPlayAbility(s, 'p1', 0, '1,0', card);
  assert.deepEqual(log, []);
});
