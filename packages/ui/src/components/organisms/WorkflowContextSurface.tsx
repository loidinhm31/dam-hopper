import { useEffect, useRef, useState } from "react";
import type { ProjectTargetRef } from "@/api/client.js";
import {
  GLOBAL_WORKSPACE_PROJECT,
  type ItemDto,
  type ItemKind,
} from "@/api/workflow-dto-types.js";
import { useWorkflowOverview } from "@/api/workflow-queries.js";
import {
  filterOverviewByTarget,
  flattenOverviewNodes,
  selectActivePlanOrItem,
  selectAttentionSummary,
  selectRunningSessionForItem,
} from "@/api/workflow-selectors.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import { getActiveProfileId } from "@/api/server-config.js";
import { WorkflowContextRibbon } from "@/components/molecules/WorkflowContextRibbon.js";
import {
  WorkflowContextDeck,
  type WorkflowPlansMode,
} from "@/components/organisms/WorkflowContextDeck.js";
import {
  WorkflowContextSheet,
  type MobileWorkflowSegment,
} from "@/components/organisms/WorkflowContextSheet.js";
import { useOsViewport } from "@/os/use-os-viewport.js";
import { useWorkflowSurfaceActions } from "@/hooks/use-workflow-surface-actions.js";
import { cn } from "@/lib/utils.js";
import {
  isWorkflowShortcutOwner,
  matchesWorkflowToggleShortcut,
  restoreWorkflowFocus,
} from "@/lib/workflow-focus.js";

export interface WorkflowContextSurfaceProps {
  target?: ProjectTargetRef | null;
  configuredProjects?: Array<{ name: string }>;
  variant?: "deck" | "window";
  initialSelectedItemId?: string | null;
  initialPlansMode?: WorkflowPlansMode;
  onPlansModeChange?: (mode: WorkflowPlansMode) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenTerminal?: (sessionId: string) => void;
  onSelectTarget?: (target: ProjectTargetRef | null) => void;
}

