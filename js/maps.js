// Map definitions for SIGNAL.
// grid: [row][col], row 0 = top (P2 side), row 3 = bottom (P1 side).
// Terrain types: 'plains' | 'forest' | 'desert' | 'city'
//
// Run 2 (2026-08-31): rewired against doc 04 (SIGNAL Objectives & Maps Truth v1.0), which
// locks exactly 4 maps (Normandy and Midway are both cut — archived below, not deleted) and
// confirms "no Set 1 water/river/ocean terrain" as a hard rule (Naval is fully cut — see
// CLAUDE.md — so no class needs it). 'water' is removed as a terrain type entirely.
//
// Placement rules (enforced in canPlaceOnTerrain below):
//   forest → no Tank class (Airborne bypasses)
//   desert / city / plains → unrestricted (doc 04 §12: "Plain/Desert/City neutral")

const P = 'plains', F = 'forest', D = 'desert', C = 'city';

// Cut 2026-08-31 (Run 2): Normandy and Midway are not part of doc 04's locked 4-map list.
// Preserved here (not deleted) per the same archive-don't-delete convention as cards.js —
// see js/archive/legacy_cards.js's manifest for the card-side equivalent.
export const ARCHIVED_MAPS = {
  normandy: {
    name: "Normandy",
    flavor: "Beach landings. Bocage forest blocks tanks top-right. Naval units hold the left flank.",
    grid: [
      ['plains', 'plains', 'forest', 'forest'],
      ['plains', 'plains', 'forest', 'forest'],
      ['plains', 'plains', 'plains', 'plains'],
      ['water', 'water', 'plains', 'plains'],
    ],
    objectiveSlots: ["0,2", "1,0", "3,3"],
    archived: true,
    archiveReason: "Not one of doc 04's locked 4 maps (Stalingrad/Kursk/El Alamein/Ardennes) — cut 2026-08-31 Run 2.",
  },
  midway: {
    name: "Midway",
    flavor: "Open ocean. No land at all — Naval, Aircraft, and Airborne units only.",
    grid: [
      ['water', 'water', 'water', 'water'],
      ['water', 'water', 'water', 'water'],
      ['water', 'water', 'water', 'water'],
      ['water', 'water', 'water', 'water'],
    ],
    objectiveSlots: ["1,1", "1,2", "2,1", "2,2"],
    objectiveExclude: ['O1', 'O4'],
    archived: true,
    archiveReason: "Not one of doc 04's locked 4 maps, and doc 04 confirms Set 1 has no water terrain at all (Naval is fully cut) — cut 2026-08-31 Run 2.",
  },
};

export const MAPS = {
  stalingrad: {
    name: "Stalingrad — The Strongpoint",
    flavor: "One brutal central fight. Highest concentration on the board — control swings hard.",
    // DATA MIGRATION FLAG (doc 04 §17): the Volga River (water) column from the pre-Run-2
    // grid is gone — confirmed both by doc 04 ("no Set 1 water/river/ocean terrain") and by
    // the actual v1.1 map asset (SIGNAL_Set1_Map_Proposals_v1.1), which states Stalingrad's
    // theme outright as "City / Plain visual theme" with no water feature at all. The 4
    // former water cells below are set to 'plains' as a placeholder. Cosmetic-only, not a
    // correctness risk: the same doc states Plain/Desert/City are "currently
    // gameplay-equivalent neutral terrain" — an exact City/Plain checkerboard mismatch vs.
    // the source art changes nothing about how the map plays, only how it looks. Match the
    // v1.1 art's exact pattern whenever it's convenient, not before.
    grid: [
      [C, C, C, P],
      [C, P, C, P],
      [P, C, C, P],
      [P, P, C, P],
    ],
    // 1 slot, canonical label B2 → interior, 4 adjacent contest positions (doc 04 §13).
    objectiveSlots: ["1,1"],
  },
  kursk: {
    name: "Kursk — The Two Fronts",
    flavor: "Two separate fronts. Concentrate your army, or divide it?",
    grid: [
      [F, P, P, F],
      [P, P, P, P],
      [P, P, P, P],
      [F, P, P, F],
    ],
    // 2 slots, canonical labels A2 + D3 → both edge, 3 adjacent contest positions each
    // (doc 04 §14).
    objectiveSlots: ["1,0", "2,3"],
  },
  el_alamein: {
    name: "El Alamein — Strategic Priorities",
    flavor: "Which Objective is worth committing to? Desert itself stays neutral.",
    grid: [
      [D, D, D, D],
      [D, D, D, D],
      [D, D, D, D],
      [D, D, D, D],
    ],
    // 3 slots, canonical labels A4 (corner, 2 adjacent) + B2 (interior, 4) + C1 (edge, 3)
    // — doc 04 §15.
    objectiveSlots: ["3,0", "1,1", "0,2"],
  },
  ardennes: {
    name: "Ardennes — Wide Front",
    flavor: "Maximum board coverage pressure. Heavy Forest constrains Tank routes.",
    grid: [
      [F, P, F, F],
      [F, P, F, F],
      [F, F, P, F],
      [F, F, P, F],
    ],
    // 4 slots, canonical labels A2 + B4 + C1 + D3 → all edge, 3 adjacent contest positions
    // each (doc 04 §16).
    objectiveSlots: ["1,0", "3,1", "0,2", "2,3"],
  },
};

export function getTerrain(mapId, row, col) {
  return MAPS[mapId]?.grid[row]?.[col] ?? 'plains';
}

// Returns true if the card can legally be placed on terrainType.
export function canPlaceOnTerrain(card, terrainType) {
  if (!card) return false;
  if (card.keyword === 'Airborne') return true;       // Airborne bypasses all terrain
  if (terrainType === 'forest') {
    return card.cls !== 'Tank';
  }
  return true;  // plains, desert, city — unrestricted (doc 04 §12)
}
