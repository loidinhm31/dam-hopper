import type { UsageSessionDetail } from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import type { UsageSessionViewState } from "./UsageSessionList.js";
import { UsageSessionTokens } from "./UsageSessionTokens.js";

export interface UsageSessionTreeProps {
  detail?: UsageSessionDetail;
  state?: UsageSessionViewState;
  errorMessage?: string;
  className?: string;
}

export function UsageSessionTree({
  detail,
  state = "ready",
  errorMessage,
  className,
}: UsageSessionTreeProps) {
  if (state === "loading") {
    return (
      <section
        aria-busy="true"
        className={cn(
          "rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]",
          className,
        )}
      >
        Loading session detail…
      </section>
    );
  }
  if (state === "error") {
    return (
      <section
        role="alert"
        className={cn(
          "rounded border border-[var(--color-danger)]/50 bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text)]",
          className,
        )}
      >
        {errorMessage || "Session detail could not be loaded."}
      </section>
    );
  }
  if (state === "empty" || !detail) {
    return (
      <section
        className={cn(
          "rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]",
          className,
        )}
      >
        No session summary is available.
      </section>
    );
  }

  const { session } = detail;
  return (
    <section
      aria-labelledby="usage-session-detail-heading"
      className={cn(
        "rounded border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <h3
          id="usage-session-detail-heading"
          className="text-xs font-semibold text-[var(--color-text)]"
        >
          Session summary
        </h3>
      </div>
      <div className="space-y-3 p-3">
        <p className="text-xs text-[var(--color-text-muted)]">
          {session.model || "Model unavailable"} ·{" "}
          {new Date(session.startedAtUtcMs).toLocaleString()}
        </p>
        <UsageSessionTokens tokens={session.tokens} />
        {session.models.length > 0 ? (
          <div>
            <h4 className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Models
            </h4>
            <ul className="mt-2 space-y-2">
              {session.models.map((model) => (
                <li
                  key={model.model || "unknown"}
                  className="rounded border border-[var(--color-border)] p-2 text-xs"
                >
                  <p className="font-medium text-[var(--color-text)]">
                    {model.model || "Model unavailable"}
                  </p>
                  <UsageSessionTokens tokens={model.tokens} compact className="mt-1" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
