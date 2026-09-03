// Game state shape (canonical — see ARCHITECTURE.md):
// {
//   turn: number,               — starts at 1, increments on endTurn
//   initiative: "p1" | "p2",   — whose turn it is
//   phase: "play",              — reserved; always "play" for now
//   p2Joined: boolean,          — set by lobby when opponent joins
//
//   p1: PlayerState,
//   p2: PlayerState,
//
//   board: { [tileKey]: BoardUnit | null },   — tileKey = "row,col"
//   objectives: { [tileKey]: { cardId, level } },
//   log: string[],
//   pendingArtyHits: number,    — Artillery Position L2/L4 hits owed to `initiative` player, synced so the
//                                 controlling player's own client (not just whoever ended the prior turn)
//                                 enters targeting mode; 0 once resolved.
// }
//
// PlayerState: {
//   hq: number,                 — starts 30
//   fuel: number,               — capped at fuelCap (default 9)
//   fuelCap: number,            — per-player storage cap; a Hero can raise it
//   pendingFuelGain: number,    — delayed fuel (Industrial Surge), added at next startOfTurn
//   hand: number[],             — cardIds in hand
//   deck: number[],             — cardIds remaining (top = index 0)
//   missions: ActiveMission[],
//   pendingDiscounts: [{ appliesTo, column, amount, min }],  — unspent Fuel discounts
//   pendingUnitBuffs: [{ appliesTo, amount }],  — unspent stat buffs (Deathrattle: Convoy Escort)
//   fieldMarshalUses: number,   — Field Marshal (144) activation count this match, never reset
//   discardPile: number[],      — cardIds destroyed/resolved/discarded (doc 02 Q026-Q028): destroyed
//                                 Units, resolved Commands, and any card that would enter hand while
//                                 hand is already at the 10-card max. Tracked but currently has no
//                                 gameplay effect that reads it (no retrieval/counting/targeting) —
//                                 per doc 02 Q028, that's locked Set 1 truth, not a gap.
//   fatigueCount: number,       — failed draw-from-empty-deck attempts this match (doc 02 Q029-Q030).
//                                 Each attempt deals fatigueCount HQ damage (1, then 2, then 3...) —
//                                 see drawCards. Never resets.
// }
//
// ActiveMission: { cardId, killsAtDeploy? } — no turn limit; stays active until its reward fires.
// killsAtDeploy is only set for Total Onslaught (81), to track kills since THIS copy was played.
//
// BoardUnit: {
//   cardId: number,
//   owner: "p1" | "p2",
//   state: "normal" | "suppressed" | "destroyed",
//   armorHits: number,          — hits absorbed by armor so far
//   tempKeywords: string[],     — keywords added THIS TURN only (objective buffs, Entrench); cleared by endTurn
//   grantedKeywords: string[],  — keywords from commands lasting UNTIL OWNER'S NEXT TURN; cleared by startOfTurn
//   permanentKeywords: string[], — keywords granted for the rest of the match (Breakthrough's Armor/
//                                 Double Attack grants, Blitzkrieg Order, Field Repairs) — never
//                                 cleared by startOfTurn/endTurn, unlike the confusingly-similarly-
//                                 named grantedKeywords above. Added 2026-08-31: T34/T35/C27/C28 had
//                                 all been storing their permanent grants in grantedKeywords, which
//                                 silently wiped them the very next time the owner's turn started.
//   tempSideBonus: number,      — +N to all sides this turn
//   grantedSideBonus: number,   — +N to all sides from Rally Cry; lasts sideBonusTurns owner turn-starts
//   sideBonusTurns: number,     — turn-starts remaining before grantedSideBonus clears (Rally Cry = 2)
//   debugSideBonus: number,     — +/-N to all sides from the debug panel; persists until the tester
//                                 changes it back to 0, NOT cleared by normal turn logic
//   justPlaced: boolean,        — true only on the turn deployed; cleared by endTurn
//   rotation: number,           — 0/90/180/270, clockwise, set by Rotate-granting cards.
//                                 Which of the card's own N/E/S/W values lines up with a given
//                                 physical board side — see rotatedDir. Persists until
//                                 explicitly rotated again; never auto-clears.
//   persistentSpent: number,    — persistent attacks (Double Attack ? 2 : 1) used this turn;
//                                 reset to 0 at the owner's Refresh (startOfTurn) or by an
//                                 explicit attack-reset effect. See remainingAttacks/spendAttack.
//   tempExtraAttacks: number,   — additional attacks granted "this turn"/"until end of turn"
//                                 (Coordinated Strike, Air Strike, etc.); cleared at endTurn.
//   tempExtraAttacksSpent: number, — spent temporary extras; NOT recreated by an explicit
//                                 attack-reset (doc 01 §8 — reset restores persistent only).
//                                 Cleared alongside tempExtraAttacks at endTurn.
// }
//
// ATTACK-ALLOWANCE CONSUMPTION ORDER (locked, Run 1 correction 2026-08-31): an attack always
// draws from the persistent pool first, then the temporary pool — see spendAttack. An explicit
// "reset attacks" effect (e.g. Maneuver Commander, Scramble) zeroes persistentSpent only and
// never recreates an already-spent temporary extra attack.

