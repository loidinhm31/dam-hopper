import { useCallback, useEffect, useState } from "react";
import { X, Layers, FolderGit2, ListTodo, AlertCircle } from "lucide-react";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ProjectTargetRef } from "@/api/client.js";
import type {
  ItemDto,
  ItemKind,
  ItemOverviewNodeDto,
  ItemStatus,
  LinkDto,
  NoteDto,
  ProjectDto,
  ResourceLinkType,
  SessionDto,
} from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";
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
  onLinkResource?: (sessionId: string, req: { resourceType: ResourceLinkType; externalId: string; harnessLabel?: string; runId?: string }) => void;
  onUnlinkResource?: (sessionId: string, resourceType: ResourceLinkType, externalId: string) => void;
  onOpenTerminal?: (sessionId: string) => void;
  onCreateItem?: (item: { target: ProjectTargetRef; kind: ItemKind; title: string; summary?: string; status: ItemStatus; parentId?: string | null; startSessionImmediately?: boolean }) => Promise<void> | void;
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
}
export function WorkflowContextDeck({
  isOpen,
  onClose,
  onCloseAutoFocus,
  target,
  projects,
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
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const effectiveTarget = selectedTarget ?? target ?? { project: "default" };
  const rawRealTarget = selectedTarget ?? target ?? null;
  const realTarget =
    rawRealTarget && rawRealTarget.project && rawRealTarget.project !== "default"
      ? rawRealTarget
      : null;

  const dashboardKey = realTarget
    ? `${owner?.profileId ?? "none"}:${owner?.generation ?? 0}:${realTarget.project}:${realTarget.worktreePath ?? ""}`
    : "no-target";

  return (
    <section
      id="workflow-context-deck"
      role="region"
      aria-label="Workflow Context Deck"
      className="relative z-10 flex h-[min(70dvh,720px)] min-h-[320px] max-h-[720px] w-full flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 text-xs">
        <div className="flex items-center gap-3 font-medium text-[var(--color-text)]">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-[var(--color-primary)]" />
            <span>Workflow Deck</span>
            {effectiveTarget && (
              <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                {effectiveTarget.project}
              </span>
            )}
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
      </div>

      {/* File plans view */}
      {activeMode === "files" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {realTarget ? (
            <ProjectPlansDashboard
              key={dashboardKey}
              owner={owner}
              target={realTarget}
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
                Select a configured project or worktree to browse its <code className="bg-[var(--color-surface-2)] px-1 rounded">plans/</code> folder.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Manual tracking view (kept mounted to preserve drafts) */}
      <div
        className={cn(
          "grid flex-1 grid-cols-1 overflow-hidden p-3 gap-3 md:grid-cols-2 lg:grid-cols-[220px_1fr_300px]",
          activeMode !== "manual" && "hidden",
        )}
      >
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
        ) : manualError ? (
          <div
            role="alert"
            className="col-span-full flex flex-col items-center justify-center h-full p-6 text-center gap-2 text-xs text-[var(--color-danger)]"
          >
            <AlertCircle className="h-7 w-7 shrink-0" />
            <span className="font-medium">
              Manual workflow error: {typeof manualError === "string" ? manualError : manualError.message}
            </span>
          </div>
        ) : (
          <>
        <div className="hidden h-full overflow-hidden border-r border-[var(--color-border)]/60 pr-3 lg:block">
          <WorkflowProjectList
            projects={projects}
            selectedTarget={selectedTarget}
            onSelectTarget={onSelectTarget}
          />
        </div>

        <div className="h-full overflow-hidden border-r border-[var(--color-border)]/60 pr-3">
          {isQuickCaptureOpen && onCreateItem ? (
            <WorkflowQuickCapture
              target={effectiveTarget}
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
    </section>
  );
}
