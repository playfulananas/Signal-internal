// Browser checks for match statistics (docs/plans/2026-09-16-match-statistics.md) that unit tests
// can't reach: the real game.js flows end to end, with the Firebase SDK swapped for the in-memory
// stand-in in browser_test_fake_firebase.mjs (no live Firebase is touched).
//
// Local game (one client):
//   - lethal Direct HQ writes exactly one record: End Turn's row, no phantom or duplicate turn
//   - a mid-turn lethal attack adds the final turn once, flagged terminal
//   - a failed record write shows Retry, and Retry saves the same record once
//   - the host's include/note goes to stats/meta without touching the record
//   - Rally Cry / Hold Position / Fire for Effect: full Cancel removes the card play,
//     a committed partial resolution keeps exactly one
//   - H16 destination Cancel removes the provisional activation stats
// Online game (two clients):
//   - P2 deals lethal: exactly one record, written by P2 (the client that ended the match);
//     only P1 (host) sees the include/note controls
//   - P1 deals lethal: no record until the game-ending transaction commits
//   - the game-ending transaction is rejected: no record at all, and the client can keep playing
//   - an ending and the winner leaving arrive in one snapshot: the survivor shows the result and
//     writes nothing (no disconnect record over the HQ record)
//   - a disconnect during mulligan writes no record; after the match starts it writes one
//   - Main Menu stays blocked until the game-ending write and the record write are both done
// Fake Firebase fidelity: undefined/NaN/Infinity and invalid keys rejected, held listener
// deliveries coalesce to the newest value.
// Statistics page:
//   - default filters, match-list include toggle (writes stats/meta), sorting, CSV export,
//     loading a self-play .jsonl file
//
// Run with the dev server up: node match_stats_browser_test.mjs [scenarioNameFilter]
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createFakeFirebase } from "./browser_test_fake_firebase.mjs";
import { createInitialState } from "./js/state.js?v=2026090402";
import { createMatchStats, recordCardPlayed, recordHqDamage, buildMatchRecord } from "./js/stats.js?v=2026090402";

const BASE_URL = "http://localhost:3000";
const results = [];

function check(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  (${detail})`}`);
}

function unit(instanceId, cardId, owner, extra = {}) {
  return {
    instanceId, cardId, owner, state: "normal", armorHits: 0,
    tempKeywords: [], grantedKeywords: [], permanentKeywords: [],
    tempSideBonus: 0, grantedSideBonus: 0, sideBonusTurns: 0, permanentSideBonus: 0,
    persistentSpent: 0, tempExtraAttacks: 0, tempExtraAttacksSpent: 0, justPlaced: false, rotation: 0,
    ...extra,
  };
}

function board(units) {
  const b = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) b[`${r},${c}`] = null;
  return { ...b, ...units };
}

// No Hero phase will fire (empty rosters, level already noted), so no deploy modal interferes.
const NO_HEROES = { heroRoster: [], lastObjLevel: 4, heroZones: [null, null, null, null], heroesActivatedThisTurn: [] };

async function waitFor(fn, timeout = 6000, step = 100) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, step));
  }
  return false;
}

const matchWrites = (ff, prefix = "") => ff.writes.filter(w => w.path.startsWith(`stats/matches/${prefix}`));
const readState = page => page.evaluate(() => window.__SIGNAL_TEST_HOOKS__.getState());

