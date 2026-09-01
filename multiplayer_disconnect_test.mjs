// Multiplayer disconnect-flow check from docs/plans/2026-09-01-multiplayer-test-plan.md,
// scenario 4: explicit Exit should notify the other client with a disconnect screen.
// Run with: node multiplayer_disconnect_test.mjs (dev server must be running).
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
  await host.goto(`${BASE_URL}/index.html`);
  await host.fill('#display-name-input', 'HostPlayer');
  await host.locator('#btn-host-open').click();
  await host.locator('.deck-option[data-map="stalingrad"]').click();
  await host.waitForURL(/game\.html\?game=.*role=p1/, { timeout: 8000 });

  await joiner.goto(`${BASE_URL}/index.html`);
  await joiner.waitForSelector('.lobby-row', { timeout: 8000 });
  await joiner.locator('.lobby-row').first().click();
  await joiner.waitForURL(/game\.html\?game=.*role=p2/, { timeout: 8000 });

  await host.locator('.deck-option[data-deck="infantry-formation"]').click();
  await host.waitForSelector('#waiting-screen', { state: 'visible', timeout: 8000 });
  await joiner.locator('.deck-option[data-deck="tank-blitz"]').click();

  await host.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 });
  await host.locator('#btn-mulligan-keep').click();
  await joiner.waitForSelector('#mulligan-screen', { state: 'visible', timeout: 8000 });
  await joiner.locator('#btn-mulligan-keep').click();

  await host.waitForSelector('#board', { state: 'visible', timeout: 8000 });
  await joiner.waitForSelector('#board', { state: 'visible', timeout: 8000 });
  ok('both clients reached the live board');

  // Explicit Exit on the joiner -> host should see a disconnect screen.
  joiner.once('dialog', d => d.accept());
  await joiner.locator('#btn-exit').click();

  await host.waitForSelector('#end-screen', { state: 'visible', timeout: 10000 })
    .then(async () => {
      const subtitle = await host.locator('#end-subtitle').textContent();
      const winner = await host.locator('#end-winner').textContent();
      if (!/disconnect/i.test(subtitle ?? '')) fail(`host's end-screen subtitle didn't mention disconnect: "${subtitle}"`);
      else ok(`host correctly showed the disconnect screen: "${winner}" / "${subtitle}"`);
    })
    .catch(() => fail('host never showed a disconnect screen after the joiner clicked Exit'));

} catch (e) {
  fail(`unexpected exception: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}
