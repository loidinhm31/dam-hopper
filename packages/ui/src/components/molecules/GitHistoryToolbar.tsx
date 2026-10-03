import React, { useId } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { cn } from "@/lib/utils.js";

export interface GitHistoryToolbarProps {
  searchText: string;
  onSearchChange: (text: string) => void;
  onClearSearch: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  isFiltered?: boolean;

  page: number;
  offset: number;
  logsCount: number;
  pageSize?: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;

  onRefresh: () => void;
  isRefreshing?: boolean;
  isLoading?: boolean;
  disabled?: boolean;

  followActive?: boolean;
  isViewingActiveBranch?: boolean;
  branchLabel?: string;
  onFollowCheckedOutBranch?: () => void;

  notice?: string | null;
  onDismissNotice?: () => void;

  squashCount?: number;
  squashDisabledReason?: string;
  squashBusy?: boolean;
  onSquash?: () => void;
  onClearSquashSelection?: () => void;
  focusRef?: React.Ref<HTMLDivElement>;
  className?: string;
  compact?: boolean;
}

export function GitHistoryToolbar({
  searchText,
  onSearchChange,
  onClearSearch,
  onCompositionStart,
  onCompositionEnd,
  isFiltered = false,

  page,
  offset,
  logsCount,
  pageSize = 200,
  hasPreviousPage,
  hasNextPage,
  onPreviousPage,
  onNextPage,

  onRefresh,
  isRefreshing = false,
  isLoading = false,
  disabled = false,

  followActive = true,
  isViewingActiveBranch = true,
  branchLabel,
  onFollowCheckedOutBranch,

  notice,
  onDismissNotice,

  className,
  compact = false,
  squashCount = 0,
  squashDisabledReason,
  squashBusy = false,
  onSquash,
  onClearSquashSelection,
  focusRef,
}: GitHistoryToolbarProps) {
  const isSearchDisabled = disabled || isLoading;
  const isPaginationDisabled = disabled || isLoading || isRefreshing;
  const squashHelpId = useId();

  const countDisplay =
    logsCount === 0
      ? "0 commits"
      : `${offset + 1}–${offset + logsCount} commits`;

  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      aria-label="Git history actions"
      className={cn(
        "flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]",
        className,
      )}
    >
      {notice ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-amber-500/20 bg-amber-500/10 text-amber-300 text-xs"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{notice}</span>
          </div>
          {onDismissNotice ? (
            <button
              type="button"
              onClick={onDismissNotice}
              className="text-amber-300/70 hover:text-amber-300 p-0.5"
              aria-label="Dismiss notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {onSquash && (
        <div className="flex flex-wrap items-center gap-2 text-xs leading-relaxed text-[var(--color-text)]">
          <span role="status" aria-live="polite">
            {squashCount} selected
          </span>
          {squashCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11"
              disabled={squashBusy}
              onClick={onClearSquashSelection}
            >
              Clear selection
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            className="min-h-11"
            disabled={disabled || squashBusy || Boolean(squashDisabledReason)}
            aria-describedby={squashHelpId}
            onClick={onSquash}
          >
            {squashCount >= 2
              ? `Squash ${squashCount} commits`
              : "Squash commits"}
          </Button>
          <p id={squashHelpId} className="basis-full break-words">
            {squashDisabledReason ||
              "Select at least two parent-contiguous commits on this page."}
          </p>
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-2 flex-wrap min-w-0 justify-between",
          compact && "gap-1.5",
        )}
      >
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-full relative">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)] pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => onSearchChange(e.target.value)}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClearSearch();
                }
              }}
              placeholder="Search commit messages (Subject and body)..."
              aria-label="Search commit messages"
              disabled={isSearchDisabled}
              className={cn(
                "w-full h-8 pl-8 pr-7 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/40 disabled:opacity-50",
                compact && "text-[11px] h-7",
              )}
            />
            {searchText.length > 0 ? (
              <button
                type="button"
                onClick={onClearSearch}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {!followActive && onFollowCheckedOutBranch ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onFollowCheckedOutBranch}
              className="h-8 text-xs shrink-0 flex items-center gap-1 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              title="Return to tracking checked-out branch"
              aria-label="Follow checked-out branch"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {!compact ? <span>Follow active</span> : null}
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center text-xs text-[var(--color-text-muted)] font-mono">
            <span>{countDisplay}</span>
            {isFiltered ? (
              <span className="ml-1 text-[10px] text-emerald-400 font-sans">
                (filtered)
              </span>
            ) : null}
          </div>

          <div className="flex items-center border border-[var(--color-border)] rounded overflow-hidden">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onPreviousPage}
              disabled={!hasPreviousPage || isPaginationDisabled}
              aria-label="Previous page"
              className="h-7 w-7 p-0 rounded-none border-r border-[var(--color-border)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onNextPage}
              disabled={!hasNextPage || isPaginationDisabled}
              aria-label="Next page"
              className="h-7 w-7 p-0 rounded-none"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={disabled || isRefreshing || isLoading}
            aria-label="Refresh history"
            title="Refresh commits"
            className="h-7 w-7 p-0"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 motion-reduce:animate-none",
                isRefreshing && "animate-spin",
              )}
            />
          </Button>
        </div>
      </div>
    </div>
  );
}
