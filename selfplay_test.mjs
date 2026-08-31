// Playwright self-play harness for SIGNAL (Local Play mode: both seats on one screen).
// Decisions are made by bot_ai.mjs, which reuses the game's own pure combat/placement
// functions (state.js/combat.js/maps.js) to score every legal move — not random/greedy-first.
// Requires game.js to expose window.__SIGNAL_DEBUG__ (added as a read-only debug hook).
// Run with: node selfplay_test.mjs [games]
import { chromium } from "playwright";
import { CARD_BY_ID } from "./js/cards.js";
import { bestPlacement, bestExistingAttack, findLethal, findCombinedLethal, bestAttackForUnit, scoreCommand, scoreHeroPower, bestHeroPowerTarget, bestHeroDeployment, maxAttacksFor } from "./js/bot_ai.js";
import { discountFor } from "./js/state.js";

const NUM_GAMES = Number(process.argv[2] || 3);
const MAX_HALF_TURNS = 60; // safety valve — 30 rounds each (real games finish in ~7-11)
const STALL_STREAK_LIMIT = 8; // consecutive half-turns with zero HQ/board change = bail early (~4 rounds of true stagnation, not a normal quiet lull)
const BASE_URL = "http://localhost:3000";

// Updated 2026-08-31 (Run 1) for the 8 SIGNAL Set 1 Recommended Decks (see decks.js
// STARTER_DECKS) replacing the old 4 starter decks. Updated again same day (Run 2) for the
// doc-04-locked 4-map truth — Normandy and Midway are cut (archived in maps.js, not deleted).
const DECKS = ["infantry-formation", "tank-blitz", "artillery-fire-control", "air-superiority", "last-stand-sacrifice", "command-engine", "combined-arms", "objective-tempo"];
const MAPS = ["stalingrad", "el_alamein", "ardennes", "kursk"];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function readDebug(page) {
  return page.evaluate(() => window.__SIGNAL_DEBUG__ ?? null);
}

async function clickTile(page, key) {
  await page.locator(`.tile[data-key="${key}"]`).first().click().catch(() => {});
}

async function clickHandCard(page, cardId) {
  await page.locator(`#p1-hand .hand-card[data-card-id="${cardId}"]`).first().click().catch(() => {});
}

// Plain click (no shiftKey) activates a deployed Hero's Power — shift+click is a reposition,
// which this harness never does. See game.js's handleHeroZoneClick.
async function clickHeroZone(page, active, col) {
  await page.locator(`#hero-zone-${active} .hero-zone-slot[data-hero-zone="${active}-${col}"]`).first().click().catch(() => {});
}

async function handleForwardObserver(page) {
  const modal = page.locator("#fo-modal");
  if (!(await modal.isVisible().catch(() => false))) return;
  const slots = page.locator(".fo-slot");
  const n = await slots.count();
  const positions = ["keep", "top", "bottom"];
  for (let i = 0; i < n; i++) {
    await page.locator(`#fo-btn-${i}-${positions[i] ?? "top"}`).click();
    await page.waitForTimeout(20);
  }
  await page.locator("#fo-confirm").click();
  await page.waitForTimeout(30);
}

// Radio Operator (111) on-play: look at top 2 of the deck, put one on top. Binary choice,
// resolves on a single click — no separate Confirm button (see game.js's showRadioOperatorModal).
async function handleRadioOperator(page) {
  const modal = page.locator("#radio-op-modal");
  if (!(await modal.isVisible().catch(() => false))) return;
  await page.locator("#radio-op-cards .fo-pos-btn").first().click().catch(() => {});
  await page.waitForTimeout(30);
}

// Change Formation (C16) / Field Coordinator's Hero Power (H11): direction doesn't affect
// scoring, always CW.
async function handleRotateDirection(page) {
  const modal = page.locator("#rotate-direction-modal");
  if (!(await modal.isVisible().catch(() => false))) return;
  await page.locator("#rotate-cw-btn").click().catch(() => {});
  await page.waitForTimeout(30);
}

// Chief Aircraft Engineer (H25) Craft: 3 freshly-rolled candidates, no heuristic scores them
// (they don't exist until rolled) — always takes the first, mirroring bot_player.js's in-page
// handleCraftPicker (see CLAUDE.md: the two bots are duplicated and must be updated in parallel).
async function handleCraftPicker(page) {
  const modal = page.locator("#craft-picker-modal");
  if (!(await modal.isVisible().catch(() => false))) return;
  await page.locator("#craft-picker-cards .fo-pos-btn").first().click().catch(() => {});
  await page.waitForTimeout(30);
}

