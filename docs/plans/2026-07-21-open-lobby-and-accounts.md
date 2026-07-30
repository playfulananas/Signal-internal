# Open Lobby Browser + Anonymous Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "type a code to join" with a live, browsable list of open games on the SIGNAL main menu, give each player a lightweight anonymous identity (no password) so a display name can show in that list, and use that same identity to back up custom decks server-side.

**Architecture:** Firebase (already used for game-state sync) gains two new jobs: Anonymous Auth for identity, and two new Realtime Database paths — `openLobbies/{code}` (the browsable list) and `users/{uid}/decks` (deck backup). A new pure module `js/lobbies.js` handles stale-lobby filtering/sorting/display so it's unit-testable without a browser. A new `js/lobby-browser.js` drives the main menu page. `js/game.js` gets a small additive change so a lobby created from the browser (map already chosen) skips the existing map-picker screen. The existing code-share join flow and local play are untouched — this adds a path, it doesn't replace one.

**Tech Stack:** Vanilla ES modules, Firebase Realtime Database + Firebase Auth (Anonymous provider), `node --test` for unit tests, Playwright for the end-to-end smoke test.

**Design calls locked in this plan (flag to Filip if wrong):**
- The open lobby list shows host display name, map, and "waiting Xm" — **never** the host's deck. Deck choice stays exactly as secret as it is today (chosen after landing in `game.html`, same as local play). This was an explicit requirement from the brainstorming conversation.
- Identity is anonymous-auth-only: a stable ID per browser profile, with a user-settable display name. No password, no email, no cross-device sync of the identity itself — only within the same browser as long as its Firebase Auth session/localStorage survive. This matches "just ID works" from the conversation, not a full account system.
- Stale open lobbies (nobody joined) are hidden from the list after 10 minutes rather than actively deleted — no host-cancel button, no server cleanup job. Simplest thing that works for a small playtest audience; documented as a deliberate YAGNI cut.
- Joining claims the lobby (removes it from the open list) immediately on click, before the join even fully completes. Two people could theoretically click the same lobby in the same instant and race — acceptable for this scale, not solved with Firebase transactions here.
- The old "Create Game" (share a code) and "Join Game" (type a code) buttons stay. This is an additional path, not a replacement.

**Repo note:** the git repo is `digital/` itself. All `git` commands below run with `digital/` as CWD. The pre-commit hook auto-bumps `?v=` cache-busting params on every commit — when editing import lines that already have a `?v=...` value, keep whatever value is already in the file; don't hand-invent a version number, the hook normalizes it on commit anyway.

---

### Task 1: Anonymous auth + persisted display name

**Files:**
- Modify: `digital/js/firebase.js`

- [ ] **Step 1: Read the current file**

Read `digital/js/firebase.js` in full before editing — confirm the exact current `?v=` isn't relevant here (this file has no self-import) and note the existing import line for `firebase-database.js` so you add the auth import next to it, not in some other spot.

- [ ] **Step 2: Add the Firebase Auth import**

Add this import right after the existing `firebase-database.js` import line:

```js
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
```

(Version `10.12.0` matches the existing `firebase-app`/`firebase-database` imports already in this file — keep them in sync.)

- [ ] **Step 3: Initialize auth and add the identity functions**

Right after the existing `const db = getDatabase(app);` line, add:

```js
const auth = getAuth(app);
```

Then append these exports at the end of the file:

```js
// ── Identity (anonymous auth + local display name) ─────────────────────────────
// Signs in anonymously (idempotent — Firebase persists the session across
// reloads via its own storage, separate from localStorage) and fires
// callback(uid) once resolved. The uid is stable across reloads on the same
// browser profile, NOT across devices or after clearing site data — this is
// intentionally lightweight, not a full account system.
export function initAuth(callback) {
  onAuthStateChanged(auth, user => {
    if (user) callback(user.uid);
  });
  signInAnonymously(auth).catch(err => console.error('Anonymous sign-in failed', err));
}

const NAME_KEY = 'signal-display-name';

// Returns the saved display name, generating and persisting a default
// ("Player1234") the first time it's called so repeated calls are stable.
export function getDisplayName() {
  let name = localStorage.getItem(NAME_KEY);
  if (!name) {
    name = `Player${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(NAME_KEY, name);
  }
  return name;
}

