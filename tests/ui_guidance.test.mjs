import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAttackOutcome, renderHand } from '../js/ui.js?v=20260903';

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
