# Match Statistics Plan — Review Amendments

**Date:** 2026-09-16  
**Base plan:** `docs/plans/2026-09-16-match-statistics.md`  
**Code reviewed against:** `playfulananas/Signal-internal` commit `d2d02fe`

## Authority

This file is an **authoritative amendment** to `2026-09-16-match-statistics.md` after a code-level review. Implement the base plan, but whenever this file conflicts with the base plan, **this file wins**.

The locked product decisions in the base plan do not change:

- Every finished match is saved.
- Include is host-only and unticked by default.
- Guard blocks, replay logs and UI click tracking remain out of scope.
- Self-play records go to local JSONL only, never Firebase.
- Stats recorders remain no-op-safe, immutable and error-swallowing.

The existing find/replace anchors in Tasks 5, 7, 8, 9, 10, 12 and 13 were checked against `d2d02fe` and are otherwise valid at their stated occurrence counts. The amendments below fix concrete correctness problems discovered in the real code.

---

## Amendment 1 — Direct HQ lethal must stop the turn pipeline immediately

**Overrides:** Task 7 Step 9 and the Known Limit saying lethal Direct HQ may count the next turn.

### Problem

The current End Turn pipeline applies Direct HQ, then continues through:

1. `endTurn()`
2. opponent draw
3. `startOfTurn()`
4. objective level/control
5. `applyObjectiveEffects()`
6. only then `checkWin()`

If Direct HQ is lethal, the dead player's next turn and Objective effects must not happen. In the current code they can happen and can even change the eventual winner.

Example: P1 ends turn, Direct HQ kills P2, but P2's newly-started Objective backbone then kills P1 before `checkWin()`. The existing `checkWin()` tests P1 first and can award the win to P2 even though P1 dealt lethal first.

### Required plan change

In the End Turn handler, after:

- `evaluateDirectHQ`
- applying Direct HQ damage to both HQs
- `recordHqDamage(..., 'directHq')`
- `recordDirectHq(...)`
- recording the ending player's turn row

check whether either HQ is `<= 0` **before** `expireTempFuelGrant`, `endTurn`, draw, `startOfTurn`, Objective control, Objective effects, Hero phase or bot turn.

If Direct HQ is lethal:

- commit/persist exactly that terminal state,
- keep the Direct HQ log / transition effects,
- do not advance `state.turn`,
- do not start the opponent's turn,
- do not trigger any Objective or Hero-phase work,
- then enter the normal game-end flow.

Remove the old Known Limit about lethal Direct HQ already counting the next turn. After this correction, `turnsPlayed` must describe the actual terminal turn.

### Regression test required

Add an integration/unit-level test around the End Turn pipeline proving:

- P2 begins at 1 HQ,
- P1 has a Direct HQ conversion available,
- P2 controls an Objective that would damage P1 if P2's turn started,
- ending P1's turn gives P1 the win,
- P2's Objective never activates,
- `state.turn` is not incremented past the lethal turn,
- no post-lethal Objective stats are recorded.

---

## Amendment 2 — Online normal-match records are written by the host, from authoritative state

**Overrides:** Task 9 Steps 3-4 and Task 10 documentation saying the "committing client" writes normal online matches.

### Problem

`commitState()` applies state locally and queues `pushVersionedState()`. The Firebase transaction can later reject because the expected revision lost a race. The base plan calls `checkWin()` immediately after the local commit and can write `stats/matches/{matchId}` before the gameplay transaction is known to have committed.

That can create a permanent finished-match record for a terminal state Firebase rejected.

A per-client `statsFinalized` boolean does not solve this because it only prevents duplicate attempts inside one browser.

### Required ownership rule

For **normal HQ endings in online play**, use a single writer:

- **P1 / host writes the match record.**
- P2 never writes a normal HQ-ended Firebase match record.
- P2 may still show its end screen immediately.

This matches the existing host-owned include/note controls and prevents cross-client duplicate writers.

For **disconnect endings**, the surviving client may write the disconnect record, because the host may be the client that disappeared.

For local/vs-AI, the single local client writes as before.

### Authoritative-state rule

Do not write an online normal-match record from a speculative local state.

