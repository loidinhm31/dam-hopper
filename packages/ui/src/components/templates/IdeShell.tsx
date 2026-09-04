import { useState, type ReactNode, useMemo, useEffect, useRef } from "react";
import { TopNav } from "@/components/organisms/TopNav.js";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse.js";
import { useResizeHandle } from "@/hooks/use-resize-handle.js";
import { useVerticalResizeHandle } from "@/hooks/use-vertical-resize-handle.js";
import { cn } from "@/lib/utils.js";
import type { ToolWindowDef } from "@/types/ide.js";
import { ActivityBar } from "@/components/organisms/ActivityBar.js";
import { SidebarTopGroup } from "@/components/organisms/SidebarTopGroup.js";
import { SidebarBottomGroup } from "@/components/organisms/SidebarBottomGroup.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import {
  resolveBottomPanelLayout,
  resolveMaximizeToggle,
  resolveTerminalPanelShortcut,
  resolveTopToolToggle,
} from "@/lib/ide-shell-layout.js";
import type { TerminalPanelToolId } from "@/lib/ide-shell-layout.js";

const TREE_WIDTH_KEY = "dam-hopper:ide-tree-width";
const TERMINAL_TREE_WIDTH_KEY = "dam-hopper:ide-terminal-tree-width";
const BOTTOM_HEIGHT_KEY = "dam-hopper:ide-bottom-height";

const LEFT_TOP_KEY = "dam-hopper:ide-left-top";
const LEFT_BOTTOM_KEY = "dam-hopper:ide-left-bottom";
const RIGHT_TOP_KEY = "dam-hopper:ide-right-top";
const RIGHT_BOTTOM_KEY = "dam-hopper:ide-right-bottom";

