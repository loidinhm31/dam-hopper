import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";

export type MountedSessionMetadata = Omit<MountedSession, "sessionId">;

export function createMountedSession(
  sessionId: string,
  metadata: MountedSessionMetadata,
): MountedSession {
  return { sessionId, ...metadata };
}

export function upsertMountedSession(
  sessions: MountedSession[],
  nextSession: MountedSession,
): MountedSession[] {
  const index = sessions.findIndex(
    (session) => session.sessionId === nextSession.sessionId,
  );

  if (index === -1) {
    return [...sessions, nextSession];
  }

  const current = sessions[index];
  if (
    current.project === nextSession.project &&
    current.command === nextSession.command &&
    current.cwd === nextSession.cwd &&
    current.name === nextSession.name &&
    current.worktreePath === nextSession.worktreePath
  ) {
    return sessions;
  }

  return sessions.map((session, sessionIndex) =>
    sessionIndex === index ? nextSession : session,
  );
}
