# SIGNAL Digital Prototype — Changelog

Append-only history of implementation work. Entries are never edited after the fact to reflect a
later change — add a new entry instead and let the reader see the sequence. **For what's true
right now, see `STATUS.md`, not this file** — STATUS.md states current facts only and gets
edited in place; this file is the "how did we get here" record.

Newest first.

---

## 2026-09-01 — Multiplayer test pass: confirmed a real cross-client crash for Craft/Training Officer

Wrote and ran two Playwright two-context scripts (`multiplayer_craft_test.mjs`,
`multiplayer_disconnect_test.mjs` — new, checked in alongside the existing `open_lobby_test.mjs`,
whose deck-picker selectors were also stale from before the Run 1 deck-name migration and are now
fixed) against the live Firebase project per `docs/plans/2026-09-01-multiplayer-test-plan.md`.

- **Confirmed, live-reproduced bug**: a Craft-generated Aircraft (H25) placed on the board in an
  online match crashes the OTHER client with `Cannot read properties of undefined (reading
  'ability')`. Root cause: `registerGeneratedCard` (combat.js) only writes the new card's
  definition into the CRAFTING client's own in-memory `CARD_BY_ID` — `pushState` (firebase.js)
  only ever transmits the bare card id (e.g. `"Craft-1"`) as part of the board/hand state, never
  the definition. The receiving client's `CARD_BY_ID['Craft-1']` is `undefined`, and rendering
  that board tile dereferences it. Verified directly: after the host crafted and placed `Craft-1`,
  `await joiner.evaluate(() => CARD_BY_ID['Craft-1'])` came back `undefined` on the joiner's page,
  with the exact console error above. Same exposure applies to Training Officer (H19)'s hand-buff
  clones, which use the same `registerGeneratedCard` mechanism.
