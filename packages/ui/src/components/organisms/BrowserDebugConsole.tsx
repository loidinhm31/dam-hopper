import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/atoms/Button.js";
import type { BrowserConsoleEntry } from "@/hooks/use-browser-debug.js";
import { cn } from "@/lib/utils.js";

const LEVEL_CLASS: Record<BrowserConsoleEntry["level"], string> = {
  debug: "text-[var(--color-text-muted)]",
  log: "text-[var(--color-text)]",
  info: "text-sky-500",
  warn: "text-amber-500",
  error: "text-red-500",
};

export function BrowserDebugConsole({
  entries,
  onClear,
  available = false,
}: {
  entries: BrowserConsoleEntry[];
  onClear: () => void;
  available?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section
      aria-label="Browser debug console"
      className="shrink-0 border-t border-[var(--color-border)] bg-[#0b1220]"
    >
      <div className="flex h-8 items-center justify-between gap-2 px-3">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--color-text)]"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Browser console
          <span className="text-[var(--color-text-muted)]">
            ({entries.length})
          </span>
        </button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClear}
          disabled={entries.length === 0}
          aria-label="Clear browser console"
          title="Clear browser console"
          className="h-6 px-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </Button>
      </div>
      {expanded && (
        <div
          className="max-h-36 overflow-auto border-t border-[var(--color-border)]/70 px-3 py-1.5 font-mono text-[11px] leading-5"
          role="log"
          aria-live="polite"
        >
          {entries.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">
              {available
                ? "Waiting for target console output. It stays local, is never included in terminal artifacts, and should not contain secrets."
                : "Console forwarding requires a Browser Debug extension built for this exact DamHopper origin."}
            </p>
          ) : (
            entries.map((entry) => (
              <p key={entry.id} className="break-words">
                <span
                  className={cn("mr-2 uppercase", LEVEL_CLASS[entry.level])}
                >
                  {entry.level}
                </span>
                <span className="text-[var(--color-text)]">
                  {entry.message}
                </span>
              </p>
            ))
          )}
        </div>
      )}
    </section>
  );
}
