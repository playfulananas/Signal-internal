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
//   - the game-ending transaction is rejected: no record at all
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
    const builtId = await page.evaluate(() => window.__SIGNAL_STATS__?.lastRecord?.matchId);
    await page.locator("#stats-retry-btn").click();
    await waitFor(async () => matchWrites(ff).length > 0);
    const writes = matchWrites(ff);
    check("Failed write: Retry saves exactly one record, same match id", writes.length === 1 && writes[0].path === `stats/matches/${builtId}`, JSON.stringify(writes.map(w => w.path)));
    check("Failed write: status confirms the save and Retry hides", (await page.locator("#stats-status").innerText()).includes("saved") && !(await page.locator("#stats-retry-btn").isVisible()), await page.locator("#stats-status").innerText());
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
async function startOnlineGame(browser, ff, code) {
  const hostCtx = await browser.newContext();
  await ff.attach(hostCtx, "p1");
  const joinCtx = await browser.newContext();
  await ff.attach(joinCtx, "p2");
  const host = await hostCtx.newPage();
  const joiner = await joinCtx.newPage();
  for (const [p, l] of [[host, "host"], [joiner, "joiner"]]) p.on("pageerror", e => check(`${code} ${l}: no page errors`, false, e.message));
  await host.goto(`${BASE_URL}/game.html?game=${code}&role=p1&mapId=kursk`, { waitUntil: "domcontentloaded" });
  await host.locator('#deck-grid .deck-option[data-deck="infantry-formation"]').click();
  await joiner.goto(`${BASE_URL}/game.html?game=${code}&role=p2&mapId=kursk`, { waitUntil: "domcontentloaded" });
  await joiner.locator('#deck-grid .deck-option[data-deck="tank-blitz"]').click();
  await host.locator("#mulligan-screen").waitFor({ state: "visible", timeout: 10000 });
  await joiner.locator("#mulligan-screen").waitFor({ state: "visible", timeout: 10000 });
  await host.locator("#btn-mulligan-keep").click();
  await joiner.locator("#btn-mulligan-keep").click();
  await host.locator("#game-area").waitFor({ state: "visible", timeout: 10000 });
  await joiner.locator("#game-area").waitFor({ state: "visible", timeout: 10000 });
  return { host, joiner, close: async () => { await hostCtx.close(); await joinCtx.close(); } };
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
  try {
    await injectOnline(ff, code, {
      turn: 7, initiative: "p1", nextUnitInstance: 100,
      board: board({ "0,0": unit("t-1", "I1", "p1") }),
      p1: { ...NO_HEROES }, p2: { ...NO_HEROES, hq: 1 },
    });
    await waitFor(async () => (await readState(game.host)).initiative === "p1" && (await readState(game.host)).p2.hq === 1);
    // Another update lands on the server first: the game-ending write loses the race.
    ff.hooks.beforeCas = async ({ path, value }) => {
      if (rejected || path !== `games/${code}` || !isTerminal(value)) return undefined;
      rejected = true;
      const current = ff.getAt(path);
      await ff.serverSet(path, { ...current, _revision: (current._revision ?? 0) + 1, _pushId: "other-client" });
      return "conflict";
    };
    await game.host.locator("#btn-end-turn").click();
    await waitFor(async () => rejected);
    await new Promise(r => setTimeout(r, 3000));
    check("Online rejected game-ending write: no match record at all", rejected && matchWrites(ff, code).length === 0, `rejected=${rejected} writes=${matchWrites(ff, code).length}`);
    check("Online rejected game-ending write: the server kept the non-terminal state", !isTerminal(ff.getAt(`games/${code}`)), JSON.stringify({ p1: ff.getAt(`games/${code}`)?.p1?.hq, p2: ff.getAt(`games/${code}`)?.p2?.hq }));
  } finally {
    ff.hooks.beforeCas = null;
    await game.close();
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
