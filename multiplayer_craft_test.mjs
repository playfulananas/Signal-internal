// Multiplayer regression check for the Craft (H25)/Training Officer (H19) cross-client risk
// flagged in docs/plans/2026-09-01-multiplayer-test-plan.md: registerGeneratedCard (combat.js)
// only registers a dynamically-created card into the CRAFTING client's own CARD_BY_ID. Firebase
// sync (pushState) only ever transmits the bare card id. This script gets two real, independent
// clients into a live online match, has the host craft an Aircraft and place it on the board,
// and watches the JOINER's page for a console error or a broken/blank render of that tile —
// the predicted failure mode if the cross-client registration gap is real.
//
// Requires the dev server (npx serve . -p 3000) and hits the live Firebase project — same
// caveats as open_lobby_test.mjs, which this reuses the lobby-setup half of.
// Run with: node multiplayer_craft_test.mjs
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

try {
  // ── Lobby setup (mirrors open_lobby_test.mjs) ──────────────────────────────
  await host.goto(`${BASE_URL}/index.html`);
  await host.fill('#display-name-input', 'HostPlayer');
  await host.locator('#btn-host-open').click();
  await host.locator('.deck-option[data-map="kursk"]').click();
  await host.waitForURL(/game\.html\?game=.*role=p1/, { timeout: 8000 });

  await joiner.goto(`${BASE_URL}/index.html`);
  await joiner.waitForSelector('.lobby-row', { timeout: 8000 });
  await joiner.locator('.lobby-row').first().click();
  await joiner.waitForURL(/game\.html\?game=.*role=p2/, { timeout: 8000 });

  // Host deck must include H25 or H19 — Air Superiority (04) carries H25 Chief Aircraft Engineer.
  await host.locator('.deck-option[data-deck="air-superiority"]').click();
  await host.waitForSelector('#waiting-screen', { state: 'visible', timeout: 8000 });

  await joiner.locator('.deck-option[data-deck="tank-blitz"]').click();

  await host.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 });
  ok('both clients reached the lobby handshake and the host sees the mulligan screen');

  // ── Mulligan: keep all on both sides ────────────────────────────────────────
  await host.locator('#btn-mulligan-keep').click();
  await joiner.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 })
    .catch(() => fail('joiner never reached its own mulligan screen after host kept its hand'));
  await joiner.locator('#btn-mulligan-keep').click();

  await host.waitForSelector('#board', { state: 'visible', timeout: 8000 })
    .catch(() => fail('host never reached the live board after both mulligans'));
  await joiner.waitForSelector('#board', { state: 'visible', timeout: 8000 })
    .catch(() => fail('joiner never reached the live board after both mulligans'));
  ok('both clients reached the live board — match started');

  // Both mulligan confirmations push a full state replace (commitState pushes regardless of
  // whose "turn" it conceptually is); give any in-flight round-trip time to land before doing
  // a raw local mutation below, or an incoming replace can silently wipe it out mid-script.
  await host.waitForTimeout(1500);

  // ── Force H25 into the host's Hero Zone + give Fuel via the debug panel ─────
  // (debug actions route through commitState -> pushStateIfOnline, same as any real action,
  // so this exercises the real sync path, not a local-only shortcut.)
  await host.evaluate(() => {
    const dbg = window.__SIGNAL_DEBUG__;
    dbg.state.p1.heroZones[0] = 'H25';
  });
  // Force a real commitState so the mutation above actually gets pushed: nudge Fuel via the
  // debug panel UI (direct state mutation alone doesn't call commitState/pushState).
  await host.locator('#debug-toggle').click();
  const fuelPlus5 = host.locator('button:has-text("+5")').first();
  await fuelPlus5.click();
  await fuelPlus5.click();
  await fuelPlus5.click();
  await host.locator('.debug-panel button:has-text("✕")').first().click();

  const hostFuel = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.p1.fuel);
  const hostHeroZones = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.p1.heroZones);
  console.log(`host fuel after debug bumps: ${hostFuel}, heroZones: ${JSON.stringify(hostHeroZones)}`);
  if (!hostHeroZones.includes('H25')) fail('H25 was not actually placed in a hero zone after the debug injection + redraw');

  // Confirm the joiner's client also sees the deployed H25 (state actually synced).
  await joiner.waitForFunction(
    () => window.__SIGNAL_DEBUG__?.state?.p1?.heroZones?.includes('H25'),
    { timeout: 8000 }
  ).catch(() => fail('joiner never saw P1\'s H25 deployment sync in — Fuel/heroZone debug pushes may not be reaching Firebase'));
  ok('joiner\'s client received the synced H25 deployment + Fuel bump');

  // ── Host activates Craft and picks a candidate ──────────────────────────────
  const heroZoneSlot = host.locator('.hero-zone-slot.filled').first();
  await heroZoneSlot.click();
  await host.waitForSelector('#craft-picker-modal', { state: 'visible', timeout: 5000 })
    .catch(() => fail('Craft picker modal never opened on the host after clicking the H25 hero zone'));

  const craftButton = host.locator('button:has-text("CRAFT THIS")').first();
  await craftButton.click();

  const hostHandAfterCraft = await host.evaluate(() => window.__SIGNAL_DEBUG__.state.p1.hand);
  const craftedId = hostHandAfterCraft.find(id => id.startsWith('Craft-'));
  if (!craftedId) fail(`no Craft-* card id found in host's hand after crafting: ${JSON.stringify(hostHandAfterCraft)}`);
  else ok(`host crafted ${craftedId}`);

  // ── Host places the crafted card on the board ───────────────────────────────
  if (craftedId) {
    await host.locator(`.hand-card[data-card-id="${craftedId}"]`).click();
    // Any empty tile works; pick the first one with no 'has-unit' class.
    const emptyTile = host.locator('.tile:not(.has-unit)').first();
    await emptyTile.click();

    const hostBoardHasCraft = await host.evaluate((id) => {
      return Object.values(window.__SIGNAL_DEBUG__.state.board).some(u => u && u.cardId === id);
    }, craftedId);
    if (!hostBoardHasCraft) fail(`${craftedId} was not placed on the host's board after clicking an empty tile`);
    else ok(`host placed ${craftedId} on the board`);

    // ── The actual test: does the JOINER's client end up with a working render? ─
    await joiner.waitForFunction(
      (id) => Object.values(window.__SIGNAL_DEBUG__?.state?.board ?? {}).some(u => u && u.cardId === id),
      craftedId,
      { timeout: 8000 }
    ).catch(() => fail(`joiner's state never showed ${craftedId} on the board — sync may have failed entirely`));

    const joinerCardDefined = await joiner.evaluate(async (id) => {
      const mod = await import('./js/cards.js');
      return !!mod.CARD_BY_ID[id];
    }, craftedId).catch(e => { fail(`joiner failed evaluating CARD_BY_ID lookup: ${e.message}`); return null; });

    if (joinerCardDefined === false) {
      fail(`CONFIRMED BUG: joiner's CARD_BY_ID has no entry for ${craftedId} — the crafted card's ` +
        `definition never crossed the network, only its bare id did. Rendering that board tile on ` +
        `the joiner's client will break.`);
    } else if (joinerCardDefined === true) {
      ok(`joiner's CARD_BY_ID DOES have ${craftedId} defined — cross-client lookup gap did not reproduce as predicted`);
    }
  }

  // ── Explicit Exit -> other client should show the disconnect screen ────────
  joiner.once('dialog', d => d.accept());
  await joiner.locator('#btn-exit').click();
  await host.waitForSelector('#end-screen', { state: 'visible', timeout: 8000 })
    .then(async () => {
      const subtitle = await host.locator('#end-subtitle').textContent();
      const winner = await host.locator('#end-winner').textContent();
      if (!/disconnect/i.test(subtitle ?? '')) fail(`host's end-screen subtitle didn't mention disconnect: "${subtitle}"`);
      else ok(`host correctly showed the disconnect screen after joiner's Exit: "${winner}" / "${subtitle}"`);
    })
    .catch(() => fail('host never showed a disconnect screen after the joiner clicked Exit'));

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