- If **P2 deals lethal**, P1 writes only after P1 receives and accepts the terminal remote snapshot through the existing revision/sync path.
- If **P1 deals lethal**, P1 writes only after the corresponding `pushVersionedState()` transaction has actually committed successfully.
- If that transaction is rejected, do **not** write a match record for the rejected local state.

Use the existing `pushVersionedState()` resolved value / success path as the authority signal. Do not add polling or timers.

### Smallest implementation shape

It is acceptable to extend the existing online commit plumbing so the caller can know when the versioned transaction committed, or to centralize the terminal-host write in the existing `pushVersionedState(...).then(...)` success branch. Do not replace the current revision-check architecture.

### Regression tests/manual verification required

1. Online P2 deals lethal: only P1 writes `stats/matches/{matchId}`.
2. Online P1 deals lethal: the record is written only after transaction success.
3. Simulate/reproduce a `state-conflict` on a locally terminal update: no match record is written for the rejected state.
4. Both clients may render the end screen, but there is only one Firebase match record.

---

## Amendment 3 — Match duration must not subtract clocks from different machines

**Overrides:** Task 4 `buildMatchRecord` duration derivation and Task 9 finalization arguments.

### Problem

The base plan stores `startedAt` from the host and derives `durationMs` as:

```js
endedAt - stats.startedAt
```

If a non-host client ever builds a record (notably disconnect handling), those timestamps can come from different machine clocks. Clock skew can make the duration inaccurate or negative.

Even with host-only normal online writes, disconnect records can still be written by P2.

### Required change

Keep `startedAt` as the host wall-clock timestamp used for sorting/display, but measure duration using a **local elapsed timer on each client**.

Add module state such as:

```js
let matchStartedAtMs = null;
```

Set it when that client first enters the actual playable match (`readyForPlay === true`):

- host/local: when `finishStartGame` makes the game playable,
- online P2: when the first playable `readyForPlay` state is accepted.

At finalization compute local elapsed duration from the same client clock and pass it explicitly into `buildMatchRecord`.

Change `buildMatchRecord` to accept a `durationMs` override instead of deriving duration solely from `endedAt - startedAt`. `endedAt` can remain a wall-clock timestamp for display.

If local elapsed timing is unavailable, omit `durationMs` rather than manufacture a cross-device subtraction.

### Tests required

Add a `buildMatchRecord` test showing that an explicit `durationMs` is preserved even when `endedAt - startedAt` would be different.

---

## Amendment 4 — Record the terminal half-turn for mid-turn lethal endings

**Overrides:** Task 7 Step 9 / Task 9 finalization assumptions.

### Problem

`recordTurnEnd()` is only planned inside the End Turn button path. Many games end before End Turn:

- Unit attack
- Blast/Barrage secondary destruction
- H15
- H17
- C19
- self/fatigue damage caused during a Command/H20 chain
- other current `checkWin()` call sites

Those terminal turns would be missing from `stats.turns`, and the acting player's final unspent Fuel would also be missing from the cumulative `fuelUnspent` counter.

This biases Avg turn length and Avg unspent Fuel per turn.

### Required change

Add one helper around the game controller, e.g. `recordTerminalTurnIfNeeded(s)`, that:

- does nothing without `state.stats`,
- checks whether the state is terminal (`p1.hq <= 0 || p2.hq <= 0`),
- checks whether `stats.turns` already has a row for the current `(turn, initiative)` pair,
- if missing, calls `recordTurnEnd` with current player, current Fuel and local `turnStartedAtMs` when known,
- returns a new state without mutating input.

Call this **before a terminal state is committed/pushed**, so the row travels inside the authoritative synced game state. The Direct HQ End Turn branch from Amendment 1 already records the turn; the helper must therefore deduplicate by `(turn, player)`.

Do not wait until `buildMatchRecord()` to invent this row, because the acting client's local timer is the best available source and the authoritative terminal state should carry the final turn record online.

### Tests required

Add tests proving:

- a mid-turn lethal attack adds one terminal turn row,
- calling the helper twice does not duplicate it,
- an End-Turn lethal path that already recorded the row stays at one row,
- unknown timer omits `ms` but still records Fuel/HQ values.

---

## Amendment 5 — H16 Cancel must restore the activation stats and Fuel

**Overrides:** Task 8 Step 5 for targeted Hero activation and the related Cancel assumptions.

