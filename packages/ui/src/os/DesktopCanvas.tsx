import { useEffect, useRef, type ReactNode } from "react";
import type { OsDesktop, OsWindow } from "./types.js";
import { useWindowStore } from "./window-store.js";
import { WindowContextProvider } from "./window-context.js";
import { WindowFrame } from "./WindowFrame.js";
import { GenericTileRenderer } from "@/components/organisms/SplitLayout.js";
import type { TilePaneNode } from "@/types/tile-tree.js";

export interface DesktopCanvasProps {
  desktop: OsDesktop;
  renderApp: (window: OsWindow) => ReactNode;
}

export function DesktopCanvas({
  desktop,
  renderApp,
}: DesktopCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const session = useWindowStore((state) => state.session);
  const setViewport = useWindowStore((state) => state.setViewport);
  const updateTreeSizes = useWindowStore((state) => state.updateTreeSizes);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const selectPaneTab = useWindowStore((state) => state.selectPaneTab);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setViewport({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [setViewport]);

  const renderWindow = (windowId: string) => {
    const win = session.windows[windowId];
    if (!win || win.minimized) return null;
    const isFocused = desktop.focusedWindowId === windowId;
    return (
      <WindowContextProvider
        key={win.id}
        window={win}
        isFocused={isFocused}
        isActiveDesktop={session.activeDesktopId === desktop.id}
      >
        <WindowFrame window={win}>{renderApp(win)}</WindowFrame>
      </WindowContextProvider>
    );
  };

  const renderTiledPane = (pane: TilePaneNode<string>) => {
    if (pane.items.length === 0) return null;
    const activeId = pane.active ?? pane.items[0];
    if (!activeId) return null;

    return (
      <div className="flex flex-col w-full h-full overflow-hidden">
        {/* Pane Tabs Header when multiple items exist */}
        {pane.items.length > 1 && (
          <div
            role="tablist"
            aria-label="Tiled window tabs"
            data-os-pane-tabs={pane.id}
            className="flex items-center gap-1 px-2 py-1 bg-[var(--color-surface)] border-b border-[var(--color-border)] overflow-x-auto text-xs select-none"
          >
            {pane.items.map((winId) => {
              const win = session.windows[winId];
              if (!win) return null;
              const isActive = winId === activeId;
              return (
                <button
                  key={winId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`window-frame-${winId}`}
                  onClick={() => selectPaneTab(pane.id, winId)}
                  className={`px-2 py-0.5 rounded text-xs truncate max-w-[140px] transition-colors ${
                    isActive
                      ? "bg-[var(--color-primary)] text-white font-medium shadow-sm"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {win.title}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex-1 min-h-0 relative">{renderWindow(activeId)}</div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      data-os-desktop-canvas={desktop.id}
      data-testid={`desktop-canvas-${desktop.id}`}
      className="relative flex-1 w-full h-full overflow-hidden bg-[var(--color-bg)]"
    >
      {/* Tiled Windows Layer */}
      {desktop.tree && (
        <div className="absolute inset-0">
          <GenericTileRenderer
            node={desktop.tree}
            onUpdateSizes={(splitId, sizes) =>
              updateTreeSizes(desktop.id, splitId, sizes)
            }
            renderPane={renderTiledPane}
          />
        </div>
      )}

      {/* Floating Windows Layer */}
      {desktop.floatingWindowIds.map((winId) => renderWindow(winId))}
    </div>
  );
}
