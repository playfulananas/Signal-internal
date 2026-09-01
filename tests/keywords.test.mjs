// Unit tests for the core Set 1 keyword mechanics (Guard/Precision, Blast, Barrage, Rally,
// Inspire, Muster, Last Stand, Breakthrough) — none of these had ANY test coverage before this
// file, despite being exactly what Denis's 08_SIGNAL_Local_Playtest_Card_QA_Checklist Sections
// 3-6 ask about. Section numbers below reference that checklist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAttackableTargets, resolveSingleAttack, checkRally, computeDynamicSideBonus, recalculateDynamicStats, resolveDestructionChain, applyPostDestructionEffects } from '../js/combat.js';
import { discountFor, addDiscount, getSideValue, getKeywords, startOfTurn, applyHit } from '../js/state.js';
import { CARD_BY_ID } from '../js/cards.js';

function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
const unit = (owner, cardId = 'I1', extra = {}) => ({ cardId, owner, state: 'normal', armorHits: 0, rotation: 0, persistentSpent: 0, tempExtraAttacks: 0, tempExtraAttacksSpent: 0, tempKeywords: [], grantedKeywords: [], ...extra });
const baseState = (board, extra = {}) => ({ turn: 2, mapId: 'kursk', board, objectives: {}, p1: { hq: 30, hand: [] }, p2: { hq: 30, hand: [] }, ...extra });

// ── getSideValue: directional stat floor = 0 (doc 01 §16, doc 02 Q127) ─────────
test('getSideValue floors at 0 — a large negative modifier cannot push a side below 0', () => {
  const u = unit('p1', 'I1', { debugSideBonus: -999 });
  assert.equal(getSideValue(u, 'n'), 0);
});

test('getSideValue: no maximum cap — a large positive modifier passes through unclamped', () => {
  const u = unit('p1', 'I1', { debugSideBonus: 50 });
  assert.equal(getSideValue(u, 'n'), CARD_BY_ID['I1'].n + 50);
});

// ── discountFor: 'unit' appliesTo (Run 2, Factory O1 L2/L4) ─────────────────
// Added because addDiscount's only prior generic dimension was 'command' (special-cased) or
// an exact card.cls match — nothing meant "any Unit, any class, but not a Command." Factory's
// "next Unit played this turn costs N less" needed exactly that, so discountMatches gained a
// parallel 'unit' special case rather than leaving the discount over-broad enough to also
// (wrongly) apply to Commands.
test("discountFor: appliesTo 'unit' matches any Unit card regardless of class", () => {
  const ps = addDiscount({ pendingDiscounts: [] }, { appliesTo: 'unit', column: null, amount: 1, min: 0 });
  assert.equal(discountFor(ps, { type: 'unit', cls: 'Infantry', cost: 3 }, null), 1);
  assert.equal(discountFor(ps, { type: 'unit', cls: 'Tank', cost: 3 }, null), 1);
  assert.equal(discountFor(ps, { type: 'unit', cls: 'Aircraft', cost: 3 }, null), 1);
});

test("discountFor: appliesTo 'unit' does NOT match a Command", () => {
  const ps = addDiscount({ pendingDiscounts: [] }, { appliesTo: 'unit', column: null, amount: 1, min: 0 });
  assert.equal(discountFor(ps, { type: 'command', cost: 3 }, null), 0);
});

// ── Section 3/5: Guard / Precision ──────────────────────────────────────────

test('Guard: a reachable Guard candidate restricts the legal-target pool to Guard only', () => {
  // Use a Bombard attacker so both enemies are reachable candidates in one row.
  const state = baseState(boardWith({ '0,0': unit('p1', 'AR43'), '0,1': unit('p2', 'I6'), '0,2': unit('p2', 'I2') }));
  const targets = getAttackableTargets(state, '0,0');
  assert.deepEqual(targets.map(t => t.key).sort(), ['0,1'], 'only the Guard candidate should be legal');
});

test('Guard: a Suppressed Guard still restricts the pool (Suppressed Units remain legal targets)', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'AR43'), '0,1': unit('p2', 'I6', { state: 'suppressed' }), '0,2': unit('p2', 'I2') }));
  const targets = getAttackableTargets(state, '0,0');
  assert.deepEqual(targets.map(t => t.key), ['0,1']);
});

