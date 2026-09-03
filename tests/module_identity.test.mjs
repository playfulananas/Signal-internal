import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXPECTED_ASSET_VERSION = '20260903';
const runtimeFiles = [
  'index.html',
  'game.html',
  'deckbuilder.html',
  'showroom.html',
  ...readdirSync(`${ROOT}/js`).filter(name => name.endsWith('.js')).map(name => `js/${name}`),
];

test('all runtime module imports use one cache version', () => {
  const imports = [];

  for (const relativePath of runtimeFiles) {
    const source = readFileSync(`${ROOT}/${relativePath}`, 'utf8');
    const importPattern = /\bfrom\s*['"](\.{1,2}\/[^?' "]+\.js)(?:\?v=([^'"]+))?['"]/g;
    for (const match of source.matchAll(importPattern)) {
      imports.push({ file: relativePath, module: match[1], version: match[2] });
    }
  }

  assert.ok(imports.length > 0, 'expected to find local runtime imports');
  for (const entry of imports) {
    assert.equal(
      entry.version,
      EXPECTED_ASSET_VERSION,
      `${entry.file} imports ${entry.module} with a different or missing cache version`,
    );
  }
});

test('HTML entry modules and versioned styles use the shared cache version', () => {
  const assets = [];

  for (const relativePath of runtimeFiles.filter(name => name.endsWith('.html'))) {
    const source = readFileSync(`${ROOT}/${relativePath}`, 'utf8');
    const assetPattern = /(?:src|href)=['"](?:\.\/)?(?:js\/[^'"]+\.js|css\/[^'"]+\.css)\?v=([^'"]+)['"]/g;
    for (const match of source.matchAll(assetPattern)) {
      assets.push({ file: relativePath, version: match[1] });
    }
  }

  assert.ok(assets.length > 0, 'expected to find versioned HTML assets');
  for (const entry of assets) {
    assert.equal(entry.version, EXPECTED_ASSET_VERSION, `${entry.file} has a stale asset cache version`);
  }
});

test('Deck Builder preserves string card IDs from data attributes', () => {
  const source = readFileSync(`${ROOT}/js/deckbuilder.js`, 'utf8');
  assert.doesNotMatch(source, /Number\s*\(\s*row\.dataset\.id\s*\)/);
  assert.match(source, /const id = row\.dataset\.id;/);
});
