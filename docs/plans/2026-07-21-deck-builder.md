# Deck Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a custom deck builder to the SIGNAL digital prototype so players can build, save, and play their own decks alongside the 4 starter decks, with the 50 AP budget and copy limits (Common max 2, Rare max 1) enforced.

**Architecture:** A new pure module `js/decks.js` owns deck rules, validation, starter deck definitions, and localStorage persistence (key `signal-custom-decks`). A new standalone page `deckbuilder.html` + `js/deckbuilder.js` provides the building UI. The lobby in `game.html`/`game.js` switches from 4 hardcoded deck tiles to a dynamically rendered grid (starters + saved custom decks). The game engine is untouched — decks are already plain arrays of card ids passed to `startGame`, and online play already syncs them through Firebase.

**Tech Stack:** Vanilla ES modules (no framework, matches existing code), `node --test` for unit tests, Playwright ad-hoc script for the smoke test (matches existing `selfplay_test.mjs` pattern).

**Design calls locked in this plan (flag to Filip if wrong):**
- Objectives (`type:"objective"`) are excluded from the pool — they are board elements, not deck cards.
- Minimum deck size guardrail: 15 cards (`DECK_RULES.minCards`, one constant, easy to change). Rules say no *maximum* card count; a minimum is needed so the 4-card opening hand + mulligan + ~1 draw/turn doesn't deck out immediately.
- Adding a card past its copy limit is blocked in the UI; exceeding the AP budget is allowed while editing (shown red) but blocks saving. This makes swap-based editing pleasant.
- Custom decks are re-validated every time the lobby loads. If card data changed since a deck was saved (AP retuned, card removed), the deck shows as INVALID with the reason and can't be picked.

**Repo note:** the git repo is `digital/` itself. All `git` commands below run with `digital/` as CWD. The pre-commit hook auto-bumps `?v=` cache-busting params.

---

### Task 1: `js/decks.js` — rules, validation, persistence (+ unit tests)

**Files:**
- Create: `digital/js/decks.js`
- Create: `digital/tests/decks.test.mjs`
- Modify: `digital/js/game.js:23-33` (in Task 4, not here — this task only creates the module)

- [ ] **Step 1: Write the failing tests**

Create `digital/tests/decks.test.mjs`:

```js
// Unit tests for deck validation. Run: node --test tests/
// Only pure functions are tested — localStorage helpers are browser-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_RULES, STARTER_DECKS, getDeckPool,
  computeDeckAP, countCopies, validateDeck,
} from '../js/decks.js';

test('computeDeckAP sums ap of card ids', () => {
  // id 1 Rifle Squad = 1 AP, id 66 King Tiger = 4 AP
  assert.equal(computeDeckAP([1, 1, 66]), 6);
});

test('countCopies counts duplicates', () => {
  assert.deepEqual(countCopies([5, 5, 42]), { 5: 2, 42: 1 });
});

test('getDeckPool excludes objectives', () => {
  const pool = getDeckPool();
  assert.ok(pool.length > 0);
  assert.ok(pool.every(c => c.type !== 'objective'));
});

test('all four starter decks are valid', () => {
  assert.equal(STARTER_DECKS.length, 4);
  for (const d of STARTER_DECKS) {
    const v = validateDeck(d.ids);
    assert.deepEqual(v.errors, [], `${d.name}: ${v.errors.join(' | ')}`);
    assert.ok(v.valid);
  }
});

test('third copy of a Common is rejected', () => {
  // 3x Rifle Squad (Common) padded with legal pairs to clear the min-cards floor
  const ids = [1, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('Rifle Squad')));
});

test('second copy of a Rare is rejected', () => {
  // 2x Field Commander (id 14, Rare) padded with legal pairs
  const ids = [14, 14, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('Field Commander')));
});

test('deck over 50 AP is rejected', () => {
  // 2 copies each of 8 high-AP cards = 66 AP, 16 cards, copy limits fine
  const ids = [45, 45, 41, 41, 9, 9, 66, 66, 64, 64, 48, 48, 79, 79, 7, 7];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('AP')));
  assert.equal(v.ap, 66);
});

test('deck below minimum card count is rejected', () => {
  const v = validateDeck([1, 1, 2, 2]);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('minimum')));
});

test('objective card in deck is rejected', () => {
  const ids = [26, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.toLowerCase().includes('objective')));
});

test('unknown card id is rejected', () => {
  const ids = [999, 1, 1, 2, 2, 5, 5, 34, 34, 61, 61, 70, 70, 71, 71];
  const v = validateDeck(ids);
  assert.ok(!v.valid);
  assert.ok(v.errors.some(e => e.includes('999')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (CWD `digital/`): `node --test tests/`
Expected: FAIL — `Cannot find module '../js/decks.js'`

- [ ] **Step 3: Create `js/decks.js`**

The starter deck ids are moved verbatim from `game.js:24-33`; names/flavor text moved from `game.html:22-41`.

```js
// Deck rules, starter decks, validation, and custom-deck persistence.
// Validation functions are pure (node-testable). localStorage helpers are
// browser-only — never called at module top level.
import { CARDS, CARD_BY_ID } from './cards.js?v=1783511053';