export function IdeShell({
  leftTools,
  rightTools,
  editor,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
  activateLeftTopToolRequest,
  activateBottomToolRequest,
  activateRightTopToolRequest,
  toolbarActions,
}: {
  leftTools: ToolWindowDef[];
  rightTools: ToolWindowDef[];
  editor: ReactNode;
  workspaceMode?: WorkspaceMode;
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
  activateLeftTopToolRequest?: {
    nonce: number;
    toolId: string;
    exclusiveTarget?: TerminalPanelToolId;
  } | null;
  activateBottomToolRequest?: {
    nonce: number;
    toolId: string;
    exclusiveTarget?: TerminalPanelToolId;
  } | null;
  activateRightTopToolRequest?: {
    nonce: number;
    toolId: string;
    exclusiveTarget?: TerminalPanelToolId;
  } | null;
  toolbarActions?: ReactNode;
}) {
  const { collapsed, toggle } = useSidebarCollapse();

  // Left: tool panel width
  const {
    width: leftWidth,
    handleProps: leftResizeProps,
    isDragging: isLeftDragging,
  } = useResizeHandle({
    min: 140,
    max: 480,
    defaultWidth: 240,
    storageKey: TREE_WIDTH_KEY,
  });

  // Right: tool panel width
  const {
    width: rightWidth,
    handleProps: rightResizeProps,
    isDragging: isRightDragging,
  } = useResizeHandle({
    min: 180,
    max: 480,
    defaultWidth: 260,
    storageKey: TERMINAL_TREE_WIDTH_KEY,
    reversed: true,
  });

  // Bottom: panel height
  const {
    height: bottomHeight,
    handleProps: bottomResizeProps,
    isDragging: isBottomDragging,
  } = useVerticalResizeHandle({
    min: 100,
    max: 600,
    defaultHeight: 300,
    storageKey: BOTTOM_HEIGHT_KEY,
    reversed: true,
  });

  const [activeLeftTopId, setActiveLeftTopId] = useState<string | null>(() => {
    const stored = localStorage.getItem(LEFT_TOP_KEY);
    if (stored === null) {
      const def = leftTools.find(
        (t) => (!t.position || t.position === "top") && t.defaultActive,
      );
      if (def) return def.id;
      return (
        leftTools.find((t) => !t.position || t.position === "top")?.id || null
      );
    }
    return stored === "null" ? null : stored;
  });
  const [activeLeftBottomId, setActiveLeftBottomId] = useState<string | null>(
    () => {
      const stored = localStorage.getItem(LEFT_BOTTOM_KEY);
      if (stored === null) {
        const def = leftTools.find(
          (t) => t.position === "bottom" && t.defaultActive,
        );
        if (def) return def.id;
        return leftTools.find((t) => t.position === "bottom")?.id || null;
      }
      return stored === "null" ? null : stored;
    },
  );
  const [activeRightTopId, setActiveRightTopId] = useState<string | null>(
    () => {
      const stored = localStorage.getItem(RIGHT_TOP_KEY);
      if (stored === null) {
        const def = rightTools.find(
          (t) => (!t.position || t.position === "top") && t.defaultActive,
        );
        if (def) return def.id;
        return (
          rightTools.find((t) => !t.position || t.position === "top")?.id ||
          null
        );
      }
      return stored === "null" ? null : stored;
    },
  );
  const [activeRightBottomId, setActiveRightBottomId] = useState<string | null>(
    () => {
      const stored = localStorage.getItem(RIGHT_BOTTOM_KEY);
      if (stored === null) {
        const def = rightTools.find(
          (t) => t.position === "bottom" && t.defaultActive,
        );
        if (def) return def.id;
        return rightTools.find((t) => t.position === "bottom")?.id || null;
      }
      return stored === "null" ? null : stored;
    },
  );
  const activeLeftTopTool = useMemo(
    () => leftTools.find((t) => t.id === activeLeftTopId),
    [leftTools, activeLeftTopId],
  );
  const activeLeftBottomTool = useMemo(
    () => leftTools.find((t) => t.id === activeLeftBottomId),
    [leftTools, activeLeftBottomId],
  );
  const activeRightTopTool = useMemo(
    () => rightTools.find((t) => t.id === activeRightTopId),
    [rightTools, activeRightTopId],
  );
  const activeRightBottomTool = useMemo(
    () => rightTools.find((t) => t.id === activeRightBottomId),
    [rightTools, activeRightBottomId],
  );

  useEffect(() => {
    localStorage.setItem(
      LEFT_TOP_KEY,
      activeLeftTopId === null ? "null" : activeLeftTopId,
    );
  }, [activeLeftTopId]);
  useEffect(() => {
    localStorage.setItem(
      LEFT_BOTTOM_KEY,
      activeLeftBottomId === null ? "null" : activeLeftBottomId,
    );
  }, [activeLeftBottomId]);
  useEffect(() => {
    localStorage.setItem(
      RIGHT_TOP_KEY,
      activeRightTopId === null ? "null" : activeRightTopId,
    );
  }, [activeRightTopId]);
  useEffect(() => {
    localStorage.setItem(
      RIGHT_BOTTOM_KEY,
      activeRightBottomId === null ? "null" : activeRightBottomId,
    );
  }, [activeRightBottomId]);
  // Session-only maximize state for the bottom tool panel (not persisted).
  const [bottomMaximized, setBottomMaximized] = useState(false);
  const processedPanelShortcutNonceRef = useRef<number | null>(null);
  const closeLeftBottom = () => {
    setActiveLeftBottomId(null);
    setBottomMaximized(false);
  };
  const closeRightBottom = () => {
    setActiveRightBottomId(null);
    setBottomMaximized(false);
  };
  const toggleBottomMaximize = () => {
    const outcome = resolveMaximizeToggle({ bottomMaximized });
    setBottomMaximized(outcome.nextBottomMaximized);
    if (outcome.clearTopActive) {
      // Entering maximize: unselect active top tools on both sides so the
      // activity bar no longer highlights them while the bottom panel covers
      // the top area. Selecting a top tool again restores the normal layout.
      setActiveLeftTopId(null);
      setActiveRightTopId(null);
    }
  };

  useEffect(() => {
    if (!activateLeftTopToolRequest) return;
    const requestedTool = leftTools.find(
      (entry) => entry.id === activateLeftTopToolRequest.toolId,
    );
    if (!requestedTool || requestedTool.position === "bottom") return;
    // Request props bridge WorkspacePage events into local panel state after
    // the committing render, avoiding a synchronous effect-state cascade.
    queueMicrotask(() => {
      setActiveLeftTopId(activateLeftTopToolRequest.toolId);
      setBottomMaximized((v) => (v ? false : v));
    });
  }, [activateLeftTopToolRequest, leftTools]);

  useEffect(() => {
    if (!activateBottomToolRequest) return;
    const requestedTool = [...leftTools, ...rightTools].find(
      (entry) => entry.id === activateBottomToolRequest.toolId,
    );
    if (!requestedTool || requestedTool.position !== "bottom") return;
    queueMicrotask(() => {
      if (leftTools.includes(requestedTool)) {
        setActiveLeftBottomId(requestedTool.id);
      } else {
        setActiveRightBottomId(requestedTool.id);
      }
      setBottomMaximized((v) => (v ? false : v));
    });
  }, [activateBottomToolRequest, leftTools, rightTools]);

  useEffect(() => {
    if (!activateRightTopToolRequest) return;
    const requestedTool = rightTools.find(
      (entry) => entry.id === activateRightTopToolRequest.toolId,
    );
    if (!requestedTool || requestedTool.position === "bottom") return;

    if (activateRightTopToolRequest.exclusiveTarget) {
      if (
        processedPanelShortcutNonceRef.current ===
        activateRightTopToolRequest.nonce
      ) {
        return;
      }
      processedPanelShortcutNonceRef.current =
        activateRightTopToolRequest.nonce;
      const outcome = resolveTerminalPanelShortcut({
        targetId: activateRightTopToolRequest.exclusiveTarget,
        activeLeftBottomId,
        activeRightTopId,
        bottomMaximized,
      });
      queueMicrotask(() => {
        setActiveLeftBottomId(outcome.nextActiveLeftBottomId);
        setActiveRightTopId(outcome.nextActiveRightTopId);
        setBottomMaximized(outcome.nextBottomMaximized);
      });
      return;
    }

    queueMicrotask(() => {
      setActiveRightTopId(activateRightTopToolRequest.toolId);
      setBottomMaximized((v) => (v ? false : v));
    });
  }, [
    activateRightTopToolRequest,
    activeLeftBottomId,
    activeRightTopId,
    bottomMaximized,
    rightTools,
  ]);

  useEffect(() => {
    if (!activateBottomToolRequest?.exclusiveTarget) return;
    const requestedTool = leftTools.find(
      (entry) => entry.id === activateBottomToolRequest.toolId,
    );
    if (!requestedTool || requestedTool.position !== "bottom") return;

    if (
      processedPanelShortcutNonceRef.current === activateBottomToolRequest.nonce
    ) {
      return;
    }
    processedPanelShortcutNonceRef.current = activateBottomToolRequest.nonce;

    const outcome = resolveTerminalPanelShortcut({
      targetId: activateBottomToolRequest.exclusiveTarget,
      activeLeftBottomId,
      activeRightTopId,
      bottomMaximized,
    });
    queueMicrotask(() => {
      setActiveLeftBottomId(outcome.nextActiveLeftBottomId);
      setActiveRightTopId(outcome.nextActiveRightTopId);
      setBottomMaximized(outcome.nextBottomMaximized);
    });
  }, [
    activateBottomToolRequest,
    activeLeftBottomId,
    activeRightTopId,
    bottomMaximized,
    leftTools,
  ]);

  function handleToggleLeft(id: string) {
    const tool = leftTools.find((t) => t.id === id);
    if (!tool) return;
    const isTop = !tool.position || tool.position === "top";
    if (isTop) {
      const outcome = resolveTopToolToggle({
        currentActiveId: activeLeftTopId,
        clickedId: id,
        bottomMaximized,
      });
      setActiveLeftTopId(outcome.nextActiveId);
      // Reopening a top tool restores the normal (non-maximized) layout.
      if (outcome.revertMaximize) setBottomMaximized(false);
    } else {
      setActiveLeftBottomId((curr) => (curr === id ? null : id));
    }
  }

  function handleToggleRight(id: string) {
    const tool = rightTools.find((t) => t.id === id);
    if (!tool) return;
    const isTop = !tool.position || tool.position === "top";
    if (isTop) {
      const outcome = resolveTopToolToggle({
        currentActiveId: activeRightTopId,
        clickedId: id,
        bottomMaximized,
      });
      setActiveRightTopId(outcome.nextActiveId);
      if (outcome.revertMaximize) setBottomMaximized(false);
    } else {
      setActiveRightBottomId((curr) => (curr === id ? null : id));
    }
  }

  const isDragging = isLeftDragging || isRightDragging || isBottomDragging;

  const bottomLayout = resolveBottomPanelLayout({
    bottomMaximized,
    bottomHeight,
  });

  return (
    <div
      className={cn(
        "app-screen-height flex flex-col overflow-clip gradient-bg",
        isDragging && "select-none",
      )}
    >
      {/* App nav top bar */}
      <TopNav
        collapsed={collapsed}
        onToggle={toggle}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={onWorkspaceModeChange}
        workspaceModeShortcutLabel={workspaceModeShortcutLabel}
      />
      {toolbarActions && (
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-[var(--color-border)] bg-[var(--color-surface)]/30 px-3">
          {toolbarActions}
        </div>
      )}

      <div className="flex-1 flex min-w-0 min-h-0 overflow-clip">
        {/* ── Left Activity Bar ────────────────────────────────────────── */}
        <ActivityBar
          side="left"
          tools={leftTools}
          activeTopId={activeLeftTopId}
          activeBottomId={activeLeftBottomId}
          onToggle={handleToggleLeft}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-clip">
          {/* ── Top area: Sidebars + Editor ───────────────────────────── */}
          <div className={bottomLayout.topAreaClassName}>
            {activeLeftTopTool && (
              <>
                <div
                  style={{ width: leftWidth }}
                  className="shrink-0 flex flex-col"
                >
                  <SidebarTopGroup
                    tool={activeLeftTopTool}
                    onClose={() => setActiveLeftTopId(null)}
                  />
                </div>
                <div
                  {...leftResizeProps}
                  className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
                >
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </>
            )}

            {/* ── Center Editor ────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-clip">
              <div className="flex-1 min-h-0 overflow-clip">{editor}</div>
            </div>

            {activeRightTopTool && (
              <>
                <div
                  {...rightResizeProps}
                  className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
                >
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div
                  style={{ width: rightWidth }}
                  className="shrink-0 flex flex-col"
                >
                  <SidebarTopGroup
                    tool={activeRightTopTool}
                    onClose={() => setActiveRightTopId(null)}
                  />
                </div>
              </>
            )}
          </div>

          {/* ── Bottom Panel Area ────────────────────────────────────── */}
          {(activeLeftBottomTool || activeRightBottomTool) && (
            <div className={bottomLayout.bottomOuterClassName}>
              {bottomLayout.showResizeHandle && (
                <div
                  {...bottomResizeProps}
                  className="h-1 shrink-0 cursor-row-resize group relative hover:bg-[var(--color-primary)]/20"
                >
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
              <div
                style={bottomLayout.innerStyle}
                className={bottomLayout.innerClassName}
              >
                {activeLeftBottomTool && (
                  <div className="flex-1 min-w-0 flex flex-col">
                    <SidebarBottomGroup
                      tool={activeLeftBottomTool}
                      onClose={closeLeftBottom}
                      maximizable
                      isMaximized={bottomMaximized}
                      onToggleMaximize={toggleBottomMaximize}
                    />
                  </div>
                )}
                {activeLeftBottomTool && activeRightBottomTool && (
                  <div className="w-px shrink-0 bg-[var(--color-border)]" />
                )}
                {activeRightBottomTool && (
                  <div className="flex-1 min-w-0 flex flex-col">
                    <SidebarBottomGroup
                      tool={activeRightBottomTool}
                      onClose={closeRightBottom}
                      maximizable
                      isMaximized={bottomMaximized}
                      onToggleMaximize={toggleBottomMaximize}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right Activity Bar ───────────────────────────────────────── */}
        {rightTools.length > 0 && (
          <ActivityBar
            side="right"
            tools={rightTools}
            activeTopId={activeRightTopId}
            activeBottomId={activeRightBottomId}
            onToggle={handleToggleRight}
          />
        )}
      </div>
    </div>
  );
}
