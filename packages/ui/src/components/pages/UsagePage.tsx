import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  Clock3,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button, inputClass } from "@/components/atoms/Button.js";
import {
  UsageCoveragePanel,
  UsageFilters,
  UsageMetricCard,
  UsageTrendChart,
  ProjectExclusions,
  formatDuration,
  hasTokenTotal,
  hasUsageValue,
  formatPercent,
  formatTokenTotal,
  formatUsageNumber,
} from "@/components/usage/UsageComponents.js";
import {
  useDeleteUsageData,
  useDeleteUsageRange,
  useProjects,
  useUpdateUsageSettings,
  useUsageSettings,
  useUsageSummary,
} from "@/api/queries.js";
import type { UsageSummaryQuery, UsageWindow } from "@/api/client.js";

const DEFAULT_QUERY: UsageSummaryQuery = { window: "7d", bucket: "day" };

function isWindow(value: string | null): value is UsageWindow {
  return value === "24h" || value === "7d" || value === "30d";
}

export function queryFromSearch(params: URLSearchParams): UsageSummaryQuery {
  const window = params.get("window");
  const bucket = params.get("bucket");
  const fromValue = params.get("from");
  const toValue = params.get("to");
  const from = fromValue === null ? undefined : Number(fromValue);
  const to = toValue === null ? undefined : Number(toValue);
  return {
    window: isWindow(window) ? window : undefined,
    bucket: bucket === "hour" || bucket === "day" ? bucket : "day",
    project: params.get("project") || undefined,
    shell: (params.get("shell") as UsageSummaryQuery["shell"]) || undefined,
    captureQuality:
      (params.get("captureQuality") as UsageSummaryQuery["captureQuality"]) ||
      undefined,
    category: params.get("category") || undefined,
    agent: (params.get("agent") as "codex" | null) || undefined,
    model: (params.get("model") as UsageSummaryQuery["model"]) || undefined,
    from:
      from !== undefined && Number.isSafeInteger(from) && from >= 0
        ? from
        : undefined,
    to:
      from !== undefined &&
      to !== undefined &&
      Number.isSafeInteger(to) &&
      to > from
        ? to
        : undefined,
  };
}