### Problem

The base plan records targeted Hero activation immediately after the pre-activation snapshot. That is generally correct because Cancel restores `preCommandState`.

H16 is a two-step exception. In the current code `resolveHeroTargeting()` clears `preCommandState` before handing off to `hero-maneuver-destination`. The destination step is still cancellable. Therefore:

1. H16 is activated; Fuel and stats activation are recorded.
2. Player selects the source Unit.
3. `preCommandState` is cleared.
4. Player presses Escape while choosing the destination.
5. There is no snapshot left to restore.

The activation can remain counted even though the Hero power never resolved.

### Required change

For H16 only, preserve the original pre-activation `preCommandState` through the source-selection handoff into `hero-maneuver-destination`.

- Do not clear it when the H16 source Unit is selected.
- Clear it only after `resolveHeroManeuverDestination()` successfully commits the completed maneuver.
- Existing Cancel should then restore Fuel, consumed cost modifiers and the provisional stats activation together.

Do not change H01/H25: their pay/lock activation is intentionally committed before their mandatory picker modals.

### Tests required

Add a controller/integration test for:

- activate H16,
- choose a source Unit,
- cancel at destination step,
- Fuel is restored,
- cost modifiers are restored if applicable,
- H16 `activations` / `fuelSpent` stats are not incremented,
- H16 is still available to activate afterward.

---

## Amendment 6 — H19 buffed clones keep the original printed card statistics identity

**Overrides:** Task 2 Step 1/3 `statsCardKey` behavior and Task 4 card derivation assumptions.

### Problem

`applyHandBuff()` implements H19 Training Officer by replacing each qualifying card in hand with a generated clone registered through `registerGeneratedCard()`.

The base plan's `statsCardKey()` maps generated cards to `CRAFTED` or `GENERATED`. That means an H19-buffed Rifle Squad no longer contributes its play/dead-in-hand stats to `I1`; it appears as a fake generated card row instead.

This corrupts card play rate, Fuel, average round played, dead-in-hand and win-when-played metrics whenever H19 is used.

### Required change

Give H19-generated clones an explicit printed-card identity, e.g.:

```js
statsBaseId: card.statsBaseId ?? card.id
```

when `applyHandBuff()` creates the clone.

Then make `statsCardKey()` resolve in this order:

1. if the known card has `statsBaseId`, return that,
2. else if it is a Craft generated card (`craftDrawback`), return `CRAFTED`,
3. else handle any other intentionally grouped generated type,
4. else return the normal card ID.

The field must travel inside the generated card definition so online clients preserve the same identity.

Do not infer all `Craft-*` unknown IDs as H19 clones; the unknown-ID fallback remains Craft-safe for genuinely unknown remote Craft cards.

### Tests required

Add tests that:

- H19 buffs `I1`, the generated clone's `statsCardKey` is still `I1`,
- playing the H19 clone increments `cards.I1.played`, not `GENERATED`/`CRAFTED`,
- leaving the H19 clone in hand increments `I1.inHandAtEnd`,
- a real H25 crafted Aircraft still maps to `CRAFTED`.

---

## Amendment 7 — Failed match-record writes must be retryable

**Overrides:** Task 9 Step 3 `statsFinalized` behavior.

### Problem

The base plan sets:

```js
statsFinalized = true;
```

before the Firebase `writeMatchRecord()` succeeds. A temporary network/auth/permission failure then leaves no Firebase record and no way to retry because later calls immediately return.

That conflicts with the locked requirement that every finished match is saved.

### Required change

Separate **record built** from **record persisted**.

Suggested module state:

```js
let pendingStatsRecord = null;
let statsRecordSaved = false;
let statsWriteInFlight = false;
```

Rules:

- Build the record once and keep it in `pendingStatsRecord`.
- Self-play still exposes it through `window.__SIGNAL_STATS__` and never calls Firebase.
- Do not mark `statsRecordSaved` until `writeMatchRecord()` resolves successfully.
- If the write fails, keep the same pending record and allow retry.
- Reusing `set(stats/matches/{matchId})` with the same record is idempotent.
- Prevent concurrent duplicate requests with `statsWriteInFlight`, not with a permanent pre-success flag.

