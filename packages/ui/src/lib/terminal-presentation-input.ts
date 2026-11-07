import type { Terminal } from "@xterm/xterm";

export interface TerminalPresentationToken {
  readonly presenterId: string;
  readonly epoch: number;
}

interface TerminalPresentationState {
  managed: boolean;
  nextEpoch: number;
  currentToken: TerminalPresentationToken | null;
  suppressionReasons: Set<string>;
  listeners: Set<() => void>;
}

const presentationStates = new WeakMap<Terminal, TerminalPresentationState>();

function notifyPresentationListeners(state: TerminalPresentationState): void {
  const snapshot = Array.from(state.listeners);
  for (const listener of snapshot) {
    try {
      listener();
    } catch (err) {
      console.error("Error in terminal presentation listener", err);
    }
  }
}

/**
 * Acquires presentation ownership of a terminal.
 *
 * Rules:
 * - Marks the terminal permanently as "presentation-managed".
 * - Epoch is strictly monotonically increasing and never resets, even across releases and re-acquisitions.
 * - Resets presenter-specific suppression reasons.
 * - Synchronously notifies subscribers so quiet-PTYs recover input immediately without PTY drain activity.
 */
export function acquireTerminalPresentation(
  term: Terminal,
  presenterId: string,
): TerminalPresentationToken {
  let state = presentationStates.get(term);
  if (!state) {
    state = {
      managed: true,
      nextEpoch: 1,
      currentToken: null,
      suppressionReasons: new Set(),
      listeners: new Set(),
    };
    presentationStates.set(term, state);
  } else {
    state.managed = true;
  }

  const token: TerminalPresentationToken = Object.freeze({
    presenterId,
    epoch: state.nextEpoch++,
  });
  state.currentToken = token;
  state.suppressionReasons.clear();
  notifyPresentationListeners(state);
  return token;
}

/**
 * Releases presentation ownership of a terminal.
 *
 * Rules:
 * - No-op unless the supplied token matches the currently active presenter and epoch.
 * - Stale release does not mutate state or notify subscribers.
 * - Releasing the current presenter sets currentToken to null and clears suppression reasons.
 * - Leaves the terminal in "presentation-managed" mode; managed terminals with no presenter remain suppressed.
 * - Notifies subscribers of the release.
 */
export function releaseTerminalPresentation(
  term: Terminal,
  token: TerminalPresentationToken,
): void {
  const state = presentationStates.get(term);
  if (!state || !state.currentToken) return;
  if (
    state.currentToken.presenterId !== token.presenterId ||
    state.currentToken.epoch !== token.epoch
  ) {
    return;
  }

  state.currentToken = null;
  state.suppressionReasons.clear();
  notifyPresentationListeners(state);
}

/**
 * Checks whether the given token currently owns presentation of the terminal.
 */
export function isCurrentTerminalPresenter(
  term: Terminal,
  token: TerminalPresentationToken,
): boolean {
  const state = presentationStates.get(term);
  if (!state || !state.currentToken) return false;
  return (
    state.currentToken.presenterId === token.presenterId &&
    state.currentToken.epoch === token.epoch
  );
}

/**
 * Toggles a presenter-scoped input suppression reason (e.g. "inactive-pane", "blur").
 *
 * Rules:
 * - No-op unless the token is the current active presenter.
 * - Idempotent: notifying subscribers only occurs when the reason state actually changes.
 */
export function setPresenterInputSuppression(
  term: Terminal,
  token: TerminalPresentationToken,
  reason: string,
  suppressed: boolean,
): void {
  const state = presentationStates.get(term);
  if (!state || !state.currentToken) return;
  if (
    state.currentToken.presenterId !== token.presenterId ||
    state.currentToken.epoch !== token.epoch
  ) {
    return;
  }

  const hadReason = state.suppressionReasons.has(reason);
  if (suppressed) {
    if (!hadReason) {
      state.suppressionReasons.add(reason);
      notifyPresentationListeners(state);
    }
  } else {
    if (hadReason) {
      state.suppressionReasons.delete(reason);
      notifyPresentationListeners(state);
    }
  }
}

/**
 * Executes a cleanup action (such as key-handler reset, blur, or parking)
 * ONLY if the supplied token is still the current active presenter.
 *
 * Returns true if cleanup ran, or false if the presenter was stale/preempted.
 */
export function runIfCurrentPresenter(
  term: Terminal,
  token: TerminalPresentationToken,
  cleanup: () => void,
): boolean {
  if (!isCurrentTerminalPresenter(term, token)) {
    return false;
  }
  cleanup();
  return true;
}

/**
 * Computes effective stdin suppression for a terminal:
 * - If panelSuppressed is true (global replay, modal, cognito, etc.), returns true.
 * - If terminal is unmanaged (never acquired), returns panelSuppressed (legacy behavior).
 * - If terminal is managed and has no current presenter, returns true (suppressed).
 * - If terminal is managed and current presenter has any suppression reason, returns true.
 * - Otherwise returns false (unsuppressed).
 */
export function computePresentedInputSuppression(
  term: Terminal,
  panelSuppressed: boolean,
): boolean {
  if (panelSuppressed) return true;

  const state = presentationStates.get(term);
  if (!state || !state.managed) {
    return panelSuppressed;
  }

  if (!state.currentToken) {
    return true;
  }

  return state.suppressionReasons.size > 0;
}

/**
 * Subscribes to terminal presentation changes (acquire, release, suppression reason toggle).
 *
 * Note: Subscribing before first acquire does NOT mark the terminal as managed.
 */
export function subscribeTerminalPresentation(
  term: Terminal,
  listener: () => void,
): () => void {
  let state = presentationStates.get(term);
  if (!state) {
    state = {
      managed: false,
      nextEpoch: 1,
      currentToken: null,
      suppressionReasons: new Set(),
      listeners: new Set(),
    };
    presentationStates.set(term, state);
  }
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}