// End-screen Main Menu button: whether it exists, is disabled, and whether a forced click navigates.
async function menuState(page) {
  const btn = page.locator("#end-menu-btn");
  if (!(await btn.count())) return { exists: false, disabled: false };
  return { exists: true, disabled: await btn.isDisabled() };
}
async function forcedMenuClickNavigates(page) {
  const before = page.url();
  await page.locator("#end-menu-btn").click({ force: true, timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page.url() !== before;
}

// The exact write js/firebase.js's setPlayerLeft makes when a player uses Exit.
async function writePlayerLeft(page, code, role) {
  await page.evaluate(async ([gameCode, who]) => {
    const db = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    await db.update(db.ref(db.getDatabase(), `games/${gameCode}`), { _playerLeft: who });
  }, [code, role]);
}

// ── Local game helpers ─────────────────────────────────────────────────────────
async function newLocalPage(browser, ff, label) {
  const context = await browser.newContext();
  await ff.attach(context, label);
  const page = await context.newPage();
  page.on("pageerror", e => check(`${label}: no page errors`, false, e.message));
  await page.goto(`${BASE_URL}/game.html`, { waitUntil: "domcontentloaded" });
  await page.locator('#map-grid .deck-option[data-map="kursk"]').click();
  await page.locator("#deck-picker").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#deck-grid .deck-option").first().click();
  await page.waitForTimeout(150);
  await page.locator("#deck-grid .deck-option").first().click();
  for (let i = 0; i < 3; i++) {
    if (await page.locator("#btn-mulligan-keep").isVisible().catch(() => false)) await page.locator("#btn-mulligan-keep").click();
    await page.waitForTimeout(150);
  }
  await page.locator("#game-area").waitFor({ state: "visible", timeout: 5000 });
  return { page, context };
}

async function injectLocal(page, overrides) {
  await page.evaluate(o => {
    const hooks = window.__SIGNAL_TEST_HOOKS__;
    const s = hooks.getState();
    hooks.receiveRemoteState({
      ...s, ...o,
      p1: { ...s.p1, ...(o.p1 ?? {}) },
      p2: { ...s.p2, ...(o.p2 ?? {}) },
      pendingObjectivePick: null,
      pendingArtyHits: 0,
      _revision: (s._revision ?? 0) + 1,
    }, { force: true });
  }, overrides);
}

async function localDirectHqRecordAndMeta(browser) {
  const ff = createFakeFirebase();
  const { page, context } = await newLocalPage(browser, ff, "local-directhq");
  try {
    await injectLocal(page, {
      turn: 7, initiative: "p1", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      p1: { ...NO_HEROES }, p2: { ...NO_HEROES, hq: 1 },
    });
    await page.locator("#btn-end-turn").click();
    await page.locator("#end-screen").waitFor({ state: "visible", timeout: 5000 });
    await waitFor(async () => matchWrites(ff).length > 0);
    const writes = matchWrites(ff);
    check("Local Direct HQ lethal: exactly one match record written", writes.length === 1, `writes=${writes.length}`);
    const rec = writes[0]?.value ?? {};
    const rows = (rec.turns ?? []).filter(t => t.turn === 7 && t.player === "p1");
    check("Local Direct HQ lethal: the ending turn has one row, from End Turn (not terminal)", rows.length === 1 && !rows[0].terminal, JSON.stringify(rec.turns));
    check("Local Direct HQ lethal: no phantom turn after the lethal one", (rec.turns ?? []).every(t => t.turn <= 7) && rec.turnsPlayed === 7, `turnsPlayed=${rec.turnsPlayed}`);
    check("Local Direct HQ lethal: winner, reason and Direct HQ damage recorded", rec.winner === "p1" && rec.endReason === "hq" && rec.players?.p2?.hqDamageTaken?.directHq === 1, JSON.stringify({ winner: rec.winner, dmg: rec.players?.p2?.hqDamageTaken }));
    check("Local Direct HQ lethal: durationMs is a local elapsed time", Number.isFinite(rec.durationMs) && rec.durationMs >= 0, `durationMs=${rec.durationMs}`);
    check("Local: the host sees the include/note controls", await page.locator("#end-stats").isVisible(), "hidden");

    await page.locator("#stats-include").check();
    await page.locator("#stats-note").fill("regression test note");
    await page.locator("#stats-save-btn").click();
    await waitFor(async () => ff.getAt(`stats/meta/${rec.matchId}`) !== null);
    const meta = ff.getAt(`stats/meta/${rec.matchId}`);
    const stored = ff.getAt(`stats/matches/${rec.matchId}`);
    check("Local: include/note saved under stats/meta", meta?.included === true && meta?.note === "regression test note", JSON.stringify(meta));
    check("Local: saving include/note leaves the match record untouched", stored && !("included" in stored) && !("note" in stored) && matchWrites(ff).length === 1, JSON.stringify(Object.keys(stored ?? {})));
  } finally {
    await context.close();
  }
}

async function localTerminalAttackRow(browser) {
  const ff = createFakeFirebase();
  const { page, context } = await newLocalPage(browser, ff, "local-attack");
  try {
    // Tiger I (E 7) at 1,1 destroys a Suppressed Rifle Squad (W 2) at 1,2: 2 HQ damage, P2 at 2 HQ.
    await injectLocal(page, {
      turn: 7, initiative: "p1", nextUnitInstance: 100,
      board: board({ "1,1": unit("t-1", "T31", "p1"), "1,2": unit("t-2", "I1", "p2", { state: "suppressed" }) }),
      p1: { ...NO_HEROES, fuel: 4 }, p2: { ...NO_HEROES, hq: 2 },
    });
    await page.locator('.tile[data-key="1,1"]').click();
    await page.locator('.tile[data-key="1,2"]').click();
    await page.locator("#end-screen").waitFor({ state: "visible", timeout: 5000 });
    await waitFor(async () => matchWrites(ff).length > 0);
    const rec = matchWrites(ff)[0]?.value ?? {};
    const rows = (rec.turns ?? []).filter(t => t.turn === 7 && t.player === "p1");
    check("Mid-turn lethal: the final turn is recorded once, flagged terminal", rows.length === 1 && rows[0].terminal === true && !("fuelUnspent" in rows[0]), JSON.stringify(rec.turns));
    check("Mid-turn lethal: combat damage and the kill recorded", rec.players?.p2?.hqDamageTaken?.combat === 2 && rec.players?.p1?.trades?.Tank?.Infantry?.destroyed === 1, JSON.stringify({ dmg: rec.players?.p2?.hqDamageTaken, trades: rec.players?.p1?.trades }));
  } finally {
    await context.close();
  }
}

async function localRetryAfterFailedWrite(browser) {
  const ff = createFakeFirebase();
  let failuresLeft = 1;
  ff.hooks.beforeWrite = ({ path }) => {
    if (path.startsWith("stats/matches/") && failuresLeft-- > 0) throw new Error("PERMISSION_DENIED (simulated)");
  };
  const { page, context } = await newLocalPage(browser, ff, "local-retry");
  try {
    await injectLocal(page, {
      turn: 7, initiative: "p1", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      p1: { ...NO_HEROES }, p2: { ...NO_HEROES, hq: 1 },
    });
    await page.locator("#btn-end-turn").click();
    const retryShown = await page.locator("#stats-retry-btn").waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
    check("Failed write: Retry button appears and nothing was saved", retryShown && matchWrites(ff).length === 0, `retry=${retryShown} writes=${matchWrites(ff).length}`);
    await page.locator("#end-screen").waitFor({ state: "visible", timeout: 5000 });
    const failedMenu = await menuState(page);
    check("Failed write: Main Menu stays blocked while the record is unsaved", failedMenu.exists && failedMenu.disabled && !(await forcedMenuClickNavigates(page)), JSON.stringify(failedMenu));
    const builtId = await page.evaluate(() => window.__SIGNAL_STATS__?.lastRecord?.matchId);
    await page.locator("#stats-retry-btn").click();
    await waitFor(async () => matchWrites(ff).length > 0);
    const writes = matchWrites(ff);
    check("Failed write: Retry saves exactly one record, same match id", writes.length === 1 && writes[0].path === `stats/matches/${builtId}`, JSON.stringify(writes.map(w => w.path)));
    check("Failed write: status confirms the save and Retry hides", (await page.locator("#stats-status").innerText()).includes("Match saved") && !(await page.locator("#stats-retry-btn").isVisible()), await page.locator("#stats-status").innerText());
    await waitFor(async () => !(await menuState(page)).disabled, 3000);
    check("Failed write: a successful Retry enables Main Menu", (await menuState(page)).exists && !(await menuState(page)).disabled, JSON.stringify(await menuState(page)));
  } finally {
    await context.close();
  }
}

async function localMultiPickCommandCancel(browser) {
  const ff = createFakeFirebase();
  const { page, context } = await newLocalPage(browser, ff, "local-commands");
  const played = async id => (await readState(page)).stats.players.p1.cards?.[id]?.played ?? 0;
  const fuel = async () => (await readState(page)).p1.fuel;
  const inHand = async id => (await readState(page)).p1.hand.filter(x => x === id).length;
  try {
    await injectLocal(page, {
      turn: 3, initiative: "p1", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "I1", "p1"), "0,1": unit("t-2", "I1", "p1"), "3,0": unit("t-3", "AR43", "p1"), "3,1": unit("t-4", "AR43", "p1") }),
      p1: { ...NO_HEROES, fuel: 9, hand: ["C03", "C03", "C10", "C32", "C32"], escalateUses: { "Fire for Effect": true } },
      p2: { ...NO_HEROES },
    });

    for (const [id, name, cost] of [["C03", "Rally Cry", 1], ["C10", "Hold Position", 2]]) {
      const handBefore = await inHand(id);
      await page.locator(`#p1-hand .hand-card[data-card-id="${id}"]`).first().click();
      await page.keyboard.press("Escape");
      check(`${name}: full Cancel removes the card play and refunds`, (await played(id)) === 0 && (await fuel()) === 9 && (await inHand(id)) === handBefore, `played=${await played(id)} fuel=${await fuel()}`);
      await page.locator(`#p1-hand .hand-card[data-card-id="${id}"]`).first().click();
      await page.locator('.tile[data-key="0,0"]').click();
      await page.keyboard.press("Escape"); // "Done" after the first pick
      check(`${name}: stopping after one pick keeps exactly one card play`, (await played(id)) === 1 && (await fuel()) === 9 - cost, `played=${await played(id)} fuel=${await fuel()}`);
      await injectLocal(page, { p1: { fuel: 9 } });
    }

    // Fire for Effect with Escalate already used: first pick commits, a second is offered.
    await page.locator('#p1-hand .hand-card[data-card-id="C32"]').first().click();
    await page.keyboard.press("Escape");
    check("Fire for Effect: full Cancel removes the card play and refunds", (await played("C32")) === 0 && (await fuel()) === 9, `played=${await played("C32")} fuel=${await fuel()}`);
    await page.locator('#p1-hand .hand-card[data-card-id="C32"]').first().click();
    await page.locator('.tile[data-key="3,0"]').click();
    await page.keyboard.press("Escape");
    check("Fire for Effect (Escalate): stopping after one pick keeps exactly one card play", (await played("C32")) === 1 && (await fuel()) === 6, `played=${await played("C32")} fuel=${await fuel()}`);
  } finally {
    await context.close();
  }
}

