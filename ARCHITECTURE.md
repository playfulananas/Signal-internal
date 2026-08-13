# SIGNAL Digital Prototype — Living Architecture Doc

**Purpose:** Every subagent reads this before starting a task and updates it after completing one. This is the single source of truth for how the codebase is structured. The DEVPLAN tells you *what* to build; this doc tells you *how* things are built so far.

**Rule:** If you write code that contradicts something in this doc, update this doc. If something here is wrong, fix it here. Never silently drift.

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

*(Session Log entries above are milestone summaries, not one-per-commit — see `git log` for full commit-level history.)*

---

## Module Map

| File | Exports | Depends on |
|---|---|---|
| `js/cards.js` | `CARDS`, `CARD_BY_ID` | nothing |
| `js/maps.js` | `MAPS`, `getTerrain`, `canPlaceOnTerrain` | nothing |
| `js/state.js` | see State API below | `cards.js` |
| `js/combat.js` | see Combat API below (incl. Hero passives — see below) | `cards.js`, `state.js` |
| `js/ui.js` | see UI API below | `cards.js`, `state.js`, `maps.js` |
| `js/firebase.js` | see Firebase API below | Firebase SDK (CDN) |
| `js/debug.js` | `debugAddCard`, `debugSetFuel`, `debugAdjustFuel`, `debugSetHQ`, `debugAdjustHQ`, `debugSetObjective`, `debugSetUnitState`, `debugBuffUnit`, `debugDrawCards`, `debugSkipToTurn` — pure, same `{state, log}` return shape as combat.js | `cards.js`, `state.js` |
| `js/decks.js` | `DECK_RULES`, `STARTER_DECKS`, `getDeckPool`, `getHeroPool`, `countCopies`, `copyCap`, `validateDeck`, `validateHeroRoster`, `loadCustomDecks`/`saveCustomDeck`/`deleteCustomDeck`/`replaceAllCustomDecks` (localStorage, browser-only), `mergeRemoteDecks` (pure) | `cards.js` |
| `js/bot_ai.js` | `bestAttackForUnit`, `maxAttacksFor`, `bestExistingAttack`, `findLethal`, `bestPlacement`, `bestDamageCommandTarget` — pure move-scoring, shared by the in-page "vs AI" bot and the Playwright self-play harness so both can never drift from real game rules | `cards.js`, `state.js`, `combat.js`, `maps.js` |
| `js/bot_player.js` | `runBotTurn()` — drives P2's turn via the same DOM click handlers a human uses (not a separate code path) | `cards.js`, `state.js`, `bot_ai.js` |
| `js/lobbies.js` | `filterStale`, `sortByNewest`, `formatWaiting` — pure list helpers | nothing |
| `js/lobby-browser.js` | (side-effects only — open lobby list UI: host/browse/join without a code) | `firebase.js`, `lobbies.js`, `maps.js` |
| `js/deckbuilder.js` | (side-effects only — deck builder page: pool/build/validate/save) | `cards.js`, `decks.js`, `firebase.js` |
| `js/game.js` | (side-effects only — entry point for `game.html`: FSM, turn flow, event handlers, card-effect dispatch for objectives/commands/Hero powers) | `cards.js`, `state.js`, `combat.js`, `ui.js`, `maps.js`, `firebase.js`, `debug.js`, `decks.js`, `bot_player.js` |
| `game.html` | (entry point) | `js/game.js` |
| `index.html` | (entry point) | `js/lobby-browser.js` |
| `deckbuilder.html` | (entry point) | `js/deckbuilder.js` |

**Dependency rule:** `cards.js` and `state.js` must never import from `ui.js`, `firebase.js`, `game.js`, or any UI-facing module. The dependency graph flows one way: cards → state → combat/debug/bot_ai → ui/decks/bot_player → firebase/lobbies → entry points (`game.js`, `deckbuilder.js`, `lobby-browser.js`).

---

## State Shape

This is the canonical game state object. Firebase stores this exact shape. Do not add fields without updating this doc.

