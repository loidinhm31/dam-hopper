import { useDraggable } from "@dnd-kit/core";
import { GripVertical, SplitSquareHorizontal, SplitSquareVertical, X, Plus } from "lucide-react";
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
          ? "border-[var(--color-primary)] text-[var(--color-text)] bg-[var(--color-background)]"
          : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
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
        <span className="max-w-32 truncate block font-mono">{tab.label}</span>
      </button>

      {/* Close button */}
      <span
        role="button"
        aria-label="Close terminal"
        title="Close terminal (terminates process)"
        tabIndex={0}
        className="pr-2 py-1.5 opacity-40 hover:opacity-100 rounded transition-opacity"
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
        <X className="h-2.5 w-2.5 hover:text-[var(--color-danger)]" />
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
  onNewTerminal: () => void;
  onSplitPaneHorizontal: () => void;
  onSplitPaneVertical: () => void;
  onClosePane: () => void;
}

export function TabBar({
  paneId,
  paneTabs,
  activeSessionId,
  hasSplit,
  onSelectTab,
  onCloseTab,
  onNewTerminal,
  onSplitPaneHorizontal,
  onSplitPaneVertical,
  onClosePane,
}: TabBarProps) {
  return (
    <div className="flex items-center shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden h-8">
      {/* Scrollable tab strip */}
      <div className="flex items-center overflow-x-auto min-w-0 flex-1 scrollbar-hide h-full">
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

        {/* New Terminal Button in Tab Strip */}
        <button
          type="button"
          title="New Terminal"
          className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors shrink-0 h-full flex items-center"
          onClick={(e) => {
            e.stopPropagation();
            onNewTerminal();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center px-1 border-l border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Split Horizontal Button */}
        <button
          type="button"
          title="Split Right (Ctrl+Shift+5)"
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onSplitPaneVertical();
          }}
        >
          <SplitSquareHorizontal className="h-3.5 w-3.5" />
        </button>

        {/* Split Vertical Button */}
        <button
          type="button"
          title="Split Down"
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onSplitPaneHorizontal();
          }}
        >
          <SplitSquareVertical className="h-3.5 w-3.5" />
        </button>

        {/* Close pane button (only when multiple panes exist) */}
        {hasSplit && (
          <button
            type="button"
            title="Close pane"
            className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onClosePane();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
