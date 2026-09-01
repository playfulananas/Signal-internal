// Deck builder page. Pool on the left, working deck on the right.
// Copy-limit adds are blocked outright; going over/under 30 cards is allowed
// while editing (meter turns red) but blocks saving.
import { CARD_BY_ID } from './cards.js?v=1788267223';
import {
  getDeckPool, getHeroPool, validateDeck, validateHeroRoster, countCopies, copyCap,
  DECK_RULES, STARTER_DECKS, loadCustomDecks, saveCustomDeck, deleteCustomDeck,
  mergeRemoteDecks, replaceAllCustomDecks,
} from './decks.js?v=1788267223';
import { initAuth, pushUserDecks, fetchUserDecks } from './firebase.js?v=1788267223';

let deckIds = [];
let heroIds = [];
let filter = 'all';
let currentUid = null; // set once anonymous auth resolves; enables server-side deck sync

const TYPE_ORDER = { unit: 0, command: 1 }; // mission dropped 2026-07-30 — Missions retired (Batch 1), never in the pool

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
  return 'Command'; // only unit/command ever reach the pool now — hero/objective/retired are filtered out
}

function heroPoolSorted() {
  return getHeroPool().slice().sort((a, b) =>
    a.scope.localeCompare(b.scope) ||
    a.rarity.localeCompare(b.rarity) ||
    a.name.localeCompare(b.name));
}

function renderHeroPool() {
  document.getElementById('db-pool').innerHTML = heroPoolSorted().map(h => {
    const already = heroIds.includes(h.id);
    const full = heroIds.length >= DECK_RULES.heroRosterSize;
    const maxed = already || full;
    const cost = h.powerType === 'active' ? `Active ${h.activeCost}F` : 'Passive';
    return `<div class="db-card-row${maxed ? ' maxed' : ''}" data-id="${h.id}" title="${esc(h.ability)}">
      <span class="n">${esc(h.name)}${already ? ' <span class="have">✓</span>' : ''}</span>
      <span class="meta">Hero · ${esc(h.rarity)}</span>
      <span class="sides">${h.scope.toUpperCase()}</span>
      <span class="meta">${esc(cost)}</span>
    </div>`;
  }).join('');
}

function renderPool() {
  if (filter === 'hero') { renderHeroPool(); return; }
  const counts = countCopies(deckIds);
  document.getElementById('db-pool').innerHTML = poolSorted()
    .filter(c => filter === 'all' || c.type === filter)
    .map(c => {
      const have = counts[c.id] ?? 0;
      const maxed = have >= copyCap(c);
      const sides = c.type === 'unit' ? `${c.n}/${c.e}/${c.s}/${c.w}` : '';
      const tip = c.type === 'command' ? ` title="${esc(c.effect)}"` : '';
      return `<div class="db-card-row${maxed ? ' maxed' : ''}" data-id="${c.id}"${tip}>
        <span class="n">${esc(c.name)}${have ? ` <span class="have">×${have}</span>` : ''}</span>
        <span class="meta">${esc(cardMeta(c))}</span>
        <span class="sides">${sides}</span>
        <span class="meta">Fuel ${c.cost}</span>
      </div>`;
    }).join('');
}

