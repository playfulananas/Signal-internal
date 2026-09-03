// Smoke test: build a deck in the builder, save it, verify it's playable from the lobby.
// Requires the dev server: npx serve . -p 3000
// Run with: node deckbuilder_test.mjs
import { chromium } from 'playwright';
import { STARTER_DECKS } from './js/decks.js';

const BASE_URL = 'http://localhost:3000';
const DECK_NAME = 'Smoke Test Deck';
const STARTER = STARTER_DECKS[0];

function fail(msg) { console.error(`FAIL: ${msg}`); process.exitCode = 1; }

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  // ── 1. Build and save ──
  await page.goto(`${BASE_URL}/deckbuilder.html`);
  await page.evaluate(() => localStorage.removeItem('signal-custom-decks'));
  await page.reload();

  const cardCounts = STARTER.ids.reduce((counts, id) => {
    (counts[id] ??= []).push(id);
    return counts;
  }, {});
  for (const [id, copies] of Object.entries(cardCounts)) {
    const row = page.locator(`.db-card-row[data-id="${id}"]`);
    for (let i = 0; i < copies.length; i++) await row.click();
  }

  const count = await page.locator('#db-ap').textContent();
  if (count !== '30 / 30 cards') fail(`expected "30 / 30 cards", got "${count}"`);

  // A legal saved deck also requires four distinct Heroes.
  await page.locator('.db-filter[data-filter="hero"]').click();
  for (const id of STARTER.heroIds) {
    await page.locator(`.db-card-row[data-id="${id}"]`).click();
  }
  const heroCount = await page.locator('#db-hero-count').textContent();
  if (heroCount !== '4 / 4 heroes') fail(`expected "4 / 4 heroes", got "${heroCount}"`);

  await page.fill('#db-deck-name', DECK_NAME);
  const saveBtn = page.locator('#db-save');
  if (await saveBtn.isDisabled()) fail('Save disabled for a legal 30-card deck');
  await saveBtn.click();
  await page.waitForTimeout(100);

  const saved = await page.locator('#db-saved .db-saved-row', { hasText: DECK_NAME }).count();
  if (saved !== 1) fail('saved deck not listed after save');

  // ── 2. Copy-limit guard: third copy is blocked ──
  await page.locator('.db-filter[data-filter="all"]').click();
  const duplicateId = Object.entries(cardCounts).find(([, copies]) => copies.length === 2)?.[0];
  const duplicate = page.locator(`.db-card-row[data-id="${duplicateId}"]`);
  if (!(await duplicate.getAttribute('class')).includes('maxed')) fail(`${duplicateId} not maxed at 2 copies`);

  // ── 3. Deck appears in lobby and starts a game ──
  await page.goto(`${BASE_URL}/game.html`);
  const tile = page.locator('.deck-option', { hasText: DECK_NAME });
  if (await tile.count() !== 1) fail('custom deck tile missing in lobby');

  await tile.click();                                        // P1 deck
  await tile.click();                                        // P2 deck
  await page.locator('.deck-option[data-map="kursk"]').click(); // map
  await page.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 3000 })
    .catch(() => fail('mulligan screen did not appear — game did not start'));

  // ── 4. Cleanup ──
  await page.evaluate(() => localStorage.removeItem('signal-custom-decks'));

  if (process.exitCode !== 1) console.log('PASS: deck builder smoke test');
} finally {
  await browser.close();
}
