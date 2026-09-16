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

// ── Recorders ──────────────────────────────────────────────────────────────────
// Clone-then-mutate keeps the input untouched; stats are a few KB, so the clone is cheap.
function update(state, fn) {
  if (!state?.stats) return state;
  try {
    const stats = normalizeStats(structuredClone(state.stats));
    fn(stats);
    return { ...state, stats };
  } catch (err) {
    console.error('[stats] recording failed; gameplay unaffected', err);
    return state;
  }
}

export function recordCardPlayed(state, role, cardId, fuelSpent = 0) {
  return update(state, stats => {
    const entry = child(stats.players[role].cards, statsCardKey(cardId));
    inc(entry, 'played');
    inc(entry, 'roundSum', roundOf(state.turn));
    inc(entry, 'fuelSpent', Math.max(0, fuelSpent));
  });
}

// `victim` is the player whose HQ lost `amount`; `source` is the cause (see the plan's list).
export function recordHqDamage(state, victim, amount, source) {
  if (!(amount > 0)) return state;
  return update(state, stats => {
    inc(stats.players[victim].hqDamageTaken, source, amount);
  });
}

// `mutations` uses resolveSingleAttack's boardMutations shape: [{ key, newUnit }], newUnit null =
// destroyed. `beforeBoard` must hold each unit as it was before the hit. Recorded under the player
// who dealt the hits; `attackerKind` is a unit class, or 'hero' / 'self'.
export function recordUnitHits(state, byPlayer, attackerKind, beforeBoard, mutations) {
  return update(state, stats => {
    for (const { key, newUnit } of mutations ?? []) {
      const before = beforeBoard?.[key];
      if (!before) continue;
      let result = null;
      if (newUnit === null) result = 'destroyed';
      else if (newUnit?.state === 'suppressed' && before.state !== 'suppressed') result = 'suppressed';
      else if ((newUnit?.armorHits ?? 0) > (before.armorHits ?? 0)) result = 'armorAbsorbed';
      if (!result) continue;
      const targetCls = CARD_BY_ID[before.cardId]?.cls ?? 'Unknown';
      inc(child(child(stats.players[byPlayer].trades, attackerKind), targetCls), result);
    }
  });
}

export function recordTrigger(state, role, keyword, cardId) {
  return update(state, stats => {
    inc(child(stats.players[role].triggers, keyword), statsCardKey(cardId));
  });
}

export function recordHeroDeployed(state, role, heroId) {
  return update(state, stats => {
    const entry = child(stats.players[role].heroes, heroId);
    if (entry.deployedRound == null) entry.deployedRound = roundOf(state.turn);
  });
}

export function recordHeroActivation(state, role, heroId, fuelSpent = 0) {
  return update(state, stats => {
    const entry = child(stats.players[role].heroes, heroId);
    inc(entry, 'activations');
    inc(entry, 'fuelSpent', Math.max(0, fuelSpent));
  });
}

export function recordDirectHq(state, role, units) {
  if (!(units > 0)) return state;
  return update(state, stats => { inc(stats.players[role], 'directHqUnits', units); });
}

export function recordFuelLostToCap(state, role, amount) {
  if (!(amount > 0)) return state;
  return update(state, stats => { inc(stats.players[role], 'fuelLostToCap', amount); });
}

// Called on End Turn, before the turn counter advances. `ms` is measured on this client's own
// clock; omitted when unknown (e.g. this client never saw the turn start).
export function recordTurnEnd(state, { role, ms, fuelUnspent }) {
  return update(state, stats => {
    const unspent = Math.max(0, fuelUnspent ?? 0);
    inc(stats.players[role], 'fuelUnspent', unspent);
    const entry = { turn: state.turn, player: role, fuelUnspent: unspent, p1Hq: state.p1?.hq ?? 0, p2Hq: state.p2?.hq ?? 0 };
    if (Number.isFinite(ms)) entry.ms = Math.max(0, Math.round(ms));
    stats.turns.push(entry);
  });
}

// The turn in progress when the match ends never reaches End Turn. Called once at finalize: adds
// that turn flagged `terminal` (a partial turn, so aggregations leave it out of turn-length and
// unspent-Fuel averages, and it adds nothing to fuelUnspent), unless End Turn already recorded it
// (lethal Direct HQ ends the match inside the End Turn handler).
export function recordTerminalTurn(state, { ms } = {}) {
  const role = state?.initiative;
  if (!state?.stats || !role) return state;
  if (toArray(state.stats.turns).some(t => t.turn === state.turn && t.player === role)) return state;
  return update(state, stats => {
    const entry = { turn: state.turn, player: role, terminal: true, p1Hq: state.p1?.hq ?? 0, p2Hq: state.p2?.hq ?? 0 };
    if (Number.isFinite(ms)) entry.ms = Math.max(0, Math.round(ms));
    stats.turns.push(entry);
  });
}

export function recordCraftPick(state, role, chosen, offered = []) {
  return update(state, stats => {
    const summary = c => `${c.n}/${c.e}/${c.s}/${c.w} ${c.keyword} ${c.craftDrawback}`;
    stats.players[role].craftPicks.push({
      round: roundOf(state.turn),
      stats: `${chosen.n}/${chosen.e}/${chosen.s}/${chosen.w}`,
      fixedLine: chosen.n === 6 && chosen.e === 6 && chosen.s === 6 && chosen.w === 6,
      keyword: chosen.keyword,
      drawback: chosen.craftDrawback,
      offered: offered.map(summary).join(' | '),
    });
  });
}

