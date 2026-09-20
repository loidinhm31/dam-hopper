import { useId } from "react";
import type { MultiHostResourceEntry } from "@/hooks/use-multi-host-resources.js";
import { HostResourceFleetCard } from "@/components/organisms/HostResourceFleetCard.js";

export interface HostResourceFleetDeckProps {
  entries: MultiHostResourceEntry[];
  selectedProfileId?: string;
  onInspect: (profileId: string) => void;
}

export function HostResourceFleetDeck({
  entries,
  selectedProfileId,
  onInspect,
}: HostResourceFleetDeckProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-0.5">
        <h3
          id={headingId}
          className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]"
        >
          Fleet Overview
        </h3>
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
        <ul role="list" className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.profile.id}>
              <HostResourceFleetCard
                entry={entry}
                selected={entry.profile.id === selectedProfileId}
                onInspect={onInspect}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
