// Regression checks for two game bugs found in the 2026-09-16 match-statistics plan review:
//   1) Lethal Direct HQ at End Turn must end the match right there. It used to carry on into the
//      defeated player's turn (draw, Objective effects), so their Objective backbone could still
//      hit the winner, and checkWin (which tests P1 first) could then name the wrong winner.
//   2) Cancelling Maneuver Commander (H16) on its destination step must refund the Fuel.
// And two found while fixing selfplay_test.mjs the same day:
//   3) After Field Coordinator's (H11) rotate direction pick, End Turn must be usable right away
//      (the modal closed without a redraw, leaving it stuck on "Finish Choice").
//   4) The vs AI bot must finish a turn in which it used Quartermaster General (H01): it never
//      handled that modal, so P2's turn froze with End Turn disabled.
//   5) Two Hero deploy timers pending at once (turns ended faster than runHeroPhase's 1800ms delay)
//      must not replace each other's modal: each player gets their own prompt, one after the other.
//
// Each scenario starts a real game (local hot-seat, or vs AI for #4), injects a prepared board
// through window.__SIGNAL_TEST_HOOKS__.receiveRemoteState, then drives the real UI (End Turn
// button, Hero Zone, board tiles, Escape, modal buttons).
//
// Run with the dev server already up: node regression_directhq_lethal_h16_cancel.mjs
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";

function unit(instanceId, cardId, owner) {
  return {
    instanceId, cardId, owner, state: "normal", armorHits: 0,
    tempKeywords: [], grantedKeywords: [], permanentKeywords: [],
    tempSideBonus: 0, grantedSideBonus: 0, sideBonusTurns: 0, permanentSideBonus: 0,
    persistentSpent: 0, tempExtraAttacks: 0, tempExtraAttacksSpent: 0, justPlaced: false, rotation: 0,
  };
}

function board(units) {
  const b = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) b[`${r},${c}`] = null;
  return { ...b, ...units };
}

async function startLocalGame(page) {
  await page.goto(`${BASE_URL}/game.html`, { waitUntil: "domcontentloaded" });
  await page.locator('#map-grid .deck-option[data-map="kursk"]').click();
  await page.locator("#deck-picker").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#deck-grid .deck-option").first().click();
  await page.waitForTimeout(150);
  await page.locator("#deck-grid .deck-option").first().click();
  await page.locator("#mulligan-screen").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#btn-mulligan-keep").click();
  await page.waitForTimeout(150);
  if (await page.locator("#mulligan-screen").isVisible().catch(() => false)) {
    await page.locator("#btn-mulligan-keep").click();
  }
  await page.locator("#game-area").waitFor({ state: "visible", timeout: 5000 });
}

async function injectState(page, overrides) {
  await page.evaluate(o => {
    const hooks = window.__SIGNAL_TEST_HOOKS__;
    const s = hooks.getState();
    hooks.receiveRemoteState({
      ...s,
      ...o,
      p1: { ...s.p1, ...(o.p1 ?? {}) },
      p2: { ...s.p2, ...(o.p2 ?? {}) },
      _revision: (s._revision ?? 0) + 1,
    }, { force: true });
  }, overrides);
}

const readState = page => page.evaluate(() => window.__SIGNAL_TEST_HOOKS__.getState());
const readUiState = page => page.evaluate(() => window.__SIGNAL_DEBUG__?.uiState);

function check(results, name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  (${detail})`}`);
}

// Kursk objective slots are 1,0 and 2,3. P1's Rifle Squad at 0,0 has no adjacent enemy, so End
// Turn converts its attack into 1 Direct HQ damage: P2 (1 HQ) dies. P2's Rifle Squads at 1,3 and
// 3,3 would give P2 control of 2,3 at the start of P2's turn, and its backbone would hit P1 (1 HQ).
async function directHqLethalScenario(browser, results) {
  const page = await browser.newPage();
  try {
    await startLocalGame(page);
    await injectState(page, {
      turn: 7,
      initiative: "p1",
      board: board({ "0,0": unit("t-1", "I1", "p1"), "1,3": unit("t-2", "I1", "p2"), "3,3": unit("t-3", "I1", "p2") }),
      nextUnitInstance: 100,
      pendingObjectivePick: null,
      pendingArtyHits: 0,
      p1: { hq: 1 },
      p2: { hq: 1 },
    });
    await page.locator("#btn-end-turn").click();
    await page.locator("#end-screen").waitFor({ state: "visible", timeout: 5000 });
    const winner = (await page.locator("#end-winner").innerText()).trim();
    const s = await readState(page);
    check(results, "Direct HQ lethal: the player who dealt it wins", winner === "P1 WINS", `end screen says "${winner}"`);
    check(results, "Direct HQ lethal: the defeated player's turn never starts", s.turn === 7 && s.initiative === "p1", `turn=${s.turn} initiative=${s.initiative}`);
    check(results, "Direct HQ lethal: no Objective backbone hits the winner afterwards", s.p1.hq === 1, `P1 HQ=${s.p1.hq}`);
  } finally {
    await page.close();
  }
}

