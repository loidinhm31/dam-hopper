import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@dam-hopper/shared/logger";
import {
  useTerminalTree,
  FREE_TERMINAL_PREFIX,
} from "@/hooks/use-terminal-tree.js";
import { useTerminalSessions, useProjects } from "@/api/queries.js";
import { api, isProjectTargetError } from "@/api/client.js";
import {
  markProjectTargetUnavailable,
  useProjectTargetStore,
} from "@/stores/project-target.js";
import { generateUUID, sanitizeSessionSegment } from "@/lib/utils.js";
import { terminalProfileSessionId } from "@/lib/terminal-target-identity.js";
import {
  getTerminalLaunchContext,
  getTerminalLaunchRequest,
  getSafeProjectProfileCwd,
} from "@/lib/terminal-launch-context.js";
import {
  deriveTerminalAutoAttachState,
  isAdHocProjectTerminal,
  parseTerminalSessionId,
  sessionProject,
} from "@/lib/terminal-auto-attach.js";
import {
  createMountedSession,
  upsertMountedSession,
} from "@/lib/terminal-mounted-sessions.js";
import { isTerminalTabClosable } from "@/lib/terminal-tab-state.js";
import {
  loadPinnedTerminalIds,
  retainPinnedTerminalIds,
  savePinnedTerminalIds,
  setPinnedTerminalId,
} from "@/lib/terminal-pin-persistence.js";
import {
  selectTerminal,
  syncTerminalProject,
} from "@/lib/terminal-selection.js";
import {
  latestTerminalSessionIncarnation,
  rememberTerminalSessionIncarnation,
} from "@/lib/terminal-incarnation-state.js";
import {
  applyTerminalTitleOrdinals,
  freeTerminalBaseLabel,
} from "@/lib/terminal-title.js";
import type { TabEntry, DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TreeCommand, TreeProject } from "@/hooks/use-terminal-tree.js";
import type { SessionInfo } from "@/api/client.js";
import type { SetURLSearchParams } from "react-router-dom";

export type SelectionState =
  | { type: "project"; name: string }
  | { type: "terminal"; sessionId: string }
  | null;

export interface LaunchFormState {
  projectName: string;
  cwd: string;
  command: string;
}

export interface SavePromptState {
  sessionId: string;
  name: string;
  error?: string;
}

export interface FreeTerminalSavePromptState {
  sessionId: string;
  projectName: string;
  name: string;
  error?: string;
}

export interface TerminalManagerState {
  openTabs: TabEntry[];
  activeTab: string | null;
  mountedSessions: MountedSession[];
  launchForm: LaunchFormState | null;
  savePrompt: SavePromptState | null;
  freeTerminalSavePrompt: FreeTerminalSavePromptState | null;
  selection: SelectionState;
  focusedPaneId: string | null;
}

export interface TerminalManagerDerived {
  tree: TreeProject[];
  freeTerminals: SessionInfo[];
  isLoading: boolean;
  terminalTabs: DisplayTabEntry[];
  selectedId: string | null;
  sessionMap: Map<string, SessionInfo>;
  freeTerminalIndexMap: Map<string, number>;
}

export interface TerminalManagerActions {
  handleSelectProject: (name: string) => void;
  handleSelectTerminal: (sessionId: string) => void;
  handleLaunchTerminal: (projectName: string, cmd: TreeCommand) => void;
  handleLaunchProfile: (projectName: string, cmd: TreeCommand) => void;
  handleLaunchFormSubmit: () => void;
  handleDeleteProfile: (projectName: string, profileName: string) => void;
  handleSaveProfile: () => void;
  handleAddFreeTerminal: (projectName?: string) => void;
  handleLaunchFreeWithCommand: (command: string, projectName?: string) => void;
  handleLaunchSuggestedCommand: (projectName: string, command: string) => void;
  handleAddShell: (projectName: string) => void;
  handleLaunchShell: (projectName: string) => void;
  handleSelectTab: (sessionId: string) => void;
  handleToggleTabPin: (sessionId: string) => void;
  handleCloseTab: (sessionId: string) => void;
  handleKillTerminal: (sessionId: string) => void;
  handleRemoveFreeTerminal: (sessionId: string) => void;
  handleOpenFreeTerminalSavePrompt: (sessionId: string) => void;
  handleSaveFreeTerminalToProject: () => void;
  handleUpdateProfile: (
    projectName: string,
    originalName: string,
    next: { name: string; command: string; cwd: string },
  ) => Promise<void>;
  handleUpdateCustomCommand: (
    projectName: string,
    originalKey: string,
    next: { key: string; command: string },
  ) => Promise<void>;
  handleSessionExit: (sessionId: string) => void;
  setSavePrompt: React.Dispatch<React.SetStateAction<SavePromptState | null>>;
  setFreeTerminalSavePrompt: React.Dispatch<
    React.SetStateAction<FreeTerminalSavePromptState | null>
  >;
  setLaunchForm: React.Dispatch<React.SetStateAction<LaunchFormState | null>>;
  setFocusedPaneId: React.Dispatch<React.SetStateAction<string | null>>;
  openTerminalTab: (
    sessionId: string,
    project: string,
    command: string,
    cwd?: string,
    worktreePath?: string,
  ) => void;
}

