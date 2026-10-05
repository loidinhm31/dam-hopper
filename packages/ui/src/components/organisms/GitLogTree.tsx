import React, { useId, useMemo } from "react";
import { cn } from "@/lib/utils.js";
import type { GitLogEntry } from "@/api/client.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";

const GRAPH_CELL_WIDTH = 14;
const ROW_HEIGHT = 44;
const SVG_PADDING = 8;
const RADIUS = 4;

const COLORS = [
  "#2563EB", // blue-600
  "#16A34A", // green-600
  "#D97706", // amber-600
  "#DC2626", // red-600
  "#9333EA", // purple-600
  "#0891B2", // cyan-600
  "#EA580C", // orange-600
  "#BE185D", // pink-700
];

interface GitLogTreeProps {
  logs: GitLogEntry[];
  isLoading?: boolean;
  selectedHash?: string;
  squashSelectedHashes?: readonly string[];
  onToggleSquashCommit?: (hash: string) => void;
  squashSelectionDisabled?: boolean;
  onSelectCommit?: (entry: GitLogEntry) => void;
  onCherryPick?: (entry: GitLogEntry) => void;
  onRevertCommit?: (entry: GitLogEntry) => void;
  onUndoLastCommit?: (entry: GitLogEntry) => void;
  onEditCommitMessage?: (entry: GitLogEntry) => void;
  onReset?: (entry: GitLogEntry) => void;
  onDropCommit?: (entry: GitLogEntry) => void;
  presentation?: "graph" | "list";
  emptyMessage?: string;
}

interface RenderNode {
  entry: GitLogEntry;
  trackIndex: number;
  prevTracks: string[];
  nextTracks: string[];
}

export function getDropCommitMenuState(entry: Pick<GitLogEntry, "isPushed">) {
  return {
    disabled: entry.isPushed,
    title: entry.isPushed
      ? "Drop commit is only available for commits not pushed upstream"
      : undefined,
  };
}

export function getEditCommitMessageMenuState(
  _entry?: Pick<GitLogEntry, "isPushed">,
) {
  void _entry;
  return {
    disabled: false,
    title: undefined,
  };
}

export function getUndoLastCommitMenuState({
  isHead,
  isPushed,
}: {
  isHead: boolean;
  isPushed: boolean;
}) {
  const title = !isHead
    ? "Undo Last Commit is only available on HEAD"
    : isPushed
      ? "Undo Last Commit is only available for commits not pushed upstream"
      : undefined;
  return {
    disabled: Boolean(title),
    title,
  };
}

export function isHeadCommit(entry: Pick<GitLogEntry, "refs">) {
  return entry.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD ->"));
}

