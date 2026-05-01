import { Fragment, useRef, useState, useEffect } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useCommandSearch } from "@/hooks/useCommandSearch.js";
import type { CommandDefinition, CombinedSearchResult } from "@/api/client.js";
import type { ProjectType } from "@/api/client.js";

interface Props {
  projectType?: ProjectType;
  projectName?: string;
  onSelect: (command: CommandDefinition) => void;
  onSubmitCustom: (command: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

function findFirstCatalogIndex(results: CombinedSearchResult[]): number {
  return results.findIndex((r) => r.source === "catalog");
}

function SectionHeader({ label }: { label: string }) {
  return (
    <li
      className={cn(
        "px-3 py-1 text-[9px] uppercase tracking-wider font-medium",
        "text-[var(--color-text-muted)] bg-[var(--color-surface-2)]",
        "pointer-events-none select-none",
        "border-b border-[var(--color-border)]",
      )}
    >
      {label}
    </li>
  );
}

function HistoryItem({ result }: { result: CombinedSearchResult }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-xs truncate">{result.command.command}</span>
      {result.historyEntry?.project && (
        <span className="text-[10px] shrink-0 opacity-40">{result.historyEntry.project}</span>
      )}
    </div>
  );
}

function CatalogItem({ result }: { result: CombinedSearchResult }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs truncate">{result.command.command}</span>
        {result.projectType && (
          <span className="text-[10px] shrink-0 opacity-40">{result.projectType}</span>
        )}
      </div>
      {result.command.description && (
        <span className="text-[10px] opacity-60 truncate">{result.command.description}</span>
      )}
    </>
  );
}

export function CommandSuggestionInput({
  projectType,
  projectName,
  onSelect,
  onSubmitCustom,
  placeholder = "Type a command...",
  autoFocus,
  className,
}: Props) {
  const { query, setQuery, results } = useCommandSearch(projectType, projectName);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [openState, setOpenState] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasResults = results.length > 0 && query.trim().length > 0;
  const open = openState && hasResults;

  useEffect(() => {
    setHighlightedIndex(-1);
    setOpenState(true);
  }, [results, query]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!e.shiftKey && highlightedIndex >= 0 && results[highlightedIndex]) {
        onSelect(results[highlightedIndex].command);
        setQuery("");
        setOpenState(false);
      } else {
        onSubmitCustom(e.shiftKey ? "" : query.trim());
        setQuery("");
        setOpenState(false);
      }
    } else if (e.key === "Escape") {
      setOpenState(false);
      setHighlightedIndex(-1);
    }
  }

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  function handleSelect(command: CommandDefinition) {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    onSelect(command);
    setQuery("");
    setOpenState(false);
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      // querySelectorAll skips non-interactive section header <li>s so index maps correctly
      const items = listRef.current.querySelectorAll<HTMLElement>("[data-result-item]");
      items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  return (
    <div className={cn("relative", className)}>
      <div className="relative flex items-center">
        <Search className="absolute left-2 h-3.5 w-3.5 text-[var(--color-text-muted)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setOpenState(false), 150);
          }}
          onFocus={() => {
            if (results.length > 0 && query.trim()) setOpenState(true);
          }}
          placeholder={placeholder}
          className={cn(
            "w-full rounded glass-input pl-7 pr-2.5 py-1.5 text-xs outline-none",
            "text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]",
          )}
        />
      </div>

      {open && results.length > 0 && (
        <ul
          ref={listRef}
          className={cn(
            "absolute z-50 mt-1 w-full max-h-56 overflow-y-auto",
            "rounded border border-[var(--color-border)] bg-[var(--color-surface)]",
            "shadow-lg shadow-black/30",
          )}
        >
          {(() => {
            const firstCatIdx = findFirstCatalogIndex(results);
            return results.map((result, i) => {
              const showHistoryHeader = i === 0 && result.source === "history";
              const showCatalogHeader = i === firstCatIdx && firstCatIdx > 0;

              return (
                <Fragment key={`${result.source}:${i}`}>
                  {showHistoryHeader && <SectionHeader label="Recent" />}
                  {showCatalogHeader && <SectionHeader label="Commands" />}
                  <li
                    data-result-item
                    onMouseDown={() => handleSelect(result.command)}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    className={cn(
                      "flex flex-col gap-0.5 px-3 py-2 cursor-pointer transition-colors",
                      "border-b border-[var(--color-border)] last:border-0",
                      i === highlightedIndex
                        ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
                    )}
                  >
                    {result.source === "history" ? (
                      <HistoryItem result={result} />
                    ) : (
                      <CatalogItem result={result} />
                    )}
                  </li>
                </Fragment>
              );
            });
          })()}
        </ul>
      )}
    </div>
  );
}
