import { useState } from "react";
import { FolderGit2, ListTodo, Activity, ChevronUp, ChevronDown, Layers, AlertCircle } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog.js";
import { WorkflowExecutionList } from "@/components/molecules/WorkflowExecutionList.js";
import { WorkflowItemList } from "@/components/molecules/WorkflowItemList.js";
import { WorkflowProjectList } from "@/components/molecules/WorkflowProjectList.js";
import { WorkflowQuickCapture } from "@/components/molecules/WorkflowQuickCapture.js";
import { cn } from "@/lib/utils.js";
import { ProjectPlansDashboard } from "./ProjectPlansDashboard.js";
import type { WorkflowPlansMode } from "./WorkflowContextDeck.js";

export type MobileWorkflowSegment = "projects" | "items" | "execution";

export interface WorkflowContextSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: () => void;
  target?: ProjectTargetRef | null;
  projects: ProjectDto[];
  plans: ItemOverviewNodeDto[];
  standaloneTasks: ItemOverviewNodeDto[];
  sessions: SessionDto[];
  links?: Record<string, LinkDto[]>;
  selectedItemId?: string | null;
  selectedTarget?: ProjectTargetRef | null;
  activeSegment?: MobileWorkflowSegment;
  onSegmentChange?: (segment: MobileWorkflowSegment) => void;
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
export function WorkflowContextSheet({
  isOpen,
  onOpenChange,
  onCloseAutoFocus,
  target,
  projects,
  plans,
  standaloneTasks,
  sessions,
  links,
  selectedItemId,
  selectedTarget,
  activeSegment: controlledSegment,
  onSegmentChange,
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
}: WorkflowContextSheetProps) {
  const [localSegment, setLocalSegment] = useState<MobileWorkflowSegment>("items");
  const [isExpanded, setIsExpanded] = useState(false);
  const [localPlansMode, setLocalPlansMode] = useState<WorkflowPlansMode>(
    isManualUnavailable ? "files" : "manual",
  );
  const plansMode = controlledPlansMode ?? localPlansMode;
  const handlePlansModeChange = (mode: WorkflowPlansMode) => {
    setLocalPlansMode(mode);
    onPlansModeChange?.(mode);
  };
  const segment = controlledSegment ?? localSegment;
  const setSegment = (s: MobileWorkflowSegment) => {
    setLocalSegment(s);
    onSegmentChange?.(s);
  };
  const effectiveTarget = selectedTarget ?? target ?? { project: "default" };

  const segments = [
    { id: "projects" as const, label: "Projects", icon: FolderGit2 },
    { id: "items" as const, label: "Plans", icon: ListTodo },
    { id: "execution" as const, label: "Execution", icon: Activity },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus?.();
        }}
        className={cn(
          "fixed bottom-0 left-0 right-0 top-auto z-50 flex flex-col rounded-t-xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-0 shadow-2xl transition-all duration-300",
          "w-full max-w-none translate-x-0 translate-y-0 safe-area-bottom",
          isExpanded || (segment === "items" && plansMode === "files") ? "h-[90dvh]" : "h-[35dvh]",
        )}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex h-6 w-full shrink-0 items-center justify-center cursor-pointer select-none pt-1"
          aria-label={isExpanded ? "Collapse sheet to 35%" : "Expand sheet to 90%"}
        >
          <div className="h-1.5 w-10 rounded-full bg-[var(--color-border)]" />
        </div>

        <DialogHeader className="px-4 pb-2 text-left">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-semibold text-[var(--color-text)]">Workflow Context</DialogTitle>
            <button type="button" onClick={() => setIsExpanded((prev) => !prev)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
          <DialogDescription className="sr-only">Workflow context, plans, tasks, and work sessions.</DialogDescription>

          <div className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-[var(--color-surface-2)] p-1 text-xs font-medium">
            {segments.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSegment(id)}
                className={cn(
                  "flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded transition-colors cursor-pointer",
                  segment === id ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-xs font-semibold" : "text-[var(--color-text-muted)]",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-4 pb-3">
          {segment === "projects" && (
            <WorkflowProjectList projects={projects} selectedTarget={selectedTarget} onSelectTarget={(t) => { onSelectTarget(t); setSegment("items"); }} />
          )}
          {segment === "items" && (
            <div className="flex flex-col h-full min-h-0">
              {/* Mode switch for mobile Plans segment */}
              <div
                role="tablist"
                aria-label="Plans source mode"
                className="flex items-center gap-1 rounded bg-[var(--color-surface-2)] p-0.5 text-xs mb-2 shrink-0"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={plansMode === "files"}
                  onClick={() => handlePlansModeChange("files")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded py-1 font-medium transition-colors cursor-pointer",
                    plansMode === "files"
                      ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-xs"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                  )}
                >
                  <FolderGit2 className="h-3.5 w-3.5" />
                  <span>File plans</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={plansMode === "manual"}
                  onClick={() => handlePlansModeChange("manual")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded py-1 font-medium transition-colors cursor-pointer",
                    plansMode === "manual"
                      ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-xs"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                  )}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                  <span>Manual tracking</span>
                </button>
              </div>

              {/* File plans tab */}
              {plansMode === "files" && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  {effectiveTarget && effectiveTarget.project && effectiveTarget.project !== "default" ? (
                    <ProjectPlansDashboard
                      key={`${owner?.profileId ?? "none"}:${owner?.generation ?? 0}:${effectiveTarget.project}:${effectiveTarget.worktreePath ?? ""}`}
                      owner={owner}
                      target={effectiveTarget}
                      enabled={isOpen && segment === "items" && plansMode === "files"}
                    />
                  ) : (
                    <div
                      role="status"
                      className="flex flex-col items-center justify-center h-full p-4 text-center gap-2 text-xs text-[var(--color-text-muted)]"
                    >
                      <FolderGit2 className="h-7 w-7 opacity-60" />
                      <span className="font-medium text-[var(--color-text)]">
                        No configured project selected
                      </span>
                      <p className="max-w-xs">
                        Select a configured project from the Projects tab to browse file plans.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Manual tracking tab (kept mounted to preserve drafts) */}
              <div className={cn("flex-1 min-h-0 overflow-hidden", plansMode !== "manual" && "hidden")}>
                {isManualUnavailable ? (
                  <div
                    role="status"
                    className="flex flex-col items-center justify-center h-full p-4 text-center gap-2 text-xs text-[var(--color-text-muted)]"
                  >
                    <Layers className="h-7 w-7 opacity-60" />
                    <span className="font-medium text-[var(--color-text)]">
                      Manual workflow tracking is unavailable for this profile.
                    </span>
                  </div>
                ) : manualError ? (
                  <div
                    role="alert"
                    className="flex flex-col items-center justify-center h-full p-4 text-center gap-2 text-xs text-[var(--color-danger)]"
                  >
                    <AlertCircle className="h-7 w-7 shrink-0" />
                    <span className="font-medium">
                      Manual workflow error: {typeof manualError === "string" ? manualError : manualError.message}
                    </span>
                  </div>
                ) : isQuickCaptureOpen && onCreateItem ? (
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
            </div>
          )}
          {segment === "execution" && (
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