async function localH16CancelStats(browser) {
  const ff = createFakeFirebase();
  const { page, context } = await newLocalPage(browser, ff, "local-h16");
  const h16 = async () => (await readState(page)).stats.players.p1.heroes?.H16 ?? null;
  try {
    await injectLocal(page, {
      turn: 3, initiative: "p1", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      p1: { ...NO_HEROES, fuel: 5, heroZones: ["H16", null, null, null], heroTaxedColumns: {}, pendingHeroDiscount: 0 },
      p2: { ...NO_HEROES },
    });
    const zone = page.locator('#hero-zone-p1 .hero-zone-slot[data-hero-zone="p1-0"]');
    await zone.click();
    await page.locator('.tile[data-key="0,0"]').click();
    const provisional = await h16();
    await page.keyboard.press("Escape");
    const afterCancel = await h16();
    check("H16 destination Cancel: provisional activation stats are removed with the refund", provisional?.activations === 1 && afterCancel === null && (await readState(page)).p1.fuel === 5, `provisional=${JSON.stringify(provisional)} after=${JSON.stringify(afterCancel)}`);
    await zone.click();
    await page.locator('.tile[data-key="0,0"]').click();
    await page.locator('.tile[data-key="0,1"]').click();
    const done = await h16();
    check("H16 completed: one activation and its Fuel recorded", done?.activations === 1 && done?.fuelSpent === 2, JSON.stringify(done));
  } finally {
    await context.close();
  }
}

