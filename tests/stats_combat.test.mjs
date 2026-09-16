import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchStats } from '../js/stats.js?v=2026090402';
import { createInitialState, createBoardUnit } from '../js/state.js?v=2026090402';
import { checkHeroPassivesOnPlace, resolveCraftDrawback, resolveDestructionChain, checkRally, applyHandBuff, craftCandidateToCard } from '../js/combat.js?v=2026090402';
import { recordCardPlayed, buildMatchRecord, statsCardKey } from '../js/stats.js?v=2026090402';
import { CARD_BY_ID } from '../js/cards.js?v=2026090402';

const DECK = Array.from({ length: 15 }, () => ['I1', 'T33']).flat();

function matchWithUnits(placements) {
  let s = createInitialState(DECK, DECK, 'kursk', [], []);
  s = { ...s, initiative: 'p1' };
  s = { ...s, stats: createMatchStats(s, { matchId: 'TEST-2', mode: 'hotseat', source: 'human', startedAt: 0 }) };
  for (const [key, cardId, owner] of placements) {
    const created = createBoardUnit(s, cardId, owner);
    s = { ...created.state, board: { ...created.state.board, [key]: created.unit } };
  }
  return s;
}

test('H21 Emergency Logistics Officer self-damage is recorded as selfInflicted', () => {
  let s = matchWithUnits([['0,0', 'I1', 'p1']]);
  s = { ...s, p1: { ...s.p1, heroZones: ['H21', null, null, null] } };
  const { state: after } = checkHeroPassivesOnPlace(s, 'p1', 0, '0,0', CARD_BY_ID.I1);
  assert.equal(after.p1.hq, 29);
  assert.equal(after.stats.players.p1.hqDamageTaken.selfInflicted, 1);
});

test('H21 counts its +1 Fuel as lost to cap only when the real threshold blocks it', () => {
  const h21At = (fuel, zones) => {
    let s = matchWithUnits([['0,0', 'I1', 'p1']]);
    s = { ...s, p1: { ...s.p1, fuel, heroZones: zones } };
    return checkHeroPassivesOnPlace(s, 'p1', 0, '0,0', CARD_BY_ID.I1).state;
  };
  const below = h21At(4, ['H21', null, null, null]);
  assert.equal(below.p1.fuel, 5);
  assert.equal(below.stats.players.p1.fuelLostToCap, 0);
  const atCap = h21At(9, ['H21', null, null, null]);
  assert.equal(atCap.p1.fuel, 9);
  assert.equal(atCap.stats.players.p1.fuelLostToCap, 1);
  const raisedCap = h21At(10, ['H21', 'H02', null, null]); // Logistics Chief: threshold 11
  assert.equal(raisedCap.p1.fuel, 11);
  assert.equal(raisedCap.stats.players.p1.fuelLostToCap, 0);
});

test('H19 Training Officer buffed copies keep their printed card identity in stats', () => {
  let s = matchWithUnits([]);
  const crafted = craftCandidateToCard({ stats: { n: 6, e: 6, s: 6, w: 6 }, keyword: 'Armor', drawback: 'ownHqDamage' }, 'p1');
  const { playerState, generated } = applyHandBuff({ ...s.p1, hand: ['I1', 'I1', crafted.id] }, 1, c => c.cost === 1 || c.cost === 2, 'p1');
  assert.equal(generated.length, 3);
  assert.equal(statsCardKey(playerState.hand[0]), 'I1');
  assert.equal(statsCardKey(playerState.hand[2]), 'CRAFTED', 'a buffed crafted Aircraft is still CRAFTED, not its own row');
  s = { ...s, p1: playerState };
  s = recordCardPlayed(s, 'p1', playerState.hand[0], 1);
  const record = buildMatchRecord({ ...s, p1: { ...s.p1, hand: playerState.hand.slice(1) } }, { winner: null, endReason: 'disconnect', endedAt: 1 });
  assert.equal(record.players.p1.cards.I1.played, 1);
  assert.equal(record.players.p1.cards.I1.inHandAtEnd, 1);
  assert.equal(record.players.p1.cards.GENERATED, undefined);
});