test('Precision bypasses Guard entirely — full raw candidate pool, unrestricted', () => {
  // A61 Strategic Bomber: Precision + Bombard, so both enemies in-row are reachable candidates.
  const state = baseState(boardWith({ '0,0': unit('p1', 'A61'), '0,1': unit('p2', 'I6'), '0,2': unit('p2', 'I2') }));
  const targets = getAttackableTargets(state, '0,0');
  assert.deepEqual(targets.map(t => t.key).sort(), ['0,1', '0,2'], 'Precision ignores the Guard candidate entirely');
});

test('Bombard obeys Guard like any other attacker (doc 02 Q100 — old auto-bypass is removed)', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'AR43'), '3,0': unit('p2', 'I6') })); // AR43 = Bombard only, no Precision
  const targets = getAttackableTargets(state, '0,0');
  assert.deepEqual(targets.map(t => t.key), ['3,0'], 'the only candidate happens to have Guard, still legal');
  // Add a second, non-Guard enemy in range — Guard priority should now exclude it.
  const state2 = { ...state, board: { ...state.board, '2,0': unit('p2', 'I2') } };
  const targets2 = getAttackableTargets(state2, '0,0');
  assert.deepEqual(targets2.map(t => t.key), ['3,0'], 'Guard still wins priority over the non-Guard candidate at 2,0');
});

test('no Guard candidate in range -> full raw pool is legal', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'AR43'), '3,0': unit('p2', 'I2'), '0,3': unit('p2', 'I3') }));
  const targets = getAttackableTargets(state, '0,0');
  assert.deepEqual(targets.map(t => t.key).sort(), ['0,3', '3,0']);
});

// ── Guard blocks HQ damage on normal-combat destruction (fixed 2026-09-01) ──
// resolveDestructionChain already gave a Guard Unit 0 HQ damage on self-destruct/command-based
// destruction (see the Sacrifice Play tests below), but normal combat destruction goes through
// applyHit directly (via resolveSingleAttack/resolveSecondaryHits), which had no Guard check at
// all — a Guard Unit killed in an ordinary attack wrongly dealt its owner the full 2 HQ damage.
test('applyHit: destroying a Guard Unit (already Suppressed) deals 0 HQ damage', () => {
  const guardUnit = unit('p1', 'I6', { state: 'suppressed' }); // I6 Shield Bearers, Guard
  const { newUnit, hqDamage } = applyHit(guardUnit);
  assert.equal(newUnit.state, 'destroyed');
  assert.equal(hqDamage, 0, 'Guard reduces normal combat-destruction HQ damage to 0');
});

test('applyHit: destroying a non-Guard Unit (already Suppressed) deals the normal 2 HQ damage', () => {
  const plainUnit = unit('p1', 'I1', { state: 'suppressed' });
  const { newUnit, hqDamage } = applyHit(plainUnit);
  assert.equal(newUnit.state, 'destroyed');
  assert.equal(hqDamage, 2);
});

test('resolveSingleAttack: destroying a Guard Unit in normal combat deals 0 HQ damage to its owner', () => {
  const state = baseState(boardWith({
    '1,1': unit('p1', 'I1', { tempSideBonus: 20 }),
    '2,1': unit('p2', 'I6', { state: 'suppressed' }), // I6 Shield Bearers, Guard, one hit from destroyed
  }));
  const result = resolveSingleAttack(state, '1,1', '2,1');
  assert.ok(result.boardMutations.some(m => m.key === '2,1' && m.newUnit === null), 'target was destroyed');
  assert.equal(result.hqDamageToP2, 0, 'Guard reduces the destroyed defender owner\'s HQ damage to 0');
});

test('resolveSingleAttack: Blast secondary Hit destroying a Guard Unit deals 0 HQ damage for that kill', () => {
  const state = baseState(boardWith({
    '1,1': unit('p1', 'AR46', { tempSideBonus: 20 }), // Blast
    '2,1': unit('p2', 'I1', { state: 'suppressed' }),  // primary target, one hit from destroyed
    '2,0': unit('p2', 'I6', { state: 'suppressed' }),  // Guard, perpendicular secondary, also one hit from destroyed
  }));
  const result = resolveSingleAttack(state, '1,1', '2,1');
  const primaryDestroyed = result.boardMutations.some(m => m.key === '2,1' && m.newUnit === null);
  const secondaryDestroyed = result.boardMutations.some(m => m.key === '2,0' && m.newUnit === null);
  assert.ok(primaryDestroyed && secondaryDestroyed, 'both primary and secondary Guard target were destroyed');
  assert.equal(result.hqDamageToP2, 2, 'only the non-Guard primary kill (2) contributes HQ damage — the Guard secondary kill contributes 0');
});

