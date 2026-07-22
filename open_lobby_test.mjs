// Smoke test: two independent browser contexts (host + joiner) exercise the
// open-lobby flow end to end. Requires the dev server: npx serve . -p 3000
// Run with: node open_lobby_test.mjs
// Hits the live Firebase project — no local emulator is configured here.
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
function fail(msg) { console.error(`FAIL: ${msg}`); process.exitCode = 1; }

const browser = await chromium.launch();
const hostCtx = await browser.newContext();
const joinCtx = await browser.newContext();
const host = await hostCtx.newPage();
const joiner = await joinCtx.newPage();

try {
  await host.goto(`${BASE_URL}/index.html`);
  await host.fill('#display-name-input', 'HostPlayer');
  await host.locator('#btn-host-open').click();
  await host.locator('.deck-option[data-map="kursk"]').click();
  await host.waitForURL(/game\.html\?game=.*role=p1/, { timeout: 8000 })
    .catch(() => fail('host was not navigated into game.html after picking a map'));

  await joiner.goto(`${BASE_URL}/index.html`);
  await joiner.waitForSelector('.lobby-row', { timeout: 8000 })
    .catch(() => fail('open lobby row never appeared for the joiner'));

  const row = joiner.locator('.lobby-row').first();
  const rowText = (await row.textContent()) ?? '';
  if (!rowText.includes('HostPlayer')) fail(`lobby row missing host name, got: "${rowText}"`);
  if (!rowText.toLowerCase().includes('kursk')) fail(`lobby row missing map name, got: "${rowText}"`);
  if (rowText.toLowerCase().match(/aggro|control|counter|power|hammer strike|iron fortress|blitz breaker|steel column/)) {
    fail(`lobby row leaked deck information: "${rowText}"`);
  }

  await row.click();
  await joiner.waitForURL(/game\.html\?game=.*role=p2/, { timeout: 8000 })
    .catch(() => fail('joiner was not navigated into game.html after clicking the lobby row'));

  // Host picks a deck — map-picker should be skipped since mapId came from the lobby.
  await host.locator('.deck-option[data-deck="aggro"]').click();
  await host.waitForSelector('#waiting-screen', { state: 'visible', timeout: 8000 })
    .catch(() => fail('host did not reach the waiting screen — map-picker may not have been skipped'));

  // Joiner picks a deck — this should complete the handshake and start the game.
  await joiner.locator('.deck-option[data-deck="control"]').click();

  await host.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 })
    .catch(() => fail('game did not start for host after both decks were picked'));

  if (process.exitCode !== 1) console.log('PASS: open lobby smoke test');
} finally {
  await browser.close();
}
