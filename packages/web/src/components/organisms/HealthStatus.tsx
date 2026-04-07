import { useState } from "react";
import { Badge } from "@/components/atoms/Badge.js";
import { useAgentStoreHealth } from "@/api/queries.js";

export function HealthStatus() {
  const { data: health, isLoading, refetch } = useAgentStoreHealth();
  const [expanded, setExpanded] = useState(false);

  const brokenCount = health?.brokenSymlinks?.length ?? 0;
  const orphanCount = health?.orphanedItems?.length ?? 0;
  const totalIssues = brokenCount + orphanCount;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--color-text)]">Health</span>
          {isLoading ? (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
          ) : totalIssues === 0 ? (
            <Badge variant="success">✓ Healthy</Badge>
          ) : (
            <>
              {brokenCount > 0 && <Badge variant="danger">{brokenCount} broken links</Badge>}
              {orphanCount > 0 && <Badge variant="warning">{orphanCount} orphaned</Badge>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refetch()}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Refresh
          </button>
          {totalIssues > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              {expanded ? "Hide" : "Show"}
            </button>
          )}
        </div>
      </div>

      {expanded && totalIssues > 0 && (
        <div className="mt-2 space-y-1">
          {health?.brokenSymlinks?.map((b) => (
            <div key={b.path} className="text-xs font-mono text-[var(--color-danger)]">
              ⚠ {b.project}: {b.path} → {b.target}
            </div>
          ))}
          {health?.orphanedItems?.map((o) => (
            <div key={o.path} className="text-xs font-mono text-[var(--color-warning)]">
              ○ {o.project}: {o.path} ({o.reason})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
