import {
  useState,
  useMemo,
  useCallback,
  type ReactElement,
} from "react";
import { X } from "lucide-react";
import type { OsWindow } from "../types.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { TraditionalTerminalProjectsDisplay } from "@/components/organisms/TraditionalTerminalProjectsDisplay.js";
import { useAgentHubWorkspaces } from "../agent-hub/use-agent-hub-workspaces.js";
import { useHubTerminalTabActions } from "../agent-hub/use-hub-terminal-tab-actions.js";
import { useHubTerminalLaunch } from "../agent-hub/use-hub-terminal-launch.js";
import { AgentHubHeader } from "../agent-hub/AgentHubHeader.js";
import { HubStuckLaunchNotice } from "../agent-hub/HubStuckLaunchNotice.js";
import { requestAgentHubReview } from "../agent-hub/agent-hub-review.js";
import {
  useProjectTargetStore,
  projectScopeKey,
} from "@/stores/project-target.js";
import type { IntentPayloadMap } from "../intents.js";
import { terminalKey } from "@/api/ownership.js";

export interface AgentHubAppProps {
  window: OsWindow;
}

export function AgentHubApp({ window }: AgentHubAppProps): ReactElement {
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [fileTreeHidden, setFileTreeHidden] = useState(false);
  const handleToggleFileTree = useCallback(() => {
    setFileTreeHidden((prev) => !prev);
  }, []);

  const workspaces = useAgentHubWorkspaces(window);
  const {
    groups,
    openWorkspaceRefs,
    runtimeIndex,
    summary,
    sidebarHidden,
    projectInventory,
    inventoryLoading,
    disclosedGroupIds,
  } = workspaces;

  const mountedSessions = useMemo(
    () => groups.flatMap((g) => g.mountedSessions),
    [groups],
  );
  const handleSelectTab = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const handleClearSelection = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  const tabActions = useHubTerminalTabActions({
    hubWindowId: window.id,
    groups,
    runtimeIndex,
    terminalInventoryLoaded: workspaces.terminalInventoryLoaded,
    loadedProfileIds: workspaces.loadedTerminalInventoryProfileIds,
    onSelectTab: handleSelectTab,
    onClearSelection: handleClearSelection,
  });

  const terminalTabs = useMemo(
    () =>
      groups.flatMap((g) =>
        g.terminalTabs.map((t) => ({
          ...t,
          isPinned: tabActions.isTabPinned(t.sessionId),
        })),
      ),
    [groups, tabActions],
  );

  const launch = useHubTerminalLaunch({
    hubWindowId: window.id,
    desktopId: window.desktopId,
    groups,
    runtimeIndex,
    onSelectTab: handleSelectTab,
  });

  const selectedGroup = useMemo(() => {
    if (!workspaces.selectedWorkspace) return groups[0] ?? null;
    return (
      groups.find((g) => g.id === workspaces.selectedWorkspace) ??
      groups[0] ??
      null
    );
  }, [groups, workspaces.selectedWorkspace]);
  const hubAttach = useMemo(
    () => ({
      hubWindowId: window.id,
      resolveTarget: (key: string) => runtimeIndex.get(key),
    }),
    [window.id, runtimeIndex],
  );

  const selectedProjectKey = useMemo(() => {
    if (!selectedGroup) return null;
    return selectedGroup.projectRef
      ? projectScopeKey(selectedGroup.projectRef)
      : (selectedGroup.projectName ?? selectedGroup.id);
  }, [selectedGroup]);

  const activeTargets = useProjectTargetStore((s) => s.activeTargetByProject) as Record<string, string | null>;
  const selectedWorktree = selectedProjectKey ? activeTargets[selectedProjectKey] ?? null : null;

  // R7: Relocated Review affordance with exact fences
  const handleOpenSessionChanges = useCallback(
    async (sessionId: string) => {
      setFeedbackNotice(null);
      const item = workspaces.items.find((i) =>
        i.terminalRef
          ? terminalKey(i.terminalRef) === sessionId
          : i.sessionId === sessionId,
      );
      if (!item) {
        setFeedbackNotice(
          "Review unavailable: Terminal session not found in active inventory.",
        );
        return;
      }
      const result = await requestAgentHubReview(item, window.id);
      if (!result.ok && result.notice) {
        setFeedbackNotice(result.notice);
      }
    },
    [window.id, workspaces.items],
  );

  // R9: File open intent forwarder
  const handleOpenFile = useCallback(
    async (payload: IntentPayloadMap["file:open"]) => {
      setFeedbackNotice(null);
      const intentResult = await dispatchIntent(
        createIntent("file:open", payload, window.id),
      );
      if (intentResult && intentResult.status === "unhandled" && intentResult.reason) {
        setFeedbackNotice(intentResult.reason);
      }
    },
    [window.id],
  );

  // Recipes intent
  const handleOpenRecipes = useCallback(() => {
    dispatchIntent(createIntent("recipes:open", {}, window.id));
  }, [window.id]);

  // Git float intent
  const handleOpenGit = useCallback(() => {
    if (!selectedGroup?.projectName || !selectedGroup.profileId) return;
    dispatchIntent(
      createIntent(
        "git:status",
        {
          profileId: selectedGroup.profileId,
          projectId: selectedGroup.projectName,
          worktreeId: selectedWorktree ?? undefined,
          mode: "float",
        },
        window.id,
      ),
    );
  }, [selectedGroup, selectedWorktree, window.id]);

  return (
    <div
      data-testid="agent-hub-app"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-background)]"
    >
      <AgentHubHeader
        sidebarHidden={sidebarHidden}
        fileTreeHidden={fileTreeHidden}
        onToggleSidebar={workspaces.toggleSidebar}
        onToggleFileTree={handleToggleFileTree}
        selectedGroup={selectedGroup}
        selectedWorktree={selectedWorktree}
        summary={summary}
        onOpenRecipes={handleOpenRecipes}
        onOpenGit={handleOpenGit}
      />

      {feedbackNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 border-b border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-2 text-xs text-[var(--color-warning)]"
        >
          <span>{feedbackNotice}</span>
          <button
            type="button"
            onClick={() => setFeedbackNotice(null)}
            className="rounded p-0.5 hover:bg-[var(--color-warning)]/20"
            aria-label="Dismiss feedback"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {tabActions.actionNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 border-b border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-2 text-xs text-[var(--color-warning)]"
        >
          <span>{tabActions.actionNotice}</span>
          <button
            type="button"
            onClick={tabActions.clearActionNotice}
            className="rounded p-0.5 hover:bg-[var(--color-warning)]/20"
            aria-label="Dismiss action notice"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {launch.launchNotice && !launch.stuckAttempt && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 border-b border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-2 text-xs text-[var(--color-warning)]"
        >
          <span>{launch.launchNotice}</span>
          <button
            type="button"
            onClick={launch.clearNotice}
            className="rounded p-0.5 hover:bg-[var(--color-warning)]/20"
            aria-label="Dismiss launch notice"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {launch.stuckAttempt && (
        <HubStuckLaunchNotice
          reason={launch.stuckAttempt.reason}
          attemptId={launch.stuckAttempt.attemptId}
          profileId={launch.stuckAttempt.profileId}
          onSelectTerminal={handleSelectTab}
          onDismiss={launch.clearStuckAttempt}
          onLaunchAgain={() => launch.launchTerminal(selectedGroup?.id)}
        />
      )}

      <div className="min-h-0 flex-1">
        <TraditionalTerminalProjectsDisplay
          activeSessionId={activeSessionId}
          mountedSessions={mountedSessions}
          terminalTabs={terminalTabs}
          currentProjectId={selectedGroup ? selectedGroup.id : null}
          currentProjectRevision={1}
          renderTerminals={false}
          isCompact={false}
          sidebarHidden={sidebarHidden}
          fileTreeHidden={fileTreeHidden}
          onToggleFileTree={handleToggleFileTree}
          disclosedGroupIds={disclosedGroupIds}
          openWorkspaceRefs={openWorkspaceRefs}
          projectInventory={projectInventory}
          inventoryLoading={inventoryLoading}
          onToggleDisclosure={workspaces.toggleDisclosure}
          onOpenWorkspace={workspaces.openWorkspace}
          onCloseWorkspace={workspaces.closeWorkspace}
          onNewTerminalInGroup={(groupId) => launch.launchTerminal(groupId)}
          onNewProjectTerminal={(projectId) => launch.launchTerminal(projectId)}
          onNewFreeTerminal={() => launch.launchTerminal(selectedGroup?.id)}
          onSelectTab={handleSelectTab}
          onToggleTabPin={tabActions.onToggleTabPin}
          onCloseTab={tabActions.onCloseTab}
          onOpenFile={handleOpenFile}
          onOpenRecipes={handleOpenRecipes}
          onOpenGit={handleOpenGit}
          onOpenSessionChanges={handleOpenSessionChanges}
          onSelectedGroupChange={workspaces.handleSelectedGroupChange}
          selectGroupRequest={workspaces.selectGroupRequest}
          hubAttach={hubAttach}
        />
      </div>
    </div>
  );
}
