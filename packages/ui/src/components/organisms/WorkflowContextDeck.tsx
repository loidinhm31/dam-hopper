import { useCallback, useEffect, type ReactNode } from "react";
import { X, Layers } from "lucide-react";
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
import { Button } from "@/components/atoms/Button.js";
import { WorkflowExecutionList } from "@/components/molecules/WorkflowExecutionList.js";
import { WorkflowItemList } from "@/components/molecules/WorkflowItemList.js";
import { WorkflowProjectList } from "@/components/molecules/WorkflowProjectList.js";
import { WorkflowQuickCapture } from "@/components/molecules/WorkflowQuickCapture.js";

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
  onAddNote?: (itemId: string, note: string) => void;
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
  onAddNote,
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
}: WorkflowContextDeckProps) {
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

  return (
    <section
      id="workflow-context-deck"
      role="region"
      aria-label="Workflow Context Deck"
      className="relative z-10 flex h-[360px] min-h-[320px] max-h-[440px] w-full flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
    >
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-[var(--color-text)]">
          <Layers className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          <span>Workflow Deck</span>
          {effectiveTarget && (
            <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
              {effectiveTarget.project}
            </span>
          )}
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

      <div className="grid flex-1 grid-cols-1 overflow-hidden p-3 gap-3 md:grid-cols-2 lg:grid-cols-[220px_1fr_300px]">
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
              onAddNote={onAddNote}
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
      </div>
    </section>
  );
}
