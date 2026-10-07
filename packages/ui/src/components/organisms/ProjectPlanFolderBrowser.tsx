// Folder-first browsing component for Project Plans Dashboard — Phase 04
// Aligned with contracts.md section 2, 3 and phase-04-dashboard-and-document-details.md

import React, { useState, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import {
  Folder,
  ChevronRight,
  Search,
  RefreshCw,
  AlertCircle,
  Inbox,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { cn } from "@/lib/utils.js";
import type { PlanFoldersResponse } from "@/api/project-plans-types.js";

export interface ProjectPlanFolderBrowserProps {
  currentPath: string;
  foldersData?: PlanFoldersResponse;
  isLoading: boolean;
  error: Error | null;
  onNavigatePath: (path: string) => void;
  onRefresh: () => void;
  lastSelectedPath?: string | null;
  className?: string;
}

export function ProjectPlanFolderBrowser({
  currentPath,
  foldersData,
  isLoading,
  error,
  onNavigatePath,
  onRefresh,
  lastSelectedPath,
  className,
}: ProjectPlanFolderBrowserProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Restore focus to last selected row if specified (e.g. after navigating back)
  useEffect(() => {
    if (lastSelectedPath && !isLoading) {
      const el = rowRefs.current.get(lastSelectedPath);
      el?.focus();
    }
  }, [lastSelectedPath, isLoading]);

  // Compute breadcrumbs from currentPath
  // e.g. "plans" -> [{ label: "plans", path: "plans" }]
  // e.g. "plans/sub/folder" -> [{ label: "plans", path: "plans" }, { label: "sub", path: "plans/sub" }, ...]
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length === 0) {
      return [{ label: "plans", path: "plans" }];
    }
    const crumbs: { label: string; path: string }[] = [];
    let accumulated = "";
    for (let i = 0; i < parts.length; i++) {
      accumulated = accumulated ? `${accumulated}/${parts[i]}` : parts[i];
      crumbs.push({ label: parts[i], path: accumulated });
    }
    return crumbs;
  }, [currentPath]);

  // Immediate folder rows
  const allFolders = useMemo(() => foldersData?.folders ?? [], [foldersData?.folders]);
  // Filter folders by immediate name
  const filteredFolders = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return allFolders;
    return allFolders.filter((f) => f.name.toLowerCase().includes(query));
  }, [allFolders, filterQuery]);

  const limitsReached = foldersData?.listing.limitsReached ?? [];
  const isTruncated = !foldersData?.listing.complete || limitsReached.length > 0;
  const isMissingFolder = foldersData?.folderState === "missing";

  const handleRowKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = Math.min(filteredFolders.length - 1, index + 1);
      const nextPath = filteredFolders[nextIndex]?.path;
      if (nextPath) rowRefs.current.get(nextPath)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = Math.max(0, index - 1);
      const prevPath = filteredFolders[prevIndex]?.path;
      if (prevPath) rowRefs.current.get(prevPath)?.focus();
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full w-full min-w-0 bg-[var(--color-surface)] text-[var(--color-text)] text-xs",
        className,
      )}
      role="region"
      aria-label="Project Plans Folder Browser"
    >
      {/* Top Header: Breadcrumbs and Action Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface-2)]/40">
        <nav
          aria-label="Folder breadcrumbs"
          className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs"
        >
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.path}>
                {idx > 0 && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
                )}
                {isLast ? (
                  <span
                    className="font-semibold text-[var(--color-text)] truncate max-w-[160px]"
                    aria-current="page"
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigatePath(crumb.path)}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:underline truncate max-w-[140px] focus:outline-hidden focus:ring-1 focus:ring-[var(--color-primary)] rounded px-1"
                  >
                    {crumb.label}
                  </button>
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-7 w-7 p-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            title="Refresh folder listing"
            aria-label="Refresh folders"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isLoading && "animate-spin text-[var(--color-primary)]")}
            />
          </Button>
        </div>
      </div>

      {/* Filter search bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 bg-[var(--color-surface)]">
        <div className="relative flex flex-1 items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-[var(--color-text-muted)] pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter folders by name..."
            aria-label="Filter folders by name"
            className="h-7 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 pl-8 pr-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-hidden focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </div>
        {filterQuery && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFilterQuery("")}
            className="h-6 px-1.5 text-xs text-[var(--color-text-muted)]"
          >
            Clear
          </Button>
        )}
      </div>

      {/* Warning / Limits Banner */}
      {isTruncated && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 bg-[var(--color-warning)]/10 px-3 py-1.5 text-xs text-[var(--color-warning)] border-b border-[var(--color-warning)]/30"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Listing truncated: entry limit reached ({foldersData?.listing.entriesVisited ?? 0}{" "}
            entries visited).
          </span>
        </div>
      )}

      {/* Main Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {/* Loading state */}
        {isLoading && !foldersData && (
          <div
            role="status"
            aria-label="Loading plans folders"
            className="flex flex-col items-center justify-center h-32 gap-2 text-[var(--color-text-muted)]"
          >
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
            <span>Loading plans folder...</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            role="alert"
            className="flex flex-col items-center justify-center p-6 text-center gap-2 text-[var(--color-danger)]"
          >
            <AlertCircle className="h-6 w-6 shrink-0" />
            <span className="font-medium">Failed to read folder</span>
            <span className="text-xs text-[var(--color-text-muted)] max-w-sm">
              {error.message || "An unexpected error occurred while loading folders."}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              className="mt-2 text-xs"
            >
              Try Again
            </Button>
          </div>
        )}

        {/* Missing plans root directory */}
        {isMissingFolder && !isLoading && !error && (
          <div
            role="status"
            className="flex flex-col items-center justify-center p-6 text-center gap-2 text-[var(--color-text-muted)]"
          >
            <Inbox className="h-8 w-8 text-[var(--color-text-muted)]/60" />
            <span className="font-medium text-[var(--color-text)]">
              No plans folder found
            </span>
            <p className="text-xs max-w-sm">
              The project does not currently have a <code className="text-xs bg-[var(--color-surface-2)] px-1 rounded">plans/</code> directory.
            </p>
          </div>
        )}

        {/* Empty directory */}
        {!isMissingFolder && !isLoading && !error && allFolders.length === 0 && (
          <div
            role="status"
            className="flex flex-col items-center justify-center p-6 text-center gap-2 text-[var(--color-text-muted)]"
          >
            <Inbox className="h-8 w-8 text-[var(--color-text-muted)]/60" />
            <span className="font-medium text-[var(--color-text)]">
              Directory is empty
            </span>
            <p className="text-xs max-w-sm">
              No subfolders or plans exist in <code className="text-xs bg-[var(--color-surface-2)] px-1 rounded">{currentPath}</code>.
            </p>
          </div>
        )}

        {/* Filter produced 0 matches */}
        {!isMissingFolder &&
          !isLoading &&
          !error &&
          allFolders.length > 0 &&
          filteredFolders.length === 0 && (
            <div
              role="status"
              className="flex flex-col items-center justify-center p-6 text-center gap-1 text-[var(--color-text-muted)]"
            >
              <span>No matching folders for &ldquo;{filterQuery}&rdquo;</span>
            </div>
          )}

        {/* Folder items list */}
        {!isMissingFolder && filteredFolders.length > 0 && (
          <div
            role="list"
            aria-label="Folder entries"
            className="flex flex-col gap-1 min-w-0"
          >
            {filteredFolders.map((entry, idx) => (
              <button
                key={entry.path}
                ref={(el) => {
                  if (el) rowRefs.current.set(entry.path, el);
                  else rowRefs.current.delete(entry.path);
                }}
                type="button"
                role="listitem"
                tabIndex={0}
                onClick={() => onNavigatePath(entry.path)}
                onKeyDown={(e) => handleRowKeyDown(e, idx)}
                className={cn(
                  "flex items-center justify-between w-full rounded px-2.5 py-2 text-left transition-colors",
                  "border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/60",
                  "focus:border-[var(--color-primary)] focus:bg-[var(--color-surface-2)] focus:outline-hidden",
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Folder className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                  <span className="font-medium truncate text-[var(--color-text)]">
                    {entry.name}
                  </span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] opacity-60" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
