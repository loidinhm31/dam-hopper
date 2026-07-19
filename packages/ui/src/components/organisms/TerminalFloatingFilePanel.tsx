import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Files, Grip, Move, X } from "lucide-react";
import {
  clampTerminalFloatingFilePanelLayout,
  loadTerminalFloatingFilePanelLayout,
  saveTerminalFloatingFilePanelLayout,
  TERMINAL_FILE_PANEL_MARGIN,
  type TerminalFloatingFilePanelLayout,
} from "@/lib/terminal-floating-file-panel-state.js";
import {
  getTerminalFloatingFilePanelTabForKey,
  type TerminalFloatingFilePanelTab,
} from "@/lib/terminal-floating-file-panel-tabs.js";
import { cn } from "@/lib/utils.js";

const EXPLORER_TAB_ID = "terminal-file-panel-explorer-tab";
const CHANGES_TAB_ID = "terminal-file-panel-changes-tab";
const EXPLORER_PANEL_ID = "terminal-file-panel-explorer-panel";
const CHANGES_PANEL_ID = "terminal-file-panel-changes-panel";

interface ResizeHandleProps {
  onMouseDown: (event: ReactMouseEvent) => void;
}

interface TerminalFloatingFilePanelProps {
  open: boolean;
  treeWidth: number;
  isDragging?: boolean;
  focusEditorSignal?: number;
  explorerContent: ReactNode;
  changesContent: ReactNode;
  editorContent: ReactNode;
  treeResizeHandleProps: ResizeHandleProps;
  onClose: () => void;
}

type TerminalFloatingFilePanelContentProps = Omit<
  TerminalFloatingFilePanelProps,
  "open"
>;

export function handleTerminalFloatingFilePanelKeyDown(
  event: Pick<KeyboardEvent, "key">,
  onClose: () => void,
) {
  if (event.key !== "Escape") return false;
  onClose();
  return true;
}

export function TerminalFloatingFilePanel({
  open,
  ...props
}: TerminalFloatingFilePanelProps) {
  if (!open) return null;
  return <TerminalFloatingFilePanelContent {...props} />;
}