// ── Section 5: Blast / Barrage ───────────────────────────────────────────────

test('Blast: a successful Hit also Hits enemies directly left/right of the target (perpendicular)', () => {
  // AR46 Mortar Battery (Blast) at 0,1 attacking south into 3,1 (a Bombard-range attack since
  // Blast units aren't necessarily Bombard — use adjacency instead: attacker at 1,1, target 2,1).
  const state = baseState(boardWith({
    '1,1': unit('p1', 'AR46', { tempSideBonus: 20 }),
    '2,1': unit('p2', 'I1'),   // primary target, south of attacker
    '2,0': unit('p2', 'I2'),  // perpendicular (west of primary, relative to south-facing attack)
    '2,2': unit('p2', 'I3'),  // perpendicular (east of primary)
  }));
  const result = resolveSingleAttack(state, '1,1', '2,1');
  const hitKeys = result.boardMutations.map(m => m.key).sort();
  assert.deepEqual(hitKeys, ['2,0', '2,1', '2,2'], 'primary + both perpendicular secondaries all resolve');
});

test('Blast secondary Hits are not blocked/redirected by Guard', () => {
  const state = baseState(boardWith({
    '1,1': unit('p1', 'AR46', { tempSideBonus: 20 }),
    '2,1': unit('p2', 'I1'),
    '2,0': unit('p2', 'I6'), // Guard, but this is a SECONDARY tile, not chosen via getAttackableTargets
  }));
  const result = resolveSingleAttack(state, '1,1', '2,1');
  assert.ok(result.boardMutations.some(m => m.key === '2,0'), 'Guard does not protect against Blast secondary splash');
});

test('Barrage: a successful Hit continues forward along the attack ray beyond the target', () => {
  const state = baseState(boardWith({
    '0,1': unit('p1', 'AR48', { tempSideBonus: 20 }), // Rocket Battery, Barrage
    '1,1': unit('p2', 'I1'),  // primary, south of attacker
    '2,1': unit('p2', 'I2'),  // forward-ray beyond primary
    '3,1': unit('p2', 'I3'),  // further forward-ray
  }));
  const result = resolveSingleAttack(state, '0,1', '1,1');
  const hitKeys = result.boardMutations.map(m => m.key).sort();
  assert.deepEqual(hitKeys, ['1,1', '2,1', '3,1'], 'Barrage hits everything along the ray, not just one extra tile');
});

test('Barrage does not Hit behind the attacker or beside the primary target', () => {
  const state = baseState(boardWith({
    '2,1': unit('p1', 'AR48', { tempSideBonus: 20 }),
    '1,1': unit('p2', 'I1'),  // primary, north of attacker
    '3,1': unit('p2', 'I2'),  // behind the attacker — must NOT be hit
    '1,0': unit('p2', 'I3'),  // beside the primary — must NOT be hit (that's Blast's job, not Barrage's)
  }));
  const result = resolveSingleAttack(state, '2,1', '1,1');
  const hitKeys = result.boardMutations.map(m => m.key).sort();
  assert.deepEqual(hitKeys, ['1,1'], 'only the primary lands — (0,1) is empty (nothing to hit), (3,1)/(1,0) are correctly out of the forward ray');
});

// ── Section 3: Rally ─────────────────────────────────────────────────────────

test('Rally (I12 Assault Trooper): draws 1 card on attack declaration', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I12') }), { p1: { hq: 30, hand: [], deck: ['I2', 'I3'] } });
  const { state: after, log } = checkRally(state, '0,0');
  assert.equal(after.p1.hand.length, 1);
  assert.ok(log[0].includes('draw 1 card'));
});

test('Rally (I13 Combat Engager): a random OTHER friendly Infantry gets +1 permanently, never itself', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I13'), '0,1': unit('p1', 'I1') }));
  const { state: after } = checkRally(state, '0,0');
  assert.equal(after.board['0,0'].grantedSideBonus ?? 0, 0, 'the Rally source itself is never a valid target');
  assert.equal(after.board['0,1'].grantedSideBonus, 1);
});

test('Rally (I14 Veteran Raider): ALL adjacent friendly Units get +1 permanently (not just Infantry)', () => {
  const state = baseState(boardWith({ '1,1': unit('p1', 'I14'), '0,1': unit('p1', 'T23'), '1,0': unit('p1', 'I1'), '1,2': unit('p2', 'I2') }));
  const { state: after } = checkRally(state, '1,1');
  assert.equal(after.board['0,1'].grantedSideBonus, 1, 'adjacent friendly Tank also qualifies — not Infantry-only');
  assert.equal(after.board['1,0'].grantedSideBonus, 1);
  assert.equal(after.board['1,2'].grantedSideBonus ?? 0, 0, 'enemy adjacent Unit must not be buffed');
});

