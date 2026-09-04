import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAttackOutcome, renderEndTurnSummary, renderHand, summarizeTurnReadiness } from '../js/ui.js?v=2026090402';

function unit(cardId = 'I1', extra = {}) {
  return {
    cardId,
    owner: 'p2',
    state: 'normal',
    armorHits: 0,
    rotation: 0,
    tempKeywords: [],
    grantedKeywords: [],
    permanentKeywords: [],
    ...extra,
  };
}

function boardWith(entries) {
  const board = {};
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) board[`${r},${c}`] = null;
  }
  return { ...board, ...entries };
}

function turnState(board, extra = {}) {
  return {
    turn: 2,
    initiative: 'p1',
    mapId: 'kursk',
    board,
    objectives: {},
    p1: { hq: 30 },
    p2: { hq: 30 },
    ...extra,
  };
}

test('attack preview distinguishes blocked, Armor, and Suppression outcomes', () => {
  assert.deepEqual(describeAttackOutcome(unit(), false), {
    badge: 'BLOCKED',
    outcome: 'Attack blocked — no effect',
    hqDamage: 0,
  });

  assert.deepEqual(describeAttackOutcome(unit('T28'), true), {
    badge: 'HIT',
    outcome: 'Armor absorbs the hit — no HQ damage',
    hqDamage: 0,
  });

  assert.deepEqual(describeAttackOutcome(unit(), true), {
    badge: 'HIT',
    outcome: 'Suppressed — no HQ damage',
    hqDamage: 0,
  });
});

test('attack preview reports normal and Guard destruction damage accurately', () => {
  assert.deepEqual(describeAttackOutcome(unit('I1', { state: 'suppressed' }), true), {
    badge: 'HIT',
    outcome: 'Destroyed — 2 HQ damage to defender',
    hqDamage: 2,
  });

  assert.deepEqual(describeAttackOutcome(unit('I6', { state: 'suppressed' }), true), {
    badge: 'HIT',
    outcome: 'Destroyed — Guard prevents HQ damage',
    hqDamage: 0,
  });
});

test('attack preview includes Overrun damage for Suppression and destruction', () => {
  assert.deepEqual(describeAttackOutcome(unit(), true, { overrun: true }), {
    badge: 'HIT',
    outcome: 'Suppressed — 1 HQ damage to defender',
    hqDamage: 1,
  });

  assert.deepEqual(describeAttackOutcome(unit('I6', { state: 'suppressed' }), true, { overrun: true }), {
    badge: 'HIT',
    outcome: 'Destroyed — 1 HQ damage to defender',
    hqDamage: 1,
  });
});

test('hand rendering marks only cards that current Fuel cannot afford', (t) => {
  const children = [];
  const container = {
    innerHTML: '',
    appendChild(child) { children.push(child); },
  };
  const createElement = () => {
    const classes = new Set();
    return {
      className: '',
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        contains(name) { return classes.has(name); },
      },
      dataset: {},
      attributes: {},
      innerHTML: '',
      setAttribute(name, value) { this.attributes[name] = value; },
    };
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => container,
    createElement,
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  renderHand(['I1', 'C01'], 'test-hand', null, {
    playerState: { fuel: 0, pendingDiscounts: [] },
  });

  assert.equal(children.length, 2);
  for (const card of children) {
    assert.equal(card.classList.contains('cant-afford'), true);
    assert.equal(card.attributes['aria-disabled'], 'true');
    assert.equal(card.dataset.tip, 'Need 1 more Fuel');
  }

  children.length = 0;
  renderHand(['I1'], 'test-hand', null, {
    playerState: {
      fuel: 0,
      pendingDiscounts: [{ appliesTo: 'unit', column: null, amount: 1, min: 0 }],
    },
  });
  assert.equal(children[0].classList.contains('cant-afford'), false);
  assert.equal(children[0].attributes['aria-disabled'], undefined);
});

test('turn readiness separates clickable attacks from automatic Direct HQ damage', () => {
  const state = turnState(boardWith({
    '0,0': unit('T36', { owner: 'p1' }), // Double Attack, adjacent target: 2 usable attacks
    '0,1': unit('I2', { owner: 'p2' }),
    '3,3': unit('I1', { owner: 'p1' }),  // isolated: 1 automatic Direct HQ damage
  }));

  const summary = summarizeTurnReadiness(state, 'p1');
  assert.deepEqual(summary.canAttack, [{ key: '0,0', remaining: 2, targetCount: 1 }]);
  assert.deepEqual(summary.directHq, [{ key: '3,3', damage: 1 }]);
  assert.equal(summary.availableAttackCount, 2);
  assert.equal(summary.totalDirectHqDamage, 1);
  assert.equal(summary.lethal, false);
  assert.deepEqual(summary.indicators.get('0,0'), { kind: 'attack', count: 2, targetCount: 1 });
  assert.deepEqual(summary.indicators.get('3,3'), { kind: 'direct', count: 1, targetPlayer: 'p2' });
});

test('turn readiness uses the engine lethal stop for an isolated Double Attack Unit', () => {
  const state = turnState(
    boardWith({ '0,0': unit('T36', { owner: 'p1' }) }),
    { p2: { hq: 1 } },
  );

  const summary = summarizeTurnReadiness(state, 'p1');
  assert.equal(summary.totalDirectHqDamage, 1, 'forecast must not show the unused second hit after lethal');
  assert.deepEqual(summary.directHq, [{ key: '0,0', damage: 1 }]);
  assert.equal(summary.lethal, true);
});

test('turn readiness excludes turn-1 Direct HQ, suppressed Units, and spent Units', () => {
  const firstTurn = turnState(
    boardWith({ '0,0': unit('T36', { owner: 'p1' }) }),
    { turn: 1 },
  );
  const firstTurnSummary = summarizeTurnReadiness(firstTurn, 'p1');
  assert.equal(firstTurnSummary.totalDirectHqDamage, 0);
  assert.equal(firstTurnSummary.indicators.size, 0);

  const unavailable = turnState(boardWith({
    '0,0': unit('T36', { owner: 'p1', state: 'suppressed' }),
    '3,3': unit('I1', { owner: 'p1', persistentSpent: 1 }),
  }));
  const unavailableSummary = summarizeTurnReadiness(unavailable, 'p1');
  assert.equal(unavailableSummary.availableAttackCount, 0);
  assert.equal(unavailableSummary.totalDirectHqDamage, 0);
  assert.equal(unavailableSummary.indicators.size, 0);
});

test('End Turn summary names automatic damage, lethal, and forfeited attacks', (t) => {
  const makeNode = () => ({
    className: '',
    textContent: '',
    style: {},
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
  });
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: makeNode };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  const el = makeNode();
  renderEndTurnSummary(el, {
    targetPlayer: 'p2',
    totalDirectHqDamage: 2,
    availableAttackCount: 1,
    lethal: true,
  });

  assert.equal(el.style.display, 'block');
  assert.deepEqual(el.children.map(child => child.textContent), [
    'ENDING NOW',
    'LETHAL · 2 automatic damage to P2 HQ',
    '⚔ 1 usable attack will be forfeited',
  ]);

  renderEndTurnSummary(el, null);
  assert.equal(el.style.display, 'none');
  assert.equal(el.children.length, 0);
});