async function h16CancelScenario(browser, results) {
  const page = await browser.newPage();
  try {
    await startLocalGame(page);
    await injectState(page, {
      turn: 3,
      initiative: "p1",
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      nextUnitInstance: 100,
      pendingObjectivePick: null,
      pendingArtyHits: 0,
      p1: { fuel: 5, heroZones: ["H16", null, null, null], heroesActivatedThisTurn: [], heroTaxedColumns: {}, pendingHeroDiscount: 0 },
    });
    const zone = page.locator('#hero-zone-p1 .hero-zone-slot[data-hero-zone="p1-0"]');

    await zone.click();
    await page.locator('.tile[data-key="0,0"]').click();
    const midUi = await readUiState(page);
    const midFuel = (await readState(page)).p1.fuel;
    check(results, "H16: source pick reaches the destination step with Fuel paid", midUi === "hero-maneuver-destination" && midFuel === 3, `uiState=${midUi} fuel=${midFuel}`);

    await page.keyboard.press("Escape");
    let s = await readState(page);
    check(results, "H16: Cancel on the destination step refunds the Fuel", s.p1.fuel === 5, `fuel=${s.p1.fuel}`);
    check(results, "H16: Cancel leaves the Hero unused and the Unit in place", !(s.p1.heroesActivatedThisTurn ?? []).includes("H16") && s.board["0,0"]?.cardId === "I1", `activated=${JSON.stringify(s.p1.heroesActivatedThisTurn)} 0,0=${s.board["0,0"]?.cardId}`);

    await zone.click();
    await page.locator('.tile[data-key="0,0"]').click();
    await page.locator('.tile[data-key="0,1"]').click();
    s = await readState(page);
    check(results, "H16: completing the Maneuver still costs the Fuel once and moves the Unit", s.p1.fuel === 3 && s.board["0,1"]?.cardId === "I1" && (s.p1.heroesActivatedThisTurn ?? []).includes("H16"), `fuel=${s.p1.fuel} 0,1=${s.board["0,1"]?.cardId}`);

    await page.keyboard.press("Escape");
    s = await readState(page);
    check(results, "H16: Escape after completion does not undo the Maneuver", s.p1.fuel === 3 && s.board["0,1"]?.cardId === "I1", `fuel=${s.p1.fuel} 0,1=${s.board["0,1"]?.cardId}`);
  } finally {
    await page.close();
  }
}

async function h11RotateEndTurnScenario(browser, results) {
  const page = await browser.newPage();
  try {
    await startLocalGame(page);
    await injectState(page, {
      turn: 3,
      initiative: "p1",
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      nextUnitInstance: 100,
      pendingObjectivePick: null,
      pendingArtyHits: 0,
      p1: { fuel: 5, heroZones: ["H11", null, null, null], heroesActivatedThisTurn: [], heroTaxedColumns: {}, pendingHeroDiscount: 0 },
    });
    await page.locator('#hero-zone-p1 .hero-zone-slot[data-hero-zone="p1-0"]').click();
    await page.locator('.tile[data-key="0,0"]').click();
    await page.locator("#rotate-direction-modal").waitFor({ state: "visible", timeout: 3000 });
    await page.locator("#rotate-cw-btn").click();
    const endTurn = page.locator("#btn-end-turn");
    const enabled = await endTurn.isEnabled();
    const text = (await endTurn.innerText()).trim();
    const s = await readState(page);
    check(results, "H11: End Turn is usable right after the rotate pick", enabled && text !== "Finish Choice", `enabled=${enabled} text="${text}"`);
    check(results, "H11: the rotation itself still applied", s.board["0,0"]?.rotation === 90, `rotation=${s.board["0,0"]?.rotation}`);
  } finally {
    await page.close();
  }
}

async function startAiGame(page) {
  await page.goto(`${BASE_URL}/game.html?ai=1`, { waitUntil: "domcontentloaded" });
  await page.locator('#map-grid .deck-option[data-map="kursk"]').click();
  await page.locator("#deck-picker").waitFor({ state: "visible", timeout: 5000 });
  for (let i = 0; i < 2 && (await page.locator("#deck-picker").isVisible().catch(() => false)); i++) {
    await page.locator("#deck-grid .deck-option").first().click();
    await page.waitForTimeout(150);
  }
  for (let i = 0; i < 3; i++) {
    if (await page.locator("#btn-mulligan-keep").isVisible().catch(() => false)) await page.locator("#btn-mulligan-keep").click();
    await page.waitForTimeout(150);
  }
  await page.locator("#game-area").waitFor({ state: "visible", timeout: 5000 });
}

