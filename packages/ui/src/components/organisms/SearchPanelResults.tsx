import { FileDecorationIcon } from "@/lib/file-decoration-icon.js";
import { cn } from "@/lib/utils.js";
import type {
  GroupedContentSearchMatches,
  SearchResultItem,
} from "@/lib/search-matches.js";
import { buildContentSearchMatchKey } from "@/lib/search-matches.js";
import type { PathSearchMatch, SearchMatch } from "@/api/fs-types.js";
import type { SearchMode, SearchScope } from "@/stores/search-ui.js";

interface SearchPanelResultsProps {
  mode: SearchMode;
  scope: SearchScope;
  query: string;
  caseSensitive: boolean;
  isLoading: boolean;
  groupedContentMatches: GroupedContentSearchMatches[];
  pathMatches: PathSearchMatch[];
  selectedMatchKey: string | null;
  onResultClick: (match: SearchResultItem) => void;
  onContentMatchClick: (match: SearchMatch) => void;
}

export function SearchPanelResults({
  mode,
  scope,
  query,
  caseSensitive,
  isLoading,
  groupedContentMatches,
  pathMatches,
  selectedMatchKey,
  onResultClick,
  onContentMatchClick,
}: SearchPanelResultsProps) {
  if (mode === "filename" && pathMatches.length > 0) {
    return (
      <div>
        {pathMatches.map((match) => {
          const key = `${match.project ?? ""}:${match.path}`;
          return (
            <button
              key={key}
              onClick={() => onResultClick(match)}
              className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-surface-2)] transition-colors"
            >
              {match.project && scope === "workspace" && (
                <span className="shrink-0 px-1.5 py-0.5 rounded-sm bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-mono text-[9px]">
                  {match.project}
                </span>
              )}
              <FileDecorationIcon
                pathOrName={match.path}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="min-w-0 truncate text-[11px] font-mono text-[var(--color-text)]">
                {highlightMatch(match.path, query, caseSensitive)}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (groupedContentMatches.length > 0) {
    return (
      <>
        {groupedContentMatches.map((group) => (
          <div
            key={group.key}
            className="border-b border-[var(--color-border)]/40 last:border-0"
          >
            <div
              className="sticky top-0 px-2 py-1 bg-[var(--color-surface-2)] text-[10px] font-semibold text-[var(--color-text-muted)] tracking-wide truncate cursor-pointer hover:text-[var(--color-text)] transition-colors flex items-center gap-1.5"
              title={group.path}
              onClick={() => onContentMatchClick(group.matches[0]!)}
            >
              {group.project && scope === "workspace" && (
                <span className="shrink-0 px-1.5 py-0.5 rounded-sm bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-mono text-[9px] tracking-normal">
                  {group.project}
                </span>
              )}
              <FileDecorationIcon
                pathOrName={group.path}
                className="h-3.5 w-3.5"
              />
              <span className="truncate">{group.path}</span>
            </div>
            {group.matches.map((match) => {
              const matchKey = buildContentSearchMatchKey(match);
              const isSelected = selectedMatchKey === matchKey;
              return (
                <button
                  key={matchKey}
                  onClick={() => onContentMatchClick(match)}
                  className={cn(
                    "w-full text-left flex items-start gap-2 px-3 py-1 transition-colors group hover:bg-[var(--color-surface-2)]",
                    isSelected && "bg-[var(--color-primary)]/10",
                  )}
                >
                  <span className="shrink-0 text-[10px] text-[var(--color-text-muted)] font-mono w-8 text-right mt-0.5">
                    {match.line}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--color-text)] truncate leading-5">
                    {highlightMatch(
                      match.text.trimStart(),
                      query,
                      caseSensitive,
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </>
    );
  }

  if (!isLoading && query.length >= 2) {
    return (
      <div className="flex items-center justify-center h-20 text-xs text-[var(--color-text-muted)]">
        No results for &ldquo;{query}&rdquo;
      </div>
    );
  }

  if (query.length < 2) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-[var(--color-text-muted)] opacity-60">
        {mode === "content" ? "Search file contents" : "Find files by name"}
      </div>
    );
  }

  return null;
}

function highlightMatch(text: string, query: string, caseSensitive: boolean) {
  if (!query) return <span>{text}</span>;

  const flags = caseSensitive ? "g" : "gi";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, flags));

  return (
    <>
      {parts.map((part, index) => {
        const matches = caseSensitive
          ? part === query
          : part.toLowerCase() === query.toLowerCase();
        return matches ? (
          <mark
            key={index}
            className="bg-[var(--color-primary)]/25 text-[var(--color-primary)] rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </>
  );
}
