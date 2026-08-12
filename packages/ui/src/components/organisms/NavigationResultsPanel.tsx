import { useNavigationResultsStore } from "@/stores/navigation-results.js";
import type { SemanticNavigationTarget } from "@dam-hopper/shared";

interface Props {
  onOpen: (target: SemanticNavigationTarget) => void;
}

/** Gate B result surface: metadata only until the user selects one target. */
export function NavigationResultsPanel({ onOpen }: Props) {
  const state = useNavigationResultsStore((store) => store.state);
  if (state.kind === "idle") return null;
  return (
    <section
      className="absolute bottom-2 left-2 right-2 z-20 max-h-56 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)]/95 shadow-xl"
      aria-label="Semantic navigation results"
      aria-live="polite"
      role="region"
    >
      {state.kind === "loading" && (
        <p className="p-3 text-xs text-[var(--color-text-muted)]">
          Finding {state.operation}…
        </p>
      )}
      {state.kind === "empty" && (
        <p className="p-3 text-xs text-[var(--color-text-muted)]">
          No {state.operation} targets found.
        </p>
      )}
      {state.kind === "stale" && (
        <p className="p-3 text-xs text-[var(--color-text-muted)]">
          The editor changed before results arrived.
        </p>
      )}
      {state.kind === "unavailable" && (
        <p className="p-3 text-xs text-[var(--color-text-muted)]">
          Semantic navigation is unavailable for this file.
        </p>
      )}
      {state.kind === "targets" && (
        <>
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-muted)]">
            <span>
              {state.targets.length} {state.operation}
            </span>
            {state.capped && <span>Showing first 500</span>}
          </div>
          <div className="max-h-44 overflow-y-auto">
            {state.targets.map((target, index) => (
              <button
                key={`${target.uri.path}:${target.range.start.line}:${index}`}
                type="button"
                className="block w-full border-b border-[var(--color-border)]/50 px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-2)]"
                onClick={() => onOpen(target)}
              >
                <span className="block truncate">{target.label}</span>
                <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
                  {target.uri.path}:{target.range.start.line + 1}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
