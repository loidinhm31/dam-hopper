import {
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CheckCircle2, Grip, Loader2, X } from "lucide-react";
import type { ProjectTargetInput } from "@/api/client.js";
import { useConflictResolver } from "@/hooks/use-conflict-resolver.js";
import { useFloatingPanelGeometry } from "@/hooks/use-floating-panel-geometry.js";
import { TERMINAL_FLOATING_PANEL_TOPMOST_Z_INDEX } from "@/lib/terminal-workspace-panel.js";
import {
  clampResolverPanelLayout,
  handleResolverPanelKeyDown,
  INITIAL_RESOLVER_PANEL_LAYOUT,
  type ResolverPanelLayout,
} from "@/lib/conflict-resolver-panel-state.js";
import { ConflictResolverToolbar } from "./ConflictResolverToolbar.js";
import { MergeConflictEditor } from "./MergeConflictEditor.js";

export interface ConflictRevealIntent {
  nonce: number;
  filePath?: string;
  root?: string;
}

interface ConflictResolverPanelProps {
  open: boolean;
  project: string;
  target?: ProjectTargetInput;
  targetAvailable?: boolean;
  root?: string;
  initialFilePath?: string;
  revealIntent?: ConflictRevealIntent | null;
  zIndex?: number;
  isTopmost?: boolean;
  onActivate?: () => void;
  onHide: () => void;
}

