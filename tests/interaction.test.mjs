import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancelInteraction, getInteractionDecision, getInteractionGuide } from '../js/interaction.js?v=20260903';

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

test('every multi-step board interaction has a persistent guide', () => {
  const guidedStates = [
    'placing',
    'targeting',
    'command-targeting',
    'command-hero-targeting',
    'command-maneuver-source',
    'command-maneuver-destination',
    'command-coordstrike-first',
    'command-coordstrike-second',
    'hero-targeting',
    'hero-maneuver-destination',
    'unit-maneuver-source',
    'unit-maneuver-destination',
    'objective-picking',
    'arty-targeting',
  ];

  for (const uiState of guidedStates) {
    const guide = getInteractionGuide({ uiState, subjectName: 'Test Subject' });
    assert.ok(guide, `${uiState} should have a guide`);
    assert.ok(guide.label, `${uiState} should have a label`);
    assert.ok(guide.instruction, `${uiState} should have an instruction`);
    assert.ok(guide.hint, `${uiState} should have a hint`);
    assert.ok(guide.tone, `${uiState} should have a tone`);
  }
});

test('interaction guides use action-specific wording and mandatory status', () => {
  const placement = getInteractionGuide({ uiState: 'placing', subjectName: 'Mobile Fortress' });
  assert.match(placement.label, /Mobile Fortress/);
  assert.match(placement.instruction, /green deployment tile/i);
  assert.equal(placement.mandatory, false);

  const objective = getInteractionGuide({
    uiState: 'objective-picking',
    customInstruction: 'Choose a Unit beside the Airfield.',
  });
  assert.equal(objective.instruction, 'Choose a Unit beside the Airfield.');
  assert.equal(objective.mandatory, true);

  const maneuver = getInteractionGuide({ uiState: 'unit-maneuver-destination' });
  assert.equal(maneuver.mandatory, true);
  assert.match(maneuver.hint, /Required choice/);

  const optionalSecondTarget = getInteractionGuide({
    uiState: 'command-targeting',
    remainingChoices: 1,
    canFinishEarly: true,
  });
  assert.match(optionalSecondTarget.hint, /press Done/);
});

test('idle guidance appears only for Hero repositioning or a sync pause', () => {
  assert.equal(getInteractionGuide(), null);

  const reposition = getInteractionGuide({ selectedHeroZone: 1, subjectName: 'Tactician' });
  assert.match(reposition.label, /Tactician/);
  assert.match(reposition.instruction, /Hero column/);
  assert.equal(reposition.mandatory, false);

  const paused = getInteractionGuide({ syncPaused: true });
  assert.equal(paused.label, 'CONNECTION PAUSED');
  assert.equal(paused.mandatory, true);
  assert.equal(paused.tone, 'warning');
});
