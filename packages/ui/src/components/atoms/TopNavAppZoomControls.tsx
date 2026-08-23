import { useAppZoom } from "@/contexts/AppZoomContext.js";

const DECREASE_LABEL = "Decrease app layout zoom";
const INCREASE_LABEL = "Increase app layout zoom";

export function TopNavAppZoomControls() {
  const { level, canDecrease, canIncrease, step } = useAppZoom();

  return (
    <div
      aria-label="App layout zoom controls"
      className="flex shrink-0 items-center gap-0.5"
      data-testid="top-nav-app-zoom-controls"
      role="group"
    >
      <button
        type="button"
        className="flex min-h-7 min-w-7 items-center justify-center rounded-sm p-1 text-sm leading-none text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={DECREASE_LABEL}
        title={DECREASE_LABEL}
        data-testid="top-nav-app-zoom-decrease"
        disabled={!canDecrease}
        onClick={() => step("decrease")}
      >
        <span aria-hidden="true">−</span>
      </button>
      <span
        aria-label={`Current app layout zoom: ${level}%`}
        aria-live="polite"
        className="min-w-9 text-center text-[length:calc(var(--app-font-size)*0.65)] text-[var(--color-text-muted)]"
        data-testid="top-nav-app-zoom-level"
      >
        {level}%
      </span>
      <button
        type="button"
        className="flex min-h-7 min-w-7 items-center justify-center rounded-sm p-1 text-sm leading-none text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={INCREASE_LABEL}
        title={INCREASE_LABEL}
        data-testid="top-nav-app-zoom-increase"
        disabled={!canIncrease}
        onClick={() => step("increase")}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
