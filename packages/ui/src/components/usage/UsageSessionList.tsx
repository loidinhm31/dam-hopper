import type { UsageSessionSummary } from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import { UsageSessionTokens } from "./UsageSessionTokens.js";

export type UsageSessionViewState = "ready" | "loading" | "empty" | "error";

export interface UsageSessionListProps {
  sessions: UsageSessionSummary[];
  selectedSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  state?: UsageSessionViewState;
  errorMessage?: string;
  nextCursor?: string | null;
  onLoadMore?: () => void;
  className?: string;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function sessionTimeRange(session: UsageSessionSummary): string {
  const started = dateTimeFormatter.format(new Date(session.startedAtUtcMs));
  const ended = session.endedAtUtcMs !== null
    ? dateTimeFormatter.format(new Date(session.endedAtUtcMs))
    : "Active";
  return `${started} – ${ended}`;
}

function modelSummaryCopy(session: UsageSessionSummary): string {
  if (session.models.length === 0) return "Unavailable";
  return session.models
    .map(
      (model) => `${model.model || "Unknown"} ×${model.responseCount}`,
    )
    .join(", ");
}

export function UsageSessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  state = "ready",
  errorMessage,
  nextCursor,
  onLoadMore,
  className,
}: UsageSessionListProps) {
  if (state === "loading")
    return (
      <section
        aria-busy="true"
        className={cn(
          "rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]",
          className,
        )}
      >
        Loading session audit…
      </section>
    );
  if (state === "error")
    return (
      <section
        role="alert"
        className={cn(
          "rounded border border-[var(--color-danger)]/50 bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text)]",
          className,
        )}
      >
        {errorMessage || "Session audit could not be loaded."}
      </section>
    );
  if (state === "empty" || sessions.length === 0)
    return (
      <section
        className={cn(
          "rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]",
          className,
        )}
      >
        No sessions in this range.
      </section>
    );

  return (
    <section
      aria-labelledby="usage-session-list-heading"
      className={cn(
        "rounded border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <h3
          id="usage-session-list-heading"
          className="text-xs font-semibold text-[var(--color-text)]"
        >
          Sessions
        </h3>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {sessions.map((session) => {
          const selected = session.id === selectedSessionId;
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelectSession?.(session.id)}
                aria-pressed={selected}
                className={cn(
                  "block w-full px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset",
                  selected && "bg-[var(--color-primary)]/10",
                )}
              >
                <span className="block min-w-0 truncate text-xs font-medium text-[var(--color-text)]">
                  {session.model || "Model unavailable"}
                </span>
                <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">
                  {sessionTimeRange(session)}
                </span>
                <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">
                  Model: {session.model || "Unavailable"}
                </span>
                <span className="mt-1 block truncate text-[10px] text-[var(--color-text-muted)]">
                  Models: {modelSummaryCopy(session)}
                </span>
                <UsageSessionTokens
                  tokens={session.tokens}
                  compact
                  className="mt-1.5"
                />
              </button>
            </li>
          );
        })}
      </ul>
      {nextCursor && onLoadMore ? (
        <div className="border-t border-[var(--color-border)] p-2">
          <button
            type="button"
            onClick={onLoadMore}
            className="min-h-11 rounded px-2 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            Next page
          </button>
        </div>
      ) : null}
    </section>
  );
}
