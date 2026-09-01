// Multiplayer test plan follow-up, 2026-09-01: verifies the doc 04 §1 map-before-deck fix for
// the code-share lobby flow (P1 direct-code-join). Before this fix, P1 saw Deck picker then Map
// picker (wrong order); now P1 must see Map first, then Deck — same order local/AI mode and the
// open-lobby flow already use. Also confirms P2 still never gets an interactive map-picker (one
// player picks, not two) but now sees the map's name during their own deck pick, read-only.
// Run with: node multiplayer_codeshare_order_test.mjs (dev server must be running).
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

try {
  // ── Host: code-share create ─────────────────────────────────────────────────
  await host.goto(`${BASE_URL}/index.html`);
  await host.locator('#btn-create').click();
  const code = await host.locator('#game-code-display').textContent();
  await host.locator('#btn-enter-game').click();
  await host.waitForURL(/game\.html\?game=.*role=p1/, { timeout: 8000 });

  // The actual fix: map-picker must be the FIRST thing P1 sees, deck-picker hidden.
  const mapPickerVisible = await host.locator('#map-picker').isVisible();
  const deckPickerVisible = await host.locator('#deck-picker').isVisible();
  if (!mapPickerVisible) fail('P1 (code-share) did not start on the map-picker — doc 04 §1 order not fixed');
  else ok('P1 (code-share) starts on the map-picker, not the deck-picker');
  if (deckPickerVisible) fail('P1 (code-share) deck-picker is visible at the same time as the map-picker — should be hidden until a map is chosen');

  await host.locator('.deck-option[data-map="ardennes"]').click();

  // After picking a map, P1 should now see the deck-picker (map-picker hidden).
  await host.waitForSelector('#deck-picker', { state: 'visible', timeout: 5000 })
    .catch(() => fail('P1 never reached the deck-picker after choosing a map'));
  const mapPickerHiddenAfter = await host.locator('#map-picker').isHidden();
  if (!mapPickerHiddenAfter) fail('P1 map-picker still visible after choosing a map');
  else ok('P1 correctly moved from map-picker to deck-picker after choosing Ardennes');

  await host.locator('.deck-option[data-deck="infantry-formation"]').click();
  await host.waitForSelector('#waiting-screen', { state: 'visible', timeout: 8000 })
    .catch(() => fail('P1 never reached the waiting screen after picking a deck'));
  ok('P1 reached the waiting screen after map-then-deck');

  // ── Joiner: code-share join ──────────────────────────────────────────────────
  await joiner.goto(`${BASE_URL}/index.html`);
  await joiner.locator('#btn-join-option').click();
  await joiner.locator('#code-input').fill(code ?? '');
  await joiner.locator('#btn-join').click();
  await joiner.waitForURL(/game\.html\?game=.*role=p2/, { timeout: 8000 });

  // P2 must NEVER see an interactive map-picker in this flow.
  const joinerMapPickerVisible = await joiner.locator('#map-picker').isVisible();
  if (joinerMapPickerVisible) fail('P2 (code-share) sees a map-picker — should never get one, one player picks it');
  else ok('P2 (code-share) never sees a map-picker, as intended');

  // P2 should see which map it is (read-only) once P1's lobby data arrives — the new
  // visibility fix, so P2 isn't picking a deck totally blind to terrain.
  await joiner.waitForFunction(
    () => document.getElementById('picker-label')?.textContent?.includes('Ardennes'),
    { timeout: 8000 }
  ).catch(() => fail('P2\'s picker label never showed the map name ("Ardennes") after P1\'s lobby data arrived'));
  const label = await joiner.locator('#picker-label').textContent();
  ok(`P2's picker label correctly shows the map (read-only): "${label}"`);

  await joiner.locator('.deck-option[data-deck="tank-blitz"]').click();
  await host.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 })
    .catch(() => fail('match never started after both P1 (map-then-deck) and P2 (deck-only) finished'));
  ok('match started successfully with the corrected P1 order');

} catch (e) {
  fail(`unexpected exception: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}
