// Unit tests for the Deathrattle keyword system added 2026-08-19 (from Denis's "DeathRattle
// Brainstorm" tab on the Card List Sheet): checkDeathrattle + its 8 per-card effects (131-138),
// checkPendingUnitBuff (Convoy Escort 138's queued buff), and Graves Registration Officer
// (147)'s doubling. Run: node --test tests/
//
// The new Hero Power cases (142/144/145 in applyHeroPower) and new Command cases (139/140/141
// in playInstantCommand/applyCommandEffect) live in game.js's imperative UI state machine, not
// pure functions — not unit-tested here, same convention as new_cards.test.mjs. Covered by
// live smoke testing (npm run dev / selfplay) instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeathrattle, checkPendingUnitBuff, hasColumnFreedom } from '../js/combat.js';
import { CARD_BY_ID } from '../js/cards.js';

function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
const unit = (cardId, owner = 'p1', overrides = {}) => ({
  cardId, owner, state: 'normal', armorHits: 0, tempKeywords: [], grantedKeywords: [],
  tempSideBonus: 0, grantedSideBonus: 0, rotation: 0, ...overrides,
});
function playerState(overrides = {}) {
  return { hand: [], deck: [], heroZones: [null, null, null, null], pendingDiscounts: [], pendingUnitBuffs: [], ...overrides };
}

// ── hasColumnFreedom ──────────────────────────────────────────────────────────

test('hasColumnFreedom is true only when Supreme Commander (143) is deployed', () => {
  assert.equal(hasColumnFreedom(playerState()), false);
  assert.equal(hasColumnFreedom(playerState({ heroZones: [null, 143, null, null] })), true);
});

// ── checkDeathrattle — gating ─────────────────────────────────────────────────

test('checkDeathrattle no-ops for a non-Deathrattle card', () => {
  const s = { p1: playerState({ deck: [5, 6] }), board: boardWith({}) };
  const dying = unit(1, 'p1'); // Rifle Squad — no keyword
  const { state: after, log } = checkDeathrattle(s, '0,0', dying);
  assert.deepEqual(log, []);
  assert.equal(after, s, 'must return the same state reference on a no-op');
});

test('checkDeathrattle no-ops when dyingUnit is null (e.g. Suppression, not Destroy)', () => {
  const s = { p1: playerState(), board: boardWith({}) };
  assert.deepEqual(checkDeathrattle(s, '0,0', null).log, []);
});

// ── checkDeathrattle — per-card effects ───────────────────────────────────────

test('Forward Gun Crew (131): draw 1 card', () => {
  const s = { p1: playerState({ deck: [5, 6] }), board: boardWith({}) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(131, 'p1'));
  assert.equal(log.length, 1);
  assert.deepEqual(after.p1.hand, [5]);
  assert.deepEqual(after.p1.deck, [6]);
});

test('Salvage Battery (132): summons a random 1-cost friendly Artillery from deck onto the tile', () => {
  // Ranging Section (133, itself a Deathrattle card) is the only 1-cost Artillery in the set
  // — every pre-existing Artillery unit costs 2+ (Field Howitzer 10, Anti-Tank Gun 11, etc.).
  const s = { p1: playerState({ deck: [133, 999] }), board: boardWith({}) };
  const { state: after, log } = checkDeathrattle(s, '2,2', unit(132, 'p1'));
  assert.equal(log.length, 1);
  assert.equal(after.board['2,2'].cardId, 133);
  assert.equal(after.board['2,2'].owner, 'p1');
  assert.equal(after.board['2,2'].justPlaced, false, 'a summoned unit must not get a placement attack');
  assert.deepEqual(after.p1.deck, [999], 'the summoned card is removed from the deck');
});

test('Salvage Battery (132): no-ops (logs, no summon) when the deck has no 1-cost Artillery', () => {
  const s = { p1: playerState({ deck: [10, 11] }), board: boardWith({}) }; // Artillery, but both cost 2
  const { state: after, log } = checkDeathrattle(s, '2,2', unit(132, 'p1'));
  assert.equal(log.length, 1);
  assert.equal(after.board['2,2'], null);
  assert.deepEqual(after.p1.deck, [10, 11]);
});

test('Ranging Section (133): gives a friendly Artillery Bombard until end of turn', () => {
  const artillery = unit(10, 'p1'); // Field Howitzer
  const s = { p1: playerState(), board: boardWith({ '1,1': artillery }) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(133, 'p1'));
  assert.equal(log.length, 1);
  assert.deepEqual(after.board['1,1'].tempKeywords, ['Bombard']);
});

test('Ranging Section (133): no-ops when no friendly Artillery is on board', () => {
  const s = { p1: playerState(), board: boardWith({ '1,1': unit(1, 'p1') }) }; // Infantry only
  const { log } = checkDeathrattle(s, '0,0', unit(133, 'p1'));
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('no friendly Artillery'));
});

