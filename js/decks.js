// Deck rules, starter decks, validation, and custom-deck persistence.
// Validation functions are pure (node-testable). localStorage helpers are
// browser-only — never called at module top level.
import { CARDS, CARD_BY_ID } from './cards.js?v=1786664736';

export const DECK_RULES = {
  deckSize: 30, // v0.4 fixed deck size (2026-07-30) — replaces the old 50-AP budget model. Exact, not a ceiling.
  maxCopiesCommon: 2,
  maxCopiesRare: 1,
  heroRosterSize: 4, // separate from deckSize — Heroes are never shuffled into the main deck (see getDeckPool)
};

export const STARTER_DECKS = [
  {
    key: 'aggro', name: 'Hammer Strike',
    flavor: 'Bombard units deal hits on placement. Double Attack finishers close the game. Draw fast, destroy everything.',
    // Rebuilt to exactly 30 cards for the v0.4 fixed-deck model (2026-07-30) — Missions
    // stripped in Batch 1 (removed 2x Total Onslaught), then filled back up to 30 with
    // cheap aggressive Commons already on-theme (Storm Squad to 2x, Rifle Squad, Scouts,
    // Radio Operator) rather than reworking the deck's identity.
    ids: [5,5, 42,42, 40,40, 19,19, 22,22, 10,10, 59,59, 1,1, 34,34, 111,111, 4,4, 13,13, 61,61, 52,52, 8,8],
    // Fixed 4-Hero roster (not player-selectable yet — see Batch 4/5 scope notes in cards.js).
    // Rosters draw only from the implemented Tier 1 pool (see `implemented` in cards.js) so
    // every starter deck's Heroes actually do something. Reassigned 2026-08-03.
    heroIds: [92, 104, 110, 87], // Tactical Commander, Infantry Commander, Conventional Warfare Commander, Quartermaster General
  },
  {
    key: 'control', name: 'Iron Fortress',
    flavor: "Armor and Guard wall. Bombard can't suppress Heavy Armor. Guard nullifies Double Attack. Hold objectives, outlast.",
    // Rebuilt to exactly 30 cards (2026-07-30) — Missions stripped in Batch 1 (removed
    // 2x Fortify the Line), filled back up with more Guard/Armor Commons on-theme.
    ids: [65,65, 6,6, 36,36, 11,11, 39,39, 63,63, 2,2, 75,75, 74,74, 49,49, 54,54, 16,16, 43,43, 9,9, 66,66],
    heroIds: [94, 99, 100, 101], // Objective Marshal, Garrison Commander, Recovery Officer, Counteroffensive General
  },
  {
    key: 'counter', name: 'Blitz Breaker',
    flavor: 'Four Guard unit types wall off Double Attack. Armor absorbs Bombard. Cheap flood, full draw engine, Overrun punishes every kill.',
    // Rebuilt to exactly 30 cards (2026-07-30) — Missions stripped in Batch 1 (removed
    // 2x Blitz Assault, 2x Total Onslaught), filled back up with more cheap Guard bodies.
    ids: [2,2, 11,11, 36,36, 43,43, 6,6, 69,69, 5,5, 1,1, 34,34, 22,22, 19,19, 73,73, 51,51, 62,62, 112,112],
    heroIds: [87, 104, 101, 92], // Quartermaster General, Infantry Commander, Counteroffensive General, Tactical Commander
  },
  {
    key: 'power', name: 'Steel Column',
    flavor: 'Six Armor / Heavy Armor vehicles grind through hits. Supply Runner and Industrial Surge ramp Fuel, Field Medic stabilizes.',
    // Rebuilt to exactly 30 cards (2026-07-30) — Missions stripped in Batch 1 (removed
    // 2x Armored Spearhead, 2x Blitz Assault, 2x Hold the Line), filled back up with
    // heavier grind pieces on-theme. 2x Tank Destroyer (41) swapped for 2x Flak Halftrack
    // (40) on 2026-08-13 — Tank Destroyer retired along with Breakthrough (unbalanced as
    // vanilla); Flak Halftrack keeps the slot in-class (Tank) and fills a cost-2 curve gap.
    ids: [63,63, 66,66, 65,65, 39,39, 6,6, 9,9, 5,5, 76,76, 18,18, 45,45, 40,40, 117,117, 116,116, 64,64, 43,43],
    // Combined Arms General (109) retired 2026-08-14 — swapped for Recovery Officer (100),
    // a closer fit for a grind-and-outlast deck (pairs with Field Medic on Suppression removal).
    heroIds: [89, 103, 100, 107], // Logistics Chief, Armored Commander, Recovery Officer, Command Specialist
  },
];

