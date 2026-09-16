import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatchStats, normalizeStats, statsCardKey, computeRulesHash,
} from '../js/stats.js?v=2026090402';
import { createInitialState } from '../js/state.js?v=2026090402';
import { CARDS, CARD_BY_ID, registerGeneratedCard } from '../js/cards.js?v=2026090402';
import { craftCandidateToCard } from '../js/combat.js?v=2026090402';

export const DECK = Array.from({ length: 15 }, () => ['I1', 'T33']).flat();
export const ROSTER = ['H07', 'H02', 'H21', 'H05'];

export function freshMatch(overrides = {}) {
  let s = createInitialState(DECK, DECK, 'kursk', ROSTER, ROSTER);
  s = { ...s, initiative: 'p1', ...overrides };
  return { ...s, stats: createMatchStats(s, { matchId: 'TEST-1', mode: 'hotseat', source: 'human', startedAt: 1000 }) };
}

test('createMatchStats counts the full 30-card deck (opening hand included) and the match setup', () => {
  const s = freshMatch();
  assert.deepEqual(s.stats.players.p1.deck, { I1: 15, T33: 15 });
  assert.deepEqual(s.stats.players.p2.heroRoster, ROSTER);
  assert.equal(s.stats.firstPlayer, 'p1');
  assert.equal(s.stats.mapId, 'kursk');
  assert.equal(s.stats.debugUsed, false);
  assert.deepEqual(s.stats.startHq, { p1: 30, p2: 30 });
  assert.deepEqual(JSON.parse(JSON.stringify(s.stats)), s.stats, 'must survive a Firebase round trip unchanged');
});

test('normalizeStats restores what Firebase strips: empty objects, empty arrays, false flags, arrays-as-objects', () => {
  const stripped = {
    v: 1, matchId: 'TEST-1', mode: 'hotseat', source: 'human', startedAt: 1000, mapId: 'kursk', firstPlayer: 'p1',
    startHq: { p1: 30, p2: 30 },
    players: { p1: { deck: { I1: 15, T33: 15 }, heroRoster: { 0: 'H07', 1: 'H02' } } },
    turns: { 0: { turn: 1, player: 'p1', fuelUnspent: 0, p1Hq: 30, p2Hq: 30 } },
  };
  const n = normalizeStats(stripped);
  assert.equal(n.debugUsed, false);
  assert.deepEqual(n.players.p1.heroRoster, ['H07', 'H02']);
  assert.deepEqual(n.players.p1.cards, {});
  assert.deepEqual(n.players.p2.craftPicks, []);
  assert.equal(n.players.p2.fuelUnspent, 0);
  assert.deepEqual(n.objectives, {});
  assert.ok(Array.isArray(n.turns));
  assert.equal(n.turns[0].player, 'p1');
});

test('statsCardKey: crafted cards group, H19 buffed copies keep their printed card id', () => {
  const crafted = craftCandidateToCard({ stats: { n: 6, e: 6, s: 6, w: 6 }, keyword: 'Armor', drawback: 'ownHqDamage' }, 'p1');
  assert.equal(statsCardKey(crafted.id), 'CRAFTED');
  assert.equal(statsCardKey('Craft-p2-999'), 'CRAFTED', 'unknown crafted id (other client) still groups');
  assert.equal(statsCardKey('I1'), 'I1');
  // Shapes applyHandBuff produces for H19 (Task 5 adds statsBaseId there; tested end-to-end in stats_combat).
  const buffedRifle = registerGeneratedCard({ ...CARD_BY_ID.I1, statsBaseId: 'I1', n: CARD_BY_ID.I1.n + 1 }, 'p1');
  const buffedCrafted = registerGeneratedCard({ ...crafted, statsBaseId: crafted.id, n: crafted.n + 1 }, 'p1');
  assert.equal(statsCardKey(buffedRifle.id), 'I1');
  assert.equal(statsCardKey(buffedCrafted.id), 'CRAFTED', 'crafted check must come before statsBaseId');
});

test('computeRulesHash is stable and changes when card data changes', () => {
  assert.match(computeRulesHash(), /^[0-9a-f]{8}$/);
  assert.equal(computeRulesHash(), computeRulesHash());
  const tweaked = CARDS.map(c => (c.id === 'T33' ? { ...c, cost: c.cost + 1 } : c));
  assert.notEqual(computeRulesHash(tweaked), computeRulesHash());
});

