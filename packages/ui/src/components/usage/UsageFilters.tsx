import type {
  UsageBucket,
  UsageCaptureQuality,
  UsageShell,
  UsageSummaryQuery,
  UsageWindow,
} from "@/api/client.js";
import { cn } from "@/lib/utils.js";

export interface UsageFilterOptions {
  projects?: readonly string[];
  categories?: readonly string[];
  models?: readonly string[];
  showAdvanced?: boolean;
}

export interface UsageFiltersProps {
  value: Pick<
    UsageSummaryQuery,
    | "window"
    | "bucket"
    | "project"
    | "shell"
    | "captureQuality"
    | "category"
    | "agent"
    | "model"
  >;
  onChange: (next: UsageSummaryQuery) => void;
  options?: UsageFilterOptions;
  disabled?: boolean;
  className?: string;
}

const windows: readonly UsageWindow[] = ["24h", "7d", "30d"];
const buckets: readonly UsageBucket[] = ["hour", "day"];
const shells: readonly UsageShell[] = ["bash", "zsh", "fish"];
const captureQualities: readonly UsageCaptureQuality[] = [
  "rich",
  "partial",
  "unavailable",
];

const selectClass =
  "h-8 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/60 disabled:cursor-not-allowed disabled:opacity-50";

function titleCase(value: string) {
  return value.replace(/(^|[-_ ])\w/g, (character) => character.toUpperCase());
}

export function UsageFilters({
  value,
  onChange,
  options = {},
  disabled = false,
  className,
}: UsageFiltersProps) {
  const update = (patch: Partial<UsageSummaryQuery>) => onChange({ ...value, ...patch });
  const advancedVisible =
    options.showAdvanced ||
    Boolean(value.project || value.shell || value.captureQuality || value.category || value.agent || value.model);

  return (
    <fieldset
      aria-label="Usage filters"
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
          onChange={(event) => update({ window: event.target.value as UsageWindow })}
          className={selectClass}
        >
          {windows.map((window) => <option key={window} value={window}>Last {window}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        Group by
        <select
          value={value.bucket ?? "day"}
          onChange={(event) => update({ bucket: event.target.value as UsageBucket })}
          className={selectClass}
        >
          {buckets.map((bucket) => <option key={bucket} value={bucket}>{titleCase(bucket)}</option>)}
        </select>
      </label>
      {options.projects && options.projects.length > 0 ? (
        <label className="grid min-w-32 flex-1 gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          Project
          <select value={value.project ?? ""} onChange={(event) => update({ project: event.target.value || undefined })} className={selectClass}>
            <option value="">All projects</option>
            {options.projects.map((project) => <option key={project} value={project}>{project}</option>)}
          </select>
        </label>
      ) : null}
      {advancedVisible ? (
        <>
          <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Shell
            <select value={value.shell ?? ""} onChange={(event) => update({ shell: (event.target.value || undefined) as UsageShell | undefined })} className={selectClass}>
              <option value="">Any shell</option>
              {shells.map((shell) => <option key={shell} value={shell}>{shell}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Capture
            <select value={value.captureQuality ?? ""} onChange={(event) => update({ captureQuality: (event.target.value || undefined) as UsageCaptureQuality | undefined })} className={selectClass}>
              <option value="">All coverage</option>
              {captureQualities.map((quality) => <option key={quality} value={quality}>{titleCase(quality)}</option>)}
            </select>
          </label>
          {options.categories && options.categories.length > 0 ? (
            <label className="grid min-w-28 gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Category
              <select value={value.category ?? ""} onChange={(event) => update({ category: event.target.value || undefined })} className={selectClass}>
                <option value="">All categories</option>
                {options.categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Agent
            <select value={value.agent ?? ""} onChange={(event) => update({ agent: (event.target.value || undefined) as "codex" | undefined })} className={selectClass}>
              <option value="">All agents</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          {options.models && options.models.length > 0 ? (
            <label className="grid min-w-28 gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Model
              <select value={value.model ?? ""} onChange={(event) => update({ model: (event.target.value || undefined) as "gpt-5.6-sol" | undefined })} className={selectClass}>
                <option value="">All models</option>
                {options.models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