import { CARD_BY_ID } from './cards.js?v=20260902';

// ── State factory ────────────────────────────────────────────────────────────

export function createInitialState(p1DeckIds, p2DeckIds, mapId = 'kursk', p1HeroIds = [], p2HeroIds = []) {
  return {
    _revision: 0,
    turn: 1,
    // Doc 02 Q005 (locked): first player is chosen randomly — "remove alternate-initiative or
    // predetermined first-player rules." Previously hardcoded to always be p1, missed by both
    // Run 1 and Run 2 since neither touched match-setup sequencing. Safe to randomize here even
    // for online play: only the host (p1's client) ever calls createInitialState — P2's client
    // receives the resulting state (including this field) via the normal Firebase push, so
    // there's no risk of the two clients independently rolling different results.
    initiative: Math.random() < 0.5 ? "p1" : "p2",
    phase: "play",
    p2Joined: false,
    mapId,
    p1: createPlayerState(p1DeckIds, p1HeroIds),
    p2: createPlayerState(p2DeckIds, p2HeroIds),
    board: Object.fromEntries(
      Array.from({ length: 4 }, (_, r) =>
        Array.from({ length: 4 }, (_, c) => [`${r},${c}`, null])
      ).flat()
    ),
    objectives: {},
    log: [],
    pendingArtyHits: 0,
    // Craft (H25) / Training Officer (H19) generated-card definitions, keyed by id — has to
    // travel in shared state so the OTHER client's CARD_BY_ID (per-client, in-memory only)
    // learns about a card it never itself registered. See ensureGeneratedCard (cards.js) and
    // normalizeFirebaseState (game.js).
    generatedCards: {},
    // Online simultaneous mulligan only (local/AI mode never touches this): false from creation
    // until the host runs the post-mulligan setup (objectives, first draw — see finishStartGame
    // in game.js), which flips it to true. Lets each client's ongoing-sync listener tell "still
    // in the pre-objectives mulligan phase" apart from "real gameplay has started" — `turn` alone
    // can't do this, since it's already 1 from the moment this object is created, well before
    // either player has mulliganed.
    readyForPlay: false,
  };
}

