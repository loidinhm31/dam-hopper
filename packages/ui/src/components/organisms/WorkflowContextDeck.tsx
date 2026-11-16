import { useCallback, useEffect, useState } from "react";
import { X, Layers, FolderGit2, ListTodo, AlertCircle } from "lucide-react";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ProjectTargetRef } from "@/api/client.js";
import {
  formatWorkflowTargetLabel,
  GLOBAL_WORKSPACE_PROJECT,
  type ItemDto,
  type ItemKind,
  type ItemOverviewNodeDto,
  type ItemStatus,
  type LinkDto,
  type NoteDto,
  type ProjectDto,
  type ResourceLinkType,
  type SessionDto,
} from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { WorkflowExecutionList } from "@/components/molecules/WorkflowExecutionList.js";
import { WorkflowItemList } from "@/components/molecules/WorkflowItemList.js";
import { WorkflowProjectList } from "@/components/molecules/WorkflowProjectList.js";
import { WorkflowQuickCapture } from "@/components/molecules/WorkflowQuickCapture.js";
import { cn } from "@/lib/utils.js";
import { ProjectPlansDashboard } from "./ProjectPlansDashboard.js";

export type WorkflowPlansMode = "files" | "manual";

export interface WorkflowContextDeckProps {
  isOpen: boolean;
  onClose: () => void;
  onCloseAutoFocus?: () => void;
  target?: ProjectTargetRef | null;
  projects: ProjectDto[];
  configuredProjects?: Array<{ name: string }>;
  variant?: "deck" | "window";
  mutationTarget?: ProjectTargetRef;
  quickCaptureTarget?: ProjectTargetRef;
  targetOptions?: ProjectTargetRef[];
  plans: ItemOverviewNodeDto[];
  standaloneTasks: ItemOverviewNodeDto[];
  sessions: SessionDto[];
  links?: Record<string, LinkDto[]>;
  selectedItemId?: string | null;
  selectedTarget?: ProjectTargetRef | null;
  onSelectTarget: (target: ProjectTargetRef | null) => void;
  onSelectItem: (item: ItemDto | null) => void;
  onStatusChange?: (item: ItemDto, status: ItemStatus) => void;
  onDeleteItem?: (item: ItemDto) => void;
  onEditItem?: (
    item: ItemDto,
    updates: { title?: string; summary?: string | null },
  ) => Promise<unknown> | void;
  onAddNote?: (itemId: string, note: string) => void;
  onDeleteNote?: (note: NoteDto) => Promise<unknown> | void;
  onStartSession?: (startedAt: string, itemId?: string | null) => void;
  onEndSession?: (sessionId: string, endedAt: string) => void;
  onAbandonSession?: (sessionId: string) => void;
  onLinkResource?: (
    sessionId: string,
    req: {
      resourceType: ResourceLinkType;
      externalId: string;
      harnessLabel?: string;
      runId?: string;
    },
  ) => void;
  onUnlinkResource?: (
    sessionId: string,
    resourceType: ResourceLinkType,
    externalId: string,
  ) => void;
  onOpenTerminal?: (sessionId: string) => void;
  onCreateItem?: (item: {
    target: ProjectTargetRef;
    kind: ItemKind;
    title: string;
    summary?: string;
    status: ItemStatus;
    parentId?: string | null;
    startSessionImmediately?: boolean;
  }) => Promise<void> | void;
  isQuickCaptureOpen?: boolean;
  onOpenQuickCapture?: (kind?: ItemKind, parentId?: string | null) => void;
  onCloseQuickCapture?: () => void;
  quickCaptureParentId?: string | null;
  quickCaptureKind?: ItemKind;
  nowMs?: number;
  owner?: ConnectionRef | null;
  plansMode?: WorkflowPlansMode;
  onPlansModeChange?: (mode: WorkflowPlansMode) => void;
  isManualUnavailable?: boolean;
  manualError?: Error | string | null;
  hasManualData?: boolean;
}
export function WorkflowContextDeck({
  isOpen,
  onClose,
  onCloseAutoFocus,
  target,
  projects,
  configuredProjects = [],
  variant = "deck",
  mutationTarget,
  quickCaptureTarget,
  targetOptions,
  plans,
  standaloneTasks,
  sessions,
  links,
  selectedItemId,
  selectedTarget,
  onSelectTarget,
  onSelectItem,
  onStatusChange,
  onDeleteItem,
  onEditItem,
  onAddNote,
  onDeleteNote,
  onStartSession,
  onEndSession,
  onAbandonSession,
  onLinkResource,
  onUnlinkResource,
  onOpenTerminal,
  onCreateItem,
  isQuickCaptureOpen = false,
  onOpenQuickCapture,
  onCloseQuickCapture,
  quickCaptureParentId = null,
  quickCaptureKind = "plan",
  nowMs,
  owner,
  plansMode: controlledPlansMode,
  onPlansModeChange,
  isManualUnavailable = false,
  manualError = null,
  hasManualData = false,
}: WorkflowContextDeckProps) {
  const [localPlansMode, setLocalPlansMode] = useState<WorkflowPlansMode>(
    isManualUnavailable ? "files" : "manual",
  );
  const activeMode = controlledPlansMode ?? localPlansMode;
  const handleModeChange = (mode: WorkflowPlansMode) => {
    setLocalPlansMode(mode);
    onPlansModeChange?.(mode);
  };
  const handleClose = useCallback(() => {
    onCloseAutoFocus?.();
    onClose();
  }, [onClose, onCloseAutoFocus]);

  useEffect(() => {
    if (!isOpen || variant === "window") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, variant, handleClose]);

  if (!isOpen) return null;

  const displayTarget =
    selectedTarget !== undefined ? selectedTarget : (target ?? null);
  const effectiveTarget =
    mutationTarget ??
    (displayTarget && displayTarget.project !== "default"
      ? displayTarget
      : { project: "default" });
  const realTarget =
    displayTarget &&
    displayTarget.project &&
    displayTarget.project !== "default"
      ? displayTarget
      : null;
  const effectiveFileTarget =
    realTarget ??
    (variant === "window"
      ? {
          ...(owner?.profileId ? { profileId: owner.profileId } : {}),
          project: GLOBAL_WORKSPACE_PROJECT,
        }
      : null);

  const dashboardKey = effectiveFileTarget
    ? `${owner?.profileId ?? "none"}:${owner?.generation ?? 0}:${effectiveFileTarget.project}:${effectiveFileTarget.worktreePath ?? ""}`
    : "no-target";

  const showSpaceSidebarInFiles =
    variant === "window" || configuredProjects.length > 0;

  const compactSpaceSelectValue =
    displayTarget === null
      ? "__all__"
      : displayTarget.project;

  const compactProjectNames = Array.from(
    new Set([
      ...configuredProjects.map((c) => c.name),
      ...projects
        .map((p) => p.project)
        .filter((name) => name !== GLOBAL_WORKSPACE_PROJECT),
    ]),
  );

  return (
    <section
      id="workflow-context-deck"
      role="region"
      aria-label="Workflow Context Deck"
      className={cn(
        "relative z-10 flex w-full flex-col bg-[var(--color-surface)]",
        variant === "window"
          ? "h-full"
          : "h-[min(70dvh,720px)] min-h-[320px] max-h-[720px] border-b border-[var(--color-border)] shadow-lg",
      )}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 text-xs">
        <div className="flex items-center gap-3 font-medium text-[var(--color-text)] min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
            <span className="truncate">
              {variant === "window" ? "Workflow & Plans" : "Workflow Deck"}
            </span>
            <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] truncate max-w-[140px]">
              {formatWorkflowTargetLabel(displayTarget)}
            </span>
          </div>

          <div
            role="tablist"
            aria-label="Plans source mode"
            className="flex items-center gap-1 rounded bg-[var(--color-surface-2)] p-0.5 text-[11px]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "files"}
              onClick={() => handleModeChange("files")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors",
                activeMode === "files"
                  ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-xs"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              )}
            >
              <FolderGit2 className="h-3 w-3" />
              <span>File plans</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "manual"}
              onClick={() => handleModeChange("manual")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors",
                activeMode === "manual"
                  ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-xs"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              )}
            >
              <ListTodo className="h-3 w-3" />
              <span>Manual tracking</span>
            </button>
          </div>
        </div>
        {variant !== "window" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            aria-label="Close workflow deck"
            className="h-6 w-6 p-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Compact space switcher for narrow / floating windows (< lg) */}
      {(variant === "window" || configuredProjects.length > 0) && (
        <div className="flex lg:hidden shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 bg-[var(--color-surface-2)]/30 text-xs">
          <span className="text-[11px] font-medium text-[var(--color-text-muted)] shrink-0">
            Space:
          </span>
          <Select
            value={
              activeMode === "files" && compactSpaceSelectValue === "__all__"
                ? GLOBAL_WORKSPACE_PROJECT
                : compactSpaceSelectValue
            }
            onValueChange={(val) => {
              if (val === "__all__") {
                onSelectTarget(null);
              } else {
                onSelectTarget({ project: val });
              }
            }}
          >
            <SelectTrigger className="h-7 text-xs flex-1 max-w-[260px]" aria-label="Select workflow space">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeMode === "manual" && (
                <SelectItem value="__all__">All Projects</SelectItem>
              )}
              <SelectItem value={GLOBAL_WORKSPACE_PROJECT}>
                General (Global Workspace)
              </SelectItem>
              {compactProjectNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* File plans view (kept mounted to preserve state) */}
      <div
        className={cn(
          "flex-1 min-h-0 overflow-hidden",
          showSpaceSidebarInFiles && "flex gap-3 p-3",
          activeMode !== "files" && "hidden",
        )}
      >
        {showSpaceSidebarInFiles && (
          <div className="hidden lg:block w-[220px] shrink-0 h-full overflow-hidden border-r border-[var(--color-border)]/60 pr-3">
            <WorkflowProjectList
              projects={projects}
              configuredProjects={configuredProjects}
              selectedTarget={effectiveFileTarget}
              onSelectTarget={onSelectTarget}
              showAllOption={false}
            />
          </div>
        )}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          {effectiveFileTarget ? (
            <ProjectPlansDashboard
              key={dashboardKey}
              owner={owner}
              target={effectiveFileTarget}
              enabled={isOpen && activeMode === "files"}
            />
          ) : (
            <div
              role="status"
              className="flex flex-col items-center justify-center h-full p-6 text-center gap-2 text-xs text-[var(--color-text-muted)]"
            >
              <FolderGit2 className="h-7 w-7 opacity-60" />
              <span className="font-medium text-[var(--color-text)]">
                No configured project selected
              </span>
              <p className="max-w-sm">
                Select a configured project or worktree to browse its{" "}
                <code className="bg-[var(--color-surface-2)] px-1 rounded">
                  plans/
                </code>{" "}
                folder.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Manual tracking view (kept mounted to preserve drafts) */}
      <div
        className={cn(
          "flex flex-col flex-1 min-h-0 overflow-hidden p-3 gap-3",
          activeMode !== "manual" && "hidden",
        )}
      >
        {manualError && hasManualData && !isManualUnavailable && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-danger)]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              Manual workflow refresh failed:{" "}
              {typeof manualError === "string"
                ? manualError
                : manualError.message}
              . Showing previously loaded data; unsaved drafts are preserved.
            </span>
          </div>
        )}
        <div className="grid flex-1 min-h-0 grid-cols-1 overflow-hidden gap-3 md:grid-cols-2 lg:grid-cols-[220px_1fr_300px]">
          {isManualUnavailable ? (
            <div
              role="status"
              className="col-span-full flex flex-col items-center justify-center h-full p-6 text-center gap-2 text-xs text-[var(--color-text-muted)]"
            >
              <Layers className="h-7 w-7 opacity-60" />
              <span className="font-medium text-[var(--color-text)]">
                Manual workflow tracking is unavailable for this profile.
              </span>
            </div>
          ) : manualError && !hasManualData ? (
            <div
              role="alert"
              className="col-span-full flex flex-col items-center justify-center h-full p-6 text-center gap-2 text-xs text-[var(--color-danger)]"
            >
              <AlertCircle className="h-7 w-7 shrink-0" />
              <span className="font-medium">
                Manual workflow error:{" "}
                {typeof manualError === "string"
                  ? manualError
                  : manualError.message}
              </span>
            </div>
          ) : (
            <>
              <div className="hidden h-full overflow-hidden border-r border-[var(--color-border)]/60 pr-3 lg:block">
                <WorkflowProjectList
                  projects={projects}
                  configuredProjects={configuredProjects}
                  selectedTarget={displayTarget}
                  onSelectTarget={onSelectTarget}
                />
              </div>

              <div className="h-full overflow-hidden border-r border-[var(--color-border)]/60 pr-3">
                {isQuickCaptureOpen && onCreateItem ? (
                  <WorkflowQuickCapture
                    target={quickCaptureTarget ?? effectiveTarget}
                    targetOptions={quickCaptureParentId ? undefined : targetOptions}
                    initialKind={quickCaptureKind}
                    initialParentId={quickCaptureParentId}
                    onSubmit={async (item) => {
                      await onCreateItem(item);
                      onCloseQuickCapture?.();
                    }}
                    onCancel={onCloseQuickCapture}
                  />
                ) : (
                  <WorkflowItemList
                    plans={plans}
                    standaloneTasks={standaloneTasks}
                    selectedItemId={selectedItemId}
                    onSelectItem={onSelectItem}
                    onStatusChange={onStatusChange}
                    onDeleteItem={onDeleteItem}
                    onEditItem={onEditItem}
                    onAddNote={onAddNote}
                    onDeleteNote={onDeleteNote}
                    onOpenQuickCapture={onOpenQuickCapture}
                  />
                )}
              </div>

              <div className="h-full overflow-hidden">
                <WorkflowExecutionList
                  sessions={sessions}
                  links={links}
                  nowMs={nowMs}
                  selectedItemId={selectedItemId}
                  onStartSession={onStartSession}
                  onEndSession={onEndSession}
                  onAbandonSession={onAbandonSession}
                  onLinkResource={onLinkResource}
                  onUnlinkResource={onUnlinkResource}
                  onOpenTerminal={onOpenTerminal}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
