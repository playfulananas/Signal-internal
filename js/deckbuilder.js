// Deck builder page. Pool on the left, working deck on the right.
// Copy-limit adds are blocked outright; AP overruns are allowed while editing
// (meter turns red) but block saving.
import { CARD_BY_ID } from './cards.js?v=1784635080';
import {
  getDeckPool, validateDeck, computeDeckAP, countCopies, copyCap,
  DECK_RULES, STARTER_DECKS, loadCustomDecks, saveCustomDeck, deleteCustomDeck,
} from './decks.js?v=1784635080';

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
