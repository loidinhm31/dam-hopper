import { toTerminalKey, type TerminalRef } from "@/api/ownership.js";

export const TERMINAL_OUTPUT_ACTIVITY_WINDOW_MS = 3_000;

export interface TerminalOutputActivitySnapshot {
  readonly recentOutput: boolean;
  readonly streamReady: boolean;
}
export type TerminalOutputActivityStatus =
  | "stopped"
  | "unavailable"
  | "receiving"
  | "quiet";

export function getTerminalOutputActivityStatus(
  snapshot: TerminalOutputActivitySnapshot,
  alive?: boolean,
): TerminalOutputActivityStatus {
  if (alive === false) return "stopped";
  if (!snapshot.streamReady) return "unavailable";
  return snapshot.recentOutput ? "receiving" : "quiet";
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
let activityRevision = 0;

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
  activityRevision += 1;
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
  target: TerminalRef | string,
): TerminalOutputActivitySnapshot {
  const key = toTerminalKey(target);
  return (
    sessions.get(key)?.snapshot ??
    (typeof target === "string" ? sessions.get(target)?.snapshot : undefined) ??
    EMPTY_SNAPSHOT
  );
}
export function getTerminalOutputActivityRevision(): number {
  return activityRevision;
}

export function subscribeToTerminalOutputActivity(
  target: TerminalRef | string,
  listener: Listener,
): () => void {
  const key = toTerminalKey(target);
  const state = getOrCreate(key);
  state.listeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.owner === undefined) {
      clearRecentOutput(state, false);
      sessions.delete(key);
    }
  };
}
export function subscribeToTerminalOutputActivitySessions(
  targets: readonly (TerminalRef | string)[],
  listener: Listener,
): () => void {
  const unsubscribers = [...new Set(targets.map((t) => toTerminalKey(t)))].map(
    (key) => subscribeToTerminalOutputActivity(key, listener),
  );
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export function markTerminalOutput(target: TerminalRef | string): void {
  const key = toTerminalKey(target);
  markOutputForState(key, getOrCreate(key));
}

export function setTerminalStreamReady(
  target: TerminalRef | string,
  ready: boolean,
): void {
  const key = toTerminalKey(target);
  setReadyForState(getOrCreate(key), ready);
}

export function registerTerminalOutputActivity(
  target: TerminalRef | string,
): TerminalOutputActivityRegistration {
  const key = toTerminalKey(target);
  const state = getOrCreate(key);
  const owner = Symbol(key);
  state.owner = owner;
  clearRecentOutput(state, false);

  return {
    markOutput: () => {
      if (state.owner === owner) markOutputForState(key, state);
    },
    setStreamReady: (ready) => {
      if (state.owner === owner) setReadyForState(state, ready);
    },
    dispose: () => disposeState(key, state, owner),
  };
}
