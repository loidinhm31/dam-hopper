import { useState, useCallback, useMemo, useEffect } from "react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import { useWindowStore } from "../window-store.js";
import { useConflictResolver } from "@/hooks/use-conflict-resolver.js";
import { ConflictResolverToolbar } from "@/components/organisms/ConflictResolverToolbar.js";
import { MergeConflictEditor } from "@/components/organisms/MergeConflictEditor.js";
import { normalizeProjectTarget } from "@/api/client.js";
import { AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";

export interface ConflictResolverAppProps {
  window: OsWindow;
}

export function ConflictResolverApp({ window }: ConflictResolverAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const project = window.ctx.projectId ?? "";
  const worktreeId = window.ctx.worktreeId;
  const root = (window.appState?.root as string | undefined) ?? window.ctx.gitRootId;
  const initialFilePath = window.appState?.filePath as string | undefined;

  const closeWindow = useWindowStore((state) => state.closeWindow);
  const [confirmAbortOp, setConfirmAbortOp] = useState<string | null>(null);

  const target = useMemo(
    () =>
      normalizeProjectTarget({
        profileId,
        project,
        worktreePath: worktreeId,
      }),
    [profileId, project, worktreeId],
  );

  const requestedOperation =
    (window.appState?.operation as string | undefined) ?? window.ctx.operation;

  const resolver = useConflictResolver(target, root);
  const conflicts = resolver.conflicts;

  const claimKey = useMemo<ResourceClaimKey>(
    () => ({
      resourceKind: "conflict-resolver",
      profileId,
      generation: owner.generation,
      resourceId: `${project}:${worktreeId ?? "root"}:${root ?? "root"}:${requestedOperation ?? resolver.operation?.operation ?? "none"}`,
    }),
    [
      profileId,
      owner.generation,
      project,
      worktreeId,
      root,
      requestedOperation,
      resolver.operation?.operation,
    ],
  );

  const claimStatus = useResourceClaim(claimKey, window.id);

  const [selectedFilePath, setSelectedFilePath] = useState<string>(
    initialFilePath ?? (conflicts.length > 0 ? conflicts[0].path : ""),
  );
  const [isContinuing, setIsContinuing] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  useEffect(() => {
    if (
      conflicts.length > 0 &&
      !conflicts.some((c) => c.path === selectedFilePath)
    ) {
      setSelectedFilePath(conflicts[0].path);
    }
  }, [conflicts, selectedFilePath]);

  const handleContinue = useCallback(async () => {
    const liveOp = resolver.operation?.operation;
    if (
      requestedOperation !== undefined &&
      (!liveOp || liveOp === "none" || liveOp !== requestedOperation)
    ) {
      return;
    }
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
  }, [resolver, requestedOperation]);

  const handleAbort = useCallback(() => {
    const liveOp = resolver.operation?.operation;
    if (
      requestedOperation !== undefined &&
      (!liveOp || liveOp === "none" || liveOp !== requestedOperation)
    ) {
      return;
    }
    const op = liveOp ?? "operation";
    setConfirmAbortOp(op);
  }, [resolver.operation?.operation, requestedOperation]);

  const executeAbort = useCallback(async () => {
    const expectedOp = confirmAbortOp;
    setConfirmAbortOp(null);
    if (!expectedOp) return;
    const currentOp = resolver.operation?.operation;
    if (currentOp !== expectedOp) {
      setOperationError("Conflict operation changed while confirmation was pending; abort cancelled.");
      return;
    }
    setIsAborting(true);
    setOperationError(null);
    try {
      const outcome = await resolver.abortOperation(true);
      if (outcome.outcome === "aborted") {
        closeWindow(window.id);
      } else if ("error" in outcome && outcome.error) {
        setOperationError(outcome.error);
      }
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "Abort failed");
    } finally {
      setIsAborting(false);
    }
  }, [confirmAbortOp, resolver, closeWindow, window.id]);

  if (!claimStatus.success) {
    return (
      <div
        data-os-claim-denied="true"
        data-testid="conflict-resolver-claim-denied"
        className="flex flex-col items-center justify-center p-6 text-center h-full bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3"
      >
        <p>Conflict Resolver is already active in another window for this root.</p>
      </div>
    );
  }
  if (resolver.isLoading) {
    return (
      <div
        data-os-conflict-resolver-loading="true"
        data-testid="conflict-resolver-loading"
        className="flex h-full items-center justify-center gap-2 text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)]"
      >
        <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
        Loading conflict status…
      </div>
    );
  }

  const liveOperation = resolver.operation?.operation;
  const requestedOperationUnavailable =
    requestedOperation !== undefined &&
    (!liveOperation ||
      liveOperation === "none" ||
      liveOperation !== requestedOperation);

  if (requestedOperationUnavailable) {
    return (
      <div
        data-os-operation-mismatch="true"
        data-testid="conflict-resolver-operation-mismatch"
        className="flex flex-col items-center justify-center p-6 text-center h-full bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3"
      >
        <p className="font-semibold text-sm text-[var(--color-text)]">
          Operation Mismatch
        </p>
        <p className="max-w-md">
          {liveOperation && liveOperation !== "none"
            ? `Requested operation "${requestedOperation}" does not match the active git operation "${liveOperation}".`
            : `Requested operation "${requestedOperation}" is not currently active for this repository.`}
        </p>
      </div>
    );
  }

  const isNoOperation =
    (!liveOperation || liveOperation === "none") && conflicts.length === 0;
  return (
    <div
      data-os-conflict-resolver-app={window.id}
      data-testid={`conflict-resolver-app-${window.id}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
        }
      }}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      {/* Operation Toolbar */}
      {resolver.operation && resolver.operation.operation !== "none" && (
        <ConflictResolverToolbar
          project={project}
          operation={resolver.operation}
          conflicts={conflicts}
          selectedFilePath={selectedFilePath}
          onSelectFilePath={setSelectedFilePath}
          isMaximized={false}
          onToggleMaximize={() => {}}
          onHide={() => closeWindow(window.id)}
          onDragStart={() => {}}
          onContinue={handleContinue}
          onAbort={handleAbort}
          isContinuing={isContinuing}
          isAborting={isAborting}
        />
      )}

      {/* Operation error banner */}
      {operationError && (
        <div
          role="alert"
          className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-[var(--color-danger)] text-xs"
        >
          <span>{operationError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setOperationError(null)}
            className="hover:opacity-80"
          >
            ✕
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 relative">
        {isNoOperation ? (
          <div
            data-testid="resolver-no-operation"
            className="flex flex-col items-center justify-center h-full p-6 text-center text-xs text-[var(--color-text-muted)] gap-3"
          >
            <CheckCircle2 className="h-8 w-8 text-[var(--color-success)]" />
            <div className="space-y-1">
              <p className="font-semibold text-sm text-[var(--color-text)]">
                No active conflicts
              </p>
              <p className="max-w-sm text-2xs text-[var(--color-text-muted)]">
                There are no active merge or rebase conflicts requiring resolution in this workspace.
              </p>
            </div>
          </div>
        ) : selectedFilePath ? (
          <MergeConflictEditor
            key={`${project}:${root ?? "root"}:${selectedFilePath}`}
            project={project}
            target={target}
            targetAvailable={true}
            filePath={selectedFilePath}
            root={root}
            onClose={() => closeWindow(window.id)}
            onResolved={() => {
              resolver.refetchAll();
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center text-xs text-[var(--color-text-muted)]">
            <AlertTriangle className="h-6 w-6 text-amber-400" />
            <span>Select a conflicted file to begin resolution</span>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(confirmAbortOp)}
        onClose={() => setConfirmAbortOp(null)}
        onConfirm={executeAbort}
        title="Abort Conflict Resolution?"
        description={`Abort ${(confirmAbortOp ?? "operation").toUpperCase()}? This will discard uncommitted merge resolutions and clean the worktree.`}
        confirmText="Abort and Discard"
        cancelText="Keep Resolving"
        variant="danger"
      />
    </div>
  );
}
