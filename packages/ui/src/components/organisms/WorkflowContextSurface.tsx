import { useEffect, useState } from "react";
import type { ProjectTargetRef } from "@/api/client.js";
import type { ItemKind } from "@/api/workflow-dto-types.js";
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
import { isWorkflowShortcutOwner, matchesWorkflowToggleShortcut } from "@/lib/workflow-focus.js";

export interface WorkflowContextSurfaceProps {
  target?: ProjectTargetRef | null;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function WorkflowContextSurface({
  target,
  isOpen: controlledIsOpen,
  onOpenChange,
}: WorkflowContextSurfaceProps) {
  const isCompact = useCompactWorkspace();
  const [localIsOpen, setLocalIsOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<ProjectTargetRef | null>(target ?? null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const [quickCaptureKind, setQuickCaptureKind] = useState<ItemKind>("plan");
  const [quickCaptureParentId, setQuickCaptureParentId] = useState<string | null>(null);
  const [mobileSegment, setMobileSegment] = useState<MobileWorkflowSegment>("items");
  const [nowMs, setNowMs] = useState(Date.now());
  const isOpen = controlledIsOpen ?? localIsOpen;
  const setIsOpen = (open: boolean) => {
    setLocalIsOpen(open);
    onOpenChange?.(open);
  };

  const { data: overview, isLoading, error, refetch } = useWorkflowOverview();
  const effectiveTarget = selectedTarget ?? target ?? { project: "default" };
  const actions = useWorkflowSurfaceActions(effectiveTarget);

  const { plans, standaloneTasks } = filterOverviewByTarget(overview, effectiveTarget);
  const activeNode = selectActivePlanOrItem(overview, effectiveTarget);
  const runningSession = selectRunningSessionForItem(activeNode);
  const attention = selectAttentionSummary(overview, effectiveTarget);

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

  const sharedProps = {
    target: effectiveTarget,
    projects: overview?.projects ?? [],
    plans,
    standaloneTasks,
    sessions: overview?.runningSessions ?? [],
    selectedItemId,
    selectedTarget,
    onSelectTarget: setSelectedTarget,
    onSelectItem: (item: { id: string } | null) => setSelectedItemId(item?.id ?? null),
    onStatusChange: actions.handleStatusChange,
    onAddNote: actions.handleAddNote,
    onStartSession: actions.handleStartSession,
    onEndSession: actions.handleEndSession,
    onAbandonSession: actions.handleAbandonSession,
    onLinkResource: actions.handleLinkResource,
    onUnlinkResource: actions.handleUnlinkResource,
    onCreateItem: actions.handleCreateItem,
    isQuickCaptureOpen,
    onOpenQuickCapture: handleOpenQuickCapture,
    onCloseQuickCapture: () => setIsQuickCaptureOpen(false),
    quickCaptureParentId,
    quickCaptureKind,
    nowMs,
  };

  return (
    <div className="flex flex-col w-full">
      <WorkflowContextRibbon
        target={effectiveTarget}
        activeNode={activeNode}
        runningSession={runningSession}
        attention={attention}
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
        onOpenQuickCapture={() => handleOpenQuickCapture("plan", null)}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        nowMs={nowMs}
      />

      {isCompact ? (
        <WorkflowContextSheet
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          activeSegment={mobileSegment}
          onSegmentChange={setMobileSegment}
          {...sharedProps}
        />
      ) : (
        <WorkflowContextDeck
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          {...sharedProps}
        />
      )}
    </div>
  );
}