import {
  recordCardPlayed, recordHqDamage, recordUnitHits, recordTrigger, recordHeroDeployed,
  recordHeroActivation, recordDirectHq, recordFuelLostToCap, recordTurnEnd, recordTerminalTurn,
  recordCraftPick, markDebugUsed, recordObjectiveActivation, recordObjectiveYield, recordObjectiveControl,
} from '../js/stats.js?v=2026090402';

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

test('recorders are no-ops on a state without stats (older matches, other tests\' fixtures)', () => {
  const s = createInitialState(DECK, DECK, 'kursk', ROSTER, ROSTER);
  assert.equal(recordHqDamage(s, 'p1', 2, 'combat'), s);
  assert.equal(recordCardPlayed(s, 'p1', 'I1', 1), s);
  assert.equal(recordObjectiveControl(s), s);
  assert.equal(markDebugUsed(s), s);
});

test('recorders never mutate the state they are given (Cancel restores old snapshots)', () => {
  const s = deepFreeze(freshMatch());
  const after = recordCardPlayed(recordHqDamage(s, 'p2', 2, 'combat'), 'p1', 'I1', 1);
  assert.equal(s.stats.players.p2.hqDamageTaken.combat, undefined);
  assert.equal(after.stats.players.p2.hqDamageTaken.combat, 2);
  assert.equal(after.stats.players.p1.cards.I1.played, 1);
});

test('a recorder that throws returns the original state instead of breaking the action', () => {
  const s = freshMatch();
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(recordHqDamage(s, 'p3', 2, 'combat'), s);
  } finally {
    console.error = originalError;
  }
});

test('recordCardPlayed tracks plays, round played and Fuel spent; crafted Aircraft share one row', () => {
  let s = freshMatch({ turn: 3 }); // round 2
  s = recordCardPlayed(s, 'p1', 'T33', 3);
  s = recordCardPlayed(s, 'p1', 'T33', 4);
  const crafted = craftCandidateToCard({ stats: { n: 6, e: 6, s: 6, w: 6 }, keyword: 'Armor', drawback: 'ownHqDamage' }, 'p1');
  s = recordCardPlayed(s, 'p1', crafted.id, 1);
  assert.deepEqual(s.stats.players.p1.cards.T33, { played: 2, roundSum: 4, fuelSpent: 7 });
  assert.deepEqual(s.stats.players.p1.cards.CRAFTED, { played: 1, roundSum: 2, fuelSpent: 1 });
});

test('recordHqDamage sums per victim and source, ignoring zero amounts', () => {
  let s = freshMatch();
  s = recordHqDamage(s, 'p2', 2, 'combat');
  s = recordHqDamage(s, 'p2', 1, 'combat');
  s = recordHqDamage(s, 'p2', 0, 'directHq');
  s = recordHqDamage(s, 'p1', 3, 'selfInflicted');
  assert.deepEqual(s.stats.players.p2.hqDamageTaken, { combat: 3 });
  assert.deepEqual(s.stats.players.p1.hqDamageTaken, { selfInflicted: 3 });
});

test('recordUnitHits classifies destroyed / suppressed / armor-absorbed by attacker kind and target class', () => {
  let s = freshMatch();
  const before = {
    '0,0': { cardId: 'I1', owner: 'p2', state: 'suppressed', armorHits: 0 },
    '0,1': { cardId: 'T33', owner: 'p2', state: 'normal', armorHits: 0 },
    '0,2': { cardId: 'T33', owner: 'p2', state: 'normal', armorHits: 0 },
    '0,3': { cardId: 'I1', owner: 'p2', state: 'normal', armorHits: 0 },
  };
  s = recordUnitHits(s, 'p1', 'Tank', before, [
    { key: '0,0', newUnit: null },
    { key: '0,1', newUnit: { ...before['0,1'], state: 'suppressed' } },
    { key: '0,2', newUnit: { ...before['0,2'], armorHits: 1 } },
    { key: '0,3', newUnit: { ...before['0,3'] } }, // no change: not a hit
  ]);
  assert.deepEqual(s.stats.players.p1.trades, {
    Tank: { Infantry: { destroyed: 1 }, Tank: { suppressed: 1, armorAbsorbed: 1 } },
  });
});

