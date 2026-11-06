import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { OsDesktop, OsWindow, WindowPresentationKind } from "./types.js";
import { useWindowStore } from "./window-store.js";
import { WindowContextProvider } from "./window-context.js";
import { WindowFrame } from "./WindowFrame.js";
import { GenericTileRenderer } from "@/components/organisms/SplitLayout.js";
import type { TilePaneNode } from "@/types/tile-tree.js";
import { collectTilePanes } from "@/lib/tile-tree.js";

import { getConnectionSnapshot } from "@/api/connections.js";
import { DesktopContextMenu } from "./DesktopContextMenu.js";
export interface DesktopCanvasProps {
  desktop: OsDesktop;
  renderApp: (window: OsWindow) => ReactNode;
  onNotice?: (notice: string) => void;
}

export function DesktopCanvas({
  desktop,
  renderApp,
  onNotice,
}: DesktopCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const session = useWindowStore((state) => state.session);
  const viewport = useWindowStore((state) => state.viewport);
  const setViewport = useWindowStore((state) => state.setViewport);
  const updateTreeSizes = useWindowStore((state) => state.updateTreeSizes);
  const selectPaneTab = useWindowStore((state) => state.selectPaneTab);
  const toggleMaximizeWindow = useWindowStore(
    (state) => state.toggleMaximizeWindow,
  );

  // ResizeObserver authority for canvas geometry work area
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
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

  // Stable presentation containers per window to preserve React fiber and DOM lifetime across plane shifts
  const [presentationContainersMap] = useState(() => new Map<string, HTMLDivElement>());

  const getPresentationContainer = useCallback((winId: string): HTMLDivElement => {
    let el = presentationContainersMap.get(winId);
    if (!el && typeof document !== "undefined") {
      el = document.createElement("div");
      el.setAttribute("data-os-presentation-container", winId);
      el.className = "w-full h-full";
      presentationContainersMap.set(winId, el);
    }
    return el!;
  }, [presentationContainersMap]);

  // Prune containers when windows are permanently removed from session
  useEffect(() => {
    for (const [id] of presentationContainersMap.entries()) {
      if (!session.windows[id]) {
        presentationContainersMap.delete(id);
      }
    }
  }, [session.windows, presentationContainersMap]);

  // Attach a window's presentation container to its active host slot
  const attachToSlot = useCallback(
    (winId: string, slotNode: HTMLElement | null) => {
      if (!slotNode) return;
      const container = getPresentationContainer(winId);
      if (!container) return;
      if (container.parentElement !== slotNode) {
        slotNode.appendChild(container);
      }
    },
    [getPresentationContainer],
  );

  // Active non-minimized windows belonging to this desktop
  const activeWindowIds = useMemo(() => {
    const ids: string[] = [];
    if (desktop.tree) {
      const panes = collectTilePanes(desktop.tree);
      for (const pane of panes) {
        const activeId = pane.active ?? pane.items[0];
        if (activeId && !ids.includes(activeId)) {
          ids.push(activeId);
        }
      }
    }
    for (const fid of desktop.floatingWindowIds) {
      if (!ids.includes(fid)) ids.push(fid);
    }
    return ids.filter((id) => {
      const win = session.windows[id];
      return win && win.desktopId === desktop.id && !win.minimized;
    });
  }, [desktop.tree, desktop.floatingWindowIds, desktop.id, session.windows]);

  // Maximized windows on this desktop with deterministic stacking (focused window on top)
  const maximizedWindowIds = useMemo(() => {
    const list = activeWindowIds.filter((id) => {
      const win = session.windows[id];
      return Boolean(win?.maximized);
    });

    list.sort((a, b) => {
      if (a === desktop.focusedWindowId) return 1;
      if (b === desktop.focusedWindowId) return -1;
      return a.localeCompare(b);
    });
    return list;
  }, [activeWindowIds, desktop.focusedWindowId, session.windows]);

  const focusedWin = desktop.focusedWindowId
    ? session.windows[desktop.focusedWindowId]
    : undefined;
  const floatOnTop = Boolean(
    focusedWin &&
      focusedWin.mode === "float" &&
      !focusedWin.minimized &&
      !focusedWin.maximized,
  );

  const renderTiledPane = (pane: TilePaneNode<string>) => {
    if (pane.items.length === 0) return null;
    const activeId = pane.active ?? pane.items[0];
    if (!activeId) return null;
    const activeWin = session.windows[activeId];
    const isMaximized = Boolean(activeWin && activeWin.maximized && !activeWin.minimized);

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
                  {win.maximized && <span className="ml-1 opacity-75">❐</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 min-h-0 relative">
          {isMaximized ? (
            <div
              data-os-tile-placeholder={activeId}
              data-testid={`tile-placeholder-${activeId}`}
              className="flex flex-col items-center justify-center w-full h-full bg-[var(--color-surface)]/60 border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-muted)] select-none gap-2 p-4"
            >
              <span className="font-medium text-[var(--color-text)]">
                {activeWin?.title ?? "Window"}
              </span>
              <span className="text-[10px] opacity-75">Maximized to canvas work area</span>
              <button
                type="button"
                data-testid={`tile-placeholder-restore-${activeId}`}
                onClick={() => toggleMaximizeWindow(activeId)}
                className="px-2 py-1 rounded text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] transition-colors"
              >
                Restore to tile
              </button>
            </div>
          ) : (
            <div
              data-os-tile-slot={activeId}
              data-testid={`tile-slot-${activeId}`}
              ref={(node) => attachToSlot(activeId, node)}
              className="w-full h-full relative"
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      data-os-desktop-canvas={desktop.id}
      data-testid={`desktop-canvas-${desktop.id}`}
      className="relative isolate flex-1 w-full h-full overflow-hidden bg-[var(--color-bg)]"
    >
      {/* 0. Background Context Menu (Sibling behind all window layers) */}
      <DesktopContextMenu
        desktopId={desktop.id}
        onNotice={onNotice}
        getContext={() => {
          const currentDesk =
            session.desktops.find((d) => d.id === desktop.id) ?? desktop;
          const desktopCtx = currentDesk.defaultCtx ?? { profileId: "default" };
          const snap = desktopCtx.profileId
            ? getConnectionSnapshot(desktopCtx.profileId)
            : null;
          return {
            desktopId: desktop.id,
            owner: snap?.owner ?? null,
            target: desktopCtx.target,
            windowContext: desktopCtx,
            cwd: null,
            directoryKind: "profile-default",
          };
        }}
      />
      {/* 1. Tiled Windows Layer */}
      {desktop.tree && (
        <div
          data-os-tile-layer="true"
          data-testid={`tile-layer-${desktop.id}`}
          className="absolute inset-0"
        >
          <GenericTileRenderer
            node={desktop.tree}
            onUpdateSizes={(splitId, sizes) =>
              updateTreeSizes(desktop.id, splitId, sizes)
            }
            renderPane={renderTiledPane}
          />
        </div>
      )}

      {/* 2. Floating Windows Layer */}
      <div
        data-os-float-layer="true"
        data-testid={`float-layer-${desktop.id}`}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: floatOnTop ? 60 : 20 }}
      >
        {desktop.floatingWindowIds.map((winId) => {
          const win = session.windows[winId];
          if (!win || win.minimized || win.maximized) return null;
          return (
            <div
              key={winId}
              data-os-float-slot={winId}
              data-testid={`float-slot-${winId}`}
              ref={(node) => attachToSlot(winId, node)}
              className="w-full h-full pointer-events-none"
            />
          );
        })}
      </div>

      {/* 3. Maximized Presentation Plane (Sibling plane to tile/float layers, inset 0 to canvas work area) */}
      {maximizedWindowIds.length > 0 && (
        <div
          data-os-maximized-layer="true"
          data-testid={`maximized-layer-${desktop.id}`}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 40 }}
        >
          {maximizedWindowIds.map((winId, index) => {
            const isFocused = desktop.focusedWindowId === winId;
            return (
              <div
                key={winId}
                data-os-maximized-slot={winId}
                data-testid={`maximized-slot-${winId}`}
                ref={(node) => attachToSlot(winId, node)}
                className="absolute inset-0 pointer-events-auto"
                style={{ zIndex: isFocused ? 50 : 40 + index }}
              />
            );
          })}
        </div>
      )}

      {/* Stable Window Portals: Single React owner, constant portal destination, zero remounting */}
      {activeWindowIds.map((winId) => {
        const win = session.windows[winId];
        if (!win) return null;
        const container = getPresentationContainer(winId);
        const isFocused = desktop.focusedWindowId === winId;
        const presentationKind: WindowPresentationKind = win.maximized
          ? "maximized"
          : win.mode;

        return createPortal(
          <WindowContextProvider
            key={win.id}
            window={win}
            isFocused={isFocused}
            isActiveDesktop={session.activeDesktopId === desktop.id}
          >
            <WindowFrame
              window={win}
              presentationKind={presentationKind}
              canvasArea={viewport}
            >
              {renderApp(win)}
            </WindowFrame>
          </WindowContextProvider>,
          container,
          win.id,
        );
      })}
    </div>
  );
}
