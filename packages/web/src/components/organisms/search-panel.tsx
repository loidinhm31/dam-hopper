import { useRef, useMemo } from "react";
import { Loader2, CaseSensitive, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useFileSearch } from "@/hooks/use-file-search.js";
import type { SearchMatch } from "@/api/fs-types.js";

interface SearchPanelProps {
  project: string;
  onResultClick: (match: SearchMatch) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function SearchPanel({ project, onResultClick, inputRef }: SearchPanelProps) {
  const localInputRef = useRef<HTMLInputElement>(null);
  const resolvedRef = inputRef ?? localInputRef;

  const { query, setQuery, caseSensitive, setCaseSensitive, data, isLoading, isError } =
    useFileSearch(project);

  // Group matches by file path
  const grouped = useMemo(() => {
    if (!data?.matches.length) return [];
    const map = new Map<string, SearchMatch[]>();
    for (const m of data.matches) {
      const arr = map.get(m.path) ?? [];
      arr.push(m);
      map.set(m.path, arr);
    }
    return Array.from(map.entries());
  }, [data?.matches]);

  const totalMatches = data?.matches.length ?? 0;
  const fileCount = grouped.length;

  function highlightMatch(text: string, q: string, isCaseSensitive: boolean) {
    if (!q) return <span>{text}</span>;
    const flags = isCaseSensitive ? "g" : "gi";
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, flags));
    return (
      <>
        {parts.map((part, i) => {
          const matches = isCaseSensitive ? part === q : part.toLowerCase() === q.toLowerCase();
          return matches ? (
            <mark key={i} className="bg-[var(--color-primary)]/25 text-[var(--color-primary)] rounded-sm px-0.5">
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          );
        })}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="shrink-0 px-2 py-2 border-b border-[var(--color-border)] space-y-1.5">
        <div className="flex items-center gap-1">
          <input
            ref={resolvedRef}
            autoFocus
            type="text"
            placeholder="Search files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 text-xs px-2 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors"
          />
          <button
            onClick={() => setCaseSensitive((v) => !v)}
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

        {/* Status line */}
        {query.length >= 2 && (
          <div className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1.5">
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
                  ? `${totalMatches} result${totalMatches !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`
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
        {query.length > 0 && query.length < 2 && (
          <p className="text-[10px] text-[var(--color-text-muted)]">Type at least 2 characters</p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {grouped.length > 0 ? (
          grouped.map(([filePath, fileMatches]) => (
            <div key={filePath} className="border-b border-[var(--color-border)]/40 last:border-0">
              {/* File header */}
              <div
                className="sticky top-0 px-2 py-1 bg-[var(--color-surface-2)] text-[10px] font-semibold text-[var(--color-text-muted)] tracking-wide truncate cursor-pointer hover:text-[var(--color-text)] transition-colors"
                title={filePath}
                onClick={() => onResultClick(fileMatches[0])}
              >
                {filePath}
              </div>
              {/* Match lines */}
              {fileMatches.map((m, i) => (
                <button
                  key={i}
                  onClick={() => onResultClick(m)}
                  className="w-full text-left flex items-start gap-2 px-3 py-1 hover:bg-[var(--color-surface-2)] transition-colors group"
                >
                  <span className="shrink-0 text-[10px] text-[var(--color-text-muted)] font-mono w-8 text-right mt-0.5">
                    {m.line}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--color-text)] truncate leading-5">
                    {highlightMatch(m.text.trimStart(), query, caseSensitive)}
                  </span>
                </button>
              ))}
            </div>
          ))
        ) : (
          !isLoading &&
          query.length >= 2 &&
          data && (
            <div className="flex items-center justify-center h-20 text-xs text-[var(--color-text-muted)]">
              No results for &ldquo;{query}&rdquo;
            </div>
          )
        )}

        {/* Empty state */}
        {query.length < 2 && (
          <div className="flex items-center justify-center h-24 text-xs text-[var(--color-text-muted)] opacity-60">
            Search file contents
          </div>
        )}
      </div>
    </div>
  );
}