// Fisher-Yates — NOT `arr.sort(() => Math.random() - 0.5)`, which does not produce a uniform
// shuffle (a well-known JS anti-pattern: sort implementations don't call the comparator on
// every pair with equal frequency, and it's especially biased on small arrays — V8 uses
// insertion sort below ~10 elements, exactly the size of a starting deck's shuffle-relevant
// windows and the Objectives pool). Was the actual cause of "same objectives across 7 games in
// a row" (2026-08-19 playtest report) — see pickObjectives in game.js and applyMulligan.
export function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function createPlayerState(deckCardIds, heroIds = []) {
  const shuffled = shuffle(deckCardIds);
  const hand = shuffled.slice(0, 4);
  const deck = shuffled.slice(4);
  return {
    hq: 30,
    fuel: 0,
    fuelCap: 9,
    pendingFuelGain: 0,
    hand,
    deck,
    missions: [],
    pendingDiscounts: [],
    overrun: false,
    discardPile: [],
    fatigueCount: 0,
    // ── Hero command layer ──
    // Heroes are never shuffled into the deck; the roster is a separate fixed list of 4.
    heroRoster: [...heroIds],
    // Index = board column (0-3). Value = hero cardId occupying that zone, or null.
    heroZones: [null, null, null, null],
    // Hero ids whose Activated Power has already fired THIS TURN. Each Hero may activate
    // once per turn; different Heroes may each activate in the SAME turn (locked 2026-08-17,
    // replaces the old single `heroActivated` once-per-turn-total flag — Coordinated Orders
    // is retired as a result, since "activate another Hero's power this turn" is now default).
    heroesActivatedThisTurn: [],
    // Snapshot of the above, taken at the START of this player's turn (before it's cleared
    // for the new turn) — i.e. "did I activate any Hero Power on my own previous turn."
    // Powers Veteran Signal Corps (119). Cleared/recomputed every startOfTurn.
    heroActivatedLastTurn: false,
    heroRepositioned: false,    // one move/swap per turn; a reinforcement consumes it
    // Per-player, because P1 and P2 cross each Objective threshold on different half-turns.
    // Starts at 0 (not 1) so the FIRST Hero deploys at round 2 (Objective Level 1) via
    // runHeroPhase, same as the 3 reinforcements after it — there is no separate
    // pre-game "Starting Hero" step anymore (removed 2026-08-11: hero timing now follows
    // the objective escalation schedule exactly, L1-L4 = all 4 roster Heroes).
    lastObjLevel: 0,
    lastUnitClass: null,        // for Combined Arms General (109)
    // { [heroId]: true } — gates "first X each turn" passives (94, 104, 109, 110) so each
    // fires at most once per owner turn. Cleared at startOfTurn alongside heroesActivatedThisTurn.
    heroTriggeredThisTurn: {},
    // Set by Priority Orders (121): Fuel discount applied to the very next Hero Power
    // activation this turn, then consumed. Independent of pendingDiscounts (that system is
    // keyed by card class/type, not applicable to a Hero Power's activeCost).
    pendingHeroDiscount: 0,
    // Set by Radio Interference (123) on an ENEMY Hero: extra Fuel cost added to that
    // column's Activated Hero Power during the controller's next turn. { [col]: amount }.
    // Cleared at startOfTurn alongside the other per-cycle Hero fields.
    heroTaxedColumns: {},
    // Field Marshal (144): number of times this player has activated it this match. The
    // Hero's own bonus is (this + 1) each activation — never reset, by design (escalating
    // Active power, not a per-turn passive). See cards.js's note on 144 for the interpretation.
    fieldMarshalUses: 0,
    // One-shot stat buffs queued for the next matching Unit played (Deathrattle: Convoy Escort
    // 138). Entries: { appliesTo: className, amount }. Consumed (removed) by
    // checkPendingUnitBuff in combat.js the moment a matching Unit is placed — unlike
    // pendingDiscounts, this is a stat bonus, not a Fuel discount, so it needs its own list.
    pendingUnitBuffs: [],
  };
}

// ── Turn transitions ─────────────────────────────────────────────────────────

