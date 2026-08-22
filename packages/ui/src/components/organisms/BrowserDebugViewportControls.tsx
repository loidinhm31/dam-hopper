import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { Input } from "@/components/ui/Input.js";
import {
  BROWSER_DEBUG_VIEWPORT_MAX_HEIGHT,
  BROWSER_DEBUG_VIEWPORT_MAX_WIDTH,
  BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT,
  BROWSER_DEBUG_VIEWPORT_MIN_WIDTH,
  BROWSER_DEBUG_VIEWPORT_RESIZE_STEP,
  type BrowserDebugViewportSize,
  type BrowserDebugViewportState,
  validateBrowserDebugViewportDimension,
} from "@/lib/browser-debug-viewport.js";
import { cn } from "@/lib/utils.js";

interface BrowserDebugViewportControlsProps {
  state: BrowserDebugViewportState;
  onModeChange: (mode: BrowserDebugViewportState["mode"]) => void;
  onSizeChange: (size: BrowserDebugViewportSize) => void;
  onStep: (direction: "increase" | "decrease") => void;
}

type Dimension = "width" | "height";
type DimensionErrors = Record<Dimension, string | null>;

export function BrowserDebugViewportControls({
  state,
  onModeChange,
  onSizeChange,
  onStep,
}: BrowserDebugViewportControlsProps) {
  const id = useId();
  const modeName = `browser-debug-viewport-mode-${id}`;
  const widthId = `browser-debug-viewport-width-${id}`;
  const heightId = `browser-debug-viewport-height-${id}`;
  const hintId = `browser-debug-viewport-hint-${id}`;
  const [errors, setErrors] = useState<DimensionErrors>({
    width: null,
    height: null,
  });

  const commitDimension = (dimension: Dimension, draft: string) => {
    const result = validateBrowserDebugViewportDimension(draft);
    setErrors((current) => ({ ...current, [dimension]: result.error }));
    if (result.value === null || state.mode !== "custom") return;

    setErrors((current) => ({ ...current, [dimension]: null }));
    onSizeChange({
      ...state.customSize,
      [dimension]: result.value,
    });
  };

  const handleModeChange = (mode: BrowserDebugViewportState["mode"]) => {
    setErrors({ width: null, height: null });
    onModeChange(mode);
  };

  const handleStep = (direction: "increase" | "decrease") => {
    setErrors({ width: null, height: null });
    onStep(direction);
  };

  const clearDimensionError = (dimension: Dimension) => {
    setErrors((current) => ({ ...current, [dimension]: null }));
  };

  const renderMode = (
    mode: BrowserDebugViewportState["mode"],
    label: string,
  ) => (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center rounded border px-3 text-xs font-medium transition-colors",
        "focus-within:ring-2 focus-within:ring-[var(--color-ring)]",
        state.mode === mode
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-text)]"
          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
      )}
    >
      <input
        type="radio"
        name={modeName}
        value={mode}
        checked={state.mode === mode}
        onChange={() => handleModeChange(mode)}
        className="sr-only"
      />
      {label}
    </label>
  );

  return (
    <section
      aria-label="Browser viewport controls"
      className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
      data-testid="browser-debug-viewport-controls"
    >
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <fieldset className="flex min-w-0 flex-wrap items-end gap-2">
          <legend className="sr-only">Viewport mode</legend>
          {renderMode("responsive", "Responsive")}
          {renderMode("custom", "Custom")}
        </fieldset>

        {state.mode === "custom" && (
          <>
            <label
              key={`width-${state.customSize.width}`}
              className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]"
            >
              <span>Width (CSS pixels)</span>
              <Input
                id={widthId}
                type="number"
                inputMode="numeric"
                min={BROWSER_DEBUG_VIEWPORT_MIN_WIDTH}
                max={BROWSER_DEBUG_VIEWPORT_MAX_WIDTH}
                step={1}
                defaultValue={state.customSize.width}
                aria-invalid={Boolean(errors.width)}
                aria-describedby={`${hintId}${errors.width ? ` ${widthId}-error` : ""}`}
                className="h-11 min-h-11"
                onChange={() => clearDimensionError("width")}
                onBlur={(event) =>
                  commitDimension("width", event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitDimension("width", event.currentTarget.value);
                  }
                }}
              />
              {errors.width && (
                <span
                  id={`${widthId}-error`}
                  role="alert"
                  className="text-[11px] text-[var(--color-danger)]"
                >
                  {errors.width}
                </span>
              )}
            </label>
            <label
              key={`height-${state.customSize.height}`}
              className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]"
            >
              <span>Height (CSS pixels)</span>
              <Input
                id={heightId}
                type="number"
                inputMode="numeric"
                min={BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT}
                max={BROWSER_DEBUG_VIEWPORT_MAX_HEIGHT}
                step={1}
                defaultValue={state.customSize.height}
                aria-invalid={Boolean(errors.height)}
                aria-describedby={`${hintId}${errors.height ? ` ${heightId}-error` : ""}`}
                className="h-11 min-h-11"
                onChange={() => clearDimensionError("height")}
                onBlur={(event) =>
                  commitDimension("height", event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitDimension("height", event.currentTarget.value);
                  }
                }}
              />
              {errors.height && (
                <span
                  id={`${heightId}-error`}
                  role="alert"
                  className="text-[11px] text-[var(--color-danger)]"
                >
                  {errors.height}
                </span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="md"
                variant="ghost"
                className="h-11 min-h-11 w-11 min-w-11 px-0"
                aria-label={`Decrease viewport size by ${BROWSER_DEBUG_VIEWPORT_RESIZE_STEP} CSS pixels`}
                title={`Decrease viewport size by ${BROWSER_DEBUG_VIEWPORT_RESIZE_STEP} CSS pixels`}
                disabled={
                  state.customSize.width === BROWSER_DEBUG_VIEWPORT_MIN_WIDTH &&
                  state.customSize.height === BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT
                }
                onClick={() => handleStep("decrease")}
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="md"
                variant="ghost"
                className="h-11 min-h-11 w-11 min-w-11 px-0"
                aria-label={`Increase viewport size by ${BROWSER_DEBUG_VIEWPORT_RESIZE_STEP} CSS pixels`}
                title={`Increase viewport size by ${BROWSER_DEBUG_VIEWPORT_RESIZE_STEP} CSS pixels`}
                disabled={
                  state.customSize.width === BROWSER_DEBUG_VIEWPORT_MAX_WIDTH &&
                  state.customSize.height === BROWSER_DEBUG_VIEWPORT_MAX_HEIGHT
                }
                onClick={() => handleStep("increase")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </>
        )}
      </div>
      <p
        id={hintId}
        className="mt-1.5 text-[11px] text-[var(--color-text-muted)]"
      >
        {state.mode === "custom"
          ? `${BROWSER_DEBUG_VIEWPORT_MIN_WIDTH}–${BROWSER_DEBUG_VIEWPORT_MAX_WIDTH} CSS pixels · step controls change both dimensions by ${BROWSER_DEBUG_VIEWPORT_RESIZE_STEP}px`
          : "Responsive uses the available device screen size."}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {state.mode === "custom"
          ? `Custom viewport ${state.customSize.width} by ${state.customSize.height} CSS pixels`
          : "Responsive viewport selected"}
      </p>
    </section>
  );
}