export function WorkflowContextSurface({
  target,
  configuredProjects = [],
  variant = "deck",
  initialSelectedItemId = null,
  initialPlansMode = "manual",
  onPlansModeChange,
  isOpen: controlledIsOpen,
  onOpenChange,
  onOpenTerminal,
  onSelectTarget,
}: WorkflowContextSurfaceProps) {
  const { isCompact } = useOsViewport();
  const [localIsOpen, setLocalIsOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<ProjectTargetRef | null>(
    target ?? null,
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    initialSelectedItemId,
  );
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const workflowTriggerRef = useRef<HTMLDivElement | null>(null);
  const [quickCaptureKind, setQuickCaptureKind] = useState<ItemKind>("plan");
  const [quickCaptureParentId, setQuickCaptureParentId] = useState<
    string | null
  >(null);
  const [mobileSegment, setMobileSegment] =
    useState<MobileWorkflowSegment>("items");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [plansMode, setPlansMode] = useState<WorkflowPlansMode>(initialPlansMode);
  const isOpen = variant === "window" ? true : (controlledIsOpen ?? localIsOpen);
  const setIsOpen = (open: boolean) => {
    setLocalIsOpen(open);
    onOpenChange?.(open);
  };
  const handlePlansModeChange = (mode: WorkflowPlansMode) => {
    setPlansMode(mode);
    onPlansModeChange?.(mode);
  };

  const resolvedProfileId =
    selectedTarget?.profileId ?? target?.profileId ?? getActiveProfileId();
  const filterTarget = selectedTarget;
  const mutationTarget: ProjectTargetRef =
    selectedTarget && selectedTarget.project !== "default"
      ? {
          ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
          project: selectedTarget.project,
          ...(selectedTarget.worktreePath
            ? { worktreePath: selectedTarget.worktreePath }
            : {}),
        }
      : {
          ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
          project: GLOBAL_WORKSPACE_PROJECT,
        };
  const overviewOptions = resolvedProfileId
    ? { profileId: resolvedProfileId }
    : undefined;
  const {
    data: overview,
    isLoading,
    error,
    refetch,
    isUnavailable,
  } = useWorkflowOverview(overviewOptions);
  const actions = useWorkflowSurfaceActions(mutationTarget);
  const overviewForSurface = isUnavailable ? undefined : overview;

  const activeProfileId = resolvedProfileId;
  const connSnap = activeProfileId
    ? getConnectionSnapshot(activeProfileId)
    : null;
  const owner =
    connSnap?.owner ??
    (activeProfileId ? { profileId: activeProfileId, generation: 1 } : null);
  const { plans, standaloneTasks } = filterOverviewByTarget(
    overviewForSurface,
    filterTarget,
  );
  const activeNode = selectActivePlanOrItem(
    overviewForSurface,
    filterTarget,
  );
  const runningSession = selectRunningSessionForItem(activeNode);
  const attention = selectAttentionSummary(overviewForSurface, filterTarget);
  useEffect(() => {
    if (!isUnavailable) return;
    setSelectedItemId(null);
    setIsQuickCaptureOpen(false);
  }, [isUnavailable]);

  useEffect(() => {
    if (target !== undefined) {
      setSelectedTarget(target);
    }
  }, [target?.profileId, target?.project, target?.worktreePath]);

  useEffect(() => {
    if (initialSelectedItemId) {
      setSelectedItemId(initialSelectedItemId);
    }
  }, [initialSelectedItemId]);

  const handleSelectTarget = (nextTarget: ProjectTargetRef | null) => {
    const qualifiedNext = nextTarget
      ? {
          ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
          ...nextTarget,
        }
      : null;
    setSelectedTarget(qualifiedNext);
    onSelectTarget?.(qualifiedNext);
  };

  useEffect(() => {
    if (variant === "window") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        matchesWorkflowToggleShortcut(e) &&
        isWorkflowShortcutOwner(e.target)
      ) {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, variant]);
  useEffect(() => {
    if (!attention.hasRunningSessions) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) {
        setNowMs(Date.now());
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [attention.hasRunningSessions]);

  const handleOpenQuickCapture = (
    kind: ItemKind = "plan",
    parentId: string | null = null,
  ) => {
    setQuickCaptureKind(kind);
    setQuickCaptureParentId(parentId);
    setIsQuickCaptureOpen(true);
  };
  const handleDeleteItem = async (item: ItemDto) => {
    await actions.handleDeleteItem(item);
    if (selectedItemId === item.id) {
      setSelectedItemId(null);
    }
  };
  const allNodes = overviewForSurface
    ? flattenOverviewNodes([
        ...overviewForSurface.plans,
        ...overviewForSurface.standaloneTasks,
      ])
    : [];

  const quickCaptureTarget: ProjectTargetRef = (() => {
    if (quickCaptureParentId) {
      const parentNode = allNodes.find((n) => n.item.id === quickCaptureParentId);
      if (parentNode) {
        return {
          ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
          project: parentNode.item.target.project,
          ...(parentNode.item.target.worktreePath
            ? { worktreePath: parentNode.item.target.worktreePath }
            : {}),
        };
      }
    }
    return mutationTarget;
  })();

  const handleStartSession = (startedAt: string, itemId?: string | null) => {
    if (itemId) {
      const itemNode = allNodes.find((n) => n.item.id === itemId);
      if (itemNode) {
        const itemTarget: ProjectTargetRef = {
          ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
          project: itemNode.item.target.project,
          ...(itemNode.item.target.worktreePath
            ? { worktreePath: itemNode.item.target.worktreePath }
            : {}),
        };
        return actions.handleStartSession(startedAt, itemId, itemTarget);
      }
    }
    return actions.handleStartSession(startedAt, itemId);
  };

  const targetOptions: ProjectTargetRef[] | undefined =
    selectedTarget === null
      ? (() => {
          const seen = new Set<string>([GLOBAL_WORKSPACE_PROJECT]);
          const opts: ProjectTargetRef[] = [
            {
              ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
              project: GLOBAL_WORKSPACE_PROJECT,
            },
          ];
          for (const cfg of configuredProjects) {
            if (!cfg.name || seen.has(cfg.name)) continue;
            seen.add(cfg.name);
            opts.push({
              ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
              project: cfg.name,
            });
          }
          for (const proj of overviewForSurface?.projects ?? []) {
            if (!proj.project || seen.has(proj.project)) continue;
            seen.add(proj.project);
            opts.push({
              ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
              project: proj.project,
              ...(proj.target?.worktreePath
                ? { worktreePath: proj.target.worktreePath }
                : {}),
            });
          }
          return opts;
        })()
      : undefined;

  const sharedProps = {
    target: filterTarget,
    mutationTarget,
    quickCaptureTarget,
    targetOptions,
    configuredProjects,
    projects: overviewForSurface?.projects ?? [],
    plans,
    standaloneTasks,
    sessions: overviewForSurface?.runningSessions ?? [],
    selectedItemId,
    selectedTarget,
    onSelectTarget: handleSelectTarget,
    onSelectItem: (item: { id: string } | null) =>
      setSelectedItemId(item?.id ?? null),
    onStatusChange: actions.handleStatusChange,
    onDeleteItem: handleDeleteItem,
    onEditItem: actions.handleUpdateItem,
    onAddNote: actions.handleAddNote,
    onDeleteNote: actions.handleDeleteNote,
    onStartSession: handleStartSession,
    onEndSession: actions.handleEndSession,
    onAbandonSession: actions.handleAbandonSession,
    onLinkResource: actions.handleLinkResource,
    onUnlinkResource: actions.handleUnlinkResource,
    onOpenTerminal,
    onCreateItem: actions.handleCreateItem,
    isQuickCaptureOpen,
    onOpenQuickCapture: handleOpenQuickCapture,
    onCloseQuickCapture: () => setIsQuickCaptureOpen(false),
    quickCaptureParentId,
    quickCaptureKind,
    nowMs,
    owner,
    plansMode,
    onPlansModeChange: handlePlansModeChange,
    isManualUnavailable: isUnavailable,
    manualError: error,
    hasManualData: overviewForSurface !== undefined,
  };
  return (
    <div
      className={cn(
        "flex flex-col w-full",
        variant === "window" ? "h-full min-h-0" : isOpen && !isCompact && "self-start",
      )}
    >
      {variant !== "window" && (
        <WorkflowContextRibbon
          target={filterTarget}
          triggerRef={workflowTriggerRef}
          activeNode={activeNode}
          runningSession={runningSession}
          attention={attention}
          isOpen={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onOpenQuickCapture={() => handleOpenQuickCapture("plan", null)}
          isLoading={isLoading}
          isUnavailable={isUnavailable}
          error={error}
          onRetry={() => refetch()}
          nowMs={nowMs}
        />
      )}

      {isCompact && variant !== "window" ? (
        <WorkflowContextSheet
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          onCloseAutoFocus={() =>
            restoreWorkflowFocus(workflowTriggerRef.current)
          }
          activeSegment={mobileSegment}
          onSegmentChange={setMobileSegment}
          {...sharedProps}
        />
      ) : (
        <WorkflowContextDeck
          variant={variant}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onCloseAutoFocus={() =>
            restoreWorkflowFocus(workflowTriggerRef.current)
          }
          {...sharedProps}
        />
      )}
    </div>
  );
}
