import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Plus } from "lucide-react";
import {
  getConnectionSnapshot,
  subscribeConnections,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import {
  getProfileChangeVersion,
  getProfiles,
  subscribeToProfileChanges,
} from "@/api/server-config.js";
import { parseTerminalKey, projectKey, terminalKey } from "@/api/ownership.js";
import { ProfileBadge } from "@/components/atoms/ProfileBadge.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import {
  MultiTerminalDisplay,
  type MountedSession,
} from "@/components/organisms/MultiTerminalDisplay.js";
import { TraditionalTerminalProjectsNavigator } from "@/components/organisms/TraditionalTerminalProjectsNavigator.js";
import type { TerminalDiagnosticsMenuHandler } from "@/components/organisms/TerminalDiagnosticsContextMenu.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { useResizeHandle } from "@/hooks/use-resize-handle.js";
import { useTraditionalTerminalProjectSelection } from "@/hooks/use-traditional-terminal-project-selection.js";
import {
  buildTraditionalTerminalProjectGroups,
  firstRemainingTraditionalTerminalId,
  traditionalTerminalLayoutStorageKey,
  traditionalTerminalProjectPanelId,
  traditionalTerminalProjectTabId,
  type TraditionalTerminalProjectGroup,
} from "@/lib/traditional-terminal-projects.js";
import { buildAgentSettingsHref } from "@/lib/agent-store-navigation.js";
import { buildTraditionalTerminalAgentRows } from "@/lib/traditional-terminal-agents.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import { cn } from "@/lib/utils.js";

const TRADITIONAL_PROJECTS_NAVIGATOR_WIDTH_KEY =
  "dam-hopper:traditional-projects-navigator-width";

function groupProjectTargetId(
  group?: Pick<TraditionalTerminalProjectGroup, "projectRef" | "projectName"> | null,
): string | null {
  if (!group) return null;
  if (group.projectRef) return projectKey(group.projectRef);
  return group.projectName;
}