interface TerminalManagerOptions {
  terminalAutoSwitchProjectEnabled: boolean;
  setActiveProject: (project: string | null) => void;
}
export interface LocallyStoppedSessionMarker {
  incarnation?: number;
  startedAt?: number;
}

export function getLocallyStoppedSessionMarker(
  sessionId: string,
  sessionMap: ReadonlyMap<string, SessionInfo>,
  openTabs: readonly TabEntry[],
): LocallyStoppedSessionMarker | undefined {
  const session =
    sessionMap.get(sessionId) ??
    openTabs.find((tab) => tab.sessionId === sessionId)?.session;
  const incarnation =
    session?.incarnation ?? latestTerminalSessionIncarnation(sessionId);
  const startedAt = session?.startedAt;
  if (incarnation === undefined && startedAt === undefined) return undefined;
  return { incarnation, startedAt };
}

export function isSameSessionIdentity(
  session: SessionInfo,
  marker: LocallyStoppedSessionMarker,
): boolean {
  if (
    marker.startedAt !== undefined &&
    session.startedAt !== marker.startedAt
  ) {
    return false;
  }
  if (marker.incarnation !== undefined) {
    if (
      session.incarnation !== undefined &&
      marker.incarnation !== session.incarnation
    ) {
      return false;
    }
    if (session.incarnation === undefined && marker.startedAt === undefined) {
      return false;
    }
  }
  return marker.startedAt !== undefined || marker.incarnation !== undefined;
}

export function getLocallyStoppedSessionIds(
  markers: Map<string, LocallyStoppedSessionMarker>,
  sessionMap: Map<string, SessionInfo>,
): Set<string> {
  const stoppedSessionIds = new Set<string>();
  for (const [sessionId, marker] of markers) {
    const session = sessionMap.get(sessionId);
    if (!session || (session.alive && isSameSessionIdentity(session, marker))) {
      stoppedSessionIds.add(sessionId);
    } else {
      markers.delete(sessionId);
    }
  }
  return stoppedSessionIds;
}

export function applyLocalStoppedSession(
  session: SessionInfo | undefined,
  marker: LocallyStoppedSessionMarker | undefined,
): SessionInfo | undefined {
  if (
    !session ||
    !session.alive ||
    !marker ||
    !isSameSessionIdentity(session, marker)
  ) {
    return session;
  }
  return { ...session, alive: false };
}

const INVALID_PROFILE_NAME_RE = /[:]/;

function validateProfileName(name: string, existing: string[]): string | null {
  if (!name.trim()) return "Name is required";
  if (INVALID_PROFILE_NAME_RE.test(name)) return "Name must not contain ':'";
  if (existing.includes(name.trim()))
    return "A profile with this name already exists";
  return null;
}

