# "vs AI" Singleplayer Mode — Implementation Plan

**Goal:** Add a fourth lobby mode where a human plays P1 through the normal UI and the existing self-play bot automatically plays P2's turns, so the game is playable solo.

**Architecture:** The bot runs *inside* the game's own page (not via external Playwright automation) and drives P2 by calling `.click()` on the real DOM elements — the exact same elements a human would click. This means it goes through the unmodified, already-tested click handlers in `game.js`, so **zero changes to placement/attack/command logic are needed** and the online-multiplayer and local-hotseat paths cannot regress. The bot's decision logic (which card/tile/target to pick) is a near-verbatim port of the `playTurnSmart` loop already built and validated in `selfplay_test.mjs`, reusing the same `bot_ai.mjs` scoring functions.

**Tech stack:** Vanilla ES modules, no build step, no new dependencies. Reuses `js/state.js`, `js/combat.js`, `js/maps.js`, `js/cards.js` (already pure/DOM-free) and the `window.__SIGNAL_DEBUG__` hook already present in `game.js`.

**Testing approach:** At the time this plan was written, the project had no unit-test framework; a `node --test` suite covering the pure modules (`state.js`, `combat.js`, `cards.js`, `decks.js`, `lobbies.js`) was added later (see `tests/`, run via `npm test`) but still does not cover `game.js` itself. Verification for this plan remains manual browser play plus the existing `selfplay_test.mjs` Playwright harness (which exercises the same click handlers this plan reuses). Each task below has a concrete manual and/or automated check before moving to the next.

---

## File Structure

```
digital/
├── bot_ai.mjs              → MOVE to digital/js/bot_ai.js (Task 1)
├── js/
│   ├── bot_ai.js            — NEW location; unchanged content except import paths
│   ├── bot_player.js        — NEW; in-page bot turn orchestrator (Task 3)
│   ├── game.js               — MODIFY; add isAiMode, wire deck/mulligan skip + bot trigger (Task 2, 4)
│   └── decks.js              — unchanged, already exports STARTER_DECKS (reused, not modified)
├── index.html                — MODIFY; add "vs AI" lobby button (Task 2)
└── selfplay_test.mjs         — MODIFY; update import path for moved bot_ai.js (Task 1)
```

---

## Task 1: Move `bot_ai.mjs` into `js/` for consistency

**Files:**
- Create: `digital/js/bot_ai.js`
- Delete: `digital/bot_ai.mjs`
- Modify: `digital/selfplay_test.mjs:8`

`bot_ai.mjs` currently lives at the top level and is only used by the Node test harness. Now that game.js (which lives in `js/`) will import it too, co-locating it with the other engine modules keeps imports simple (`./bot_ai.js` instead of `../bot_ai.mjs`) and matches the project's existing convention of keeping all game logic under `js/`.

- [ ] **Step 1: Read the current file to copy exactly**

Read `digital/bot_ai.mjs` in full — it's already correct, this is a pure move with two import-path edits (the file imports from `./js/cards.js`, `./js/combat.js`, `./js/state.js`, `./js/maps.js`; once it lives in `js/` itself those become `./cards.js`, `./combat.js`, `./state.js`, `./maps.js`).

- [ ] **Step 2: Create `digital/js/bot_ai.js`**

Copy the full content of `digital/bot_ai.mjs`, changing only the import line at the top from:
```js
import { CARD_BY_ID } from "./js/cards.js";
import { getAttackableTargets, resolveSingleAttack } from "./js/combat.js";
import { getKeywords, maxArmorHits } from "./js/state.js";
import { canPlaceOnTerrain, getTerrain } from "./js/maps.js";
```
to:
```js
import { CARD_BY_ID } from "./cards.js";
import { getAttackableTargets, resolveSingleAttack } from "./combat.js";
import { getKeywords, maxArmorHits } from "./state.js";
import { canPlaceOnTerrain, getTerrain } from "./maps.js";
```
Every function body (`scoreAttack`, `severityStep`, `bestAttackForUnit`, `maxAttacksFor`, `bestExistingAttack`, `findLethal`, `exposureRisk`, `bestPlacement`, `bestDamageCommandTarget`) is copied unchanged.

