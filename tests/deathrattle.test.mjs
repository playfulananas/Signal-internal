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

test('Ranging Section (133): gives a friendly Artillery Bombard until your next turn', () => {
  const artillery = unit(11, 'p1'); // Anti-Tank Gun — Artillery, no innate Bombard (Field Howitzer 10 has Bombard printed, would be auto-excluded)
  const s = { p1: playerState(), board: boardWith({ '1,1': artillery }) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(133, 'p1'));
  assert.equal(log.length, 1);
  // grantedKeywords, not tempKeywords — clears at the OWNER's next startOfTurn, giving "until
  // your next turn" (2026-08-19 fix; was tempKeywords, "until end of turn").
  assert.deepEqual(after.board['1,1'].grantedKeywords, ['Bombard']);
  assert.deepEqual(after.board['1,1'].tempKeywords, []);
});

test('Ranging Section (133): no-ops when no friendly Artillery is on board', () => {
  const s = { p1: playerState(), board: boardWith({ '1,1': unit(1, 'p1') }) }; // Infantry only
  const { log } = checkDeathrattle(s, '0,0', unit(133, 'p1'));
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('no friendly Artillery'));
});

test('Ranging Section (133): skips an Artillery that already has Bombard, no-ops if that\'s the only one', () => {
  const alreadyBombard = unit(10, 'p1', { grantedKeywords: ['Bombard'] });
  const s = { p1: playerState(), board: boardWith({ '1,1': alreadyBombard }) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(133, 'p1'));
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('no friendly Artillery'), 'the only Artillery already has Bombard, so nothing qualifies');
  assert.deepEqual(after.board['1,1'].grantedKeywords, ['Bombard'], 'unchanged — not re-granted');
});

test('Ranging Section (133) doubled (Graves Registration Officer): hits two DIFFERENT Artillery, not the same one twice', () => {
  const a = unit(11, 'p1'); // Anti-Tank Gun — Guard, no innate Bombard
  const b = unit(43, 'p1'); // Anti-Aircraft Gun — Guard, no innate Bombard
  const s = { p1: playerState({ heroZones: [147, null, null, null] }), board: boardWith({ '1,1': a, '2,2': b }) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(133, 'p1'));
  assert.equal(log.length, 2);
  assert.deepEqual(after.board['1,1'].grantedKeywords, ['Bombard']);
  assert.deepEqual(after.board['2,2'].grantedKeywords, ['Bombard']);
});

test('Ranging Section (133) doubled with only ONE eligible Artillery: second application no-ops instead of re-hitting it', () => {
  const only = unit(11, 'p1');
  const s = { p1: playerState({ heroZones: [147, null, null, null] }), board: boardWith({ '1,1': only }) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(133, 'p1'));
  assert.equal(log.length, 2);
  assert.ok(log[1].includes('no friendly Artillery'), 'second application must not re-target the same unit');
  assert.deepEqual(after.board['1,1'].grantedKeywords, ['Bombard'], 'only granted once, not twice');
});

test('Veteran Battery (134): gives a friendly Artillery +3 all sides until end of your next turn', () => {
  const artillery = unit(10, 'p1');
  const s = { p1: playerState(), board: boardWith({ '1,1': artillery }) };
  const { state: after, log } = checkDeathrattle(s, '0,0', unit(134, 'p1'));
  assert.equal(log.length, 1);
  assert.equal(after.board['1,1'].grantedSideBonus, 3);
  // sideBonusTurns:2 — the Rally Cry (51) "2 turns" convention, lasting through the OWNER's
  // entire next turn (not just up to it) — corrected 2026-08-20, per Filip (was +1, 1 turn).
  assert.equal(after.board['1,1'].sideBonusTurns, 2);
});

test('Veteran Battery (134) doubled: hits two different Artillery, not the same one twice', () => {
  const a = unit(10, 'p1');
  const b = unit(11, 'p1');
  const s = { p1: playerState({ heroZones: [147, null, null, null] }), board: boardWith({ '1,1': a, '2,2': b }) };
  const { state: after } = checkDeathrattle(s, '0,0', unit(134, 'p1'));
  assert.equal(after.board['1,1'].grantedSideBonus, 3);
  assert.equal(after.board['2,2'].grantedSideBonus, 3);
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

test('Rearguard Squad (135) doubled: hits two different adjacent friendlies, not the same one twice', () => {
  const north = unit(1, 'p1');
  const south = unit(2, 'p1');
  // Dying unit at 1,1 — adjacent tiles 0,1 (north) and 2,1 (south) both hold a friendly.
  const s = { p1: playerState({ heroZones: [147, null, null, null] }), board: boardWith({ '0,1': north, '2,1': south }) };
  const { state: after } = checkDeathrattle(s, '1,1', unit(135, 'p1'));
  assert.equal(after.board['0,1'].grantedSideBonus, 1);
  assert.equal(after.board['2,1'].grantedSideBonus, 1);
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

test('Convoy Escort (138) doubled: queues two +1 entries, which checkPendingUnitBuff stacks into +2 on ONE Unit', () => {
  const s = { p1: playerState({ heroZones: [147, null, null, null] }), board: boardWith({}) };
  const { state: after } = checkDeathrattle(s, '0,0', unit(138, 'p1'));
  assert.deepEqual(after.p1.pendingUnitBuffs, [{ appliesTo: 'Naval', amount: 1 }, { appliesTo: 'Naval', amount: 1 }]);

  const naval = CARD_BY_ID[15];
  const placed = { p1: after.p1, board: boardWith({ '0,0': unit(15, 'p1') }) };
  const { state: final, log } = checkPendingUnitBuff(placed, 'p1', '0,0', naval);
  assert.equal(final.board['0,0'].grantedSideBonus, 2, 'both queued +1s land on the same Unit, not spread across two');
  assert.equal(final.board['0,0'].sideBonusTurns, 99, 'permanent, not the 1-turn Veteran Battery style limit');
  assert.deepEqual(final.p1.pendingUnitBuffs, [], 'both entries consumed at once');
  assert.ok(log[0].includes('+2'));
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
  // Permanent (sideBonusTurns:99, same convention as Field Marshal 144) — corrected 2026-08-20,
  // per Filip: was wrongly given a 1-turn limit like Veteran Battery (134), which IS meant to
  // be temporary; Convoy Escort's bonus isn't.
  assert.equal(after.board['0,0'].sideBonusTurns, 99);
  assert.deepEqual(after.p1.pendingUnitBuffs, [], 'the buff is consumed, not left queued');
});

test('checkPendingUnitBuff aggregates entries from different sources, not just doubled ones — matches discountFor\'s "sum every matching entry" convention', () => {
  const naval = CARD_BY_ID[15];
  const s = {
    p1: { ...playerState(), pendingUnitBuffs: [{ appliesTo: 'Naval', amount: 1 }, { appliesTo: 'Naval', amount: 3 }, { appliesTo: 'Infantry', amount: 5 }] },
    board: boardWith({ '0,0': unit(15, 'p1') }),
  };
  const { state: after } = checkPendingUnitBuff(s, 'p1', '0,0', naval);
  assert.equal(after.board['0,0'].grantedSideBonus, 4, '1 + 3 from the two Naval entries');
  assert.deepEqual(after.p1.pendingUnitBuffs, [{ appliesTo: 'Infantry', amount: 5 }], 'the unrelated Infantry entry stays queued untouched');
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
