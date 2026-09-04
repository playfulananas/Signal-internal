// Main menu script: local play + code-based create/join + vs AI (unchanged
// behavior, moved out of an inline <script> tag) plus the open-lobby browser
// (host a lobby with a fixed map, browse and join others without typing a code).
import { generateGameCode, initAuth, getDisplayName, setDisplayName,
         createOpenLobby, removeOpenLobby, subscribeOpenLobbies } from './firebase.js?v=20260904';
import { filterStale, sortByNewest, formatWaiting } from './lobbies.js?v=20260904';
import { MAPS } from './maps.js?v=20260904';

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// ── Local play + code-based create/join + vs AI (unchanged from the original inline script) ──
document.getElementById('btn-local').addEventListener('click', () => {
  window.location.href = 'game.html';
});

document.getElementById('btn-deckbuilder').addEventListener('click', () => {
  window.location.href = 'deckbuilder.html';
});

document.getElementById('btn-ai').addEventListener('click', () => {
  window.location.href = 'game.html?ai=1';
});

document.getElementById('btn-create').addEventListener('click', () => {
  const code = generateGameCode();
  document.getElementById('game-code-display').textContent = code;
  document.getElementById('create-panel').style.display = 'flex';
  document.getElementById('main-buttons').style.display = 'none';
  document.getElementById('btn-enter-game').addEventListener('click', () => {
    window.location.href = `game.html?game=${code}&role=p1`;
  });
});

document.getElementById('btn-join-option').addEventListener('click', () => {
  document.getElementById('join-form').style.display = 'flex';
  document.getElementById('main-buttons').style.display = 'none';
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  if (code.length < 4) return;
  // Deliberately not pre-checking the code exists here: the host's own lobby write is
  // itself async, so a fast Join right after Create can race it and produce a false
  // "not found" for a code that's actually about to be valid. game.html's own
  // "Connecting..." screen has a timeout that surfaces a warning if the code truly
  // never resolves, without this race.
  window.location.href = `game.html?game=${code}&role=p2`;
});

document.getElementById('code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

// Theme toggle — same 'signal-theme' localStorage key as game.html, so the choice carries
// over. The attribute itself is already set by the inline blocking script at the top of
// <body> (before this deferred module script runs) — this just wires up the button.
(function initTheme() {
  const btn = document.getElementById('theme-toggle');
  btn.textContent = document.body.dataset.theme === 'light' ? '☀ DARK' : '☾ LIGHT';
  btn.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    document.body.dataset.theme = next;
    localStorage.setItem('signal-theme', next);
    btn.textContent = next === 'light' ? '☀ DARK' : '☾ LIGHT';
  });
})();

// ── Display name ─────────────────────────────────────────────────────────────
const nameInput = document.getElementById('display-name-input');
nameInput.value = getDisplayName();
nameInput.addEventListener('input', () => setDisplayName(nameInput.value.trim()));

// ── Auth + open lobby browser ─────────────────────────────────────────────────
let myUid = null;
let openLobbies = [];

initAuth(uid => {
  myUid = uid;
  subscribeOpenLobbies(lobbies => {
    openLobbies = lobbies;
    renderLobbyList();
  });
});

function renderLobbyList() {
  const listEl = document.getElementById('open-lobby-list');
  const live = sortByNewest(filterStale(openLobbies));
  if (live.length === 0) {
    listEl.innerHTML = '<div class="lobby-empty">No open lobbies right now. Host one!</div>';
    return;
  }
  listEl.innerHTML = live.map(l => `
    <div class="lobby-row" data-id="${l.id}">
      <span class="host">${escapeHtml(l.hostName ?? 'Player')}</span>
      <span class="map">${escapeHtml(MAPS[l.mapId]?.name ?? l.mapId)}</span>
      <span class="waiting">${formatWaiting(l.createdAt)}</span>
    </div>`).join('');
}

// Re-render every 30s so "waiting Xm" keeps ticking even with no new Firebase event.
setInterval(renderLobbyList, 30000);

document.getElementById('open-lobby-list').addEventListener('click', e => {
  const row = e.target.closest('.lobby-row');
  if (!row) return;
  const lobby = openLobbies.find(l => l.id === row.dataset.id);
  if (!lobby) return;
  // Claim it immediately (best-effort — no transaction; a simultaneous click
  // from two players is an accepted, unhandled edge case at this scale).
  removeOpenLobby(lobby.id);
  window.location.href = `game.html?game=${lobby.id}&role=p2&mapId=${lobby.mapId}`;
});

document.getElementById('btn-host-open').addEventListener('click', () => {
  document.getElementById('open-lobby-map-picker').style.display = '';
});

document.getElementById('open-lobby-map-grid').addEventListener('click', e => {
  const option = e.target.closest('.deck-option');
  if (!option || !option.dataset.map) return;
  const mapId = option.dataset.map;
  const code = generateGameCode();
  createOpenLobby(code, myUid, getDisplayName(), mapId).then(() => {
    window.location.href = `game.html?game=${code}&role=p1&mapId=${mapId}`;
  });
});