// Active player gains 3 fuel, capped at 6, then pendingFuelGain (Industrial Surge) on top of that,
// uncapped — may push Fuel past 6 for this turn only. Resets pendingFuelGain to 0.
// Missions have no turn limit — they stay active until their reward condition fires
// (checkActiveMissions removes them at that point, not here).
// Clears grantedKeywords from all units owned by the active player.
export function startOfTurn(state) {
  const activePlayer = state.initiative;
  let ps = { ...state[activePlayer] };
  ps = gainFuel(ps, 3); // base per-turn gain, capped at 6 as normal
  ps = gainFuel(ps, ps.pendingFuelGain, false); // Industrial Surge — may exceed the storage cap this turn
  ps.pendingFuelGain = 0;
  // Hero Phase allowances refresh here rather than in endTurn: this runs for the active
  // player only and survives remote sync, matching the killsThisTurn convention.
  // Snapshot BEFORE clearing — "did I activate a Hero Power on my own last turn" (Veteran
  // Signal Corps, 119) needs the value from the turn that's ending, not the fresh one.
  ps.heroActivatedLastTurn = (ps.heroesActivatedThisTurn ?? []).length > 0;
  ps.heroesActivatedThisTurn = [];
  ps.heroRepositioned = false;
  ps.heroTriggeredThisTurn = {};
  ps.heroTaxedColumns = {};
  ps.pendingHeroDiscount = 0; // "this turn" only (Priority Orders) — expires unused

  // Clear per-turn grants and obj bonus for the active player's units before objective effects re-apply.
  // grantedSideBonus (Rally Cry) uses its own counter so it can outlast a single turn (see sideBonusTurns).
  const newBoard = Object.fromEntries(
    Object.entries(state.board).map(([k, u]) => {
      if (!u || u.owner !== activePlayer) return [k, u];
      const turnsLeft = (u.sideBonusTurns ?? 0) - 1;
      return [k, {
        ...u,
        grantedKeywords: [],
        objSideBonus: 0,
        grantedSideBonus: turnsLeft > 0 ? u.grantedSideBonus : 0,
        sideBonusTurns: turnsLeft > 0 ? turnsLeft : 0,
        persistentSpent: 0, // Refresh (doc 01 §8): persistent attack allowance restores here
      }];
    })
  );

  return { ...state, [activePlayer]: ps, board: newBoard };
}

// Swaps initiative, increments turn counter.
// Clears justPlaced, tempKeywords, tempSideBonus, and temporary extra-attack grants (both
// granted and spent counters — doc 01 §8: "this turn" attack grants expire at cleanup, after
// Direct HQ has had a chance to use them) on all board units.
export function endTurn(state) {
  const newBoard = Object.fromEntries(
    Object.entries(state.board).map(([k, v]) =>
      [k, v ? { ...v, justPlaced: false, tempKeywords: [], tempSideBonus: 0, tempExtraAttacks: 0, tempExtraAttacksSpent: 0 } : null]
    )
  );
  return {
    ...state,
    board: newBoard,
    p1: { ...state.p1, overrun: false },
    p2: { ...state.p2, overrun: false },
    initiative: state.initiative === "p1" ? "p2" : "p1",
    turn: state.turn + 1,
  };
}

// Checks who controls each objective (majority of adjacent non-destroyed units).
// Called at the start of each player's turn before applying objective effects.
export function checkObjectiveControl(state) {
  const updated = {};
  for (const [key, obj] of Object.entries(state.objectives)) {
    const [r, c] = key.split(',').map(Number);
    const adjKeys = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]
      .filter(([row, col]) => row >= 0 && row < 4 && col >= 0 && col < 4)
      .map(([row, col]) => `${row},${col}`);
    let p1 = 0, p2 = 0;
    for (const k of adjKeys) {
      const u = state.board[k];
      if (!u || u.state === 'destroyed') continue;
      if (u.owner === 'p1') p1++; else p2++;
    }
    const controller = p1 > p2 ? 'p1' : p2 > p1 ? 'p2' : null;
    updated[key] = { ...obj, controller };
  }
  return { ...state, objectives: updated };
}

// Recalculates objective level for current turn and sets it on all placed objectives.
export function updateObjectiveLevels(state) {
  const level = objectiveLevel(state.turn);
  if (level === 0) return state;
  const objectives = Object.fromEntries(
    Object.entries(state.objectives).map(([k, obj]) => [k, { ...obj, level }])
  );
  return { ...state, objectives };
}

// ── Player state helpers ─────────────────────────────────────────────────────

// Single funnel for "put a card into this player's hand" (doc 02 Q022-Q025): if hand is
// already at the 10-card max, the incoming card goes to discardPile instead. Applies
// regardless of source — normal draw, Craft, Tactical Withdrawal-style return-to-hand, or
// any future "add to hand" effect — so every call site shares one overflow rule rather than
// each one needing its own copy of this check (several didn't have it at all before).
export function addCardToHand(playerState, cardId) {
  if (playerState.hand.length >= 10) {
    return { ...playerState, discardPile: [...(playerState.discardPile ?? []), cardId] };
  }
  return { ...playerState, hand: [...playerState.hand, cardId] };
}