export const DECK_RULES = {
  apBudget: 50,
  maxCopiesCommon: 2,
  maxCopiesRare: 1,
  minCards: 15, // guardrail: 4-card opening hand + ~1 draw/turn over 8-10 turns
};

export const STARTER_DECKS = [
  {
    key: 'aggro', name: 'Hammer Strike',
    flavor: 'Bombard units deal hits on placement. Double Attack finishers close the game. Draw fast, destroy everything.',
    ids: [5,5, 42,42, 40,40, 19,19, 22,22, 10,10, 59,59, 81,81, 4,4, 13,13, 61,61, 52,52, 8,8],
  },
  {
    key: 'control', name: 'Iron Fortress',
    flavor: "Armor and Guard wall. Bombard can't suppress Heavy Armor. Guard nullifies Double Attack. Hold objectives, outlast.",
    ids: [65,65, 6,6, 36,36, 11,11, 39,39, 63,63, 2,2, 75,75, 74,74, 49,49, 54,54, 16,16, 57,57],
  },
  {
    key: 'counter', name: 'Blitz Breaker',
    flavor: 'Four Guard unit types wall off Double Attack. Armor absorbs Bombard. Cheap flood, full draw engine, Overrun punishes every kill.',
    ids: [2,2, 11,11, 36,36, 43,43, 6,6, 69,69, 5,5, 1,1, 34,34, 22,22, 19,19, 73,73, 51,51, 25,25, 81,81],
  },
  {
    key: 'power', name: 'Steel Column',
    flavor: 'Six Armor / Heavy Armor vehicles grind through hits. Supply Runner and Industrial Surge ramp Fuel, Armored Spearhead discounts Tanks, Hold the Line and Field Medic stabilize.',
    ids: [63,63, 66,66, 65,65, 39,39, 6,6, 9,9, 5,5, 55,55, 25,25, 23,23, 76,76, 18,18],
  },
];

export function getDeckPool() {
  return CARDS.filter(c => c.type !== 'objective');
}

export function computeDeckAP(ids) {
  return ids.reduce((sum, id) => sum + (CARD_BY_ID[id]?.ap ?? 0), 0);
}

