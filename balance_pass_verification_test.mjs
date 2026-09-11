// Live verification for the 2026-09 balance pass (Infantry/Tank stat reductions, 5 Hero
// changes). Solo hot-seat game — no Firebase/multiplayer involved, so state mutations via the
// debug panel apply synchronously with no network round-trip to race against.
//
// Run with the dev server already up: node balance_pass_verification_test.mjs
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
let failed = false;
function fail(msg) { console.error(`FAIL: ${msg}`); failed = true; }
function ok(msg) { console.log(`OK: ${msg}`); }

async function mutateAndCommit(page, mutatorSrc) {
  await page.evaluate((src) => {
    const dbg = window.__SIGNAL_DEBUG__;
    // eslint-disable-next-line no-eval
    (0, eval)(`(${src})`)(dbg.state);
    document.querySelector('[data-fuel-delta="5"]').click(); // any debug action reaching commitState
  }, mutatorSrc);
  await page.waitForTimeout(150); // local-only game, no network — a short settle is plenty
}

function readState(page) {
  return page.evaluate(() => window.__SIGNAL_DEBUG__.state);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

try {
  await page.goto(`${BASE_URL}/game.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#map-grid .deck-option[data-map="kursk"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('#map-grid .deck-option[data-map="kursk"]').click();
  await page.locator('#deck-picker').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#deck-grid .deck-option').first().click();
  await page.waitForTimeout(150);
  await page.locator('#deck-grid .deck-option').first().click();
  await page.locator('#mulligan-screen').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#btn-mulligan-keep').click();
  const shown2 = await page.locator('#mulligan-screen').waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
  if (shown2) await page.locator('#btn-mulligan-keep').click();
  await page.locator('#game-area').waitFor({ state: 'visible', timeout: 5000 });
  ok('local hot-seat match started');

  // ── Set up: turn=2 (past the Direct HQ / not-relevant-here turn-1 quirk, harmless either
  // way for Hero passives, but matches other scripts' convention), full Fuel, all 5 changed
  // Heroes deployed into P1's 4 zones (H01/H04/H08/H25 — 4 zones only, H17 tested via a
  // SEPARATE re-deployment after H25 is done with, since only 4 Hero Zones exist).
  await mutateAndCommit(page, `s => {
    s.initiative = 'p1';
    s.turn = 2;
    s.p1.fuel = 30;
    s.p1.heroZones = ['H01', 'H04', 'H08', 'H25'];
  }`);
  let state = await readState(page);
  if (state.p1.heroZones.join(',') === 'H01,H04,H08,H25') ok('H01/H04/H08/H25 deployed to P1\'s 4 Hero Zones');
  else fail(`Hero Zone injection did not stick: ${JSON.stringify(state.p1.heroZones)}`);

  // ── H01 Quartermaster General: look at 3 random cards, choose 1 ────────────────────────────
  const deckBefore = state.p1.deck.length;
  const handBefore = state.p1.hand.length;
  await page.locator('[data-hero-zone="p1-0"]').click();
  await page.locator('#quartermaster-modal').waitFor({ state: 'visible', timeout: 3000 })
    .catch(() => fail('Quartermaster modal never opened after clicking H01\'s Hero Zone'));
  const slotCount = await page.locator('#quartermaster-cards .fo-slot').count();
  if (slotCount > 0 && slotCount <= 3) ok(`Quartermaster modal shows ${slotCount} candidate(s) (expected 1-3)`);
  else fail(`Quartermaster modal shows ${slotCount} candidates, expected 1-3`);
  await page.locator('#quartermaster-cards .fo-slot').first().locator('button').click();
  await page.locator('#quartermaster-modal').waitFor({ state: 'hidden', timeout: 3000 })
    .catch(() => fail('Quartermaster modal never closed after picking a candidate'));
  state = await readState(page);
  const deckAfter = state.p1.deck.length;
  const handAfter = state.p1.hand.length;
  if (deckAfter === deckBefore - 1 && handAfter === handBefore + 1) {
    ok(`H01: deck ${deckBefore} -> ${deckAfter}, hand ${handBefore} -> ${handAfter} — exactly 1 card moved`);
  } else {
    fail(`H01: expected deck -1 and hand +1, got deck ${deckBefore}->${deckAfter}, hand ${handBefore}->${handAfter}`);
  }
  if (state.p1.heroesActivatedThisTurn?.includes('H01')) ok('H01 marked activated this turn');
  else fail('H01 not marked in heroesActivatedThisTurn after activation');

  // ── H04 Objective Marshal: fires board-wide, no Column restriction ─────────────────────────
  // H04 sits in zone/column 1. Objective slots are not occupiable tiles (see CLAUDE.md's
  // per-map "occupiable tiles" counts) — place an Infantry-neutralising Artillery unit
  // ADJACENT to the Objective, not on it, in a DIFFERENT column (3) from H04, with NO Supreme
  // Commander present — must still fire.
  await mutateAndCommit(page, `s => {
    s.objectives['0,3'] = { cardId: 'O1', level: 1 };
    s.p1.hand = [...s.p1.hand, 'AR40'];
  }`);
  state = await readState(page);
  const ar40InHand = state.p1.hand.includes('AR40');
  if (ar40InHand) {
    await page.locator('.hand-card[data-card-id="AR40"]').first().click();
    await page.locator('.tile[data-key="1,3"]').click(); // adjacent to the 0,3 Objective, column 3
    await page.waitForTimeout(200);
    state = await readState(page);
    const bonus = state.board['1,3']?.grantedSideBonus ?? 0;
    if (bonus === 1) ok('H04 (column 1) fired on a column-3 placement with no Supreme Commander — board scope confirmed');
    else fail(`H04 expected to grant +1 on a column-3 placement (board scope), got grantedSideBonus=${bonus} — board: ${JSON.stringify(state.board['1,3'])}`);
  } else {
    fail('AR40 never reached hand — could not test H04');
  }

  // ── H08 Infantry Commander: +1 (was +2) ─────────────────────────────────────────────────────
  // H08 sits in zone/column 2. Place an Infantry unit in column 2 — must grant exactly +1.
  await mutateAndCommit(page, `s => {
    s.p1.hand = [...s.p1.hand, 'I2'];
  }`);
  state = await readState(page);
  if (state.p1.hand.includes('I2')) {
    await page.locator('.hand-card[data-card-id="I2"]').first().click();
    await page.locator('.tile[data-key="1,2"]').click();
    await page.waitForTimeout(200);
    state = await readState(page);
    const bonus = state.board['1,2']?.grantedSideBonus ?? 0;
    if (bonus === 1) ok('H08 granted exactly +1 (2026-09 balance pass value) to an Infantry placed in its column');
    else fail(`H08 expected grantedSideBonus=1 (balance pass reduced from 2), got ${bonus}`);
  } else {
    fail('I2 never reached hand — could not test H08');
  }

  // ── H17 HQ Assault Commander: 2 damage (was 1) ──────────────────────────────────────────────
  await mutateAndCommit(page, `s => {
    s.p1.heroZones[3] = 'H17'; // replace H25 in zone 3 — done testing Craft's own cost separately below
    s.p1.fuel = 10;
  }`);
  state = await readState(page);
  const p2HqBefore = state.p2.hq;
  await page.locator('[data-hero-zone="p1-3"]').click();
  await page.waitForTimeout(200);
  state = await readState(page);
  const p2HqAfter = state.p2.hq;
  if (p2HqBefore - p2HqAfter === 2) ok(`H17 dealt exactly 2 damage (balance pass, was 1): P2 HQ ${p2HqBefore} -> ${p2HqAfter}`);
  else fail(`H17 expected exactly 2 damage, got P2 HQ ${p2HqBefore} -> ${p2HqAfter} (delta ${p2HqBefore - p2HqAfter})`);

  // ── H25 Chief Aircraft Engineer: starting cost 4 (was 5) ────────────────────────────────────
  await mutateAndCommit(page, `s => {
    s.p1.heroZones[3] = 'H25';
    s.p1.nextCraftCost = undefined;
    s.p1.fuel = 10;
    s.p1.heroesActivatedThisTurn = (s.p1.heroesActivatedThisTurn ?? []).filter(h => h !== 'H25');
  }`);
  state = await readState(page);
  const fuelBeforeCraft = state.p1.fuel;
  await page.locator('[data-hero-zone="p1-3"]').click();
  await page.locator('#craft-picker-modal').waitFor({ state: 'visible', timeout: 3000 })
    .catch(() => fail('Craft picker modal never opened for H25'));
  state = await readState(page);
  const fuelAfterCraft = state.p1.fuel;
  const craftCost = fuelBeforeCraft - fuelAfterCraft;
  if (craftCost === 4) ok(`H25's first activation cost exactly 4 Fuel (balance pass, was 5): ${fuelBeforeCraft} -> ${fuelAfterCraft}`);
  else fail(`H25 first activation expected to cost 4 Fuel, actual cost was ${craftCost} (${fuelBeforeCraft} -> ${fuelAfterCraft})`);

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