// Draws n cards one at a time (doc 02 Q030: multi-draws resolve sequentially, not as one
// packet). Empty-deck exception (doc 02 Q029-Q030, doc 01 §4 Fatigue), previously entirely
// missing: each failed draw deals escalating HQ damage to the drawing player — 1st failed
// draw this match = 1, 2nd = 2, 3rd = 3, etc. Never resets. This used to just silently stop
// drawing with no consequence at all. Hand-cap overflow per successful draw goes through
// addCardToHand above.
export function drawCards(playerState, n) {
  let ps = playerState;
  for (let i = 0; i < n; i++) {
    if (ps.deck.length === 0) {
      const fatigueCount = (ps.fatigueCount ?? 0) + 1;
      ps = { ...ps, fatigueCount, hq: ps.hq - fatigueCount };
      continue;
    }
    const [card, ...restDeck] = ps.deck;
    ps = { ...addCardToHand(ps, card), deck: restDeck };
  }
  return ps;
}

export function spendFuel(playerState, amount) {
  return { ...playerState, fuel: Math.max(0, playerState.fuel - amount) };
}

// Expires any unused portion of "this turn" temporary Fuel grants (Emergency Supply, doc 01
// §3) at end-of-turn cleanup, after Direct HQ. Fuel is a single fungible pool, so this can't
// know WHICH units of fuel came from the temp grant — it removes min(grant, currentFuel),
// which correctly handles both "never spent, remove the full grant" and "already spent below
// the grant amount through other means, remove only what's left."
export function expireTempFuelGrant(playerState) {
  const grant = playerState.tempFuelGrant ?? 0;
  if (grant <= 0) return playerState;
  return { ...playerState, fuel: Math.max(0, playerState.fuel - grant), tempFuelGrant: 0 };
}

export function gainFuel(playerState, amount, cap = true) {
  // doc 02 Q037 (locked): if current Fuel is already above the normal threshold (from a prior
  // uncapped effect-generated gain), a normal capped Fuel step must add 0, NOT reduce it back
  // down to the cap. The previous `Math.min(capValue, fuel + amount)` got this wrong — e.g.
  // fuel already at 12 (cap 9) + a normal +3 step computed min(9, 15) = 9, silently erasing 3
  // Fuel of legitimate excess every single turn. Correct rule: the capped GAIN itself is
  // clamped to "however much room is left under the cap," never negative, then added — excess
  // already banked is left alone.
  if (!cap) return { ...playerState, fuel: playerState.fuel + amount };
  const room = Math.max(0, fuelCapOf(playerState) - playerState.fuel);
  return { ...playerState, fuel: playerState.fuel + Math.min(amount, room) };
}

// Base cap is 9, but Logistics Chief (H02) raises it to 11 while deployed in any Hero Zone.
export function fuelCapOf(playerState) {
  const base = playerState.fuelCap ?? 9;
  const hasLogisticsChief = (playerState.heroZones ?? []).includes('H02');
  return hasLogisticsChief ? Math.max(base, 11) : base;
}

// ── Fuel discounts ───────────────────────────────────────────────────────────
// Replaces the old scalar `tempFuelDiscount`, which was hardcoded to Tanks, had no column
// or floor, and never expired. Entry shape:
//   { appliesTo, column, amount, min }
//     appliesTo — a unit class ('Tank'), or 'command', or null for any card
//     column    — restrict to one board column (Hero powers), or null for anywhere
//     amount    — Fuel reduction offered
//     min       — floor for the resulting cost (0 = may reach free; Hero powers use 1)
// Discounts persist until spent, matching the previous behaviour.

function discountMatches(d, card, col) {
  if (d.appliesTo === 'command') { if (card.type !== 'command') return false; }
  // 'unit' means "any Unit class" (Factory L2/L4's "next Unit played" — as opposed to a
  // specific class like 'Tank'/'Aircraft', or a Command, which 'unit' must exclude).
  else if (d.appliesTo === 'unit') { if (card.type !== 'unit') return false; }
  else if (d.appliesTo && card.cls !== d.appliesTo) return false;
  // col === null means "don't filter by column" — used by the hand display and the
  // affordability pre-check, which run before a tile has been chosen, so they show the
  // best case. Placement passes the real column and gets the true figure.
  if (col !== null && d.column != null && d.column !== col) return false;
  return true;
}