test('trigger, Hero, Direct HQ, Fuel and debug recorders', () => {
  let s = freshMatch({ turn: 4 }); // round 2
  s = recordTrigger(s, 'p1', 'Breakthrough', 'T33');
  s = recordTrigger(s, 'p1', 'Breakthrough', 'T33');
  s = recordHeroDeployed(s, 'p2', 'H07');
  s = recordHeroDeployed({ ...s, turn: 8 }, 'p2', 'H07'); // never overwrites the first deployment round
  s = recordHeroActivation(s, 'p2', 'H07', 2);
  s = recordDirectHq(s, 'p1', 2);
  s = recordFuelLostToCap(s, 'p1', 1);
  s = markDebugUsed(s);
  assert.deepEqual(s.stats.players.p1.triggers, { Breakthrough: { T33: 2 } });
  assert.deepEqual(s.stats.players.p2.heroes.H07, { deployedRound: 2, activations: 1, fuelSpent: 2 });
  assert.equal(s.stats.players.p1.directHqUnits, 2);
  assert.equal(s.stats.players.p1.fuelLostToCap, 1);
  assert.equal(s.stats.debugUsed, true);
});

test('recordTurnEnd appends a turn row with duration, unspent Fuel and both HQs', () => {
  let s = freshMatch({ turn: 5 });
  s = { ...s, p1: { ...s.p1, hq: 24 }, p2: { ...s.p2, hq: 19 } };
  s = recordTurnEnd(s, { role: 'p1', ms: 41234.6, fuelUnspent: 2 });
  s = recordTurnEnd(s, { role: 'p2', ms: undefined, fuelUnspent: 0 });
  assert.deepEqual(s.stats.turns, [
    { turn: 5, player: 'p1', fuelUnspent: 2, p1Hq: 24, p2Hq: 19, ms: 41235 },
    { turn: 5, player: 'p2', fuelUnspent: 0, p1Hq: 24, p2Hq: 19 },
  ]);
  assert.equal(s.stats.players.p1.fuelUnspent, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(s.stats.turns)), s.stats.turns, 'unknown duration is omitted, not undefined');
});

test('recordTerminalTurn adds the cut-short final turn once, flagged, without Fuel', () => {
  let s = freshMatch({ turn: 9, initiative: 'p2' });
  s = { ...s, p1: { ...s.p1, hq: 0 }, p2: { ...s.p2, hq: 7, fuel: 4 } };
  s = recordTerminalTurn(s, { ms: 12004.4 });
  s = recordTerminalTurn(s, { ms: 99999 }); // second call (e.g. a repeated end check) is a no-op
  assert.deepEqual(s.stats.turns, [{ turn: 9, player: 'p2', terminal: true, p1Hq: 0, p2Hq: 7, ms: 12004 }]);
  assert.equal(s.stats.players.p2.fuelUnspent, 0, 'a partial turn never adds to unspent Fuel');
});

test('recordTerminalTurn does nothing when End Turn already recorded that turn (lethal Direct HQ)', () => {
  let s = freshMatch({ turn: 6, initiative: 'p1' });
  s = recordTurnEnd(s, { role: 'p1', ms: 5000, fuelUnspent: 2 });
  const after = recordTerminalTurn(s, { ms: 5100 });
  assert.equal(after, s);
  assert.equal(after.stats.turns.length, 1);
});

test('recordCraftPick stores the chosen line, keyword, drawback and what was offered', () => {
  let s = freshMatch({ turn: 6 });
  const offered = [
    craftCandidateToCard({ stats: { n: 6, e: 6, s: 6, w: 6 }, keyword: 'Armor', drawback: 'ownHqDamage' }, 'p1'),
    craftCandidateToCard({ stats: { n: 1, e: 20, s: 3, w: 3 }, keyword: 'Bombard', drawback: 'rotateAll' }, 'p1'),
  ];
  s = recordCraftPick(s, 'p1', offered[1], offered);
  assert.deepEqual(s.stats.players.p1.craftPicks, [{
    round: 3, stats: '1/20/3/3', fixedLine: false, keyword: 'Bombard', drawback: 'rotateAll',
    offered: '6/6/6/6 Armor ownHqDamage | 1/20/3/3 Bombard rotateAll',
  }]);
});