- [ ] **Step 3: Delete the old file**

Delete `digital/bot_ai.mjs`.

- [ ] **Step 4: Update `selfplay_test.mjs`'s import**

In `digital/selfplay_test.mjs`, change:
```js
import { bestPlacement, bestExistingAttack, findLethal, bestAttackForUnit, bestDamageCommandTarget, maxAttacksFor } from "./bot_ai.mjs";
```
to:
```js
import { bestPlacement, bestExistingAttack, findLethal, bestAttackForUnit, bestDamageCommandTarget, maxAttacksFor } from "./js/bot_ai.js";
```

- [ ] **Step 5: Verify — syntax check and a quick regression run**

Run:
```bash
cd digital && node --check js/bot_ai.js && node --check selfplay_test.mjs && echo OK
```
Expected: `OK`

Then run a small regression batch to confirm the moved module still works correctly end-to-end:
```bash
cd digital && node selfplay_test.mjs 4
```
Expected: 4/4 games played, 0 stalls, 0 crashes (matching the last known-good run). If this fails, stop and fix before continuing — everything after this task builds on `js/bot_ai.js` being correct.

- [ ] **Step 6: Commit**
```bash
git add digital/js/bot_ai.js digital/selfplay_test.mjs
git rm digital/bot_ai.mjs
git commit -m "refactor: move bot_ai.mjs into js/ for consistency with other engine modules"
```

---

## Task 2: Lobby entry point + deck/mulligan auto-skip for P2

**Files:**
- Modify: `digital/index.html`
- Modify: `digital/js/game.js` (deck-picker click handler, `startGame`)

