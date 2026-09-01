# SIGNAL Prototype — Implementation Status

**This file states current facts only, edited in place — no dated narrative, no history.**
For "how did we get here" (what changed, when, why, what bugs were found), see `CHANGELOG.md`.
When something here changes, overwrite the fact; don't leave the old value struck through.

Legend: ✅ done | ⚠️ partial | ❌ missing

---

## Card content

Active pool: exactly 65 Units + 25 Heroes + 35 Commands + 5 Objectives = 130 records (125
collectible) in `js/cards.js`, matching doc 03 (SIGNAL Card Truth & Migration). Card ids are
strings: `I1`-`A65` (Units), `H01`-`H25` (Heroes), `C01`-`C35` (Commands), `O1`-`O5`
(Objectives). Every retired card is preserved, not deleted, in `js/archive/legacy_cards.js` with
a manifest. All 8 starter decks in `js/decks.js` are the exact SIGNAL Set 1 Recommended Decks
(Infantry Formation, Tank Blitz, Artillery Fire Control, Air Superiority, Last Stand Sacrifice,
Command Engine, Combined Arms, Objective Tempo).

## Rules engine

All 25 Heroes and all 35 Commands have real implementations — no stub/no-op cases remain in
`applyHeroPower`/`playInstantCommand`/`applyCommandEffect`. Guard uses attacker-specific
legal-target priority (not adjacency); Precision, Blast, Barrage, Rally, Inspire (dynamic aura),
Muster (dynamic aura), Last Stand (unit keyword), Breakthrough, Maneuver, Escalate, and Craft are
all built and tested. `recalculateDynamicStats` (combat.js) runs after all 3 events that can
change adjacency/board-Infantry-count — placement, movement, and destruction — so Inspire/Muster
stay correctly live; the board display (`buildBoardCard` in ui.js) sums `dynamicSideBonus` into
each side's shown value alongside the other bonus fields. A shared destruction chain
(`resolveDestructionChain`/`applyPostDestructionEffects` in combat.js) is the single path for
Last Stand/Breakthrough/HQ-damage-replacement, used by both combat and self-destruct Commands.
The combat TARGETING handler (game.js) runs this chain for EVERY unit destroyed by a single
attack, not just one — a Blast/Barrage attack that kills both its primary and a secondary target
in the same swing correctly fires Last Stand/Breakthrough for both. A
persistent+temporary attack-allowance model (`remainingAttacks`/`spendAttack` in state.js) has
locked consumption order: persistent first, then temporary; an explicit reset restores persistent
only. Direct HQ (`evaluateDirectHQ` in combat.js) is the sole end-of-turn HQ-conversion
mechanism, wired into the End Turn handler. Suppression deals 0 HQ damage; Destroy deals 2, or 0
if the destroyed Unit has Guard — enforced consistently by both destruction paths (`applyHit` in
state.js, for normal combat/Blast/Barrage kills; `resolveDestructionChain` in combat.js, for
command/self-destruct kills like Sacrifice Play).

`bot_ai.js`'s Command/Hero-Power/Objective scoring is fully mapped to the current id scheme,
matched by each card's actual effect text.

## Objectives

`applyObjectiveEffects` (game.js) implements the real O1-O5 scheme: a universal 1/1/2/2 HQ
backbone by level, resolved before each Objective's own secondary effect, with an immediate
lethal-stop that also cancels that Objective's own secondary and any later Objective in scan
order. Multiple simultaneously-controlled Objectives resolve in fixed column-major board order.
All 5 Objectives' L1-L4 secondary effects execute for real. Objective identities randomize into
fixed per-map slots after mulligan (`finishStartGame`), unique per map.