export interface TraditionalTerminalProjectsDisplayProps {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  terminalTabs: DisplayTabEntry[];
  currentProjectId: string | null;
  currentProjectRevision: number;
  layoutRevision?: number;
  renderTerminals?: boolean;
  profileId?: string;
  onSessionExit?: (sessionId: string) => void;
  onNewProjectTerminal?: (projectId: string) => void;
  onNewFreeTerminal?: (projectId?: string) => void;
  onSelectTab?: (sessionId: string) => void;
  onToggleTabPin?: (sessionId: string) => void;
  onCloseTab?: (sessionId: string, preferredFallbackSessionId?: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  onRenameSession?: (sessionId: string) => void;
  onVisibleSessionIdsChange?: (sessionIds: ReadonlySet<string>) => void;
  browserOpen?: boolean;
  renderBrowserContent?: (onClose: () => void) => ReactNode;
  onCloseBrowser?: () => void;
}

export function TraditionalTerminalProjectsDisplay({
  activeSessionId,
  mountedSessions,
  terminalTabs,
  currentProjectId,
  currentProjectRevision,
  layoutRevision = 0,
  renderTerminals = false,
  profileId,
  onSessionExit,
  onNewProjectTerminal,
  onNewFreeTerminal,
  onSelectTab,
  onToggleTabPin,
  onCloseTab,
  onOpenDiagnosticsMenu,
  onRenameSession,
  onVisibleSessionIdsChange,
  browserOpen = false,
  renderBrowserContent,
  onCloseBrowser,
}: TraditionalTerminalProjectsDisplayProps) {
  const isCompactWorkspace = useCompactWorkspace();
  const {
    width: projectsNavigatorWidth,
    handleProps: projectsNavigatorResizeProps,
    isDragging: isResizingProjectsNavigator,
  } = useResizeHandle({
    min: 220,
    max: 520,
    defaultWidth: 224,
    keyboardResizeEnabled: true,
    storageKey: TRADITIONAL_PROJECTS_NAVIGATOR_WIDTH_KEY,
  });
  const [projectsSheetOpen, setProjectsSheetOpen] = useState(false);
  const projectsOpenerRef = useRef<HTMLButtonElement>(null);
  const statusProfiles = useAgentStatusStore((state) => state.profiles);
  const profileVersion = useSyncExternalStore(
    subscribeToProfileChanges,
    getProfileChangeVersion,
    () => 0,
  );
  const registeredProfiles = useMemo(() => getProfiles(), [profileVersion]);
  const profileLabels = useMemo(
    () => new Map(registeredProfiles.map((profile) => [profile.id, profile.name])),
    [registeredProfiles],
  );
  const connectionSignature = useSyncExternalStore(
    subscribeConnections,
    () =>
      JSON.stringify(
        registeredProfiles.map((profile) => {
          const snapshot = getConnectionSnapshot(profile.id);
          return [profile.id, snapshot?.status, snapshot?.owner.generation];
        }),
      ),
    () => "",
  );
  const connections = useMemo(() => {
    const snapshots = new Map<string, ConnectionSnapshot>();
    for (const profile of registeredProfiles) {
      const snapshot = getConnectionSnapshot(profile.id);
      if (snapshot) snapshots.set(profile.id, snapshot);
    }
    return snapshots;
  }, [registeredProfiles, connectionSignature]);
  const groups = useMemo(
    () => buildTraditionalTerminalProjectGroups(mountedSessions, terminalTabs),
    [mountedSessions, terminalTabs, registeredProfiles],
  );
  const rosterGroups = useMemo(
    () =>
      groups.map((group) => {
        const terminalTabs: DisplayTabEntry[] = [];
        for (const tab of group.terminalTabs) {
          const parsed = parseTerminalKey(tab.sessionId);
          const ref = tab.terminalRef ?? parsed;
          const session = tab.session;
          // useTerminalTree qualifies SessionInfo.id for UI routing. Project
          // only that exact application shape back to server metadata for the
          // pure builder; never accept raw alternates or mismatched identities.
          if (
            !parsed ||
            !ref ||
            !session ||
            tab.sessionId !== terminalKey(ref) ||
            session.id !== tab.sessionId ||
            parsed.profileId !== ref.profileId ||
            parsed.id !== ref.id ||
            (tab.profileId !== undefined && tab.profileId !== ref.profileId)
          ) continue;
          terminalTabs.push({
            ...tab,
            session: { ...session, id: ref.id },
          });
        }
        return { ...group, terminalTabs };
      }),
    [groups],
  );
  const agentRows = useMemo(
    () =>
      buildTraditionalTerminalAgentRows({
        groups: rosterGroups,
        profiles: statusProfiles,
        connections,
        profileLabels,
      }),
    [rosterGroups, statusProfiles, connections, profileLabels],
  );
  const offeredAgentKeys = useMemo(
    () => new Map(agentRows.map((row) => [row.sessionId, row.key])),
    [agentRows],
  );
  const committedAgentSelection = useRef<{
    keys: ReadonlyMap<string, string>;
    selectTab: (sessionId: string) => void;
  } | null>(null);
  const selection = useTraditionalTerminalProjectSelection({
    groups,
    activeSessionId,
    onSelectTab,
  });
  const { selectedGroup, activeSessionForGroup } = selection;
  // Status-bearing tabs or session renames rebuild groups/mountedSessions,
  // but unchanged PTY membership must not retrigger MultiTerminalDisplay's
  // prune/reparent/fit path and steal focus.
  const terminalSurfaceMountedSessionsKey = useMemo(() => {
    if (!selectedGroup) return "";
    return selectedGroup.mountedSessions
      .map(
        (s) =>
          `${s.sessionId}:${s.project}:${s.command}:${s.cwd ?? ""}:${s.worktreePath ?? ""}:${s.profileId ?? ""}:${s.terminalRef?.id ?? ""}:${s.terminalRef?.profileId ?? ""}`,
      )
      .join("|");
  }, [selectedGroup]);
  const terminalSurfaceMountedSessions = useMemo(() => {
    if (!selectedGroup) return [];
    const canonicalById = new Map(
      mountedSessions.map((session) => [session.sessionId, session]),
    );
    const members: MountedSession[] = [];
    for (const s of selectedGroup.mountedSessions) {
      const canonical = canonicalById.get(s.sessionId);
      if (canonical) members.push(canonical);
    }
    return members;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalSurfaceMountedSessionsKey]);
  const selectedGroupProjectTargetId = groupProjectTargetId(selectedGroup);
  const settingsProfileId =
    selectedGroup?.projectName &&
    selectedGroup?.profileId &&
    (!selectedGroup.projectRef ||
      selectedGroup.projectRef.profileId === selectedGroup.profileId) &&
    profileLabels.has(selectedGroup.profileId)
      ? selectedGroup.profileId
      : null;
  const agentSettingsHref = buildAgentSettingsHref(settingsProfileId);
  const activeSessionGroup = activeSessionId
    ? groups.find((group) =>
        group.terminalTabs.some((tab) => tab.sessionId === activeSessionId),
      )
    : undefined;
  const activeSessionGroupProjectTargetId = groupProjectTargetId(activeSessionGroup);
  const [newTerminalTargetState, setNewTerminalTargetState] = useState(() => ({
    projectId:
      currentProjectId === null
        ? null
        : (activeSessionGroupProjectTargetId ?? selectedGroupProjectTargetId),
    currentProjectRevision,
    activeSessionId,
  }));
  const currentProjectChanged =
    newTerminalTargetState.currentProjectRevision !== currentProjectRevision;
  const activeSessionChanged =
    newTerminalTargetState.activeSessionId !== activeSessionId;
  const newTerminalProjectTarget = currentProjectChanged
    ? currentProjectId
    : activeSessionChanged
      ? selectedGroupProjectTargetId
      : newTerminalTargetState.projectId;

  function rememberNewTerminalTarget(projectId: string | null) {
    setNewTerminalTargetState({
      projectId,
      currentProjectRevision,
      activeSessionId,
    });
  }

  function handleSelectGroup(groupId: string) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    rememberNewTerminalTarget(groupProjectTargetId(group));
    selection.handleSelectGroup(groupId);
    setProjectsSheetOpen(false);
  }

