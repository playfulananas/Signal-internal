// Focused regression tests for GPT's third-round review of fix/signal-gameplay-corrections,
// findings 1 (local self-consumption), 2 (batched multi-event playback), and 4 (tooltip
// hover-while-pinned). Solo browser, single local hot-seat game — no second client, no real
// Firebase-timing race to fight, because these scenarios are synthesized directly via
// window.__SIGNAL_TEST_HOOKS__.receiveRemoteState (a debug-only hook, see game.js — same
// no-gameplay-effect contract as window.__SIGNAL_DEBUG__, added specifically so these exact
// internal-logic scenarios could be tested deterministically instead of choreographing precise
// real-network timing across two live clients for every one of them).
//
// Run with the dev server already up: node event_consumption_regression_test.mjs
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
let failed = false;
function fail(msg) { console.error(`FAIL: ${msg}`); failed = true; }
function ok(msg) { console.log(`OK: ${msg}`); }

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
        heroZone: el.dataset?.heroZone ?? null,
        cls: el.className,
        text: (el.textContent || '').slice(0, 60),
        t: Date.now(),
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

async function receiveSynthetic(page, snapshotBuilderSrc, opts = {}) {
  return page.evaluate(({ src, opts }) => {
    const hooks = window.__SIGNAL_TEST_HOOKS__;
    const current = hooks.getState();
    // eslint-disable-next-line no-eval
    const snapshot = (0, eval)(`(${src})`)(current);
    hooks.receiveRemoteState(snapshot, opts);
  }, { src: snapshotBuilderSrc, opts });
}

let eventCounter = 0;
function nextTestEventId() { eventCounter += 1; return `synthtest-${eventCounter}`; }

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

