/**
 * SessionChangesPanel — Full read-only session review dialog panel.
 * Composes status, file list, and capability-free Monaco diff viewer.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  RefreshCw,
  Play,
  AlertTriangle,
  Clock,
  Layers,
  ShieldAlert,
  Loader2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn, generateUUID } from "@/lib/utils";
import type { ConnectionRef } from "@/api/ownership";
import { SessionChangesClientError } from "@/api/session-changes-client";
import type { FileRow, Comparison } from "@/api/session-changes-types";
import {
  useSessionChangesStatus,
  useSessionChangesFiles,
  useSessionChangesFileDetail,
  useSessionChangesRefreshMutation,
} from "@/api/session-changes-queries";
import { SessionChangedFilesList } from "./SessionChangedFilesList";
import { ReadonlyMonacoDiffViewer } from "./ReadonlyMonacoDiffViewer";
export interface SessionChangesPanelProps {
  owner: ConnectionRef;
  terminalId: string;
  terminalIncarnation: string;
  ompSessionId: string;
  rootId?: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onClose: () => void;
  className?: string;
}
interface SessionChangesReadyViewProps {
  owner: ConnectionRef;
  terminalId: string;
  terminalIncarnation: string;
  ompSessionId: string;
  rootId: string;
  serverEpoch: string;
  baselineId: string;
  initialComparison: Comparison | null;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  refreshError: Error | null;
  renderSideBySide: boolean;
  onToggleSideBySide: () => void;
}

function SessionChangesReadyView({
  owner,
  terminalId,
  terminalIncarnation,
  ompSessionId,
  rootId,
  serverEpoch,
  baselineId,
  initialComparison,
  onRefresh,
  isRefreshing,
  refreshError,
  renderSideBySide,
  onToggleSideBySide,
}: SessionChangesReadyViewProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [activeRevision, setActiveRevision] = useState<string | null>(
    initialComparison?.comparisonRevision ?? null,
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulatedFiles, setAccumulatedFiles] = useState<FileRow[]>([]);
  const lastRecoveredFailedKeyRef = useRef<string | null>(null);
  const isAutoRecoveringRef = useRef(false);
  const filesQuery = useSessionChangesFiles(
    owner,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    serverEpoch,
    baselineId,
    activeRevision,
    cursor,
    200,
    rootId,
  );

  const activeComparison =
    filesQuery.data?.comparison ?? initialComparison;
  const currentRevision =
    activeComparison?.comparisonRevision ?? activeRevision;

  useEffect(() => {
    if (initialComparison?.comparisonRevision) {
      setActiveRevision(initialComparison.comparisonRevision);
      setCursor(null);
      setAccumulatedFiles([]);
      setSelectedFileId(null);
    }
  }, [initialComparison?.comparisonRevision]);

  useEffect(() => {
    if (filesQuery.data?.comparison?.comparisonRevision) {
      setActiveRevision(filesQuery.data.comparison.comparisonRevision);
    }
  }, [filesQuery.data?.comparison?.comparisonRevision]);

  useEffect(() => {
    if (!filesQuery.data?.files) return;
    if (!cursor) {
      setAccumulatedFiles(filesQuery.data.files as FileRow[]);
    } else {
      setAccumulatedFiles((prev) => {
        const existingIds = new Set(prev.map((f) => f.fileId));
        const newFiles = (filesQuery.data?.files as FileRow[]).filter(
          (f) => !existingIds.has(f.fileId),
        );
        return [...prev, ...newFiles].slice(0, 500);
      });
    }
  }, [filesQuery.data?.files, cursor]);

  const files =
    accumulatedFiles.length > 0
      ? accumulatedFiles
      : (filesQuery.data?.files ?? []);

  useEffect(() => {
    if (
      files.length > 0 &&
      (!selectedFileId || !files.some((f) => f.fileId === selectedFileId))
    ) {
      setSelectedFileId(files[0].fileId);
    }
  }, [files, selectedFileId]);

  const detailQuery = useSessionChangesFileDetail(
    owner,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    serverEpoch,
    baselineId,
    currentRevision ?? "",
    selectedFileId ?? "",
    rootId,
    {
      enabled: Boolean(currentRevision && selectedFileId),
    },
  );
  useEffect(() => {
    const isStaleError = (err: unknown): err is SessionChangesClientError => {
      if (err instanceof SessionChangesClientError) {
        return (
          err.code === "refreshRequired" || err.code === "serverRestarted"
        );
      }
      return false;
    };

    const filesStale = isStaleError(filesQuery.error);
    const detailStale = isStaleError(detailQuery.error);

    if (!filesStale && !detailStale) {
      return;
    }

    if (isAutoRecoveringRef.current || isRefreshing) {
      return;
    }

    const requestedRev = filesStale
      ? (activeRevision ?? "bootstrap")
      : (currentRevision ?? "bootstrap");
    const failureKey = `${serverEpoch}:${baselineId}:${requestedRev}`;

    if (lastRecoveredFailedKeyRef.current === failureKey) {
      return;
    }

    lastRecoveredFailedKeyRef.current = failureKey;
    isAutoRecoveringRef.current = true;

    void (async () => {
      try {
        await onRefresh();
      } catch (err) {
        console.error("[SessionChanges] auto-recovery refresh failed:", err);
      } finally {
        isAutoRecoveringRef.current = false;
      }
    })();
  }, [
    filesQuery.error,
    detailQuery.error,
    onRefresh,
    isRefreshing,
    serverEpoch,
    baselineId,
    activeRevision,
    currentRevision,
  ]);

  return (
    <Group
      orientation="horizontal"
      className="flex-1 min-h-0 overflow-hidden"
      style={{ overflow: "clip" }}
    >
      {/* File list sidebar */}
      <Panel
        id="session-changes-files"
        defaultSize="26%"
        minSize="15%"
        maxSize="60%"
        className="flex flex-col h-full bg-[var(--color-surface-2)] min-w-0"
        style={{ overflow: "clip" }}
      >
        <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)] text-xs font-semibold flex items-center justify-between text-[var(--color-text-muted)]">
          <span>Changed Files ({files.length})</span>
          {activeComparison?.countsComplete && (
            <div className="flex items-center gap-1 font-mono text-[10px]">
              {activeComparison.additions != null && (
                <span className="text-emerald-500">+{activeComparison.additions}</span>
              )}
              {activeComparison.deletions != null && (
                <span className="text-rose-500">-{activeComparison.deletions}</span>
              )}
            </div>
          )}
        </div>

        {filesQuery.isError ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-xs text-rose-400 gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <span>
              Failed to load changed files:{" "}
              {filesQuery.error instanceof Error
                ? filesQuery.error.message
                : String(filesQuery.error)}
            </span>
            <button
              type="button"
              onClick={() => void filesQuery.refetch()}
              className="px-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
            >
              Retry Files
            </button>
          </div>
        ) : refreshError ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-xs text-rose-400 gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <span>Failed to compute comparison: {refreshError.message || "Scan failed"}</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="px-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
            >
              Retry Scan
            </button>
          </div>
        ) : filesQuery.isLoading || isRefreshing ? (
          <div className="flex-1 flex items-center justify-center p-4 text-center text-xs text-[var(--color-text-muted)]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span>{isRefreshing ? "Comparing tool-observed edits against current files…" : "Loading changed files…"}</span>
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-xs text-[var(--color-text-muted)] gap-2.5">
            <span>No file changes made by OMP agent yet.</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors shadow-sm cursor-pointer"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
              <span>{isRefreshing ? "Scanning..." : "Check for Changes"}</span>
            </button>
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <SessionChangedFilesList
              files={files}
              selectedFileId={selectedFileId}
              onSelectFile={setSelectedFileId}
              hasMore={Boolean(
                filesQuery.data?.nextCursor && files.length < 500,
              )}
              onLoadMore={() => {
                if (filesQuery.data?.nextCursor) {
                  setCursor(filesQuery.data.nextCursor);
                }
              }}
              isLoadingMore={filesQuery.isFetching && Boolean(cursor)}
            />
          </div>
        )}
      </Panel>
      <Separator
        aria-label="Resize files and diff panels"
        className="w-1.5 shrink-0 bg-[var(--color-border)] hover:bg-[var(--color-primary)] active:bg-[var(--color-primary)] transition-colors cursor-col-resize relative after:absolute after:inset-y-0 after:-inset-x-1.5 after:content-[''] z-10"
      />

      {/* Monaco Diff Viewer Area */}
      <Panel
        id="session-changes-diff"
        defaultSize="74%"
        minSize="35%"
        className="flex flex-col min-h-0 bg-[var(--color-surface)] min-w-0"
        style={{ overflow: "clip" }}
      >
        {detailQuery.isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
          </div>
        ) : detailQuery.isError ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-xs text-rose-400 gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <span>
              Failed to load file diff:{" "}
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : String(detailQuery.error)}
            </span>
            <button
              type="button"
              onClick={() => void detailQuery.refetch()}
              className="px-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
            >
              Retry Diff
            </button>
          </div>
        ) : detailQuery.data ? (
          <ReadonlyMonacoDiffViewer
            fileDetail={detailQuery.data}
            owner={owner}
            terminalId={terminalId}
            terminalIncarnation={terminalIncarnation}
            ompSessionId={ompSessionId}
            rootId={rootId}
            renderSideBySide={renderSideBySide}
            onToggleSideBySide={onToggleSideBySide}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
            Select a file to review diff
          </div>
        )}
      </Panel>
    </Group>
  );
}

