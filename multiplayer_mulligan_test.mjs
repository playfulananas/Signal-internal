// Verifies simultaneous online mulligan (per direct request — the old flow was sequential:
// P2 sat on a blank waiting screen until P1 had already finished mulliganing and the whole
// game had technically started). Runs the scenario twice, once with P2 confirming first and
// once with P1 confirming first, since the host (P1) has two different code paths depending on
// which order finishes last — its own listener vs. its own onConfirm handler (see
// showOnlineMulligan/beginOnlineMulligan in game.js).
// Run with: node multiplayer_mulligan_test.mjs (dev server must be running).
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
let failed = false;
function fail(msg) { console.error(`FAIL: ${msg}`); failed = true; }
function ok(msg) { console.log(`OK: ${msg}`); }

async function setupToMulliganScreens(browser, mapAttr) {
  const hostCtx = await browser.newContext();
  const joinCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const joiner = await joinCtx.newPage();
  host.on('pageerror', e => fail(`[${mapAttr}] host page error: ${e.message}`));
  joiner.on('pageerror', e => fail(`[${mapAttr}] joiner page error: ${e.message}`));

  await host.goto(`${BASE_URL}/index.html`);
  await host.locator('#btn-host-open').click();
  await host.locator(`.deck-option[data-map="${mapAttr}"]`).click();
  await host.waitForURL(/game\.html\?game=.*role=p1/, { timeout: 8000 });

  await joiner.goto(`${BASE_URL}/index.html`);
  await joiner.waitForSelector('.lobby-row', { timeout: 8000 });
  await joiner.locator('.lobby-row').first().click();
  await joiner.waitForURL(/game\.html\?game=.*role=p2/, { timeout: 8000 });

  // Neither deck-pick depends on the other (unaffected by this change, confirmed separately).
  await host.locator('.deck-option[data-deck="infantry-formation"]').click();
  await joiner.locator('.deck-option[data-deck="tank-blitz"]').click();

  // The actual thing under test: BOTH must reach their own mulligan screen without waiting on
  // the other. If mulligan were still sequential, the joiner would sit on a waiting screen here
  // instead, since P1 mulliganing hadn't happened yet.
  const results = await Promise.allSettled([
    host.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 }),
    joiner.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 }),
  ]);
  if (results[0].status === 'rejected') fail(`[${mapAttr}] host never reached its mulligan screen`);
  if (results[1].status === 'rejected') fail(`[${mapAttr}] joiner never reached its mulligan screen — mulligan is still sequential`);
  if (results.every(r => r.status === 'fulfilled')) {
    ok(`[${mapAttr}] both host and joiner reached their own mulligan screen simultaneously, neither waited on the other`);
  }

  return { host, joiner, hostCtx, joinCtx };
}

async function confirmMulligan(page) {
  await page.locator('#btn-mulligan-keep').click();
}

async function bothReachBoard(host, joiner, label) {
  const results = await Promise.allSettled([
    host.waitForSelector('#board', { state: 'visible', timeout: 10000 }),
    joiner.waitForSelector('#board', { state: 'visible', timeout: 10000 }),
  ]);
  if (results[0].status === 'rejected') fail(`[${label}] host never reached the live board`);
  if (results[1].status === 'rejected') fail(`[${label}] joiner never reached the live board`);
  if (results.every(r => r.status === 'fulfilled')) {
    ok(`[${label}] both reached the live board after simultaneous mulligan`);
  }
}

const browser = await chromium.launch();
try {
  // ── Scenario A: P1 (host) confirms first, P2 second ─────────────────────────
  {
    const { host, joiner, hostCtx, joinCtx } = await setupToMulliganScreens(browser, 'stalingrad');
    await confirmMulligan(host);
    await host.waitForTimeout(300);
    const hostOnBoardEarly = await host.locator('#board').isVisible().catch(() => false);
    if (hostOnBoardEarly) fail('[A: P1-first] host reached the board before the joiner even mulliganed');
    await confirmMulligan(joiner);
    await bothReachBoard(host, joiner, 'A: P1-first');
    await hostCtx.close();
    await joinCtx.close();
  }

  // ── Scenario B: P2 (joiner) confirms first, P1 second ───────────────────────
  {
    const { host, joiner, hostCtx, joinCtx } = await setupToMulliganScreens(browser, 'kursk');
    await confirmMulligan(joiner);
    await joiner.waitForTimeout(300);
    const joinerOnBoardEarly = await joiner.locator('#board').isVisible().catch(() => false);
    if (joinerOnBoardEarly) fail('[B: P2-first] joiner reached the board before the host even mulliganed');
    await confirmMulligan(host);
    await bothReachBoard(host, joiner, 'B: P2-first');
    await hostCtx.close();
    await joinCtx.close();
  }
} catch (e) {
  fail(`unexpected exception: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}