function TerminalFloatingFilePanelContent({
  treeWidth,
  isDragging = false,
  focusEditorSignal = 0,
  explorerContent,
  changesContent,
  editorContent,
  treeResizeHandleProps,
  onClose,
}: TerminalFloatingFilePanelContentProps) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const editorRegionRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<
    Partial<Record<TerminalFloatingFilePanelTab, HTMLButtonElement>>
  >({});
  const [layout, setLayout] = useState(loadTerminalFloatingFilePanelLayout);
  const [activeTab, setActiveTab] =
    useState<TerminalFloatingFilePanelTab>("explorer");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleTerminalFloatingFilePanelKeyDown(event, onClose);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (focusEditorSignal <= 0) return;
    editorRegionRef.current?.focus();
  }, [focusEditorSignal]);

  useEffect(() => {
    if (!boundsRef.current) return;
    const bounds = boundsRef.current.getBoundingClientRect();
    setLayout((current) =>
      clampTerminalFloatingFilePanelLayout(current, {
        width: bounds.width,
        height: bounds.height,
      }),
    );
  }, []);

  const updateLayout = (
    nextLayout:
      | TerminalFloatingFilePanelLayout
      | ((
          current: TerminalFloatingFilePanelLayout,
        ) => TerminalFloatingFilePanelLayout),
  ) => {
    setLayout((current) => {
      const resolved =
        typeof nextLayout === "function" ? nextLayout(current) : nextLayout;
      saveTerminalFloatingFilePanelLayout(resolved);
      return resolved;
    });
  };

  const resolveCurrentFrame = () => {
    const bounds = boundsRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!bounds || !panel) return null;

    return {
      bounds,
      frame: {
        left: panel.left - bounds.left,
        top: panel.top - bounds.top,
        width: panel.width,
        height: panel.height,
      },
    };
  };

  const handleDragStart = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    const current = resolveCurrentFrame();
    if (!current) return;
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = current.frame.left;
    const startTop = current.frame.top;
    const boundsWidth = current.bounds.width;
    const boundsHeight = current.bounds.height;
    const startWidth = current.frame.width;
    const startHeight = current.frame.height;

    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      updateLayout(
        clampTerminalFloatingFilePanelLayout(
          {
            width: startWidth,
            height: startHeight,
            left: startLeft + deltaX,
            top: startTop + deltaY,
          },
          { width: boundsWidth, height: boundsHeight },
        ),
      );
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const handleResizeStart = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    const current = resolveCurrentFrame();
    if (!current) return;
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const boundsWidth = current.bounds.width;
    const boundsHeight = current.bounds.height;
    const startFrame = current.frame;

    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      updateLayout(
        clampTerminalFloatingFilePanelLayout(
          {
            width: startFrame.width + deltaX,
            height: startFrame.height + deltaY,
            left: layout.left,
            top: startFrame.top,
          },
          { width: boundsWidth, height: boundsHeight },
        ),
      );
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const selectTab = (tab: TerminalFloatingFilePanelTab, focus = false) => {
    setActiveTab(tab);
    if (focus) tabRefs.current[tab]?.focus();
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const nextTab = getTerminalFloatingFilePanelTabForKey(activeTab, event.key);
    if (!nextTab) return;
    event.preventDefault();
    selectTab(nextTab, true);
  };

  return (
    <div ref={boundsRef} className="pointer-events-none absolute inset-0 z-20">
      <div
        ref={panelRef}
        className={cn(
          "pointer-events-auto absolute flex max-w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/96 shadow-2xl backdrop-blur-xl",
          isDragging && "select-none",
        )}
        style={{
          top: layout.top,
          left: layout.left ?? undefined,
          right: layout.left === null ? TERMINAL_FILE_PANEL_MARGIN : undefined,
          width: layout.width,
          height: layout.height,
        }}
        data-testid="terminal-floating-file-panel"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 px-3">
            <div
              className="flex min-w-0 flex-1 cursor-move items-center gap-2"
              onMouseDown={handleDragStart}
              title="Drag files panel"
            >
              <Move className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
              <Files className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
              <span className="truncate text-xs font-semibold text-[var(--color-text)]">
                Workspace Files
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              title="Close files panel"
              aria-label="Close files panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <section
              className="flex min-h-0 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]/80"
              style={{ width: treeWidth }}
            >
              <div
                role="tablist"
                aria-label="Files panel"
                className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2"
              >
                <button
                  ref={(element) => {
                    tabRefs.current.explorer = element ?? undefined;
                  }}
                  id={EXPLORER_TAB_ID}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "explorer"}
                  aria-controls={EXPLORER_PANEL_ID}
                  tabIndex={activeTab === "explorer" ? 0 : -1}
                  onClick={() => selectTab("explorer")}
                  onKeyDown={handleTabKeyDown}
                  className={cn(
                    "rounded-sm px-1.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors",
                    activeTab === "explorer"
                      ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                  )}
                >
                  Explorer
                </button>
                <button
                  ref={(element) => {
                    tabRefs.current.changes = element ?? undefined;
                  }}
                  id={CHANGES_TAB_ID}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "changes"}
                  aria-controls={CHANGES_PANEL_ID}
                  tabIndex={activeTab === "changes" ? 0 : -1}
                  onClick={() => selectTab("changes")}
                  onKeyDown={handleTabKeyDown}
                  className={cn(
                    "rounded-sm px-1.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors",
                    activeTab === "changes"
                      ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                  )}
                >
                  Changes
                </button>
              </div>
              <div
                id={EXPLORER_PANEL_ID}
                role="tabpanel"
                aria-labelledby={EXPLORER_TAB_ID}
                hidden={activeTab !== "explorer"}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                {activeTab === "explorer" ? explorerContent : null}
              </div>
              <div
                id={CHANGES_PANEL_ID}
                role="tabpanel"
                aria-labelledby={CHANGES_TAB_ID}
                hidden={activeTab !== "changes"}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                {activeTab === "changes" ? changesContent : null}
              </div>
            </section>

            <div
              {...treeResizeHandleProps}
              className="group relative w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)]/20"
              aria-hidden="true"
            >
              <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[var(--color-primary)]/50 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex h-8 shrink-0 items-center border-b border-[var(--color-border)] px-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Editor
                </span>
              </div>
              <div
                ref={editorRegionRef}
                tabIndex={-1}
                className="min-h-0 min-w-0 flex-1 overflow-hidden outline-none"
              >
                {editorContent}
              </div>
            </section>
          </div>
        </div>

        <button
          type="button"
          onMouseDown={handleResizeStart}
          className="absolute bottom-2 right-2 rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          title="Resize files panel"
          aria-label="Resize files panel"
        >
          <Grip className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