// ── Online game helpers ────────────────────────────────────────────────────────
async function startOnlineGame(browser, ff, code, { untilMulligan = false } = {}) {
  const hostCtx = await browser.newContext();
  await ff.attach(hostCtx, "p1");
  const joinCtx = await browser.newContext();
  await ff.attach(joinCtx, "p2");
  const host = await hostCtx.newPage();
  const joiner = await joinCtx.newPage();
  const close = async () => { await hostCtx.close(); await joinCtx.close(); };
  for (const [p, l] of [[host, "host"], [joiner, "joiner"]]) p.on("pageerror", e => check(`${code} ${l}: no page errors`, false, e.message));
  await host.goto(`${BASE_URL}/game.html?game=${code}&role=p1&mapId=kursk`, { waitUntil: "domcontentloaded" });
  await host.locator('#deck-grid .deck-option[data-deck="infantry-formation"]').click();
  await joiner.goto(`${BASE_URL}/game.html?game=${code}&role=p2&mapId=kursk`, { waitUntil: "domcontentloaded" });
  await joiner.locator('#deck-grid .deck-option[data-deck="tank-blitz"]').click();
  await host.locator("#mulligan-screen").waitFor({ state: "visible", timeout: 10000 });
  await joiner.locator("#mulligan-screen").waitFor({ state: "visible", timeout: 10000 });
  if (untilMulligan) return { host, joiner, close };
  await host.locator("#btn-mulligan-keep").click();
  await joiner.locator("#btn-mulligan-keep").click();
  await host.locator("#game-area").waitFor({ state: "visible", timeout: 10000 });
  await joiner.locator("#game-area").waitFor({ state: "visible", timeout: 10000 });
  return { host, joiner, close };
}

// Writes a prepared game state server-side, as another client would; both pages receive it.
async function injectOnline(ff, code, overrides) {
  const current = ff.getAt(`games/${code}`);
  await ff.serverSet(`games/${code}`, {
    ...current, ...overrides,
    p1: { ...current.p1, ...(overrides.p1 ?? {}) },
    p2: { ...current.p2, ...(overrides.p2 ?? {}) },
    pendingObjectivePick: null,
    pendingArtyHits: 0,
    _revision: (current._revision ?? 0) + 1,
    _pushId: "test-inject",
  });
}

const isTerminal = value => (value?.p1?.hq ?? 1) <= 0 || (value?.p2?.hq ?? 1) <= 0;

async function onlineP2Lethal(browser) {
  const ff = createFakeFirebase();
  const code = "STATP2";
  const game = await startOnlineGame(browser, ff, code);
  try {
    await injectOnline(ff, code, {
      turn: 8, initiative: "p2", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "T23", "p2") }),
      p1: { ...NO_HEROES, hq: 1 }, p2: { ...NO_HEROES },
    });
    await waitFor(async () => (await readState(game.joiner)).initiative === "p2" && (await readState(game.joiner)).p1.hq === 1);
    await game.joiner.locator("#btn-end-turn").click();
    await game.host.locator("#end-screen").waitFor({ state: "visible", timeout: 8000 });
    await game.joiner.locator("#end-screen").waitFor({ state: "visible", timeout: 8000 });
    await waitFor(async () => matchWrites(ff, code).length > 0);
    await new Promise(r => setTimeout(r, 1500)); // give a second (wrong) writer time to show up
    const writes = matchWrites(ff, code);
    check("Online P2 lethal: exactly one match record", writes.length === 1, `writes=${writes.length}`);
    check("Online P2 lethal: written by the client that ended the match (P2)", writes[0]?.label === "p2" && writes[0]?.value?.winner === "p2", JSON.stringify(writes.map(w => [w.label, w.value?.winner])));
    check("Online: only the host sees include/note controls", (await game.host.locator("#end-stats").isVisible()) && !(await game.joiner.locator("#end-stats").isVisible()), "controls visibility wrong");
  } finally {
    await game.close();
  }
}

async function onlineP1LethalWaitsForCommit(browser) {
  const ff = createFakeFirebase();
  const code = "STATP1";
  const game = await startOnlineGame(browser, ff, code);
  let release;
  const gate = new Promise(r => { release = r; });
  let held = false;
  try {
    await injectOnline(ff, code, {
      turn: 7, initiative: "p1", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      p1: { ...NO_HEROES }, p2: { ...NO_HEROES, hq: 1 },
    });
    await waitFor(async () => (await readState(game.host)).initiative === "p1" && (await readState(game.host)).p2.hq === 1);
    ff.hooks.beforeCas = async ({ path, value }) => {
      if (path === `games/${code}` && isTerminal(value)) {
        held = true;
        await gate;
      }
    };
    await game.host.locator("#btn-end-turn").click();
    await game.host.locator("#end-screen").waitFor({ state: "visible", timeout: 8000 });
    await waitFor(async () => held);
    await new Promise(r => setTimeout(r, 1500));
    check("Online P1 lethal: no record while the game-ending transaction is still pending", held && matchWrites(ff, code).length === 0, `held=${held} writes=${matchWrites(ff, code).length}`);
    release();
    await waitFor(async () => matchWrites(ff, code).length > 0);
    await new Promise(r => setTimeout(r, 1000));
    const writes = matchWrites(ff, code);
    check("Online P1 lethal: exactly one record once the transaction commits, written by P1", writes.length === 1 && writes[0].label === "p1", JSON.stringify(writes.map(w => w.label)));
  } finally {
    release?.();
    ff.hooks.beforeCas = null;
    await game.close();
  }
}

