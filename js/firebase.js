import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, set, get, onValue, update, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// Paste your Firebase project config here (from Firebase Console → Project Settings)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDmLHLBwzuc4g54Cs8UIXUVGzLefLmmkFk",
  authDomain: "signal-prototype-1eead.firebaseapp.com",
  databaseURL: "https://signal-prototype-1eead-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "signal-prototype-1eead",
  storageBucket: "signal-prototype-1eead.firebasestorage.app",
  messagingSenderId: "969963486327",
  appId: "1:969963486327:web:045b7848084335ffbb5a72",
};

const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);
const auth = getAuth(app);

export function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function pushState(gameId, state) {
  await set(ref(db, `games/${gameId}`), state);
}

export async function fetchState(gameId) {
  const snap = await get(ref(db, `games/${gameId}`));
  return snap.exists() ? snap.val() : null;
}

// Returns the unsubscribe function.
export function subscribeState(gameId, callback) {
  const r = ref(db, `games/${gameId}`);
  return onValue(r, snap => {
    if (snap.exists()) callback(snap.val());
  });
}

export async function setPlayerLeft(gameId, role) {
  await update(ref(db, `games/${gameId}`), { _playerLeft: role });
}

// Lobby: pre-game coordination (deck choices, map). Uses update() so both
// players can write their own fields without overwriting each other's.
export async function updateLobby(gameId, data) {
  await update(ref(db, `lobbies/${gameId}`), data);
}

export function subscribeLobby(gameId, callback) {
  return onValue(ref(db, `lobbies/${gameId}`), snap => {
    if (snap.exists()) callback(snap.val());
  });
}

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
