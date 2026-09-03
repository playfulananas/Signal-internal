// Pure helpers for optimistic online-state writes. Firebase owns the compare-and-set
// transaction; this module owns the revision format so it can be tested without a browser.

export function stateRevision(state) {
  const revision = state?._revision;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function prepareVersionedState(state, pushId) {
  const expectedRevision = stateRevision(state);
  return {
    expectedRevision,
    state: {
      ...state,
      _revision: expectedRevision + 1,
      _pushId: pushId,
    },
  };
}

export function shouldAcceptRemoteState(localState, remoteState, { force = false } = {}) {
  return force || stateRevision(remoteState) >= stateRevision(localState);
}

export function normalizeRemoteUnit(unit) {
  if (!unit) return unit;
  const toArray = value => Array.isArray(value) ? value : Object.values(value ?? {});
  const normalized = {
    ...unit,
    tempKeywords: toArray(unit.tempKeywords),
    grantedKeywords: toArray(unit.grantedKeywords),
    permanentKeywords: toArray(unit.permanentKeywords),
  };

  // Matches created before permanentSideBonus used sideBonusTurns:99 as a permanence
  // sentinel. Convert that representation once when it crosses the network boundary.
  if ((normalized.sideBonusTurns ?? 0) >= 99) {
    normalized.permanentSideBonus = (normalized.permanentSideBonus || 0) + (normalized.grantedSideBonus || 0);
    normalized.grantedSideBonus = 0;
    normalized.sideBonusTurns = 0;
  }
  return normalized;
}

export function normalizeRemoteBoard(board) {
  if (!board) return {};
  return Object.fromEntries(Object.entries(board).map(([key, unit]) => {
    const normalized = normalizeRemoteUnit(unit);
    if (!normalized || normalized.instanceId) return [key, normalized];
    // Deterministic compatibility ID for an older in-progress match. Both clients derive the
    // same value, and the field then follows the object through every later Maneuver/write.
    return [key, { ...normalized, instanceId: `legacy-unit-${key.replace(',', '-')}` }];
  }));
}