At the end of this task, clicking "vs AI" reaches a working game screen with P1's mulligan shown and P2 silently assigned a random starter deck — but P2 still can't act (that's Task 3). This is an intentionally safe checkpoint: you can verify the lobby flow and P1's setup works before any bot code exists.

- [ ] **Step 1: Add the lobby button in `digital/index.html`**

In the `.deck-grid#main-buttons` block, add a new option after `#btn-deckbuilder` (currently the last of 4 options, `index.html:30-33`):
```html
      <div class="deck-option" id="btn-ai">
        <div class="deck-name">vs AI</div>
        <div class="deck-flavor">Play solo against the bot. You control P1; the bot plays P2 automatically.</div>
      </div>
```

- [ ] **Step 2: Wire the click handler**

In `index.html`'s `<script type="module">` block, add after the existing `btn-deckbuilder` listener (`index.html:59-61`):
```js
    document.getElementById('btn-ai').addEventListener('click', () => {
      window.location.href = 'game.html?ai=1';
    });
```

- [ ] **Step 3: Verify the button renders and navigates**

Start the dev server if not already running (`cd digital && npx serve . -p 3000`), open `http://localhost:3000/index.html` in a browser, confirm a "vs AI" tile appears as a 5th lobby option, click it, confirm the URL becomes `game.html?ai=1` and the normal deck-picker screen appears (P1 deck choice — this part isn't AI-aware yet, so it currently behaves exactly like Local Play. That's expected; fixed in the next steps).

- [ ] **Step 4: Add the `isAiMode` flag in `game.js`**

In `digital/js/game.js`, right after the existing online-mode constants (`game.js:168-171`):
```js
const isOnline = !!params.get('game');
const gameId   = params.get('game') ?? null;
const myRole   = params.get('role') ?? null; // 'p1' | 'p2' | null for local play
let myLastPushId = null;
```
add:
```js
const isAiMode = params.get('ai') === '1';
```

- [ ] **Step 5: Skip the P2 deck-picker step in AI mode**

In `digital/js/game.js`, find the local-play branch of the deck-grid click handler (`game.js:130-140`):
```js
  // Local play: P1 deck → P2 deck → map
  if (pickerStep === 1) {
    p1DeckIds = [...ids];
    pickerStep = 2;
    document.getElementById('picker-label').textContent = 'PLAYER 2 — CHOOSE YOUR DECK';
  } else {
    p2DeckIds = [...ids];
    pickerStep = 3;
    document.getElementById('deck-picker').style.display = 'none';
    document.getElementById('map-picker').style.display = '';
  }
```
Replace with:
```js
  // Local play: P1 deck → P2 deck → map. In AI mode, P2's deck is auto-assigned — no second picker step.
  if (pickerStep === 1) {
    p1DeckIds = [...ids];
    if (isAiMode) {
      p2DeckIds = [...STARTER_DECKS[Math.floor(Math.random() * STARTER_DECKS.length)].ids];
      pickerStep = 3;
      document.getElementById('deck-picker').style.display = 'none';
      document.getElementById('map-picker').style.display = '';
    } else {
      pickerStep = 2;
      document.getElementById('picker-label').textContent = 'PLAYER 2 — CHOOSE YOUR DECK';
    }
  } else {
    p2DeckIds = [...ids];
    pickerStep = 3;
    document.getElementById('deck-picker').style.display = 'none';
    document.getElementById('map-picker').style.display = '';
  }
```
`STARTER_DECKS` is already imported at the top of `game.js:22` — no new import needed.

- [ ] **Step 6: Skip P2's mulligan screen in AI mode**

In `digital/js/game.js`, find the local-play branch of `startGame` (`game.js:296-308`):
```js
  if (!isOnline) {
    document.getElementById('lobby').style.display = 'none';
    showMulligan('P1 — OPENING HAND', s.p1.hand, indices1 => {
      s = applyMulligan(s, 'p1', indices1);
      s = { ...s, p1: drawCards(s.p1, 1) };
      showMulligan('P2 — OPENING HAND', s.p2.hand, indices2 => {
        s = applyMulligan(s, 'p2', indices2);
        s = { ...s, p2: drawCards(s.p2, 1) };
        finishStartGame(s, mapId);
      });
    });
    return;
  }
```
Replace with:
```js
  if (!isOnline) {
    document.getElementById('lobby').style.display = 'none';
    showMulligan('P1 — OPENING HAND', s.p1.hand, indices1 => {
      s = applyMulligan(s, 'p1', indices1);
      s = { ...s, p1: drawCards(s.p1, 1) };
      if (isAiMode) {
        // Bot keeps its opening hand — no UI shown for P2 in AI mode.
        s = { ...s, p2: drawCards(s.p2, 1) };
        finishStartGame(s, mapId);
      } else {
        showMulligan('P2 — OPENING HAND', s.p2.hand, indices2 => {
          s = applyMulligan(s, 'p2', indices2);
          s = { ...s, p2: drawCards(s.p2, 1) };
          finishStartGame(s, mapId);
        });
      }
    });
    return;
  }
```
Note: the non-AI-mode path draws 1 card for P2 *after* `applyMulligan`; the AI-mode path skips `applyMulligan` entirely (bot always keeps its hand) but still draws the same 1 card, so P2's hand size matches the human path exactly (5 cards, matching what P1 ends up with).

- [ ] **Step 7: Verify the checkpoint**

Reload `index.html`, click "vs AI", pick any P1 deck. Confirm: no "PLAYER 2 — CHOOSE YOUR DECK" screen appears — it goes straight to the map picker. Pick a map. Confirm: only ONE mulligan screen appears (P1's), and after confirming/keeping it, the game board loads directly (no P2 mulligan screen). At this point P1's hand is visible and playable; P2 has no way to act yet (expected — Task 3 adds that). Manually place a P1 card to confirm normal play still works, then leave the tab open or reload.

- [ ] **Step 8: Commit**
```bash
git add digital/index.html digital/js/game.js
git commit -m "feat: vs AI lobby entry point — P2 deck/mulligan auto-skip"
```

---

## Task 3: In-page bot turn orchestrator

**Files:**
- Create: `digital/js/bot_player.js`

This is a near-1:1 port of `playTurnSmart` / `resolveTargetingSmart` / `flushPendingUiState` / `handleForwardObserver` / `handleArtyTargeting` from `selfplay_test.mjs`, with two mechanical substitutions: Playwright's `page.locator(sel).click()` becomes `document.querySelector(sel)?.click()`, and `await page.evaluate(() => window.__SIGNAL_DEBUG__)` becomes a direct, synchronous `window.__SIGNAL_DEBUG__` read (no page boundary to cross). The decision logic itself (lethal-check first, then score placement/attack/command, dead-command tracking) is unchanged.

- [ ] **Step 1: Create `digital/js/bot_player.js`**

```js
// In-page "vs AI" bot — plays P2's turn automatically inside the human's own browser tab.
// Reuses the exact scoring logic already validated in selfplay_test.mjs / bot_ai.js, but
// instead of driving a separate Playwright browser, it clicks the real DOM elements on this
// page directly — the same elements a human would click. This goes through game.js's existing,
// unmodified click handlers, so no game logic needed to change to add this feature.
import { CARD_BY_ID } from "./cards.js";
import { bestPlacement, bestExistingAttack, findLethal, bestAttackForUnit, bestDamageCommandTarget } from "./bot_ai.js";

const DAMAGE_COMMAND_IDS = new Set([16, 20, 79]);
const CLICK_DELAY_MS = 350; // pacing so a human watching can follow what the bot is doing

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function readDebug() { return window.__SIGNAL_DEBUG__ ?? null; }
function clickTile(key) { document.querySelector(`.tile[data-key="${key}"]`)?.click(); }
function clickHandCard(cardId) { document.querySelector(`#p1-hand .hand-card[data-card-id="${cardId}"]`)?.click(); }
function isGameOver() {
  const el = document.getElementById("end-screen");
  return !!el && el.style.display !== "none";
}

async function handleForwardObserver() {
  const modal = document.getElementById("fo-modal");
  if (!modal || modal.style.display === "none") return;
  const slots = document.querySelectorAll(".fo-slot");
  const positions = ["keep", "top", "bottom"];
  for (let i = 0; i < slots.length; i++) {
    document.getElementById(`fo-btn-${i}-${positions[i] ?? "top"}`)?.click();
    await sleep(80);
  }
  document.getElementById("fo-confirm")?.click();
  await sleep(CLICK_DELAY_MS);
}

async function handleArtyTargeting() {
  const targets = document.querySelectorAll(".tile.targetable");
  if (targets.length > 0) targets[0].click();
  await sleep(CLICK_DELAY_MS);
}

// If we reach the top of the decision loop with uiState != 'idle', it's leftover from
// something that didn't fully resolve (see selfplay_test.mjs for the original diagnosis:
// a stale targeting/command prompt silently swallows the next click instead of registering).
// Bail out of it cleanly via Cancel rather than guess a target.
async function flushPendingUiState(debug) {
  if (!debug || debug.uiState === "idle") return debug;
  document.getElementById("btn-cancel")?.click();
  await sleep(CLICK_DELAY_MS);
  return readDebug();
}

async function resolveTargetingSmart({ attackerKey = null, isDamageCommand = false } = {}, maxSteps = 3) {
  for (let i = 0; i < maxSteps; i++) {
    const targetTiles = [...document.querySelectorAll(".tile.targetable, .tile.cmd-target")];
    if (targetTiles.length === 0) return;
    const keys = targetTiles.map(t => t.dataset.key);

    const debug = readDebug();
    let chosenKey = keys[0];
    if (debug?.state) {
      if (isDamageCommand) {
        const best = bestDamageCommandTarget(debug.state, debug.state.initiative, keys);
        if (best) chosenKey = best.targetKey;
      } else if (attackerKey) {
        const atk = bestAttackForUnit(debug.state, attackerKey);
        if (atk && keys.includes(atk.targetKey)) chosenKey = atk.targetKey;
      }
    }
    clickTile(chosenKey);
    await sleep(CLICK_DELAY_MS);
  }
}

async function playBotTurnSteps() {
  // Some commands need a specific target (a suppressed friendly, an objective-adjacent unit,
  // etc.) and are a complete no-op if none exists right now. Track cards that just no-op'd and
  // exclude them for the rest of this turn instead of retrying the same dead command forever.
  const deadThisTurn = new Set();

  for (let i = 0; i < 12; i++) {
    await handleForwardObserver();
    if (isGameOver()) return;

    let debug = await flushPendingUiState(readDebug());
    if (!debug?.state) break;
    const { state, attackedThisTurn } = debug;
    const active = state.initiative;
    if (active !== "p2") return; // safety: bot only ever plays its own turn
    const ps = state[active];
    const attackedMap = new Map(attackedThisTurn);

    const lethal = findLethal(state, active, attackedMap);
    if (lethal) {
      clickTile(lethal.attackerKey);
      await sleep(CLICK_DELAY_MS);
      clickTile(lethal.targetKey);
      await sleep(CLICK_DELAY_MS);
      continue;
    }

    const handUnitIds = ps.hand.filter(id => {
      const c = CARD_BY_ID[id];
      if (!c || c.type !== "unit") return false;
      const discount = c.cls === "Tank" ? Math.min(c.cost, ps.tempFuelDiscount ?? 0) : 0;
      return ps.fuel >= (c.cost - discount);
    });
    const emptyTiles = Object.keys(state.board).filter(k => !state.board[k] && !state.objectives[k]);
    const placement = handUnitIds.length && emptyTiles.length ? bestPlacement(state, active, handUnitIds, emptyTiles) : null;
    const attack = bestExistingAttack(state, active, attackedMap);

    const affordableCommandId = ps.hand.find(id => { const c = CARD_BY_ID[id]; return c && c.type === "command" && ps.fuel >= c.cost && !deadThisTurn.has(id); });
    const affordableMissionId = ps.hand.find(id => { const c = CARD_BY_ID[id]; return c && c.type === "mission" && ps.fuel >= c.cost && !deadThisTurn.has(id); });

    const candidates = [];
    if (placement) candidates.push({ type: "place", score: placement.score, cardId: placement.cardId, tileKey: placement.tileKey });
    if (attack) candidates.push({ type: "attack", score: attack.score, unitKey: attack.unitKey, targetKey: attack.targetKey });
    if (affordableCommandId !== undefined) candidates.push({ type: "command", score: 0.1, cardId: affordableCommandId });
    if (candidates.length === 0 && affordableMissionId !== undefined) candidates.push({ type: "mission", score: 0.1, cardId: affordableMissionId });

    if (candidates.length === 0) break; // nothing useful left this turn

    candidates.sort((a, b) => b.score - a.score);
    const choice = candidates[0];

    if (choice.type === "place") {
      clickHandCard(choice.cardId);
      await sleep(CLICK_DELAY_MS);
      clickTile(choice.tileKey);
      await sleep(CLICK_DELAY_MS);
      await resolveTargetingSmart({ attackerKey: choice.tileKey });
    } else if (choice.type === "attack") {
      clickTile(choice.unitKey);
      await sleep(CLICK_DELAY_MS);
      clickTile(choice.targetKey);
      await sleep(CLICK_DELAY_MS);
    } else if (choice.type === "command") {
      const handBefore = ps.hand.length;
      clickHandCard(choice.cardId);
      await sleep(CLICK_DELAY_MS);
      await resolveTargetingSmart({ isDamageCommand: DAMAGE_COMMAND_IDS.has(choice.cardId) });
      const afterDebug = readDebug();
      const handAfter = afterDebug?.state?.[active]?.hand?.length ?? handBefore;
      if (handAfter === handBefore) deadThisTurn.add(choice.cardId); // no-op: card never left hand
      await flushPendingUiState(afterDebug);
    } else if (choice.type === "mission") {
      clickHandCard(choice.cardId);
      await sleep(CLICK_DELAY_MS);
    }
  }
}

// Called by game.js right after P2 becomes the active player in AI mode.
// Plays out P2's whole turn, then clicks End Turn itself — handing control back to P1.
export async function runBotTurn() {
  await sleep(CLICK_DELAY_MS);
  await handleForwardObserver();
  await handleArtyTargeting();
  await playBotTurnSteps();
  await handleForwardObserver();
  if (isGameOver()) return;

  const endTurnBtn = document.getElementById("btn-end-turn");
  if (endTurnBtn && !endTurnBtn.disabled) {
    endTurnBtn.click();
  }
}
```

- [ ] **Step 2: Verify the file loads without syntax errors**

```bash
cd digital && node --check js/bot_player.js && echo OK
```
Expected: `OK` (this only checks JS syntax — `runBotTurn` isn't wired to anything yet, so it can't be exercised until Task 4).

- [ ] **Step 3: Commit**
```bash
git add digital/js/bot_player.js
git commit -m "feat: in-page bot turn orchestrator for vs AI mode"
```

---

## Task 4: Wire the bot trigger into the turn-end flow

**Files:**
- Modify: `digital/js/game.js`

- [ ] **Step 1: Import `runBotTurn`**

At the top of `digital/js/game.js`, after the existing `decks.js` import (`game.js:22`):
```js
import { STARTER_DECKS, loadCustomDecks, validateDeck, computeDeckAP } from './decks.js?v=1784635194';
```
add:
```js
import { runBotTurn } from './bot_player.js?v=1784635194';
```
(Match whatever cache-busting `?v=` suffix the other imports currently carry — the exact number doesn't matter, just consistency with the rest of the file.)

- [ ] **Step 2: Trigger the bot after End Turn hands initiative to P2**

In `digital/js/game.js`, find the tail of the End Turn click handler (`game.js:1432-1436`):
```js
  const newRound = Math.ceil(newState.turn / 2);
  const turnLog = [...endMissionLog, `--- Round ${newRound} — ${newState.initiative.toUpperCase()} ---`, ...supplyLog, ...effectLog];
  commitState(newState, turnLog);
  checkWin();
});
```
Replace with:
```js
  const newRound = Math.ceil(newState.turn / 2);
  const turnLog = [...endMissionLog, `--- Round ${newRound} — ${newState.initiative.toUpperCase()} ---`, ...supplyLog, ...effectLog];
  commitState(newState, turnLog);
  checkWin();

  if (isAiMode && !gameOver && newState.initiative === 'p2') {
    runBotTurn();
  }
});
```
`runBotTurn()` is async and intentionally not awaited here — the click handler itself must stay synchronous (it's a DOM event handler), and `runBotTurn` drives itself forward via its own internal `await sleep(...)` calls, eventually clicking `#btn-end-turn` itself to hand control back to P1 (which re-enters this same handler, checks `newState.initiative === 'p2'` — now false — and stops).

