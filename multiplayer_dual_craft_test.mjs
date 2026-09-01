// Multiplayer test plan scenario 6: both players crafting/buffing independently in the same
// match must not collide on the same generated card id. Also exercises H19 Training Officer's
// hand-buff sync as a second consumer of the same registerGeneratedCard/generatedCards path
// the Craft fix (2026-09-01) covers.
// Run with: node multiplayer_dual_craft_test.mjs (dev server must be running).
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

async function versionedImport(page, path) {
  return page.evaluate(async (p) => {
    const scriptSrc = document.querySelector('script[type="module"]').src;
    const v = new URL(scriptSrc).search;
    const mod = await import(`${p}${v}`);
    return mod;
  }, path);
}

try {
  await host.goto(`${BASE_URL}/index.html`);
  await host.fill('#display-name-input', 'HostPlayer');
  await host.locator('#btn-host-open').click();
  await host.locator('.deck-option[data-map="ardennes"]').click();
  await host.waitForURL(/game\.html\?game=.*role=p1/, { timeout: 8000 });

  await joiner.goto(`${BASE_URL}/index.html`);
  await joiner.waitForSelector('.lobby-row', { timeout: 8000 });
  await joiner.locator('.lobby-row').first().click();
  await joiner.waitForURL(/game\.html\?game=.*role=p2/, { timeout: 8000 });

  // Both decks carry H25 (air-superiority) so both sides can craft independently.
  await host.locator('.deck-option[data-deck="air-superiority"]').click();
  await host.waitForSelector('#waiting-screen', { state: 'visible', timeout: 8000 });
  await joiner.locator('.deck-option[data-deck="air-superiority"]').click();

  await host.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 });
  await host.locator('#btn-mulligan-keep').click();
  await joiner.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 });
  await joiner.locator('#btn-mulligan-keep').click();

  await host.waitForSelector('#board', { state: 'visible', timeout: 8000 });
  await joiner.waitForSelector('#board', { state: 'visible', timeout: 8000 });
  await host.waitForTimeout(1500);
  ok('both clients reached the live board');

  // Deploy H25 on both sides via debug injection. A Hero can only activate on its owner's own
  // turn (tryActivateHero gates on state.initiative), so this also has to force initiative for
  // whichever side is about to craft — can't have both act "simultaneously" in a turn-based game,
  // the point here is just that each side's independent craft, on its own turn, must not collide.
  await host.evaluate(() => {
    window.__SIGNAL_DEBUG__.state.p1.heroZones[0] = 'H25';
    window.__SIGNAL_DEBUG__.state.initiative = 'p1';
  });
  await host.locator('#debug-toggle').click();
  await host.locator('button:has-text("+5")').first().click();
  await host.locator('button:has-text("+5")').first().click();
  await host.locator('.debug-panel button:has-text("✕")').first().click();
  await host.waitForTimeout(500);

  await joiner.evaluate(() => { window.__SIGNAL_DEBUG__.state.p2.heroZones[0] = 'H25'; });
  await joiner.locator('#debug-toggle').click();
  // The debug panel's Fuel/HQ/etc. controls default to targeting p1 regardless of which role
  // this client is playing — must explicitly switch the target or these bumps land on p1's
  // data (invisible to this client's own Fuel display, so a stale-looking `p2Fuel: 0` is the
  // symptom, not a sync failure).
  await joiner.locator('button:has-text("TARGET: P2")').click();
  await joiner.locator('button:has-text("+5")').first().click();
  await joiner.locator('button:has-text("+5")').first().click();
  await joiner.locator('.debug-panel button:has-text("✕")').first().click();
  await joiner.waitForTimeout(1500); // let both pushes settle before either crafts

  // Host crafts (it's currently p1's turn — forced above). Target the exact zone by its
  // data-hero-zone attribute rather than ".first()" — both p1-0 and p2-0 are "filled" by this
  // point and DOM order between them isn't something to depend on.
  await host.locator('[data-hero-zone="p1-0"]').click();
  await host.waitForSelector('#craft-picker-modal', { state: 'visible', timeout: 8000 });
  await host.locator('button:has-text("CRAFT THIS")').first().click();
  const hostCraftedId = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.p1.hand.find(id => id.startsWith('Craft-')));
  if (!hostCraftedId) fail('host never got a Craft-* id in hand');
  else ok(`host crafted ${hostCraftedId}`);

  await host.waitForTimeout(1000); // let the host's craft push land before the joiner crafts

  // Hand the turn to p2 so the joiner is actually allowed to activate its own Hero, then craft.
  await joiner.evaluate(() => { window.__SIGNAL_DEBUG__.state.initiative = 'p2'; });
  await joiner.locator('#debug-toggle').click();
  await joiner.locator('button:has-text("+1")').first().click();
  await joiner.locator('.debug-panel button:has-text("✕")').first().click();
  await joiner.waitForTimeout(500);
  const joinerDiag = await joiner.evaluate(() => ({
    initiative: window.__SIGNAL_DEBUG__.state.initiative,
    p2HeroZones: window.__SIGNAL_DEBUG__.state.p2.heroZones,
    p2Fuel: window.__SIGNAL_DEBUG__.state.p2.fuel,
    p2ActivatedThisTurn: window.__SIGNAL_DEBUG__.state.p2.heroesActivatedThisTurn,
  }));
  console.log('joiner diag before craft click:', JSON.stringify(joinerDiag));
  await joiner.locator('[data-hero-zone="p2-0"]').click();
  await joiner.waitForSelector('#craft-picker-modal', { state: 'visible', timeout: 8000 });
  await joiner.locator('button:has-text("CRAFT THIS")').first().click();
  const joinerCraftedId = await joiner.evaluate(() => window.__SIGNAL_DEBUG__.state.p2.hand.find(id => id.startsWith('Craft-')));
  if (!joinerCraftedId) fail('joiner never got a Craft-* id in hand');
  else ok(`joiner crafted ${joinerCraftedId}`);

  if (hostCraftedId && joinerCraftedId) {
    if (hostCraftedId === joinerCraftedId) {
      fail(`ID COLLISION: both players crafted the same id "${hostCraftedId}" independently.`);
    } else {
      ok(`no id collision: "${hostCraftedId}" vs "${joinerCraftedId}"`);
    }
  }

  // Confirm each side eventually sees BOTH generated definitions correctly (cross-registered).
  await host.waitForFunction(
    (id) => Object.values(window.__SIGNAL_DEBUG__?.state?.p2?.hand ?? []).includes(id),
    joinerCraftedId,
    { timeout: 8000 }
  ).catch(() => fail("host's state never received the joiner's craft"));

  if (hostCraftedId && joinerCraftedId) {
    const bothMod = await versionedImport(host, './js/cards.js');
    const hostSeesOwn = !!bothMod.CARD_BY_ID[hostCraftedId];
    const hostSeesJoiners = !!bothMod.CARD_BY_ID[joinerCraftedId];
    if (!hostSeesOwn) fail(`host's own CARD_BY_ID missing its own crafted card ${hostCraftedId}`);
    if (!hostSeesJoiners) fail(`host's CARD_BY_ID missing the joiner's crafted card ${joinerCraftedId} after sync`);
    if (hostSeesOwn && hostSeesJoiners) ok('host correctly has BOTH generated card definitions registered');
  }

  console.log('\n--- Console/page errors captured ---');
  console.log('Host:', hostErrors.length ? hostErrors.filter(e => !e.includes('auth/network-request-failed')) : '(none)');
  console.log('Joiner:', joinErrors.length ? joinErrors.filter(e => !e.includes('auth/network-request-failed')) : '(none)');

} catch (e) {
  fail(`unexpected exception: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}
