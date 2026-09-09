// Regression script for 3 bug fixes on branch fix/signal-gameplay-corrections:
//   1) getUnitOnPlayManeuverSources / getCommandManeuverSources no longer exclude Suppressed
//      friendly units as Maneuver sources (A55 On-Play Maneuver, C21 Forced March).
//   2) The attack-click handler now emits a transitionFlag/popup for EVERY boardMutations entry
//      (Blast/Barrage secondary victims), not just boardMutations[0].
//   3) The [data-tip-tap] click-to-pin tooltip system (floating-tip) clears its pin on outside
//      click, Escape, and DOM-rebuild (Mulligan re-render), instead of only on re-clicking the
//      same pip — which could get permanently stuck open.
//
// Drives a real local hot-seat game (game.html, no ?ai=1 — both players are "clicked" by this
// script) through the actual UI: map pick -> P1 deck pick -> P2 deck pick -> P1 mulligan ->
// P2 mulligan -> game-area. Never calls internal game.js functions directly.
//
// Run with the dev server already up: node regression_bugfix_checks.mjs
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";

// ── small helpers ────────────────────────────────────────────────────────────
function log(...args) { console.log(...args); }

async function readDebug(page) {
  return page.evaluate(() => window.__SIGNAL_DEBUG__ ?? null);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function tipDisplay(page) {
  return page.locator("#floating-tip").evaluate(el => el.style.display || "");
}

// Opens the debug panel (idempotent — no-ops if already open).
async function openDebugPanel(page) {
  const panel = page.locator("#debug-panel");
  const visible = await panel.isVisible().catch(() => false);
  if (!visible) {
    await page.locator("#debug-toggle").click();
    await panel.waitFor({ state: "visible", timeout: 3000 });
  }
}

async function setDebugTargetPlayer(page, role) {
  await openDebugPanel(page);
  await page.locator(`#debug-player-${role}`).click();
}

async function debugAddCardByName(page, role, cardId, cardName) {
  await setDebugTargetPlayer(page, role);
  await page.locator("#debug-card-search").fill(cardName);
  const result = page.locator(".debug-card-result", { hasText: `(${cardId})` });
  await result.first().waitFor({ state: "visible", timeout: 3000 });
  await result.first().click();
  log(`  [debug] added ${cardName} (${cardId}) to ${role.toUpperCase()}'s hand`);
}

async function debugSetFuel(page, role, value) {
  await setDebugTargetPlayer(page, role);
  await page.locator("#debug-fuel-value").fill(String(value));
  await page.locator("#debug-fuel-set").click();
  log(`  [debug] set ${role.toUpperCase()} fuel to ${value}`);
}

async function debugSuppressUnitAt(page, tileKey) {
  await openDebugPanel(page);
  await page.locator("#debug-unit-select-btn").click();
  await page.locator(`.tile[data-key="${tileKey}"]`).click();
  await page.locator("#debug-unit-suppress").click();
  log(`  [debug] suppressed unit at ${tileKey}`);
}

// Places a hand card (must already be in the active player's hand) onto an empty board tile.
async function placeCard(page, cardId, tileKey) {
  await page.locator(`#p1-hand .hand-card[data-card-id="${cardId}"]`).first().click();
  await page.locator(`.tile[data-key="${tileKey}"]`).click();
}

async function clickTile(page, tileKey) {
  await page.locator(`.tile[data-key="${tileKey}"]`).click();
}

async function clickHandCard(page, cardId) {
  await page.locator(`#p1-hand .hand-card[data-card-id="${cardId}"]`).first().click();
}

// End Turn, then handle the "deploy your first Hero" modal if it appears (round 2+, ~1800ms
// delayed setTimeout in game.js's runHeroPhase — see showHeroDeploy call site).
async function endTurn(page) {
  await page.locator("#btn-end-turn").click();
  const shown = await page.locator("#hero-deploy-modal")
    .waitFor({ state: "visible", timeout: 2600 }).then(() => true).catch(() => false);
  if (shown) {
    log("  [end-turn] hero-deploy-modal appeared — deploying first available Hero/zone");
    await page.locator("#hero-deploy-cards .hero-card").first().click();
    await page.locator("#hero-deploy-zones .hero-zone-pick:not([disabled])").first().click();
    await page.locator("#hero-deploy-modal").waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}

// ── Test 5 setup: startup flow through map/deck picks up to (and including) both mulligans,
// with the tooltip-pin lifecycle test run on whichever mulligan hand has a [data-tip-tap] pip.
async function runStartupAndTooltipTest(page, results) {
  log("\n=== STARTUP FLOW (map -> P1 deck -> P2 deck -> mulligans) ===");
  await page.goto(`${BASE_URL}/game.html`, { waitUntil: "domcontentloaded" });

  await page.locator('#map-grid .deck-option[data-map="kursk"]').waitFor({ state: "visible", timeout: 8000 });
  await page.locator('#map-grid .deck-option[data-map="kursk"]').click();
  log("Picked map: Kursk — The Two Fronts");

  await page.locator("#deck-picker").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#deck-grid .deck-option").first().click();
  log("Picked P1 deck (first option)");
  await page.waitForTimeout(150);
  await page.locator("#deck-grid .deck-option").first().click();
  log("Picked P2 deck (first option)");

  await page.locator("#mulligan-screen").waitFor({ state: "visible", timeout: 5000 });
  const label1 = await page.locator("#mulligan-label").innerText();
  log(`Mulligan screen #1 shown: "${label1}"`);

  const pipCount1 = await page.locator("#mulligan-hand [data-tip-tap]").count();
  log(`  mulligan hand #1 has ${pipCount1} [data-tip-tap] pip(s)`);

  if (pipCount1 > 0) {
    await runTooltipLifecycleTest(page, results, "hand #1");
  } else {
    log("  no pip on hand #1 — will try hand #2 instead");
  }
  await page.locator("#btn-mulligan-keep").click();

  const shown2 = await page.locator("#mulligan-screen").waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  if (shown2) {
    const label2 = await page.locator("#mulligan-label").innerText();
    log(`Mulligan screen #2 shown: "${label2}"`);
    if (pipCount1 === 0) {
      const pipCount2 = await page.locator("#mulligan-hand [data-tip-tap]").count();
      log(`  mulligan hand #2 has ${pipCount2} [data-tip-tap] pip(s)`);
      if (pipCount2 > 0) {
        await runTooltipLifecycleTest(page, results, "hand #2");
      } else {
        results.test5 = "FAIL: neither mulligan hand had a card with a [data-tip-tap] pip (unlucky draw — rerun the script)";
        log(`  [Test 5] ${results.test5}`);
      }
    }
    await page.locator("#btn-mulligan-keep").click();
  } else if (pipCount1 === 0) {
    results.test5 = "FAIL: only one mulligan screen appeared and it had no [data-tip-tap] pip";
  }

  await page.locator("#game-area").waitFor({ state: "visible", timeout: 5000 });
  log("Game area visible — match started.");
}

async function runTooltipLifecycleTest(page, results, label) {
  log(`--- Test 5: tooltip pinned-state lifecycle (on mulligan ${label}) ---`);
  try {
    const pip = page.locator("#mulligan-hand [data-tip-tap]").first();
    await pip.click();
    let disp = await tipDisplay(page);
    assert(disp === "block", `expected #floating-tip visible after clicking pip, got display="${disp}"`);
    log("  pip click -> tip opened: OK");

    // Outside click (not a data-tip-tap, not inside #floating-tip) dismisses it.
    await page.locator("#mulligan-label").click();
    disp = await tipDisplay(page);
    assert(disp !== "block", `expected #floating-tip hidden after outside click, got display="${disp}"`);
    log("  outside click -> tip dismissed: OK");

    // Re-open, then Escape dismisses it.
    await pip.click();
    disp = await tipDisplay(page);
    assert(disp === "block", "expected tip open again before Escape test");
    await page.keyboard.press("Escape");
    disp = await tipDisplay(page);
    assert(disp !== "block", `expected #floating-tip hidden after Escape, got display="${disp}"`);
    log("  Escape -> tip dismissed: OK");

    // Re-open, then toggle the SAME card's mulligan-selection (click its header, not the pip) —
    // renderMulliganCards rebuilds #mulligan-hand, orphaning the pinned pip's DOM node.
    await pip.click();
    disp = await tipDisplay(page);
    assert(disp === "block", "expected tip open again before DOM-rebuild test");

    const cardIndex = await page.evaluate(() => {
      const p = document.querySelector('#mulligan-hand [data-tip-tap]');
      const card = p.closest('.hand-card');
      return Array.from(card.parentElement.children).indexOf(card);
    });
    log(`  pinned pip belongs to mulligan-hand card index ${cardIndex}`);
    await page.locator("#mulligan-hand .hand-card").nth(cardIndex).locator(".hc-header").click();
    // renderMulliganCards ran again — confirm the stale pin didn't survive as "stuck open".
    disp = await tipDisplay(page);
    assert(disp !== "block", `expected #floating-tip hidden after the pinned card's DOM was rebuilt, got display="${disp}"`);
    log("  DOM rebuild (mulligan re-render) -> tip dismissed, not stuck open: OK");

    // Hover a DIFFERENT card's tip element and confirm hover-driven tooltips still work
    // (proving the stale pin isn't still blocking hover dismiss/open logic for everyone else).
    const otherIndex = await page.evaluate((skipIndex) => {
      const cards = Array.from(document.querySelectorAll('#mulligan-hand .hand-card'));
      for (let i = 0; i < cards.length; i++) {
        if (i === skipIndex) continue;
        if (cards[i].querySelector('[data-tip], [data-tip-tap]')) return i;
      }
      return -1;
    }, cardIndex);

    let hoverTarget;
    if (otherIndex >= 0) {
      hoverTarget = page.locator("#mulligan-hand .hand-card").nth(otherIndex).locator("[data-tip], [data-tip-tap]").first();
      log(`  hovering a DIFFERENT card (index ${otherIndex}) to confirm hover still works`);
    } else {
      hoverTarget = page.locator("#mulligan-hand [data-tip], #mulligan-hand [data-tip-tap]").first();
      log("  WARNING: no other card in this hand had a tip element — hovering the same card's pip as a fallback (weaker check)");
    }
    await hoverTarget.hover();
    disp = await tipDisplay(page);
    assert(disp === "block", `expected hover to open #floating-tip normally after the stale pin was cleared, got display="${disp}"`);
    log("  hover on a different card after stale-pin rebuild -> tip opens normally: OK");
    // Move mouse away so it doesn't interfere with the next step.
    await page.mouse.move(10, 10);

    results.test5 = "PASS";
    log("[Test 5] PASS");
  } catch (e) {
    results.test5 = `FAIL: ${e.message}`;
    log(`[Test 5] FAIL: ${e.message}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("console", msg => { if (msg.type() === "error") log("PAGE console.error:", msg.text()); });

  const results = { test1: null, test2: null, test3: null, test4: null, test5: null };

  try {
    await runStartupAndTooltipTest(page, results);

    let debug = await readDebug(page);
    const startRole = debug.state.initiative;
    const secondRole = startRole === "p1" ? "p2" : "p1";
    log(`\nInitiative for turn 1: ${startRole.toUpperCase()} (dynamic — randomized per match, doc 02 Q005)`);
    log(`startRole=${startRole} secondRole=${secondRole}`);

    // ── TURN 1 (startRole): Test 1 (A55 On-Play Maneuver) + Test 2 (C21 Forced March) ──
    log("\n=== TURN 1 (startRole) — Test 1 & Test 2 setup ===");
    await debugSetFuel(page, startRole, 20);
    await debugAddCardByName(page, startRole, "I1", "Rifle Squad");
    await debugAddCardByName(page, startRole, "I1", "Rifle Squad");
    await debugAddCardByName(page, startRole, "A55", "Tactical Fighter");
    await debugAddCardByName(page, startRole, "C21", "Forced March");

    // --- Test 1 ---
    log("\n--- Test 1: A55 On-Play Maneuver allows a Suppressed source ---");
    try {
      await placeCard(page, "I1", "0,0");
      await debugSuppressUnitAt(page, "0,0");
      debug = await readDebug(page);
      assert(debug.state.board["0,0"]?.state === "suppressed", "expected I1 at 0,0 to be suppressed before A55 is placed");

      await placeCard(page, "A55", "0,3");
      debug = await readDebug(page);
      assert(debug.uiState === "unit-maneuver-source", `expected uiState "unit-maneuver-source" after placing A55, got "${debug.uiState}"`);
      log("  A55 placed -> uiState=unit-maneuver-source: OK");

      const srcTileClass = await page.locator('.tile[data-key="0,0"]').getAttribute("class");
      assert(srcTileClass?.includes("cmd-target"), `expected suppressed source tile 0,0 to carry a candidate highlight class, got class="${srcTileClass}"`);
      log("  suppressed unit's tile IS highlighted as a legal Maneuver source (cmd-target): OK");

      await clickTile(page, "0,0");
      debug = await readDebug(page);
      assert(debug.uiState === "unit-maneuver-destination", `expected uiState "unit-maneuver-destination" after picking the suppressed source, got "${debug.uiState}"`);
      log("  clicking the Suppressed source was ACCEPTED -> uiState=unit-maneuver-destination: OK");

      await clickTile(page, "0,1");
      debug = await readDebug(page);
      assert(!debug.state.board["0,0"], "expected 0,0 to be empty after the maneuver completed");
      assert(debug.state.board["0,1"]?.state === "suppressed", `expected the moved unit at 0,1 to still be Suppressed, got ${JSON.stringify(debug.state.board["0,1"])}`);
      log("  unit maneuvered to 0,1 and REMAINS Suppressed: OK");

      results.test1 = "PASS";
      log("[Test 1] PASS");
    } catch (e) {
      results.test1 = `FAIL: ${e.message}`;
      log(`[Test 1] FAIL: ${e.message}`);
    }

    // --- Test 2 ---
    log("\n--- Test 2: Command C21 Forced March also allows a Suppressed source ---");
    try {
      await placeCard(page, "I1", "0,0");
      await debugSuppressUnitAt(page, "0,0");
      debug = await readDebug(page);
      assert(debug.state.board["0,0"]?.state === "suppressed", "expected 2nd I1 at 0,0 to be suppressed before playing C21");

      await clickHandCard(page, "C21");
      debug = await readDebug(page);
      assert(debug.uiState === "command-maneuver-source", `expected uiState "command-maneuver-source" after playing C21, got "${debug.uiState}"`);
      log("  C21 played -> uiState=command-maneuver-source (no board click needed): OK");

      const srcTileClass = await page.locator('.tile[data-key="0,0"]').getAttribute("class");
      assert(srcTileClass?.includes("cmd-target"), `expected suppressed source tile 0,0 to carry a candidate highlight class, got class="${srcTileClass}"`);

      await clickTile(page, "0,0");
      debug = await readDebug(page);
      assert(debug.uiState === "command-maneuver-destination", `expected uiState "command-maneuver-destination" after picking the suppressed source, got "${debug.uiState}"`);
      log("  clicking the Suppressed source was ACCEPTED -> uiState=command-maneuver-destination: OK");

      await clickTile(page, "3,0");
      debug = await readDebug(page);
      assert(!debug.state.board["0,0"], "expected 0,0 to be empty after the maneuver completed");
      assert(debug.state.board["3,0"]?.state === "suppressed", `expected the moved unit at 3,0 to still be Suppressed, got ${JSON.stringify(debug.state.board["3,0"])}`);
      log("  unit maneuvered to 3,0 and REMAINS Suppressed (C21 also draws a card): OK");

      results.test2 = "PASS";
      log("[Test 2] PASS");
    } catch (e) {
      results.test2 = `FAIL: ${e.message}`;
      log(`[Test 2] FAIL: ${e.message}`);
    }

    // ── TURN 2 (secondRole): place Blast-victim units + the Test 3 enemy-source unit ──
    log("\n=== TURN 2 (secondRole) — placing Blast targets + Test 3 enemy unit ===");
    await endTurn(page);
    debug = await readDebug(page);
    assert(debug.state.initiative === secondRole, `expected initiative to have flipped to ${secondRole}, got ${debug.state.initiative}`);

    await debugSetFuel(page, secondRole, 20);
    for (let i = 0; i < 4; i++) await debugAddCardByName(page, secondRole, "I1", "Rifle Squad");
    await placeCard(page, "I1", "2,2"); // primary Blast target (east of AR46 at 2,1)
    await placeCard(page, "I1", "1,2"); // north secondary
    await placeCard(page, "I1", "3,2"); // south secondary
    await placeCard(page, "I1", "3,3"); // Test 3 enemy-owned unit (not adjacent to anything of ours)
    log("  placed 4 secondRole I1 units: 2,2 (primary) / 1,2 (north) / 3,2 (south) / 3,3 (Test-3 enemy unit)");

    // ── TURN 3 (startRole): Test 3 (negative case) + Test 4 (Blast secondary flags) ──
    log("\n=== TURN 3 (startRole) — Test 3 & Test 4 ===");
    await endTurn(page);
    debug = await readDebug(page);
    assert(debug.state.initiative === startRole, `expected initiative back to ${startRole}, got ${debug.state.initiative}`);

    await debugSetFuel(page, startRole, 20);
    await debugAddCardByName(page, startRole, "C21", "Forced March");
    await debugAddCardByName(page, startRole, "AR46", "Mortar Battery");

    // --- Test 3 ---
    log("\n--- Test 3: an ENEMY unit is rejected as a Maneuver source ---");
    try {
      await clickHandCard(page, "C21");
      debug = await readDebug(page);
      assert(debug.uiState === "command-maneuver-source", `expected uiState "command-maneuver-source" after playing 2nd C21, got "${debug.uiState}"`);

      const enemyTileClassBefore = await page.locator('.tile[data-key="3,3"]').getAttribute("class");
      assert(!enemyTileClassBefore?.includes("cmd-target"), `expected the enemy-owned tile 3,3 to NOT be highlighted as a legal source, got class="${enemyTileClassBefore}"`);
      log("  enemy-owned tile 3,3 is NOT highlighted as a candidate source: OK");

      await clickTile(page, "3,3"); // secondRole's unit — should be rejected
      debug = await readDebug(page);
      assert(debug.uiState === "command-maneuver-source", `expected uiState to STAY "command-maneuver-source" after clicking an enemy tile (click should be a no-op), got "${debug.uiState}"`);
      assert(debug.state.board["3,3"]?.owner === secondRole, "expected the enemy unit to still be at 3,3, untouched");
      log("  clicking the enemy tile as a Maneuver source was REJECTED (uiState unchanged, unit untouched): OK");

      // Clean up: cancel this C21 flow (refunds Fuel/hand via preCommandState) before Test 4.
      await page.locator("#btn-cancel").click();
      debug = await readDebug(page);
      assert(debug.uiState === "idle", `expected uiState "idle" after Cancel, got "${debug.uiState}"`);
      log("  cancelled the C21 flow cleanly (uiState back to idle) to proceed to Test 4");

      results.test3 = "PASS";
      log("[Test 3] PASS");
    } catch (e) {
      results.test3 = `FAIL: ${e.message}`;
      log(`[Test 3] FAIL: ${e.message}`);
    }

    // --- Test 4 ---
    log("\n--- Test 4: Blast secondary victims each get their own transition flag ---");
    try {
      await placeCard(page, "AR46", "2,1"); // west of the primary target at 2,2 -> attacks E (strong side, E=6)
      debug = await readDebug(page);
      assert(debug.uiState === "targeting", `expected uiState "targeting" after placing AR46 next to an enemy, got "${debug.uiState}"`);
      assert(debug.pendingAttackerKey === "2,1", `expected pendingAttackerKey "2,1", got "${debug.pendingAttackerKey}"`);
      log("  AR46 placed at 2,1 -> uiState=targeting, pendingAttackerKey=2,1: OK");

      const beforeBoard = debug.state.board;
      assert(beforeBoard["2,2"]?.state === "normal" && beforeBoard["1,2"]?.state === "normal" && beforeBoard["3,2"]?.state === "normal",
        `expected all 3 victims normal before the attack, got 2,2=${beforeBoard["2,2"]?.state} 1,2=${beforeBoard["1,2"]?.state} 3,2=${beforeBoard["3,2"]?.state}`);

      await clickTile(page, "2,2"); // attack the primary target -> Blast hits 1,2 and 3,2 too
      await page.waitForTimeout(150); // let the redraw + transitionFlags/popups apply

      debug = await readDebug(page);
      const after = debug.state.board;
      log(`  post-attack board states: 2,2=${after["2,2"]?.state ?? "destroyed/empty"} 1,2=${after["1,2"]?.state ?? "destroyed/empty"} 3,2=${after["3,2"]?.state ?? "destroyed/empty"}`);

      for (const key of ["2,2", "1,2", "3,2"]) {
        const unit = after[key];
        const changed = !unit || unit.state === "suppressed" || unit.state === "destroyed";
        assert(changed, `expected tile ${key} to show a real Hit outcome (suppressed/destroyed), got ${JSON.stringify(unit)}`);
      }
      log("  underlying board state: all 3 tiles (primary + 2 Blast secondaries) show a real Hit outcome: OK");

      // Visual/CSS evidence: destroyed units leave the board (tile-level class); a Suppressed
      // unit stays on the board (board-card gets the just-suppressed class this render).
      for (const key of ["2,2", "1,2", "3,2"]) {
        const tileClass = await page.locator(`.tile[data-key="${key}"]`).getAttribute("class");
        const unit = after[key];
        if (!unit) {
          assert(tileClass?.includes("tile-just-destroyed"), `expected tile ${key} (destroyed) to carry tile-just-destroyed, got class="${tileClass}"`);
          log(`  ${key}: destroyed -> tile carries tile-just-destroyed: OK`);
        } else if (unit.state === "suppressed") {
          const cardClass = await page.locator(`.tile[data-key="${key}"] .board-card`).getAttribute("class");
          assert(cardClass?.includes("just-suppressed"), `expected tile ${key} (suppressed) board-card to carry just-suppressed, got class="${cardClass}"`);
          log(`  ${key}: suppressed -> board-card carries just-suppressed: OK`);
        }
      }

      results.test4 = "PASS";
      log("[Test 4] PASS");
    } catch (e) {
      results.test4 = `FAIL: ${e.message}`;
      log(`[Test 4] FAIL: ${e.message}`);
    }

  } catch (e) {
    log("\nFATAL (setup/sequencing error outside an individual test's try/catch):", e.message);
    log(e.stack);
  }

  log("\n=== RESULTS ===");
  for (const [k, v] of Object.entries(results)) log(`${k}: ${v ?? "NOT RUN"}`);

  log(`\nPage errors: ${pageErrors.length}`);
  pageErrors.forEach(e => log("  " + e));

  await browser.close();

  const anyFail = Object.values(results).some(v => v == null || v.startsWith("FAIL"));
  if (anyFail || pageErrors.length > 0) process.exitCode = 1;
})();