test('objective recorders track control per turn, activations, level, backbone and yields per slot', () => {
  let s = freshMatch({ turn: 7 });
  s = { ...s, objectives: { '1,0': { cardId: 'O1', level: 3, controller: 'p1' }, '2,3': { cardId: 'O3', level: 3, controller: null } } };
  s = recordObjectiveControl(s);
  s = recordObjectiveActivation(s, '1,0', 'p1', 3, 2);
  s = recordObjectiveYield(s, '1,0', 'p1', 'fuel', 1);
  s = recordObjectiveYield(s, '1,0', 'p1', 'draws', 0);
  assert.deepEqual(s.stats.objectives['1,0'], {
    activations: { p1: 1 }, maxLevel: { p1: 3 }, backbone: { p1: 2 }, fuel: { p1: 1 }, draws: {}, turnsHeld: { p1: 1 },
  });
  assert.deepEqual(s.stats.objectives['2,3'].turnsHeld, { none: 1 });
});

import { buildMatchRecord, STATS_BUILD_LABEL } from '../js/stats.js?v=2026090402';

test('buildMatchRecord derives drawn/dead cards, fatigue, unattributed damage and winner seat', () => {
  let s = freshMatch({ turn: 13 });
  const crafted = craftCandidateToCard({ stats: { n: 6, e: 6, s: 6, w: 6 }, keyword: 'Armor', drawback: 'ownHqDamage' }, 'p1');
  s = {
    ...s,
    // p1: 18 left in deck (9 + 9), so 6 of each card left the deck; ends holding 1 T33 + 1 crafted card.
    p1: { ...s.p1, hq: 20, fatigueCount: 0, deck: [...Array(9).fill('I1'), ...Array(9).fill('T33')], hand: ['T33', crafted.id], mulliganReturned: ['I1'] },
    // p2: HQ -1 = 31 damage taken; 25 recorded + 3 fatigue (1 + 2) leaves 3 unattributed.
    p2: { ...s.p2, hq: -1, fatigueCount: 2, deck: [] },
    objectives: { '1,0': { cardId: 'O1', level: 4, controller: 'p1' } },
  };
  s = recordCardPlayed(s, 'p1', 'T33', 4);
  s = recordHqDamage(s, 'p2', 25, 'combat');
  s = recordHqDamage(s, 'p1', 10, 'objectiveBackbone');
  s = recordObjectiveActivation(s, '1,0', 'p1', 4, 2);

  // endedAt - startedAt would be 998000: durationMs must come from the explicit local-clock value.
  const record = buildMatchRecord(s, { winner: 'p1', endReason: 'hq', endedAt: 999000, durationMs: 60000.4, site: 'test' });
  assert.equal(record.winnerSeat, 'first');
  assert.equal(record.rounds, 7);
  assert.equal(record.turnsPlayed, 13);
  assert.equal(record.durationMs, 60000);
  assert.equal(record.endedAt, 999000);
  assert.equal(record.buildLabel, STATS_BUILD_LABEL);
  assert.match(record.rulesHash, /^[0-9a-f]{8}$/);
  assert.deepEqual(record.players.p1.cards.T33, { copies: 15, drawn: 6, played: 1, roundSum: 7, fuelSpent: 4, inHandAtEnd: 1 });
  assert.deepEqual(record.players.p1.cards.I1, { copies: 15, drawn: 6, played: 0, roundSum: 0, fuelSpent: 0, inHandAtEnd: 0 });
  assert.equal(record.players.p1.cards.CRAFTED.inHandAtEnd, 1);
  assert.deepEqual(record.players.p1.hqDamageTaken, { objectiveBackbone: 10 });
  assert.deepEqual(record.players.p2.hqDamageTaken, { combat: 25, fatigue: 3, other: 3 });
  assert.deepEqual(record.players.p1.mulliganReturned, ['I1']);
  assert.equal(record.players.p2.finalHq, -1);
  assert.equal(record.objectives['1,0'].cardId, 'O1');
  assert.equal(record.objectives['1,0'].heldAtEnd, 'p1');
  assert.deepEqual(record.objectives['1,0'].backbone, { p1: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record, 'record must be Firebase-safe');
});

test('buildMatchRecord for a match with no winner (disconnect) and no known duration', () => {
  const record = buildMatchRecord(freshMatch(), { winner: null, endReason: 'disconnect', endedAt: 5000, site: 'test' });
  assert.equal(record.winnerSeat, 'none');
  assert.equal(record.endReason, 'disconnect');
  assert.equal('durationMs' in record, false, 'never derived from two different clocks');
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});
