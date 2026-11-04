import { useState, useRef, useEffect } from "react";
import { useWindowStore } from "./window-store.js";
import type { OsWindow } from "./types.js";
import { useEditorStore } from "@/stores/editor.js";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";

export interface WindowListProps {
  className?: string;
}

export function WindowList({ className = "" }: WindowListProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; filePath?: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const session = useWindowStore((state) => state.session);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);
  const closeWindow = useWindowStore((state) => state.closeWindow);

  const activeDesktopId = session.activeDesktopId;
  const currentDesktopWindows = Object.values(session.windows).filter(
    (w) => w.desktopId === activeDesktopId,
  );
  const totalWindows = Object.keys(session.windows).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleSelectWindow = (win: OsWindow) => {
    if (win.desktopId !== activeDesktopId) {
      switchDesktop(win.desktopId);
    }
    if (win.minimized) {
      restoreWindow(win.id);
    }
    focusWindow(win.id);
    setIsOpen(false);
  };

  const handleCloseWindow = (win: OsWindow) => {
    if (win.appId === "editor") {
      const filePath = win.appState?.filePath as string | undefined;
      const targetProject = win.ctx.projectId;
      const targetWorktree = win.ctx.worktreeId;
      const targetProfile = win.ctx.profileId;

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
        setConfirmTarget({ id: win.id, filePath });
        return;
      }
    }
    closeWindow(win.id);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label="Window list"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span>Windows</span>
        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] font-mono">
          {currentDesktopWindows.length}
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Windows on current desktop"
          className="absolute right-0 mt-1 w-64 max-h-80 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl p-1 z-50 text-xs"
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold border-b border-[var(--color-border)] mb-1">
            Active Desktop ({currentDesktopWindows.length})
          </div>

          {currentDesktopWindows.length === 0 ? (
            <div className="px-3 py-2 text-center text-[var(--color-text-muted)]">
              No open windows
            </div>
          ) : (
            currentDesktopWindows.map((win) => {
              const isMinimized = win.minimized;
              const isTile = win.mode === "tile";
              return (
                <div
                  key={win.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[var(--color-surface-hover)] group transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleSelectWindow(win)}
                    className="flex-1 flex items-center gap-2 text-left truncate mr-2"
                  >
                    <span
                      className={`text-[10px] uppercase font-mono px-1 py-0.2 rounded border ${
                        isMinimized
                          ? "border-[var(--color-warning)] text-[var(--color-warning)]"
                          : isTile
                            ? "border-[var(--color-border)] text-[var(--color-text-muted)]"
                            : "border-[var(--color-primary)] text-[var(--color-primary)]"
                      }`}
                    >
                      {isMinimized ? "min" : win.mode}
                    </span>
                    <span className="truncate font-medium text-[var(--color-text)]">
                      {win.title}
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-label={`Close ${win.title}`}
                    onClick={() => handleCloseWindow(win)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}

          {totalWindows > currentDesktopWindows.length && (
            <div className="mt-2 pt-1 border-t border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
              {totalWindows - currentDesktopWindows.length} windows on other
              desktops
            </div>
          )}
        </div>
      )}
      {confirmTarget && (
        <ConfirmDialog
          open={Boolean(confirmTarget)}
          onClose={() => setConfirmTarget(null)}
          onConfirm={() => {
            if (confirmTarget && session.windows[confirmTarget.id]) {
              closeWindow(confirmTarget.id);
            }
            setConfirmTarget(null);
          }}
          title="Discard Unsaved Changes?"
          description={`You have unsaved changes in ${confirmTarget.filePath ?? "editor"}. Close anyway?`}
          confirmText="Discard and Close"
          cancelText="Cancel"
          variant="danger"
        />
      )}
    </div>
  );
}
