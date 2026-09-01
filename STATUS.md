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
all built and tested. A shared destruction chain
(`resolveDestructionChain`/`applyPostDestructionEffects` in combat.js) is the single path for
Last Stand/Breakthrough/HQ-damage-replacement, used by both combat and self-destruct Commands. A
persistent+temporary attack-allowance model (`remainingAttacks`/`spendAttack` in state.js) has
locked consumption order: persistent first, then temporary; an explicit reset restores persistent
only. Direct HQ (`evaluateDirectHQ` in combat.js) is the sole end-of-turn HQ-conversion
mechanism, wired into the End Turn handler. Suppression deals 0 HQ damage; Destroy deals 2.

`bot_ai.js`'s Command/Hero-Power/Objective scoring is fully mapped to the current id scheme,
matched by each card's actual effect text.

## Objectives

`applyObjectiveEffects` (game.js) implements the real O1-O5 scheme: a universal 1/1/2/2 HQ
backbone by level, resolved before each Objective's own secondary effect, with an immediate
lethal-stop that also cancels that Objective's own secondary and any later Objective in scan
order. Multiple simultaneously-controlled Objectives resolve in fixed column-major board order.
All 5 Objectives' L1-L4 secondary effects execute for real. Objective identities randomize into
fixed per-map slots after mulligan (`finishStartGame`), unique per map.

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
| Online-mode lobby setup order | ⚠️ | Deck still picked before map (P1 direct-join); P2 never sees a map-picker in either online flow. Known gap, not fixed — see Open Items below. |
| Deck builder | ⚠️ | 8 hardcoded starter decks; no custom deck building UI |
| Debug panel | ✅ | |

## Open items

- **Online lobby setup order** doesn't match doc 04 §1's locked "map before deck" sequence for
  P1's direct-code-join or for P2 in either online flow. Not fixed — restructuring the Firebase
  lobby handshake timing needs a live 2-client test session to verify safely. Confirmed still
  exactly this (not worse) via a live 2-client Playwright run, 2026-09-01.
- **Craft (H25) / Training Officer (H19) crash the OTHER client in online play** —
  `registerGeneratedCard`'s dynamically-created card definition is never transmitted through
  Firebase, only its bare id. Confirmed via a live 2-client test, 2026-09-01: placing a crafted
  Aircraft throws `Cannot read properties of undefined (reading 'ability')` on the receiving
  client. A real fix needs an architecture decision (what to embed in synced state, how to
  namespace `Craft-N` ids so two independent clients crafting in the same match don't collide —
  see `CHANGELOG.md` for detail) — not attempted yet.
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

## Verification tools

`npm test` runs `tests/*.test.mjs` (pure-function unit tests, no browser, ~1s, 190/190 passing).
`node selfplay_test.mjs [games]` runs full Playwright-driven self-play games against a local
`npm run dev` server (bot vs bot, catches stalls/timeouts/console errors). `node
selfplay_vs_ai_smoke.mjs` smoke-tests the in-page "vs AI" bot specifically. The bot logic in
`bot_ai.js` is duplicated in `js/bot_player.js` (in-page mode) — update both if they ever drift.

## Pointers

- **Keywords** — see `ARCHITECTURE.md`'s "Keyword Resolution Decisions" table for the
  authoritative, up-to-date list and implementation notes. Do not duplicate it here.
- **Card content** — see `js/cards.js` (active) and `js/archive/legacy_cards.js` (archived, with
  manifest) for the authoritative current lists. Do not duplicate them here.
- **History** — see `CHANGELOG.md`.
