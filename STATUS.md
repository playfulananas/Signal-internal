# SIGNAL Prototype — Implementation Status

Legend: ✅ done | ⚠️ partial | ❌ missing

**Rewritten 2026-08-31 (Run 1 of the Set 1 surgical update).** This file was badly stale before
this pass — it still described a ~2026-07 milestone (5 maps, 20 Commands, no Heroes at all) that
predates even the last CLAUDE.md snapshot. Rewritten from scratch against the actual current
code rather than patched. See `CLAUDE.md` for full project history/decisions and the Run 1 plan
for exactly what changed and why.

---

## Run 1 summary — what's actually true right now

**Card content:** fully migrated. Active pool is exactly 65 Units + 25 Heroes + 35 Commands + 5
Objectives = 130 records (125 collectible) in `js/cards.js`, verified against doc 03 (SIGNAL
Card Truth & Migration). Every pre-migration card not in the new list is preserved, not
deleted, in `js/archive/legacy_cards.js` with a manifest (138 cards: old Units/Commands/
Heroes/Missions/3 cut Objectives/the 2026-08-19 Deathrattle batch). All 8 starter decks in
`js/decks.js` are the exact SIGNAL Set 1 Recommended Decks (replacing the old 4 in-house decks).

**Rules engine:** the hard, subtle parts of Run 1 are done and unit-tested (97/97 tests green,
`npm test`):
- Guard rewritten to attacker-specific legal-target priority (no more adjacency model).
- Precision, Blast, Barrage, Rally, Inspire (dynamic aura), Muster (dynamic aura), Last Stand
  (unit keyword), Breakthrough — all newly built.
- A shared destruction chain (`resolveDestructionChain`/`applyPostDestructionEffects` in
  combat.js) so Last Stand/Breakthrough/HQ-damage-replacement can't diverge between call sites.
- A real persistent+temporary attack-allowance model (`remainingAttacks`/`spendAttack` in
  state.js) — consumption order locked: persistent first, then temporary; reset restores
  persistent only.
- Direct HQ (`evaluateDirectHQ` in combat.js) — a genuinely new end-of-turn evaluator that
  REPLACES the old reactive mid-turn "Empty-Board HQ Strike" entirely (all 3 old call sites in
  game.js removed; wired into the End Turn handler instead).
- Suppression HQ damage fixed: 0 (was 1) — the old "Suppress=1, Destroy=2, total 3 per kill"
  model is gone.

**Update (same day, later pass):** Maneuver, Escalate, and Craft are now built (with tests).
`game.js`'s Hero Active switch (`applyHeroPower`/`heroTargetKeys`) and Command switch
(`playInstantCommand`/`getCommandTargets`/`applyCommandEffect`) have both been fully rewired to
the new id scheme — **all 25 Heroes and all 35 Commands** now have real implementations.
**In the same pass, found and fixed a real bug**: 7 dangling calls to functions removed earlier
in this same migration (`checkDeathrattle`, `checkUnitOnPlayAbility`, `checkPendingUnitBuff`)
were still live in `game.js` on reachable code paths (Artillery Position, Air Strike/Suppressing
Fire, the debug panel) — would have thrown `ReferenceError` the first time those paths executed.
All fixed, mostly rerouted through the shared destruction chain so Last Stand/Breakthrough still
fire correctly.

**Update (same day, final closure pass):** every disclosed simplification from the previous pass
is now closed, not just flagged:
- **H19 Training Officer** buffs qualifying hand cards via `applyHandBuff` (combat.js), reusing
  Craft's card-registration trick instead of a full hand-instance data-model rewrite.
- **H20 Ruthless Strategist**'s Command-play hook (`applyRuthlessStrategistIfPresent`) is wired
  into every Command-resolution exit point in `game.js` (instant Commands, Forward Observer's
  modal, targeted Commands, the objective-target and Maneuver/Coordinated-Strike flows, rotate
  confirmation, Command Shuffle).
- **C06 Coordinated Strike** has a real 2-unit multi-select flow (`startCoordinatedStrike`/
  `resolveCoordStrikeFirst`/`resolveCoordStrikeSecond` in game.js) — picks a first friendly Unit,
  then a second sharing a legal target with the first, and grants both 1 additional attack.
- **Escalate's "affect up to 2 targets" variant** (C27 Blitzkrieg Order, C32 Fire for Effect) is
  now implemented alongside the "boosted amount" variant (C26/C34): `pendingCommandManeuverRemaining`
  loops C27 back through the Maneuver-source flow for a second, different Tank when Escalated;
  C32's chain reuses the same rally-cry-style multi-target pattern as C03/C10.
- **C23 Emergency Supply**'s temporary-Fuel-that-expires-if-unused nuance is real, not
  approximated: `tempFuelGrant`/`expireTempFuelGrant` (state.js) track it and clear any unused
  portion at End Turn, after Direct HQ resolves.
- **H25 Chief Aircraft Engineer (Craft)** has a real 3-candidate picker modal
  (`craft-picker-modal` in game.html, `showCraftPickerModal`/`confirmCraftPick` in game.js) —
  Fuel and the once-per-turn activation lock commit immediately, then the player picks 1 of 3
  freshly-rolled Aircraft to add to hand. The in-page "vs AI" bot (`bot_player.js`) and the
  Playwright self-play harness (`selfplay_test.mjs`) both got a matching `handleCraftPicker` (bot
  always takes the first candidate — same "don't overthink it" simplification already used for
  rotation direction).
