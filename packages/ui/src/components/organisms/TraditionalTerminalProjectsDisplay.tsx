import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
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
} from "@/lib/traditional-terminal-projects.js";
import { cn } from "@/lib/utils.js";

const TRADITIONAL_PROJECTS_NAVIGATOR_WIDTH_KEY =
  "dam-hopper:traditional-projects-navigator-width";

export interface TraditionalTerminalProjectsDisplayProps {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  terminalTabs: DisplayTabEntry[];
  currentProjectName: string | null;
  currentProjectRevision: number;
  layoutRevision?: number;
  renderTerminals?: boolean;
  onSessionExit?: (sessionId: string) => void;
  onNewProjectTerminal?: (projectName: string) => void;
  onNewFreeTerminal?: () => void;
  onSelectTab?: (sessionId: string) => void;
  onToggleTabPin?: (sessionId: string) => void;
  onCloseTab?: (
    sessionId: string,
    preferredFallbackSessionId?: string,
  ) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  onVisibleSessionIdsChange?: (sessionIds: ReadonlySet<string>) => void;
  browserOpen?: boolean;
  renderBrowserContent?: (onClose: () => void) => ReactNode;
  onCloseBrowser?: () => void;
}

export function TraditionalTerminalProjectsDisplay({
  activeSessionId,
  mountedSessions,
  terminalTabs,
  currentProjectName,
  currentProjectRevision,
  layoutRevision = 0,
  renderTerminals = false,
  onSessionExit,
  onNewProjectTerminal,
  onNewFreeTerminal,
  onSelectTab,
  onToggleTabPin,
  onCloseTab,
  onOpenDiagnosticsMenu,
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
  const groups = useMemo(
    () => buildTraditionalTerminalProjectGroups(mountedSessions, terminalTabs),
    [mountedSessions, terminalTabs],
  );
  const selection = useTraditionalTerminalProjectSelection({
    groups,
    activeSessionId,
    onSelectTab,
  });
  const { selectedGroup, activeSessionForGroup } = selection;
  const selectedGroupProjectName = selectedGroup?.projectName ?? null;
  const activeSessionGroup = activeSessionId
    ? groups.find((group) =>
        group.terminalTabs.some((tab) => tab.sessionId === activeSessionId),
      )
    : undefined;
  const [newTerminalTargetState, setNewTerminalTargetState] = useState(() => ({
    projectName:
      currentProjectName === null
        ? null
        : activeSessionGroup
          ? activeSessionGroup.projectName
          : selectedGroupProjectName,
    currentProjectRevision,
    activeSessionId,
  }));
  const currentProjectChanged =
    newTerminalTargetState.currentProjectRevision !== currentProjectRevision;
  const activeSessionChanged =
    newTerminalTargetState.activeSessionId !== activeSessionId;
  const newTerminalProjectTarget = currentProjectChanged
    ? currentProjectName
    : activeSessionChanged
      ? selectedGroupProjectName
      : newTerminalTargetState.projectName;

  function rememberNewTerminalTarget(projectName: string | null) {
    setNewTerminalTargetState({
      projectName,
      currentProjectRevision,
      activeSessionId,
    });
  }

  function handleSelectGroup(groupId: string) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    rememberNewTerminalTarget(group.projectName);
    selection.handleSelectGroup(groupId);
    setProjectsSheetOpen(false);
  }

  function handleSelectTab(sessionId: string) {
    const group = groups.find((candidate) =>
      candidate.terminalTabs.some((tab) => tab.sessionId === sessionId),
    );
    if (group) rememberNewTerminalTarget(group.projectName);
    selection.handleSelectTab(sessionId);
  }
  function handleCloseTerminalTab(sessionId: string) {
    const group = groups.find((candidate) =>
      candidate.terminalTabs.some((tab) => tab.sessionId === sessionId),
    );
    onCloseTab?.(
      sessionId,
      group
        ? firstRemainingTraditionalTerminalId(group, sessionId)
        : undefined,
    );
  }

  function handleNewTerminal() {
    const targetProjectName = newTerminalProjectTarget;
    if (targetProjectName) {
      onNewProjectTerminal?.(targetProjectName);
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
        mountedSessions={selectedGroup.mountedSessions}
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
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={projectsSheetOpen}
            onClick={() => setProjectsSheetOpen(true)}
            className="flex h-8 items-center gap-2 rounded-md border border-[var(--color-primary)]/35 bg-[var(--color-primary)]/14 px-3 text-xs font-semibold text-[var(--color-primary)] active:bg-[var(--color-primary)]/20"
          >
            <span>Projects</span>
          </button>
          <span className="min-w-0 truncate text-xs font-semibold text-[var(--color-text)]">
            {selectedGroup.label}
          </span>
          <button
            type="button"
            aria-label="New terminal in selected project"
            onClick={handleNewTerminal}
            title="New terminal in selected project"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] active:bg-[var(--color-border)]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <main
          id={selectedGroupPanelId}
          role="tabpanel"
          aria-label="Selected terminal project"
          tabIndex={0}
          className="min-h-0 flex-1"
        >
          {renderTerminalSurface()}
        </main>
        <Dialog open={projectsSheetOpen} onOpenChange={setProjectsSheetOpen}>
          <DialogContent className="safe-area-inline safe-area-bottom fixed inset-x-0 bottom-0 top-auto left-0 z-50 max-h-[calc(var(--app-viewport-height)*0.75)] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-2xl border-x-0 border-b-0 p-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:rounded-t-2xl">
            <DialogHeader className="border-b border-[var(--color-border)] px-4 py-3 text-left">
              <DialogTitle className="text-sm">projects</DialogTitle>
              <DialogDescription className="text-xs">
                Select an open terminal project.
              </DialogDescription>
            </DialogHeader>
            <TraditionalTerminalProjectsNavigator
              groups={groups}
              activeGroupId={selectedGroup.id}
              onSelectGroup={handleSelectGroup}
              onNewTerminal={handleNewTerminal}
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
