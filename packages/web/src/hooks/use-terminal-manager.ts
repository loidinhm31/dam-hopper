import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useTerminalTree,
  FREE_TERMINAL_PREFIX,
} from "@/hooks/use-terminal-tree.js";
import { useTerminalSessions, useProjects } from "@/api/queries.js";
import { api } from "@/api/client.js";
import { generateUUID, sanitizeSessionSegment } from "@/lib/utils.js";
import { recordCommand } from "@/lib/command-history.js";
import { getTerminalLaunchContext } from "@/lib/terminal-launch-context.js";
import {
  deriveTerminalAutoAttachState,
  isAdHocProjectTerminal,
  parseTerminalSessionId,
} from "@/lib/terminal-auto-attach.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
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
  tabsWithLiveSession: TabEntry[];
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
  ) => void;
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

function findSessionMeta(
  sessionId: string,
  tree: TreeProject[],
  sessionMap: Map<string, SessionInfo>,
): { project: string; command: string } | null {
  for (const project of tree) {
    for (const cmd of project.commands) {
      if (cmd.type === "terminal") {
        const match = cmd.sessions?.find((s) => s.id === sessionId);
        if (match) return { project: project.name, command: cmd.command };
      } else if (cmd.sessionId === sessionId) {
        return { project: project.name, command: cmd.command };
      }
    }
  }
  const s = sessionMap.get(sessionId);
  return s ? { project: s.project ?? "", command: s.command } : null;
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
        tab.session === other.session &&
        tab.isSaveable === other.isSaveable
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
        session.cwd === other.cwd
      );
    })
  );
}

