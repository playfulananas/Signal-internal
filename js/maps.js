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
    objectiveSlots: ["0,0", "0,2", "1,1", "3,2"],
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
    objectiveSlots: ["2,2"],
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
    objectiveSlots: ["0,1", "1,2", "3,2"],
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
    objectiveSlots: ["1,0", "2,3"],
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
