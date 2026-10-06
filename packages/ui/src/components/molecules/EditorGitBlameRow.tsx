import * as React from "react";
import type { RenderedBlameRow } from "@/lib/editor-git-blame-gutter-layout.js";

export interface EditorGitBlameRowProps {
  row: RenderedBlameRow;
  layoutMode: "normal" | "compact";
  rootId?: string;
  snapshotId?: string;
  modelVersion?: number;
  onContextMenu: (e: React.MouseEvent, lineNumber: number) => void;
  onRevealCommit?: (commitHash: string, rootId: string) => void;
  onOpenContextMenu?: (menuState: {
    x: number;
    y: number;
    lineNumber: number | null;
    snapshotId?: string;
    modelVersion?: number;
  }) => void;
}

export function EditorGitBlameRow({
  row,
  layoutMode,
  rootId,
  snapshotId,
  modelVersion,
  onContextMenu,
  onRevealCommit,
  onOpenContextMenu,
}: EditorGitBlameRowProps) {
  const revealCommittedRow = () => {
    if (!row.isUncommitted && row.commit && rootId) {
      onRevealCommit?.(row.commit.hash, rootId);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
      return;
    revealCommittedRow();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      onOpenContextMenu?.({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        lineNumber: row.lineNumber,
        snapshotId,
        modelVersion,
      });
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      revealCommittedRow();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
    }
  };

  return (
    <div
      data-line={row.lineNumber}
      data-uncommitted={row.isUncommitted ? "true" : undefined}
      tabIndex={0}
      role="row"
      aria-label={row.hoverMetadata}
      title={row.hoverMetadata}
      className="editor-blame-row absolute left-0 right-0 px-2 flex items-center justify-between text-[11px] cursor-pointer truncate focus:outline-none"
      style={{
        top: row.top,
        height: row.height,
        lineHeight: `${row.height}px`,
      }}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, row.lineNumber)}
      onKeyDown={handleKeyDown}
    >
      {layoutMode === "normal" ? (
        <>
          <span
            className={`truncate max-w-[130px] font-medium ${
              row.isUncommitted
                ? "text-[var(--color-text-muted)] italic"
                : "text-[var(--color-text)]"
            }`}
          >
            {row.displayAuthor}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 ml-1 font-mono">
            {row.displayDate}
          </span>
        </>
      ) : (
        <span
          className={`truncate w-full font-medium ${
            row.isUncommitted
              ? "text-[var(--color-text-muted)] italic"
              : "text-[var(--color-text)]"
          }`}
        >
          {row.displayAuthor}
        </span>
      )}
    </div>
  );
}
