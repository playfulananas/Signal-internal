// Deck rules, starter decks, validation, and custom-deck persistence.
// Validation functions are pure (node-testable). localStorage helpers are
// browser-only — never called at module top level.
import { CARDS, CARD_BY_ID } from './cards.js?v=1784633047';

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
