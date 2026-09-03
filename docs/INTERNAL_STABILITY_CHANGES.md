# SIGNAL Internal Stability Changes — Plain-Language Guide

This guide explains the stability and architecture work on the internal prototype without
assuming coding experience.

## Safety boundary

All work is isolated on the `codex/stability-and-architecture` branch of
`playfulananas/Signal-internal`.

- The client-testing repository, `Shonetronic/Signal`, has not been changed.
- The client-facing GitHub Pages site has not been deployed or changed.
- Nothing has been merged into a live branch.
- The debug panel remains available, including in online games, because this version is still
  used for testing.

## What changed and why

| Change | What it means in everyday language | Why it matters |
|---|---|---|
| One shared module version | Every part of the browser now loads the same copy of the card and rules data. | Prevents rare crashes where one screen could not see a card created by another part of the game. |
| String card IDs everywhere | Cards consistently use IDs such as `H25` and `C09`, including custom decks. | Stops the old and new card-number systems from being mixed accidentally. |
| One attack record | A Unit itself remembers how many attacks it has used. There is no second board-square record that can disagree. | Moving a Unit now carries its correct attack history with it. |
| Choice locks | While the game is waiting for a required target, direction, Objective choice, or modal answer, another action cannot start and the turn cannot end. | Prevents half-finished actions, lost costs, and confusing overlapping prompts. |
| Ordered suppression events | Every effect that suppresses a Unit goes through the same event sequence. | Hero reactions such as H06 behave consistently regardless of which card caused the suppression. |
| Automated checks | Unit tests and two important browser journeys are configured in GitHub Actions. | Each internal branch update can be checked before anyone considers merging it. |
| Retired code removed from the live path | Old Missions, numeric-card branches, and the retired reactive Empty-Board HQ Strike no longer sit beside current rules. | Reduces the chance that an obsolete rule is triggered by mistake; its history remains in archives and Git. |
| Revision-checked online saves | Each shared match update has a revision number. Firebase accepts it only if it was based on the latest saved version. | Two nearly simultaneous clicks can no longer silently overwrite one another; the losing client refreshes and asks the player to retry. |
| Real permanent bonuses | Permanent stat bonuses have their own field instead of pretending to last for 99 turns. | Permanent and temporary bonuses can coexist and expire correctly. |
| Physical Unit identity | Every deployed copy gets an instance ID such as `unit-7`, separate from its printed card ID. | Two copies of the same card remain distinguishable, even after Maneuver moves one of them. |
| Runtime cleanup | Missions and other retired prototype branches were removed from active UI, bot, and state logic. | The running game now describes the current Set 1 rules more clearly. Historical material was not erased. |

## What a tester should notice

Most of this work is preventative, so the game should feel familiar. The visible differences are:

- required choices must be completed before starting something else or ending the turn;
- an online conflict or connection interruption shows a clear status message and temporarily
  pauses actions;
- after a conflict, the latest shared game is restored and the player can retry;
- Units keep the correct attacks and bonuses after moving;
- the debug panel is still present and uses the same safer online save route as normal actions.

## What this work does not do

Revision checking prevents accidental stale overwrites, but it is not a security system. The
current Firebase layout still needs a separate future design for player authentication,
private hands/rosters, and stricter database rules. No Firebase security-rule or production
configuration change is part of this branch.

This work also does not publish anything. The safe rollout path is:

1. Push only the internal feature branch.
2. Let automated checks run there.
3. Review and play-test the internal version.
4. Merge or deploy only after explicit approval.

## Verification status

- Pure rules suite: 226 tests passing locally.
- Browser smoke tests: configured for GitHub Actions, including installing Chromium there.
- Local browser run: still pending because this workspace timed out while downloading Playwright's
  Chromium binary; the repository and CI configuration were unaffected.