function validateCustomCommandKey(
  key: string,
  existing: string[],
): string | null {
  if (!key.trim()) return "Command key is required";
  if (existing.includes(key.trim()))
    return "A command with this key already exists";
  return null;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Keep a failed target selected nowhere, even when the worktree panel is hidden. */
export function reconcileTerminalTargetError(
  projectName: string | undefined,
  worktreePath: string | undefined,
  error: unknown,
): void {
  if (!projectName || !worktreePath) return;
  const message = error instanceof Error ? error.message : String(error);
  if (!isProjectTargetError(errorCode(error), message)) return;
  markProjectTargetUnavailable({ project: projectName, worktreePath });
}

export function findSessionMeta(
  sessionId: string,
  tree: TreeProject[],
  sessionMap: Map<string, SessionInfo>,
): {
  project: string;
  command: string;
  sessionType?: SessionInfo["type"];
  cwd?: string;
  worktreePath?: string;
} | null {
  for (const project of tree) {
    for (const cmd of project.commands) {
      if (cmd.type === "terminal") {
        const match = cmd.sessions?.find((s) => s.id === sessionId);
        if (match) {
          return {
            project: project.name,
            command: cmd.command,
            sessionType: match.type,
            cwd: match.cwd,
            worktreePath: match.worktreePath,
          };
        }
      } else if (cmd.sessionId === sessionId) {
        return {
          project: project.name,
          command: cmd.command,
          sessionType: cmd.session?.type,
          cwd: cmd.session?.cwd ?? cmd.cwd,
          worktreePath: cmd.session?.worktreePath,
        };
      }
    }
  }
  const s = sessionMap.get(sessionId);
  return s
    ? {
        project: sessionProject(s),
        command: s.command,
        sessionType: s.type,
        cwd: s.cwd,
        worktreePath: s.worktreePath,
      }
    : null;
}
function sameOpenTabs(a: TabEntry[], b: TabEntry[]) {
  return (
    a.length === b.length &&
    a.every((tab, index) => {
      const other = b[index];
      return (
        other &&
        tab.sessionId === other.sessionId &&
        tab.label === other.label &&
        tab.project === other.project &&
        tab.session === other.session &&
        tab.isSaveable === other.isSaveable &&
        tab.isPinned === other.isPinned
      );
    })
  );
}

function sameMountedSessions(a: MountedSession[], b: MountedSession[]) {
  return (
    a.length === b.length &&
    a.every((session, index) => {
      const other = b[index];
      return (
        other &&
        session.sessionId === other.sessionId &&
        session.project === other.project &&
        session.command === other.command &&
        session.cwd === other.cwd &&
        session.worktreePath === other.worktreePath
      );
    })
  );
}

export function buildTerminalDisplayTabs(
  openTabs: readonly TabEntry[],
  sessionMap: Map<string, SessionInfo>,
  profileSessionIds: Set<string>,
  freeTerminalIndexMap: Map<string, number>,
  stoppedSessionIds?: ReadonlySet<string>,
): DisplayTabEntry[] {
  const baseTabs = openTabs.map((tab) => {
    const { type } = parseTerminalSessionId(tab.sessionId);
    const hydrated = sessionMap.get(tab.sessionId) ?? tab.session;
    const session =
      stoppedSessionIds?.has(tab.sessionId) && hydrated?.alive
        ? { ...hydrated, alive: false }
        : hydrated;
    const isFree = type === "free" || session?.type === "free";
    const label = isFree
      ? freeTerminalBaseLabel(freeTerminalIndexMap.get(tab.sessionId))
      : tab.label;
    const baseTab = {
      ...tab,
      label,
      session,
      isSaveable: isAdHocProjectTerminal(tab.sessionId, profileSessionIds),
      isPinned: tab.isPinned,
    };
    if (isFree) {
      const { project: _project, ...projectlessTab } = baseTab;
      return projectlessTab;
    }
    const project = session ? sessionProject(session) : tab.project ?? "";
    return project ? { ...baseTab, project } : baseTab;
  });
  return applyTerminalTitleOrdinals(baseTabs);
}
export function useTerminalManager(
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
  {
    terminalAutoSwitchProjectEnabled,
    setActiveProject,
  }: TerminalManagerOptions,
) {
  const qc = useQueryClient();
  const { tree, freeTerminals, isLoading } = useTerminalTree();
  const { data: sessions = [], isSuccess: hasTerminalSessionSnapshot } =
    useTerminalSessions();
  const { data: projects = [] } = useProjects();
  const activeTargetByProject = useProjectTargetStore(
    (state) => state.activeTargetByProject,
  );

  const [selection, setSelection] = useState<SelectionState>(null);
  const [openTabs, setOpenTabs] = useState<TabEntry[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [mountedSessions, setMountedSessions] = useState<MountedSession[]>([]);
  const [launchForm, setLaunchForm] = useState<LaunchFormState | null>(null);
  const [savePrompt, setSavePrompt] = useState<SavePromptState | null>(null);
  const [freeTerminalSavePrompt, setFreeTerminalSavePrompt] =
    useState<FreeTerminalSavePromptState | null>(null);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  const [initialPinnedTerminalIds] = useState(() => loadPinnedTerminalIds());
  const suppressedAutoAttachIdsRef = useRef<Set<string>>(new Set());
  const pendingAutoAttachIdsRef = useRef<Set<string>>(new Set());
  const locallyStoppedSessionMarkersRef = useRef<
    Map<string, LocallyStoppedSessionMarker>
  >(new Map());
  const pinnedTerminalIdsRef = useRef(initialPinnedTerminalIds);
  const pinStateBySessionIdRef = useRef<Map<string, boolean>>(new Map());

  const forgetPinnedTerminalIds = useCallback(
    (sessionIds: Iterable<string>) => {
      let changed = false;
      for (const sessionId of sessionIds) {
        pinStateBySessionIdRef.current.delete(sessionId);
        changed = pinnedTerminalIdsRef.current.delete(sessionId) || changed;
      }
      if (changed) savePinnedTerminalIds(pinnedTerminalIdsRef.current);
    },
    [],
  );

  const sessionMap = useMemo(
    () =>
      new Map<string, SessionInfo>(
        sessions.filter((s) => s.id).map((s) => [s.id, s]),
      ),
    [sessions],
  );

  const freeTerminalIndexMap = useMemo(
    () => new Map(freeTerminals.map((s, i) => [s.id, i + 1])),
    [freeTerminals],
  );

  const profileSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const project of tree) {
      for (const cmd of project.commands) {
        if (cmd.type === "terminal") {
          for (const s of cmd.sessions ?? []) ids.add(s.id);
        }
      }
    }
    return ids;
  }, [tree]);

  function tabLabel(
    sessionId: string,
    project: string,
    command: string,
  ): string {
    const { type, profile } = parseTerminalSessionId(sessionId);
    if (type === "free") {
      const n = freeTerminalIndexMap.get(sessionId);
      return `Terminal ${n ?? "?"}`;
    }
    if (type === "terminal") {
      if (profile && profile !== "_")
        return `${project}:${profile.replace(/_/g, " ")}`;
      const cmdBase = command.split(/[\s/\\]/).find(Boolean) ?? command;
      return `${project}:${cmdBase}`;
    }
    return `${project}:${type}`;
  }

  function openTerminalTab(
    sessionId: string,
    project: string,
    command: string,
    cwd?: string,
    worktreePath?: string,
  ) {
    suppressedAutoAttachIdsRef.current.delete(sessionId);
    pendingAutoAttachIdsRef.current.add(sessionId);

    const isAdHoc = isAdHocProjectTerminal(sessionId, profileSessionIds);
    const sessionTargetPath =
      worktreePath ?? sessionMap.get(sessionId)?.worktreePath;
    const currentSession = sessionMap.get(sessionId);
    const { type } = parseTerminalSessionId(sessionId);
    const projectMetadata =
      type !== "free" && currentSession?.type !== "free" && project
        ? { project }
        : {};

    setOpenTabs((prev) => {
      if (prev.some((t) => t.sessionId === sessionId)) return prev;
      pinStateBySessionIdRef.current.set(sessionId, false);
      return [
        ...prev,
        {
          sessionId,
          label: tabLabel(sessionId, project, command),
          session: currentSession,
          isSaveable: isAdHoc,
          ...projectMetadata,
        },
      ];
    });

    setMountedSessions((prev) => {
      return upsertMountedSession(
        prev,
        createMountedSession(sessionId, {
          project,
          command,
          cwd,
          worktreePath: sessionTargetPath,
        }),
      );
    });

    setActiveTab(sessionId);
    setSelection({ type: "terminal", sessionId });
  }

  function removeSessionsFromUi(sessionIds: string[]) {
    if (sessionIds.length === 0) return;

    for (const sessionId of sessionIds) {
      pendingAutoAttachIdsRef.current.delete(sessionId);
      suppressedAutoAttachIdsRef.current.add(sessionId);
    }
    forgetPinnedTerminalIds(sessionIds);

    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => !sessionIds.includes(t.sessionId));
      if (activeTab && sessionIds.includes(activeTab)) {
        setActiveTab(
          remaining.length > 0
            ? remaining[remaining.length - 1].sessionId
            : null,
        );
      }
      return remaining;
    });
    setMountedSessions((prev) =>
      prev.filter((session) => !sessionIds.includes(session.sessionId)),
    );
    setSelection((prev) =>
      prev?.type === "terminal" && sessionIds.includes(prev.sessionId)
        ? null
        : prev,
    );
  }

  async function invalidateProjectConfig() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["projects"] }),
      qc.invalidateQueries({ queryKey: ["config"] }),
    ]);
  }

  useEffect(() => {
    if (searchParams.get("action") !== "new-terminal") return;
    const projectName = searchParams.get("project") ?? undefined;
    setSearchParams({}, { replace: true });
    handleAddFreeTerminal(projectName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const sessionParam = searchParams.get("session");
    if (!sessionParam || sessions.length === 0) return;

    const meta = findSessionMeta(sessionParam, tree, sessionMap);
    if (meta) {
      openTerminalTab(
        sessionParam,
        meta.project,
        meta.command,
        meta.cwd,
        meta.worktreePath,
      );
    }

    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, sessions, tree]);

  useEffect(() => {
    for (const sessionId of suppressedAutoAttachIdsRef.current) {
      if (!sessionMap.get(sessionId)?.alive) {
        suppressedAutoAttachIdsRef.current.delete(sessionId);
      }
    }
    for (const sessionId of pendingAutoAttachIdsRef.current) {
      if (
        sessionMap.has(sessionId) ||
        suppressedAutoAttachIdsRef.current.has(sessionId)
      ) {
        pendingAutoAttachIdsRef.current.delete(sessionId);
      }
    }

    const stoppedSessionIds = getLocallyStoppedSessionIds(
      locallyStoppedSessionMarkersRef.current,
      sessionMap,
    );
    const next = deriveTerminalAutoAttachState({
      sessions,
      openTabs,
      mountedSessions,
      activeTab,
      profileSessionIds,
      freeTerminalIndexMap,
      ignoredSessionIds: suppressedAutoAttachIdsRef.current,
      pendingSessionIds: pendingAutoAttachIdsRef.current,
      pinnedSessionIds: hasTerminalSessionSnapshot
        ? pinnedTerminalIdsRef.current
        : new Set(),
      stoppedSessionIds,
    });
    const attachedLiveSessionIds = new Set(
      next.openTabs.map((tab) => tab.sessionId),
    );
    for (const sessionId of pinStateBySessionIdRef.current.keys()) {
      if (!attachedLiveSessionIds.has(sessionId)) {
        pinStateBySessionIdRef.current.delete(sessionId);
      }
    }
    for (const tab of next.openTabs) {
      pinStateBySessionIdRef.current.set(tab.sessionId, tab.isPinned === true);
    }

    if (!sameOpenTabs(openTabs, next.openTabs)) {
      setOpenTabs(next.openTabs);
    }
    if (!sameMountedSessions(mountedSessions, next.mountedSessions)) {
      setMountedSessions(next.mountedSessions);
    }
    if (activeTab !== next.activeTab) {
      setActiveTab(next.activeTab);
    }

    setSelection((prev) => {
      if (next.activeTab) {
        if (
          prev?.type === "terminal" &&
          attachedLiveSessionIds.has(prev.sessionId)
        ) {
          return prev;
        }
        return { type: "terminal", sessionId: next.activeTab };
      }
      return prev?.type === "terminal" ? null : prev;
    });

    if (hasTerminalSessionSnapshot) {
      const activeOrPendingIds = new Set(
        sessions
          .filter((session) => session.alive)
          .map((session) => session.id),
      );
      for (const sessionId of pendingAutoAttachIdsRef.current) {
        activeOrPendingIds.add(sessionId);
      }
      const nextPinnedIds = retainPinnedTerminalIds(
        pinnedTerminalIdsRef.current,
        activeOrPendingIds,
      );
      if (nextPinnedIds.size !== pinnedTerminalIdsRef.current.size) {
        pinnedTerminalIdsRef.current = nextPinnedIds;
        savePinnedTerminalIds(nextPinnedIds);
      }
    }
  }, [
    sessions,
    sessionMap,
    openTabs,
    mountedSessions,
    activeTab,
    profileSessionIds,
    freeTerminalIndexMap,
    hasTerminalSessionSnapshot,
    forgetPinnedTerminalIds,
  ]);

  function handleSelectProject(name: string) {
    setLaunchForm(null);
    setSelection({ type: "project", name });
  }

  function handleSelectTerminal(sessionId: string) {
    const meta = findSessionMeta(sessionId, tree, sessionMap);
    selectTerminal({
      sessionId,
      metadata: meta,
      terminalAutoSwitchProjectEnabled,
      setActiveProject,
      openTerminalTab,
    });
  }

  function terminalLaunchForProject(
    projectName: string | undefined,
    requestedCwd?: string,
    projectPathOverride?: string,
  ) {
    const projectPath =
      projectPathOverride ??
      (projectName
        ? projects.find((project) => project.name === projectName)?.path
        : undefined);
    return getTerminalLaunchRequest(
      projectPath,
      projectName ? activeTargetByProject[projectName] : undefined,
      requestedCwd,
    );
  }

  function handleLaunchTerminal(projectName: string, cmd: TreeCommand) {
    const launch = terminalLaunchForProject(projectName, cmd.cwd);
    api.terminal
      .create({
        id: cmd.sessionId,
        project: projectName,
        command: cmd.command,
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        cols: 120,
        rows: 30,
      })
      .then((session) => {
        if (session) {
          rememberTerminalSessionIncarnation(session.id, session.incarnation);
        }
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          cmd.sessionId,
          projectName,
          cmd.command,
          launch.cwd,
          launch.worktreePath,
        );
      })
      .catch((err: unknown) => {
        reconcileTerminalTargetError(projectName, launch.worktreePath, err);
        logger.error("useTerminalManager", "failed to create terminal", {
          projectName,
          sessionId: cmd.sessionId,
          error: err,
        });
      });
  }

  function handleLaunchProfile(projectName: string, cmd: TreeCommand) {
    const sanitizedName = sanitizeSessionSegment(
      (cmd.profileName ?? "terminal").replace(/ /g, "_"),
    );
    const launch = terminalLaunchForProject(projectName, cmd.cwd);
    const sessionId = terminalProfileSessionId(
      projectName,
      sanitizedName,
      launch.worktreePath,
    );

    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command: cmd.command,
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        cols: 120,
        rows: 30,
      })
      .then((session) => {
        if (session) {
          rememberTerminalSessionIncarnation(session.id, session.incarnation);
        }
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          sessionId,
          projectName,
          cmd.command,
          launch.cwd,
          launch.worktreePath,
        );
      })
      .catch((err: unknown) => {
        reconcileTerminalTargetError(projectName, launch.worktreePath, err);
        logger.error(
          "useTerminalManager",
          "failed to launch profile instance",
          {
            projectName,
            profileName: cmd.profileName,
            sessionId,
            error: err,
          },
        );
      });
  }

  function handleLaunchFormSubmit() {
    if (!launchForm) return;
    const { projectName, cwd, command } = launchForm;
    const platform = (window as { damHopper?: { platform?: string } }).damHopper
      ?.platform;
    const resolvedCommand =
      command.trim() || (platform === "win32" ? "cmd.exe" : "bash");
    const launch = terminalLaunchForProject(projectName, cwd);
    const sessionId = terminalProfileSessionId(
      projectName,
      "_",
      launch.worktreePath,
    );

    setLaunchForm(null);

    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command: resolvedCommand,
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        cols: 120,
        rows: 30,
      })
      .then((session) => {
        if (session) {
          rememberTerminalSessionIncarnation(session.id, session.incarnation);
        }
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          sessionId,
          projectName,
          resolvedCommand,
          launch.cwd,
          launch.worktreePath,
        );
      })
      .catch((err: unknown) => {
        reconcileTerminalTargetError(projectName, launch.worktreePath, err);
        logger.error("useTerminalManager", "failed to launch terminal", {
          projectName,
          sessionId,
          error: err,
        });
      });
  }

  function handleDeleteProfile(projectName: string, profileName: string) {
    const project = projects.find((p) => p.name === projectName);
    if (!project) return;

    const sanitizedName = sanitizeSessionSegment(
      profileName.replace(/ /g, "_"),
    );
    const prefix = `terminal:${projectName}:${sanitizedName}:`;
    const instanceIds = sessions
      .filter((s) => s.id.startsWith(prefix))
      .map((s) => s.id);

    for (const id of instanceIds) {
      const s = sessionMap.get(id);
      if (s?.alive) void api.terminal.kill(id);
    }

    removeSessionsFromUi(instanceIds);

    const updated = (project.terminals ?? []).filter(
      (t) => t.name !== profileName,
    );
    void api.config
      .updateProject(projectName, { terminals: updated })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      });
  }

  async function handleUpdateProfile(
    projectName: string,
    originalName: string,
    next: { name: string; command: string; cwd: string },
  ) {
    const project = projects.find((p) => p.name === projectName);
    if (!project) throw new Error("Project not found");

    const terminals = project.terminals ?? [];
    const existing = terminals
      .map((terminal) => terminal.name)
      .filter((name) => name !== originalName);
    const trimmedName = next.name.trim();
    const trimmedCommand = next.command.trim();
    const normalizedCwd = next.cwd.trim() || ".";

    const nameError = validateProfileName(trimmedName, existing);
    if (nameError) throw new Error(nameError);
    if (!trimmedCommand) throw new Error("Command is required");

    const updated = terminals.map((terminal) =>
      terminal.name === originalName
        ? {
            name: trimmedName,
            command: trimmedCommand,
            cwd: normalizedCwd,
          }
        : terminal,
    );
    if (!updated.some((terminal) => terminal.name === trimmedName)) {
      throw new Error("Profile not found");
    }

    await api.config.updateProject(projectName, { terminals: updated });
    await invalidateProjectConfig();

    if (originalName === trimmedName) return;

    const prefix = `terminal:${projectName}:${sanitizeSessionSegment(originalName.replace(/ /g, "_"))}:`;
    const instanceIds = sessions
      .filter((session) => session.id.startsWith(prefix))
      .map((session) => session.id);

    for (const id of instanceIds) {
      if (sessionMap.get(id)?.alive) {
        void api.terminal.kill(id);
      }
    }
    removeSessionsFromUi(instanceIds);
    await qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
  }

  async function handleUpdateCustomCommand(
    projectName: string,
    originalKey: string,
    next: { key: string; command: string },
  ) {
    const project = projects.find((p) => p.name === projectName);
    if (!project) throw new Error("Project not found");

    const commands = project.commands ?? {};
    if (!(originalKey in commands)) throw new Error("Command not found");

    const trimmedKey = next.key.trim();
    const trimmedCommand = next.command.trim();
    const existing = Object.keys(commands).filter((key) => key !== originalKey);

    const keyError = validateCustomCommandKey(trimmedKey, existing);
    if (keyError) throw new Error(keyError);
    if (!trimmedCommand) throw new Error("Command is required");

    const updated: Record<string, string> = {};
    for (const [key, value] of Object.entries(commands)) {
      if (key === originalKey) {
        updated[trimmedKey] = trimmedCommand;
      } else {
        updated[key] = value;
      }
    }

    await api.config.updateProject(projectName, {
      commands: Object.keys(updated).length > 0 ? updated : undefined,
    });
    await invalidateProjectConfig();

    if (originalKey === trimmedKey) return;

    const oldSessionPrefix = `custom:${projectName}:${originalKey.replace(/[^a-zA-Z0-9:._-]/g, "-")}`;
    const oldSessionIds = sessions
      .filter((session) => session.id.startsWith(oldSessionPrefix))
      .map((session) => session.id);
    for (const oldSessionId of oldSessionIds) {
      if (sessionMap.get(oldSessionId)?.alive) {
        void api.terminal.kill(oldSessionId);
      }
    }
    removeSessionsFromUi(oldSessionIds);
    await qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
  }

  function handleSaveProfile() {
    if (!savePrompt) return;
    const { sessionId, name } = savePrompt;

    const mounted = mountedSessions.find((s) => s.sessionId === sessionId);
    const session = sessionMap.get(sessionId);
    const projectName = mounted?.project || session?.project;
    const command = mounted?.command || session?.command;

    if (!projectName) return;

    const project = projects.find((p) => p.name === projectName);
    if (!project) return;

    const cwd = getSafeProjectProfileCwd({
      destinationProjectName: projectName,
      sourceProjectName: mounted?.project ?? session?.project,
      projectPath: project.path,
      targetPath: mounted?.worktreePath ?? session?.worktreePath,
      requestedCwd: mounted?.cwd || session?.cwd,
    });

    const existingNames = (project.terminals ?? []).map((t) => t.name);
    const error = validateProfileName(name, existingNames);
    if (error) {
      setSavePrompt((p) => (p ? { ...p, error } : p));
      return;
    }

    setSavePrompt(null);

    void api.config
      .updateProject(projectName, {
        terminals: [
          ...(project.terminals ?? []),
          { name: name.trim(), command: command ?? "", cwd: cwd || "." },
        ],
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        void qc.invalidateQueries({ queryKey: ["config"] });
      });
  }

  function handleAddFreeTerminal(projectName?: string) {
    const launchContext = getTerminalLaunchContext(projects, projectName);
    const launch = terminalLaunchForProject(
      launchContext.projectName,
      launchContext.projectPath,
      launchContext.projectPath,
    );
    const sessionId = `${FREE_TERMINAL_PREFIX}${generateUUID()}`;
    api.terminal
      .create({
        id: sessionId,
        project: launchContext.projectName,
        command: "",
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        cols: 120,
        rows: 30,
      })
      .then((session) => {
        if (session) {
          rememberTerminalSessionIncarnation(session.id, session.incarnation);
        }
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          sessionId,
          launchContext.projectName ?? "",
          "",
          launch.cwd,
          launch.worktreePath,
        );
      })
      .catch((err: unknown) => {
        reconcileTerminalTargetError(
          launchContext.projectName,
          launch.worktreePath,
          err,
        );
        logger.error("useTerminalManager", "failed to create free terminal", {
          projectName: launchContext.projectName,
          sessionId,
          error: err,
        });
      });
  }

  function handleLaunchFreeWithCommand(command: string, projectName?: string) {
    const launchContext = getTerminalLaunchContext(projects, projectName);
    const launch = terminalLaunchForProject(
      launchContext.projectName,
      launchContext.projectPath,
      launchContext.projectPath,
    );
    const sessionId = `${FREE_TERMINAL_PREFIX}${generateUUID()}`;
    api.terminal
      .create({
        id: sessionId,
        project: launchContext.projectName,
        command,
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        cols: 120,
        rows: 30,
      })
      .then((session) => {
        if (session) {
          rememberTerminalSessionIncarnation(session.id, session.incarnation);
        }
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          sessionId,
          launchContext.projectName ?? "",
          command,
          launch.cwd,
          launch.worktreePath,
        );
      })
      .catch((err: unknown) => {
        reconcileTerminalTargetError(
          launchContext.projectName,
          launch.worktreePath,
          err,
        );
        logger.error(
          "useTerminalManager",
          "failed to create free terminal with command",
          {
            projectName: launchContext.projectName,
            sessionId,
            command,
            error: err,
          },
        );
      });
  }

  function handleLaunchSuggestedCommand(projectName: string, command: string) {
    const projectPath = projects.find((p) => p.name === projectName)?.path;
    const launch = terminalLaunchForProject(
      projectName,
      projectPath,
      projectPath,
    );
    const sessionId = terminalProfileSessionId(
      projectName,
      "_",
      launch.worktreePath,
    );
    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command,
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        cols: 120,
        rows: 30,
      })
      .then((session) => {
        if (session) {
          rememberTerminalSessionIncarnation(session.id, session.incarnation);
        }
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          sessionId,
          projectName,
          command,
          launch.cwd,
          launch.worktreePath,
        );
      })
      .catch((err: unknown) => {
        reconcileTerminalTargetError(projectName, launch.worktreePath, err);
        logger.error(
          "useTerminalManager",
          "failed to create suggested terminal",
          {
            projectName,
            sessionId,
            command,
            error: err,
          },
        );
      });
  }

  function handleAddShell(projectName: string) {
    const projectPath =
      projects.find((p) => p.name === projectName)?.path ?? "";
    setLaunchForm({ projectName, cwd: projectPath, command: "" });
    setSelection({ type: "project", name: projectName });
  }

  function handleLaunchShell(projectName: string) {
    const platform = (window as { damHopper?: { platform?: string } }).damHopper
      ?.platform;
    const command = platform === "win32" ? "cmd.exe" : "bash";
    const projectPath = projects.find((p) => p.name === projectName)?.path;
    const launch = terminalLaunchForProject(
      projectName,
      projectPath,
      projectPath,
    );
    const sessionId = terminalProfileSessionId(
      projectName,
      "_",
      launch.worktreePath,
    );
    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command,
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        cols: 120,
        rows: 30,
      })
      .then((session) => {
        if (session) {
          rememberTerminalSessionIncarnation(session.id, session.incarnation);
        }
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          sessionId,
          projectName,
          command,
          launch.cwd,
          launch.worktreePath,
        );
      })
      .catch((err: unknown) => {
        reconcileTerminalTargetError(projectName, launch.worktreePath, err);
        logger.error("useTerminalManager", "failed to create shell terminal", {
          projectName,
          sessionId,
          command,
          error: err,
        });
      });
  }

  function handleSelectTab(sessionId: string) {
    syncTerminalProject({
      sessionId,
      metadata: findSessionMeta(sessionId, tree, sessionMap),
      terminalAutoSwitchProjectEnabled,
      setActiveProject,
    });
    setActiveTab(sessionId);
    setSelection({ type: "terminal", sessionId });

    setMountedSessions((prev) => {
      const meta = findSessionMeta(sessionId, tree, sessionMap);
      if (meta) {
        return upsertMountedSession(
          prev,
          createMountedSession(sessionId, {
            project: meta.project,
            command: meta.command,
            cwd: meta.cwd,
            worktreePath: meta.worktreePath,
          }),
        );
      }
      return prev;
    });
  }

  function handleToggleTabPin(sessionId: string) {
    const tab = openTabs.find((entry) => entry.sessionId === sessionId);
    if (!tab) return;

    const isPinned =
      pinStateBySessionIdRef.current.get(sessionId) ?? tab.isPinned === true;
    const nextIsPinned = !isPinned;
    pinStateBySessionIdRef.current.set(sessionId, nextIsPinned);
    const nextPinnedIds = setPinnedTerminalId(
      pinnedTerminalIdsRef.current,
      sessionId,
      nextIsPinned,
    );
    pinnedTerminalIdsRef.current = nextPinnedIds;
    savePinnedTerminalIds(nextPinnedIds);

    setOpenTabs((prev) => {
      return prev.map((tab) =>
        tab.sessionId === sessionId ? { ...tab, isPinned: nextIsPinned } : tab,
      );
    });
  }

  function handleCloseTab(sessionId: string) {
    if (!isTerminalTabClosable(openTabs, sessionId)) return;
    suppressedAutoAttachIdsRef.current.add(sessionId);
    pendingAutoAttachIdsRef.current.delete(sessionId);
    locallyStoppedSessionMarkersRef.current.delete(sessionId);
    forgetPinnedTerminalIds([sessionId]);
    // Terminate the terminal session when the tab is closed
    handleKillTerminal(sessionId);

    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.sessionId !== sessionId);
      if (activeTab === sessionId) {
        setActiveTab(
          remaining.length > 0
            ? remaining[remaining.length - 1].sessionId
            : null,
        );
      }
      return remaining;
    });
    setMountedSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }

  function handleKillTerminal(sessionId: string) {
    void api.terminal.kill(sessionId);
    void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
  }

  function handleRemoveFreeTerminal(sessionId: string) {
    removeSessionsFromUi([sessionId]);
    void api.terminal.remove(sessionId).then(() => {
      void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
    });
  }

  function handleOpenFreeTerminalSavePrompt(sessionId: string) {
    if (projects.length === 0) return;
    const session = sessionMap.get(sessionId);
    setFreeTerminalSavePrompt({
      sessionId,
      projectName: session?.project ?? projects[0].name,
      name: "",
    });
  }

  function handleSaveFreeTerminalToProject() {
    if (!freeTerminalSavePrompt) return;
    const { sessionId, projectName, name } = freeTerminalSavePrompt;

    const mounted = mountedSessions.find((s) => s.sessionId === sessionId);
    const session = sessionMap.get(sessionId);
    const command = mounted?.command || session?.command;

    if (!command) return;

    const project = projects.find((p) => p.name === projectName);
    if (!project) return;

    const cwd = getSafeProjectProfileCwd({
      destinationProjectName: projectName,
      sourceProjectName: mounted?.project ?? session?.project,
      projectPath: project.path,
      targetPath: mounted?.worktreePath ?? session?.worktreePath,
      requestedCwd: mounted?.cwd || session?.cwd,
    });

    const existingNames = (project.terminals ?? []).map((t) => t.name);
    const error = validateProfileName(name, existingNames);
    if (error) {
      setFreeTerminalSavePrompt((p) => (p ? { ...p, error } : p));
      return;
    }

    setFreeTerminalSavePrompt(null);

    void api.config
      .updateProject(projectName, {
        terminals: [
          ...(project.terminals ?? []),
          { name: name.trim(), command, cwd: cwd || "." },
        ],
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        void qc.invalidateQueries({ queryKey: ["config"] });
      });
  }

  const handleSessionExit = useCallback(
    (sessionId: string) => {
      pendingAutoAttachIdsRef.current.delete(sessionId);
      const marker = getLocallyStoppedSessionMarker(
        sessionId,
        sessionMap,
        openTabs,
      );
      if (marker) {
        locallyStoppedSessionMarkersRef.current.set(sessionId, marker);
      } else {
        locallyStoppedSessionMarkersRef.current.delete(sessionId);
      }
      forgetPinnedTerminalIds([sessionId]);
      void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId ? { ...t, isPinned: false } : t,
        ),
      );
    },
    [forgetPinnedTerminalIds, openTabs, qc, sessionMap],
  );

  const terminalTabs = useMemo<DisplayTabEntry[]>(
    () =>
      buildTerminalDisplayTabs(
        openTabs,
        sessionMap,
        profileSessionIds,
        freeTerminalIndexMap,
        getLocallyStoppedSessionIds(
          locallyStoppedSessionMarkersRef.current,
          sessionMap,
        ),
      ),
    [freeTerminalIndexMap, openTabs, profileSessionIds, sessionMap],
  );

  const selectedId =
    selection?.type === "project"
      ? `project:${selection.name}`
      : selection?.type === "terminal"
        ? `terminal:${selection.sessionId}`
        : null;

  return {
    state: {
      openTabs,
      activeTab,
      mountedSessions,
      launchForm,
      savePrompt,
      freeTerminalSavePrompt,
      selection,
      focusedPaneId,
    },
    derived: {
      tree,
      freeTerminals,
      isLoading,
      terminalTabs,
      selectedId,
      sessionMap,
      freeTerminalIndexMap,
    },
    actions: {
      handleSelectProject,
      handleSelectTerminal,
      handleLaunchTerminal,
      handleLaunchProfile,
      handleLaunchFormSubmit,
      handleDeleteProfile,
      handleSaveProfile,
      handleAddFreeTerminal,
      handleLaunchFreeWithCommand,
      handleLaunchSuggestedCommand,
      handleAddShell,
      handleLaunchShell,
      handleSelectTab,
      handleToggleTabPin,
      handleCloseTab,
      handleKillTerminal,
      handleRemoveFreeTerminal,
      handleOpenFreeTerminalSavePrompt,
      handleSaveFreeTerminalToProject,
      handleUpdateProfile,
      handleUpdateCustomCommand,
      handleSessionExit,
      setSavePrompt,
      setFreeTerminalSavePrompt,
      setLaunchForm,
      setFocusedPaneId,
      openTerminalTab,
    },
  };
}