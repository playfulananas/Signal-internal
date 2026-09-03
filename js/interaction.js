// Pure interaction-lock and player-guidance rules shared by the UI and tests. A pending decision
// must be resolved before the player can start another primary action or end the turn. Mandatory
// decisions have their own controls and cannot be dismissed through the generic Cancel button.

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
  syncPaused = false,
} = {}) {
  if (syncPaused) {
    return { pending: true, mandatory: true, reason: 'Waiting for the shared game to reconnect' };
  }
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
  return { pending: false, mandatory: false, reason: null };
}

export function canCancelInteraction(context) {
  const decision = getInteractionDecision(context);
  return decision.pending && !decision.mandatory;
}

// Converts the controller's internal uiState into a short, persistent instruction. The battle
// log remains history; this guide answers the immediate question "what should I click now?".
// `subjectName` is deliberately supplied by game.js so this pure module does not depend on card
// data or the DOM. `customInstruction` covers Objective choices, whose wording depends on the
// current Objective/effect/step rather than uiState alone.
export function getInteractionGuide({
  uiState = 'idle',
  subjectName = '',
  customInstruction = '',
  remainingChoices = 0,
  canFinishEarly = false,
  selectedHeroZone = null,
  syncPaused = false,
} = {}) {
  const subject = subjectName ? ` ${subjectName}` : '';
  const remaining = remainingChoices > 0 ? ` · ${remainingChoices} remaining` : '';

  if (syncPaused) {
    return {
      label: 'CONNECTION PAUSED',
      instruction: 'Waiting for the latest shared game state.',
      hint: 'Actions will resume automatically after synchronization.',
      tone: 'warning',
      mandatory: true,
    };
  }

  switch (uiState) {
    case 'placing':
      return {
        label: `PLACE${subject}`,
        instruction: 'Choose a green deployment tile.',
        hint: 'Red dashed tiles are blocked by terrain · Esc cancels',
        tone: 'placement',
        mandatory: false,
      };
    case 'targeting':
      return {
        label: `ATTACK WITH${subject}`,
        instruction: 'Choose a red enemy target.',
        hint: 'Hover a target to preview the result · Esc cancels',
        tone: 'danger',
        mandatory: false,
      };
    case 'command-targeting':
      return {
        label: `RESOLVE${subject}${remaining}`,
        instruction: 'Choose a highlighted board target.',
        hint: canFinishEarly
          ? 'Choose another target, or press Done to keep your selection'
          : 'Blue is friendly/utility · Red is destructive · Esc cancels',
        tone: 'choice',
        mandatory: false,
      };
    case 'command-hero-targeting':
      return {
        label: `RESOLVE${subject}`,
        instruction: 'Choose a red-highlighted enemy Hero.',
        hint: 'Esc cancels and refunds the Command',
        tone: 'danger',
        mandatory: false,
      };
    case 'command-maneuver-source':
      return {
        label: `RESOLVE${subject} · STEP 1/2${remaining}`,
        instruction: 'Choose a blue-highlighted Unit to Maneuver.',
        hint: 'Esc cancels and refunds the Command',
        tone: 'movement',
        mandatory: false,
      };
    case 'command-maneuver-destination':
      return {
        label: `RESOLVE${subject} · STEP 2/2`,
        instruction: 'Choose a blue-highlighted destination tile.',
        hint: 'Blue tiles are legal destinations · Esc cancels',
        tone: 'movement',
        mandatory: false,
      };
    case 'command-coordstrike-first':
      return {
        label: `RESOLVE${subject} · STEP 1/2`,
        instruction: 'Choose the first blue-highlighted friendly Unit.',
        hint: 'Esc cancels and refunds the Command',
        tone: 'choice',
        mandatory: false,
      };
    case 'command-coordstrike-second':
      return {
        label: `RESOLVE${subject} · STEP 2/2`,
        instruction: 'Choose a second highlighted Unit sharing a legal target.',
        hint: 'Esc cancels and refunds the Command',
        tone: 'choice',
        mandatory: false,
      };
    case 'hero-targeting':
      return {
        label: `ACTIVATE${subject}`,
        instruction: 'Choose a blue-highlighted target.',
        hint: 'Esc cancels the Hero Power',
        tone: 'choice',
        mandatory: false,
      };
    case 'hero-maneuver-destination':
      return {
        label: `ACTIVATE${subject} · STEP 2/2`,
        instruction: 'Choose a blue-highlighted destination tile.',
        hint: 'Esc cancels the Hero Power',
        tone: 'movement',
        mandatory: false,
      };
    case 'unit-maneuver-source':
      return {
        label: `${subjectName || 'ON-PLAY MANEUVER'} · STEP 1/2`,
        instruction: 'Choose a blue-highlighted friendly Unit to Maneuver.',
        hint: 'Required choice — finish it before taking another action',
        tone: 'required',
        mandatory: true,
      };
    case 'unit-maneuver-destination':
      return {
        label: `${subjectName || 'ON-PLAY MANEUVER'} · STEP 2/2`,
        instruction: 'Choose a blue-highlighted destination tile.',
        hint: 'Required choice — the Unit keeps its attacks and effects',
        tone: 'required',
        mandatory: true,
      };
    case 'objective-picking':
      return {
        label: 'REQUIRED OBJECTIVE CHOICE',
        instruction: customInstruction || 'Choose a highlighted target.',
        hint: 'Finish this choice before taking another action',
        tone: 'required',
        mandatory: true,
      };
    case 'arty-targeting':
      return {
        label: `REQUIRED ARTILLERY HIT${remaining}`,
        instruction: 'Choose a red-highlighted enemy Unit.',
        hint: 'Finish every required hit before taking another action',
        tone: 'required',
        mandatory: true,
      };
    default:
      if (selectedHeroZone !== null) {
        return {
          label: `REPOSITION${subject}`,
          instruction: 'Choose another Hero column, or click the selected Hero again to cancel.',
          hint: 'An occupied destination swaps the two Heroes',
          tone: 'movement',
          mandatory: false,
        };
      }
      return null;
  }
}
