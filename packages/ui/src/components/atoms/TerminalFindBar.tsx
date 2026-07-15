import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils.js";
import {
  TERMINAL_FIND_STATUS,
  type TerminalFindSnapshot,
} from "@/lib/terminal-find-controller.js";

interface TerminalFindBarProps {
  snapshot: TerminalFindSnapshot;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  autoFocusInput?: boolean;
}

export function focusTerminalFindInput(
  input: Pick<HTMLInputElement, "focus" | "select"> | null,
  shouldFocus: boolean,
): void {
  if (!shouldFocus) return;
  input?.focus();
  input?.select();
}

function getStatusLabel(snapshot: TerminalFindSnapshot): string {
  if (snapshot.status === TERMINAL_FIND_STATUS.MATCHES) {
    return `${snapshot.resultIndex} of ${snapshot.resultCount}`;
  }
  if (snapshot.status === TERMINAL_FIND_STATUS.NO_MATCH) return "No matches";
  return "Type to search";
}

export function TerminalFindBar({
  snapshot,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
  autoFocusInput = true,
}: TerminalFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hasQuery = snapshot.query.length > 0;
  const statusLabel = getStatusLabel(snapshot);

  useEffect(() => {
    focusTerminalFindInput(inputRef.current, autoFocusInput);
  }, [autoFocusInput]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
    }
  };

  const keepInputFocused = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div
      role="search"
      aria-label="Terminal search"
      data-testid="terminal-find-bar"
      className={cn(
        "absolute right-2 top-2 z-50 flex max-w-[calc(100%-1rem)] items-center gap-1",
        "rounded-md border border-slate-700 bg-slate-900/95 p-1 shadow-xl shadow-black/50",
        "font-mono text-xs backdrop-blur-sm",
      )}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label className="sr-only" htmlFor={inputId}>
        Find in terminal
      </label>
      <Search
        className="ml-1 h-3.5 w-3.5 shrink-0 text-slate-400"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={inputId}
        value={snapshot.query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 w-36 bg-transparent px-1 py-1 text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-blue-400 sm:w-48"
      />
      <span
        aria-live="polite"
        data-testid="terminal-find-status"
        className={cn(
          "min-w-20 px-1 text-center text-[10px]",
          snapshot.status === TERMINAL_FIND_STATUS.NO_MATCH
            ? "text-amber-300"
            : "text-slate-400",
        )}
      >
        {statusLabel}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={!hasQuery}
        onMouseDown={keepInputFocused}
        onClick={onPrevious}
        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={!hasQuery}
        onMouseDown={keepInputFocused}
        onClick={onNext}
        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Close terminal search"
        title="Close (Escape)"
        onMouseDown={keepInputFocused}
        onClick={onClose}
        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
