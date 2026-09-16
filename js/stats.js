// Match statistics. Counters live in `state.stats`, which travels inside the shared game state
// (online, both clients see the same numbers). Gameplay code calls the recorders below at the
// exact point each event happens; at game end buildMatchRecord turns counters + final state into
// one flat record for Firebase `stats/matches/{matchId}`. Plan and record format:
// docs/plans/2026-09-16-match-statistics.md.
//
// Contract: stats must never break a match. Every recorder is a no-op when `state.stats` is
// missing (older in-progress matches, test fixtures), never mutates its input (Cancel restores
// `preCommandState` snapshots, so an in-place mutation would survive a cancel), never writes
// `undefined` (Firebase rejects the whole write), and swallows its own errors.

import { CARD_BY_ID, CARDS } from './cards.js?v=2026090402';
import { MAPS } from './maps.js?v=2026090402';

export const STATS_SCHEMA_VERSION = 1;
// Bump by hand whenever a balance pass or rules change lands, so records from before and after
// can be told apart. rulesHash (below) changes automatically with card/map data but not with
// rules code, which is what this label covers.
export const STATS_BUILD_LABEL = '2026-09-16';

const ROLES = ['p1', 'p2'];
const toArray = v => (Array.isArray(v) ? v : Object.values(v ?? {}));
const roundOf = turn => Math.ceil((turn ?? 1) / 2);
const inc = (obj, key, n = 1) => { obj[key] = (obj[key] ?? 0) + n; };
const child = (obj, key) => {
  if (!obj[key] || typeof obj[key] !== 'object') obj[key] = {};
  return obj[key];
};

function countIds(ids) {
  const out = {};
  for (const id of ids ?? []) inc(out, id);
  return out;
}

// Generated cards get a unique id per copy (Craft-p1-3, ...), which would give every copy its own
// row. Order matters: H25 crafted Aircraft (including H19-buffed copies of them, which keep
// craftDrawback) group as CRAFTED; H19 Training Officer buffed copies of printed cards count as
// that printed card (statsBaseId, set in applyHandBuff); anything else generated groups as
// GENERATED. Unknown Craft-* ids (a card this client hasn't received yet) are treated as crafted.
export function statsCardKey(cardId) {
  const card = CARD_BY_ID[cardId];
  if (card?.craftDrawback) return 'CRAFTED';
  if (card?.statsBaseId) return card.statsBaseId;
  if (card?.generated) return 'GENERATED';
  if (!card && String(cardId).startsWith('Craft-')) return 'CRAFTED';
  return cardId;
}

// Called once by whichever client creates the match (host online), right after
// createInitialState, so hand + deck is still the full starting deck.
export function createMatchStats(state, { matchId, mode, source, startedAt }) {
  const players = {};
  for (const role of ROLES) {
    const ps = state[role] ?? {};
    players[role] = {
      deck: countIds([...(ps.hand ?? []), ...(ps.deck ?? [])]),
      heroRoster: [...(ps.heroRoster ?? [])],
      hqDamageTaken: {}, cards: {}, heroes: {}, trades: {}, triggers: {},
      directHqUnits: 0, fuelUnspent: 0, fuelLostToCap: 0, craftPicks: [],
    };
  }
  return {
    v: STATS_SCHEMA_VERSION,
    matchId, mode, source, startedAt,
    mapId: state.mapId,
    firstPlayer: state.initiative,
    startHq: { p1: state.p1?.hq ?? 30, p2: state.p2?.hq ?? 30 },
    debugUsed: false,
    players,
    objectives: {},
    turns: [],
  };
}

// Firebase drops empty objects/arrays and `false`-y structure and can hand arrays back as
// index-keyed objects. Restores the full shape so recorders and buildMatchRecord never see holes.
export function normalizeStats(raw) {
  if (!raw || typeof raw !== 'object') return raw ?? null;
  const players = {};
  for (const role of ROLES) {
    const p = raw.players?.[role] ?? {};
    players[role] = {
      ...p,
      deck: p.deck ?? {},
      heroRoster: toArray(p.heroRoster),
      hqDamageTaken: p.hqDamageTaken ?? {},
      cards: p.cards ?? {},
      heroes: p.heroes ?? {},
      trades: p.trades ?? {},
      triggers: p.triggers ?? {},
      directHqUnits: p.directHqUnits ?? 0,
      fuelUnspent: p.fuelUnspent ?? 0,
      fuelLostToCap: p.fuelLostToCap ?? 0,
      craftPicks: toArray(p.craftPicks),
    };
  }
  return {
    ...raw,
    debugUsed: raw.debugUsed === true,
    startHq: raw.startHq ?? { p1: 30, p2: 30 },
    players,
    objectives: raw.objectives ?? {},
    turns: toArray(raw.turns),
  };
}

// FNV-1a over the static card pool + maps: changes automatically whenever card or map data
// changes, so records from different balance states can be separated even if nobody bumped
// STATS_BUILD_LABEL.
export function computeRulesHash(cards = CARDS, maps = MAPS) {
  const text = JSON.stringify(cards.filter(c => !c.generated)) + JSON.stringify(maps);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
