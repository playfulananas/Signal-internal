# SIGNAL Digital Prototype — Living Architecture Doc

**Purpose:** Every contributor or coding agent reads this before starting a task and updates it
after completing one. This is the single source of truth for how the codebase is structured. The
DEVPLAN tells you *what* to build; this doc tells you *how* things are built so far.

**Rule:** If you write code that contradicts something in this doc, update this doc. If something here is wrong, fix it here. Never silently drift.

**Doc set (updated 2026-09-02):** `STATUS.md` is the current-state implementation summary
(edited in place, no history); `CHANGELOG.md` is the append-only detailed history; this file is
the code-structure reference, with its own terse Session Log below for quick module-level
orientation. Put current facts in STATUS.md, structure here, and narrative history in
CHANGELOG.md.

---

## Session Log

| Session | Date | What changed |
|---|---|---|
| 1 | 2026-07-01 | Created digital/ subfolder, DEVPLAN.md, ARCHITECTURE.md, cards.js |
| 2 | 2026-07-01 | Created state.js — game state model and pure transition functions |
| 3 | 2026-07-01 | Created combat.js — resolveDeployment, adjacentTiles, Bombard targeting |
| 4 | 2026-07-01 | Created game.html, game.css, ui.js — board UI, hand display, placement and combat flow |
| 5 | 2026-07-01 | Fixed combat mechanic — single-target attacks, targeting UI state machine, destroyed units removed from board |
| 6 | 2026-07-01 | Google Sheet "SIGNAL — Deck Builder & Config" (ID: 1uYwR8_s8P1iSupFgEHEVG2MCXD4tc8Zjz1gei5TO1Us): ROSTER (74 cards), CONFIG (game params), DECK_Aggro/Control/Power (25-slot VLOOKUP tabs + starter decks) |
| 7 | 2026-07-01 | Deck selection lobby screen — 3 starter decks (Blitzkrieg/Defensive Line/Iron Fist), P1 then P2 each pick before game starts; game state initialized with chosen deck IDs |
| 8 | 2026-07-01 | Map selection + terrain — maps.js with 5 maps (Normandy/Stalingrad/El Alamein/Ardennes/Kursk); terrain rules: Forest=no Tanks, Water=Naval+Aircraft+Airborne only; objectives placed randomly from pool at game start |
| 9 | 2026-07-01 | Objective control + effects — majority-adjacent rule (checkObjectiveControl in state.js), effects applied at start of each turn (applyObjectiveEffects in game.html), hover tooltip shows all 4 levels with current highlighted |
| 10 | 2026-07-01 | Firebase multiplayer — create/join lobby (index.html + lobby.js), deck + map picker, real-time sync via pushState/subscribeState; normalizeFirebaseState handles array reconstruction |
| 11 | 2026-07-02 | Commands + missions fully implemented — all 20 commands and 9 missions wired in game.js; uiState machine extended with 'command-targeting', 'arty-targeting', 'fo-select' modes |
| 12 | 2026-07-02 | P2 board flip + direction fix — renderBoard accepts flip param (rows/cols iterated in reverse for P2); getSideValue applies P2_FLIP so P2's card.n fires against actual South; buildBoardCard swaps N↔S/E↔W display for opponent cards |
| 13 | 2026-07-02 | Cache busting — all ES module imports carry ?v=TIMESTAMP; pre-commit hook auto-bumps all ?v= values in game.html and all js/ files on every commit |
| 14 | 2026-07-02 | Objective placement changed from hardcoded corners to random middle-row flanks (rows 1/2, cols 0 and 3) |
| 15 | 2026-07-02 | Starter decks updated: Iron Fist replaced with Blitz Breaker (counter-aggro, 40 AP, Guard + Armor wall + full draw engine) |
| 16 | 2026-07-02 | Double Attack nerf: all 5 DA cards -2 total stats (Tank Hunter, Dive Bomber, Ace Pilot, Storm Squad, Shock Troopers) |
| 17 | 2026-07-06 to 07-08 | Debug panel — full CRUD over live game state (add card, Fuel, HQ, objective control/level, unit state, buff, draw cards, skip-to-turn); `js/debug.js` (pure) + wiring in `game.js`; end-to-end smoke test |
| 18 | 2026-07-08 to 07-21 | Deck builder — pool/build/validate/save UI (`deckbuilder.html`, `js/deckbuilder.js`), deck rules module (`js/decks.js`: `STARTER_DECKS`, `validateDeck`, copy-limit enforcement), custom decks synced to Firebase per anonymous identity; open lobby browser — host/browse/join without a code (`js/lobby-browser.js` + pure helpers in `js/lobbies.js`), replacing the old code-only `index.html`/`lobby.js` flow referenced below |
| 19 | 2026-07-21 to 07-30 | Bot AI + self-play harness for automated regression testing — `js/bot_ai.js` (pure move scoring, reused by both the in-page bot and the Playwright harness) + `js/bot_player.js` (in-page "vs AI" turn driver) + root-level `selfplay_test.mjs`/`selfplay_vs_ai_smoke.mjs`; Missions retired in the v0.4 balance pass (all mission cards flagged `retired:true` in `cards.js`), deck size fixed at exactly 30 cards |
| 20 | 2026-08-01 to 08-13 | Hero Command Layer — 4-slot hero roster/zones per player (`heroZones` indexed by board column), Activated + Passive hero powers, Hero Phase turn logic tied to the objective escalation schedule (L1-L4 = all 4 roster Heroes), hero roster selection wired into the deck builder. See the "Hero Command Layer" section below. |
| 21 | 2026-08-14 | Fixed P2 board-card stat display bug — removed the owner-based P2_FLIP from `getSideValue` (state.js) and the matching opponent-viewer swap from `buildBoardCard` (ui.js). Both were the other half of session 12's per-viewer board rotation, whose visual half was reverted 2026-07-30; left in place, they silently swapped a P2 unit's N/S and E/W the instant it was placed, mismatching what was just shown in hand. Also retired Hero Combined Arms General (109). |
| 22 | 2026-08-14 | Empty-Board HQ Strike (GDD Locked Decision) — `canStrikeHQDirectly`/`resolveEmptyBoardStrike` in `combat.js`, wired into all 3 places a unit's attack can resolve in `game.js` (idle click, post-placement auto-target, Double Attack's 2nd-hit re-entry — the last of which also fixes a pre-existing bug where a Double Attack unit's 2nd hit was silently lost if the 1st hit emptied the board). `bot_ai.js`/`bot_player.js`/`selfplay_test.mjs` updated so the bot actually uses it. See `tests/empty_board_hq_strike.test.mjs`. |
| 23 | 2026-08-31 | **Run 1 — Set 1 truth-lock migration.** Full card pool replaced (65 Units/25 Heroes/35 Commands/5 Objectives, string ids), Naval class and Deathrattle cut (archived), Guard rewritten, Direct HQ built to replace the old reactive Empty-Board HQ Strike, shared destruction chain, Blast/Barrage/Rally/Inspire/Muster/Last Stand/Breakthrough/Maneuver/Escalate/Craft all newly built. See STATUS.md for full detail — this table row exists mainly to keep the log continuous; Run 1's narrative lives in STATUS.md/CLAUDE.md, not here. |
| 24 | 2026-08-31 | **Run 2 — Maps/Objectives migration**, same day, separate pass, against doc 04 (Objectives & Maps Truth). Normandy + Midway cut (archived in `maps.js`'s new `ARCHIVED_MAPS`); Stalingrad/Kursk/El Alamein/Ardennes kept with corrected objective-slot geometry; all water/Naval terrain code removed. `applyObjectiveEffects` (game.js) rewired from dead pre-Run-1 numeric-id code to the live O1-O5 scheme — this was the actual bug: every Objective had done nothing at all since Run 1 shipped. Universal 1/1/2/2 HQ backbone, fixed column-major multi-objective resolution order with lethal-stop, and all 5 objectives' L1-L4 secondary effects now execute for real. `discountFor` gained an `appliesTo: 'unit'` dimension. Objective identities now randomize after mulligan, not before. `tests/maps.test.mjs` rewritten for the 4-map reality. |
| 25 | 2026-09-02 | **Internal stability/architecture pass.** Standardized browser module identity and string IDs; made BoardUnit attack counters the sole attack authority; locked conflicting actions during pending choices; routed suppression reactions through ordered events; added CI and browser smoke jobs; removed retired runtime paths; added revision-checked Firebase gameplay writes; separated permanent/timed bonuses; and gave each deployed Unit a stable instance ID. |

*(Session Log entries above are milestone summaries, not one-per-commit — see `git log` for full commit-level history.)*

---

## Module Map

| File | Exports | Depends on |
|---|---|---|
| `js/cards.js` | `CARDS`, `CARD_BY_ID` | nothing |
| `js/maps.js` | `MAPS` (4 live maps), `ARCHIVED_MAPS` (Normandy/Midway, cut Run 2), `getTerrain`, `canPlaceOnTerrain` | nothing |
| `js/state.js` | see State API below | `cards.js` |
| `js/combat.js` | see Combat API below (incl. Hero passives — see below) | `cards.js`, `state.js` |
| `js/interaction.js` | `getInteractionDecision`, `canCancelInteraction` — pure pending-action/choice locks | nothing |
| `js/sync.js` | `stateRevision`, `prepareVersionedState`, `shouldAcceptRemoteState`, `normalizeRemoteUnit`, `normalizeRemoteBoard` — pure online revision and compatibility helpers | nothing |
| `js/ui.js` | see UI API below | `cards.js`, `state.js`, `maps.js` |
| `js/firebase.js` | see Firebase API below, including revision-checked gameplay transactions | Firebase SDK (CDN) |
| `js/debug.js` | `debugAddCard`, `debugSetFuel`, `debugAdjustFuel`, `debugSetHQ`, `debugAdjustHQ`, `debugSetObjective`, `debugSetUnitState`, `debugBuffUnit`, `debugDrawCards`, `debugSkipToTurn` — pure, same `{state, log}` return shape as combat.js | `cards.js`, `state.js` |
| `js/decks.js` | `DECK_RULES`, `STARTER_DECKS`, `getDeckPool`, `getHeroPool`, `countCopies`, `copyCap`, `validateDeck`, `validateHeroRoster`, `loadCustomDecks`/`saveCustomDeck`/`deleteCustomDeck`/`replaceAllCustomDecks` (localStorage, browser-only), `mergeRemoteDecks` (pure) | `cards.js` |
| `js/bot_ai.js` | `bestAttackForUnit`, `maxAttacksFor`, `bestExistingAttack`, `findLethal`, `bestPlacement`, `bestDamageCommandTarget` — pure move-scoring, shared by the in-page "vs AI" bot and the Playwright self-play harness so both can never drift from real game rules | `cards.js`, `state.js`, `combat.js`, `maps.js` |
| `js/bot_player.js` | `runBotTurn()` — drives P2's turn via the same DOM click handlers a human uses (not a separate code path) | `cards.js`, `state.js`, `bot_ai.js` |
| `js/lobbies.js` | `filterStale`, `sortByNewest`, `formatWaiting` — pure list helpers | nothing |
| `js/lobby-browser.js` | (side-effects only — open lobby list UI: host/browse/join without a code) | `firebase.js`, `lobbies.js`, `maps.js` |
| `js/deckbuilder.js` | (side-effects only — deck builder page: pool/build/validate/save) | `cards.js`, `decks.js`, `firebase.js` |
| `js/game.js` | (side-effects only — entry point for `game.html`: FSM, turn flow, event handlers, card-effect dispatch for objectives/commands/Hero powers, and online-sync orchestration) | `cards.js`, `state.js`, `combat.js`, `interaction.js`, `sync.js`, `ui.js`, `maps.js`, `firebase.js`, `debug.js`, `decks.js`, `bot_player.js` |
| `scripts/serve.mjs` | repository-owned static development server used locally and in CI | Node built-ins |
| `game.html` | (entry point) | `js/game.js` |
| `index.html` | (entry point) | `js/lobby-browser.js` |
| `deckbuilder.html` | (entry point) | `js/deckbuilder.js` |

**Dependency rule:** `cards.js` and `state.js` must never import from `ui.js`, `firebase.js`,
`game.js`, or any UI-facing module. Rules, interaction, and sync-format helpers stay pure; entry
points compose them with the DOM and Firebase.

---

## State Shape

This shows the core gameplay shape. `createInitialState`/`createPlayerState` in `js/state.js` are
the field-level authority; Firebase may also carry transport/setup metadata such as `_pushId` and
disconnect/mulligan flags. Update this section when adding durable gameplay fields.

```js
{
  _revision: number,           // monotonic online gameplay snapshot version; starts at 0
  turn: number,               // starts at 1, increments on endTurn
  initiative: "p1" | "p2",   // whose turn it is
  phase: "play",              // reserved for future phases; always "play" for now
  p2Joined: boolean,          // set by lobby when opponent joins; not game logic
  mapId: string,              // key into MAPS in maps.js — determines terrain layout
  readyForPlay: boolean,      // online mulligans/setup finished

  p1: PlayerState,
  p2: PlayerState,

  board: {
    "0,0": BoardUnit | null,
    "0,1": BoardUnit | null,
    // ... all 16 tiles, keys are "row,col" strings
    "3,3": BoardUnit | null,
  },

  objectives: {
    "row,col": { cardId: string, level: number, controller: "p1"|"p2"|null },
    // only tiles that have an objective card placed on them
  },

  log: string[],
  pendingArtyHits: number,
  pendingObjectivePick: { objectiveKey: string, sourceKey: string|null } | null,
  nextUnitInstance: number,
  generatedCards: { [cardId: string]: CardDefinition },
}
```

### PlayerState

```js
{
  hq: number,                         // starts 30; game ends at 0
  fuel: number,
  fuelCap: number,                    // 9 normally; H02 can raise effective cap to 11
  pendingFuelGain: number,
  hand: string[],                     // card IDs, index order is display/draw order
  deck: string[],
  discardPile: string[],
  fatigueCount: number,
  pendingDiscounts: Discount[],
  pendingUnitBuffs: UnitBuff[],
  heroRoster: string[],
  heroZones: [string|null, string|null, string|null, string|null],
  heroesActivatedThisTurn: string[],
  heroActivatedLastTurn: boolean,
  heroRepositioned: boolean,
  heroTriggeredThisTurn: { [heroId: string]: true },
  pendingHeroDiscount: number,
  heroTaxedColumns: { [column: string]: number },
  fieldMarshalUses: number,
  overrun: boolean,
}
```

### BoardUnit

The canonical BoardUnit shape is the top-of-file comment in `js/state.js`. Two identity rules are
especially important:

- `cardId` identifies the printed card definition; `instanceId` identifies this physical copy and
  follows it through Maneuver.
- timed bonuses use `grantedSideBonus` plus `sideBonusTurns`; match-long bonuses use
  `permanentSideBonus`. Never represent permanence with a large turn count.

Likewise, `grantedKeywords` clears at the owner's next `startOfTurn`, while
`permanentKeywords` never clears automatically.

---

## State API (`js/state.js`)

All functions are **pure** — they return new state, never mutate in place.

```js
createInitialState(p1DeckIds: string[], p2DeckIds: string[], mapId?: string,
                   p1HeroIds?: string[], p2HeroIds?: string[]) → GameState
// Shuffles decks, deals 4 cards to each hand, sets hq=30, fuel=0.

createBoardUnit(state: GameState, cardId: string, owner: "p1"|"p2", overrides?: object)
  → { state: GameState, unit: BoardUnit }
// Creates a deployed physical copy with a stable instanceId and advances nextUnitInstance.

startOfTurn(state: GameState) → GameState
// Active player gains 3 Fuel up to the effective cap (9 normally, 11 with H02), then applies
// any explicitly uncapped pending gain.
// Resets pendingFuelGain to 0.
// Refreshes Hero and persistent-attack allowances and expires owner-turn grants.

endTurn(state: GameState) → GameState
// Swaps initiative, increments turn counter.
// Clears justPlaced, tempKeywords, tempSideBonus on all board units.

updateObjectiveLevels(state: GameState) → GameState
// Recalculates objective level for current turn and sets it on all placed objectives.

drawCards(playerState: PlayerState, n: number) → PlayerState
// Resolves n draws sequentially; empty-deck attempts deal escalating Fatigue damage.

spendFuel(playerState: PlayerState, amount: number) → PlayerState
gainFuel(playerState: PlayerState, amount: number) → PlayerState

getSideValue(boardUnit: BoardUnit, dir: "n"|"e"|"s"|"w") → number
// Returns the rotated printed value plus temporary, timed, permanent, Objective, debug,
// dynamic, and printed-side-specific permanent bonuses, floored at 0.
// Owner-independent — a card's printed N/E/S/W always maps to physical N/E/S/W, same
// as in hand. (The 2026-07-02 owner-based P2_FLIP was removed 2026-08-14 — it was the
// other half of a per-viewer board rotation whose visual half was reverted 2026-07-30,
// left orphaned in the meantime and silently mismatching P2's board display vs hand.)

getKeywords(boardUnit: BoardUnit) → string[]
// Returns printed, temporary, owner-turn-granted, and permanent keywords.

maxArmorHits(boardUnit: BoardUnit) → number
// Heavy Armor → 2, Armor → 1, else → 0.

hitsToDestroy(boardUnit: BoardUnit) → number
// maxArmorHits + 2 (armor absorbs N hits, then Suppressed, then Destroyed).

applyHit(boardUnit: BoardUnit) → { newUnit: BoardUnit, hqDamage: number }
// Applies one hit following the sequence:
//   armorHits < maxArmorHits → absorb (hqDamage = 0, state unchanged)
//   state === "normal"       → "suppressed" (hqDamage = 0)
//   state === "suppressed"   → "destroyed"  (hqDamage = 2, or 0 with Guard)
// hqDamage is dealt to the unit owner's HQ (the one being attacked).

attackBeats(attacker: BoardUnit, attDir: "n"|"e"|"s"|"w", defender: BoardUnit) → boolean
// Compares attacker's side value vs defender's opposite side. Tie = attacker wins.
// attDir is the direction the attacker is swinging FROM (e.g. attacker is N of defender → attDir = "s").

oppositeDir(dir: "n"|"e"|"s"|"w") → "n"|"e"|"s"|"w"

objectiveLevel(turn: number) → 0|1|2|3|4
// turn 1 → 0 (no bonus), turns 2-3 → 1, 4-5 → 2, 6-7 → 3, 8+ → 4.
```

---

## Turn Structure (locked)

On your turn:
1. Draw 1 card (except the already-resolved pre-game first draw).
2. Gain 3 Fuel, refresh attack/Hero allowances, update control and Objective effects, then run
   any scheduled Hero Phase choice.
3. Play cards and/or attack in any legal order while Fuel and targets allow.
4. **Placing a Unit** enters targeting mode; the player finishes the attack or cancels placement.
5. **Existing normal Units** may use their remaining persistent/temporary attacks; Suppressed
   Units cannot attack but still occupy tiles and count for Objectives.
6. Destroyed Units leave the board immediately.
7. End Turn resolves Direct HQ and cleanup, then starts the opponent's turn sequence.

## Combat API (`js/combat.js`)

```js
tileKey(row: number, col: number) → string         // "row,col"
tileCoords(key: string) → [number, number]          // [row, col]
adjacentTiles(row, col) → { key: string, dir: string }[]
// Returns tiles orthogonally adjacent to (row,col) that are within the 4x4 grid.

getAttackableTargets(state: GameState, attackerKey: string) → { key: string, dir: string }[]
// Returns adjacent enemy tiles the attacker can legally target.
// Filters out: friendly units, empty tiles, destroyed units.
// Guard enforcement: if any adjacent enemy has Guard (and is not Suppressed),
//   only Guard units are returned — attacker must target them first.

resolveSingleAttack(state: GameState, attackerKey: string, targetKey: string)
  → { boardMutations, hqDamageToP1, hqDamageToP2, logEntries }
// Resolves one unit attacking one specific target.
// boardMutations: array of { key: string, newUnit: BoardUnit } — may include
//   newUnit = null if the defender was Destroyed (removes it from board).
// hqDamageToP1/P2: HQ damage from this single attack.
// logEntries: human-readable strings.
// If attack fails (attacker value < defender value, or Guard blocks), returns
//   empty mutations and 0 damage — failed attack has no penalty.
// Caller applies mutations and deducts HQ damage.
```

**`resolveDeployment` is removed** — replaced by `resolveSingleAttack`. Placement no longer auto-hits all adjacents; the player picks 1 target via the UI targeting mode.

---

## Hero Command Layer

Added 2026-08-01 to 2026-08-13 (Session Log 20). Heroes are a separate fixed roster of 4 cards per player (`type:"hero"` in `cards.js`), never shuffled into the main 30-card deck — see `DECK_RULES.heroRosterSize` in `decks.js`.

**State (`PlayerState`, see `createPlayerState` in `state.js`):**
- `heroRoster: string[]` — the 4 chosen Hero card IDs (fixed for the match).
- `heroZones: [id|null, id|null, id|null, id|null]` — index = board column (0-3), value = hero cardId currently deployed in that zone, or `null`. Every hero has a `scope` of `"column"` (only affects its own column) or `"board"` (affects the whole board) — scope is an authoritative field on the card, never inferred from ability text (see `tests/hero_primitives.test.mjs`).
**Corrected 2026-08-31 (post-Run-1 QA pass) — this whole section was pre-Run-1 stale**: old
numeric Hero ids, a `heroActivated`/`heroesActivatedEver` shape that no longer exists, and Fuel
cap numbers (6/8) that were already wrong even before the migration (locked value is 9 base /
11 with Logistics Chief). Rewritten against the actual current code:
- `heroesActivatedThisTurn: string[]` — Hero ids whose Active Power has fired this turn. Each
  deployed Hero may activate once per turn; different Heroes may each activate in the *same*
  turn (locked 2026-08-17 — this replaced an older single-activation-per-turn-total model, which
  is what made Coordinated Orders' old "extra activation" effect redundant and retired). Reset
  in `startOfTurn`.
- `heroRepositioned: boolean` — one Hero Phase reposition/deployment per turn. Reset in
  `startOfTurn`. Command Shuffle (C15) reuses the same pick-up/drop UI flow but explicitly does
  *not* consume or require this flag (see `handleHeroZoneClick`'s `shuffleActive` branch).
- `heroTriggeredThisTurn: { [heroId]: true }` — gates "first X each turn" passives (Objective
  Marshal H04, Infantry Commander H08, Emergency Logistics Officer H21) so each fires at most
  once per owner turn. Reset in `startOfTurn`.
- `heroActivatedLastTurn: boolean` — snapshot of "did I activate any Hero Power on my own
  previous turn," taken at `startOfTurn` before the current turn's tracking resets.

**Hero Phase timing:** `runHeroPhase` (`game.js`) deploys roster Heroes on the same schedule as
objective escalation — a Hero becomes available to deploy at each of Objective Levels 1-4
(round 2, 4, 6, 8), not on a separate pre-game step.

**On-play passive ordering (fixed 2026-08-31):** a placed Unit's own On Play (Craft's drawback,
or the Aircraft Maneuver On Play) must resolve *before* Objective Marshal/Infantry Commander/
Emergency Logistics Officer check (doc 01 §22) — the PLACING handler had this backwards for the
whole of Run 1. For a synchronous On Play this was a straight reorder; the Aircraft Maneuver On
Play needs a UI round-trip, so `checkHeroPassivesOnPlace` is skipped in PLACING for that one
case and called instead from `resolveUnitManeuverDestination` once the Maneuver actually
resolves.

**Where the logic lives:**
- **Pure, tested hero passives** live in `combat.js` alongside ordinary combat resolution:
  `checkHeroPassivesOnPlace` (on-place triggers: Objective Marshal H04, Infantry Commander H08,
  Emergency Logistics Officer H21) and `checkCounteroffensiveGeneral` (H06, fires on the
  Suppression-*applying* side, not on removal). Covered by `tests/hero_phase.test.mjs` and
  `tests/hero_primitives.test.mjs`.
- **Hero Power dispatch** (`heroTargetKeys`, `applyHeroPower` — both switch-on-hero-id, same
  pattern as the objective/command switches below) and **DOM wiring** (`showHeroDeploy`,
  `deployHero`, `handleHeroZoneClick`, `tryActivateHero`, `resolveHeroTargeting`) live in
  `game.js`, uncovered by `node:test` — same gap as the objective/command switches (see
  "Deferred" section below).
- **Fuel cap override**: `fuelCapOf` in `state.js` raises the cap from 9 to 11 while Logistics
  Chief (H02) is deployed in any zone — read this instead of a hardcoded `9` anywhere fuel
  capacity matters.

---

## UI API (`js/ui.js`)

```js
renderBoard(state: GameState, selectedTileKey: string|null, validDropKeys: Set<string>|null,
            changedKeys?: Set<string>|null, transitionFlags?: Map|null,
            terrainBlockedKeys?: Set<string>|null, objectiveTransitionFlags?: Map|null) → void
// Writes into #board, highlights selections/legal or blocked destinations, and renders transition
// feedback. Board orientation is fixed for both players; printed directions never viewer-flip.

renderHand(handCardIds: string[], containerId: string, selectedCardId: string|null,
           extras?: object) → void
// Writes into the requested hand element and shows live discounts/buffs from extras.

renderHQ(state: GameState) → void
// Updates #p1-hq, #p2-hq, #p1-fuel, #p2-fuel, #turn-display text content.

appendLog(entries: string[]) → void
// Appends strings to #game-log and scrolls to bottom.
```

**DOM contract:** `game.html` must contain these element IDs: `board`, `p1-hand`, `p1-hq`, `p2-hq`, `p1-fuel`, `p2-fuel`, `turn-display`, `game-log`. Do not rename them.

---

## Firebase API (`js/firebase.js`)

```js
pushState(gameId: string, state: GameState) → Promise<void>
// Blind full write reserved for initial/pre-game setup before concurrent gameplay begins.

pushVersionedState(gameId: string, state: GameState, expectedRevision: number)
  → Promise<GameState>
// Firebase transaction for gameplay. Commits only if the server revision still equals
// expectedRevision; otherwise throws state-conflict with the latest server snapshot.

fetchState(gameId: string) → Promise<GameState | null>
// One-time read. Returns null if game doesn't exist.

subscribeState(gameId: string, callback: (state: GameState) => void) → () => void
// Real-time listener. Returns unsubscribe function.

generateGameCode() → string
// Returns a random 6-character uppercase alphanumeric string.
```

**Firebase paths:** shared match snapshots live at `games/{gameId}`; pre-game coordination at
`lobbies/{gameId}`; discoverable sessions at `openLobbies/{lobbyId}`; and saved custom decks at
`users/{uid}/decks`. Add a new top-level path only as an explicit data-model decision.

---

## Keyword Resolution Decisions

These are locked decisions — don't reinvent them.

**Status (updated 2026-09-01):** all 16 keywords below are fully built, wired into the current
`H01`-`H25`/`C01`-`C35`/`I1`-`A65` id scheme, and unit-tested — including Maneuver/Escalate/Craft,
which this table used to (wrongly, as of 2026-08-31) call out as "not yet built." Every Hero
Active and Command has a real implementation; see `STATUS.md` for the current-state summary and
`CHANGELOG.md` for the closure passes that finished this.

| Keyword | How it resolves |
|---|---|
| **Guard** | Attacker-specific legal-target priority (doc 01 §10, doc 02 Q92-Q100), NOT adjacency-based protection. `getAttackableTargets` (combat.js) computes each attacker's own raw candidate pool (adjacent, or row/column for Bombard), then restricts to Guard candidates if any exist — Suppressed Guards still count, Bombard no longer bypasses Guard, Double Attack's 2nd hit re-evaluates fresh (no more `skipGuard`). |
| **Precision** | New (2026-08-31). Ignores Guard priority entirely; no range effect by itself. Checked first in `getAttackableTargets`. |
| **Armor** | Absorbs 1 hit before state changes. Tracked via `armorHits` on BoardUnit. `applyHit` handles this. |
| **Heavy Armor** | Absorbs 2 hits. Same mechanism as Armor, `maxArmorHits` returns 2. |
| **Bombard** | Unit can attack any enemy in its entire row or column (not just adjacent), no blocker check. Implemented in `getBombardTargets` in combat.js. No longer bypasses Guard (see Guard above). |
| **Blast** | New (2026-08-31). On a successful primary Hit, also Hits enemies directly left/right of the target relative to attack direction. `blastSecondaryKeys`/`resolveSecondaryHits` in combat.js, wired into `resolveSingleAttack`. |
| **Barrage** | New (2026-08-31). On a successful primary Hit, also Hits enemies farther along the forward ray beyond the target, no blocker check. `barrageSecondaryKeys` in combat.js. |
| **Double Attack** | Persistent attack allowance = 2 instead of 1 (`persistentAllowance` in state.js). Sits on top of the new persistent+temporary attack-allowance model (`remainingAttacks`/`spendAttack`/`grantTempAttacks`/`resetPersistentAttacks`) — consumption order is locked persistent-then-temporary; an explicit reset restores persistent only. |
| **Breakthrough** | Implemented 2026-08-31 via the shared destruction chain (`resolveDestructionChain`/`applyPostDestructionEffects` in combat.js) — triggers from the Unit that caused a destruction, after that destroyed Unit's own Last Stand resolves. |
| **Rally** | Implemented 2026-08-31 (`checkRally` in combat.js). Triggers whenever a Rally Unit declares/executes an attack, success not required; never triggers on Direct HQ. |
| **Inspire** | Implemented 2026-08-31 as a dynamic aura (`computeDynamicSideBonus`/`recalculateDynamicStats` in combat.js) — adjacent friendly Units get +1 all sides per adjacent Inspire source, recalculated after every placement/movement/destruction. Feeds `getSideValue` via a new `dynamicSideBonus` field. |
| **Muster** | Implemented 2026-08-31, same dynamic-recalculation mechanism as Inspire — +1 all sides per OTHER friendly Infantry controlled, board-wide. |
| **Last Stand** | Implemented 2026-08-31 as a Unit keyword via the shared destruction chain (distinct from the old same-named Command, which is now archived). |
| **Maneuver** | Move a friendly Unit to any other empty, legal tile — no adjacency/range limit, terrain restrictions still apply. Either a Unit's own On Play (A55/A56/A61-A63/A65 — 2-step source-then-destination flow) or a Hero/Command effect (H16, C21/C27/C35) choosing a target Unit. Does not retrigger On Play; does not reset attacks unless the specific effect says so. `getManeuverTargets`/`resolveManeuver` in combat.js. |
| **Escalate** | First use of a named Escalate card in a match resolves its base effect; every use after the first resolves the upgraded version instead (bigger bonus or more targets, per card). Tracked by card name, per player, per match (`escalateUses` on PlayerState) — two physical copies share the count. Current cards: C26/C34 (boosted amount), C27/C32 (affects up to 2 targets instead of 1). |
| **Craft** | H25 Chief Aircraft Engineer only. Generates 3 candidate Aircraft (random stats, one of Bombard/Double Attack/Armor, plus a drawback), player picks 1 to add to hand. Activation cost starts at 5 Fuel and drops by 1 each use (5→4→3→2→1, floor 1), tracked per player for the rest of the match. `generateCraftCandidates`/`craftCandidateToCard`/`nextCraftCost` in combat.js. |
| **Airborne** | Retired — not part of the new Set 1 truth (Aircraft has innate unrestricted terrain access instead; see `maps.js`). |

---

## Patterns

### Immutability
All state transitions return new objects. Never do `state.p1.hq -= 1`. Always do `{ ...state, p1: { ...state.p1, hq: state.p1.hq - 1 } }`.

### Committing a move (`js/game.js`)

Every gameplay action goes through `commitState`. It updates the local snapshot, appends log
entries, synchronizes mandatory-choice UI, redraws, and queues an online write. Online gameplay
writes use `prepareVersionedState` plus `pushVersionedState`; they must not call a blind Firebase
`set()` directly. A revision conflict restores the newest server state and asks the player to
retry. A connection failure pauses actions until a shared snapshot arrives again.

### Tile keys
Always `"row,col"` strings. Row 0 is top, row 3 is bottom. Column 0 is left, column 3 is right. Never use any other format.

### HQ damage direction
`hqDamageToP1` means damage dealt TO P1's HQ (i.e. P2 attacked P1's unit). `hqDamageToP2` means damage dealt TO P2's HQ.

---

## Deliberate boundaries / future architecture

- Map orientation is fixed per map rather than agreed/flipped before the match. This is a known
  prototype simplification, not an accidental missing viewer flip.
- Revision-checked writes prevent accidental lost updates, but do not provide player secrecy or
  authorization. Private hands/rosters require authenticated per-player data and Firebase-rule
  changes; do not treat `_revision` as a security boundary.
- Missions, numeric-ID runtime branches, and reactive Empty-Board HQ Strike are retired. History
  remains in archives, Git, and older changelog entries; do not reconnect those paths to current
  Set 1 rules without a new design decision.
- See `STATUS.md` for current open items rather than duplicating fast-changing product status here.
