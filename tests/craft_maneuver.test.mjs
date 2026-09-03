// Unit tests for the Maneuver and Craft (H25) mechanics, new 2026-08-31 (Run 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getManeuverTargets, resolveManeuver, generateCraftCandidates, craftCandidateToCard, resolveCraftDrawback, nextCraftCost, advanceCraftCost, applyHandBuff } from '../js/combat.js';
import { CARD_BY_ID, ensureGeneratedCard } from '../js/cards.js?v=20260902';

function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
const unit = (owner, cardId = 'I1', extra = {}) => ({ cardId, owner, state: 'normal', armorHits: 0, rotation: 0, ...extra });

test('getManeuverTargets excludes occupied tiles, Objective tiles, and illegal terrain', () => {
  // Kursk's grid has Forest at all 4 corners (0,0)/(0,3)/(3,0)/(3,3) — start the Tank at a
  // plains tile (1,0) so those 4 corners are pure "blocked terrain elsewhere on the board"
  // exclusions, separate from the occupied/Objective cases this test targets.
  const state = {
    mapId: 'kursk',
    board: boardWith({ '1,0': unit('p1', 'T23'), '1,1': unit('p2') }), // T23 = Tank
    objectives: { '2,2': { cardId: 'O1', level: 1 } },
  };
  const targets = getManeuverTargets(state, '1,0');
  assert.ok(!targets.includes('1,1'), 'occupied tile excluded');
  assert.ok(!targets.includes('2,2'), 'Objective tile excluded');
  assert.ok(!targets.includes('0,0') && !targets.includes('0,3') && !targets.includes('3,0') && !targets.includes('3,3'), 'forest corners excluded for a Tank');
  // 16 tiles - self(1) - occupied(1,1) - objective(2,2) - 4 forest corners = 9
  assert.equal(targets.length, 9);
});

test('getManeuverTargets blocks a Tank from Forest tiles', () => {
  // Ardennes has forest at (0,0) and plains at (0,1)/(0,2) per maps.js.
  const state = { mapId: 'ardennes', board: boardWith({ '3,3': unit('p1', 'T23') }), objectives: {} };
  const targets = getManeuverTargets(state, '3,3');
  assert.ok(!targets.includes('0,0'), 'forest tile blocked for a Tank');
});

test('resolveManeuver moves the unit and preserves its state', () => {
  const state = { mapId: 'kursk', board: boardWith({ '0,0': unit('p1', 'I1', { rotation: 90, persistentSpent: 1 }) }), objectives: {} };
  const { state: after } = resolveManeuver(state, '0,0', '3,3');
  assert.equal(after.board['0,0'], null);
  assert.equal(after.board['3,3'].cardId, 'I1');
  assert.equal(after.board['3,3'].rotation, 90, 'orientation preserved');
  assert.equal(after.board['3,3'].persistentSpent, 1, 'attack-used state preserved');
});

test('generateCraftCandidates returns exactly 3 candidates, each with a valid keyword and drawback', () => {
  const candidates = generateCraftCandidates();
  assert.equal(candidates.length, 3);
  for (const c of candidates) {
    assert.ok(['Bombard', 'Double Attack', 'Armor'].includes(c.keyword));
    assert.ok(['rotateAll', 'ownHqDamage', 'suppressRandomFriendly'].includes(c.drawback));
    const total = c.stats.n + c.stats.e + c.stats.s + c.stats.w;
    const isFixed = c.stats.n === 6 && c.stats.e === 6 && c.stats.s === 6 && c.stats.w === 6;
    assert.ok(isFixed || total === 27, `stats must be 6/6/6/6 or total 27, got ${JSON.stringify(c.stats)}`);
    assert.ok(c.stats.n >= 0 && c.stats.e >= 0 && c.stats.s >= 0 && c.stats.w >= 0, 'no negative side');
  }
});

