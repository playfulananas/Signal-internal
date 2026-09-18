// Deck rules, starter decks, validation, and custom-deck persistence.
// Validation functions are pure (node-testable). localStorage helpers are
// browser-only — never called at module top level.
import { CARDS, CARD_BY_ID } from './cards.js?v=2026090402';

export const DECK_RULES = {
  deckSize: 30, // v0.4 fixed deck size (2026-07-30) — replaces the old 50-AP budget model. Exact, not a ceiling.
  maxCopiesCommon: 2,
  maxCopiesRare: 1,
  heroRosterSize: 4, // separate from deckSize — Heroes are never shuffled into the main deck (see getDeckPool)
};

// Replaced 2026-08-31 (Run 1 of the SIGNAL Claude Handoff surgical update) with the exact 8
// recommended Set 1 decks from the authoritative "SIGNAL_Set1_RecommendedDecksList" Google
// Sheet (spreadsheet id 1hFLSH4vPkPSnT3SL9v_42SI6gZThtCVx9oOhRXXbAj0) — per Denis's explicit
// correction during Run 1 planning, starter decks must come from this source, not invented
// same-role substitutions. Every id/copy count/Hero roster below is transcribed directly from
// that spreadsheet's 8 deck tabs, cross-referenced against the new cards.js id scheme.
// 2026-09-18: decks 01, 02, 03, 04 and 07 replaced with Denis's optimized v1 playtest lists
// (SIGNAL_*_Handoff.docx, 17 Sep 2026). Keys unchanged; 05, 06 and 08 still match the sheet.
export const STARTER_DECKS = [
  {
    key: 'infantry-formation', name: '01 Infantry Aggro',
    flavor: 'Cheap Infantry -> card flow -> Fuel acceleration -> wide buffs -> repeated pressure.',
    ids: ['I1','I1', 'I6','I6', 'I7','I7', 'I9','I9', 'I12','I12', 'I15', 'I18','I18', 'I13','I13', 'I20','I20', 'I21', 'C24','C24', 'C03','C03', 'C04','C04', 'C25','C25', 'C23','C23', 'C26','C26'],
    heroIds: ['H08', 'H11', 'H21', 'H15'], // Infantry Commander, Field Coordinator, Emergency Logistics Officer, Strike Commander
  },
  {
    key: 'tank-blitz', name: '02 Tank Blitz',
    flavor: 'Cheap Guard -> Tank acceleration -> Armor durability -> Breakthrough pressure -> sustained control.',
    ids: ['I6','I6', 'I7', 'T28','T28', 'T32','T32', 'T25','T25', 'T29','T29', 'T33','T33', 'T36','T36', 'T30','T30', 'T34','T34', 'T38', 'C28','C28', 'C29','C29', 'C13', 'C10','C10', 'C23', 'C21','C21'],
    heroIds: ['H07', 'H05', 'H21', 'H15'], // Armored Commander, Recovery Officer, Emergency Logistics Officer, Strike Commander
  },
  {
    key: 'artillery-fire-control', name: '03 Artillery Fire Control',
    flavor: 'Cheap protection -> rotate / maneuver -> remove Suppression -> Precision / Barrage / Blast -> reliable firing lines.',
    ids: ['I6','I6', 'AR43','AR43', 'AR46','AR46', 'AR50','AR50', 'AR48','AR48', 'AR51','AR51', 'AR44','AR44', 'AR47','AR47', 'AR45','AR45', 'C01','C01', 'C16','C16', 'C31','C31', 'C08','C08', 'C21','C21', 'C30','C30'],
    heroIds: ['H18', 'H11', 'H16', 'H13'], // Artillery Commander, Field Coordinator, Maneuver Commander, Supreme Commander
  },
  {
    key: 'air-superiority', name: '04 Aircraft Craft Aggro',
    flavor: 'Fuel setup -> turn-2 Chief Aircraft Engineer -> repeated Craft -> 1-Fuel Aircraft swarm -> explosive multi-attack finish.',
    ids: ['I6','I6', 'A55','A55', 'A60','A60', 'A56','A56', 'A58','A58', 'A62','A62', 'A64', 'A57', 'A59','A59', 'A63','A63', 'A65', 'C13','C13', 'C04','C04', 'C14','C14', 'C23','C23', 'C34', 'C33','C33'],
    heroIds: ['H25', 'H21', 'H09', 'H16'], // Chief Aircraft Engineer, Emergency Logistics Officer, Command Specialist, Maneuver Commander
  },
  {
    key: 'last-stand-sacrifice', name: '05 Last Stand Sacrifice',
    flavor: 'Friendly destruction -> Last Stand value -> card / HQ conversion -> pressure.',
    ids: ['I18','I18', 'I19','I19', 'I22','I22', 'I6','I6', 'I7','I7', 'I12','I12', 'I13','I13', 'I15','I15', 'I1','I1', 'I21', 'I17', 'C18','C18', 'C19','C19', 'C05', 'C24', 'C26', 'C03', 'C12', 'C11'],
    heroIds: ['H14', 'H20', 'H08', 'H01'], // Graves Registration Officer, Ruthless Strategist, Infantry Commander, Quartermaster General
  },
  {
    key: 'command-engine', name: '06 Command Engine',
    flavor: 'Cheap Commands -> discounts -> card velocity -> Hero resets -> self-inflicted HQ pressure. 14 Units / 16 Commands.',
    ids: ['I1','I1', 'I6','I6', 'I12','I12', 'T23','T23', 'AR40','AR40', 'AR43','AR43', 'A54','A54', 'C04','C04', 'C05','C05', 'C13','C13', 'C14','C14', 'C17','C17', 'C23','C23', 'C03', 'C11', 'C16', 'C21'],
    heroIds: ['H09', 'H20', 'H21', 'H01'], // Command Specialist, Ruthless Strategist, Emergency Logistics Officer, Quartermaster General
  },
  {
    key: 'combined-arms', name: '07 Combined Arms Tempo',
    flavor: 'Cheap mixed-class board control -> Guard -> draw/cycle -> Maneuver -> Objective scaling -> sustained tempo.',
    ids: ['I6','I6', 'I7','I7', 'I9','I9', 'I12','I12', 'I18','I18', 'AR43','AR43', 'AR50','AR50', 'T28','T28', 'T32','T32', 'A55','A55', 'C03','C03', 'C05','C05', 'C21','C21', 'C22','C22', 'C10', 'C07'],
    heroIds: ['H04', 'H03', 'H12', 'H01'], // Objective Marshal, Tactical Commander, Fire Support Officer, Quartermaster General
  },
  {
    key: 'objective-tempo', name: '08 Objective Tempo',
    flavor: 'Contest early -> hold adjacency -> convert Objective control into HQ pressure and tempo.',
    ids: ['I1','I1', 'I6','I6', 'I9','I9', 'T28','T28', 'T37','T37', 'AR50','AR50', 'AR51','AR51', 'A55','A55', 'A56','A56', 'A64','A64', 'C22','C22', 'C03','C03', 'C10', 'C12', 'C16', 'C21', 'C09', 'C23'],
    heroIds: ['H04', 'H15', 'H17', 'H22'], // Objective Marshal, Strike Commander, HQ Assault Commander, Frontline Marshal
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

// doc 02 Q015 (locked): "Use card-level Allowed Copies... mostly 2, selected 1-copy Units...
// do not infer copy count from rarity." Read the card's own `copies` field directly. For the
// current 65-card pool this happens to always agree with a Rare=1/Common=2 rarity inference
// (verified: no card currently diverges), but relying on rarity was still the wrong migration
// per doc 02's explicit instruction — a future card with an off-rarity copy limit would have
// silently gotten the wrong cap. Fallback only covers a card missing the field entirely.
export function copyCap(card) {
  return card.copies ?? (card.rarity === 'Rare' ? DECK_RULES.maxCopiesRare : DECK_RULES.maxCopiesCommon);
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