export function setDisplayName(name) {
  if (!name) return;
  localStorage.setItem(NAME_KEY, name);
}
```

- [ ] **Step 4: Manual verification in browser**

Run (CWD `digital/`): `npx serve . -p 3000` in the background, open `http://localhost:3000/index.html`, open DevTools console, and run:

```js
const { initAuth, getDisplayName, setDisplayName } = await import('./js/firebase.js');
initAuth(uid => console.log('signed in as', uid));
```

Expected: logs a uid string (a long alphanumeric Firebase Auth UID) within ~1 second. Then run `getDisplayName()` — expect a `PlayerNNNN` string; run it again — expect the *same* string (proves persistence, not regeneration). Run `setDisplayName('Filip')` then `getDisplayName()` — expect `'Filip'`.

- [ ] **Step 5: Commit**

```bash
git add js/firebase.js
git commit -m "feat: anonymous auth + persisted display name"
```

---

### Task 2: `js/lobbies.js` — pure lobby-list helpers (+ unit tests)

**Files:**
- Create: `digital/js/lobbies.js`
- Create: `digital/tests/lobbies.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `digital/tests/lobbies.test.mjs`:

```js
// Unit tests for open-lobby list helpers. Run: node --test tests/lobbies.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStale, sortByNewest, formatWaiting } from '../js/lobbies.js';

test('filterStale keeps lobbies newer than 10 minutes', () => {
  const now = 1_000_000_000;
  const lobbies = [
    { id: 'a', createdAt: now - 5 * 60000 },  // 5 min old — kept
    { id: 'b', createdAt: now - 11 * 60000 }, // 11 min old — dropped
    { id: 'c', createdAt: now - 60000 },      // 1 min old — kept
  ];
  const result = filterStale(lobbies, now);
  assert.deepEqual(result.map(l => l.id), ['a', 'c']);
});

test('filterStale drops entries with no createdAt (still resolving serverTimestamp)', () => {
  const result = filterStale([{ id: 'x', createdAt: null }], 1_000_000_000);
  assert.deepEqual(result, []);
});

test('sortByNewest orders newest first without mutating the input', () => {
  const lobbies = [
    { id: 'old', createdAt: 100 },
    { id: 'new', createdAt: 300 },
    { id: 'mid', createdAt: 200 },
  ];
  const sorted = sortByNewest(lobbies);
  assert.deepEqual(sorted.map(l => l.id), ['new', 'mid', 'old']);
  assert.deepEqual(lobbies.map(l => l.id), ['old', 'new', 'mid']); // original untouched
});

test('formatWaiting reports "just now" for anything under a minute', () => {
  const now = 1_000_000_000;
  assert.equal(formatWaiting(now - 30000, now), 'just now');
});

test('formatWaiting reports whole minutes for older lobbies', () => {
  const now = 1_000_000_000;
  assert.equal(formatWaiting(now - 4 * 60000, now), 'waiting 4m');
});

