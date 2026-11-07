import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CaseSensitive,
  Loader2,
  Replace,
  X,
} from "lucide-react";
import { useFileSearch } from "@/hooks/use-file-search.js";
import { useSearchUiStore, type SearchScope } from "@/stores/search-ui.js";
import type { SearchResultItem } from "@/lib/search-matches.js";
import {
  groupContentSearchMatches,
  isContentSearchMatch,
  isPathSearchMatch,
  sortContentSearchMatches,
} from "@/lib/search-matches.js";
import { SearchPanelResults } from "@/components/organisms/SearchPanelResults.js";
import { useSearchPanelReplace } from "@/hooks/use-search-panel-replace.js";
import type { PathSearchMatch, SearchMatch } from "@/api/fs-types.js";
import { cn } from "@/lib/utils.js";
import type { ProjectTargetInput, ProjectTargetRef } from "@/api/client.js";
import type { FsTargetRef } from "@/api/ownership.js";

interface SearchPanelProps {
  project: string;
  target?: ProjectTargetRef | FsTargetRef;
  onResultClick: (
    match: SearchResultItem,
    options?: { closeSearch?: boolean },
  ) => void;
  closeOnResultClick?: boolean;
  onClose?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  consumeOpenSelection?: boolean;
  autoFocus?: boolean;
  initialQuery?: string;
  query?: string;
  onQueryChange?: (query: string) => void;
  isolatedState?: boolean;
  initialMode?: "filename" | "content";
}