// Total Fuel reduction available to this card, relative to its PRINTED cost.
// Doc 01 §3: "If an effect sets a cost to a specific value, apply the set-cost first, then
// other reductions; normal minimum remains 0 unless explicitly overridden." A `setCost` entry
// (Breakthrough: Tank Destroyer) replaces the baseline cost outright; ordinary subtractive
// entries then apply against THAT baseline (floor 0 unless a matching entry sets a higher
// `min`) — so a set-cost is not itself a floor other discounts are blocked by.
export function discountFor(playerState, card, col = null) {
  const matches = (playerState.pendingDiscounts ?? []).filter(d => discountMatches(d, card, col));
  if (!matches.length) return 0;
  const setCostEntry = matches.find(d => d.setCost != null);
  const baseCost = setCostEntry ? setCostEntry.setCost : (card.cost ?? 0);
  const reductionEntries = matches.filter(d => d.setCost == null);
  const total = reductionEntries.reduce((sum, d) => sum + d.amount, 0);
  const floor = reductionEntries.reduce((m, d) => Math.max(m, d.min ?? 0), 0);
  const reduction = Math.max(0, Math.min(total, baseCost - floor));
  return ((card.cost ?? 0) - baseCost) + reduction;
}

// Spends `used` Fuel worth of discount, draining matching subtractive entries in order and
// dropping any that reach zero. A matching `setCost` entry is always fully consumed (one-shot)
// once this card is actually played, regardless of `used`.
export function consumeDiscounts(playerState, card, col, used) {
  const out = [];
  for (const d of playerState.pendingDiscounts ?? []) {
    if (discountMatches(d, card, col) && d.setCost != null) continue; // one-shot, drop it
    out.push(d);
  }
  if (used <= 0) return { ...playerState, pendingDiscounts: out };
  let left = used;
  const final = [];
  for (const d of out) {
    if (left > 0 && discountMatches(d, card, col)) {
      const take = Math.min(left, d.amount);
      left -= take;
      if (d.amount - take > 0) final.push({ ...d, amount: d.amount - take });
      continue;
    }
    final.push(d);
  }
  return { ...playerState, pendingDiscounts: final };
}

export function addDiscount(playerState, entry) {
  return { ...playerState, pendingDiscounts: [...(playerState.pendingDiscounts ?? []), entry] };
}

// ── Board unit helpers ───────────────────────────────────────────────────────

// Clears Suppression from one unit. Single funnel for every "un-suppress" effect
// (Field Medic, Last Stand, Combined Arms Doctrine, Fortify the Line) so Hero passives
// that trigger on Suppression being removed have one hook point instead of four inline
// call sites. `changed` is false when the unit was not actually suppressed, which is what
// callers gate their trigger on — un-suppressing a healthy unit must not fire anything.
export function unsuppressOnBoard(board, key) {
  const unit = board[key];
  if (!unit || unit.state !== 'suppressed') return { board, changed: false };
  return { board: { ...board, [key]: { ...unit, state: 'normal' } }, changed: true };
}

// ── Rotation (Change Formation 124, Field Engineer 91) ──────────────────────
// Answers "after rotating the unit `rotation`° clockwise, which of the card's own N/E/S/W
// attributes is now showing at physical side `dir`?" A 90° clockwise turn moves the card's
// N attribute to the physical E side, so the physical N side ends up showing what was
// previously the card's W attribute: rotatedDir('n', 90) === 'w' (look up the card's own
// attribute `steps` positions counter-clockwise from the physical side being queried).
const DIR_ORDER = ['n', 'e', 's', 'w'];
export function rotatedDir(dir, rotationDegrees) {
  const steps = Math.round((rotationDegrees || 0) / 90) % 4;
  if (!steps) return dir;
  const i = DIR_ORDER.indexOf(dir);
  return DIR_ORDER[(i - steps + 4) % 4];
}

