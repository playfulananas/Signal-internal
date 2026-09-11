// Live verification for the 2026-09-11 Artillery balance pass (SIGNAL-Claude-Artillery-Balance-
// Changes.docx, approved by Denis): H18 Artillery Commander, C30 Artillery Barrage and C31
// Target Coordinates now ALSO grant +1 to all sides (until end of turn), alongside their existing
// keyword grant. The 8 Artillery unit stat buffs are plain data changes already covered by
// CARD_TRUTH.md's generated output; this script covers only the temporary-modifier mechanics,
// which are DOM-coupled game.js switch cases with no existing pure-function unit test coverage
// (same reasoning as balance_pass_verification_test.mjs, which this script's structure mirrors).
//
// Run with the dev server already up: node artillery_balance_verification_test.mjs
import { chromium } from 'playwright';
import { CARD_BY_ID } from './js/cards.js';

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

  // H18 sits in zone/column 0 — matches Artillery Fire Control's real roster (decks.js).
  await mutateAndCommit(page, `s => {
    s.initiative = 'p1';
    s.turn = 2;
    s.p1.fuel = 30;
    s.p1.heroZones = ['H18', 'H11', 'H16', 'H05'];
  }`);
  let state = await readState(page);
  if (state.p1.heroZones[0] === 'H18') ok('H18 deployed to P1 Hero Zone 0 (column 0)');
  else fail(`H18 deployment did not stick: ${JSON.stringify(state.p1.heroZones)}`);

  // ── H18 Artillery Commander: +1 all sides AND Blast (was Blast only) ───────────────────────
  // AR44 Heavy Howitzer has no printed keyword overlap with Blast — a clean case for "gains a
  // keyword it didn't have, plus the stat bonus."
  await mutateAndCommit(page, `s => { s.p1.hand = [...s.p1.hand, 'AR44']; }`);
  state = await readState(page);
  if (state.p1.hand.includes('AR44')) {
    await page.locator('.hand-card[data-card-id="AR44"]').first().click();
    await page.locator('.tile[data-key="0,0"]').click(); // column 0, matches H18's zone
    await page.waitForTimeout(200);
    await page.locator('[data-hero-zone="p1-0"]').click(); // activate H18
    await page.locator('.tile[data-key="0,0"]').click(); // resolve targeting onto the Howitzer
    await page.waitForTimeout(200);
    state = await readState(page);
    const u = state.board['0,0'];
    const bonus = u?.tempSideBonus ?? 0;
    const hasBlast = (u?.tempKeywords ?? []).includes('Blast');
    if (bonus === 1 && hasBlast) ok('H18: AR44 Heavy Howitzer gained tempSideBonus +1 AND Blast (2026-09 Artillery pass)');
    else fail(`H18 expected tempSideBonus=1 and Blast in tempKeywords, got tempSideBonus=${bonus}, tempKeywords=${JSON.stringify(u?.tempKeywords)}`);
  } else {
    fail('AR44 never reached hand — could not test H18');
  }

  // ── C30 Artillery Barrage: +1 all sides AND Barrage (was Barrage only) ─────────────────────
  // AR46 Mortar Battery already has PRINTED Blast (not Barrage) — a different card from AR44 so
  // this is a fresh, unmodified unit.
  await mutateAndCommit(page, `s => { s.p1.hand = [...s.p1.hand, 'AR46', 'C30']; s.p1.fuel = 30; }`);
  state = await readState(page);
  if (state.p1.hand.includes('AR46') && state.p1.hand.includes('C30')) {
    await page.locator('.hand-card[data-card-id="AR46"]').first().click();
    await page.locator('.tile[data-key="1,1"]').click();
    await page.waitForTimeout(200);
    await page.locator('.hand-card[data-card-id="C30"]').first().click();
    await page.locator('.tile[data-key="1,1"]').click();
    await page.waitForTimeout(200);
    state = await readState(page);
    const u = state.board['1,1'];
    const bonus = u?.tempSideBonus ?? 0;
    const hasBarrage = (u?.tempKeywords ?? []).includes('Barrage');
    if (bonus === 1 && hasBarrage) ok('C30: AR46 Mortar Battery gained tempSideBonus +1 AND Barrage (2026-09 Artillery pass)');
    else fail(`C30 expected tempSideBonus=1 and Barrage in tempKeywords, got tempSideBonus=${bonus}, tempKeywords=${JSON.stringify(u?.tempKeywords)}`);
  } else {
    fail('AR46 and/or C30 never reached hand — could not test C30');
  }

  // ── C31 Target Coordinates: +1 all sides AND Precision (was Precision only) ────────────────
  // Reuses the SAME AR46 from the C30 case above — it already has a granted Barrage keyword
  // from this same turn. Proves the doc's "a Unit that already has the granted keyword must
  // still receive the stat bonus" requirement in its adjacent form: a Unit that already has a
  // DIFFERENT temp keyword/bonus this turn still stacks a second one cleanly (tempSideBonus
  // should read 2 total, not overwritten back to 1).
  await mutateAndCommit(page, `s => { s.p1.hand = [...s.p1.hand, 'C31']; s.p1.fuel = 30; }`);
  state = await readState(page);
  if (state.p1.hand.includes('C31')) {
    await page.locator('.hand-card[data-card-id="C31"]').first().click();
    await page.locator('.tile[data-key="1,1"]').click();
    await page.waitForTimeout(200);
    state = await readState(page);
    const u = state.board['1,1'];
    const bonus = u?.tempSideBonus ?? 0;
    const hasBarrage = (u?.tempKeywords ?? []).includes('Barrage');
    const hasPrecision = (u?.tempKeywords ?? []).includes('Precision');
    if (bonus === 2 && hasBarrage && hasPrecision) {
      ok('C31: same AR46 stacked to tempSideBonus=2 (C30 + C31), retains Barrage, gains Precision');
    } else {
      fail(`C31 expected tempSideBonus=2 (stacked with C30) with both Barrage and Precision, got tempSideBonus=${bonus}, tempKeywords=${JSON.stringify(u?.tempKeywords)}`);
    }
  } else {
    fail('C31 never reached hand — could not test C31');
  }

  // ── Already-has-the-printed-keyword case: H18 targeting a Unit that ALREADY has printed
  // Blast must still grant the +1 stat bonus, not skip it because the keyword is redundant. ──
  await mutateAndCommit(page, `s => { s.p1.hand = [...s.p1.hand, 'AR46']; s.p1.fuel = 30; s.p1.heroesActivatedThisTurn = (s.p1.heroesActivatedThisTurn ?? []).filter(h => h !== 'H18'); }`);
  state = await readState(page);
  if (state.p1.hand.includes('AR46')) {
    await page.locator('.hand-card[data-card-id="AR46"]').first().click();
    await page.locator('.tile[data-key="2,0"]').click(); // fresh AR46 (printed Blast), column 0
    await page.waitForTimeout(200);
    await page.locator('[data-hero-zone="p1-0"]').click();
    await page.locator('.tile[data-key="2,0"]').click();
    await page.waitForTimeout(200);
    state = await readState(page);
    const u = state.board['2,0'];
    const bonus = u?.tempSideBonus ?? 0;
    if (bonus === 1) ok('H18 on a Unit with PRINTED Blast still grants the +1 stat bonus (not skipped as redundant)');
    else fail(`H18 on an already-Blast Unit expected tempSideBonus=1 regardless, got ${bonus}`);
  } else {
    fail('Second AR46 never reached hand — could not test the already-has-keyword case');
  }

  // ── Expiration: end the turn, confirm tempSideBonus/tempKeywords clear but the UNIT'S OWN
  // PRINTED keyword (CARD_BY_ID's static `keyword` field, never mutated by any of this) is
  // untouched. Read directly from the cards.js module (static data — no browser needed). ────
  if (CARD_BY_ID.AR46?.keyword === 'Blast') ok('AR46\'s printed keyword field is still Blast (sanity check on the static data itself)');
  else fail(`AR46's static keyword field is ${JSON.stringify(CARD_BY_ID.AR46?.keyword)}, expected 'Blast' — printed-keyword expiry check below is meaningless without this`);
  await page.locator('#btn-end-turn').click();
  await page.waitForTimeout(300);
  state = await readState(page);
  const afterEot = state.board['2,0'];
  if (afterEot && (afterEot.tempSideBonus ?? 0) === 0 && (afterEot.tempKeywords ?? []).length === 0) {
    ok('End of turn: tempSideBonus and tempKeywords both cleared from the H18-buffed Unit, as expected');
  } else {
    fail(`Expected tempSideBonus=0 and empty tempKeywords after end of turn, got tempSideBonus=${afterEot?.tempSideBonus}, tempKeywords=${JSON.stringify(afterEot?.tempKeywords)}`);
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