function renderDeck() {
  const counts = countCopies(deckIds);
  const listEl = document.getElementById('db-deck-list');
  const entries = Object.entries(counts)
    .filter(([id]) => CARD_BY_ID[id]) // skip ids no longer in the card list — validateDeck's error box explains why
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
      </div>`).join('');
}

function renderHeroList() {
  const listEl = document.getElementById('db-hero-list');
  const heroes = heroIds.map(id => CARD_BY_ID[id]).filter(Boolean);
  listEl.innerHTML = heroes.length === 0
    ? '<div class="db-empty">Click Heroes on the left to add them.</div>'
    : heroes.map(h =>
      `<div class="db-deck-row" data-id="${h.id}" title="Click to remove">
        <span class="ap-tag">${h.scope.toUpperCase()}</span>
        <span class="n">${esc(h.name)}</span>
      </div>`).join('');
}

function renderStatus() {
  const v = validateDeck(deckIds);
  const countEl = document.getElementById('db-ap');
  countEl.textContent = `${deckIds.length} / ${DECK_RULES.deckSize} cards`;
  countEl.classList.toggle('over', deckIds.length !== DECK_RULES.deckSize);

  const hv = validateHeroRoster(heroIds);
  const heroCountEl = document.getElementById('db-hero-count');
  heroCountEl.textContent = `${heroIds.length} / ${DECK_RULES.heroRosterSize} heroes`;
  heroCountEl.classList.toggle('over', heroIds.length !== DECK_RULES.heroRosterSize);

  const errEl = document.getElementById('db-errors');
  const showDeckErrors = deckIds.length > 0 && !v.valid;
  const showHeroErrors = heroIds.length > 0 && !hv.valid;
  if (!showDeckErrors && !showHeroErrors) {
    errEl.style.display = 'none';
  } else {
    errEl.style.display = '';
    errEl.innerHTML = [...(showDeckErrors ? v.errors : []), ...(showHeroErrors ? hv.errors : [])].map(esc).join('<br>');
  }

  const name = document.getElementById('db-deck-name').value.trim();
  document.getElementById('db-save').disabled = !(v.valid && hv.valid && name.length > 0);
}

function renderSaved() {
  const savedEl = document.getElementById('db-saved');
  const decks = loadCustomDecks();
  savedEl.innerHTML = decks.length === 0
    ? '<div class="db-empty">No saved decks yet.</div>'
    : decks.map(d =>
      `<div class="db-saved-row">
        <span class="n">${esc(d.name)}</span>
        <span class="meta">${d.ids.length} cards · ${(d.heroIds ?? []).length}/${DECK_RULES.heroRosterSize} heroes</span>
        <button data-load="${esc(d.name)}">LOAD</button>
        <button class="del" data-del="${esc(d.name)}">DELETE</button>
      </div>`).join('');

  document.getElementById('db-starters').innerHTML = STARTER_DECKS.map(d =>
    `<div class="db-saved-row">
      <span class="n">${esc(d.name)}</span>
      <span class="meta">${d.ids.length} cards</span>
      <button data-load-starter="${d.key}">LOAD</button>
    </div>`).join('');
}

function redraw() {
  renderPool();
  renderDeck();
  renderHeroList();
  renderStatus();
}

function syncDecksToServer() {
  if (!currentUid) return; // auth hasn't resolved yet — the deck stays local-only until it does
  pushUserDecks(currentUid, loadCustomDecks()).catch(err => console.error('Deck sync failed', err));
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
  const id = Number(row.dataset.id);
  if (filter === 'hero') heroIds.push(id); else deckIds.push(id);
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

document.getElementById('db-hero-list').addEventListener('click', e => {
  const row = e.target.closest('.db-deck-row');
  if (!row) return;
  const id = Number(row.dataset.id);
  const i = heroIds.indexOf(id);
  if (i !== -1) heroIds.splice(i, 1);
  redraw();
});

document.getElementById('db-deck-name').addEventListener('input', renderStatus);

document.getElementById('db-save').addEventListener('click', () => {
  const name = document.getElementById('db-deck-name').value.trim();
  if (!name || !validateDeck(deckIds).valid || !validateHeroRoster(heroIds).valid) return;
  saveCustomDeck(name, [...deckIds], [...heroIds]);
  syncDecksToServer();
  renderSaved();
  const btn = document.getElementById('db-save');
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = 'Save Deck'; }, 1200);
});

document.getElementById('db-clear').addEventListener('click', () => {
  deckIds = [];
  heroIds = [];
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
    heroIds = [...(deck.heroIds ?? [])];
    document.getElementById('db-deck-name').value = deck.name;
    redraw();
  } else if (delName) {
    deleteCustomDeck(delName);
    syncDecksToServer();
    renderSaved();
  }
});

document.getElementById('db-starters').addEventListener('click', e => {
  const key = e.target.dataset.loadStarter;
  if (!key) return;
  const starter = STARTER_DECKS.find(d => d.key === key);
  deckIds = [...starter.ids];
  heroIds = [...(starter.heroIds ?? [])];
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

// Pull any decks saved from another session under this browser's anonymous
// identity and merge them in without clobbering an in-progress local deck.
initAuth(uid => {
  currentUid = uid;
  fetchUserDecks(uid).then(remoteDecks => {
    const merged = mergeRemoteDecks(loadCustomDecks(), remoteDecks);
    replaceAllCustomDecks(merged);
    renderSaved();
  }).catch(err => console.error('Deck fetch failed', err));
});