export function getDeckPool() {
  return CARDS.filter(c => c.type !== 'objective' && c.type !== 'hero' && !c.retired);
}

// Heroes selectable for a Hero roster — only ones whose power actually does something.
// Unimplemented Heroes are fully hidden, not shown-disabled (mirrors getDeckPool's own
// !c.retired filter, and retired Heroes are already implemented:false so this is belt-
// and-suspenders against a future authoring mistake).
export function getHeroPool() {
  return CARDS.filter(c => c.type === 'hero' && c.implemented && !c.retired);
}

export function countCopies(ids) {
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

export function copyCap(card) {
  return card.rarity === 'Rare' ? DECK_RULES.maxCopiesRare : DECK_RULES.maxCopiesCommon;
}

// Returns { valid, errors: string[] }. Checks every rule so the UI can
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
  if (known.some(id => CARD_BY_ID[id].type === 'hero')) {
    errors.push('Heroes cannot be put in the 30-card deck — they belong to the separate Hero roster.');
  }

  const retired = [...new Set(known.filter(id => CARD_BY_ID[id].retired))];
  for (const id of retired) {
    errors.push(`${CARD_BY_ID[id].name}: retired, cannot be used in a deck.`);
  }

  if (ids.length !== DECK_RULES.deckSize) {
    errors.push(`${ids.length} cards — must be exactly ${DECK_RULES.deckSize}.`);
  }

  for (const [id, n] of Object.entries(countCopies(known))) {
    const card = CARD_BY_ID[id];
    const max = copyCap(card);
    if (n > max) errors.push(`${card.name}: ${n} copies — max ${max} for ${card.rarity}.`);
  }

  return { valid: errors.length === 0, errors };
}

// Returns { valid, errors: string[] }. A Hero roster is exactly 4 distinct Heroes —
// no duplicates (each Hero is a unique named character), separate from the 30-card deck.
export function validateHeroRoster(heroIds) {
  const errors = [];

  const unknown = [...new Set(heroIds.filter(id => !CARD_BY_ID[id]))];
  if (unknown.length) {
    errors.push(`Unknown hero ids: ${unknown.join(', ')}.`);
  }

  const known = heroIds.filter(id => CARD_BY_ID[id]);
  if (known.some(id => CARD_BY_ID[id].type !== 'hero')) {
    errors.push('Only Hero cards can be put in the Hero roster.');
  }

  const notImplemented = [...new Set(known.filter(id => CARD_BY_ID[id].implemented === false))];
  for (const id of notImplemented) {
    errors.push(`${CARD_BY_ID[id].name}: not yet implemented, cannot be used in a Hero roster.`);
  }

  if (heroIds.length !== DECK_RULES.heroRosterSize) {
    errors.push(`${heroIds.length} heroes — must be exactly ${DECK_RULES.heroRosterSize}.`);
  }

  const dupes = [...new Set(known.filter((id, i) => known.indexOf(id) !== i))];
  for (const id of dupes) {
    errors.push(`${CARD_BY_ID[id].name}: duplicate — a Hero roster cannot repeat the same Hero.`);
  }

  return { valid: errors.length === 0, errors };
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
export function saveCustomDeck(name, ids, heroIds = []) {
  const decks = loadCustomDecks().filter(d => d.name !== name);
  decks.push({ name, ids, heroIds });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

export function deleteCustomDeck(name) {
  const decks = loadCustomDecks().filter(d => d.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

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
