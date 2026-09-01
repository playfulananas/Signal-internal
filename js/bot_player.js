// In-page "vs AI" bot — plays P2's turn automatically inside the human's own browser tab.
// Reuses the exact scoring logic already validated in selfplay_test.mjs / bot_ai.js, but
// instead of driving a separate Playwright browser, it clicks the real DOM elements on this
// page directly — the same elements a human would click. This goes through game.js's existing,
// unmodified click handlers, so no game logic needed to change to add this feature.
import { CARD_BY_ID } from "./cards.js?v=1788275462";
import { discountFor } from "./state.js?v=1788275462";
import { bestPlacement, bestExistingAttack, findLethal, findCombinedLethal, bestAttackForUnit, scoreCommand, scoreHeroPower, bestHeroPowerTarget } from "./bot_ai.js?v=1788275462";

const CLICK_DELAY_MS = 350; // pacing so a human watching can follow what the bot is doing

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function readDebug() { return window.__SIGNAL_DEBUG__ ?? null; }
function clickTile(key) { document.querySelector(`.tile[data-key="${key}"]`)?.click(); }
function clickHandCard(cardId) { document.querySelector(`#p1-hand .hand-card[data-card-id="${cardId}"]`)?.click(); }
// Plain click (no shiftKey) activates a deployed Hero's Power — shift+click is a reposition,
// which the bot never does. See game.js's handleHeroZoneClick.
function clickHeroZone(active, col) { document.querySelector(`#hero-zone-${active} .hero-zone-slot[data-hero-zone="${active}-${col}"]`)?.click(); }
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

// Radio Operator on-play: look at top 2 of the deck, put one on top. Binary choice, resolves on
// a single click — no separate Confirm button (see game.js's showRadioOperatorModal). Note: the
// old numeric-id Radio Operator card this was built for isn't in the new 125-card pool — kept
// since the underlying modal/mechanic (js/game.js's showRadioOperatorModal) is still live code,
// just currently unreachable from any Run-1 card; harmless to leave wired.
async function handleRadioOperator() {
  const modal = document.getElementById("radio-op-modal");
  if (!modal || modal.style.display === "none") return;
  document.querySelector("#radio-op-cards .fo-pos-btn")?.click();
  await sleep(CLICK_DELAY_MS);
}

async function handleArtyTargeting() {
  const targets = document.querySelectorAll(".tile.targetable");
  if (targets.length > 0) targets[0].click();
  await sleep(CLICK_DELAY_MS);
}

// Objective player-choice targeting (2026-09-01): Airfield L2/Supply Depot L1/City L1/Artillery
// Position L1 pause for a board click instead of auto-picking (see applyObjectiveEffects,
// game.js). No scoring heuristic — same "don't overthink it" simplification as
// handleRotateDirection/handleCraftPicker below: first eligible tile, always. Gated explicitly
// on uiState (not just ".cmd-target" presence) because that class is also used by Hero-power and
// Command-maneuver targeting — clicking blind on element presence alone could hijack an unrelated
// in-progress flow. Handles both steps of Airfield L2's Maneuver automatically: whichever step is
// current, computeObjectivePickTargets (game.js's render highlight) already narrows ".cmd-target"
// to just that step's legal set, so this needs no extra state of its own. Artillery Position L1's
// direction choice is covered separately by handleRotateDirection, which runs every iteration
// regardless of kind.
async function handleObjectivePicking() {
  const debug = readDebug();
  if (debug?.uiState !== "objective-picking") return;
  const targets = document.querySelectorAll(".tile.cmd-target");
  if (targets.length > 0) targets[0].click();
  await sleep(CLICK_DELAY_MS);
}

// Change Formation (C16) / Field Coordinator's Hero Power (H11): rotation direction doesn't
// affect the bot's evaluation (scoreCommand/scoreHeroPower don't model it), so it always picks
// clockwise.
async function handleRotateDirection() {
  const modal = document.getElementById("rotate-direction-modal");
  if (!modal || modal.style.display === "none") return;
  document.getElementById("rotate-cw-btn")?.click();
  await sleep(CLICK_DELAY_MS);
}