export function HistoryContextMenu({
  entry,
  isHead,
  onCherryPick,
  onRevertCommit,
  onUndoLastCommit,
  onEditCommitMessage,
  onReset,
  onDropCommit,
  onOpen,
  children,
}: {
  entry: GitLogEntry;
  isHead: boolean;
  onCherryPick?: (entry: GitLogEntry) => void;
  onRevertCommit?: (entry: GitLogEntry) => void;
  onUndoLastCommit?: (entry: GitLogEntry) => void;
  onEditCommitMessage?: (entry: GitLogEntry) => void;
  onReset?: (entry: GitLogEntry) => void;
  onDropCommit?: (entry: GitLogEntry) => void;
  onOpen: () => void;
  children: React.ReactElement;
}) {
  const dropCommitState = getDropCommitMenuState(entry);
  const undoLastCommitState = getUndoLastCommitMenuState({
    isHead,
    isPushed: entry.isPushed,
  });
  const editHelpId = useId();
  const editCommitMessageState = getEditCommitMessageMenuState(entry);
  const resetDisabled = !onReset;
  const undoDisabled = undoLastCommitState.disabled || !onUndoLastCommit;
  const editDisabled = editCommitMessageState.disabled || !onEditCommitMessage;
  const dropDisabled = dropCommitState.disabled || !onDropCommit;
  const editDisabledReason =
    editCommitMessageState.title ??
    (!onEditCommitMessage
      ? "Edit Commit Message is only available for local branches"
      : undefined);
  return (
    <ContextMenu.Root onOpenChange={(open) => open && onOpen()}>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="w-48">
          <ContextMenu.Label>Safe actions</ContextMenu.Label>
          <ContextMenu.Item onSelect={() => onRevertCommit?.(entry)}>
            Revert commit
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onCherryPick?.(entry)}>
            Cherry-pick commit
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Label>Rewrite actions</ContextMenu.Label>
          <ContextMenu.Item
            disabled={editDisabled}
            title={editDisabledReason}
            aria-describedby={
              editDisabled && editDisabledReason ? editHelpId : undefined
            }
            onSelect={() => onEditCommitMessage?.(entry)}
            className="text-[var(--color-danger)] focus:bg-[var(--color-danger)]/10 focus:text-[var(--color-danger)]"
          >
            Edit Commit Message
          </ContextMenu.Item>
          {editDisabled && editDisabledReason ? (
            <p
              id={editHelpId}
              className="px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] leading-tight break-words select-none"
            >
              {editDisabledReason}
            </p>
          ) : null}
          <ContextMenu.Item
            disabled={undoDisabled}
            title={
              undoLastCommitState.title ??
              (!onUndoLastCommit
                ? "Undo Last Commit is only available while viewing the checked-out branch"
                : undefined)
            }
            onSelect={() => onUndoLastCommit?.(entry)}
            className="text-[var(--color-danger)] focus:bg-[var(--color-danger)]/10 focus:text-[var(--color-danger)]"
          >
            Undo Last Commit
          </ContextMenu.Item>
          <ContextMenu.Item
            disabled={resetDisabled}
            title={
              !onReset
                ? "Reset is only available while viewing the checked-out branch"
                : undefined
            }
            onSelect={() => onReset?.(entry)}
            className="text-[var(--color-danger)] focus:bg-[var(--color-danger)]/10 focus:text-[var(--color-danger)]"
          >
            Reset to this commit
          </ContextMenu.Item>
          <ContextMenu.Item
            disabled={dropDisabled}
            title={
              dropCommitState.title ??
              (!onDropCommit
                ? "Drop commit is only available while viewing the checked-out branch"
                : undefined)
            }
            onSelect={() => onDropCommit?.(entry)}
            className="text-[var(--color-danger)] focus:bg-[var(--color-danger)]/10 focus:text-[var(--color-danger)]"
          >
            Drop commit
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function GitLogTree({
  logs,
  isLoading = false,
  selectedHash,
  squashSelectedHashes = [],
  onToggleSquashCommit,
  squashSelectionDisabled = false,
  onSelectCommit,
  onCherryPick,
  onRevertCommit,
  onUndoLastCommit,
  onEditCommitMessage,
  onReset,
  onDropCommit,
  presentation = "graph",
  emptyMessage = "No commits found.",
}: GitLogTreeProps) {
  const parsedGraph = useMemo(() => {
    if (presentation === "list") {
      return [];
    }
    const tracks: string[] = []; // the hash expected at each track index
    const renderNodes: RenderNode[] = [];

    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i];
      let trackIndex = tracks.indexOf(entry.hash);

      if (trackIndex === -1) {
        trackIndex = tracks.indexOf("");
        if (trackIndex === -1) trackIndex = tracks.length;
      }

      const prevTracks = [...tracks]; // for drawing lines from above

      // Consume this hash from its track, replace with its first parent
      if (entry.parents.length > 0) {
        tracks[trackIndex] = entry.parents[0];

        // Additional parents get new tracks
        for (let p = 1; p < entry.parents.length; p++) {
          const parent = entry.parents[p];
          if (!tracks.includes(parent)) {
            const emptyIdx = tracks.indexOf("");
            if (emptyIdx !== -1) tracks[emptyIdx] = parent;
            else tracks.push(parent);
          }
        }
      } else {
        tracks[trackIndex] = ""; // Branch ends
      }

      renderNodes.push({
        entry,
        trackIndex,
        prevTracks,
        nextTracks: [...tracks],
      });
    }

    return renderNodes;
  }, [logs, presentation]);

  const rowsToRender = useMemo(() => {
    if (presentation === "list") {
      return logs.map((entry) => ({ entry, node: null, graphWidth: 0 }));
    }
    return parsedGraph.map((node) => {
      const maxTracks = Math.max(
        node.prevTracks.length,
        node.nextTracks.length,
        node.trackIndex + 1,
      );
      const graphWidth =
        Math.max(1, maxTracks) * GRAPH_CELL_WIDTH + SVG_PADDING * 2;
      return { entry: node.entry, node, graphWidth };
    });
  }, [logs, parsedGraph, presentation]);

  function formatRelativeDate(timestamp: number) {
    return new Date(timestamp * 1000).toLocaleString();
  }

  if (isLoading) {
    return (
      <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">
        Loading git log...
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] bg-[var(--color-background)]">
            {onToggleSquashCommit && (
              <th className="w-11 min-w-11 sticky left-0 z-20 bg-[var(--color-background)]">
                <span className="sr-only">Select commits for squash</span>
              </th>
            )}
            <th
              className={cn(
                "font-medium px-4 py-2 sticky z-10 bg-[var(--color-background)]",
                onToggleSquashCommit ? "left-11" : "left-0",
              )}
            >
              Log
            </th>
            <th className="font-medium px-4 py-2">Author</th>
            <th className="font-medium px-4 py-2">Date</th>
            <th className="font-medium px-4 py-2">Hash</th>
          </tr>
        </thead>
        <tbody>
          {rowsToRender.map((row) => {
            const entry = row.entry;
            const node = row.node;
            const isSelected = selectedHash === entry.hash;

            return (
              <HistoryContextMenu
                key={entry.hash}
                entry={entry}
                isHead={isHeadCommit(entry)}
                onCherryPick={onCherryPick}
                onRevertCommit={onRevertCommit}
                onUndoLastCommit={onUndoLastCommit}
                onEditCommitMessage={onEditCommitMessage}
                onReset={onReset}
                onDropCommit={onDropCommit}
                onOpen={() => onSelectCommit?.(entry)}
              >
                <tr
                  tabIndex={0}
                  aria-haspopup="menu"
                  onClick={() => onSelectCommit?.(entry)}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      onSelectCommit?.(entry);
                    }
                  }}
                  className={cn(
                    "border-b border-[var(--color-border)] hover:bg-[var(--color-border)]/20 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40",
                    isSelected &&
                      "bg-[var(--color-primary)]/10 hover:bg-[var(--color-primary)]/15",
                  )}
                  style={{ height: `${ROW_HEIGHT}px` }}
                >
                  {onToggleSquashCommit && (
                    <td className="w-11 min-w-11 sticky left-0 z-20 bg-[var(--color-surface)]">
                      <label
                        className="flex h-11 w-11 items-center justify-center cursor-pointer"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={squashSelectedHashes.includes(entry.hash)}
                          disabled={squashSelectionDisabled}
                          onChange={() => onToggleSquashCommit(entry.hash)}
                          aria-label={`Select ${entry.hash.slice(0, 7)}: ${entry.message} for squash`}
                          className="h-4 w-4 accent-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                        />
                      </label>
                    </td>
                  )}
                  <td
                    className={cn(
                      "px-4 py-0 flex items-center gap-2 sticky z-10 bg-[var(--color-surface)]",
                      onToggleSquashCommit ? "left-11" : "left-0",
                      isSelected
                        ? "bg-[var(--color-primary)]/10"
                        : "group-hover:bg-[#f8f9fa] dark:group-hover:bg-[#1a1b1e]",
                    )}
                  >
                    {node ? (
                      <div
                        className="relative shrink-0 flex items-center justify-center"
                        style={{ width: row.graphWidth, height: ROW_HEIGHT }}
                      >
                        <svg
                          className="absolute inset-0"
                          width={row.graphWidth}
                          height={ROW_HEIGHT}
                        >
                          {/* Draw lines from previous row */}
                          {node.prevTracks.map((hash: string, tIdx: number) => {
                            if (!hash) return null;
                            const color = COLORS[tIdx % COLORS.length];
                            const startX =
                              SVG_PADDING + tIdx * GRAPH_CELL_WIDTH;
                            let endX = startX;
                            // If this track flows into the current node's track
                            if (hash === node.entry.hash) {
                              endX =
                                SVG_PADDING +
                                node.trackIndex * GRAPH_CELL_WIDTH;
                            }

                            return (
                              <path
                                key={`prev-${tIdx}`}
                                d={`M ${startX} 0 C ${startX} ${ROW_HEIGHT / 2}, ${endX} ${ROW_HEIGHT / 2}, ${endX} ${ROW_HEIGHT}`}
                                fill="none"
                                stroke={color}
                                strokeWidth={2}
                              />
                            );
                          })}

                          {/* Draw lines to next row */}
                          {node.nextTracks.map((hash: string, tIdx: number) => {
                            if (!hash) return null;
                            const color = COLORS[tIdx % COLORS.length];
                            let startX =
                              SVG_PADDING + node.trackIndex * GRAPH_CELL_WIDTH;
                            const endX = SVG_PADDING + tIdx * GRAPH_CELL_WIDTH;

                            // If this is a continuing pass-through line from above
                            if (
                              node.prevTracks[tIdx] === hash &&
                              hash !== node.entry.hash
                            ) {
                              startX = endX;
                            }

                            return (
                              <path
                                key={`next-${tIdx}`}
                                d={`M ${startX} ${ROW_HEIGHT / 2} C ${startX} ${ROW_HEIGHT * 0.75}, ${endX} ${ROW_HEIGHT * 0.75}, ${endX} ${ROW_HEIGHT}`}
                                fill="none"
                                stroke={color}
                                strokeWidth={2}
                              />
                            );
                          })}

                          {/* Draw commit dot */}
                          <circle
                            cx={
                              SVG_PADDING + node.trackIndex * GRAPH_CELL_WIDTH
                            }
                            cy={ROW_HEIGHT / 2}
                            r={RADIUS}
                            fill={COLORS[node.trackIndex % COLORS.length]}
                            stroke="var(--color-surface)"
                            strokeWidth={1}
                            className="z-10 relative"
                          />
                        </svg>
                      </div>
                    ) : null}

                    <div className="flex-1 min-w-0 pr-4 flex items-center gap-2">
                      {entry.refs.map((ref: string) => {
                        const isHead = ref.includes("HEAD");
                        const isRemote = ref.startsWith("origin/");
                        return (
                          <span
                            key={ref}
                            className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border
                             ${
                               isHead
                                 ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                 : isRemote
                                   ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                                   : "bg-gray-500/10 text-gray-600 border-gray-500/20"
                             }`}
                          >
                            {ref}
                          </span>
                        );
                      })}
                      <span className="truncate text-[var(--color-text)] font-medium">
                        {entry.message}
                      </span>
                    </div>
                  </td>
                  <td
                    className="px-4 py-1 text-[var(--color-text-muted)] truncate max-w-[120px]"
                    title={entry.authorEmail}
                  >
                    {entry.authorName}
                  </td>
                  <td className="px-4 py-1 text-[var(--color-text-muted)]">
                    {formatRelativeDate(entry.timestamp)}
                  </td>
                  <td className="px-4 py-1 font-mono text-[var(--color-text-muted)] opacity-60">
                    {entry.hash.substring(0, 7)}
                  </td>
                </tr>
              </HistoryContextMenu>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
