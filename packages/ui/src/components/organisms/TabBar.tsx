import { Fragment, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import {
  GripVertical,
  Pin,
  PinOff,
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { TerminalActivityIndicator } from "@/components/atoms/TerminalActivityIndicator.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import {
  openTerminalDiagnosticsContextMenu,
  type TerminalDiagnosticsMenuHandler,
} from "@/components/organisms/TerminalDiagnosticsContextMenu.js";
import { TerminalTabInsertionZone } from "@/components/organisms/TerminalTabInsertionZone.js";
import { TerminalCommitStatusChip } from "@/components/organisms/TerminalCommitStatusChip.js";

export function splitActionToPaneDirection(action: "right" | "down") {
  return action === "right" ? "horizontal" : "vertical";
}

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
  onTogglePin?: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
}

export function DraggableTab({
  paneId,
  tab,
  isActive,
  onSelect,
  onTogglePin,
  onClose,
  onOpenDiagnosticsMenu,
}: DraggableTabProps) {
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
        className="flex items-center gap-1.5 px-1.5 py-1.5 text-xs whitespace-nowrap"
        onClick={() => onSelect(tab.sessionId)}
        onContextMenu={(event) =>
          openTerminalDiagnosticsContextMenu(
            event,
            tab.sessionId,
            onOpenDiagnosticsMenu,
          )
        }
      >
        <TerminalActivityIndicator
          sessionId={tab.sessionId}
          alive={tab.session?.alive}
        />
        <span className="max-w-32 truncate block font-mono">{tab.label}</span>
      </button>

      <button
        type="button"
        aria-label={tab.isPinned ? "Unpin terminal" : "Pin terminal"}
        aria-pressed={tab.isPinned === true}
        title={
          tab.isPinned
            ? "Unpin terminal (allows closing)"
            : "Pin terminal (prevents closing)"
        }
        className={cn(
          "rounded p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]",
          tab.isPinned
            ? "text-[var(--color-primary)] bg-[var(--color-primary)]/15"
            : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin?.(tab.sessionId);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {tab.isPinned ? (
          <PinOff className="h-3 w-3" />
        ) : (
          <Pin className="h-3 w-3" />
        )}
      </button>
      {!tab.isPinned ? (
        <button
          type="button"
          aria-label="Close terminal"
          title="Close terminal (terminates process)"
          className="rounded p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
          onClick={(event) => {
            event.stopPropagation();
            onClose(tab.sessionId);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ) : null}
    </div>
  );
}

// ─── TabBar ───────────────────────────────────────────────────────────────────

export interface TabBarProps {
  paneId: string;
  paneTabs: TabEntry[];
  activeSessionId: string | null;
  activeProject?: string;
  terminalCommitStatusEnabled: boolean;
  hasSplit: boolean;
  onSelectTab: (sessionId: string) => void;
  onToggleTabPin: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  onNewTerminal: () => void;
  onSplitPaneHorizontal: () => void;
  onSplitPaneVertical: () => void;
  onClosePane: () => void;
}

export function TabBar({
  paneId,
  paneTabs,
  activeSessionId,
  activeProject,
  terminalCommitStatusEnabled,
  hasSplit,
  onSelectTab,
  onToggleTabPin,
  onCloseTab,
  onOpenDiagnosticsMenu,
  onNewTerminal,
  onSplitPaneHorizontal,
  onSplitPaneVertical,
  onClosePane,
}: TabBarProps) {
  const [isDragging, setIsDragging] = useState(false);

  function splitPane(action: "right" | "down") {
    const direction = splitActionToPaneDirection(action);
    if (direction === "horizontal") {
      onSplitPaneHorizontal();
      return;
    }
    onSplitPaneVertical();
  }

  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onDragCancel: () => setIsDragging(false),
  });

  return (
    <div className="flex items-center shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden h-8">
      {/* Scrollable tab strip */}
      <div className="flex items-center overflow-x-auto min-w-0 flex-1 scrollbar-hide h-full">
        {paneTabs.length === 0 ? (
          <TerminalTabInsertionZone
            paneId={paneId}
            index={0}
            isDragging={isDragging}
            isEmpty
          />
        ) : (
          <>
            <TerminalTabInsertionZone
              paneId={paneId}
              index={0}
              isDragging={isDragging}
            />
            {paneTabs.map((tab, index) => (
              <Fragment key={tab.sessionId}>
                <DraggableTab
                  paneId={paneId}
                  tab={tab}
                  isActive={tab.sessionId === activeSessionId}
                  onSelect={onSelectTab}
                  onTogglePin={onToggleTabPin}
                  onClose={onCloseTab}
                  onOpenDiagnosticsMenu={onOpenDiagnosticsMenu}
                />
                <TerminalTabInsertionZone
                  paneId={paneId}
                  index={index + 1}
                  isDragging={isDragging}
                />
              </Fragment>
            ))}
          </>
        )}

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
      {terminalCommitStatusEnabled ? (
        <div className="flex min-w-0 max-w-[34rem] shrink">
          <TerminalCommitStatusChip
            project={activeProject}
            enabled={terminalCommitStatusEnabled}
          />
        </div>
      ) : null}

      <div className="flex items-center px-1 border-l border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Split Horizontal Button */}
        <button
          type="button"
          title="Split Right (Ctrl+Shift+5)"
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            splitPane("right");
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
            splitPane("down");
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