async function onlineRejectedTerminalWrite(browser) {
  const ff = createFakeFirebase();
  const code = "STATRJ";
  const game = await startOnlineGame(browser, ff, code);
  let rejected = false;
  const host = game.host;
  // Read defensively: the isGameOver hook doesn't exist before the rollback fix, and the stuck
  // client must fail the check below rather than crash the scenario.
  const hostGameOver = () => host.evaluate(() => window.__SIGNAL_TEST_HOOKS__.isGameOver?.() ?? "no-hook");
  try {
    await injectOnline(ff, code, {
      turn: 7, initiative: "p1", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      p1: { ...NO_HEROES, hand: ["I1"], fuel: 3 }, p2: { ...NO_HEROES, hq: 1 },
    });
    await waitFor(async () => (await readState(host)).initiative === "p1" && (await readState(host)).p2.hq === 1);
    // Another update lands on the server first: the game-ending write loses the race. Only the
    // first game-ending write is rejected; a later one commits normally.
    ff.hooks.beforeCas = async ({ path, value }) => {
      if (rejected || path !== `games/${code}` || !isTerminal(value)) return undefined;
      rejected = true;
      const current = ff.getAt(path);
      await ff.serverSet(path, { ...current, _revision: (current._revision ?? 0) + 1, _pushId: "other-client" });
      return "conflict";
    };
    await host.locator("#btn-end-turn").click();
    await waitFor(async () => rejected);
    await new Promise(r => setTimeout(r, 3000)); // past the 1800ms end-screen reveal
    check("Online rejected game-ending write: no match record at all", rejected && matchWrites(ff, code).length === 0, `rejected=${rejected} writes=${matchWrites(ff, code).length}`);
    check("Online rejected game-ending write: the server kept the non-terminal state", !isTerminal(ff.getAt(`games/${code}`)), JSON.stringify({ p1: ff.getAt(`games/${code}`)?.p1?.hq, p2: ff.getAt(`games/${code}`)?.p2?.hq }));

    // The acting client must be back in the live match, not frozen on its rejected ending.
    check("Online rejected game-ending write: the acting client's end screen is not left visible", !(await host.locator("#end-screen").isVisible()), "end screen visible");
    check("Online rejected game-ending write: the acting client is no longer game-over", (await hostGameOver()) === false, `gameOver=${await hostGameOver()}`);
    const afterRejection = await readState(host);
    check("Online rejected game-ending write: the server's non-terminal state is active locally", afterRejection.p2.hq === 1 && afterRejection.turn === 7 && afterRejection.initiative === "p1" && afterRejection._revision === ff.getAt(`games/${code}`)._revision, JSON.stringify({ p2hq: afterRejection.p2.hq, turn: afterRejection.turn, initiative: afterRejection.initiative, rev: afterRejection._revision, serverRev: ff.getAt(`games/${code}`)._revision }));

    await host.locator('#p1-hand .hand-card[data-card-id="I1"]').click({ timeout: 3000 }).catch(() => {});
    await host.locator('.tile[data-key="3,3"]').click({ timeout: 3000 }).catch(() => {});
    const placed = await waitFor(async () => ff.getAt(`games/${code}`)?.board?.["3,3"]?.cardId === "I1");
    check("Online rejected game-ending write: the player can keep playing (a new Unit placement syncs)", placed, `server 3,3=${JSON.stringify(ff.getAt(`games/${code}`)?.board?.["3,3"] ?? null)}`);

    await host.locator("#btn-end-turn").click({ timeout: 3000 }).catch(() => {});
    await waitFor(async () => matchWrites(ff, code).length > 0, 8000);
    await new Promise(r => setTimeout(r, 1500));
    const writes = matchWrites(ff, code);
    const rec = writes[0]?.value ?? {};
    check("Online rejected game-ending write: a later committed lethal creates exactly one record", writes.length === 1 && writes[0].label === "p1" && isTerminal(ff.getAt(`games/${code}`)), `writes=${writes.length} labels=${JSON.stringify(writes.map(w => w.label))}`);
    check("Online rejected game-ending write: the record is the successful ending (includes the play made after the rejection)", rec.winner === "p1" && rec.players?.p1?.cards?.I1?.played === 1 && (rec.turns ?? []).filter(t => t.turn === 7 && t.player === "p1").length === 1, JSON.stringify({ winner: rec.winner, i1: rec.players?.p1?.cards?.I1, turns: rec.turns }));
  } finally {
    ff.hooks.beforeCas = null;
    await game.close();
  }
}

// Blocker regression (2026-09-17 review): P2's lethal is committed and recorded, then P2 leaves
// (_playerLeft), and the surviving host only processes the newest snapshot, which holds both. The
// survivor must show the real result and write nothing, never a disconnect record over the HQ one.
// Run in both directions: the host and the joiner receive snapshots through different listeners.
async function coalescedEndingAndLeave(browser, { code, ender }) {
  const survivor = ender === "p1" ? "p2" : "p1";
  const tag = `Coalesced ending+leave (${ender.toUpperCase()} ends, ${survivor.toUpperCase()} survives)`;
  const ff = createFakeFirebase();
  const game = await startOnlineGame(browser, ff, code);
  const pageOf = role => (role === "p1" ? game.host : game.joiner);
  try {
    await injectOnline(ff, code, {
      turn: 8, initiative: ender, nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", ender === "p2" ? "T23" : "I1", ender) }),
      p1: { ...NO_HEROES, ...(survivor === "p1" ? { hq: 1 } : {}) },
      p2: { ...NO_HEROES, ...(survivor === "p2" ? { hq: 1 } : {}) },
    });
    await waitFor(async () => (await readState(pageOf(survivor)))[survivor].hq === 1 && (await readState(pageOf(ender))).initiative === ender);
    ff.holdDeliveries(survivor); // the survivor sees nothing until release
    await pageOf(ender).locator("#btn-end-turn").click();
    await waitFor(async () => matchWrites(ff, code).length > 0, 8000);
    const hqWrite = matchWrites(ff, code)[0];
    check(`${tag}: the ending client wrote the HQ record`, hqWrite?.label === ender && hqWrite?.value?.winner === ender && hqWrite?.value?.endReason === "hq", JSON.stringify(hqWrite && { label: hqWrite.label, winner: hqWrite.value?.winner, reason: hqWrite.value?.endReason }));
    await writePlayerLeft(pageOf(ender), code, ender);
    const server = ff.getAt(`games/${code}`);
    check(`${tag}: the server snapshot holds both the ending and the leave`, isTerminal(server) && server?._playerLeft === ender, JSON.stringify({ p1hq: server?.p1?.hq, p2hq: server?.p2?.hq, left: server?._playerLeft }));
    await ff.releaseDeliveries(survivor); // exactly one delivery: terminal state + _playerLeft together
    const survivorPage = pageOf(survivor);
    await survivorPage.locator("#end-screen").waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    const winnerText = (await survivorPage.locator("#end-winner").innerText().catch(() => "")).trim();
    const writes = matchWrites(ff, code);
    const stored = ff.getAt(`stats/matches/${hqWrite?.value?.matchId}`);
    check(`${tag}: the survivor shows the real result, not a disconnect`, winnerText === `${ender.toUpperCase()} WINS`, `end-winner="${winnerText}"`);
    check(`${tag}: the survivor writes nothing (no disconnect record, no second HQ record)`, writes.length === 1 && !writes.some(w => w.label === survivor), JSON.stringify(writes.map(w => [w.label, w.value?.endReason])));
    check(`${tag}: the stored record is still the original HQ result`, stored?.winner === ender && stored?.endReason === "hq", JSON.stringify(stored && { winner: stored.winner, endReason: stored.endReason }));
  } finally {
    await game.close();
  }
}

