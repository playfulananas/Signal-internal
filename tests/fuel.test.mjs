// Tests for gainFuel's capped-gain logic (doc 02 Q033-Q037). The original implementation
// clamped the RESULT to the cap (Math.min(cap, fuel+amount)), which silently reduced Fuel
// that was already above the cap from a prior uncapped effect-generated gain — e.g. fuel
// already at 12 with cap 9, a normal +3 step computed min(9, 15) = 9, erasing 3 legitimate
// Fuel every turn. Doc 02 Q037 is explicit this must add 0 instead, never reduce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gainFuel } from '../js/state.js';

function ps(fuel, overrides = {}) {
  return { fuel, fuelCap: 9, heroZones: [null, null, null, null], ...overrides };
}

test('gainFuel: doc 02 example — Fuel 4, gain 3 -> 7', () => {
  assert.equal(gainFuel(ps(4), 3).fuel, 7);
});

test('gainFuel: doc 02 example — Fuel 8, gain 3 -> 9 (partial gain, not overshoot)', () => {
  assert.equal(gainFuel(ps(8), 3).fuel, 9);
});

test('gainFuel: doc 02 example — Fuel 9 (at cap), gain 3 -> 9 (gains 0)', () => {
  assert.equal(gainFuel(ps(9), 3).fuel, 9);
});

test('gainFuel: doc 02 example — Logistics Chief cap 11, Fuel 10, gain 3 -> 11', () => {
  assert.equal(gainFuel(ps(10, { heroZones: ['H02', null, null, null] }), 3).fuel, 11);
});

test('gainFuel: doc 02 Q037 — Fuel already above cap (12, from an uncapped grant) is NOT reduced by a normal capped gain, adds 0', () => {
  assert.equal(gainFuel(ps(12), 3).fuel, 12);
});

test('gainFuel: uncapped (cap=false) always adds the full amount regardless of threshold', () => {
  assert.equal(gainFuel(ps(9), 2, false).fuel, 11);
  assert.equal(gainFuel(ps(12), 2, false).fuel, 14);
});