- [ ] **Step 3: Verify — full manual playthrough**

Reload the game (`http://localhost:3000/index.html` → vs AI → pick deck → pick map → confirm/keep mulligan). Play a full P1 turn (place at least one unit), click End Turn. Confirm:
- The turn indicator changes to show P2's turn.
- Within ~1-2 seconds, board tiles start changing on their own (bot placing/attacking) with matching log entries appearing in the battle log.
- After the bot finishes, the turn indicator returns to P1 and the End Turn button is active again — with no further input needed from you to reach this point.
- Repeat for at least 3-4 full rounds to confirm this keeps working turn after turn, not just once.

- [ ] **Step 4: Verify — existing regression harness still passes unchanged**

`selfplay_test.mjs` drives *both* sides externally via `Local Play` (no `?ai=1`), so `isAiMode` is `false` in that flow and `runBotTurn()` never fires — this confirms the click-handler changes made in this plan (which only added an `if` branch, changing nothing on the `false` path) haven't regressed anything:
```bash
cd digital && node selfplay_test.mjs 10
```
Expected: results in the same ballpark as the last known-good run (10/10 played, 0 stalls, 0 crashes, average ~8-9 rounds). If this regresses, the bug is in Task 4 Step 2's edit specifically (it's the only change touching shared code) — re-check the diff.