const onlineCoalescedTerminalAndPlayerLeft = browser => coalescedEndingAndLeave(browser, { code: "STATCO", ender: "p2" });
const onlineCoalescedTerminalAndPlayerLeftJoinerSurvives = browser => coalescedEndingAndLeave(browser, { code: "STATCJ", ender: "p1" });

async function onlineDisconnectDuringMulligan(browser) {
  const ff = createFakeFirebase();
  const code = "STATMU";
  const game = await startOnlineGame(browser, ff, code, { untilMulligan: true });
  try {
    const before = await readState(game.host);
    check("Mulligan disconnect: setup is pre-play with statistics already created", before?.readyForPlay === false && !!before?.stats?.matchId, JSON.stringify({ readyForPlay: before?.readyForPlay, stats: !!before?.stats }));
    await writePlayerLeft(game.joiner, code, "p2");
    const shown = await game.host.locator("#end-screen").waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
    await new Promise(r => setTimeout(r, 2000));
    const text = (await game.host.locator("#end-winner").innerText().catch(() => "")).trim();
    check("Mulligan disconnect: the survivor is told the opponent left", shown && text.includes("LEFT THE GAME"), `shown=${shown} text="${text}"`);
    check("Mulligan disconnect: no match record for a match that never started, and no stats controls", matchWrites(ff, code).length === 0 && !(await game.host.locator("#end-stats").isVisible()), `writes=${matchWrites(ff, code).length}`);
  } finally {
    await game.close();
  }
}

async function onlineDisconnectAfterReady(browser) {
  const ff = createFakeFirebase();
  const code = "STATDC";
  const game = await startOnlineGame(browser, ff, code);
  try {
    check("Post-start disconnect: the match is playable", (await readState(game.host))?.readyForPlay === true, "not readyForPlay");
    await writePlayerLeft(game.joiner, code, "p2");
    await waitFor(async () => matchWrites(ff, code).length > 0, 8000);
    await new Promise(r => setTimeout(r, 1500));
    const writes = matchWrites(ff, code);
    check("Post-start disconnect: exactly one disconnect record, no winner, written by the survivor", writes.length === 1 && writes[0].label === "p1" && writes[0].value?.winner === null && writes[0].value?.endReason === "disconnect", JSON.stringify(writes.map(w => ({ label: w.label, winner: w.value?.winner, reason: w.value?.endReason }))));
  } finally {
    await game.close();
  }
}

// Main Menu must not let the player leave before the ending is durable: first the game-ending
// transaction, then the match record write. Both are held here and released in turn.
async function onlineMainMenuWaitsForPersistence(browser) {
  const ff = createFakeFirebase();
  const code = "STATMM";
  const game = await startOnlineGame(browser, ff, code);
  const host = game.host;
  let releaseCas;
  let releaseWrite;
  const casGate = new Promise(r => { releaseCas = r; });
  const writeGate = new Promise(r => { releaseWrite = r; });
  let casHeld = false;
  let writeHeld = false;
  try {
    await injectOnline(ff, code, {
      turn: 7, initiative: "p1", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      p1: { ...NO_HEROES }, p2: { ...NO_HEROES, hq: 1 },
    });
    await waitFor(async () => (await readState(host)).initiative === "p1" && (await readState(host)).p2.hq === 1);
    ff.hooks.beforeCas = async ({ path, value }) => {
      if (path === `games/${code}` && isTerminal(value)) { casHeld = true; await casGate; }
    };
    ff.hooks.beforeWrite = async ({ path }) => {
      if (path.startsWith(`stats/matches/${code}`)) { writeHeld = true; await writeGate; }
    };
    await host.locator("#btn-end-turn").click();
    await waitFor(async () => casHeld);
    await host.locator("#end-screen").waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
    const duringCas = await menuState(host);
    check("Main Menu: blocked while the game-ending transaction is unconfirmed", casHeld && duringCas.exists && duringCas.disabled && !(await forcedMenuClickNavigates(host)), JSON.stringify({ casHeld, ...duringCas }));

    releaseCas();
    await waitFor(async () => writeHeld);
    const duringWrite = await menuState(host);
    check("Main Menu: still blocked while the match record write is in flight", writeHeld && duringWrite.exists && duringWrite.disabled && !(await forcedMenuClickNavigates(host)), JSON.stringify({ writeHeld, ...duringWrite }));

    releaseWrite();
    await waitFor(async () => (await host.locator("#stats-status").innerText()).includes("Match saved"));
    await waitFor(async () => !(await menuState(host)).disabled, 3000);
    const afterSave = await menuState(host);
    check("Main Menu: enabled once the record is saved (status shown, Retry hidden)", afterSave.exists && !afterSave.disabled && (await host.locator("#stats-status").innerText()).includes("Match saved") && !(await host.locator("#stats-retry-btn").isVisible()), JSON.stringify(afterSave));
    await host.locator("#end-menu-btn").click({ timeout: 3000 }).catch(() => {});
    check("Main Menu: navigates once enabled", await waitFor(async () => /index\.html/.test(host.url()), 5000), host.url());
  } finally {
    releaseCas?.();
    releaseWrite?.();
    ff.hooks.beforeCas = null;
    ff.hooks.beforeWrite = null;
    await game.close();
  }
}

