import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button, inputClass } from "@/components/atoms/Button.js";
import {
  UsageFilters,
  UsageOverview,
  UsageSessionAudit,
} from "@/components/usage/UsageComponents.js";
import {
  useDeleteUsageData,
  useDeleteUsageRange,
  useUpdateUsageSettings,
  useUsageSettings,
  useUsageSession,
  useUsageSessions,
  useUsageSummary,
} from "@/api/queries.js";
import type {
  UsageSessionQuery,
  UsageSummaryQuery,
  UsageWindow,
} from "@/api/client.js";
import type { UsageSessionViewState } from "@/components/usage/UsageComponents.js";

const DEFAULT_QUERY: UsageSummaryQuery = { window: "7d", bucket: "day" };
type UsageView = "overview" | "sessions";

function viewFromSearch(params: URLSearchParams): UsageView {
  return params.get("view") === "sessions" ? "sessions" : "overview";
}

function queryErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

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
  const tabRefs = useRef<Record<UsageView, HTMLButtonElement | null>>({
    overview: null,
    sessions: null,
  });
  const view = viewFromSearch(params);
  const selectedSessionId = params.get("session");
  const sessionCursor = params.get("cursor") || undefined;
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
  const sessionQuery = useMemo<UsageSessionQuery>(
    () => ({
      from: summary?.range.from,
      to: summary?.range.to,
      model: query.model,
      limit: 25,
      cursor: sessionCursor,
    }),
    [
      query.model,
      sessionCursor,
      summary?.range.from,
      summary?.range.to,
    ],
  );
  const sessions = useUsageSessions(
    sessionQuery,
    view === "sessions" && settings?.enabled !== false,
  );
  const sessionDetail = useUsageSession(
    selectedSessionId,
    view === "sessions" && settings?.enabled !== false,
  );
  const updateSettings = useUpdateUsageSettings();
  const deleteAll = useDeleteUsageData();
  const deleteRange = useDeleteUsageRange();

  const updateQuery = (next: UsageSummaryQuery) => {
    const applyViewState = (nextParams: URLSearchParams) => {
      if (view === "sessions") nextParams.set("view", "sessions");
      setParams(nextParams);
    };
    if (next.window) {
      const windowQuery = { ...next, from: undefined, to: undefined };
      applyViewState(searchFromQuery(windowQuery));
      return;
    }
    applyViewState(searchFromQuery(next));
  };
  const reset = () => {
    setCustomFrom("");
    setCustomTo("");
    const nextParams = searchFromQuery(DEFAULT_QUERY);
    if (view === "sessions") nextParams.set("view", "sessions");
    setParams(nextParams);
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
      : "Delete all Codex usage aggregates? This cannot be undone.";
    if (!window.confirm(message)) return;
    if (rangeOnly && query.from !== undefined && query.to !== undefined) {
      deleteRange.mutate({ from: query.from, to: query.to });
    } else {
      deleteAll.mutate();
    }
  };

  const selectView = (nextView: UsageView) => {
    const nextParams = new URLSearchParams(params);
    if (nextView === "sessions") nextParams.set("view", "sessions");
    else nextParams.delete("view");
    nextParams.delete("session");
    nextParams.delete("cursor");
    setParams(nextParams);
  };
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentView: UsageView,
  ) => {
    const views: UsageView[] = ["overview", "sessions"];
    const currentIndex = views.indexOf(currentView);
    const nextView =
      event.key === "Home"
        ? views[0]
        : event.key === "End"
          ? views[1]
          : event.key === "ArrowRight"
            ? views[(currentIndex + 1) % views.length]
            : event.key === "ArrowLeft"
              ? views[(currentIndex - 1 + views.length) % views.length]
              : null;
    if (!nextView) return;
    event.preventDefault();
    selectView(nextView);
    tabRefs.current[nextView]?.focus();
  };
  const selectSession = (id: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("view", "sessions");
    nextParams.set("session", id);
    setParams(nextParams);
  };
  const loadNextSessionPage = () => {
    const nextCursor = sessions.data?.nextCursor;
    if (!nextCursor) return;
    const nextParams = new URLSearchParams(params);
    nextParams.set("view", "sessions");
    nextParams.set("cursor", nextCursor);
    nextParams.delete("session");
    setParams(nextParams);
  };
  const loadFirstSessionPage = () => {
    const nextParams = new URLSearchParams(params);
    nextParams.delete("cursor");
    nextParams.delete("session");
    setParams(nextParams);
  };

  const models = Array.from(
    new Set(
      [
        query.model,
        ...(sessions.data?.sessions.map((session) => session.model) ?? []),
      ].filter((model): model is string => Boolean(model)),
    ),
  ).sort();
  const paused = settings?.paused ?? summary?.health.paused ?? false;
  const requestError = queryErrorMessage(
    error,
    "Usage analytics could not be loaded.",
  );
  const sessionListState: UsageSessionViewState =
    isLoading || sessions.isLoading
      ? "loading"
      : sessions.error
        ? "error"
        : sessions.data?.sessions.length
          ? "ready"
          : "empty";
  const sessionTreeState: UsageSessionViewState = !selectedSessionId
    ? "empty"
    : sessionDetail.isLoading
      ? "loading"
      : sessionDetail.error
        ? "error"
        : sessionDetail.data
          ? "ready"
          : "empty";

  return (
    <AppLayout title="Usage">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Privacy-safe Codex response aggregates. No prompts, responses, or
              raw telemetry payloads are shown.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset filters
            </Button>
            {settings?.enabled === false ? (
              <Link
                to="/settings"
                className="btn-bracket inline-flex items-center gap-1.5"
              >
                Set up insights
              </Link>
            ) : (
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
            )}
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
        {settings?.enabled === false ? (
          <aside
            role="status"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs"
          >
            <p className="font-medium text-[var(--color-text)]">
              Usage insights are disabled.
            </p>
            <p className="mt-1 text-[var(--color-text-muted)]">
              Enable Codex telemetry in Settings, then return here after a
              response completion has been received.
            </p>
          </aside>
        ) : null}

        <div
          role="tablist"
          aria-label="Usage views"
          className="inline-flex rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
        >
          {(["overview", "sessions"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              aria-controls={`usage-${item}-panel`}
              id={`usage-${item}-tab`}
              ref={(element) => {
                tabRefs.current[item] = element;
              }}
              tabIndex={view === item ? 0 : -1}
              onClick={() => selectView(item)}
              onKeyDown={(event) => handleTabKeyDown(event, item)}
              className={`min-h-9 rounded px-3 text-xs font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                view === item
                  ? "bg-[var(--color-primary)] text-[var(--color-background)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <UsageFilters
          value={query}
          onChange={updateQuery}
          disabled={isLoading}
          options={{
            models,
            sessionAudit: view === "sessions",
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

        {view === "overview" ? (
          <UsageOverview
            summary={summary}
            loading={isLoading}
            errorMessage={error ? requestError : undefined}
          />
        ) : (
          <UsageSessionAudit
            page={sessions.data}
            detail={sessionDetail.data}
            selectedSessionId={selectedSessionId}
            cursorActive={Boolean(sessionCursor)}
            listState={sessionListState}
            treeState={sessionTreeState}
            listError={queryErrorMessage(
              sessions.error,
              "Session audit could not be loaded.",
            )}
            detailError={queryErrorMessage(
              sessionDetail.error,
              "Session detail could not be loaded.",
            )}
            onSelectSession={selectSession}
            onNextPage={loadNextSessionPage}
            onFirstPage={loadFirstSessionPage}
          />
        )}
      </div>
    </AppLayout>
  );
}
