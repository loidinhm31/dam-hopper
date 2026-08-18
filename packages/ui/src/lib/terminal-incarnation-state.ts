/**
 * Latest concrete PTY identity observed by this browser session.
 * Public terminal IDs are reusable, so push events need this second value to
 * reject delayed notifications from an older process.
 */
const latestBySessionId = new Map<string, number>();
const retiredPortIncarnations = new Map<string, number>();

/** Start a fresh identity namespace when the active server/profile changes. */
export function resetTerminalSessionIncarnations(): void {
  latestBySessionId.clear();
  retiredPortIncarnations.clear();
}

function isIncarnation(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

export function rememberTerminalSessionIncarnation(
  sessionId: string,
  incarnation: number | undefined,
): void {
  if (!isIncarnation(incarnation)) return;
  const current = latestBySessionId.get(sessionId);
  if (current === undefined || incarnation > current) {
    latestBySessionId.set(sessionId, incarnation);
  }
}

export function rememberTerminalSessionIncarnations(
  sessions: readonly { id: string; incarnation?: number }[],
): void {
  for (const session of sessions) {
    rememberTerminalSessionIncarnation(session.id, session.incarnation);
  }
}

export function latestTerminalSessionIncarnation(
  sessionId: string,
): number | undefined {
  return latestBySessionId.get(sessionId);
}

/** Returns false for a target-loss event older than the current session. */
export function acceptsTerminalSessionIncarnation(
  sessionId: string,
  incarnation: number,
): boolean {
  if (!isIncarnation(incarnation)) return false;
  const current = latestBySessionId.get(sessionId);
  if (current !== undefined && incarnation < current) return false;
  rememberTerminalSessionIncarnation(sessionId, incarnation);
  return true;
}

function portIdentity(sessionId: string, port: number): string {
  return `${sessionId}\u0000${port}`;
}

/** Retires a concrete port event until a fresh port:list snapshot confirms it. */
export function retireTerminalPortIncarnation(
  sessionId: string,
  port: number,
  incarnation: number,
): void {
  if (!isIncarnation(incarnation) || !Number.isSafeInteger(port)) return;
  const key = portIdentity(sessionId, port);
  const current = retiredPortIncarnations.get(key);
  if (current === undefined || incarnation >= current) {
    retiredPortIncarnations.set(key, incarnation);
  }
}

/** Accepts a discovery unless the same concrete port was just reported lost. */
export function acceptsTerminalPortIncarnation(
  sessionId: string,
  port: number,
  incarnation: number,
): boolean {
  if (!acceptsTerminalSessionIncarnation(sessionId, incarnation)) return false;
  const retired = retiredPortIncarnations.get(portIdentity(sessionId, port));
  return retired === undefined || incarnation > retired;
}

/** A fresh port:list response is authoritative and clears a retired key. */
export function confirmTerminalPortIncarnation(
  sessionId: string,
  port: number,
  incarnation: number,
): void {
  if (!isIncarnation(incarnation) || !Number.isSafeInteger(port)) return;
  const key = portIdentity(sessionId, port);
  const retired = retiredPortIncarnations.get(key);
  if (retired !== undefined && incarnation >= retired) {
    retiredPortIncarnations.delete(key);
  }
  rememberTerminalSessionIncarnation(sessionId, incarnation);
}
