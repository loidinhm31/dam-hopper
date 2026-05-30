interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function NumberStepper({ value, onChange, min = 10, max = 32 }: NumberStepperProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        className="w-7 h-7 flex items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors text-base leading-none"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label="Decrease"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(n);
        }}
        onBlur={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(isNaN(n) ? value : clampNumber(n, min, max));
        }}
        className="w-14 text-center rounded border border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-text)] text-sm px-2 py-1 focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
      />
      <button
        className="w-7 h-7 flex items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors text-base leading-none"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}