// Resolves the Hero deploy modal (starting pick and later reinforcements) using the same
// bestHeroDeployment scoring the in-page "vs AI" bot uses, falling back to first-hero/first-zone
// if state can't be read. An unhandled modal doesn't throw — it silently swallows clicks and the
// game reports STALLED, so this guard is what keeps runs green.
async function handleHeroDeploy(page) {
  const modal = page.locator("#hero-deploy-modal");
  if (!(await modal.isVisible().catch(() => false))) return;

  const debug = await readDebug(page);
  const state = debug?.state;
  const active = state?.initiative;
  const roster = state?.[active]?.heroRoster ?? [];
  const heroZones = state?.[active]?.heroZones ?? [null, null, null, null];
  const choice = state && roster.length ? bestHeroDeployment(state, active, roster, heroZones) : null;

  if (choice) {
    await page.locator(`#hero-deploy-cards .hero-card[data-hero-id="${choice.heroId}"]`).first().click();
    await page.waitForTimeout(20);
    await page.locator(".hero-zone-pick").nth(choice.col).click();
  } else {
    await page.locator("#hero-deploy-cards .hero-card").first().click();
    await page.waitForTimeout(20);
    await page.locator("#hero-deploy-zones .hero-zone-pick:not([disabled])").first().click();
  }
  await page.waitForTimeout(30);
}

async function handleArtyTargeting(page) {
  const targets = page.locator(".tile.targetable");
  const count = await targets.count();
  if (count > 0) await targets.nth(Math.floor(Math.random() * count)).click();
  await page.waitForTimeout(30);
}

// Resolve an attack-targeting or command-targeting prompt smartly: re-read live state,
// score the DOM-offered candidate tiles, click the best one. Loops for Double Attack.
async function resolveTargetingSmart(page, { attackerKey = null, heroPower = null } = {}, maxSteps = 3) {
  for (let i = 0; i < maxSteps; i++) {
    const targetTiles = page.locator(".tile.targetable, .tile.cmd-target");
    const count = await targetTiles.count();
    if (count === 0) return;
    const keys = [];
    for (let ti = 0; ti < count; ti++) keys.push(await targetTiles.nth(ti).getAttribute("data-key"));

    const debug = await readDebug(page);
    let chosenKey = keys[0];
    if (debug?.state) {
      if (heroPower) {
        const best = bestHeroPowerTarget(debug.state, debug.state.initiative, heroPower.heroId, heroPower.col);
        if (best && keys.includes(best.key)) chosenKey = best.key;
      } else if (attackerKey) {
        const atk = bestAttackForUnit(debug.state, attackerKey);
        if (atk && keys.includes(atk.targetKey)) chosenKey = atk.targetKey;
      }
    }
    await clickTile(page, chosenKey);
    await page.waitForTimeout(30);
  }
}

// If we ever reach the top of the decision loop with uiState != 'idle', it's leftover from
// something that didn't get fully resolved (a fresh targeting prompt from THIS turn's own
// placement is always resolved before we loop back — see resolveTargetingSmart). Any new
// decision made on top of a stale prompt gets silently swallowed instead of registering, so
// treat this as an anomaly and bail out of it cleanly via Cancel rather than guess a target.
async function flushPendingUiState(page, debug) {
  if (!debug || debug.uiState === "idle") return debug;
  await page.locator("#btn-cancel").click().catch(() => {});
  await page.waitForTimeout(30);
  return readDebug(page);
}

