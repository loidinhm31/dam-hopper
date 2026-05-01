import { useDraggable } from "@dnd-kit/core";
import { GripVertical, SplitSquareHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

// ─── DragItem schema ─────────────────────────────────────────────────────────

export interface DragItem {
  type: "terminal-tab";
  sessionId: string;
  sourcePaneId: string;
}

// ─── DraggableTab ─────────────────────────────────────────────────────────────

interface DraggableTabProps {
  paneId: string;
  tab: TabEntry;
  isActive: boolean;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}

function DraggableTab({ paneId, tab, isActive, onSelect, onClose }: DraggableTabProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab:${paneId}:${tab.sessionId}`,
    data: {
      type: "terminal-tab",
      sessionId: tab.sessionId,
      sourcePaneId: paneId,
    } satisfies DragItem,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center shrink-0 border-b-2 transition-colors select-none",
        isActive
          ? "border-[var(--color-primary)] text-[var(--color-text)]"
          : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        isDragging && "opacity-40",
      )}
    >
      {/* Drag handle — listeners here so click on label still fires onSelect */}
      <span
        className="pl-1.5 py-1.5 cursor-grab active:cursor-grabbing text-[var(--color-text-muted)] opacity-30 hover:opacity-70 transition-opacity"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="h-3 w-3" />
      </span>

      {/* Tab label / click to select */}
      <button
        type="button"
        className="px-1.5 py-1.5 text-xs whitespace-nowrap"
        onClick={() => onSelect(tab.sessionId)}
      >
        <span className="max-w-32 truncate block">{tab.label}</span>
      </button>

      {/* Close button */}
      <span
        role="button"
        aria-label="Close terminal"
        title="Close terminal (terminates process)"
        tabIndex={0}
        className="pr-2 py-1.5 opacity-40 hover:opacity-100 rounded hover:bg-[var(--color-danger)]/20 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.sessionId);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            onClose(tab.sessionId);
          }
        }}
      >
        <X className="h-2.5 w-2.5" />
      </span>
    </div>
  );
}

// ─── TabBar ───────────────────────────────────────────────────────────────────

export interface TabBarProps {
  paneId: string;
  paneTabs: TabEntry[];
  activeSessionId: string | null;
  hasSplit: boolean;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onSplitPane: () => void;
  onClosePane: () => void;
}

export function TabBar({
  paneId,
  paneTabs,
  activeSessionId,
  hasSplit,
  onSelectTab,
  onCloseTab,
  onSplitPane,
  onClosePane,
}: TabBarProps) {
  if (paneTabs.length === 0) return null;

  return (
    <div className="flex items-center shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      {/* Scrollable tab strip */}
      <div className="flex items-center overflow-x-auto min-w-0 flex-1">
        {paneTabs.map((tab) => (
          <DraggableTab
            key={tab.sessionId}
            paneId={paneId}
            tab={tab}
            isActive={tab.sessionId === activeSessionId}
            onSelect={onSelectTab}
            onClose={onCloseTab}
          />
        ))}
      </div>

      {/* Split pane button */}
      <button
        type="button"
        title="Split pane (Ctrl+Shift+5)"
        className="shrink-0 p-1.5 mr-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onSplitPane();
        }}
      >
        <SplitSquareHorizontal className="h-3.5 w-3.5" />
      </button>

      {/* Close pane button (only when multiple panes exist) */}
      {hasSplit && (
        <button
          type="button"
          title="Close pane"
          className="shrink-0 p-1.5 mr-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onClosePane();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
