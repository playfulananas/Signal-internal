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
