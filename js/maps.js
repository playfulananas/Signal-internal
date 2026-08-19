// Map definitions for SIGNAL.
// grid: [row][col], row 0 = top (P2 side), row 3 = bottom (P1 side).
// Terrain types: 'plains' | 'forest' | 'desert' | 'city' | 'water'
//
// Placement rules (enforced in game.html):
//   water  → Naval, Aircraft, or Airborne keyword only
//   forest → no Tank class (Airborne bypasses)
//   desert / city / plains → any unit

const P = 'plains', F = 'forest', D = 'desert', C = 'city', W = 'water';

export const MAPS = {
  normandy: {
    name: "Normandy",
    flavor: "Beach landings. Bocage forest blocks tanks top-right. Naval units hold the left flank.",
    grid: [
      [P, P, F, F],
      [P, P, F, F],
      [P, P, P, P],
      [W, W, P, P],
    ],
    objectiveSlots: ["0,2", "1,0", "3,3"],
  },
  stalingrad: {
    name: "Stalingrad",
    flavor: "Heavy urban combat. Volga River seals the entire right flank — Naval and Aircraft only.",
    grid: [
      [C, C, C, W],
      [C, P, C, W],
      [P, C, C, W],
      [P, P, C, W],
    ],
    objectiveSlots: ["0,0", "3,2"],
  },
  el_alamein: {
    name: "El Alamein",
    flavor: "Open desert. No terrain restrictions — vehicles dominate wide-open ground.",
    grid: [
      [D, D, D, D],
      [D, D, D, D],
      [D, D, D, D],
      [D, D, D, D],
    ],
    objectiveSlots: ["0,0", "0,3", "3,0", "3,3"],
  },
  ardennes: {
    name: "Ardennes",
    flavor: "Dense forest with two narrow corridors. Tanks are nearly useless here.",
    grid: [
      [F, P, F, F],
      [F, P, F, F],
      [F, F, P, F],
      [F, F, P, F],
    ],
    // "1,2" and "2,1" sit in the central forest, each touching BOTH plains corridors
    // (1,2 is adjacent to 1,1 and 2,2; 2,1 is adjacent to 1,1 and 2,2) — contestable from
    // either corridor without an objective tile ever sitting ON the path itself and
    // narrowing it further. Per Filip 2026-08-19.
    objectiveSlots: ["1,2", "2,1"],
  },
  kursk: {
    name: "Kursk",
    flavor: "Open center, forest corners. The great tank battle — wide open plains for armored warfare.",
    grid: [
      [F, P, P, F],
      [P, P, P, P],
      [P, P, P, P],
      [F, P, P, F],
    ],
    // Diagonal pair, top-left to bottom-right, within the open-plains center (clear of the
    // forest corners) — trimmed from the 4-corner rectangle down to 2. Per Filip 2026-08-19.
    objectiveSlots: ["1,0", "2,3"],
  },
  midway: {
    name: "Midway",
    flavor: "Open ocean. No land at all — Naval, Aircraft, and Airborne units only.",
    grid: [
      [W, W, W, W],
      [W, W, W, W],
      [W, W, W, W],
      [W, W, W, W],
    ],
    // 4, dead center (the 2x2 middle block) — the carrier task forces converging. Per Filip 2026-08-19.
    objectiveSlots: ["1,1", "1,2", "2,1", "2,2"],
    // Factory (26, category "Economy/Vehicle") buffs Tanks; City (31, "Infantry/Defense") buffs
    // Infantry — both dead weight here since neither class can ever be placed on 100% water.
    // Per Filip 2026-08-19. Only 3 of the 5 working objectives remain valid for 4 slots, so one
    // objective type repeats among Midway's slots — see the % in pickObjectives (game.js),
    // already built to handle a map needing more slots than its available pool.
    objectiveExclude: [26, 31],
  },
};

export function getTerrain(mapId, row, col) {
  return MAPS[mapId]?.grid[row]?.[col] ?? 'plains';
}

// Returns true if the card can legally be placed on terrainType.
export function canPlaceOnTerrain(card, terrainType) {
  if (!card) return false;
  if (card.keyword === 'Airborne') return true;       // Airborne bypasses all terrain
  if (terrainType === 'water') {
    return card.cls === 'Naval' || card.cls === 'Aircraft';
  }
  if (terrainType === 'forest') {
    return card.cls !== 'Tank';
  }
  return true;  // plains, desert, city — unrestricted
}
