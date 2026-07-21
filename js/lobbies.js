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
