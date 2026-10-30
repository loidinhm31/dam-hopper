/**
 * Accessible list of files modified since session start or from-now baseline.
 */

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { FileRow, FileChangeKind } from "@/api/session-changes-types";
import { FileCode, AlertTriangle } from "lucide-react";

export interface SessionChangedFilesListProps {
  files: readonly FileRow[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
  className?: string;
}

function getChangeBadge(change: FileChangeKind) {
  switch (change) {
    case "added":
      return {
        label: "A",
        bg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
      };
    case "deleted":
      return {
        label: "D",
        bg: "bg-rose-500/10 border-rose-500/20 text-rose-400",
      };
    case "modified":
      return {
        label: "M",
        bg: "bg-blue-500/10 border-blue-500/20 text-blue-400",
      };
    case "modeOnly":
      return {
        label: "mode",
        bg: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
      };
    case "unknown":
      return {
        label: "?",
        bg: "bg-amber-500/10 border-amber-500/20 text-amber-400",
      };
  }
}

export function SessionChangedFilesList({
  files,
  selectedFileId,
  onSelectFile,
  className,
}: SessionChangedFilesListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (files.length === 0) return;
    const currentIndex = files.findIndex((f) => f.fileId === selectedFileId);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = currentIndex < files.length - 1 ? currentIndex + 1 : 0;
      onSelectFile(files[nextIndex].fileId);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : files.length - 1;
      onSelectFile(files[prevIndex].fileId);
    }
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Changed files"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex flex-col h-full overflow-y-auto divide-y divide-[var(--color-border)] outline-none focus:ring-1 focus:ring-[var(--color-accent)]",
        className,
      )}
      data-testid="session-changed-files-list"
    >
      {files.map((file) => {
        const isSelected = file.fileId === selectedFileId;
        const badge = getChangeBadge(file.change);

        return (
          <div
            key={file.fileId}
            role="option"
            aria-selected={isSelected}
            tabIndex={-1}
            onClick={() => onSelectFile(file.fileId)}
            className={cn(
              "flex items-center justify-between px-3 py-2 cursor-pointer transition-colors text-xs select-none",
              isSelected
                ? "bg-[var(--color-surface)] text-[var(--color-text)] border-l-2 border-l-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/50 hover:text-[var(--color-text)]",
            )}
            data-testid={`file-row-${file.fileId}`}
          >
            <div className="flex items-center gap-2 min-w-0 mr-2">
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded border font-mono text-[10px] font-semibold shrink-0 uppercase",
                  badge.bg,
                )}
                title={`Change: ${file.change}`}
              >
                {badge.label}
              </span>

              <span
                className="font-mono truncate"
                title={file.path}
              >
                {file.path}
              </span>

              {file.change === "unknown" && (
                <span title="Historical presence unknown" className="shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
              {file.additions != null ? (
                <span className="text-emerald-500">+{file.additions}</span>
              ) : (
                <span className="text-zinc-500">—</span>
              )}

              {file.deletions != null ? (
                <span className="text-rose-500">-{file.deletions}</span>
              ) : (
                <span className="text-zinc-500">—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
