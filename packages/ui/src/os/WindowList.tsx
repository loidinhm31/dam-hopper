import { useState, useRef, useEffect, useCallback } from "react";
import { useWindowStore } from "./window-store.js";
import type { OsWindow } from "./types.js";
import { useEditorStore } from "@/stores/editor.js";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";
import {
  useShellInputContext,
  type ShellInputContextValue,
} from "./shell-input-context.js";
import {
  useTerminalClose,
  type TerminalCloseContextValue,
} from "./terminal-close-context.js";
import {
  resolveWindowTerminalObservation,
  type ReviewTarget,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import { useAggregatedTerminalSessions } from "@/hooks/use-aggregated-terminal-sessions.js";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { closeReviewTargetSafely } from "@/api/session-changes-queries.js";

export interface WindowListProps {
  className?: string;
}

export function WindowList({ className = "" }: WindowListProps) {
  let shellInput: ShellInputContextValue | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    shellInput = useShellInputContext();
  } catch {
    // Optional context for standalone testing
  }

  let terminalClose: TerminalCloseContextValue | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    terminalClose = useTerminalClose();
  } catch {
    // Optional context for standalone testing
  }

  let qc: QueryClient | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    qc = useQueryClient();
  } catch {
    // Optional context for standalone testing
  }
  const { observations } = useAggregatedTerminalSessions();
  const [localIsOpen, setLocalIsOpen] = useState(false);
  const isOpen = shellInput
    ? shellInput.activeNonmodal === "window-list"
    : localIsOpen;

  const setIsOpen = useCallback(
    (open: boolean) => {
      if (shellInput) {
        shellInput.setSurfaceOpen("window-list", open);
      } else {
        setLocalIsOpen(open);
      }
    },
    [shellInput],
  );

  const [confirmTarget, setConfirmTarget] = useState<{
    id: string;
    filePath?: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Register modal mount for confirmDialog
  useEffect(() => {
    if (confirmTarget !== null && shellInput) {
      return shellInput.registerModalMount("confirm-dialog");
    }
  }, [confirmTarget, shellInput]);

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
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (confirmTarget !== null) return;
      const target = event.target as HTMLElement | null;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !target?.closest?.('[data-os-nonmodal-trigger="window-list"]')
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (confirmTarget !== null) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, confirmTarget, setIsOpen]);

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
    if (win.appId === "session-changes") {
      const target = win.runtimeIdentity?.kind === "review"
        ? (win.runtimeIdentity.target as ReviewTarget)
        : (win.appState?.target as ReviewTarget | undefined);
      if (target && qc) {
        closeReviewTargetSafely(
          qc,
          target,
          win.id,
          useWindowStore.getState().session.windows,
        );
      }
      closeWindow(win.id);
      return;
    }
    if (win.appId === "terminals") {
      const { target, availability } = resolveWindowTerminalObservation(
        win,
        observations,
      );
      const effectiveTarget =
        target ??
        (win.runtimeIdentity?.kind === "terminal"
          ? (win.runtimeIdentity.target as TerminalTarget)
          : null) ??
        ((win.appState?.target ?? win.appState?.terminalTarget) as
          | TerminalTarget
          | undefined) ??
        null;

      if (terminalClose) {
        terminalClose.requestTerminalClose(
          {
            windowId: win.id,
            entry: "window-list",
            target: effectiveTarget,
            availability,
          },
          (wId) => {
            closeWindow(wId);
          },
        );
        return;
      }

      closeWindow(win.id);
      return;
    }
    closeWindow(win.id);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label="Window list"
        aria-expanded={isOpen}
        data-os-nonmodal-trigger="window-list"
        onClick={() => setIsOpen(!isOpen)}
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
          data-os-nonmodal-surface="window-list"
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