test('Veteran Battery (134): gives a friendly Artillery +1 all sides until your next turn', () => {
  const artillery = unit(10, 'p1');
  const s = { p1: playerState(), board: boardWith({ '1,1': artillery }) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(134, 'p1'));
  assert.equal(log.length, 1);
  assert.equal(after.board['1,1'].grantedSideBonus, 1);
  assert.equal(after.board['1,1'].sideBonusTurns, 1);
});

test('Rearguard Squad (135): gives the (deterministic) first adjacent friendly Unit +1 all sides', () => {
  const adjacent = unit(1, 'p1');
  const s = { p1: playerState(), board: boardWith({ '1,1': adjacent }) };
  // Dying unit was at 0,1 — adjacent to 1,1 (south).
  const { state: after, log } = checkDeathrattle(s, '0,1', unit(135, 'p1'));
  assert.equal(log.length, 1);
  assert.equal(after.board['1,1'].grantedSideBonus, 1);
});

test('Rearguard Squad (135): no-ops when no adjacent friendly Unit exists', () => {
  const s = { p1: playerState(), board: boardWith({}) };
  const { log } = checkDeathrattle(s, '0,0', unit(135, 'p1'));
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('no adjacent friendly Unit'));
});

test('Salvage Crew (136): next Tank costs 1 less Fuel (queues a discount)', () => {
  const s = { p1: playerState(), board: boardWith({}) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(136, 'p1'));
  assert.equal(log.length, 1);
  assert.deepEqual(after.p1.pendingDiscounts, [{ appliesTo: 'Tank', column: null, amount: 1, min: 0 }]);
});

test('Squadron Reserve (137): summons a random 2-cost friendly Aircraft from deck onto the tile', () => {
  // Recon Plane (44) is the only 2-cost Aircraft in this deck.
  const s = { p1: playerState({ deck: [44, 999] }), board: boardWith({}) };
  const { state: after } = checkDeathrattle(s, '3,3', unit(137, 'p1'));
  assert.equal(after.board['3,3'].cardId, 44);
  assert.deepEqual(after.p1.deck, [999]);
});

test('Convoy Escort (138): queues a +1 all sides buff for the next Naval Unit played', () => {
  const s = { p1: playerState(), board: boardWith({}) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(138, 'p1'));
  assert.equal(log.length, 1);
  assert.deepEqual(after.p1.pendingUnitBuffs, [{ appliesTo: 'Naval', amount: 1 }]);
});

// ── Graves Registration Officer (147) — doubling ──────────────────────────────

test('Graves Registration Officer (147) doubles a Deathrattle effect', () => {
  const s = { p1: playerState({ deck: [5, 6, 7], heroZones: [147, null, null, null] }), board: boardWith({}) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(131, 'p1')); // Forward Gun Crew — draw 1
  assert.equal(log.length, 2, 'the effect log should appear twice');
  assert.deepEqual(after.p1.hand, [5, 6], 'draw 1 fired twice = 2 cards drawn');
});

test('Graves Registration Officer only doubles its OWN controller\'s Deathrattles', () => {
  const s = {
    p1: playerState({ deck: [5, 6] }),
    p2: playerState({ heroZones: [147, null, null, null] }),
    board: boardWith({}),
  };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(131, 'p1'));
  assert.equal(log.length, 1, "p2's Graves Registration Officer must not double p1's Deathrattle");
  assert.deepEqual(after.p1.hand, [5]);
});

// ── checkPendingUnitBuff ───────────────────────────────────────────────────────

test('checkPendingUnitBuff applies a queued buff to a matching Unit and consumes it', () => {
  const naval = CARD_BY_ID[15]; // River Gunboat — Naval
  const s = {
    p1: { ...playerState(), pendingUnitBuffs: [{ appliesTo: 'Naval', amount: 1 }] },
    board: boardWith({ '0,0': unit(15, 'p1') }),
  };
  const { state: after, log } = checkPendingUnitBuff(s, 'p1', '0,0', naval);
  assert.equal(log.length, 1);
  assert.equal(after.board['0,0'].grantedSideBonus, 1);
  assert.deepEqual(after.p1.pendingUnitBuffs, [], 'the buff is consumed, not left queued');
});

test('checkPendingUnitBuff no-ops when the placed Unit\'s class does not match', () => {
  const infantry = CARD_BY_ID[1]; // Rifle Squad — Infantry
  const s = {
    p1: { ...playerState(), pendingUnitBuffs: [{ appliesTo: 'Naval', amount: 1 }] },
    board: boardWith({ '0,0': unit(1, 'p1') }),
  };
  const { state: after, log } = checkPendingUnitBuff(s, 'p1', '0,0', infantry);
  assert.deepEqual(log, []);
  assert.deepEqual(after.p1.pendingUnitBuffs, [{ appliesTo: 'Naval', amount: 1 }], 'unmatched buff stays queued');
});
