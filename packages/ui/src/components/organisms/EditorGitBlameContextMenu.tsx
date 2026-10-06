import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import type { GitBlameCommit, GitBlameResponse } from "@/api/client.js";
import type { EditorGitBlameStatus } from "@/hooks/use-editor-git-blame.js";
import {
  findBlameRangeForLine,
  findCommitForRange,
} from "@/lib/editor-git-blame.js";
import { GitCommit, RefreshCw, Eye, EyeOff } from "lucide-react";

export interface EditorGitBlameContextMenuProps {
  x: number;
  y: number;
  lineNumber: number | null;
  blameEnabled: boolean;
  blameStatus: EditorGitBlameStatus;
  blameData: GitBlameResponse | null;
  unavailableReason?: string | null;
  isBusy?: boolean;
  targetSnapshotId?: string;
  targetModelVersion?: number;
  onClose: () => void;
  onToggleBlame: (enabled?: boolean) => void;
  onRefreshBlame: () => void;
  onRevealCommit?: (commitHash: string, rootId: string) => void;
}

/**
 * Coordinated context menu for Monaco line-number gutter and blame column.
 * Uses existing Radix ContextMenu primitives and synthetic pointer positioning.
 */
export function EditorGitBlameContextMenu({
  x,
  y,
  lineNumber,
  blameEnabled,
  blameStatus,
  blameData,
  unavailableReason,
  isBusy = false,
  targetSnapshotId,
  targetModelVersion,
  onClose,
  onToggleBlame,
  onRefreshBlame,
  onRevealCommit,
}: EditorGitBlameContextMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
  }, [x, y]);

  // Determine if refresh action is available
  const isRefreshDisabled =
    !blameEnabled ||
    blameStatus === "unavailable" ||
    (unavailableReason !== null && unavailableReason !== undefined);
  const refreshTooltip = isRefreshDisabled
    ? (unavailableReason ?? "Source or owner unavailable")
    : isBusy
      ? "Refreshing annotations…"
      : undefined;

  // Resolve commit attribution for the targeted line if blame data is valid
  let targetCommit: GitBlameCommit | null = null;
  let isUncommittedLine = false;

  const isReady =
    blameStatus === "ready" &&
    blameData !== null &&
    blameData.status === "ready";

  const isSnapshotCurrent =
    isReady &&
    (!targetSnapshotId || blameData.snapshotId === targetSnapshotId) &&
    (!targetModelVersion || blameData.modelVersion === targetModelVersion);

  if (
    lineNumber !== null &&
    lineNumber > 0 &&
    isReady &&
    isSnapshotCurrent &&
    blameData
  ) {
    const range = findBlameRangeForLine(blameData.ranges, lineNumber);
    if (range) {
      if (range.commitIndex === null || range.commitIndex === undefined) {
        isUncommittedLine = true;
      } else {
        targetCommit = findCommitForRange(blameData.commits, range);
      }
    }
  }

  const canRevealCommit =
    blameEnabled &&
    isReady &&
    isSnapshotCurrent &&
    !isUncommittedLine &&
    targetCommit !== null &&
    blameData !== null &&
    typeof blameData.rootId === "string" &&
    blameData.rootId.length > 0 &&
    onRevealCommit !== undefined;

  const revealTooltip = !isReady
    ? "Annotations not ready"
    : !isSnapshotCurrent
      ? "Buffer changed; refresh annotations"
      : isUncommittedLine
        ? "Uncommitted changes"
        : !canRevealCommit
          ? "No committed baseline for line"
          : undefined;

  return (
    <ContextMenu.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) onClose();
      }}
    >
      <ContextMenu.Trigger ref={triggerRef}>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="w-56"
          data-testid="editor-git-blame-menu"
        >
          <ContextMenu.Item
            data-testid="editor-git-blame-menu-toggle"
            onSelect={() => {
              setOpen(false);
              onClose();
              onToggleBlame(!blameEnabled);
            }}
          >
            {blameEnabled ? (
              <>
                <EyeOff className="h-3.5 w-3.5 mr-2 shrink-0 text-[var(--color-text-muted)]" />
                Hide Git Blame Annotations
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 mr-2 shrink-0 text-[var(--color-text-muted)]" />
                Annotate with Git Blame
              </>
            )}
          </ContextMenu.Item>

          {blameEnabled && (
            <ContextMenu.Item
              data-testid="editor-git-blame-menu-refresh"
              disabled={isRefreshDisabled}
              title={refreshTooltip}
              onSelect={() => {
                setOpen(false);
                onClose();
                onRefreshBlame();
              }}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-2 shrink-0 text-[var(--color-text-muted)] ${
                  isBusy ? "animate-spin" : ""
                }`}
              />
              Refresh Annotations
            </ContextMenu.Item>
          )}

          {blameEnabled && lineNumber !== null && (
            <>
              <ContextMenu.Separator />
              <ContextMenu.Item
                data-testid="editor-git-blame-menu-reveal"
                disabled={!canRevealCommit}
                title={revealTooltip}
                onSelect={() => {
                  if (canRevealCommit && targetCommit && blameData?.rootId) {
                    setOpen(false);
                    onClose();
                    onRevealCommit(targetCommit.hash, blameData.rootId);
                  }
                }}
              >
                <GitCommit className="h-3.5 w-3.5 mr-2 shrink-0 text-[var(--color-text-muted)]" />
                Show Commit in Git
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