export function countCopies(ids) {
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

export function copyCap(card) {
  return card.rarity === 'Rare' ? DECK_RULES.maxCopiesRare : DECK_RULES.maxCopiesCommon;
}

// Returns { valid, errors: string[], ap }. Checks every rule so the UI can
// show all problems at once, not just the first.
export function validateDeck(ids) {
  const errors = [];

  const unknown = [...new Set(ids.filter(id => !CARD_BY_ID[id]))];
  if (unknown.length) {
    errors.push(`Unknown card ids: ${unknown.join(', ')} — card list changed since this deck was saved.`);
  }

  const known = ids.filter(id => CARD_BY_ID[id]);
  if (known.some(id => CARD_BY_ID[id].type === 'objective')) {
    errors.push('Objectives cannot be put in a deck.');
  }

  const ap = computeDeckAP(known);
  if (ap > DECK_RULES.apBudget) {
    errors.push(`${ap} AP — exceeds the ${DECK_RULES.apBudget} AP budget.`);
  }

  if (ids.length < DECK_RULES.minCards) {
    errors.push(`${ids.length} cards — minimum is ${DECK_RULES.minCards}.`);
  }

  for (const [id, n] of Object.entries(countCopies(known))) {
    const card = CARD_BY_ID[id];
    const max = copyCap(card);
    if (n > max) errors.push(`${card.name}: ${n} copies — max ${max} for ${card.rarity}.`);
  }

  return { valid: errors.length === 0, errors, ap };
}

// ── Persistence (browser-only) ────────────────────────────────────────────────
const STORAGE_KEY = 'signal-custom-decks';

export function loadCustomDecks() {
  try {
    const decks = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(decks) ? decks : [];
  } catch {
    return [];
  }
}

// Saving under an existing name overwrites that deck.
export function saveCustomDeck(name, ids) {
  const decks = loadCustomDecks().filter(d => d.name !== name);
  decks.push({ name, ids });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

export function deleteCustomDeck(name) {
  const decks = loadCustomDecks().filter(d => d.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (CWD `digital/`): `node --test tests/`
Expected: PASS — 10 tests, 0 failures. (Node resolves the `./cards.js?v=…` import; query strings are legal in ESM file URLs.)

- [ ] **Step 5: Commit**

```bash
git add js/decks.js tests/decks.test.mjs
git commit -m "feat: add deck rules module with validation and custom-deck persistence"
```

---

### Task 2: Deck builder page markup + styles

**Files:**
- Create: `digital/deckbuilder.html`
- Modify: `digital/css/game.css` (append at end of file)

- [ ] **Step 1: Create `deckbuilder.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SIGNAL — Deck Builder</title>
  <link rel="stylesheet" href="css/game.css?v=1783511053">
</head>
<body>

  <button id="theme-toggle" class="theme-toggle">☾ LIGHT</button>

  <div class="db-page">
    <div class="db-header">
      <div>
        <div class="lobby-title" style="font-size:30px;">DECK BUILDER</div>
        <div class="lobby-subtitle">50 AP BUDGET · COMMON ×2 · RARE ×1</div>
      </div>
      <button class="btn btn-secondary" id="db-back">Main Menu</button>
    </div>

    <div class="db-columns">

      <!-- LEFT: card pool -->
      <div class="db-pool-panel">
        <div class="db-filters" id="db-filters">
          <button class="db-filter active" data-filter="all">ALL</button>
          <button class="db-filter" data-filter="unit">UNITS</button>
          <button class="db-filter" data-filter="command">COMMANDS</button>
          <button class="db-filter" data-filter="mission">MISSIONS</button>
        </div>
        <div class="db-pool" id="db-pool"></div>
      </div>

      <!-- RIGHT: working deck -->
      <div class="db-deck-panel">
        <input class="db-name-input" id="db-deck-name" placeholder="Deck name…" maxlength="24">
        <div class="db-stats">
          <span class="db-ap-meter" id="db-ap">0 / 50 AP</span>
          <span class="db-count" id="db-count">0 cards</span>
        </div>
        <div class="db-errors" id="db-errors" style="display:none"></div>
        <div class="db-deck-list" id="db-deck-list">
          <div class="db-empty" id="db-empty">Click cards on the left to add them.</div>
        </div>
        <div class="db-actions">
          <button class="btn btn-primary" id="db-save" disabled>Save Deck</button>
          <button class="btn btn-secondary" id="db-clear">Clear</button>
        </div>

        <div class="db-saved-title">SAVED DECKS</div>
        <div class="db-saved" id="db-saved"></div>

        <div class="db-saved-title">LOAD A STARTER AS BASE</div>
        <div class="db-saved" id="db-starters"></div>
      </div>

    </div>
  </div>

  <script type="module" src="./js/deckbuilder.js?v=1783511053"></script>

</body>
</html>
```

- [ ] **Step 2: Append deck builder styles to `css/game.css`**

Add at the very end of the file:

```css
/* ── Deck Builder ─────────────────────────────────────────────────────────── */
.db-page { max-width: 1150px; margin: 0 auto; padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 18px; }
.db-header { display: flex; justify-content: space-between; align-items: center; }
.db-columns { display: flex; gap: 16px; align-items: flex-start; }
.db-pool-panel { flex: 1.5; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.db-deck-panel { flex: 1; display: flex; flex-direction: column; gap: 10px; background: var(--bg-alt); border: 1px solid var(--border); border-radius: 4px; padding: 14px; position: sticky; top: 16px; }

.db-filters { display: flex; gap: 6px; }
.db-filter { background: var(--bg-alt); border: 1px solid var(--border); color: var(--text-b); font-size: 11px; letter-spacing: 1px; padding: 6px 14px; cursor: pointer; border-radius: 3px; font-family: 'Arial Narrow', Arial, sans-serif; }
.db-filter.active { border-color: var(--gold); color: var(--gold); }

.db-pool { display: flex; flex-direction: column; gap: 4px; max-height: 74vh; overflow-y: auto; padding-right: 4px; }
.db-card-row { display: flex; align-items: center; gap: 10px; background: var(--bg-alt); border: 1px solid var(--border); border-radius: 3px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.db-card-row:hover { border-color: var(--gold-dim); }
.db-card-row.maxed { opacity: 0.35; cursor: default; }
.db-card-row.maxed:hover { border-color: var(--border); }
.db-card-row .n { flex: 1; color: var(--text); font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-card-row .n .have { color: var(--gold); font-weight: normal; }
.db-card-row .meta { color: var(--text-c); font-size: 11px; white-space: nowrap; }
.db-card-row .sides { color: var(--text-b); font-family: monospace; font-size: 11px; min-width: 60px; text-align: right; }
.db-card-row .ap-tag { color: var(--gold); font-weight: bold; min-width: 40px; text-align: right; }

.db-name-input { background: var(--bg-deep); border: 1px solid var(--border); color: var(--text); font-size: 14px; padding: 8px 10px; border-radius: 3px; font-family: 'Arial Narrow', Arial, sans-serif; letter-spacing: 1px; }
.db-stats { display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; font-family: 'Arial Narrow', Arial, sans-serif; letter-spacing: 1px; }
.db-ap-meter { color: var(--gold); }
.db-ap-meter.over { color: var(--red); }
.db-count { color: var(--text-b); }

.db-errors { background: rgba(221,51,68,0.08); border: 1px solid var(--red); color: var(--red); font-size: 11px; padding: 8px 10px; border-radius: 3px; line-height: 1.6; }

.db-deck-list { display: flex; flex-direction: column; gap: 3px; max-height: 38vh; overflow-y: auto; }
.db-empty { color: var(--text-d); font-size: 11px; padding: 12px 0; text-align: center; }
.db-deck-row { display: flex; align-items: center; gap: 8px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 3px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.db-deck-row:hover { border-color: var(--red); }
.db-deck-row .n { flex: 1; color: var(--text); }
.db-deck-row .copies { color: var(--gold); font-weight: bold; }
.db-deck-row .ap-tag { color: var(--text-c); min-width: 40px; text-align: right; }

.db-actions { display: flex; gap: 8px; }
.db-saved-title { font-size: 11px; letter-spacing: 2px; color: var(--text-c); font-family: 'Arial Narrow', Arial, sans-serif; margin-top: 6px; }
.db-saved { display: flex; flex-direction: column; gap: 4px; }
.db-saved-row { display: flex; align-items: center; gap: 8px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 3px; padding: 6px 10px; font-size: 12px; }
.db-saved-row .n { flex: 1; color: var(--text); font-weight: bold; }
.db-saved-row .meta { color: var(--text-c); font-size: 11px; }
.db-saved-row button { background: none; border: 1px solid var(--border); color: var(--text-b); font-size: 10px; letter-spacing: 1px; padding: 3px 8px; cursor: pointer; border-radius: 2px; }
.db-saved-row button:hover { border-color: var(--gold); color: var(--gold); }
.db-saved-row button.del:hover { border-color: var(--red); color: var(--red); }

/* Lobby: invalid custom deck tile */
.deck-option.deck-invalid { opacity: 0.4; cursor: default; }
.deck-option.deck-invalid:hover { border-color: var(--border); box-shadow: none; }
```

- [ ] **Step 3: Verify the page renders (empty but styled)**

Run (CWD `digital/`): `npx serve . -p 3000` in the background, open `http://localhost:3000/deckbuilder.html` in a browser.
Expected: dark-themed page with header, filter buttons, empty pool and deck panels. Console shows a 404 for `js/deckbuilder.js` — that's next task.

- [ ] **Step 4: Commit**

```bash
git add deckbuilder.html css/game.css
git commit -m "feat: deck builder page markup and styles"
```

---

### Task 3: `js/deckbuilder.js` — builder logic

**Files:**
- Create: `digital/js/deckbuilder.js`

- [ ] **Step 1: Create `js/deckbuilder.js`**

```js
// Deck builder page. Pool on the left, working deck on the right.
// Copy-limit adds are blocked outright; AP overruns are allowed while editing
// (meter turns red) but block saving.
import { CARD_BY_ID } from './cards.js?v=1783511053';
import {
  getDeckPool, validateDeck, computeDeckAP, countCopies, copyCap,
  DECK_RULES, STARTER_DECKS, loadCustomDecks, saveCustomDeck, deleteCustomDeck,
} from './decks.js?v=1783511053';

let deckIds = [];
let filter = 'all';

const TYPE_ORDER = { unit: 0, command: 1, mission: 2 };

function esc(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function poolSorted() {
  return getDeckPool().slice().sort((a, b) =>
    (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) ||
    ((a.cls ?? '').localeCompare(b.cls ?? '')) ||
    (a.cost - b.cost) ||
    a.name.localeCompare(b.name));
}

function cardMeta(card) {
  if (card.type === 'unit') {
    const kw = Array.isArray(card.keyword) ? card.keyword.join(', ') : card.keyword;
    return `${card.cls}${card.rarity === 'Rare' ? ' · Rare' : ''}${kw ? ' · ' + kw : ''}`;
  }
  return card.type === 'command' ? 'Command' : 'Mission';
}

function renderPool() {
  const counts = countCopies(deckIds);
  document.getElementById('db-pool').innerHTML = poolSorted()
    .filter(c => filter === 'all' || c.type === filter)
    .map(c => {
      const have = counts[c.id] ?? 0;
      const maxed = have >= copyCap(c);
      const sides = c.type === 'unit' ? `${c.n}/${c.e}/${c.s}/${c.w}` : '';
      return `<div class="db-card-row${maxed ? ' maxed' : ''}" data-id="${c.id}">
        <span class="n">${esc(c.name)}${have ? ` <span class="have">×${have}</span>` : ''}</span>
        <span class="meta">${esc(cardMeta(c))}</span>
        <span class="sides">${sides}</span>
        <span class="meta">Fuel ${c.cost}</span>
        <span class="ap-tag">${c.ap} AP</span>
      </div>`;
    }).join('');
}

function renderDeck() {
  const counts = countCopies(deckIds);
  const listEl = document.getElementById('db-deck-list');
  const entries = Object.entries(counts)
    .map(([id, n]) => ({ card: CARD_BY_ID[id], n }))
    .sort((a, b) =>
      (TYPE_ORDER[a.card.type] - TYPE_ORDER[b.card.type]) ||
      (a.card.cost - b.card.cost) ||
      a.card.name.localeCompare(b.card.name));

  listEl.innerHTML = entries.length === 0
    ? '<div class="db-empty">Click cards on the left to add them.</div>'
    : entries.map(({ card, n }) =>
      `<div class="db-deck-row" data-id="${card.id}" title="Click to remove one copy">
        <span class="copies">×${n}</span>
        <span class="n">${esc(card.name)}</span>
        <span class="ap-tag">${card.ap * n} AP</span>
      </div>`).join('');
}

function renderStatus() {
  const v = validateDeck(deckIds);
  const apEl = document.getElementById('db-ap');
  apEl.textContent = `${v.ap} / ${DECK_RULES.apBudget} AP`;
  apEl.classList.toggle('over', v.ap > DECK_RULES.apBudget);
  document.getElementById('db-count').textContent = `${deckIds.length} cards`;

  const errEl = document.getElementById('db-errors');
  if (deckIds.length === 0 || v.valid) {
    errEl.style.display = 'none';
  } else {
    errEl.style.display = '';
    errEl.innerHTML = v.errors.map(esc).join('<br>');
  }

  const name = document.getElementById('db-deck-name').value.trim();
  document.getElementById('db-save').disabled = !(v.valid && name.length > 0);
}

function renderSaved() {
  const savedEl = document.getElementById('db-saved');
  const decks = loadCustomDecks();
  savedEl.innerHTML = decks.length === 0
    ? '<div class="db-empty">No saved decks yet.</div>'
    : decks.map(d =>
      `<div class="db-saved-row">
        <span class="n">${esc(d.name)}</span>
        <span class="meta">${d.ids.length} cards · ${computeDeckAP(d.ids)} AP</span>
        <button data-load="${esc(d.name)}">LOAD</button>
        <button class="del" data-del="${esc(d.name)}">DELETE</button>
      </div>`).join('');

  document.getElementById('db-starters').innerHTML = STARTER_DECKS.map(d =>
    `<div class="db-saved-row">
      <span class="n">${esc(d.name)}</span>
      <span class="meta">${d.ids.length} cards · ${computeDeckAP(d.ids)} AP</span>
      <button data-load-starter="${d.key}">LOAD</button>
    </div>`).join('');
}

function redraw() {
  renderPool();
  renderDeck();
  renderStatus();
}

// ── Events ────────────────────────────────────────────────────────────────────
document.getElementById('db-filters').addEventListener('click', e => {
  const btn = e.target.closest('.db-filter');
  if (!btn) return;
  filter = btn.dataset.filter;
  document.querySelectorAll('.db-filter').forEach(b => b.classList.toggle('active', b === btn));
  renderPool();
});

document.getElementById('db-pool').addEventListener('click', e => {
  const row = e.target.closest('.db-card-row');
  if (!row || row.classList.contains('maxed')) return;
  deckIds.push(Number(row.dataset.id));
  redraw();
});

document.getElementById('db-deck-list').addEventListener('click', e => {
  const row = e.target.closest('.db-deck-row');
  if (!row) return;
  const id = Number(row.dataset.id);
  const i = deckIds.indexOf(id);
  if (i !== -1) deckIds.splice(i, 1);
  redraw();
});

document.getElementById('db-deck-name').addEventListener('input', renderStatus);

document.getElementById('db-save').addEventListener('click', () => {
  const name = document.getElementById('db-deck-name').value.trim();
  if (!name || !validateDeck(deckIds).valid) return;
  saveCustomDeck(name, [...deckIds]);
  renderSaved();
  const btn = document.getElementById('db-save');
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = 'Save Deck'; }, 1200);
});

document.getElementById('db-clear').addEventListener('click', () => {
  deckIds = [];
  document.getElementById('db-deck-name').value = '';
  redraw();
});

document.getElementById('db-saved').addEventListener('click', e => {
  const loadName = e.target.dataset.load;
  const delName = e.target.dataset.del;
  if (loadName) {
    const deck = loadCustomDecks().find(d => d.name === loadName);
    if (!deck) return;
    deckIds = [...deck.ids];
    document.getElementById('db-deck-name').value = deck.name;
    redraw();
  } else if (delName) {
    deleteCustomDeck(delName);
    renderSaved();
  }
});

document.getElementById('db-starters').addEventListener('click', e => {
  const key = e.target.dataset.loadStarter;
  if (!key) return;
  const starter = STARTER_DECKS.find(d => d.key === key);
  deckIds = [...starter.ids];
  document.getElementById('db-deck-name').value = '';
  redraw();
});

document.getElementById('db-back').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// Theme toggle — same 'signal-theme' key as the other pages.
(function initTheme() {
  const saved = localStorage.getItem('signal-theme');
  if (saved === 'light') document.body.dataset.theme = 'light';
  const btn = document.getElementById('theme-toggle');
  btn.textContent = document.body.dataset.theme === 'light' ? '☀ DARK' : '☾ LIGHT';
  btn.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    document.body.dataset.theme = next;
    localStorage.setItem('signal-theme', next);
    btn.textContent = next === 'light' ? '☀ DARK' : '☾ LIGHT';
  });
})();

redraw();
renderSaved();
```

- [ ] **Step 2: Manual verification in browser**

With `npx serve . -p 3000` running, open `http://localhost:3000/deckbuilder.html` and check:
1. Pool lists all non-objective cards; filters work.
2. Clicking a card adds it; third click on a Common is blocked (row greys out at ×2); Field Commander greys out at ×1.
3. AP meter turns red past 50 and an error box appears; Save stays disabled.
4. With a legal deck (e.g. LOAD Hammer Strike starter) and a name typed, Save enables; saving shows "Saved ✓" and the deck appears under SAVED DECKS.
5. Reload the page — saved deck persists. LOAD restores it, DELETE removes it.

- [ ] **Step 3: Commit**

```bash
git add js/deckbuilder.js
git commit -m "feat: deck builder page logic — build, validate, save custom decks"
```

---

### Task 4: Lobby integration — custom decks selectable in game

**Files:**
- Modify: `digital/js/game.js:23-33` (delete `DECKS`), `digital/js/game.js:68-101` (click handler), imports at top
- Modify: `digital/game.html:19-43` (deck picker markup)

- [ ] **Step 1: Replace the hardcoded deck tiles in `game.html`**

Replace lines 19-43 (the whole `#deck-picker` div) with:

```html
    <!-- Step 1 & 2: Deck selection (tiles rendered by game.js from decks.js + localStorage) -->
    <div id="deck-picker">
      <div class="picker-label" id="picker-label">PLAYER 1 — CHOOSE YOUR DECK</div>
      <div class="deck-grid" id="deck-grid"></div>
      <div style="text-align:center; margin-top:16px;">
        <button class="btn btn-secondary" id="btn-open-builder">OPEN DECK BUILDER</button>
      </div>
    </div>
```

- [ ] **Step 2: Rework deck selection in `game.js`**

Add to the imports at the top of `game.js` (after the `debug.js` import on line 21):

```js
import { STARTER_DECKS, loadCustomDecks, validateDeck, computeDeckAP } from './decks.js?v=1783511053';
```

Replace the `DECKS` constant (lines 23-33) with:

```js
// ── Deck selection ────────────────────────────────────────────────────────────
// Tiles are rendered from STARTER_DECKS + saved custom decks. Custom decks are
// re-validated here because card data may have changed since they were saved.
// Starters keep data-deck="aggro" etc. — the selfplay harness clicks by that.
let deckChoices = []; // parallel to data-choice indices on the tiles

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function renderDeckGrid() {
  const grid = document.getElementById('deck-grid');
  grid.innerHTML = '';
  deckChoices = [];

  for (const d of STARTER_DECKS) {
    deckChoices.push(d.ids);
    grid.insertAdjacentHTML('beforeend',
      `<div class="deck-option" data-deck="${d.key}" data-choice="${deckChoices.length - 1}">
        <div class="deck-name">${escapeHtml(d.name)}</div>
        <div class="deck-flavor">${escapeHtml(d.flavor)}</div>
        <div class="deck-ap">${computeDeckAP(d.ids)} AP</div>
      </div>`);
  }

  for (const d of loadCustomDecks()) {
    const v = validateDeck(d.ids);
    if (v.valid) {
      deckChoices.push(d.ids);
      grid.insertAdjacentHTML('beforeend',
        `<div class="deck-option" data-choice="${deckChoices.length - 1}">
          <div class="deck-name">${escapeHtml(d.name)}</div>
          <div class="deck-flavor">Custom deck · ${d.ids.length} cards</div>
          <div class="deck-ap">${v.ap} AP</div>
        </div>`);
    } else {
      grid.insertAdjacentHTML('beforeend',
        `<div class="deck-option deck-invalid" title="${escapeHtml(v.errors.join(' '))}">
          <div class="deck-name">${escapeHtml(d.name)}</div>
          <div class="deck-flavor">INVALID — ${escapeHtml(v.errors[0])} Fix it in the Deck Builder.</div>
          <div class="deck-ap">${v.ap} AP</div>
        </div>`);
    }
  }
}

renderDeckGrid();
document.getElementById('btn-open-builder').addEventListener('click', () => {
  window.location.href = 'deckbuilder.html';
});
```

- [ ] **Step 3: Update the deck-grid click handler**

In the `#deck-grid` click listener (originally `game.js:68-101`), replace:

```js
  const option = e.target.closest('.deck-option');
  if (!option) return;
  const deck = DECKS[option.dataset.deck];
  if (!deck) return;
```

with:

```js
  const option = e.target.closest('.deck-option');
  if (!option || option.dataset.choice === undefined) return;
  const ids = deckChoices[Number(option.dataset.choice)];
  if (!ids) return;
```

Then in the same handler replace all four occurrences of `[...deck.ids]` with `[...ids]` (the P2-online branch, the P1-online branch, and the two local-play assignments for P1 and P2).

- [ ] **Step 4: Manual verification in browser**

With `npx serve . -p 3000` running, open `http://localhost:3000/game.html`:
1. All 4 starter tiles render with correct AP totals (48/50/40/50) and are pickable; a full local game still starts (pick 2 decks, map, mulligan appears).
2. A custom deck saved in Task 3 shows as a fifth tile and is pickable for either player.
3. Corrupt test: in DevTools run `localStorage.setItem('signal-custom-decks', JSON.stringify([{name:'Broken', ids:[999,1]}]))`, reload — "Broken" renders greyed out with the INVALID reason, clicking it does nothing.
4. OPEN DECK BUILDER button navigates to the builder.

- [ ] **Step 5: Run the existing selfplay harness to confirm no regression**

With serve still running (CWD `digital/`): `node selfplay_test.mjs 1`
Expected: completes one bot game without errors (it clicks starters via `data-deck`, which is preserved).

- [ ] **Step 6: Commit**

```bash
git add js/game.js game.html
git commit -m "feat: lobby renders starter + custom decks from decks.js, adds deck builder entry"
```

---

### Task 5: Main menu entry + pre-commit hook coverage

**Files:**
- Modify: `digital/index.html:17-30` (main buttons)
- Modify: `digital/.git/hooks/pre-commit`

- [ ] **Step 1: Add a Deck Builder tile to `index.html`**

Inside `<div class="deck-grid" id="main-buttons">`, after the `btn-join-option` div, add:

```html
      <div class="deck-option" id="btn-deckbuilder">
        <div class="deck-name">Deck Builder</div>
        <div class="deck-flavor">Build and save custom decks. 50 AP budget, copy limits enforced.</div>
      </div>
```

And in the inline module script, after the `btn-local` listener, add:

```js
    document.getElementById('btn-deckbuilder').addEventListener('click', () => {
      window.location.href = 'deckbuilder.html';
    });
```

- [ ] **Step 2: Extend the pre-commit hook to bump `?v=` in all HTML files**

The hook currently only rewrites `game.html`. Replace `.git/hooks/pre-commit` content with:

```sh
#!/bin/sh
# Auto-bump cache-busting version in all HTML pages and JS module imports on every commit
TIMESTAMP=$(date +%s)
sed -i "s/?v=[0-9]*/?v=$TIMESTAMP/g" *.html
find . -path './.git' -prune -o -path './node_modules' -prune -o -name "*.js" -print | xargs sed -i "s/?v=[0-9]*/?v=$TIMESTAMP/g"
git add *.html js/
```

(Also adds the `node_modules` prune that the original was missing.)

- [ ] **Step 3: Verify the hook**

Run (CWD `digital/`): `git commit --allow-empty -m "chore: test hook"` then `git show --stat HEAD`
Expected: commit succeeds; if any `?v=` values existed they are bumped uniformly across `game.html`, `deckbuilder.html`, and `js/*.js`. Then drop the test commit: `git reset --soft HEAD~1` if it only contains the bump noise, or keep it — either is fine.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: deck builder entry on main menu"
```

---

### Task 6: Playwright smoke test

**Files:**
- Create: `digital/deckbuilder_test.mjs`

- [ ] **Step 1: Create the smoke test**

Follows the existing `selfplay_test.mjs` pattern (assumes `npx serve . -p 3000` is running).

```js
// Smoke test: build a deck in the builder, save it, verify it's playable from the lobby.
// Requires the dev server: npx serve . -p 3000
// Run with: node deckbuilder_test.mjs
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
const DECK_NAME = 'Smoke Test Deck';
// 8 cheap Commons ×2 = 16 cards, well under 50 AP, no copy-limit issues
const CARD_NAMES = ['Rifle Squad', 'Riflemen', 'Scouts', 'Supply Runner',
  'Shock Troopers', 'Trench Runners', 'Light Skirmishers', 'Quartermaster'];

function fail(msg) { console.error(`FAIL: ${msg}`); process.exitCode = 1; }

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  // ── 1. Build and save ──
  await page.goto(`${BASE_URL}/deckbuilder.html`);
  await page.evaluate(() => localStorage.removeItem('signal-custom-decks'));
  await page.reload();

  for (const name of CARD_NAMES) {
    const row = page.locator('.db-card-row', { hasText: name }).first();
    await row.click();
    await row.click();
  }

  const count = await page.locator('#db-count').textContent();
  if (count !== '16 cards') fail(`expected 16 cards, got "${count}"`);

  await page.fill('#db-deck-name', DECK_NAME);
  const saveBtn = page.locator('#db-save');
  if (await saveBtn.isDisabled()) fail('Save disabled for a legal 16-card deck');
  await saveBtn.click();
  await page.waitForTimeout(100);

  const saved = await page.locator('#db-saved .db-saved-row', { hasText: DECK_NAME }).count();
  if (saved !== 1) fail('saved deck not listed after save');

  // ── 2. Copy-limit guard: third copy is blocked ──
  const rifle = page.locator('.db-card-row', { hasText: 'Rifle Squad' }).first();
  if (!(await rifle.getAttribute('class')).includes('maxed')) fail('Rifle Squad not maxed at 2 copies');

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
```

- [ ] **Step 2: Run it**

CWD `digital/`, with `npx serve . -p 3000` running in another terminal:

```bash
node deckbuilder_test.mjs
```

Expected: `PASS: deck builder smoke test`, exit code 0.

- [ ] **Step 3: Run the unit tests one more time**

```bash
node --test tests/
```

Expected: 10 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add deckbuilder_test.mjs
git commit -m "test: deck builder smoke test — build, save, play from lobby"
```

---

## Out of scope (deliberately)

- **Online custom decks work automatically** — deck ids already travel through Firebase as arrays; each player's saved decks live in their own browser. Nothing to build.
- **Deck export/import codes** (sharing decks between devices) — YAGNI until playtesters ask.
- **Card art / full card rendering in the pool** — rows with stats are enough for a prototype; the showroom page already exists for browsing visuals.
- **Bot support for custom decks in selfplay** — the harness keeps using starters via `data-deck`.