test('Craft drawbacks record own-HQ damage and self-suppression', () => {
  const s = matchWithUnits([['0,0', 'I1', 'p1']]);
  const hq = resolveCraftDrawback(s, 'p1', '0,0', 'ownHqDamage').state;
  assert.equal(hq.stats.players.p1.hqDamageTaken.selfInflicted, 3);
  const sup = resolveCraftDrawback(s, 'p1', '0,0', 'suppressRandomFriendly').state;
  assert.deepEqual(sup.stats.players.p1.trades, { self: { Infantry: { suppressed: 1 } } });
});

test('Breakthrough and Last Stand triggers are counted per keyword and card', () => {
  const s = matchWithUnits([['0,0', 'T32', 'p1'], ['0,1', 'I18', 'p2']]);
  const { state: after } = resolveDestructionChain(s, { unitKey: '0,1', sourceUnitKey: '0,0' });
  assert.deepEqual(after.stats.players.p1.triggers, { Breakthrough: { T32: 1 } });
  assert.deepEqual(after.stats.players.p2.triggers, { 'Last Stand': { I18: 1 } });
});

test('Rally is counted when a Rally Unit declares an attack', () => {
  const s = matchWithUnits([['0,0', 'I12', 'p1']]);
  const { state: after } = checkRally(s, '0,0');
  assert.deepEqual(after.stats.players.p1.triggers, { Rally: { I12: 1 } });
});

// ── Unit hits from real attack resolution (review follow-up, 2026-09-16) ─────────
// game.js records attack hits by passing resolveSingleAttack's boardMutations to recordUnitHits.
// These pin that combination: every primary and Blast/Barrage secondary hit counts exactly once,
// friendly Units in a Barrage line are never counted, and Double Attack's two real attacks give
// two results with no extra counter.
import { resolveSingleAttack } from '../js/combat.js?v=2026090402';
import { recordUnitHits } from '../js/stats.js?v=2026090402';

function applyMutations(board, mutations) {
  const next = { ...board };
  for (const { key, newUnit } of mutations) next[key] = newUnit;
  return next;
}

test('Blast: primary and both perpendicular secondary hits count once each', () => {
  // Siege Gun (S 8, Blast) at 0,1 hits south into 1,1; Blast also hits 1,0 and 1,2.
  const s = matchWithUnits([['0,1', 'AR47', 'p1'], ['1,1', 'I1', 'p2'], ['1,0', 'I1', 'p2'], ['1,2', 'I1', 'p2']]);
  const result = resolveSingleAttack(s, '0,1', '1,1');
  assert.deepEqual(result.boardMutations.map(m => m.key).sort(), ['1,0', '1,1', '1,2'], 'primary is not repeated among secondaries');
  const after = recordUnitHits(s, 'p1', 'Artillery', s.board, result.boardMutations);
  assert.deepEqual(after.stats.players.p1.trades, { Artillery: { Infantry: { suppressed: 3 } } });
});

test('Barrage: hits along the line count once each and skip friendly Units', () => {
  // Rocket Battery (W 6, Barrage) at 0,3 hits west into 0,2; the line continues to 0,1 (enemy) and 0,0 (friendly).
  const s = matchWithUnits([['0,3', 'AR48', 'p1'], ['0,2', 'I1', 'p2'], ['0,1', 'I1', 'p2'], ['0,0', 'I1', 'p1']]);
  const result = resolveSingleAttack(s, '0,3', '0,2');
  const after = recordUnitHits(s, 'p1', 'Artillery', s.board, result.boardMutations);
  assert.deepEqual(after.stats.players.p1.trades, { Artillery: { Infantry: { suppressed: 2 } } });
  assert.equal(after.stats.players.p2.trades.Artillery, undefined, 'nothing is ever recorded against the friendly Unit');
});

test('Double Attack: two real attacks on one target record suppressed then destroyed, nothing extra', () => {
  // Shock Trooper (E 5, Double Attack) at 2,0 attacks east into Rifle Squad (W 2) at 2,1 twice.
  let s = matchWithUnits([['2,0', 'I20', 'p1'], ['2,1', 'I1', 'p2']]);
  const first = resolveSingleAttack(s, '2,0', '2,1');
  s = recordUnitHits(s, 'p1', 'Infantry', s.board, first.boardMutations);
  s = { ...s, board: applyMutations(s.board, first.boardMutations) };
  const second = resolveSingleAttack(s, '2,0', '2,1');
  s = recordUnitHits(s, 'p1', 'Infantry', s.board, second.boardMutations);
  assert.deepEqual(s.stats.players.p1.trades, { Infantry: { Infantry: { suppressed: 1, destroyed: 1 } } });
});