export function SessionChangesPanel({
  owner,
  terminalId,
  terminalIncarnation,
  ompSessionId,
  rootId = ".",
  isMaximized,
  onToggleMaximize,
  onClose,
  className,
}: SessionChangesPanelProps) {
  const [renderSideBySide, setRenderSideBySide] = useState(true);

  const refreshMutation = useSessionChangesRefreshMutation(owner);

  // Status query
  const statusQuery = useSessionChangesStatus(
    owner,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    rootId,
  );

  const status = statusQuery.data;
  const isReadyOrIncomplete =
    status?.state === "ready" || status?.state === "incomplete";
  const baselineId = status?.baselineId;
  const serverEpoch = status?.serverEpoch;

  const isRefreshMatchingCurrentIdentity =
    refreshMutation.variables?.serverEpoch === serverEpoch &&
    refreshMutation.variables?.baselineId === baselineId;

  const currentRefreshData = isRefreshMatchingCurrentIdentity
    ? refreshMutation.data
    : null;
  const currentRefreshError = isRefreshMatchingCurrentIdentity
    ? refreshMutation.error
    : null;
  const isRefreshing = isRefreshMatchingCurrentIdentity
    ? refreshMutation.isPending
    : false;

  const { mutateAsync } = refreshMutation;
  const handleRefresh = useCallback(async () => {
    if (!serverEpoch || !baselineId) return;
    try {
      await mutateAsync({
        terminalId,
        terminalIncarnation,
        ompSessionId,
        rootId,
        serverEpoch,
        baselineId,
        requestId: generateUUID(),
      });
    } catch (err) {
      console.error("[SessionChanges] scan failed:", err);
    }
  }, [
    serverEpoch,
    baselineId,
    mutateAsync,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    rootId,
  ]);
  return (
    <div
      className={cn(
        "flex flex-col h-full w-full bg-[var(--color-surface-1)] text-[var(--color-text)] overflow-hidden rounded-lg border border-[var(--color-border)] shadow-2xl",
        className,
      )}
      data-testid="session-changes-panel"
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
          <h3 className="text-sm font-semibold truncate">Session Changes</h3>
          {status && (
            <span
              className={cn(
                "px-2 py-0.5 rounded text-[10px] uppercase font-mono font-bold tracking-wider",
                status.state === "ready"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : status.state === "incomplete"
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : status.state === "initializing"
                      ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      : "bg-rose-500/10 text-rose-400 border border-rose-500/20",
              )}
            >
              {status.state}
            </span>
          )}
          {status?.origin && (
            <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
              ({status.origin})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isReadyOrIncomplete && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Refresh comparison"
              title="Refresh comparison against current files"
              className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={cn(
                  "w-3.5 h-3.5",
                  isRefreshing && "animate-spin",
                )}
              />
            </button>
          )}
          {onToggleMaximize && (
            <button
              type="button"
              onClick={onToggleMaximize}
              aria-label={isMaximized ? "Restore panel size" : "Maximize panel"}
              title={isMaximized ? "Restore" : "Maximize"}
              className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
            >
              {isMaximized ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close session changes review"
            title="Close"
            className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Shared writers disclaimer & coverage warning banner */}
      <div className="shrink-0 px-4 py-1.5 bg-[var(--color-surface-2)]/60 border-b border-[var(--color-border)] flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5 truncate">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>
            Tool-observed edits since first touch. External writers and unobserved script modifications are tracked in Git Changes.
          </span>
        </span>
        {status?.capturedAtMs && (
          <span className="flex items-center gap-1 shrink-0 font-mono text-[10px]">
            <Clock className="w-3 h-3" />
            {new Date(status.capturedAtMs).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Body content based on state */}
      {statusQuery.isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-text-muted)]" />
        </div>
      ) : statusQuery.isError ? (
        <div
          className="flex-1 flex flex-col items-center justify-center p-8 text-center text-rose-400 gap-2"
          data-testid="session-status-error-view"
        >
          <AlertTriangle className="w-12 h-12 text-rose-400 mb-2 opacity-80" />
          <h4 className="text-base font-semibold mb-1">
            Failed to load session changes status
          </h4>
          <p className="text-xs text-[var(--color-text-muted)] max-w-sm mb-4">
            {statusQuery.error instanceof Error
              ? statusQuery.error.message
              : String(statusQuery.error)}
          </p>
          <button
            type="button"
            onClick={() => void statusQuery.refetch()}
            className="px-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
          >
            Retry Status
          </button>
        </div>
      ) : !isReadyOrIncomplete ? (
        // Missing, Unavailable, or Initializing
        <div
          className="flex-1 flex flex-col items-center justify-center p-8 text-center"
          data-testid="session-unavailable-view"
        >
          <AlertTriangle className="w-12 h-12 text-amber-400 mb-3 opacity-80" />
          <h4 className="text-base font-semibold mb-1">
            {status?.state === "initializing"
              ? "Connecting to OMP Session..."
              : "No OMP Session Baseline"}
          </h4>
          <p className="text-xs text-[var(--color-text-muted)] max-w-sm mb-4">
            {status?.state === "initializing"
              ? "Connecting to OMP Session... Restart active OMP sessions if Session Changes was recently enabled."
              : "No file changes made by OMP agent yet. Supported tools (edit, write) capture original file states on first touch."}
          </p>
        </div>
      ) : (
        <SessionChangesReadyView
          key={`${serverEpoch}:${baselineId}`}
          owner={owner}
          terminalId={terminalId}
          terminalIncarnation={terminalIncarnation}
          ompSessionId={ompSessionId}
          rootId={rootId}
          serverEpoch={serverEpoch!}
          baselineId={baselineId!}
          initialComparison={currentRefreshData ?? status?.comparison ?? null}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          refreshError={currentRefreshError}
          renderSideBySide={renderSideBySide}
          onToggleSideBySide={() => setRenderSideBySide(!renderSideBySide)}
        />
      )}
    </div>
  );
}
