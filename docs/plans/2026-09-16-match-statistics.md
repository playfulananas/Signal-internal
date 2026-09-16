# Match Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every finished match automatically produces one statistics record (balance data: seats, damage sources, cards, Heroes, objectives, unit trades, timing, Fuel), the host decides at the end screen whether it counts, and a Statistics page turns the records into tables with CSV export for Google Sheets.

**Architecture:** A pure module `js/stats.js` holds counters in `state.stats`, which travels inside the shared game state (so online both clients see the same numbers). Gameplay code calls small recorder functions at the exact places events happen (card played, HQ damage, hits, Hero use, objective control, end of turn). At game end, `buildMatchRecord` turns the counters plus the final state into one flat JSON record, written to Firebase `stats/matches/{matchId}`; the host's include toggle and note go to `stats/meta/{matchId}`. `stats.html` reads both, aggregates with the pure `js/stats-aggregate.js`, and renders tables.

**Tech Stack:** Vanilla JS ES modules, Firebase Realtime Database (JS SDK 10.12), `node --test` unit tests, Playwright self-play harness.

---

## Decisions locked with Filip (2026-09-16)

- Track everything discussed except Guard "blocks", full replay logs, and UI click tracking.
- Every match is saved. The host (online P1, or the only client in Local/vs AI) gets an "Include in statistics" checkbox (default **unticked**) and an optional note on the end screen. Unticked records stay in Firebase and can be ticked later from the Statistics page.
- Records are tagged with mode (online / vsAi / hotseat), source (human / selfplay), a build label, an automatic rules hash, and whether the debug panel was used.
- Bot self-play records go to a local `selfplay_stats.jsonl` file, never Firebase.

## Hard rules for the implementer

1. **Stats must never break a match.** Every recorder is a no-op if `state.stats` is missing, never mutates its input (Cancel restores `preCommandState` snapshots, so an in-place mutation would leak past a cancel), and swallows its own errors. Do not "simplify" this away.
2. **Never write `undefined` into state or a record.** Firebase `set()` rejects the whole write. Recorders only write numbers/strings/booleans; `buildMatchRecord` JSON-round-trips its output.
3. **Cache version:** every new local import uses `?v=2026090402` (enforced by `tests/module_identity.test.mjs`).
4. **Git:** stage files by name only (never `git add -A` / `git add .`), run `git status` before each commit and flag files you didn't touch. End every commit message with the attribution line shown in the commit steps.
5. **Do not push** to any remote unless Filip explicitly asks.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `js/stats.js` | Create | Stats schema, recorders, Firebase normalization, `buildMatchRecord`, rules hash. Pure, no DOM. |
| `tests/stats.test.mjs` | Create | Unit tests for `js/stats.js`. |
| `tests/stats_combat.test.mjs` | Create | Tests that combat.js hook points record correctly. |
| `js/combat.js` | Modify | Record H21 / Craft drawback self-damage, self-suppression, Rally / Last Stand / Breakthrough triggers. |
| `js/firebase.js` | Modify | `ensureSignedIn`, `writeMatchRecord`, `writeMatchMeta`, `fetchStatsData`. |
| `js/game.js` | Modify | Stats init, normalization, all game-flow hook points, end-screen finalize + host controls. |
| `game.html` | Modify | End-screen include checkbox, note, save button, status line. |
| `css/game.css` | Modify | End-screen stats controls + Statistics page styles. |
| `selfplay_test.mjs` | Modify | Tag self-play games, append records to `selfplay_stats.jsonl`. |
| `scripts/check_selfplay_stats.mjs` | Create | Sanity-check self-play records (unattributed HQ damage = a missed hook). |
| `.gitignore` | Modify | Ignore `selfplay_stats.jsonl`. |
| `js/stats-aggregate.js` | Create | Pure aggregation of records into table rows + CSV. |
| `tests/stats_aggregate.test.mjs` | Create | Unit tests for aggregation. |
| `stats.html` | Create | Statistics page shell. |
| `js/stats-page.js` | Create | Statistics page: load, filter, render tables, CSV, include/note editing. |
| `index.html`, `js/lobby-browser.js` | Modify | "Statistics" main-menu tile. |
| `tests/module_identity.test.mjs` | Modify | Cover `stats.html`. |
| `STATUS.md`, `DEVNOTES.md`, `CHANGELOG.md` | Modify | Document the feature and the "route new damage/play paths through a recorder" rule. |

## Record format (what lands in Firebase)

```jsonc
// stats/matches/{matchId}
{
  "v": 1, "matchId": "ABC123-mf3k2x9", "buildLabel": "2026-09-16", "rulesHash": "1a2b3c4d",
  "site": "https://playfulananas.github.io/Signal-internal/game.html",
  "mode": "online",            // online | vsAi | hotseat
  "source": "human",           // human | selfplay
  "debugUsed": false,
  "startedAt": 1758000000000, "endedAt": 1758000600000, "durationMs": 600000,
  "mapId": "kursk", "firstPlayer": "p2", "winner": "p1", "winnerSeat": "second", // first | second | none
  "endReason": "hq",           // hq | disconnect
  "turnsPlayed": 15, "rounds": 8,
  "players": {
    "p1": {
      "deck": { "T33": 2, "I1": 2 },               // starting 30-card deck
      "heroRoster": ["H07", "H02", "H21", "H05"],   // the 4 Heroes chosen
      "finalHq": 4,
      "hqDamageTaken": { "combat": 12, "directHq": 6, "objectiveBackbone": 5, "command": 1, "hero": 2, "selfInflicted": 0, "fatigue": 0, "other": 0 },
      "cards": { "T33": { "copies": 2, "drawn": 2, "played": 1, "roundSum": 4, "fuelSpent": 4, "inHandAtEnd": 1 } },
      "heroes": { "H07": { "deployedRound": 2, "activations": 3, "fuelSpent": 6 } },
      "trades": { "Tank": { "Infantry": { "suppressed": 2, "destroyed": 1, "armorAbsorbed": 0 } } }, // hits DEALT by this player
      "triggers": { "Breakthrough": { "T33": 1 }, "Last Stand": { "I18": 1 }, "Rally": { "I12": 2 } },
      "directHqUnits": 3, "fuelUnspent": 11, "fuelLostToCap": 2,
      "mulliganReturned": ["T31"],
      "craftPicks": [{ "round": 5, "stats": "1/20/3/3", "fixedLine": false, "keyword": "Bombard", "drawback": "rotateAll", "offered": "6/6/6/6 Armor ownHqDamage | ..." }]
    },
    "p2": { }
  },
  "objectives": { "1,0": { "cardId": "O1", "heldAtEnd": "p1", "turnsHeld": { "p1": 6, "p2": 2, "none": 4 }, "activations": { "p1": 3 }, "maxLevel": { "p1": 3 }, "backbone": { "p1": 4 }, "fuel": { "p1": 3 }, "draws": {} } },
  "turns": [{ "turn": 1, "player": "p2", "ms": 41235, "fuelUnspent": 1, "p1Hq": 30, "p2Hq": 30 }]
}
// stats/meta/{matchId}
{ "included": true, "note": "testing T33 change", "updatedAt": 1758000700000 }
```

HQ damage sources are by **cause**: `combat` (unit attacks incl. Blast/Barrage), `directHq`, `objectiveBackbone`, `command` (Overrun bonus, Scorched Earth), `hero` (H15, H17), `selfInflicted` (Emergency Supply, Sacrifice Play, H20, H21, Craft drawback), `fatigue` (derived at the end), `other` (anything unattributed, e.g. debug panel; in a non-debug match a non-zero `other` means a missed hook).

---

## Part A: Collect and save

### Task 1: Firebase rules check (Filip, manual, 2 minutes)

The database denies unauthenticated reads (confirmed 2026-09-16 via REST), so rules exist. They must allow signed-in clients to read and write `stats`.

- [ ] **Step 1:** Firebase console → project `signal-prototype-1eead` → Realtime Database → Rules.
- [ ] **Step 2:** If the rules are a single top-level `".read": "auth != null", ".write": "auth != null"`, nothing to do. If they are per-path (`games`, `lobbies`, `openLobbies`, `users`, ...), add this sibling block and Publish:

```json
"stats": {
  ".read": "auth != null",
  ".write": "auth != null"
}
```

- [ ] **Step 3:** Note in the task log which case applied. Task 10 verifies with a real write.

### Task 2: `js/stats.js` core (schema, normalization, card keys, rules hash)

**Files:**
- Create: `js/stats.js`
- Test: `tests/stats.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/stats.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatchStats, normalizeStats, statsCardKey, computeRulesHash,
} from '../js/stats.js?v=2026090402';
import { createInitialState } from '../js/state.js?v=2026090402';
import { CARDS } from '../js/cards.js?v=2026090402';
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

test('statsCardKey groups generated cards into one key per kind', () => {
  const crafted = craftCandidateToCard({ stats: { n: 6, e: 6, s: 6, w: 6 }, keyword: 'Armor', drawback: 'ownHqDamage' }, 'p1');
  assert.equal(statsCardKey(crafted.id), 'CRAFTED');
  assert.equal(statsCardKey('Craft-p2-999'), 'CRAFTED', 'unknown crafted id (other client) still groups');
  assert.equal(statsCardKey('I1'), 'I1');
});

test('computeRulesHash is stable and changes when card data changes', () => {
  assert.match(computeRulesHash(), /^[0-9a-f]{8}$/);
  assert.equal(computeRulesHash(), computeRulesHash());
  const tweaked = CARDS.map(c => (c.id === 'T33' ? { ...c, cost: c.cost + 1 } : c));
  assert.notEqual(computeRulesHash(tweaked), computeRulesHash());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/stats.test.mjs`
Expected: FAIL, `Cannot find module ... js/stats.js`.

- [ ] **Step 3: Write `js/stats.js` (core part)**

```js
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

// Generated cards get a unique id per copy (Craft-p1-3, ...), which would give every crafted
// Aircraft its own row. Group them by kind instead.
export function statsCardKey(cardId) {
  const card = CARD_BY_ID[cardId];
  if (card?.generated) return card.craftDrawback ? 'CRAFTED' : 'GENERATED';
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/stats.test.mjs`
Expected: 4 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass (module_identity picks up `js/stats.js` automatically and its imports use `?v=2026090402`).

- [ ] **Step 6: Commit**

```bash
git status
git add js/stats.js tests/stats.test.mjs
git commit -m "Add match statistics core: schema, Firebase normalization, rules hash

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Recorders

**Files:**
- Modify: `js/stats.js` (append)
- Test: `tests/stats.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append to the import list in `tests/stats.test.mjs`:

```js
import {
  recordCardPlayed, recordHqDamage, recordUnitHits, recordTrigger, recordHeroDeployed,
  recordHeroActivation, recordDirectHq, recordFuelLostToCap, recordTurnEnd, recordCraftPick,
  markDebugUsed, recordObjectiveActivation, recordObjectiveYield, recordObjectiveControl,
} from '../js/stats.js?v=2026090402';
```

