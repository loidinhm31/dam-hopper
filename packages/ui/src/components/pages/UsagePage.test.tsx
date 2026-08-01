import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsagePage, queryFromSearch, searchFromQuery } from "./UsagePage.js";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("window=7d&bucket=day"),
  setParams: vi.fn(),
  summary: {
    range: { from: 1_782_864_000_000, to: 1_783_468_800_000, bucket: "day" },
    terminal: {
      commandCount: 12,
      succeededCount: 10,
      failedCount: 1,
      interruptedCount: 1,
      unknownCount: 0,
      durationMsSum: 3_600,
    },
    codex: {
      inputTokens: 100,
      cachedInputTokens: null,
      outputTokens: 40,
      reasoningTokens: null,
    },
    timeSeries: [],
    categories: [],
    projects: [],
    detailMetrics: null,
    coverage: {
      detailOnly: false,
      captureQualityFilter: null,
      codexCorrelation: { exact: 1, approximate: 0, unattributed: 0 },
    },
    health: {
      available: true,
      paused: false,
      writerErrors: 0,
      rejectedEvents: 0,
      correlationEnvConflicts: 0,
      sampledAt: 1_783_468_800_000,
      collector: {
        running: false,
        malformed: 0,
        rejected: 0,
        queued: 1,
        dropped: 0,
        duplicate: 0,
        unverifiedVersion: 0,
        coreSchemaDrift: 0,
        unavailableTokenCoverage: 0,
        lastAcceptedAtUtcMs: null,
      },
    },
  },
  settings: {
    enabled: true,
    paused: false,
    detailRetentionDays: 90,
    aggregateRetentionDays: null,
    excludedProjects: [],
    collectorEnabled: false,
    collectorSetup: {
      codexExporter: "notConfigured",
      restartRequired: true,
      serverRestartRequired: false,
    },
    runtime: {
      active: true,
      collector: {
        running: false,
        malformed: 0,
        rejected: 0,
        queued: 0,
        dropped: 0,
        duplicate: 0,
        unverifiedVersion: 0,
        coreSchemaDrift: 0,
        unavailableTokenCoverage: 0,
        lastAcceptedAtUtcMs: null,
      },
      collectorError: null,
    },
  },
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [mocks.params, mocks.setParams],
}));

vi.mock("@/api/queries.js", () => ({
  useDeleteUsageData: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteUsageRange: () => ({ mutate: vi.fn(), isPending: false }),
  useProjects: () => ({ data: [{ name: "api" }] }),
  useUpdateUsageSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useUsageSettings: () => ({ data: mocks.settings }),
  useUsageSummary: () => ({
    data: mocks.summary,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children, title }: { children: unknown; title?: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

describe("UsagePage", () => {
  beforeEach(() => {
    mocks.params = new URLSearchParams("window=7d&bucket=day");
    mocks.setParams.mockClear();
  });

  it("renders privacy copy, aggregate controls, and coverage state", () => {
    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain(
      "Privacy-safe aggregates from DamHopper-managed terminals",
    );
    expect(markup).toContain("No commands or agent content are shown.");
    expect(markup).toContain("Coverage &amp; collection");
    expect(markup).toContain("Pause collection");
    expect(markup).toContain("Delete all usage");
    expect(markup).toContain("No cost estimates");
  });

  it("uses a custom UTC range as the destructive-action scope", () => {
    mocks.params = new URLSearchParams(
      "from=1782864000000&to=1783036800000&bucket=day",
    );

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("Custom UTC range");
    expect(markup).toContain("To (exclusive)");
    expect(markup).toContain("Delete selected range");
  });

  it("round-trips bounded URL filters and validates custom UTC ranges", () => {
    const query = queryFromSearch(
      new URLSearchParams("window=30d&bucket=day&project=api"),
    );
    expect(query).toMatchObject({
      window: "30d",
      bucket: "day",
      project: "api",
    });

    const range = queryFromSearch(
      new URLSearchParams("from=1782864000000&to=1783036800000&bucket=day"),
    );
    expect(range.from).toBe(1_782_864_000_000);
    expect(range.to).toBe(1_783_036_800_000);

    const windowParams = searchFromQuery({
      ...query,
      window: "7d",
      from: undefined,
      to: undefined,
    });
    expect(windowParams.get("window")).toBe("7d");
    expect(windowParams.has("from")).toBe(false);
    expect(windowParams.has("to")).toBe(false);
  });
});