// Real Firebase rejects invalid keys and non-finite numbers; the server-value placeholder stays legal.
async function fakeFirebaseValidatesKeysAndNumbers(browser) {
  const ff = createFakeFirebase();
  const context = await browser.newContext();
  await ff.attach(context, "fake-keys");
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
    const outcome = await page.evaluate(async () => {
      const db = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const attempt = async fn => { try { await fn(); return "accepted"; } catch (err) { return `rejected: ${err.message}`; } };
      const root = db.getDatabase();
      const r = db.ref(root, "probe");
      return {
        dotKey: await attempt(() => db.set(r, { "a.b": 1 })),
        nestedSlashKey: await attempt(() => db.set(r, { nested: { "a/b": 1 } })),
        dollarKey: await attempt(() => db.set(r, { $x: 1 })),
        bracketKey: await attempt(() => db.set(r, { "[0]": 1 })),
        hashKey: await attempt(() => db.set(r, { "a#b": 1 })),
        updateBadSegment: await attempt(() => db.update(r, { "ok/bad#seg": 1 })),
        updateDeepPath: await attempt(() => db.update(r, { "ok/deep": 1 })),
        badRefPath: await attempt(() => db.set(db.ref(root, "games/a.b"), 1)),
        nan: await attempt(() => db.set(r, { n: NaN })),
        infinity: await attempt(() => db.set(r, { n: Infinity })),
        serverTimestamp: await attempt(() => db.set(db.ref(root, "probe-ts"), { at: db.serverTimestamp() })),
      };
    });
    for (const k of ["dotKey", "nestedSlashKey", "dollarKey", "bracketKey", "hashKey", "updateBadSegment", "badRefPath", "nan", "infinity"]) {
      check(`Fake Firebase: rejects ${k}`, outcome[k].startsWith("rejected"), outcome[k]);
    }
    check("Fake Firebase: update() with a deep a/b path is accepted", outcome.updateDeepPath === "accepted" && ff.getAt("probe/ok/deep") === 1, `${outcome.updateDeepPath} stored=${JSON.stringify(ff.getAt("probe"))}`);
    check("Fake Firebase: the {'.sv':'timestamp'} placeholder is accepted as a value", outcome.serverTimestamp === "accepted" && typeof ff.getAt("probe-ts/at") === "number", `${outcome.serverTimestamp} stored=${JSON.stringify(ff.getAt("probe-ts"))}`);
  } finally {
    await context.close();
  }
}

async function fakeFirebaseHoldsAndCoalescesDeliveries(browser) {
  const ff = createFakeFirebase();
  const context = await browser.newContext();
  await ff.attach(context, "hold-probe");
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const db = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      window.__seen = [];
      db.onValue(db.ref(db.getDatabase(), "probe/hold"), snap => window.__seen.push(snap.val()));
    });
    await waitFor(async () => (await page.evaluate(() => window.__seen.length)) >= 1);
    const base = await page.evaluate(() => window.__seen.length);
    ff.holdDeliveries("hold-probe");
    for (const n of [1, 2, 3]) await ff.serverSet("probe/hold", { n });
    await page.waitForTimeout(300);
    const duringHold = await page.evaluate(() => window.__seen.length);
    await ff.releaseDeliveries("hold-probe");
    await page.waitForTimeout(300);
    const seen = await page.evaluate(() => window.__seen);
    check("Fake Firebase: a held listener receives nothing while writes continue", duringHold === base, `before=${base} during=${duringHold}`);
    check("Fake Firebase: release delivers only the newest value, exactly once", seen.length === base + 1 && seen.at(-1)?.n === 3, JSON.stringify(seen));
  } finally {
    await context.close();
  }
}

// Real Firebase rejects writes containing `undefined`; the stand-in must too, or it would hide a
// violation of the "never write undefined" rule. Nulls are still allowed (they delete).
async function fakeFirebaseRejectsUndefined(browser) {
  const ff = createFakeFirebase();
  const context = await browser.newContext();
  await ff.attach(context, "fake-undefined");
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
    const outcome = await page.evaluate(async () => {
      const db = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const attempt = async (fn) => { try { await fn(); return "accepted"; } catch (err) { return `rejected: ${err.message}`; } };
      const r = db.ref(db.getDatabase(), "probe");
      return {
        setObject: await attempt(() => db.set(r, { valid: 1, invalid: undefined })),
        setNestedArray: await attempt(() => db.set(r, { list: [1, undefined, 3] })),
        update: await attempt(() => db.update(r, { valid: 1, nested: { invalid: undefined } })),
        nullAllowed: await attempt(() => db.set(r, { valid: 1, removed: null })),
      };
    });
    check("Fake Firebase: set() with an undefined property is rejected", outcome.setObject.startsWith("rejected"), outcome.setObject);
    check("Fake Firebase: set() with undefined inside an array is rejected", outcome.setNestedArray.startsWith("rejected"), outcome.setNestedArray);
    check("Fake Firebase: update() with a nested undefined is rejected", outcome.update.startsWith("rejected"), outcome.update);
    check("Fake Firebase: null values are still accepted (and dropped)", outcome.nullAllowed === "accepted" && JSON.stringify(ff.getAt("probe")) === JSON.stringify({ valid: 1 }), `${outcome.nullAllowed} stored=${JSON.stringify(ff.getAt("probe"))}`);
  } finally {
    await context.close();
  }
}

