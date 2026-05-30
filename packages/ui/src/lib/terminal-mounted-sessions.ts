import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";

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
    current.cwd === nextSession.cwd
  ) {
    return sessions;
  }

  return sessions.map((session, sessionIndex) =>
    sessionIndex === index ? nextSession : session,
  );
}
