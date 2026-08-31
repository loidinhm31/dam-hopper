import type { SessionInfo } from "@/api/client.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import { freeTerminalBaseLabel, terminalBaseLabel } from "@/lib/terminal-title.js";

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
  stoppedSessionIds?: ReadonlySet<string>;
}

export interface TerminalAutoAttachState {
  openTabs: TabEntry[];
  mountedSessions: MountedSession[];
  activeTab: string | null;
}

export function parseTerminalSessionId(sessionId: string): ParsedTerminalSessionId {
  const parts = sessionId.split(":");
  return {
    type: parts[0] ?? sessionId,
    project: parts[1],
    profile: parts[2],
    timestamp: parts[3],
  };
}

export function isAdHocProjectTerminal(sessionId: string, profileSessionIds: Set<string>) {
  const { type, profile } = parseTerminalSessionId(sessionId);
  return !profileSessionIds.has(sessionId) && type === "terminal" && profile === "_";
}

export function sessionProject(session: SessionInfo): string {
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
  const fallback =
    type === "free"
      ? freeTerminalBaseLabel(freeTerminalIndexMap.get(session.id))
      : type === "terminal"
        ? profile && profile !== "_"
          ? `${project}:${profile.replace(/_/g, " ")}`
          : `${project}:${
              session.command.split(/[\s/\\]/).find(Boolean) ?? session.command
            }`
        : `${project}:${type}`;
  return terminalBaseLabel(session.name, fallback);
}

function tabForSession(
  session: SessionInfo,
  profileSessionIds: Set<string>,
  freeTerminalIndexMap: Map<string, number>,
  isPinned = false,
): TabEntry {
  const isFree = session.type === "free" || parseTerminalSessionId(session.id).type === "free";
  const project = !isFree ? sessionProject(session) : undefined;
  return {
    sessionId: session.id,
    label: sessionTabLabel(session, freeTerminalIndexMap),
    session,
    isSaveable: isAdHocProjectTerminal(session.id, profileSessionIds),
    isPinned,
    ...(project ? { project } : {}),
  };
}

function mountedForSession(session: SessionInfo): MountedSession {
  return {
    sessionId: session.id,
    project: sessionProject(session),
    name: session.name,
    command: session.command,
    cwd: session.cwd,
    worktreePath: session.worktreePath,
  };
}

export function deriveTerminalAutoAttachState({
  sessions, openTabs, mountedSessions, activeTab, profileSessionIds,
  freeTerminalIndexMap, ignoredSessionIds = new Set<string>(),
  pendingSessionIds = new Set<string>(), pinnedSessionIds = new Set<string>(),
  stoppedSessionIds = new Set<string>(),
}: TerminalAutoAttachInput): TerminalAutoAttachState {
  const liveSessions = sessions
    .filter((session) => session.alive && session.id && !ignoredSessionIds.has(session.id) && !stoppedSessionIds.has(session.id))
    .sort((a, b) => a.startedAt - b.startedAt);
  const liveById = new Map(liveSessions.map((session) => [session.id, session]));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const knownSessionIds = new Set(sessions.map((session) => session.id));
  const existingTabIds = new Set(openTabs.map((tab) => tab.sessionId));
  const existingMountedIds = new Set(mountedSessions.map((session) => session.sessionId));

  const nextOpenTabs = [
    ...openTabs
      .filter((tab) => !ignoredSessionIds.has(tab.sessionId))
      .map((tab) => {
        const session = sessionsById.get(tab.sessionId);
        if (!session) {
          if (tab.session?.alive !== true) return tab;
          return { ...tab, session: { ...tab.session, alive: false } };
        }
        if (
          stoppedSessionIds.has(session.id) &&
          session.alive &&
          tab.session?.alive === false
        ) {
          return tab;
        }
        const effectiveSession = stoppedSessionIds.has(session.id) && session.alive
          ? { ...session, alive: false }
          : session;
        const hydratedTab = {
          ...tab,
          ...tabForSession(effectiveSession, profileSessionIds, freeTerminalIndexMap),
          isPinned: tab.isPinned ?? pinnedSessionIds.has(session.id),
        };
        const isFree = effectiveSession.type === "free" || parseTerminalSessionId(effectiveSession.id).type === "free";
        if (isFree || sessionProject(effectiveSession).length === 0) {
          const { project: _project, ...projectlessTab } = hydratedTab;
          return projectlessTab;
        }
        return hydratedTab;
      }),
    ...liveSessions
      .filter((session) => !existingTabIds.has(session.id))
      .map((session) => tabForSession(session, profileSessionIds, freeTerminalIndexMap, pinnedSessionIds.has(session.id))),
  ];

  const nextMountedSessions = [
    ...mountedSessions
      .filter((mounted) =>
        !ignoredSessionIds.has(mounted.sessionId) &&
        (liveById.has(mounted.sessionId) || pendingSessionIds.has(mounted.sessionId) ||
          !knownSessionIds.has(mounted.sessionId) || existingTabIds.has(mounted.sessionId)),
      )
      .map((mounted) => {
        const session = sessionsById.get(mounted.sessionId);
        return session ? mountedForSession(session) : mounted;
      }),
    ...liveSessions
      .filter((session) => !existingMountedIds.has(session.id))
      .map(mountedForSession),
  ];

  const nextActiveTab = activeTab &&
    (liveById.has(activeTab) || pendingSessionIds.has(activeTab) || nextOpenTabs.some((tab) => tab.sessionId === activeTab))
    ? activeTab
    : (nextOpenTabs.at(-1)?.sessionId ?? null);
  return { openTabs: nextOpenTabs, mountedSessions: nextMountedSessions, activeTab: nextActiveTab };
}
