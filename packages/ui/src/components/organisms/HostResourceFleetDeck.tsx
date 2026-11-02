import { useId } from "react";
import type { MultiHostResourceEntry } from "@/hooks/use-multi-host-resources.js";
import { HostResourceFleetCard } from "@/components/organisms/HostResourceFleetCard.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
export interface HostResourceFleetDeckProps {
  entries: MultiHostResourceEntry[];
  selectedProfileId?: string;
  onInspect: (profileId: string) => void;
  onSelectAll?: () => void;
  layout?: "vertical" | "grid" | "horizontal";
  className?: string;
}
export function HostResourceFleetDeck({
  entries,
  selectedProfileId,
  onInspect,
  onSelectAll,
  layout = "vertical",
  className = "",
}: HostResourceFleetDeckProps) {
  const headingId = useId();
  const cognitoActive = useCognitoModeStore((state) => state.active);
  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <h3
            id={headingId}
            className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]"
          >
            Fleet Overview
          </h3>
          {onSelectAll && (
            <button
              type="button"
              onClick={onSelectAll}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                selectedProfileId === undefined
                  ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] border border-[var(--color-primary)]/40"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
              }`}
            >
              All Fleet
            </button>
          )}
        </div>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {entries.length} watched {entries.length === 1 ? "profile" : "profiles"}
        </span>
      </div>

      {entries.length === 0 ? (
        <div
          role="status"
          className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-text-muted)]"
        >
          No connected or auto-connect profiles to watch.
        </div>
      ) : (
        <ul
          role="list"
          className={
            layout === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
              : layout === "horizontal"
                ? "flex gap-2 overflow-x-auto pb-1"
                : "flex flex-col gap-2"
          }
        >
          {entries.map((entry, idx) => {
            const displayEntry = cognitoActive
              ? {
                  ...entry,
                  profile: {
                    ...entry.profile,
                    name: `Profile ${idx + 1}`,
                    url: "protected://host",
                  },
                  snapshot: entry.snapshot
                    ? {
                        ...entry.snapshot,
                        host: {
                          ...entry.snapshot.host,
                          hostname: "protected-host",
                        },
                      }
                    : undefined,
                }
              : entry;
            return (
              <li key={entry.profile.id}>
                <HostResourceFleetCard
                  entry={displayEntry}
                  selected={entry.profile.id === selectedProfileId}
                  onInspect={onInspect}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