// Chief Aircraft Engineer (H25) Craft: 3 freshly-rolled candidates, no existing heuristic
// scores them (they don't exist until rolled), so the bot always takes the first one — same
// "don't overthink it" simplification as handleRotateDirection's fixed clockwise choice.
async function handleCraftPicker() {
  const modal = document.getElementById("craft-picker-modal");
  if (!modal || modal.style.display === "none") return;
  document.querySelector("#craft-picker-cards .fo-pos-btn")?.click();
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

async function resolveTargetingSmart({ attackerKey = null, heroPower = null } = {}, maxSteps = 3) {
  for (let i = 0; i < maxSteps; i++) {
    const targetTiles = [...document.querySelectorAll(".tile.targetable, .tile.cmd-target")];
    if (targetTiles.length === 0) return;
    const keys = targetTiles.map(t => t.dataset.key);

    const debug = readDebug();
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
    await handleRadioOperator();
    await handleRotateDirection();
    await handleCraftPicker();
    // Must run before flushPendingUiState below: there's no Cancel button for
    // 'objective-picking' (it isn't a voluntary action to back out of), so if this uiState were
    // ever left for flushPendingUiState's generic "click Cancel on anything stale" fallback to
    // find, the bot's turn would hang forever instead of progressing.
    await handleObjectivePicking();
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
      // Empty-Board HQ Strike resolves on the attacker's own click — no target tile exists
      // to click (there's nothing on the board to click).
      if (!lethal.isHQStrike) {
        clickTile(lethal.targetKey);
        await sleep(CLICK_DELAY_MS);
      }
      continue;
    }

    // No single attack finishes the HQ — check whether several of this turn's attackers
    // together do (a human closing out a game would take the whole line, not just the best
    // single swing and then a lesser action next).
    const combinedLethal = findCombinedLethal(state, active, attackedMap);
    if (combinedLethal) {
      for (const step of combinedLethal) {
        clickTile(step.unitKey);
        await sleep(CLICK_DELAY_MS);
        if (!step.isHQStrike) {
          clickTile(step.targetKey);
          await sleep(CLICK_DELAY_MS);
        }
        if (isGameOver()) return;
      }
      continue;
    }

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
      clickHandCard(choice.cardId);
      await sleep(CLICK_DELAY_MS);
      clickTile(choice.tileKey);
      await sleep(CLICK_DELAY_MS);
      await resolveTargetingSmart({ attackerKey: choice.tileKey });
    } else if (choice.type === "attack") {
      clickTile(choice.unitKey);
      await sleep(CLICK_DELAY_MS);
      if (!choice.isHQStrike) {
        clickTile(choice.targetKey);
        await sleep(CLICK_DELAY_MS);
      }
    } else if (choice.type === "command") {
      const handBefore = ps.hand.length;
      clickHandCard(choice.cardId);
      await sleep(CLICK_DELAY_MS);
      await resolveTargetingSmart();
      await handleRotateDirection(); // Change Formation (C16) — direction modal, see game.js
      const afterDebug = readDebug();
      const handAfter = afterDebug?.state?.[active]?.hand?.length ?? handBefore;
      if (handAfter === handBefore) deadThisTurn.add(choice.cardId); // no-op: card never left hand
      await flushPendingUiState(afterDebug);
    } else if (choice.type === "mission") {
      clickHandCard(choice.cardId);
      await sleep(CLICK_DELAY_MS);
    } else if (choice.type === "heroPower") {
      clickHeroZone(active, choice.col);
      await sleep(CLICK_DELAY_MS);
      await resolveTargetingSmart({ heroPower: { heroId: choice.heroId, col: choice.col } });
      await handleRotateDirection(); // Field Engineer (91) — direction modal, see game.js
      await handleCraftPicker(); // Chief Aircraft Engineer (H25) — 3-candidate modal, see game.js
      const afterDebug = readDebug();
      const nowActivated = afterDebug?.state?.[active]?.heroesActivatedThisTurn ?? [];
      if (!nowActivated.includes(choice.heroId)) deadThisTurn.add(`hero:${choice.heroId}`); // no-op: no legal target
      await flushPendingUiState(afterDebug);
    }
  }
}

// Called by game.js right after P2 becomes the active player in AI mode.
// Plays out P2's whole turn, then clicks End Turn itself — handing control back to P1.
export async function runBotTurn() {
  await sleep(CLICK_DELAY_MS);
  await handleForwardObserver();
  await handleRadioOperator();
  await handleArtyTargeting();
  await playBotTurnSteps();
  await handleForwardObserver();
  await handleRadioOperator();
  await handleRotateDirection();
  if (isGameOver()) return;

  const endTurnBtn = document.getElementById("btn-end-turn");
  if (endTurnBtn && !endTurnBtn.disabled) {
    endTurnBtn.click();
  }
}
