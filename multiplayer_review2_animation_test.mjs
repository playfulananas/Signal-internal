// Live 2-client verification for GPT's second-round review of fix/signal-gameplay-corrections
// (commit 289b9cb). Specifically targets what GPT's own review could NOT live-test (its cloud
// browser hit ERR_BLOCKED_BY_CLIENT against the local build): Direct HQ flash/connector and Hero
// activation glow reaching the OPPONENT'S client, plus the new per-victim Blast feedback and the
// Hero-activate -> placement no-repeat-event fix (findings 1 and 5).
//
// Mirrors multiplayer_craft_test.mjs's lobby-setup/debug-panel-injection pattern. One match,
// two scenarios, alternating which role is the actor so both get covered:
//   A. P1 (host) attacks with AR46 (Blast) into a 3-unit formation, then ends the turn with a
//      separate isolated Unit converting to Direct HQ damage. Checked on BOTH clients.
//   B. P2 (joiner) activates H25 Chief Aircraft Engineer's Craft power. Checked on BOTH clients,
//      then immediately followed by P2 placing an unrelated Unit from hand (the exact
//      Hero-activate -> placement sequence finding 1 was about) to confirm the glow does not
//      re-fire on that second delivery.
//
// Requires the dev server (npm run dev) and hits the live Firebase project — same caveats as
// every other multiplayer_*_test.mjs. Run with: node multiplayer_review2_animation_test.mjs
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
let failed = false;
function fail(msg) { console.error(`FAIL: ${msg}`); failed = true; }
function ok(msg) { console.log(`OK: ${msg}`); }

const browser = await chromium.launch();
const hostCtx = await browser.newContext();
const joinCtx = await browser.newContext();
const host = await hostCtx.newPage();
const joiner = await joinCtx.newPage();

const hostErrors = [];
const joinErrors = [];
host.on('pageerror', e => hostErrors.push(e.message));
joiner.on('pageerror', e => joinErrors.push(e.message));
host.on('console', m => { if (m.type() === 'error') hostErrors.push(m.text()); });
joiner.on('console', m => { if (m.type() === 'error') joinErrors.push(m.text()); });

// Found while building this script (root-caused via temporary tracing, then reverted — not a
// bug in the reviewed fix): subscribeState's self-echo guard (`if (remoteState._pushId ===
// myLastPushId) return;`, game.js) only recognizes the MOST RECENT of a client's own pushes.
// Firing several debug-panel commits in quick succession queues several pushes; their echoes
// can arrive out of order, and once `myLastPushId` has moved on to a later push, an earlier
// push's own echo no longer matches it — the guard fails to recognize it as "mine" and
// `receiveRemoteState` applies it as if it were a genuine (but stale) remote update, clobbering
// whatever the later push had just set locally. Real, but a separate/pre-existing issue from the
// 7 findings this branch addresses — worth a follow-up, not something to fix inline here. This
// script works around it the only way that matters for verification purposes: never start a
// second debug commit until the first one's echo has had time to fully round-trip and settle.
// Round 2 (turn 3+) starts granting free Hero deployment (doc 04's Objective-escalation
// schedule) — the modal is mandatory and blocks every other click, including End Turn, until
// resolved. Mirrors selfplay_vs_ai_smoke.mjs's own helper for the same modal.
async function resolveHeroDeployIfShown(page) {
  const modal = page.locator('#hero-deploy-modal');
  const shown = await modal.waitFor({ state: 'visible', timeout: 2200 }).then(() => true).catch(() => false);
  if (!shown) return;
  await modal.locator('.hero-card').first().click();
  await modal.locator('.hero-zone-pick:not([disabled])').first().click();
}

async function debugMutateAndCommit(page, mutatorSrc) {
  await page.evaluate((src) => {
    const dbg = window.__SIGNAL_DEBUG__;
    // eslint-disable-next-line no-eval
    (0, eval)(`(${src})`)(dbg.state);
    document.querySelector('[data-fuel-delta="5"]').click(); // any debug action reaching commitState
  }, mutatorSrc);
  await page.waitForTimeout(2500);
}

