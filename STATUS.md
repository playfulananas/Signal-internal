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
| Firebase multiplayer | ✅ | Gameplay snapshots use revision-checked transactions; stale writes refresh the latest shared state instead of overwriting it, and connection/conflict status is visible |
| Local-mode lobby setup order | ✅ | Map picked before deck(s), local hotseat + AI mode |
| Online-mode lobby setup order | ✅ | Map picked before deck for both online flows (P1 direct-join now fixed to match); P2 never picks a map (by design — one player picks, not two) but sees its name |
| Online mulligan | ✅ | Simultaneous — each player mulligans independently the moment the host's initial state arrives, no dependency on the other. Objectives/first-draw still computed once, by the host, but strictly after BOTH mulligans (doc 04 §1) |
| Deck builder | ✅ | 8 Recommended Decks plus custom deck/4-Hero-roster build, validation, local save, and Firebase backup |
| Debug panel | ✅ | Deliberately retained for both local and online testing; online edits use the same revision-checked commit path as normal actions |

## Player guidance and UI feedback

Every multi-step board/Hero action has a persistent action guide that states what is being
resolved, what to click next, and whether it can be cancelled. Target colours use one semantic
language: green for placement, red for destructive/enemy targets, blue for movement/friendly
utility, and gold for required choices. Selected Maneuver and Coordinated Strike source Units
remain highlighted through the next step; Radio Interference highlights its eligible enemy Hero
targets.

Hand cards that cannot be paid for with current Fuel are visibly dimmed, their cost is red, and a
tooltip reports the exact shortfall. Attack hover previews use the same `applyHit()` result as
combat resolution, including Armor absorption, 0-damage Suppression, 2-damage destruction, Guard
prevention, and Overrun's extra damage.

## Open items

- **Online privacy/security:** gameplay state is revision-safe against accidental stale
  overwrites, but hands and Hero rosters are still stored in the shared match node. Proper secrecy
  needs authenticated per-player private state and stricter Firebase rules; that production-facing
  change was deliberately not attempted in this internal branch.
- **Browser verification:** GitHub Actions is configured to install Chromium and run the deck
  builder plus in-page AI smoke tests. This workspace timed out while downloading Playwright's
  Chromium binary, so that browser pass remains to be observed in CI after the internal branch is
  pushed.
- **Stalingrad terrain art:** see the low-priority cosmetic note in Maps above.
- **Turn-step wording:** code consistently draws before Fuel gain; the rules ledger literally lists
  Fuel before Draw. No gameplay difference has been observed, but changing this should be a
  deliberate rules decision.

Artillery Position L2/L4 targeting is active, not dormant: `pendingArtyHits` carries the required
hits across clients until the controlling player resolves them.

## Verification tools

`npm test` runs `tests/*.test.mjs` (pure-function and lightweight DOM-contract tests, no browser,
233/233 passing).
`node selfplay_test.mjs [games]` runs full Playwright-driven self-play games against a local
`npm run dev` server (bot vs bot, catches stalls/timeouts/console errors). `node
selfplay_vs_ai_smoke.mjs` smoke-tests the in-page "vs AI" bot specifically. Pure move scoring in
`bot_ai.js` is shared by the in-page bot and the test harness; `bot_player.js` drives the browser
through the same controls a human uses.
`node open_lobby_test.mjs` / `multiplayer_craft_test.mjs` / `multiplayer_dual_craft_test.mjs` /
`multiplayer_disconnect_test.mjs` / `multiplayer_codeshare_order_test.mjs` /
`multiplayer_mulligan_test.mjs` are two-real-client Playwright scripts against the live Firebase
project (no emulator configured) — need `npm run dev` running first. See
`docs/plans/2026-09-01-multiplayer-test-plan.md` for what each one checks.

GitHub Actions runs `npm test` and `npm run test:browser` on pushes and pull requests. The browser
job installs Chromium before starting the repository-owned local server.

## Pointers

- **Keywords** — see `ARCHITECTURE.md`'s "Keyword Resolution Decisions" table for the
  authoritative, up-to-date list and implementation notes. Do not duplicate it here.
- **Card content** — see `js/cards.js` (active) and `js/archive/legacy_cards.js` (archived, with
  manifest) for the authoritative current lists. Do not duplicate them here.
- **History** — see `CHANGELOG.md`.