Append these tests:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/stats.test.mjs`
Expected: FAIL, the new named imports are not exported.

- [ ] **Step 3: Append the recorders to `js/stats.js`**

```js
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
```

Note: `recordObjectiveYield(..., 'draws', 0)` returns early, so the `draws: {}` in the objectives test comes from `objectiveEntry` creating every field.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/stats.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git status
git add js/stats.js tests/stats.test.mjs
git commit -m "Add match statistics recorders

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: `buildMatchRecord`

**Files:**
- Modify: `js/stats.js` (append)
- Test: `tests/stats.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

Add `buildMatchRecord, STATS_BUILD_LABEL` to the stats import list, then append:

```js
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

  const record = buildMatchRecord(s, { winner: 'p1', endReason: 'hq', endedAt: 61000, site: 'test' });
  assert.equal(record.winnerSeat, 'first');
  assert.equal(record.rounds, 7);
  assert.equal(record.turnsPlayed, 13);
  assert.equal(record.durationMs, 60000);
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

test('buildMatchRecord for a match with no winner (disconnect)', () => {
  const record = buildMatchRecord(freshMatch(), { winner: null, endReason: 'disconnect', endedAt: 5000, site: 'test' });
  assert.equal(record.winnerSeat, 'none');
  assert.equal(record.endReason, 'disconnect');
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/stats.test.mjs`
Expected: FAIL, `buildMatchRecord` is not exported.

- [ ] **Step 3: Append to `js/stats.js`**

```js
// ── Final record ───────────────────────────────────────────────────────────────
// Pure: counters + the final state in, one flat Firebase-safe record out. `winner` is 'p1' | 'p2'
// | null. Things that can be derived from the final state are derived here instead of tracked
// live: cards drawn (starting deck minus what's left in the deck), dead cards (hand at the end),
// fatigue damage (1 + 2 + ... + fatigueCount), and "other" (HQ lost that no recorder claimed).
export function buildMatchRecord(state, { winner = null, endReason = 'hq', endedAt = Date.now(), site = '' } = {}) {
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
    durationMs: endedAt - stats.startedAt,
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/stats.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git status
git add js/stats.js tests/stats.test.mjs
git commit -m "Add buildMatchRecord for end-of-match statistics records

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: Hook points in `js/combat.js`

**Files:**
- Modify: `js/combat.js`
- Test: `tests/stats_combat.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/stats_combat.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchStats } from '../js/stats.js?v=2026090402';
import { createInitialState, createBoardUnit } from '../js/state.js?v=2026090402';
import { checkHeroPassivesOnPlace, resolveCraftDrawback, resolveDestructionChain, checkRally } from '../js/combat.js?v=2026090402';
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/stats_combat.test.mjs`
Expected: 4 failures (stats counters stay empty).

- [ ] **Step 3: Add the import to `js/combat.js`**

Directly below the existing `import` lines at the top of `js/combat.js`, add:

```js
import { recordHqDamage, recordUnitHits, recordTrigger } from './stats.js?v=2026090402';
```

- [ ] **Step 4: H21 self-damage** (`checkHeroPassivesOnPlace`)

Replace:

```js
    s = {
      ...s,
      [active]: { ...fueled, hq: fueled.hq - 1, heroTriggeredThisTurn: { ...fueled.heroTriggeredThisTurn, H21: true } },
    };
```

with:

```js
    s = {
      ...s,
      [active]: { ...fueled, hq: fueled.hq - 1, heroTriggeredThisTurn: { ...fueled.heroTriggeredThisTurn, H21: true } },
    };
    s = recordHqDamage(s, active, 1, 'selfInflicted');
```

- [ ] **Step 5: Rally** (`checkRally`)

Replace:

```js
  const tag = `${card.name} (Rally):`;

  switch (card.id) {
```

with:

```js
  const tag = `${card.name} (Rally):`;
  s = recordTrigger(s, owner, 'Rally', card.id);

  switch (card.id) {
```

- [ ] **Step 6: Last Stand and Breakthrough** (both `resolveDestructionChain` and `applyPostDestructionEffects` contain identical blocks; apply each replacement to **both occurrences**, e.g. Edit with `replace_all: true`)

Replace (2 occurrences):

```js
      const r = runLastStandEffect(s, unitKey, dyingUnit, card, owner, usedTargets);
      s = r.state;
```

with:

```js
      const r = runLastStandEffect(s, unitKey, dyingUnit, card, owner, usedTargets);
      s = r.state;
      s = recordTrigger(s, owner, 'Last Stand', dyingUnit.cardId);
```

Replace (2 occurrences):

```js
      const r = runBreakthroughEffect(s, sourceUnitKey, sourceUnit, sourceCard);
      s = r.state;
```

with:

```js
      const r = runBreakthroughEffect(s, sourceUnitKey, sourceUnit, sourceCard);
      s = r.state;
      s = recordTrigger(s, sourceUnit.owner, 'Breakthrough', sourceUnit.cardId);
```

- [ ] **Step 7: Craft drawbacks** (`resolveCraftDrawback`)

Replace:

```js
    s = { ...s, [ownerRole]: { ...s[ownerRole], hq: s[ownerRole].hq - 3 } };
```

with:

```js
    s = { ...s, [ownerRole]: { ...s[ownerRole], hq: s[ownerRole].hq - 3 } };
    s = recordHqDamage(s, ownerRole, 3, 'selfInflicted');
```

Replace:

```js
      s = { ...s, board: { ...s.board, [pick.key]: suppressed } };
```

with:

```js
      s = { ...s, board: { ...s.board, [pick.key]: suppressed } };
      s = recordUnitHits(s, ownerRole, 'self', { [pick.key]: pick.unit }, [{ key: pick.key, newUnit: suppressed }]);
```

- [ ] **Step 8: Run tests**

Run: `node --test tests/stats_combat.test.mjs`, then `npm test`
Expected: the 4 new tests pass; full suite passes (existing fixtures have no `state.stats`, so recorders no-op).

- [ ] **Step 9: Commit**

```bash
git status
git add js/combat.js tests/stats_combat.test.mjs
git commit -m "Record self-damage, self-suppression and keyword triggers in combat.js

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 6: Firebase helpers

**Files:**
- Modify: `js/firebase.js` (append)

No unit test (needs a live Firebase); verified end-to-end in Task 10.

- [ ] **Step 1: Append to `js/firebase.js`**

```js
// ── Match statistics (docs/plans/2026-09-16-match-statistics.md) ───────────────
// game.html never calls initAuth; it relies on the anonymous session index.html created, which
// Firebase restores from its own storage asynchronously. Wait for that restore and sign in only
// if there was no session, so a stats write can't fail an `auth != null` rule on a cold load.
export async function ensureSignedIn() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser.uid;
}

export async function writeMatchRecord(matchId, record) {
  await ensureSignedIn();
  await set(ref(db, `stats/matches/${matchId}`), record);
}

// Separate path from the record, so a late record write can never overwrite the host's choice.
export async function writeMatchMeta(matchId, meta) {
  await ensureSignedIn();
  await set(ref(db, `stats/meta/${matchId}`), meta);
}

export async function fetchStatsData() {
  await ensureSignedIn();
  const [matches, meta] = await Promise.all([get(ref(db, 'stats/matches')), get(ref(db, 'stats/meta'))]);
  return { matches: matches.val() ?? {}, meta: meta.val() ?? {} };
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git status
git add js/firebase.js
git commit -m "Add Firebase helpers for match statistics records and host settings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: `js/game.js` wiring, part 1 (setup, sync, turn flow)

**Files:**
- Modify: `js/game.js`

Each step is a find-and-replace on unique text. Anchors verified against `main` at `d2d02fe`; if one doesn't match, re-read the surrounding function rather than guessing.

- [ ] **Step 1: Imports**

Replace:

```js
import { pushState, pushVersionedState, subscribeState, setPlayerLeft, updateLobby, subscribeLobby, updatePlayerState } from './firebase.js?v=2026090402';
```

with:

```js
import { pushState, pushVersionedState, subscribeState, setPlayerLeft, updateLobby, subscribeLobby, updatePlayerState, writeMatchRecord, writeMatchMeta } from './firebase.js?v=2026090402';
import { createMatchStats, normalizeStats, markDebugUsed, recordCardPlayed, recordHqDamage, recordUnitHits, recordHeroDeployed, recordHeroActivation, recordDirectHq, recordFuelLostToCap, recordTurnEnd, recordCraftPick, recordObjectiveActivation, recordObjectiveYield, recordObjectiveControl, buildMatchRecord } from './stats.js?v=2026090402';
```

- [ ] **Step 2: Module state**

Replace:

```js
let gameOver = false;
```

with:

```js
let gameOver = false;
// Match statistics: when this client saw the current turn start (its own clock), or null when
// it's not this client's turn to measure. See recordTurnEnd in stats.js.
let turnStartedAtMs = null;
```

- [ ] **Step 3: Create stats when the match is created** (`startGame`)

Replace:

```js
function startGame(p1Ids, p2Ids, mapId, p1Heroes = [], p2Heroes = []) {
  let s = createInitialState(p1Ids, p2Ids, mapId, p1Heroes, p2Heroes);
```

with:

```js
function startGame(p1Ids, p2Ids, mapId, p1Heroes = [], p2Heroes = []) {
  let s = createInitialState(p1Ids, p2Ids, mapId, p1Heroes, p2Heroes);
  s = {
    ...s,
    stats: createMatchStats(s, {
      matchId: `${gameId ?? 'local'}-${Date.now().toString(36)}`,
      mode: isOnline ? 'online' : isAiMode ? 'vsAi' : 'hotseat',
      source: statsSource(),
      startedAt: Date.now(),
    }),
  };
```

Then add this helper directly above `function startGame(`:

```js
// selfplay_test.mjs sets this before loading the page, so bot-vs-bot games are tagged and kept
// out of Firebase. Everything else is a human game.
function statsSource() {
  try {
    return localStorage.getItem('signal-stats-source') === 'selfplay' ? 'selfplay' : 'human';
  } catch {
    return 'human';
  }
}
```

- [ ] **Step 4: Remember mulligan choices** (`applyMulligan`)

Replace:

```js
  return { ...s, [role]: { ...ps, hand: [...keep, ...drawn], deck: newDeck.slice(putBack.length) } };
```

with:

```js
  // mulliganReturned lives on the player slice (not state.stats) because online mulligans are
  // written with updatePlayerState, which only sends that player's slice.
  return { ...s, [role]: { ...ps, hand: [...keep, ...drawn], deck: newDeck.slice(putBack.length), mulliganReturned: putBack } };
```

- [ ] **Step 5: First turn timer** (`finishStartGame`)

Replace:

```js
  state = { ...state, readyForPlay: true, log: [`Game started on ${mapName} — ${state.initiative.toUpperCase()} goes first.`] };
```

with:

```js
  state = { ...state, readyForPlay: true, log: [`Game started on ${mapName} — ${state.initiative.toUpperCase()} goes first.`] };
  turnStartedAtMs = !isOnline || state.initiative === myRole ? Date.now() : null;
```

- [ ] **Step 6: Firebase normalization** (`normalizeFirebaseState`)

Replace:

```js
    discardPile: toArray(p.discardPile),
  } : p;
```

with:

```js
    discardPile: toArray(p.discardPile),
    mulliganReturned: toArray(p.mulliganReturned),
  } : p;
```

Replace:

```js
    board: normalizeRemoteBoard(raw.board),
    _eventHistory: eventHistory,
  };
```

with:

```js
    board: normalizeRemoteBoard(raw.board),
    _eventHistory: eventHistory,
    // Only add the key when present: an `undefined` value would make the next Firebase write fail.
    ...(raw.stats ? { stats: normalizeStats(raw.stats) } : {}),
  };
```

- [ ] **Step 7: Turn timer on the receiving client** (`receiveRemoteState`)

Replace:

```js
    if (!normalized.pendingObjectivePick) runHeroPhase(myRole);
  }
}
```

with:

```js
    if (!normalized.pendingObjectivePick) runHeroPhase(myRole);
  }
  // Start this client's turn clock the first time it sees its own turn (covers turn hand-offs and
  // the very first turn on the non-host client).
  if (isOnline && !gameOver && normalized.readyForPlay && normalized.initiative === myRole && turnStartedAtMs == null) {
    turnStartedAtMs = Date.now();
  }
}
```

- [ ] **Step 8: Debug panel flag** (`commitState`)

Replace:

```js
  lastChangedKeys = new Set(); // player acted — clear opponent highlights