  function handleSelectTab(sessionId: string) {
    const group = groups.find((candidate) =>
      candidate.terminalTabs.some((tab) => tab.sessionId === sessionId),
    );
    if (group) rememberNewTerminalTarget(groupProjectTargetId(group));
    selection.handleSelectTab(sessionId);
  }
  // Publish only committed membership/selection. A retained old row callback
  // must not select a removed terminal or a replacement PTY with the same ID.
  useLayoutEffect(() => {
    committedAgentSelection.current = {
      keys: offeredAgentKeys,
      selectTab: handleSelectTab,
    };
    return () => {
      committedAgentSelection.current = null;
    };
  });

  function handleSelectAgent(sessionId: string) {
    const offeredKey = offeredAgentKeys.get(sessionId);
    const committed = committedAgentSelection.current;
    if (!offeredKey || committed?.keys.get(sessionId) !== offeredKey) return;
    committed.selectTab(sessionId);
    setProjectsSheetOpen(false);
  }
  function handleCloseTerminalTab(sessionId: string) {
    const group = groups.find((candidate) =>
      candidate.terminalTabs.some((tab) => tab.sessionId === sessionId),
    );
    onCloseTab?.(
      sessionId,
      group ? firstRemainingTraditionalTerminalId(group, sessionId) : undefined,
    );
  }

  function handleNewTerminal() {
    const targetProjectId = newTerminalProjectTarget;
    if (targetProjectId) {
      onNewProjectTerminal?.(targetProjectId);
    } else {
      onNewFreeTerminal?.();
    }
  }

  function renderTerminalSurface() {
    if (!selectedGroup) return null;
    return (
      <MultiTerminalDisplay
        key={selectedGroup.id}
        activeSessionId={activeSessionForGroup}
        mountedSessions={terminalSurfaceMountedSessions}
        openTabs={selectedGroup.terminalTabs}
        layoutStorageKey={traditionalTerminalLayoutStorageKey(selectedGroup.id)}
        terminalCommitStatusEnabled={false}
        layoutRevision={layoutRevision}
        renderTerminals={renderTerminals}
        onSessionExit={onSessionExit}
        onNewTerminal={handleNewTerminal}
        onSelectTab={handleSelectTab}
        onToggleTabPin={onToggleTabPin}
        onCloseTab={handleCloseTerminalTab}
        onRenameSession={onRenameSession}
        onOpenDiagnosticsMenu={onOpenDiagnosticsMenu}
        onVisibleSessionIdsChange={onVisibleSessionIdsChange}
        browserOpen={browserOpen}
        renderBrowserContent={renderBrowserContent}
        onCloseBrowser={onCloseBrowser}
      />
    );
  }

  if (!selectedGroup) return null;
  const selectedGroupTabId = traditionalTerminalProjectTabId(selectedGroup.id);
  const selectedGroupPanelId = traditionalTerminalProjectPanelId(
    selectedGroup.id,
  );