```js
{
  turn: number,               // starts at 1, increments on endTurn
  initiative: "p1" | "p2",   // whose turn it is
  phase: "play",              // reserved for future phases; always "play" for now
  p2Joined: boolean,          // set by lobby when opponent joins; not game logic
  mapId: string,              // key into MAPS in maps.js — determines terrain layout

  p1: PlayerState,
  p2: PlayerState,

  board: {
    "0,0": BoardUnit | null,
    "0,1": BoardUnit | null,
    // ... all 16 tiles, keys are "row,col" strings
    "3,3": BoardUnit | null,
  },

  objectives: {
    "row,col": { cardId: number, level: number },
    // only tiles that have an objective card placed on them
  },

  log: string[],   // last N action strings, appended by commitState
}
```

### PlayerState

```js
{
  hq: number,                // HQ HP, starts 25, game ends at 0
  fuel: number,              // current fuel, max 6
  pendingFuelGain: number,   // delayed fuel (Industrial Surge), added at next startOfTurn
  hand: number[],            // cardIds in hand, order matters for display
  deck: number[],            // cardIds remaining, index 0 = top of deck
  missions: ActiveMission[], // active mission cards
  tempFuelDiscount: number,  // discount on next card of matching class (Armored Spearhead)
}
```

### ActiveMission

```js
{
  cardId: number,
  turnsRemaining: number,
  progress: any,   // mission-specific tracking; structure varies by card
}
```

### BoardUnit

```js
{
  cardId: number,
  owner: "p1" | "p2",
  state: "normal" | "suppressed" | "destroyed",
  armorHits: number,        // hits absorbed by armor so far (0 until armor starts taking hits)
  tempKeywords: string[],   // keywords added THIS TURN only (Smoke Screen, Dig In, etc.); cleared by endTurn
  grantedKeywords: string[], // keywords from commands lasting until owner's NEXT TURN; cleared by startOfTurn
  tempSideBonus: number,    // +N to all sides this turn (Rally Cry, Entrench, etc.); cleared by endTurn
  objSideBonus: number,     // +N from objective effects; recalculated each startOfTurn
  justPlaced: boolean,      // true only on the turn deployed; cleared by endTurn
}
```

---

## State API (`js/state.js`)

All functions are **pure** — they return new state, never mutate in place.