test('Rally (I21 Commanding Infantry): ALL other friendly Infantry get +1 permanently', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I21'), '0,1': unit('p1', 'I1'), '3,3': unit('p1', 'I2'), '1,1': unit('p1', 'T23') }));
  const { state: after } = checkRally(state, '0,0');
  assert.equal(after.board['0,1'].grantedSideBonus, 1);
  assert.equal(after.board['3,3'].grantedSideBonus, 1, 'not adjacency-limited, board-wide');
  assert.equal(after.board['1,1'].grantedSideBonus ?? 0, 0, 'Tank does not qualify — Infantry only for I21');
});

test('Rally triggers on attack declaration even without the Rally keyword actually being present -> no-op safely', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I1') })); // no Rally keyword
  const { log } = checkRally(state, '0,0');
  assert.deepEqual(log, []);
});

// ── Section 3: Inspire / Muster (dynamic recalculation) ─────────────────────

test('Inspire: adjacent friendly Units get +1 all sides while the Inspire source is on the battlefield', () => {
  const state = baseState(boardWith({ '1,1': unit('p1', 'I9'), '0,1': unit('p1', 'I1'), '2,2': unit('p1', 'I2') }));
  const after = recalculateDynamicStats(state);
  assert.equal(computeDynamicSideBonus(after, '0,1'), 1, 'orthogonally adjacent to Inspire source');
  assert.equal(computeDynamicSideBonus(after, '2,2'), 0, 'diagonal, not adjacent — no bonus');
});

test('Inspire bonus disappears immediately once the source leaves the battlefield (dynamic, not baked in)', () => {
  const withSource = baseState(boardWith({ '1,1': unit('p1', 'I9'), '0,1': unit('p1', 'I1') }));
  assert.equal(computeDynamicSideBonus(withSource, '0,1'), 1);
  const withoutSource = baseState(boardWith({ '0,1': unit('p1', 'I1') })); // source removed
  assert.equal(computeDynamicSideBonus(withoutSource, '0,1'), 0);
});

test('Muster: +1 all sides for each OTHER friendly Infantry, recalculated as the board changes', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I15'), '0,1': unit('p1', 'I1'), '0,2': unit('p1', 'I2'), '1,1': unit('p1', 'T23') }));
  assert.equal(computeDynamicSideBonus(state, '0,0'), 2, '2 other friendly Infantry (Tank does not count)');
  const fewer = { ...state, board: { ...state.board, '0,2': null } };
  assert.equal(computeDynamicSideBonus(fewer, '0,0'), 1, 'recalculates down when an Infantry leaves the board');
});

test('Muster does not count itself among "other friendly Infantry"', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I15') })); // alone on the board
  assert.equal(computeDynamicSideBonus(state, '0,0'), 0);
});

// ── Section 3/4: Last Stand / Breakthrough (via the shared destruction chain) ─

test('Last Stand (I18 Last Stand Soldier): draws 1 card when destroyed', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I18') }), { p1: { hq: 30, hand: [], deck: ['I1'] } });
  const { state: after } = resolveDestructionChain(state, { unitKey: '0,0' });
  assert.equal(after.p1.hand.length, 1);
});

test('Last Stand (I19 Final Defender): a random friendly Infantry (excluding the dying Unit itself) gets +1 permanently', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I19'), '0,1': unit('p1', 'I1') }));
  const { state: after } = resolveDestructionChain(state, { unitKey: '0,0' });
  assert.equal(after.board['0,1'].grantedSideBonus, 1);
});

test('Last Stand (I22 Field Commander): adjacent friendly Infantry get +1 until end of turn (tempSideBonus, not permanent)', () => {
  const state = baseState(boardWith({ '1,1': unit('p1', 'I22'), '0,1': unit('p1', 'I1') }));
  const { state: after } = resolveDestructionChain(state, { unitKey: '1,1' });
  assert.equal(after.board['0,1'].tempSideBonus, 1);
  assert.equal(after.board['0,1'].grantedSideBonus ?? 0, 0, 'this one is temporary, not permanent');
});

