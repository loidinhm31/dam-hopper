export const TERMINAL_OUTPUT_ACTIVITY_WINDOW_MS = 3_000;

export interface TerminalOutputActivitySnapshot {
  readonly recentOutput: boolean;
  readonly streamReady: boolean;
}

export interface TerminalOutputActivityRegistration {
  markOutput(): void;
  setStreamReady(ready: boolean): void;
  dispose(): void;
}

type Listener = () => void;
type Timer = ReturnType<typeof setTimeout>;

const EMPTY_SNAPSHOT: TerminalOutputActivitySnapshot = Object.freeze({
  recentOutput: false,
  streamReady: false,
});

interface SessionState {
  snapshot: TerminalOutputActivitySnapshot;
  lastOutputAt: number | null;
  timer: Timer | null;
  owner: symbol | undefined;
  listeners: Set<Listener>;
}

const sessions = new Map<string, SessionState>();

function getOrCreate(sessionId: string): SessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const state: SessionState = {
    snapshot: EMPTY_SNAPSHOT,
    lastOutputAt: null,
    timer: null,
    owner: undefined,
    listeners: new Set(),
  };
  sessions.set(sessionId, state);
  return state;
}

function notify(state: SessionState): void {
  state.listeners.forEach((listener) => listener());
}

function setSnapshot(
  state: SessionState,
  snapshot: TerminalOutputActivitySnapshot,
): void {
  if (
    state.snapshot.recentOutput === snapshot.recentOutput &&
    state.snapshot.streamReady === snapshot.streamReady
  ) {
    return;
  }
  state.snapshot = Object.freeze(snapshot);
  notify(state);
}

function clearTimer(state: SessionState): void {
  if (state.timer === null) return;
  clearTimeout(state.timer);
  state.timer = null;
}

function clearRecentOutput(state: SessionState, streamReady: boolean): void {
  clearTimer(state);
  state.lastOutputAt = null;
  setSnapshot(state, { recentOutput: false, streamReady });
}

function scheduleExpiry(
  sessionId: string,
  state: SessionState,
  delay = TERMINAL_OUTPUT_ACTIVITY_WINDOW_MS,
): void {
  const expectedOwner = state.owner;
  state.timer = setTimeout(() => {
    if (sessions.get(sessionId) !== state || state.owner !== expectedOwner) {
      return;
    }
    state.timer = null;
    if (state.lastOutputAt === null) return;

    const remaining =
      TERMINAL_OUTPUT_ACTIVITY_WINDOW_MS - (Date.now() - state.lastOutputAt);
    if (remaining > 0) {
      scheduleExpiry(sessionId, state, remaining);
      return;
    }
    setSnapshot(state, {
      recentOutput: false,
      streamReady: state.snapshot.streamReady,
    });
  }, delay);
}

function markOutputForState(sessionId: string, state: SessionState): void {
  if (!state.snapshot.streamReady) return;
  state.lastOutputAt = Date.now();
  setSnapshot(state, {
    recentOutput: true,
    streamReady: state.snapshot.streamReady,
  });
  if (state.timer === null) scheduleExpiry(sessionId, state);
}

function setReadyForState(state: SessionState, ready: boolean): void {
  if (!ready) {
    clearRecentOutput(state, false);
    return;
  }
  setSnapshot(state, {
    recentOutput: state.snapshot.recentOutput,
    streamReady: true,
  });
}

function disposeState(
  sessionId: string,
  state: SessionState,
  owner?: symbol,
): void {
  if (owner !== undefined && state.owner !== owner) return;
  state.owner = undefined;
  clearRecentOutput(state, false);
  if (state.listeners.size === 0) sessions.delete(sessionId);
}

export function getTerminalOutputActivitySnapshot(
  sessionId: string,
): TerminalOutputActivitySnapshot {
  return sessions.get(sessionId)?.snapshot ?? EMPTY_SNAPSHOT;
}

export function subscribeToTerminalOutputActivity(
  sessionId: string,
  listener: Listener,
): () => void {
  const state = getOrCreate(sessionId);
  state.listeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.owner === undefined) {
      clearRecentOutput(state, false);
      sessions.delete(sessionId);
    }
  };
}

export function markTerminalOutput(sessionId: string): void {
  markOutputForState(sessionId, getOrCreate(sessionId));
}

export function setTerminalStreamReady(
  sessionId: string,
  ready: boolean,
): void {
  setReadyForState(getOrCreate(sessionId), ready);
}

export function registerTerminalOutputActivity(
  sessionId: string,
): TerminalOutputActivityRegistration {
  const state = getOrCreate(sessionId);
  const owner = Symbol(sessionId);
  state.owner = owner;
  clearRecentOutput(state, false);

  return {
    markOutput: () => {
      if (state.owner === owner) markOutputForState(sessionId, state);
    },
    setStreamReady: (ready) => {
      if (state.owner === owner) setReadyForState(state, ready);
    },
    dispose: () => disposeState(sessionId, state, owner),
  };
}