```

with:

```js
  // Every debug panel action logs "[DEBUG] ...". Matches touched by it are flagged so the
  // Statistics page can leave them out.
  if (logLines?.some(line => typeof line === 'string' && line.startsWith('[DEBUG]'))) newState = markDebugUsed(newState);
  lastChangedKeys = new Set(); // player acted — clear opponent highlights
```

Verify every debug handler goes through `commitState` with a `[DEBUG]` line:

Run: `grep -n "\[DEBUG\]" js/debug.js js/game.js`
Expected: every debug action's log text starts with `[DEBUG]`. If a game.js debug handler builds its own log lines without the prefix, add it.

- [ ] **Step 9: End Turn** (the `btn-end-turn` click handler)

Replace:

```js
  const directHQLog = directHQ.log;
```

with:

```js
  const directHQLog = directHQ.log;
  s = recordHqDamage(s, 'p1', directHQ.hqDamageToP1, 'directHq');
  s = recordHqDamage(s, 'p2', directHQ.hqDamageToP2, 'directHq');
  s = recordDirectHq(s, currentPlayer, directHQ.sources.length);
  s = recordTurnEnd(s, {
    role: currentPlayer,
    ms: turnStartedAtMs == null ? undefined : Date.now() - turnStartedAtMs,
    fuelUnspent: s[currentPlayer].fuel,
  });
  // Local/vs AI: this client measures the next turn too. Online: the other client measures it.
  turnStartedAtMs = isOnline ? null : Date.now();
```

Replace:

```js
  newState = startOfTurn(newState);                      // gain fuel for new active player
```

with:

```js
  const fuelBeforeRefresh = newState[newActive].fuel;
  const pendingFuelBeforeRefresh = newState[newActive].pendingFuelGain ?? 0;
  newState = startOfTurn(newState);                      // gain fuel for new active player
  // startOfTurn adds 3 capped plus pendingFuelGain uncapped; whatever of the 3 didn't land hit the cap.
  newState = recordFuelLostToCap(newState, newActive, 3 + pendingFuelBeforeRefresh - (newState[newActive].fuel - fuelBeforeRefresh));
```

Replace:

```js
  newState = checkObjectiveControl(newState);            // check majority-adjacent control
```

with:

```js
  newState = checkObjectiveControl(newState);            // check majority-adjacent control
  newState = recordObjectiveControl(newState);
```

- [ ] **Step 10: Objective backbone and yields** (`applyObjectiveEffects`)

Replace:

```js
    const backbone = lv >= 3 ? 2 : 1;
    s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - backbone } };
```

with:

```js
    const backbone = lv >= 3 ? 2 : 1;
    s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - backbone } };
    s = recordHqDamage(s, opp, backbone, 'objectiveBackbone');
    s = recordObjectiveActivation(s, key, player, lv, backbone);
    // Secondary-effect yields are measured as a before/after diff around the switch below, so no
    // individual Objective case needs its own recorder call.
    const fuelBeforeEffect = s[player].fuel;
    const deckBeforeEffect = s[player].deck.length;
```

Replace:

```js
      default: log.push(`${nm} L${lv}: effect triggered (not automated)`);
    }
  }
```

with:

```js
      default: log.push(`${nm} L${lv}: effect triggered (not automated)`);
    }
    s = recordObjectiveYield(s, key, player, 'fuel', s[player].fuel - fuelBeforeEffect);
    s = recordObjectiveYield(s, key, player, 'draws', deckBeforeEffect - s[player].deck.length);
  }
```

(Cases that `return` early for a player pick never gain Fuel or draw, so skipping the diff there loses nothing.)

- [ ] **Step 11: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git status
git add js/game.js
git commit -m "Wire match statistics into setup, sync, End Turn and objective effects

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 8: `js/game.js` wiring, part 2 (plays, Heroes, damage, hits, Craft)

**Files:**
- Modify: `js/game.js`

- [ ] **Step 1: Unit placement** (board click, `uiState === "placing"`)

Replace:

```js
        card, c, discount,
      ),
    };
```

with:

```js
        card, c, discount,
      ),
    };
    newState = recordCardPlayed(newState, active, selectedHandCardId, effectiveCost);
```

- [ ] **Step 2: Instant Commands** (`playInstantCommand`)

Replace:

```js
  const log = [];

  switch (cardId) {
    case 'C05': { // Recon — draw 2
```

with:

```js
  s = recordCardPlayed(s, active, cardId, effectiveCost);
  const log = [];

  switch (cardId) {
    case 'C05': { // Recon — draw 2
```

- [ ] **Step 3: Targeted Commands** (4 functions; Cancel restores `preCommandState`, which also undoes the recorded play)

In `startCoordinatedStrike`, replace:

```js
  pendingCommandId = cardId;
  pendingCoordStrikeFirst = null;
```

with:

```js
  state = recordCardPlayed(state, active, cardId, effectiveCost);
  pendingCommandId = cardId;
  pendingCoordStrikeFirst = null;
```

In `startCommandManeuver`, replace:

```js
  pendingCommandId = cardId;
  pendingCommandManeuverSource = { key: null, commandId: cardId };
```

with:

```js
  state = recordCardPlayed(state, active, cardId, effectiveCost);
  pendingCommandId = cardId;
  pendingCommandManeuverSource = { key: null, commandId: cardId };
```

In `startCommandTargeting`, replace:

```js
  pendingCommandId = cardId;
  pendingRallyCryCount = (cardId === 'C03' || cardId === 'C10') ? 2 : 0;
```

with:

```js
  state = recordCardPlayed(state, active, cardId, effectiveCost);
  pendingCommandId = cardId;
  pendingRallyCryCount = (cardId === 'C03' || cardId === 'C10') ? 2 : 0;
```

In `startEnemyHeroTargeting`, replace:

```js
  pendingCommandId = cardId;
  uiState = 'command-hero-targeting';
```

with:

```js
  state = recordCardPlayed(state, active, cardId, effectiveCost);
  pendingCommandId = cardId;
  uiState = 'command-hero-targeting';
```

- [ ] **Step 4: Hero deployment** (`runHeroPhase` → `finish`)

Replace:

```js
    s = { ...s, [role]: { ...deployed, heroRepositioned: true } };
```

with:

```js
    s = { ...s, [role]: { ...deployed, heroRepositioned: true } };
    s = recordHeroDeployed(s, role, heroId);
```

- [ ] **Step 5: Hero activations** (`tryActivateHero`, 4 paths)

H01 path, replace:

```js
      commitState(paid, costModLog, undefined, undefined, `${role}-${col}`);
      showQuartermasterModal(role, candidates);
```

with:

```js
      commitState(recordHeroActivation(paid, role, hero.id, cost), costModLog, undefined, undefined, `${role}-${col}`);
      showQuartermasterModal(role, candidates);
```

H25 path, replace:

```js
      commitState(paid, costModLog, undefined, undefined, `${role}-${col}`);
      showCraftPickerModal(role);
```

with:

```js
      commitState(recordHeroActivation(paid, role, hero.id, cost), costModLog, undefined, undefined, `${role}-${col}`);
      showCraftPickerModal(role);
```

Instant path, replace:

```js
    const { state: next, log } = applyHeroPower(paid, role, col, hero, null);
```

with:

```js
    const { state: next, log } = applyHeroPower(recordHeroActivation(paid, role, hero.id, cost), role, col, hero, null);
```

Targeted path, replace:

```js
  state = { ...state, [role]: { ...spendCostMods(ps), fuel: ps.fuel - cost } };
  pendingHeroId = hero.id;
```

with:

```js
  state = recordHeroActivation({ ...state, [role]: { ...spendCostMods(ps), fuel: ps.fuel - cost } }, role, hero.id, cost);
  pendingHeroId = hero.id;
```

- [ ] **Step 6: Hero damage** (`applyHeroPower`)

H17, replace:

```js
      s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } };
```

with:

```js
      s = { ...s, [opp]: { ...s[opp], hq: s[opp].hq - 2 } };
      s = recordHqDamage(s, opp, 2, 'hero');
```

H15, replace:

```js
      s = { ...s, board: { ...s.board, [targetKey]: finalUnit }, [opp]: { ...s[opp], hq: s[opp].hq - hqDamage } };
```

with:

```js
      s = { ...s, board: { ...s.board, [targetKey]: finalUnit }, [opp]: { ...s[opp], hq: s[opp].hq - hqDamage } };
      s = recordHqDamage(s, opp, hqDamage, 'hero');
      s = recordUnitHits(s, role, 'hero', { [targetKey]: before }, [{ key: targetKey, newUnit: finalUnit }]);
```

- [ ] **Step 7: Unit attacks** (board click, `uiState === "targeting"`)

Replace:

```js
      p1: { ...rallyState.p1, hq: rallyState.p1.hq - dmgP1 },
      p2: { ...rallyState.p2, hq: rallyState.p2.hq - dmgP2 },
    };
```

with:

```js
      p1: { ...rallyState.p1, hq: rallyState.p1.hq - dmgP1 },
      p2: { ...rallyState.p2, hq: rallyState.p2.hq - dmgP2 },
    };
    // Base destruction damage is combat; anything Overrun added on top is the Command's.
    newState = recordHqDamage(newState, 'p1', result.hqDamageToP1, 'combat');
    newState = recordHqDamage(newState, 'p2', result.hqDamageToP2, 'combat');
    newState = recordHqDamage(newState, 'p1', dmgP1 - result.hqDamageToP1, 'command');
    newState = recordHqDamage(newState, 'p2', dmgP2 - result.hqDamageToP2, 'command');
    newState = recordUnitHits(newState, attacker, CARD_BY_ID[rallyState.board[pendingAttackerKey]?.cardId]?.cls ?? 'Unknown', rallyState.board, result.boardMutations);