test('random27 stats integrity holds across many rolls', () => {
  for (let i = 0; i < 200; i++) {
    const [c] = generateCraftCandidates();
    const total = c.stats.n + c.stats.e + c.stats.s + c.stats.w;
    const isFixed = c.stats.n === 6 && c.stats.e === 6 && c.stats.s === 6 && c.stats.w === 6;
    assert.ok(isFixed || total === 27);
  }
});

// Checklist Section 8: "6/6/6/6 stats option can occur" and "zero side is legal" — both are
// probabilistic, so assert they actually show up across enough rolls rather than just being
// theoretically possible (a regression that silently narrowed either range wouldn't fail the
// integrity check above, since e.g. always-random27 or always-nonzero would still pass it).
test('the fixed 6/6/6/6 stats option actually occurs across many rolls', () => {
  let sawFixed = false;
  for (let i = 0; i < 500 && !sawFixed; i++) {
    const [c] = generateCraftCandidates();
    if (c.stats.n === 6 && c.stats.e === 6 && c.stats.s === 6 && c.stats.w === 6) sawFixed = true;
  }
  assert.ok(sawFixed, '6/6/6/6 never rolled in 500 tries — statsRoll===0 branch may be broken');
});

test('a zero-value side actually occurs across many random27 rolls', () => {
  let sawZero = false;
  for (let i = 0; i < 500 && !sawZero; i++) {
    const [c] = generateCraftCandidates();
    if ([c.stats.n, c.stats.e, c.stats.s, c.stats.w].includes(0)) sawZero = true;
  }
  assert.ok(sawZero, 'no zero side rolled in 500 tries — stick-breaking cut points may never collide');
});

test('craftCandidateToCard produces a real Aircraft card definition, not in the static pool', () => {
  const candidate = { stats: { n: 6, e: 6, s: 6, w: 6 }, keyword: 'Armor', drawback: 'ownHqDamage' };
  const card = craftCandidateToCard(candidate, 'p1');
  assert.ok(card.id.startsWith('Craft-p1-'), `id should be namespaced by role, got: ${card.id}`);
  assert.equal(card.cls, 'Aircraft');
  assert.equal(card.cost, 1);
  assert.equal(card.generated, true);
  assert.equal(card.craftDrawback, 'ownHqDamage');
  assert.equal(CARD_BY_ID[card.id], card, 'generated card must be visible through the shared card registry');
});

test('resolveCraftDrawback: ownHqDamage deals exactly 3 to the owner\'s HQ', () => {
  const state = { board: boardWith({ '0,0': unit('p1') }), p1: { hq: 30 }, p2: { hq: 30 } };
  const { state: after, log } = resolveCraftDrawback(state, 'p1', '0,0', 'ownHqDamage');
  assert.equal(after.p1.hq, 27);
  assert.equal(after.p2.hq, 30);
  assert.equal(log.length, 1);
});

test('resolveCraftDrawback: suppressRandomFriendly can select the crafted Aircraft itself', () => {
  // Single friendly unit on board — must be selectable (doc 01 §28: "includes it unless wording says other").
  const state = { board: boardWith({ '0,0': unit('p1', 'A54') }), p1: {}, p2: {} };
  const { state: after } = resolveCraftDrawback(state, 'p1', '0,0', 'suppressRandomFriendly');
  assert.equal(after.board['0,0'].state, 'suppressed');
});

test('resolveCraftDrawback: rotateAll rotates every friendly unit including the crafted one, not enemies', () => {
  const state = { board: boardWith({ '0,0': unit('p1', 'I1', { rotation: 0 }), '1,1': unit('p2', 'I1', { rotation: 0 }) }), p1: {}, p2: {} };
  const { state: after } = resolveCraftDrawback(state, 'p1', '0,0', 'rotateAll');
  assert.notEqual(after.board['0,0'].rotation, 0, 'friendly unit rotated');
  assert.equal(after.board['1,1'].rotation, 0, 'enemy unit untouched');
});