export function useTerminalManager(
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
) {
  const qc = useQueryClient();
  const { tree, freeTerminals, isLoading } = useTerminalTree();
  const { data: sessions = [] } = useTerminalSessions();
  const { data: projects = [] } = useProjects();

  const [selection, setSelection] = useState<SelectionState>(null);
  const [openTabs, setOpenTabs] = useState<TabEntry[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [mountedSessions, setMountedSessions] = useState<MountedSession[]>([]);
  const [launchForm, setLaunchForm] = useState<LaunchFormState | null>(null);
  const [savePrompt, setSavePrompt] = useState<SavePromptState | null>(null);
  const [freeTerminalSavePrompt, setFreeTerminalSavePrompt] =
    useState<FreeTerminalSavePromptState | null>(null);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  const suppressedAutoAttachIdsRef = useRef<Set<string>>(new Set());
  const pendingAutoAttachIdsRef = useRef<Set<string>>(new Set());

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
  ) {
    suppressedAutoAttachIdsRef.current.delete(sessionId);
    pendingAutoAttachIdsRef.current.add(sessionId);

    const isAdHoc = isAdHocProjectTerminal(sessionId, profileSessionIds);

    setOpenTabs((prev) => {
      if (prev.some((t) => t.sessionId === sessionId)) return prev;
      return [
        ...prev,
        {
          sessionId,
          label: tabLabel(sessionId, project, command),
          session: sessionMap.get(sessionId),
          isSaveable: isAdHoc,
        },
      ];
    });

    setMountedSessions((prev) => {
      const existing = prev.find((s) => s.sessionId === sessionId);
      if (existing) {
        return [existing, ...prev.filter((s) => s.sessionId !== sessionId)];
      }
      return [{ sessionId, project, command, cwd }, ...prev];
    });

    setActiveTab(sessionId);
    setSelection({ type: "terminal", sessionId });
  }

  function removeSessionsFromUi(sessionIds: string[]) {
    if (sessionIds.length === 0) return;

    for (const sessionId of sessionIds) {
      pendingAutoAttachIdsRef.current.delete(sessionId);
    }

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
      openTerminalTab(sessionParam, meta.project, meta.command);
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

    const next = deriveTerminalAutoAttachState({
      sessions,
      openTabs,
      mountedSessions,
      activeTab,
      profileSessionIds,
      freeTerminalIndexMap,
      ignoredSessionIds: suppressedAutoAttachIdsRef.current,
      pendingSessionIds: pendingAutoAttachIdsRef.current,
    });
    const attachedLiveSessionIds = new Set(
      next.openTabs.map((tab) => tab.sessionId),
    );

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
  }, [
    sessions,
    sessionMap,
    openTabs,
    mountedSessions,
    activeTab,
    profileSessionIds,
    freeTerminalIndexMap,
  ]);

  function handleSelectProject(name: string) {
    setLaunchForm(null);
    setSelection({ type: "project", name });
  }

  function handleSelectTerminal(sessionId: string) {
    const meta = findSessionMeta(sessionId, tree, sessionMap);
    if (meta) {
      openTerminalTab(sessionId, meta.project, meta.command);
    }
  }

  function handleLaunchTerminal(projectName: string, cmd: TreeCommand) {
    const projectPath = projects.find((p) => p.name === projectName)?.path;
    const resolvedCwd = cmd.cwd || projectPath;
    api.terminal
      .create({
        id: cmd.sessionId,
        project: projectName,
        command: cmd.command,
        cwd: resolvedCwd,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(cmd.sessionId, projectName, cmd.command, resolvedCwd);
      })
      .catch((err: unknown) =>
        console.error("[useTerminalManager] failed to create terminal", err),
      );
  }

  function handleLaunchProfile(projectName: string, cmd: TreeCommand) {
    const sanitizedName = sanitizeSessionSegment(
      (cmd.profileName ?? "terminal").replace(/ /g, "_"),
    );
    const sessionId = `terminal:${projectName}:${sanitizedName}:${Date.now()}`;

    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command: cmd.command,
        cwd: cmd.cwd,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, projectName, cmd.command, cmd.cwd);
      })
      .catch((err: unknown) =>
        console.error(
          "[useTerminalManager] failed to launch profile instance",
          err,
        ),
      );
  }

  function handleLaunchFormSubmit() {
    if (!launchForm) return;
    const { projectName, cwd, command } = launchForm;
    const platform = (window as { damHopper?: { platform?: string } }).damHopper
      ?.platform;
    const resolvedCommand =
      command.trim() || (platform === "win32" ? "cmd.exe" : "bash");
    const resolvedCwd = cwd.trim() || undefined;
    const sessionId = `terminal:${projectName}:_:${Date.now()}`;

    setLaunchForm(null);

    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command: resolvedCommand,
        cwd: resolvedCwd,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, projectName, resolvedCommand, resolvedCwd);
      })
      .catch((err: unknown) =>
        console.error("[useTerminalManager] failed to launch terminal", err),
      );
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

    const oldSessionId = `custom:${projectName}:${originalKey.replace(/[^a-zA-Z0-9:._-]/g, "-")}`;
    if (sessionMap.get(oldSessionId)?.alive) {
      void api.terminal.kill(oldSessionId);
    }
    removeSessionsFromUi([oldSessionId]);
    await qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
  }

  function handleSaveProfile() {
    if (!savePrompt) return;
    const { sessionId, name } = savePrompt;

    const mounted = mountedSessions.find((s) => s.sessionId === sessionId);
    const session = sessionMap.get(sessionId);
    const projectName = mounted?.project || session?.project;
    const command = mounted?.command || session?.command;
    const cwd = mounted?.cwd || session?.cwd;

    if (!projectName) return;

    const project = projects.find((p) => p.name === projectName);
    if (!project) return;

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
    const sessionId = `${FREE_TERMINAL_PREFIX}${generateUUID()}`;
    api.terminal
      .create({
        id: sessionId,
        project: launchContext.projectName,
        command: "",
        cwd: launchContext.projectPath,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          sessionId,
          launchContext.projectName ?? "",
          "",
          launchContext.projectPath,
        );
      })
      .catch((err: unknown) =>
        console.error(
          "[useTerminalManager] failed to create free terminal",
          err,
        ),
      );
  }

  function handleLaunchFreeWithCommand(command: string, projectName?: string) {
    const launchContext = getTerminalLaunchContext(projects, projectName);
    if (command.trim()) recordCommand(command, launchContext.projectName);
    const sessionId = `${FREE_TERMINAL_PREFIX}${generateUUID()}`;
    api.terminal
      .create({
        id: sessionId,
        project: launchContext.projectName,
        command,
        cwd: launchContext.projectPath,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(
          sessionId,
          launchContext.projectName ?? "",
          command,
          launchContext.projectPath,
        );
      })
      .catch((err: unknown) =>
        console.error(
          "[useTerminalManager] failed to create free terminal with command",
          err,
        ),
      );
  }

  function handleLaunchSuggestedCommand(projectName: string, command: string) {
    if (command.trim()) recordCommand(command, projectName);
    const sessionId = `terminal:${projectName}:_:${Date.now()}`;
    const projectPath = projects.find((p) => p.name === projectName)?.path;
    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command,
        cwd: projectPath,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, projectName, command, projectPath);
      })
      .catch((err: unknown) =>
        console.error(
          "[useTerminalManager] failed to create suggested terminal",
          err,
        ),
      );
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
    const sessionId = `terminal:${projectName}:_:${Date.now()}`;
    const projectPath = projects.find((p) => p.name === projectName)?.path;
    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command,
        cwd: projectPath,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, projectName, command, projectPath);
      })
      .catch((err: unknown) =>
        console.error(
          "[useTerminalManager] failed to create suggested terminal",
          err,
        ),
      );
  }

  function handleSelectTab(sessionId: string) {
    setActiveTab(sessionId);
    setSelection({ type: "terminal", sessionId });

    setMountedSessions((prev) => {
      const existing = prev.find((s) => s.sessionId === sessionId);
      if (existing) {
        return [existing, ...prev.filter((s) => s.sessionId !== sessionId)];
      }
      const meta = findSessionMeta(sessionId, tree, sessionMap);
      if (meta) {
        return [
          { sessionId, project: meta.project, command: meta.command },
          ...prev,
        ];
      }
      return prev;
    });
  }

  function handleCloseTab(sessionId: string) {
    suppressedAutoAttachIdsRef.current.add(sessionId);
    pendingAutoAttachIdsRef.current.delete(sessionId);
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
    void api.terminal.remove(sessionId).then(() => {
      void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
    });
    handleCloseTab(sessionId);
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
    const cwd = mounted?.cwd || session?.cwd;

    if (!command) return;

    const project = projects.find((p) => p.name === projectName);
    if (!project) return;

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
      void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId
            ? { ...t, session: sessionMap.get(sessionId) }
            : t,
        ),
      );
    },
    [qc, sessionMap],
  );

  const tabsWithLiveSession: TabEntry[] = openTabs.map((t) => {
    const { type } = parseTerminalSessionId(t.sessionId);
    const isAdHoc = isAdHocProjectTerminal(t.sessionId, profileSessionIds);
    const label = type === "free" ? tabLabel(t.sessionId, "", "") : t.label;
    return {
      ...t,
      label,
      session: sessionMap.get(t.sessionId) ?? t.session,
      isSaveable: isAdHoc,
    };
  });

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
      tabsWithLiveSession,
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
