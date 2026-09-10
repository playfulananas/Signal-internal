// Live 2-client verification for GPT's second-round review of fix/signal-gameplay-corrections.
// Specifically targets what GPT's own review could NOT live-test (its cloud browser hit
// ERR_BLOCKED_BY_CLIENT against the local build): Direct HQ flash/connector and Hero activation
// glow reaching the OPPONENT'S client, the new per-victim Blast feedback, and the Hero-activate
// -> placement no-repeat-event fix.
//
// GPT's third-round review of that first version flagged that its own pass/fail signal was
// mostly NOTE-only soft logging — it could report RESULT: PASS without ever having actually
// observed the animation it claimed to check. Rewritten around MutationObserver-based recorders
// (armObserver/readObserver below), armed on the page BEFORE the triggering action and read back
// afterward, so a class or popup that appears and is gone again before the script gets around to
// checking is still counted — a later redraw cannot un-observe it. Every animation check below is
// now a hard fail() if it was never observed, not a console NOTE. setupFail() is used separately
// for rig/sync problems (a selector that didn't appear, a debug injection that didn't sync) so a
// broken test script can't be misread as a broken fix, and vice versa.
//
// Mirrors multiplayer_craft_test.mjs's lobby-setup/debug-panel-injection pattern. One match, two
// scenarios, alternating which role is the actor so both get covered:
//   A. P1 (host) attacks with AR46 (Blast) into a 3-unit formation, then ends the turn with a
//      separate isolated Unit converting to Direct HQ damage. Checked on BOTH clients.
//   B. P2 (joiner) activates H25 Chief Aircraft Engineer's Craft power. Checked on BOTH clients,
//      then immediately followed by P2 placing an unrelated Unit from hand (the exact
//      Hero-activate -> placement sequence finding 1 was about) to confirm the glow does not
//      re-fire on that second delivery — checked by reading the SAME observer's count at the end
//      of the whole sequence (armed once, before activation) rather than a separate spot-check.
//
// Requires the dev server (npm run dev) and hits the live Firebase project — same caveats as
// every other multiplayer_*_test.mjs. Run with: node multiplayer_review2_animation_test.mjs
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
let setupFailed = false;
let assertFailed = false;
function setupFail(msg) { console.error(`SETUP FAIL: ${msg}`); setupFailed = true; }
function fail(msg) { console.error(`ASSERTION FAIL: ${msg}`); assertFailed = true; }
function ok(msg) { console.log(`OK: ${msg}`); }

// ── Animation observers — armed on the page before the action, read back after ────────────────
// Watches for elements matching `selector` being added to the DOM (covers both a full innerHTML
// rebuild, which is how this codebase normally re-renders, and a direct classList/appendChild
// call, which is how the FxConnector/FxPopup primitives work) OR gaining `selector` via a class
// attribute change on an existing node (defensive — covers either rendering strategy). Records
// each sighting's tile key (via the nearest .tile ancestor, when there is one) and a text snippet
// so assertions can check not just "did it fire" but "did it fire for the right tile(s)".
async function armObserver(page, key, selector, { textMatch } = {}) {
  await page.evaluate(({ key, selector, textMatch }) => {
    window.__obs__ = window.__obs__ || {};
    const rec = { count: 0, details: [] };
    window.__obs__[key] = rec;
    const record = el => {
      if (textMatch && !(new RegExp(textMatch, 'i')).test(el.textContent || '')) return;
      rec.count++;
      rec.details.push({
        tileKey: el.closest?.('.tile')?.dataset?.key ?? null,
        text: (el.textContent || '').slice(0, 60),
      });
    };
    const scanSubtree = node => {
      if (node.nodeType !== 1) return;
      if (node.matches?.(selector)) record(node);
      node.querySelectorAll?.(selector).forEach(record);
    };
    const mo = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) scanSubtree(n);
        } else if (m.type === 'attributes' && m.target.nodeType === 1 && m.target.matches?.(selector)) {
          record(m.target);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    (window.__obs_handles__ = window.__obs_handles__ || {})[key] = mo;
  }, { key, selector, textMatch: textMatch ?? null });
}

async function readObserver(page, key) {
  return page.evaluate((k) => window.__obs__?.[k] ?? { count: 0, details: [] }, key);
}

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

