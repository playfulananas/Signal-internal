// Pure interaction-lock rules shared by the UI and tests. A pending decision must be resolved
// before the player can start another primary action or end the turn. Mandatory decisions have
// their own controls and cannot be dismissed through the generic Cancel button.

const MANDATORY_UI_STATES = new Set([
  'arty-targeting',
  'objective-picking',
  'unit-maneuver-source',
  'unit-maneuver-destination',
]);

const LABELS = {
  'arty-targeting': 'Resolve the Artillery Position hit',
  'objective-picking': 'Resolve the Objective choice',
  'unit-maneuver-source': 'Choose a Unit to Maneuver',
  'unit-maneuver-destination': 'Choose the Maneuver destination',
  placing: 'Finish or cancel Unit placement',
  targeting: 'Finish or cancel the attack',
  'command-targeting': 'Finish or cancel the Command',
  'command-hero-targeting': 'Finish or cancel the Command',
  'command-maneuver-source': 'Finish or cancel the Command',
  'command-maneuver-destination': 'Finish or cancel the Command',
  'command-coordstrike-first': 'Finish or cancel the Command',
  'command-coordstrike-second': 'Finish or cancel the Command',
  'hero-targeting': 'Finish or cancel the Hero Power',
  'hero-maneuver-destination': 'Finish or cancel the Hero Power',
};

export function getInteractionDecision({
  uiState = 'idle',
  pendingObjectivePick = null,
  pendingArtyHits = 0,
  hasBlockingModal = false,
  pendingCommandId = null,
  selectedHeroZone = null,
  pendingHalftrackMove = null,
} = {}) {
  if (pendingObjectivePick || uiState === 'objective-picking') {
    return { pending: true, mandatory: true, reason: LABELS['objective-picking'] };
  }
  if (pendingArtyHits > 0 || uiState === 'arty-targeting') {
    return { pending: true, mandatory: true, reason: LABELS['arty-targeting'] };
  }
  if (hasBlockingModal) {
    return { pending: true, mandatory: true, reason: 'Finish the open choice' };
  }
  if (MANDATORY_UI_STATES.has(uiState)) {
    return { pending: true, mandatory: true, reason: LABELS[uiState] };
  }
  if (uiState !== 'idle') {
    return { pending: true, mandatory: false, reason: LABELS[uiState] ?? 'Finish or cancel the current action' };
  }
  if (pendingCommandId !== null) {
    return { pending: true, mandatory: false, reason: 'Finish or cancel the Command' };
  }
  if (selectedHeroZone !== null) {
    return { pending: true, mandatory: false, reason: 'Finish or cancel Hero repositioning' };
  }
  if (pendingHalftrackMove !== null) {
    return { pending: true, mandatory: false, reason: 'Move a Hero or skip the optional move' };
  }
  return { pending: false, mandatory: false, reason: null };
}

export function canCancelInteraction(context) {
  const decision = getInteractionDecision(context);
  return decision.pending && !decision.mandatory;
}
