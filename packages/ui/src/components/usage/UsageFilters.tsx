import type {
  UsageBucket,
  UsageModel,
  UsageSummaryQuery,
  UsageWindow,
} from "@/api/client.js";
import { cn } from "@/lib/utils.js";

export interface UsageFilterOptions {
  models?: readonly string[];
  sessionAudit?: boolean;
}

export interface UsageFiltersProps {
  value: Pick<UsageSummaryQuery, "window" | "bucket" | "model">;
  onChange: (next: UsageSummaryQuery) => void;
  options?: UsageFilterOptions;
  disabled?: boolean;
  className?: string;
}

const windows: readonly UsageWindow[] = ["24h", "7d", "30d"];
const buckets: readonly UsageBucket[] = ["hour", "day"];
const selectClass =
  "h-8 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/60 disabled:cursor-not-allowed disabled:opacity-50";

export function UsageFilters({
  value,
  onChange,
  options = {},
  disabled = false,
  className,
}: UsageFiltersProps) {
  const update = (patch: Partial<UsageSummaryQuery>) =>
    onChange({ ...value, ...patch });

  return (
    <fieldset
      aria-label="Codex usage filters"
      disabled={disabled}
      className={cn(
        "flex flex-wrap items-end gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5",
        className,
      )}
    >
      <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        Window
        <select
          value={value.window ?? "7d"}
          onChange={(event) =>
            update({ window: event.target.value as UsageWindow })
          }
          className={selectClass}
        >
          {windows.map((window) => (
            <option key={window} value={window}>
              Last {window}
            </option>
          ))}
        </select>
      </label>
      {!options.sessionAudit ? (
        <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          Group by
          <select
            value={value.bucket ?? "day"}
            onChange={(event) =>
              update({ bucket: event.target.value as UsageBucket })
            }
            className={selectClass}
          >
            {buckets.map((bucket) => (
              <option key={bucket} value={bucket}>
                {bucket === "hour" ? "Hour" : "Day"}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {options.models && options.models.length > 0 ? (
        <label className="grid min-w-40 flex-1 gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          Model
          <select
            value={value.model ?? ""}
            onChange={(event) =>
              update({
                model: (event.target.value || undefined) as
                  | UsageModel
                  | undefined,
              })
            }
            className={selectClass}
          >
            <option value="">All models</option>
            {options.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </fieldset>
  );
}
