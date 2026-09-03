// Smoke test for "vs AI" mode: drives ONLY P1 via Playwright. If the bot wiring works,
// P2's turns resolve on their own with no P2-side clicks from this script at all.
//
// Fixed 2026-08-31: this used to navigate to /game?ai=1 (not /game.html?ai=1) on a claimed
// theory that the old `npx serve` dev server clean-URL-redirects /game to game.html while
// dropping the query string on .html requests. Verified directly (Playwright): /game?ai=1
// 404s outright in this environment — the redirect theory was simply wrong, not a
// version-specific quirk. This script had never actually run successfully as a result.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ROUNDS_TO_PLAY = 3;

async function readDebug(page) { return page.evaluate(() => window.__SIGNAL_DEBUG__ ?? null); }

async function resolveHeroDeployIfShown(page) {
  const modal = page.locator("#hero-deploy-modal");
  const shown = await modal.waitFor({ state: "visible", timeout: 2200 }).then(() => true).catch(() => false);
  if (!shown) return;
  await modal.locator(".hero-card").first().click();
  await modal.locator(".hero-zone-pick:not([disabled])").first().click();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));

  await page.goto(`${BASE_URL}/game.html?ai=1`, { waitUntil: "domcontentloaded" });

  // Map + P1 deck pick (P2 is auto-assigned in AI mode — no second picker step to handle).
  // Run 2 (2026-08-31): map picker now shows first (doc 04 §1's locked setup order),
  // reversing the old deck->map sequence.
  await page.locator("#map-grid .deck-option").first().waitFor({ state: "visible", timeout: 8000 });
  await page.locator("#map-grid .deck-option").first().click();
  await page.locator("#deck-picker").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#deck-grid .deck-option").first().click();

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
    // Hero deployment is a mandatory start-of-turn choice and appears after an intentional
    // 1800ms animation delay, so complete it before trying to click End Turn.
    await resolveHeroDeployIfShown(page);
    await page.locator("#btn-end-turn").click();

    // Poll for control to return to P1. The bot can take up to 12 actions, and each action may
    // require several deliberately paced 350ms clicks, so a busy legal turn can exceed 10s.
    // Keep a generous 40s ceiling: long enough for the designed worst case, still finite so a
    // genuinely stuck interaction fails the smoke test instead of hanging CI indefinitely.
    let backToP1 = false;
    let debug = null;
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(500);
      debug = await readDebug(page);
      if (debug?.state?.initiative === "p1" || (await page.locator("#end-screen").isVisible().catch(() => false))) {
        backToP1 = true;
        break;
      }
    }

    const turnText = await page.locator("#turn-display").innerText().catch(() => "?");
    console.log(`After round ${round}: initiative=${debug?.state?.initiative}, turn-display="${turnText}"`);

    if (!backToP1) {
      console.log(`FAIL: expected control back at P1 (or a game-over screen) within 40s of the bot's turn, got initiative="${debug?.state?.initiative}", uiState="${debug?.uiState}"`);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`Page errors: ${pageErrors.length}`);
  pageErrors.forEach(e => console.log("  " + e));
  if (pageErrors.length > 0) process.exitCode = 1;

  await browser.close();
})();