test('Graves Registration Officer (H14) doubles Last Stand as two independent resolutions, never the same random target twice', () => {
  const state = baseState(
    boardWith({ '0,0': unit('p1', 'I19'), '0,1': unit('p1', 'I1'), '0,2': unit('p1', 'I2') }),
    { p1: { hq: 30, hand: [], heroZones: ['H14', null, null, null] } }
  );
  const { state: after } = resolveDestructionChain(state, { unitKey: '0,0' });
  assert.equal(after.board['0,1'].grantedSideBonus, 1);
  assert.equal(after.board['0,2'].grantedSideBonus, 1, 'both eligible Infantry got hit — doubling could not pick the same one twice');
});

test('Breakthrough (T32 Tank Hunter): the surviving attacker gains +1 all sides permanently on a kill', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T32'), '0,1': unit('p2', 'I1') }));
  const { state: after } = resolveDestructionChain(state, { unitKey: '0,1', sourceUnitKey: '0,0' });
  assert.equal(after.board['0,0'].grantedSideBonus, 1);
});

test('Breakthrough (T33 Tank Destroyer): sets a Tank set-cost discount that other reductions can still stack through', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T33'), '0,1': unit('p2', 'I1') }));
  const { state: after } = resolveDestructionChain(state, { unitKey: '0,1', sourceUnitKey: '0,0' });
  const tankCard = { cost: 5, cls: 'Tank' };
  assert.equal(discountFor(after.p1, tankCard, null), 4, 'Tank Destroyer sets cost to 1, i.e. a discount of (cost - 1)');
});

test('Breakthrough (T34 Breakthrough Tank): gains Armor, no-ops if it already has Armor/Heavy Armor', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T34'), '0,1': unit('p2', 'I1') }));
  const { state: after } = resolveDestructionChain(state, { unitKey: '0,1', sourceUnitKey: '0,0' });
  assert.ok((after.board['0,0'].permanentKeywords ?? []).includes('Armor'), 'must be permanentKeywords, not grantedKeywords (which clears every startOfTurn)');
});

test('Breakthrough (T35 Ace Tank): gains Double Attack on a kill', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T35'), '0,1': unit('p2', 'I1') }));
  const { state: after } = resolveDestructionChain(state, { unitKey: '0,1', sourceUnitKey: '0,0' });
  assert.ok((after.board['0,0'].permanentKeywords ?? []).includes('Double Attack'), 'must be permanentKeywords, not grantedKeywords (which clears every startOfTurn)');
});

test('regression: a Breakthrough-granted keyword survives the owner\'s startOfTurn (was silently wiped — grantedKeywords clears every startOfTurn, but this grant has no "until" wording and must be permanent)', () => {
  const richP1 = { hq: 30, hand: [], fuel: 5, fuelCap: 9, pendingFuelGain: 0, heroesActivatedThisTurn: [], heroZones: [null, null, null, null] };
  const state = baseState(boardWith({ '0,0': unit('p1', 'T35'), '0,1': unit('p2', 'I1') }), { p1: richP1 });
  const { state: afterKill } = resolveDestructionChain(state, { unitKey: '0,1', sourceUnitKey: '0,0' });
  assert.ok(getKeywords(afterKill.board['0,0']).includes('Double Attack'), 'sanity: granted immediately after the kill');
  const afterOwnerTurnStarts = startOfTurn({ ...afterKill, initiative: 'p1' });
  assert.ok(getKeywords(afterOwnerTurnStarts.board['0,0']).includes('Double Attack'), 'must still be there once the owner\'s own next turn begins');
});

test('Breakthrough does not trigger if the source Unit did not survive the exchange', () => {
  const state = baseState(boardWith({ '0,1': unit('p2', 'I1') })); // source unit key given but not actually on board
  const { state: after, log } = resolveDestructionChain(state, { unitKey: '0,1', sourceUnitKey: '0,0' });
  assert.deepEqual(log.filter(l => l.includes('Breakthrough')), []);
});

test('resolveDestructionChain with no replacement: destroying a Guard Unit deals 0 HQ damage to its owner (Sacrifice Play C18)', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I6') })); // I6 Shield Bearers, Guard
  const { hqDamageToP1, hqDamageToP2, log } = resolveDestructionChain(state, { unitKey: '0,0', sourceUnitKey: null, cause: 'command' });
  assert.equal(hqDamageToP1, 0, 'Guard reduces normal self-destruction HQ damage to 0');
  assert.equal(hqDamageToP2, 0);
  assert.ok(log.some(l => /0 HQ damage/.test(l)));
});