```

- [ ] **Step 8: Self-damage Commands and H20**

C23 Emergency Supply (`playInstantCommand`), replace:

```js
      s = { ...s, [active]: { ...grantedFuel, hq: grantedFuel.hq - 2, tempFuelGrant: (grantedFuel.tempFuelGrant ?? 0) + 3 } };
```

with:

```js
      s = { ...s, [active]: { ...grantedFuel, hq: grantedFuel.hq - 2, tempFuelGrant: (grantedFuel.tempFuelGrant ?? 0) + 3 } };
      s = recordHqDamage(s, active, 2, 'selfInflicted');
```

C18 Sacrifice Play (`applyCommandEffect`), replace:

```js
      s = { ...dc.state, p1: { ...dc.state.p1, hq: dc.state.p1.hq - dc.hqDamageToP1 }, p2: { ...dc.state.p2, hq: dc.state.p2.hq - dc.hqDamageToP2 } };
      s = { ...s, [active]: drawCards(s[active], 2) };
```

with:

```js
      s = { ...dc.state, p1: { ...dc.state.p1, hq: dc.state.p1.hq - dc.hqDamageToP1 }, p2: { ...dc.state.p2, hq: dc.state.p2.hq - dc.hqDamageToP2 } };
      s = recordHqDamage(s, 'p1', dc.hqDamageToP1, 'selfInflicted');
      s = recordHqDamage(s, 'p2', dc.hqDamageToP2, 'selfInflicted');
      s = recordUnitHits(s, active, 'self', { [targetKey]: unit }, [{ key: targetKey, newUnit: null }]);
      s = { ...s, [active]: drawCards(s[active], 2) };
```

C19 Scorched Earth Raid, replace:

```js
      s = { ...dc.state, p1: { ...dc.state.p1, hq: dc.state.p1.hq - dc.hqDamageToP1 }, p2: { ...dc.state.p2, hq: dc.state.p2.hq - dc.hqDamageToP2 } };
      log.push(`${card.name}:`);
```

with:

```js
      s = { ...dc.state, p1: { ...dc.state.p1, hq: dc.state.p1.hq - dc.hqDamageToP1 }, p2: { ...dc.state.p2, hq: dc.state.p2.hq - dc.hqDamageToP2 } };
      s = recordHqDamage(s, 'p1', dc.hqDamageToP1, 'command');
      s = recordHqDamage(s, 'p2', dc.hqDamageToP2, 'command');
      s = recordUnitHits(s, active, 'self', { [targetKey]: unit }, [{ key: targetKey, newUnit: null }]);
      log.push(`${card.name}:`);
```

H20 Ruthless Strategist (`applyRuthlessStrategistIfPresent`), replace:

```js
  return { state: { ...s, [active]: afterDamage }, log: [`${CARD_BY_ID['H20'].name}: draw 1 card, 1 damage to own HQ`] };
```

with:

```js
  return { state: recordHqDamage({ ...s, [active]: afterDamage }, active, 1, 'selfInflicted'), log: [`${CARD_BY_ID['H20'].name}: draw 1 card, 1 damage to own HQ`] };
```

- [ ] **Step 9: Craft picks**

Replace:

```js
let craftPickerRole = null;
```

with:

```js
let craftPickerRole = null;
let craftOfferedCards = []; // the 3 candidates currently shown, for recordCraftPick
```

Replace:

```js
  const candidates = generateCraftCandidates().map(c => craftCandidateToCard(c, role));
```

with:

```js
  const candidates = generateCraftCandidates().map(c => craftCandidateToCard(c, role));
  craftOfferedCards = candidates;
```

In `confirmCraftPick`, replace:

```js
  const s = {
    ...state,
    [role]: addCardToHand(advanceCraftCost(ps), chosenId),
    generatedCards: { ...(state.generatedCards ?? {}), [chosenId]: chosen },
  };
```

with:

```js
  const s = recordCraftPick({
    ...state,
    [role]: addCardToHand(advanceCraftCost(ps), chosenId),
    generatedCards: { ...(state.generatedCards ?? {}), [chosenId]: chosen },
  }, role, chosen, craftOfferedCards);
```

- [ ] **Step 10: Confirm no HQ write was missed**

Run: `grep -n "hq: .*- " js/game.js js/combat.js`
Expected: every line is followed (within 1-5 lines) by a `recordHqDamage` call, except `game.js` Artillery Position targeting (`hq: state[defOwner].hq - hqDamage`, a dead path since Run 2: no objective sets `pendingArtyHits` above 0). Fatigue (`state.js` `drawCards`) is derived in `buildMatchRecord`.

- [ ] **Step 11: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git status
git add js/game.js
git commit -m "Record card plays, Hero use, HQ damage sources, unit hits and Craft picks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 9: End screen: write the record, host controls

**Files:**
- Modify: `js/game.js`, `game.html`, `css/game.css`

- [ ] **Step 1: End-screen markup** (`game.html`)

Replace:

```html
      <div class="end-log-actions">
        <button class="btn btn-secondary" id="log-copy-btn">Copy Log</button>
        <button class="btn btn-secondary" id="log-download-btn">Download Log</button>
      </div>
```

with:

```html
      <div class="end-log-actions">
        <button class="btn btn-secondary" id="log-copy-btn">Copy Log</button>
        <button class="btn btn-secondary" id="log-download-btn">Download Log</button>
      </div>
      <div class="end-stats" id="end-stats" style="display:none;">
        <label class="end-stats-include"><input type="checkbox" id="stats-include"> Include in statistics</label>
        <textarea id="stats-note" maxlength="300" rows="2" placeholder="Note (optional), e.g. testing the T33 change"></textarea>
        <button class="btn btn-secondary" id="stats-save-btn">Save</button>
      </div>
      <div class="end-stats-status" id="stats-status"></div>