async function playTurnSmart(page) {
  // Some commands need a specific target (a suppressed friendly, an objective-adjacent unit,
  // etc.) and are a complete no-op if none exists right now — game.js doesn't spend fuel or
  // remove the card in that case, it just logs "no valid targets". A candidate picked purely
  // on affordability can't tell a live command from a dead one, so it'd retry the same no-op
  // every sub-step forever. Track cards that just no-op'd and exclude them for the rest of
  // this turn instead of trusting fuel-affordability alone.
  const deadThisTurn = new Set();

  for (let i = 0; i < 12; i++) {
    await handleForwardObserver(page);
    await handleRadioOperator(page);
    await handleRotateDirection(page);
    await handleCraftPicker(page);
    if (await page.locator("#end-screen").isVisible().catch(() => false)) return;

    let debug = await readDebug(page);
    debug = await flushPendingUiState(page, debug);
    if (!debug?.state) break;
    const { state, attackedThisTurn } = debug;
    const active = state.initiative;
    const ps = state[active];
    const attackedMap = new Map(attackedThisTurn);

    // 1. Take a lethal attack immediately if one exists.
    const lethal = findLethal(state, active, attackedMap);
    if (lethal) {
      await clickTile(page, lethal.attackerKey);
      await page.waitForTimeout(30);
      // Empty-Board HQ Strike resolves on the attacker's own click — no target tile to click.
      if (!lethal.isHQStrike) {
        await clickTile(page, lethal.targetKey);
        await page.waitForTimeout(30);
      }
      continue;
    }

    // 1b. No single attack is lethal — check whether several attackers together are.
    const combinedLethal = findCombinedLethal(state, active, attackedMap);
    if (combinedLethal) {
      for (const step of combinedLethal) {
        await clickTile(page, step.unitKey);
        await page.waitForTimeout(30);
        if (!step.isHQStrike) {
          await clickTile(page, step.targetKey);
          await page.waitForTimeout(30);
        }
        if (await page.locator("#end-screen").isVisible().catch(() => false)) return;
      }
      continue;
    }

    // 2. Score the best available unit placement and the best available existing-unit attack.
    const handUnitIds = ps.hand.filter(id => {
      const c = CARD_BY_ID[id];
      if (!c || c.type !== "unit") return false;
      return ps.fuel >= (c.cost - discountFor(ps, c, null));
    });
    const emptyTiles = Object.keys(state.board).filter(k => !state.board[k] && !state.objectives[k]);
    const placement = handUnitIds.length && emptyTiles.length ? bestPlacement(state, active, handUnitIds, emptyTiles) : null;
    const attack = bestExistingAttack(state, active, attackedMap);

    const affordableCommandIds = ps.hand.filter(id => { const c = CARD_BY_ID[id]; return c && c.type === "command" && ps.fuel >= c.cost && !deadThisTurn.has(id); });
    const affordableMissionId = ps.hand.find(id => { const c = CARD_BY_ID[id]; return c && c.type === "mission" && ps.fuel >= c.cost && !deadThisTurn.has(id); });

    let bestCommand = null;
    for (const id of affordableCommandIds) {
      const score = scoreCommand(state, active, id, attackedMap);
      if (!bestCommand || score > bestCommand.score) bestCommand = { cardId: id, score };
    }

    // Hero Power: each Hero once per turn, multiple different Heroes okay in the same turn
    // (2026-08-17 — Coordinated Orders retired, its bonus activation is baseline now).
    // Only implemented, powerType:"active" Heroes; skip whichever already no-op'd this turn.
    let bestHeroPower = null;
    {
      const activatedThisTurn = ps.heroesActivatedThisTurn ?? [];
      const heroZones = ps.heroZones ?? [null, null, null, null];
      for (let col = 0; col < 4; col++) {
        const heroId = heroZones[col];
        const hero = heroId != null ? CARD_BY_ID[heroId] : null;
        if (!hero || hero.powerType !== "active" || !hero.implemented) continue;
        if (activatedThisTurn.includes(heroId)) continue;
        if (ps.fuel < (hero.activeCost ?? 0) || deadThisTurn.has(`hero:${heroId}`)) continue;
        const score = scoreHeroPower(state, active, heroId, col, attackedMap);
        if (!bestHeroPower || score > bestHeroPower.score) bestHeroPower = { heroId, col, score };
      }
    }

    const candidates = [];
    if (placement) candidates.push({ type: "place", score: placement.score, cardId: placement.cardId, tileKey: placement.tileKey });
    if (attack) candidates.push({ type: "attack", score: attack.score, unitKey: attack.unitKey, targetKey: attack.targetKey, isHQStrike: attack.isHQStrike });
    if (bestCommand) candidates.push({ type: "command", score: bestCommand.score, cardId: bestCommand.cardId });
    if (bestHeroPower) candidates.push({ type: "heroPower", score: bestHeroPower.score, heroId: bestHeroPower.heroId, col: bestHeroPower.col });
    if (candidates.length === 0 && affordableMissionId !== undefined) candidates.push({ type: "mission", score: 0.1, cardId: affordableMissionId });

    if (candidates.length === 0) break; // nothing useful left this turn

    candidates.sort((a, b) => b.score - a.score);
    const choice = candidates[0];

    if (choice.type === "place") {
      await clickHandCard(page, choice.cardId);
      await page.waitForTimeout(30);
      await clickTile(page, choice.tileKey);
      await page.waitForTimeout(30);
      await resolveTargetingSmart(page, { attackerKey: choice.tileKey });
    } else if (choice.type === "attack") {
      await clickTile(page, choice.unitKey);
      await page.waitForTimeout(30);
      if (!choice.isHQStrike) {
        await clickTile(page, choice.targetKey);
        await page.waitForTimeout(30);
      }
    } else if (choice.type === "command") {
      const handBefore = ps.hand.length;
      await clickHandCard(page, choice.cardId);
      await page.waitForTimeout(30);
      await resolveTargetingSmart(page);
      await handleRotateDirection(page); // Change Formation (C16)
      const afterDebug = await readDebug(page);
      const handAfter = afterDebug?.state?.[active]?.hand?.length ?? handBefore;
      if (handAfter === handBefore) deadThisTurn.add(choice.cardId); // no-op: card never left hand
      await flushPendingUiState(page, afterDebug); // clean up if it landed in command-targeting with no targets
    } else if (choice.type === "mission") {
      await clickHandCard(page, choice.cardId);
      await page.waitForTimeout(30);
    } else if (choice.type === "heroPower") {
      await clickHeroZone(page, active, choice.col);
      await page.waitForTimeout(30);
      await resolveTargetingSmart(page, { heroPower: { heroId: choice.heroId, col: choice.col } });
      await handleRotateDirection(page); // Field Coordinator's Hero Power (H11)
      await handleCraftPicker(page); // Chief Aircraft Engineer's Hero Power (H25)
      const afterDebug = await readDebug(page);
      const nowActivated = afterDebug?.state?.[active]?.heroesActivatedThisTurn ?? [];
      if (!nowActivated.includes(choice.heroId)) deadThisTurn.add(`hero:${choice.heroId}`); // no-op: no legal target
      await flushPendingUiState(page, afterDebug);
    }
  }
}