test('resolveDestructionChain with no replacement: destroying a non-Guard Unit deals the normal 2 HQ damage to its owner', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I1') }));
  const { hqDamageToP1 } = resolveDestructionChain(state, { unitKey: '0,0', sourceUnitKey: null, cause: 'command' });
  assert.equal(hqDamageToP1, 2);
});

test('resolveDestructionChain with hqResultReplacement bypasses Guard entirely (Scorched Earth Raid C19)', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I6') })); // Guard
  const { hqDamageToP1, hqDamageToP2 } = resolveDestructionChain(state, { unitKey: '0,0', sourceUnitKey: null, cause: 'command', hqResultReplacement: { targetHq: 'p2', amount: 2 } });
  assert.equal(hqDamageToP1, 0, 'the owner takes no self-damage when a replacement is in effect');
  assert.equal(hqDamageToP2, 2, 'the replacement amount lands on the opponent regardless of Guard');
});

// Section 12 high-risk combo: "Scorched Earth Raid + Guard Last Stand Unit" — I22 Field
// Commander carries both Guard and Last Stand. Guard blocking the normal self-HQ result and
// Last Stand triggering are independent steps in the chain; neither should suppress the other.
test('Scorched Earth Raid on a Guard + Last Stand Unit: HQ replacement bypasses Guard AND Last Stand still fires', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'I22'), '0,1': unit('p1', 'I1') })); // I22: Guard + Last Stand
  const { hqDamageToP1, hqDamageToP2, state: after } = resolveDestructionChain(state, { unitKey: '0,0', sourceUnitKey: null, cause: 'command', hqResultReplacement: { targetHq: 'p2', amount: 2 } });
  assert.equal(hqDamageToP1, 0);
  assert.equal(hqDamageToP2, 2, 'Guard does not block the replacement');
  assert.equal(after.board['0,1'].tempSideBonus, 1, "Field Commander's Last Stand (adjacent Infantry +1) still fires despite Guard/replacement");
});

test('applyPostDestructionEffects (combat-path sibling) never adds its own HQ damage — only Last Stand/Breakthrough', () => {
  const state = baseState(boardWith({ '0,0': unit('p1', 'T32'), '0,1': unit('p2', 'I1', { state: 'destroyed' }) }));
  const dyingSnapshot = unit('p2', 'I1');
  const { log } = applyPostDestructionEffects(state, { unitKey: '0,1', dyingUnit: dyingSnapshot, sourceUnitKey: '0,0' });
  assert.ok(!log.some(l => /HQ damage/i.test(l)), 'HQ damage is the combat path\'s own job (applyHit), not this sibling\'s');
});

// ── Section 7: Long War Commander (H24) permanent per-side bonus ─────────────
// game.js's H24 activation writes boardUnit[`perm_${dir}`] directly (not exported for direct
// unit testing — it's an internal game.js closure), but getSideValue is the one place that
// must actually READ it for the ability to do anything at all. Found via code reading that it
// didn't (a genuine, silent "major card effect does nothing" bug per checklist Section 13's
// NO-GO criteria) — fixed in state.js, verified here directly against getSideValue.
test('getSideValue includes a perm_<dir> bonus (Long War Commander, H24)', () => {
  const u = { cardId: 'I1', rotation: 0, perm_n: 3 }; // I1 printed n=5
  assert.equal(getSideValue(u, 'n'), 8);
  assert.equal(getSideValue(u, 'e'), 4, 'unaffected side is untouched');
});

test('a perm_<dir> bonus is stored card-relative and rotates with the Unit like every other stat', () => {
  // I1 printed: n=5 e=4 s=3 w=2. A 90° rotation shifts which printed side faces each physical
  // direction — the SAME shift must apply to a perm_ bonus, or it would silently detach from
  // its side the moment the Unit rotates (Change Formation, Field Coordinator, etc.).
  const unrotated = { cardId: 'I1', rotation: 0, perm_n: 10 };
  const rotated90 = { cardId: 'I1', rotation: 90, perm_n: 10 };
  assert.equal(getSideValue(unrotated, 'n'), 15, 'bonus applies to physical north pre-rotation');
  assert.notEqual(getSideValue(rotated90, 'n'), 15, 'after rotating, a different printed side now faces physical north');
  // Whichever physical direction now maps back to printed 'n' should carry the +10.
  const physicalDirs = ['n', 'e', 's', 'w'];
  const boosted = physicalDirs.filter(d => getSideValue(rotated90, d) >= 10);
  assert.equal(boosted.length, 1, 'the +10 bonus followed its printed side to exactly one (different) physical direction');
});