try {
  // ── Startup: local hot-seat game (map -> P1 deck -> P2 deck -> both mulligans) ─────────────
  await page.goto(`${BASE_URL}/game.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#map-grid .deck-option[data-map="kursk"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('#map-grid .deck-option[data-map="kursk"]').click();
  await page.locator('#deck-picker').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#deck-grid .deck-option').first().click();
  await page.waitForTimeout(150);
  await page.locator('#deck-grid .deck-option').first().click();
  await page.locator('#mulligan-screen').waitFor({ state: 'visible', timeout: 5000 });

  // ── Test 5 (finding 4) runs HERE, on the Mulligan screen, the only reliable place
  //    [data-tip-tap] pips exist (never present on the normal in-turn hand/board). Must run
  //    before confirming mulligan, or the pips are gone for the rest of the script. Retries
  //    across both mulligan hands (a card-choice screen only shows pips on cards that actually
  //    have a keyword/ability, so an unlucky hand can have none).
  async function findTwoTappablePips() {
    const pips = page.locator('#mulligan-hand [data-tip-tap]');
    const count = await pips.count();
    if (count < 2) return null;
    return { a: pips.nth(0), b: pips.nth(1) };
  }
  let pipPair = await findTwoTappablePips();
  if (!pipPair) {
    await page.locator('#btn-mulligan-keep').click();
    const shown2early = await page.locator('#mulligan-screen').waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    if (shown2early) pipPair = await findTwoTappablePips();
  }
  if (pipPair) {
    await pipPair.a.click();
    const pinnedText = await page.locator('#floating-tip').innerText();
    await pipPair.b.hover();
    const hoveredText = await page.locator('#floating-tip').innerText();
    if (hoveredText === pinnedText) {
      fail('Test 5 INCONCLUSIVE: the two pips happened to have identical tip text — cannot distinguish which is shown, rerun for a different hand');
    } else {
      await page.mouse.move(10, 10); // leave the hovered (non-pinned) pip B
      await page.waitForTimeout(150);
      const restoredText = await page.locator('#floating-tip').innerText();
      const stillVisible = await page.locator('#floating-tip').evaluate(el => el.style.display === 'block');
      if (stillVisible && restoredText === pinnedText) {
        ok('Test 5 PASS: pin A -> hover B -> leave B restored the PINNED pip\'s own content, not left showing B\'s stale text');
      } else {
        fail(`Test 5 FAIL: after leaving the hovered pip, expected the pin's own text ("${pinnedText}") restored and visible, got visible=${stillVisible} text="${restoredText}"`);
      }
    }
  } else {
    fail('Test 5 SETUP: neither mulligan hand had 2+ cards with a [data-tip-tap] pip — unlucky draw, rerun the script');
  }

  // Finish the startup flow (whichever mulligan screen(s) are still pending).
  const stillOnMulligan = await page.locator('#mulligan-screen').isVisible().catch(() => false);
  if (stillOnMulligan) {
    await page.locator('#btn-mulligan-keep').click();
    const shown2 = await page.locator('#mulligan-screen').waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    if (shown2) await page.locator('#btn-mulligan-keep').click();
  }
  await page.locator('#game-area').waitFor({ state: 'visible', timeout: 5000 });
  ok('local hot-seat match started');

  // Confirm the test hooks are actually present before relying on them for everything below.
  const hooksPresent = await page.evaluate(() => typeof window.__SIGNAL_TEST_HOOKS__?.receiveRemoteState === 'function');
  if (!hooksPresent) throw new Error('window.__SIGNAL_TEST_HOOKS__.receiveRemoteState is not present — cannot run synthetic-event tests');

  // ── Test 1: Duplicate delivery — the same event, delivered twice, plays exactly once ───────
  // Note on scope: this exercises receiveRemoteState's OWN dedup loop, which already existed
  // going into this round (it was never the bug) — kept as a baseline idempotency check, not a
  // claim that it alone proves finding 1's fix. Finding 1 was specifically about the ACTING
  // client's commitState never marking its own locally-played event consumed, so a LATER
  // opponent-originated delivery carrying that same id forward would replay it — that exact
  // path requires a real commitState call plus a real subsequent receiveRemoteState from another
  // source, which is what multiplayer_review2_animation_test.mjs's "host (the ACTOR) observed
  // its own Blast-attack flourish exactly once" and "exactly once across the whole sequence"
  // checks verify end-to-end, live, two real clients. That live test is the authoritative proof
  // for finding 1; this one is a related but distinct correctness property.
  await armObserver(page, 't1Glow', '.hero-zone-slot.just-activated');
  await receiveSynthetic(page, `s => {
    const heroId = s.p1.heroRoster?.[0];
    const ev = { id: '${nextTestEventId()}', heroActivationKey: 'p1-0' };
    return {
      ...s,
      p1: { ...s.p1, heroZones: [heroId, ...(s.p1.heroZones ?? [null,null,null,null]).slice(1)] },
      _revision: (s._revision ?? 0) + 1,
      _eventHistory: [...(s._eventHistory ?? []), ev],
    };
  }`);
  await page.waitForTimeout(300);
  const afterFirst = await readObserver(page, 't1Glow');
  // Deliver the EXACT SAME snapshot again (same _revision, same event id) — simulates Firebase's
  // local-cache-then-server-ack redelivering an already-applied write.
  const snapshotNow = await page.evaluate(() => window.__SIGNAL_TEST_HOOKS__.getState());
  await page.evaluate((snap) => window.__SIGNAL_TEST_HOOKS__.receiveRemoteState(snap), snapshotNow);
  await page.waitForTimeout(300);
  const afterDuplicate = await readObserver(page, 't1Glow');
  if (afterFirst.count === 1 && afterDuplicate.count === 1) {
    ok('Test 1 PASS: duplicate delivery of the same event played the glow exactly once (not twice)');
  } else {
    fail(`Test 1 FAIL: expected count 1 then still 1, got ${afterFirst.count} then ${afterDuplicate.count}`);
  }

  // ── Test 2: Event-free delivery (placement/Cancel style) — state changes, no new event ─────
  // Simulates the audited-safe direct pushStateIfOnline paths (placement's early returns,
  // Cancel restoring preCommandState): _eventHistory carried forward UNCHANGED, board changes.
  await receiveSynthetic(page, `s => ({
    ...s,
    board: { ...s.board, '3,3': { cardId: 'I1', owner: 'p1', state: 'normal', armorHits: 0, rotation: 0, persistentSpent: 0, instanceId: 'synth-placed-1' } },
    _revision: (s._revision ?? 0) + 1,
    // _eventHistory deliberately omitted — inherits nothing new, same array reference concept as
    // the real direct-push paths (here just literally not present, which the receiver treats as
    // "no fresh events" all the same).
  })`);
  await page.waitForTimeout(300);
  const afterEventFree = await readObserver(page, 't1Glow');
  const boardAfterEventFree = await page.evaluate(() => window.__SIGNAL_TEST_HOOKS__.getState().board['3,3']);
  if (afterEventFree.count === 1 && boardAfterEventFree?.instanceId === 'synth-placed-1') {
    ok('Test 2 PASS: event-free state change applied (board updated) without triggering any animation replay');
  } else {
    fail(`Test 2 FAIL: glow count ${afterEventFree.count} (expected still 1) or board not updated: ${JSON.stringify(boardAfterEventFree)}`);
  }

  // ── Test 3: Recovery snapshot (force) suppresses playback; next genuine action resumes it ──
  await armObserver(page, 't3GlowZone1', '.hero-zone-slot.just-activated[data-hero-zone="p1-1"]');
  await receiveSynthetic(page, `s => {
    const heroId = s.p1.heroRoster?.[1] ?? s.p1.heroRoster?.[0];
    const ev = { id: '${nextTestEventId()}', heroActivationKey: 'p1-1' };
    const zones = [...(s.p1.heroZones ?? [null,null,null,null])];
    zones[1] = heroId;
    return { ...s, p1: { ...s.p1, heroZones: zones }, _revision: (s._revision ?? 0) + 1, _eventHistory: [...(s._eventHistory ?? []), ev] };
  }`, { force: true });
  await page.waitForTimeout(600);
  const afterRecovery = await readObserver(page, 't3GlowZone1');
  if (afterRecovery.count === 0) ok('Test 3a PASS: forced recovery delivery did not play its event\'s animation');
  else fail(`Test 3a FAIL: recovery delivery played the glow ${afterRecovery.count} time(s), expected 0`);

  // Now a genuine (non-forced) NEW event, on a different zone — normal playback should resume.
  await armObserver(page, 't3GlowZone2', '.hero-zone-slot.just-activated[data-hero-zone="p1-2"]');
  await receiveSynthetic(page, `s => {
    const heroId = s.p1.heroRoster?.[2] ?? s.p1.heroRoster?.[0];
    const ev = { id: '${nextTestEventId()}', heroActivationKey: 'p1-2' };
    const zones = [...(s.p1.heroZones ?? [null,null,null,null])];
    zones[2] = heroId;
    return { ...s, p1: { ...s.p1, heroZones: zones }, _revision: (s._revision ?? 0) + 1, _eventHistory: [...(s._eventHistory ?? []), ev] };
  }`);
  await page.waitForTimeout(600);
  const afterGenuine = await readObserver(page, 't3GlowZone2');
  const zone1StillZero = (await readObserver(page, 't3GlowZone1')).count;
  if (afterGenuine.count === 1 && zone1StillZero === 0) {
    ok('Test 3b PASS: the next genuine event after a recovery delivery played normally, and the earlier recovery-suppressed event never played retroactively');
  } else {
    fail(`Test 3b FAIL: genuine-event count ${afterGenuine.count} (expected 1), recovery zone count ${zone1StillZero} (expected still 0)`);
  }

  // ── Test 4: Coalesced delivery — 2 Hero activations + a suppress-then-causality-pulse
  //    same-tile sequence, all in ONE delivery. Every intended effect must play once, in
  //    order. ─────────────────────────────────────────────────────────────────────────────────
  // The unit stays alive across both tile events deliberately — a 'destroyed' flourish lives on
  // the TILE itself (renders regardless of occupancy), but 'suppressed'/'causality-source' both
  // live on the .board-card (see ui.js), which only exists in the DOM while a live unit occupies
  // that tile. A single shared final `state.board` per delivery (never re-simulated mid-sequence
  // — see computeDisplayFlags' doc comment on why that's a deliberate boundary, not a gap: this
  // fix threads the SAME instanceId through a real render pass, it does not fabricate one) means
  // an earlier same-tile event whose own unit has been destroyed by a LATER event in the same
  // batch has nothing left to render on by the time its turn comes — this pairing (unit survives
  // to the end) is the one that's both realistic and renderable, and is what's tested here.
  // Real unit with a real instanceId first, so tileUnitSnapshot comparisons are meaningful.
  await receiveSynthetic(page, `s => ({
    ...s,
    board: { ...s.board, '0,0': { cardId: 'I1', owner: 'p1', state: 'normal', armorHits: 0, rotation: 0, persistentSpent: 0, instanceId: 'synth-victim-1' } },
    _revision: (s._revision ?? 0) + 1,
  })`);
  await page.waitForTimeout(300);

  await armObserver(page, 't4Glow', '.hero-zone-slot.just-activated');
  await armObserver(page, 't4Tile', '.board-card.just-suppressed, .board-card.fx-flash-positive');

  await receiveSynthetic(page, `s => {
    const heroId0 = s.p1.heroRoster?.[0];
    const heroId3 = s.p1.heroRoster?.[3] ?? s.p1.heroRoster?.[0];
    const zones = [...(s.p1.heroZones ?? [null,null,null,null])];
    zones[0] = heroId0; zones[3] = heroId3;
    const evA = { id: '${nextTestEventId()}', heroActivationKey: 'p1-0' };
    const evB = { id: '${nextTestEventId()}', heroActivationKey: 'p1-3', transitionFlags: { '0,0': 'suppressed' }, tileUnitSnapshot: { '0,0': 'synth-victim-1' } };
    const evC = { id: '${nextTestEventId()}', transitionFlags: { '0,0': 'causality-source' }, tileUnitSnapshot: { '0,0': 'synth-victim-1' } };
    return {
      ...s,
      p1: { ...s.p1, heroZones: zones },
      // Final truth: the SAME unit is still there (still suppressed) — only its transitionFlags
      // treatment changed across the two events, not its actual board presence.
      board: { ...s.board, '0,0': { cardId: 'I1', owner: 'p1', state: 'suppressed', armorHits: 0, rotation: 0, persistentSpent: 0, instanceId: 'synth-victim-1' } },
      _revision: (s._revision ?? 0) + 1,
      _eventHistory: [...(s._eventHistory ?? []), evA, evB, evC],
    };
  }`);
  // 3 events staggered 600ms apart (see receiveRemoteState) — generous margin past the last one.
  await page.waitForTimeout(2600);

  const glowObs = await readObserver(page, 't4Glow');
  const glowZones = new Set(glowObs.details.map(d => d.heroZone).filter(Boolean));
  if (glowZones.has('p1-0') && glowZones.has('p1-3')) {
    ok(`Test 4a PASS: BOTH distinct Hero activations in the coalesced batch showed their glow (zones: ${[...glowZones].join(', ')}) — neither was lost to a merge`);
  } else {
    fail(`Test 4a FAIL: expected glows for both p1-0 and p1-3, observed zones [${[...glowZones].join(', ')}], raw: ${JSON.stringify(glowObs)}`);
  }

  const tileObs = await readObserver(page, 't4Tile');
  const suppressIdx = tileObs.details.findIndex(d => d.cls?.includes('just-suppressed'));
  const causalityIdx = tileObs.details.findIndex(d => d.cls?.includes('fx-flash-positive'));
  if (suppressIdx !== -1 && causalityIdx !== -1 && suppressIdx < causalityIdx) {
    ok('Test 4b PASS: the same tile\'s two conflicting transitionFlags (suppressed, then causality-source) both played, in the correct order, instead of the second silently overwriting the first');
  } else {
    fail(`Test 4b FAIL: expected both a just-suppressed and a later fx-flash-positive sighting on tile 0,0, got suppressIdx=${suppressIdx} causalityIdx=${causalityIdx}, raw: ${JSON.stringify(tileObs)}`);
  }

  console.log(`\nPage errors: ${pageErrors.length}`);
  pageErrors.forEach(e => console.log('  ' + e));
  if (pageErrors.length > 0) failed = true;

} catch (e) {
  fail(`unexpected exception: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? '\nRESULT: FAIL (see above)' : '\nRESULT: PASS');
}