- [ ] **Step 5: Commit**
```bash
git add digital/js/game.js
git commit -m "feat: wire vs AI bot trigger into end-of-turn flow"
```

---

## Task 5: Automated smoke test for AI mode itself

**Files:**
- Create: `digital/selfplay_vs_ai_smoke.mjs`

Task 4's Step 4 proves the *existing* harness didn't regress. This task adds a small, separate script that specifically exercises the *new* AI-mode path headlessly — driving only P1 and confirming P2 resolves on its own — so this doesn't rely on manual browser testing alone going forward.

- [ ] **Step 1: Create `digital/selfplay_vs_ai_smoke.mjs`**

```js
// Smoke test for "vs AI" mode: drives ONLY P1 via Playwright. If the bot wiring works,
// P2's turns resolve on their own with no P2-side clicks from this script at all.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ROUNDS_TO_PLAY = 3;

async function readDebug(page) { return page.evaluate(() => window.__SIGNAL_DEBUG__ ?? null); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));

  await page.goto(`${BASE_URL}/game.html?ai=1`, { waitUntil: "domcontentloaded" });

  // P1 deck + map pick (P2 is auto-assigned in AI mode — no second picker step to handle).
  await page.locator("#deck-grid .deck-option[data-deck='aggro']").click();
  await page.locator("#map-picker").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#map-grid .deck-option[data-map='kursk']").click();

  // Only P1's mulligan should appear.
  await page.locator("#btn-mulligan-keep").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#btn-mulligan-keep").click();

  await page.locator("#game-area").waitFor({ state: "visible", timeout: 5000 });
  console.log("Game started in AI mode — P1 hand and board visible.");

  for (let round = 1; round <= ROUNDS_TO_PLAY; round++) {
    if (await page.locator("#end-screen").isVisible().catch(() => false)) {
      console.log(`Game ended before round ${round} (bot or P1 already won) — that's fine for a smoke test.`);
      break;
    }
    // P1 does nothing but pass — this test only cares whether P2's turn resolves unattended.
    await page.locator("#btn-end-turn").click();
    await page.waitForTimeout(1500); // give the bot's paced clicks (350ms each) room to run

    const debug = await readDebug(page);
    const turnText = await page.locator("#turn-display").innerText().catch(() => "?");
    console.log(`After round ${round}: initiative=${debug?.state?.initiative}, turn-display="${turnText}"`);

    if (debug?.state?.initiative !== "p1") {
      console.log(`FAIL: expected control back at P1 after the bot's turn, got initiative="${debug?.state?.initiative}"`);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`Page errors: ${pageErrors.length}`);
  pageErrors.forEach(e => console.log("  " + e));
  if (pageErrors.length > 0) process.exitCode = 1;

  await browser.close();
})();
```

- [ ] **Step 2: Run it**

```bash
cd digital && node selfplay_vs_ai_smoke.mjs
```
Expected output: `Game started in AI mode...` followed by 3 lines like `After round N: initiative=p1, turn-display="..."`, then `Page errors: 0`, exit code 0. If `initiative` is ever anything other than `p1` after a round, or the script hangs (bot never handed control back), that's a real bug in the Task 3/4 wiring — worth reproducing with `headless: false` to watch it directly.

- [ ] **Step 3: Commit**
```bash
git add digital/selfplay_vs_ai_smoke.mjs
git commit -m "test: headless smoke test for vs AI mode turn handoff"
```

---

## Self-Review

**Spec coverage:**
- Human plays P1 through normal UI → Task 2 (lobby entry, P1 deck/map/mulligan unchanged) + Task 4 (bot never touches P1's turn).
- Bot auto-plays P2 on turn end, hands control back → Task 4 Step 2 (trigger) + Task 3 (`runBotTurn` ends its own turn).
- Reuse `bot_ai.mjs` battle-tested logic → Task 1 (moved, not rewritten) + Task 3 (imports it directly, same scoring functions).
- Direct state-mutation calls instead of simulated DOM events → **superseded during planning**: the lower-risk design (Task 3) clicks real DOM elements through the existing handlers instead, for the reasons explained in the Architecture section. Functionally equivalent outcome (bot plays P2 automatically) with less regression surface.
- New lobby entry point alongside existing options → Task 2 Steps 1-2.
- Must not regress online-multiplayer or local-hotseat → verified structurally (all new logic is gated behind `isAiMode`, which is only ever true for the new `?ai=1` URL) and empirically (Task 4 Step 4 re-runs the existing harness, which never sets `isAiMode`).

**Placeholder scan:** No TBDs; every step has complete, runnable code.

**Type/naming consistency:** `runBotTurn` (Task 3 export, Task 4 import/call) — consistent. `isAiMode` (Task 2 Step 4 declaration, used in Task 2 Step 5-6 and Task 4 Step 2) — consistent. `STARTER_DECKS` (already-imported in `game.js`, reused in Task 2 Step 5 without a new import) — verified against current file content, not assumed.
