import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import type { HistorySearchResult } from "@/lib/command-history.js";

export interface TerminalHistoryListProps {
  /** Deliberately controlled: no passive suggestion can open this workflow. */
  open: boolean;
  query: string;
  results: readonly HistorySearchResult[];
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  /** Inserts exactly this command. The caller must not execute it. */
  onUse: (command: string) => void;
}

/** A history entry can be copied verbatim, but never insert a line break into PTY input. */
export function canUseTerminalHistoryCommand(command: string): boolean {
  return !/[\r\n]/.test(command);
}

async function copyCommand(command: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(command);
    return true;
  } catch {
    return false;
  }
}

function commandIdentifier(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}…` : normalized;
}

/**
 * A keyboard-focused, explicit command-history workflow. Search ranking and
 * terminal mutation remain outside this component so it cannot accept a ghost.
 */
export function TerminalHistoryList({
  open,
  query,
  results,
  onOpenChange,
  onQueryChange,
  onUse,
}: TerminalHistoryListProps) {
  if (!open) return null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <TerminalHistoryListContent
        query={query}
        results={results}
        onQueryChange={onQueryChange}
        onUse={onUse}
      />
    </Dialog>
  );
}

function TerminalHistoryListContent({
  query,
  results,
  onQueryChange,
  onUse,
}: Omit<TerminalHistoryListProps, "open" | "onOpenChange">) {
  const queryRef = useRef<HTMLInputElement>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const hasMultilineResult = results.some(
    (result) => !canUseTerminalHistoryCommand(result.entry.command),
  );

  const copy = async (command: string) => {
    const copied = await copyCommand(command);
    setCopiedCommand(copied ? command : null);
    setCopyFailed(!copied);
  };

  return (
    <DialogContent
        aria-describedby="terminal-history-description"
        className="max-h-[min(42rem,calc(var(--app-viewport-height)_-_2rem))] max-w-3xl gap-3 overflow-y-auto p-4 font-mono text-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          queryRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Command history</DialogTitle>
          <DialogDescription id="terminal-history-description">
            Choose a command to insert into the current prompt. Use never runs it.
          </DialogDescription>
        </DialogHeader>

        <label className="grid gap-1.5 text-xs text-[var(--color-text-muted)]">
          Search history
          <input
            ref={queryRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-9 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus-visible:ring-2 focus-visible:ring-blue-400"
            placeholder="Type to filter commands"
          />
        </label>

        <p aria-live="polite" className="text-xs text-[var(--color-text-muted)]">
          {results.length} {results.length === 1 ? "command" : "commands"}
        </p>
        {hasMultilineResult && (
          <p
            id="terminal-history-multiline-note"
            className="text-xs text-[var(--color-text-muted)]"
          >
            Multi-line commands can be copied but cannot be inserted.
          </p>
        )}

        {results.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
            No matching commands.
          </p>
        ) : (
          <ul aria-label="Matching command history" className="grid gap-2">
            {results.map(({ entry }) => {
              const isMultiline = !canUseTerminalHistoryCommand(entry.command);
              const identifier = commandIdentifier(entry.command);
              return (
                <li
                  key={entry.id}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
                >
                  <code className="block whitespace-pre-wrap break-all text-xs leading-5 text-[var(--color-text)]">
                    {entry.command}
                  </code>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {entry.project ? `Project: ${entry.project}` : "All projects"}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void copy(entry.command)}
                        aria-label={`Copy command: ${identifier}`}
                        className="rounded border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        {copiedCommand === entry.command ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        disabled={isMultiline}
                        aria-describedby={
                          isMultiline
                            ? "terminal-history-multiline-note"
                            : undefined
                        }
                        aria-label={`Use command: ${identifier}`}
                        onClick={() => onUse(entry.command)}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Use
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {copyFailed && (
          <p role="status" className="text-xs text-red-400">
            Copy failed. Your browser did not allow clipboard access.
          </p>
        )}
    </DialogContent>
  );
}