The end-screen status should expose a retry action or reuse an explicit Save/Retry button for the record write when it failed. Saving include/note must not be treated as retrying the missing match record unless the implementation explicitly performs both.

### Manual verification required

Force a failed stats write, restore connectivity/permission, retry, and confirm exactly one `stats/matches/{matchId}` record exists.

---

## Amendment 8 — H21 capped Fuel loss belongs in `fuelLostToCap`

**Overrides:** Task 5 Step 4.

### Problem

H21 Emergency Logistics Officer grants +1 Fuel through normal capped `gainFuel()`. The base plan only measures lost-to-cap Fuel around the normal start-of-turn +3 step.

If H21 triggers while the player is already at their cap, its +1 gain is lost but never counted in `fuelLostToCap`.

### Required change

Task 5's H21 hook must also measure cap loss:

1. snapshot Fuel immediately before `gainFuel(s[active], 1)`,
2. call `gainFuel`,
3. compute `actualGain = fueled.fuel - fuelBefore`,
4. call `recordFuelLostToCap(..., active, 1 - actualGain)` when positive,
5. then apply/record H21's self-inflicted HQ damage as already planned.

Update the Task 5 stats import accordingly to include `recordFuelLostToCap`.

### Tests required

Extend `stats_combat.test.mjs` with:

- H21 below cap: +1 Fuel, lost-to-cap remains 0,
- H21 at cap: Fuel unchanged and `fuelLostToCap` increments by 1,
- H21 with H02's raised threshold: use the real effective threshold, not a hard-coded 9.

---

## Additional required verification changes

### Task 10 self-play sanity checker

Keep the existing `other != 0` check, and add basic invariants that catch these review regressions:

- exactly one turn row per `(turn, player)` pair,
- no negative `durationMs`,
- for a non-debug HQ-ended match, no `hqDamageTaken.other`,
- `turnsPlayed` must be at least the maximum recorded turn and must not reflect a post-lethal phantom turn,
- no ordinary printed card should be replaced by a `GENERATED` stats row solely because H19 buffed it.

Do not require every player to have played a card; a legitimate very-short match or future test scenario may violate that. Treat "played no cards" as informational, not a hard failure, unless the self-play harness itself guarantees a minimum sequence.

### Task 10 live online verification

Add one two-browser online test in addition to the local Firebase test:

1. P1 hosts, P2 joins.
2. Let P2 produce the lethal action.
3. Both clients show the end screen.
4. Exactly one match record exists.
5. P1 is the normal-match Firebase writer and sees include/note controls.
6. Reload stats data: record and meta are still separate and intact.

Also test P1 lethal and verify the record appears only after the versioned gameplay transaction commits.

### Known limits — corrected list

Keep:

- abandoned matches/tab closed mid-game produce no record,
- turn duration is measured on the acting client's clock and includes Hero deploy/modal time; unknown starts omit `ms`,
- win rates only count decided HQ-destroyed matches; disconnects are excluded,
- build label is manual and rules hash only covers card/map data,
- Firebase page currently downloads all records.

Remove:

- "after a lethal Direct HQ it already counts the next turn" — this is not an accepted limit; Amendment 1 fixes it.

Add:

- online normal-match persistence is host-owned; disconnect persistence is owned by the surviving client,
- `endedAt` is a wall-clock timestamp for display, while `durationMs` is local elapsed time and may be omitted if the local start was not observed.

---

## Required implementation order

Use the original task order, with these corrections inserted before the affected task is considered complete:

1. Tasks 1-2, including Amendment 6's stats identity support.
2. Tasks 3-4, including explicit `durationMs` support and terminal-turn helper tests.
3. Task 5, including Amendment 8.
4. Task 6 unchanged except that write helpers must remain retry-safe/idempotent.
5. Task 7, including Amendment 1 and terminal-turn handling.
6. Task 8, including Amendment 5 and H19 identity propagation.
7. Task 9, using Amendment 2 host-authoritative online persistence and Amendment 7 retry semantics.
8. Task 10, including the expanded sanity checks and two-browser online verification.
9. Tasks 11-13 as written; their aggregation math, decided-only win-rate handling and CSV escaping were reviewed and are sound.

Before coding each affected area, re-read the live surrounding function. Do not blindly apply a replacement if earlier tasks changed the anchor.
