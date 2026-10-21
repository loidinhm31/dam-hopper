import { type MouseEvent as ReactMouseEvent } from "react";
import { GitMerge, Maximize2, Minimize2, Move, X } from "lucide-react";
import type { ConflictSummaryEntry, OperationStatusResponse } from "@/api/client.js";

interface ConflictResolverToolbarProps {
  project: string;
  operation?: OperationStatusResponse | null;
  conflicts: readonly ConflictSummaryEntry[];
  selectedFilePath: string;
  onSelectFilePath: (path: string) => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onHide: () => void;
  onDragStart: (event: ReactMouseEvent) => void;
  onContinue?: () => void;
  onAbort?: () => void;
  isContinuing?: boolean;
  isAborting?: boolean;
}

export function ConflictResolverToolbar({
  project,
  operation,
  conflicts,
  selectedFilePath,
  onSelectFilePath,
  isMaximized,
  onToggleMaximize,
  onHide,
  onDragStart,
  onContinue,
  onAbort,
  isContinuing = false,
  isAborting = false,
}: ConflictResolverToolbarProps) {
  const opKind = operation?.operation ?? null;
  const opLabel = opKind && opKind !== "none" ? opKind.toUpperCase() : null;

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/90 px-3">
      {/* Title & drag handle */}
      <div
        className="flex min-w-0 flex-1 cursor-move items-center gap-2 select-none"
        onMouseDown={onDragStart}
        title="Drag conflict resolver panel"
      >
        <Move className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
        <GitMerge className="h-4 w-4 shrink-0 text-amber-400" />
        <span className="truncate text-xs font-semibold text-[var(--color-text)]">
          Git Conflict Resolver
        </span>

        {opLabel && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            {opLabel}
          </span>
        )}

        <span className="hidden text-[11px] text-[var(--color-text-muted)] sm:inline truncate">
          {project}
        </span>
      </div>

      {/* File selector when multiple conflicts */}
      {conflicts.length > 0 && (
        <div className="mx-2 flex shrink-0 items-center gap-1.5">
          <label htmlFor="resolver-file-select" className="text-[10px] text-[var(--color-text-muted)]">
            File ({conflicts.length}):
          </label>
          <select
            id="resolver-file-select"
            value={selectedFilePath}
            onChange={(e) => onSelectFilePath(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] text-[var(--color-text)] focus:outline-none"
            aria-label="Select conflicted file"
          >
            {conflicts.map((c) => (
              <option key={c.path} value={c.path}>
                {c.path} ({c.status})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Operation Continue and Abort buttons */}
      {opKind && opKind !== "none" && (
        <div className="flex shrink-0 items-center gap-1.5 mr-2">
          {onAbort && (
            <button
              type="button"
              disabled={!operation?.canAbort || isContinuing || isAborting}
              onClick={onAbort}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-2xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 disabled:opacity-40"
              title={
                !operation?.canAbort
                  ? `Cannot abort ${opLabel}`
                  : `Abort ${opLabel}`
              }
              aria-label={`Abort ${opLabel}`}
            >
              {isAborting ? "Aborting…" : "Abort"}
            </button>
          )}
          {onContinue && (
            <button
              type="button"
              disabled={
                !operation?.canContinue ||
                isContinuing ||
                isAborting ||
                conflicts.length > 0
              }
              onClick={onContinue}
              className="rounded bg-green-600 px-2 py-0.5 text-2xs font-semibold text-white shadow-sm transition-colors hover:bg-green-500 disabled:opacity-40"
              title={
                conflicts.length > 0
                  ? "Resolve all conflicts before continuing"
                  : !operation?.canContinue
                    ? `Cannot continue ${opLabel}`
                    : `Continue ${opLabel}`
              }
              aria-label={`Continue ${opLabel}`}
            >
              {isContinuing ? "Continuing…" : `Continue ${opLabel}`}
            </button>
          )}
        </div>
      )}

      {/* Window action buttons */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleMaximize}
          className="rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
          title={isMaximized ? "Restore resolver window" : "Maximize resolver window"}
          aria-label={isMaximized ? "Restore resolver window" : "Maximize resolver window"}
        >
          {isMaximized ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onHide}
          className="rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
          title="Hide conflict resolver"
          aria-label="Hide conflict resolver"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