// P2 (the bot) starts its turn with only Quartermaster General deployed, an unaffordable Tiger I in
// hand and an empty board, so activating H01 is its only move.
async function aiQuartermasterScenario(browser, results) {
  const page = await browser.newPage();
  try {
    await startAiGame(page);
    await injectState(page, {
      turn: 3,
      initiative: "p1",
      board: board({}),
      nextUnitInstance: 100,
      pendingObjectivePick: null,
      pendingArtyHits: 0,
      p1: { heroRoster: [], lastObjLevel: 4 },
      p2: { hand: [], deck: ["T31", "T31", "T31", "T31"], fuel: 0, pendingFuelGain: 0, heroRoster: [], lastObjLevel: 4, heroZones: ["H01", null, null, null], heroesActivatedThisTurn: [], heroTaxedColumns: {}, pendingHeroDiscount: 0 },
    });
    await page.locator("#btn-end-turn").click();
    const handedBack = await page.waitForFunction(() => {
      const s = window.__SIGNAL_TEST_HOOKS__.getState();
      return s.initiative === "p1" && s.turn === 5;
    }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    const s = await readState(page);
    const modalOpen = await page.locator("#quartermaster-modal").isVisible();
    check(results, "vs AI: the bot finishes a turn where it used Quartermaster General", handedBack, `turn=${s.turn} initiative=${s.initiative} quartermasterModalOpen=${modalOpen}`);
    check(results, "vs AI: the bot's Quartermaster pick went to its hand", s.p2.hand.length === 2, `p2 hand=${JSON.stringify(s.p2.hand)}`);
  } finally {
    await page.close();
  }
}

// End Turn twice, 300ms apart, from a state where both players have a first Hero due: P2's deploy
// timer and P1's deploy timer are then both pending. P2's modal opens first; P1's timer used to
// fire 300ms later and replace it before P2 could pick.
async function stackedHeroDeployScenario(browser, results) {
  const page = await browser.newPage();
  try {
    await startLocalGame(page);
    await injectState(page, {
      turn: 3,
      initiative: "p1",
      board: board({}),
      nextUnitInstance: 100,
      pendingObjectivePick: null,
      pendingArtyHits: 0,
      p1: { lastObjLevel: 0, heroZones: [null, null, null, null] },
      p2: { lastObjLevel: 0, heroZones: [null, null, null, null] },
    });
    const modal = page.locator("#hero-deploy-modal");
    const title = () => page.locator("#hero-deploy-title").innerText().then(t => t.trim());
    const deployFirstOption = async () => {
      await page.locator("#hero-deploy-cards .hero-card").first().click({ timeout: 3000 });
      await page.locator("#hero-deploy-zones .hero-zone-pick:not([disabled])").first().click({ timeout: 3000 });
    };

    await page.locator("#btn-end-turn").click();
    await page.waitForTimeout(300);
    await page.locator("#btn-end-turn").click();
    await modal.waitFor({ state: "visible", timeout: 4000 });
    await page.waitForTimeout(800); // well past the moment P1's timer fires
    const firstTitle = await title();
    check(results, "Stacked deploys: P2's prompt is not replaced by P1's timer", firstTitle === "P2 — FIRST HERO", `title="${firstTitle}"`);

    await deployFirstOption();
    const secondShown = await page.waitForFunction(() => {
      const m = document.getElementById("hero-deploy-modal");
      return m.style.display === "flex" && document.getElementById("hero-deploy-title").textContent.startsWith("P1");
    }, null, { timeout: 3000 }).then(() => true).catch(() => false);
    check(results, "Stacked deploys: P1's prompt follows once P2 has picked", secondShown, `modal=${await modal.isVisible()} title="${await title()}"`);
    if (secondShown) await deployFirstOption();

    await page.waitForTimeout(700);
    const s = await readState(page);
    const count = role => (s[role].heroZones ?? []).filter(Boolean).length;
    check(results, "Stacked deploys: each player deployed exactly one Hero, no empty modal left", count("p1") === 1 && count("p2") === 1 && !(await modal.isVisible()), `p1=${count("p1")} p2=${count("p2")} modalOpen=${await modal.isVisible()}`);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const scenario of [directHqLethalScenario, h16CancelScenario, h11RotateEndTurnScenario, aiQuartermasterScenario, stackedHeroDeployScenario]) {
      try {
        await scenario(browser, results);
      } catch (err) {
        results.push({ name: scenario.name, pass: false, detail: err.message });
        console.log(`FAIL  ${scenario.name} crashed: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
})();