- **`bot_ai.js`'s Command/Hero-Power scoring** (`COMMAND_UTILITY_VALUE`, `HERO_POWER_UTILITY_VALUE`,
  `OBJ_HQ_DMG`, `scoreCommand`, `scoreHeroPower`, `bestHeroPowerTarget`) is fully remapped to the
  new C01-C35/H01-H25 ids, matched by actual current effect text per card (not by old id or name
  — several new-truth cards reuse an old name for a different effect). Two new shared helpers
  (`bestKeywordGrantTarget`, `boardWideClassBuffValue`) cover the keyword-granting and
  board-wide-buff commands the old table never had a dynamic model for. The old direct-damage
  command scoring (`damageCommandValue`/`bestDamageCommandTarget`, plus `DAMAGE_COMMAND_IDS` in
  `bot_player.js`/`selfplay_test.mjs`) was removed rather than remapped — no Command in the new
  35-card pool deals direct Hit damage anymore (C30 Artillery Barrage and C33 Air Strike, the
  cards that inherited those old names, grant a keyword/extra attack instead), so that whole
  scoring path was genuinely dead code, not a remap gap. `OBJ_HQ_DMG` is intentionally all-zero
  for O1-O5, since `applyObjectiveEffects` (game.js) is confirmed still keyed to the old numeric
  Objective ids and is dead code for every currently-live Objective — scoring it as anything else
  would value a payout the engine doesn't actually deliver until Run 2.
- `game.js`/`ui.js`'s `CLS_ABBR` maps had their dead `Commander`/`Naval` entries removed (cosmetic).

**Verified via live self-play (12 games total across both passes):** loads, deals hands, deploys
Heroes, plays multiple rounds, **zero uncaught page errors** every time, including after the
closure-pass changes above. Games still get flagged "STALLED" by the test harness after ~5
rounds — traced this precisely: the harness's stall signature is only `(p1.hq, p2.hq,
occupied-tile-count)`, so a run of turns spent granting buffs/keywords (Guard, Blast, Precision,
stat buffs — exactly what the new Command/Hero layer does a lot of) can look identical to it turn
over turn even though real state is changing. This may not be a real gameplay bug so much as the
harness's signature being too narrow for the new mechanics — worth widening in a follow-up, but
not re-verified by hand yet. **Separately worth a look:** every stalled game reported "heroes=2/2"
(never 3 or 4 deployed) regardless of how long the game ran — flagging for human playtest since
it's outside this pass's specific scope to chase further blind.

**The remaining gap is now Run 2 only** — everything disclosed as a Run 1 simplification is
closed. What's left:
- Maps/Objectives content migration (Normandy/Midway removal, Bridge/Radar Station/
  Fortification removal, the locked 1/1/2/2 Objective HQ backbone) is explicitly Run 2 scope.
  Only a tiny compatibility patch was made in Run 1 (`WORKING_OBJECTIVE_IDS` and Midway's
  `objectiveExclude` updated to the new O1-O5 ids, so nothing crashes) — Objective secondary
  effects (`applyObjectiveEffects`) still key on old ids and are currently inert, same failure
  mode Commands had before this pass (silently no-ops, doesn't crash). Objective CONTROL
  tracking itself (`checkObjectiveControl`) is unaffected since it doesn't key on cardId at all.

---

## Core Systems

| Feature | Status | Notes |
|---|---|---|
| Board rendering (4x4 grid) | ✅ | Unchanged by Run 1 |
| Hand rendering | ✅ | Unchanged by Run 1 |
| Fuel system | ✅ | Threshold 9 (11 w/ Logistics Chief H02) — unchanged by Run 1 |
| HQ damage + win condition | ✅ | Suppress = 0 (fixed 2026-08-31, was 1), Destroy = 2; first to 0 loses |
| Direct HQ | ✅ | New end-of-turn evaluator, replaces old reactive mid-turn strike |
| Initiative swap | ✅ | Unchanged by Run 1 |
| Objective control tracking | ✅ | Unchanged by Run 1 (doesn't key on cardId) |
| Objective secondary effects | ⚠️ | Inert — keys on old ids; Run 2 will re-wire against the locked 1/1/2/2 backbone |
| Hit sequence (normal/Armor/Heavy Armor) | ✅ | Unchanged by Run 1 |
| Terrain placement restrictions | ✅ | Unchanged by Run 1 (Naval-only-water etc. still Run 2 cleanup, currently dormant/harmless) |
| Firebase multiplayer | ✅ | Unchanged by Run 1 |
| Deck builder | ⚠️ | Still 8 hardcoded starter decks (now the real recommended decks, not 4 in-house ones); no custom deck building |
| Debug panel | ✅ | Unchanged by Run 1 |

---

## Keywords — see ARCHITECTURE.md's "Keyword Resolution Decisions" table for the authoritative, up-to-date list and implementation notes. Do not duplicate it here.

## Card content — see `js/cards.js` (active) and `js/archive/legacy_cards.js` (archived, with manifest) for the authoritative current lists. Do not duplicate them here.

---

## Known gaps carried over from before Run 1 (still true)

- Airfield L1 ("Aircraft attack twice on placement"), Objective L2/L4 single-hit effects, and
  similar "not automated, log message only" Objective secondary effects were already
  manual-resolve before Run 1 and remain so — Run 2 scope.
- ~~Coordinated Strike (C06) / Pincer-style multi-select targeting UI was never built.~~
  RESOLVED — C06's 2-unit multi-select flow is built (see the closure-pass entry above);
  Pincer Maneuver itself isn't in the new 35-Command pool at all (archived), so there's no
  remaining Pincer-style case to cover.
