/**
 * SessionChangesPanel — Full read-only session review dialog panel.
 * Composes status, file list, and capability-free Monaco diff viewer.
 */

import React, { useState, useEffect } from "react";
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
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

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
  const comparison = status?.comparison ?? refreshMutation.data;
  const revision = comparison?.comparisonRevision;
  const baselineId = status?.baselineId;
  const serverEpoch = status?.serverEpoch;

  const isReadyOrIncomplete =
    status?.state === "ready" || status?.state === "incomplete";

  // Files query
  const filesQuery = useSessionChangesFiles(
    owner,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    serverEpoch ?? "",
    baselineId ?? "",
    revision ?? "",
    null,
    200,
    {
      enabled: Boolean(isReadyOrIncomplete && serverEpoch && baselineId && revision),
    },
  );

  const files = filesQuery.data?.files ?? [];

  // Automatically select first file when files load and none selected
  useEffect(() => {
    if (files.length > 0 && (!selectedFileId || !files.some((f) => f.fileId === selectedFileId))) {
      setSelectedFileId(files[0].fileId);
    }
  }, [files, selectedFileId]);

  // File detail query
  const detailQuery = useSessionChangesFileDetail(
    owner,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    serverEpoch ?? "",
    baselineId ?? "",
    revision ?? "",
    selectedFileId ?? "",
    {
      enabled: Boolean(
        isReadyOrIncomplete &&
          serverEpoch &&
          baselineId &&
          revision &&
          selectedFileId,
      ),
    },
  );

  const handleRefresh = async () => {
    if (!serverEpoch || !baselineId) return;
    try {
      await refreshMutation.mutateAsync({
        terminalId,
        terminalIncarnation,
        ompSessionId,
        serverEpoch,
        baselineId,
        requestId: generateUUID(),
      });
    } catch (err) {
      console.error("[SessionChanges] scan failed:", err);
    }
  };
  const hasTriggeredRef = React.useRef(false);
  // Automatically trigger comparison scan on ready baseline if none yet computed
  useEffect(() => {
    if (
      isReadyOrIncomplete &&
      serverEpoch &&
      baselineId &&
      !comparison &&
      !refreshMutation.isPending &&
      !refreshMutation.isError &&
      !hasTriggeredRef.current
    ) {
      hasTriggeredRef.current = true;
      handleRefresh();
    }
  }, [isReadyOrIncomplete, serverEpoch, baselineId, comparison, refreshMutation.isPending, refreshMutation.isError]);


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
              disabled={refreshMutation.isPending}
              aria-label="Refresh comparison"
              title="Refresh comparison against current files"
              className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", refreshMutation.isPending && "animate-spin")}
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
            Read-only comparison against session start. External writers may edit concurrently.
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
              ? "The baseline is currently being captured before model turns run. Please wait a moment."
              : "No baseline was captured for this session yet. When an OMP agent executes commands in this terminal, changes will be tracked automatically."}
          </p>
        </div>
      ) : (
        // Ready or Incomplete comparison view with resizable panels
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
              {comparison?.countsComplete && (
                <div className="flex items-center gap-1 font-mono text-[10px]">
                  {comparison.additions != null && (
                    <span className="text-emerald-500">+{comparison.additions}</span>
                  )}
                  {comparison.deletions != null && (
                    <span className="text-rose-500">-{comparison.deletions}</span>
                  )}
                </div>
              )}
            </div>

            {refreshMutation.isError ? (
              <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-xs text-rose-400 gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
                <span>Failed to compute comparison: {refreshMutation.error?.message || "Scan failed"}</span>
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshMutation.isPending}
                  className="px-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
                >
                  Retry Scan
                </button>
              </div>
            ) : filesQuery.isLoading || refreshMutation.isPending ? (
              <div className="flex-1 flex items-center justify-center p-4 text-center text-xs text-[var(--color-text-muted)]">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span>{refreshMutation.isPending ? "Scanning repository files against session start…" : "Loading changed files…"}</span>
              </div>
            ) : files.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-xs text-[var(--color-text-muted)] gap-2.5">
                <span>
                  {status?.state === "incomplete"
                    ? "No changes detected yet in covered paths."
                    : "No file changes made by OMP agent yet."}
                </span>
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors shadow-sm cursor-pointer"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", refreshMutation.isPending && "animate-spin")} />
                  <span>{refreshMutation.isPending ? "Scanning..." : "Check for Changes"}</span>
                </button>
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <SessionChangedFilesList
                  files={files}
                  selectedFileId={selectedFileId}
                  onSelectFile={setSelectedFileId}
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
            ) : detailQuery.data ? (
              <ReadonlyMonacoDiffViewer
                fileDetail={detailQuery.data}
                owner={owner}
                terminalId={terminalId}
                terminalIncarnation={terminalIncarnation}
                ompSessionId={ompSessionId}
                rootId={rootId}
                renderSideBySide={renderSideBySide}
                onToggleSideBySide={() => setRenderSideBySide(!renderSideBySide)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
                Select a file to review diff
              </div>
            )}
          </Panel>
        </Group>
      )}
    </div>
  );
}