```

- [ ] **Step 2: Styles** (`css/game.css`)

Replace:

```css
.end-log-actions { display: flex; gap: 10px; }
```

with:

```css
.end-log-actions { display: flex; gap: 10px; }
.end-stats { flex-direction: column; align-items: center; gap: 8px; width: 100%; max-width: 360px; }
.end-stats-include { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; letter-spacing: 1px; color: var(--end-sub); font-family: 'Arial Narrow', Arial, sans-serif; }
.end-stats textarea { width: 100%; resize: vertical; background: var(--bg); color: inherit; border: 1px solid var(--end-sub); border-radius: 3px; padding: 6px 8px; font-family: inherit; font-size: 12px; }
.end-stats-status { min-height: 14px; font-size: 11px; color: var(--end-sub); }
```

- [ ] **Step 3: Finalize and host controls** (`js/game.js`)

Add this block directly above `function showEndScreen(winner) {`:

```js
// ── Match statistics (docs/plans/2026-09-16-match-statistics.md) ────────────────
// Exactly one client writes the record: the one that committed the game-ending state (checkWin
// from a local action), or the one left behind on a disconnect. A client that only RECEIVED the
// final state never writes, so online matches are never counted twice. The host (online p1, or
// the only client in Local/vs AI) gets the include toggle and note, saved under stats/meta.
let statsFinalized = false;

function setStatsStatus(text) {
  const el = document.getElementById('stats-status');
  if (el) el.textContent = text;
}

function finalizeMatchStats({ winner, endReason }) {
  if (statsFinalized || !state?.stats) return;
  statsFinalized = true;
  let record;
  try {
    record = buildMatchRecord(state, { winner, endReason, endedAt: Date.now(), site: `${location.origin}${location.pathname}` });
  } catch (err) {
    console.error('[stats] could not build the match record', err);
    setStatsStatus('Statistics: could not build the match record (see console).');
    return;
  }
  window.__SIGNAL_STATS__ = { lastRecord: record };
  if (record.source === 'selfplay') return; // selfplay_test.mjs saves these to a local file instead
  writeMatchRecord(record.matchId, record)
    .then(() => setStatsStatus('Match saved to the statistics log.'))
    .catch(err => {
      console.error('[stats] match record write failed', err);
      setStatsStatus(`Statistics: match not saved (${err.message}).`);
    });
}

function showStatsControls() {
  if (!state?.stats?.matchId || state.stats.source === 'selfplay') return;
  if (isOnline && myRole !== 'p1') return;
  document.getElementById('end-stats').style.display = 'flex';
}

document.getElementById('stats-save-btn').addEventListener('click', () => {
  const matchId = state?.stats?.matchId;
  if (!matchId) return;
  const btn = document.getElementById('stats-save-btn');
  btn.disabled = true;
  writeMatchMeta(matchId, {
    included: document.getElementById('stats-include').checked,
    note: document.getElementById('stats-note').value.trim(),
    updatedAt: Date.now(),
  })
    .then(() => setStatsStatus('Statistics settings saved.'))
    .catch(err => {
      console.error('[stats] settings write failed', err);
      setStatsStatus(`Statistics settings not saved (${err.message}).`);
    })
    .finally(() => { btn.disabled = false; });
});
```

- [ ] **Step 4: Hook into the end paths**

Replace:

```js
function showEndScreen(winner) {
```

with:

```js
function showEndScreen(winner, { remote = false } = {}) {
```

Replace (inside `showEndScreen`):

```js
  gameOver = true;
  setTimeout(() => {
```

with:

```js
  gameOver = true;
  if (!remote) finalizeMatchStats({ winner: winner === 'P1' ? 'p1' : 'p2', endReason: 'hq' });
  showStatsControls();
  setTimeout(() => {
```

Replace:

```js
function checkWin() {
  if (state.p1.hq <= 0) { showEndScreen('P2'); return true; }
  if (state.p2.hq <= 0) { showEndScreen('P1'); return true; }
  return false;
}
```

with:

```js
function checkWin({ remote = false } = {}) {
  if (state.p1.hq <= 0) { showEndScreen('P2', { remote }); return true; }
  if (state.p2.hq <= 0) { showEndScreen('P1', { remote }); return true; }
  return false;
}
```

In `receiveRemoteState`, replace:

```js
  checkWin();
  // The opponent's End Turn handler can't prompt us, so an inbound state that hands us the
```

with:

```js
  checkWin({ remote: true });
  // The opponent's End Turn handler can't prompt us, so an inbound state that hands us the
```

Replace:

```js
function showDisconnectScreen(who) {
  gameOver = true;
```

with:

```js
function showDisconnectScreen(who) {
  // If the match had already ended normally, its record already exists: don't overwrite it
  // with a "disconnect" one just because the other player left the end screen.
  if (!gameOver) finalizeMatchStats({ winner: null, endReason: 'disconnect' });
  gameOver = true;
  showStatsControls();
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git status
git add js/game.js game.html css/game.css
git commit -m "Write match statistics at game end, add host include toggle and note

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 10: Self-play output, sanity check, live verification, docs

**Files:**
- Modify: `selfplay_test.mjs`, `.gitignore`, `STATUS.md`, `DEVNOTES.md`, `CHANGELOG.md`
- Create: `scripts/check_selfplay_stats.mjs`

- [ ] **Step 1: Tag self-play games and save their records** (`selfplay_test.mjs`)

Replace:

```js
import { chromium } from "playwright";
```

with:

```js
import { chromium } from "playwright";
import { appendFileSync } from "node:fs";
```

Replace:

```js
const BASE_URL = "http://localhost:3000";
```

with:

```js
const BASE_URL = "http://localhost:3000";
const SELFPLAY_STATS_FILE = "selfplay_stats.jsonl"; // one match record per line, see scripts/check_selfplay_stats.mjs
```

Replace:

```js
async function playOneGame(page) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
```

with:

```js
async function playOneGame(page) {
  // Tags the match as bot self-play: game.js keeps it out of Firebase and exposes the record instead.
  await page.addInitScript(() => localStorage.setItem("signal-stats-source", "selfplay"));
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
```

Replace:

```js
  const gameOver = await page.locator("#end-screen").isVisible().catch(() => false);
```

with:

```js
  const gameOver = await page.locator("#end-screen").isVisible().catch(() => false);
  const statsRecord = await page.evaluate(() => window.__SIGNAL_STATS__?.lastRecord ?? null).catch(() => null);
  if (statsRecord) appendFileSync(SELFPLAY_STATS_FILE, JSON.stringify(statsRecord) + "\n");
```

- [ ] **Step 2: Ignore the output file** (`.gitignore`, append a line)

```
selfplay_stats.jsonl
```

- [ ] **Step 3: Create `scripts/check_selfplay_stats.mjs`**

```js
// Sanity-checks match records written by selfplay_test.mjs. The key check: every point of HQ
// damage should be attributed to a named source. A non-zero "other" in a match without debug use
// means some HQ damage path isn't calling recordHqDamage (js/stats.js).
// Run: node scripts/check_selfplay_stats.mjs [file]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'selfplay_stats.jsonl';
const records = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
let problems = 0;

for (const r of records) {
  const lines = [`${r.matchId} ${r.mapId} winner=${r.winner ?? 'none'} (${r.winnerSeat}) rounds=${r.rounds} turns=${(r.turns ?? []).length}`];
  for (const role of ['p1', 'p2']) {
    const p = r.players?.[role] ?? {};
    const dmg = p.hqDamageTaken ?? {};
    const played = Object.values(p.cards ?? {}).reduce((a, c) => a + (c.played ?? 0), 0);
    lines.push(`${role}: finalHq=${p.finalHq} damage=${JSON.stringify(dmg)} played=${played} heroes=${Object.keys(p.heroes ?? {}).length}`);
    if (!r.debugUsed && (dmg.other ?? 0) !== 0) {
      problems++;
      lines.push(`!! ${role} has ${dmg.other} unattributed HQ damage`);
    }
    if (played === 0) {
      problems++;
      lines.push(`!! ${role} played no cards`);
    }
  }
  if ((r.turns ?? []).length === 0) {
    problems++;
    lines.push('!! no turns recorded');
  }
  console.log(lines.join('\n  '));
}

console.log(`\n${records.length} record(s), ${problems} problem(s)`);
process.exitCode = problems ? 1 : 0;
```

- [ ] **Step 4: Run self-play and check the records**

Run (terminal 1): `npm run dev`
Run (terminal 2): `node selfplay_test.mjs 4` then `node scripts/check_selfplay_stats.mjs`
Expected: one record per finished game, `0 problem(s)`. If a record shows unattributed HQ damage, find the missing hook: compare the game log (`#game-log`) HQ lines against the damage buckets for that match. Delete `selfplay_stats.jsonl` afterwards if the test data isn't wanted.

- [ ] **Step 5: Live Firebase check (manual, dev server running)**

1. Open `http://localhost:3000/index.html` → Local Play → any map, both decks → mulligan.
2. Play a turn each so a few cards are played, then use the debug panel to set P2 HQ to 0.
3. End screen shows "Match saved to the statistics log." and the include checkbox, note box and Save button.
4. Tick include, type a note, Save → "Statistics settings saved."
5. Firebase console → Realtime Database → `stats/matches/local-...` exists with `debugUsed: true`, `players.p1.cards` filled; `stats/meta/local-...` has `included: true` and the note.

If step 3 shows `PERMISSION_DENIED`, Task 1's rule is missing.

- [ ] **Step 6: Docs**

`STATUS.md`: add a "Match statistics" section: what's tracked (link to this plan's record format), who writes (committing client only), host include toggle + note under `stats/meta`, self-play records in `selfplay_stats.jsonl`, known gaps: abandoned matches (tab closed / Exit mid-game) are not recorded; turn durations use each client's own clock; `turnsPlayed` counts the turn in progress when the game ends.

`DEVNOTES.md` "Safe change checklist": add

```
9. A new HQ damage source, card-play path, hit source, or Hero activation path must call the
   matching recorder in `js/stats.js` (unrecorded HQ damage shows up as "other" in
   `node scripts/check_selfplay_stats.mjs`). Bump `STATS_BUILD_LABEL` when a balance pass or
   rules change lands.
```

`CHANGELOG.md`: add a newest-first entry "2026-09-XX — Match statistics (collection)" summarizing Tasks 2-10.

- [ ] **Step 7: Commit**

```bash
git status
git add selfplay_test.mjs .gitignore scripts/check_selfplay_stats.mjs STATUS.md DEVNOTES.md CHANGELOG.md
git commit -m "Save self-play match records locally, add stats sanity check, document statistics

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Part B: Statistics page

### Task 11: `js/stats-aggregate.js`

**Files:**
- Create: `js/stats-aggregate.js`
- Test: `tests/stats_aggregate.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/stats_aggregate.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordsFromFirebase, recordsFromJsonl, filterRecords, summarize, damageBySource, cardRows,
  heroRows, objectiveSlotRows, objectiveCardRows, tradeRows, triggerRows, craftRows, matchRows,
  slotLabel, toCsv,
} from '../js/stats-aggregate.js?v=2026090402';

function record(overrides = {}) {
  return {
    matchId: 'm1', mode: 'hotseat', source: 'human', buildLabel: '2026-09-16', debugUsed: false,
    startedAt: 1000, durationMs: 600000, mapId: 'kursk', firstPlayer: 'p1', winner: 'p1', winnerSeat: 'first',
    endReason: 'hq', rounds: 8, included: true, note: '',
    players: {
      p1: {
        heroRoster: ['H07'], hqDamageTaken: { combat: 10 },
        cards: { T33: { copies: 2, drawn: 2, played: 1, roundSum: 3, fuelSpent: 4, inHandAtEnd: 1 } },
        heroes: { H07: { deployedRound: 2, activations: 3, fuelSpent: 6 } },
        trades: { Tank: { Infantry: { destroyed: 2 } } }, triggers: { Breakthrough: { T33: 1 } },
        fuelLostToCap: 2, directHqUnits: 1, craftPicks: [],
      },
      p2: {
        heroRoster: ['H07'], hqDamageTaken: { combat: 20, directHq: 10 },
        cards: { T33: { copies: 2, drawn: 1, played: 0, roundSum: 0, fuelSpent: 0, inHandAtEnd: 1 } },
        heroes: {}, trades: {}, triggers: {}, fuelLostToCap: 0, directHqUnits: 0,
        craftPicks: [{ keyword: 'Armor', drawback: 'rotateAll', fixedLine: true }],
      },
    },
    objectives: { '1,0': { cardId: 'O1', heldAtEnd: 'p1', turnsHeld: { p1: 6, none: 2 }, activations: { p1: 3 }, backbone: { p1: 4 }, fuel: { p1: 3 }, draws: {} } },
    turns: [{ turn: 1, player: 'p1', ms: 30000, fuelUnspent: 1 }, { turn: 2, player: 'p2', ms: 90000, fuelUnspent: 3 }],
    ...overrides,
  };
}
// Same match, but p2 won (second seat).
const lost = () => record({ matchId: 'm2', startedAt: 2000, winner: 'p2', winnerSeat: 'second' });

test('recordsFromFirebase merges include/note settings and sorts newest first', () => {
  const rows = recordsFromFirebase(
    { m1: record({ included: undefined, note: undefined }), m2: lost() },
    { m2: { included: true, note: 'T33 test' } },
  );
  assert.deepEqual(rows.map(r => [r.matchId, r.included, r.note]), [['m2', true, 'T33 test'], ['m1', false, '']]);
});

test('recordsFromJsonl reads one record per line and treats them as included', () => {
  const rows = recordsFromJsonl(`${JSON.stringify(record())}\n\n${JSON.stringify(lost())}\n`);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.included));
});

test('filterRecords applies included, debug, source, mode and build filters', () => {
  const rs = [record(), record({ matchId: 'x', included: false }), record({ matchId: 'd', debugUsed: true }), record({ matchId: 's', source: 'selfplay' })];
  assert.deepEqual(filterRecords(rs, { sources: ['human'], modes: ['hotseat'] }).map(r => r.matchId), ['m1']);
  assert.equal(filterRecords(rs, { includedOnly: false, excludeDebug: false, sources: ['human', 'selfplay'], modes: ['hotseat'] }).length, 4);
  assert.equal(filterRecords(rs, { buildLabel: 'other' }).length, 0);
});

test('summarize reports seat win rates, averages and Fuel', () => {
  const byMetric = Object.fromEntries(summarize([record(), lost()]).map(r => [r.metric, r.value]));
  assert.equal(byMetric['Matches'], 2);
  assert.equal(byMetric['First player win %'], 50);
  assert.equal(byMetric['Avg rounds'], 8);
  assert.equal(byMetric['Avg match length (min)'], 10);
  assert.equal(byMetric['Avg turn length (sec)'], 60);
  assert.equal(byMetric['Avg unspent Fuel per turn'], 2);
  assert.equal(byMetric['Avg Fuel lost to cap per player per match'], 1);
});

test('damageBySource totals both players and computes shares', () => {
  assert.deepEqual(damageBySource([record(), lost()]), [
    { source: 'combat', total: 60, perMatch: 30, sharePct: 75 },
    { source: 'directHq', total: 20, perMatch: 10, sharePct: 25 },
  ]);
});

test('cardRows computes play rate, win rates and dead cards', () => {
  const [t33] = cardRows([record(), lost()], id => `name:${id}`);
  assert.equal(t33.name, 'name:T33');
  assert.equal(t33.drawn, 6);
  assert.equal(t33.played, 2);
  assert.equal(t33.playRatePct, 33.3);
  assert.equal(t33.winPctWhenPlayed, 50);
  assert.equal(t33.winPctInDeck, 50);
  assert.equal(t33.avgRoundPlayed, 3);
  assert.equal(t33.deadInHand, 4);
});

test('heroRows counts deployments, activations and win rate when deployed', () => {
  const [h07] = heroRows([record(), lost()]);
  assert.equal(h07.rosters, 4);
  assert.equal(h07.deployed, 2);
  assert.equal(h07.deployPct, 50);
  assert.equal(h07.avgDeployRound, 2);
  assert.equal(h07.activationsPerDeploy, 3);
  assert.equal(h07.winPctWhenDeployed, 50);
});

test('objective rows: seat-relative control share, backbone and winner holding at the end', () => {
  const [slot] = objectiveSlotRows([record(), lost()]);
  assert.equal(slot.slot, 'A2');
  assert.equal(slot.heldFirstPct, 75);
  assert.equal(slot.neutralPct, 25);
  assert.equal(slot.backbonePerMatch, 4);
  assert.equal(slot.winnerHeldAtEndPct, 50);
  const [o1] = objectiveCardRows([record(), lost()]);
  assert.equal(o1.cardId, 'O1');
  assert.equal(o1.fuelPerMatch, 3);
  assert.equal(o1.heldPct, 75);
  assert.equal(slotLabel('2,3'), 'D3');
});

test('trade, trigger and Craft rows', () => {
  assert.deepEqual(tradeRows([record()]), [{ attacker: 'Tank', target: 'Infantry', suppressed: 0, destroyed: 2, armorAbsorbed: 0, destroyedPerMatch: 2 }]);
  assert.deepEqual(triggerRows([record(), lost()]), [{ keyword: 'Breakthrough', cardId: 'T33', name: 'T33', count: 2, perMatch: 1 }]);
  assert.deepEqual(craftRows([record()]), [{ keyword: 'Armor', drawback: 'rotateAll', line: 'fixed 6/6/6/6', picks: 1, sharePct: 100 }]);
});

test('matchRows and toCsv escaping', () => {
  const [row] = matchRows([record({ note: 'said "hi", then left' })]);
  assert.equal(row.minutes, 10);
  const csv = toCsv([['matchId', 'Match'], ['note', 'Note']], [row]);
  assert.equal(csv, 'Match,Note\nm1,"said ""hi"", then left"');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/stats_aggregate.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `js/stats-aggregate.js`**

```js
// Pure aggregation of match records (buildMatchRecord output, js/stats.js) into table rows for
// stats.html. No DOM, no Firebase; tested in tests/stats_aggregate.test.mjs.

const ROLES = ['p1', 'p2'];
const toArray = v => (Array.isArray(v) ? v : Object.values(v ?? {}));
const sum = values => values.reduce((a, b) => a + (Number(b) || 0), 0);
const avg = (total, count) => (count > 0 ? total / count : null);
const round2 = v => (v == null ? null : Math.round(v * 100) / 100);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const isDecided = r => r.winnerSeat === 'first' || r.winnerSeat === 'second';
const seatOf = (r, role) => (role === r.firstPlayer ? 'first' : 'second');

// "1,0" (row,col) -> "A2" (the Handoff docs' column-letter + row-number labels).
export function slotLabel(key) {
  const [row, col] = String(key).split(',').map(Number);
  return Number.isInteger(row) && Number.isInteger(col) ? `${'ABCD'[col]}${row + 1}` : String(key);
}

export function recordsFromFirebase(matches, meta) {
  return Object.entries(matches ?? {})
    .map(([id, r]) => ({ ...r, matchId: r.matchId ?? id, included: meta?.[id]?.included === true, note: meta?.[id]?.note ?? '' }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

// Self-play files are deliberate test runs, so every record counts as included.
export function recordsFromJsonl(text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
    .map(line => ({ ...JSON.parse(line), included: true, note: '' }));
}

export function filterRecords(records, { includedOnly = true, excludeDebug = true, sources = ['human'], modes = null, buildLabel = '' } = {}) {
  return records.filter(r =>
    (!includedOnly || r.included) &&
    (!excludeDebug || !r.debugUsed) &&
    (!sources || sources.includes(r.source)) &&
    (!modes || modes.includes(r.mode)) &&
    (!buildLabel || r.buildLabel === buildLabel));
}

export function summarize(records) {
  const n = records.length;
  const decided = records.filter(isDecided);
  const firstWins = decided.filter(r => r.winnerSeat === 'first').length;
  const turns = records.flatMap(r => toArray(r.turns));
  const turnMs = turns.map(t => t.ms).filter(Number.isFinite);
  const durations = records.map(r => r.durationMs).filter(Number.isFinite);
  const perPlayer = field => round2(avg(sum(records.flatMap(r => ROLES.map(role => r.players?.[role]?.[field]))), n * 2));
  return [
    { metric: 'Matches', value: n },
    { metric: 'Decided (HQ destroyed)', value: decided.length },
    { metric: 'First player win %', value: pct(firstWins, decided.length) },
    { metric: 'Second player win %', value: pct(decided.length - firstWins, decided.length) },
    { metric: 'Avg rounds', value: round2(avg(sum(records.map(r => r.rounds)), n)) },
    { metric: 'Avg match length (min)', value: durations.length ? round2(sum(durations) / durations.length / 60000) : null },
    { metric: 'Avg turn length (sec)', value: turnMs.length ? round2(sum(turnMs) / turnMs.length / 1000) : null },
    { metric: 'Avg unspent Fuel per turn', value: round2(avg(sum(turns.map(t => t.fuelUnspent)), turns.length)) },
    { metric: 'Avg Fuel lost to cap per player per match', value: perPlayer('fuelLostToCap') },
    { metric: 'Avg Direct HQ unit conversions per player per match', value: perPlayer('directHqUnits') },
  ];
}

export function damageBySource(records) {
  const totals = {};
  for (const r of records) {
    for (const role of ROLES) {
      for (const [source, amount] of Object.entries(r.players?.[role]?.hqDamageTaken ?? {})) {
        totals[source] = (totals[source] ?? 0) + amount;
      }
    }
  }
  const all = sum(Object.values(totals));
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([source, total]) => ({ source, total, perMatch: round2(avg(total, records.length)), sharePct: pct(total, all) }));
}

export function cardRows(records, cardName = id => id) {
  const rows = {};
  const row = id => rows[id] ?? (rows[id] = {
    cardId: id, inDecks: 0, copies: 0, drawn: 0, played: 0, deadInHand: 0, roundSum: 0, fuelSpent: 0,
    decidedInDeck: 0, winsInDeck: 0, decidedPlayed: 0, winsPlayed: 0,
  });
  for (const r of records) {
    const decided = isDecided(r);
    for (const role of ROLES) {
      for (const [id, c] of Object.entries(r.players?.[role]?.cards ?? {})) {
        const x = row(id);
        x.copies += c.copies ?? 0;
        x.drawn += c.drawn ?? 0;
        x.played += c.played ?? 0;
        x.deadInHand += c.inHandAtEnd ?? 0;
        x.roundSum += c.roundSum ?? 0;
        x.fuelSpent += c.fuelSpent ?? 0;
        if ((c.copies ?? 0) > 0) {
          x.inDecks++;
          if (decided) { x.decidedInDeck++; if (r.winner === role) x.winsInDeck++; }
        }
        if ((c.played ?? 0) > 0 && decided) { x.decidedPlayed++; if (r.winner === role) x.winsPlayed++; }
      }
    }
  }
  return Object.values(rows).map(x => ({
    cardId: x.cardId,
    name: cardName(x.cardId),
    inDecks: x.inDecks,
    copies: x.copies,
    drawn: x.drawn,
    played: x.played,
    playRatePct: pct(x.played, x.drawn),
    winPctInDeck: pct(x.winsInDeck, x.decidedInDeck),
    winPctWhenPlayed: pct(x.winsPlayed, x.decidedPlayed),
    avgRoundPlayed: round2(avg(x.roundSum, x.played)),
    avgFuel: round2(avg(x.fuelSpent, x.played)),
    deadInHand: x.deadInHand,
  })).sort((a, b) => b.played - a.played);
}

export function heroRows(records, cardName = id => id) {
  const rows = {};
  const row = id => rows[id] ?? (rows[id] = { heroId: id, rosters: 0, deployed: 0, deployRoundSum: 0, activations: 0, fuelSpent: 0, decidedDeployed: 0, winsDeployed: 0 });
  for (const r of records) {
    const decided = isDecided(r);
    for (const role of ROLES) {
      const p = r.players?.[role] ?? {};
      for (const id of toArray(p.heroRoster)) row(id).rosters++;
      for (const [id, h] of Object.entries(p.heroes ?? {})) {
        const x = row(id);
        if (h.deployedRound != null) {
          x.deployed++;
          x.deployRoundSum += h.deployedRound;
          if (decided) { x.decidedDeployed++; if (r.winner === role) x.winsDeployed++; }
        }
        x.activations += h.activations ?? 0;
        x.fuelSpent += h.fuelSpent ?? 0;
      }
    }
  }
  return Object.values(rows).map(x => ({
    heroId: x.heroId,
    name: cardName(x.heroId),
    rosters: x.rosters,
    deployed: x.deployed,
    deployPct: pct(x.deployed, x.rosters),
    avgDeployRound: round2(avg(x.deployRoundSum, x.deployed)),
    activations: x.activations,
    activationsPerDeploy: round2(avg(x.activations, x.deployed)),
    avgFuelPerActivation: round2(avg(x.fuelSpent, x.activations)),
    winPctWhenDeployed: pct(x.winsDeployed, x.decidedDeployed),
  })).sort((a, b) => b.deployed - a.deployed);
}

export function objectiveSlotRows(records, mapName = id => id) {
  const rows = {};
  for (const r of records) {
    for (const [slot, o] of Object.entries(r.objectives ?? {})) {
      const key = `${r.mapId}|${slot}`;
      const x = rows[key] ?? (rows[key] = { map: mapName(r.mapId), slot: slotLabel(slot), matches: 0, first: 0, second: 0, none: 0, backbone: 0, decided: 0, winnerHeld: 0 });
      x.matches++;
      for (const role of ROLES) {
        x[seatOf(r, role)] += o.turnsHeld?.[role] ?? 0;
        x.backbone += o.backbone?.[role] ?? 0;
      }
      x.none += o.turnsHeld?.none ?? 0;
      if (isDecided(r)) { x.decided++; if (o.heldAtEnd === r.winner) x.winnerHeld++; }
    }
  }
  return Object.values(rows).map(x => {
    const turns = x.first + x.second + x.none;
    return {
      map: x.map,
      slot: x.slot,
      matches: x.matches,
      heldFirstPct: pct(x.first, turns),
      heldSecondPct: pct(x.second, turns),
      neutralPct: pct(x.none, turns),
      backbonePerMatch: round2(avg(x.backbone, x.matches)),
      winnerHeldAtEndPct: pct(x.winnerHeld, x.decided),
    };
  }).sort((a, b) => String(a.map).localeCompare(String(b.map)) || a.slot.localeCompare(b.slot));
}

export function objectiveCardRows(records, cardName = id => id) {
  const rows = {};
  for (const r of records) {
    for (const o of Object.values(r.objectives ?? {})) {
      const x = rows[o.cardId] ?? (rows[o.cardId] = { cardId: o.cardId, matches: 0, activations: 0, backbone: 0, fuel: 0, draws: 0, held: 0, turns: 0, decided: 0, winnerHeld: 0 });
      x.matches++;
      x.activations += sum(Object.values(o.activations ?? {}));
      x.backbone += sum(Object.values(o.backbone ?? {}));
      x.fuel += sum(Object.values(o.fuel ?? {}));
      x.draws += sum(Object.values(o.draws ?? {}));
      x.held += (o.turnsHeld?.p1 ?? 0) + (o.turnsHeld?.p2 ?? 0);
      x.turns += sum(Object.values(o.turnsHeld ?? {}));
      if (isDecided(r)) { x.decided++; if (o.heldAtEnd === r.winner) x.winnerHeld++; }
    }
  }
  return Object.values(rows).map(x => ({
    cardId: x.cardId,
    name: cardName(x.cardId),
    matches: x.matches,
    activationsPerMatch: round2(avg(x.activations, x.matches)),
    backbonePerMatch: round2(avg(x.backbone, x.matches)),
    fuelPerMatch: round2(avg(x.fuel, x.matches)),
    drawsPerMatch: round2(avg(x.draws, x.matches)),
    heldPct: pct(x.held, x.turns),
    winnerHeldAtEndPct: pct(x.winnerHeld, x.decided),
  })).sort((a, b) => a.cardId.localeCompare(b.cardId));
}

export function tradeRows(records) {
  const rows = {};
  for (const r of records) {
    for (const role of ROLES) {
      for (const [attacker, targets] of Object.entries(r.players?.[role]?.trades ?? {})) {
        for (const [target, result] of Object.entries(targets)) {
          const x = rows[`${attacker}|${target}`] ?? (rows[`${attacker}|${target}`] = { attacker, target, suppressed: 0, destroyed: 0, armorAbsorbed: 0 });
          x.suppressed += result.suppressed ?? 0;
          x.destroyed += result.destroyed ?? 0;
          x.armorAbsorbed += result.armorAbsorbed ?? 0;
        }
      }
    }
  }
  return Object.values(rows)
    .map(x => ({ ...x, destroyedPerMatch: round2(avg(x.destroyed, records.length)) }))
    .sort((a, b) => b.destroyed - a.destroyed);
}

export function triggerRows(records, cardName = id => id) {
  const rows = {};
  for (const r of records) {
    for (const role of ROLES) {
      for (const [keyword, byCard] of Object.entries(r.players?.[role]?.triggers ?? {})) {
        for (const [cardId, count] of Object.entries(byCard)) {
          const x = rows[`${keyword}|${cardId}`] ?? (rows[`${keyword}|${cardId}`] = { keyword, cardId, count: 0 });
          x.count += count;
        }
      }
    }
  }
  return Object.values(rows)
    .map(x => ({ keyword: x.keyword, cardId: x.cardId, name: cardName(x.cardId), count: x.count, perMatch: round2(avg(x.count, records.length)) }))
    .sort((a, b) => b.count - a.count);
}

export function craftRows(records) {
  const picks = records.flatMap(r => ROLES.flatMap(role => toArray(r.players?.[role]?.craftPicks)));
  const rows = {};
  for (const p of picks) {
    const line = p.fixedLine ? 'fixed 6/6/6/6' : 'random';
    const key = `${p.keyword}|${p.drawback}|${line}`;
    const x = rows[key] ?? (rows[key] = { keyword: p.keyword, drawback: p.drawback, line, picks: 0 });
    x.picks++;
  }
  return Object.values(rows)
    .map(x => ({ ...x, sharePct: pct(x.picks, picks.length) }))
    .sort((a, b) => b.picks - a.picks);
}

export function matchRows(records, mapName = id => id) {
  return records.map(r => ({
    matchId: r.matchId,
    date: r.startedAt ? new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ') : '',
    mode: r.mode,
    source: r.source,
    build: r.buildLabel,
    map: mapName(r.mapId),
    winnerSeat: r.winnerSeat,
    endReason: r.endReason,
    rounds: r.rounds,
    minutes: Number.isFinite(r.durationMs) ? round2(r.durationMs / 60000) : null,
    debugUsed: r.debugUsed ? 'yes' : '',
    included: r.included ? 'yes' : '',
    note: r.note ?? '',
  }));
}

// columns: [[key, label], ...]
export function toCsv(columns, rows) {
  const cell = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.map(([, label]) => cell(label)).join(','),
    ...rows.map(row => columns.map(([key]) => cell(row[key])).join(',')),
  ].join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/stats_aggregate.test.mjs`
Expected: all pass. If a number is off, fix the aggregation, not the expected value, unless the fixture arithmetic in the test comment is wrong.

- [ ] **Step 5: Commit**

```bash
git status
git add js/stats-aggregate.js tests/stats_aggregate.test.mjs
git commit -m "Add pure aggregation for the statistics page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 12: `stats.html` and `js/stats-page.js`

**Files:**
- Create: `stats.html`, `js/stats-page.js`
- Modify: `css/game.css`, `tests/module_identity.test.mjs`

- [ ] **Step 1: Cover the new page in the cache-version test** (`tests/module_identity.test.mjs`)

Replace:

```js
  'showroom.html',
```

with:

```js
  'showroom.html',
  'stats.html',
```

Run: `node --test tests/module_identity.test.mjs`
Expected: FAIL (`stats.html` doesn't exist yet: ENOENT).

- [ ] **Step 2: Create `stats.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SIGNAL — Statistics</title>
  <link rel="stylesheet" href="css/game.css?v=2026090402">
</head>
<body>
  <script>(function(){try{if(localStorage.getItem('signal-theme')==='light')document.body.dataset.theme='light';}catch(e){}})();</script>
  <button id="theme-toggle" class="theme-toggle">☾ LIGHT</button>

  <div class="stats-page">
    <div class="db-header">
      <div>
        <div class="lobby-title" style="font-size:30px;">STATISTICS</div>
        <div class="lobby-subtitle" id="stats-count">LOADING…</div>
      </div>
      <button class="btn btn-secondary" id="stats-back">Main Menu</button>
    </div>

    <div class="stats-filters">
      <label><input type="checkbox" id="f-included" checked> Included only</label>
      <label><input type="checkbox" id="f-exclude-debug" checked> Exclude debug-panel matches</label>
      <span>SOURCE</span>
      <label><input type="checkbox" name="f-source" value="human" checked> Human</label>
      <label><input type="checkbox" name="f-source" value="selfplay"> Bot self-play</label>
      <span>MODE</span>
      <label><input type="checkbox" name="f-mode" value="online" checked> Online</label>
      <label><input type="checkbox" name="f-mode" value="vsAi" checked> vs AI</label>
      <label><input type="checkbox" name="f-mode" value="hotseat" checked> Local</label>
      <label>BUILD <select id="f-build"><option value="">All</option></select></label>
      <button class="btn btn-secondary" id="stats-reload">Reload from Firebase</button>
      <label class="btn btn-secondary">Load self-play file<input type="file" id="f-file" accept=".jsonl,.txt" hidden></label>
    </div>
    <div class="stats-status" id="stats-status"></div>
    <div id="stats-sections"></div>
  </div>

  <script type="module" src="./js/stats-page.js?v=2026090402"></script>
</body>
</html>
```

- [ ] **Step 3: Create `js/stats-page.js`**

```js
// Statistics page (stats.html). Loads match records + include/note settings from Firebase, or a
// local self-play .jsonl file; filters them; renders one sortable table per question, each with a
// CSV export for Google Sheets. All the math is in stats-aggregate.js (pure, unit-tested).
import { fetchStatsData, writeMatchMeta } from './firebase.js?v=2026090402';
import { CARD_BY_ID } from './cards.js?v=2026090402';
import { MAPS } from './maps.js?v=2026090402';
import {
  recordsFromFirebase, recordsFromJsonl, filterRecords, summarize, damageBySource, cardRows,
  heroRows, objectiveSlotRows, objectiveCardRows, tradeRows, triggerRows, craftRows, matchRows, toCsv,
} from './stats-aggregate.js?v=2026090402';

const cardName = id => CARD_BY_ID[id]?.name ?? id;
const mapName = id => MAPS[id]?.name ?? id;

let allRecords = [];
let dataSource = 'firebase'; // 'firebase' | 'file'

const SECTIONS = [
  { id: 'summary', title: 'Summary', rows: rs => summarize(rs),
    columns: [['metric', 'Metric'], ['value', 'Value']] },
  { id: 'damage', title: 'HQ damage by source', rows: rs => damageBySource(rs),
    columns: [['source', 'Source'], ['total', 'Total'], ['perMatch', 'Per match'], ['sharePct', 'Share %']] },
  { id: 'cards', title: 'Cards', rows: rs => cardRows(rs, cardName),
    columns: [['cardId', 'ID'], ['name', 'Card'], ['inDecks', 'Decks'], ['copies', 'Copies'], ['drawn', 'Drawn'], ['played', 'Played'], ['playRatePct', 'Play % of drawn'], ['winPctInDeck', 'Win % in deck'], ['winPctWhenPlayed', 'Win % when played'], ['avgRoundPlayed', 'Avg round played'], ['avgFuel', 'Avg Fuel'], ['deadInHand', 'Dead in hand']] },
  { id: 'heroes', title: 'Heroes', rows: rs => heroRows(rs, cardName),
    columns: [['heroId', 'ID'], ['name', 'Hero'], ['rosters', 'In rosters'], ['deployed', 'Deployed'], ['deployPct', 'Deploy %'], ['avgDeployRound', 'Avg deploy round'], ['activations', 'Activations'], ['activationsPerDeploy', 'Activations per deploy'], ['avgFuelPerActivation', 'Avg Fuel per activation'], ['winPctWhenDeployed', 'Win % when deployed']] },
  { id: 'objective-slots', title: 'Objectives by map slot', rows: rs => objectiveSlotRows(rs, mapName),
    columns: [['map', 'Map'], ['slot', 'Slot'], ['matches', 'Matches'], ['heldFirstPct', 'Held by first player %'], ['heldSecondPct', 'Held by second player %'], ['neutralPct', 'Neutral %'], ['backbonePerMatch', 'Backbone damage per match'], ['winnerHeldAtEndPct', 'Winner held at end %']] },
  { id: 'objective-cards', title: 'Objectives by card', rows: rs => objectiveCardRows(rs, cardName),
    columns: [['cardId', 'ID'], ['name', 'Objective'], ['matches', 'Matches'], ['activationsPerMatch', 'Activations per match'], ['backbonePerMatch', 'Backbone per match'], ['fuelPerMatch', 'Fuel per match'], ['drawsPerMatch', 'Draws per match'], ['heldPct', 'Held %'], ['winnerHeldAtEndPct', 'Winner held at end %']] },
  { id: 'trades', title: 'Unit trades (hits dealt)', rows: rs => tradeRows(rs),
    columns: [['attacker', 'Attacker'], ['target', 'Target class'], ['suppressed', 'Suppressed'], ['destroyed', 'Destroyed'], ['armorAbsorbed', 'Armor absorbed'], ['destroyedPerMatch', 'Destroyed per match']] },
  { id: 'triggers', title: 'Keyword triggers', rows: rs => triggerRows(rs, cardName),
    columns: [['keyword', 'Keyword'], ['cardId', 'ID'], ['name', 'Card'], ['count', 'Count'], ['perMatch', 'Per match']] },
  { id: 'craft', title: 'Craft picks', rows: rs => craftRows(rs),
    columns: [['keyword', 'Keyword'], ['drawback', 'Drawback'], ['line', 'Stat line'], ['picks', 'Picks'], ['sharePct', 'Share %']] },
];

const MATCH_COLUMNS = [['date', 'Date (UTC)'], ['mode', 'Mode'], ['source', 'Source'], ['build', 'Build'], ['map', 'Map'], ['winnerSeat', 'Winner seat'], ['endReason', 'End'], ['rounds', 'Rounds'], ['minutes', 'Minutes'], ['debugUsed', 'Debug'], ['included', 'Included'], ['note', 'Note'], ['matchId', 'Match ID']];

const compare = (a, b) => {
  if (a == null || a === '') return -1;
  if (b == null || b === '') return 1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
};

function setStatus(text) {
  document.getElementById('stats-status').textContent = text;
}

function currentFilters() {
  const checked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
  return {
    includedOnly: document.getElementById('f-included').checked,
    excludeDebug: document.getElementById('f-exclude-debug').checked,
    sources: checked('f-source'),
    modes: checked('f-mode'),
    buildLabel: document.getElementById('f-build').value,
  };
}

function downloadCsv(name, columns, rows) {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `signal-stats-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// cellFor(row, key) may return a DOM node (for editable cells); otherwise the value is shown as text.
function renderTable(container, columns, rows, cellFor = null, sort = null) {
  const sorted = sort
    ? [...rows].sort((a, b) => compare(a[sort.key], b[sort.key]) * (sort.dir === 'desc' ? -1 : 1))
    : rows;
  const table = document.createElement('table');
  table.className = 'stats-table';
  const head = table.createTHead().insertRow();
  for (const [key, label] of columns) {
    const th = document.createElement('th');
    th.textContent = sort?.key === key ? `${label} ${sort.dir === 'desc' ? '▼' : '▲'}` : label;
    th.addEventListener('click', () => {
      const dir = sort?.key === key && sort.dir === 'desc' ? 'asc' : 'desc';
      renderTable(container, columns, rows, cellFor, { key, dir });
    });
    head.appendChild(th);
  }
  const body = table.createTBody();
  for (const row of sorted) {
    const tr = body.insertRow();
    for (const [key] of columns) {
      const td = tr.insertCell();
      const custom = cellFor?.(row, key);
      if (custom) td.appendChild(custom);
      else td.textContent = row[key] ?? '';
    }
  }
  if (!sorted.length) {
    const td = body.insertRow().insertCell();
    td.colSpan = columns.length;
    td.textContent = 'No matches for the current filters.';
  }
  container.replaceChildren(table);
}

function sectionShell(id, title, onCsv) {
  const section = document.createElement('section');
  section.className = 'stats-section';
  section.id = `section-${id}`;
  const header = document.createElement('div');
  header.className = 'stats-section-header';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary';
  btn.textContent = 'CSV';
  btn.addEventListener('click', onCsv);
  header.append(h2, btn);
  const body = document.createElement('div');
  body.className = 'stats-table-wrap';
  section.append(header, body);
  return { section, body };
}

// Include/note are editable here too, so a forgotten tick on the end screen can be fixed later.
function saveMeta(record) {
  setStatus('Saving…');
  writeMatchMeta(record.matchId, { included: record.included, note: record.note, updatedAt: Date.now() })
    .then(() => { setStatus('Saved.'); render(); })
    .catch(err => setStatus(`Could not save: ${err.message}`));
}

function matchCell(row, key) {
  if (dataSource !== 'firebase') return null;
  const record = allRecords.find(r => r.matchId === row.matchId);
  if (!record) return null;
  if (key === 'included') {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = record.included;
    box.addEventListener('change', () => { record.included = box.checked; saveMeta(record); });
    return box;
  }
  if (key === 'note') {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 300;
    input.value = record.note;
    input.addEventListener('change', () => { record.note = input.value.trim(); saveMeta(record); });
    return input;
  }
  return null;
}

function populateBuildFilter() {
  const select = document.getElementById('f-build');
  const current = select.value;
  const labels = [...new Set(allRecords.map(r => r.buildLabel).filter(Boolean))].sort().reverse();
  select.replaceChildren(new Option('All', ''), ...labels.map(l => new Option(l, l)));
  select.value = labels.includes(current) ? current : '';
}

function render() {
  const filters = currentFilters();
  const records = filterRecords(allRecords, filters);
  document.getElementById('stats-count').textContent =
    `${records.length} OF ${allRecords.length} MATCHES · ${dataSource === 'file' ? 'SELF-PLAY FILE' : 'FIREBASE'}`;
  const root = document.getElementById('stats-sections');
  root.replaceChildren();
  for (const s of SECTIONS) {
    const rows = s.rows(records);
    const { section, body } = sectionShell(s.id, s.title, () => downloadCsv(s.id, s.columns, rows));
    renderTable(body, s.columns, rows);
    root.appendChild(section);
  }
  // The match list ignores "Included only" so unticked matches can be found and ticked.
  const listed = filterRecords(allRecords, { ...filters, includedOnly: false });
  const rows = matchRows(listed, mapName);
  const { section, body } = sectionShell('matches', 'Matches', () => downloadCsv('matches', MATCH_COLUMNS, rows));
  renderTable(body, MATCH_COLUMNS, rows, matchCell);
  root.appendChild(section);
}

async function loadFirebase() {
  setStatus('Loading from Firebase…');
  try {
    const { matches, meta } = await fetchStatsData();
    allRecords = recordsFromFirebase(matches, meta);
    dataSource = 'firebase';
    populateBuildFilter();
    render();
    setStatus('');
  } catch (err) {
    console.error('[stats] load failed', err);
    setStatus(`Could not load statistics: ${err.message}`);
  }
}

document.getElementById('f-file').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    allRecords = recordsFromJsonl(await file.text());
    dataSource = 'file';
    document.querySelector('input[name="f-source"][value="selfplay"]').checked = true;
    populateBuildFilter();
    render();
    setStatus(`Loaded ${file.name}.`);
  } catch (err) {
    setStatus(`Could not read ${file.name}: ${err.message}`);
  }
  e.target.value = '';
});

document.querySelectorAll('.stats-filters input[type="checkbox"], #f-build')
  .forEach(el => el.addEventListener('change', render));
document.getElementById('stats-reload').addEventListener('click', loadFirebase);
document.getElementById('stats-back').addEventListener('click', () => { window.location.href = 'index.html'; });

(function initTheme() {
  const btn = document.getElementById('theme-toggle');
  btn.textContent = document.body.dataset.theme === 'light' ? '☀ DARK' : '☾ LIGHT';
  btn.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    document.body.dataset.theme = next;
    try { localStorage.setItem('signal-theme', next); } catch {}
    btn.textContent = next === 'light' ? '☀ DARK' : '☾ LIGHT';
  });
})();

loadFirebase();
```

- [ ] **Step 4: Styles** (`css/game.css`)

Insert directly above the line `/* ── Light mode explicit overrides (E theme from color_preview.html) ── */`:

```css
/* ── Statistics page (stats.html) ── */
.stats-page { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
.stats-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin: 16px 0 8px; font-size: 12px; letter-spacing: 1px; font-family: 'Arial Narrow', Arial, sans-serif; }
.stats-filters label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.stats-filters select { background: var(--bg); color: inherit; border: 1px solid var(--end-sub); padding: 3px 6px; }
.stats-status { min-height: 16px; font-size: 12px; color: var(--end-sub); }
.stats-section { margin-top: 28px; }
.stats-section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.stats-section-header h2 { margin: 0; font-size: 14px; letter-spacing: 3px; color: var(--gold); font-family: 'Arial Narrow', Arial, sans-serif; }
.stats-table-wrap { margin-top: 8px; overflow-x: auto; }
.stats-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.stats-table th, .stats-table td { padding: 4px 8px; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--end-sub); }
.stats-table th { cursor: pointer; user-select: none; }
.stats-table input[type="text"] { width: 220px; background: var(--bg); color: inherit; border: 1px solid var(--end-sub); padding: 2px 4px; }
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass (module_identity now covers `stats.html` and `js/stats-page.js` / `js/stats-aggregate.js`).

- [ ] **Step 6: Commit**

```bash
git status
git add stats.html js/stats-page.js css/game.css tests/module_identity.test.mjs
git commit -m "Add Statistics page with filters, tables, CSV export and include/note editing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 13: Main menu link, verification, docs

**Files:**
- Modify: `index.html`, `js/lobby-browser.js`, `STATUS.md`, `CHANGELOG.md`

- [ ] **Step 1: Menu tile** (`index.html`)

Replace:

```html
      <div class="deck-option" id="btn-ai">
        <div class="deck-name">vs AI</div>
        <div class="deck-flavor">Play solo against the bot. You control P1; the bot plays P2 automatically.</div>
      </div>
```

with:

```html
      <div class="deck-option" id="btn-ai">
        <div class="deck-name">vs AI</div>
        <div class="deck-flavor">Play solo against the bot. You control P1; the bot plays P2 automatically.</div>
      </div>
      <div class="deck-option" id="btn-stats">
        <div class="deck-name">Statistics</div>
        <div class="deck-flavor">Balance data from finished matches. Filter, sort, export to CSV.</div>
      </div>
```

- [ ] **Step 2: Click handler** (`js/lobby-browser.js`)

Replace:

```js
document.getElementById('btn-deckbuilder').addEventListener('click', () => {
  window.location.href = 'deckbuilder.html';
```

with:

```js
document.getElementById('btn-stats').addEventListener('click', () => {
  window.location.href = 'stats.html';
});

document.getElementById('btn-deckbuilder').addEventListener('click', () => {
  window.location.href = 'deckbuilder.html';
```

- [ ] **Step 3: Verify in the browser** (dev server running)

1. `http://localhost:3000/index.html` → Statistics tile opens `stats.html`.
2. With default filters the Task 10 test match is hidden (debug used). Untick "Exclude debug-panel matches": it appears in every table.
3. Matches table: untick/tick "Included" and edit the note → "Saved." → Reload from Firebase → the change persisted.
4. Click a column header twice: sorts descending then ascending.
5. Click CSV on the Cards section, open the file in Google Sheets: columns line up, notes with commas stay in one cell.
6. "Load self-play file" → pick `selfplay_stats.jsonl` from Task 10 → tables fill, header says SELF-PLAY FILE.
7. Toggle the theme button: page stays readable in light mode.

- [ ] **Step 4: Docs**

`STATUS.md` "Match statistics" section: add the Statistics page (main menu → Statistics), what each table answers, CSV export, self-play file loading. `CHANGELOG.md`: newest-first entry "2026-09-XX — Statistics page".

- [ ] **Step 5: Run tests and commit**

Run: `npm test`
Expected: all pass.

```bash
git status
git add index.html js/lobby-browser.js STATUS.md CHANGELOG.md
git commit -m "Link the Statistics page from the main menu, document it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Known limits (accepted, documented in STATUS.md)

- Abandoned matches (tab closed, Exit mid-game) produce no record.
- Turn duration is measured on the acting client's clock and includes Hero deploy modal time. A turn this client didn't see start has no `ms`.
- `turnsPlayed` is the turn counter when the game ended; after a lethal Direct HQ it already counts the next turn.
- Win rates only count decided matches (HQ destroyed); disconnects are excluded from win %.
- Build label is manual (`STATS_BUILD_LABEL`); the rules hash only catches card/map data changes.
- Firebase reads download every record; fine to a few thousand matches, revisit if the page gets slow.
