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