- **Compounding risk found by inspection, not yet independently live-tested**: `cards.js`'s
  `nextGeneratedCardSeq` counter is a plain per-page `let` starting at 1 on every load — not
  derived from shared match state. Two independent clients each crafting/buffing once in the same
  match would each produce a card literally named `Craft-1` with unrelated stats, so a fix that
  just "transmits the definition and re-registers by id" isn't sufficient on its own; the id
  needs to be made unique across both clients too (e.g. namespaced by role, or derived from a
  counter that's part of the synced state rather than local to each page).
- **Confirmed working correctly**: the open-lobby happy path end-to-end through mulligan and into
  a live, synced board (both the existing smoke test and the new scripts); the explicit-Exit
  disconnect flow (`multiplayer_disconnect_test.mjs` — the other client correctly shows "OPPONENT
  DISCONNECTED"); Fuel/Hero-zone-deployment state pushed via the debug panel syncing correctly to
  the other client once given time to settle (see next point).
- **Test-script-only gotcha worth recording**: a raw local-state mutation immediately after
  reaching the live board can get silently wiped by an in-flight incoming Firebase replace — both
  players' mulligan confirmations push a full state replace (`commitState` pushes regardless of
  whose "turn" it conceptually is), and if the other side's mulligan-triggered push is still in
  flight when a script does a same-tick local mutation, `receiveRemoteState`'s full replace
  clobbers it a moment later. Not a game bug — `commitState`'s always-push behavior is correct —
  just something a synced-two-client test needs to wait out (a short settle delay after both
  sides reach the board) rather than something to "fix."
- Not yet fixed — this needs an actual architecture decision (what gets embedded in synced state,
  how ids get namespaced) before writing the fix, so it's left as a confirmed, reproducible open
  item rather than a same-session patch.

## 2026-09-01 — Card-by-card verification pass, Commands: C15 zero-target waste + C09 Overrun's Suppress bonus never fired

Continuing the per-card verification (Heroes done, moving through the 35 Commands): found and fixed
two more real bugs, both confirmed live via Playwright, neither caught by `npm test` because both
live in game.js's DOM-driven code rather than a pure function.

- **C15 Command Shuffle wasted 1 Fuel and the card itself when played with zero deployed Heroes,
  instead of being blocked.** Every other targeted Command in the codebase (the 15 routed through
  `getCommandTargets`/`startCommandTargeting`, plus C06/C21/C27/C35's dedicated flows, plus the
  enemy-Hero-targeting command) checks for a legal target BEFORE deducting Fuel/removing the card
  from hand — matching doc 01 §26's "a Command with a target-dependent effect and zero legal
  targets is illegal to play at all" rule. C15 was the one exception: it's handled inline inside
  `playInstantCommand`'s switch, which deducts Fuel/hand *before* the switch runs; its own case
  only discovered "no deployed Hero to move" after that deduction already happened, logged a
  message, and let the wasted state commit anyway. Fixed by adding the same pre-flight check
  (`click handler, before playInstantCommand is even called for C15) as every other special-cased
  Command already has. Live-verified: playing C15 with an empty Hero roster now leaves Fuel and
  hand untouched, with the same "no deployed Hero to move" log line as before.
- **Overrun (C09)'s "enemy Units Suppressed... deal 1 HQ damage" half never fired — only the
  "destroyed... deal 3 instead of 2" half worked, and only by coincidence.** The bonus was gated
  on `dmgP2 > 0` before adding +1 — which is true for a Destroy (base 2) but always false for a
  Suppress (base 0), so a Suppress under Overrun stayed at 0 HQ damage instead of becoming 1. The
  gate also worked on the pre-summed total rather than per-hit, meaning a Blast/Barrage attack
  that suppressed multiple units in one resolution would only ever get a flat +1 regardless of
  how many qualifying hits landed. Rewired to inspect `resolveSingleAttack`'s actual
  `boardMutations` (which already includes any Blast/Barrage secondary hits) and apply the bonus
  per qualifying hit: `newUnit === null` (just destroyed) or `newUnit.state === 'suppressed'` with
  the pre-hit state not already suppressed (just suppressed) each independently add 1 HQ damage to
  the right side. Live-verified the Suppress case end-to-end (Overrun played, an attack that only
  Suppressed the defender, P2's HQ dropped from 30 to 29 with a matching "Overrun: +1 HQ damage
  (suppress)" log line — previously stayed at 30). The Destroy case (2→3) uses the identical
  per-mutation branch and was already the one working path pre-fix, so it's verified by
  code-symmetry rather than re-clicked through live.
- No unit tests added for either fix — both live entirely in game.js's DOM-orchestration layer
  (click handlers, `playInstantCommand`'s switch), which isn't part of the pure-function test
  suite, consistent with the H25/module-fragmentation fix below. Live Playwright re-runs are the
  verification for both.

## 2026-09-01 — Card-by-card verification pass: module-instance fragmentation bug (live crash) + H25 cost bug

Started a full per-card audit (every Hero's code checked against its exact printed ability text,
not just "does a case exist") as a follow-up to the doc 02 pass below. Found two real bugs, one of
them a live, reproducible crash:

- **H25 Chief Aircraft Engineer's escalating cost (5→4→3→2→1, floor 1) was never actually
  charged.** `tryActivateHero` (game.js) computed cost from the card's static printed
  `activeCost` (always 5) instead of `nextCraftCost(ps)` — the tracked, advancing value only ever
  got *read* for the post-craft log line ("next activation costs 4"), never for what Fuel was
  actually deducted. The Hero Zone UI (`renderHeroZones`, ui.js) had the identical bug, so the
  displayed cost was wrong too, in the same direction, meaning nothing on screen contradicted the
  charge. Fixed both call sites to use `nextCraftCost(ps)` as the base cost when the Hero is H25.
- **Root cause of a second, more serious bug found while live-testing the fix above: internal ES
  module imports across `digital/js/*.js` used inconsistent cache-busting `?v=` query strings**
  (e.g. `combat.js` importing `cards.js?v=1788192005` while `game.js` imported the same file at
  `?v=1788202754`, and `debug.js`/`bot_player.js`/`bot_ai.js` imported several internal modules
  with no version string at all). Browsers resolve each distinct URL (path+query) as a separate
  module instance — so the codebase was silently running **5 separate instances of `cards.js`**
  (and 3 of `state.js`, 3 of `maps.js`, 2 of `decks.js`) at once, each with its own independent
  `CARD_BY_ID` object. `registerGeneratedCard` (cards.js) mutates `CARD_BY_ID` at runtime for
  dynamically-created cards (H25 Craft candidates, H19 Training Officer's hand-buff clones) — a
  card registered via combat.js's instance was invisible to any lookup made through a
  differently-versioned import, most importantly `confirmCraftPick`'s `CARD_BY_ID[chosenId]` in
  game.js. **Live-reproduced via Playwright**: activating H25 and picking any of the 3 candidates
  threw `TypeError: Cannot read properties of undefined (reading 'name')` and left the picker
  modal stuck open — a full break of a shipped Hero's core loop, not a corner case. `npm test`'s
  190/190 never caught this because Node resolves the test files' bare (unversioned) import
  specifiers consistently; `selfplay_test.mjs`'s "zero uncaught page errors" runs never happened
  to exercise a Craft-and-pick sequence. Fixed by unifying every internal `.js?v=` import (and the
  few previously-bare ones) across every file in `digital/js/`, plus both HTML entry points'
  `<script>` tags, to one shared version string — verified live post-fix: H25's full activate →
  pick → hand → place → drawback lifecycle and H19's hand-buff → place lifecycle both run clean
  with zero console errors, and the two real activations checked charged 5 then 4 Fuel exactly as
  the escalating-cost fix intends. No unit test added for the version-string convention itself
  (there's nothing to assert against — the bug was that two files' import URLs for the same target
  didn't match a string, not a computable invariant); the live Playwright re-run is the
  verification.

## 2026-09-01 — Doc 02 full pass (all 130 rulings), following up on the earlier 2-question spot check

Went through every section of doc 02 systematically rather than waiting for more questions to
surface individual gaps. Found and fixed several real, previously-shipped bugs:

- **Fatigue (Q029-Q030) didn't exist at all.** Drawing from an empty deck silently did nothing —
  no damage, no consequence, `drawCards` just stopped. Doc 01 §4 / doc 02 lock escalating HQ
  damage per failed draw attempt (1st = 1, 2nd = 2, 3rd = 3...), never resetting. Added
  `fatigueCount` to PlayerState and rewired `drawCards` to deal it per failed draw, one at a time
  (not bundled), matching doc 02 Q030's "multi-draws resolve sequentially" requirement.
- **No Discard Pile zone existed, and the 10-card max hand size was enforced nowhere.** Added
  `discardPile` to PlayerState and a shared `addCardToHand` funnel (state.js) that routes
  overflow there instead of growing hand past 10 — used by `drawCards`, Tactical Withdrawal
  (C11), Craft's candidate pick, and Forward Observer's keep. Destroyed Units now go to the
  owner's Discard Pile via the shared `resolveDestructionChain` (one call site, covers every
  destruction source). Resolved Commands go to Discard Pile too, added at each of the 5 places a
  Command is removed from hand. Per doc 02 Q028, this is bookkeeping only — no current card reads
  the zone — but it's locked truth, not an invented feature.
- **`playInstantCommand`'s entire shared resolution path never called `checkWin()`.** Pre-existing,
  not new — C23 Emergency Supply already dealt 2 own-HQ damage through this exact path before
  today, meaning a lethal Emergency Supply could already have gone undetected until some
  unrelated later action happened to check. Same bug class as the "entire Hero Power system
  never checked for a win" fix from Run 1's QA pass, just a different call path. Also added
  `checkWin()` to the debug panel's own Draw Cards button, now that fatigue can make even a
  debug draw lethal.
- **`gainFuel`'s cap logic could silently erase legitimately-banked excess Fuel.** It computed
  `Math.min(cap, fuel + amount)` — correct when under the cap, but if fuel was already ABOVE the
  cap (from an uncapped Objective/card grant, which doc 02 Q036 explicitly allows), the very next
  normal capped Fuel gain would clamp it back DOWN to the cap instead of adding 0 as doc 02 Q037
  requires verbatim ("does not reduce the 12; it simply adds 0"). Fixed to clamp the gain itself
  to "room left under the cap" (never negative) rather than clamping the result.
- **Unit/Command copy limits were inferred from rarity instead of reading each card's own
  `copies` field.** Doc 02 Q015 explicitly says not to do this. Doesn't change behavior for the
  current 65-card pool (every card's `copies` value happens to already agree with what rarity
  alone would predict — verified, no current exception), but it was one card design decision
  away from silently capping the wrong number for a future off-rarity copy limit.
- **No maximum/minimum stat floor was enforced** (doc 01 §16 / doc 02 Q127: "floor = 0, no
  maximum"). Added `Math.max(0, ...)` to `getSideValue`'s final sum. Not reachable by any current
  card (no negative modifier exists in the live pool) — only via the debug panel's negative
  all-sides buff — but the rule is unconditional, so it shouldn't depend on luck.

**Verified:** `npm test` 190/190 (172 → 190 across this session's doc-02 work). Live Playwright
verification of fatigue specifically (forced an empty deck via the debug hook, drew twice,
confirmed escalating 1-then-2 HQ damage and correct fatigueCount tracking). 8-game selfplay
sweep clean (0 uncaught page errors) after all of the above landed together.

**Deferred, flagged as a decision rather than fixed:** Hero roster secrecy (doc 02 Q016 — "the
opponent does not see undeployed Hero identities") isn't implemented; both hands and rosters
already sit in a world-writable Firebase node with no per-player privacy layer at all. Meaningful
only for online play (hot-seat has no secrecy to begin with, by definition). Implementing real
hidden information would need a genuine architecture change — splitting private per-player state
from the shared public node, likely via Firebase security rules or a Cloud Function intermediary
— not a small patch, and out of scope for this pass.

**Also flagged, not changed:** doc 01 §2 lists the turn sequence as Refresh → Fuel → Draw, but
the actual code order (End Turn handler, and the newly-added turn-1 draw in `finishStartGame`)
does Draw before Fuel, consistently, everywhere. The two operations don't interact (Fuel gain
doesn't read hand/deck state, draw doesn't read Fuel), so this has no observed gameplay
consequence — flagging the literal-order mismatch for completeness, not treating it as a bug
worth a risky reorder of an already-tested turn pipeline for zero behavioral change.

---

## 2026-08-31 — Doc 02 audit (Resolved Q&A Decision Ledger, not covered by Run 1/2)

Doc 02 (130 locked Q&A rulings) was never cross-checked during Run 1 or Run 2 — both runs
focused on doc 03 (cards) and doc 04 (maps/objectives). Prompted by a user question, went
through it and found two real, still-live bugs:

- **First player was hardcoded to always be `p1`**, never randomized. Doc 02 Q005 (mirrored in
  doc 01 §1.9): "First player is selected randomly." Fixed in `state.js`'s `createInitialState`
  (`initiative: Math.random() < 0.5 ? "p1" : "p2"`). Safe for online too — only the host's
  client ever calls `createInitialState`; the joiner receives the result via the normal Firebase
  state push, so there's no risk of the two clients rolling different results independently.
  Exposed a second-order bug: in AI mode the bot always sits in the `p2` seat, and its turn only
  ever fired reactively after an End Turn — if `p2` won the new coin flip, nothing ever kicked
  off its first turn. Fixed by calling `runBotTurn()` at game start when `isAiMode &&
  state.initiative === 'p2'`. Both verified live via Playwright (a p2-first game where the bot
  placed a unit automatically and correctly handed control to P1).
- **Initially over-corrected the opening-hand issue — caught and fixed same day, see below.**

**Correction, same day, later pass:** the first pass above also removed a leftover
`drawCards(s.p1, 1)` bonus applied after P1's mulligan, reasoning it was an asymmetric "P1 gets
5, P2 gets 4" bug (doc 02's own deprecated-checklist names "old 5-card opening hand"). That
reasoning was wrong, caught when the user asked "since that draw is immediate, isn't 5 correct?"
and pushed for verification. Doc 01 §2 (Turn State Machine) settles it: "Every active-player turn
resolves in this order" — Refresh → Fuel → **Draw 1** → ... — with no stated exception for turn
1, unlike Direct HQ's explicit first-turn carve-out (§1.11/§19). Doc 01 §1.4 separately pins down
"opening hand" as the pre-mulligan 4-card setup hand specifically — a different concept from the
Step 3 turn-draw. So the deprecated "5-card opening hand" refers to the *setup hand* being wrong
(5 instead of 4), not to a player correctly holding 5 after their own first turn's normal draw.
**Correct design: opening hand = 4 for both (unchanged), then whoever goes first draws 1 as a
completely normal Step 3 on their own turn 1, exactly as whoever goes second already did on
their turn 2 — fully symmetric, no first/second-mover hand-size difference.** Re-added the draw
in `finishStartGame`, keyed to `s.initiative` (not hardcoded `'p1'` — that was the actual original
bug, not the draw itself). Verified live: a p2-first game showed p1 correctly holding 5 cards
when its own turn 1 began, p2 having already drawn to 5 and spent one card down to 4 on its turn.

`npm test`: 174/174 (172 + 2 new tests covering both first-player/turn-1 combinations for Direct
HQ's turn-1 lock, which was already correctly turn-number-based rather than label-based).

**Also found and fixed along the way (unrelated, pre-existing):** `selfplay_vs_ai_smoke.mjs`
navigated to a URL (`/game?ai=1`) that 404s in this environment — the script had never actually
run successfully before. Fixed to use `/game.html?ai=1`. That surfaced a second, separate gap in
the same script (it doesn't handle the Hero-deploy modal that appears at round 2) — not fixed,
flagged as a known tooling gap rather than a game bug.

**Not yet done:** doc 02 has ~128 other rulings beyond the two checked here. This was a targeted
check prompted by a user question, not an exhaustive pass — worth a dedicated session if full
coverage matters.

---

## 2026-08-31 — Run 2: Maps/Objectives migration

Executed against doc 04 (SIGNAL Objectives & Maps Truth v1.0) and doc 09 (the Run 2 execution
prompt), both read in full before any code changed — same audit-first discipline as Run 1.

**The actual bug, found during the audit:** `applyObjectiveEffects` (game.js) was still switching
on the pre-Run-1 numeric Objective ids (26-33). Since Run 1 changed `obj.cardId` to the O1-O5
string scheme, no case could ever match — every controlled Objective silently fell through to a
"not automated" log line and did *nothing* (no Fuel, no HQ damage, no buffs) for the entire time
Run 1's card content had been live. Objective CONTROL tracking (`checkObjectiveControl`) was
unaffected the whole time, since it never keyed on cardId — only the effects were dead.

**Maps:** Normandy and Midway cut per doc 04's locked 4-map list — archived in `maps.js`'s new
`ARCHIVED_MAPS` export, not deleted. Stalingrad/Kursk/El Alamein/Ardennes kept, with objective
slot coordinates corrected to doc 04's exact canonical geometry (every stated adjacency count —
corner=2/edge=3/interior=4 — cross-verified against the row,col conversion and matched exactly).
All water terrain and the Naval-only-water branch removed from `canPlaceOnTerrain` (dead code
since Naval was cut in Run 1 — no card could ever have exercised it). Stalingrad's former water
column is placeholder-filled with `plains`.

**Objectives:** rewired `applyObjectiveEffects` from scratch. Universal 1/1/2/2 HQ backbone
(doc 04 §4-5) resolves before each Objective's own secondary effect, with an immediate
lethal-stop check that also cancels that Objective's own secondary if the backbone alone ends the
match. Multiple simultaneously-controlled Objectives now resolve in fixed column-major board scan
order (previously JS object insertion order — doc 04 §5/§19 require the deterministic scan).
All 5 Objectives' exact L1-L4 secondary effects are wired for the first time — the O1-O5 card
text itself was already correct from Run 1, it just had no execution code reading it. Airfield L2
("Maneuver 1 friendly Unit") auto-resolves via the existing global Maneuver primitive (random
mover with a legal destination + random destination) rather than being left manual, since doc 04
describes it as a fully automatic effect with no player choice. City L1's Guard grant filters to
eligible (non-Guard) targets before picking randomly, per doc 04 §6's "avoid a duplicate no-op"
rule. `discountFor`/`addDiscount` (state.js) gained an `appliesTo: 'unit'` dimension — Factory's
"next Unit played this turn costs N less" needed "any Unit class, but not a Command," which the
prior 'command'-or-exact-class scheme couldn't express. Objective identities now randomize after
mulligan (moved from `startGame` into `finishStartGame`), per doc 04 §1's locked setup order.

**Verified:** live via Playwright on Stalingrad — correct slot placement at the doc-04 coordinate,
backbone HQ damage firing and logging correctly, Suppressed units still counting toward control,
and the Guard no-op-avoidance correctly skipping a unit that already had innate Guard rather than
wasting the effect; zero console errors across 3 played rounds. `tests/maps.test.mjs` rewritten
for the 4-map reality plus doc 04's exact per-map geometry as assertions. `npm test`: 172/172.
Full-game verification via `selfplay_test.mjs` across the 4 remaining maps (12/12 games clean).

**Resolved same day, later pass:** Stalingrad's terrain-cell pattern — fetched and viewed the
real v1.1 Map Proposals PDF (not just its text, which Docs' plain-text extraction drops embedded
images from). Confirms no water feature exists in the current design (Stalingrad's stated theme
is "City / Plain visual theme"), so the `plains` placeholder is directionally correct; the same
doc states Plain/Desert/City are "currently gameplay-equivalent neutral terrain," so an exact
cell-for-cell mismatch against the source art is cosmetic only, not a correctness risk.

**Post-Run-2 follow-ups, same day:**
- **T003 (map before deck/Hero roster) — fixed for local hotseat and AI mode.** `game.js` now
  shows the map picker first, then deck picker(s), then starts the match directly (no redundant
  second map step) — matches doc 04 §1's locked setup order. Deliberately NOT touched for
  online: P1's direct-code-join still deck-picks before map, and P2 in both online flows never
  sees a map-picker at all before choosing their deck — restructuring the Firebase lobby
  handshake order can't be safely verified without a live 2-client session, so it stays a known,
  documented gap. P1-via-open-lobby-browser already satisfied the order on its own (map chosen
  on `index.html` before `game.html` loads). `selfplay_test.mjs` and `selfplay_vs_ai_smoke.mjs`
  updated to click map-picker before deck-picker — both re-verified live (3/3 and 12/12 games
  clean, 0 errors).
- **Bot "heroes=2/2, never full roster" pattern — investigated, not a bug.** Hero deployment
  opportunities occur only at rounds 2/4/6/8 (`objectiveLevel`'s schedule). Cross-checking actual
  Run 2 selfplay data: a 5-round game caps at exactly 2 heroes per side, an 8-round game allows
  all 4 — every observed game matches this exactly, including asymmetric splits like 4/3
  (one player's own turn within the final round never happened before the game ended). The
  original concern almost certainly came from pre-Run-2 stalled games, which tended to plateau
  around round 4-5 before being bailed by the stall-detector — Run 2 means games resolve via
  real wins now, not stalls (0 stalls across 15 total selfplay games this session).

**Deferred/flagged, not fixed:** the old Artillery-Position "click an enemy to deal 1 hit"
targeting mode (`pendingArtyHits`) is fully dormant — no O1-O5 card triggers it — but left in
place rather than torn out, since removing it touches UI plumbing beyond Objective-effect scope.

---

## 2026-08-31 — Run 1 closure passes (same day, two further passes after the main Run 1 pass below)

**Pass 2:** Maneuver, Escalate, and Craft built (with tests). `game.js`'s Hero Active switch
(`applyHeroPower`/`heroTargetKeys`) and Command switch (`playInstantCommand`/`getCommandTargets`/
`applyCommandEffect`) fully rewired to the new id scheme — all 25 Heroes and all 35 Commands got
real implementations. Found and fixed a real bug in the same pass: 7 dangling calls to functions
removed earlier in the migration (`checkDeathrattle`, `checkUnitOnPlayAbility`,
`checkPendingUnitBuff`) were still live on reachable code paths (Artillery Position, Air
Strike/Suppressing Fire, the debug panel) — would have thrown `ReferenceError` the first time
those paths executed. Fixed, mostly rerouted through the shared destruction chain.

**Pass 3 (final closure):** every disclosed simplification from pass 2 closed, not just flagged:
- H19 Training Officer buffs qualifying hand cards via `applyHandBuff` (combat.js), reusing
  Craft's card-registration trick.
- H20 Ruthless Strategist's Command-play hook wired into every Command-resolution exit point.
- C06 Coordinated Strike got a real 2-unit multi-select flow.
- Escalate's "affect up to 2 targets" variant (C27, C32) built alongside the existing "boosted
  amount" variant (C26/C34).
- C23 Emergency Supply's temporary-Fuel-expires-if-unused nuance implemented for real
  (`tempFuelGrant`/`expireTempFuelGrant`, cleared at End Turn after Direct HQ).
- H25 Craft got a real 3-candidate picker modal; the in-page bot and selfplay harness both got a
  matching auto-pick-first-candidate handler.
- `bot_ai.js`'s Command/Hero-Power scoring fully remapped to C01-C35/H01-H25, matched by actual
  current effect text per card, not old id/name. Two new shared helpers
  (`bestKeywordGrantTarget`, `boardWideClassBuffValue`) added. Old direct-damage command scoring
  removed rather than remapped (no Command in the new pool deals direct Hit damage anymore).
- Dead `Commander`/`Naval` entries removed from `CLS_ABBR` maps (cosmetic).

Verified: 109/109 unit tests green throughout, 12 live self-play games total across both passes,
zero uncaught page errors.

---

## 2026-08-31 — post-Run-1 QA pass (Denis's Local Playtest Card QA Checklist)

All the Run 1 work had been verified almost entirely via unit tests and bot self-play, never by a
human or a real browser — this pass actually drove the game (Playwright, live clicks, the debug
panel) and cross-checked the checklist's specific scenarios one section at a time. Found and
fixed real bugs no automated test had caught, in order of severity:

- **Every hand-card click did nothing at all.** 4 places in `game.js` wrapped a DOM dataset id in
  `Number(...)`, a leftover from the pre-migration numeric-id scheme — `Number("I1")` is `NaN`,
  so the click handler silently bailed. Affected the hand-card click listener, the hand-card and
  Hero-Zone hover previews, and the Hero Deploy modal's pick handler (which corrupted `heroZones`
  with `NaN` rather than crashing). This is almost certainly the real explanation for every
  "STALLED" self-play result and the "heroes=2/2, never 3/4" plateau reported earlier in Run 1 —
  previously misdiagnosed as a too-narrow stall-detection signature. That diagnosis was wrong.
- **Aircraft On-Play Maneuver was never wired at all** (6 cards sharing "On Play: Maneuver 1
  other friendly Unit"). Built as a new 2-step source-then-destination flow.
- **Change Formation (C16) + Ruthless Strategist (H20) crashed the page** — the rotate-modal's
  context object never carried `role` for the Command-triggered path.
- **H22 Frontline Marshal crashed on every activation** — called `columnKeys(col)`, a real
  exported `combat.js` helper `game.js` never imported.
- **I14 Veteran Raider's Rally was an explicit TODO stub**, never wired.
- **H24 Long War Commander's Active Power did nothing** — wrote to a field `getSideValue` never
  read; the ability "succeeded" but never affected combat.
- **Sacrifice Play (C18) dealt full self-HQ-damage through Guard**, unlike C19 which correctly
  bypasses Guard on purpose. Fixed by routing both through `resolveDestructionChain` directly.
- **2 of 8 `applyRuthlessStrategistIfPresent` (H20) call sites never called `checkWin()`**
  afterward — H20's self-damage could reach 0 HQ without the game noticing.
- **Activating ANY Hero Power never called `checkWin()` at all** — not H20-specific, the whole
  Hero Power system. Verified live after the fix.
- **T34/T35/C27/C28's "permanent" keyword grants were wiped the very next turn** — written to
  `grantedKeywords` (clears every `startOfTurn`) instead of a true permanent field. Fixed by
  adding `permanentKeywords`, which nothing clears.

Also closed a real test-coverage gap: none of Guard/Precision/Blast/Barrage/Rally/Inspire/
Muster/Last Stand/Breakthrough/Direct HQ had any unit tests at all, despite being the core of the
whole Set 1 migration. Added `tests/direct_hq.test.mjs` (15 tests) and `tests/keywords.test.mjs`
(34 tests) — 160/160 tests green throughout this pass.

---

## 2026-08-31 — Run 1: Set 1 truth-lock migration (main pass)

Denis's team delivered a full Claude Handoff package (Google Drive, docs 00-09) locking a new
Set 1 truth. Executed as "Run 1" per that package's own phased plan (Run 2 = Maps/Objectives,
separate later session).

**Card content:** `js/cards.js` replaced wholesale with exactly 65 Units + 25 Heroes + 35
Commands + 5 Objectives (130 records, 125 collectible), matching doc 03 card-by-card,
cross-referenced against actual effect text rather than old ID/name resemblance. Every
pre-migration card not in the new list preserved in `js/archive/legacy_cards.js` with a manifest
(138 archived + 5 Objectives carried forward under new O1-O5 ids = 143, nothing lost). `js/decks.js`'s
4 in-house starter decks replaced with the exact 8 SIGNAL Set 1 Recommended Decks.

**Rules engine:** Guard rewritten from adjacency-protection to attacker-specific legal-target
priority; Precision/Blast/Barrage/Rally/Inspire/Muster/Last Stand(keyword)/Breakthrough all newly
built; a shared destruction chain (`resolveDestructionChain`/`applyPostDestructionEffects`) so
Last Stand/Breakthrough/HQ-replacement can't diverge between combat and self-destruct Commands; a
real persistent+temporary attack-allowance model with locked persistent-first consumption order;
Direct HQ (`evaluateDirectHQ`) built as a new end-of-turn evaluator replacing the old reactive
mid-turn "Empty-Board HQ Strike" entirely; Suppression HQ damage fixed to 0 (was 1).

This file (STATUS.md) was rewritten from scratch in this pass — it had gone stale describing a
~2026-07 milestone (5 maps, 20 Commands, no Heroes at all).

---

## Pre-2026-08-31 history

Everything before the Run 1 truth-lock migration predates this changelog file. See
`clients/wwii-card-game/CLAUDE.md`'s own changelog for the project-level design history (Hero
Command Layer build-out, Deathrattle keyword system, the biased-shuffle bug, Midway's
add-then-cut, etc.) — that history is design/project-level, not duplicated here.
