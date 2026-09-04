import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancelInteraction, getInteractionDecision } from '../js/interaction.js?v=2026090401';

test('idle play has no interaction lock', () => {
  assert.deepEqual(getInteractionDecision(), { pending: false, mandatory: false, reason: null });
  assert.equal(canCancelInteraction(), false);
});

test('voluntary targeting blocks other actions but remains cancellable', () => {
  for (const uiState of ['placing', 'targeting', 'command-targeting', 'hero-targeting']) {
    const context = { uiState };
    assert.equal(getInteractionDecision(context).pending, true, uiState);
    assert.equal(getInteractionDecision(context).mandatory, false, uiState);
    assert.equal(canCancelInteraction(context), true, uiState);
  }
});

test('Objective, Artillery, and on-play Maneuver choices cannot be skipped', () => {
  const contexts = [
    { uiState: 'idle', pendingObjectivePick: { objectiveKey: '1,1' } },
    { uiState: 'idle', pendingArtyHits: 2 },
    { uiState: 'objective-picking' },
    { uiState: 'arty-targeting' },
    { uiState: 'unit-maneuver-source' },
    { uiState: 'unit-maneuver-destination' },
  ];

  for (const context of contexts) {
    const decision = getInteractionDecision(context);
    assert.equal(decision.pending, true);
    assert.equal(decision.mandatory, true);
    assert.equal(canCancelInteraction(context), false);
  }
});

test('open modals block hidden buttons and keyboard-triggered actions', () => {
  const context = { uiState: 'idle', hasBlockingModal: true };
  assert.equal(getInteractionDecision(context).pending, true);
  assert.equal(getInteractionDecision(context).mandatory, true);
  assert.equal(canCancelInteraction(context), false);
});

test('a paused online sync blocks new actions until server state is restored', () => {
  const context = { uiState: 'idle', syncPaused: true };
  assert.deepEqual(getInteractionDecision(context), {
    pending: true,
    mandatory: true,
    reason: 'Waiting for the shared game to reconnect',
  });
  assert.equal(canCancelInteraction(context), false);
});

test('Hero reposition and Command Shuffle stay explicit', () => {
  const contexts = [
    { selectedHeroZone: 0 },
    { pendingCommandId: 'C15' },
  ];
  for (const context of contexts) {
    assert.equal(getInteractionDecision(context).pending, true);
    assert.equal(canCancelInteraction(context), true);
  }
});