export function SearchPanel({
  project,
  target,
  onResultClick,
  closeOnResultClick = false,
  onClose,
  inputRef,
  consumeOpenSelection = Boolean(onClose),
  autoFocus = Boolean(onClose),
  initialQuery,
  query: controlledQuery,
  onQueryChange: controlledOnQueryChange,
  isolatedState = false,
  initialMode,
}: SearchPanelProps) {
  const requestTarget = useMemo(() => {
    if (target && "kind" in target) {
      return target;
    }
    const worktreePath = target?.worktreePath;
    const targetProject = target?.project ?? project;
    const targetProfileId = target?.profileId;
    const base =
      worktreePath == null
        ? { project: targetProject }
        : { project: targetProject, worktreePath };
    return targetProfileId ? { ...base, profileId: targetProfileId } : base;
  }, [target, project]);
  const localInputRef = useRef<HTMLInputElement>(null);
  const resolvedRef = inputRef ?? localInputRef;
  const globalStore = useSearchUiStore();
  const [localScope, setLocalScope] = useState<SearchScope>("project");
  const [localMode, setLocalMode] = useState<"filename" | "content">(initialMode ?? "content");
  const [localQueries, setLocalQueries] = useState<{
    filename: string;
    content: string;
  }>({
    filename: initialMode === "filename" ? (controlledQuery ?? initialQuery ?? "") : "",
    content: initialMode === "filename" ? "" : (controlledQuery ?? initialQuery ?? ""),
  });
  const [localReplaceQuery, setLocalReplaceQuery] = useState("");

  const scope = isolatedState ? localScope : globalStore.scope;
  const setScope = isolatedState ? setLocalScope : globalStore.setScope;
  const mode = isolatedState ? localMode : globalStore.mode;
  const setMode = isolatedState ? setLocalMode : globalStore.setMode;
  const queries = isolatedState ? localQueries : globalStore.queries;
  const replaceQuery = isolatedState
    ? localReplaceQuery
    : globalStore.replaceQuery;
  const setReplaceQuery = isolatedState
    ? setLocalReplaceQuery
    : globalStore.setReplaceQuery;
  const setQuery = isolatedState
    ? (m: "filename" | "content", val: string) =>
        setLocalQueries((prev: { filename: string; content: string }) => ({
          ...prev,
          [m]: val,
        }))
    : globalStore.setQuery;
  const { selectOnOpen: shouldSelectOnOpen, consumeSelectOnOpen } = globalStore;
  const isControlledQuery = controlledQuery !== undefined;
  const query = (isControlledQuery ? controlledQuery : (queries && mode ? queries[mode] : "")) ?? "";
  const {
    caseSensitive,
    setCaseSensitive,
    data,
    profileStatuses,
    truncated,
    isLoading,
    isError,
    refetch,
  } = useFileSearch(requestTarget, scope, mode, query);
  const contentMatches = useMemo(
    () =>
      mode === "content"
        ? ((data?.matches ?? []) as SearchResultItem[]).filter(
            isContentSearchMatch,
          )
        : [],
    [data?.matches, mode],
  );
  const pathMatches = useMemo(
    () =>
      mode === "filename"
        ? ((data?.matches ?? []) as SearchResultItem[]).filter(
            isPathSearchMatch,
          )
        : [],
    [data?.matches, mode],
  );
  const groupedContentMatches = useMemo(
    () => groupContentSearchMatches(contentMatches),
    [contentMatches],
  );
  const totalMatches =
    mode === "content" ? contentMatches.length : pathMatches.length;
  const fileCount =
    mode === "content"
      ? groupedContentMatches.length
      : new Set(pathMatches.map((match) => match.path)).size;

  useEffect(() => {
    if (!onClose) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose?.();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (consumeOpenSelection && consumeSelectOnOpen()) {
      setTimeout(() => resolvedRef.current?.select(), 20);
    }
    // consumeSelectOnOpen is a Zustand action; resolvedRef intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, consumeOpenSelection, shouldSelectOnOpen]);

  const refreshContentMatches = async () => {
    const refreshed = await refetch();
    const matches = (refreshed.data?.matches ?? []) as SearchResultItem[];
    return sortContentSearchMatches(matches.filter(isContentSearchMatch));
  };

  const isSearchMatchingInput =
    data !== undefined &&
    data.query.length >= 2 &&
    data.query === query.slice(0, 200) &&
    !isLoading;

  const searchReplaceTarget: ProjectTargetInput = useMemo(() => {
    if (requestTarget && "kind" in requestTarget) {
      if (requestTarget.kind === "workspace") {
        return { project: "", profileId: requestTarget.profileId };
      }
      return {
        project: requestTarget.project,
        worktreePath: requestTarget.worktreePath,
        profileId: requestTarget.profileId,
      };
    }
    return requestTarget as ProjectTargetInput;
  }, [requestTarget]);

  const {
    selectedMatchKey,
    isReplacing,
    warning,
    error,
    replaceDisabled,
    selectMatch,
    replaceNext,
    replaceAll,
  } = useSearchPanelReplace({
    target: searchReplaceTarget,
    scope,
    matches: isSearchMatchingInput ? contentMatches : [],
    searchQuery: data?.query ?? "",
    replaceQuery,
    caseSensitive,
    replaceDisabled: !isSearchMatchingInput,
    refreshMatches: refreshContentMatches,
    openMatch: (match, options) => onResultClick(match, options),
  });

  const handleContentMatchClick = (match: SearchMatch) => {
    selectMatch(match);
    onResultClick(match, { closeSearch: closeOnResultClick });
  };

  const handlePathMatchClick = (match: PathSearchMatch) => {
    onResultClick(match, { closeSearch: closeOnResultClick });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-xs font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
          {mode === "content" ? "Search Contents" : "Find File"}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="shrink-0 px-3 pt-2">
        <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-xs font-medium mr-2">
          {(["content", "filename"] as const).map((nextMode) => (
            <button
              key={nextMode}
              onClick={() => setMode(nextMode)}
              className={cn(
                "px-3 py-1 transition-colors capitalize",
                mode === nextMode
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              )}
            >
              {nextMode === "content" ? "Contents" : "Files"}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-xs font-medium">
          {(["project", "workspace"] as const).map((nextScope) => (
            <button
              key={nextScope}
              onClick={() => setScope(nextScope)}
              className={cn(
                "px-3 py-1 transition-colors",
                scope === nextScope
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              )}
            >
              {nextScope === "project"
                ? "Project target"
                : "All connected profiles"}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)] space-y-1.5">
        <div className="flex items-center gap-1.5">
          <input
            ref={resolvedRef}
            autoFocus={autoFocus}
            type="text"
            placeholder={
              mode === "filename"
                ? scope === "workspace"
                  ? "Find files across all connected profiles…"
                  : "Find files in project target…"
                : scope === "workspace"
                  ? "Search across all connected profiles…"
                  : "Search project target contents…"
            }
            value={query}
            // Synchronously update query state on each keystroke for controlled input
            onChange={(event) =>
              isControlledQuery
                ? controlledOnQueryChange?.(event.target.value)
                : setQuery(mode, event.target.value)
            }
            className="flex-1 text-xs px-2 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors"
          />
          <button
            onClick={() => setCaseSensitive((value) => !value)}
            title="Case sensitive"
            className={cn(
              "p-1.5 rounded transition-colors shrink-0",
              caseSensitive
                ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
            )}
          >
            <CaseSensitive className="h-3.5 w-3.5" />
          </button>
        </div>

        {mode === "content" && (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Replace with…"
              value={replaceQuery}
              onChange={(event) => setReplaceQuery(event.target.value)}
              className="flex-1 text-xs px-2 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors"
            />
            <button
              type="button"
              onClick={() => void replaceNext()}
              disabled={replaceDisabled}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                replaceDisabled
                  ? "cursor-not-allowed bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
                  : "bg-[var(--color-primary)] text-white hover:opacity-90",
              )}
            >
              {isReplacing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Replace className="h-3.5 w-3.5" />
              )}
              Replace Next
            </button>
            <button
              type="button"
              onClick={() => void replaceAll()}
              disabled={replaceDisabled}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                replaceDisabled
                  ? "cursor-not-allowed bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
                  : "bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-3)]",
              )}
            >
              Replace All
            </button>
          </div>
        )}

        {(query?.length ?? 0) >= 2 && (
          <div className="text-2xs text-[var(--color-text-muted)] flex items-center gap-1.5">
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Searching…
              </>
            ) : isError ? (
              <>
                <AlertTriangle className="h-3 w-3 text-[var(--color-danger)]" />
                <span className="text-[var(--color-danger)]">Search error</span>
              </>
            ) : data ? (
              <>
                {totalMatches > 0
                  ? mode === "content"
                    ? `${totalMatches} result${totalMatches !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`
                    : `${totalMatches} file${totalMatches !== 1 ? "s" : ""}`
                  : "No results"}
                {data.truncated && (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    truncated
                  </span>
                )}
              </>
            ) : null}
          </div>
        )}

        {warning && (
          <div className="flex items-start gap-1.5 text-2xs text-amber-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{warning}</span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-1.5 text-2xs text-[var(--color-danger)]">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {truncated && (
          <div className="flex items-center gap-1.5 text-2xs text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>Results capped at 500 matches. Search may be truncated.</span>
          </div>
        )}
        {scope === "workspace" && profileStatuses && profileStatuses.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {profileStatuses.map((st) => (
              <span
                key={st.profileId}
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-2xs font-mono",
                  st.status === "connected"
                    ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                    : st.status === "error" || st.status === "offline"
                      ? "border-red-400/30 bg-red-400/10 text-red-300"
                      : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
                )}
              >
                <span className="font-semibold">{st.profileName}</span>
                <span>
                  {st.status === "connected"
                    ? `${st.matchCount}${st.truncated ? "+" : ""}`
                    : st.status}
                </span>
              </span>
            ))}
          </div>
        )}
        {query.length > 0 && query.length < 2 && (
          <p className="text-2xs text-[var(--color-text-muted)]">
            Type at least 2 characters
          </p>
        )}
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        <SearchPanelResults
          mode={mode}
          scope={scope}
          query={query}
          caseSensitive={caseSensitive}
          isLoading={isLoading}
          groupedContentMatches={groupedContentMatches}
          pathMatches={pathMatches}
          selectedMatchKey={selectedMatchKey}
          onResultClick={handlePathMatchClick}
          onContentMatchClick={handleContentMatchClick}
        />
      </div>
    </div>
  );
}
