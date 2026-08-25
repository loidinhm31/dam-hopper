import {
  DIAGNOSTICS_WINDOW_OPTIONS,
  type DiagnosticsTimeWindowMinutes,
} from "@/lib/diagnostics-export.js";
import { cn } from "@/lib/utils.js";

interface DiagnosticsTimeWindowSelectProps {
  value: DiagnosticsTimeWindowMinutes;
  onChange: (value: DiagnosticsTimeWindowMinutes) => void;
  className?: string;
}

export function DiagnosticsTimeWindowSelect({
  value,
  onChange,
  className,
}: DiagnosticsTimeWindowSelectProps) {
  return (
    <select
      aria-label="Diagnostics time window"
      value={value}
      onChange={(event) =>
        onChange(Number(event.target.value) as DiagnosticsTimeWindowMinutes)
      }
      className={cn(
        "h-7 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/50",
        className,
      )}
    >
      {DIAGNOSTICS_WINDOW_OPTIONS.map((minutes) => (
        <option key={minutes} value={minutes}>
          Last {minutes}m
        </option>
      ))}
    </select>
  );
}