export function searchFromQuery(query: UsageSummaryQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

function utcDateInput(milliseconds: number | undefined): string {
  return milliseconds !== undefined
    ? new Date(milliseconds).toISOString().slice(0, 10)
    : "";
}

function parseUtcDateInput(value: string): number | undefined {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const [customFrom, setCustomFrom] = useState(() =>
    utcDateInput(queryFromSearch(params).from),
  );
  const [customTo, setCustomTo] = useState(() =>
    utcDateInput(queryFromSearch(params).to),
  );
  const query = useMemo(() => {
    const selected = queryFromSearch(params);
    return selected.from !== undefined && selected.to !== undefined
      ? selected
      : { ...DEFAULT_QUERY, ...selected };
  }, [params]);
  const { data: summary, isLoading, error } = useUsageSummary(query);
  const { data: settings } = useUsageSettings();
  const { data: projects = [] } = useProjects();
  const updateSettings = useUpdateUsageSettings();
  const deleteAll = useDeleteUsageData();
  const deleteRange = useDeleteUsageRange();

  const updateQuery = (next: UsageSummaryQuery) => {
    if (next.window) {
      const windowQuery = { ...next, from: undefined, to: undefined };
      setParams(searchFromQuery(windowQuery));
      return;
    }
    setParams(searchFromQuery(next));
  };
  const reset = () => {
    setCustomFrom("");
    setCustomTo("");
    setParams(searchFromQuery(DEFAULT_QUERY));
  };
  const applyCustomRange = () => {
    const from = parseUtcDateInput(customFrom);
    const to = parseUtcDateInput(customTo);
    if (from === undefined || to === undefined || to <= from) return;
    updateQuery({ ...query, from, to, window: undefined, bucket: "day" });
  };
  const confirmDelete = (rangeOnly: boolean) => {
    const message = rangeOnly
      ? "Delete the selected UTC date range? This cannot be undone."
      : "Delete all terminal and Codex usage aggregates? This cannot be undone.";
    if (!window.confirm(message)) return;
    if (rangeOnly && query.from !== undefined && query.to !== undefined) {
      deleteRange.mutate({ from: query.from, to: query.to });
    } else {
      deleteAll.mutate();
    }
  };

  const categories = summary?.categories.map((item) => item.name) ?? [];
  const models = summary?.codex ? ["gpt-5.6-sol"] : [];
  const detail = summary?.detailMetrics;
  const paused = settings?.paused ?? summary?.health.paused ?? false;
  const excludedProjects = settings?.excludedProjects ?? [];
  const requestError =
    error instanceof Error
      ? error.message
      : "Usage analytics could not be loaded.";

  const addProjectExclusion = (
    project: string,
    onSuccess: () => void,
    onError: () => void,
  ) => {
    if (excludedProjects.includes(project)) return;
    updateSettings.mutate(
      { excludedProjects: [...excludedProjects, project] },
      { onSuccess, onError },
    );
  };

  const removeProjectExclusion = (
    projectName: string,
    onSuccess: () => void,
    onError: () => void,
  ) => {
    updateSettings.mutate(
      {
        excludedProjects: excludedProjects.filter(
          (name) => name !== projectName,
        ),
      },
      { onSuccess, onError },
    );
  };

  return (
    <AppLayout title="Usage">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Privacy-safe aggregates from DamHopper-managed terminals. No
              commands or agent content are shown.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset filters
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={updateSettings.isPending}
              onClick={() => updateSettings.mutate({ paused: !paused })}
            >
              {paused ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
              {paused ? "Resume collection" : "Pause collection"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={deleteAll.isPending || deleteRange.isPending}
              onClick={() =>
                confirmDelete(
                  query.from !== undefined && query.to !== undefined,
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              {query.from !== undefined && query.to !== undefined
                ? "Delete selected range"
                : "Delete all usage"}
            </Button>
          </div>
        </div>

        <UsageFilters
          value={query}
          onChange={updateQuery}
          disabled={isLoading}
          options={{
            projects: projects.map((project) => project.name),
            categories,
            models,
            showAdvanced: true,
          }}
        />
        <fieldset className="flex flex-wrap items-end gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
          <legend className="px-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Custom UTC range
          </legend>
          <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            From
            <input
              className={inputClass}
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            To (exclusive)
            <input
              className={inputClass}
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </label>
          <Button variant="secondary" size="sm" onClick={applyCustomRange}>
            Apply custom range
          </Button>
        </fieldset>

        <ProjectExclusions
          excludedProjects={excludedProjects}
          isPending={updateSettings.isPending}
          projects={projects}
          settingsLoaded={Boolean(settings)}
          onAdd={addProjectExclusion}
          onRemove={removeProjectExclusion}
        />

        {isLoading ? (
          <p className="rounded glass-card p-6 text-sm text-[var(--color-text-muted)]">
            Loading aggregate usage…
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-text)]"
          >
            {requestError}
          </p>
        ) : null}
        {summary ? (
          <>
            <UsageCoveragePanel
              coverage={summary.coverage}
              health={summary.health}
            />
            <section
              aria-label="Terminal aggregate metrics"
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <UsageMetricCard
                label="Commands"
                value={formatUsageNumber(summary.terminal.commandCount)}
                icon={Activity}
                tone="primary"
                description={`${formatUsageNumber(summary.terminal.succeededCount)} succeeded · ${formatUsageNumber(summary.terminal.failedCount)} failed`}
              />
              <UsageMetricCard
                label="Active execution"
                value={formatDuration(summary.terminal.durationMsSum)}
                icon={Clock3}
                description="Total command execution time in this range."
              />
              <UsageMetricCard
                label="P50 duration"
                value={formatDuration(detail?.durationP50Ms)}
                unavailable={!detail}
                description={
                  detail
                    ? "Median completed command duration."
                    : "Available only within detail retention."
                }
              />
              <UsageMetricCard
                label="P95 duration"
                value={formatDuration(detail?.durationP95Ms)}
                unavailable={!detail}
                description={
                  detail
                    ? "Nearest-rank 95th percentile."
                    : "Available only within detail retention."
                }
              />
              <UsageMetricCard
                label="Repeated commands"
                value={formatUsageNumber(detail?.repeatedCommandCount)}
                unavailable={!detail}
                description={
                  detail
                    ? "Additional occurrences of a retained command fingerprint."
                    : "Available only within detail retention."
                }
              />
            </section>
            <section className="grid gap-3 lg:grid-cols-2">
              <UsageTrendChart
                series={summary.timeSeries}
                bucket={summary.range.bucket}
                metric="commands"
                title="Terminal commands over time"
              />
              <UsageTrendChart
                series={summary.timeSeries}
                bucket={summary.range.bucket}
                metric="tokens"
                title="Codex tokens over time"
              />
            </section>
            <section
              aria-label="Terminal breakdowns"
              className="grid gap-3 lg:grid-cols-2"
            >
              <UsageBreakdown title="Categories" entries={summary.categories} />
              <UsageBreakdown title="Projects" entries={summary.projects} />
            </section>
            <section
              aria-label="Codex aggregate metrics"
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-xs font-semibold text-[var(--color-text)]">
                  Codex usage
                </h2>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  No cost estimates
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <UsageMetricCard
                  label="Total tokens"
                  value={formatTokenTotal(summary.codex)}
                  unavailable={!hasTokenTotal(summary.codex)}
                  description="Input, output, and reasoning token components."
                />
                <UsageMetricCard
                  label="Input tokens"
                  value={formatUsageNumber(summary.codex?.inputTokens)}
                  unavailable={!hasUsageValue(summary.codex?.inputTokens)}
                />
                <UsageMetricCard
                  label="Cached input"
                  value={formatUsageNumber(summary.codex?.cachedInputTokens)}
                  unavailable={!hasUsageValue(summary.codex?.cachedInputTokens)}
                />
                <UsageMetricCard
                  label="Output tokens"
                  value={formatUsageNumber(summary.codex?.outputTokens)}
                  unavailable={!hasUsageValue(summary.codex?.outputTokens)}
                />
                <UsageMetricCard
                  label="Reasoning tokens"
                  value={formatUsageNumber(summary.codex?.reasoningTokens)}
                  unavailable={!hasUsageValue(summary.codex?.reasoningTokens)}
                />
                <UsageMetricCard
                  label="Cache ratio"
                  value={formatPercent(
                    summary.codex?.cachedInputTokens,
                    summary.codex?.inputTokens,
                  )}
                  unavailable={!summary.codex}
                  description="Cached input ÷ reported input tokens."
                />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}

function UsageBreakdown({
  title,
  entries,
}: {
  title: string;
  entries: ReadonlyArray<{
    name: string;
    terminal: { commandCount: number; failedCount: number };
  }>;
}) {
  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h2 className="text-xs font-semibold text-[var(--color-text)]">
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          No aggregate data in this range.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  Name
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Commands
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Failed
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.name}
                  className="border-t border-[var(--color-border)]"
                >
                  <th
                    scope="row"
                    className="py-2 font-medium text-[var(--color-text)]"
                  >
                    {entry.name}
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {formatUsageNumber(entry.terminal.commandCount)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatUsageNumber(entry.terminal.failedCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