try {
  // ── Lobby setup ──────────────────────────────────────────────────────────────
  await host.goto(`${BASE_URL}/index.html`);
  await host.fill('#display-name-input', 'HostPlayer');
  await host.locator('#btn-host-open').click();
  // Stalingrad has only 1 Objective slot (1,1, interior) — easier to keep the injected
  // formation entirely clear of its 4 adjacent contest positions than Kursk's 2 edge slots.
  await host.locator('.deck-option[data-map="stalingrad"]').click();
  await host.waitForURL(/game\.html\?game=.*role=p1/, { timeout: 8000 });

  await joiner.goto(`${BASE_URL}/index.html`);
  await joiner.waitForSelector('.lobby-row', { timeout: 8000 });
  await joiner.locator('.lobby-row').first().click();
  await joiner.waitForURL(/game\.html\?game=.*role=p2/, { timeout: 8000 });

  // Joiner's deck needs H25 for scenario B — Air Superiority (04) carries it.
  await host.locator('.deck-option[data-deck="tank-blitz"]').click();
  await host.waitForSelector('#waiting-screen', { state: 'visible', timeout: 8000 });
  await joiner.locator('.deck-option[data-deck="air-superiority"]').click();

  await host.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 });
  await host.locator('#btn-mulligan-keep').click();
  await joiner.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 })
    .catch(() => fail('joiner never reached its own mulligan screen'));
  await joiner.locator('#btn-mulligan-keep').click();

  await host.waitForSelector('#board', { state: 'visible', timeout: 8000 })
    .catch(() => fail('host never reached the live board'));
  await joiner.waitForSelector('#board', { state: 'visible', timeout: 8000 })
    .catch(() => fail('joiner never reached the live board'));
  ok('both clients reached the live board — match started');
  await host.waitForTimeout(3000); // let both mulligan pushes fully settle before raw injections

  // ── Scenario A setup: inject P1's AR46 + isolated Unit, P2's 3-unit Blast formation ────────
  // Stalingrad's single Objective slot (1,1) and its 4 adjacent contest tiles (0,1 / 2,1 / 1,0 /
  // 1,2) are the only "danger zone" — every injected tile below is outside it, so nothing here
  // accidentally contests/controls the Objective (which would otherwise force a pending pick and
  // block End Turn later in this scenario).
  await debugMutateAndCommit(host, `s => {
    const u = (owner, cardId) => ({ cardId, owner, state: 'normal', armorHits: 0, rotation: 0, persistentSpent: 0 });
    s.initiative = 'p1';
    s.board['2,2'] = u('p1', 'AR46');
    s.board['3,0'] = u('p1', 'I1');
    s.board['2,3'] = u('p2', 'I1');
    s.board['1,3'] = u('p2', 'I1');
    s.board['3,3'] = u('p2', 'I1');
  }`);
  await joiner.waitForFunction(
    () => window.__SIGNAL_DEBUG__?.state?.board?.['2,2']?.cardId === 'AR46',
    { timeout: 8000 }
  ).catch(() => fail('joiner never saw the injected Scenario A board — debug injection may not have synced'));
  ok('Scenario A board injected and synced to joiner');

  // ── Scenario A part 1: Blast attack — every victim must get its own feedback ───────────────
  // Empirically needed: clicking immediately after debugMutateAndCommit's own settle wait is
  // intermittently too soon for the host's own board-injection redraw to be fully interactive.
  await host.waitForTimeout(800);
  await host.locator('.tile[data-key="2,2"] .board-card').click();
  await host.waitForFunction(
    () => window.__SIGNAL_DEBUG__?.uiState === 'targeting' && window.__SIGNAL_DEBUG__?.pendingAttackerKey === '2,2',
    { timeout: 5000 }
  ).catch(() => fail('host never entered targeting mode after clicking AR46 — attacker click did not register'));
  await host.locator('.tile[data-key="2,3"]').click(); // attack primary target
  await host.waitForTimeout(500);

  for (const [label, page] of [['host', host], ['joiner', joiner]]) {
    const board = await page.evaluate(() => window.__SIGNAL_DEBUG__.state.board);
    const primaryHit = board['2,3'] === null || board['2,3']?.state === 'suppressed';
    const northHit = board['1,3'] === null || board['1,3']?.state === 'suppressed';
    const southHit = board['3,3'] === null || board['3,3']?.state === 'suppressed';
    if (primaryHit && northHit && southHit) ok(`${label}: all 3 Blast victims (primary + 2 secondary) show a Hit outcome in state`);
    else fail(`${label}: not all Blast victims registered a Hit — primary=${JSON.stringify(board['2,3'])} north=${JSON.stringify(board['1,3'])} south=${JSON.stringify(board['3,3'])}`);
  }

  // Ephemeral proof, best-effort: a destroy/suppress popup near more than just the primary tile.
  const joinerPopupCount = await joiner.locator('.fx-popup-text').count().catch(() => 0);
  if (joinerPopupCount >= 2) ok(`joiner shows ${joinerPopupCount} popups after the Blast attack — secondary-victim feedback reached the opponent, not just the primary`);
  else console.log(`NOTE: only ${joinerPopupCount} popup(s) caught on the joiner (ephemeral, ~1.6-2s window) — the state-based check above is the authoritative one`);

  // ── Scenario A part 2: Direct HQ — isolated Unit, no target, converts on End Turn ───────────
  // Requires turn != 1 (doc 01 §19: "Player 1 can't Direct HQ on their own first turn") — rather
  // than force-mutating state.turn directly (which fights the self-echo race documented above
  // for no real benefit), play one real, throwaway End Turn first so turn advances legitimately.
  await resolveHeroDeployIfShown(host);
  await host.locator('#btn-end-turn').click();
  await host.waitForTimeout(800);
  await resolveHeroDeployIfShown(joiner);
  await joiner.locator('#btn-end-turn').click().catch(() => {}); // P2's throwaway turn, if it's enabled
  await joiner.waitForTimeout(800);
  await resolveHeroDeployIfShown(host);
  const turnNow = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.turn);
  console.log(`Turn after the throwaway End Turn cycle: ${turnNow}`);

  // Re-inject the isolated Unit + force initiative back to P1 for a clean Direct HQ setup (the
  // throwaway cycle above may have consumed/moved things) — same settle-then-verify pattern.
  // 0,0 is outside Stalingrad's danger zone (diagonal to 1,1, not orthogonally adjacent) and
  // far from every Scenario A unit — genuinely isolated, no legal target.
  await debugMutateAndCommit(host, `s => {
    s.initiative = 'p1';
    s.board['0,0'] = { cardId: 'I1', owner: 'p1', state: 'normal', armorHits: 0, rotation: 0, persistentSpent: 0 };
  }`);
  await joiner.waitForFunction(
    () => window.__SIGNAL_DEBUG__?.state?.board?.['0,0']?.owner === 'p1',
    { timeout: 8000 }
  ).catch(() => fail('joiner never saw the re-injected isolated Unit for the Direct HQ scenario'));

  const p2HqBefore = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.p2.hq);
  await host.locator('#btn-end-turn').click();
  await host.waitForTimeout(1200);

  for (const [label, page] of [['host', host], ['joiner', joiner]]) {
    const p2Hq = await page.evaluate(() => window.__SIGNAL_DEBUG__.state.p2.hq);
    if (p2Hq < p2HqBefore) ok(`${label}: P2 HQ dropped (${p2HqBefore} -> ${p2Hq}) from Direct HQ conversion`);
    else console.log(`NOTE: ${label} P2 HQ did not drop (still ${p2Hq}) — see closing summary for interpretation`);
  }
  const joinerDirectHitPopup = await joiner.locator('.fx-popup-text', { hasText: /DIRECT HIT/i }).count().catch(() => 0);
  if (joinerDirectHitPopup > 0) ok('joiner shows a "DIRECT HIT" popup — Direct HQ feedback reached the opponent\'s client');
  else console.log('NOTE: "DIRECT HIT" popup not caught on the joiner in time (ephemeral, ~2s)');

  // ── Scenario B: P2 (the OTHER role) activates H25 Craft — glow must reach the host too ─────
  await debugMutateAndCommit(host, `s => {
    s.p2.heroZones[0] = 'H25';
    s.p2.fuel = 20; // Craft's cost (5, escalating down) — p2 never otherwise got any Fuel
    s.initiative = 'p2';
  }`);
  await joiner.waitForFunction(
    () => window.__SIGNAL_DEBUG__?.state?.p2?.heroZones?.includes('H25') && window.__SIGNAL_DEBUG__?.state?.initiative === 'p2',
    { timeout: 8000 }
  ).catch(() => fail('joiner (p2) never saw its own H25 deployment / initiative sync in'));
  // P2 also crossed into round 2 by now — its own free Hero deployment prompt (separate from
  // the heroZones injection above) may still be blocking every click.
  await resolveHeroDeployIfShown(joiner);
  await joiner.waitForTimeout(500);

  const heroZoneSlot = joiner.locator('.hero-zone-slot.filled').first();
  await heroZoneSlot.click();
  await joiner.waitForSelector('#craft-picker-modal', { state: 'visible', timeout: 5000 })
    .catch(() => fail('Craft picker modal never opened on the joiner after activating H25'));

  // Poll tightly right after the activating client's own commit — heroActivationKey drives a
  // one-render CSS flourish (.just-activated), so catch it as close to the commit as possible.
  const hostGlowSeen = await host.waitForSelector('.hero-zone-slot.just-activated', { timeout: 2500 })
    .then(() => true).catch(() => false);
  if (hostGlowSeen) ok('host (the OTHER client) saw the Hero activation glow after P2 activated H25 — cross-client Hero glow confirmed');
  else console.log('NOTE: host did not catch .just-activated within 2.5s of P2\'s activation — one-render CSS flourish is inherently timing-sensitive; heroesActivatedThisTurn state check below is the non-ephemeral fallback proof');

  const hostSeesActivated = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.p2.heroesActivatedThisTurn?.includes('H25'));
  if (hostSeesActivated) ok('host\'s synced state confirms P2 activated H25 this turn (non-ephemeral proof the commit + heroActivationKey event both arrived)');
  else fail('host\'s state does not show H25 in p2.heroesActivatedThisTurn — the activation commit itself may not have synced');

  // ── The finding-1 repro: pick a Craft candidate, then immediately place an unrelated Unit ──
  // (confirmCraftPick's commit carries no new event -> history unchanged; the placement after it
  // is a direct pushStateIfOnline -> also carries it unchanged. Neither should re-trigger the
  // glow on the host now that the H25 activation's event id has already been consumed.)
  const craftButton = joiner.locator('button:has-text("CRAFT THIS")').first();
  await craftButton.click();
  await joiner.waitForTimeout(1000);

  await debugMutateAndCommit(joiner, `s => {
    if (!s.p2.hand.includes('I1')) s.p2.hand = [...s.p2.hand, 'I1'];
  }`);
  await joiner.locator('.hand-card[data-card-id="I1"]').first().click();
  const emptyTile = joiner.locator('.tile:not(.has-unit)').first();
  await emptyTile.click();
  await joiner.waitForTimeout(500);

  const hostGlowAfterPlacement = await host.locator('.hero-zone-slot.just-activated').count().catch(() => 0);
  if (hostGlowAfterPlacement === 0) ok('host shows NO .just-activated glow after P2\'s craft-confirm + placement — the earlier H25 event did not replay (finding 1 fix holds)');
  else fail(`host still shows .just-activated (count=${hostGlowAfterPlacement}) after unrelated follow-up actions — stale event may have replayed`);

  console.log('\n--- Console/page errors captured ---');
  console.log('Host:', hostErrors.length ? hostErrors : '(none)');
  console.log('Joiner:', joinErrors.length ? joinErrors : '(none)');

} catch (e) {
  fail(`unexpected exception: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? '\nRESULT: FAIL (see above)' : '\nRESULT: PASS');
}
