import { useEffect, useRef, useState } from "react";
import type { ProjectTargetRef } from "@/api/client.js";
import type { ItemDto, ItemKind } from "@/api/workflow-dto-types.js";
import { useWorkflowOverview } from "@/api/workflow-queries.js";
import {
  filterOverviewByTarget,
  selectActivePlanOrItem,
  selectAttentionSummary,
  selectRunningSessionForItem,
} from "@/api/workflow-selectors.js";
import { WorkflowContextRibbon } from "@/components/molecules/WorkflowContextRibbon.js";
import { WorkflowContextDeck } from "@/components/organisms/WorkflowContextDeck.js";
import {
  WorkflowContextSheet,
  type MobileWorkflowSegment,
} from "@/components/organisms/WorkflowContextSheet.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { useWorkflowSurfaceActions } from "@/hooks/use-workflow-surface-actions.js";
import { cn } from "@/lib/utils.js";
import {
  isWorkflowShortcutOwner,
  matchesWorkflowToggleShortcut,
  restoreWorkflowFocus,
} from "@/lib/workflow-focus.js";

export interface WorkflowContextSurfaceProps {
  target?: ProjectTargetRef | null;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenTerminal?: (sessionId: string) => void;
  onSelectTarget?: (target: ProjectTargetRef) => void;
}

export function WorkflowContextSurface({
  target,
  isOpen: controlledIsOpen,
  onOpenChange,
  onOpenTerminal,
  onSelectTarget,
}: WorkflowContextSurfaceProps) {
  const isCompact = useCompactWorkspace();
  const [localIsOpen, setLocalIsOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<ProjectTargetRef | null>(target ?? null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const workflowTriggerRef = useRef<HTMLDivElement | null>(null);
  const [quickCaptureKind, setQuickCaptureKind] = useState<ItemKind>("plan");
  const [quickCaptureParentId, setQuickCaptureParentId] = useState<string | null>(null);
  const [mobileSegment, setMobileSegment] = useState<MobileWorkflowSegment>("items");
  const [nowMs, setNowMs] = useState(Date.now());
  const isOpen = controlledIsOpen ?? localIsOpen;
  const setIsOpen = (open: boolean) => {
    setLocalIsOpen(open);
    onOpenChange?.(open);
  };

  const {
    data: overview,
    isLoading,
    error,
    refetch,
    isUnavailable,
  } = useWorkflowOverview();
  const effectiveTarget = selectedTarget ?? target ?? { project: "default" };
  const actions = useWorkflowSurfaceActions(effectiveTarget);
  const overviewForSurface = isUnavailable ? undefined : overview;

  const { plans, standaloneTasks } = filterOverviewByTarget(
    overviewForSurface,
    effectiveTarget,
  );
  const activeNode = selectActivePlanOrItem(
    overviewForSurface,
    effectiveTarget,
  );
  const runningSession = selectRunningSessionForItem(activeNode);
  const attention = selectAttentionSummary(
    overviewForSurface,
    effectiveTarget,
  );
  useEffect(() => {
    if (!isUnavailable) return;
    setLocalIsOpen(false);
    setSelectedItemId(null);
    setIsQuickCaptureOpen(false);
    setMobileSegment("items");
  }, [isUnavailable]);

  useEffect(() => {
    setSelectedTarget(target ?? null);
  }, [target?.project, target?.worktreePath]);

  const handleSelectTarget = (nextTarget: ProjectTargetRef | null) => {
    setSelectedTarget(nextTarget);
    if (nextTarget) {
      onSelectTarget?.(nextTarget);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesWorkflowToggleShortcut(e) && isWorkflowShortcutOwner(e.target)) {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!attention.hasRunningSessions) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) {
        setNowMs(Date.now());
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [attention.hasRunningSessions]);

  const handleOpenQuickCapture = (kind: ItemKind = "plan", parentId: string | null = null) => {
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

  const sharedProps = {
    target: effectiveTarget,
    projects: overviewForSurface?.projects ?? [],
    plans,
    standaloneTasks,
    sessions: overviewForSurface?.runningSessions ?? [],
    selectedItemId,
    selectedTarget,
    onSelectTarget: handleSelectTarget,
    onSelectItem: (item: { id: string } | null) => setSelectedItemId(item?.id ?? null),
    onStatusChange: actions.handleStatusChange,
    onDeleteItem: handleDeleteItem,
    onEditItem: actions.handleUpdateItem,
    onAddNote: actions.handleAddNote,
    onDeleteNote: actions.handleDeleteNote,
    onStartSession: actions.handleStartSession,
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
  };

  return (
    <div
      className={cn(
        "flex flex-col w-full",
        isOpen && !isCompact && "self-start",
      )}
    >
      <WorkflowContextRibbon
        target={effectiveTarget}
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

      {!isUnavailable &&
        (isCompact ? (
          <WorkflowContextSheet
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            onCloseAutoFocus={() => restoreWorkflowFocus(workflowTriggerRef.current)}
            activeSegment={mobileSegment}
            onSegmentChange={setMobileSegment}
            {...sharedProps}
          />
        ) : (
          <WorkflowContextDeck
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            onCloseAutoFocus={() => restoreWorkflowFocus(workflowTriggerRef.current)}
            {...sharedProps}
          />
        ))}
    </div>
  );
}
