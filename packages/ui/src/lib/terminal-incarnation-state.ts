import {
  toTerminalKey,
  parseTerminalKey,
  type TerminalRef,
  type ProfileId,
} from "@/api/ownership.js";

/**
 * Latest concrete PTY identity observed by this browser session.
 * Public terminal IDs are reusable, so push events need this second value to
 * reject delayed notifications from an older process.
 */
const latestBySessionId = new Map<string, number>();
const retiredPortIncarnations = new Map<string, number>();

/** Start a fresh identity namespace, optionally for one profile only. */
export function resetTerminalSessionIncarnations(profileId?: ProfileId): void {
  if (!profileId) {
    latestBySessionId.clear();
    retiredPortIncarnations.clear();
    return;
  }
  for (const key of latestBySessionId.keys()) {
    const parsed = parseTerminalKey(key);
    if (parsed?.profileId === profileId) {
      latestBySessionId.delete(key);
    }
  }
  for (const key of retiredPortIncarnations.keys()) {
    const [sessionKey] = key.split("\u0000");
    if (sessionKey) {
      const parsed = parseTerminalKey(sessionKey);
      if (parsed?.profileId === profileId) {
        retiredPortIncarnations.delete(key);
      }
    }
  }
}

function isIncarnation(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

export function rememberTerminalSessionIncarnation(
  target: TerminalRef | string,
  incarnation: number | undefined,
): void {
  if (!isIncarnation(incarnation)) return;
  const key = toTerminalKey(target);
  const current = latestBySessionId.get(key);
  if (current === undefined || incarnation > current) {
    latestBySessionId.set(key, incarnation);
  }
}

export function rememberTerminalSessionIncarnations(
  sessions: readonly {
    id: string;
    incarnation?: number;
    profileId?: ProfileId;
    terminalRef?: TerminalRef;
  }[],
  defaultProfileId?: ProfileId,
): void {
  for (const session of sessions) {
    const target =
      session.terminalRef ??
      (session.profileId || defaultProfileId
        ? {
            profileId: session.profileId ?? defaultProfileId ?? "",
            id: session.id,
          }
        : session.id);
    rememberTerminalSessionIncarnation(target, session.incarnation);
  }
}

export function latestTerminalSessionIncarnation(
  target: TerminalRef | string,
): number | undefined {
  const key = toTerminalKey(target);
  return (
    latestBySessionId.get(key) ??
    (typeof target === "string" ? latestBySessionId.get(target) : undefined)
  );
}

/** Returns false for a target-loss event older than the current session. */
export function acceptsTerminalSessionIncarnation(
  target: TerminalRef | string,
  incarnation: number,
): boolean {
  if (!isIncarnation(incarnation)) return false;
  const key = toTerminalKey(target);
  const current =
    latestBySessionId.get(key) ??
    (typeof target === "string" ? latestBySessionId.get(target) : undefined);
  if (current !== undefined && incarnation < current) return false;
  rememberTerminalSessionIncarnation(target, incarnation);
  return true;
}

function portIdentity(sessionId: string, port: number): string {
  return `${sessionId}\u0000${port}`;
}

export function retireTerminalPortIncarnation(
  target: TerminalRef | string,
  port: number,
  incarnation: number,
): void {
  if (!isIncarnation(incarnation) || !Number.isSafeInteger(port)) return;
  const key = portIdentity(toTerminalKey(target), port);
  const current = retiredPortIncarnations.get(key);
  if (current === undefined || incarnation >= current) {
    retiredPortIncarnations.set(key, incarnation);
  }
}

/** Accepts a discovery unless the same concrete port was just reported lost. */
export function acceptsTerminalPortIncarnation(
  target: TerminalRef | string,
  port: number,
  incarnation: number,
): boolean {
  if (!acceptsTerminalSessionIncarnation(target, incarnation)) return false;
  const key = portIdentity(toTerminalKey(target), port);
  const retired = retiredPortIncarnations.get(key);
  return retired === undefined || incarnation > retired;
}

/** A fresh port:list response is authoritative and clears a retired key. */
export function confirmTerminalPortIncarnation(
  target: TerminalRef | string,
  port: number,
  incarnation: number,
): void {
  if (!isIncarnation(incarnation) || !Number.isSafeInteger(port)) return;
  const key = portIdentity(toTerminalKey(target), port);
  const retired = retiredPortIncarnations.get(key);
  if (retired !== undefined && incarnation >= retired) {
    retiredPortIncarnations.delete(key);
  }
  rememberTerminalSessionIncarnation(target, incarnation);
}