test('applyHandBuff replaces qualifying hand slots with buffed clones, leaves the rest untouched', () => {
  // I1 Rifle Squad is cost 1 (qualifies); T27 King Tiger is cost 6 (does not).
  const ps = { hand: ['I1', 'T27', 'I1'] };
  const { playerState, log, generated } = applyHandBuff(ps, 1, c => c.cost === 1 || c.cost === 2, 'p1');
  assert.equal(playerState.hand.length, 3);
  assert.equal(playerState.hand[1], 'T27', 'non-qualifying card untouched, same id');
  assert.notEqual(playerState.hand[0], 'I1', 'qualifying card replaced with a new clone id');
  assert.notEqual(playerState.hand[2], 'I1', 'second copy also replaced');
  assert.notEqual(playerState.hand[0], playerState.hand[2], 'two independent clones, not the same instance');
  assert.equal(log.length, 2, 'one log line per buffed card');
  // Doc 2026-09-01 multiplayer fix: every clone's full definition must be returned too, so the
  // caller can thread it into shared state's generatedCards for the other client to receive.
  assert.equal(generated.length, 2, 'one generated definition per buffed card');
  assert.ok(generated.every(g => g.id.startsWith('Craft-p1-')), 'generated ids namespaced by role');
  assert.deepEqual(generated.map(g => g.id), playerState.hand.filter(id => id !== 'T27'), 'generated ids match the hand\'s new clone ids');
});

test('applyHandBuff is a no-op when nothing in hand qualifies', () => {
  const ps = { hand: ['T27'] };
  const { playerState, log, generated } = applyHandBuff(ps, 1, c => c.cost === 1, 'p1');
  assert.deepEqual(playerState.hand, ['T27']);
  assert.deepEqual(log, []);
  assert.deepEqual(generated, []);
});

test('registerGeneratedCard (via craftCandidateToCard) namespaces ids by role so two clients crafting independently never collide', () => {
  const candidate = { stats: { n: 1, e: 1, s: 1, w: 1 }, keyword: 'Armor', drawback: 'ownHqDamage' };
  const p1Card = craftCandidateToCard(candidate, 'p1');
  const p2Card = craftCandidateToCard(candidate, 'p2');
  assert.notEqual(p1Card.id, p2Card.id, 'p1 and p2 crafting independently must never produce the same id');
  assert.ok(p1Card.id.includes('-p1-'));
  assert.ok(p2Card.id.includes('-p2-'));
});

// 2026-09-01 multiplayer fix: ensureGeneratedCard is the receiving-client half of syncing a
// Craft/Training-Officer card across the network — normalizeFirebaseState (game.js) calls it
// for every entry in the synced generatedCards dict on every state update.
test('ensureGeneratedCard registers a definition under its given id when not already present', () => {
  assert.equal(CARD_BY_ID['Craft-test-1'], undefined, 'precondition: id not already registered');
  const registered = ensureGeneratedCard('Craft-test-1', { name: 'Synced Aircraft', cls: 'Aircraft', n: 3, e: 3, s: 3, w: 3 });
  assert.equal(registered.id, 'Craft-test-1');
  assert.equal(registered.generated, true);
  assert.equal(CARD_BY_ID['Craft-test-1'].name, 'Synced Aircraft');
});

test('ensureGeneratedCard is idempotent — does not overwrite an already-registered definition', () => {
  ensureGeneratedCard('Craft-test-2', { name: 'First' });
  ensureGeneratedCard('Craft-test-2', { name: 'Second — should be ignored' });
  assert.equal(CARD_BY_ID['Craft-test-2'].name, 'First', 're-registering the same id must not clobber the existing definition');
});

test('nextCraftCost/advanceCraftCost: 5 -> 4 -> 3 -> 2 -> 1 -> 1 progression, floor 1', () => {
  let ps = {};
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(nextCraftCost(ps));
    ps = advanceCraftCost(ps);
  }
  assert.deepEqual(seen, [5, 4, 3, 2, 1, 1]);
});
