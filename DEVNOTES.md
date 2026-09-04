# SIGNAL — Developer Notes

Quick orientation for someone opening the current prototype for the first time. For detailed
rules status, use `STATUS.md`; for historical changes, use `CHANGELOG.md`.

## Run and verify

```sh
npm run dev
npm test
npm run test:browser
```

`npm run dev` starts the repository-owned static server at `http://localhost:3000`.
`npm run test:browser` expects that server to be running. GitHub Actions runs both the unit
suite and browser smoke suite automatically.

## Current module map

| File | Responsibility |
|---|---|
| `js/cards.js` | Active Unit, Hero, Command, and Objective definitions |
| `js/state.js` | Pure state factories and transitions, including unit identity and attack allowances |
| `js/combat.js` | Pure targeting, attack, destruction, keyword, Maneuver, and Craft rules |
| `js/interaction.js` | Pure rules for whether the player may start/cancel another action |
| `js/sync.js` | Pure online revision, remote-normalization, and compatibility helpers |
| `js/ui.js` | Board, hand, Hero, HQ, effects, and battle-log rendering |
| `js/firebase.js` | Firebase reads, subscriptions, lobby writes, and revision-checked game writes |
| `js/decks.js` / `js/deckbuilder.js` | Deck rules, starter decks, and custom deck builder |
| `js/debug.js` | Pure debug-panel state transitions; the panel remains available online for testing |
| `js/bot_ai.js` / `js/bot_player.js` | Shared bot scoring and in-page P2 driver |
| `js/game.js` | Browser controller: setup, turn flow, card dispatch, UI events, and sync orchestration |

The important dependency direction is `cards → state → combat/debug/bot → UI/controller`.
Pure modules do not access the DOM or Firebase, which keeps their rules easy to test.

## Identity and card IDs

Card IDs are strings such as `I1`, `T23`, `H01`, and `C01`. A card ID identifies the printed
definition, not a physical copy. Every deployed Unit also has an `instanceId` such as `unit-7`.
That identity follows the Unit when it Maneuvers and distinguishes two copies of the same card.

`nextUnitInstance` in shared game state supplies these IDs. Older online matches without them
receive deterministic `legacy-unit-row-col` compatibility IDs when loaded.

## Modifier lifetimes

Do not use a large turn count as a substitute for permanence.

| Field | Lifetime |
|---|---|
| `tempSideBonus` | Until the current turn ends |
| `grantedSideBonus` + `sideBonusTurns` | Until the relevant future owner-turn refresh |
| `permanentSideBonus` | Rest of the match |
| `objSideBonus` | Recomputed from Objectives |
| `dynamicSideBonus` | Recomputed from live Inspire/Muster relationships |
| `debugSideBonus` | Until a tester changes it |
| `perm_n/e/s/w` | Permanent, printed-side-relative H24 bonus |

`getSideValue()` is the authoritative sum. Remote normalization migrates the retired
`sideBonusTurns: 99` representation into `permanentSideBonus`.

## Attack allowance

The Unit object is the only attack authority:

- `persistentSpent` records ordinary/Double Attack uses.
- `tempExtraAttacks` and `tempExtraAttacksSpent` record temporary additional attacks.
- `remainingAttacks()`, `spendAttack()`, and `resetPersistentAttacks()` are the shared API.

There is no second tile-keyed attack map. Because the counters live on the Unit, Maneuver
naturally carries its attack history with it.

## UI decisions

`uiState` describes the current board-click mode. `getInteractionDecision()` combines that
with pending Objective/Artillery choices, blocking modals, Hero repositioning, and online-sync
status. Mandatory choices cannot be dismissed through the generic Cancel button; voluntary
targeting can be cancelled.

`getInteractionGuide()` is the pure presentation sibling of that lock decision. `redraw()`
renders its action/next-click/cancel guidance into the persistent `#mode-banner` for every
multi-step interaction. Keep target colours semantic: green = legal placement, red = destructive
or enemy target, blue = movement/friendly utility, gold = required choice. Multi-step flows keep
the chosen source highlighted until resolution. Attack inspector text comes from
`describeAttackOutcome()` in `ui.js`, which delegates hit rules to `applyHit()`; do not duplicate
Suppression/Armor/Guard damage rules in `game.js`.

## Online state safety

Lobby setup still uses narrow or pre-game writes. Once a shared game snapshot exists, every
full gameplay update has a monotonically increasing `_revision` and is committed with a Firebase
transaction. A write succeeds only when the server still has the revision on which it was based.

If a stale update loses that comparison, it cannot overwrite the newer move. The client reloads
the server snapshot and displays a retry message. If connectivity fails, gameplay actions pause
until a shared snapshot is received again. `_pushId` still filters a client's own subscription
echoes; revision comparison also prevents an older echo from rolling optimistic local state back.

This prevents accidental lost updates. It is not player authentication or private-hand security;
those require Firebase rules and a different public/private data layout.

## Retired content

Missions, old numeric-ID cards, Mobile Command Halftrack, Radio Operator, Supply Runner,
Quartermaster, and reactive Empty-Board HQ Strike belong to earlier prototypes. Their history is
preserved in `js/archive/`, archived tests, and Git, but they are not runtime branches in the
current string-ID Set 1 game.

## Safe change checklist

1. Use string card IDs and the shared `CARD_BY_ID` registry.
2. Create deployed Units with `createBoardUnit()`.
3. Use attack/modifier helpers instead of adding a parallel counter.
4. Route a new suppression source through the ordered `UNIT_SUPPRESSED` event.
5. Add new remote array fields to normalization.
6. Keep every local runtime import on the shared `?v=2026090402` cache version.
7. Run `npm test`; add a browser scenario when DOM or multiplayer behavior changes.
8. Do not deploy or merge into the protected client-testing repository without explicit approval.