```js
createInitialState(p1DeckIds: number[], p2DeckIds: number[]) → GameState
// Shuffles decks, deals 5 cards to each hand, sets hq=25, fuel=0.

startOfTurn(state: GameState) → GameState
// Active player gains 3 fuel (+pendingFuelGain, capped at 6).
// Resets pendingFuelGain to 0.
// Decrements mission turnsRemaining, removes expired missions.

endTurn(state: GameState) → GameState
// Swaps initiative, increments turn counter.
// Clears justPlaced, tempKeywords, tempSideBonus on all board units.

updateObjectiveLevels(state: GameState) → GameState
// Recalculates objective level for current turn and sets it on all placed objectives.

drawCards(playerState: PlayerState, n: number) → PlayerState
// Draws up to n cards from deck into hand. Stops if deck empty.

spendFuel(playerState: PlayerState, amount: number) → PlayerState
gainFuel(playerState: PlayerState, amount: number) → PlayerState

getSideValue(boardUnit: BoardUnit, dir: "n"|"e"|"s"|"w") → number
// Returns card's base side value + tempSideBonus + objSideBonus.
// Owner-independent — a card's printed N/E/S/W always maps to physical N/E/S/W, same
// as in hand. (The 2026-07-02 owner-based P2_FLIP was removed 2026-08-14 — it was the
// other half of a per-viewer board rotation whose visual half was reverted 2026-07-30,
// left orphaned in the meantime and silently mismatching P2's board display vs hand.)

getKeywords(boardUnit: BoardUnit) → string[]
// Returns card's base keyword (if any) + tempKeywords + grantedKeywords arrays.

maxArmorHits(boardUnit: BoardUnit) → number
// Heavy Armor → 2, Armor → 1, else → 0.

hitsToDestroy(boardUnit: BoardUnit) → number
// maxArmorHits + 2 (armor absorbs N hits, then Suppressed, then Destroyed).

applyHit(boardUnit: BoardUnit) → { newUnit: BoardUnit, hqDamage: number }
// Applies one hit following the sequence:
//   armorHits < maxArmorHits → absorb (hqDamage = 0, state unchanged)
//   state === "normal"       → "suppressed" (hqDamage = 1)
//   state === "suppressed"   → "destroyed"  (hqDamage = 2)
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
1. Gain 3 fuel (startOfTurn)
2. Play cards from hand and/or attack with board units — in any order, as many times as you have fuel/targets
3. **Placing a unit** → immediately enter targeting mode: player must click 1 adjacent enemy to attack (or cancel, which returns the card to hand and refunds fuel)
4. **Existing alive units** (state === "normal") can each attack once per turn — click the unit, then click 1 adjacent enemy
5. **Suppressed units** cannot attack but still occupy their tile and count for objectives
6. **Destroyed units** are removed from the board immediately (tile becomes null, free for new placement)
7. End Turn

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
- `heroRoster: number[]` — the 4 chosen hero card IDs (fixed for the match).
- `heroZones: [id|null, id|null, id|null, id|null]` — index = board column (0-3), value = hero cardId currently deployed in that zone, or `null`. Every hero has a `scope` of `"column"` (only affects its own column) or `"board"` (affects the whole board) — scope is an authoritative field on the card, never inferred from ability text (see `tests/hero_primitives.test.mjs`).
- `heroActivated` / `heroRepositioned` — one Activated Hero Power and one reposition/swap per turn, across all zones. Reset in `startOfTurn`.
- `heroTriggeredThisTurn: { [heroId]: true }` — gates "first X each turn" passives so each fires at most once per owner turn. Reset in `startOfTurn`.
- `heroesActivatedEver: number[]` — every distinct hero whose Activated Power has fired this **match** (not per-turn), never cleared. Used by cards like Veteran Signal Corps (119).
- `lastUnitClass` — tracks the class of the last Unit played, for Combined Arms General (109)'s "mixed-class army" trigger.

**Hero Phase timing:** `runHeroPhase` (`game.js`) deploys roster Heroes on the same schedule as objective escalation — a Hero becomes available to deploy at each of Objective Levels 1-4 (round 2, 4, 6, 8), not on a separate pre-game step.

**Where the logic lives:**
- **Pure, tested hero passives** live in `combat.js` alongside ordinary combat resolution: `checkHeroPassivesOnPlace` (on-place triggers: Objective Marshal 94, Infantry Commander 104, Combined Arms General 109, Conventional Warfare Commander 110) and `checkCounteroffensiveGeneral` (101, fires on the Suppression-*applying* side, not on removal). Covered by `tests/hero_phase.test.mjs` and `tests/hero_primitives.test.mjs`.
- **Hero Power dispatch** (`heroTargetKeys`, `applyHeroPower` — both switch-on-hero-id, same pattern as the objective/command switches below) and **DOM wiring** (`showHeroDeploy`, `deployHero`, `handleHeroZoneClick`, `tryActivateHero`, `resolveHeroTargeting`) live in `game.js`, uncovered by `node:test` — same gap as the objective/command switches (see "Deferred" section below and the project's optimization plan for the plan to close it).
- **Fuel cap override**: `fuelCapOf` in `state.js` raises the cap from 6 to 8 while Logistics Chief (89) is deployed in any zone — read this instead of a hardcoded `6` anywhere fuel capacity matters.

---

## UI API (`js/ui.js`)

```js
renderBoard(state: GameState, selectedTileKey: string|null, validDropKeys: Set<string>|null, changedKeys?: Set<string>|null, flip?: boolean) → void
// Writes into #board element. Highlights selectedTileKey, marks validDropKeys green.
// flip=true reverses row/col iteration so P2 sees board from their side.
// viewer is derived from flip: flip=true → 'p2' viewer (opponent cards swap N↔S/E↔W in display).

renderHand(handCardIds: number[], containerId: string, selectedCardId: number|null) → void
// Writes into element with given id. Marks selectedCardId as selected.

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
// Writes full state to Firebase at path games/{gameId}.

fetchState(gameId: string) → Promise<GameState | null>
// One-time read. Returns null if game doesn't exist.