// ── Statistics page ────────────────────────────────────────────────────────────
function sampleRecord(matchId, { mode, source, winner }) {
  const deck = Array.from({ length: 15 }, () => ["I1", "T33"]).flat();
  const loser = winner === "p1" ? "p2" : "p1";
  let s = createInitialState(deck, deck, "kursk", ["H07"], ["H07"]);
  s = { ...s, initiative: "p1", turn: 9 };
  s = { ...s, stats: createMatchStats(s, { matchId, mode, source, startedAt: Date.now() - 600000 }) };
  s = recordCardPlayed(s, "p1", "T33", 4);
  s = recordHqDamage(s, loser, 30, "combat");
  s = { ...s, [loser]: { ...s[loser], hq: 0 } };
  return buildMatchRecord(s, { winner, endReason: "hq", endedAt: Date.now(), durationMs: 600000, site: "test" });
}

async function statsPage(browser) {
  const ff = createFakeFirebase();
  await ff.serverSet("stats/matches/A", sampleRecord("A", { mode: "hotseat", source: "human", winner: "p1" }));
  await ff.serverSet("stats/matches/B", sampleRecord("B", { mode: "online", source: "human", winner: "p2" }));
  await ff.serverSet("stats/matches/C", sampleRecord("C", { mode: "hotseat", source: "selfplay", winner: "p1" }));
  await ff.serverSet("stats/meta/A", { included: true, note: "real playtest", updatedAt: 1 });
  const context = await browser.newContext({ acceptDownloads: true });
  await ff.attach(context, "stats-page");
  const page = await context.newPage();
  page.on("pageerror", e => check("Statistics page: no page errors", false, e.message));
  const count = () => page.locator("#stats-count").innerText();
  try {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
    await page.locator("#btn-stats").click();
    await page.waitForURL(/stats\.html/, { timeout: 5000 });
    await page.locator("#section-summary table").waitFor({ timeout: 8000 });
    check("Statistics page: main menu tile opens it; default filters show only included human matches", (await count()).startsWith("1 OF 3"), await count());

    await page.locator("#f-included").uncheck();
    check("Statistics page: unticking 'Included only' shows every human match", (await count()).startsWith("2 OF 3"), await count());

    const bRow = page.locator("#section-matches tbody tr", { hasText: "B" }).filter({ hasText: "online" });
    await bRow.locator('input[type="checkbox"]').check();
    await waitFor(async () => ff.getAt("stats/meta/B")?.included === true);
    await page.locator("#f-included").check();
    check("Statistics page: ticking include in the match list saves to stats/meta and counts the match", ff.getAt("stats/meta/B")?.included === true && (await count()).startsWith("2 OF 3"), `${JSON.stringify(ff.getAt("stats/meta/B"))} ${await count()}`);

    await page.locator("#section-cards th").filter({ hasText: /^Played( [▲▼])?$/ }).click();
    check("Statistics page: clicking a column header sorts it", (await page.locator("#section-cards th").filter({ hasText: /^Played( [▲▼])?$/ }).innerText()).includes("▼"), await page.locator("#section-cards th").filter({ hasText: /^Played( [▲▼])?$/ }).innerText());

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 5000 }),
      page.locator("#section-cards .stats-section-header button").click(),
    ]);
    const csv = readFileSync(await download.path(), "utf8");
    check("Statistics page: CSV export downloads the table with its header", csv.split("\n")[0].startsWith("ID,Card,") && csv.includes("T33"), csv.split("\n")[0]);

    const jsonl = `${JSON.stringify(sampleRecord("D", { mode: "hotseat", source: "selfplay", winner: "p2" }))}\n`;
    await page.locator("#f-file").setInputFiles({ name: "selfplay_stats.jsonl", mimeType: "application/json", buffer: Buffer.from(jsonl) });
    await waitFor(async () => (await count()).includes("SELF-PLAY FILE"));
    check("Statistics page: loading a self-play file shows its records", (await count()).startsWith("1 OF 1") && (await count()).includes("SELF-PLAY FILE"), await count());
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const only = process.argv[2];
  try {
    for (const scenario of [
      localDirectHqRecordAndMeta, localTerminalAttackRow, localRetryAfterFailedWrite,
      localMultiPickCommandCancel, localH16CancelStats,
      onlineP2Lethal, onlineP1LethalWaitsForCommit, onlineRejectedTerminalWrite,
      onlineCoalescedTerminalAndPlayerLeft, onlineCoalescedTerminalAndPlayerLeftJoinerSurvives,
      onlineDisconnectDuringMulligan, onlineDisconnectAfterReady,
      onlineMainMenuWaitsForPersistence,
      fakeFirebaseRejectsUndefined, fakeFirebaseValidatesKeysAndNumbers, fakeFirebaseHoldsAndCoalescesDeliveries,
      statsPage,
    ].filter(s => !only || s.name.toLowerCase().includes(only.toLowerCase()))) {
      try {
        await scenario(browser);
      } catch (err) {
        check(`${scenario.name} ran without crashing`, false, err.message.split("\n")[0]);
      }
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
})();
