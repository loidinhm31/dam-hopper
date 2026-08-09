import type { SessionInfo } from "@/api/client.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";

export interface ParsedTerminalSessionId {
  type: string;
  project?: string;
  profile?: string;
  timestamp?: string;
}

export interface TerminalAutoAttachInput {
  sessions: SessionInfo[];
  openTabs: TabEntry[];
  mountedSessions: MountedSession[];
  activeTab: string | null;
  profileSessionIds: Set<string>;
  freeTerminalIndexMap: Map<string, number>;
  ignoredSessionIds?: Set<string>;
  pendingSessionIds?: Set<string>;
  pinnedSessionIds?: Set<string>;
}

export interface TerminalAutoAttachState {
  openTabs: TabEntry[];
  mountedSessions: MountedSession[];
  activeTab: string | null;
}

export function parseTerminalSessionId(
  sessionId: string,
): ParsedTerminalSessionId {
  const parts = sessionId.split(":");
  return {
    type: parts[0] ?? sessionId,
    project: parts[1],
    profile: parts[2],
    timestamp: parts[3],
  };
}

export function isAdHocProjectTerminal(
  sessionId: string,
  profileSessionIds: Set<string>,
) {
  const { type, profile } = parseTerminalSessionId(sessionId);
  return (
    !profileSessionIds.has(sessionId) && type === "terminal" && profile === "_"
  );
}

function sessionProject(session: SessionInfo) {
  const parsed = parseTerminalSessionId(session.id);
  if (parsed.type === "free") return session.project ?? "";
  return session.project ?? parsed.project ?? "";
}

function sessionTabLabel(
  session: SessionInfo,
  freeTerminalIndexMap: Map<string, number>,
) {
  const { type, profile } = parseTerminalSessionId(session.id);
  const project = sessionProject(session);

  if (type === "free") {
    const n = freeTerminalIndexMap.get(session.id);
    return `Terminal ${n ?? "?"}`;
  }

  if (type === "terminal") {
    if (profile && profile !== "_") {
      return `${project}:${profile.replace(/_/g, " ")}`;
    }
    const cmdBase =
      session.command.split(/[\s/\\]/).find(Boolean) ?? session.command;
    return `${project}:${cmdBase}`;
  }

  return `${project}:${type}`;
}

function tabForSession(
  session: SessionInfo,
  profileSessionIds: Set<string>,
  freeTerminalIndexMap: Map<string, number>,
  isPinned = false,
): TabEntry {
  return {
    sessionId: session.id,
    label: sessionTabLabel(session, freeTerminalIndexMap),
    session,
    isSaveable: isAdHocProjectTerminal(session.id, profileSessionIds),
    isPinned,
  };
}

function mountedForSession(session: SessionInfo): MountedSession {
  return {
    sessionId: session.id,
    project: sessionProject(session),
    command: session.command,
    cwd: session.cwd,
  };
}

export function deriveTerminalAutoAttachState({
  sessions,
  openTabs,
  mountedSessions,
  activeTab,
  profileSessionIds,
  freeTerminalIndexMap,
  ignoredSessionIds = new Set<string>(),
  pendingSessionIds = new Set<string>(),
  pinnedSessionIds = new Set<string>(),
}: TerminalAutoAttachInput): TerminalAutoAttachState {
  const liveSessions = sessions
    .filter(
      (session) =>
        session.alive && session.id && !ignoredSessionIds.has(session.id),
    )
    .sort((a, b) => a.startedAt - b.startedAt);
  const liveById = new Map(
    liveSessions.map((session) => [session.id, session]),
  );
  const knownSessionIds = new Set(sessions.map((session) => session.id));
  const existingTabIds = new Set(openTabs.map((tab) => tab.sessionId));
  const existingMountedIds = new Set(
    mountedSessions.map((session) => session.sessionId),
  );

  const nextOpenTabs = [
    ...openTabs
      .filter(
        (tab) =>
          liveById.has(tab.sessionId) ||
          pendingSessionIds.has(tab.sessionId) ||
          !knownSessionIds.has(tab.sessionId),
      )
      .map((tab) => {
        const session = liveById.get(tab.sessionId);
        if (!session) return tab;
        return {
          ...tab,
          ...tabForSession(session, profileSessionIds, freeTerminalIndexMap),
          // An explicit unpin wins, but a pre-snapshot tab can hydrate a stored pin.
          isPinned: tab.isPinned ?? pinnedSessionIds.has(session.id),
        };
      }),
    ...liveSessions
      .filter((session) => !existingTabIds.has(session.id))
      .map((session) =>
        tabForSession(
          session,
          profileSessionIds,
          freeTerminalIndexMap,
          pinnedSessionIds.has(session.id),
        ),
      ),
  ];

  const nextMountedSessions = [
    ...mountedSessions
      .filter(
        (mounted) =>
          liveById.has(mounted.sessionId) ||
          pendingSessionIds.has(mounted.sessionId) ||
          !knownSessionIds.has(mounted.sessionId),
      )
      .map((mounted) => ({
        ...mounted,
        ...(liveById.has(mounted.sessionId)
          ? mountedForSession(liveById.get(mounted.sessionId)!)
          : {}),
      })),
    ...liveSessions
      .filter((session) => !existingMountedIds.has(session.id))
      .map(mountedForSession),
  ];

  const nextActiveTab =
    activeTab &&
    (liveById.has(activeTab) ||
      pendingSessionIds.has(activeTab) ||
      nextOpenTabs.some((tab) => tab.sessionId === activeTab))
      ? activeTab
      : (nextOpenTabs.at(-1)?.sessionId ?? null);

  return {
    openTabs: nextOpenTabs,
    mountedSessions: nextMountedSessions,
    activeTab: nextActiveTab,
  };
}