subscribeState(gameId: string, callback: (state: GameState) => void) → () => void
// Real-time listener. Returns unsubscribe function.

generateGameCode() → string
// Returns a random 6-character uppercase alphanumeric string.
```

**Firebase path convention:** All game data lives at `games/{gameId}`. Never write to any other path.

---

## Keyword Resolution Decisions

These are locked decisions — don't reinvent them.

| Keyword | How it resolves |
|---|---|
| **Guard** | UI enforces targeting: if a Guard unit is adjacent to the attacker, it must be the target. Guard is ignored if the unit is Suppressed. `resolveDeployment` trusts the caller passed a legal target. |
| **Armor** | Absorbs 1 hit before state changes. Tracked via `armorHits` on BoardUnit. `applyHit` handles this. |
| **Heavy Armor** | Absorbs 2 hits. Same mechanism as Armor, `maxArmorHits` returns 2. |
| **Bombard** | Unit can attack any enemy in its entire row or column (not just adjacent). Bypasses Guard enforcement. Implemented in `getBombardTargets` in combat.js. |
| **Double Attack** | After the first attack resolves, the unit stays selected and targeting mode re-enters automatically — player picks a second target. Guard is bypassed on the second hit (`skipGuard=true`). |
| **Breakthrough** | After Destroying an enemy, unit can slide into the vacated tile and attack again. **Deferred — not implemented in Phase 1.** For now, Breakthrough is a stat card with no special mechanic. |
| **Airborne** | Ignores terrain restrictions. **Terrain not implemented in Phase 1**, so Airborne has no mechanical effect yet. Card still shows keyword. |
| **Inspire** | Adjacent friendly units gain +1 to all sides. **Deferred — not implemented in Phase 1.** Requires tracking adjacency every time a unit moves or is placed. |

---

## Patterns

### Immutability
All state transitions return new objects. Never do `state.p1.hq -= 1`. Always do `{ ...state, p1: { ...state.p1, hq: state.p1.hq - 1 } }`.

### Committing a move (game.html)
```js
async function commitState(newState, logLines) {
  state = newState;
  appendLog(logLines || []);
  redraw();
  if (isOnline) await pushState(gameId, state);
}
```
Every action goes through `commitState`. Never write to `state` directly and then call `redraw()` separately.

### Tile keys
Always `"row,col"` strings. Row 0 is top, row 3 is bottom. Column 0 is left, column 3 is right. Never use any other format.

### HQ damage direction
`hqDamageToP1` means damage dealt TO P1's HQ (i.e. P2 attacked P1's unit). `hqDamageToP2` means damage dealt TO P2's HQ.

---

## Deferred — Do Not Implement Yet

**This list was stale as of 2026-08-13 and has been corrected.** Interactive Command effects, Guard targeting enforcement, the deck builder, the win condition popup/screen, and copy limits are all now implemented — this section previously described Phase 1-2 scope from 2026-07-02 and was never updated as those phases completed. Breakthrough and Inspire are no longer "deferred to implement" either — the Breakthrough- and Inspire-keyword cards (Blitz Tank, Tank Destroyer, Vanguard Tank, Field Commander, Chief of Staff) and the entire Commander class were **retired** 2026-08-13 as a balance decision (unimplemented + unbalanced, and the Commander class's strategic-presence role is now covered by Heroes) — see the `retired:true` comments in `cards.js`. Missions are similarly retired (2026-07-30), not deferred — see the dead-code note called out where the codebase's optimization plan removes them.

**Still genuinely incomplete** — check `STATUS.md`'s "Known workarounds / prototype shortcuts" section for the current, authoritative list (Rally Cry choose-2, Artillery Position L2/L4 auto-hit, Bridge return-to-hand, Airfield L1 double-attack-on-placement, Factory L2 Tank discount) rather than duplicating it here, since that list changes faster than this doc gets reviewed.

**One remaining genuine simplification, not a gap to close without discussion:** map orientation is fixed per map rather than agreed/flipped pre-game by both players (the GDD's tabletop rule) — see the comment in `ui.js`'s `renderBoard`. This was a deliberate prototype simplification (reverted from an earlier per-viewer flip attempt on 2026-07-30), not an oversight.
