// In-page "vs AI" bot — plays P2's turn automatically inside the human's own browser tab.
// Reuses the exact scoring logic already validated in selfplay_test.mjs / bot_ai.js, but
// instead of driving a separate Playwright browser, it clicks the real DOM elements on this
// page directly — the same elements a human would click. This goes through game.js's existing,
// unmodified click handlers, so no game logic needed to change to add this feature.
import { CARD_BY_ID } from "./cards.js";
import { discountFor } from "./state.js";
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
      // Empty-Board HQ Strike resolves on the attacker's own click — no target tile exists
      // to click (there's nothing on the board to click).
      if (!lethal.isHQStrike) {
        clickTile(lethal.targetKey);
        await sleep(CLICK_DELAY_MS);
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

    const affordableCommandId = ps.hand.find(id => { const c = CARD_BY_ID[id]; return c && c.type === "command" && ps.fuel >= c.cost && !deadThisTurn.has(id); });
    const affordableMissionId = ps.hand.find(id => { const c = CARD_BY_ID[id]; return c && c.type === "mission" && ps.fuel >= c.cost && !deadThisTurn.has(id); });

    const candidates = [];
    if (placement) candidates.push({ type: "place", score: placement.score, cardId: placement.cardId, tileKey: placement.tileKey });
    if (attack) candidates.push({ type: "attack", score: attack.score, unitKey: attack.unitKey, targetKey: attack.targetKey, isHQStrike: attack.isHQStrike });
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
      if (!choice.isHQStrike) {
        clickTile(choice.targetKey);
        await sleep(CLICK_DELAY_MS);
      }
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