export function ConflictResolverPanel({
  open,
  project,
  target,
  targetAvailable = true,
  root: propRoot,
  initialFilePath,
  revealIntent,
  zIndex = TERMINAL_FLOATING_PANEL_TOPMOST_Z_INDEX,
  isTopmost = true,
  onActivate,
  onHide,
}: ConflictResolverPanelProps) {
  const effectiveRoot = revealIntent ? revealIntent.root : propRoot;
  const resolver = useConflictResolver(target ?? project, effectiveRoot);
  const conflicts = resolver.conflicts;
  const [selectedFilePath, setSelectedFilePath] = useState<string>(
    revealIntent?.filePath ??
      initialFilePath ??
      (conflicts.length > 0 ? conflicts[0].path : ""),
  );
  const [isContinuing, setIsContinuing] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const {
    boundsRef,
    panelRef,
    layout,
    handleDragStart,
    handleResizeStart,
    toggleMaximize,
  } = useFloatingPanelGeometry<ResolverPanelLayout>({
    initialLayout: INITIAL_RESOLVER_PANEL_LAYOUT,
    clampLayout: clampResolverPanelLayout,
  });
  const lastConsumedNonceRef = useRef<number | null>(null);

  useEffect(() => {
    if (revealIntent && lastConsumedNonceRef.current !== revealIntent.nonce) {
      lastConsumedNonceRef.current = revealIntent.nonce;
      if (revealIntent.filePath) {
        setSelectedFilePath(revealIntent.filePath);
      } else if (conflicts.length > 0) {
        setSelectedFilePath(conflicts[0].path);
      } else {
        setSelectedFilePath("");
      }
    }
  }, [conflicts, revealIntent]);

  useEffect(() => {
    if (
      conflicts.length > 0 &&
      !conflicts.some((c) => c.path === selectedFilePath)
    ) {
      setSelectedFilePath(conflicts[0].path);
    }
  }, [conflicts, selectedFilePath]);
  const handleContinue = async () => {
    setIsContinuing(true);
    setOperationError(null);
    try {
      const outcome = await resolver.continueOperation();
      if (outcome.outcome !== "continued") {
        if ("error" in outcome && outcome.error) {
          setOperationError(outcome.error);
        } else if ("reason" in outcome && outcome.reason) {
          setOperationError(outcome.reason);
        }
      }
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "Continue failed");
    } finally {
      setIsContinuing(false);
    }
  };

  const handleAbort = async () => {
    const op = resolver.operation?.operation ?? "operation";
    if (
      !window.confirm(
        `Abort ${op.toUpperCase()}? This will discard uncommitted merge resolutions and clean the worktree.`,
      )
    ) {
      return;
    }
    setIsAborting(true);
    setOperationError(null);
    try {
      const outcome = await resolver.abortOperation(true);
      if (outcome.outcome === "aborted") {
        onHide();
      } else if ("error" in outcome && outcome.error) {
        setOperationError(outcome.error);
      }
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "Abort failed");
    } finally {
      setIsAborting(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const activeEl = document.activeElement;

      // Only handle Escape if focus is inside this panel (or at root document/body)
      if (
        panelRef.current &&
        activeEl &&
        activeEl !== document.body &&
        !panelRef.current.contains(activeEl)
      ) {
        return;
      }

      // If Monaco suggest or find widget or context menu is visible, let Monaco consume Escape
      const hasVisibleMonacoWidget =
        panelRef.current?.querySelector(
          ".monaco-editor .suggest-widget.visible, .monaco-editor .find-widget.visible",
        ) || document.querySelector(".monaco-menu-container");
      if (hasVisibleMonacoWidget) return;
      handleResolverPanelKeyDown(event, onHide, isTopmost);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isTopmost, onHide, open, panelRef]);

  if (!open) return null;

  return (
    <div
      ref={boundsRef}
      className="pointer-events-none fixed inset-0 z-40"
      style={{ zIndex }}
      data-testid="conflict-resolver-overlay"
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className="pointer-events-auto absolute flex min-h-0 max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl backdrop-blur-xl"
        style={{
          top: layout.top,
          left: layout.left ?? undefined,
          right: layout.left === null ? 12 : undefined,
          width: layout.width,
          height: layout.height,
        }}
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
        data-testid="conflict-resolver-panel"
      >
        <ConflictResolverToolbar
          project={project}
          operation={resolver.operation}
          conflicts={conflicts}
          selectedFilePath={selectedFilePath}
          onSelectFilePath={setSelectedFilePath}
          isMaximized={layout.isMaximized}
          onToggleMaximize={toggleMaximize}
          onHide={onHide}
          onDragStart={handleDragStart}
          onContinue={handleContinue}
          onAbort={handleAbort}
          isContinuing={isContinuing}
          isAborting={isAborting}
        />

        {/* Terminal handoff guidance banner */}
        {resolver.terminalHandoff && (
          <div
            role="alert"
            className="shrink-0 flex items-center justify-between gap-3 border-b border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[11px] text-blue-300"
          >
            <span>
              {resolver.terminalHandoff.reason === "messageEditRequired"
                ? "Commit message editing required in Git's configured editor."
                : `Action required (${resolver.terminalHandoff.reason}).`}{" "}
              Return to terminal in{" "}
              <strong>{resolver.terminalHandoff.worktreeRoot}</strong> to finish.
            </span>
            <button
              type="button"
              onClick={() => {
                if (!resolver.terminalHandoff) return;
                void resolver
                  .refreshAfterTerminalReturn(resolver.terminalHandoff)
                  .catch((err) => {
                    setOperationError(
                      err instanceof Error ? err.message : "Refresh failed",
                    );
                  });
              }}
              className="rounded border border-blue-300/40 px-2 py-1 hover:bg-blue-300/20"
            >
              Refresh after terminal return
            </button>
          </div>
        )}

        {/* Operation error banner */}
        {operationError && (
          <div
            role="alert"
            className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-[var(--color-danger)] text-[11px]"
          >
            <span>{operationError}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setOperationError(null)}
            >
              <X className="h-3 w-3 opacity-60 hover:opacity-100" />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedFilePath ? (
            <MergeConflictEditor
              key={`${project}:${effectiveRoot ?? "root"}:${selectedFilePath}`}
              project={project}
              target={target}
              targetAvailable={targetAvailable}
              filePath={selectedFilePath}
              root={effectiveRoot}
              onClose={onHide}
              onResolved={() => {
                resolver.refetchAll();
              }}
            />
          ) : resolver.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              Loading conflict status…
            </div>
          ) : resolver.inventoryError ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center text-xs text-[var(--color-danger)]">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-semibold">Conflict inventory unavailable</span>
              <span className="text-2xs text-[var(--color-text-muted)] max-w-sm">
                {resolver.inventoryError}
              </span>
              <button
                type="button"
                onClick={() => void resolver.refetchAll()}
                className="mt-2 rounded border border-[var(--color-border)] px-3 py-1 text-2xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
              >
                Retry
              </button>
            </div>
          ) : resolver.operation?.stoppedReason === "messageEditRequired" ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-blue-400" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  Commit message editing required
                </h3>
                <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
                  Git requires editing the commit message in your configured terminal editor.
                  Switch to the terminal in{" "}
                  <strong className="text-[var(--color-text)]">
                    {resolver.terminalHandoff?.worktreeRoot ??
                      resolver.operation.terminalHandoffRequired?.worktreeRoot ??
                      project}
                  </strong>{" "}
                  to finish.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (resolver.terminalHandoff) {
                    void resolver
                      .refreshAfterTerminalReturn(resolver.terminalHandoff)
                      .catch((err) => {
                        setOperationError(
                          err instanceof Error ? err.message : "Refresh failed",
                        );
                      });
                  } else {
                    void resolver.refetchAll();
                  }
                }}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
              >
                Refresh after terminal return
              </button>
            </div>
          ) : resolver.operation && resolver.operation.operation !== "none" ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-400" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  All conflicts resolved
                </h3>
                <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
                  All conflicted files have been resolved. You can now continue the{" "}
                  <strong className="text-[var(--color-text)] uppercase">
                    {resolver.operation.operation}
                  </strong>{" "}
                  operation.
                </p>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {resolver.operation.canContinue && (
                  <button
                    type="button"
                    disabled={isContinuing || isAborting}
                    onClick={handleContinue}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-green-500 disabled:opacity-50"
                  >
                    {isContinuing
                      ? "Continuing…"
                      : `Continue ${resolver.operation.operation.toUpperCase()}`}
                  </button>
                )}
                {resolver.operation.canAbort && (
                  <button
                    type="button"
                    disabled={isContinuing || isAborting}
                    onClick={handleAbort}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
                  >
                    {isAborting
                      ? "Aborting…"
                      : `Abort ${resolver.operation.operation.toUpperCase()}`}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
              No conflict selected or all conflicts resolved.
            </div>
          )}
        </div>

        {!layout.isMaximized && (
          <button
            type="button"
            onMouseDown={handleResizeStart}
            className="absolute bottom-2 right-2 z-20 rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            title="Resize conflict resolver"
            aria-label="Resize conflict resolver"
          >
            <Grip className="h-4 w-4" />
          </button>
        )}
      </section>
    </div>
  );
}
