import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  UsageSessionDetail,
  UsageSessionPage,
  UsageSessionQuery,
  UsageSettings,
  UsageSummary,
} from "@/api/client.js";
import { UsagePage } from "@/components/pages/UsagePage.js";
import "@/index.css";

const calls = vi.hoisted(() => ({
  detail: [] as Array<string | null>,
  sessionEnabled: [] as boolean[],
  sessions: [] as UsageSessionQuery[],
}));

let sessionPage: UsageSessionPage;
let sessionDetail: UsageSessionDetail;
let sessionError: Error | null;
let detailError: Error | null;

vi.mock("@/api/queries.js", () => ({
  useDeleteUsageData: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteUsageRange: () => ({ isPending: false, mutate: vi.fn() }),
  useProjects: () => ({ data: [{ name: "api" }] }),
  useUpdateUsageSettings: () => ({ isPending: false, mutate: vi.fn() }),
  useUsageSettings: () => ({ data: settings }),
  useUsageSession: (id: string | null) => {
    calls.detail.push(id);
    return {
      data: detailError ? undefined : sessionDetail,
      error: detailError,
      isLoading: false,
    };
  },
  useUsageSessions: (query: UsageSessionQuery, enabled: boolean) => {
    calls.sessions.push(query);
    calls.sessionEnabled.push(enabled);
    return {
      data: sessionError ? undefined : sessionPage,
      error: sessionError,
      isLoading: false,
    };
  },
  useUsageSummary: () => ({ data: summary, error: null, isLoading: false }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const tokens = {
  inputTokens: 10,
  cachedInputTokens: 100,
  outputTokens: 20,
  reasoningTokens: 30,
};
const exactCoverage = {
  lineage: "exact",
  tokens: "exact",
  correlation: "exact",
} as const;
const degradedCoverage = {
  lineage: "lineage_unavailable",
  tokens: "token_data_unavailable",
  correlation: "unattributed",
} as const;

const settings: UsageSettings = {
  aggregateRetentionDays: null,
  collectorEnabled: false,
  collectorSetup: {
    codexExporter: "notConfigured",
    restartRequired: false,
    serverRestartRequired: false,
  },
  detailRetentionDays: 90,
  enabled: true,
  excludedProjects: [],
  paused: false,
  terminalCorrelationEnabled: true,
  runtime: {
    active: true,
    collector: {
      coreSchemaDrift: 0,
      dropped: 0,
      duplicate: 0,
      lastAcceptedAtUtcMs: null,
      malformed: 0,
      queued: 0,
      rejected: 0,
      running: false,
      unavailableTokenCoverage: 0,
      unverifiedVersion: 0,
    },
    collectorError: null,
  },
};

const emptyAggregate = {
  commandCount: 0,
  durationMsSum: 0,
  failedCount: 0,
  interruptedCount: 0,
  succeededCount: 0,
  unknownCount: 0,
};
const summary: UsageSummary = {
  categories: [],
  codex: null,
  coverage: {
    captureQualityFilter: null,
    codexCorrelation: null,
    detailOnly: true,
  },
  detailMetrics: null,
  health: {
    available: true,
    collector: settings.runtime.collector,
    correlationEnvConflicts: 0,
    paused: false,
    rejectedEvents: 0,
    sampledAt: 0,
    writerErrors: 0,
  },
  projects: [],
  range: { bucket: "day", from: 100, to: 200 },
  terminal: emptyAggregate,
  timeSeries: [],
};

function makePage(): UsageSessionPage {
  return {
    range: { from: 100, to: 200 },
    nextCursor: "next-page",
    paused: false,
    sessions: [
      {
        id: "a".repeat(64),
        startedAtUtcMs: 110,
        endedAtUtcMs: 190,
        rootModel: "provider/model-a",
        childCount: 1,
        tokens,
        mainTokenShare: 0.4,
        delegationState: "delegated",
        coverage: exactCoverage,
        terminals: [
          {
            id: "c".repeat(64),
            label: "api · 110 · cccccccc",
            project: "api",
            startedAtUtcMs: 110,
            firstSeenAtUtcMs: 110,
            lastSeenAtUtcMs: 190,
          },
        ],
      },
      {
        id: "b".repeat(64),
        startedAtUtcMs: 120,
        endedAtUtcMs: 180,
        rootModel: "provider/model-b",
        childCount: 0,
        tokens: {
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
        },
        mainTokenShare: null,
        delegationState: "lineage_unavailable",
        coverage: degradedCoverage,
        terminals: [],
      },
    ],
  };
}

function makeDetail(): UsageSessionDetail {
  const rootId = "a".repeat(64);
  return {
    session: makePage().sessions[0],
    maxDepth: 16,
    maxNodes: 256,
    paused: false,
    truncated: false,
    nodes: [
      {
        id: rootId,
        parentId: null,
        role: "root",
        depth: 0,
        model: "provider/model-a",
        startedAtUtcMs: 110,
        endedAtUtcMs: 190,
        tokens,
        coverage: exactCoverage,
      },
      {
        id: "d".repeat(64),
        parentId: rootId,
        role: "subagent",
        depth: 1,
        model: "provider/model-b",
        startedAtUtcMs: 120,
        endedAtUtcMs: null,
        tokens: {
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: 5,
          reasoningTokens: null,
        },
        coverage: degradedCoverage,
      },
    ],
  };
}

function SearchProbe() {
  return <output data-testid="usage-location">{useLocation().search}</output>;
}

describe("usage session audit in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    calls.detail.length = 0;
    calls.sessionEnabled.length = 0;
    calls.sessions.length = 0;
    sessionPage = makePage();
    sessionDetail = makeDetail();
    sessionError = null;
    detailError = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderUsage(
    entry = `/usage?view=sessions&session=${"a".repeat(64)}`,
  ) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <UsagePage />
          <SearchProbe />
        </MemoryRouter>,
      );
    });
  }

  it("renders exact and degraded facts without double-counting cached input", async () => {
    await renderUsage();
    expect(container.textContent).toContain("api · 110 · cccccccc");
    expect(container.textContent).toContain("60 primary tokens");
    expect(container.textContent).toContain("Cached input: 100");
    expect(container.textContent).toContain("Lineage unavailable");
    expect(container.textContent).toContain("Token data unavailable");
    expect(container.textContent).toContain(
      "Subagent · provider/model-b · Active",
    );
    expect(container.textContent).not.toContain("raw-provider-session");
    expect(container.textContent).not.toContain("git status");
  });

  it("keeps expansion reachable by keyboard focus and exposes its state", async () => {
    await renderUsage();
    const toggle = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Collapse Root node']",
    );
    toggle?.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain(
      "Subagent · provider/model-b · Active",
    );
  });

  it("keeps cursor and selection in URL state and resets them on filter changes", async () => {
    await renderUsage();
    expect(calls.detail).toContain("a".repeat(64));
    const next = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Next page"));
    await act(async () => next?.click());
    await vi.waitFor(() =>
      expect(
        container.querySelector("[data-testid='usage-location']")?.textContent,
      ).toContain("cursor=next-page"),
    );
    const windowSelect = [
      ...container.querySelectorAll<HTMLLabelElement>("label"),
    ]
      .find((label) => label.textContent?.includes("Window"))
      ?.querySelector("select");
    await act(async () => {
      if (windowSelect) {
        windowSelect.value = "24h";
        windowSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await vi.waitFor(() => {
      const location = container.querySelector(
        "[data-testid='usage-location']",
      )?.textContent;
      expect(location).toContain("view=sessions");
      expect(location).not.toContain("cursor=");
      expect(location).not.toContain("session=");
    });
  });

  it("scopes polling to Sessions and supports the ARIA tab keyboard pattern", async () => {
    await renderUsage("/usage?window=7d&bucket=day");
    expect(calls.sessionEnabled.at(-1)).toBe(false);
    const overviewTab = container.querySelector<HTMLButtonElement>(
      "#usage-overview-tab",
    );
    const sessionsTab = container.querySelector<HTMLButtonElement>(
      "#usage-sessions-tab",
    );
    overviewTab?.focus();
    await act(async () => {
      overviewTab?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-testid='usage-location']")?.textContent,
      ).toContain("view=sessions");
      expect(calls.sessionEnabled.at(-1)).toBe(true);
      expect(document.activeElement).toBe(sessionsTab);
      expect(overviewTab?.tabIndex).toBe(-1);
      expect(sessionsTab?.tabIndex).toBe(0);
    });
  });

  it("resets filters without leaving the Sessions tab", async () => {
    await renderUsage(
      "/usage?view=sessions&window=30d&model=provider%2Fmodel-a",
    );
    const reset = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Reset filters"));
    await act(async () => reset?.click());
    await vi.waitFor(() => {
      const location = container.querySelector(
        "[data-testid='usage-location']",
      )?.textContent;
      expect(location).toContain("view=sessions");
      expect(location).toContain("window=7d");
      expect(location).not.toContain("model=");
    });
  });

  it("renders bounded responsive and empty/error states", async () => {
    sessionPage = { ...makePage(), sessions: [], nextCursor: null };
    await renderUsage("/usage?view=sessions");
    expect(container.textContent).toContain("No sessions in this range.");
    expect(
      container.querySelector(
        ".lg\\:grid-cols-\\[minmax\\(18rem\\,0\\.85fr\\)_minmax\\(0\\,1\\.15fr\\)\\]",
      ),
    ).toBeTruthy();

    await act(async () => root.unmount());
    root = createRoot(container);
    sessionError = new Error("Session audit unavailable");
    await renderUsage("/usage?view=sessions");
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Session audit unavailable",
    );
  });
});