async function playOneGame(page) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#btn-local").click();

  const d1 = pick(DECKS), d2 = pick(DECKS), map = pick(MAPS);
  // Run 2 (2026-08-31): map picker now shows first for local play (doc 04 §1's locked
  // setup order — map before deck/Hero roster), reversing the old deck->deck->map sequence.
  await page.locator(`#map-grid .deck-option[data-map="${map}"]`).click();
  await page.locator("#deck-picker").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(`#deck-grid .deck-option[data-deck="${d1}"]`).click();
  await page.waitForTimeout(50);
  await page.locator(`#deck-grid .deck-option[data-deck="${d2}"]`).click();
  await page.waitForTimeout(50);

  // Mulligan and starting-Hero pick interleave (P1 mulligan -> P2 mulligan -> P1 hero -> P2 hero),
  // so poll both rather than assuming a fixed order.
  for (let i = 0; i < 4; i++) {
    const keepBtn = page.locator("#btn-mulligan-keep");
    if (await keepBtn.isVisible().catch(() => false)) {
      await keepBtn.click();
      await page.waitForTimeout(50);
    }
    await handleHeroDeploy(page);
  }

  await page.locator("#game-area").waitFor({ state: "visible", timeout: 5000 });

  let halfTurns = 0;
  let lastSignature = null;
  let stallStreak = 0;
  let stallInfo = null;
  while (halfTurns < MAX_HALF_TURNS) {
    if (await page.locator("#end-screen").isVisible().catch(() => false)) break;

    await handleHeroDeploy(page);   // reinforcement can fire at the start of a turn
    await handleForwardObserver(page);
    await handleRadioOperator(page);
    await handleArtyTargeting(page);
    await playTurnSmart(page);
    await handleForwardObserver(page);
    await handleRadioOperator(page);
    await handleRotateDirection(page);
    await handleCraftPicker(page);

    if (await page.locator("#end-screen").isVisible().catch(() => false)) break;
    const endTurnBtn = page.locator("#btn-end-turn");
    if (await endTurnBtn.isEnabled().catch(() => false)) {
      await endTurnBtn.click();
      await page.waitForTimeout(40);
    }
    halfTurns++;

    // Stall watchdog: if HQ and board occupancy haven't moved in STALL_STREAK_LIMIT
    // consecutive half-turns, something is stuck (regardless of cause) — bail early with
    // diagnostics instead of grinding to MAX_HALF_TURNS.
    const debug = await readDebug(page);
    if (debug?.state) {
      const occupied = Object.values(debug.state.board).filter(Boolean).length;
      const signature = `${debug.state.p1.hq},${debug.state.p2.hq},${occupied}`;
      if (signature === lastSignature) {
        stallStreak++;
        if (stallStreak >= STALL_STREAK_LIMIT) {
          const active = debug.state.initiative;
          stallInfo = { half: halfTurns, uiState: debug.uiState, active, hand: debug.state[active].hand, fuel: debug.state[active].fuel };
          break;
        }
      } else {
        stallStreak = 0;
      }
      lastSignature = signature;
    }
  }

  const gameOver = await page.locator("#end-screen").isVisible().catch(() => false);
  const winner = gameOver ? await page.locator("#end-winner").innerText().catch(() => "?")
    : stallInfo ? "STALLED (no progress)" : "TIMEOUT (no winner)";
  const p1hq = await page.locator("#p1-hq").innerText().catch(() => "?");
  const p2hq = await page.locator("#p2-hq").innerText().catch(() => "?");
  const logText = await page.locator("#game-log").innerText().catch(() => "");
  const notAutomatedMatches = logText.match(/not automated/gi) || [];

  // Hero deployment counts. Reinforcement is tied to Objective escalation (levels rise at
  // rounds 4/6/8), so in a 6-10 round game the 4th Hero often never lands. This is the
  // measurement that decides whether that pacing needs changing.
  const heroesDeployed = await page.evaluate(() => {
    const s = window.__SIGNAL_DEBUG__?.state;
    if (!s) return null;
    const count = p => (s[p]?.heroZones ?? []).filter(z => z != null).length;
    return { p1: count('p1'), p2: count('p2') };
  }).catch(() => null);

  return {
    deck1: d1, deck2: d2, map, winner,
    rounds: Math.ceil(halfTurns / 2),
    finalHQ: { p1: p1hq, p2: p2hq },
    notAutomatedTriggers: notAutomatedMatches.length,
    heroesDeployed,
    stallInfo,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const consoleErrors = [];
  const pageErrors = [];

  for (let g = 0; g < NUM_GAMES; g++) {
    const page = await browser.newPage();
    page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(`game${g + 1}: ${msg.text()}`); });
    page.on("pageerror", err => pageErrors.push(`game${g + 1}: ${err.message}\n${err.stack}`));
    try {
      const result = await playOneGame(page);
      results.push(result);
      const hd = result.heroesDeployed ? ` heroes=${result.heroesDeployed.p1}/${result.heroesDeployed.p2}` : '';
      console.log(`Game ${g + 1}: ${result.deck1} vs ${result.deck2} on ${result.map} → ${result.winner} (${result.rounds} rounds, HQ p1=${result.finalHQ.p1} p2=${result.finalHQ.p2},${hd} not-automated log hits=${result.notAutomatedTriggers})`);
    } catch (e) {
      console.log(`Game ${g + 1}: CRASHED — ${e.message}`);
      await page.screenshot({ path: `selfplay_crash_${g + 1}.png` }).catch(() => {});
    }
    await page.close();
  }

  await browser.close();

  console.log("\n--- Summary ---");
  console.log(`Games played: ${results.length}/${NUM_GAMES}`);
  const timeouts = results.filter(r => r.winner.includes("TIMEOUT"));
  console.log(`Timeouts (hit ${MAX_HALF_TURNS / 2}-round cap, no winner): ${timeouts.length}`);
  const stalls = results.filter(r => r.stallInfo);
  console.log(`Stalls (no HQ/board change for ${STALL_STREAK_LIMIT} turns, bailed early): ${stalls.length}`);
  stalls.forEach(r => console.log(`  ${r.deck1} vs ${r.deck2} on ${r.map}, half=${r.stallInfo.half}, uiState=${r.stallInfo.uiState}, active=${r.stallInfo.active}, fuel=${r.stallInfo.fuel}, hand=${JSON.stringify(r.stallInfo.hand)}`));
  const avgRounds = results.length ? (results.reduce((a, r) => a + r.rounds, 0) / results.length).toFixed(1) : "n/a";
  console.log(`Average game length: ${avgRounds} rounds`);
  const p1wins = results.filter(r => r.winner.includes("P1")).length;
  const p2wins = results.filter(r => r.winner.includes("P2")).length;
  console.log(`P1 wins: ${p1wins}  P2 wins: ${p2wins}`);
  console.log(`Total "not automated" log lines hit: ${results.reduce((a, r) => a + r.notAutomatedTriggers, 0)}`);
  const withHeroes = results.filter(r => r.heroesDeployed);
  if (withHeroes.length) {
    const all = withHeroes.flatMap(r => [r.heroesDeployed.p1, r.heroesDeployed.p2]);
    const avg = (all.reduce((a, n) => a + n, 0) / all.length).toFixed(2);
    const full = all.filter(n => n === 4).length;
    console.log(`Heroes deployed per side: avg ${avg} of 4 — full roster in ${full}/${all.length} sides`);
  }
  console.log(`Console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 20).forEach(e => console.log("  " + e));
  console.log(`Uncaught page errors: ${pageErrors.length}`);
  pageErrors.slice(0, 20).forEach(e => console.log("  " + e));
})();