  if (isCompactWorkspace) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-clip bg-[var(--color-background)]">
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1">
          <span className="min-w-0 flex items-center gap-1.5 truncate text-xs font-semibold text-[var(--color-text)]">
            <span className="min-w-0 truncate">{selectedGroup.label}</span>
            {selectedGroup.profileName && (
              <ProfileBadge
                profileId={selectedGroup.profileId}
                name={selectedGroup.profileName}
              />
            )}
          </span>
          <button
            type="button"
            aria-label="New terminal in selected project"
            onClick={handleNewTerminal}
            title="New terminal in selected project"
            className="ml-auto flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] active:bg-[var(--color-border)]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          {/* Keep the sheet action on its own trailing row: the mobile shell's
              default floating Panels selector occupies the leading edge. */}
          <button
            ref={projectsOpenerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={projectsSheetOpen}
            onClick={() => setProjectsSheetOpen(true)}
            className="col-span-2 flex min-h-11 min-w-11 shrink-0 items-center justify-self-end gap-2 rounded-md border border-[var(--color-primary)]/35 bg-[var(--color-primary)]/14 px-3 text-xs font-semibold text-[var(--color-primary)] active:bg-[var(--color-primary)]/20"
          >
            <span>Projects + Agents</span>
          </button>
        </div>
        {/* The pane host changes sibling position between layouts. Keep its
            React identity so a breakpoint does not detach or remount xterm. */}
        <main
          key="terminal-surface"
          id={selectedGroupPanelId}
          role="tabpanel"
          aria-label="Selected terminal project"
          tabIndex={0}
          className="min-h-0 flex-1"
        >
          {renderTerminalSurface()}
        </main>
        <Dialog open={projectsSheetOpen} onOpenChange={setProjectsSheetOpen}>
          <DialogContent
            // Keep modal keys out of document-level workspace shortcuts.
            // Do not preventDefault: Radix still owns Tab trapping and Escape.
            onKeyDown={(event) => event.stopPropagation()}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (projectsOpenerRef.current?.isConnected) {
                projectsOpenerRef.current.focus();
              }
            }}
            className="safe-area-inline safe-area-bottom fixed inset-x-0 bottom-0 top-auto left-0 z-50 max-h-[calc(var(--app-viewport-height)*0.75)] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-2xl border-x-0 border-b-0 p-0 [&>button]:flex [&>button]:min-h-11 [&>button]:min-w-11 [&>button]:items-center [&>button]:justify-center data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:rounded-t-2xl"
          >
            <DialogHeader className="border-b border-[var(--color-border)] py-3 pl-4 pr-16 text-left">
              <DialogTitle className="text-sm">Projects + Agents</DialogTitle>
              <DialogDescription className="text-xs">
                Select an open project or an observed agent's terminal.
              </DialogDescription>
            </DialogHeader>
            <TraditionalTerminalProjectsNavigator
              groups={groups}
              activeGroupId={selectedGroup.id}
              onSelectGroup={handleSelectGroup}
              onNewTerminal={handleNewTerminal}
              agentRows={agentRows}
              activeSessionId={activeSessionId}
              onSelectAgent={handleSelectAgent}
              agentSettingsHref={agentSettingsHref}
              className="max-h-[calc(var(--app-viewport-height)*0.75_-_5rem)]"
              touchOptimized
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 overflow-clip bg-[var(--color-background)]",
        isResizingProjectsNavigator && "select-none",
      )}
    >
      <TraditionalTerminalProjectsNavigator
        groups={groups}
        activeGroupId={selectedGroup.id}
        onSelectGroup={handleSelectGroup}
        onNewTerminal={handleNewTerminal}
        agentRows={agentRows}
        activeSessionId={activeSessionId}
        onSelectAgent={handleSelectAgent}
        agentSettingsHref={agentSettingsHref}
        width={projectsNavigatorWidth}
      />
      <div
        {...projectsNavigatorResizeProps}
        role="separator"
        aria-label="Resize projects panel"
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={520}
        aria-valuenow={projectsNavigatorWidth}
        aria-valuetext={`${projectsNavigatorWidth} pixels`}
        data-testid="traditional-projects-resize-handle"
        title="Resize projects panel"
        className="group relative w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)]/20 focus-visible:bg-[var(--color-primary)]/20 focus-visible:outline-none"
      >
        <div
          className={cn(
            "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[var(--color-primary)]/50 opacity-0 transition-opacity group-hover:opacity-100",
            isResizingProjectsNavigator && "opacity-100",
          )}
        />
      </div>
      <main
        key="terminal-surface"
        id={selectedGroupPanelId}
        role="tabpanel"
        aria-labelledby={selectedGroupTabId}
        tabIndex={0}
        className="min-w-0 flex min-h-0 flex-1 flex-col"
      >
        {renderTerminalSurface()}
      </main>
    </div>
  );
}