// Returns card's base side value (after rotation) + tempSideBonus + grantedSideBonus +
// objSideBonus + debugSideBonus.
// No owner-based flip: a card's printed N/E/S/W always maps to physical N/E/S/W on the
// fixed board grid, for both players — matching how it's shown in hand and on the tile.
// (2026-07-02 added an owner-based P2_FLIP here, paired with a per-viewer board rotation
// in renderBoard; the board rotation was reverted 2026-07-30 but this half was missed,
// leaving P2's board stats silently mismatched from what was shown in hand. Removed 2026-08-14.)
export function getSideValue(boardUnit, dir) {
  const card = CARD_BY_ID[boardUnit.cardId];
  if (!card || card.type !== "unit") return 0;
  const d = rotatedDir(dir, boardUnit.rotation);
  // perm_n/e/s/w (Long War Commander, H24): a printed-side-relative permanent bonus, granted
  // to one of the 4 sides at random each activation — looked up via the same rotated index `d`
  // as the base printed stat, so a later rotation (Change Formation etc.) carries the bonus
  // with its side exactly like every other stat does, rather than pinning it to whichever
  // physical board direction happened to face that way at grant time.
  const total = card[d] + (boardUnit.tempSideBonus || 0) + (boardUnit.grantedSideBonus || 0) + (boardUnit.objSideBonus || 0) + (boardUnit.debugSideBonus || 0) + (boardUnit.dynamicSideBonus || 0) + (boardUnit[`perm_${d}`] || 0);
  // doc 01 §16 / doc 02 Q127: directional stat floor = 0, no maximum cap. Not currently
  // reachable by any card in the live pool (no negative modifier exists yet) — only via the
  // debug panel's negative all-sides buff — but the rule is unconditional, not "unless no
  // card needs it yet," so enforce it here rather than leave it to luck.
  return Math.max(0, total);
}

// Returns card's base keyword(s) + tempKeywords + grantedKeywords.
// card.keyword may be a string or array.
export function getKeywords(boardUnit) {
  const card = CARD_BY_ID[boardUnit.cardId];
  const base = card?.keyword
    ? (Array.isArray(card.keyword) ? card.keyword : [card.keyword])
    : [];
  return [...new Set([...base, ...(boardUnit.tempKeywords || []), ...(boardUnit.grantedKeywords || []), ...(boardUnit.permanentKeywords || [])])];
}

// Heavy Armor → 2, Armor → 1, else → 0.
export function maxArmorHits(boardUnit) {
  const kws = getKeywords(boardUnit);
  if (kws.includes("Heavy Armor")) return 2;
  if (kws.includes("Armor")) return 1;
  return 0;
}

// maxArmorHits + 2 (armor absorbs N hits, then Suppressed, then Destroyed).
export function hitsToDestroy(boardUnit) {
  return maxArmorHits(boardUnit) + 2;
}

// Applies one hit following the sequence:
//   armorHits < maxArmorHits → absorb (hqDamage = 0, state unchanged)
//   state === "normal"       → "suppressed" (hqDamage = 0 — Set 1 truth, locked 2026-08-31:
//                               Suppression never deals HQ damage by default. This replaces
//                               the old "Suppress = 1, Destroy = 2, total 3 per kill" model.)
//   state === "suppressed"   → "destroyed"  (hqDamage = 2, or 0 if the unit has Guard — same
//                               rule resolveDestructionChain already applies for command/
//                               self-destruct destruction: "destroying a Unit deals 2 to its
//                               OWNER's HQ ... unless Guard reduces it to 0." Fixed 2026-09-01:
//                               this path — every normal combat kill, including Blast/Barrage
//                               secondary hits via resolveSecondaryHits — had no Guard check at
//                               all, so a Guard Unit killed in combat wrongly dealt its owner 2
//                               HQ damage instead of 0.)
// hqDamage is dealt to the unit owner's HQ (the one being attacked).
export function applyHit(boardUnit) {
  const unit = { ...boardUnit };
  const armor = maxArmorHits(unit);

  if (unit.armorHits < armor) {
    unit.armorHits += 1;
    return { newUnit: unit, hqDamage: 0 };
  }

  if (unit.state === "normal") {
    unit.state = "suppressed";
    return { newUnit: unit, hqDamage: 0 };
  }

  if (unit.state === "suppressed") {
    unit.state = "destroyed";
    const isGuard = getKeywords(unit).includes('Guard');
    return { newUnit: unit, hqDamage: isGuard ? 0 : 2 };
  }

  // Already destroyed — safe fallback.
  return { newUnit: unit, hqDamage: 0 };
}