test('formatWaiting falls back to "just now" while createdAt is still unresolved', () => {
  assert.equal(formatWaiting(null, 1_000_000_000), 'just now');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (CWD `digital/`): `node --test tests/lobbies.test.mjs`
Expected: FAIL — `Cannot find module '../js/lobbies.js'`

- [ ] **Step 3: Create `js/lobbies.js`**

```js
// Pure helpers for the open-lobby browser. Firebase I/O (create/remove/subscribe)
// lives in firebase.js — this file only shapes and filters the data.
const STALE_MS = 10 * 60 * 1000; // hide lobbies nobody joined after 10 minutes

export function filterStale(lobbies, nowMs = Date.now()) {
  return lobbies.filter(l => typeof l.createdAt === 'number' && (nowMs - l.createdAt) < STALE_MS);
}

export function sortByNewest(lobbies) {
  return [...lobbies].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// createdAt may briefly be null/non-numeric right after creation, before
// Firebase's serverTimestamp() placeholder resolves to a real value.
export function formatWaiting(createdAt, nowMs = Date.now()) {
  if (typeof createdAt !== 'number') return 'just now';
  const mins = Math.floor((nowMs - createdAt) / 60000);
  return mins < 1 ? 'just now' : `waiting ${mins}m`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (CWD `digital/`): `node --test tests/lobbies.test.mjs`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add js/lobbies.js tests/lobbies.test.mjs
git commit -m "feat: add pure lobby-list helpers (stale filter, sort, waiting-time display)"
```

---

### Task 3: Firebase I/O for open lobbies + per-user decks (+ manual rules step)

**Files:**
- Modify: `digital/js/firebase.js`

- [ ] **Step 1: Add `serverTimestamp` to the existing database import**

Find the existing import line:

```js
import { getDatabase, ref, set, get, onValue, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
```

Replace it with:

```js
import { getDatabase, ref, set, get, onValue, update, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
```

- [ ] **Step 2: Append the open-lobby and per-user-deck functions**

Add at the end of the file (after Task 1's identity exports):

```js
// ── Open lobby list ──────────────────────────────────────────────────────────
// createdAt uses serverTimestamp() so every client agrees on lobby age
// regardless of local clock skew — it resolves to a plain number once Firebase
// commits it, which is what subscribeOpenLobbies' listeners will see.
export async function createOpenLobby(lobbyId, hostUid, hostName, mapId) {
  await set(ref(db, `openLobbies/${lobbyId}`), { hostUid, hostName, mapId, createdAt: serverTimestamp() });
}

export async function removeOpenLobby(lobbyId) {
  await set(ref(db, `openLobbies/${lobbyId}`), null);
}

// Returns the unsubscribe function. Callback receives an array of
// { id, hostUid, hostName, mapId, createdAt }.
export function subscribeOpenLobbies(callback) {
  return onValue(ref(db, 'openLobbies'), snap => {
    const val = snap.val() ?? {};
    callback(Object.entries(val).map(([id, data]) => ({ id, ...data })));
  });
}

// ── Per-user saved decks (backup of the localStorage custom decks) ─────────────
export async function pushUserDecks(uid, decks) {
  await set(ref(db, `users/${uid}/decks`), decks);
}

export async function fetchUserDecks(uid) {
  const snap = await get(ref(db, `users/${uid}/decks`));
  if (!snap.exists()) return [];
  const val = snap.val();
  // Firebase can return a sparse array as an object keyed by index — normalize.
  return Array.isArray(val) ? val : Object.values(val);
}
```

- [ ] **Step 3: Manual step — update Firebase Realtime Database rules (Firebase Console, not code)**

This step is done in the Firebase Console, not this repo — flag it to Filip rather than attempting it via any CLI, since it changes a live shared project's access rules. Go to **Firebase Console → your project (signal-prototype-1eead) → Realtime Database → Rules**, and merge in (don't blindly overwrite if other rules already exist — ask Filip to confirm current rules first, since none are checked into this repo):

```json
{
  "rules": {
    "games": {
      ".read": true,
      ".write": true
    },
    "openLobbies": {
      ".read": true,
      ".write": true
    },
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

`games` and `openLobbies` stay world-readable/writable, matching how the project already behaves today (no rules file exists in the repo, so it's presumably running on permissive test-mode rules already — this doesn't tighten anything that currently works). The only new restriction is `users/{uid}`, which requires being signed in as that exact uid — this is what keeps one browser from overwriting another's deck backup.

Also in **Firebase Console → Authentication → Sign-in method**, confirm the **Anonymous** provider is enabled (it usually isn't by default) — toggle it on if not.

- [ ] **Step 4: Manual verification in browser**

With rules updated and Anonymous auth enabled, `npx serve . -p 3000`, open `http://localhost:3000/index.html`, DevTools console:

```js
const { initAuth, createOpenLobby, subscribeOpenLobbies, pushUserDecks, fetchUserDecks } = await import('./js/firebase.js');
let myUid;
initAuth(uid => { myUid = uid; });
```

Wait ~1s for sign-in, then:

```js
await createOpenLobby('TEST01', myUid, 'DebugHost', 'kursk');
subscribeOpenLobbies(list => console.log(list));
```

Expected: logs an array containing `{ id: 'TEST01', hostUid: <uid>, hostName: 'DebugHost', mapId: 'kursk', createdAt: <number> }`.

```js
await pushUserDecks(myUid, [{ name: 'Test', ids: [1,1,2,2] }]);
console.log(await fetchUserDecks(myUid));
```

Expected: logs `[{ name: 'Test', ids: [1,1,2,2] }]`.

Clean up the test lobby: `const { removeOpenLobby } = await import('./js/firebase.js'); await removeOpenLobby('TEST01');`

- [ ] **Step 5: Commit**

```bash
git add js/firebase.js
git commit -m "feat: Firebase I/O for open lobby list and per-user deck backup"
```

---

### Task 4: Server-synced custom decks

**Files:**
- Modify: `digital/js/decks.js`
- Modify: `digital/tests/decks.test.mjs`
- Modify: `digital/js/deckbuilder.js`

- [ ] **Step 1: Write the failing test**

Read the current `digital/tests/decks.test.mjs` first to confirm its import line, then add `mergeRemoteDecks` to it:

```js
import {
  DECK_RULES, STARTER_DECKS, getDeckPool,
  computeDeckAP, countCopies, validateDeck, mergeRemoteDecks,
} from '../js/decks.js';
```

Append this test at the end of the file:

```js
test('mergeRemoteDecks adds remote decks not present locally, without overwriting name clashes', () => {
  const local = [{ name: 'Mine', ids: [1, 1] }];
  const remote = [{ name: 'Mine', ids: [2, 2] }, { name: 'FromOtherSession', ids: [5, 5] }];
  const merged = mergeRemoteDecks(local, remote);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.find(d => d.name === 'Mine').ids, [1, 1]); // local wins on a name clash
  assert.ok(merged.find(d => d.name === 'FromOtherSession'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (CWD `digital/`): `node --test tests/decks.test.mjs`
Expected: FAIL — `mergeRemoteDecks is not a function` (or similar import error).

- [ ] **Step 3: Add the merge function and a bulk setter to `js/decks.js`**

Read the current file first to confirm `deleteCustomDeck` is still the last function (Task 1 of the deck-builder plan put it there). Append after it:

```js

// Overwrites the full local deck list — used when merging in server-synced decks.
export function replaceAllCustomDecks(decks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

// Adds remote decks the local list doesn't already have (matched by name).
// Never overwrites a local deck on a name clash — an in-progress local edit
// always wins over whatever's on the server.
export function mergeRemoteDecks(localDecks, remoteDecks) {
  const localNames = new Set(localDecks.map(d => d.name));
  const additions = remoteDecks.filter(d => !localNames.has(d.name));
  return [...localDecks, ...additions];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (CWD `digital/`): `node --test tests/decks.test.mjs`
Expected: PASS — 11 tests, 0 failures.

- [ ] **Step 5: Wire sync into `js/deckbuilder.js`**

Read the current file first (it was written verbatim from an earlier plan) and confirm these anchors still match before editing.

Replace the import block at the top:

```js
import { CARD_BY_ID } from './cards.js?v=1783511053';
import {
  getDeckPool, validateDeck, computeDeckAP, countCopies, copyCap,
  DECK_RULES, STARTER_DECKS, loadCustomDecks, saveCustomDeck, deleteCustomDeck,
} from './decks.js?v=1783511053';

let deckIds = [];
let filter = 'all';
```

with:

```js
import { CARD_BY_ID } from './cards.js?v=1783511053';
import {
  getDeckPool, validateDeck, computeDeckAP, countCopies, copyCap,
  DECK_RULES, STARTER_DECKS, loadCustomDecks, saveCustomDeck, deleteCustomDeck,
  mergeRemoteDecks, replaceAllCustomDecks,
} from './decks.js?v=1783511053';
import { initAuth, pushUserDecks, fetchUserDecks } from './firebase.js?v=1783511053';

let deckIds = [];
let filter = 'all';
let currentUid = null; // set once anonymous auth resolves; enables server-side deck sync
```

(Keep whatever `?v=...` value is already present in the file for each import — don't invent a new number; the pre-commit hook normalizes it on commit.)

Find the Save button handler:

```js
document.getElementById('db-save').addEventListener('click', () => {
  const name = document.getElementById('db-deck-name').value.trim();
  if (!name || !validateDeck(deckIds).valid) return;
  saveCustomDeck(name, [...deckIds]);
  renderSaved();
  const btn = document.getElementById('db-save');
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = 'Save Deck'; }, 1200);
});
```

Add a sync call right after `saveCustomDeck(...)`:

```js
document.getElementById('db-save').addEventListener('click', () => {
  const name = document.getElementById('db-deck-name').value.trim();
  if (!name || !validateDeck(deckIds).valid) return;
  saveCustomDeck(name, [...deckIds]);
  syncDecksToServer();
  renderSaved();
  const btn = document.getElementById('db-save');
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = 'Save Deck'; }, 1200);
});
```

Find the saved-decks click handler's delete branch:

```js
  } else if (delName) {
    deleteCustomDeck(delName);
    renderSaved();
  }
```

Add a sync call there too:

```js
  } else if (delName) {
    deleteCustomDeck(delName);
    syncDecksToServer();
    renderSaved();
  }
```

Add this helper function anywhere above where it's first used (e.g. right after the `redraw()` function definition):

```js
function syncDecksToServer() {
  if (!currentUid) return; // auth hasn't resolved yet — the deck stays local-only until it does
  pushUserDecks(currentUid, loadCustomDecks()).catch(err => console.error('Deck sync failed', err));
}
```

Finally, find the last two lines of the file:

```js
redraw();
renderSaved();
```

Replace with:

```js
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
```

- [ ] **Step 6: Manual verification in browser**

With Task 3's Firebase rules already applied, `npx serve . -p 3000`, open `http://localhost:3000/deckbuilder.html`. Build and save a deck (name it "SyncTest"). Open DevTools console and confirm no errors logged. Then run in console:

```js
const { fetchUserDecks } = await import('./js/firebase.js');
const uid = (await new Promise(r => { import('./js/firebase.js').then(m => m.initAuth(r)); }));
console.log(await fetchUserDecks(uid));
```

Expected: includes `{ name: 'SyncTest', ids: [...] }`. Then reload the page — "SyncTest" should still be listed under SAVED DECKS (this doesn't prove server round-trip by itself since localStorage alone would also show it — the real proof is the console check above showing it landed in Firebase).

- [ ] **Step 7: Commit**

```bash
git add js/decks.js tests/decks.test.mjs js/deckbuilder.js
git commit -m "feat: sync custom decks to Firebase, keyed by anonymous identity"
```

---

### Task 5: `game.js` — skip the map-picker when a lobby already fixed the map

**Files:**
- Modify: `digital/js/game.js`

- [ ] **Step 1: Read the current file and confirm anchors**

Read `digital/js/game.js` in full. Find the online-mode constants block (search for `const isOnline`), the `#deck-grid` click listener's P1-online branch, and the `#map-grid` click listener. Line numbers have shifted since earlier plans touched this file — match by content, not by the numbers below.

- [ ] **Step 2: Add the `urlMapId` constant**

Find:

```js
const params  = new URLSearchParams(window.location.search);
const isOnline = !!params.get('game');
const gameId   = params.get('game') ?? null;
const myRole   = params.get('role') ?? null; // 'p1' | 'p2' | null for local play
```

Replace with:

```js
const params  = new URLSearchParams(window.location.search);
const isOnline = !!params.get('game');
const gameId   = params.get('game') ?? null;
const myRole   = params.get('role') ?? null; // 'p1' | 'p2' | null for local play
const urlMapId = params.get('mapId') ?? null; // set when this game came from the open-lobby browser — the map was already chosen there, so skip the map-picker
```

- [ ] **Step 3: Extract the host-wait logic into `beginHostWait`, and call it from both places that need it**

Find the `#map-grid` click listener:

```js
document.getElementById('map-grid').addEventListener('click', e => {
  const option = e.target.closest('.deck-option');
  if (!option || !option.dataset.map) return;
  const mapId = option.dataset.map;

  if (isOnline && myRole === 'p1') {
    // Push lobby state to games/${gameId} and wait for P2's ready response
    pushState(gameId, { _phase: 'lobby', p1Deck: p1DeckIds, mapId });
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'flex';
    document.getElementById('waiting-msg').textContent = 'Waiting for Player 2 to choose their deck...';
    subscribeState(gameId, data => {
      if (state) return; // already started
      if (data._phase !== 'ready' || !data.p2Deck) return;
      const toArr = v => Array.isArray(v) ? v : Object.values(v ?? {});
      startGame(toArr(data.p1Deck), toArr(data.p2Deck), data.mapId);
    });
    return;
  }

  startGame(p1DeckIds, p2DeckIds, mapId);
});
```

Replace with:

```js
// Pushes P1's lobby state (deck + map) and waits for P2 to finish picking
// their deck. Used both by the map-picker (legacy code-share flow, where the
// host picks the map here) and directly from the deck-grid handler when the
// map was already fixed by the open-lobby browser (urlMapId is set).
function beginHostWait(mapId) {
  pushState(gameId, { _phase: 'lobby', p1Deck: p1DeckIds, mapId });
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('waiting-screen').style.display = 'flex';
  document.getElementById('waiting-msg').textContent = 'Waiting for Player 2 to choose their deck...';
  subscribeState(gameId, data => {
    if (state) return; // already started
    if (data._phase !== 'ready' || !data.p2Deck) return;
    const toArr = v => Array.isArray(v) ? v : Object.values(v ?? {});
    startGame(toArr(data.p1Deck), toArr(data.p2Deck), data.mapId);
  });
}

document.getElementById('map-grid').addEventListener('click', e => {
  const option = e.target.closest('.deck-option');
  if (!option || !option.dataset.map) return;

  if (isOnline && myRole === 'p1') { beginHostWait(option.dataset.map); return; }

  startGame(p1DeckIds, p2DeckIds, option.dataset.map);
});
```

Now find the `#deck-grid` click listener's P1-online branch:

```js
  if (isOnline && myRole === 'p1') {
    p1DeckIds = [...ids];
    document.getElementById('deck-picker').style.display = 'none';
    document.getElementById('map-picker').style.display = '';
    return;
  }
```

Replace with:

```js
  if (isOnline && myRole === 'p1') {
    p1DeckIds = [...ids];
    document.getElementById('deck-picker').style.display = 'none';
    if (urlMapId) { beginHostWait(urlMapId); return; }
    document.getElementById('map-picker').style.display = '';
    return;
  }
```

(`beginHostWait` is a hoisted function declaration, so it's callable here even though its definition sits later in the file — no reordering needed.)

- [ ] **Step 4: Manual verification in browser**

`npx serve . -p 3000`, open two tabs.

Tab A (simulating a lobby-browser-created hosted game — normally `js/lobby-browser.js` would build this URL, but for this task's verification, construct it by hand): `http://localhost:3000/game.html?game=MANUAL1&role=p1&mapId=kursk`. Pick any starter deck. Expected: **map-picker never appears** — it goes straight to the waiting screen ("Waiting for Player 2 to choose their deck...").

Tab B: `http://localhost:3000/game.html?game=MANUAL1&role=p2`. Pick any starter deck. Expected: both tabs proceed to their mulligan screens and the game starts on Kursk.

Then re-verify the **old** flow still works unchanged: Tab A `http://localhost:3000/index.html` → Create Game → note the code → pick a deck. Expected: map-picker **does** appear (no `mapId` in the URL this time), confirming the legacy path is untouched.

- [ ] **Step 5: Commit**

```bash
git add js/game.js
git commit -m "feat: skip map-picker in online play when the map was already chosen by the open-lobby browser"
```

---

### Task 6: Open lobby browser UI on the main menu

**Files:**
- Modify: `digital/index.html`
- Create: `digital/js/lobby-browser.js`
- Modify: `digital/css/game.css`

- [ ] **Step 1: Read the current `index.html`**

Read `digital/index.html` in full — this task moves its inline `<script type="module">` block out into a new external file and adds markup for the name input, host button, inline map picker, and lobby list.

- [ ] **Step 2: Replace the body markup**

Replace everything from `<div id="join-form" ...>` through the closing of the inline `<script type="module">` block (i.e. keep `#lobby`, `#main-buttons` and their three existing buttons exactly as they are — only what comes after changes) with:

```html
    <div id="name-panel" style="margin-top:24px; display:flex; align-items:center; gap:10px; justify-content:center;">
      <span style="font-size:11px; color:#777; letter-spacing:1px; font-family:'Arial Narrow',Arial,sans-serif;">YOUR NAME</span>
      <input id="display-name-input" type="text" maxlength="16" placeholder="Player"
        style="background:#0e0c09; border:1px solid #3a3020; color:#d4c8a8; padding:6px 10px; border-radius:3px; font-family:'Arial Narrow',Arial,sans-serif;">
    </div>

    <div id="open-lobby-section" style="margin-top:24px; width:100%; max-width:520px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span class="picker-label" style="margin:0;">OPEN LOBBIES</span>
        <button class="btn btn-secondary" id="btn-host-open">HOST OPEN GAME</button>
      </div>
      <div id="open-lobby-map-picker" style="display:none; margin-bottom:14px;">
        <div class="picker-label">CHOOSE MAP FOR YOUR LOBBY</div>
        <div class="deck-grid" id="open-lobby-map-grid">
          <div class="deck-option" data-map="normandy"><div class="deck-name">Normandy</div></div>
          <div class="deck-option" data-map="stalingrad"><div class="deck-name">Stalingrad</div></div>
          <div class="deck-option" data-map="el_alamein"><div class="deck-name">El Alamein</div></div>
          <div class="deck-option" data-map="ardennes"><div class="deck-name">Ardennes</div></div>
          <div class="deck-option" data-map="kursk"><div class="deck-name">Kursk</div></div>
        </div>
      </div>
      <div id="open-lobby-list"></div>
    </div>

    <div id="join-form" style="display:none; flex-direction:column; align-items:center; gap:16px; margin-top:32px;">
      <input id="code-input" type="text" placeholder="XXXXXX" maxlength="6"
        style="font-size:28px; letter-spacing:8px; text-transform:uppercase; padding:14px 28px;
               background:#0e0c09; border:1px solid #3a3020; color:#d4c8a8; border-radius:3px;
               text-align:center; width:220px; font-family:'Arial Narrow',Arial,sans-serif;">
      <button class="btn btn-primary" id="btn-join">JOIN GAME</button>
    </div>

    <div id="create-panel" style="display:none; flex-direction:column; align-items:center; gap:16px; margin-top:32px;">
      <div style="font-size:11px; color:#3a3020; letter-spacing:3px; font-family:'Arial Narrow',Arial,sans-serif;">SHARE THIS CODE WITH YOUR OPPONENT</div>
      <div id="game-code-display" style="font-size:52px; font-weight:bold; letter-spacing:12px; color:#c49a28; font-family:'Arial Narrow',Arial,sans-serif;"></div>
      <div style="font-size:11px; color:#3a3020;">When they join, click Enter Game to pick decks and map.</div>
      <button class="btn btn-primary" id="btn-enter-game">Enter Game</button>
    </div>
  </div>

  <script type="module" src="./js/lobby-browser.js?v=1783511053"></script>

</body>
</html>
```

(Note: this closes `#lobby` with `</div>` right after the `create-panel` block, same as the original file — check the original's closing tags match this structure before assuming; adjust only if the actual current file nests differently.)

- [ ] **Step 3: Create `js/lobby-browser.js`**

This carries over the existing inline script's logic verbatim (local play, create-by-code, join-by-code, theme toggle) and adds the new open-lobby browser on top.

```js
// Main menu script: local play + code-based create/join (unchanged behavior,
// moved out of an inline <script> tag) plus the open-lobby browser (host a
// lobby with a fixed map, browse and join others without typing a code).
import { generateGameCode, initAuth, getDisplayName, setDisplayName,
         createOpenLobby, removeOpenLobby, subscribeOpenLobbies } from './firebase.js?v=1783511053';
import { filterStale, sortByNewest, formatWaiting } from './lobbies.js?v=1783511053';
import { MAPS } from './maps.js?v=1783511053';

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// ── Local play + code-based create/join (unchanged from the original inline script) ──
document.getElementById('btn-local').addEventListener('click', () => {
  window.location.href = 'game.html';
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
  window.location.href = `game.html?game=${code}&role=p2`;
});

document.getElementById('code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

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
```

- [ ] **Step 4: Append lobby-list styles to `css/game.css`**

Find the end of the file — it currently ends with the Deck Builder styles block added by an earlier plan, whose last two lines are:

```css
.deck-option.deck-invalid { opacity: 0.4; cursor: default; }
.deck-option.deck-invalid:hover { border-color: var(--border); box-shadow: none; }
```

Append after those lines:

```css

/* ── Open Lobby Browser ───────────────────────────────────────────────────── */
.lobby-row { display: flex; align-items: center; gap: 10px; background: var(--bg-alt); border: 1px solid var(--border); border-radius: 3px; padding: 8px 12px; margin-bottom: 6px; cursor: pointer; font-size: 12px; }
.lobby-row:hover { border-color: var(--gold-dim); }
.lobby-row .host { flex: 1; color: var(--text); font-weight: bold; }
.lobby-row .map { color: var(--text-b); }
.lobby-row .waiting { color: var(--text-c); font-size: 11px; }
.lobby-empty { color: var(--text-d); font-size: 11px; text-align: center; padding: 16px 0; }
```

- [ ] **Step 5: Manual verification in browser**

With Task 1-5 already in place and Firebase rules updated, `npx serve . -p 3000`, open two separate browser windows (not just tabs — use a regular window and an Incognito/private window so they get independent anonymous auth sessions) to `http://localhost:3000/index.html`.

In window A: set the name field to "Alice". Click HOST OPEN GAME, pick Kursk. Expected: navigates to `game.html?game=<code>&role=p1&mapId=kursk` and the deck-picker appears (no map-picker).

In window B: expected within a couple seconds, a row appears under OPEN LOBBIES showing "Alice", "Kursk", and a waiting time — and **no deck information**. Click the row. Expected: navigates to `game.html?game=<code>&role=p2&mapId=kursk`, deck-picker appears. Pick a deck in both windows — expected: both proceed to mulligan and the game starts on Kursk.

Back in window A's original tab (still on `index.html` if you opened a third tab) or a fresh tab to `index.html`: expected the lobby row for Alice's game is now gone (claimed by window B).

- [ ] **Step 6: Commit**

```bash
git add index.html js/lobby-browser.js css/game.css
git commit -m "feat: open lobby browser on the main menu — host, browse, and join without a code"
```

---

### Task 7: End-to-end Playwright smoke test

**Files:**
- Create: `digital/open_lobby_test.mjs`

- [ ] **Step 1: Create the smoke test**

This test hits the live Firebase project (there's no local emulator configured in this repo), so it's a real network-dependent smoke test, not a hermetic unit test — some slack in the timeouts is deliberate.

```js
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
```

- [ ] **Step 2: Run it**

CWD `digital/`, with `npx serve . -p 3000` running in another terminal:

```bash
node open_lobby_test.mjs
```

Expected: `PASS: open lobby smoke test`, exit code 0. If it fails, check the failure message first — Firebase network latency can occasionally need the timeouts nudged up, but a repeated failure at the same step points at a real bug, not flakiness.

- [ ] **Step 3: Re-run the full unit test suite**

```bash
node --test tests/decks.test.mjs tests/lobbies.test.mjs
```

Expected: 17 tests total (11 from `decks.test.mjs` + 6 from `lobbies.test.mjs`), 0 failures.

- [ ] **Step 4: Commit**

```bash
git add open_lobby_test.mjs
git commit -m "test: open lobby end-to-end smoke test — host, browse, join, deck secrecy, game start"
```

---

## Out of scope (deliberately)

- **Cross-device deck sync** — identity is per-browser (anonymous auth), not a portable account. Building a deck on your phone won't show up on your laptop. Solving this needs real accounts (email/password or a provider login), which was explicitly the heavier option Filip chose not to take.
- **Host-cancel button** — an abandoned lobby just ages out of the list after 10 minutes (`filterStale`) rather than being actively deleted when the host leaves. Add a cancel button later if playtesters find 10 minutes annoying.
- **Race-condition handling for simultaneous joins** — two players clicking the same lobby at the same instant isn't resolved with a Firebase transaction. Fine at this scale; revisit if it actually happens.
- **Lobby filtering/sorting by map** — with 5 maps and a small player pool, a flat newest-first list is enough.
- **Server-side display name storage** — the name lives in `localStorage` only; clearing it resets to a fresh random default. Not synced to `users/{uid}` since nothing else needs it there yet.
