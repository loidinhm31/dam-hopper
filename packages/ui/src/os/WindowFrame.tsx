import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { OsWindow } from "./types.js";
import { useWindowStore } from "./window-store.js";
import { useWindowContext } from "./window-context.js";
import { arbitrateKeyboardEvent } from "./input-arbiter.js";
import {
  DEFAULT_FLOAT_BOUNDS,
  getVisibleFloatBounds,
  type ResizeDirection,
} from "./window-ops.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useEditorStore } from "@/stores/editor.js";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
export interface WindowFrameProps {
  window: OsWindow;
  children: ReactNode;
}

export function WindowFrame({ window, children }: WindowFrameProps) {
  const { isFocused, owner } = useWindowContext();
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const session = useWindowStore((state) => state.session);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const closeWindow = useWindowStore((state) => state.closeWindow);
  const toggleMaximizeWindow = useWindowStore(
    (state) => state.toggleMaximizeWindow,
  );
  const minimizeWindow = useWindowStore((state) => state.minimizeWindow);
  const setWindowMode = useWindowStore((state) => state.setWindowMode);
  const moveWindowToDesktop = useWindowStore(
    (state) => state.moveWindowToDesktop,
  );
  const updateFloatBounds = useWindowStore((state) => state.updateFloatBounds);
  const resizeFloatBounds = useWindowStore((state) => state.resizeFloatBounds);
  const viewport = useWindowStore((state) => state.viewport);
  const [isResizing, setIsResizing] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const filePath = window.appState?.filePath as string | undefined;

  // Cancel active drag/resize gestures immediately if Cognito activates or unmounts
  useEffect(() => {
    if (isCognitoActive && dragCleanupRef.current) {
      dragCleanupRef.current();
      dragCleanupRef.current = null;
      setIsDragging(false);
      setIsResizing(false);
    }
  }, [isCognitoActive]);

  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
    };
  }, []);

  const handlePointerDown = useCallback(() => {
    if (!isFocused) {
      focusWindow(window.id);
    }
  }, [focusWindow, isFocused, window.id]);

  const handleStartDrag = useCallback(
    (e: ReactMouseEvent) => {
      if (window.mode !== "float" || window.maximized) return;
      focusWindow(window.id);
      setIsDragging(true);

      const dragStart = {
        startX: e.clientX,
        startY: e.clientY,
        initialX: window.floatBounds?.x ?? 60,
        initialY: window.floatBounds?.y ?? 60,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - dragStart.startX;
        const deltaY = moveEvent.clientY - dragStart.startY;
        const nextX = dragStart.initialX + deltaX;
        const nextY = dragStart.initialY + deltaY;
        updateFloatBounds(window.id, {
          x: nextX,
          y: nextY,
          width: window.floatBounds?.width ?? 720,
          height: window.floatBounds?.height ?? 520,
        });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        globalThis.removeEventListener("mousemove", handleMouseMove);
        globalThis.removeEventListener("mouseup", handleMouseUp);
        dragCleanupRef.current = null;
      };

      globalThis.addEventListener("mousemove", handleMouseMove);
      globalThis.addEventListener("mouseup", handleMouseUp);
      dragCleanupRef.current = handleMouseUp;
    },
    [
      window.mode,
      window.maximized,
      window.id,
      window.floatBounds,
      focusWindow,
      updateFloatBounds,
    ],
  );

  const handleStartResize = useCallback(
    (direction: ResizeDirection, e: ReactMouseEvent) => {
      if (window.mode !== "float" || window.maximized || isCognitoActive) return;
      e.stopPropagation();
      e.preventDefault();
      focusWindow(window.id);
      setIsResizing(true);

      let prevX = e.clientX;
      let prevY = e.clientY;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - prevX;
        const deltaY = moveEvent.clientY - prevY;
        prevX = moveEvent.clientX;
        prevY = moveEvent.clientY;
        resizeFloatBounds(window.id, deltaX, deltaY, direction);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        globalThis.removeEventListener("mousemove", handleMouseMove);
        globalThis.removeEventListener("mouseup", handleMouseUp);
        dragCleanupRef.current = null;
      };

      globalThis.addEventListener("mousemove", handleMouseMove);
      globalThis.addEventListener("mouseup", handleMouseUp);
      dragCleanupRef.current = handleMouseUp;
    },
    [
      window.mode,
      window.maximized,
      window.id,
      isCognitoActive,
      focusWindow,
      resizeFloatBounds,
    ],
  );

  const handleClose = useCallback(() => {
    if (window.appId === "editor") {
      const filePath = window.appState?.filePath as string | undefined;
      const targetProject = window.ctx.projectId;
      const targetWorktree = window.ctx.worktreeId;
      const targetProfile = window.ctx.profileId;

      const tabs = useEditorStore.getState().tabs;
      const isDirty = tabs.some((t) => {
        if (!t.dirty) return false;
        if (filePath && t.path !== filePath) return false;
        if (targetProject && t.project !== targetProject) return false;
        if (
          targetProfile &&
          t.target?.profileId &&
          t.target.profileId !== targetProfile
        ) {
          return false;
        }
        if (
          targetWorktree &&
          t.target?.kind === "project" &&
          t.target.worktreePath &&
          t.target.worktreePath !== targetWorktree
        ) {
          return false;
        }
        return true;
      });

      if (isDirty) {
        setConfirmCloseOpen(true);
        return;
      }
    }
    closeWindow(window.id);
  }, [
    closeWindow,
    window.appId,
    window.id,
    window.appState?.filePath,
    window.ctx.projectId,
    window.ctx.profileId,
    window.ctx.worktreeId,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const isTargetInBody =
        targetEl?.closest?.("[data-os-window-slot]") !== null;
      const isFrameFocused = !isTargetInBody;
      const isModalActive = Boolean(
        typeof document !== "undefined" &&
          document.querySelector('[data-os-modal="true"], [role="dialog"]'),
      );

      const disposition = arbitrateKeyboardEvent(e.nativeEvent, {
        isCognitoActive,
        isComposing: Boolean(e.nativeEvent.isComposing),
        isFrameFocused,
        isModalActive,
      });
      if (disposition === "cognito-blocked") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (disposition === "os-shortcut-handled") {
        e.preventDefault();
        e.stopPropagation();
        const visibleWindowIds = Object.keys(session.windows).filter(
          (id) =>
            !session.windows[id]?.minimized &&
            session.windows[id]?.desktopId === window.desktopId,
        );
        const idx = visibleWindowIds.indexOf(window.id);
        const nextId =
          visibleWindowIds[(idx + 1) % visibleWindowIds.length] ?? window.id;
        if (nextId) {
          focusWindow(nextId);
          const nextEl = document.querySelector(
            `[data-os-window-frame="${CSS.escape(nextId)}"]`,
          ) as HTMLElement | null;
          nextEl?.focus();
        }
      }
    },
    [isCognitoActive, session.windows, window.desktopId, window.id, focusWindow],
  );

  const otherDesktops = session.desktops.filter(
    (d) => d.id !== window.desktopId,
  );

  const frameStyle: React.CSSProperties = window.maximized
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 50,
        width: "100vw",
        height: "100vh",
      }
    : window.mode === "float"
      ? (() => {
          const bounds = window.floatBounds
            ? getVisibleFloatBounds(window.floatBounds, viewport)
            : DEFAULT_FLOAT_BOUNDS;
          return {
            position: "absolute" as const,
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            zIndex: isFocused ? 30 : 20,
          };
        })()
      : {
          position: "relative" as const,
          width: "100%",
          height: "100%",
        };
  const RESIZE_HANDLES: Array<{
    dir: ResizeDirection;
    className: string;
  }> = [
    { dir: "n", className: "top-0 left-2 right-2 h-2 cursor-n-resize" },
    { dir: "s", className: "bottom-0 left-2 right-2 h-2 cursor-s-resize" },
    { dir: "w", className: "left-0 top-2 bottom-2 w-2 cursor-w-resize" },
    { dir: "e", className: "right-0 top-2 bottom-2 w-2 cursor-e-resize" },
    { dir: "nw", className: "top-0 left-0 w-3 h-3 cursor-nw-resize" },
    { dir: "ne", className: "top-0 right-0 w-3 h-3 cursor-ne-resize" },
    { dir: "sw", className: "bottom-0 left-0 w-3 h-3 cursor-sw-resize" },
    { dir: "se", className: "bottom-0 right-0 w-3 h-3 cursor-se-resize" },
  ];

  return (
    <>
      <div
        role="region"
      aria-label={window.title}
      aria-labelledby={`window-title-${window.id}`}
      data-os-window-frame={window.id}
      data-testid={`window-frame-${window.id}`}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
      onKeyDownCapture={handleKeyDown}
      style={frameStyle}
      className={`flex flex-col overflow-hidden bg-[var(--color-surface)] border ${
        isFocused
          ? "border-[var(--color-primary)] shadow-xl"
          : "border-[var(--color-border)] shadow-sm"
      } ${window.mode === "float" ? "rounded-lg" : ""}`}
    >
      <div
        data-os-frame-header="true"
        onMouseDown={handleStartDrag}
        className={`flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] select-none text-xs ${
          isFocused
            ? "bg-[var(--color-surface-hover)]"
            : "bg-[var(--color-surface)]"
        } ${window.mode === "float" && !window.maximized ? "cursor-move" : "cursor-default"}`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <span
            id={`window-title-${window.id}`}
            className="font-medium text-[var(--color-text)] truncate"
          >
            {window.title}
          </span>
          {window.ctx.projectId && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-bg)] text-[var(--color-text-muted)] font-mono border border-[var(--color-border)]">
              {window.ctx.projectId}
            </span>
          )}
        </div>
        {/* Window controls */}
        <div className="flex items-center gap-1">
          {/* Mode toggle (Tile <-> Float) */}
          <button
            type="button"
            aria-label={
              window.mode === "tile" ? "Switch to Float" : "Switch to Tile"
            }
            onClick={() =>
              setWindowMode(
                window.id,
                window.mode === "tile" ? "float" : "tile",
              )
            }
            className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[10px]"
          >
            {window.mode === "tile" ? "Float" : "Tile"}
          </button>

          {/* Move to other desktop */}
          {otherDesktops.length > 0 && (
            <Select
              value=""
              onValueChange={(val) => {
                if (val) {
                  moveWindowToDesktop(window.id, val);
                }
              }}
            >
              <SelectTrigger
                aria-label="Move to desktop"
                className="h-5 w-auto gap-1 border border-[var(--color-border)] rounded bg-transparent px-1.5 py-0 text-[10px] text-[var(--color-text-muted)]"
              >
                <SelectValue placeholder="Move…" />
              </SelectTrigger>
              <SelectContent>
                {otherDesktops.map((d) => (
                  <SelectItem key={d.id} value={d.id} className="text-xs">
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Minimize */}
          <button
            type="button"
            aria-label="Minimize"
            onClick={() => minimizeWindow(window.id)}
            className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[10px]"
          >
            _
          </button>

          {/* Maximize / Restore */}
          <button
            type="button"
            aria-label={window.maximized ? "Restore" : "Maximize"}
            onClick={() => toggleMaximizeWindow(window.id)}
            className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[10px]"
          >
            {window.maximized ? "❐" : "□"}
          </button>

          {/* Close */}
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            className="p-1 rounded hover:bg-[var(--color-error)] text-[var(--color-text-muted)] hover:text-white text-[10px]"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Frame Body / App Slot */}
      <div
        data-os-window-slot={window.id}
        className="flex-1 min-h-0 relative overflow-hidden"
      >
        {!owner.targetValid ? (
          <div
            data-os-target-unavailable="true"
            data-testid="window-target-unavailable"
            className="flex flex-col items-center justify-center p-6 text-center h-full bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3 select-none"
          >
            <span className="text-sm font-semibold text-[var(--color-text)]">
              Target Profile Unavailable
            </span>
            <p className="max-w-xs leading-relaxed">
              {owner.repairAffordance ??
                `Server profile '${window.ctx.profileId}' is missing or retired.`}
            </p>
          </div>
        ) : (
          children
        )}
      </div>

      {/* 8-Way Floating Resize Handles */}
      {window.mode === "float" && !window.maximized && (
        <>
          {RESIZE_HANDLES.map(({ dir, className }) => (
            <div
              key={dir}
              data-os-resize-handle={dir}
              onMouseDown={(e) => handleStartResize(dir, e)}
              className={`absolute z-40 select-none ${className}`}
            />
          ))}
        </>
      )}
      </div>
      <ConfirmDialog
        open={confirmCloseOpen}
        onClose={() => setConfirmCloseOpen(false)}
        onConfirm={() => {
          setConfirmCloseOpen(false);
          if (session.windows[window.id]) {
            closeWindow(window.id);
          }
        }}
        title="Discard Unsaved Changes?"
        description={`You have unsaved changes in ${filePath ?? "editor"}. Close anyway?`}
        confirmText="Discard and Close"
        cancelText="Cancel"
        variant="danger"
      />
    </>
  );
}