// Found while building the first version of this script (root-caused via temporary tracing, then
// reverted — not a bug in the reviewed fix, a separate pre-existing one, see CHANGELOG.md):
// subscribeState's self-echo guard (`if (remoteState._pushId === myLastPushId) return;`, game.js)
// only recognizes the MOST RECENT of a client's own pushes. Firing several debug-panel commits in
// quick succession queues several pushes; their echoes can arrive out of order, and once
// `myLastPushId` has moved on to a later push, an earlier push's own echo no longer matches it —
// the guard fails to recognize it as "mine" and `receiveRemoteState` applies it as if it were a
// genuine (but stale) remote update, clobbering whatever the later push had just set locally.
// This script works around it the only way that matters for verification purposes: never start a
// second debug commit until the first one's echo has had time to fully round-trip and settle.
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
  await host.waitForURL(/game\.html\?game=.*role=p1/, { timeout: 8000 })
    .catch(() => setupFail('host never reached game.html as p1'));

  await joiner.goto(`${BASE_URL}/index.html`);
  await joiner.waitForSelector('.lobby-row', { timeout: 8000 }).catch(() => setupFail('joiner never saw the host\'s lobby row'));
  await joiner.locator('.lobby-row').first().click();
  await joiner.waitForURL(/game\.html\?game=.*role=p2/, { timeout: 8000 })
    .catch(() => setupFail('joiner never reached game.html as p2'));

  // Joiner's deck needs H25 for scenario B — Air Superiority (04) carries it.
  await host.locator('.deck-option[data-deck="tank-blitz"]').click();
  await host.waitForSelector('#waiting-screen', { state: 'visible', timeout: 8000 }).catch(() => setupFail('host never reached the waiting screen'));
  await joiner.locator('.deck-option[data-deck="air-superiority"]').click();

  await host.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 })
    .catch(() => setupFail('host never reached mulligan'));
  await host.locator('#btn-mulligan-keep').click();
  await joiner.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 })
    .catch(() => setupFail('joiner never reached its own mulligan screen'));
  await joiner.locator('#btn-mulligan-keep').click();

  await host.waitForSelector('#board', { state: 'visible', timeout: 8000 })
    .catch(() => setupFail('host never reached the live board'));
  await joiner.waitForSelector('#board', { state: 'visible', timeout: 8000 })
    .catch(() => setupFail('joiner never reached the live board'));
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
  ).catch(() => setupFail('joiner never saw the injected Scenario A board — debug injection may not have synced'));
  ok('Scenario A board injected and synced to joiner');

  // ── Scenario A part 1: Blast attack — every victim must get its own OBSERVED feedback ──────
  // Arm on the JOINER (the opponent's client — the whole point is proving it reaches them, not
  // just the acting host) before the attack, watching for the suppression flourish
  // (.board-card.just-suppressed) or the destroy flourish (.tile.tile-just-destroyed) — every
  // injected P2 victim here is a vanilla Rifle Squad with no Armor, so a single Hit suppresses
  // it (no destroy), but both classes are watched in case timing/order ever changes that.
  await armObserver(joiner, 'blastVictims', '.board-card.just-suppressed, .tile.tile-just-destroyed');
  await armObserver(joiner, 'blastPopups', '.fx-popup-text');
  // ALSO armed on the HOST (the actor) itself — GPT's review, finding 1: "the existing
  // opponent-only no-replay test does not cover the ACTING client receiving its own event
  // back." Read only at the very end of the whole script (see the bottom), after every
  // subsequent action (End Turns, H25 activation, craft-confirm, placement) has had a chance to
  // deliver an opponent update carrying this event's id back to the host — if the local
  // self-consumption fix (commitState's markEventConsumed call) didn't hold, host's own count
  // for these 3 tiles would exceed 3 (one legitimate local firing each, from playing its own
  // action, plus at least one illegitimate replay).
  await armObserver(host, 'hostBlastVictims', '.board-card.just-suppressed, .tile.tile-just-destroyed');

  // Empirically needed: clicking immediately after debugMutateAndCommit's own settle wait is
  // intermittently too soon for the host's own board-injection redraw to be fully interactive —
  // this is the same pre-existing Firebase-timing flakiness documented above (self-echo races),
  // not something this test can fully eliminate; retry a few times rather than fail outright on
  // what's usually just a slow settle.
  await host.waitForTimeout(1500);
  let enteredTargeting = false;
  for (let attempt = 0; attempt < 4 && !enteredTargeting; attempt++) {
    await host.locator('.tile[data-key="2,2"] .board-card').click().catch(() => {});
    enteredTargeting = await host.waitForFunction(
      () => window.__SIGNAL_DEBUG__?.uiState === 'targeting' && window.__SIGNAL_DEBUG__?.pendingAttackerKey === '2,2',
      { timeout: 3000 }
    ).then(() => true).catch(() => false);
    if (!enteredTargeting) await host.waitForTimeout(1000);
  }
  if (!enteredTargeting) setupFail('host never entered targeting mode after clicking AR46 — attacker click did not register after 4 attempts');
  await host.locator('.tile[data-key="2,3"]').click(); // attack primary target
  await host.waitForTimeout(1200); // flourish is 0.3-0.5s (game.css) — generous margin before reading

  for (const [label, page] of [['host', host], ['joiner', joiner]]) {
    const board = await page.evaluate(() => window.__SIGNAL_DEBUG__.state.board);
    const primaryHit = board['2,3'] === null || board['2,3']?.state === 'suppressed';
    const northHit = board['1,3'] === null || board['1,3']?.state === 'suppressed';
    const southHit = board['3,3'] === null || board['3,3']?.state === 'suppressed';
    if (primaryHit && northHit && southHit) ok(`${label}: all 3 Blast victims (primary + 2 secondary) show a Hit outcome in state`);
    else fail(`${label}: not all Blast victims registered a Hit — primary=${JSON.stringify(board['2,3'])} north=${JSON.stringify(board['1,3'])} south=${JSON.stringify(board['3,3'])}`);
  }

  const blastVictimObs = await readObserver(joiner, 'blastVictims');
  const blastVictimTiles = new Set(blastVictimObs.details.map(d => d.tileKey).filter(Boolean));
  const expectedVictimTiles = ['2,3', '1,3', '3,3'];
  const sawAllThree = expectedVictimTiles.every(k => blastVictimTiles.has(k));
  if (sawAllThree) ok(`joiner OBSERVED the suppression/destroy flourish on all 3 victim tiles (${[...blastVictimTiles].join(', ')}) — secondary-victim feedback confirmed reaching the opponent, not just gameplay state`);
  else fail(`joiner did not observe the flourish on all 3 expected tiles — saw tiles [${[...blastVictimTiles].join(', ')}], expected [${expectedVictimTiles.join(', ')}], raw observer: ${JSON.stringify(blastVictimObs)}`);

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
  ).catch(() => setupFail('joiner never saw the re-injected isolated Unit for the Direct HQ scenario'));

  // Arm BEFORE End Turn — both the result popup and the source->HQ connector line.
  await armObserver(joiner, 'directHitPopup', '.fx-popup-text', { textMatch: 'DIRECT HIT' });
  await armObserver(joiner, 'directHqConnector', '#fx-connector-svg line.fx-connector-line');

  const p2HqBefore = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.p2.hq);
  await host.locator('#btn-end-turn').click();
  await host.waitForTimeout(1200);

  for (const [label, page] of [['host', host], ['joiner', joiner]]) {
    const p2Hq = await page.evaluate(() => window.__SIGNAL_DEBUG__.state.p2.hq);
    if (p2Hq < p2HqBefore) ok(`${label}: P2 HQ dropped (${p2HqBefore} -> ${p2Hq}) from Direct HQ conversion`);
    else fail(`${label}: P2 HQ did not drop from Direct HQ — expected < ${p2HqBefore}, got ${p2Hq}`);
  }
  const directHitObs = await readObserver(joiner, 'directHitPopup');
  if (directHitObs.count > 0) ok('joiner OBSERVED a "DIRECT HIT" popup — Direct HQ popup confirmed reaching the opponent\'s client');
  else fail(`joiner never observed a "DIRECT HIT" popup — Direct HQ damage synced (state check above) but its animation did not reach the opponent`);
  const connectorObs = await readObserver(joiner, 'directHqConnector');
  if (connectorObs.count > 0) ok('joiner OBSERVED the Direct HQ source->HQ connector line — confirmed reaching the opponent\'s client, not just the popup');
  else fail('joiner never observed the Direct HQ connector line (#fx-connector-svg line.fx-connector-line)');

  // ── Scenario B: P2 (the OTHER role) activates H25 Craft — glow must reach the host too ─────
  // heroGlow is armed ONCE, right before P2's activation, and read only at the very end of this
  // whole scenario (after craft-confirm + placement) — the exact GPT-review requirement: prove
  // it fired exactly once (during activation), not "seen at some point" and separately "absent
  // at some later point", which a race between the two checks could paper over.
  await armObserver(host, 'heroGlow', '.hero-zone-slot.just-activated');

  await debugMutateAndCommit(host, `s => {
    s.p2.heroZones[0] = 'H25';
    s.p2.fuel = 20; // Craft's cost (5, escalating down) — p2 never otherwise got any Fuel
    s.initiative = 'p2';
  }`);
  await joiner.waitForFunction(
    () => window.__SIGNAL_DEBUG__?.state?.p2?.heroZones?.includes('H25') && window.__SIGNAL_DEBUG__?.state?.initiative === 'p2',
    { timeout: 8000 }
  ).catch(() => setupFail('joiner (p2) never saw its own H25 deployment / initiative sync in'));
  // P2 also crossed into round 2 by now — its own free Hero deployment prompt (separate from
  // the heroZones injection above) may still be blocking every click.
  await resolveHeroDeployIfShown(joiner);
  await joiner.waitForTimeout(500);

  const heroZoneSlot = joiner.locator('.hero-zone-slot.filled').first();
  await heroZoneSlot.click();
  await joiner.waitForSelector('#craft-picker-modal', { state: 'visible', timeout: 5000 })
    .catch(() => setupFail('Craft picker modal never opened on the joiner after activating H25'));
  await host.waitForTimeout(1200); // let the activation's redraw + flourish actually land on host

  const hostSeesActivated = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.p2.heroesActivatedThisTurn?.includes('H25'));
  if (hostSeesActivated) ok('host\'s synced state confirms P2 activated H25 this turn (gameplay-state proof — separate from the animation proof below, does not substitute for it)');
  else fail('host\'s state does not show H25 in p2.heroesActivatedThisTurn — the activation commit itself may not have synced');

  // ── The finding-1 repro: pick a Craft candidate, then immediately place an unrelated Unit ──
  // (confirmCraftPick's commit carries no new event -> history unchanged; the placement after it
  // is a direct pushStateIfOnline -> also carries it unchanged. Neither should re-trigger the
  // glow on the host now that the H25 activation's event id was marked consumed the moment P2's
  // OWN client played it locally — see commitState's markEventConsumed call.)
  const craftButton = joiner.locator('button:has-text("CRAFT THIS")').first();
  await craftButton.click();
  await joiner.waitForTimeout(1000);

  await debugMutateAndCommit(joiner, `s => {
    if (!s.p2.hand.includes('I1')) s.p2.hand = [...s.p2.hand, 'I1'];
  }`);
  await joiner.locator('.hand-card[data-card-id="I1"]').first().click();
  const emptyTile = joiner.locator('.tile:not(.has-unit)').first();
  await emptyTile.click();
  await joiner.waitForTimeout(1200);

  const heroGlowObs = await readObserver(host, 'heroGlow');
  if (heroGlowObs.count === 1) ok('host OBSERVED the Hero activation glow exactly once across the whole sequence (activation, then craft-confirm + placement) — cross-client glow confirmed AND no replay (finding 1 fix holds)');
  else if (heroGlowObs.count === 0) fail('host never observed the Hero activation glow at all — cross-client Hero glow did not reach the opponent');
  else fail(`host observed the Hero activation glow ${heroGlowObs.count} times (expected exactly 1) — it replayed after the craft-confirm/placement follow-up`);

  // GPT review, finding 1: the acting client's OWN event, read at the very end of the script —
  // after End Turn (twice), the Direct HQ re-injection, H25's activation, craft-confirm, and the
  // final placement have all had a chance to deliver an opponent update carrying this event's id
  // back to host. Exactly 3 (one legitimate local firing per victim tile) proves host's own
  // Blast-attack event never replayed on itself.
  const hostBlastObs = await readObserver(host, 'hostBlastVictims');
  const hostBlastTiles = new Set(hostBlastObs.details.map(d => d.tileKey).filter(Boolean));
  if (hostBlastObs.count === 3 && expectedVictimTiles.every(k => hostBlastTiles.has(k))) {
    ok('host (the ACTOR) observed its own Blast-attack flourish exactly once per victim tile across the whole remaining script — its own event did not replay on itself after later receiving opponent updates (finding 1\'s acting-client gap fixed)');
  } else {
    fail(`host observed its own Blast-attack flourish ${hostBlastObs.count} times across tiles [${[...hostBlastTiles].join(', ')}] (expected exactly 3, one per victim tile [${expectedVictimTiles.join(', ')}]) — its own event may have replayed on itself: ${JSON.stringify(hostBlastObs)}`);
  }

  console.log('\n--- Console/page errors captured ---');
  console.log('Host:', hostErrors.length ? hostErrors : '(none)');
  console.log('Joiner:', joinErrors.length ? joinErrors : '(none)');

} catch (e) {
  setupFail(`unexpected exception: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
  if (setupFailed) {
    console.log('\nRESULT: SETUP FAILURE (see SETUP FAIL lines above) — the test rig itself broke before fully exercising its assertions; this is not evidence the fix is broken, but also not evidence it works. Re-run.');
    process.exitCode = 2;
  } else if (assertFailed) {
    console.log('\nRESULT: FAIL (see ASSERTION FAIL lines above)');
    process.exitCode = 1;
  } else {
    console.log('\nRESULT: PASS');
    process.exitCode = 0;
  }
}
