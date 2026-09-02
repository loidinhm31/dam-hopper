import { useState } from "react";
import { FolderGit2, ListTodo, Activity, ChevronUp, ChevronDown } from "lucide-react";
import type { ProjectTargetRef } from "@/api/client.js";
import type {
  ItemDto,
  ItemKind,
  ItemOverviewNodeDto,
  ItemStatus,
  LinkDto,
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

export type MobileWorkflowSegment = "projects" | "items" | "execution";

export interface WorkflowContextSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
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
  onAddNote?: (itemId: string, note: string) => void;
  onStartSession?: (startedAt: string, itemId?: string | null) => void;
  onEndSession?: (sessionId: string, endedAt: string) => void;
  onAbandonSession?: (sessionId: string) => void;
  onLinkResource?: (sessionId: string, req: { resourceType: ResourceLinkType; externalId: string; harnessLabel?: string; runId?: string }) => void;
  onUnlinkResource?: (sessionId: string, resourceType: ResourceLinkType, externalId: string) => void;
  onCreateItem?: (item: { target: ProjectTargetRef; kind: ItemKind; title: string; summary?: string; status: ItemStatus; parentId?: string | null; startSessionImmediately?: boolean }) => Promise<void> | void;
  isQuickCaptureOpen?: boolean;
  onOpenQuickCapture?: (kind?: ItemKind, parentId?: string | null) => void;
  onCloseQuickCapture?: () => void;
  quickCaptureParentId?: string | null;
  quickCaptureKind?: ItemKind;
  nowMs?: number;
}

export function WorkflowContextSheet({
  isOpen,
  onOpenChange,
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
  onAddNote,
  onStartSession,
  onEndSession,
  onAbandonSession,
  onLinkResource,
  onUnlinkResource,
  onCreateItem,
  isQuickCaptureOpen = false,
  onOpenQuickCapture,
  onCloseQuickCapture,
  quickCaptureParentId = null,
  quickCaptureKind = "plan",
  nowMs,
}: WorkflowContextSheetProps) {
  const [localSegment, setLocalSegment] = useState<MobileWorkflowSegment>("items");
  const [isExpanded, setIsExpanded] = useState(false);
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
        className={cn(
          "fixed bottom-0 left-0 right-0 top-auto z-50 flex flex-col rounded-t-xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-0 shadow-2xl transition-all duration-300",
          "w-full max-w-none translate-x-0 translate-y-0 safe-area-bottom",
          isExpanded ? "h-[90dvh]" : "h-[35dvh]",
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
            isQuickCaptureOpen && onCreateItem ? (
              <WorkflowQuickCapture
                target={effectiveTarget}
                initialKind={quickCaptureKind}
                initialParentId={quickCaptureParentId}
                onSubmit={async (item) => { await onCreateItem(item); onCloseQuickCapture?.(); }}
                onCancel={onCloseQuickCapture}
              />
            ) : (
              <WorkflowItemList
                plans={plans}
                standaloneTasks={standaloneTasks}
                selectedItemId={selectedItemId}
                onSelectItem={onSelectItem}
                onStatusChange={onStatusChange}
                onAddNote={onAddNote}
                onOpenQuickCapture={onOpenQuickCapture}
              />
            )
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
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