// ── Attack allowance (persistent + temporary) ───────────────────────────────
// Doc 01 §8: persistent allowance (Double Attack ? 2 : 1) and temporary additional attacks
// are tracked separately. Consumption order is locked: persistent first, then temporary.
// A unit's own On Play / normal battlefield presence never grants attacks by itself — this
// only ever grows via Double Attack (persistent) or an explicit "gains 1 additional legal
// attack" effect (temporary).

export function persistentAllowance(boardUnit) {
  return getKeywords(boardUnit).includes('Double Attack') ? 2 : 1;
}

// Total attacks this unit can still use right now, across both pools.
export function remainingAttacks(boardUnit) {
  const persistentLeft = Math.max(0, persistentAllowance(boardUnit) - (boardUnit.persistentSpent ?? 0));
  const tempLeft = Math.max(0, (boardUnit.tempExtraAttacks ?? 0) - (boardUnit.tempExtraAttacksSpent ?? 0));
  return persistentLeft + tempLeft;
}

// Spends one attack: persistent pool first, then temporary. Returns the updated unit;
// caller is responsible for checking remainingAttacks(unit) > 0 first.
export function spendAttack(boardUnit) {
  const persistentLeft = persistentAllowance(boardUnit) - (boardUnit.persistentSpent ?? 0);
  if (persistentLeft > 0) {
    return { ...boardUnit, persistentSpent: (boardUnit.persistentSpent ?? 0) + 1 };
  }
  return { ...boardUnit, tempExtraAttacksSpent: (boardUnit.tempExtraAttacksSpent ?? 0) + 1 };
}

// Grants N additional temporary attacks (Coordinated Strike, Air Strike, Airfield L4, ...).
// These survive through Direct HQ and clear at endTurn cleanup (see endTurn below).
export function grantTempAttacks(boardUnit, n = 1) {
  return { ...boardUnit, tempExtraAttacks: (boardUnit.tempExtraAttacks ?? 0) + n };
}

// Explicit attack reset (Maneuver Commander, Scramble): restores persistent allowance only.
// Never recreates an already-spent temporary extra attack — doc 01 §8, Run 1 correction.
export function resetPersistentAttacks(boardUnit) {
  return { ...boardUnit, persistentSpent: 0 };
}

// ── Escalate (doc 01 §29) ────────────────────────────────────────────────────
// Tracked by Command NAME, per player, per match. Two physical copies of the same Command
// share the count; the opponent's count is independent. Current Escalate Commands: General
// Offensive, Blitzkrieg Order, Fire for Effect, Air Superiority (C26/C27/C32/C34).

export function hasEscalated(playerState, commandName) {
  return !!(playerState.escalateUses ?? {})[commandName];
}

// Marks this Command name as used at least once this match — the NEXT play of the same name
// resolves its Escalate clause. Idempotent past the first call.
export function markEscalateUse(playerState, commandName) {
  return { ...playerState, escalateUses: { ...(playerState.escalateUses ?? {}), [commandName]: true } };
}

// Compares attacker's side value vs defender's opposite side. Tie = attacker wins.
// attDir is the direction the attacker is swinging FROM
// (e.g. attacker is N of defender → attDir = "s").
export function attackBeats(attacker, attDir, defender) {
  const attValue = getSideValue(attacker, attDir);
  const defValue = getSideValue(defender, oppositeDir(attDir));
  return attValue >= defValue;
}

export function oppositeDir(dir) {
  return { n: "s", s: "n", e: "w", w: "e" }[dir];
}

// ── Objective helpers ────────────────────────────────────────────────────────

// state.turn is a half-turn counter (increments each time any player ends their turn).
// Convert to full rounds: round 1 = half-turns 1-2, round 2 = half-turns 3-4, etc.
// Round 1 → 0 (no bonus), rounds 2-3 → L1, 4-5 → L2, 6-7 → L3, 8+ → L4.
export function objectiveLevel(turn) {
  const round = Math.ceil(turn / 2);
  if (round < 2) return 0;
  if (round <= 3) return 1;
  if (round <= 5) return 2;
  if (round <= 7) return 3;
  return 4;
}