Of the 20 total secondary effects, 16 say "random" in their card text and auto-pick via
`pickRandomN` (doc 04 §6's locked Random-Target Rule). The other 4 — Airfield L2 (Maneuver),
Supply Depot L1 (Remove Suppression), City L1 (Guard), Artillery Position L1 (Rotate) — don't say
"random", and the doc is silent on selection method for them; the controlling player picks the
target instead. `applyObjectiveEffects` is resumable (`resumeAfterKey` param): it pauses and
returns `pendingPick: { objectiveKey, sourceKey }` the moment one of these 4 needs a target with
at least one eligible option, halting all further Objective processing (later controlled
Objectives' backbone included) until the pick resolves — doc 04 §5's "fully resolve one Objective
before the next begins" holds exactly, not approximately. No eligible target logs an explicit
line (e.g. "City L1: no eligible friendly Unit.") and the loop continues normally, same as the
"random" effects' existing no-op behavior. `getObjectivePickEffectType`/`computeObjectivePickTargets`
(combat.js) are the single source of truth for eligibility, shared by the render highlight, the
click validator (`resolveObjectivePickClick`, game.js), and the bot (`handleObjectivePicking`,
bot_player.js / selfplay_test.mjs) — a highlighted tile is always a legal click. Airfield L2 is a
2-step pick (source Unit, then destination) using one `uiState` value throughout, distinguished
only by whether `sourceKey` is set. Artillery Position L1 reuses the existing rotate-direction
modal (Change Formation C16 / Field Coordinator's Hero Power) via a third `kind: 'objective'`
branch. Hero Phase is deferred (`runHeroPhase` call gated on `!pendingPick`) until the entire
Objective chain — including any pending pick — has fully drained, both locally and via
`receiveRemoteState` online. City L1's Guard eligibility check (`getKeywords(u).includes('Guard')`)
treats printed/permanent/temp-granted Guard identically — a documented simplification pending
this project's separate work on distinguishing keyword provenance/duration.

## Maps

4 live maps in `js/maps.js`: Stalingrad (1 objective slot), Kursk (2), El Alamein (3), Ardennes
(4) — exact slot coordinates and geometry match doc 04. Normandy and Midway are archived (not
deleted) in `maps.js`'s `ARCHIVED_MAPS` export. No map has water terrain; Forest-blocks-Tank is
the only terrain restriction. Naval class is fully cut — `canPlaceOnTerrain` has no
Naval/water branch.

**Human check, low priority, cosmetic only:** Stalingrad's exact City/Plain cell pattern is a
`plains` placeholder where the old water column used to be. Doesn't affect gameplay (Plain/
Desert/City are mechanically identical terrain) — matters only if the visual pattern should
match the v1.1 map art exactly.

## Core Systems

| Feature | Status | Notes |
|---|---|---|
| Board rendering (4x4 grid) | ✅ | |
| Hand rendering | ✅ | |
| Fuel system | ✅ | Threshold 9 (11 w/ Logistics Chief H02); a capped Fuel gain clamps the gain itself to remaining room under the cap, never reduces Fuel already above it |
| Fatigue (empty-deck draw) | ✅ | `drawCards` deals escalating HQ damage per failed draw (`fatigueCount` on PlayerState), never resets |
| Discard Pile + 10-card hand cap | ✅ | `discardPile` on PlayerState; `addCardToHand` (state.js) is the shared funnel for every hand-entry point. Bookkeeping only — no current card reads the zone |
| Unit/Command copy limits | ✅ | Read from each card's own `copies` field (`copyCap` in decks.js), not inferred from rarity |
| HQ damage + win condition | ✅ | Suppress = 0, Destroy = 2; first to 0 loses |
| Direct HQ | ✅ | End-of-turn evaluator; turn-1 lock is on whoever moves first, not hardcoded to `p1` |
| First player selection | ✅ | Randomized (`createInitialState`), not hardcoded to `p1` — doc 02 Q005 |
| Opening hand / turn-1 draw | ✅ | 4-card opening hand for both; whoever has initiative also draws 1 normally on turn 1 (doc 01 §2 Step 3, no turn-1 exception) — symmetric with whoever goes second drawing on their own turn 2 |
| Initiative swap | ✅ | |
| Objective control tracking | ✅ | Majority-adjacent, orthogonal, tie = no control |
| Objective HQ backbone + secondary effects | ✅ | See Objectives above |
| Maps | ✅ | 4 live maps, see Maps above |
| Hit sequence (normal/Armor/Heavy Armor) | ✅ | |
| Terrain placement restrictions | ✅ | Forest-blocks-Tank only |
| Firebase multiplayer | ✅ | |
| Local-mode lobby setup order | ✅ | Map picked before deck(s), local hotseat + AI mode |
| Online-mode lobby setup order | ✅ | Map picked before deck for both online flows (P1 direct-join now fixed to match); P2 never picks a map (by design — one player picks, not two) but sees its name |
| Online mulligan | ✅ | Simultaneous — each player mulligans independently the moment the host's initial state arrives, no dependency on the other. Objectives/first-draw still computed once, by the host, but strictly after BOTH mulligans (doc 04 §1) |
| Deck builder | ⚠️ | 8 hardcoded starter decks; no custom deck building UI |
| Debug panel | ✅ | |

## Open items

- **Deck builder** has no custom-deck UI — only the 8 hardcoded Recommended Decks are playable.
- **`pendingArtyHits`** (the old Artillery-Position "click an enemy to deal 1 hit" targeting
  mode) is fully dormant — no current card triggers it — but not removed, since removing it
  touches UI plumbing beyond any single feature's scope.
- **Stalingrad's terrain art** — see Maps above.
- **Hero roster secrecy (doc 02 Q016)** isn't implemented — both hands and hero rosters sit in
  a world-writable Firebase node with no per-player privacy layer. Meaningful only for online
  play (hot-seat has no secrecy to begin with). Needs a real architecture change (splitting
  private per-player state from the shared public node) to fix properly — not attempted.
- **Doc 02 (Resolved Q&A Decision Ledger, 130 rulings) has now had a full pass** (2026-09-01) —
  see `CHANGELOG.md` for the complete list of what was found and fixed. Two minor items were
  flagged rather than changed: the literal Fuel-before-Draw turn-step order (code does
  Draw-before-Fuel consistently everywhere, no observed gameplay difference), and Hero roster
  secrecy above.
- **A full per-card verification pass (every card's code re-checked against its exact printed
  text) completed 2026-09-01** — all 25 Heroes, all 35 Commands, all 65 Units (every one with
  unique ability text checked individually; the rest cross-checked structurally: 65 units across
  4 classes, no Naval, copy counts matching rarity, no missing stats, no duplicate ids), and all 5
  Objectives' 20 level effects re-verified against doc 04. Found and fixed 4 real bugs:
  - H25 Craft's escalating activation cost was never actually charged (always billed the flat
    printed 5, not the tracked `nextCraftCost`) — same bug in the Hero Zone cost display.
  - The deeper root cause behind that: internal `.js?v=` import version strings had drifted
    inconsistently across files, silently splitting `cards.js` (and others) into several separate
    module instances in the browser, so a dynamically-registered card (`registerGeneratedCard`,
    used by H25 Craft and H19 Training Officer) was invisible to lookups made through a
    differently-versioned import — live-reproduced as an uncaught crash on picking a Craft
    candidate. Every internal import across `digital/js/` and both HTML entry points now shares
    one version string.
  - C15 Command Shuffle wasted 1 Fuel and the card itself when played with zero deployed Heroes
    instead of being blocked pre-cost, unlike every other targeted Command.
  - Overrun (C09)'s "Suppressed enemy deals 1 HQ damage" half never fired (only the "Destroy
    deals 3 instead of 2" half worked, and only by coincidence of the old gate's math); rewired to
    compute the bonus per actual hit outcome instead of off the pre-summed total.
  See `CHANGELOG.md` for full detail on each. `npm test`: 190/190. 4-game selfplay regression
  (mixed decks/maps) post-fix: 0 stalls/timeouts/uncaught errors.
- **A live 2-client multiplayer test pass (2026-09-01) found and fixed a real cross-client
  crash**: Craft (H25) / Training Officer (H19) generate card definitions at runtime that only
  ever existed in the generating client's own memory — Firebase sync only transmitted the bare
  id, so the OTHER client's render threw `Cannot read properties of undefined (reading
  'ability')` the moment a generated card became visible to them. Fixed by adding a
  `generatedCards` dict to shared game state (definitions ride along in every push, merged into
  the receiving client's `CARD_BY_ID` on arrival) and namespacing generated ids by role
  (`Craft-p1-1` vs `Craft-p2-1`) so two clients generating independently never collide. A second,
  independent bug surfaced while fixing this — a crafted card's `copies: Infinity` field made the
  entire Firebase write fail silently once the definition needed to be synced — also fixed
  (removed; copy-limit accounting never applied to a generated id anyway). See `CHANGELOG.md` for
  full detail. Confirmed working (not just "didn't crash") via `multiplayer_craft_test.mjs` and
  the new `multiplayer_dual_craft_test.mjs`, both live against the real Firebase project.
  Everything else checked in that same pass — the open-lobby flow through mulligan into a synced
  board, and the explicit-Exit disconnect flow — was already correct.
- **Online lobby map-before-deck order fixed (2026-09-01)**: P1's code-share flow now shows the
  map-picker before the deck-picker, matching local/AI mode and the open-lobby flow (was the
  reverse order, the one remaining wrong-order case — see Core Systems table above). P2
  deliberately still never gets a map-picker (one player picks, not two) but now sees the map's
  name during its own deck pick, read-only. Live-verified with `multiplayer_codeshare_order_test.mjs`;
  re-ran every other multiplayer test to confirm nothing else broke. See `CHANGELOG.md`.
- **Online mulligan made simultaneous (2026-09-01)**: per direct request — was strictly
  sequential (P1 mulligans, pushes a fully-started game, only then does P2 even see a mulligan
  screen). Both players now mulligan independently the instant the host's initial state arrives;
  objectives/first-draw still computed once by the host, but now after both mulligans instead of
  after only P1's (doc 04 §1). Found and fixed a real bug while live-testing this: the host's new
  mulligan-phase listener reused the existing `_pushId` echo-guard, which doesn't work for the new
  targeted per-player Firebase writes (they never touch that field, so it stays stale and falsely
  matches) — both players would otherwise wait forever, `finishStartGame` never firing.
  Live-verified both possible finish orders with `multiplayer_mulligan_test.mjs`; re-ran every
  other multiplayer test plus a local/AI selfplay regression — all still pass. See `CHANGELOG.md`.

## Verification tools

`npm test` runs `tests/*.test.mjs` (pure-function unit tests, no browser, ~1s, 193/193 passing).
`node selfplay_test.mjs [games]` runs full Playwright-driven self-play games against a local
`npm run dev` server (bot vs bot, catches stalls/timeouts/console errors). `node
selfplay_vs_ai_smoke.mjs` smoke-tests the in-page "vs AI" bot specifically. The bot logic in
`bot_ai.js` is duplicated in `js/bot_player.js` (in-page mode) — update both if they ever drift.
`node open_lobby_test.mjs` / `multiplayer_craft_test.mjs` / `multiplayer_dual_craft_test.mjs` /
`multiplayer_disconnect_test.mjs` / `multiplayer_codeshare_order_test.mjs` /
`multiplayer_mulligan_test.mjs` are two-real-client Playwright scripts against the live Firebase
project (no emulator configured) — need `npm run dev` running first. See
`docs/plans/2026-09-01-multiplayer-test-plan.md` for what each one checks.

## Pointers

- **Keywords** — see `ARCHITECTURE.md`'s "Keyword Resolution Decisions" table for the
  authoritative, up-to-date list and implementation notes. Do not duplicate it here.
- **Card content** — see `js/cards.js` (active) and `js/archive/legacy_cards.js` (archived, with
  manifest) for the authoritative current lists. Do not duplicate them here.
- **History** — see `CHANGELOG.md`.