export function markDebugUsed(state) {
  if (!state?.stats || state.stats.debugUsed === true) return state;
  return update(state, stats => { stats.debugUsed = true; });
}

function objectiveEntry(stats, slotKey) {
  const entry = child(stats.objectives, slotKey);
  for (const field of ['activations', 'maxLevel', 'backbone', 'fuel', 'draws', 'turnsHeld']) child(entry, field);
  return entry;
}

export function recordObjectiveActivation(state, slotKey, role, level, backbone) {
  return update(state, stats => {
    const entry = objectiveEntry(stats, slotKey);
    inc(entry.activations, role);
    entry.maxLevel[role] = Math.max(entry.maxLevel[role] ?? 0, level);
    inc(entry.backbone, role, backbone);
  });
}

// kind: 'fuel' | 'draws'
export function recordObjectiveYield(state, slotKey, role, kind, amount) {
  if (!(amount > 0)) return state;
  return update(state, stats => { inc(objectiveEntry(stats, slotKey)[kind], role, amount); });
}

// Called right after checkObjectiveControl on every End Turn: one count per half-turn per slot.
export function recordObjectiveControl(state) {
  return update(state, stats => {
    for (const [slotKey, obj] of Object.entries(state.objectives ?? {})) {
      inc(objectiveEntry(stats, slotKey).turnsHeld, obj.controller ?? 'none');
    }
  });
}

// ── Final record ───────────────────────────────────────────────────────────────
// Pure: counters + the final state in, one flat Firebase-safe record out. `winner` is 'p1' | 'p2'
// | null. Things that can be derived from the final state are derived here instead of tracked
// live: cards drawn (starting deck minus what's left in the deck), dead cards (hand at the end),
// fatigue damage (1 + 2 + ... + fatigueCount), and "other" (HQ lost that no recorder claimed).
// `durationMs` is passed in, measured on the writing client's own clock; it is never derived from
// endedAt - startedAt, because startedAt comes from the host's clock and the writer may be P2.
export function buildMatchRecord(state, { winner = null, endReason = 'hq', endedAt = Date.now(), durationMs, site = '' } = {}) {
  const stats = normalizeStats(state.stats);
  const players = {};
  for (const role of ROLES) {
    const ps = state[role] ?? {};
    const p = stats.players[role];
    const remainingDeck = countIds(toArray(ps.deck));
    const inHand = countIds(toArray(ps.hand).map(statsCardKey));
    const blank = () => ({ copies: 0, drawn: 0, played: 0, roundSum: 0, fuelSpent: 0, inHandAtEnd: 0 });
    const cards = {};
    for (const [id, copies] of Object.entries(p.deck)) {
      cards[id] = { ...blank(), copies, drawn: Math.max(0, copies - (remainingDeck[id] ?? 0)) };
    }
    for (const [id, e] of Object.entries(p.cards)) {
      const c = cards[id] ?? (cards[id] = blank());
      c.played = e.played ?? 0;
      c.roundSum = e.roundSum ?? 0;
      c.fuelSpent = e.fuelSpent ?? 0;
    }
    for (const [id, n] of Object.entries(inHand)) {
      (cards[id] ?? (cards[id] = blank())).inHandAtEnd = n;
    }

    const hqDamageTaken = { ...p.hqDamageTaken };
    const fatigueCount = ps.fatigueCount ?? 0;
    if (fatigueCount > 0) hqDamageTaken.fatigue = (fatigueCount * (fatigueCount + 1)) / 2;
    const attributed = Object.values(hqDamageTaken).reduce((a, b) => a + b, 0);
    const startHq = stats.startHq[role] ?? 30;
    const other = (startHq - (ps.hq ?? startHq)) - attributed;
    if (other !== 0) hqDamageTaken.other = other;

    players[role] = {
      deck: p.deck,
      heroRoster: p.heroRoster,
      finalHq: ps.hq ?? null,
      hqDamageTaken,
      cards,
      heroes: p.heroes,
      trades: p.trades,
      triggers: p.triggers,
      directHqUnits: p.directHqUnits,
      fuelUnspent: p.fuelUnspent,
      fuelLostToCap: p.fuelLostToCap,
      mulliganReturned: toArray(ps.mulliganReturned),
      craftPicks: p.craftPicks,
    };
  }

  const objectives = {};
  for (const [slot, obj] of Object.entries(state.objectives ?? {})) {
    objectives[slot] = { ...(stats.objectives[slot] ?? {}), cardId: obj.cardId, heldAtEnd: obj.controller ?? 'none' };
  }

  const turn = state.turn ?? 1;
  const winnerSeat = winner == null ? 'none' : (winner === stats.firstPlayer ? 'first' : 'second');
  return JSON.parse(JSON.stringify({
    v: STATS_SCHEMA_VERSION,
    matchId: stats.matchId,
    buildLabel: STATS_BUILD_LABEL,
    rulesHash: computeRulesHash(),
    site,
    mode: stats.mode,
    source: stats.source,
    debugUsed: stats.debugUsed,
    startedAt: stats.startedAt,
    endedAt,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : undefined, // undefined is dropped by the JSON round trip
    mapId: stats.mapId,
    firstPlayer: stats.firstPlayer,
    winner,
    winnerSeat,
    endReason,
    turnsPlayed: turn,
    rounds: Math.ceil(turn / 2),
    players,
    objectives,
    turns: stats.turns,
  }));
}
