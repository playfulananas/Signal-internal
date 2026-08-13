// Unit tests for the primitives the Hero layer is built on. Run: node --test tests/
// These are pure functions — no DOM, no Firebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { columnKeys, unitsInColumn, unitsOnBoard } from '../js/combat.js';
import { unsuppressOnBoard, getKeywords } from '../js/state.js';
import { CARDS } from '../js/cards.js';

// Minimal board fixture. Board keys are "row,col" — the column is the SECOND component,
// which is the easiest thing to get backwards.
function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  return { ...board, ...entries };
}
const unit = (owner, state = 'normal') => ({ cardId: 1, owner, state, armorHits: 0 });

test('columnKeys returns the 4 tiles of a column, top to bottom', () => {
  assert.deepEqual(columnKeys(0), ['0,0', '1,0', '2,0', '3,0']);
  assert.deepEqual(columnKeys(2), ['0,2', '1,2', '2,2', '3,2']);
});

test('unitsInColumn reads the column, not the row', () => {
  // A unit at "0,2" is in COLUMN 2, row 0 — the classic off-by-axis mistake.
  const state = { board: boardWith({ '0,2': unit('p1') }) };
  assert.equal(unitsInColumn(state, 2).length, 1);
  assert.equal(unitsInColumn(state, 0).length, 0);
});

test('unitsInColumn filters by owner when asked', () => {
  const state = { board: boardWith({ '0,1': unit('p1'), '2,1': unit('p2') }) };
  assert.equal(unitsInColumn(state, 1).length, 2);
  assert.equal(unitsInColumn(state, 1, 'p1').length, 1);
  assert.equal(unitsInColumn(state, 1, 'p2').length, 1);
});

test('unitsInColumn excludes destroyed units', () => {
  // Destroyed units linger on the board greyed out, but must never be targets or triggers.
  const state = { board: boardWith({ '0,3': unit('p1', 'destroyed'), '1,3': unit('p1', 'suppressed') }) };
  const found = unitsInColumn(state, 3);
  assert.equal(found.length, 1);
  assert.equal(found[0].key, '1,3');
});

test('unitsOnBoard finds units in any column, unlike unitsInColumn', () => {
  const state = { board: boardWith({ '0,0': unit('p1'), '3,3': unit('p1') }) };
  assert.equal(unitsOnBoard(state).length, 2);
});

test('unitsOnBoard filters by owner and excludes destroyed units, same as unitsInColumn', () => {
  const state = { board: boardWith({ '0,0': unit('p1'), '1,1': unit('p2'), '2,2': unit('p1', 'destroyed') }) };
  assert.equal(unitsOnBoard(state).length, 2);
  assert.equal(unitsOnBoard(state, 'p1').length, 1);
  assert.equal(unitsOnBoard(state, 'p2').length, 1);
});

test('getKeywords deduplicates — a unit with innate Guard that also gets granted Guard shows it once', () => {
  const guardCard = 62; // Bunker Crew — innate Guard (see cards.js)
  const unitWithGrant = { cardId: guardCard, tempKeywords: [], grantedKeywords: ['Guard'] };
  assert.deepEqual(getKeywords(unitWithGrant), ['Guard']);
});

test('getKeywords still returns distinct keywords from different sources untouched', () => {
  const unitMixed = { cardId: 62, tempKeywords: ['Armor'], grantedKeywords: ['Guard'] };
  assert.deepEqual(getKeywords(unitMixed), ['Guard', 'Armor']);
});

test('unsuppressOnBoard clears a suppressed unit and reports the change', () => {
  const board = boardWith({ '1,1': unit('p1', 'suppressed') });
  const { board: after, changed } = unsuppressOnBoard(board, '1,1');
  assert.equal(changed, true);
  assert.equal(after['1,1'].state, 'normal');
  assert.equal(board['1,1'].state, 'suppressed', 'must not mutate the input board');
});

test('unsuppressOnBoard is a no-op on a healthy unit', () => {
  // Hero passives gate on `changed`, so this must be false or they would fire spuriously.
  const board = boardWith({ '1,1': unit('p1', 'normal') });
  const { board: after, changed } = unsuppressOnBoard(board, '1,1');
  assert.equal(changed, false);
  assert.equal(after, board);
});

test('unsuppressOnBoard is a no-op on a destroyed unit and on an empty tile', () => {
  const board = boardWith({ '1,1': unit('p1', 'destroyed') });
  assert.equal(unsuppressOnBoard(board, '1,1').changed, false);
  assert.equal(unsuppressOnBoard(board, '3,3').changed, false);
});

test('every hero carries an authoritative scope and implemented flag', () => {
  // Scope must never be inferred from ability wording — hero 93 reads "this Hero's column"
  // only after a 2026-08-01 rewording, and text matching had misread it as board-scoped.
  const heroes = CARDS.filter(c => c.type === 'hero');
  assert.equal(heroes.length, 24);
  for (const h of heroes) {
    assert.ok(['column', 'board'].includes(h.scope), `${h.name} has no valid scope`);
    assert.equal(typeof h.implemented, 'boolean', `${h.name} has no implemented flag`);
  }
  assert.equal(heroes.filter(h => h.implemented).length, 12);
  // 14 column / 10 board as of the 2026-08 balance pass — Garrison Commander (99),
  // Counteroffensive General (101), and Armored Commander (103) moved column -> board.
  assert.equal(heroes.filter(h => h.scope === 'column').length, 14);
});

test('implemented heroes cover both scopes, both power types, and all 3 Commons', () => {
  const impl = CARDS.filter(c => c.type === 'hero' && c.implemented);
  assert.equal(impl.filter(h => h.powerType === 'active').length, 6);
  assert.equal(impl.filter(h => h.powerType === 'passive').length, 6);
  assert.ok(impl.some(h => h.scope === 'board') && impl.some(h => h.scope === 'column'));
  assert.equal(impl.filter(h => h.rarity === 'Common').length, 3);
});

test('a retired hero is never also marked implemented', () => {
  const bad = CARDS.filter(c => c.type === 'hero' && c.retired && c.implemented);
  assert.deepEqual(bad, []);
});

test('every starter deck roster uses only implemented heroes', async () => {
  // A deck stocked with deferred Heroes looks fine but plays as if it had none — the aggro
  // deck shipped that way until 2026-08-03. Assert it so it can't regress silently.
  const { STARTER_DECKS } = await import('../js/decks.js');
  const byId = Object.fromEntries(CARDS.map(c => [c.id, c]));
  for (const d of STARTER_DECKS) {
    for (const id of d.heroIds) {
      assert.ok(byId[id]?.implemented, `${d.name}: hero ${id} (${byId[id]?.name}) is not implemented`);
    }
  }
});
